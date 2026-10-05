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
the work index at `/work/`, case studies for Race Timer, Taskr, Tender, Cairn and
the photo site (the last two from #230), and Taskr's tester, support and privacy
pages; the apps index folded into `/work/` in #81, and `/apps/` now 301s there.
Since #230 (2026-10-01) hq says Dave is open to full-time roles and contract work,
and puts JPMorgan Chase in the past tense.
Sailing has the home, about, apps index, the
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
waiting for approval, #155 the share page that makes those JPEGs on the
phone and sends them, #156 the queue where the owner approves or rejects
them, #157 the public album list and album pages, which replaced the
holding page at `/`, #159 the policy at `/policy`, which every page's
footer links, #158 "Remove this photo", which hides a photo at once
and queues it on `/admin/removals`, #192 the coach sign-in at `/coach`,
which opens an upload session through Access with no invite link, and #193
the installed app: the share page installs to a phone's home screen, and on
Android it takes photos from the Share menu. Those are epic #147's. **Epic #216 (accounts) replaces the invite link and the
coaches' Access sign-in** with email-and-password accounts the owner
approves, and retires both at its cutover, #226. Its first story, #217, is
the email the site sends through Resend, with a test send at `/admin/mail`,
and #218 chose the password hash every account will use: scrypt, in
`photos/lib/password.js`. **Epic #191 makes COHSSA a section of the same
site**, on those accounts; #194 recorded the decisions behind both epics
(The photo site, item 24).
Epics #147, #216 and #191 build the rest. The `develop` preview sits behind
Access. The domain has served the site since release `50992c3` (2026-09-27),
and each story reaches it with the next promotion, so read `release`, not this
paragraph, for what production holds
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
│   │                         api/join.js, the public pages (#157: index.js is /,
│   │                         albums/[address]/ an album, photos/[id]/[size].js
│   │                         a photo), "Remove this photo" (#158: remove.js
│   │                         asks without JavaScript, api/remove.js takes it
│   │                         down), api/upload/ and api/albums/ behind
│   │                         the upload guard (api/upload/index.js takes a
│   │                         photo, #154), and admin/ and api/admin/
│   │                         behind the admin guard (admin/code.js is the
│   │                         invite code, #152; admin/albums.js the albums, #153;
│   │                         admin/queue.js the approval queue, #156, with
│   │                         api/admin/queue/ and api/admin/photos/;
│   │                         admin/removals.js the removal requests, #158,
│   │                         with api/admin/removals/; admin/mail.js the
│   │                         test email, #217, with api/admin/mail/;
│   │                         share/receive.js answers a share that found no
│   │                         worker on the phone, #193)
│   ├── lib/                  Code the Functions import that is not a route
│   ├── templates/page.html   The public pages' shell, never served (#157)
│   ├── migrations/           D1, NNNN_<what>.sql, additive only
│   ├── scripts/              access-dev.mjs: a local stand-in for Access (#151)
│   ├── test/                 node --test; `npm test` from the root, which loads
│   │                         test/text-modules.js first so a .html imports (#157)
│   └── public/               The served files and nothing else (the output dir)
│       ├── share/index.html  Where an invite link lands; joins, then (#155) sends.
│       │                     The installed app's start page (#193)
│       ├── share/sw.js       The installed app's worker: takes a share, caches
│       │                     nothing, controls /share/ only (#193)
│       ├── manifest.webmanifest  The installed app and its Android share target (#193)
│       ├── icons/            Its icons, written by tools/app_icons.py (#193)
│       ├── policy.html       /policy: who sees a photo, what is kept, how to have
│       │                     one taken down (#159). Every page's footer links it
│       ├── 404.html          Also what stops Pages treating the site as an SPA
│       ├── _headers          Static files only; lib/headers.js holds the same
│       ├── _routes.json      Which paths invoke a Function: /, /albums/*, /photos/*,
│       │                     /remove, /api/*, /admin, /admin/*, /coach, /coach/*,
│       │                     /share/receive
│       ├── robots.txt        Allows crawling, on purpose
│       ├── css/site.css
│       ├── js/share.js
│       ├── js/remove.js      An album page's "Remove this photo" dialog; the
│       │                     template loads it, so assetver stamps it (#158)
│       ├── js/admin-code.js  /admin/code's script; its ?v= is stamped by hand
│       │                     in lib/admin-page.js (#152)
│       ├── js/admin-queue.js /admin/queue's reject dialog, stamped the same way (#156)
│       └── js/admin-removals.js /admin/removals' delete dialog, the same way (#158)
├── tools/
│   ├── photos.py             Trip-log derivatives + trip.json + the log pages
│   ├── templates/            trip.html, logs-index.html — photos.py fills these
│   ├── linkcheck.py          Resolves every internal href AND src against disk. In the gate.
│   │                         Reads photos/templates/, and resolves a Function path against
│   │                         photos/functions/ (#157).
│   ├── assetver.py           Writes ?v=<hash> onto every shared and site CSS/JS URL, templates
│   │                         included. linkcheck checks it.
│   ├── quality_floor.mjs     Measures the floor on the PRODUCTION domains. Not in the gate.
│   ├── h2proxy.mjs           HTTP/2 in front of wrangler, to read the photo site's floor locally (#155). Not in the gate.
│   ├── app_icons.py          Renders the photo site's app icons from shared/img/madcow-mark.svg (#193). Not a build step.
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
*Read on production on 2026-10-01 (#161):* an approved photo's grid, screen and full
sizes each answered `private, max-age=300` on photos.madcowsailing.com, the same header
`madcowphotos.pages.dev` sent. So the zone does not raise a Function's lifetime, and no
Cache Rule is needed.

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
├── templates/       the public pages' shell, never served (added by #157)
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
| CPU | 10 ms per request | measured per route on production on 2026-10-01 (#161), each route driven alone for 20 requests in its own UTC minute, then read from the GraphQL Analytics API's `pagesFunctionsInvocationsAdaptiveGroups` by `datetimeMinute` (an Account Analytics: Read token; the schema gives the unit as microseconds). Each minute's request total had to equal the 20 sent, so no other traffic was in it. p50 / p90 / p99: `/` 2.4 / 5.4 / 7.1 ms; an album page of 12 photos 1.9 / 2.5 / 7.2 ms; the image route 2.2 / 3.1 / 7.5 ms; the admin home behind the Access token check 2.7 / 4.2 / 9.2 ms; 0 errors. At 20 requests, p99 is about the minute's slowest request, and on every route that one took 7–9 ms. The admin home's came within 0.8 ms of the limit. Two minutes were sampled (`sampleInterval` 1.25 and 1.82), so their quantiles come from about 16 and 11 requests. The Metrics tab cannot split by route, and the tail output Cloudflare documents carries no CPU field. Clip parts: the video stories | Workers Paid: 30 million CPU ms a month, then $0.02 per million |
| R2 storage | 10 GB-month | about 11,000 photos, or about 30–50 three-minute clips (item 9) | $0.015 per GB-month |
| R2 writes (Class A) | 1 million a month | 3 per photo, about 12 per clip | $4.50 per million |
| R2 reads (Class B) | 10 million a month | 40 per album view: about 2.93 million a month at the request ceiling | $0.36 per million |
| D1 | 5 million rows read and 100,000 written a day; 5 GB in all, 500 MB per database | about 4% of reads at the request ceiling, if every query uses an index | with Workers Paid: 25 billion reads and 50 million writes a month |
| Zero Trust | 50 users | the owner, plus anyone who signs in to a preview, plus each coach (#192, item 20) | $7 per user a month |
| Email (Resend Free, its own account; #217, item 21) | **100 emails a day** and 3,000 a month, sent and received together, each recipient counting as one; the day is 00:00–24:00 UTC. 10 requests a second, per team | every email the later stories send, and each test from `/admin/mail`. **Past the daily limit Resend refuses each send with `429 daily_quota_exceeded` until midnight UTC**, and past the monthly one with `monthly_quota_exceeded`. Pay-as-you-go is a paid feature, so nothing is billed and nothing is queued: the site sends nothing more until the reset | Pro, $20 a month: 50,000 a month, no daily limit, then $0.90 per 1,000 |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and the
[Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/).
The email row, read 2026-10-01: [Resend pricing](https://resend.com/pricing),
Resend's [account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
(*"daily email quota of 100 emails/day and 3,000 emails/month. This quota
includes both sent and received emails … The daily quota is a UTC calendar day
(00:00–24:00 UTC) and resets at midnight UTC"*), and its
[errors](https://resend.com/docs/api-reference/errors) page (`daily_quota_exceeded`,
status 429, *"wait for the quota to reset at midnight UTC"*). The account's
own Usage page read the same that day: Free, 0 / 100 a day, 0 / 3,000 a
month, 0 / 3 domains, 10 req/s, pay-as-you-go off. The refusal is read from
the docs, not measured: measuring it costs a day's sends.

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
  the code ends every parent session whatever its age; a coach's session has no code
  behind it and survives (item 20). The cookie is `__Host-upload`, signed with
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
  every Function route outside its `PUBLIC` list with seven bad cookies, a parent's
  and a coach's (#192), and requires 401, and holds every upload write to 403
  without the site's Origin.
  An admin route (#151) answers to the admin guard instead (item 12). The test knows
  admin routes by directory and holds them to 403, rather than listing them as public.
- **The admin page makes and changes the code** (#152, `/admin/code`). "Create code"
  makes generation 1 only while the database holds none, so a second press, or a page
  left open, never ends a session. "Rotate code" opens a native `<dialog>`, and only
  its confirm button posts; the new code is the next generation, which ends every
  parent session at its next request. The dialog says coaches keep sending (#192). Each is one `INSERT … SELECT`, so two presses at once
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
`requireOwner` in `lib/access.js`. Since #192 the same check also guards
`/coach`, run against the coaches' list and application (item 20). It is run by `functions/admin/_middleware.js`, and by
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
  opened the session. Not chosen: leaving #192 to add the column. #192 writes it,
  from the session's `sender` (item 20).
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

### 16. The approval queue

**Built in #156, 2026-09-30, with three owner decisions taken at its pickup.**
`/admin/queue` (`functions/admin/queue.js`) shows every waiting photo, and its
forms post to `functions/api/admin/queue/`: `approve`, `reject` and `captions`.
`lib/queue.js` holds the rules. Only a pending photo is approved or rejected
here; an approved one leaves the public page through #158.

- **A batch is one press of Send, in one album.** A photo retried into another
  album keeps its first batch (item 15), so the album is part of the key. The
  oldest batch comes first, each with its album, when it was sent and how many
  photos it holds.
- **A batch over 200 photos is shown in parts of 200**, each its own form, whose
  Approve all and Reject all mean the part (owner, at #156's review). Nothing but
  the share page's habit keeps a batch small, and a form carries every caption
  in it: a part of 200 photos each captioned with 200 emoji comes to about
  485,000 characters, under the 512 KiB a queue form may be, and a press names
  at most 200 photos. Not chosen: a notice plus a command-line recipe for a batch
  too big to post, which left an abusive batch stuck; leaving it.
- **All three sizes are in view before approving** (owner, at pickup). The
  screen size is shown large enough to tell faces apart, and the grid and the
  full, which the public sees, sit smaller beside each other, each a link to
  itself. That is the check item 14 left to this page: two different
  pictures of one shape pass the upload route. Not chosen: the grid and the
  full as links only, which a busy evening would skip; all three at one size,
  which makes faces smallest. The cost is data, about 0.9 MB a photo and up to
  4.2 MB (item 9), fetched lazily as the page scrolls, and requests: each size
  shown is a Function request, so clearing a 500-photo regatta takes about
  1,500 of the account's 100,000 a day (item 2), against about 500 for the
  links-only option.
- **Every picture comes through `GET /api/admin/photos/<id>/<size>`**, under
  the admin guard, so no token is 403 with nothing read. It serves a photo in
  any state but uploading, so a size opened from the queue still opens once
  approved, with `Cache-Control: private, max-age=300` (item 3), which also
  spares the reload after each press from fetching every picture again.
- **Every press in a batch saves every caption typed in it** (owner, at
  pickup). Each batch is one form, so Approve, Approve all, Reject, Reject all
  and Save captions all post its captions, and a reload never loses one. A
  waiting photo's caption can be saved while it keeps waiting; its state
  changes only when a press names it. An emptied field publishes no caption.
  Not chosen: saving only the approved photos' captions, which drops the rest
  on the reload; posting with a script and no reload. **Save captions is the
  form's action and its first button**, so Enter in a caption field saves
  rather than approving the batch's first photo. A caption typed for a photo
  approved since the page loaded is not saved, since a public caption changes
  only through its own approval, and the notice says how many were not.
- **A caption stops at 200 characters on the page** (`admin-queue.js`, counted
  by code point as the server counts, as the share page does), and a tab or
  other control character becomes a space on the server rather than refusing
  the press (owner, at #156's review). One refused caption refuses the press,
  and the reload then shows the stored captions, so every caption typed in the
  batch would have to be typed again; now only a browser without the script can
  send one over 200. Not `maxlength`: browsers count it in UTF-16 units, where an
  emoji is two, and WebKit in whole symbols, which lets through a caption the
  server refuses (item 15). Not chosen: re-rendering the typed captions on a
  refusal, which breaks the post-then-redirect every admin page follows.
- **Approve all and Reject all act on the photos the page showed**, which the
  form names, never on the batch as it stands when the press arrives. A photo
  that joined the batch after the page loaded has not been seen, so it waits.
  A batch of one shows neither.
- **Rejecting is confirmed in a native `<dialog>`.** Reject and Reject all only
  open it (`public/js/admin-queue.js`) and point its confirm button at their
  batch's form through the `form` attribute, so the confirm posts that batch's
  captions with it. The dialog sits after every batch, so no batch form's first
  button is its confirm, and Cancel takes the focus. Rejecting needs
  JavaScript; approving and saving do not.
- **A rejected photo's row goes first, then its three objects**, the mirror of
  the upload's objects-first, so no row ever names objects that are gone. A
  delete the bucket refuses leaves objects no row names, and the log names
  each one's `photos/<key>/` prefix (README, The photo site).
- **A press is at most three statements, whatever the batch holds.** D1 allows
  50 queries a request on the free plan and 100 bound parameters a query
  ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/), read
  2026-09-30), so the ids and the captions each travel as one JSON value, read
  with `json_each()`. A queue form may be 512 KiB, far past the albums' 4 KB,
  since it carries a caption for every photo in the batch. R2 deletes at most
  1,000 keys a call, so a reject deletes 333 photos' objects a call.
- **The admin home shows how many photos wait and the storage used**, the sum
  of every stored row's `bytes` in any state, against item 8's free 10
  GB-month. R2's pricing page does not say which GB it means
  ([R2 pricing](https://developers.cloudflare.com/r2/pricing/), read
  2026-09-30), so the page takes the smaller, 10^9 bytes, and runs out early
  rather than late. The sum reads every row, about 11,000 at the allowance,
  against D1's 5 million a day. It counts rows, so objects a refused reject
  left in the bucket, which R2 still bills, are in the log and not in the
  figure.
- **Clips are not in the queue yet.** Every statement names `kind = 'photo'`,
  so a clip's id posted to a press changes nothing; the clip story, #198, adds
  them.
- **A coach's photo says "sent by a coach"** beside when it was taken (owner,
  at #192's pickup), per photo rather than per batch, so it stays true
  whatever a batch holds. It does not say which coach: the row keeps no
  address and no sign-in time (item 20).

### 17. The public pages

**Built in #157, 2026-09-30, with four owner decisions taken at its pickup and
one on its floor.** `/` lists the albums (`functions/index.js`),
`/albums/<address>/` shows one (`functions/albums/[address]/index.js`), and
`/photos/<id>/<size>` serves a photo (`functions/photos/[id]/[size].js`).
`lib/public.js` holds the queries and `lib/public-page.js` the markup.

- **Only an approved photo is public.** Every public statement names
  `state = 'approved' AND kind = 'photo'`, so a waiting, hidden or rejected
  photo is never listed, counted or served, and clips wait for #198. A closed
  album stays listed (item 13). An album holding no approved photo is not
  listed, and its address answers the site's 404 page: the route calls
  `next()`, and Pages' static files hold nothing under `/albums/`. The same
  address without its trailing slash is sent to the one with it (308).
- **An album is in capture order**, `captured_at` then `id`, so two photos
  taken in the same second keep the order they were sent in. The same order
  picks the list's cover and counts a photo's place for its alt text and its
  download name.
- **The pages' shell is a file** (owner, at pickup): `templates/page.html`,
  never served, which Pages bundles as a text module
  ([module support](https://developers.cloudflare.com/pages/functions/module-support/),
  read 2026-09-30). `tools/assetver.py` stamps it, and `tools/linkcheck.py` and
  html-validate read it like a page. `npm test` loads `test/text-modules.js`
  first, so Node imports a `.html` file the same way. Not chosen: a string in
  `lib/`, as the admin pages keep theirs, which linkcheck cannot read; and
  moving the admin pages onto the template in this story.
- **The grid is square tiles in fixed columns**, 2 on a phone and 5 at the
  widest (owner, at pickup). The trip logs' justified rows need an inline style
  on every figure, which this site's CSP refuses. Fixed columns are what let
  the server know the first row at every width: the first `FIRST_ROW` (2)
  photos load eager at `fetchpriority="high"` and every other lazily, so on a
  phone nothing below the first row is eager, as `tools/photos.py` makes a
  trip photo eager only in the first row of both its layouts. On a wide
  screen the rest of the first row is lazy but in view, so it loads once the
  page is laid out. `test/public.test.js` fails if `FIRST_ROW` stops being
  the CSS's fewest columns. *(`FIRST_ROW` was 5, the widest row, until
  #157's review found photos 3–5 eager on a phone.)* The lightbox shows each
  photo whole. Not chosen: flex rows that keep each shape, whose first row
  depends on the viewport; the exact trip-log rows through a per-response
  CSP hash.
- **The lightbox is `shared/js/gallery.js`, unchanged.** Each figure is a trip
  log's: an `a.frame` linking to the screen size, which the lightbox shows,
  around the grid `img`. A caption is the figcaption, the `alt` and the
  lightbox's `data-caption`, escaped. A photo with no caption has the alt
  "&lt;album&gt;, photo n of N".
- **Download saves the full size as `<address>-<nnn>.jpg`.** The full size
  answers `Content-Disposition: attachment` with that name, counted in the
  page's order, so a browser that ignores the link's `download` attribute
  still saves it named. The grid and screen sizes open in the page.
- **An album page links back with an "All albums" eyebrow link** (owner, at
  pickup). Not chosen: a one-item nav now. #159 added the second kind of page,
  and with it a two-item nav (item 18); the eyebrow stays.
- **Every page is `public, max-age=0, must-revalidate`** (#157, criterion 8),
  so an approval or a takedown shows on the next load. Every photo is
  `private, max-age=300` (item 3). A missing photo is a plain `404`,
  `no-store`. Item 3 asks for the photo header to be read on
  `photos.madcowsailing.com`, where the zone may raise it; #157 reads it there
  at its step 9, after the promotion.
- **HEAD is answered as GET is** on all three routes, as the static holding
  page answered it at `/`, so a monitor or a link preview reads the real
  status. It costs the same database read, and bucket read for a photo.
- **A path that cannot name anything asks nothing.** A size outside the three
  or an id that is not one is `404` with no query and no bucket read, and a
  path under `/albums/` that is not an address is the 404 page at once, before
  the trailing-slash redirect.
- **A database that does not answer** leaves an image `404`, never served
  unchecked (item 4), and a page `503`, saying the photos can't be shown right
  now, rather than an empty list claiming nothing is posted.
- **What a view costs D1.** The list reads one index entry per approved photo
  on the whole site, plus one row per album holding one. So at item 8's
  11,000 photos a list view reads about 11,000 rows, and D1's 5 million a day
  hold about 450 list views, fewer than item 2's 2,439 album views. An album
  page reads one row per approved photo in it, each grid or screen image one
  row by its id (item 2's 81 for 40 photos), and a full size one row plus one
  index entry per photo up to its place. *Reasoned from the queries and D1's
  rule that every row scanned counts, not measured with `meta.rows_read`.* If
  the list's reads ever bind first, the fix is a count kept on the album row,
  which is a migration.
- **The floor is lower for album pages**, ≥ 85 performance (owner,
  2026-09-30, during #157; Quality floor, below).

### 18. The policy

**Built in #159, 2026-09-30, with four owner decisions taken at its pickup,
one at its design review and five at its `review-fanout`.** `/policy`
(`public/policy.html`, a static page, so it costs no Function request) says
who sees a photo, who can send one, how each is checked, what the site keeps,
for how long, and how to have a photo taken down. Every page's footer links
it, and the share page links it beside the join step.

- **Every claim is traced to its source**, in a table in the page's head
  comment: the code or the decision that makes it true. A change to either is
  a change to the page. `test/policy.test.js` holds the page's figures (90
  days, an hour, 2,560 pixels, 500 a day) to the constants in
  `lib/session.js`, `functions/api/join.js` and `lib/photos.js`, so a change
  there fails until the page agrees.
- **The header has a nav: All albums and Who sees these photos** (owner, at
  the review). This **overruled** the recommendation, which was to keep the
  footer link and eyebrow and record "no nav". #157 had left the header
  without one until a second kind of page needed it, and the Quality floor
  names a real `<nav>`. It marks no `aria-current`, so all five header copies
  stay byte for byte the same, which three tests hold. Not chosen: marking
  the current page, which would need those tests to strip the attribute as
  the sailing site's hash check does. **Since 2026-10-01 the nav is All
  albums alone** (owner): the policy link sat in the header and the footer,
  and "it only needs to be in the footer". The nav stays, with its one link,
  because the Quality floor names a real `<nav>`.
- **The check is described, not promised as an outcome** (owner, at the
  review). The page says an admin turns down any photo they recognize as a
  sailor whose family opted out, and that a check can miss one, with the
  email as the route (and, since #158, "Remove this photo" before it). Not
  chosen: "a photo of a sailor whose family opted out
  is turned down", which approval cannot guarantee
  (cairn's `memory/projects/madcowsailing-photo-space-2026-09-26.md`: it
  "cannot see what it enforces"), and any admin can approve, not only the one
  who knows the list.
- **A takedown was done by hand until #158** (owner, at the review): README,
  Taking a photo down by hand, one `wrangler d1 execute` that set the row
  `hidden`, which the public routes already answered 404. `test/policy.test.js`
  ran that statement from README against the real schema. **#158 kept it
  as the fallback** (owner, at #158's review): an email takedown is the same
  button pressed by an admin (item 19), and the hand statement is for when
  the button is refused. #158 had first retired it, and its review found no
  route left past the limit or a 503.
- **The invite link is for parents, sailors and coaches** (owner, at pickup).
  Not chosen: parents and coaches, which the story proposed; parents only,
  D9's end state once coaches sign in through Access (#192).
- **Photos are kept with no set limit** (owner, at pickup). An approved photo
  stays until it is taken down. Not chosen: through the season, or a fixed
  number of years. Pages runs no scheduled job, so either needs a deletion
  story before the page can promise it.
- **Removal requests go to dave@madcowsailing.com** (owner, at pickup), the
  sailing site's address. Not chosen: the hq address, or a new photos@ alias.
  **The lede gives it**, as well as the section at the foot (owner, at the
  story's design review): the parent who wants a photo down is the one in a
  hurry, and the foot of the page sat about 3,400 px down at 360 px. Not
  chosen: moving the removal section first; leaving it last.
- **"Remove this photo" was #158's to name** (owner, at pickup). Until #158
  the page gave the email route only, so it was true on any release. Not
  chosen: naming the link then and holding the promotion until #158 shipped.
  **#158 carried a criterion for the page** (owner, at the review): the link,
  what a taken-down photo keeps (its copies, `hidden_at` and the free-text
  `hidden_note`, which 0005 already had, so 0005's row in the trace table did
  not change), and how long its rate limit keeps a scrambled address. Since
  #158 the page names the button first and the email second (item 19).
- **#192 changed the page**, because a coach sends through Access with no
  invite link: the lede, who can send, and what is kept for a coach,
  including the coaches' list and Cloudflare's record of each sign-in. The
  owner made it a criterion at #192's pickup. Its rows are in the head
  comment's trace and `test/policy.test.js`.
- **#219 put accounts on the page** (2026-10-05), before the request form
  (#220) takes its first request. So most of what the new sections describe
  is built by later stories of #216, and each claim's row in the trace names
  the story that builds it. Three owner decisions at pickup, all the
  recommendation:
  - **A deleted account's photos stay, and stop naming it**, approved or
    waiting: D17's rule for revoking, applied to a delete. To have them
    down too, the person presses "Remove this photo" or says so in the
    email. Not chosen: deleting every photo with the account, which takes
    good team photos down (D17's reason, for revoking); letting the person
    choose, which is two promises to build and hold.
  - **Deletion is asked for by email**, to dave@madcowsailing.com. No story
    deleted an account (#225 revokes), so #220 gained a criterion for a
    by-hand delete in README, run by a test against the real schema, and
    #225 one for the admin's delete. Not chosen: one new story; a by-hand
    delete with no button ever.
  - **An account, and a request for one, is kept until it is deleted**, with
    no set limit, as a photo is. That stays true whatever #221 does with a
    turned-down request and #225 with a revoked address. Not chosen:
    deleting a turned-down request at once; leaving the duration off.

  Six more at the story's `review-fanout` (2026-10-05), all the
  recommendation:
  - **The section opens as a condition**, "If you ask for an account … it
    keeps", so that it is true on a release before #220 builds the form,
    as #158 kept the page true on any release. Not chosen: holding every
    promotion until #220 (develop is promoted whole); accepting a release
    that describes a form not yet there.
  - **The admins' log names the person, and keeps its entries after a
    delete**, and the page says so. #221 logs who, what, whom and when, and
    #225 logs the delete. Not chosen: a delete that scrubs the log, which
    loses who was approved or revoked; deciding at #221.
  - **A delete is confirmed by a reply to the account's own address**,
    since a delete cannot be undone and a request can come from anyone. Not
    chosen: trusting the From address; the admin's judgement.
  - **A revoked account's address stays as a keyed hash after a delete**,
    so a revoke survives it (#225's criterion 4), as the join and takedown
    limits keep theirs. Not chosen: a delete that lifts the revoke; refusing
    to delete a revoked account.
  - **The page names the database's restore points**: D1 Time Travel is
    always on, 7 days on Free and 30 on Workers Paid (D1's limits page, read
    that day), so a deleted account stays restorable for up to 30 days. Not
    chosen: "7 days", which goes false with Workers Paid; leaving it to a
    later story. "A photo that is turned down is deleted for good" has the
    same gap for its row, and was left as it is.
  - **#220 to #224 each carry a `/policy` criterion for the records they
    add** (the request's time, the session cookie, token and code hashes,
    failed sign-in counts, the per-account daily count, the request limit),
    and #223's also covers the lede and "Who can send a photo". Not chosen:
    naming them all now, ahead of their code; leaving them to #226.

  The page names Turnstile and Resend and what each sees, from Cloudflare's
  Turnstile Privacy Addendum (last updated 2025-06-18), Turnstile's docs
  ("does not access ... form entries") and Resend's pricing (Free keeps 30
  days), all read that day. **"Nothing kept with a photo names who sent it"
  now covers the invite link and the coaches only**, and the page says a
  photo sent from an account names the account (D17). **The sentence about
  matching a coach's send time to Cloudflare's sign-in record stays until
  the cutover, #226**, which removes it with the coaches' sign-in.
- **The scrambled address counts for an hour and has no upper bound.** It is
  deleted by the first join after it is an hour old (item 11), and in the
  off-season that can be months. The page says exactly that. *(This bullet
  said "kept about an hour" until the review, and so did the pickup comment,
  which was corrected on the issue.)* The story's criterion asked for "a
  stated number of days", written before #150 set the window. Not chosen: a
  delete on a busier route to make a real bound, which spends D1 writes on
  public requests against item 2's arithmetic.
- **A removal names the photo by its link or the file, never its number.** A
  download's `<nnn>` is the photo's place at download time, which moves as
  earlier-taken photos are approved (the review's finding).
- **The page lists what the story's list left out**: when a photo was sent,
  which invite link and session it came through (0005), and the daily count
  per phone (`upload_counts`). Leaving them out would make a list headed "what
  the site keeps" wrong.
- **"One of the site's admins" checks a photo, not "the owner"**, since item
  12 lets every address in `ADMIN_EMAILS` approve.
- **A header or footer change is five copies**: `public/404.html`,
  `public/policy.html`, `public/share/index.html`, `templates/page.html` and
  `lib/admin-page.js`. `test/site.test.js`, `test/admin-page.test.js` and
  `test/public.test.js` fail until they agree, and `test/policy.test.js` until
  each footer links `/policy` and each nav holds All albums alone.

### 19. Remove this photo

**Built in #158, 2026-09-30, with four owner decisions taken at its pickup
and two at its review.**
"Remove this photo" sits under every photo on an album page, and anyone may
press it (epic #147, D7). The photo is hidden from everyone at once and waits
on `/admin/removals` until an admin puts it back or deletes it.
`lib/removals.js` holds the rules, `functions/api/remove.js` takes a photo
down, and `functions/remove.js` asks first for a browser without JavaScript.

- **10 takedowns an hour from one network address, and only a takedown that
  hid a photo counts** (owner, at pickup, confirming the story's figure). The
  address is the keyed hash item 11's join limit uses, IPv6 by its /64, in
  `removal_requests` (migration 0006). A request naming a photo that is not
  public is 404 and writes nothing, so a wrong id costs no D1 write. Not
  chosen: counting every request, 404s included, which is a write per bad
  request, the cost #177 budgets on the join route; 5 an hour; 20 an hour.
  The limit is read first, so an address past it is 429 whatever it names.
- **Two takedowns at once cannot both take an address's tenth.** One
  statement counts the hour and inserts the row together, and only then is
  the photo hidden, by a statement that finds it still approved. If another
  takedown got there first, or that statement throws, the row is deleted
  again, so a unit is spent only by a photo hidden. Once the photo is hidden
  the answer is a 303, whatever fails after it: the album lookup failing
  sends the browser to the list. The review of #158 found both: a throw kept
  the unit, and a failed lookup answered 503 "Nothing was changed" for a
  hidden photo.
- **A row over an hour old is deleted by the next takedown, and by every load
  of `/admin` and `/admin/removals`** (owner, at #158's review), never by a
  refusal. So a scrambled address is kept no longer than the next admin
  visit. Pages runs no scheduled job, and the next takedown alone could keep
  one for months, which the review escalated against criterion 3's "a keyed
  hash that expires". A load with nothing expired writes no row. Not chosen:
  the next takedown alone, with the criterion annotated; every request,
  refusals included, which reverses the pickup's no-write rule.
- **README keeps the hand takedown as the fallback** (owner, at #158's
  review): README, Taking a photo down by hand, for when the button is
  refused, by the limit on an admin's own network or a 503.
  `test/policy.test.js` runs its statement against the schema. Not chosen: an
  admin take-down press behind Access with no limit; rewording the 429 and 503
  pages; accepting the hour's wait.
- **Without JavaScript, the button opens a page that asks first** (owner, at
  pickup). Each photo's button is a form posting its id to `/remove`, which
  answers the dialog's words, the photo, the note and a "Remove it" button.
  `public/js/remove.js` opens the album page's native `<dialog>` instead.
  Both end in one `POST /api/remove`. Not chosen: a post that hides at once,
  which gives a reader without JavaScript no note and lets a stray tap hide a
  photo until an admin puts it back.
- **The button sits under each photo in the grid, beside Download, and not in
  the lightbox** (owner, at pickup), so `shared/js/gallery.js` stays as the
  sailing site's trip logs have it. Not chosen: the lightbox as well.
- **After a takedown the browser goes back to the album**, with `?removed`
  showing one fixed sentence, or to the list when the album has nothing
  public left, since its page is then the site's 404. The address bar can
  show only that sentence.
- **The note is at most 500 characters, and a longer one is cut, not
  refused.** The takedown matters more than the note. The field's
  `maxlength` counts UTF-16 units in every current browser, so it is never
  looser than the server. WebKit counted a whole emoji as one until
  260838@main (bug 252900, 2023-02-25), so an older Safari can send a longer
  note, which is cut; with some 220 family emoji it can pass the form's 16 KiB,
  and then the whole form reads empty and the takedown is refused as naming
  nothing. The review of #158 corrected "WebKit counts whole symbols", which
  this line said first. A note keeps its line breaks, and every other control
  character becomes a space.
- **Download is a 24 px target since #158.** "Remove this photo" sits 3 px
  under it, which took away the spacing the 16 px link passed WCAG 2.5.8 on;
  `.download` now has the button's box. `ux-design`'s audit found it (axe
  `target-size` ×6, 0 on the same page without the remove forms).
- **"Put it back" keeps when the photo was hidden and the note** (owner, at
  pickup), as a record; a later takedown writes over both. `/policy` says a
  note stays with the photo until it is deleted. Not chosen: clearing both.
- **"Delete permanently" deletes the row, then its three objects**, as a
  reject does (item 16), so no row names objects that are gone. A bucket that
  refuses leaves objects the log names by their `photos/<key>/` prefix. It is
  confirmed in a native `<dialog>`, and needs JavaScript, as rejecting does.
- **The dialog says "one of the site's admins" reviews it, not "the site's
  owner"** as the criterion was written, for item 18's reason.
- **The admin home counts the hidden photos** as removal requests waiting,
  photos only: every statement names `kind = 'photo'`, and clips wait for
  #198.
- **Anyone can hide every photo from enough addresses.** Ten an hour per
  address stops one person, not a crowd of IPv6 /64s, and "Put it back" is
  one photo at a time. D7 accepts that anyone can hide a photo; this is that
  cost at its largest, and nothing past the per-address limit is built.

### 20. The coach sign-in

**Built in #192, 2026-10-01, with four owner decisions taken at its pickup
and four at its review.**
A Hoover JRT coach opens `/coach`, signs in through Cloudflare Access, and
lands on the share page able to send, having typed and followed no code
(epic #147, D9). `functions/coach/` holds the route, `requireCoach` in
`lib/access.js` the guard, and `lib/session.js` the coach's session.

- **The admin guard's check, run against a second list.** `requireCoach` is
  `requireOwner`'s token check (item 12) with the coaches' AUD tag,
  `ACCESS_COACH_AUD`, and their list, `COACH_EMAILS`, so it refuses every
  token #151's list refuses, on every hostname, `*.pages.dev` included.
  `test/coach.test.js` runs that list at `/coach`, and `test/guard.test.js`
  holds every route under `functions/coach/` to the guard.
- **A separate Access application**, `madcowphotos coach`, covering
  `photos.madcowsailing.com/coach` and `/coach/*`, because Access's `/coach/*`
  does not match `/coach`. Not chosen: adding those paths to the admin
  application. Access applies a policy to a whole application, so a coach
  would then pass Access's sign-in into `/admin`, with the code's 403 the
  only thing stopping them. Its tag differs from the admin one's, so a token
  signed for either never passes the other's check. On a preview, the Pages
  preview application signs every path, so there the two tags are equal and
  the lists alone tell admin from coach. README, The photo site, has the
  application, its policy and the four places a new coach goes.
- **The session names the coach by a keyed hash, never the address.** The
  cookie is `__Host-upload=c1.<coach>.<issued>.<signature>`, where `<coach>`
  is an HMAC of the address keyed with `SESSION_SIGNING_KEY`. Every upload
  request hashes each address on `COACH_EMAILS` again and refuses a session
  whose hash is not among them, so taking a coach off the list ends their
  session at its next request (criterion 5), with no table and no D1 write.
  The list is short: each coach is a Zero Trust seat. Not chosen: the
  address in the cookie, which `/policy` would then have to own as kept; a
  coaches table, which is a migration for what a secret already holds.
- **A rotation leaves a coach's session alone** (owner, at pickup). It
  exists for a leaked parent link, and a coach is removed by the list. So
  rotating ends every *parent* session, and the rotate dialog, item 11 and
  README say so.
- **A coach sends when no invite code exists** (owner, at #192's review,
  under D9). This reverses #152's "uploads stay closed until a code exists"
  for coaches only, so the `/admin/code` no-code panel, README, the code
  page's header and the albums guard's comment now say no *parent* can send.
  Not chosen: closing coach uploads too, one more D1 read per request.
- **Opening the invite link keeps a coach's session** (owner, at #192's
  review). The two share one cookie name, so `POST /api/join` answers a
  request already carrying a listed coach's session with 204 and no
  Set-Cookie, whatever code it presents, before reading the database.
  Without that, a coach who opened the link became a parent: their photos
  lost the marker, and the next rotation ended their sending. A coach off
  the list joins like anyone else. Not chosen: a second cookie name, a wider
  change to the guard and its tests.
- **A coach's session lasts 90 days**, as a parent's does, and is capped at
  500 uploads a UTC day, counted in `upload_counts` under
  `coach.<coach>.<issued>`, a key no parent's can take.
- **What a coach's upload records.** `sender` is `coach`, and
  `code_generation` and `session_issued` are both empty (item 14's column,
  written here). The sign-in time is left out on purpose (owner, at #192's
  review): it sits beside the coach's address in Cloudflare's Access log,
  and `upload_counts`' key carries it too, so keeping it would name which
  coach sent each photo. `sent_at` still allows a match by time against that
  log, and `/policy` says so. It waits for approval like any other upload
  (D10), and the queue says "sent by a coach" (item 16).
- **The share page links `/coach`** beside the invite-link wording (#192's
  review), since every message there is about a link a coach does not hold.
- **`/coach` is a GET that sets a cookie**, because it is where Access sends
  the browser back after the sign-in. Another site making a coach's browser
  load it only gives that coach a fresh session of their own. It answers 303
  to `/share/`, which asks `GET /api/upload/session` as it does for a
  returning parent, and 503 with no cookie when `SESSION_SIGNING_KEY` is
  missing.
- **`/policy` says it** (owner, at pickup; item 18): who can send, what is
  kept for a coach, that only the owner can change the coaches' list (a
  Pages secret and an Access policy, so in Cloudflare's dashboard), and that
  Cloudflare records each sign-in with the email address and network
  address, which its Access authentication logs do ("each login attempt",
  read 2026-10-01), so a photo's send time could be matched to a sign-in.
- **The coach list started with the owner's address only** (owner, at
  pickup), so `/coach` can be read end to end. Real coaches are added by
  README's steps.

### 21. Email: Resend, from photos.madcowsailing.com

**Built in #217, 2026-10-01, the first story of epic #216.** Every later
story of that epic sends mail: approval, the sign-in code, a reset, new
requests. `lib/mail.js` is the one way the site sends, and README, The photo
site, Email, is the operating record: the account, the domain, the records
and how to replace the key.

- **Resend, on an account of its own** (owner, 2026-10-01, before pickup).
  It is not the login holding Taskr's and Tender's domains, so the free
  quota is this site's alone; Resend documents its rate limit as per team
  but does not say whether the daily quota is, which is why this is a
  separate account and not a second team. Signed in with email and password
  and MFA, since Google or GitHub would have landed on the existing account.
  Not chosen: comparing Cloudflare Email Sending first, a Workers Paid beta
  whose effect on the Zoho MX was untested, and which would have made this
  story wait on #218.
- **From `no-reply@photos.madcowsailing.com`, Reply-To
  `dave@madcowsailing.com`** (owner, 2026-10-01). The per-app subdomain
  matches Taskr's and Tender's, and keeps the site's sending reputation away
  from the owner's Zoho mail at the apex. Not chosen: the apex; a shared
  `mail.madcowsailing.com`.
- **One `fetch` and no library**, the Stack rule. A POST to
  `https://api.resend.com/emails` with the key as a bearer token, JSON, and a
  `User-Agent`. Resend refuses a request without one, 403 (its API
  introduction, read 2026-10-01). Node's `fetch` adds one and workerd's adds
  none: under `wrangler pages dev`, a send with the line removed reached a
  local echo server with no `User-Agent` header, and with it, with the site's
  (measured on #217). So a test under Node would pass while every real send
  was refused; `test/mail.test.js` requires the header. Against Resend itself
  with a deliberately invalid key, both forms answered 401
  `validation_error`, so Resend checks the key first and the 403 itself was
  not seen. A send waits 10 seconds at most.
- **`sendMail()` never throws**: it answers sent, or one reason
  (`not-configured`, `address`, `message`, `quota`, `rate`, `refused`,
  `unreachable`), and the caller says what the person sees. It takes one
  plain address and nothing else, so a typed list, a display name or a line
  break never reaches Resend.
- **The log holds the reason, Resend's status and its error name.** Never
  the address, the subject, the text, or Resend's own message, which for an
  unverified sender quotes an address. `test/mail.test.js` plants each and
  reads every console line for them, with a control showing the reading
  works; `test/logging.test.js` refuses a logging call handed `to`,
  `subject`, `html` or `reply_to` (criterion 6).
- **No DMARC record of its own** (owner, at pickup). The org record,
  `_dmarc.madcowsailing.com`, covers the subdomain by fallback with its
  reports. Not chosen: `_dmarc.photos` with the reports copied, which needs a
  second authorisation record in madcowhq.com for no change of policy; or
  without them, which would drop this mail's reports, since a subdomain
  record replaces the org one rather than adding to it.
- **Receiving off, so no MX.** Resend's add-domain page now offers an MX for
  receiving, and received mail counts toward the same 100 a day, so an MX
  would let anyone spend the site's sends. **Tracking off**: click tracking
  would send every sign-in and reset link through Resend's redirect.
- **The test send is a page, `/admin/mail`** (owner, at pickup): a form,
  starting with the admin's own address, that sends a fixed message naming
  the environment. It stays as the check after any change to the key, the
  domain or the DNS. Not chosen: a button that sends to the admin only,
  which could not reach a Gmail inbox from an admin whose address is not
  one; and no route, which would have left the key and domain unproven until
  #220. The address never travels in the redirect's query.
- **One key, both environments**, scoped to Sending access for
  `photos.madcowsailing.com`. Criterion 3 names one key; a second per
  environment would separate their logs in Resend at the cost of a second
  paste. The key went from Resend's copy button into each environment's
  secret by the owner's paste and is in no file, chat or issue.
- **Resend keeps each email 30 days** (Free plan data retention,
  resend.com/pricing, read 2026-10-01), recipient and content included.
  `/policy` names it since #219 (item 18), read again on 2026-10-05.

### 22. The installed app

**Built in #193, 2026-10-01, with four owner decisions taken at its
pickup and four at its review.** The share page installs to a phone's home
screen as "Mad Cow photos", and on Android the installed app is listed in
the Share menu for photos (epic #147, D9). `public/manifest.webmanifest`
names it, `public/share/sw.js` takes a share, and `js/share.js` offers the
shared photos in its list. On an iPhone it should install and do nothing
more: Safari has no Share-menu entry for a web app (WebKit bug 194593), so
there the photos are chosen in the page, which says so. *No iPhone reading
was taken*; #210 carries it (owner, at #193's review), with one question it
must answer: a Home Screen app on iOS keeps its cookies apart from Safari,
and an invite link opens in Safari, so a parent's installed app may never
hold a session (reasoned, from cairn's
`pwa-install-offer-android-prompt-ios-copy` note).

- **The share page is the app.** `start_url` and `id` are `/share/`, `scope`
  is `/`, `display` is `standalone`, and only the share page links the
  manifest, so no other page offers to install it. Its colours are `--hull`.
- **The icon is the `--blue` mark on `--chalk`** (owner, at pickup), labelled
  "Mad Cow photos". Not chosen: the white mark on `--blue`, or on `--deep`.
  `tools/app_icons.py` renders all four PNGs from
  `shared/img/madcow-mark.svg` with `trace_logo.py`'s own fill, reading the
  colours from `tokens.css`. The maskable one keeps the mark's farthest point
  at 92% of the safe zone's radius (40% of the width), and an iPhone's icon is
  the same opaque composition, since an iPhone fills a transparent icon with
  black. `test/app.test.js` decodes each PNG and holds the sizes, colours and
  safe zone, and the 512 px icon to the shared mark itself.
- **The worker answers one request: the share target's POST to
  `/share/receive`.** It puts the shared files in this phone's IndexedDB
  (`madcow-shared`), one record per file, and answers 303 to `/share/?shared`,
  or `?shared=empty` when the share carried no photo it could read, or
  `?shared=failed` when it could not keep them. Every other request
  goes to the network as if no worker were installed: it calls `respondWith`
  for nothing else and holds no Cache Storage. That keeps a takedown's next
  request (item 3) and a deploy's next open (below). `test/sw.test.js` runs its
  handler over every kind of request, and re-runs #158's takedown with it
  installed. Not chosen: precaching the page for offline use, which would keep
  a removed photo or old code (cairn's
  `vite-plugin-pwa-autoupdate-ships-no-reload` records the second); receiving
  the share on the server, which would send the phone's originals, location
  and all, before the page strips them.
- **Its scope is `/share/`**, the folder it is served from, so it can never
  control `/`, an album page, a photo, `/policy` or `/admin`. Measured in
  Chrome 154: an album page reads no controller, and every response on the
  share page reads `fromServiceWorker: false`.
- **Who may start a share** (#193's security audit and review). Android's
  Share menu sends `Origin: null` (*measured* on the owner's Samsung, Chrome
  154), and a form on the site sends the site's own origin; the worker reads
  `Origin` but never `Sec-Fetch-Site`, which is added after it runs. So it
  refuses a share whose `Origin` is another site's, unread, and answers 303 to
  `/share/`: otherwise any page could put photos on the share page as if the
  sender had shared them. A sandboxed frame can also send `null`, so that
  route stays open, with the sender's own Send and an admin's approval in
  front of it. Not chosen: refusing `null`, which would refuse every real
  share; labelling shared photos in the list.
- **Shared photos wait on the phone for a session** (owner, at pickup, for
  criterion 3). With no session the page says how many are waiting and to
  open the invite link or sign in as a coach; once a session exists they go
  into the list, ready to send. Not chosen: going straight to `/coach`, which
  sends a parent whose invite has ended to an Access sign-in that refuses
  them; not keeping them, so the coach shares again after every ended session.
- **Each stays in storage until it is sent or removed** (owner, at #193's
  review). The page deletes a file's record when its upload answers 201 or
  the sender presses Remove, so a reload, an ended session or a second share
  before Send offers it again. Not chosen: deleting a record when the page
  lists it, which the first build did and which lost the first batch when a
  second share arrived (*measured* on the phone); a leave-page prompt for
  unsent photos. **A record over a day old is never offered, and is deleted
  the next time the store is opened**, by the page or by a new share. Nothing
  deletes it sooner, since Pages runs no scheduled job, so a share to an app
  never opened again stays on the phone until it is. `/policy` says so (owner,
  at #193's review), in "What the site keeps".
- **Photos only until #198** (owner, at pickup). The share target accepts
  `image/*`, so the Share menu lists the app only when photos are chosen.
  #198 carries the criterion to add `video/*` once a clip can be sent.
- **`/share/receive` is also a Function**, for a share that reaches the
  server because no worker is there to take it (site data cleared while the
  app stayed on the home screen). Pages answers a POST to a static path with
  an empty `405` (measured on `madcowphotos.pages.dev`, 2026-10-01), which a
  phone shows as a blank page. The Function reads no body and answers 303 to
  `/share/?shared=failed`, which says to share again; loading the page
  registers the worker again.
- **A deploy reaches an installed app the next time it opens.** The page is
  never answered from a copy, a new worker takes over at once (`skipWaiting`,
  `clients.claim`), and the page registers it with `updateViaCache: 'none'`,
  which is what fetches the worker past the browser's cache. `_headers` gives
  the manifest and the worker `max-age=0` as well, but on
  photos.madcowsailing.com the zone raises a file type it caches to
  `max-age=14400` whatever `_headers` says (*measured* on `/js/share.js`,
  2026-10-01), so those rules are belt and braces, not the lock; step 9 of
  #193 reads both on the domain. *Measured on the owner's Samsung (Chrome
  154), with the app installed from a local server:* after a deploy and a
  fresh open, the page and the worker both ran the new build. An app left
  open keeps its page until it navigates, as any open page does.
- **What a share delivers depends on the app sharing.** *Measured on the same
  phone:* Samsung Gallery's own Share (one photo), the system share list (one
  photo) and My Files (six photos, `SEND_MULTIPLE`) each arrived with every
  file, named and sized. A share from Chrome itself (Web Share, one photo or
  six) arrived as a form with no files, so the worker answers `?shared=empty`
  and the page says to share from the gallery or Files app instead. Google
  Photos was not read.
- **The floor holds with the worker installed.** Through `tools/h2proxy.mjs`,
  with the worker registered before and after each run and only the HTTP
  cache cleared, the share page read 99, 98 and 99, accessibility 100, and
  after the review's changes 96, 95 and 99, then 98, 98 and 98. With
  Lighthouse's storage reset, which removes the worker, it read 98, 98 and 99,
  then 97, 98 and 98. The one 95 came in the first batch after the proxy was
  restarted, and the batches either side of it read 98.

### 23. Password hashing: scrypt, from the runtime's node:crypto

**Chosen in #218, 2026-10-02, before any story stores a password** (epic
#216, D14). `lib/password.js` is the one place a password is hashed or
checked. Nothing calls it yet: #222's sign-in and reset and #224's admin
sign-in will.

**What a Pages Function can run without a library**, read 2026-10-02:

| Function | Where | The limit the runtime puts on it |
|---|---|---|
| PBKDF2 (SHA-1, -256, -384, -512) | Web Crypto, `deriveBits` / `deriveKey` | **refuses more than 100,000 iterations** |
| HKDF | Web Crypto | none read; it has no work factor, so it is not a password hash |
| `pbkdf2` | `node:crypto` | the same 100,000 |
| `scrypt` | `node:crypto` | **refuses N·r·p above 2^20**; memory 128·r·(N + p + 2) bytes (its table plus one block per lane), inside the isolate's 128 MB |
| `argon2` | `node:crypto` | "not supported" |

Cloudflare's [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
page lists PBKDF2 and HKDF as fully supported and names no limit. Its
[`node:crypto`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
page (updated 2026-08-12) says every API is supported except a short list
that includes *"`argon2` and `argon2Sync` are not supported"*, and that a
`compatibility_date` of 2026-08-04 or later turns `nodejs_compat` on by
default. This project's date is 2026-09-25, and `wrangler.jsonc` names the
flag anyway, for the reason its comment gives. **Neither page names the two
limits.** They are in workerd's source, `src/workerd/io/limit-enforcer.h`
(`DEFAULT_MAX_PBKDF2_ITERATIONS = 100'000`, `DEFAULT_MAX_SCRYPT_COST = 1u <<
20`, the second added 2026-05-15 as "Cap scrypt work parameters to prevent CPU
limit bypass"), which both the Web Crypto and the `node:crypto` paths call.
The [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
page gives the memory: 128 MB per isolate, shared by its concurrent requests.

**Local wrangler lifts the PBKDF2 limit and keeps scrypt's.** workerd's own
server overrides the iteration check (*"No limit on the number of iterations
in workerd"*). *Measured* in workerd from wrangler 4.141.0 on 2026-10-02: one
step past each limit, 100,001 iterations read `accepted` from both PBKDF2s,
and scrypt read `refused: Scrypt failed: cost exceeds maximum (1048576).` So a
local run passes a PBKDF2 count that Cloudflare, by its source, refuses. The
deployed reading is the probe's `?run=over-cap` (below), recorded here once
taken.

- **scrypt, at N=2^14, r=8, p=5.** The [OWASP Password Storage Cheat
  Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  (read 2026-10-02; its numbers last changed 2026-06-24): *"Use Argon2id
  with a minimum configuration of 19 MiB of memory, an iteration count of 2,
  and 1 degree of parallelism. If Argon2id is not available, use scrypt with
  a minimum CPU/memory cost parameter of (2^17), a minimum block size of 8
  (1024 bytes), and a parallelization parameter of 1."* It lists five scrypt
  rows that *"provide a similar minimal level of defense"*, from N=2^17, p=1
  to N=2^13, p=10, all with r=8. Argon2id is not in the runtime, so scrypt is
  the strongest function it carries.
- **Not PBKDF2.** OWASP asks *"PBKDF2-HMAC-SHA256: 600,000 iterations"* and
  *"PBKDF2-HMAC-SHA512: 220,000 iterations"*, and the runtime stops at
  100,000, so PBKDF2 here is a weaker setting, which D14 rules out. Not
  chosen either: Argon2id or bcrypt in WebAssembly or in JS (a library, or
  hand-written crypto under the no-library rule, and slower than the native
  code); chaining PBKDF2 calls past the limit (not PBKDF2, so no published
  vector can check it).
- **Why the N=2^14 row.** N=2^17 needs 128 MiB, the whole isolate. N=2^16
  needs 64 MiB, so two sign-ins at once would fill it. Of the three left,
  N=2^15, p=3 costs the most CPU, and N=2^13, p=10 costs the same CPU as
  N=2^14, p=5 with half the memory, which is the part of scrypt a cracking
  rig pays for. *Measured* in Node 24.19 on this machine, median of 7:
  N=2^13 p=10 168.5 ms, N=2^14 p=5 170.7 ms, N=2^15 p=3 200.6 ms, N=2^16 p=2
  273.2 ms; PBKDF2-SHA256 at 100,000 42.3 ms and at 600,000 257.2 ms. One
  hash took 218 ms of wall time in local workerd.
- **A stored hash is a PHC string**, `$scrypt$ln=14,r=8,p=5$<salt>$<hash>`,
  16 random bytes of salt and 32 of hash, in unpadded base64. It names its own
  parameters, so raising them later leaves older hashes verifiable.
  `verifyPassword()` reads them from the string and refuses, unread, a string
  naming an N·r·p past 2^20, more than 32 MiB counted as 128·r·(N + p + 2),
  or an N of 2^(16r) or more. The last is RFC 7914's own rule, and the first
  draft missed it and the lane term; `review-fanout` found both. scrypt
  refuses either itself, and *measured* in local workerd on 2026-10-03 it does
  so with a plain `Error: Scrypt failed`, no code, so a check after the fact
  could not tell it from an outage. With the rules in front, `ln=16,r=1`,
  `ln=1,r=999,p=524` and `ln=1,r=512,p=999` each answered false there. It
  compares with `timingSafeEqual`, and answers false, never an error, for a
  string it could not have written. Nothing in it logs.
- **The password goes in as the UTF-8 it arrives as.** Normalising it, its
  minimum and maximum length, and a breached-password check are #222's, under
  NIST SP 800-63B (its first criterion).
- **Tests**: `test/password.test.js` runs RFC 7914's scrypt vectors 1–3
  (section 12, read 2026-10-02) through `derive()`; the fourth needs N·r·p of
  2^23 and 1 GiB, past the runtime's limit. OWASP's row is written out in the
  test, not read from `SCRYPT`, and each stored hash is recomputed from its own
  salt with `node:crypto` directly, so a changed cost or salt fails it. A
  non-ASCII password is recomputed from its UTF-8, and its decomposed form
  must not verify. Each bound is held by real hashes either side of it:
  r=255 and N=2^10 at p=2, 512 bytes under 32 MiB, verifies, and at p=3,
  32,128 over, is refused. At r=1, N=2^15 verifies. A hash cut short at its
  end is refused.
- **The CPU is read on the develop preview with `/api/admin/password-probe`**,
  behind the admin guard, and 404 on production. `?run=hash` makes one hash at
  `SCRYPT`, which is what a sign-in or a new password costs, and answers the
  string it made. That string verifies in Node against the probe's fixed
  password, so the deployed scrypt can be checked against Node's in full.
  *Measured* against local workerd on 2026-10-03: a hash it made verified in
  Node, all 32 bytes, and a wrong password did not. `?run=none` is the
  control, and `?run=over-cap` reports each function's answer one step
  past its limit. #161's method reads it (item 8), and a minute counts only
  with 0 errors and its `sampleInterval` written beside it (README). The
  preview builds from `develop` only, so the reading follows this item's
  merge, and item 8 holds it.
- **Workers Paid if it does not fit** (D14, pre-approved): the free plan
  allows 10 ms of CPU a request. The local figures above put one hash near
  170 ms, which predicts it will not fit. Predicted, not yet measured on
  Cloudflare.

### 24. Accounts and the COHSSA section: the 2026-10-01 decisions

**Taken by the owner on 2026-10-01 through the question tool, before any
story under them was drafted, and recorded here in #194 (2026-10-05).** Epic
#216 (accounts) carries D13–D18, and epic #191 (the COHSSA section) the
rest. Each names the option recommended that day and the options not taken;
the questions and the reasoning shown with them are in cairn's
`memory/projects/madcowsailing-photo-space-2026-09-26.md`. Three went
against the recommendation: the password (D14), public COHSSA viewing, and
COHSSA's consent basis. They supersede four earlier decisions on #147: A4
(no parent accounts), D3 (Access on `/admin`, item 12), D9's Access sign-in
for coaches (item 20) and D12's COHSSA copy. Items 11, 12 and 20 still
describe production until the cutover, #226.

- **D13. Accounts replace every way in, on both teams** (the
  recommendation). A parent, coach or other person asks for an account, and
  the owner approves it. The invite link (#150, #152; item 11) and the
  coaches' Access sign-in (#192; item 20) retire at #226, once accounts work
  on production, and today's admins and coaches get set-password emails
  then. Not chosen: accounts for COHSSA only; accounts with the link kept
  for one-off events.
- **D14. Email and password, against the recommendation** of an emailed
  sign-in link with no password. Not chosen either: Google sign-in plus an
  emailed link. The case made for the link: a password still needs a reset
  by email, so the inbox is the key either way; a password hash spends CPU
  against the free plan's 10 ms a request; and it is hand-written security
  code under the vanilla-JS rule, the reason a password was turned down for
  `/admin` on 2026-09-26. A forgotten password resets by emailed link (a
  default, shown and not asked). The hash is measured on Cloudflare before
  any password is stored, and the account moves to Workers Paid ($5 a month)
  if it does not fit, which the owner approved in advance. Not chosen: a
  weaker hash to stay free; measuring and then stopping to ask. Item 23 has
  the hash.
- **D15. Admin is a role on the same sign-in** (the recommendation), with a
  6-digit code emailed at each sign-in and sessions of 12 hours at most. The
  owner adds and removes admins from `/admin` (#224). Not chosen: Access kept
  in front of `/admin`, with adding an admin left a dashboard edit; the site
  rewriting the Access policy through an API token, which would put a token
  that can open the admin door on the site; a password alone; an
  authenticator app, which is hand-written TOTP plus a lost-phone recovery
  path.
- **D16. An account is approved per team** (the recommendation), and sends
  only to that team's events. Not chosen: one approval that sends anywhere.
  The role is the one the requester picks, editable at approval, and a coach
  keeps D11's 15-minute clips while everyone else keeps 3 (defaults, shown
  and not asked).
- **D17. Each photo records the account that sent it, seen by admins only**
  (the recommendation). This ends the anonymity #192 built (item 20), so
  `/policy` says so (#219). Revoking a person keeps their approved photos,
  and one action hides everything they sent (#225). Not chosen: anonymous
  uploads, which leave a revoked sender's photos unfindable as a group;
  revoking that hides everything, which takes a departing coach's good
  photos down too.
- **D18. No sailor data on the site** (the recommendation). The request form
  asks no sailor's name, and a later link from coaches-dockbox carries links
  and opt-out flags only. Not chosen: carrying the attendance app's rule on
  name, school and graduation year over; deciding at integration time.
- **COHSSA is a section of this site** (the recommendation), superseding
  the copy D12 chose on 2026-09-28. With one sign-in and one admin area, the
  copy's reason, separate queues and codes, is gone. Each album belongs to a
  team, and each team's section lists its own (#227). Not chosen: the copy as
  filed under #191; a separate address served by this site with shared
  accounts. #195 and #196 closed with it.
- **COHSSA photos are public once approved, from the start, against the
  recommendation** of members-only viewing until a COHSSA release was
  recorded. Not chosen: members only, always.
- **COHSSA's consent rests on a COHSSA-wide release, against the
  recommendation** of each school's release plus each coach's opt-out list.
  Not chosen: the owner's judgement plus takedown. Nothing on 2026-10-01
  confirmed that such a release existed, so no COHSSA photo is approved until
  its wording is recorded here and on `/policy` (#191's end state).
  **Confirmed by the owner on 2026-10-05 (#194):** the release is part of
  COHSSA's season registration, COHSSA issues it, and it covers photos
  published online. It has no opt-out, so unlike Hoover's (item 18) there is
  no per-family list for an admin to check a COHSSA photo against. **Its
  exact wording is not recorded yet.** #238 records it here word for word
  and puts it on `/policy`, and no COHSSA photo is approved until then.
- **The section shows COHSSA's name as text, with no COHSSA logo** unless
  COHSSA's permission is recorded here (a default, confirmed on 2026-10-05).
  None was recorded that day.
- **The COHSSA section's admins are the site's admins** (a default,
  confirmed on 2026-10-05). D15's admin role has no team, so every admin
  approves for both teams. Not chosen: a COHSSA person approving COHSSA's
  photos, which needs a team-scoped admin role that nothing has built.

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

**Nav:** `apps · logs · photos · about` — photos is
https://photos.madcowsailing.com/ (D6 on epic #147: linked from this nav, never
indexed). It is an absolute link, so linkcheck never reads it; `grep -c
'href="https://photos.madcowsailing.com/"'` over every sailing page and both
`tools/templates/` files is the check (#160).

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

**Album pages on the photo site are held to ≥ 85 performance, by owner
decision (2026-09-30, #157).** Through the proxy, an album of 44 approved
photos (sent through the share page from 44 trip-log photos), with its first 5
photos eager, read 87, 84 and 88 (median 87), with accessibility 100. With
every photo blocked it read 96, 96 and 96, with the web fonts blocked 93, 93
and 94, and with both 99, 99 and 98. So the photos on the first screen are
what cost, as on the trip pages (#53). No loading change reached 95 in that
batch: fewer eager photos, one at high priority and no font preloads read
between 76 and 93. The decision was taken on those readings. As shipped, with
only the first row at every width eager (2 photos, item 17), the page read 90,
91, 91, 91 and 91 (median 91), accessibility 100. The album list at `/` reads
96, 96 and 96 and is held to 95. The evidence is on #157 and its PR, and
production is read at its step 9. Ask again if a change takes an album page
below 85.

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
