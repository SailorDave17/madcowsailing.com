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
alone. `--runs 1` is quicker and noisier; `--only <substring>` restricts the pages;
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
  under 95 is marked and explained under *Under the floor* with its LCP element and
  what Lighthouse itself names as render-blocking.
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
  matches and the computed outline is non-zero. Details and any misses are listed
  under *Keyboard pass*.
- **Contrast pairs** are every distinct (text colour, effective background) pair
  found on any page, named by token, with the smallest size each is used at. The
  brief's table (`design-brief.md`) is the design intent; this is what production
  does.

## Findings, 2026-09-04

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

### Keyboard: every interactive element reached with visible focus

All thirteen pages: every expected element reached, every stop showing the 2-px
outline (`--blue` on light, `--chalk` on the navy fields). Counts per page are in
the checklist below. The first version of this pass reported misses on five
pages, and all five were the instrument, not the sites: two links sharing text
and href (the footer's GitHub link and the body's, for instance) were read as
focus having wrapped, and the logs index's cover image link carries
`tabindex="-1"` by design so its title link is the one stop. Elements are now
identified by DOM index, and `tabindex="-1"` is not expected.

**The lightbox is not included**, because it does not exist: AC 4 names it and
#12 has not been built. When #12 lands, its `<dialog>` is a new set of stops
(close, previous, next) and this pass will pick them up on the next run without
changes — but the focus-return-to-thumbnail behaviour it specifies is not
something this pass checks, and #12's own AC 4 covers it.

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

## Also found, not fixed here

- **Every `.html` URL on both domains answers `308` to its clean form**
  (`/about.html` → `/about`), a Cloudflare Pages default nobody set. The pages'
  `rel="canonical"` and every internal link say `.html`, so each click pays a
  redirect and the canonical names a URL the host redirects away from. Not a floor
  criterion and not this story's; recorded on #13 for a story of its own.
- **The real trip has 24 photos**, not the forty the epic and #13 imagined. It is
  the real trip, which is what the criterion asks for; the number is recorded so
  nobody reads "forty" off the epic as a measured fact.
- Lighthouse's image-delivery insight flags the first-row `-med` derivative as
  larger than its displayed box. It is informational (weight 0) and the pick is
  what `sizes` and a 1.75× DPR select; the request log #11 took shows no `-full`
  fetches at any tested width. Left alone.

## Measurements

<!-- generated:start -->
_Generated by `node tools/quality_floor.mjs` on 2026-09-04. Lighthouse 13.4.1, mobile preset, 3 run(s) per page, performance = median. Bases: https://madcowhq.com and https://madcowsailing.com. Per-page Lighthouse command:_

```
npx --yes lighthouse@13.4.1 <url> --only-categories=performance,accessibility --form-factor=mobile --screenEmulation.mobile --chrome-flags="--headless=new" --output=json
```

### Scores

| Page | Performance | Accessibility | CLS | 360px scrollWidth | Keyboard | Date | Lighthouse |
|---|---|---|---|---|---|---|---|
| madcowhq.com/about.html | 91 **under floor** (91/91/82) | 100 | 0.000 | 360 | 12/12 ok | 2026-09-04 | 13.4.1 |
| madcowhq.com/apps/ | 98 (98/98/90) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-04 | 13.4.1 |
| madcowhq.com/ | 88 **under floor** (88/81/88) | 100 | 0.000 | 360 | 16/16 ok | 2026-09-04 | 13.4.1 |
| madcowhq.com/work/ | 82 **under floor** (82/81/99) | 100 | 0.000 | 360 | 14/14 ok | 2026-09-04 | 13.4.1 |
| madcowhq.com/work/race-timer.html | 79 **under floor** (79/79/79) | 100 | 0.000 | 360 | 11/11 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/about.html | 96 (96/81/96) | 100 | 0.000 | 360 | 8/8 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/apps/ | 98 (80/99/98) | 100 | 0.044 | 360 | 8/8 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/apps/race-timer/ | 93 **under floor** (93/92/93) | 100 | 0.000 | 360 | 13/13 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/apps/race-timer/privacy.html | 91 **under floor** (91/80/91) | 100 | 0.000 | 360 | 11/11 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/apps/race-timer/support.html | 95 (80/95/98) | 100 | 0.000 | 360 | 11/11 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/ | 93 **under floor** (98/92/93) | 100 | 0.025 | 360 | 12/12 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/logs/2025-07-12-put-in-bay/ | 83 **under floor** (83/82/84) | 100 | 0.000 | 360 | 30/30 ok | 2026-09-04 | 13.4.1 |
| madcowsailing.com/logs/ | 94 **under floor** (94/94/95) | 100 | 0.000 | 360 | 7/7 ok | 2026-09-04 | 13.4.1 |

