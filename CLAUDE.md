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
home page, #152 the admin page where the code was created and rotated,
#153 the albums the owner keeps for each regatta and practice, #154 the
upload API, which stores each photo's three JPEGs with their metadata removed,
waiting for approval, #155 the share page that makes those JPEGs on the
phone and sends them, #156 the queue where the owner approves or rejects
them, #157 the public album list and album pages, which replaced the
holding page at `/`, #159 the policy at `/policy`, which every page's
footer links, #158 "Remove this photo", which hides a photo at once
and queues it on `/admin/removals`, #192 the coach sign-in at `/coach`,
which opened an upload session through Access with no invite link, and #193
the installed app: the share page installs to a phone's home screen, and on
Android it takes photos from the Share menu. Those are epic #147's. **Epic #216 (accounts) replaced the invite link and the
coaches' Access sign-in** with email-and-password accounts the owner
approves, and retired both at its cutover, #226. Its first story, #217, is
the email the site sends through Resend, with a test send at `/admin/mail`,
and #218 chose the password hash every account will use: scrypt, in
`photos/lib/password.js`. One hash takes far more than the free plan's 10 ms
of CPU, so the account is on Workers Paid since 2026-10-05. #220 built the
request form at `/ask`, behind Turnstile, which the share page and an old
invite link point to since #226 (item 25), and #221 the page where admins approve each request per team,
`/admin/people`, which emails a link to set a password (item 26). #222 made
that link set a password, and added signing in at `/sign-in`, `/account`
with Sign out, and a reset at `/forgot-password` (item 27), and #223 let an
account send from the share page, to its approved teams' albums, each photo
recording the account (item 29). #224 made the admin pages answer to
accounts holding the admin role, signed in with the password and a code
emailed for that sign-in, for 12 hours at a time; any admin makes another
on `/admin/people`, only the owner removes one, and the one owner is made
by hand (item 30). #225 let an admin revoke a person for a team, ending
their sessions, hide every photo an account sent, delete an account on
request, and hold a revoked address back from asking again (item 31). #226
is the cutover: its release removes the invite link, `/admin/code` and
`/coach`, and its last steps on production delete the coach Access
application, `ADMIN_EMAILS` and `COACH_EMAILS`, so every way in is an
account; items 11, 12 and 20 keep the
record, each opening with what replaced it, and README.md, The cutover
(#226), the order of its steps on production.
**Epic #191 makes COHSSA a section of the same
site**, on those accounts; #194 recorded the decisions behind both epics
(The photo site, item 24), and #227 gave every album a team: `/` leads to
`/hoover-jrt/` and `/cohssa/`, each listing its own team's albums (item 28).
#228 gave each team a "Not sure / other event" for photos from an event
nobody has added yet, which an admin moves into its event on `/admin/queue`
before approving them (item 32). #268, the first of epic #267's, deleted
the Access application in front of `/admin` on production, so an admin
signs in once, with the password and the emailed code (item 30). #269 made
the admin home open on what is waiting, each count a full-width button to
its page (item 30), and #271 made `/admin/people`, `/admin/albums` and
`/admin/removals` work at 320 px, every button 48 px (item 30). #274 let an
admin tick "Remember this phone for 30 days" at the code step, so that
phone stays signed in to the admin pages for 30 days rather than 12 hours,
and put "Forget this phone" on the admin home (item 30). #198 let the
share page send clips, in parts of 25 MiB, their location and camera data
overwritten on the phone and checked again on arrival, up to 10 GB of an
account's clips a day (40 GB a coach's); a clip waits in `/admin/queue`
beside the photos, where an admin plays, approves, rejects or moves it, and
#286 shows approved clips on the public pages (item 33). The `develop` preview sits behind Access. The domain has served a holding page since release `50992c3`
(2026-09-27), and the public albums since release `5a5b2f2` (2026-09-30, #157).
Each story reaches it with the next promotion, so read `release`, not this
paragraph, for what production holds
(see [The photo site](#the-photo-site--photosmadcowsailingcom)).
The open work is still construction: epics #147 (the photo site) and #191
(the COHSSA section) have stories open, and #226 was the last open story of
#216 (accounts). Beside them, #163
keeps the app pages true to the apps and #175 carries the plumbing the three
sites share. All of it is tracked on the board, not here.

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
│   │   └── base.css          Reset, header and footer shell (#169), nav, buttons,
│   │                         cards — used by all three sites
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
│   │                         api/join.js (since #226 a fixed answer that the
│   │                         invite link was replaced), the public pages (#157: index.js is /,
│   │                         albums/[address]/ an album, photos/[id]/[size].js
│   │                         a photo), "Remove this photo" (#158: remove.js
│   │                         asks without JavaScript, api/remove.js takes it
│   │                         down), api/upload/ and api/albums/ behind
│   │                         the upload guard (api/upload/index.js takes a
│   │                         photo, #154), and admin/ and api/admin/
│   │                         behind the admin guard (admin/albums.js the albums, #153;
│   │                         admin/queue.js the approval queue, #156, with
│   │                         api/admin/queue/ and api/admin/photos/;
│   │                         admin/removals.js the removal requests, #158,
│   │                         with api/admin/removals/; admin/mail.js the
│   │                         test email, #217, with api/admin/mail/;
│   │                         admin/people.js the requests for an account,
│   │                         #221, with api/admin/people/;
│   │                         share/receive.js answers a share that found no
│   │                         worker on the phone, #193; ask.js is /ask, a
│   │                         request for an account, #220; set-password.js
│   │                         is where an approval or reset email's link
│   │                         lands, #221, and sets the password, #222;
│   │                         sign-in.js, sign-out.js and forgot-password.js
│   │                         sign in, out and reset, #222; and account/
│   │                         behind the account guard, #222)
│   ├── lib/                  Code the Functions import that is not a route
│   ├── templates/page.html   The public pages' shell, never served (#157)
│   ├── migrations/           D1, NNNN_<what>.sql, additive only
│   ├── scripts/              sign-in-dev.mjs: signs the local account in, admin
│   │                         session and all (#224, #226; access-dev.mjs, a
│   │                         stand-in for Access, until #226)
│   ├── test/                 node --test; `npm test` from the root, which loads
│   │                         test/text-modules.js first so a .html imports (#157)
│   └── public/               The served files and nothing else (the output dir)
│       ├── share/index.html  Where an account sends (#155, #223); an old invite
│       │                     link lands here and is told it was replaced (#226).
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
│       │                     /remove, /ask, /set-password, /sign-in, /sign-out,
│       │                     /forgot-password, /account, /account/*, /api/*,
│       │                     /admin, /admin/*, /share/receive (/coach and
│       │                     /coach/* until #226)
│       ├── robots.txt        Allows crawling, on purpose
│       ├── css/site.css
│       ├── js/share.js
│       ├── js/remove.js      An album page's "Remove this photo" dialog; the
│       │                     template loads it, so assetver stamps it (#158)
│       ├── js/admin-queue.js /admin/queue's reject dialog; its ?v= is stamped by
│       │                     hand in lib/admin-page.js (#156), as /admin/code's
│       │                     script was until #226
│       ├── js/admin-removals.js /admin/removals' delete dialog, the same way (#158)
│       └── js/ask.js         /ask's Turnstile loader, on the form's first focus or
│                             touch; stamped by hand in lib/ask-page.js (#220).
│                             /forgot-password loads it too (#222,
│                             lib/sign-in-page.js)
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
photos and videos. Parents holding the current invite link upload from their phones (since
#226, accounts an admin approved do; item 29), and
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
`/admin`. #151 already requires that check. *Since #224 that lock is the
admin session instead (item 30), the same on every hostname.*

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
  was the admin allow-list (item 12), which #226 deletes once its release is live.

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

**The account is on Workers Paid since 2026-10-05** (#218; the owner's
purchase, pre-approved by D14). One password hash takes about 137 ms of CPU
on Cloudflare, and the free plan allows 10 ms a request (the CPU row). The
plan is the account's, so the paid step below is now in force for requests,
CPU and D1. R2, Zero Trust and Resend are billed on their own, and their rows
are unchanged.

| Meter | Free allowance | Where it ends here | The paid step |
|---|---|---|---|
| Requests (Functions and Workers together) | 100,000 a day, for the account | about 2,439 album views a day (item 2), minus what clips take (item 10) | Workers Paid, $5 a month: 10 million a month, then $0.30 per million |
| CPU | 10 ms per request | measured per route on production on 2026-10-01 (#161), each route driven alone for 20 requests in its own UTC minute, then read from the GraphQL Analytics API's `pagesFunctionsInvocationsAdaptiveGroups` by `datetimeMinute` (an Account Analytics: Read token; the schema gives the unit as microseconds). Each minute's request total had to equal the 20 sent, so no other traffic was in it. p50 / p90 / p99: `/` 2.4 / 5.4 / 7.1 ms; an album page of 12 photos 1.9 / 2.5 / 7.2 ms; the image route 2.2 / 3.1 / 7.5 ms; the admin home behind the Access token check 2.7 / 4.2 / 9.2 ms; 0 errors. At 20 requests, p99 is about the minute's slowest request, and on every route that one took 7–9 ms. The admin home's came within 0.8 ms of the limit. Two minutes were sampled (`sampleInterval` 1.25 and 1.82), so their quantiles come from about 16 and 11 requests. The Metrics tab cannot split by route, and the tail output Cloudflare documents carries no CPU field. **The password hash does not fit** (#218, read on the develop preview on 2026-10-05 by the same method, `?run=hash` and `?run=none` each alone in its own minute). On the free plan 2 of the 20 hashes were cut, answering 503 with status `exceededResources` at 10.0 and 22.7 ms of CPU, and the 18 that ran read 114.6 / 118.7 / 124.3 ms (`sampleInterval` 1.38). On Workers Paid, from a deployment made after the upgrade: 136.5 / 149.5 / 155.0 ms, 0 errors (`sampleInterval` 1.11), against the control's 1.6 / 1.9 / 2.3 ms (2.5). **A deployment live at the upgrade kept a 50 ms cut**: the preview's cut 4 of 20 hashes at 50.0 to 104.2 ms until it was redeployed. Production's deployment then, release `d02da44`, was made before the upgrade too, so by the same reading it keeps that cut until the next release deploys (not measured on production; its routes read under 10 ms above, and nothing there hashes yet). Clip parts: #198 measures a 25 MB part on the `develop` preview after its merge, by the same method (item 33) | Workers Paid, **in force since 2026-10-05**: 30 million CPU ms a month, then $0.02 per million. The project's own CPU time limit (Settings → General) is blank, so the plan's default applies |
| R2 storage | 10 GB-month | about 11,000 photos, or about 30–50 three-minute clips (item 9) | $0.015 per GB-month |
| R2 writes (Class A) | 1 million a month | 3 per photo, about 12 per clip | $4.50 per million |
| R2 reads (Class B) | 10 million a month | 40 per album view: about 2.93 million a month at the request ceiling | $0.36 per million |
| D1 | 5 million rows read and 100,000 written a day; 5 GB in all, 500 MB per database | about 4% of reads at the request ceiling, if every query uses an index | with Workers Paid: 25 billion reads and 50 million writes a month |
| Zero Trust | 50 users | the owner, plus anyone who signs in to a preview, plus each coach who signed in at `/coach` before #226 retired it (#192, item 20), whose seat stays until the user is removed | $7 per user a month |
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
treat them as an estimate. A coach's clip may run for 15 minutes (D11). #198 adds a size
cap beside each: 1 GiB for a parent's clip and 4 GiB for a coach's (`CLIP_BYTES` in
`lib/photos.js`; owner, item 33), and a day's budget for a session's clips together, 10 GiB
and a coach's 40 GiB (`CLIP_DAY_BYTES`; owner, after the security audit, item 33).

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
a lifecycle rule on the bucket shortens that to 1 day. It is on both buckets since
2026-10-08 (#198, item 33).

Whether a free Function can pass a 25 MB part into R2 within its 10 ms of CPU is not
documented. **The first video story measures it before building on it.** If a part does
not fit, the answer is Workers Paid, whose CPU limit defaults to 30 seconds, not a
different upload path. The account has been on Workers Paid since 2026-10-05, so #198
built first and measures a part on the `develop` preview after its merge (item 33).

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
data. The boxes playback needs carry creation times too, and #198 zeroes them in place
(owner, item 33).

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
250 MB clip that is about 70 requests. Since #198 the admin queue plays a waiting clip
this way, through `functions/api/admin/clips/[id].js`; serving one on the public pages
is #286 (item 33).

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

**Retired by #226.** Accounts replaced the invite link (D13, item
24): a person asks at `/ask` (item 25), an admin approves each team (item
26), and the phone signs in to the 90-day `__Host-account` session (item 27)
it sends from (item 29). Revoking a person (item 31) replaced rotating the
code. `POST /api/join` now answers `410 {"error":"replaced","ask":"/ask"}`
to every post from the site's own Origin, without reading the body, the
database or a secret, and still refuses another Origin with 403; the share
page takes an old `#code=` out of the address bar, sends it nowhere, and
says the link was replaced. `/admin/code`, its Create and Rotate routes and
`lib/invite.js` are gone (its two survivors are `lib/site.js`'s
`PRODUCTION_SITE` and `siteOrigin`). `requireUploadSession` takes an
account's session alone, and when a `__Host-upload` cookie reaches it or
`POST /api/join`, a parent's `v1.` or a coach's `c1.`, valid or not, the
answer deletes it; it opens nothing. The share page asks the guard on every
load, so a phone's old cookie goes the next time it opens the page. `invite_codes`, `join_failures` and `join_budget` stay,
since migrations are additive (item 6), and nothing reads or writes them;
the old codes and the failed-join rows are deleted by hand once #226's
release is live (README.md, The cutover (#226)), so a rollback to a build
from before #226 finds no current code and refuses every old link and
parent cookie (`security-audit` at #226's review, owner's choice). What
follows is #150's, #152's and #177's record as built.

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
  An admin route (#151) answers to the admin guard instead: #151's Access check
  (item 12), since #224 the site's admin session (item 30), and since #268 with no
  Access application in front of it on any hostname. The test knows admin routes by
  directory and holds them to the guard's refusal, rather than listing them as public.
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

README.md, The photo site, The invite link, retired by #226, says what an old link
meets now; until #226 it said where the code was created and rotated.

### 12. The admin guard

**Replaced in code by #224, 2026-10-06 (item 30), and at the door by #268,
2026-10-07.** Both admin directories now run `requireAdmin`, an account's
admin session opened by its password and an emailed code (12 hours, or 30
days on a remembered phone since #274; item 30), and `requireOwner` is
gone, with the admins' `ACCESS_AUD` and `ADMIN_EMAILS` it read (the owner's
choice at #224's pickup: replace outright). #268 deleted
the Access application in front of `/admin` on `photos.madcowsailing.com`,
and the `ACCESS_AUD` var that still held its tag (epic #267: the owner moved
it ahead of #226). **#226 retires the rest**: the token check this item
describes guarded `/coach` (item 20) until then, and went with the coach
sign-in in #226's code, along with `lib/access.js`, `test/access.test.js` and
the `ACCESS_TEAM_DOMAIN` and `ACCESS_COACH_AUD` vars; #226 deletes the coach
Access application once its release is live (README.md, The cutover (#226)).
So since #226 no code
reads an Access token, and the admin session (item 30) is the one lock on
`/admin`. What follows is #151's record as built.

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
  locally). *Both went with the check at #226; the stand-in is
  `scripts/sign-in-dev.mjs` since, and signs the site's own sessions.*
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
  `public/js/admin-code.js`'s own hash. *All three went at #226; the queue's
  and removals' scripts are stamped by hand the same way.*
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
- **Every album belongs to a team since #227**, Hoover JRT or COHSSA, set on
  this page and changed by an edit, and its team's section lists it (item 28).
- **Each team also has a "Not sure / other event" since #228**, which is no
  event: this page only closes and reopens it, in a section of its own, and
  none of its photos is ever approved (item 32).
- **Deleting an album that holds a photo is refused by the database.** Owner's choice
  at #153's pickup: #154's `photos.album_id` must be `REFERENCES albums (id)`, with no
  `ON DELETE` action. D1 enforces foreign keys in every query, and a violating statement
  fails with `FOREIGN KEY constraint failed`
  ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), read
  2026-09-28). So the refusal holds whatever state the photo is in, and an upload that
  lands mid-delete cannot slip past a count taken first. The route catches the failure and
  only then counts the photos, to say how many. Since #198's review it counts photos and
  clips apart in that one statement, with how many clips are approved or still being
  sent, which no admin page shows, and the page names both kinds (item 33). An album
  holding photos alone lands and reads as before. `test/albums.test.js` holds the rule on
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
  confirming the story's proposal; an account's 500 are the account's, shared
  by every phone signed in to it, since #223, item 29), counted in `upload_counts` by one guarded upsert,
  as #177's join budget was until #226, so two uploads arriving together cannot both take the
  last one. A unit is spent before the objects are stored, so a capped session costs
  no R2 write, and given back by a guarded decrement when the bucket or the
  database fails or the album closes mid-send. So the cap counts photos stored,
  not attempts (a finding of #154's review). It stops a runaway phone. It does not
  stop a leaked code, since whoever
  holds the code can join again for a new session; rotating the code does that
  (item 11). Not chosen: adding a sitewide cap of 2,000 a day, which lets any code
  holder use up the day for every parent (the tradeoff #177 turned down for
  joins); or 200 per session. *Since #226 every session is an account's, so
  the cap is the account's 500 and no code is left to leak (items 11, 29).*
  Since #198 a clip spends one too, and its size of the day's clip budget
  beside it (item 33).
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
  in #154. #198 did add a migration, 0016, but no column: it confirms these as
  0005 made them and adds ten triggers holding a clip's row to them (item 33).
  Its other migration, 0017, adds a column to `upload_counts`, not `photos`:
  the day's clip bytes (item 33).
- **A clip's row can start empty** (owner, 2026-09-29, at #154's review).
  `captured_at`, `width`, `height` and `bytes` are required by a CHECK in every
  state but `uploading`, not by NOT NULL. A clip's row is made when its upload
  starts (#198: before its first part), before the server can check what the page
  says about it. #198 fills `width`, `height` and `bytes` from the server's own
  reading of the clip once its parts are joined, and `captured_at` from the time
  the page read before zeroing it (item 33). And SQLite can
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
  Built 2026-10-08, widened to the admin queue (item 33).
- **A coach's upload has its own marker** (owner, 2026-09-29, for #192). `sender` is
  `parent` or `coach`, and a coach's row names no code generation, since no code
  opened the session. Not chosen: leaving #192 to add the column. #192 wrote it,
  from the coach's Access session (item 20), until #226; since then it comes
  from the account's role, `coach` or else `parent`, and every new row's
  code generation is the placeholder 0 (item 29).
- **The Origin check is the upload directory's** (see item 11), so the clip routes
  get it without anyone remembering it.
- **CPU.** *Measured in Node 24 on this machine, not on the edge:* rebuilding
  Chrome's canvas full size (0.55 MiB) takes 0.3 ms warm and 1.1 ms cold, and a
  Pillow quality-100 file (1.75 MiB) 3.1 ms, against the free plan's 10 ms a request.
  The edge's own reading per route is #157's (item 8's CPU row).

### 15. The share page's sending

**Built in #155, 2026-09-29.** `public/js/share.js` joins (item 11), then sends:
the link, "Add photos", the photos, "Send", with nothing typed. *Until #226;
since then it joins nothing, sends from an account's session (item 29), and
answers an old link with the words item 11 gives.* `test/share.test.js`
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
  to try again. *Since #226 a 401 means the sign-in ended, and a new `#code=`
  in the same tab is answered as an old link is (item 11).*
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
- **Since #198 a clip goes too** (item 33 has the owner's decisions). A file
  is a clip by its type (`video/…`) or its name (`.mp4`, `.mov`, `.m4v`,
  `.3gp`, any case); anything else, a HEIC included, takes the photo path,
  and a clip is never decoded. It is planned in the making chain by
  `MadcowClip.planClip` over `file.slice` reads, never the whole file, and
  judged against the caps `GET /api/albums/open` gives, waited for off the
  chain so a failed list holds up no photo. Its frame is text, "Clip n,
  m:ss", numbered by place in the one list as a photo is. One clip sends at
  a time, in one of the three places. The start declares `plan.bytes`, then
  each part goes as a `Blob` of file slices and the walker's edits, then the
  complete. **Parts and the complete are tried again on no answer or a 5xx,
  after 1, 3 and 9 seconds; the start never is**, since a start whose answer
  was lost has made an upload and spent one of the 500, while the complete
  answers 201 for a clip already stored. A clip that gives up after its start
  abandons its upload at once (`DELETE`, which gives the day back), unless
  the last answer was 404, **or the complete's tries all got no answer or a
  5xx**: any one of them may have stored the clip, so the complete is kept
  on the clip (`unsettled`: the upload, the etags, the capture time and the
  upload's album) and the clip fails in that answer's words (item 33, owner
  at #198's review). **Try again sends that complete again first**, with
  Remove withdrawn as for any complete: 201 is Sent, a complete that never
  arrived is joined from the parts already in the bucket with none sent
  again, 404 starts afresh in the same press into the album chosen now, no
  answer or a 5xx keeps it, and any other answer is the server's word on the
  clip, as a first complete's. **Remove on such a clip asks first**: "Checking
  whether it arrived…", with Remove and Try again withdrawn and the caption
  fixed, any leftover let go of, then the `DELETE`, tried as a complete is,
  since every try's answer means the same. 409 `stored` shows "Sent. It
  reached the photo site before you pressed Remove."; no answer or a 5xx
  fails it again; 204, 404 or 401 settles it as `letGo` reads one, and the
  item goes, the focus moving only from inside the item. Remove never sends
  the complete. While its complete is unanswered a clip's caption is
  read-only (owner): the caption went with the start. A clip being checked
  is in neither the summary's counts nor flight. A refusal that stops the
  queue (the 500, the clip budget, a closed album, a revoked team) leaves a
  queued clip whose complete is kept, since its Try again sends only that
  complete; a 401 stops it too, as the session refuses that complete. A
  `DELETE` that gets no
  answer is kept on the
  clip and sent again before Try again's new start, or on Remove, since the
  sweep that would otherwise clear it a day later gives nothing back (#198's
  review); a start whose answer was lost made an upload the page never
  learns of, which only the sweep clears. A clip refused for good (422, or
  413 too long or large) offers no Try again, and the summary asks for Try
  again only where it is offered (owner). One clip at a time is counted by
  clips sending, not by the list, so a clip removed while its upload starts
  keeps its turn until that upload is let go of. `captured` is `mvhd`'s time when it is after
  2000-01-01 and no more than a day past the page's clock, else the file's
  date. An edit's bytes are told from a file range with
  `ArrayBuffer.isView`, not `instanceof Uint8Array`: `partPieces` makes them
  in `clip.js`'s realm, and across realms (the tests' `node:vm`)
  `instanceof` is false and the page would send the whole file for each
  edit. `share.js` grew from 46,162 bytes to 71,793 (15,428 to 23,502
  with `gzip -9 -n`), much of it comments, and `/share/` now loads
  `clip.js` too (37,686; 12,919), measured once #198's review fixes were in.

### 16. The approval queue

**Built in #156, 2026-09-30, with three owner decisions taken at its pickup.**
`/admin/queue` (`functions/admin/queue.js`) shows every waiting photo, and its
forms post to `functions/api/admin/queue/`: `approve`, `reject` and `captions`,
and since #228 `move` (item 32).
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
- **A press is a fixed handful of statements, whatever the batch holds**,
  besides the admin guard's own read: two for Save captions, four for Reject,
  four for Approve or five when it approves fewer than it named, and five for
  Move into an event, six when the move finds none of its photos still
  waiting. Into a new event, `createAlbum`'s
  tries for a free address take the place of the event's read, so five at the
  first address. #270 added the read of the queue's order (below) to Approve
  and Reject, and to Move when nothing moves, and took two reads off Move's
  success. `test/queue.test.js` and `test/not-sure.test.js` count them. *(This
  said "at most three" until #270's review, which counted.)*
  D1 allows
  50 queries a request on the free plan and 100 bound parameters a query
  ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/), read
  2026-09-30), so the ids and the captions each travel as one JSON value, read
  with `json_each()`. A queue form may be 512 KiB, far past the albums' 4 KB,
  since it carries a caption for every photo in the batch. R2 deletes at most
  1,000 keys a call, so a reject deletes 333 photos' objects a call.
- **A press lands on the next waiting photo** (#270), so an admin on a phone
  carries on down the queue rather than starting again at the top: the next
  photo in its batch that still waits, else the next batch's first, else the
  earliest photo still waiting, which is one the admin skipped (owner, at
  #270's pickup; not chosen: the top of the queue). Approve and Reject read
  the queue's order first (`waitingOrder`, the page's own query, so a
  filtered page stays on its team), which reads every waiting row once more
  a press, as the page's load after it does. **Save captions lands on the
  card of the last caption it changed**, in the page's order, and at the
  batch when none changed (owner, at #270's review): Enter in a caption field
  presses it, and landing at the batch's heading sent an admin typing in
  photo 150 back up past 149 cards. Not chosen: the script naming the
  focused card, which needs JavaScript; the batch. A Move refused for its
  choice, and an approve naming only Not sure photos, land at the batch,
  where the Move choices are. **The
  notice shows where the page lands** (owner, at pickup), in that photo's
  card or that batch's section, once; the address carries `?at=` because the
  fragment never reaches the server, and the page puts the notice at the top
  only when `?at=` names nothing it shows. Not chosen: the top only, out of
  sight on a phone; a bar pinned to the screen, which costs height all
  evening and can cover a focused caption field (WCAG 2.4.11).
- **On a phone the queue is laid out for one hand** (#270; the owner's choices
  at pickup). Up to 30rem wide, each photo's screen size runs edge to edge,
  the most a phone can give a face; its words, caption field and buttons keep
  the page's margin. Not chosen: the card inside the margins (272 px of
  picture at 320) or as it was (238 px). Each photo names its event and team
  under its heading as well as its batch does, since a press lands far below
  that heading. Every button on the page is at least 48 px square
  (`--space-6`), at every width. **Reject and Reject all sit alone on the
  last row of their buttons, at its end**, apart from Approve, with Approve
  and Move filling the row above. Not chosen: one row with Reject at its far
  end (it drops to a second row at 320 anyway, and sits 13 px from Move at
  360); Approve alone across the full width with Move and Reject below it.
  **Each photo's buttons stick to the bottom of the screen while its card is
  on it** (owner, at #270's review), so after a press they are under the
  thumb: landing on an upright photo had put Approve 211 to 418 px below the
  screen at every phone size, a landscape one on it from 360 px up. The row
  covers about 128 px of the photo while scrolling, and the page's
  `scroll-padding-bottom` keeps a focused caption above it (WCAG 2.4.11).
  Not chosen: filing it for #276's real-phone check; one scroll per upright
  photo. **The picture's focus ring is two rings**, `--chalk` then `--deep`
  inside it, since an edge-to-edge picture puts the ring on the photo, where
  one `--blue` ring read 1.14:1 on deep water; the pair reads 14.87:1, so one
  of them reads 3:1 on any photo (WCAG technique C40).
  Before #270 the page was 717 px wide on every phone from 320 to 430: the
  new event's fieldset was as wide as its 65-character title field, as a
  fieldset is unless given `min-inline-size: 0`.
- **The admin home shows how many photos wait and the storage used**, the sum
  of every stored row's `bytes` in any state, against item 8's free 10
  GB-month. R2's pricing page does not say which GB it means
  ([R2 pricing](https://developers.cloudflare.com/r2/pricing/), read
  2026-09-30), so the page takes the smaller, 10^9 bytes, and runs out early
  rather than late. The sum reads every row, about 11,000 at the allowance,
  against D1's 5 million a day. It counts rows, so objects a refused reject
  left in the bucket, which R2 still bills, are in the log and not in the
  figure.
- **Since #228 a batch also has Move**, which moves one waiting photo, or
  the batch, into one of its team's events or a new one, and a batch in a
  team's "Not sure / other event" has no Approve (item 32).
- **Clips wait here too, since #198** (item 33). A checked clip is a card in
  its batch, "Clip <id>", with its length and frame size, and plays through
  `functions/api/admin/clips/[id].js` (206 ranges), loading nothing until
  Play. Every press takes it as it takes a photo, by the same names and
  values, and reads its kind from the statement it already makes (`RETURNING
  …, kind`), so no press makes a statement more and the counts below hold.
  Notices and counts name the two kinds apart, and read as before when no
  clip is among them. A reject deletes a clip's one object, in calls of whole
  rows up to R2's 1,000 keys. A clip still `uploading` is not waiting, so it
  is never shown or pressed. An approved clip is kept and shown nowhere
  public until #286.
- **A coach's photo says "sent by a coach"** beside when it was taken (owner,
  at #192's pickup), per photo rather than per batch, so it stays true
  whatever a batch holds. It does not say which coach: the row keeps no
  address and no sign-in time (item 20). *Since #226 a coach is an account,
  whose photos the queue names (item 29); the words stay for a photo sent
  through the coach sign-in before then.*

### 17. The public pages

**Built in #157, 2026-09-30, with four owner decisions taken at its pickup and
one on its floor.** `/` lists the albums (`functions/index.js`),
`/albums/<address>/` shows one (`functions/albums/[address]/index.js`), and
`/photos/<id>/<size>` serves a photo (`functions/photos/[id]/[size].js`).
`lib/public.js` holds the queries and `lib/public-page.js` the markup.
**Since #227 `/` leads to each team's section**, `/hoover-jrt/` and
`/cohssa/`, and the album list described below is each section's, for its
own team's albums (item 28).

- **Only an approved photo is public.** Every public statement names
  `state = 'approved' AND kind = 'photo'`, so a waiting, hidden or rejected
  photo is never listed, counted or served, and clips wait for #286: since
  #198 an admin can approve one, and it is kept and shown nowhere public
  (item 33). A closed
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
  and with it a two-item nav (item 18); the eyebrow stays. **Since #227 it
  leads to the album's team's section**, named for it ("COHSSA photos"),
  rather than to `/` (item 28).
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
it, and the share page links it beside the way to sign in (the join step
until #226).

- **Every claim is traced to its source**, in a table in the page's head
  comment: the code or the decision that makes it true. A change to either is
  a change to the page. `test/policy.test.js` holds the page's figures (90
  days, an hour, 2,560 pixels, 500 a day) to the constants in the code, which
  were `lib/session.js`, `functions/api/join.js` and `lib/photos.js` when
  #159 built it, so a change there fails until the page agrees.
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
  because the Quality floor names a real `<nav>`. **Since #227 that link
  reads "Team photos"** (owner, at #227's review), since `/` lists teams now,
  not albums (item 28).
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
  D9's end state once coaches sign in through Access (#192). *Retired with
  the link at #226: since then only an account an admin approved sends, and
  its role says parent, coach or other (the #226 bullet below).*
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
    so a revoke survives it (#225's criterion 4), as the takedown and
    request limits keep theirs (and the join limit kept its own until
    #226). Not chosen: a delete that lifts the revoke; refusing
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
  then covered the invite link and the coaches only**, and the page says a
  photo sent from an account names the account (D17). **The sentence about
  matching a coach's send time to Cloudflare's sign-in record stayed until
  the cutover, #226**, which removed it with the coaches' sign-in (below).
- **#220 put the request's own records on the page** (its criterion 9):
  when it was asked, which teams still wait for an answer and whether the
  admins have been emailed about it, and the request limit, with how long
  its scrambled address is kept. Each has a row in the trace and a line in
  `test/policy.test.js`, which also runs README's by-hand account delete
  against the real schema (item 25).
- **#238 put each team's release on the page** (2026-10-06). "Every photo
  is checked first" says which release covers which team's photos. Hoover
  JRT's check against the families who opted out keeps its words, and
  COHSSA's is named as its season-registration release, which has no
  opt-out (item 24). `test/policy.test.js` fails if Hoover JRT's sentences
  change, if COHSSA's paragraph stops naming its release or its lack of an
  opt-out, and if a team in `lib/teams.js` has no sentence of its own, so a
  third team needs its release named here before it ships. The wording was
  not to hand, and the owner chose at #238's gate to ship without the quote
  rather than hold for it. *The "no opt-out" was wrong, and #253 corrected
  it (next bullet).*
- **#253 quoted COHSSA's release and corrected its opt-out** (2026-10-07).
  The release the owner gave lets a family give or withhold permission and
  take it back, so COHSSA's paragraph now says an admin turns down a photo
  of a sailor whose family said no or took it back (a family that never
  returned the form is not on that list; item 24). Item 2 of the
  release, the part on photos published online, follows it word for word in
  a `blockquote class="release"`, set off by a `--blue` rule at its start
  edge. `test/policy.test.js` fails if that quote and item 24's record
  differ by a word or a list item, if the quote stops following COHSSA's
  paragraph straight away, or if COHSSA's paragraph stops saying how a family
  withholds permission. The admin queue's lede, README → Approving and the
  hq case study, which check every photo against "the families who opted
  out", read true for both teams again and are unchanged.
- **#226 retired the invite link and the coaches' sign-in on the page**
  (2026-10-08), with the facts production held that day: 12 photos sent
  with the invite link, all hidden; none through the coaches' sign-in; one
  failed-join row. "Who can send a photo" says only an account an admin
  approved for the team sends, a coach being an account with the coach
  role, and what replaced each retired way in: the invite link by an
  account, asked for at the request page, named in words with no link
  (#220's "Not chosen: a link from `/policy`", item 25); the coaches'
  sign-in by the coach role; changing the link by an admin revoking an
  account. The invite-link and coaches' paragraphs went, with the
  `COACH_EMAILS`, Access and coaches'-list sentences. **#192's sentence
  matching a coach's send time to who signed in went outright**, not into
  the past tense, since production held no photo sent through that sign-in.
  The failed-join paragraph went too: its last row is deleted by hand at
  the cutover (README.md, The cutover (#226)). A photo sent with the invite
  link before then keeps, in the past tense, which link it came with and
  when that phone opened it, and nothing naming who sent it. The phone's old
  `__Host-upload` cookie is deleted the next time it opens the share page or
  sends, and nothing reads it; the daily count is per account. The head
  comment's rows for retired things went or became dated history, and the
  change log has a #226 entry.
- **The scrambled address counts for an hour and has no upper bound.** It is
  deleted by the first join after it is an hour old (item 11), and in the
  off-season that can be months. The page says exactly that. *(This bullet
  said "kept about an hour" until the review, and so did the pickup comment,
  which was corrected on the issue.)* The story's criterion asked for "a
  stated number of days", written before #150 set the window. Not chosen: a
  delete on a busier route to make a real bound, which spends D1 writes on
  public requests against item 2's arithmetic. *Until #226, which stopped
  joins recording failures; the rows left are deleted by hand at the
  cutover, and the page no longer has the paragraph (the #226 bullet
  above).*
- **A removal names the photo by its link or the file, never its number.** A
  download's `<nnn>` is the photo's place at download time, which moves as
  earlier-taken photos are approved (the review's finding).
- **The page lists what the story's list left out**: when a photo was sent,
  which invite link and session it came through (0005), and the daily count
  per phone (`upload_counts`). Leaving them out would make a list headed "what
  the site keeps" wrong. *Since #226 the invite link's part is in the past
  tense, for photos sent before then, and the count is per account.*
- **"One of the site's admins" checks a photo, not "the owner"**, since item
  12 let every address in `ADMIN_EMAILS` approve (since #224 every account
  holding the admin role does; item 30).
- **A header or footer change is five copies**: `public/404.html`,
  `public/policy.html`, `public/share/index.html`, `templates/page.html` and
  `lib/admin-page.js`. `test/site.test.js`, `test/admin-page.test.js` and
  `test/public.test.js` fail until they agree, and `test/policy.test.js` until
  each footer links `/policy` and each nav holds Team photos alone (All
  albums until #227, item 28).

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
  address is the keyed hash item 11's join limit used until #226, IPv6 by its /64, in
  `removal_requests` (migration 0006). A request naming a photo that is not
  public is 404 and writes nothing, so a wrong id costs no D1 write. Not
  chosen: counting every request, 404s included, which is a write per bad
  request, the cost #177 budgeted on the join route until #226; 5 an hour; 20 an hour.
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
  #286, which shows them and so gives them a takedown. Until then an approved
  clip is deleted on request by hand (#198, item 33; README.md, Deleting a
  clip by hand).
- **Anyone can hide every photo from enough addresses.** Ten an hour per
  address stops one person, not a crowd of IPv6 /64s, and "Put it back" is
  one photo at a time. D7 accepts that anyone can hide a photo; this is that
  cost at its largest, and nothing past the per-address limit is built.

### 20. The coach sign-in

**Retired by #226.** A coach is an account approved with the
coach role (D13, D16; items 25 and 26), signed in at `/sign-in` like anyone
(item 27). `sendsAsCoach` in `lib/photos.js` reads that role alone: a coach
account's clips run 15 minutes (`clipSeconds`, D11), and its photos say
`coach` and name the account, which the queue shows (item 29). `/coach`,
`functions/coach/`, `requireCoach` and `lib/access.js`, the `c1.` session and
the `ACCESS_TEAM_DOMAIN` and `ACCESS_COACH_AUD` vars went in #226's code, so
from its release `/coach` is the site's 404 page; `COACH_EMAILS` and the
`madcowphotos coach` application with its policy are deleted once that release
is live (README.md, The cutover (#226)). A coach's old `__Host-upload` cookie opens nothing, and is
deleted the next time it reaches the upload guard (item 11). A photo sent through the coach sign-in
keeps `sender` `coach` and names nobody, and the queue still says "sent by a
coach" beside it; production held none on 2026-10-08, and the cutover reads
that again once its release is live (README.md, The cutover (#226)). What follows is
#192's record as built.

**Built in #192, 2026-10-01, with four owner decisions taken at its pickup
and four at its review.**
A Hoover JRT coach opens `/coach`, signs in through Cloudflare Access, and
lands on the share page able to send, having typed and followed no code
(epic #147, D9). `functions/coach/` holds the route, `requireCoach` in
`lib/access.js` the guard, and `lib/session.js` the coach's session.

- **The admin guard's check, run against a second list.** `requireCoach` is
  `requireOwner`'s token check (item 12; since #224 the one guard left
  running it, item 30) with the coaches' AUD tag,
  `ACCESS_COACH_AUD`, and their list, `COACH_EMAILS`, so it refuses every
  token #151's list refuses, on every hostname, `*.pages.dev` included.
  `test/coach.test.js` runs that list at `/coach`, and `test/guard.test.js`
  holds every route under `functions/coach/` to the guard.
- **A separate Access application**, `madcowphotos coach`, covering
  `photos.madcowsailing.com/coach` and `/coach/*`, because Access's `/coach/*`
  does not match `/coach`. Not chosen: adding those paths to the admin
  application. Access applies a policy to a whole application, so a coach
  would then pass Access's sign-in into `/admin`, with the code's 403 the
  only thing stopping them. Its tag differed from the admin one's, so a token
  signed for either never passed the other's check, until #268 deleted the
  admin application. On a preview, the Pages
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
`pwa-install-offer-android-prompt-ios-copy` note). *Since #226 the question
is a sign-in's: one made in Safari may not reach the installed app, so the
sender signs in inside it.*

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
  open the invite link or sign in as a coach (until #226; since then, to sign
  in); once a session exists they go
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
  #198 carries the criterion to add `video/*` once a clip can be sent. Since
  #198 it accepts `video/*` too, in its one field still named `photos`; the
  worker keeps any file it is given, so a shared clip waits in IndexedDB as
  a photo does and leaves only as the page sends it (item 33). An app
  installed before #198 keeps `image/*` until Chrome rebuilds it: `accept`
  is built into the installed app (`android-pwa-share-target-measured` in
  cairn), and Chrome checks the manifest at a launch when it has not in 24
  hours, then builds the new app once every window is closed and the phone
  is plugged in on Wi-Fi ([web.dev](https://web.dev/articles/manifest-updates),
  updated 2024-09-19; read at #198's review). **Add photos** takes clips
  meanwhile.
- **`/share/receive` is also a Function**, for a share that reaches the
  server because no worker is there to take it (site data cleared while the
  app stayed on the home screen). Pages answers a POST to a static path with
  an empty `405` (measured on `madcowphotos.pages.dev`, 2026-10-01), which a
  phone shows as a blank page. The Function reads no body and answers 303 to
  `/share/?shared=failed`, which says to share again; loading the page
  registers the worker again.
- **A deploy reaches an installed app the next time it opens**, all but the
  share target's types, which wait for Chrome's rebuild (above). The page is
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
checked. #222's set-password and sign-in call it (item 27), and #224's
admin sign-in will.

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
local run passes a PBKDF2 count that Cloudflare, by its source, refuses.
**Cloudflare refuses it.** *Measured* on the develop preview on 2026-10-05
with the probe's `?run=over-cap` (below): both PBKDF2s read `refused: Pbkdf2
failed: iteration counts above 100000 are not supported (requested 100001).`,
and scrypt read `refused: Scrypt failed: cost exceeds maximum (1048576).`

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
  NIST SP 800-63B (its first criterion): item 27 has them.
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
  Node, all 32 bytes, and a wrong password did not. *Measured* against
  Cloudflare on 2026-10-05: a hash the develop preview made equalled Node's
  `scryptSync` over its own salt, all 32 bytes, and verified, and a wrong
  password did not. `?run=none` is the
  control, and `?run=over-cap` reports each function's answer one step
  past its limit. #161's method reads it (item 8), and a minute counts only
  with 0 errors and its `sampleInterval` written beside it (README). The
  preview builds from `develop` only, so the reading follows this item's
  merge, and item 8 holds it.
- **It did not fit, so the account is on Workers Paid since 2026-10-05**
  (D14, pre-approved; the owner chose on 2026-10-02 to decide after the
  free-plan reading). The free plan allows 10 ms of CPU a request. *Measured*
  on the develop preview, the free plan cut 2 of 20 hashes, and on Workers
  Paid one hash read 136.5 / 149.5 / 155.0 ms at p50 / p90 / p99, 0 errors.
  Item 8 has both minutes, their controls, and the 50 ms cut that a
  deployment made before the upgrade kept.

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
for coaches (item 20) and D12's COHSSA copy. #226 retired what items 11,
12 and 20 describe on 2026-10-08, and each now opens with what replaced it.

- **D13. Accounts replace every way in, on both teams** (the
  recommendation). A parent, coach or other person asks for an account, and
  the owner approves it. The invite link (#150, #152; item 11) and the
  coaches' Access sign-in (#192; item 20) retire at #226, once accounts work
  on production, and today's admins and coaches get set-password emails
  then. Not chosen: accounts for COHSSA only; accounts with the link kept
  for one-off events. **#226 carries it out**, in the order README.md, The
  cutover (#226), records: an account sending and an admin signing in on
  production, and every address on `ADMIN_EMAILS` and `COACH_EMAILS` given an
  account with its role and a set-password email, before the release that
  removes the old ways in; then `ADMIN_EMAILS`, `COACH_EMAILS` and the coach
  Access application deleted.
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
  path. **#274 lengthened it for a remembered phone** (owner, 2026-10-07,
  #267): an admin who ticks "Remember this phone for 30 days" at the code
  step stays signed in to the admin pages on that phone for 30 days, and
  every other admin session still lasts 12 hours (item 30).
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
  team, and each team's section lists its own (#227, item 28). Not chosen: the copy as
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
  published online. *This item then said the release has no opt-out, so
  that unlike Hoover's (item 18) no per-family list applied, and `/policy`
  said so from #238 (2026-10-06). #253 corrected both on 2026-10-07, below.*
  #238 shipped without the quote rather than wait for the wording (owner, at
  #238's gate, 2026-10-06).
  **Its wording, recorded on 2026-10-07 (#253)** from the owner's copy of the
  release, pasted at #253's pickup, which the owner confirmed that day is the
  form COHSSA families have signed. The form has no title, and it covers the
  2026–27 school year and any later seasons. A family ticks "I GIVE
  permission" or "I DO NOT give permission", and can withdraw it at any time
  by emailing the coaching staff. So **COHSSA's release has an opt-out after
  all**: an admin turns down any COHSSA photo they recognize as showing a
  sailor whose family said no or took it back, as for Hoover's opt-outs. A
  family that never returned the form is not on that list (owner,
  2026-10-07). Not chosen: checking against every family that has not given
  permission, non-returners included, which the form's opt-in wording
  supports and which needs the list of families who ticked GIVE. On photos
  published online, item 2 of its "What you're allowing" reads, word for
  word:

  > 2. Post and publish those images and recordings, along with my sailor's
  >    full name, school, and team results, on:
  >
  >    - COHSSA and member team websites
  >    - Social media accounts run by COHSSA or its member teams (e.g.,
  >      Instagram, Facebook)
  >    - Fundraising and promotional materials, including sponsor
  >      presentations, donor appeals, recruiting flyers, and event programs

  `/policy` quotes it straight after COHSSA's paragraph, and
  `test/policy.test.js` fails if the two differ. Edit both together, and only
  from the release itself. The owner chose item 2 alone (2026-10-07). Not
  chosen: item 2 plus the withdrawal term, which carries a personal email
  address; all of "What you're allowing". **The quoted text does not name
  photos.madcowsailing.com.** Asked at #253's pickup, the owner said the
  issued release names it, then chose to proceed on the assumption that the
  text given is the issued one and covers the site among "COHSSA and member
  team websites". If the issued form reads differently, item 2 is recorded
  again from it. **Open (owner, 2026-10-07):** item 2 permits posting "those
  images and recordings", the ones its item 1 lets COHSSA, its member school
  teams, and its coaches and volunteers take. Whether a parent's photo sent
  to the site is one of them, or one the form's "Third-party photos" term
  describes, the release does not settle. No COHSSA photo is approved until #253 is released (item
  28).
- **The section shows COHSSA's name as text, with no COHSSA logo** unless
  COHSSA's permission is recorded here (a default, confirmed on 2026-10-05).
  None was recorded that day.
- **The COHSSA section's admins are the site's admins** (a default,
  confirmed on 2026-10-05). D15's admin role has no team, so every admin
  approves for both teams. Not chosen: a COHSSA person approving COHSSA's
  photos, which needs a team-scoped admin role that nothing has built.

### 25. Requests for an account

**Built in #220, 2026-10-05, the first story of epic #216 to keep anything
about a person.** Anyone asks at `/ask` (`functions/ask.js`) with a name, an
email address, parent, coach or other, Hoover JRT, COHSSA or both, and an
optional note. `lib/accounts.js` holds the rules, `lib/ask-page.js` the page,
`lib/turnstile.js` the check, and migration 0007 the tables. README.md, The
photo site, Account requests and Deleting an account by hand, is the
operating record. The owner's decisions, through the question tool:

- **The admins' email is the lazy hour** (owner, at pickup, as criterion 5
  proposed). The first new request emails every admin (each address on
  `ADMIN_EMAILS` until #224, each admin account since; item 30) at
  once and opens an hour; requests inside it send nothing; the first after it
  sends one email naming every request no email has named. The admin home
  counts the waiting requests, which is how a request that no later one
  follows is seen: Pages runs no scheduled job. Not chosen: a 3-hour window;
  no email, the count alone.
- **10 requests an hour from one network address, 100 an hour from
  everyone** (owner, at pickup): the join limit's figure (item 11) and #177's
  budget. Not chosen: 5 and 30, which an email to every COHSSA family could
  hit; 20 and 200. A scrambled address is deleted after its hour by the next
  request the site takes or the next load of the admin home, as #158's
  takedown log is; a refused request deletes nothing.
- **A spent hour writes nothing** (owner, at the review). The site's hour is
  read before the address's unit is claimed, as #177's join budget was spent
  before a failed join was recorded (until #226). Then the unit is spent, and if another
  request took the last one in between, or the spend fails, the address's
  unit goes back. Not chosen: claiming first and recording the cost of a
  spent hour's claim and give-back (about 4 rows a request, bounded only by
  Turnstile); keeping the address's unit when the site is busy, which would
  count a refused request against the person's own 10.
- **The address log's time is the account's, to the second, and `/policy`
  says so** (owner, at the review). A request that makes an account stores
  one clock reading in both `accounts.requested_at` and its
  `account_request_log` row, so for the hour that row is kept the scrambled
  address can be matched to the account. `test/policy.test.js` holds the
  sentence to the code: it fails if the two times ever differ. Not chosen:
  a coarser time on the account, which would cost the admins the exact time;
  recording it here alone, which would leave `/policy` claiming less than the
  site keeps.
- **The page is `/ask`** (owner, at pickup). Not chosen: `/account/request`,
  `/request-access`.
- **Nothing linked to `/ask` at first** (owner, at pickup), and #226 was to
  point the old invite link at it. Not chosen: a link from `/policy`; links
  from the album list and the share page. *#223 kept it so (item 29): the
  share page linked `/sign-in`, not `/ask`. This bullet said "an account
  cannot send until #223" until #223.* **Since #226 the share page links
  it**, "No account yet? Ask for one" beside "Have an account? Sign in", as
  plain links that #272 makes buttons (owner, 2026-10-08), and an old invite
  link and `POST /api/join` point to it. `/policy` names the request page in
  words, with no link, as chosen here.
- **Turnstile's script loads on the form's first focus or touch** (owner, at
  the review). *Measured* through `tools/h2proxy.mjs` on a local serve,
  Lighthouse 13.4.1, mobile, three runs each, accessibility 100 in every one:
  loaded with the page, `/ask` read 86, 87 and 87 for performance, under
  the photo site's floor of 95 (Quality floor); with Turnstile's origin
  blocked 94, 94 and 97; the
  album list on the same template 97, 97 and 99 (the control). Added on the
  first focus or touch by `public/js/ask.js`, it read 96, 97 and 99, with no
  Turnstile request during the run. A page sent back with a reason loads it
  at once, since the person is part way through. Not chosen: loading it with
  the page and holding `/ask` to 85; a preconnect hint (88, 87, 87); adding
  it after the page's load event (84, 84, 83). The cost: someone who sends
  within a second or two of starting meets the check unfinished, and the 403
  page asks them to wait and send again, keeping what they typed (measured:
  the token arrived 1.9 s after the first Tab, with the test keys).

The rest are defaults. The first three were taken at pickup and recorded on
#220 then. The rest were taken while building, and are recorded in #220's
pull request and its story comment, which #220's review found they were not
before: one of them, the email's 50-name cap, narrows criterion 5.

- **Turnstile is checked on the server before any field is read.** A token
  siteverify does not pass is a `403` and writes nothing, so neither limit is
  spent by a request no person sent. Only `success` decides: Cloudflare's
  always-pass test secret answered `"hostname":"example.com"` and no action,
  for a token as well as for `not-a-token` (*measured* 2026-10-05), so a
  hostname or action check would refuse every local run. In production a
  response marked `result_with_testing_key` is refused as unavailable (`503`),
  so a test secret set there by mistake cannot pass every request. Siteverify
  answered a request with no `User-Agent`, unlike Resend (item 21); the
  site sends one anyway. One widget, Managed, serves both environments: a
  hostname covers its subdomains (Turnstile's Hostname management page, read
  2026-10-05), so `madcowphotos.pages.dev` covers the `develop` preview.
  Local runs use the test keys (README, Running it locally).
- **The CSP widens on `/ask` alone**, by the two values Turnstile's CSP page
  lists: `https://challenges.cloudflare.com` in `script-src`, and as the
  whole of `frame-src`. `lib/headers.js`'s `headersFor` picks it by path, and
  every other path keeps the site's policy. *Measured* in Chrome: no CSP
  report and no console error on `/ask`, the widget's frame from that origin.
  *Since #222 the reset form at `/forgot-password` gets it too
  (`TURNSTILE_PATHS`, item 27), the one other page with the widget.*
- **One account per email address**, unique without regard to letter case.
  A request from an address the site already has, in any state, writes
  nothing about the account, and is answered with the same `303` to
  `/ask?sent` by the same statements as a new address (criterion 4). Only a
  new address emails the admins, and that runs after the answer
  (`context.waitUntil`), so its timing does not carry it. A turned-down
  address that asks again writes nothing too (#221's pickup, item 26), and
  since #225 so does a revoked one, after its account is deleted as well,
  by the same statements (item 31).
- **The admins' email names a request by name, role and teams only**, never
  the address or the note, as `/policy` says, and links `/admin/people`
  (item 26). Each admin gets a send of its own: since #224 each account
  holding the admin role, the owner's included (`adminAddresses`, item 30),
  where until then it was each address on `ADMIN_EMAILS`. Only a request
  that made an account sends it. If no admin's email goes through, the hour is given back and the
  requests stay unnamed for the next request.
- **One email names at most 50 requests** (`LIST_MAX`) and says how many more
  wait; those are named by the next email. That narrows criterion 5's "names
  every requester since the last one" for a backlog alone: the budget counts
  clock hours and the email's hour slides, so up to 200 requests can fall in
  one email's hour, and the 200th's email names 50 and counts 150. 50 of the
  widest lines stay inside `lib/mail.js`'s `TEXT_MAX`, which
  `test/accounts.test.js` holds. Not chosen: no cap, which a full backlog
  of the widest names would push past `TEXT_MAX`'s 20,000 characters, and
  `sendMail` refuses a text that long, so no email would go at all.
- **The form's limits**: a name of 100 characters, one line; a note of 500,
  read as a takedown note is (`readNote`); one plain address by
  `lib/mail.js`'s rule. 0007's CHECKs hold the same figures. A name drops
  Unicode's bidirectional controls, which would reorder the rest of its line
  in the admins' email, and a name of only format characters (a zero-width
  space, say) is no name; other format characters stay, since a zero-width
  non-joiner belongs in some names (#220's review).
- **The teams are a table**, `teams`, so a third team is a row and #227 can
  point albums at it. `account_teams`' CHECK already holds all four states
  (requested, approved, rejected, revoked), since SQLite cannot change a CHECK
  in place, which #223 meets on `photos`.
- **The two team checkboxes share one name, `team`**, as an HTML checkbox
  group does. html-validate's `form-dup-name` shares radio, button, reset and
  submit names by default, and checkboxes by an option, which
  `photos/.htmlvalidate.json` now sets. Not chosen: `team[]`, a framework's
  convention the server would have to read back.

**D1 rows written, measured** on `madcowphotos-preview` on 2026-10-06 (UTC)
with `wrangler d1 execute --remote --json`, each statement the code runs
with probe values, every probe row deleted after:

| Statement | Rows written | Rows read |
|---|---|---|
| Read the site's hour first (`account_request_budget`) | 0 | 1 |
| Claim the address's unit (`account_request_log`, two indexes) | 3 | 3 |
| Spend the site's unit (`account_request_budget` upsert) | 1 | 2 |
| The account, new (`accounts`: its UNIQUE email and its AUTOINCREMENT counter) | 3 | 3 |
| Its two teams (`account_teams`, `WITHOUT ROWID`) | 2 | 13 |
| The account, an address already there (`ON CONFLICT DO NOTHING`) | **1** | 4 |
| Its teams, an address already there | 0 | 3 |
| The admins' hour: claim it / inside it | 1 / 0 | 2 |
| Mark the named requests | 1 a request | 5 |
| Delete the address's row once over an hour old (a later request's tidy) | 1 | 1 |
| README's by-hand delete (the account and two teams, by cascade) | 3 | 9 |

The budget read and the one-row delete were measured at #220's review, the
same way, on 2026-10-06 (UTC), with a probe row planted at time 1000 so the
tidy's own statement could delete it and nothing else. So a new request
costs 10 rows written (9 with one team), counting the delete of its own log
row an hour on, and a repeat 6. A repeat's insert does nothing and still
writes 1 row: SQLite moves an AUTOINCREMENT counter even for an insert that
does nothing. So a repeat spends an id. A request once the site's hour is
spent writes nothing: it runs the budget read alone. The budget caps the
route at 100 × 10 = 1,000 rows an hour, plus one email's marks (at most 50),
about 25,000 a day: 25% of the free plan's daily 100,000 and a sliver of
Workers Paid's 50 million a month.

### 26. Approving requests for an account

**Built in #221, 2026-10-06.** An admin decides each request at
`/admin/people` (`functions/admin/people.js`), approving or turning down
each team on its own (D16), and approving emails a link to set a password.
`lib/people.js` holds the decisions and the admins' log, `lib/people-page.js`
the page, `lib/password-link.js` the link, and migration 0008 the two
tables. README.md, The photo site, Approving accounts, is the operating
record. The owner's decisions at pickup, through the question tool:

- **A link lasts 7 days** (`LINK_SECONDS`). A parent who reads email once a
  week still gets in, and "Send a new link" covers anyone slower. Not
  chosen: 72 hours, 24 hours, 14 days.
- **Turning down sends nothing** (criterion 3's default). Anyone can type
  any address into `/ask`, so a note could reach a stranger whose address
  was used, and would confirm a live address to a spammer. Not chosen: a
  short note.
- **#221 checks the link and nothing more; setting the password is #222's.**
  A valid link's page said the account is approved, when the link runs out,
  and that setting a password was not open yet, with no form. Not chosen: a
  set-password form here under a stopgap length rule, which would have
  decided the password rules twice. *Since #222 the link opens the form
  (item 27), so a real person can be approved once a release carries #222.
  This bullet said "`spendLink` is built and tested here, and #222's form
  calls it" until #222 retired `spendLink` for a batch that stores the
  password with the spend.*
- **A turned-down address that asks again still writes nothing**, so #220's
  criterion 4 stands as tested. `/admin/people` lists the turned-down, and
  an admin can still approve them. Not chosen: turned down as final, with
  only the log showing it; asking again putting them back in the waiting
  list, which would let a spammer re-queue every hour.

The rest are defaults, recorded on #221 at pickup or in its pull request:

- **The token is 32 random bytes in the query string, and only its SHA-256
  is kept** (`password_links`). The page answers without JavaScript. The
  site's `Referrer-Policy: strict-origin-when-cross-origin` sends another
  site the origin alone. Not chosen: the fragment, as the invite link used
  (item 11), which needs a script to read and an API to ask. A plain
  SHA-256 suffices for a 256-bit random value, where a password needs
  scrypt (item 23).
- **Opening the link changes nothing.** `GET /set-password` reads one row, so
  a mail scanner that fetches every link cannot use it up. A used, replaced,
  expired, mistyped or missing link answers `404` with one page for all of
  them, which offers no form and no sign-in, only how to get a new link.
  *Since #222 that includes a link to the reset at `/forgot-password`
  (item 27), and a usable link opens the form to choose a password. This
  bullet said "only who to ask for a new link" until #222's review.*
- **A new link replaces the account's last only once its email is sent**
  (`replaceOthers`). A refused send deletes the new link instead
  (`dropLink`), so the link a person already holds keeps working, and an
  unconfirmed send keeps both, since Resend may have delivered it. Making a
  link also deletes every expired one in the table, and so does each load of
  `/admin/people`. Nothing else deletes one before #222 spends it. *Until
  #221's review the new link deleted the old one before the send was known,
  so a refused email (the day's quota, say) revoked a link that worked; four
  of the review's six lenses found it.*
- **The decision form**: a box per team still to decide (ticked when it
  waits, unticked when it was turned down), the role the requester chose,
  Approve, and Turn down when a team waits. The role changes, and is logged,
  only when the same press approves a team. Each account is in one list,
  Waiting, Approved or Turned down, by its teams' states, the oldest request
  first. *Since #225 an account whose every team is revoked is in a fourth,
  Revoked (item 31); this said it was in none until then.*
- **Each decision is one D1 batch, every statement guarded by the same
  condition**: a ticked team still open to that decision. So the log entries
  and the change commit together or not at all, and of two admins pressing
  at once only the first changes anything. The second is told another admin
  may have got there first.
- **The approval is the answer, whatever the email does.** It has committed
  by the time the link is sent, so a refused, unconfirmed or unstored email
  is reported beside it (`?mail=`), never instead of it (cairn:
  `a-route-of-separate-writes-answers-from-its-last-commit`). `sendLink`
  never throws: a D1 error reading the account answers `unsaved`, which
  #221's review found answering 500 for a saved approval, and an account
  that held no approved team by then answers `not-approved`.
- **A link's log entry commits with the link** (owner, at #221's review), in
  one D1 batch, so no link exists without an entry naming the admin who
  issued it. The entry starts `unrecorded`, and the send's outcome is written
  afterwards on a best-effort basis; if that write fails, the page says how the email went was
  not recorded. Not chosen: logging first and refusing to send if that
  write fails; keeping the entry best-effort and annotating criterion 5.
- **The email names nobody**: the teams approved, when the link runs out,
  and the link. Nothing the requester typed is sent back to the address they
  gave.
- **The admins' log copies the person's name and address into each entry,
  with no foreign key to `accounts`**, so a delete neither removes nor is
  refused by an entry, and the entry still names the person, as `/policy`
  says. `test/policy.test.js` lists it as the one survivor of README's
  by-hand delete and checks it still names them. Its actions are
  `ACTIONS` in `lib/people.js`. 0008's CHECK holds their shape only, since
  #224 and #225 add their own and SQLite cannot change a CHECK in place. The
  page shows the newest 100 (`LOG_SHOWN`), and nothing deletes from the
  table.

### 27. Signing in, signing out, and a forgotten password

**Built in #222, 2026-10-06.** An approved person sets a password from the
emailed link at `/set-password`, signs in at `/sign-in`, lands on
`/account`, signs out there, and resets a forgotten password at
`/forgot-password`. Since #224 an account with the admin role is also asked
for an emailed code after its password (item 30). `lib/sign-in.js` holds sign-in, sign-out and setting a
password, `lib/account-session.js` the cookie and its guard,
`lib/password-rules.js` the password's rules and the breach check,
`lib/reset.js` the reset, `lib/sign-in-page.js` and `lib/password-page.js`
the pages, and migration 0009 the columns and tables. README.md, The photo
site, Signing in, is the operating record. Sending from an account is
#223's, and the admin sign-in with its emailed code #224's (item 30).

**The password follows NIST SP 800-63B-4**, section 3.1.1.2
(pages.nist.gov/800-63-4/sp800-63b.html, last modified 2025-08-26, read
2026-10-06; criterion 1):

- *"Verifiers and CSPs SHALL require passwords that are used as a
  single-factor authentication mechanism to be a minimum of 15 characters
  in length."* A parent's or coach's password is their only factor, so 15
  (`PASSWORD_MIN`). The 8 NIST allows inside multi-factor is not taken for
  admins either: #224 adds the code on top of the same password.
- *"Verifiers and CSPs SHOULD permit a maximum password length of at least
  64 characters."* 256 (`PASSWORD_MAX`): any passphrase or password manager
  fits, and scrypt's cost does not grow with it.
- *"Each Unicode code point SHALL be counted as a single character"*, and
  *"the verifier SHOULD apply the normalization process ... (NFC) ... before
  hashing"*. The routes normalise to NFC before counting, hashing and
  checking (`normalizePassword`), since #218's `hashPassword` hashes the
  UTF-8 it is given.
- *"Verifiers and CSPs SHALL NOT impose other composition rules"*. None.
- *"verifiers SHALL compare the prospective secret against a blocklist that
  contains known commonly used, expected, or compromised passwords. The
  entire password SHALL be subject to comparison"*. Two halves: the whole
  password, case and punctuation folded, against the person's own address,
  the part before its @, their name and the site's and teams' names
  (`SITE_WORDS`); and every password Have I Been Pwned has seen in a breach
  (below).
- *"Verifiers SHALL offer guidance"*: the field's hint, and the short and
  breached messages, suggest a few unrelated words.
- Section 3.2.2: *"the verifier SHALL limit consecutive failed
  authentication attempts ... to no more than 100 by disabling that
  authenticator"*, and *"When the subscriber successfully authenticates, the
  verifier SHOULD disregard any previous failed attempts"*. `FAILED_IN_A_ROW`
  is 100, on the account (`failed_sign_ins`); a password that reaches it
  stops working until a new one is set from an emailed link, and a sign-in
  that succeeds sets it back to 0 and forgets the address's failed tries.
- Not built: a show-password toggle, which NIST says SHOULD be offered and
  which needs a script. The form asks for the password twice instead.
  Pasting and password managers work (`autocomplete` `new-password` and
  `current-password`, the address as `username`).

The owner's decisions at pickup (2026-10-06), through the question tool:

- **The breach check is Pwned Passwords, failing open.** Setting a password
  asks `https://api.pwnedpasswords.com/range/{first 5 SHA-1 chars}`, which
  needs no key, with `Add-Padding: true` (haveibeenpwned.com/API/v3, read
  2026-10-06), and refuses a password whose suffix it lists with a count. If
  it does not answer within 3 s (`PWNED_TIMEOUT_MS`), the password is let
  through and the miss logged. Only the 5 characters leave the site, and
  `/policy` says so. It runs when a password is set, never at sign-in. Not
  chosen: failing closed, which would stop every new account and reset while
  the service is down; a local list only, which has to be sourced and kept
  and misses most breached passwords. *Measured* on #222's local run: a
  real call from workerd turned down `password12345678`.
- **Signing out ends every session the account holds, on every device.** It
  adds 1 to `session_version`, as setting a password does, so every cookie
  naming the older version is refused at its next request. Nothing new is
  stored, and a copied cookie dies too. Not chosen: a sessions table, one
  row per device, which /policy would have to name. *Since #225 an admin's
  revoke of any team adds 1 too (item 31), so a re-approval cannot bring a
  pre-revoke cookie back; criterion 4's revoke half was deferred there
  (owner, at #222's review). Until then a revoke ended sessions only because
  the guard reads only an account approved for a team.*
- **Failed sign-ins: 10 an hour per email address, 20 an hour per network,
  100 an hour for the whole site** (`EMAIL_FAILURE_LIMIT`,
  `NETWORK_FAILURE_LIMIT`, `FAILURE_BUDGET_PER_HOUR`). The address is counted
  by a keyed hash of what was typed, so one with no account is counted as
  one with an account is, and a limit says nothing about which. Once the
  site's hour is spent nobody can sign in until it turns, and nothing is
  written; a session already open keeps working. The accepted cost: someone
  on five or more networks can close sign-in for an hour at a time. Not
  chosen: 10/10/100; 10/20/1,000; Turnstile on the sign-in form, which a
  password manager's autofill-and-submit can beat.
- **Every unit is claimed before the password is checked** (owner, at
  #222's review). The first build read the counts before the hash and wrote
  the failure after it, so tries sent at once all read the limits as free:
  `review-fanout`'s refuters measured 12 tries at once against the limit of
  10 all checked, and a burst of 150 checking 150 guesses and setting the
  count in a row to 100 in seconds. Now each try claims, each in one guarded
  statement, its address's and network's units together (an `INSERT …
  SELECT` that counts both, as `claimResetRequest` and `/ask` claim theirs),
  then the site's hour, then a step of the count in a row, and only then is
  scrypt run. A sign-in that succeeds gives all three back. So a burst gets
  10 checks per address and 20 per network, and every check spends a unit of
  the hour before its CPU. Not chosen: saying the limits hold one try at a
  time.
- **A reset link lasts an hour** (`RESET_SECONDS`), works once and is kept
  only as a hash, in `password_links` beside the approval links. The form
  sits behind the `/ask` Turnstile widget (`lib/headers.js` widens the CSP
  for `/forgot-password` too). 10 requests an hour per network
  (`RESET_REQUEST_LIMIT`), at most one email per account every 15 minutes
  (`RESET_GAP_SECONDS`), and 20 a day for the whole site
  (`RESET_EMAILS_PER_DAY`), so resets can never spend more than a fifth of
  Resend's 100 a day (item 21). Not chosen: 24 hours; no Turnstile. *The gap
  is the link insert's own `NOT EXISTS` a link made in the last 15 minutes,
  so resets sent at once get one link (#222's review: a read before the
  insert let three at once all send). It counts the links the account still
  holds, so a used link ends it, and `/policy` says "while an earlier one
  waits to be used". The day's unit is spent only once the link is stored.*

The rest are defaults, recorded on #222 at pickup:

- **The session is its own cookie, `__Host-account`**:
  `a1.<account>.<version>.<issued>.<signature>`, HMAC-SHA256 with
  `SESSION_SIGNING_KEY`, 90 days, `Secure; HttpOnly; SameSite=Lax; Path=/`.
  It is not a third shape of `__Host-upload`, so #223 read it alongside the
  invite link's and the coach's, and #226 retired those without touching it.
  `requireAccount` (`functions/account/_middleware.js`, with the Origin
  check) reads the account on every request: gone, approved for no team, or
  on another version, and the page is sent to `/sign-in` with the dead cookie
  deleted.
- **One path for every failure** (criterion 2). An unknown address, a wrong
  password, an account not approved, one with no password yet and one whose
  password stopped all run the same statements in the same order, and check
  the typed password against one scrypt hash: the account's, or
  `STAND_IN_HASH`, made at `SCRYPT` from bytes nobody kept. They get one
  page, which points at the reset. `test/sign-in.test.js` compares the
  statements and counts the checks. *Measured* on #222's local run in
  workerd, 8 of each alternating: an unknown address 252 ms median
  (218–326), a wrong password 237 ms (223–312).
- **Setting a password is one D1 batch**, every statement held by the link
  still being the account's, unexpired, and the account approved: the hash,
  the version up by 1, the count in a row back to 0, the address's failed
  tries forgotten, and every link the account holds deleted. So of two posts
  of one link only the first changes anything, and a failed store keeps the
  link. #221's `spendLink`, a delete of its own, would have spent the link
  before the password was stored; #222 retired it. Setting a password signs
  that browser in.
- **A reset is answered before its email is decided.** Every request past
  the checks gets the same `303` to `/forgot-password?sent`, after the same
  statements; `sendReset` runs in `waitUntil`, and emails only an account
  approved for a team, whether or not it had a password. A reset link does
  not replace the approval link the person may still hold; setting a
  password with either ends both. Nothing is written to the admins' log,
  which records what admins do.
- **The pages**: `/sign-in`, `/sign-out` (POST only, so a link or a prefetch
  never signs anyone out), `/forgot-password`, `/set-password` (GET shows the
  form, POST sets the password) and `/account`. They take `/ask`'s form
  classes, so the only CSS change was the password field's edge. *Since
  #223 the share page links `/sign-in` and `/account` links the share page
  (item 29); `/ask` stayed unlinked until #226, which links it from the
  share page (item 25). This bullet said nothing public linked `/sign-in`
  yet, and that #223 and #226 would decide, until #223.*

**D1 rows written, measured** on `madcowphotos-preview` on 2026-10-06 (UTC)
with `wrangler d1 execute --remote --json`, each statement the code runs
with probe values, every probe row deleted after:

| Statement | Rows written | Rows read |
|---|---|---|
| Read the site's hour (`sign_in_budget`) | 0 | 1 |
| Claim the try: address and network together (`sign_in_failures` guarded `INSERT … SELECT`, two indexes) | 3 | 4 |
| Spend the site's unit (`sign_in_budget` upsert), a new hour or the same | 1 | 2 |
| The account's count in a row, `+ 1 … RETURNING`: an account / no such account | 1 / 0 | 2 / 1 |
| Delete the failure an hour on (no index on time) | 1 | 1 |
| A sign-in that succeeds: forget the address's tries (one row) / the count back to 0 / the hour's unit back | 1 / 1 / 1 | 1 / 1 / 1 |
| Reset: claim the network's unit (`reset_request_log`, one index) | 2 | 3 |
| Reset: delete the claim an hour on | 1 | 1 |
| Reset: the link, inserted under the gap / refused inside it | 2 / 0 | 5 / 4 |
| Reset: the day's email unit (`reset_mail_budget` upsert) | 1 | 2 |

Measured in two passes the same day: the first before #222's review moved
the claims in front of the hash, the second, after it, for the claim, the
`RETURNING` count, the success path and the guarded link insert. So a recorded
failure costs 5 rows written, 6 where the address has an account, counting
its own delete an hour on; a sign-in that succeeds costs about 8, since it
claims like a failure and gives the units back; a limited or busy try
writes nothing. The site's budget caps failed sign-ins at 600 rows an hour,
14,400 a day, and their CPU at 100 hashes an hour, about 14 s (item 23's
137 ms), about 10 million CPU-milliseconds a month against Workers Paid's
30 million: every check now spends a unit of the hour before it runs. The
delete with no time index read 1 row on a table holding only the probe; on
a full table it reads at most the rows two hours of the budget leave, a few
hundred.

### 28. Albums belong to a team, and each team has its own section

**Built in #227, 2026-10-06, the first story of epic #191 to change the
site.** Four decisions were the owner's at pickup, each the recommendation;
the rest were taken while building and are named as such.

- **The sections are `/hoover-jrt/` and `/cohssa/`**, the keys `teams`
  (0007) already held (owner, at pickup). Each is a two-line route file
  under `functions/<team>/` calling `lib/section-route.js`, with both
  spellings in `_routes.json`. Not a top-level `functions/[team]/` route,
  which would sit beside `/ask`, `/admin` and every other top-level path. A
  third team is a `teams` row, an entry in `lib/teams.js`'s `TEAMS`, a route
  file and two `_routes.json` lines, and `test/public.test.js` fails on any
  one missing. An album's address names no team, so every album link sent
  before #227 keeps working, and so does one to an album moved to the other
  team. Not chosen: `/teams/<team>/`, one dynamic route under its own prefix
  but a longer link; shorter words such as `/hoover/`, a second naming of the
  teams beside their keys.
- **The migration is `team TEXT NOT NULL DEFAULT 'hoover-jrt'` plus four
  triggers** (owner, at pickup). SQLite refuses `ADD COLUMN … REFERENCES`
  with a non-NULL default while foreign keys are enforced (*"Cannot add a
  REFERENCES column with non-NULL default value"*, measured on node:sqlite
  3.53.3), and D1 enforces them in every query and migration, with only
  `PRAGMA defer_foreign_keys` to relax them
  ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
  read 2026-10-06). So the triggers do the reference's work: an album's team
  must be a `teams` row on insert and on update, and a team an album names
  cannot be deleted or have its key changed. Every album made before 0010 is
  Hoover JRT's by the default, with no UPDATE of a stored row. `teams` stays
  the one list, as 0007 made it a table for. Not chosen: a CHECK naming the
  two teams, a third copy of the list that needs a table rebuild for a third
  team; a nullable REFERENCES column set by an UPDATE, which leaves NULL
  allowed for good and is the destructive class. `test/site.test.js`'s
  additive check now reads a trigger's event (`BEFORE DELETE`) as when it
  runs, and still fails a trigger whose body changes rows.
  **0010's four were not the whole reference, and 0011 adds the fifth**
  (found by `review-fanout` at #227's review). `REPLACE INTO teams` whose
  row clashes with another key's unique `name` deletes that row without
  firing a delete trigger, since `recursive_triggers` is off on node:sqlite
  and D1 (measured on both), and the albums naming it were left pointing at
  nothing. 0011's `BEFORE INSERT` trigger runs before the clash is resolved
  and refuses exactly that case. 0010 was already on the preview database,
  and D1 records a migration by its filename, so 0010 was left as it was.
  In the two update triggers, `OF team` only spares a title or name edit
  the subquery; no behaviour tells it apart, and the tests say so.
- **`/` is one row per team** (owner, at pickup): its name, how many albums
  and photos its section shows, and its newest album's cover. A team with
  nothing posted keeps its row, saying so, with an empty tile where the cover
  goes, since its section is a page all the same. Not chosen: every album on
  `/`, grouped under a heading per team, which still has a COHSSA parent
  scroll past Hoover JRT's. `/` costs D1 what it did before: one read of every
  approved photo's index entry, summed per team in the code. The first row
  with a cover loads it at once, so a first team with nothing posted leaves
  the other team's cover eager (the review's finding).
- **A section reads only its own team's photos.** The team is applied inside
  the window's scan (`album_id IN (SELECT id FROM albums WHERE team = ?)`),
  which reaches the photos by `photos_by_album`.
- **The share page groups its album choices under each team's name**
  (owner, at pickup): an `<optgroup>` per team, in the order the teams first
  appear in the newest-first list. `GET /api/albums/open` gives each album
  `team` and `teamName`. The invite link and a coach's sign-in had no
  team, so until #226 they were offered every open album; since #223 an
  account is offered its approved teams' albums only (item 29), and since
  #226 every session is an account's. Not chosen: a team picker before
  the list, which #223 would mostly take away again; the API alone, which
  shows nothing about teams until #223.
- **An album page's eyebrow leads to its team's section** ("COHSSA photos"),
  where it led to `/` as "All albums". Taken while building, which reversed
  #157's recorded choice, so `review-fanout` raised it, and the owner kept it
  at #227's review: #157's choice was the eyebrow as the way back to the
  list, and an album's list is its section now.
- **Every link to `/` is named "Team photos"**, the page's own title (owner,
  at #227's review): the header nav in its five byte-identical copies (item
  18), and the eyebrows on the sections, `/ask`, `/sign-in` and the refusal
  pages. They said "All albums", and the sections briefly "All teams", for a
  page that now lists teams. `test/site.test.js` reads every source for a
  link to `/` named anything else. Not chosen: reverting the album eyebrow
  to #157's "All albums"; shipping the mixed labels with a story to follow.
- **A takedown that leaves its album with nothing public lands on the album's
  team's section**, with `?removed`. It lands on `/` only when the album could
  not be read back, which is why `/` still shows the notice.
- **The queue and removals pages filter by `?team=`** (criterion 2): links to
  all teams and to each, the one showing marked `aria-current`. Every press
  on a filtered page posts to its route with the same `?team=`, so it lands
  back on that team, and anything else in `?team=` shows every team. The
  team travels in the address, never in a field, so a press that arrives as
  a GET keeps it too (when #227 shipped, that was the Access sign-in
  running out mid-page; since #224 a lapsed press goes to the sign-in, and
  a GET comes from the press's address opened as a page) (`lib/teams.js`,
  `teamOf`; the first build used a hidden field, and `review-fanout` found
  the GET dropped it). Each batch and each hidden photo names its team; the
  admin home's counts stay whole-site.
  `/admin/albums` shows each album's team and sets it as the form's first
  field, preselected on neither team for a new album, as the kind is not.
- **`TEAMS` moved to `lib/teams.js`**, and `lib/accounts.js` re-exports it.
  `lib/albums.js` needs it, and importing `accounts.js` there makes a cycle
  through `removals.js` and `photos.js`, which import `albums.js`.
- **No COHSSA album is made on production until #253 is released**
  (owner, 2026-10-06). #227 is the first release in which an admin can make a
  COHSSA album and approve a COHSSA photo, and item 24 says no COHSSA photo
  is approved until the COHSSA release's wording is recorded and on
  `/policy`; #238's criterion 4 said that reaches production no later
  than #227. Nothing in code holds that order. At #227's review the owner
  chose to hold the promotion that would carry #227 until #238 was in
  `develop`; release PR #251 carried #227 to production that same day with
  #238 still open, and the owner then put the rule on the admins instead:
  no COHSSA album on production until #238 is released. **At #238's gate
  the wording moved to #253**, since it was not to hand, and the rule
  moved with it: #238 names COHSSA's release on `/policy` but does not quote
  it. Not chosen: a code gate refusing COHSSA albums or approvals until the
  wording is recorded, which the wording's story would then have to remove;
  rewording #238's criterion.

### 29. Sending from an account

**Built in #223, 2026-10-06.** A phone signed in at `/sign-in` sends from
the share page as the account, to the open albums of the teams an admin
approved it for (D16), and each photo records the account, which the
admins alone see (D17). `requireUploadSession` in `lib/session.js` takes
the account's session, `functions/api/albums/open.js` and
`functions/api/upload/index.js` hold it to its teams, `senderColumns` and
`insertPhoto` in `lib/photos.js` write the row, and migration 0012 adds the
column. README.md, The photo site, Uploads and Hiding every photo an account
sent, by hand, is the operating record. The owner's decisions at pickup,
through the question tool:

- **The account is a column on `photos`, not a rebuild.** 0005's CHECKs
  allow a sender of `parent` or `coach` only and require a parent's row to
  name a code generation, and SQLite changes a CHECK only by rebuilding the
  table (item 6). So 0012 adds `account_id INTEGER REFERENCES accounts (id)
  ON DELETE SET NULL`, NULL by default, which SQLite allows under enforced
  foreign keys where a non-NULL default is refused (cairn:
  `sqlite-a-references-column-cannot-be-added-with-a-default`), and an
  account's row fills 0005's columns with placeholders: the sender is the
  account's role, `coach` or else `parent`, and the code generation and
  session time are 0, which no invite code is. 0012's CHECK holds an
  account's row to those zeros with `IS 0`, since `= 0` reads NULL as a
  pass (*measured* on node:sqlite: a coach-shaped row with no zeros got
  through). The delete's SET NULL is what `/policy`'s "no longer record
  which account sent them" rests on, so README's by-hand delete and #225's
  need no statement of their own. A partial index serves "hide all their
  photos" and the delete's lookup, and costs a row with no account nothing.
  Not chosen: a side table naming each photo's account, a second write per
  upload and a second table to join; rebuilding `photos` under a
  two-release plan, the destructive class, which on D1 also needs
  `defer_foreign_keys` and must carry AUTOINCREMENT's high-water mark over
  by hand, or a rejected photo's id could be given out again.
  `test/upload.test.js`'s one-migration rule now names 0012 beside 0005.
- **An account's session wins over an upload cookie.** A phone holding a
  live account session sends as the account, to its approved teams only,
  whatever invite or coach cookie it also holds; one whose account session
  no longer holds (signed out, a new password, no approved team, gone)
  sent with the upload cookie as before, until #226. A database that does
  not answer while the account is read is 503, closed, even beside a live
  upload cookie. The accepted cost: someone signed in for one team who also
  opened the other team's invite link cannot send to the other while signed
  in. Not chosen: the upload cookie first, which leaves gaps in D17's
  record of who sent each photo. *Since #226 `requireUploadSession` takes an
  account's session alone: with no live one it answers `401
  {"error":"not-joined"}`, and an upload cookie that reaches it is deleted
  (item 11).*
- **The share page links `/sign-in` and `/account` links the share page.**
  "Have an account? Sign in" sat beside the coach line, and `/account`'s
  "isn't open yet" became a Send photos button. `/ask` stayed unlinked until
  #226 (item 25). Not chosen: `/account` only; linking `/ask` too. *Since
  #226 the coach line is gone, and "No account yet? Ask for one" sits beside
  the sign-in link (item 25).*

The rest are defaults, recorded on #223 at pickup or taken while building:

- **Another team's album is `403 {"error":"team"}`, before the cap is
  spent.** The route reads the album's team after `openAlbum` and refuses
  it unless the guard's `teams` hold it, storing nothing. `insertPhoto` then
  checks the team again in the statement that writes the row, so a team
  revoked mid-send stores nothing too: it answers `409 album`, the objects
  are deleted and the unit given back. The share page fails every photo
  queued for that album with the team's words and reloads the list
  preselecting nothing, as after a 409.
- **The daily cap is the account's** (`sessionKey`: `account.<id>`, issued
  time left out), so every phone signed in to it shares its 500, and
  signing in again opens no new 500 (criterion 5). Since #198 its phones
  share the day's clip budget the same way (item 33).
- **A clip's length goes by role** (criterion 4, D11): `clipSeconds(session)`
  in `lib/photos.js` gives 15 minutes (`CLIP_SECONDS.coach`) to an account
  approved as a coach (`sendsAsCoach`; a coach's Access session too, until
  #226), and 3 to everyone else.
  The guard reads the role on every request, so a role changed at approval
  applies from the next upload. #198 reads it at a clip's start and again at
  its complete, beside `clipBytes(session)`'s 1 GiB and 4 GiB, and
  `clipDayBytes(session)`'s 10 GiB and 40 GiB at the start (item 33).
- **The queue and removals pages name the account** ("sent by <name>",
  escaped), by a LEFT JOIN on `accounts`. A photo sent through a coach's
  Access sign-in before #226 says only "sent by a coach" on the queue, and
  the invite link and a deleted account say nothing. `test/account-upload.test.js` scans every
  public route's GET and HEAD, `/remove` and `/api/remove`, headers and
  bytes, for a planted name and address, and the admin queue is its
  control.
- **The share page's words name both ways in**, since the server does not
  say which kind of session ended: "Sign in, or open the invite link you
  were sent", "Your sign-in or invite has ended", and the cap's "This
  phone, or your account". `GET /api/upload/session` still answers a bare
  204. *Until #226; since then they name the account alone ("Your sign-in
  has ended", and the cap's "Your account has sent today's limit"), and an
  old invite link is told it was replaced (item 11).*
- **What a deleted account leaves** (`/policy`, Having an account deleted):
  its photos stay with `account_id` NULL and the sender still saying
  whether a coach's account sent them, and the day's count under
  `account.<id>` stays until anyone's first upload of a later day.
  `test/policy.test.js`'s by-hand delete test holds both.
- **`lib/account-session.js` no longer imports `lib/session.js`.** The
  guard now reads it, and the import back made a cycle in which
  `ACCOUNT_SESSION_DAYS = SESSION_DAYS` would meet an unset constant
  whenever `session.js` loaded first. It states 90 itself, and
  `test/policy.test.js` held the two equal until #226 deleted
  `SESSION_DAYS`, which left 90 stated there alone.

### 30. Admins: the emailed code, the admin session, the owner

**Built in #224, 2026-10-06** (D15). An account holding the admin role
signs in at `/sign-in` like anyone, and is then asked for a 6-digit code the
site emails to the account's address. The code opens the account's 90-day
session and a separate admin session, which every admin page and admin API
checks in place of #151's Access token (item 12). The admin session lasts
12 hours, or, since #274, 30 days on a phone the admin asks the site to
remember (below). *This heading said "the 12-hour session" until #274.*
`lib/admin-code.js` holds the code, `lib/admin-session.js` the cookie and
the guard (`requireAdmin`), `lib/people.js` making and removing admins,
`functions/sign-in/code.js` the code's page, and migration 0013 the role,
the codes and the triggers. README.md, The photo site, Signing in, Approving
accounts and Making the owner, is the operating record. The owner's
decisions at pickup, through the question tool:

- **One sign-in, and the admin part lasts 12 hours** (the recommendation).
  Everyone signs in at `/sign-in`; an account with the admin role meets the
  code after its password, every time it signs in, and the right code sets
  both `__Host-account` (90 days, for sending) and `__Host-admin` (12 hours,
  for the admin pages). After 12 hours the admin pages send the browser to
  `/sign-in?admin`, while the phone keeps sending. Not chosen: a separate
  admin sign-in page, with `/sign-in` code-free for everyone; one 12-hour
  session for everything an admin does, sending included. *Since #274
  (2026-10-08) the admin part lasts 30 days on a phone the admin asks the
  site to remember, and 12 hours otherwise: see "Since #274" below. This
  bullet is #224's choice as taken.*
- **The owner role is granted by hand, once per database** (the
  recommendation). No address may go into this public repo (item 12), so no
  migration can name the owner: README's Making the owner runs one `UPDATE`
  keyed by the account's id. Not chosen: an `OWNER_EMAIL` secret, which
  would outlive #226 while `ADMIN_EMAILS` goes; the first address on
  `ADMIN_EMAILS` claiming it at its first sign-in, a bootstrap path inside
  the guard.
- **Any admin adds an admin, only the owner removes one.** This changed
  criterion 4's default, the owner alone, as that criterion allowed. Not
  chosen: the default; any admin adding and removing.
- **Replace outright** (the recommendation). Both admin directories run
  `[requireAdmin, requireSameOrigin]`; `requireOwner` and the admins' pair
  of names it read (`ACCESS_AUD`, `ADMIN_EMAILS`) are gone from the code.
  The Access application stayed in front of `/admin` on
  `photos.madcowsailing.com` (criterion 7), so there an admin met Access's
  PIN and then the site's sign-in, and an admin not on its policy used
  `madcowphotos.pages.dev/admin/`, until #268 deleted it on 2026-10-07
  (epic #267: the owner moved it ahead of #226). The accepted cost: the
  second address on `ADMIN_EMAILS` cannot open `/admin` from the release
  that carries #224 until it has an account and an admin makes it one. Not
  chosen: either lock opening `/admin` alone while Access stood; both
  required. *Closed by #226's criterion 2, which gives every address on
  `ADMIN_EMAILS` an account with its role before the secret is deleted
  (README.md, The cutover (#226)).*

The rest are defaults, taken while building and recorded on #224's pull
request:

- **The code is bound to its sign-in.** The password step sets
  `__Host-sign-in-code`, 32 random bytes for 10 minutes, and the code's row
  is found by their SHA-256, so the code typed into another browser finds
  nothing. The code itself is kept only as HMAC-SHA256 under
  `SESSION_SIGNING_KEY`, over the token's hash and the code: a 6-digit code
  has a million values, which a plain hash would give up to anyone holding
  a copy of the table. `newCode` draws from `crypto.getRandomValues` and
  draws again past the last whole million, so every code is equally likely.
- **5 tries, claimed first.** Each try adds 1 to `tries` in one guarded
  `UPDATE … WHERE tries < 5 RETURNING` before the code is checked (cairn:
  `a-count-then-record-limit-is-not-a-limit`), and the right code is spent
  by a second guarded statement (`useCode`) once the route has read who it
  signs in, so of two right posts only one signs in.
  A typed code that is not 6 digits (spaces and hyphens taken out) is a 400
  and spends no try. 10 minutes is `expires_at`, checked in the same claim.
- **At most 10 codes per admin in any 24 hours**, counted from the codes'
  own rows, kept a day for it, by one `INSERT … SELECT … WHERE count < 10`.
  So someone holding an admin's password cannot spend Resend's 100 emails
  a day (item 21) on codes, and each code's email says what to do if it
  was not asked for: set a new password, which ends every session and,
  since the review below, deletes the account's codes. A code Resend
  refused is deleted and does not count; one Resend did not confirm is
  kept, and the code page says it may not arrive.
- **The guard reads the account on every request**: it exists, holds the
  session version the cookie names, is approved for a team, and holds the
  admin role. So a removal closes the admin pages at the next request
  (criterion 2), and a sign-out, a new password or being made an admin (the
  review below), each a version bump, end them too. #225's revoke is a
  version bump as well, but it refuses an account holding the admin role
  (item 31), so it reaches an admin only after the owner's "Remove admin",
  which has already closed the admin pages; its bump then ends the
  account's other sessions. *Until #274 this bullet listed the revoke
  beside the other three as ending an admin's pages, which has not been
  true since #225's pickup chose that refusal.* A refused request, whatever
  its method, is a 303 to `/sign-in?admin`, deleting a dead admin cookie:
  the admin pages are plain forms, and a press made after the session's
  length ran out (12 hours, or 30 days on a remembered phone since #274)
  lands on a page saying nothing was changed. Nothing behind the guard
  answers a 303 there, which is how `test/guard.test.js` tells the guard's
  refusal from a route's own. Since
  #274 the cookie's payload starts `m2.` and carries the session's length
  in what is signed, `m2.<account>.<version>.<issued>.<seconds>`, so no
  other cookie's or token's signature under the same key (`a1.`, #224's
  `m1.`, the retired `v1.` and `c1.`, `clip.`, `admin-code.`) can be
  carried over, and a 12-hour cookie cannot be edited into a 30-day one.
  #224's `m1.<account>.<version>.<issued>` is no longer read (below).
- **The database holds criterion 3 and the last admin itself** (migration
  0013): a unique partial index for one owner, and seven triggers refusing
  a second owner, the owner's demotion, deletion or any change to an
  approved team of theirs, the last admin's demotion or deletion, and every
  REPLACE path that removes such a row without firing a delete trigger
  (cairn: `sqlite-append-only-needs-a-replace-trigger`). *Measured* on
  node:sqlite 3.53.3 before the triggers: `UPDATE OR REPLACE accounts SET
  admin_role = 'owner'` on a second account deleted the owner's whole row,
  teams and all, because the unique index's clash resolves by deletion. A
  `REPLACE` onto an admin's id or email is skipped (`RAISE(IGNORE)`), never
  refused, because a `BEFORE INSERT` trigger runs before `/ask`'s `ON
  CONFLICT DO NOTHING`: a refusal would answer `/ask` for an admin's address
  with an error and so name it, where #220's criterion 4 holds every known
  address to one answer. `test/admins.test.js` holds `/ask` for the owner's
  address to the same statements as any known address's. The same seven
  held on local D1 (`wrangler d1 execute --local`, 2026-10-06).
- **Making an admin needs an approved team, and each press is one batch**:
  the log entry and the change, both held by the same condition, the actor
  re-read in it (the guard read them when the request began, and a removal
  can land in between). Nothing is emailed: a new admin meets the code at
  their next sign-in, and since the review below the change ends every
  session they hold. The log's actions are `promote` and `demote`, with no
  detail.
- **The admins' email about new requests goes to the admin accounts**
  (`adminAddresses` in `lib/accounts.js`), the owner's included, where it
  went to `ADMIN_EMAILS` (item 25). So nothing read `ADMIN_EMAILS` after
  #224, and #226 deletes it once its release is live (README.md, The cutover (#226)). `ACCESS_AUD` stayed in `wrangler.jsonc`, read by nothing,
  as the record of the Access application's tag, until #268 deleted the
  application and the var; README's Access section keeps the tag.
- **The admin home says who is signed in, as the owner or an admin, until
  when, and has Sign out**, which ends every session the account holds, as
  `/account`'s does (#222). `/sign-out` now ends a session from either
  cookie and deletes both. Since #269 that is the page's last section, and
  since #274 it says the session's own end and holds "Forget this phone"
  above Sign out (below).
- **Since #269 the admin home opens on what is waiting** (epic #267). Under
  its head come photos waiting for approval, account requests and removal
  requests, in that order (`TODO` in `lib/admin-page.js`), each a
  full-width button 48 px tall to its page with its count first. A zero is
  shown too, in the quiet button, saying "Nothing to do.". Then the links:
  Albums, People and Email, and the storage figure as a line of text. The
  owner's choices at pickup: keep the Invite code link, which the
  criterion's list left out, until #226 retired the invite link (it went
  then, with `/admin/code`); and storage stays text, since there is no page
  for it to link to. The counts
  are unchanged: `queueSummary` and `waitingRequests`, whole-site, photos
  only. Since #198 `queueSummary` also counts the waiting clips, and the
  queue's button names both kinds: "3 photos and 1 clip waiting for
  approval", "1 clip waiting for approval" with no photo, and today's words
  with no clip (owner, item 33).
- **Since #271 people, albums and removals work on a phone** (epic #267).
  Every button on the three pages is at least 48 px square (`--space-6`) at
  every width, as the queue's are (#270); `/admin/mail`'s one button shares
  `.album-form`, so it grew too. **The team filter's links count as buttons**
  (the owner's reading of "link used as a button"; not chosen: on removals
  only, or links left at their 18 px), so each is a 48 px target, on the
  queue as well as removals, which share the rule. The two disclosures,
  "Edit" and "Revoke, hide their photos or delete", are padded past 44 px
  rather than made flex rows, which would delete their marker. Up to 30rem
  wide every field runs
  the full width, the date and the role select as well as the text fields,
  and each team, kind and tick box is a 48 px row of its own (owner, at
  pickup; not chosen: side by side at 44 px tall, or left at their 25 px).
  **"Delete permanently" sits alone on the row below a full-width "Put it
  back", at its end**, as Reject does on the queue, and its dialog stays the
  confirm (owner, at pickup; not chosen: one row with the two at its ends,
  or only 48 px tall). Revoke, hide and delete keep their disclosure, which
  stands a step further from the everyday buttons on a phone, over a rule.
  An album's Delete is only made 48 px: it has no confirm step, and the
  database refuses it for an album holding photos (owner; not chosen:
  setting it apart too, or filing a confirm step). The queue's Move fields
  (`.move`) stay as #270 shipped them. Before #271, at 320 px,
  `/admin/albums` was 383 px wide from an album's title, `/admin/removals`
  657 from a caption, and a notice naming a long name or title 341 to 380;
  each wraps now. So does the queue's batch heading, each card's album and
  sender, and a Move's notice, which made `/admin/queue` 545 px wide at
  every phone width (found by #271's reading and folded in at its gate, the
  owner's choice over filing it; #270's reading seeded no long title). The
  320 px reading is a browser's, in #271's PR, and
  `test/admin-phone.test.js` holds the rules it rests on (owner, at pickup;
  not chosen: a browser in CI, which would be the gate's fourth kind of
  step).
- **Since #274 an admin's phone can stay signed in to the admin pages for
  30 days** (epic #267). The owner's decision of 2026-10-07 (#267): remember
  this phone for 30 days. Not chosen: passkeys (2–3 days, WebAuthn), and
  keeping 12 hours. It lengthens #216's D15 cap (item 24) for a remembered
  phone only.

  The code step has a tick box under the code field, "Remember this phone
  for 30 days", unticked by default. Ticked, the form sends `remember=yes`,
  and that value exactly opens a 30-day admin cookie (`sessionLength` in
  `lib/admin-session.js`); any other value, or none, opens a 12-hour one, as
  before. The form names no length, so it cannot choose one: the site issues
  two, `ADMIN_SESSION_LENGTHS`, `adminCookie` throws for any other, and the
  guard refuses a cookie naming any other even when its signature holds,
  since only a leaked key or a test could sign one. Every page that shows
  the form again (a code that is not 6 digits, a wrong code, either 503)
  keeps the tick as it was sent. The account's own cookie is 90 days either
  way. The length is signed into the cookie (`m2.`, the guard bullet above),
  and the server checks the age against that signed length itself, never
  against `Max-Age`, which is set to the same length and only asks the
  browser. `/sign-out` reads the admin cookie by the same rule, so a
  remembered cookie names its account to Sign out for its whole 30 days.
  Signing out, a new password and losing the admin role end a remembered
  session at the next request, as they end a 12-hour one; a revoke reaches
  it only after Remove admin, as the guard bullet says.

  The admin home's last section says until when this session lasts, in UTC
  as before: "The admin pages stay open until …" for 12 hours, and "This
  phone is remembered: the admin pages stay open on it until …" for 30
  days. Above Sign out is **Forget this phone**, a `POST` to
  `/api/admin/forget` (`functions/api/admin/forget.js`) behind both admin
  guards. It deletes this browser's `__Host-admin` and nothing else, and
  lands on `/account?forgotten`, which says this phone no longer opens the
  admin pages and still sends photos. Its `GET` changes nothing, as every
  admin write's does. Each form's hint says what its button ends: Forget
  this browser's admin pages, Sign out every session the account holds.
  Both buttons are 48 px square, the second form stands a step below the
  first, and up to 30rem wide the remember row is a 48 px row of its own
  (`.admin-sign-in` and `.code-remember` in `public/css/site.css`).

  The owner's choices at pickup, 2026-10-08, through the question tool (on
  #274, issuecomment-6073189186), each the recommendation:
  - **Forget this phone deletes this browser's admin cookie only** and
    writes nothing to the database, so the account's cookie and every other
    phone and computer stay as they were. Not chosen: a server-side record
    of each admin session, so that a copied cookie stops working at once,
    which needs a migration and one more read on every admin request;
    adding 1 to the session version, which is Sign out and ends every
    device. **The cost**: the server keeps no list of admin cookies, so a
    copy of one taken off the browser keeps working until its length runs
    out, 30 days for a remembered one, or until Sign out, a new password, or
    the account losing its admin role. A lost phone cannot press Forget:
    Sign out on any other phone or computer, or a new password through
    `/forgot-password`, ends its sessions, its admin one included.
  - **Admin cookies from before the release are refused.** #224's `m1.`
    no longer matches, so each admin who has the admin pages open at the
    release signs in once more. Not chosen: reading `m1.` as a 12-hour
    cookie until the last one ran out. A further option, a second prefix per
    length that would have kept `m1.` valid, was named after this choice by
    the critic of the code map; it was not put to the owner, since the
    one-time sign-in had already been accepted.
  - **Forget this phone shows on every admin session**, remembered or not.
    Not chosen: only on a remembered one.
  - **Criterion 3's revoke is tested on the path that exists.** #225's
    revoke refuses an account holding the admin role, so it reaches an
    admin only after Remove admin. `test/admins.test.js` runs that sequence
    through the real presses, and a test of its own gives the role back by
    hand, with a no-revoke control, to show the revoke's version bump is
    what keeps the old cookie out (Make admin bumps the version too, so it
    cannot show that alone). Not chosen: rewording criterion 3; testing only
    a cookie on an old version.
  - **Every text #274 makes false belongs to this story**, not only
    criterion 5's two: `/policy`, README's Signing in, the `/sign-in?admin`
    notice, `/admin/people`, the code headers, and here item 12, D15 and
    this item's heading. #216's end-state note is amended when the PR
    opens, with the options not chosen. The mutations that weaken the guard
    run on a scratch copy, each red count predicted first; their record is
    the PR's.
  - **Forget this phone and Sign out are 48 px, and so is the remember row
    on a phone**, which `test/admin-phone.test.js` holds, each rule beside a
    control. Defaults that came with
    it: Forget lands on `/account` with a notice; the tick survives the page
    coming back after a wrong code; the end time stays in UTC, as the admin
    home showed it.

  **#274's review** (`review-fanout`, 3 low findings, all fixed at the
  owner's choice). A Forget press the guard refuses (its session already
  ended: a second tab, the time up, Sign out elsewhere) lands on
  `/sign-in?admin`, whose notice told the admin to press it again once
  signed in, which would only open a session for Forget to end. The notice
  now adds that a refused "Forget this phone" needs nothing more, since this
  browser already opens no admin pages. That was a default taken while
  fixing. Not chosen: the guard sending a refused Forget to
  `/account?forgotten`, which would make one admin route's refusal unlike
  every other's that `test/guard.test.js` holds; and a public Forget route
  beside `/sign-out`, which would need its own Origin check and a `PUBLIC`
  entry. The `/account` notice test now sends `?constructor` and its kin,
  which only the route's own list of keys keeps off the page.

  **Locally** `scripts/sign-in-dev.mjs` signs a fresh 12-hour admin cookie
  on every request it forwards, so through `:8789` the admin home always
  reads 12 hours from now, and Forget this phone looks as if it did
  nothing, since the next request carries a new cookie (README.md, Running
  it locally). **What a remembered cookie cannot do**: it belongs to one
  browser. A mail app that opens the admins' email link (`/admin/people`)
  in another browser, or in a view of its own, does not carry it, and
  meets `/sign-in?admin` there. *Reasoned from where a browser keeps its
  cookies, not measured.*
- **Locally the code cannot be emailed** (`.dev.vars` holds no Resend key),
  so `scripts/sign-in-dev.mjs` (`access-dev.mjs` until #226) signs an admin
  session for the local account `ADMIN_DEV_ACCOUNT` names, with the local
  key, on every request it forwards; the guard runs unchanged. Since #226 it
  also signs that account's `__Host-account` session on every path outside
  the admin pages, so the local share page sends as it, which the invite
  link did until then. README.md, Running it locally.

**#224's review, 2026-10-06.** `review-fanout` confirmed 11 findings, and the
owner chose to fix all 11. The owner's choices on the three it escalated,
and on its one escalation, through the question tool:

- **The right code lands on `/account`, which links the admin pages** (the
  recommendation). Until #268, Access stood in front of `/admin` on
  `photos.madcowsailing.com` and answered a browser without its cookie with a
  302 to its login on another origin. The code page's CSP says `form-action
  'self'`, which Chromium and WebKit apply to every redirect of a form's
  post, so the 303 to `/admin/` was stopped there with no error page, after
  the code was spent; Firefox follows it. A link is not a form's post. With
  Access gone, a direct redirect to `/admin/` would stay on the site's
  origin; no story has taken that up. Not chosen: allowing Access's origin
  in `form-action` on `/sign-in/code`; documenting "open `/admin` first".
- **Making an admin ends every session the account holds** (the
  recommendation): `promoteAdmin` adds 1 to the session version, the
  session renewal a grant of rights calls for, as #225's revoke does. Without
  it a removal only suspended: made an admin again within 12 hours of their
  last admin sign-in, someone found a cookie from before the removal open
  again, with no new password and no code. *Since #274 a remembered phone's
  cookie lasts 30 days, so without the bump that window would be 30 days
  wide.* A removal still ends nothing but the admin pages. Not chosen:
  refusing admin cookies older than the promotion's log entry; a
  grant-time column in a migration 0014; correcting the docs only.
- **A sign-in makes the browser one person** (the recommendation): the
  password step at `/sign-in`, `/set-password` and a code step whose role
  was taken away delete any `__Host-admin` the browser holds. So someone
  signing in where an admin left theirs open is not that admin on `/admin`,
  and their Sign out does not end the admin's sessions everywhere. Not
  chosen: signing out only the account cookie's account; keeping it and
  correcting the comment.
- **0013 and the owner reach production at step 8, before the merge** (the
  recommendation, on the review's escalation). From this story `signIn`
  reads `admin_role`, so a release ahead of 0013 would answer every
  `/sign-in` with a 503, for parents and coaches too (cairn's open fault
  `promotion-ships-ahead-of-its-migrations`). Not chosen: also a story for a
  release-PR check of `/api/health`'s migration; README alone.

Defaults the other findings asked for, taken while fixing:

- **A new password deletes the account's codes**, in `setPassword`'s batch,
  so the reset the email and the limit's page advise lifts the day's limit
  at once: someone who spent the codes with the old password cannot keep
  the admin out for a day. *Measured* before the fix: the reset left the
  limit standing for 86,000 seconds.
- **The code is spent after the reads.** `checkCode` claims the try and
  checks the code, the route reads who it signs in, and `useCode` spends it.
  A read that fails now leaves the code to be sent again, where spending it
  first answered "try again" for a code no longer there (cairn:
  `a-route-of-separate-writes-answers-from-its-last-commit`, its third
  instance after #158 and #221).
- **Sign-out is one statement per account**, holding every version its
  cookies carry, so its 503 always means nothing ended. Two calls, the
  second a no-op that could still fail, answered 503 for sessions that had
  ended.

### 31. Revoking a person, hiding what they sent, deleting an account

**Built in #225, 2026-10-07** (D17). On `/admin/people` an admin revokes an
approved person for a team or every team, hides every photo an account sent,
deletes an account a person asked by email to have deleted, and lets a
deleted revoked account's address ask again. `lib/people.js` holds the four
(`revokeTeams`, `hidePhotos`, `deleteAccount`, `allowAddress`),
`lib/people-page.js` the forms, `functions/api/admin/people/` the presses, and
migration 0014 the revoked addresses. README.md, The photo site, Approving
accounts, is the operating record. The owner's decisions at pickup, through
the question tool, each the recommendation:

- **Revoke and Delete refuse an account holding the admin role.** The owner
  presses "Remove admin" first (item 30), and then any admin acts on that
  person as on anyone. So taking an admin's access away stays the owner's
  alone, as #224 made removing one, with no second authority path to build.
  Every statement of both carries the condition, and 0013's triggers stand
  under it for the owner. Not chosen: the owner revoking or deleting an
  admin in one press, with a full revoke also taking the role; any admin
  acting on anyone but the owner.
- **"Unless the owner allows it" works two ways** (criterion 5). While the
  account exists, approving a revoked team takes the person back, and once
  no team is left revoked the address's hold is lifted in the same batch.
  After a delete, an admin types the address into "Let it ask again", which
  deletes its keyed hash. Both are logged, and nothing is emailed. Not
  chosen: re-approval only, which would hold a deleted revoked address back
  for good; both ways for the owner alone.
- **The delete is held to the reply by a box that must be ticked**
  (criterion 7): "<address> replied to confirm they asked for this", and the
  route refuses a press without it. It is the admin's word, as #219 chose a
  reply over trusting a From address, since the site cannot read mail
  (Resend receiving stays off, item 21). README's procedure, write to the
  address and wait, is unchanged. Not chosen: the site emailing a one-time
  link that deletes when opened; the box plus typing the address out.
- **"Hide all their photos" needs its box ticked**, a box naming the count
  ("Hide the 3 photos … sent (2 public, 1 waiting)"), so a mis-press changes
  nothing. Not chosen: one press; a native dialog, which needs JavaScript on
  a page of plain forms.

The rest are defaults, recorded on #225 at pickup or taken while building:

- **The revoked address's keyed hash is written when the revoke happens**,
  into `revoked_addresses` (0014): `emailHash` under `ADDRESS_HASH_KEY`, the
  key failed sign-ins count an address by (item 27), and `account_id
  REFERENCES accounts ON DELETE SET NULL`. So README's delete by hand keeps
  the hold too, a re-approval lifts it in its own batch with no key, and
  after a delete the row names no account, as `/policy` says. `/ask` makes
  the address's key for every request, and `requestAccount`'s account insert
  is now an `INSERT … SELECT … WHERE NOT EXISTS` that hash, so a new, a known
  and a held-back address run the same two statements (#220's criterion 4).
  `requestAccount` refuses a call with no key, so no caller can skip the
  hold by forgetting it. Not chosen: writing the hash only at the delete,
  which no statement typed by hand can do; a hash kept on the account and
  copied out by a delete trigger, whose body inserts, which
  `test/site.test.js`'s additive check refuses. **Rotating `ADDRESS_HASH_KEY`
  lifts every hold at once** (README, Secrets).
- **Every revoke adds 1 to `session_version`, a single team's included**
  (criterion 2), so the person signs in again to the teams they keep, and a
  re-approval later cannot bring a cookie from before the revoke back. The
  revoke's batch is the log entries, the hash, the bump and the teams'
  change, every statement held by the same condition. Nothing is emailed,
  and the photos are untouched: the approved ones stay public (criterion 3).
- **A waiting photo is hidden too, and "Put it back" returns it to the
  queue, never onto the site** (criterion 4; `/policy` says every photo is
  checked first). 0005's CHECK requires `approved_at` on a hidden row, so
  such a photo carries 0 (`WAITING_WHEN_HIDDEN` in `lib/removals.js`), which
  no approval is ever made at, after 0012's placeholder zeros. `restorePhoto`
  sends it back `pending` with `approved_at` NULL, and `/admin/removals`
  marks it "was waiting for approval". Until #225 `restorePhoto` made every
  hidden photo public. Not chosen: a migration column saying where a hidden
  photo came from, which would still need the placeholder; leaving waiting
  photos out, which criterion 4 names; turning them down, which deletes
  them, where criterion 4 asks that each can be restored.
- **A hide writes no note**, as README's statement by hand writes none. A
  note naming the account would put the person's name on photo rows that
  outlive a delete. `/admin/removals` names the account through its join
  while the account exists. A photo already hidden keeps its own time and
  note.
- **The three forms sit in one native `<details>` per person**, "Revoke,
  hide their photos or delete", its summary naming only what applies (an
  admin's says only "Hide their photos"). People revoked from every team
  have a list of their own, Revoked, between Approved and Turned down; a
  partly revoked person stays under Approved, with the revoked team's
  unticked box under Approve. `peopleLists` reads each account's waiting and
  public photo counts in one grouped statement for the hide box.
- **A re-approval emails the usual set-password link**, as every approval
  does; someone who already has a password can ignore it.
- **"Let it ask again" logs the person by the newest log entry naming the
  address**, and changes nothing (`unmatched`) when none names it as typed:
  `COLLATE NOCASE` folds A to Z only, where `emailHash` lowercases every
  letter. An address whose account still exists answers that it does, since
  re-approving is the way back there.
- **Until #226, a revoked person who also held an invite cookie could still
  send through the invite link**: an upload fell back to that cookie when
  the account's session no longer held (item 29's stated cost). #226 ended
  it: an upload takes an account's session alone.
- **0014 reaches production before the release that carries #225.** From
  this story `/ask`'s account insert reads `revoked_addresses`, so a release
  ahead of 0014 would answer every request with a 503, the class item 30's
  last decision names. Production's `/api/health` names the newest
  migration it holds.

**#225's review, 2026-10-07.** `review-fanout` confirmed 8 findings and
dropped 3 more over its cap; the owner chose to fix all 11, each with a test.
Its one escalation, and the ux-design audit's pre-existing failure, were the
owner's:

- **A delete cuts its photos' takedown time to the day** (the
  recommendation, on the escalation). "Hide all their photos" stamps one
  second on every photo and on the log's `hide` entry, which names the
  person and outlives the account, so matching the two would still say which
  photos a deleted person sent, against `/policy`'s "no longer record which
  account sent them" (cairn: `a-timestamp-joins-to-the-log-that-names-it`).
  `deleteAccount` moves `hidden_at` on the account's photos to the start of
  its UTC day (`HIDDEN_DAY_SECONDS`), put-back photos included, and README's
  delete by hand gained the same statement as its step 3. `/policy` says a
  photo that had been taken down keeps only the day. `test/policy.test.js`
  and `test/revoke.test.js` test the join itself, with its control. The day
  still narrows it where few photos were hidden that day. Not chosen: saying
  so on `/policy`, as was chosen for the request log's time (item 25), since
  that log row lasts an hour and the admins' log lasts for good; a README
  step alone.
- **#224's "Make admin" and "Remove admin" are named from their own words**
  ("Make admin: <name>"), against the recommendation of a story under #216.
  axe's `label-content-name-mismatch` (WCAG 2.5.3) flagged them beside #225's
  own "Hide all their photos", and a test now holds every named button on
  `/admin/people` to a name that starts with its visible text.
- Among the fixes: **the Revoked section no longer says revoked people
  "cannot sign in or send"**. Until #226 the invite link (held, or joined
  again) and a coach's sign-in still sent, and the page and README said so
  with the way to end it (rotate the code; take them off `COACH_EMAILS`);
  #226 removed that sentence from both. The
  `has-account` notice points at the person's own form, since a partly
  revoked person is not under Revoked. The queue's caption notice says
  "approved or hidden", since Hide all is the first way a waiting photo leaves
  the queue unapproved.

**D1 rows written, measured** on `madcowphotos-preview` on 2026-10-07 with
`wrangler d1 execute --remote --json`, the statements with probe values, a
planted hold and a probe account, every probe row deleted after (the probe
spent preview's account id 6):

| Statement | Rows written | Rows read |
|---|---|---|
| `/ask`'s account insert, new address (`INSERT … SELECT … WHERE NOT EXISTS` the hold) | 3 | 6 |
| The same, an address already there | 1 | 7 |
| The same, a held-back address | **0** | 5 |
| A revoke's hold, new or already there (`ON CONFLICT … DO UPDATE`) | 2 | 6 |
| Deleting an account whose hold stays (one team, the hold set NULL) | 3 | 14 |

So the new insert costs what item 25's `VALUES` form did for a new and a
known address, and a held-back address costs nothing written: SQLite makes
no row for the `SELECT` to insert, so the AUTOINCREMENT counter does not
move. Both new statement shapes ran on D1 as they do on node:sqlite. The rest
of each revoke, hide, delete and lift is one batch of two to four guarded
statements, not measured.

### 32. "Not sure / other event", and moving a photo into its event

**Built in #228, 2026-10-07** (epic #147). A sender with photos from an
event nobody has added yet chooses its team's "Not sure / other event", and
an admin moves the photos into an event on `/admin/queue` before approving
them. Migration 0015, `lib/albums.js`, `lib/queue.js` (`movePhotos`) and
`functions/api/admin/queue/move.js` hold it. README.md, The photo site,
Albums and Approving, is the operating record. Four decisions were the
owner's at pickup, through the question tool:

- **A marked album per team, with the database's guard** (the
  recommendation). Criterion 5 keeps `photos.album_id` NOT NULL and
  referencing `albums (id)`, so a Not sure photo names a real album row.
  0015 adds `albums.holding` (0 or 1), one Not sure album per team by a
  unique index, and makes the two rows; six triggers refuse a photo in one
  being approved, or hidden other than while waiting (on insert, on a change
  of state or `approved_at`, and on a move in), `holding` changing either
  way, a Not sure album's delete, and a REPLACE INTO or UPDATE OR REPLACE
  that would make, remove or take over one (the hole #227's 0011 closed for
  `teams`; the UPDATE half was review-fanout's at #228's review, where the
  insert trigger alone let an event's approved photo end up in a Not sure
  album). Every path to a second Not sure album meets a trigger first, so
  the index states the invariant and is a spare. Not chosen: the same column
  with the app's check alone, which a statement typed by hand or a later
  route could pass; two ordinary album rows known by a reserved address,
  which every query would recognise by convention and `/admin/albums` would
  let an admin edit or delete.
- **"Hide all their photos" hides a waiting Not sure photo too** (owner, at
  #228's review, the recommendation). #225's Hide all hides waiting photos
  with `approved_at` 0, and the first build of 0015 refused any hidden photo
  in a Not sure album, so Hide all on an account with a waiting Not sure
  photo rolled back whole and answered 500, leaving the person's public
  photos up. The triggers now allow `hidden` with `approved_at` 0, which
  "Put it back" returns to the queue, never to the site. Not chosen: Hide
  all skipping Not sure photos, which leaves part of what the person sent
  in the queue; Hide all rejecting them, which cannot be undone.
- **Move works on any waiting photo** (against the recommendation of Not
  sure photos only): one a parent sent to the wrong event moves the same
  way, within its team. Not chosen: Move on Not sure batches only.
- **An admin can close a team's Not sure album**, and only close and reopen
  it (the recommendation): `/admin/albums` lists each team's in a section of
  its own, with no Edit and no Delete. Closing every album still stops every
  upload, as it did before #228. Not chosen: always open, which would leave
  no way to stop uploads from the admin pages short of rotating the code.
- **A Not sure batch has no Approve, and says why** (the recommendation): a
  photo there has no event to be public in, so it is moved first and
  approved in its event. A press naming one anyway (an old or forged page)
  leaves it waiting, approves any event photo beside it, and the notice says
  so (`?error=not-sure`, `&not-sure=<n>`). Not chosen: Approve shown and
  refused on every press, buttons on every Not sure batch that never work.

The rest were taken while building:

- **0015 is applied to each database just before the code that reads it
  reaches it**: the preview just before the merge into `develop`, and
  production just before the promotion that carries #228, not at the
  commit gate as 0004 to 0014 were. Its rows are what the older code
  cannot read: to it each is an ordinary open event dated year 1, offered
  on the share page (preselected when every event is in the future), with
  Edit and a Delete that answers 500 on `/admin/albums`, and an Approve that
  answers 500 on the queue (review-fanout at #228's review). The other order
  is worse: #228's code reads `holding` on every album read, uploads
  included. The migration's header says the same.
- **The rows are dated 0001-01-01**, at `0001-01-01-not-sure-<team>`, kind
  `regatta` (a placeholder 0004's CHECK needs; nothing shows it). No admin
  form can give an event that date, since `isDate` reads a year under 100 as
  19xx and refuses it, so no event's address can clash with one. A third
  team needs its own row in the migration that adds it, and
  `test/not-sure.test.js` fails until every `TEAMS` entry has exactly one.
- **The open list gives them apart**: `GET /api/albums/open` answers
  `{ albums, other }`, the Not sure albums in `other`, in the teams' order,
  with no title, so nothing that preselects or counts events can take one
  for an event (they sort last as "the latest past album", which the
  preselect would otherwise pick when every event is in the future). The
  share page writes their words itself and puts each last in its team's
  group, a team with no event open getting a group of its own after the
  teams with events. The "no album is taking photos" note shows only when
  neither list holds anything.
- **Move's choices are the batch's team's events**, newest first, open or
  closed (marked so), never another team's, a Not sure album or the batch's
  own album, then "A new event, below", whose title, kind and date sit under
  the list and make an event for the batch's team as **Add album** would.
  One select per batch, shared by Move all and each photo's Move: a select
  per photo is 200 in a full part. The new event's fields are not
  `required`, since every button in the batch posts the same form; the route
  checks them, and a wrong field adds nothing and moves nothing.
- **A move is one statement**: `UPDATE … FROM` the chosen album, held to
  `holding = 0` and to the photo's own team in the same statement, so an
  album moved to the other team meanwhile takes nothing. It moves waiting
  photos only and keeps their batch, so the queue shows them as a batch of
  the event they are in now, and the press lands on the first photo it
  moved, there, ready to approve (owner, at #270's pickup; until then at the
  batch, on its first part when it held more than 200 there). The captions
  typed are
  saved first, as every press saves them, and before the choice is checked,
  so a press with no event chosen loses nothing typed. A press whose photos
  now sit in two teams' events, from a stale page, moves nothing and says so
  in its own words (`?error=teams`), since its captions were saved.
- **The photos are read before a new event is made**, so a press for photos
  no longer waiting makes no empty event. If they go between that read and
  the move, the event is kept and the notice says both.
- **`/policy` says the album a photo was sent to, "or the event an admin
  moved it into"**: a move changes `album_id`, and the row keeps no other.

### 33. Clips: sent in parts, checked, and waiting in the queue

**Built in #198, 2026-10-08** (epic #147), on item 10's design. A parent or
coach sends a clip from `/share/` as an R2 multipart upload, in parts of 25
MiB. The page first blanks the clip's location and camera data in place
(`public/js/clip.js`, `planClip`). Once the parts are joined, the server
reads the clip's boxes with ranged reads (`checkClip`) and deletes a clip
still holding anything outside the keep-list. A checked clip waits in
`/admin/queue` beside the photos, where an admin plays it through
`functions/api/admin/clips/[id].js` (206 ranges) and approves, rejects,
moves or captions it as a photo. Nothing public shows a clip yet: that is
#286. `lib/clips.js`, the four routes under `functions/api/upload/clips/`,
migrations 0016 and 0017 and `lib/queue.js` hold it; README.md, The photo site,
Uploads and Approving, is the operating record. The owner's decisions,
through the question tool:

- **The story widened to the admin queue** (owner, at pickup, against the
  recommendation). On `develop` every queue, approval, Move and image
  statement named `kind = 'photo'`, so a clip the story stored would have
  waited where no admin could see it, billed from the day it landed (item
  8). #198 shows clips in the queue, plays them, and approves, rejects,
  moves and captions them; public serving (the album pages, the lightbox,
  Remove this photo and Hide all for a clip) is #286. Not chosen: the sender
  as filed with the queue filed as a sibling (the recommendation), which
  leaves a release where clips arrive and no admin sees them; splitting
  first and building the server half alone; running groom-backlog on the
  video half first.
- **Size caps: 1 GiB for a parent's clip, 4 GiB for a coach's** (the
  recommendation), `CLIP_BYTES` and `clipBytes(session)` in `lib/photos.js`,
  beside D11's 3 and 15 minutes (`CLIP_SECONDS`). The page refuses a clip
  over either before sending anything, and the start route refuses it again
  before any part is stored; the complete refuses a clip the server itself
  reads as longer. Not chosen: 512 MiB and 2 GiB, which refuses a 3-minute
  4K phone clip; one 4 GiB cap for everyone.
- **Criterion 1's CPU figure is measured after the merge** (the
  recommendation): a 25 MB part on the `develop` preview, by item 8's
  per-minute GraphQL method, at the story's step 9. The account has been on
  Workers Paid since 2026-10-05, which is the criterion's own fallback. Not
  chosen: annotating it moot; shipping a probe to `develop` before any clip
  code.
- **Criterion 4's clips: the owner's Samsung over adb, and published sample
  originals** standing in for the iPhone and the action camera. Those two
  halves are real device files, not the owner's devices. Not chosen: an
  iPhone lent for a session; an action camera of the owner's.
- **The recorded times are zeroed** (the recommendation). `mvhd`, `tkhd`
  and `mdhd` carry when the clip was made and last changed; the walker
  zeroes both times in place, and the server's check refuses a clip that
  still holds one, so `/policy`'s promise of no hidden details holds for
  clips. The row still records when the clip was taken: `captured_at` is the
  page's reading of `mvhd` before zeroing, or the file's date when that is
  missing or implausible. A player shows the file's date as 1904. Not
  chosen: keeping the times, with a `/policy` sentence saying so. Item 10
  had left this to the video stories.
- **Hide all stays photo-only, and says so** (the recommendation).
  `/admin/people`'s box says the person's waiting clips are not hidden and
  are rejected in the queue. Not chosen: Hide all hiding waiting clips too,
  which brings clips into `/admin/removals` (#286's); Hide all rejecting
  them, which "Put it back" cannot undo.
- **A clip card loads nothing until Play** (the recommendation):
  `preload="none"`, with the clip's length and frame size in text. The
  queue reloads after every press, and every range request is a Functions
  request. Not chosen: `preload="metadata"`, a first frame for 1 to 3
  requests per clip on every load.
- **Counts name both kinds** (the recommendation): "3 photos and 1 clip
  waiting for approval", and today's words exactly when no clip waits. Not
  chosen: one neutral count, which changes today's wording for photos; a
  fourth to-do button, on a phone's first screen that #269 measured as
  already full at 320 by 568.
- **The lifecycle rule was applied in the dashboard** (the recommendation),
  2026-10-08 at about 17:52 UTC: "Abort unfinished uploads after 1 day" on
  `madcowphotos-preview` and `madcowphotos`, the whole bucket, beside R2's
  own 7-day default. The session filled in each form, and each Save waited
  for the owner's go-ahead; both lists were read back after a reload.
  **R2's Add dialog opens with "Delete uploaded objects after:" ticked.**
  Saved that way with a number in it, a rule deletes every object in the
  bucket after that many days, every approved photo included. It was
  unticked on both. Not chosen: a short-lived R2 token and `wrangler r2
  bucket lifecycle add`; changing R2's default rule from 7 days to 1, whose
  name would then say nothing of the change.
- **A QuickTime file with no ftyp is a MOV** (owner, once the walker was
  built, the recommendation): one whose first box is `wide`, `mdat`,
  `moov`, `free` or `skip`, as QuickTime files were before `ftyp` existed.
  A current iPhone's Live Photo video starts that way (an iPhone 14 Pro's,
  iOS 17.0: `wide`, `mdat`, `moov`), and the build spec had refused it as
  not a clip. Read as a MOV, the published one blanked clean: exiftool found
  none of its 24 identity tags afterwards, and every frame hashed the same.
  Not chosen: refusing it, which refuses a Live Photo's video picked as a
  file.
- **The share page's words for a clip give its own reason** (owner, the
  recommendation): a clip over a cap says its own length or size beside the
  cap ("This clip runs 4:00, longer than the 3 minutes you can send, so it
  won't be sent. Trim it, then add it again."), and a 422 says the site
  found details still in it and deleted it. Not chosen: one line for every
  server refusal, which tells a clip deleted for leftover details to try
  again, where it fails the same way.
- **The summary says clips are not shown yet** (owner, the recommendation):
  "Sent 2 photos and 1 clip. The photos will appear in the album once
  they're reviewed. Clips aren't shown on the site yet." With no clip it
  reads as before; #286 changes the one sentence. Not chosen: saying only
  what was sent, which drops the photos' line; saying who sees a clip,
  the longest to hear.
- **Photo-only words change only where a clip makes them wrong** (owner, the
  recommendation): the line asking to keep the page open until everything
  says Sent, and the two notes about shared files. Not chosen: leaving
  every line, where "every photo says Sent" reads as done while a clip
  still sends; naming clips everywhere, title and heading included.
- **A clip refused for good offers no Try again** (owner, at the share
  page's review, the recommendation): a 422 (details the site does not
  keep) or a 413 (too long or too large). Its words already say to leave it
  out or trim it, and sending it again, up to 4 GiB, meets the same refusal.
  The summary asks for Try again only where it is offered. Not chosen:
  changing the summary only, which still offers a resend that cannot work;
  leaving it as built.
- **Remove is withdrawn while the server joins and checks a clip's parts**
  (owner, the recommendation). Not chosen: Remove to the end, where a clip
  stored a moment before the abandon waits in the queue though the page
  dropped it.
- **Two rare queue notices keep a photo's words** (owner, the
  recommendation): "gone", when a press names a clip another admin got to
  first, and the over-200 caption error, which only a page without its
  script reaches. Naming the kind there costs a statement every press makes,
  or a form field. Not chosen: neutral words for both, which change today's
  photo wording; a hidden field per batch listing its clips.
- **The `SET rowid` hole in #224's and #228's guards is its own story,
  #288** (owner, the recommendation), found while building 0016 (below).
  Not chosen: folding both fixes into 0016 before it is applied anywhere,
  which widens #198; recording it as a stated limit with no fix.
- **A day's clips have a size budget: 10 GiB an account, 40 GiB a coach's**
  (owner, at #198's review, the recommendation), after the security audit's
  SA-1. The 500 alone bounded a day of photos at about 2.2 GB but let a day
  of clips reach 500 GiB, or 2 TB from a coach, billed until an admin
  rejected them (item 8). `CLIP_DAY_BYTES` and `clipDayBytes(session)` in
  `lib/photos.js`; `spendDailyClip` spends one of the 500 and the clip's
  declared size in one statement, kept in `upload_counts.clip_bytes`
  (migration 0017), and the start refuses past either with 429,
  `daily-cap` or `clip-bytes`. The size goes back with the one, wherever
  that is given back. The complete refuses a stored clip of any size but the
  one the start spent, so the budget counts what is stored. Ten parents' 1
  GiB clips, or ten of a coach's, fit a day. `/policy` says so in Clips, and
  in what the site keeps. Like the 500 (item 14), it is the account's,
  shared by every phone signed in to it. It was decided while an invite-link
  session still had a budget of its own, which whoever held the code could
  renew by joining again; #226 retired the link before #198 merged, so a new
  budget now takes a new account an admin approves. Not chosen: leaving the
  count as the only bound, which a misused invite link would have turned
  into storage billing; a story after #198.
- **A complete that got no answer is asked about, never abandoned** (owner,
  at #198's review, fixing all 11 of its findings). Any one of a
  complete's tries may have stored the clip, and the review measured the
  old abandon being answered as settled and Try again storing the clip
  twice. So the page keeps the complete, and **Try again sends it again
  first**: 201 is Sent, a complete that never arrived is joined from the
  parts already in the bucket with none sent again, and a 404 starts
  afresh in the same press. **Remove asks through the abandon**, which
  answers 409 `stored` for a clip this account already stored; the page then
  shows "Sent. It reached the photo site before you pressed Remove." Remove
  never sends the complete: the owner first chose to re-send it, and amended
  that at a second question once it was seen to store a clip whose complete
  never arrived, after the sender had pressed Remove. Not chosen: the
  session withdrawing its own stored clip through the abandon, which widens
  that route into a way to delete one; Remove taking the item as before,
  which leaves a stored clip waiting that the sender removed.
- **The gap a rejoin left was accepted as a limit, and #226 closed it**
  (owner, the recommendation, before develop's cutover was merged in). The
  clip token is signed over `sessionKey`, which held a parent's or a coach's
  join time, so after a lost complete and then a rejoin before the press,
  the server read the old token as another session's and answered 404: Try
  again stored the clip a second time, and Remove took off an item whose
  clip was stored. Measured on the share page's harness. Since #226 every
  session is an account's, whose key has no join time, so signing in again
  keeps the token good. Not chosen: keeping the complete across a 401,
  which still met the 404 after a rejoin; the page counting its own joins,
  which covered one tab only; a token that survives a rejoin, which reopens
  the token decision below. **A clip an admin rejects before Try again is
  still a limit** (owner, the recommendation, from the fix's verifier): the
  reject deletes the row, the complete sent again answers 404, and the page
  sends the clip afresh, so it waits again.
  Not chosen: remembering rejects on the server, which needs a migration
  and reverses item 16's row-first delete; failing on that 404 instead of
  starting afresh, which the next press repeats.
- **A caption is read-only while its clip's complete is unanswered**
  (owner, the recommendation). The caption went with the start, so an edit
  then would show words the stored row never got. Not chosen: leaving it
  editable; putting the start's caption back once the clip shows Sent,
  which makes the sender's edit visibly disappear.
- **An album holding a clip names it in the delete refusal** (owner, at
  #198's review, the recommendation). One statement counts photos and clips
  apart, with how many clips are approved or still being sent, and the
  notice reads "it holds 2 photos and 1 clip". A clip no admin page shows
  gets a sentence saying where it goes: "An approved clip is not on any
  admin page yet: the site's owner deletes it by hand." and "A clip still
  being sent is cleared a day after it started if it is never finished."
  An album holding photos alone lands and reads as before. Not chosen:
  naming both kinds with no pointer, which leaves an admin looking for a
  clip no page shows; keeping the photo words beside the rare notices
  above.

The rest were taken while building:

- **An upload belongs to the session that started it, by a signed token**,
  `clip1.<id>.<bytes>.<sig>`: an HMAC with the session key over the id, the
  declared size and `sessionKey(session)`, answered at the start and sent
  back in a `Clip-Upload` header on every part, complete and abort, and
  checked in constant time. Another account or size reads as an unknown
  upload (404); since #226 every session is an account's, so another phone
  signed in to the same account carries on. Its prefix is `clip1.`, not
  `c1.`, which a coach's cookie used until #226. Not chosen: matching the
  row's sender columns, which let any coach carry on any coach's upload; a
  column holding a hash of the session, which kept coach-identifying data on
  the row (#192).
- **No new column and no new index: 0016 is ten triggers.** The declared
  size travels in the token, as 0005 chose not to store page-declared values
  while a clip uploads. The triggers hold a clip's type to the two the check
  gives, its type and a length over 0 outside `uploading`, its upload id
  while uploading and at no other time, `uploading` left only for `pending`
  and never entered again, and every row's kind, through a REPLACE INTO or a
  moved id too. Not chosen: the caps in triggers as well, two places to
  change them. Either order of applying 0016 and deploying the code is safe:
  nothing before #198 writes a clip.
- **0016's guard against a REPLACE has an update side with no column list.**
  *Measured on node:sqlite 3.53 and local D1:* a `BEFORE UPDATE OF id`
  trigger does not fire on `SET rowid`, `SET oid` or `SET _rowid_`, so
  `UPDATE OR REPLACE … SET rowid = <id>` moves a row onto another's id
  unseen. `photos_id_kept_on_update` fires on every update and looks past
  its first test only when the id moves. Its insert side reads only an id
  over 0, since `NEW.id` is -1 in a `BEFORE INSERT` that names no id, and a
  row given -1 by hand would otherwise fail every later clip. An upsert or
  `INSERT OR IGNORE` naming a clip's id is refused, not skipped: a `BEFORE
  INSERT` trigger runs before the conflict clause, and nothing here inserts
  that way. Not chosen: guarding `media_key`, whose clash removes a row and
  adds one under a new id, so no id changes kind or state. 0013's
  `accounts_admin_not_displaced_by_key` and 0015's
  `albums_holding_kept_on_update` are `UPDATE OF id` triggers and miss the
  same spellings. Measured on local D1, an `UPDATE OR REPLACE … SET rowid`
  past the first removed the owner's row, and one past the second left an
  approved photo in a Not sure album. Only a statement typed by hand reaches
  either; #288 closes both.
- **A clip spends one of the day's 500** at its start, with its declared
  size of the day's clip budget, both given back on the day they were spent
  (the row's `sent_at`, not now) when it is abandoned, fails the check, or
  its album closes or its team is revoked while the parts arrive. The size
  given back is the token's, the one the start spent. A refusal reads which
  limit refused with one statement more, made only then.
- **0017 is applied before the code, unlike 0016.** A clip's start names
  `clip_bytes`, and so does every give-back, a photo's included, so code
  ahead of the column answers 503 to every clip and logs every photo's
  give-back as failed. The column is `NOT NULL DEFAULT 0` with a
  `CHECK (clip_bytes >= 0)`, so every row before it reads 0 and the
  give-back's `MAX(…, 0)` is the second guard, not the only one.
- **An abandoned upload is cleared a day after it started**, at most 20 at a
  time, at the start of every clip and on every admin home load, since
  Pages runs no scheduled job: one `DELETE … RETURNING` of the rows still
  uploading, then each one's R2 upload aborted and any object deleted. That
  matches the lifecycle rule. No day's upload is given back: that day is
  over.
- **The page sends the parts' etags at the complete**: the R2 binding has
  no call that lists an upload's parts. `uploadPart` takes a body of known
  length, so the part route checks that `Content-Length` is the part's exact
  size before it reads a byte; R2 itself checks that the parts are the same
  size only at `complete()`. Its errors carry their code at the end of the
  message, as "(10024)": NoSuchUpload 10024, InvalidPart 10025 and 10048,
  EntityTooSmall 10011. After the join, or a NoSuchUpload (joined by a
  complete whose answer was lost, or aborted), the route reads the stored
  object with one `head()` for its size and type: R2's documentation types
  `complete()`'s answer as an object without saying it carries the type the
  upload started with. A retried complete for a clip already checked
  answers 201.
- **A refusal takes the row back first**, and only while it is still
  uploading, then the parts or object, then the day's upload, for the
  reason a reject deletes its row first (item 16): a complete that finished
  the clip meanwhile has made it pending, and then nothing touches its
  object.
- **A complete that finds its row gone says so.** When `finishClip` finds
  no row uploading and `dropClip` takes none back, the complete reads the
  row again: one there was stored by another complete (201), none was taken
  by the day-old sweep, by an overlapping complete refused 409, or by the
  sender's Remove (404 `upload`, which the page offers Try again for), and a
  read that fails is 503. It answered 201 for both until #198's review,
  which showed Sent for a clip with no row and no object. **The abandon does
  the same** when its own take-back finds nothing: a row a complete still
  running stored meanwhile is 409 `stored`, none is 404, since a 404 there
  would have Remove drop a stored clip (the fix's verifier, *measured* with
  the two routes interleaved).
- **The walker, beyond item 10's rules.** Inside kept boxes it zeroes every
  `hdlr`'s manufacturer, flags and name (box bytes 20 on), a visual sample
  entry's vendor and compressor name, and an audio sample entry's vendor
  only, since its version and revision decide QuickTime's layout; `stsd` is
  still never blanked. It refuses a fragmented file: no phone camera's
  writer was found that makes one, and the browser's recorder does. It sends
  nothing after the last whole top-level box, where Insta360's GPS records
  and Samsung's SEF trailer sit, so no offset moves. It blanks `tref` in a
  kept track, which links only to tracks it blanks. Every sample entry of a
  kept track must be on a codec allow-list (`VIDEO_FORMATS`,
  `AUDIO_FORMATS`), so an MJPEG track whose frames carry EXIF cannot pass.
  A frame that reads 0 wide or 0 high, by `tkhd` and then by the sample
  entry's coded size, is malformed: 0005's CHECK would refuse it in the row,
  which reached the page as an outage after every part had gone and was
  re-sent in full on every Try again (#198's review).
  Its own defaults, each stated in `public/js/clip.js` where it is used: at
  most 64 top-level boxes, since each is one ranged read on the server; one
  `moov`, since players differ on which of two they read; a photo told apart
  by its major brand alone; every chunk a kept track plays inside a
  top-level `mdat`; a blanked track's `dref` held to the same
  self-contained rule; and a trailer known by bytes that read as no box
  type. *Measured in Node 24 on this machine, not on the edge:* the largest
  real clip read, an 11.6 MB HERO5, planned in 3.4 ms and its copy checked
  in 1.0 ms; a `moov` the size a 15-minute 60 fps clip carries (778 KB)
  planned in 5.6 ms and checked in 2.5 ms.
- **The length a clip is held to is `mvhd`'s**, the movie's own duration,
  which is what a player shows. A file edited to understate it passes the
  length cap and is held by the size cap alone. The share page sends what
  the walker read, so only a request made by hand meets this.
- **One clip sends at a time**, taking one of the page's three slots, and
  photos keep the others. The page learns its caps from `GET
  /api/albums/open`, which answers `clip: { seconds, bytes, dayBytes }` for
  the session beside `albums` and `other`. `dayBytes` is only named, when
  the start refuses a clip with `clip-bytes`: the server alone knows how
  much of a day is spent, across an account's phones. That refusal fails the
  clip and every queued clip, and photos still go.
- **The page and the server read one keep-list.** `share.js` is a classic
  deferred script, so `/share/` loads `/js/clip.js` before it with `<script
  type="module">`, which sets `window.MadcowClip`; `lib/clips.js` imports the
  same file through the Functions bundler.
- **The admin clip route decides 206 from the parsed request**, never from
  whether R2's object carries a `range`: miniflare sets one on every get.

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
