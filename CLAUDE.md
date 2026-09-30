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
A third site, photos.madcowsailing.com under `photos/`, was decided in #148, and
#149 built its holding page, its Cloudflare project and its gate. #150 added the
invite code and the upload session, #151 the admin area's lock and its
home page, #152 the admin page where the code is created and rotated,
#153 the albums the owner keeps for each regatta and practice, #154 the
upload API, which stores each photo's three JPEGs with their metadata removed,
waiting for approval, and #155 the share page that makes those JPEGs on the
phone and sends them.
Epic #147 builds the rest. Its `develop` preview sits behind
Access, and the domain serves nothing until a release carries `photos/`
(see [The photo site](#the-photo-site--photosmadcowsailingcom)).
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
├── photos/                   → photos.madcowsailing.com (#149; see The photo site)
│   ├── wrangler.jsonc        Bindings per environment. Never published.
│   ├── package.json          Not a build: makes photos/ wrangler's project root
│   ├── .htmlvalidate.json    no-inline-style back on, for the CSP
│   ├── functions/            Pages Functions: _middleware.js, api/health.js,
│   │                         api/join.js, api/upload/ and api/albums/ behind
│   │                         the upload guard (api/upload/index.js takes a
│   │                         photo, #154), and admin/ and api/admin/
│   │                         behind the admin guard (admin/code.js is the
│   │                         invite code, #152; admin/albums.js the albums, #153)
│   ├── lib/                  Code the Functions import that is not a route
│   ├── migrations/           D1, NNNN_<what>.sql, additive only
│   ├── scripts/              access-dev.mjs: a local stand-in for Access (#151)
│   ├── test/                 node --test; `npm test` from the root
│   └── public/               The served files and nothing else (the output dir)
│       ├── index.html        The holding page, until #157
│       ├── share/index.html  Where an invite link lands; joins, then (#155) sends
│       ├── 404.html          Also what stops Pages treating the site as an SPA
│       ├── _headers          Static files only; lib/headers.js holds the same
│       ├── _routes.json      Which paths invoke a Function: /api/*, /admin, /admin/*
│       ├── robots.txt        Allows crawling, on purpose
│       ├── css/site.css
│       ├── js/share.js
│       └── js/admin-code.js  /admin/code's script; its ?v= is stamped by hand
│                             in lib/admin-page.js (#152)
├── tools/
│   ├── photos.py             Trip-log derivatives + trip.json + the log pages
│   ├── templates/            trip.html, logs-index.html — photos.py fills these
│   ├── linkcheck.py          Resolves every internal href AND src against disk. In the gate.
│   ├── assetver.py           Writes ?v=<hash> onto every shared and site CSS/JS URL. linkcheck checks it.
│   ├── quality_floor.mjs     Measures the floor on the PRODUCTION domains. Not in the gate.
│   ├── h2proxy.mjs           HTTP/2 in front of wrangler, to read the photo site's floor locally (#155). Not in the gate.
│   └── trace_logo.py         Re-traces shared/img/ from docs/source/. Not a build step.
├── githooks/                 pre-push + `checks`, the list CI mirrors line for line
├── docs/
│   ├── source/               Original artwork the marks were traced from
│   ├── preview/              theme-preview.html + its assets/
│   ├── design-brief.md       Visual direction. Read before writing any CSS.
│   ├── sailing-site.md       The logs/gallery spec
│   ├── quality-floor.md      The floor as measured on production, with its instrument
│   └── email.md              Mail for both domains: Zoho Mail Lite, the DNS records, Outlook
└── CLAUDE.md
```

Two of those are easy to confuse, and the difference is the whole reason both
exist. **`linkcheck.py` is a gate**: it reads the tree, never makes a request, and
runs on every push and every PR. **`quality_floor.mjs` is a measurement**: it
drives a real browser against the *deployed* sites and is deliberately outside the
gate, because a pull request has not changed production yet. `docs/quality-floor.md`
records that choice and its reasoning.

## Hosting

Three Cloudflare Pages projects from this one repo. README.md's hosting table
holds every setting, read back from the dashboard; this is the summary.

| | hq | sailing | photos |
|---|---|---|---|
| Root directory | `hq` | `sailing` | `photos` |
| Build command | `mkdir -p assets/shared && cp -R ../shared/. assets/shared/` | same | `mkdir -p public/assets/shared && cp -R ../shared/. public/assets/shared/` |
| Output directory | `.` | `.` | `public` |
| Watch paths | `hq/*`, `shared/*` | `sailing/*`, `shared/*` | `photos/*`, `shared/*` |
| Custom domain | madcowhq.com | madcowsailing.com | photos.madcowsailing.com |

Watch paths matter: without them, adding forty photos to a trip log rebuilds the
portfolio site too. The photo site's build command is still the one-line copy,
pointed at its output folder. Its server code is compiled by Pages itself from
`photos/functions/`, which is not a second command.

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

**Mail for both domains is Zoho Mail Lite** (owner decision 2026-09-17), one mailbox
with an address at each domain. `docs/email.md` holds the records, the setup order and
the Outlook settings — and the Zoho feature *not* to use for the second domain.

## Stack

Plain HTML, CSS, and vanilla JS. No framework, no dependencies beyond the copy step.
The repo is part of the portfolio, so it should be readable.

**That rule still holds for `hq/` and `sailing/`.** It does not cover the third site,
photos.madcowsailing.com under `photos/`, which runs server code on Cloudflare Pages
Functions. That exception was decided on purpose, in #148, and it is recorded in
[The photo site](#the-photo-site--photosmadcowsailingcom) below. The vanilla-JS rule
still covers it: no framework and no library, in the served code or the server code.

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

## The photo site — photos.madcowsailing.com

**Decided on 2026-09-26 in #148, before any of its code existed.** Epic #147 builds a
third site from this repo. Anyone can browse albums of the team's regatta and practice
photos and videos. Parents holding the current invite link upload from their phones, and
nothing appears until the owner approves it. It is the first server code in the repo, so
the static rule in Stack does not cover it. Each decision below names the alternative not
taken and the page it rests on. **Every page was read on 2026-09-26.** Several of them
had changed that same week, so re-read the page before relying on a number. The evidence
for each decision is on #148's pull request.

### 1. Platform: a Pages project with Functions

A third Cloudflare Pages project, built from `release`, with root directory `photos`,
watch paths `photos/*` and `shared/*`, and its server code in `photos/functions/`.
Previews build for `develop` only, as they do on the other two projects, through Pages'
*Custom branches* control
([branch build controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)).
Preview deployments get their own database and bucket, through `env.preview` in the
Wrangler file
([Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)).

**Not chosen: a Worker with static assets**, even though Cloudflare's Pages overview now
tells readers to *"Start new projects with Workers"*
([Pages](https://developers.cloudflare.com/pages/)). Workers Builds previews *"every push
to a branch that is not your production branch"*. Its only control is one on/off
checkbox, with no branch filter
([build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)).
Worker Previews, which give each branch preview its own bindings, launched on 2026-09-22
([changelog](https://developers.cloudflare.com/changelog/post/2026-09-22-worker-previews/))
and need Wrangler 4.135.0 or later
([Worker Previews](https://developers.cloudflare.com/workers/previews/)). Keeping previews
`develop`-only on a Worker would take a second, staging Worker or a GitHub Actions job.
Pages is steered away from, not retired: its changelog shipped a build change on
2026-08-11
([changelog](https://developers.cloudflare.com/changelog/post/2026-08-11-skip-superseded-builds/)),
and no Pages page uses the word deprecated. *Seen on 2026-09-27 (UTC), creating the
project for #149:* the dashboard's Create application page leads with Workers, and
reaches Pages only through a link reading *"Need to use the legacy Pages workflow?
Continue to Pages"*. "Legacy" is not "deprecated", so the kill condition below is not
met. It is the direction to watch.

**The accepted costs of Pages.** The custom domain, build command, root directory, watch
paths, branch controls and fail mode stay in the dashboard. So the README's hosting table
remains the only other copy of them; #149 added the column. Also, the project's
`*.pages.dev` address cannot be switched off, and Pages' preview access policy *"will only
protect your preview deployments … and not your `*.pages.dev` domain or custom domain"*
([preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)).
So on that address, the code's own check of the Access token is the only lock on
`/admin`. #151 already requires that check.

**Kill condition.** Move to a Worker, by the route in Cloudflare's migration guide
([migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)),
on any of this evidence:

- a Cloudflare page or changelog entry that deprecates Pages or Pages Functions, or ends
  support for either;
- a story under #147 that needs a feature the guide's compatibility matrix gives only to
  Workers, such as Cron Triggers, Durable Objects, Workers Logs or the Rate Limiting
  binding;
- #149's first `develop` build showing that Pages cannot give previews their own database
  and bucket, or cannot limit previews to `develop`.

### 2. Serving: the site's code checks every photo on every request

Every photo response comes from a Function. It reads the photo's state in D1 first and
answers 404 unless the photo is approved, so a takedown holds from the next request.
Photos live in a private R2 bucket, one per environment. That bucket never gets a custom
domain or an `r2.dev` address.

**The quota arithmetic.** On the free plan the limit that binds is requests: *"Accounts on
the Workers Free plan have a daily request limit of 100,000 requests, resetting at
midnight UTC."* ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).
Pages Functions draw on the same account-wide 100,000
([Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)).
Static files cost nothing, as long as `_routes.json` keeps them away from the Functions.
An album view is the page plus 40 thumbnails, 41 requests. So one day holds
**100,000 ÷ 41 ≈ 2,439 album views**. Each photo opened in the lightbox costs one
request more. At that ceiling the other meters are far from theirs:

- D1: about 81 rows read per view (one indexed query for the page, then one row per
  thumbnail), so about 198,000 rows a day against 5 million;
- R2: 40 reads per view, about 2.93 million a month against 10 million Class B
  operations ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)).

Neither figure survives a query that scans a table instead of using an index, because D1
counts every row a query scans
([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)).

**When to switch.** As far as this workspace shows, no other project on the account runs
a Function or a Worker: hq and sailing are static, and Taskr and Tender are on Vercel. So
the photo site has the 100,000 to itself; the dashboard's Workers & Pages overview is the
authority. Move to Workers Paid when any UTC day passes 80,000 requests, about 1,950
album views, or when anyone reports an Error 1027. Workers Paid costs $5 a month for the
account, which includes 10 million requests a month, then $0.30 per million
([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). 10
million a month is about 8,130 album views a day.

**Not chosen: a public R2 custom domain holding approved copies under unguessable
keys.** It spends no request quota, but a takedown then needs a cache purge, and purging
*"does not affect assets stored by a visitor’s browser"*. On this zone a browser keeps a
cacheable file for at least the zone's Browser Cache TTL, 4 hours by default
([Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)).
Its `X-Robots-Tag` would need a zone rule outside git, and anyone holding an image's URL
could embed it anywhere. **Not chosen either: Workers Paid from the start**, which pays for
traffic the site does not have.

### 3. Cache lifetime: 300 seconds

Every photo response carries `Cache-Control: private, max-age=300`, and no photo response
may carry more. That is the longest a taken-down photo can survive in a browser that
already loaded it, and #157 asserts it. `immutable` is never used, and no photo is ever
served from under `/assets/`, which the other sites' `_headers` caches for a year
(#95). `stale-while-revalidate` is not used either, because it would add its own
window. On Pages, `_headers` never applies to a Function's response, so the code sets
every header itself.

**Read the header on `photos.madcowsailing.com`, not only on a local server or
`*.pages.dev`.** The zone raises a shorter lifetime to its Browser Cache TTL. On
2026-09-26, `madcowsailing.com/css/site.css` was served with `max-age=14400`, while
`madcowsailing.pages.dev` served the same file with `max-age=0`. Whether the zone does the
same to a Function's response is not documented. If the live header reads longer than
300, add a Cache Rule scoped to the photos hostname, with Browser TTL set to *Respect
origin*. The Free plan allows 10 Cache Rules
([Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/)).

Not chosen: 3,600 seconds, which saves requests on a same-evening revisit and lets a
removed photo last an hour; or 86,400 seconds, which lets it last a day.

### 4. Past the daily limit: fail closed, for the whole project

Pages has one fail-mode setting per project, under Settings > Runtime, and none per route
([Functions routing](https://developers.cloudflare.com/pages/functions/routing/)).
Per-route modes exist only for a Worker attached by zone routes. Set it to **Fail
closed**. *Fail open* keeps serving static assets where Functions would have run, and
every album page, photo, upload and admin route here is a Function. So failing open would
give a visitor nothing but static files. Failing closed also meets the rule that the admin
and upload routes fail closed. Two rules keep that true:

- nothing under `/admin` or `/api` exists as a static file;
- the project ships a top-level `404.html`. Without one, Pages answers every unmatched
  path with the home page and a 200
  ([serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)).

D1 has daily limits of its own, apart from the request limit, and has enforced them since
2026-09-01
([changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)).
Past 5 million rows read or 100,000 written in a UTC day, every query on the account
errors until midnight UTC. So a public route treats a D1 error as *not approved*, and
never serves a photo it could not check. A public GET never writes to D1.

### 5. Configuration in git

```
photos/
├── wrangler.jsonc   pages_build_output_dir, env.preview, env.production
├── package.json     no build and no dependencies; see item 7
├── functions/       the server code (Pages Functions)
├── lib/             code the Functions import that is not a route (added by #149)
├── migrations/      D1 migrations, NNNN_<what>.sql, additive only
├── scripts/         run by hand, never served (added by #150)
├── test/            node --test
└── public/          the served files, and nothing else
```

The build command stays one line, pointed at the output folder:
`mkdir -p public/assets/shared && cp -R ../shared/. public/assets/shared/`, with output
directory `public`. It cannot be `.`, as it is on the other two projects. Wrangler's Pages
uploader skips only nine names: `_worker.js`, `_redirects`, `_headers`, `_routes.json`,
`functions`, `.DS_Store`, `node_modules`, `.git` and `.wrangler`
([workers-sdk `pages/validate.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/pages/validate.ts)).
So an output of `.` would publish `wrangler.jsonc` and every migration. Whether Pages' own
build uploads through that code is not documented. #149 checks it by requesting both
files by path from the preview. Under `wrangler pages dev` 4.141.0, before the merge,
both answered 404, as did `package.json`, the tests and the Function sources.

In the Wrangler file, which Cloudflare recommends writing as `wrangler.jsonc` for new
projects ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)):

- `env.preview` and `env.production` each name their own D1 database and R2 bucket. Each
  restates every binding, because overriding one non-inheritable key in an environment
  means restating all of them.
- The top-level bindings name the **preview** resources. An environment Wrangler cannot
  match then falls back to preview rather than production.
- Every `database_id` is written out. A resource Wrangler provisions during a Git deploy
  gets an ID that will *"only be accessible via the dashboard"*.
- `preview_database_id` and `preview_bucket_name` do not choose a preview deployment's
  resources. They choose what `wrangler dev` uses.
- No secret goes in the file or anywhere in the tree. The session-signing and
  address-hashing keys are Pages secrets, listed by name only in the README, and so
  is the admin allow-list (item 12).

Once the file exists, the dashboard shows its bindings read-only. What stays in the
dashboard goes in the README's hosting table: build command, root directory, watch paths,
custom domain, branch controls, preview access policy and fail mode. Wrangler reads a JSON
config from 3.91.0 on, but Pages does not document which Wrangler its builds use. So
#149's first build confirms the file was read, by the bindings showing read-only. If it
was not, use `wrangler.toml`.

### 6. How a schema change reaches production

No build applies a D1 migration. Pages documents no hook or token for it. Cloudflare's
own suggestion is a `deploy` script that runs the migrations before deploying
([deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)),
which here would be the second build command that Hosting warns about. So migrations are
applied by hand, in this order:

1. The pull request adds one file under `photos/migrations/`, and the file is additive:
   it creates a table, adds a column or adds an index.
2. Before the pull request merges into `develop`, run
   `npx wrangler d1 migrations apply madcowphotos-preview --remote --env preview`. The
   merge builds the preview at once, so the preview database must already have the change.
3. Before the owner merges `develop` into `release`, run
   `npx wrangler d1 migrations apply madcowphotos --remote --env production`.
4. Then the promotion.

Run them from `photos/`, as `npx --no-install wrangler …` so the pinned wrangler runs,
with the D1-scoped API token in `photos/.env`. README.md, The photo site, names the token
and shows how to check it. #149 ran this order first, with the no-op `0001_baseline.sql`.

Pass `--remote` and `--env` every time, and name the database rather than the binding, as
Cloudflare's migrations page advises
([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)). Wrangler
records what has been applied in each database's `d1_migrations` table. Running code must
never meet a schema it does not know. So a change that drops or renames anything ships in
two releases: first the code stops using the thing, then a later migration removes it.
Keep migrations small, because Wrangler warns that the database may not serve requests
while one runs. On the free plan, Time Travel reaches back 7 days
([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)), and a restore
overwrites the whole database. So a restore also un-hides every photo hidden since the
restore point. The database names follow the project name, which the owner confirmed at
#149's pickup (A6).

### 7. Tests and Wrangler

The site's own code is tested with `node --test`, with no dependency. Node 24, which CI
runs, has `Request`, `Response`, `Headers` and `crypto.subtle` as globals. A Pages
Function is a plain exported `onRequest(context)`, so a test calls it with a hand-built
context and hand-written stand-ins for D1 and R2.

Not chosen:

- Cloudflare's recommended Vitest integration
  ([testing](https://developers.cloudflare.com/workers/testing/)), which is a framework
  plus `vitest` and `@cloudflare/vitest-plugin`;
- `jose`, or Cloudflare's Access plugin, for the token check. Both are libraries.

A hand-written token check needs tests that libraries would otherwise stand in for. A
measured first version passed all 6 of its tests while it accepted a token with no `exp`,
threw a 500 on a malformed token instead of answering 403, and had no test that failed
when its `alg` or `nbf` check was removed. #151's list of refusals covers `alg`
(`alg: none`, and HS256 signed with the public key). It named no case for a missing
`exp`, a malformed token or `nbf`, so #151 added those three, and item 12 says how each
check was then proven.

Wrangler becomes an exact-pinned devDependency, added by #149 with the first code;
4.141.0 was current on 2026-09-26 and needs Node 22 or later
([npm](https://www.npmjs.com/package/wrangler)). That same change updates
`package.json`'s description. **#149 also added `photos/package.json`**, with no
dependencies. Wrangler's `pages dev` starts from the nearest `package.json`'s
directory. From the repo root it found no `wrangler.jsonc` and ran the site with no
bindings, with no warning. The file's `"type": "module"` also lets Node load the
Functions as they are. The committed lockfile and `npm ci` then pin wrangler's
whole dependency tree, as Cloudflare recommends
([install and update](https://developers.cloudflare.com/workers/wrangler/install-and-update/)).
Not chosen: a pinned `npx wrangler@<version>`, which keeps `package.json` as it is but
resolves wrangler's own dependencies afresh on each run. The accepted cost is that CI's
`npm ci` installs wrangler, workerd and sharp on every run, although CI never runs them.

### 8. Free-tier headroom

| Meter | Free allowance | Where it ends here | The paid step |
|---|---|---|---|
| Requests (Functions and Workers together) | 100,000 a day, for the account | about 2,439 album views a day (item 2), minus what clips take (item 10) | Workers Paid, $5 a month: 10 million a month, then $0.30 per million |
| CPU | 10 ms per request | not yet measured per route. The project's Metrics tab reports every Function together, with no unit on the page. At #151's close (2026-09-28), 38 production requests over 24 hours read p50 2,463 and p99 8,874, with 0 over the limit, so the unit is taken as microseconds and the slowest was about 1.1 ms under 10 ms. Per route, the token check and the admin home included: #157. Rendered album pages and clip parts: #157 and the video stories | Workers Paid: 30 million CPU ms a month, then $0.02 per million |
| R2 storage | 10 GB-month | about 11,000 photos, or about 30–50 three-minute clips (item 9) | $0.015 per GB-month |
| R2 writes (Class A) | 1 million a month | 3 per photo, about 12 per clip | $4.50 per million |
| R2 reads (Class B) | 10 million a month | 40 per album view: about 2.93 million a month at the request ceiling | $0.36 per million |
| D1 | 5 million rows read and 100,000 written a day; 5 GB in all, 500 MB per database | about 4% of reads at the request ceiling, if every query uses an index | with Workers Paid: 25 billion reads and 50 million writes a month |
| Zero Trust | 50 users | the owner, plus anyone who signs in to a preview | $7 per user a month |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and the
[Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/).

Storage runs out first, and video is what fills it. R2 has no daily cut-off: past the
free allowance it bills monthly, rounded up to whole units, and using R2 at all needs its
subscription taken out at checkout. 100 clips of about 250 MB would cost about $0.25 a
month. R2 bills the average of each day's peak storage, so a clip counts from the day it
is stored, pending or rejected. So a rejected clip is deleted, not kept. Zero Trust asks
for payment details at onboarding even on its Free plan, and a seat stays taken until
the user is removed; seat expiration can remove users automatically.

### 9. What an upload may be

Each photo arrives as three JPEGs, and #154 refuses any outside these caps
(item 14 says how). A KB here is 1,024 bytes and an MB 1,048,576, the
generous reading, so the byte caps are 153,600, 1,048,576 and 3,145,728:

| Size | Long edge | Largest file |
|---|---|---|
| grid | 480 px | 150 KB |
| screen | 1600 px | 1 MB |
| full | 2560 px | 3 MB |

Measured on 2026-09-26, by saving the repo's 78 trip-log photos as JPEG at quality 85:
the largest file was 75 KB at 480 px and 752 KB at 1600 px. The repo holds nothing larger
than 2000 px (1,143 KB at most there), so 2560 px was scaled by pixel count, to about
1.9 MB. The caps leave room above all three. A median photo comes to about 875 KB for all
three sizes, which is where item 8's 11,000 comes from.

A clip may run for up to 3 minutes. That was the owner's figure for pricing, and the
video stories confirm it. Apple gives 70–105 MB for a minute of 1080p, the iPhone's
default ([Apple](https://support.apple.com/en-us/127765)), so a 3-minute clip is roughly
200–300 MB. Apple's figures are for exporting from iMovie, not for camera originals, so
treat them as an estimate.

### 10. Video: uploaded in parts, blanked in the browser, checked on the server

**Added to the epic on 2026-09-26, while this story was being worked** (owner decision; it
reverses #147's default A2, "photos only"). Clips go in the same private R2 bucket as the
photos, through the site's own Functions, with the same approval.

**Upload.** A Function accepts at most 100 MB per request on the Free plan
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), and
Workers Paid does not raise that; only the zone's plan does. So the page sends an R2
multipart upload through the Function's binding, and each part is still held to that
limit ([R2 multipart](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)).
Every part except the last must be the same size and at least 5 MiB
([R2 uploads](https://developers.cloudflare.com/r2/objects/upload-objects/)).
Parts are small, about 25 MB, and go one at a time: a failed part is retried alone. That
matters because the runtime gives an in-flight request only a 30-second grace period
when it restarts, which happens a few times a week. The binding does the auth, so no
credential reaches the browser and nothing leaves the site's domain. R2 aborts an
unfinished multipart upload after 7 days by default
([R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/));
a lifecycle rule on the bucket shortens that to 1 day.

Whether a free Function can pass a 25 MB part into R2 within its 10 ms of CPU is not
documented. **The first video story measures it before building on it.** If a part does
not fit, the answer is Workers Paid, whose CPU limit defaults to 30 seconds, not a
different upload path.

**Location and camera data.** The page removes them before uploading, without
re-encoding. A hand-written walker goes through the file's boxes (the named blocks an
MP4 or MOV file is made of). It keeps the ones playback needs and overwrites every other
box in place: the type becomes `free`, the contents become zeros, and the size stays the
same. Nothing moves, so the offsets that point into the media stay valid, wherever the
file keeps its index (`moov`). Apple's QuickTime documentation lets a `free` box stand
in for removed metadata
([metadata atoms](https://developer.apple.com/documentation/quicktime-file-format/metadata_atoms_and_types)),
and Android's own media provider redacts video location in place, keeping every size. The
walker must:

- blank a whole `meta` box, a whole `udta` child or a whole track, never single items
  inside `ilst`, where Apple does not allow `free` boxes;
- leave `stsd` whole, because its entries carry the codec setup a player needs;
- zero the contents of every existing `free` or `skip` box as well, because some
  devices store GPS in a top-level `skip` box
  ([exiftool QuickTime tags](https://exiftool.org/TagNames/QuickTime.html));
- zero the samples of any track that is neither audio nor video, then blank the track,
  because timed location data sits in the media data, not in `moov`.

The phone does none of this for us. What iOS Safari's picker does to a video's metadata
is undocumented, and Android's redaction skips `.mov` files and never touches camera
identity. The test is `exiftool -a -G1 -ee -u`, run on real iPhone and Android clips
before and after the walker: afterwards it must find no location, make, model,
software, lens or free-text device tags. `-ee` reads timed metadata, and `-u` shows the
vendor GPS boxes that exiftool otherwise hides. The promise covers location and camera
data. The boxes playback needs still carry creation times; the video stories decide
whether to zero those too.

**The server checks rather than strips.** R2 cannot patch a stored object, and rewriting a
300 MB clip through a free Function would not fit its CPU. So when an upload completes,
the Function reads the clip's box headers with ranged reads, and deletes the clip before
it can be approved if anything outside the walker's keep-list still holds data. R2
deletes are strongly consistent. For photos, the server strips again; for clips, it
refuses what was not stripped. Box headers cannot show samples that a blanked track left
behind in the media data, so that one case rests on the walker and its tests.

**Serving.** A Function serves clips the same way it serves photos. It checks the clip's
state in D1, then answers range requests with `206` and `Content-Range`, which iOS
requires of any server hosting media
([Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html)).
Cloudflare's own example R2 handler answers `200`, which is not enough. Clip responses
carry the same `Cache-Control: private, max-age=300` as photos. Every range request is a
Functions request. A third-party trace from 2023, not a Cloudflare figure, saw Chrome and
Firefox make 3–4 requests per play, and Safari one request per few MB
([zeng.dev](https://www.zeng.dev/post/2023-http-range-and-play-mp4-in-browser/)). For a
250 MB clip that is about 70 requests.

**Open until the video stories measure it:** clips are stored as recorded, so an iPhone's
HEVC clip stays HEVC. Whether every browser the families use plays HEVC was not
established.

**Not chosen:**

- **Cloudflare Stream.** It has no free tier: $5 a month per 1,000 minutes stored, plus
  $1 per 1,000 minutes delivered
  ([Stream pricing](https://developers.cloudflare.com/stream/pricing/)). With direct
  uploads it keeps the parent's original, metadata and all, where the site cannot strip
  it. Its delivery domain
  sends no `X-Robots-Tag`, its manifests may not be proxied, and desktop Firefox has no
  native HLS.
- **Media Transformations**, Cloudflare's server-side re-encode. Output is capped at 60
  seconds and input at 100 MB
  ([transform videos](https://developers.cloudflare.com/stream/transform-videos/)).
- **Presigned uploads straight to R2.** They need a hand-written request signer
  (Cloudflare's examples use a library), an R2 secret key held by the site and a CORS
  rule, and a signed URL cannot cap the file size.
- **Re-encoding in the browser with its built-in recorder.** It runs in real time, so a
  parent waits the clip's full length with the screen on, and nobody has shown the
  iPhone audio route working.
- **A library, Mediabunny, for a faster re-encode**, which the vanilla-JS rule rules out.

**The terms question.** Cloudflare's CDN terms say: *"Unless you are an Enterprise
customer, Cloudflare offers specific Paid Services (e.g., the Developer Platform, Images,
and Stream) that you must use in order to serve video and other large files via the
CDN."* ([service-specific terms](https://www.cloudflare.com/service-specific-terms-application-services/)).
R2 and Pages are Developer Platform services. Cloudflare's 2023 announcement says
*"customers can serve video and other large files using the CDN so long as that content
is hosted by a Cloudflare service like Stream, Images, or R2"*
([blog](https://blog.cloudflare.com/updated-tos/)). Whether free-tier use counts as a
Paid Service is not settled by the text. **Owner decision, 2026-09-26: accept that and
record it.** With clips kept at full size, storage passes the free 10 GB after roughly
30–50 clips and is billed from then on anyway.

### 11. The invite code and the upload session

**Built in #150, with two values confirmed by the owner at its pickup on 2026-09-27.**
The code is 12 symbols of Crockford's base 32, 60 bits, grouped in fours
(`K7QM-3XRD-9FWB`). It lives in D1 as it is, because the admin page shows it (#152).
Earlier codes stay, so an old link can say the invite has changed rather than that it is
wrong. The letters I, L and O are read as 1, 1 and 0.

- **A session lasts 90 days.** Not chosen: the 180 the issue proposed, or 365. Rotating
  the code ends every session whatever its age. The cookie is `__Host-upload`, signed with
  `SESSION_SIGNING_KEY`, and it names the code's generation. The server checks the age
  itself rather than trusting `Max-Age`.
- **10 failed joins per address per hour, then 429.** Not chosen: 5 or 20. Only a wrong
  or earlier code counts. The address is stored as an HMAC keyed with `ADDRESS_HASH_KEY`,
  and an IPv6 address counts by its /64. Pages runs no scheduled job, so a failure is
  deleted by the first join after it is an hour old, not on the hour.
- **Recording a failure spends one unit of a budget of 100 an hour for the whole site**
  (owner, 2026-09-28, #177). It spends D1's daily writes, which the account shares.
  Measured on the preview database with `meta.rows_written`, a recorded failure costs 5
  rows written: 1 for the budget's counter row, 3 to insert it (the table and its two
  indexes) and 1 to delete it an hour later. So the join route can spend at most
  5 × 100 × 24 = 12,000 of D1's 100,000 a day, plus one cleanup write an hour. Without
  the budget, 25,000 failures from any number of addresses would stop every D1 query on
  the account until midnight UTC. Once the hour's budget is spent, a failure is answered
  as usual and not recorded, and the current code still joins. Not chosen: closing
  joining for everyone until the hour turns, which would let about 100 bad requests an
  hour stop every parent. The accepted cost is that a new address can try codes past its
  limit until the hour turns, which 60 bits makes hopeless.
- **Every upload route sits under `functions/api/upload/`**, whose `_middleware.js` runs
  the one guard, `requireUploadSession` in `lib/session.js`, then (since #154)
  `requireSameOrigin`, so every upload write needs the site's own Origin as every admin
  write does. `test/guard.test.js` calls
  every Function route outside its `PUBLIC` list with four bad cookies and requires 401,
  and holds every upload write to 403 without the site's Origin.
  An admin route (#151) answers to the admin guard instead (item 12). The test knows
  admin routes by directory and holds them to 403, rather than listing them as public.
- **The admin page makes and changes the code** (#152, `/admin/code`). "Create code"
  makes generation 1 only while the database holds none, so a second press, or a page
  left open, never ends a session. "Rotate code" opens a native `<dialog>`, and only
  its confirm button posts; the new code is the next generation, which ends every
  session at its next request. Each is one `INSERT … SELECT`, so two presses at once
  cannot make two codes of one generation. Both are plain form posts answered `303`
  back to the page, so a reload cannot post again. The invite link names
  `https://photos.madcowsailing.com` in production and the page's own origin
  anywhere else, so a preview's link opens the preview. This replaced #150's seed
  script. Not chosen: posting with `fetch`, which needs more script for the same
  result, and one endpoint for both, which would let a stale "Create code" page
  rotate the code with no warning.

Secrets, and where the code is created and rotated, are in README.md, The photo site.

### 12. The admin guard

**Built in #151, 2026-09-28.** Every `/admin` page and admin API passes
`requireOwner` in `lib/access.js`. It is run by `functions/admin/_middleware.js`, and by
`functions/api/admin/_middleware.js` for the admin APIs. Access sits in front of `/admin`
on `photos.madcowsailing.com`, but the project's `*.pages.dev` address is not behind it
(item 1). So the lock is this check of the `Cf-Access-Jwt-Assertion` token, and the
Access sign-in is the door to it. README.md, The photo site, records the two Access
applications and their policies.

- **What passes.** An RS256 signature by one of the team's published keys, looked up
  by `kid`, with the algorithm pinned in the code and never read from the header. `iss`
  must equal the team domain and `aud` must hold the application's tag. `exp` must be
  present and not yet reached, and `nbf` present and reached, allowing 60 s of clock
  drift for `nbf` only. The email must be on the list, compared without regard to
  letter case. Anything else is 403, a malformed token included. Keys that cannot be
  fetched give 503. Not chosen: reading the `CF_Authorization` cookie, which Access's
  own docs say is not always passed.
- **Who is let in. Owner decision, 2026-09-28, during #151: the admins, not the owner
  alone.** A second address was added to the admin policy, to both `ADMIN_EMAILS`
  secrets and to the preview policy, and the policy was named `Admins - photos admin`.
  Not chosen: the owner alone, which is what epic #147 ("`/admin` answers only to the
  owner") and #151's title were written for. Those still say "owner", and the code's
  `requireOwner` and `context.data.owner` keep the name. The docs name no count: the
  list is whatever `ADMIN_EMAILS` holds, and README.md says which four places change
  when an admin is added.
- **Where each value lives.** `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are vars in
  `wrangler.jsonc`, one pair per environment, because every token carries both.
  Preview deployments are signed for the Pages preview application, so the two
  environments' tags differ. `ADMIN_EMAILS` is a Pages secret. **Owner's choice,
  2026-09-28: keep the addresses out of this public repo.** Not chosen: an address
  already published on the sites, in `wrangler.jsonc`. The cost: the list can't be
  reviewed in a diff, and a change means retyping the whole secret in both
  environments. Any of the three unset means every request is refused.
- **Keys.** They are cached per isolate for an hour. They are fetched at most once a
  minute, whether the last attempt worked or failed, and requests that arrive while a
  fetch is in flight wait for that one. So neither made-up kids nor a certs outage can
  make every request fetch. A failed fetch keeps the keys it had, so a made-up kid
  during an outage cannot lock out a known one. The accepted costs: a token signed by a
  key published less than a minute after the last fetch is refused until the minute is
  up, and a failed fetch answers 503 for the rest of its minute. Access rotates every 6
  weeks and keeps the previous key valid for 7 days. *Measured under `wrangler pages
  dev` 4.141.0, not on the edge:* six concurrent requests on a cold isolate shared one
  fetch and all passed, and a request whose client disconnected mid-fetch did not stop
  another waiting on the same fetch.
- **No bypass anywhere.** No flag, header, cookie or hostname turns the check off.
  `test/access.test.js` tries five hosts (localhost, both `pages.dev` forms, the domain),
  four environments and four headers, a valid token in the `CF_Authorization` cookie
  among them, and requires 403 from each without the token header. Local development
  runs the check unchanged against generated keys: `scripts/access-dev.mjs` stands in
  for Access, and `.dev.vars` points `ACCESS_TEAM_DOMAIN` at it (README, Running it
  locally).
- **A write needs the site's own Origin as well** (#152). Both admin directories run
  `[requireOwner, requireSameOrigin]`, and `requireSameOrigin` in `lib/origin.js`
  refuses any method but GET and HEAD whose `Origin` is missing or another site's, with
  403 `{"error":"origin"}`. So a page elsewhere cannot post a form into the admin area,
  and a later admin write gets the check from its directory rather than from memory.
  `test/guard.test.js` holds every admin write to it. `POST /api/join` uses the same
  `sameOrigin`, since it sits behind no directory guard. Whether a browser sends
  Access's cookie on a post from another site depends on the application's SameSite
  setting, which lives in the dashboard and in no file here, so nothing rests on it.
- **Pages are rendered, never static** (item 4). `lib/admin-page.js` holds a byte-for-byte
  copy of the site's header and footer. It also holds the stylesheet links with their
  `?v=` stamps, because `tools/assetver.py` stamps HTML files only.
  `test/admin-page.test.js` fails until that copy matches the static pages again, and it
  runs html-validate on the rendered page, which `npm run check` never sees. A
  page's script is the same kind of copy: `/admin/code`'s `?v=` is written into
  `lib/admin-page.js` by hand, and `test/admin-code.test.js` fails until it is
  `public/js/admin-code.js`'s own hash.
- **Proven, not only passing.** Each refusal was predicted before the check was written
  (31 of 34 tests red against a stub that let everything through). A first round of 16
  mutations, one per check, read 15 exact and one above. `review-fanout` then found three
  holes that no mutation had reached: R23's `ACCESS_AUD` half could not fail, the three
  timing values were tested with ticks derived from themselves, and nothing tried a
  host or header bypass. After the fix, a second round of 26 mutations read 26 of 26
  exactly as predicted, 11 of them on the new tests. Both rounds ran on a scratch copy of
  `photos/`, and the tables are on #151's pull request. `test/guard.test.js` holds every
  route under `admin/` or `api/admin/` to 403, both with no token and with a valid upload
  session.

### 13. Albums

**Built in #153, 2026-09-28.** The owner keeps one album per regatta or practice day on
`/admin/albums`, in the `albums` table (migration 0004). `lib/albums.js` holds the rules.

- **The address is made once and never changes.** It is the date, then the title with
  accents dropped, lowercased, and every run of anything but a–z and 0–9 made one hyphen,
  cut back to a whole word within 60 characters: `2026-10-04-fall-regatta`. A title with
  no letter or digit takes its kind's name. A second album with the same date and title
  gets `-2`, then `-3`, and the UNIQUE constraint decides, so two made at once cannot
  share one. Once all 50 are held, adding says so on the page and makes nothing. Editing the title, kind or date keeps the address, so a shared link keeps
  working. Not chosen: an address that follows the title, which breaks every link sent
  before an edit.
- **A title is 1 to 80 characters on one line, with no control character**, stored as
  typed, markup included.
  Every page escapes it where it shows it; `GET /api/albums/open` returns it as JSON
  data, so the share page (#155) must set it as text, never as HTML.
- **Closing sets `closed_at`**, which takes the album off `GET /api/albums/open` and makes
  `openAlbum()` find nothing. That is the check #154's upload route makes, answering 409.
  Its approved photos stay public, so #157's public list must not filter on it.
  Reopening clears it.
- **Deleting an album that holds a photo is refused by the database.** Owner's choice
  at #153's pickup: #154's `photos.album_id` must be `REFERENCES albums (id)`, with no
  `ON DELETE` action. D1 enforces foreign keys in every query, and a violating statement
  fails with `FOREIGN KEY constraint failed`
  ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), read
  2026-09-28). So the refusal holds whatever state the photo is in, and an upload that
  lands mid-delete cannot slip past a count taken first. The route catches the failure and
  only then counts the photos, to say how many. `test/albums.test.js` holds the rule on
  #154's real `photos` table (a stand-in until #154 made it), and `test/upload.test.js`
  holds it on photos sent through the upload route. The schema test fails if any table
  but `photos` names albums, since the count reads `photos`, or if `photos.album_id` lacks
  the reference or cascades.
  Not chosen: creating the photos table in #153, which would design #154's schema before
  its pickup; and moving the refusal into #154.
- **The open list lives at `/api/albums/open`**, the path the story named, in its own
  directory whose `_middleware.js` runs the same `requireUploadSession` as
  `api/upload/`. `test/guard.test.js` checks both directories.
- **"Newest first" is the latest date first, a future one included**, so an album made
  ahead of time for next week's regatta sorts above today's practice. Which album the
  share page preselects is #155's to decide: only one held today, else the most recent
  past one, never a future one. Owner's choice at #153's review, 2026-09-28. Not chosen:
  sorting today and past first, or hiding future albums, since each needs "today" in the
  club's time zone while D1's clock is UTC.
- **Every press is a plain form post answered 303** back to the page, with `?done=` or
  `?error=` saying what happened, as on `/admin/code`. So the page has no script, and a
  reload cannot post twice. The notice names an album by the title read from the
  database, never from the address bar. Delete has no confirm dialog: only an empty album
  deletes, and one deleted by mistake is made again at the same address.
- **The page's fields are the first form fields on any of the three sites.** Their border
  is `--deep`, because a field's edge must read 3:1 against the page (WCAG 1.4.11). On
  `--hull`, the `--spray` hairline reads 1.64:1 and `--deep` 13.45:1 (computed from
  `tokens.css`, #153).

### 14. The upload API

**Built in #154, 2026-09-29, with three owner decisions taken at its pickup and
three at its review.**
`POST /api/upload` (`functions/api/upload/index.js`) takes one photo as its three
JPEG sizes, from a live upload session, into an open album, and stores it pending.
`lib/photos.js` holds the rules and `lib/jpeg.js` the rebuild. The form's fields and
every answer are in the route's header comment.

- **Every metadata segment goes, by an allow-list.** Each JPEG is rebuilt from the
  segments a decoder needs (frame, Huffman and quantisation tables, restart
  interval, scans) and nothing else. So every APPn goes (EXIF and its GPS in APP1,
  XMP, the ICC profile, IPTC, JFIF), as does every comment, every unknown marker,
  and whatever follows the end-of-image marker, where a motion photo keeps its
  video. The compressed data is copied as it came, so the picture is unchanged. Ten
  Pillow variants and Chrome 154's canvas output decoded to identical pixels
  afterwards, and a real `wrangler pages dev` run stored the canvas JPEGs with the
  fictional GPS spliced in and read none of it back. Not chosen: a deny-list of
  known metadata segments, which lets a vendor's new segment through.
- **What the share page must do, because the strip removes it** (for #155). EXIF
  orientation goes with the rest, so draw the photo upright before encoding, as #155
  criterion 2 already says. The ICC profile goes too. Chrome's canvas writes an
  sRGB one, which a browser assumes for an untagged JPEG, so nothing shifts, but
  keep the canvas on its default `srgb` colour space: a `display-p3` canvas would
  lose its profile here and its colours would shift.
- **What is refused.** A file that does not start as a JPEG, or whose frame is
  lossless, arithmetic-coded, 12-bit or neither one nor three components, is 415.
  One that breaks off is 400. One over its size's bytes or long edge (item 9) is
  413, as is a body past all three caps together, before any of it is parsed. A
  caption is counted in characters, as the table's CHECK counts it, so an emoji is
  one.
- **The three sizes must be one picture's shape** (owner, 2026-09-29, at #154's
  review). Each is no larger than the next, and each has the next's aspect ratio to
  within a pixel of the browser's rounding, or the upload is 400 `sizes`. That
  catches a broken share page. It cannot catch two different pictures of the same
  shape sent on purpose by someone holding the code, and the owner approves after
  seeing one size while the public sees the others. So #156 carries a criterion to
  show all three before approving. Not chosen: the route check alone; accepting it
  with rotation as the remedy.
- **Objects first, then the row.** The three objects go into R2 under a random
  128-bit `media_key` (`photos/<key>/grid.jpg`, `screen.jpg`, `full.jpg`). Only then
  is the row written, by one `INSERT … SELECT` that finds the album open in the
  same statement. So no row ever names missing objects, and an album closed or
  deleted mid-send takes nothing. Any failure after the objects are stored deletes
  them again, once every put has settled. If that delete fails too, the log names
  the objects' `photos/<key>/` prefix, the only way to find them short of listing
  the bucket against the table. The row's `id` is AUTOINCREMENT, so a rejected
  photo's id (#156) is never given to a later one.
- **The daily cap is 500 uploads per session per UTC day** (owner, 2026-09-29,
  confirming the story's proposal), counted in `upload_counts` by one guarded upsert,
  as #177's join budget is, so two uploads arriving together cannot both take the
  last one. A unit is spent before the objects are stored, so a capped session costs
  no R2 write, and given back by a guarded decrement when the bucket or the
  database fails or the album closes mid-send. So the cap counts photos stored,
  not attempts (a finding of #154's review). It stops a runaway phone. It does not
  stop a leaked code, since whoever
  holds the code can join again for a new session; rotating the code does that
  (item 11). Not chosen: adding a sitewide cap of 2,000 a day, which lets any code
  holder use up the day for every parent (the tradeoff #177 turned down for
  joins); or 200 per session.
- **What an upload costs D1.** *Measured on the preview database, 2026-09-29, with
  `meta.rows_written`:* the photo insert writes 5 rows (the table, its three
  indexes and the AUTOINCREMENT counter) and the cap's upsert 1, so a stored photo
  costs 6. At the cap one session writes 3,000 a day, and the account's 100,000
  hold about 16,600 uploads before every D1 query stops until midnight UTC. A
  failure after the checks writes 2, the unit spent and given back.
- **One table for photos and clips** (owner, 2026-09-29). `photos` carries every
  state the epic needs (`uploading` for a clip whose parts are still arriving,
  `pending`, `approved` and `hidden`) with the approval and takedown columns, and a
  clip's `content_type`, `duration_ms` and R2 `upload_id`, left empty on a photo. So
  the clip story (#198) and #156 and #158 add no migration to it, and the
  album-delete refusal (item 13) covers clips as well. A rejected row is deleted,
  not kept in a state. The accepted cost is that the clip columns were chosen
  before the clip design exists, so #198 may still need one more column, which is
  additive. Not chosen: a second migration for video, and building the clip upload
  in #154.
- **A clip's row can start empty** (owner, 2026-09-29, at #154's review).
  `captured_at`, `width`, `height` and `bytes` are required by a CHECK in every
  state but `uploading`, not by NOT NULL. A clip's row is made when its first part
  arrives, before the server can check what the page says about it. And SQLite can
  loosen a NOT NULL only by rebuilding the table, which the additive-only rule
  (item 6) forbids, so this had to be settled before production had the table.
  0005 was edited in place for it, and preview's empty copy was dropped and applied
  again the same day, with `d1_migrations` row 5 deleted. Preview's `sqlite_master`
  then matched the files object for object, and the old 0005 differed on `photos`
  alone. Not chosen: writing page-declared values at `uploading` and overwriting
  them; a rebuild in a 0006. **A migration already applied anywhere is not edited
  again**: D1 records it by filename, so an edit reaches no database that has it.
- **The clip upload is its own story**, #198, filed at #154's review (owner,
  2026-09-29) as a placeholder under #147, carrying D11's caps, a size cap, the
  bucket's lifecycle rule and the part-CPU measurement item 10 asks for first.
- **A coach's upload has its own marker** (owner, 2026-09-29, for #192). `sender` is
  `parent` or `coach`, and a coach's row names no code generation, since no code
  opened the session. Not chosen: leaving #192 to add the column.
- **The Origin check is the upload directory's** (see item 11), so the clip routes
  get it without anyone remembering it.
- **CPU.** *Measured in Node 24 on this machine, not on the edge:* rebuilding
  Chrome's canvas full size (0.55 MiB) takes 0.3 ms warm and 1.1 ms cold, and a
  Pillow quality-100 file (1.75 MiB) 3.1 ms, against the free plan's 10 ms a request.
  The edge's own reading per route is #157's (item 8's CPU row).

### 15. The share page's sending

**Built in #155, 2026-09-29.** `public/js/share.js` joins (item 11), then sends:
the link, "Add photos", the photos, "Send", with nothing typed. `test/share.test.js`
runs the script in `node:vm` against stand-ins for the DOM, the canvas and the
image decoder, and sends through the real routes into SQLite, so the page and
`POST /api/upload` are tested as one contract.

- **Each photo is made ready as soon as it is chosen, one at a time.** Its capture
  time is EXIF's DateTimeOriginal with its offset, else DateTimeDigitized, else the
  file's date, in seconds. DateTime is not read, because an edit moves it. Without an
  offset the time is read in the phone's own zone. The photo is decoded with
  `createImageBitmap`, and `<canvas>` makes full (2560), screen (1600) and grid
  (480) as JPEG, each drawn from the size above it. It tries quality 0.85, then lower,
  until each size is under its cap. Every size is worked out from the photo's own
  shape, never from the size above, so the three always pass `sizesAgree`. That was
  checked over a million random shapes. Not chosen: making them when Send is
  pressed, which makes the parent wait after Send and tells them about a HEIC too
  late; or several at once, since a phone holds one photo's pixels at a time this way.
- **Upright, whatever the browser does.** *Measured in Chrome 154:*
  `createImageBitmap` turns all eight EXIF orientations upright by itself, and
  `imageOrientation: 'none'` changes nothing. So the page asks once, of a 2 × 1 JPEG
  marked "turn 90°", and turns a photo itself only where the browser did not. A
  photo turned by both would arrive on its side. With Chrome made to decode as a
  browser that does not turn would (EXIF taken out before it decodes), all eight
  arrived upright, read from their stored pixels. So did two portraits the owner
  sent from a Samsung (Chrome 154, Android 16).
- **No more than three upload at once, one batch per press of Send.** Try again
  sends a failed photo into the album chosen now, in its first batch. A 401 (the
  invite ended) or a 429 (the day's 500) fails every queued photo at once rather
  than sending each to be refused. Opening the new invite link in the same tab
  joins without a reload (the `hashchange` listener), so the photos are still there
  to try again.
- **An album closed mid-send (409) stops every queued photo bound for it**, and
  only those: a later Send or a Try again may have queued photos for another album.
  The list then reloads and **preselects nothing** (owner, #155's review), so the
  photos that failed go only to an album the parent chooses. Not chosen: keeping the
  preselect, which quietly filed today's photos into last Saturday's album on one
  tap of Try again; or preselecting only a same-day twin.
- **A photo the phone cannot hand over says so**, apart from one it cannot open.
  On the owner's Samsung, six stale picker entries for files just replaced were
  refused with the format wording, whose advice (add a JPEG copy) was wrong for
  them. The page now reads the file's first bytes before decoding anything.
- **An album's day is shown in UTC.** A date with no time of day is a calendar
  day: made at local midnight, or shown in the phone's zone, it slips a day on one
  side of UTC. The tests give the page a fixed clock at a moment when Chatham's date
  is a day ahead of UTC's, and show dates in a zone west of UTC by default, so a slip
  either way fails every run (#155's review measured the old pin missing both).
- **A caption is counted in characters, as the server counts it, with no
  `maxlength`.** Browsers count `maxlength` in UTF-16 units, where an emoji is two.
  WebKit has counted it in whole symbols, which would let through a caption the
  server refuses. Line breaks and tabs are sent as spaces.
- **Remove**, until a photo starts sending. The owner added it at the pickup. The
  story's criteria had no way to take a chosen photo back out.
- **Leaving while photos are queued or sending asks first** (`beforeunload`), and
  a line says to keep the page open. Measured in desktop Chrome 154. Whether
  iPhone Safari shows that prompt was not measured; it is read with the iPhone
  check (#155's criterion 7).
- **The summary is written once per change.** Everything that changes in one turn
  is written to the live region together, and only when its words change. So a
  screen reader hears a photo sent, not every step.
- **The floor is read through `tools/h2proxy.mjs`** (Quality floor, the owner's
  decision at #155's review). Through it the page read 96, 97 and 96 with
  accessibility 100, against `develop`'s 97, 97 and 97. The point it costs is
  `share.js`'s size, measured by swapping the branch's script for `develop`'s: the
  page's CSS and markup cost nothing.

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
and every split of `loading` and `fetchpriority` hints. Production was expected
to read about a point below that local serve, and at #96's step 9 it read a
point above (96 against 95, 94 and 94), so the offset is per page: measure it
rather than apply it. 95 was reached only by dropping the covers to
quality 50. Accessibility stays at 100. The evidence is on #96 and its PR. Ask
again if a change takes the page below 90.

**Trip gallery pages are held lower too, by owner decision (2026-09-15, #53):
they need ≥ 85 performance.** Their LCP element is the log paragraph, not a
photo. What costs them is everything that finishes before the first paint,
which Lighthouse's simulator puts on the critical path: the first screen's
photos, the stylesheets and the fonts. On production, with every photo blocked
the pages read 90–95, and with every web font blocked 93–95. So no shippable
change reaches 95 in all three runs without dropping the photographs or the web
fonts. Dropping the display face's preload cost 3 points. Since #53, only the
first screen of both layouts loads eager. The evidence is on #53 and its PR.
Each trip page's number is in `tools/quality_floor.mjs`'s `PERF_FLOORS`, keyed by
file, so a new trip is judged against 95 until it has an entry there. Ask again
if a change takes a trip page below 85.

**The photo site's floor is read on a local server over HTTP/2, by owner
decision (2026-09-29, #155).** `wrangler pages dev` serves HTTP/1.1, and
Lighthouse's simulation charges a page for that: the share page as shipped read
93–94 under wrangler, 98–99 on production and 96–97 through a local HTTP/2
proxy, `tools/h2proxy.mjs`, whose header has the recipe. So a photo page meets
the performance floor when it reads ≥ 95 through that proxy. A reading under
plain wrangler is compared with `develop`'s under wrangler, never with 95.
Accessibility, 360 px, focus and reduced motion are read as on the other sites.
Not chosen: reading the Access-protected `develop` preview after each merge,
which comes after the review it should inform; and holding plain wrangler to
95, which the page as shipped cannot reach. A compressing proxy was tried and
moved nothing, since Lighthouse counts decoded bytes. Ask again if production
and the proxy stop agreeing.

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
- **The same goes for each site's own CSS and JS** (`hq/css/`, `sailing/css/`,
  `photos/public/css/`, `photos/public/js/`) since #176. They are not served
  `immutable`, but all three zones hold them for 4 hours in a returning
  visitor's browser: `/css/site.css` read `max-age=14400` on every custom domain
  on 2026-09-28, against `max-age=0` on `*.pages.dev`. A reference is stamped
  with the version of the file the page's own site serves, relative links
  included.
- Internal links name the URL Pages serves: `/about`, not `/about.html`, and a
  directory with its trailing slash (`/work/`). Pages 308s the `.html` form, so
  each such link costs a visitor a redirect (#113). Since #130 linkcheck
  **refuses** an href Pages would redirect — a path ending `.html`, a directory
  without its slash, and a path naming an `index` — so the gate catches one
  coming back. `src` is unaffected. Absolute links stay outside linkcheck, so
  `grep -rhoE 'href="https://madcow[^"]*\.html"' hq sailing` is still the check
  for the two cross-site links.
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