### Under the floor

- **https://madcowhq.com/about.html** — performance 91, accessibility 100; simulated FCP 3464 ms, LCP 3614 ms (last run; observed first paint in the unthrottled trace 1322 ms). LCP element: `body > main#main > section.wrap > p "I live in Columbus, Ohio and work at JPM"`. Weighted audits under 1: first-contentful-paint (0.35), largest-contentful-paint (0.6), speed-index (0.89). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (815 ms); https://madcowhq.com/css/site.css (302 ms).
- **https://madcowhq.com/** — performance 88, accessibility 100; simulated FCP 3080 ms, LCP 3080 ms (last run; observed first paint in the unthrottled trace 404 ms). LCP element: `main#main > section.hero > div > p.lede "I build sailing software — the boat is t"`. Weighted audits under 1: first-contentful-paint (0.47), largest-contentful-paint (0.76), speed-index (0.93). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (850 ms); https://madcowhq.com/css/site.css (499 ms).
- **https://madcowhq.com/work/** — performance 82, accessibility 100; simulated FCP 1770 ms, LCP 1770 ms (last run; observed first paint in the unthrottled trace 302 ms). LCP element: `section.wrap > ul.rows > li > p "Pairs skippers who are short of crew wit"`. Weighted audits under 1: first-contentful-paint (0.9), largest-contentful-paint (0.99). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (806 ms); https://madcowhq.com/css/site.css (329 ms).
- **https://madcowhq.com/work/race-timer.html** — performance 79, accessibility 100; simulated FCP 3857 ms, LCP 3857 ms (last run; observed first paint in the unthrottled trace 1360 ms). LCP element: `main#main > section.wrap > div.shot > img "The watch face mid-countdown: white nume"`. Weighted audits under 1: first-contentful-paint (0.26), largest-contentful-paint (0.53), speed-index (0.83). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (874 ms); https://madcowhq.com/css/site.css (303 ms).
- **https://madcowsailing.com/apps/race-timer/** — performance 93, accessibility 100; simulated FCP 2605 ms, LCP 2605 ms (last run; observed first paint in the unthrottled trace 296 ms). LCP element: `main#main > section.hero > div.shot > img "A watch face showing US Sailing 5-4-1-Go"`. Weighted audits under 1: first-contentful-paint (0.63), largest-contentful-paint (0.87), speed-index (0.97). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (851 ms); https://madcowsailing.com/css/site.css (330 ms); https://madcowsailing.com/assets/shared/css/base.css (165 ms).
- **https://madcowsailing.com/apps/race-timer/privacy.html** — performance 91, accessibility 100; simulated FCP 2744 ms, LCP 2744 ms (last run; observed first paint in the unthrottled trace 333 ms). LCP element: `body > main#main > section.wrap > p.lede "Race Timer does not collect, send or sha"`. Weighted audits under 1: first-contentful-paint (0.58), largest-contentful-paint (0.84), speed-index (0.96). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (812 ms); https://madcowsailing.com/css/site.css (303 ms).
- **https://madcowsailing.com/** — performance 93, accessibility 100; simulated FCP 2633 ms, LCP 2633 ms (last run; observed first paint in the unthrottled trace 315 ms). LCP element: `section.hero > div.hero-photo > picture > img "Mad Cow sailing under spinnaker on grey "`. Weighted audits under 1: first-contentful-paint (0.62), largest-contentful-paint (0.87), speed-index (0.97). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (870 ms); https://madcowsailing.com/css/site.css (334 ms).
- **https://madcowsailing.com/logs/2025-07-12-put-in-bay/** — performance 83, accessibility 100; simulated FCP 2795 ms, LCP 3795 ms (last run; observed first paint in the unthrottled trace 313 ms). LCP element: `body.logs-page > main#main > section.wrap > p "Five days at Put-in-Bay, 12 to 16 July. "`. Weighted audits under 1: first-contentful-paint (0.57), largest-contentful-paint (0.55), speed-index (0.96). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (861 ms); https://madcowsailing.com/css/site.css (331 ms).
- **https://madcowsailing.com/logs/** — performance 94, accessibility 100; simulated FCP 1934 ms, LCP 2720 ms (last run; observed first paint in the unthrottled trace 305 ms). LCP element: `li.log-row > a.log-cover > picture > img "li.log-row > a.log-cover > picture > img"`. Weighted audits under 1: first-contentful-paint (0.86), largest-contentful-paint (0.85). Render-blocking per Lighthouse: https://fonts.googleapis.com/css2?… (954 ms); https://madcowsailing.com/css/site.css (338 ms).

