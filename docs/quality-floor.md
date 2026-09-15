# Quality floor — measured on production

`CLAUDE.md` sets a quality floor for every page on both sites. This document is
where the floor is **measured**, on the two production domains after a promotion,
and where the numbers live — with the instrument, its version and the command that
produced them, so the next measurement is comparable with this one. Story #13.

The per-page stories checked what they could on their own page, usually served
locally. This is different in two ways that matter: it measures the deployed sites
(Cloudflare's edge, the real redirects, the real fonts) and it measures **every**
page in one run, so a regression on a page nobody was working on still shows up.

## How to re-run it

```sh
node tools/quality_floor.mjs
```

That is the whole command. It needs Node and a system Chrome, nothing installed in
the repo: Lighthouse is fetched through `npx` at the **exact version pinned in the
script** (`LH_VERSION`), and the other three measurements drive a headless Chrome
over the DevTools protocol with Node's built-in WebSocket. It rewrites everything
between the `generated:start` / `generated:end` markers below and leaves this prose
alone. `--runs 1` is quicker and noisier; `--only <substring>` restricts the pages
— **and a write from a restricted run replaces the whole block with only those
pages**, so pair `--only` with `--no-write` unless losing the other rows is
intended (#50 found this out by reading the code, not by doing it);
`--base-hq` / `--base-sailing` point it at a local serve (used for the controls
below). It exits non-zero when anything is under the floor, so a shell can read
the verdict. From Git Bash, prefix `MSYS_NO_PATHCONV=1` or drop the leading slash
from `--only`, or the shell rewrites `/logs/` into a path under its own install.

Pages are derived from the tree — every `.html` under `hq/` and `sailing/` — so a
new page is measured on the next run without editing the script.

**It is deliberately not wired into CI.** `CLAUDE.md` says the only build step is
the one-line copy in the Pages config and means it; `githooks/checks` and `ci.yml`
run one list each and are required to stay identical. Beyond that rule, this is
the wrong shape for a gate: it measures the *deployed* sites, which a pull request
has not changed yet, and Lighthouse's performance score varies run to run for a
reason explained under *Findings* — a gate that goes red on the same commit one
time in three gets `--no-verify`'d rather than fixed. Run it after a promotion, or
when a story claims to have moved one of these numbers.

## How to read the table

- **Performance** is the median of three Lighthouse runs, with all three shown in
  brackets; the spread is part of the measurement, not noise to hide. Anything
  under the page's floor is marked and explained under *Under the floor* with its
  LCP element and what Lighthouse itself names as render-blocking. The floor is 95
  unless `CLAUDE.md` sets a page its own, and then it is shown beside the score:
  the sailing logs index is held to 90 since #96, and each trip page to 85 since
  #53. The tool reads that number from `PERF_FLOORS` in the script (#124).
- **Accessibility** is deterministic and is read from the last run.
- **CLS** is Lighthouse's, under its simulated slow-4G throttling. An unthrottled
  probe under-reads the font-swap shift by two orders of magnitude, so this is the
  only number that counts for the floor's *no layout shift* rule.
- **360px scrollWidth** is `document.documentElement.scrollWidth` in a 360-px
  emulated mobile viewport (DPR 3) after `document.fonts.ready`. 360 is a pass;
  anything more is a horizontal scroll.
- **Keyboard** is *reached / expected*: every visible link, button, form control or
  positive-tabindex element in DOM order, against the distinct stops Tab produced
  before focus wrapped, at desktop width. A stop is visible when `:focus-visible`
  matches and the computed outline is non-zero. On a page with a gallery the
  figure carries a `+N lightbox` — the dialog's controls, measured with it open,
  since #50. Details and any misses are listed under *Keyboard pass*.
- **Contrast pairs** are every distinct (text colour, effective background) pair
  found on any page, named by token, with the smallest size each is used at. The
  brief's table (`design-brief.md`) is the design intent; this is what production
  does.

## Findings, 2026-09-15

Against release `c684027` (PR #133: everything through #132 live on both
domains), Lighthouse 13.4.1. This is one full run of `node tools/quality_floor.mjs`
from `release`'s own tree (`git archive origin/release`), so the page list is
exactly what production holds: 21 pages, three runs each. The block under
*Measurements* is that run, whole, with no rows pasted in by hand. Before it ran,
all 21 pages fetched with `Accept: text/html` were byte-identical to
`origin/release`, while a page from the previous release was not, so the run
measured this release and not a deploy still rolling out.

### Performance: every page at or above its floor, and the font cause is gone

Nothing is under the floor. The 18 pages held to 95 read **97–99** on the median.
The three that sat under it in the 2026-09-04 block on image LCP alone have
recovered: `madcowhq.com/work/race-timer.html` reads 99 (97/99/99) and
`madcowsailing.com/about.html` 97 (98/97/97). The trip pages have been held to
85 since #53. They read 91 (94/91/89) and 89 (89/89/89), against 87 and 88 on
release `5509192`, before #129 made the photos below a phone's first screen lazy.
The logs index has been held to 90 since #96 and reads 97 (94/98/97).

The bimodal scores the section below explains do not recur. In that race, the
Google font files landed before Chrome's first paint, the simulator put them on
the critical path, and *simulated* first paint moved from about 1.9 s to 3.8 s.
A page read 98 in one run and 79 in the next. The widest spread now, on a page
held to 95, is 92 to 99, and the simulated metrics are not what moved. Race
Timer's three pages ran nine times between them. In all nine, FCP scored
0.97–0.99 (1,213–1,395 ms) and LCP 0.93–0.97.

**Four of the 63 runs painted late, and each lost points on Speed Index.** In
the other 59, the observed first paint in the unthrottled trace came at
534–1,555 ms. In these four it came at 2.5–4.8 s, and the whole page arrived with
it, fonts included:

| Page | That run | Observed first paint | Speed Index |
|---|---|---|---|
| `madcowsailing.com/apps/race-timer/privacy.html` | 92 | 4,768 ms | 0.30 (7.2 s) |
| `madcowsailing.com/apps/race-timer/` | 92 | 3,928 ms | 0.45 (6.1 s) |
| `madcowsailing.com/logs/` | 94 | 2,646 ms | 0.75 (4.3 s) |
| `madcowhq.com/apps/taskr/support.html` | 97 | 2,477 ms | 0.81 (4.0 s) |

In the two 92s, FCP, LCP, TBT and CLS scored as they did in the same pages' 98
and 99 runs. Speed Index is read from the observed filmstrip, so a page that
arrives late in the trace loses it whatever the simulator makes of the critical
path. The same bytes were served in every run of a page. So the late arrival is
the network during those runs, not anything the pages load. *That attribution is
reasoned from the trace, not measured with a control arm.* Held to #46's bar of
95 in all three runs, not only the median, the two Race Timer pages miss on one
run each for this reason. The trip pages and the logs index are held to their
own floors by owner decision.

### Accessibility: 100 on every page

All 21 score 100. Earlier on 2026-09-15, before a release carried #119, Taskr's
tester, privacy and support pages read 95, 96 and 96 on production. Each failed
only color-contrast, on `--blue` eyebrows and table heads on a navy field.

### CLS: 0.000 on every page

The two shifts found on 2026-09-04 are gone on all 21 pages. Both came from the
web-font swap: `madcowsailing.com/` at 0.025 and `madcowsailing.com/apps/` at
0.044.

### 360px and keyboard: every page passes

All 21 read exactly 360. On every page Tab reaches every expected element with
focus showing. Both trip-page lightboxes read 3 of 3 and trapped, and their ring is
now `--chalk` (#56).

### Contrast: nine pairs, all above 4.5:1

The lowest is still `--blue` on `--hull` at 5.3:1. The `--blue` on `--deep` pair
that #119 removed (2.5:1, on three hq pages) is absent. `--spray` on `--deep` is
used on 8 pages, against 4 on 2026-09-04: Tender's product page (#37) and #119's
three hq pages added the rest.

## Findings, 2026-09-04

**Superseded as the current reading by *Findings, 2026-09-15* above**, which is
the run the block under *Measurements* now holds. This section stays as the record
of the Google Fonts cause and of how the scores behaved while it was live, so read
its Lighthouse and CLS prose as describing the PR #45 promotion it names. In
between, #50 regenerated the block on 2026-09-04, after the #55 promotion put the
self-hosted fonts (#46) on both domains. That block had no render-blocking list
naming a Google host and read CLS 0.000 on all thirteen pages, while three pages
sat under the performance floor on image LCP alone: `madcowhq.com/work/race-timer.html`
94, `madcowsailing.com/about.html` 94 and the trip page 85. #46 deferred
re-reading them to #53, which did so on 2026-09-15.

Against the promotion in PR #45 (everything through #11 live on both domains),
Lighthouse 13.4.1. The tool was run in full three times that day; the block under
*Measurements* is the **third** run. The first two are cited here where they
carry the evidence, because the numbers move between runs for the reason this
section explains, and the movement is the finding.

### Performance: 9 of 13 pages under 95 in the shipped run, 10 of 13 in the two before it — one cause, the Google Fonts chain

Every page loads three families from Google Fonts: a render-blocking stylesheet
from `fonts.googleapis.com`, which then fetches `.woff2` files from
`fonts.gstatic.com`. That is two extra origins — each a DNS lookup, a TCP
handshake and a TLS handshake under simulated slow 4G — in the critical path to
first paint, and the largest file (Bricolage Grotesque, 128 KB) alone is most of
a second on that link. Lighthouse's `render-blocking` insight names the fonts
stylesheet first on every page, at roughly 840 ms of the estimated saving.

The scores are **bimodal**, and that is worth understanding before trusting any
single run. Medians in the shipped run range from 79 to 98; in the first full run
the same pages read 72 to 98, and a page reads 98 in one run and 79 in the next
with nothing changed (`madcowhq.com/work/race-timer.html` 98/79/79 in the first
run, 79/79/79 in the third). In the first run's JSON the difference is the
*observed* first paint in the unthrottled trace: about 300–600 ms in the fast
runs, about 1,430 ms in the slow ones. Lighthouse's simulator treats every resource that finished before the
observed first paint as render-blocking, so when the font files happened to land
before Chrome painted (they finish at 500–800 ms), the simulation put them on the
critical path and the simulated first paint went from ~1.9 s to ~3.8 s. Same
page, same fonts; only the race between the fonts and the first frame differed.

**Control arm** — the same page (`madcowhq.com/about.html`) with both Google
Fonts hosts blocked, three runs: **98, 99, 98**, observed first paint 257–342 ms
every time, no bimodality. So the whole shortfall is the font chain, and the
pages are above the floor once it is gone.

The trip page is the worst in every run (72/72/73 in the first, 83/82/84 in the
shipped one) for the same reason in a second form: its LCP element is the log
**paragraph**, a text node, and Lighthouse's LCP breakdown in the first run
attributes 1,250 ms of it to *element render delay* — the text is repainted when
the web font arrives, and that repaint is the LCP. The gallery
images are not the LCP; the first row is eager with `fetchpriority="high"` as #11
built it.

The fix is not per-page and not this story's: self-host the three families as
`woff2` under `shared/`, declare them in `tokens.css`, and preload them — which
removes both third-party origins from the critical path and is also the natural
home for #21's metric-adjusted fallbacks. Filed as **#46**.

Pages above the floor on the median and not on every run (`madcowsailing.com/apps/`
80/99/98 and `madcowsailing.com/about.html` 96/81/96 in the shipped run) are the
same mechanism landing on the other side of the line; the set of pages that pass
changes from run to run, and the set that has the cause does not.

### CLS: two pages shift, both the web-font swap

`madcowsailing.com/` reads **0.025** — the number #8 recorded and #21 is filed
for — and `madcowsailing.com/apps/` reads **0.044**, which is new and is the same
shift on a longer heading. Every other page reads 0.000 in the shipped run —
though `madcowhq.com/work/race-timer.html` read 0.033 in the second full run and
0.000 in the other two, which is the same swap landing on the other side of the
frame. #21's fix in `tokens.css`
covers both sites at once; the apps-index number is recorded on #21 so its
before/after has both.

### Accessibility: 100 on every page

Nothing to list. The `.muted`/`opacity` contrast trap #10 found does not recur.

### 360px: no page scrolls horizontally

All thirteen read exactly 360.

### Keyboard: every interactive element reached with visible focus, the lightbox included

All thirteen pages: every expected element reached, every stop showing the 2-px
outline (`--blue` on light, `--chalk` on the navy fields). Counts per page are in
the checklist below. The first version of this pass reported misses on five
pages, and all five were the instrument, not the sites: two links sharing text
and href (the footer's GitHub link and the body's, for instance) were read as
focus having wrapped, and the logs index's cover image link carries
`tabindex="-1"` by design so its title link is the one stop. Elements are now
identified by DOM index, and `tabindex="-1"` is not expected.

**The lightbox is included, since #50.** On the trip page the pass opens it —
the first thumbnail focused, then a *trusted* Enter over the DevTools protocol,
which is the platform path #12 AC 1 rests on and not a synthetic click — and
finds its three controls, `lightbox-close`, `lightbox-prev` and `lightbox-next`.
*Measured 2026-09-04 on production*: all three reached with the outline showing;
focus **trapped**, Tab from the last control coming round to the first with no
page control ever reached; Escape closing it; focus back on the thumbnail that
opened it; and the page walked again afterwards reading **30 of 30 both times**,
so opening the dialog did not move the number for the page that hosts it. The
twelve pages with no `.gallery` behave exactly as before — nothing is opened and
no lightbox figure is printed.

Three things the reading rests on that are not obvious, each measured rather than
assumed:

- **Chrome's modal Tab cycle passes through two stops that are not controls.**
  For this dialog it is close → prev → next → `document.body` → the `<dialog>`
  element itself → close. Neither `body` nor the dialog is an escape — both are
  inside the modal scope and a reader can act on neither — but the first version
  of this pass read `body` as focus having left the dialog and reported a broken
  trap on a trap that was intact. So the trap test is *no page control is ever
  reached*, never *every stop is inside the dialog*.
- **`showModal()` places focus on the close button before any Tab.** A walk that
  only records what Tab produced reports that control as never reached; the
  initial position is a stop and is recorded as one.
- **Expected is derived from the open dialog, never assumed.** A one-photo gallery
  has no arrows at all — `gallery.js` removes them rather than disabling them —
  and `photos.py`'s own end-to-end run was against a single photo, so that is a
  configuration the pipeline has already produced. Hard-coding three would report
  a false miss on it.

One blind spot, by construction and shared with the page pass: a control given
`tabindex="-1"` leaves the Tab order and the derived expected set together, so
that particular regression reads clean. It is stated here rather than mutated for
that reason.

**History — why it was not included until #50.** The original wording of this
section said the `<dialog>`'s three stops "will be picked up on the next run
without changes". That was a prediction rather than a dated reading, so the
section's own date did not protect it, and it was false. `shared/js/gallery.js`
appends the dialog **closed** — `showModal()` runs only on a thumbnail click —
and a closed `<dialog>` computes `display: none`, so its buttons returned zero
`getClientRects()` and were dropped by the pass's own expected-stop filter.
*Measured 2026-09-04* by reproducing that filter against the trip page: **0
lightbox stops when closed, 3 when open**, all three at zero rects while closed.
A re-run therefore reported the same clean counts as before and said nothing
whatever about the lightbox — an absent measurement and a passing one producing
identical output. #12's own acceptance criteria covered the component's keyboard
behaviour once, in that story's session; nothing standing did, and the instrument
going green is exactly what it would have done had the claim been true. That
failure shape is the reason the paragraph stays.

### Contrast: every pair in production clears 4.5:1, and the brief's table was wrong

Nine distinct pairs across the two sites; the lowest is `--blue` on `--hull` at
**5.3:1**, used down to 12 px for eyebrows. All pass.

Comparing against `design-brief.md` found the brief's *Measured contrast* table
disagreeing with the measurement on four of its seven cells — `--deep` on
`--hull` was written as 15.1:1 and measures **13.5:1**; `--chalk` on `--deep`
14.4 vs **14.9**; `--spray` on `--deep` 8.9 vs **8.2**; `--spray` on `--hull` 1.8
vs **1.6**. Two independent implementations of the WCAG formula (the tool, and a
Python check by hand) agree with each other to two decimals. The brief's numbers
predate anything that measured them. No correction moves a pair across the floor,
so nothing in the design changes; the brief's table is now the measured one, and
carries the four pairings production uses that it had never listed (`--blue` and
`--deep` on `--chalk`, `--blue-deep` on `--hull`, `--chalk` on `--ensign`).

## Controls — proving the instrument can say no

A measurement whose failure mode is a plausible number needs a run where the
answer is known to be *fail*. Before the production numbers were trusted, the
tool was run against a local copy of the sailing site with four faults planted on
`about.html`: a 500-px-wide block, `:focus-visible { outline: none }`, a
paragraph in `--spray` on `--hull`, and a keydown handler that swallows Tab while
the skip link has focus (a focus trap). Predicted first, then run:

| Fault | Predicted | Measured |
|---|---|---|
| 500-px block | scrollWidth 500, flagged | 500 **scrolls** |
| Focus trap on the skip link | 1 of 8 reached, 7 unreached | 1 of 8, 7 listed as not reached |
| `outline: none` | every reached stop flagged as no visible focus | the one reached stop flagged, `focus-visible=true, outline=none` |
| `--spray` on `--hull` | one failing pair at 1.6:1 | `--spray` on `--hull` 1.6:1 **fails** |
| Exit code | 1 | 1 |

The unmutated hq copy served alongside it read clean (12 of 12, 360, no failing
pair), so the flags are the faults and not the local serve. The fonts-blocked arm
above is the other control: it is what turns "the fonts look slow" into an
attribution.

The lightbox half of the keyboard pass (#50) got the same treatment, against a
local copy of the sailing site assembled by the Pages build's own one-line copy
and nothing else. The unmutated copy read exactly what production read — 30 of
30, lightbox 3 of 3, trapped, exit 0 — and then three faults were planted one at
a time in the served `base.css` and `gallery.js`, each reverted before the next,
with the red count written down first:

| Fault | Predicted | Measured |
|---|---|---|
| `outline: none` on the three lightbox controls | 3 *no visible focus* lines, page 30 of 30 untouched, exit 1 | exactly those 3, `focus-visible=true, outline=none` on each; 30 of 30; exit 1 |
| `showModal()` → `show()`, so no trap | 4 lines: escaped to the skip link; Escape does not close a non-modal dialog; focus not returned; page count 30 → 33 with the dialog left open | exactly those 4, the escape landing on `a.skip-link` and the after-count 33 |
| Tab swallowed while on the previous-photo button | 2 lines: next never reached; first control never comes round again; 2 of 3 | 2 of 3, both lines, exit 1 |

Three for three on the written prediction. The second row is the one that
matters most: a `<dialog>` opened with `show()` looks identical to one opened
with `showModal()` — same box, same backdrop-coloured buttons, Escape the only
visible difference — and nothing before #50 would have noticed.

## Also found, not fixed here

- **Resolved by #112 and #113 — every `.html` URL on both domains answers `308`
  to its clean form** (`/about.html` → `/about`), a Cloudflare Pages default nobody
  set. The pages' `rel="canonical"` and every internal link said `.html`, so each
  click paid a redirect and the canonical named a URL the host redirects away from.
  Not a floor criterion and not this story's; recorded on #13 for a story of its own.
  #112 pointed each canonical and `og:url` at the clean URL, and #113 did the same
  for every internal link.
- **The real trip has 24 photos**, not the forty the epic and #13 imagined. It is
  the real trip, which is what the criterion asks for; the number is recorded so
  nobody reads "forty" off the epic as a measured fact.
- **Resolved by #56 — the lightbox's focus ring was `--blue` on a navy field.** Measured 2026-09-04
  by #50's pass: each control's `:focus-visible` outline computes to
  `rgb(0, 103, 161)` (`--blue`), with `outline-offset: 2px` placing the ring over
  the `::backdrop` — `--deep` at 0.94 over the page ground — which composites to
  about `rgb(19, 51, 71)`. That is **2.2:1**, and 2.5:1 even against pure
  `--deep`; WCAG 2.x 1.4.11 asks 3:1 of a state indicator. The cause is that the
  controls sit on `--deep` without being inside `.field-deep`, so the `--chalk`
  outline override the navy fields get does not reach them (`--chalk` there
  would read 12.7:1). The pass reports these stops as *visible* because #13's
  criterion is a non-zero outline, which is the thing this instrument measures;
  the ratio here is arithmetic on the tokens, not an instrument reading. Not this
  story's — #50 makes the lightbox measurable and does not change it — and
  recorded on #50 for a story of its own.
  *Resolved 2026-09-14 by #56*: `.lightbox :focus-visible` now shares the
  `--chalk` override with `.field-deep` in `shared/css/base.css`. The pass still
  does not measure a ring's contrast, but its progress line now names the
  outline colour each set of stops showed, by token, so the change reads off the
  tool. On a local serve of all 21 pages, `develop` printed `lightbox 3/3 trapped
  outlines --blue x3` on both trip pages and the branch `--chalk x3`, with every
  other line identical. Production has it: the 2026-09-15 run below printed
  `lightbox 3/3 trapped outlines --chalk x3` on both trip pages.
- Lighthouse's image-delivery insight flags the first-row `-med` derivative as
  larger than its displayed box. It is informational (weight 0) and the pick is
  what `sizes` and a 1.75× DPR select; the request log #11 took shows no `-full`
  fetches at any tested width. Left alone.

## Measurements

<!-- generated:start -->
_Generated by `node tools/quality_floor.mjs` on 2026-09-15. Lighthouse 13.4.1, mobile preset, 3 run(s) per page, performance = median. Bases: https://madcowhq.com and https://madcowsailing.com. Per-page Lighthouse command:_

```
npx --yes lighthouse@13.4.1 <url> --only-categories=performance,accessibility --form-factor=mobile --screenEmulation.mobile --chrome-flags="--headless=new" --output=json
```

### Scores

| Page | Performance | Accessibility | CLS | 360px scrollWidth | Keyboard | Date | Lighthouse |
|---|---|---|---|---|---|---|---|
| madcowhq.com/404.html | 99 (99/99/97) | 100 | 0.000 | 360 | 13/13 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/about.html | 99 (99/97/99) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/apps/taskr/ | 98 (98/98/99) | 100 | 0.000 | 360 | 17/17 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/apps/taskr/privacy.html | 98 (97/98/99) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/apps/taskr/support.html | 98 (97/98/98) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/ | 98 (98/98/98) | 100 | 0.000 | 360 | 16/16 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/work/ | 98 (98/98/98) | 100 | 0.000 | 360 | 23/23 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/work/race-timer.html | 99 (97/99/99) | 100 | 0.000 | 360 | 12/12 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/work/taskr.html | 97 (97/97/99) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-15 | 13.4.1 |
| madcowhq.com/work/tender.html | 98 (98/98/99) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/404.html | 98 (98/97/98) | 100 | 0.000 | 360 | 9/9 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/about.html | 97 (98/97/97) | 100 | 0.000 | 360 | 8/8 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/apps/ | 98 (98/98/98) | 100 | 0.000 | 360 | 10/10 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/apps/race-timer/ | 97 (97/92/99) | 100 | 0.000 | 360 | 13/13 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/apps/race-timer/privacy.html | 98 (98/99/92) | 100 | 0.000 | 360 | 11/11 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/apps/race-timer/support.html | 99 (98/99/99) | 100 | 0.000 | 360 | 11/11 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/apps/tender/ | 99 (97/99/99) | 100 | 0.000 | 360 | 11/11 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/ | 97 (97/97/97) | 100 | 0.000 | 360 | 13/13 ok | 2026-09-15 | 13.4.1 |
| madcowsailing.com/logs/2025-07-12-put-in-bay/ | 91 (94/91/89), floor 85 | 100 | 0.000 | 360 | 30/30 ok +3 lightbox | 2026-09-15 | 13.4.1 |
| madcowsailing.com/logs/2026-07-04-mullett-lake/ | 89 (89/89/89), floor 85 | 100 | 0.000 | 360 | 59/59 ok +3 lightbox | 2026-09-15 | 13.4.1 |
| madcowsailing.com/logs/ | 97 (94/98/97), floor 90 | 100 | 0.000 | 360 | 8/8 ok | 2026-09-15 | 13.4.1 |

### Under the floor

Nothing. Every page scored at or above its floor on both categories in this run: 95, or the performance floor shown beside its score.

### Keyboard pass

Desktop width (1280px). "Expected" is every visible `a[href]`, button, form control, summary or positive-tabindex element in DOM order; "reached" is how many distinct stops Tab produced before focus wrapped. A stop counts as visible when `:focus-visible` matches and the computed outline is non-zero.

On a page carrying a `.gallery` the pass then opens the lightbox — first thumbnail, trusted Enter — and repeats the walk inside the open `<dialog>`, Tabbing **twice** round so that the second lap proves focus is trapped rather than merely cyclic. The dialog's controls are enumerated from the open dialog and never assumed: a one-photo gallery has no arrows. It is closed with Escape afterwards and the page is re-walked, so the page's own count is measured before and after.

- [x] madcowhq.com/404.html — 13 of 13
- [x] madcowhq.com/about.html — 14 of 14
- [x] madcowhq.com/apps/taskr/ — 17 of 17
- [x] madcowhq.com/apps/taskr/privacy.html — 14 of 14
- [x] madcowhq.com/apps/taskr/support.html — 14 of 14
- [x] madcowhq.com/ — 16 of 16
- [x] madcowhq.com/work/ — 23 of 23
- [x] madcowhq.com/work/race-timer.html — 12 of 12
- [x] madcowhq.com/work/taskr.html — 14 of 14
- [x] madcowhq.com/work/tender.html — 14 of 14
- [x] madcowsailing.com/404.html — 9 of 9
- [x] madcowsailing.com/about.html — 8 of 8
- [x] madcowsailing.com/apps/ — 10 of 10
- [x] madcowsailing.com/apps/race-timer/ — 13 of 13
- [x] madcowsailing.com/apps/race-timer/privacy.html — 11 of 11
- [x] madcowsailing.com/apps/race-timer/support.html — 11 of 11
- [x] madcowsailing.com/apps/tender/ — 11 of 11
- [x] madcowsailing.com/ — 13 of 13
- [x] madcowsailing.com/logs/2025-07-12-put-in-bay/ — 30 of 30, lightbox 3 of 3, focus trapped, closed and focus returned
- [x] madcowsailing.com/logs/2026-07-04-mullett-lake/ — 59 of 59, lightbox 3 of 3, focus trapped, closed and focus returned
- [x] madcowsailing.com/logs/ — 8 of 8

### Contrast pairs in production

Every distinct (text colour, effective background) pair found on any page, named by token. Ratio is WCAG 2.x. The floor is 4.5:1 for body text; 3:1 is enough only for large text (≥ 24px, or ≥ 18.66px bold), and the smallest size each pair is used at is shown so that can be judged. A pair marked *over image* had a background-image somewhere in its ancestor chain, and the ratio against the colour underneath is a lower bound on nothing — read it by eye.

| Text | Background | Ratio | Smallest use | Pages | Sample | Floor |
|---|---|---|---|---|---|---|
| --blue | --hull | 5.3:1 | 12.0px | 18 | p.eyebrow "404" | ok |
| --blue | --chalk | 5.9:1 | 12.0px | 18 | li "React" | ok |
| --chalk | --blue | 5.9:1 | 14.0px | 1 | a.button "Try Taskr" -> /apps/taskr/ | ok |
| --chalk | --ensign | 6.6:1 | 14.0px | 4 | a.button "Open Taskr" -> https://taskr.madcowhq.com/ | ok |
| --blue-deep | --hull | 7.7:1 | 14.0px | 13 | a "about" -> /about | ok |
| --spray | --deep | 8.2:1 | 12.0px | 8 | p.eyebrow "Testing" | ok |
| --deep | --hull | 13.5:1 | 14.0px | 18 | a "work" -> /work/ | ok |
| --chalk | --deep | 14.9:1 | 14.0px | 14 | td "Supabase" | ok |
| --deep | --chalk | 14.9:1 | 14.0px | 2 | p.card-more "No page yet — it is still being built." | ok |
<!-- generated:end -->
