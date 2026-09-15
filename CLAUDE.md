# Mad Cow — Project Context

Monorepo containing two static sites that share one design system.

**Supersedes the earlier single-site version of this file.** The plan changed when
sailing apps moved to their own domain: a domain with products on it needs its own
home page, navigation, and support pages, so it is a real site rather than a
section. The earlier "split at ~5 trip galleries" rule is void.

## The two sites

**madcowhq.com** — the professional site. Audience: hiring managers, recruiters,
collaborators. Holds the portfolio, case studies for everything worth one, an index
of all apps, and the about page. This is the link that goes on a résumé.

**madcowsailing.com** — the sailing site. Audience: sailors. Holds product pages for
sailing apps, their required support and privacy pages, and the trip logs and
photos. This is the link that goes in an App Store listing.

They share tokens, logo assets, and base CSS. They do not share content.

## Current status

**Both sites are live on their domains.** On `develop`, hq has the home, about,
the work index at `/work/`, case studies for Race Timer, Taskr and Tender, and
Taskr's tester, support and privacy pages; the apps index folded into `/work/` in
#81, and `/apps/` now 301s there. Sailing has the home, about, apps index, the
Race Timer product / support / privacy trio, Tender's product page (#37; its
support and privacy pages are Tender's own to publish, not this repo's), the
logs index and two trip logs. Each site also has a `404.html`, which Pages
serves with a 404 for any path the site does not hold (#36). `docs/design-brief.md`
still holds the visual direction, and `docs/quality-floor.md` holds the floor as
**measured on production** rather than as an aspiration.

Stories #2–#11 and #35 are closed, which is what built the above. The epic is #1.
The remaining open work is refinement rather than construction — self-hosted
fonts, a second app's pages, copy sharpening — and it is
tracked on the board, not here.

*This section read "Greenfield … No page of either site is built yet" until
2026-09-04, by which point eleven stories had shipped and both domains were
serving. It is the one part of this file with a short half-life: **it describes a
moving state while everything around it describes durable rules**, so it goes
stale silently and nothing errors. If you are editing this file after shipping a
story, this is the paragraph to check.*

## Structure

```
/
├── shared/
│   ├── css/
│   │   ├── tokens.css        Colour, type, space. Single source of truth.
│   │   └── base.css          Reset, nav, buttons, cards — used by both sites
│   ├── img/                  madcow-*.svg, madcow-*.png
│   └── js/gallery.js         The trip-log lightbox. The only script file; the Race
│                             Timer product page carries one inline (#40)
├── hq/                       → madcowhq.com
│   ├── index.html
│   ├── work/
│   │   ├── index.html
│   │   └── <slug>.html       Case studies
│   ├── apps/                 No index page: /apps/ 301s to /work/ (#81)
│   │   └── <slug>/           Non-sailing apps only: support.html, privacy.html
│   ├── about.html
│   ├── 404.html              Served with a 404 for any missing path (#36)
│   ├── _redirects            Path redirects, exact paths only; Pages reads it
│   └── assets/               Site-specific images; shared/ lands in assets/shared/
├── sailing/                  → madcowsailing.com
│   ├── index.html
│   ├── apps/
│   │   ├── index.html        Sailing app product pages
│   │   └── <slug>/
│   │       ├── index.html    Product page
│   │       ├── support.html  Required by App Store / Play
│   │       └── privacy.html  Required by App Store / Play
│   ├── logs/
│   │   ├── index.html
│   │   └── <trip-slug>/      index.html + trip.json
│   ├── about.html            The boat, the name, who's behind it
│   ├── 404.html              Served with a 404 for any missing path (#36)
│   └── assets/photos/<trip-slug>/
├── tools/
│   ├── photos.py             Trip-log derivatives + trip.json + the log pages
│   ├── templates/            trip.html, logs-index.html — photos.py fills these
│   ├── linkcheck.py          Resolves every internal href AND src against disk. In the gate.
│   ├── assetver.py           Writes ?v=<hash> onto every shared CSS/JS URL. linkcheck checks it.
│   ├── quality_floor.mjs     Measures the floor on the PRODUCTION domains. Not in the gate.
│   └── trace_logo.py         Re-traces shared/img/ from docs/source/. Not a build step.
├── githooks/                 pre-push + `checks`, the list CI mirrors line for line
├── docs/
│   ├── source/               Original artwork the marks were traced from
│   ├── preview/              theme-preview.html + its assets/
│   ├── design-brief.md       Visual direction. Read before writing any CSS.
│   ├── sailing-site.md       The logs/gallery spec
│   └── quality-floor.md      The floor as measured on production, with its instrument
└── CLAUDE.md
```

Two of those are easy to confuse, and the difference is the whole reason both
exist. **`linkcheck.py` is a gate**: it reads the tree, never makes a request, and
runs on every push and every PR. **`quality_floor.mjs` is a measurement**: it
drives a real browser against the *deployed* sites and is deliberately outside the
gate, because a pull request has not changed production yet. `docs/quality-floor.md`
records that choice and its reasoning.

## Hosting

Two Cloudflare Pages projects from this one repo.

| | hq | sailing |
|---|---|---|
| Root directory | `hq` | `sailing` |
| Build command | `mkdir -p assets/shared && cp -R ../shared/. assets/shared/` | same |
| Output directory | `.` | `.` |
| Watch paths | `hq/*`, `shared/*` | `sailing/*`, `shared/*` |
| Custom domain | madcowhq.com | madcowsailing.com |

Watch paths matter: without them, adding forty photos to a trip log rebuilds the
portfolio site too.

That `cp` is a build step, and it is the point where "no build step" stops being
worth defending. It is one line, not a framework — the sites remain static files
that can be read directly. Do not let it grow into a pipeline. If it ever needs a
second command, reconsider Astro instead of accumulating shell.

**madcowsailing.com no longer redirects anywhere.** If anything ever linked to
`madcowhq.com/sailing`, 301 that path to `https://madcowsailing.com/` in
`hq/_redirects`.

**The edge adds nothing to a page (#105).** Until 2026-09-15 each zone had two
settings that rewrote pages, and neither appeared anywhere in the repo. Email
Address Obfuscation (zone → Security → Settings) served every `mailto:` as a
`/cdn-cgi/l/email-protection` link that needs JavaScript, and showed
`[email protected]` as body text until the script ran. Web Analytics' automatic
setup (account → Web Analytics → Manage site, set to "Enable, excluding visitor
data in the EU") injected `static.cloudflareinsights.com/beacon.min.js` before
`</body>`. **Owner decision, 2026-09-15: both off, in both zones**, so that a
contact link works without JavaScript and nothing runs on a page that the repo
does not ship.

The check is the project's `*.pages.dev` host against the custom domain. Pages
serves the repo's bytes, so any difference between the two is a zone setting.
Fetch with `Accept: text/html`: the beacon was injected only for that header, so
a plain `curl` read no beacon while every browser got one.

## Stack

Plain HTML, CSS, and vanilla JS. No framework, no dependencies beyond the copy step.
The repo is part of the portfolio, so it should be readable.

Migrate to Astro only when shared layout across both sites becomes genuinely painful
— realistically past ten or so pages per site. Not before.

*Where that stands, 2026-09-14: **hq 10 pages, sailing 9**, counted at develop
`98b8e28`; projected **10 and 11** once #36 adds a 404 to each site, #37 adds
Tender's product page, and #81 folds `hq/apps/index.html` into `/work/`. That
lands hq on the threshold, not past it, and the second-command rule under Hosting
is unmet. **Owner decision, 2026-09-14 (#78): stay static.** The question is asked
again when **either site passes 12 pages, or the Pages build needs a second
command**, whichever comes first. The evidence is on #78 and its PR: the header
block is 29 lines copied verbatim into every page, a one-item nav change is one
line per page, the two copy defects on record (#7, #10) were one class and were
caught before production, and Astro's Cloudflare guide (read 2026-09-14, Astro
7.3.2) now documents Workers rather than Pages, so a migration moves the hosting
too. Count before deciding; do not read this line as the count.*

No analytics requiring a cookie banner, and since #105 no analytics script at
all: Cloudflare Web Analytics is off in both zones (see Hosting).

## The two-presentation rule

A sailing app appears in three places, and the text must be different in each.
Copy-pasting between them produces duplicate content that search engines penalise
and that serves neither reader.

1. **`hq/work/<slug>.html` — the case study.** For an employer. The problem, what
   you built, a decision you'd defend, the outcome. Technical. First person about
   engineering.
2. **`sailing/apps/<slug>/index.html` — the product page.** For a sailor. What it
   does, who it's for, what it costs, how to get it. No architecture talk. No stack
   tags. The reader does not care what it's written in.
3. **`hq/work/index.html` — one row.** Name, one line, links to both of the above.
   It was `hq/apps/index.html` until #81 folded that page into the work index.

Each page self-references `rel="canonical"`. Do not cross-canonical them; they are
different documents for different audiences, not variants.

Non-sailing apps use the same shape minus step 2, with their support and privacy
pages under `hq/apps/<slug>/`. **A non-sailing app that is open to the public gets
a tester page in step 2's slot, at `hq/apps/<slug>/index.html`** (owner decision
2026-09-11, first used by Taskr in #66): what it does in one sentence a household
would say out loud, how to start in three steps naming the app's own controls,
what "testing" means, what it keeps (linking to privacy), how to report a
problem, and one primary action into the app. Written for the person who will
use it, in their register, with no stack tags; the case study keeps the
engineering. The rule against sharing a sentence between the presentations
applies to it exactly as it does to a product page.

## Page specs — hq

**Home.** Hero (name, one specific sentence, two actions), three selected projects,
short about, footer. Must answer "who is this, should I keep
reading" without scrolling.

**Work index.** Everything, grouped by where it stands, under three `<h2>`s in this
order: In testing, Building, Tooling. An In testing row carries the title, a one-line
summary, stack tags, the case study if there is one, and where to get it. Building and
Tooling rows are brief: a name and one line, with a link only where there is a public
one. No row carries a date.

**Case study.** Same order every time so a skimmer learns the shape once: header
(name, summary, role, stack, timeframe, links) → the problem → what I built →
**a decision I'd defend** → outcome. That fourth section is the point of the page;
it is the thing a hiring manager cannot get from the repo. If a project can't fill
it, it doesn't get a case study — it gets a line in the index.

Never invent metrics. "Still in progress" is a fine outcome.

**Apps index.** There is none since #81: `/apps/` 301s to `/work/`, whose rows
carry every app and where to get it. The redirects in `hq/_redirects` are exact
paths, so the `hq/apps/<slug>/` pages keep serving. Do not add a splat.

**About.** First person. Where you are, what you're building, what you want to build
next. Real `mailto:`, GitHub, résumé PDF. No skills-bar charts. The `mailto:`
is served as written only because Email Address Obfuscation is off (#105, see
Hosting).

**Nav:** `work · about · resume · contact` — resume is the PDF, contact is
About's `#getting-in-touch` heading, and linkcheck fails if that id goes (#79).

## Page specs — sailing

**Home.** Lead with the boat photo, not the logo — this audience responds to a boat
on the water. Then the apps, then recent logs. One line on who you are with a link
to madcowhq.com.

**App product page.** What it does in one sentence a sailor would say out loud.
Screenshots of real screens. Platform and price. Download buttons. A short FAQ.
Links to support and privacy. No stack tags anywhere.

**Support page.** Contact email, expected response time, known issues, version
history. Plain and boring. It exists so store review does not block, and so a
frustrated user finds a human.

**Privacy page.** What the app collects, what it does not, who it is shared with,
how to request deletion. If an app collects nothing, say exactly that.

Both stores require a support URL and a privacy policy URL per app. Build these
shells before submitting anything or review will block.

**Logs index and trip pages.** See `docs/sailing-site.md`.

**Nav:** `apps · logs · about`

## Writing rules

- Specific beats clever. Name the actual thing.
- Active voice. A control says what happens when it is used.
- Banned: passionate, leverage, solutions, journey, cutting-edge, seamless.
- Sentence case in UI.
- Three projects explained properly beat ten thumbnails.
- On the sailing site, write like a sailor talking to a sailor. On hq, write like an
  engineer explaining a decision. Same person, different register.

## Quality floor

Applies to every page on both sites.

- Semantic HTML. One `<h1>`, headings in order, real `<nav>`, `<main>`, `<footer>`.
- Responsive to 360px, no horizontal scroll.
- Visible keyboard focus everywhere. Never `outline: none` without a replacement.
- `prefers-reduced-motion: reduce` respected for all animation.
- Images: `alt`, explicit `width`/`height`, `loading="lazy"` below the fold.
- Body text contrast ≥ 4.5:1. See the measured table in `docs/design-brief.md`.
- No layout shift on load. `font-display: swap`.
- Lighthouse ≥ 95 performance and accessibility, tested on a real trip gallery.

**One page is held lower, by owner decision (2026-09-15, #96): the sailing logs
index needs ≥ 90 performance while two trip covers share its first screen.**
With one trip it read 95 on a single 58 KB cover, with no margin. The second
trip put a second cover on a phone's first screen, and every lever that keeps
the pictures as they are read 94 locally: 4:3 cover derivatives, a 640 rung,
and every split of `loading` and `fetchpriority` hints. Production reads about
a point below a local serve. 95 was reached only by dropping the covers to
quality 50. Accessibility stays at 100. The evidence is on #96 and its PR. Ask
again if a change takes the page below 90.

## Conventions

- Every colour, type size, and spacing value comes from `shared/css/tokens.css`.
  No hex values or pixel sizes anywhere else.
- Never edit files in `assets/shared/` — they are copies. Edit `shared/`.
- After editing anything in `shared/css/` or `shared/js/`, run
  `python tools/assetver.py` in the same change. `/assets/*` is served
  `immutable` for a year, so a replaced file reaches a returning visitor only
  under a new URL; the script writes `?v=<hash>` onto every reference, and the
  gate refuses a page whose version does not match its file (#95). Fonts and
  images are not versioned — rename them rather than overwrite.
- Class names lowercase-hyphenated, describing role not appearance.
- Watch CSS specificity collisions between element and class selectors, especially
  section padding.
- Vanilla JS only. Needing a library is a signal to reconsider the feature.
- Imperative commit messages. The history is visible to the same people the site is.

## Before writing any CSS

Read `docs/design-brief.md` — the identity is the boat's transom graphics, the blue
is sampled and fixed, and the accent ships as two paired values.

## Build order — done, kept for the shape

All nine steps below shipped between 2026-08-21 and 2026-09-04. The list stays
because **the order is the reusable part**: tokens before pages, one page of each
kind as the template before its siblings, and hosting last so there is something
worth deploying. A second app, or a second trip, follows the same shape.

1. ~~`shared/css/tokens.css`, then `base.css`~~
2. ~~hq home, desktop then mobile~~
3. ~~hq about~~
4. ~~hq work index + one case study as the template~~
5. ~~sailing home~~
6. ~~sailing app product page + support + privacy for one app as the template~~
7. ~~`tools/photos.py`, then sailing logs index + one trip page~~
8. ~~hq apps index~~
9. ~~Both Pages projects, domains attached, watch paths set~~

What comes next is on the board (epic #1, and #34 for the second pass), not here —
a to-do list in a context file goes stale the moment work moves, which is what
happened to the status section above.