### Keyboard pass

Desktop width (1280px). "Expected" is every visible `a[href]`, button, form control, summary or positive-tabindex element in DOM order; "reached" is how many distinct stops Tab produced before focus wrapped. A stop counts as visible when `:focus-visible` matches and the computed outline is non-zero.

- [x] madcowhq.com/about.html — 12 of 12
- [x] madcowhq.com/apps/ — 14 of 14
- [x] madcowhq.com/ — 16 of 16
- [x] madcowhq.com/work/ — 14 of 14
- [x] madcowhq.com/work/race-timer.html — 11 of 11
- [x] madcowsailing.com/about.html — 8 of 8
- [x] madcowsailing.com/apps/ — 8 of 8
- [x] madcowsailing.com/apps/race-timer/ — 13 of 13
- [x] madcowsailing.com/apps/race-timer/privacy.html — 11 of 11
- [x] madcowsailing.com/apps/race-timer/support.html — 11 of 11
- [x] madcowsailing.com/ — 12 of 12
- [x] madcowsailing.com/logs/2025-07-12-put-in-bay/ — 30 of 30
- [x] madcowsailing.com/logs/ — 7 of 7

### Contrast pairs in production

Every distinct (text colour, effective background) pair found on any page, named by token. Ratio is WCAG 2.x. The floor is 4.5:1 for body text; 3:1 is enough only for large text (≥ 24px, or ≥ 18.66px bold), and the smallest size each pair is used at is shown so that can be judged. A pair marked *over image* had a background-image somewhere in its ancestor chain, and the ratio against the colour underneath is a lower bound on nothing — read it by eye.

| Text | Background | Ratio | Smallest use | Pages | Sample | Floor |
|---|---|---|---|---|---|---|
| --blue | --hull | 5.3:1 | 12.0px | 10 | p.eyebrow "Columbus, Ohio" | ok |
| --blue | --chalk | 5.9:1 | 12.0px | 10 | li "Kotlin" | ok |
| --ensign-lt | --deep | 6.3:1 | 14.0px | 8 | span.sail-number "1340" | ok |
| --chalk | --ensign | 6.6:1 | 14.0px | 2 | a.button "See the work" -> work/ | ok |
| --blue-deep | --hull | 7.7:1 | 14.0px | 6 | a "about" -> /about.html | ok |
| --spray | --deep | 8.2:1 | 12.0px | 4 | p.eyebrow "Getting it" | ok |
| --deep | --hull | 13.5:1 | 14.0px | 10 | a "work" -> /work/ | ok |
| --deep | --chalk | 14.9:1 | 14.0px | 2 | p.card-more "No page yet — it is still being built." | ok |
| --chalk | --deep | 14.9:1 | 14.0px | 8 | span "Racing as 1340 at Hoover Sailing Club" | ok |
<!-- generated:end -->
