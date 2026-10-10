# madcowsailing.com

Monorepo for **three** sites that share one design system, despite the
repo's name. Two are static; the third runs server code:

| Site | Directory | Audience |
|---|---|---|
| madcowhq.com | `hq/` | Hiring managers, recruiters, collaborators |
| madcowsailing.com | `sailing/` | Sailors |
| photos.madcowsailing.com | `photos/` | The team's families: albums anyone can browse, uploads from approved accounts (epics #147, #216) |

They share `shared/` — tokens, base CSS, the logo files. They share no content.
The photo site is the one with server code (Pages Functions, D1, R2); see
[The photo site](#the-photo-site) below and `CLAUDE.md`, The photo site.
`CLAUDE.md` is the project context and the quality floor; `docs/design-brief.md`
is the visual direction. Read those before writing anything.

## Branch model

Three long-lived branches. The rule underneath is that **the branch a deploy is
built from is never pushed to by hand.**

| Branch | What it is | How it is entered |
|---|---|---|
| `develop` | Integration, and the repo default. Cloudflare Pages builds a **preview** from it — and from it alone; see [Previews](#previews-build-from-develop-only) below. | A pull request from a feature branch, merged by the owner. |
| `release` | **Production.** Pages builds madcowhq.com, madcowsailing.com and photos.madcowsailing.com from it. | A pull request **from `develop`**, merged by the owner. Nothing else. |
| `main` | The **backup branch**: a known-good working version to fall back to if `release` breaks and cannot be fixed in place. Not deployed. **In that state since 2026-09-14** — *measured 2026-09-17*, `main` is `3bff147`, an ancestor of `release` (0 ahead, 64 behind), so a backup has been taken. Verify with `git rev-list --count origin/main..origin/release` rather than trusting this number. | A pull request **from `release`**, merged by the owner — from the branch production actually ran, never from `develop`. Nothing else. |

**`main` changed role on 2026-09-01, by owner directive.** This row read *"Frozen pointer to
the pre-`develop` history. Not deployed, not merged into, kept so old links and clones resolve —
nothing. It is retired."* That was accurate when written and is kept here rather than deleted,
because a branch changing from retired to load-bearing is worth seeing. `main` is now the backup:
the copy to return to when production is broken and cannot be fixed in place. Two things follow.
It is promoted **from `release`** — the branch production actually ran — and never from `develop`,
which is what makes it known-good by construction rather than by anyone's care. Do not take a
backup while production is broken: the point is to keep the last good copy, not to record the bad
one. And it is still **never a base for new work** — a fallback that quietly acquires unreviewed
work has stopped being one. A `main` that has moved is the backup being taken, not drift.

The directive is workspace-wide rather than particular to this repo; cairn's
`memory/global/branch-off-current-develop-2026-07-30.md` carries it for all of them.

### How work reaches `develop`

Branch from `develop`, name it `feature/<issue>-<slug>`, open a PR back into
`develop`. CI runs on the PR (see below). **Pages does not post a preview URL
on the PR** — previews are built for `develop` only, so a feature branch has
none; to see a change rendered before merging, build it locally. The owner
merges.

### How `develop` is promoted to `release`

A pull request from `develop` into `release`, merged by the owner. **Merging
that PR is the production deploy** — there is no separate publish step, so the
merge is the moment the two domains change. Promote deliberately, not as
housekeeping.

That coupling is the reason `release` exists at all rather than deploying from
`develop`: it puts a decision between "this is merged" and "this is live".

## Hosting

Three Cloudflare Pages projects from this one repo. **The dashboard is the only
other copy of these settings** — if a project is ever deleted or recreated, this
table is what rebuilds it. The photo site's bindings (its D1 database, R2 bucket
and `SITE_ENV`) are the exception: they live in `photos/wrangler.jsonc`, and the
dashboard shows them read-only.

| Setting | hq project | sailing project | photos project |
|---|---|---|---|
| Project name | `madcowhq` (`madcowhq.pages.dev`) | `madcowsailing` (`madcowsailing.pages.dev`) | `madcowphotos` (`madcowphotos.pages.dev`) |
| Production branch | `release` | `release` | `release` |
| Root directory | `hq` | `sailing` | `photos` |
| Build command | `mkdir -p assets/shared && cp -R ../shared/. assets/shared/` | same | `mkdir -p public/assets/shared && cp -R ../shared/. public/assets/shared/` |
| Output directory | `.` | `.` | `public` |
| Watch paths (include) | `hq/*`, `shared/*` | `sailing/*`, `shared/*` | `photos/*`, `shared/*` |
| Custom domains | `madcowhq.com`, `www.madcowhq.com` | `madcowsailing.com`, `www.madcowsailing.com` | `photos.madcowsailing.com` |
| Preview branches | `develop` only | `develop` only | `develop` only (Custom branches, include `develop`) |
| Preview access policy | not enabled | not enabled | **enabled**: Access app `madcowphotos - Cloudflare Pages` on `*.madcowphotos.pages.dev`, policy `Allow Members - Cloudflare Pages` |
| Fail open/closed | — (no Functions) | — (no Functions) | **Fail closed** |
| Workers plan (one per account) | **Workers Paid since 2026-10-05** (#218) | same | same |
| CPU time limit (Settings → General → Pages Functions billing) | — (no Functions) | — (no Functions) | blank (`—`), so the plan's default applies |
| Framework preset | None | None | None |

*The photos column was read back from the dashboard on 2026-09-27 (UTC), after
the project was created for #149.* The plan row was read on Workers plans at
23:02 UTC on 2026-10-05, right after the owner moved the account to Workers
Paid for #218, and the CPU time limit row the same evening. One password
hash took 136.5 ms of CPU at the median on Workers Paid, against the free
plan's 10 ms a request (`CLAUDE.md`, The photo site, item 8). Two of its values are not what the create
form leaves behind, and both look set when they are not. **Custom branches
pre-fills Include Preview branches with `*`**, which previews every branch, and
**Build watch paths pre-fills `*`**, which builds on every commit. Adding
`develop` or `photos/*` does not remove the `*`, and the settings summary still
reads "Preview branch: Custom". Open each editor and check that no `*` chip is
left.

The photo site's output directory is `public`, not `.`, so `photos/wrangler.jsonc`,
`photos/migrations/` and the site's tests and Function sources are never
published (CLAUDE.md, The photo site, item 5). Its first build, of `release`
before `photos/` existed there, failed as expected.

One setting per site lives on the **zone**, not the Pages project, and is
invisible from the project page — so it belongs in this table too:

| Zone setting | madcowhq.com | madcowsailing.com |
|---|---|---|
| Redirect Rule | `www to apex (301)` | `www to apex (301)` |
| — pattern | `https://www.*` | `https://www.*` |
| — target | `https://${1}`, 301, preserve query string | same |

Both zones are already on Cloudflare nameservers (`dell.ns.cloudflare.com`,
`lars.ns.cloudflare.com`), so attaching a custom domain creates the DNS record
itself — there is no external registrar step.

**The build command is the only build step in this repo, and it is one line.**
It copies `shared/` into each site as `assets/shared/`, which is why every page
links `assets/shared/css/tokens.css` rather than reaching up out of its own root.
`assets/shared/` is generated and gitignored; never edit it, edit `shared/`.

To reproduce a deploy locally, run the same command from inside `hq/` or
`sailing/` and open `index.html` from disk.

**Watch paths are not cosmetic.** Without them, adding forty photos to a trip log
rebuilds the portfolio site too. With them, a commit touching only `sailing/`
builds one project.

**`www` redirects to the apex, via a zone Redirect Rule — not via `_redirects`.**
Both hostnames are still attached to the Pages project; the rule decides what
happens once a request arrives, not whether it can.

*This said "via `_redirects` in each site" until 2026-08-23, and that never
worked and never could.* Pages matches a `_redirects` source as a **path**, so
an absolute-URL source is rejected outright — and since both hostnames point at
one project, no version of that file can tell them apart. The build log said so
on every deploy while reporting `success`:

```
Parsed 0 valid redirect rules.
Found invalid redirect lines:
  - #15: https://www.madcowsailing.com/*  https://madcowsailing.com/:splat  301
    Only relative URLs are allowed. Skipping absolute URL …
Parsed 3 valid header rules.
```

Worth knowing because the same message was already seen once and misread: when
the accidental Worker of 2026-08-22 rejected that line, it was recorded as
Workers being stricter than Pages, *"not a defect in the file."* Two independent
faults produced one symptom — wrong product **and** invalid redirect line — and
fixing the first left the second untouched and unsuspected.

Measured after the change: `www.*` → `301` to the apex with path and query
preserved, both apexes still `200`. Cloudflare's create dialog warns *"your DNS
configuration may not be proxying traffic for www"* — that warning is a false
negative here (the Pages-managed CNAME is proxied), and **"Create a new proxied
DNS record" is the wrong answer**: it would add a record conflicting with the
Pages custom domain. Ignore and deploy.

`_redirects` is kept in both sites for future **path** redirects, which is all
it can do.

**A missing path answers `404` with the site's own "Page not found" page.**
Each site ships a root `404.html`, and Pages serves it,
with a `404`, for any path its output directory does not hold, at any depth:
`/work/nope.html` and `/apps/nope/` get it too. The browser resolves that page's
URLs against the path that was asked for, not against `/404.html`, which is why
every URL in both files is root-relative. The file also answers at its own
address: `/404.html` 308s to `/404`, which is a `200`. *Measured 2026-09-14
under `wrangler pages dev` 4.131.2, before the merge*: a missing path at the
root and under `/work/`, `/apps/`, `/logs/` and `/apps/race-timer/` answered
`404` with that page's title on #36's branch, and `200` with the home page on
`develop`. Production has carried it since the 2026-09-15 promotion (PR #118);
re-measure there rather than trusting this line.

Until then neither site had a `404.html`, and without one Pages serves
`index.html` with a `200` for every unknown path. *Measured 2026-09-14 (#28)*: a
random `madcowsailing.com/__probe_…` answered `200` with the sailing home page's
title and canonical, and the same path on madcowhq.com with hq's. An uptime
monitor, a status-code link sweep and `curl -w '%{http_code}'` all reported a
page healthy whether or not it was ever deployed.

**A `404` proves a path is missing; a `200` still proves only that something
was served**: a redirect's target, a page left at an old path, a stale copy. So
the check that shows a page is its own reads the body, not the status: the
page's own `<title>` **and** its self-referencing `rel="canonical"`, with a path
that certainly does not exist fetched **in the same run** as a negative
control. That control should now read `404` and "Page not found". If it reads
`200`, the `404.html` has dropped out of the build. Two details catch a first
attempt:

- Pages strips `.html` with a `308` (`/apps/race-timer/support.html` →
  `/apps/race-timer/support`). Follow redirects (`curl -L`) and record the hop,
  or the check reads an empty redirect body. Since #113 every internal link
  names the clean form, which answers `200` with no hop, so fetch that.
- The home page could not pass the title test while the fallback served its
  title for every missing path. With the control reading "Page not found" it
  can. The home page can now be checked by title, since the control reads "Page not
found".

Internal links are held by `tools/linkcheck.py`, which resolves them against
the tree and never asks the host. It resolves an extensionless link the way
Pages does: `/about` is `about.html`, and a directory is its `index.html`
(#113). That stays right after #36: the host reports
a `404` to a visitor who has already followed the broken link, and linkcheck
refuses the link before the push. On the photo site, a path `_routes.json`
sends to a Function (`/`, since #157) is resolved against the route files in
`photos/functions/` instead of a served file.

<a id="previews-build-from-develop-only"></a>

**Previews build from `develop` only, and there is no access policy.** Owner
decision, 2026-08-23, taken with the cost stated: Pages builds a preview per
*branch* commit and skips any branch outside the include list, so **a PR from a
feature branch gets no preview URL and no PR comment.** Only `develop` itself
builds a preview, which is after the merge rather than before it.

This reverses the 2026-08-22 setting, and the reversal was deliberate rather
than a drift — the alternative on the table was a Cloudflare Access policy over
all-branch previews, which needs Zero Trust onboarded against a permanent team
name. Restricting the branch list removes the exposure without that. The cost is
paid at review time instead: to see a change rendered before merging, run the
build locally (see above) — the push guard refuses a direct push to `develop`,
so its preview only exists once a PR has already been merged.

Every `*.pages.dev` preview also carries `X-Robots-Tag: noindex` by default.

**The photo site is the exception on access, not on branches.** It previews
`develop` only as well, but its previews read the preview database and bucket,
so a public preview would be a second public copy of the site. They sit behind
Cloudflare Access (the project's *Restrict previews*, #149), which needed Zero
Trust onboarded. That is done for this account now (see
[The photo site](#the-photo-site)), so the reason recorded above for leaving hq
and sailing without a policy no longer holds. Their previews stay public until
someone decides otherwise.

<a id="the-photo-site"></a>

## The photo site

photos.madcowsailing.com is the one site with server code: Pages Functions in
`photos/functions/`, a D1 database and an R2 bucket per environment, and
Cloudflare Access in front of every preview. Why each piece is what it is, with
its sources, is in `CLAUDE.md`, The photo site. This section is the operating
record: what exists in the account, and how to run and change it.

### What exists in the Cloudflare account

Created for #149 on 2026-09-27 (UTC) and read back from the dashboard.

| Resource | Preview | Production |
|---|---|---|
| D1 database | `madcowphotos-preview` (`1cf98564-46b0-4e84-b015-2aa6767c1f2a`) | `madcowphotos` (`ea7cb9f4-80f8-4cac-bbf1-a2b09d476b15`) |
| R2 bucket | `madcowphotos-preview` | `madcowphotos` |
| `SITE_ENV` | `preview` | `production` |

- Both databases were placed automatically. Both buckets are in Eastern North
  America (ENAM), Standard storage class, with **no custom domain and the
  public development URL (`r2.dev`) disabled**. That must stay so: photos are
  served only through the site's code, which checks each one's approval first.
  Each bucket carries R2's default lifecycle rule, aborting unfinished multipart
  uploads after 7 days, and since #198 (2026-10-08, about 17:52 UTC) a rule of
  the site's own beside it: **"Abort unfinished uploads after 1 day"**, with no
  prefix, so the whole bucket, and no other action. The earlier abort applies.
  Both were read back after a reload under R2 → the bucket → Settings → Object
  Lifecycle Rules, where they are added and edited. **The Add dialog opens with
  "Delete uploaded objects after:" already ticked**: saved that way with a
  number in it, a rule deletes every object in the bucket after that many days,
  every approved photo included. Untick it before filling in anything else.
  Why one day: CLAUDE.md, The photo site, item 33.
- R2 is on the account's R2 subscription and Zero Trust on its Free plan
  (50 seats). Both were taken out for #149, $0 unless usage passes the free
  allowances.
- **Zero Trust team: `madcowsailing`**, team domain
  `madcowsailing.cloudflareaccess.com`. It was the issuer #151's admin check
  trusted until #224, and #192's coach check until #226. Since #226 no code
  reads an Access token, and the team serves the Pages preview application
  alone. `madcow`
  was wanted and is taken by another account: the rename answered `409`, while
  the confirmation dialog had already shown `madcow.cloudflareaccess.com`.
- One Access application since #226, read back from Zero Trust → Access
  controls → Applications on 2026-09-28 (#151):

  | | Previews (#149) |
  |---|---|
  | Name | `madcowphotos - Cloudflare Pages` |
  | Destinations | `*.madcowphotos.pages.dev` |
  | Policy | `Allow Members - Cloudflare Pages`: Allow, Include Emails (the address #149 set, since #151 the admins' addresses, and since #192 the coaches') |
  | Identity providers | as #149 left it |
  | Session | as #149 left it |
  | AUD tag | `da25aceb…`, kept here as the record: `ACCESS_COACH_AUD` held it in the preview's vars until #226 deleted the var |

  **The coach application goes at #226.** `madcowphotos coach` (#192), on
  `photos.madcowsailing.com/coach` and `…/coach/*` (both, because Access's
  `/coach/*` does not match `/coach`), with the policy `Coaches - photos
  coach` (Allow, Include Emails, the same list as `COACH_EMAILS`, One-time
  PIN only, a 24-hour session) and the tag `3be126b6…`, is deleted by #226
  once its release is live (The cutover (#226), below), and its policy
  with it, since deleting an application leaves a reusable policy behind.
  The `ACCESS_COACH_AUD` and `ACCESS_TEAM_DOMAIN` vars went from
  `photos/wrangler.jsonc` in the same story. From #226's release `/coach` is
  no route: it answers the site's 404 page, and a coach is an account with
  the coach role (Coaches, below). Zero Trust's seat count is read before and after
  the deletion; a seat belongs to a person, not an application, so it is
  not expected to drop.

  **The admin application is gone.** `madcowphotos admin` (#151), on
  `photos.madcowsailing.com/admin`, `…/admin/*` and `…/api/admin/*`, with the
  policy `Admins - photos admin` and the tag `78d0a143…`, was deleted by #268
  on 2026-10-07, and the `ACCESS_AUD` var that held its tag with it. Since
  #224 no code had read its token, so all it did was ask an admin for
  Access's PIN before the site's own sign-in and its code. Its policy was a
  reusable one, and deleting the application left it in place, used by no
  application, so it was deleted too. Zero Trust's seat count read 3 of 50
  before and after: a seat belongs to a person who has signed in through
  Access, not to an application.

  `madcowphotos.pages.dev`, the project's production address, was behind
  neither application, and is behind none now. The admin application's
  destination list offered it on 2026-09-28, so Access could have covered it
  too. It was left out, so that address answered the site's own `403`, which
  is the check #151's criteria read.
  **`/admin` answers to the site's admin session alone**
  (`photos/lib/admin-session.js`; #224), and since #268 on
  `photos.madcowsailing.com` too: an admin signs in once, with the password
  and the emailed code, and a signed-out request is a `303` to
  `/sign-in?admin` on either hostname. On a `develop` preview the Pages
  preview application still stands in front of every path, `/admin`
  included.
- **One Turnstile widget, `madcowphotos ask`** (#220, made 2026-10-06 UTC;
  since #222 the reset form at `/forgot-password` uses it too),
  in Managed mode with pre-clearance off, for the hostnames
  `photos.madcowsailing.com` and `madcowphotos.pages.dev`. A hostname covers
  its subdomains, so the second serves the `develop` preview too. Its site key
  is `TURNSTILE_SITE_KEY` in `photos/wrangler.jsonc`, the same in every
  environment. Its secret is the `TURNSTILE_SECRET_KEY` secret (below), which
  the owner pasted from the widget's page into both environments, so it is in
  no file, chat or issue. A widget's hostnames are edited under Turnstile →
  the widget → Settings.

### Secrets

By name only; a value never goes in this repo.

- **Pages secrets**, one value per environment, set in the dashboard under the
  project's Settings → Variables and Secrets, as type *Secret*:
  - `SESSION_SIGNING_KEY` (#150) signs the account session cookie,
    `__Host-account` (#222), and the admin session cookie, `__Host-admin`
    (#224), and keys the hash each admin sign-in code is kept as (#224).
    Until #226 it also signed the invite link's and the coaches' upload
    cookie, `__Host-upload`, which nothing reads now. Changing it ends every
    session at once.
  - `ADDRESS_HASH_KEY` (#150; #158 uses it too) keys the hash a rate limit
    stores instead of a network address. Since #222 it keys a failed
    sign-in's email address too, and since #225 a revoked account's address
    in `revoked_addresses`, which is kept with no time limit. **Changing it
    lifts every revoked address's hold at once**, since no new request's
    hash would match an old one, so a revoked person could ask again. Before
    rotating it, note who was revoked from the admins' log.
  - `ADMIN_EMAILS` (#151) and `COACH_EMAILS` (#192) are **deleted by #226
    from both environments once its release is live** (The cutover (#226),
    below). `ADMIN_EMAILS` listed the addresses the admin guard let in, and
    nothing had read it since #224: accounts holding the admin role replaced
    it (`CLAUDE.md`, The photo site, item 30), and **adding an admin is
    "Make admin" on `/admin/people`**, for anyone with an approved account
    (Approving accounts, below). `COACH_EMAILS` listed the coaches the
    sign-in at `/coach` let in: an account approved with the coach role
    replaced it (Coaches, below). Once #226's steps are done, no Access application stands in
    front of any path on `photos.madcowsailing.com`; the `Allow Members -
    Cloudflare Pages` policy still decides who can open a preview at all.
  - `RESEND_API_KEY` (#217) is the Resend API key the site sends email
    with: `madcowphotos Pages`, Sending access, for
    `photos.madcowsailing.com` only. One key, the same value in both
    environments. It went from Resend's copy button to each environment's
    secret by the owner's paste, so it is in no file, chat or issue; keep it
    that way. Unset, nothing is sent and `/admin/mail` says so. Email, below,
    says how to replace it.
  - `TURNSTILE_SECRET_KEY` (#220) is the secret of the Turnstile widget on
    `/ask` and, since #222, `/forgot-password`, which `photos/lib/turnstile.js`
    sends to Cloudflare's siteverify with each request's token. One widget, so
    the same value in both environments; its site key is public, and is
    `TURNSTILE_SITE_KEY` in `photos/wrangler.jsonc`. Unset, `/ask` and
    `/forgot-password` answer `503`, that they are closed, and keep nothing. Never set one of Cloudflare's test keys here:
    the always-pass one passes every token, which production refuses to
    trust, so requests there would close, and a preview would pass them all.

  The first two are 32 random bytes each, base64url-encoded. Preview and production get
  different values. Without them, `/sign-in` and
  `POST /set-password` answer `503` and open nothing, and without
  `ADDRESS_HASH_KEY`, `POST /api/remove`, `POST /ask` and `/forgot-password`
  answer `503` and change nothing, and Revoke and "Let it ask again" on
  `/admin/people` change nothing and say why. (`POST /api/join` needed both
  until #226; it reads no secret now.) Check on the dashboard, which shows a
  secret's name and never its value, that all four exist in both
  environments (`SESSION_SIGNING_KEY`, `ADDRESS_HASH_KEY`, `RESEND_API_KEY`
  and `TURNSTILE_SECRET_KEY`), and that `ADMIN_EMAILS` and `COACH_EMAILS`
  exist in neither.
- **Local only, in `photos/.dev.vars`** (gitignored; `wrangler pages dev` reads
  it): the same two keys, with throwaway values. Make it with
  `node -e "const k=()=>require('crypto').randomBytes(32).toString('base64url');require('fs').writeFileSync('.dev.vars','SESSION_SIGNING_KEY='+k()+'\nADDRESS_HASH_KEY='+k()+'\n')"`
  from `photos/`, which prints nothing. For the admin pages and for sending,
  make the local account and add `ADMIN_DEV_ACCOUNT`, under Running it
  locally.
- **Local only, in `photos/.env`** (gitignored; wrangler reads it from
  `photos/`): `CLOUDFLARE_API_TOKEN`, an API token named
  `madcowphotos D1 migrations` with Account → D1 → Edit on this account only,
  and `CLOUDFLARE_ACCOUNT_ID`. It exists to apply migrations. Check it with
  `npx --no-install wrangler d1 list` from `photos/`, which prints both
  databases and no secret.

### Running it locally

From the repo root, once: `npm ci`. Then, from `photos/`:

```sh
mkdir -p public/assets/shared && cp -R ../shared/. public/assets/shared/   # the Pages build step
npx --no-install wrangler d1 migrations apply madcowphotos-preview --local  # local stand-in database
npx --no-install wrangler pages dev                                        # http://localhost:8788
```

It also needs `photos/.dev.vars` (Secrets, above). Sending and the admin
pages both need a signed-in account, which a local run gets from a stand-in
(below). Until #226 a local run sent through an invite code made on
`/admin/code`, which is gone.

`GET /api/health` should answer `200` with `"environment":"preview"`, both
bindings reachable, and the newest migration's name. The local database and
bucket are stand-ins under `photos/.wrangler/`, never the real ones.
`--no-install` keeps `npx` on the wrangler pinned in the root `package.json`.

**The admin pages run locally behind a stand-in**, with the real check and no
way around it (#151; since #224 the admin session). An admin signs in with
the password and a code the site emails, and locally there is no Resend key
to send it, so the stand-in signs the session the code would open, for a
local admin account, with the local `SESSION_SIGNING_KEY`. Make the account
once, from `photos/` (write your own address for `<address>`):

```sh
npx --no-install wrangler d1 execute madcowphotos-preview --local --command "INSERT INTO accounts (email, name, role, requested_at, admin_role) VALUES ('<address>', 'Local owner', 'parent', unixepoch(), 'owner'); INSERT INTO account_teams (account_id, team, state) SELECT id, 'hoover-jrt', 'approved' FROM accounts WHERE email = '<address>'"
```

Then add its id, `1` on a fresh database, to `photos/.dev.vars`, which
`wrangler pages dev` reads in place of `wrangler.jsonc`'s values:

```sh
ADMIN_DEV_ACCOUNT=1
```

Beside `wrangler pages dev`, run `node scripts/sign-in-dev.mjs` from `photos/`
(`scripts/access-dev.mjs` until #226) and open `http://127.0.0.1:8789/admin/`.
It forwards each request to `:8788` with that account's admin session
added. The guard runs unchanged: it checks
the signature and reads the account's role, version and teams on every
request, so an account that is no admin is still sent to `/sign-in?admin`.
`/admin/` on `:8788` directly is sent there too, which is the other half
worth seeing. After signing out through `:8789`, the account's session
version is 2: add `ADMIN_DEV_VERSION=2` and restart the stand-in. It passes
its own Origin on as the site's, as one host does on production, so the
admin pages' forms get past the site's Origin check (#152); any other Origin
goes on unchanged, and is refused. A sign-in at `/sign-in` as an admin stops
at the code, which says it could not be sent.

The stand-in signs a fresh 12-hour admin session, as an unticked "Remember
this phone" would, into every request it forwards (#274). So through
`:8789` the admin home always reads 12 hours from now, never a remembered
phone's 30 days, and **Forget this phone looks as if it did nothing**: the
stand-in adds the cookie, not the browser, so the next request carries a
new one whatever Forget deleted. Read those two through the pages the code
renders for a given session instead (the admin home in `lib/admin-page.js`,
Forget's answer in `functions/api/admin/forget.js`), not through the
stand-in.

**Sending runs locally behind the same stand-in** (#226). On every path
outside the admin pages it adds the same account's `__Host-account` session,
at the same version, so `http://127.0.0.1:8789/share/` sends as the local
account, to the open albums of its approved teams, with no password: a local
account cannot set one, since the emailed link it would need cannot be sent.
To send to an event, add one for the account's team on
`http://127.0.0.1:8789/admin/albums`. Until #226 the stand-in also signed
`/coach` with a generated key pair, which went with the coach sign-in.

**The request form runs locally on Cloudflare's test keys** (#220). Add two
lines to `photos/.dev.vars`, the always-pass pair from Turnstile's Testing
page:

```sh
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Then open `http://127.0.0.1:8788/ask`. The widget passes with no challenge, on
any host, and siteverify passes the dummy token it makes. Without the two
lines, `/ask` answers `503`. The admins' email needs `RESEND_API_KEY`, which
`.dev.vars` must not hold, so locally it is logged as not configured.

**`photos/package.json` is what makes that work.** Wrangler 4.141.0's
`pages dev` reads `wrangler.jsonc` from the current directory to find the
output folder. It then starts the server from the nearest `package.json`'s
directory. Without a `package.json` in `photos/`, that is the repo root, where
there is no `wrangler.jsonc`, so the site ran with **no D1 or R2 bindings** and
nothing said so. Health answered `503`. The same file sets `"type": "module"`
for Node.

`npm test`, from the repo root, runs the site's own tests (`node --test`, in
`photos/test/`). They are in the gate.

### Changing the schema

In the order `CLAUDE.md` item 6 sets, from `photos/`, with the token above:

1. The pull request adds one additive file under `photos/migrations/`.
2. Before it merges into `develop`:
   `npx --no-install wrangler d1 migrations apply madcowphotos-preview --remote --env preview`
3. Before the owner promotes `develop` to `release`:
   `npx --no-install wrangler d1 migrations apply madcowphotos --remote --env production`

`npx --no-install wrangler d1 migrations list <database> --remote --env <env>`
shows what is still to apply. Each database's `d1_migrations` table records what
was applied, and `GET /api/health` reports the newest name. Read those rather
than a date written here, which goes stale at the next apply.

The migrations, in the order they apply. `photos/test/site.test.js` fails until
a new file is listed here.

| File | Story | What it adds |
|---|---|---|
| `0001_baseline.sql` | #149 | Nothing: it proves the apply order on both databases |
| `0002_invite_code.sql` | #150 | `invite_codes`, and `join_failures`, the failed-join log |
| `0003_join_budget.sql` | #177 | `join_budget`, the site's hourly budget for recording failed joins |
| `0004_albums.sql` | #153 | `albums`, one per regatta or practice day |
| `0005_photos.sql` | #154 | `photos`, every photo and clip in every state, and `upload_counts`, each session's uploads per UTC day |
| `0006_removal_requests.sql` | #158 | `removal_requests`, the hour's takedowns per address that rate-limit "Remove this photo" |
| `0007_accounts.sql` | #220 | `teams`, `accounts` and `account_teams`, each request for an account and its teams; `account_request_log`, `account_request_budget` and `account_request_mail`, the request limits and the admins' email hour |
| `0008_admin_people.sql` | #221 | `password_links`, each unused link to set a password, kept as a hash; `admin_log`, what the admins do with each account |
| `0009_sign_in.sql` | #222 | Three columns on `accounts`: the password hash, the session version and the failed sign-ins in a row; `sign_in_failures` and `sign_in_budget`, the sign-in limits; `reset_request_log` and `reset_mail_budget`, the reset limits |
| `0010_album_teams.sql` | #227 | `team` on `albums`, Hoover JRT for every album made before it; four triggers that hold it to a row in `teams`, in place of a reference SQLite will not add with a default |
| `0011_teams_replace_guard.sql` | #227 | A fifth trigger: a `REPLACE` into `teams` cannot remove a team an album names, the one path 0010's four left open |
| `0012_photos_account.sql` | #223 | `account_id` on `photos`, the account that sent each photo, set to NULL when the account is deleted; a CHECK holding an account's row to the placeholder code generation and session time 0; a partial index |
| `0013_admins.sql` | #224 | `admin_role` on `accounts`, NULL, `admin` or `owner`, with at most one owner; seven triggers keeping the owner's role, account and approved teams and the last admin; `admin_codes`, each admin sign-in code kept as a keyed hash, and when it was sent, for a day |
| `0014_revoked_addresses.sql` | #225 | `revoked_addresses`, each revoked account's address as a keyed hash, naming the account until it is deleted (`ON DELETE SET NULL`), so a new request from it is held back; a partial index |
| `0015_not_sure_albums.sql` | #228 | `holding` on `albums`, 0 for every album made before it; one "Not sure / other event" album per team, the one row a team may have with `holding` 1; six triggers: no photo in one is approved, or hidden other than while waiting, `holding` never changes, and one is never deleted, replaced, or moved to another team. **Apply it just before the code that reads it**, not at the commit gate: the older code reads its rows as events (`CLAUDE.md` item 32) |
| `0016_clip_rules.sql` | #198 | Ten triggers on `photos` holding a clip's row to what the clip routes write: its type is `video/mp4` or `video/quicktime`; outside `uploading` it names its type and a length over 0; it names its upload id while uploading and at no other time; it leaves `uploading` only for `pending` and never goes back; and every row keeps its kind, through a `REPLACE` or a moved id too. No column, and no stored row changes |
| `0017_clip_day_bytes.sql` | #198 | `clip_bytes` on `upload_counts`, the bytes of clips a session started that UTC day, 0 for every row before it and never below 0, read against the day's clip budget (security audit SA-1). **Apply it before the code that writes it**: a clip's start names the column, and so does every upload's give-back, a photo's included |
| `0018_sender_events.sql` | #273 | Three columns on `albums`: `created_by`, the account that made a sender's event, NULL for every album an admin makes or made before it and set to NULL when the account is deleted (`ON DELETE SET NULL`); `provisional`, 1 on a sender's event until an admin first approves a photo or clip in it, and 0 for every other album; `earlier_address`, the address an event had before that approval made it a new one, kept for the event's life. A unique partial index on `earlier_address`, and a partial index on `created_by` and `created_at` for the daily cap; five triggers: `provisional` goes from 1 to 0 and never back, no album's address is another's earlier address, and no photo or clip in a provisional event is approved, or hidden other than while waiting. No trigger refuses a change to a fixed album's address, and none guards a REPLACE that clashes on `provisional` or `earlier_address`: no route writes either, and #288 takes the statements typed by hand. **Apply it before the code that reads it**, as `CLAUDE.md` item 6 orders: #273's code names these columns in every album read and every upload, while the older code never names them and runs unchanged on a database that has them (`CLAUDE.md` item 34) |

### The invite link, retired by #226

Until #226 a parent joined by opening
`https://photos.madcowsailing.com/share/#code=<code>`, and an admin made and
rotated the code on `/admin/code` (#150, #152). Accounts replaced the link
(Account requests, Approving accounts and Signing in, below), and revoking a
person (#225) replaced rotating the code. `CLAUDE.md`, The photo site, item 11
keeps the record.

- **An old link still opens the share page**, which takes the code out of the
  address bar at once and sends it nowhere. It says the link has been
  replaced by accounts: a phone already signed in is told it is set to send,
  and any other is pointed at signing in or asking for an account.
- **`POST /api/join` answers `410 {"error":"replaced","ask":"/ask"}`** to
  every post from the site's own Origin, whatever code it names, without
  reading the body or the database, and opens no session. Another site's
  post is `403 {"error":"origin"}`, as before.
- **Every session the link opened ended with #226's release.** A phone's
  `__Host-upload` cookie opens nothing, and is deleted the next time the phone
  opens the share page or sends.
- **`/admin/code`, its Create and Rotate presses and the admin home's Invite
  code link are gone.** `invite_codes`, `join_failures` and `join_budget`
  stay as tables, since migrations are additive (`CLAUDE.md` item 6); nothing
  reads or writes them. The old codes and the failed-join rows are deleted by
  hand once the release is live (The cutover (#226), below): with no code
  left, a build from before #226 put back by a rollback would refuse every
  old link and every old parent cookie too (`security-audit` at #226's
  review).
  No code was ever written to a file or to git; this repo is public.

### Coaches

Since #226 a coach is an account approved with the coach role. They ask at
`/ask` as a coach, and an admin approves their teams on `/admin/people` with
that role, which emails the link to set a password (Approving accounts,
below). Signed in, a coach sends from the share page like anyone, to the open
albums of their approved teams. `CLAUDE.md`, The photo site, item 20 keeps
the record of the sign-in it replaced.

- **A coach account's clips may run 15 minutes**, and everyone else's 3
  (From an account, under Uploads, below).
- **A coach's photos wait for approval** like anyone's, and the queue names
  the account that sent each.
- **`/coach` is gone** (#192 built it): it is no route, so it answers the
  site's 404 page from #226's release, and its Access application is
  deleted once that release is live (What exists in the Cloudflare account,
  above).
- **A photo sent through the coaches' Access sign-in before #226** keeps
  `sender` `coach`, and the queue still says "sent by a coach" beside it and
  names nobody: that row kept no address and no sign-in time. Production
  held none on 2026-10-08, and the cutover reads that again once its
  release is live (below).

### The cutover (#226)

#226's code retires the invite link and the coaches' sign-in. What they left
in Cloudflare's dashboard and in the databases goes by hand, in this order,
so that nobody is left without a way in and nothing is deleted while a
running release still reads it (D13, `CLAUDE.md`, The photo site, item 24):

1. **Before #226 merges into `develop`**, since `develop` is promoted whole
   and any later promotion would carry it. On production, an approved
   account sends a photo, and an admin signs in with the password and the
   emailed code (#226's criterion 1). Every address on `ADMIN_EMAILS` and
   `COACH_EMAILS` has an account approved with its role, the coach role for
   a coach, and "Make admin" pressed for an admin, and its set-password
   email has gone (criterion 2; Approving accounts, below). A Pages secret cannot be read
   back, so the list of addresses is taken before either secret goes;
   record how many, never an address, since this repo and its issues are
   public.
2. **The release.** The owner promotes `develop` to `release`. From its
   first request every invite-link and coach session is refused, and an old
   link points to `/ask`. Before going on, check that it is live: a `POST`
   to `https://photos.madcowsailing.com/api/join` with that address's Origin
   answers `410`.
3. **Then, in one sitting**, reading Zero Trust's seat count first (the
   Zero Trust overview's "Users … of 50"):
   - read production's photos sent through the coaches' sign-in, which only
     that sign-in wrote with no code generation:
     `--command "SELECT COUNT(*) AS rows FROM photos WHERE sender = 'coach' AND code_generation IS NULL"`
     must say 0. `/policy` dropped #192's sentence about lining a coach's
     send time up against Access's log because production held none on
     2026-10-08, and `/coach` stayed open until the release. If it is not 0,
     stop: the policy owes that sentence back before anything else goes.
     (`account_id IS NULL` is the wrong test: a deleted coach account's
     photos read `sender` `coach` with no account too, and generation 0);
   - delete `ADMIN_EMAILS` and `COACH_EMAILS` from production and preview
     (Settings → Variables and Secrets). Nothing reads either, so neither
     deletion needs a redeploy;
   - delete the `madcowphotos coach` application (Zero Trust → Access
     controls → Applications), then its `Coaches - photos coach` policy once
     Policies shows it used by no application, as #268 found the admin
     one left behind;
   - delete the failed-join rows, the last scrambled addresses the join
     route kept, on each database (`madcowphotos --env production`, then
     `madcowphotos-preview --env preview`), from `photos/` with the D1 token
     in `photos/.env` (above). Until #226 the next join deleted them;
     nothing does now:

     ```
     npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "DELETE FROM join_failures"
     ```

     Read it back: `--command "SELECT COUNT(*) AS rows FROM join_failures"`
     must say 0;
   - delete the old invite codes the same way, on each database, with
     `--command "DELETE FROM invite_codes"`, and read back
     `--command "SELECT COUNT(*) AS rows FROM invite_codes"`, which must say 0.
     Nothing reads them since the release, and no photo row refers to the
     table. With no current code, a build from before #226, were one rolled
     back to, would refuse every old link and parent cookie too.
4. **Read the seat count again**, and record both readings on the issue.
   Expect no drop: a seat belongs to a person who signed in through Access,
   not to an application (#268 read 3 of 50 before and after).

The `develop` preview's application and its `Allow Members - Cloudflare
Pages` policy stay, and are not touched (What exists in the Cloudflare
account, above).

### Albums

Parents send photos into an album, one per regatta or practice day, kept on
`/admin/albums` (#153) behind the admin sign-in (Signing in, below). Since
#273 a sender approved for a team can also create one for it from the share
page (below).

- **Add album** takes a team, Hoover JRT or COHSSA, a title, Regatta or
  Practice, and the date. Nothing is preselected, so the team is a choice
  every time. Its address, which a link to it names, is made then from the
  date and title (`2026-10-04-fall-regatta`) and never changes, so editing the
  team, title, kind or date under **Edit** keeps every link working. A second
  album with the same date and title gets `-2`, and no album is given an
  address another event had before its first approval (below). A sender's
  event is the one album whose address can change, and only before anything
  in it is approved (below).
- **The team decides which section lists the album** (#227): `/hoover-jrt/`
  or `/cohssa/` (The public albums, below). Moving an album to the other team
  under **Edit** moves it between the sections at the next load. Every album
  made before #227 is Hoover JRT's (migration 0010).
- **Close** stops uploads to an album and takes it off the share page's list;
  its approved photos stay public. **Reopen** undoes both.
- **Delete** works only on an empty album. One holding any photo or clip,
  waiting, approved or hidden, is refused and the page says how many of each
  it holds. A clip no admin page shows yet is named with where it goes: an
  approved one is deleted by hand ([Deleting a clip by
  hand](#deleting-a-clip-by-hand)), and one still being sent is cleared a day
  after it started.
- `GET /api/albums/open` is the list the share page reads, newest first, each
  album with its team's key and name, under which the page groups it (#227).
  It answers only to a signed-in account, and lists only its approved teams'
  albums (#223; since #226 an account is the only session it takes).
- **Each team has a "Not sure / other event"** (#228; `CLAUDE.md`, The photo
  site, item 32): an album made by migration 0015, marked `holding`, dated
  0001-01-01, at `0001-01-01-not-sure-<team>`. The share page offers it after
  the team's events, for photos from an event nobody has added yet, and never
  preselects it. It is listed in its own section at the foot of
  `/admin/albums` with **Close** and **Reopen** only: closing it stops parents
  choosing it, and its waiting photos stay in the queue. It is never edited
  or deleted: the page has no Edit or Delete for it, the routes refuse a post
  naming it, and the database refuses a delete, even one typed by hand. None
  of its photos is ever approved (Approving, below), so
  no public page lists or links it, and its address answers 404 like any
  album with nothing approved. The open list gives these in `other`, apart
  from `albums`, with no title.
- **A sender creates an event from the share page** (#273; `CLAUDE.md`, The
  photo site, item 34). An account approved for a team taps **Create a new
  event** on `/share/` and gives a title, a date from 30 days back through
  tomorrow by the phone's calendar, Regatta or Practice, and the team when it
  is approved for two. The title field asks them to leave children's names
  out. When the team has open events within 3 days of that date, the first
  press of **Create the event** asks "Is it one of these?", with a button for each that
  chooses it, then **No, create** followed by the new title; with none it
  makes the event at once. The event is open from that moment: `GET /api/albums/open` lists it
  to every account approved for its team and to no other, and the share page
  preselects it by the rule it uses for any album. It is in the team's
  section and on `/` only once an admin approves a photo in it, as every
  album is. Each team's Not sure / other event stays. **An account makes at
  most 10 events a UTC day**, counting the ones it made that day that still
  exist, so one an admin deletes frees its place; the eleventh is refused,
  and the page says so. The page posts to `POST /api/albums`, which takes
  only the site's own Origin; `photos/functions/api/albums/index.js` has
  every answer.
- **A sender's event has a provisional address until its first approval.**
  It is made from the date and title as Add album's is, and `/admin/albums`
  shows it followed by "provisional: made again from the date and title when
  its first photo or clip is approved". The first time an admin approves a
  photo or a clip in it, the approval makes the address again from the
  event's date and title as they are then, so a title corrected under
  **Edit** before then is in the address it goes public under. From then on
  the address never changes, and a rename changes the title only. If every
  address that date and title can take is held, the event keeps the one it
  was made with. The address it had before is kept for as long as the event
  exists: a share page loaded before the approval still sends photos and
  clips to it, they land in the event, and no other album is ever given it.
  If the event is renamed while an approval is pressed, its photos and clips
  keep waiting and the queue says so; the next press approves them. A press
  on `/admin/albums`, or a Move in the queue, from a page loaded before the
  address was made again still acts on the event by its earlier address.
- **`/admin/albums` names the account that made a sender's event.** No
  public page and no open list says who made one. When the account is
  deleted the event stays, at its address and with its title, naming nobody
  (`albums.created_by`, migration 0018).

### Uploads

`POST /api/upload` (#154) takes one photo into an open album, as the three
JPEG sizes the share page makes, and stores it **pending**: nothing is public
until the owner approves it. It answers only to a signed-in account (since
#226 the only upload session) and the site's own Origin. The fields and
every answer are in the header comment of
`photos/functions/api/upload/index.js`, and the decisions in `CLAUDE.md`, The
photo site, item 14.

- **What is stored.** Three objects in the environment's bucket,
  `photos/<media_key>/grid.jpg`, `screen.jpg` and `full.jpg`, each rebuilt with
  every metadata segment removed (EXIF, GPS, XMP, the colour profile, comments,
  and anything after the image), and one `photos` row naming the album, the
  batch, the account that sent it and each size's dimensions. Its code
  generation and session time are 0, placeholders migration 0012 holds an
  account's row to (From an account, below); a row from before #226 may name
  an invite code's generation instead.
- **What is refused, and stores nothing.** Anything that is not a JPEG (415), a
  file that breaks off (400), a file over its size's cap (413), three sizes that
  are not one picture's shape (400), a caption over 200 characters or holding a
  line break (400), an album that is not open (409), and an account's 501st
  stored photo in a UTC day (429, with `Retry-After`). An upload that fails after
  those checks leaves nothing in the bucket and does not count against the cap.
- **If the log says** `bucket did not delete photos/<key>/ after a failure`,
  `after a reject` or `after a delete` (below), objects were left in the
  bucket with no row. Delete them by that prefix. For a clip, `clips: bucket
  did not delete photos/<key>/` means the same of its one object,
  `photos/<key>/clip`. `clips: bucket did not abort photos/<key>/` needs
  nothing: the bucket's lifecycle rule (above) aborts the upload within a day.
- **Clips** (#198; `CLAUDE.md`, The photo site, items 10 and 33). A clip goes
  into the bucket as an R2 multipart upload, in parts of 25 MiB sent one at a
  time, through four routes: `POST /api/upload/clips` starts it,
  `PUT /api/upload/clips/<id>/parts/<n>` sends a part,
  `POST /api/upload/clips/<id>/complete` joins the parts and checks the clip,
  and `DELETE /api/upload/clips/<id>` abandons it. Each after the first
  answers only to the session that started the upload, by the token the start
  answers, sent back in a `Clip-Upload` header. The fields and every answer
  are in each route's header comment. **What is stored**: one object,
  `photos/<media_key>/clip`, as the page sent it, its location and camera
  details already overwritten with zeros, and a `photos` row of kind `clip`,
  `uploading` while its parts arrive and `pending` once the server has
  checked it. **What is refused**: a clip over 3 minutes or 1 GiB, or 15
  minutes or 4 GiB from a coach (413, before any part is stored); one that is
  not an MP4 or MOV (415); one still holding anything outside the keep-list,
  which is deleted (422); an account's 501st upload in a UTC day (429
  `daily-cap`), a clip counting as one; and a clip that would take an
  account's clips past 10 GiB in a UTC day, or 40 GiB from a coach (429
  `clip-bytes`; `CLIP_DAY_BYTES` in `lib/photos.js`, kept in
  `upload_counts.clip_bytes`), both with `Retry-After` and both before any
  part is stored. An upload never stored gives its one and its size back. An
  upload left unfinished is deleted a day after it started, by the next
  clip's start or the next load of `/admin`.
- **The share page sends them** (#155). `/share/` makes each photo's three
  JPEGs on the phone as soon as it is chosen, and sends three at a time. A HEIC
  the browser cannot open says so and is left out. Since #198 it sends clips
  too, one at a time, in parts: it overwrites a clip's location and camera
  details first, and refuses one over its sender's caps before sending any of
  it. `CLAUDE.md`, The photo site, item 15 has the decisions. To try it
  locally, open `/share/` through the local stand-in (Running it locally,
  above), and choose photos or clips.
- **From an account** (#223; `CLAUDE.md`, The photo site, item 29), since
  #226 the only way to send. A phone signed in at `/sign-in` sends as the
  account, to the open albums of the teams the account is approved for: the
  share page
  lists only those, and any other album answers `403 {"error":"team"}`,
  storing nothing. Each row names the account in `account_id`, which the
  queue and removals pages show by name; the sender column is the account's
  role (`coach`, else `parent`), and the code generation and session time are
  0. An account's 500 a day are shared by every phone signed in to it
  (`upload_counts` under `account.<id>`), and so is its day's clip budget. A
  coach account's clips may run 15 minutes and be 4 GiB, 40 GiB a day, and
  everyone else's 3 minutes and 1 GiB, 10 GiB a day (`clipSeconds`,
  `clipBytes` and `clipDayBytes` in `lib/photos.js`).

### The installed app

The share page installs to a phone as **Mad Cow photos** (#193). `CLAUDE.md`,
The photo site, item 22 has the decisions.

- **On Android**, in Chrome on `/share/`: menu → *Install and create shortcut*
  → *Install*. The gallery's Share menu then lists Mad Cow photos for photos,
  and since #198 the share target takes `video/*` as well, so a clip can be
  shared to it too: *measured* at #198 on the owner's Samsung, a fresh
  install from a local server, where Samsung Gallery's Share listed the app
  for a video and the clip arrived ready to send. Shared files open the app
  on the share page, ready to send. With no session they wait on the phone
  for a day, and the page says to sign in (until #226, to open the invite
  link or sign in at `/coach`).
- **An app installed before #198 is offered for photos only until Chrome
  updates it.** The types a share target takes are built into the installed
  app. Chrome checks the manifest when the app is opened, if it has not
  checked in 24 hours, and builds the new app once every window of it is
  closed and the phone is plugged in on Wi-Fi ([web.dev, manifest
  updates](https://web.dev/articles/manifest-updates), updated 2024-09-19);
  *Update* on `about://webapks` asks for it sooner, on the same conditions.
  Meanwhile **Add photos** in the app takes clips.
- **On an iPhone**, Safari → Share → *Add to Home Screen* should open it on
  the share page, where the photos are chosen with **Add photos**: an
  iPhone's Share menu never lists a web app. **Not read on an iPhone yet**
  (#210 carries it). A Home Screen app on iOS keeps its cookies apart from
  Safari, so a sign-in made in Safari may not reach the installed app, and
  the sender signs in again inside it; until #210 reads it, send from Safari
  on an iPhone.
- **How a share travels.** The phone posts the photos to `/share/receive`.
  `public/share/sw.js`, the app's worker, takes that one request, keeps each
  photo or clip in the phone's IndexedDB, and sends the browser to `/share/?shared`.
  Nothing reaches the server until Send, and a photo stays on the phone until
  it is sent or removed, so a reload or a second share offers it again. If the
  phone has no worker (its site data was cleared), `functions/share/receive.js`
  answers instead and the page says to share again. A share another site
  started (its `Origin` is that site's) is refused unread; Android's own
  share sends `Origin: null`.
- **The worker never caches.** Every other request goes to the network, so a
  takedown and a deploy both reach an installed app the next time it asks.
  The share target's list of types is the exception: it changes only when
  Chrome updates the installed app (above).
  Its scope is `/share/`, so the public pages never meet it.
- **A share from Chrome itself arrives empty** (measured on a Samsung,
  Chrome 154): Web Share hands the app a form with no files, and the page
  says to share from the gallery or Files app instead. A one-photo share from
  Samsung Gallery and a six-photo share from My Files arrived whole. Google
  Photos was not read.
- **The icons** are `photos/public/icons/`, written by `tools/app_icons.py`
  from `shared/img/madcow-mark.svg`. Run it after changing the mark or the
  `--blue` and `--chalk` tokens, and commit what it writes.
- **To try it locally**, open `http://127.0.0.1:8788/share/` in Chrome after
  **Running it locally**, above. DevTools → Application → Manifest shows no
  installability error, and Service workers lists `/share/sw.js` for scope
  `/share/`. On a phone, `adb reverse tcp:8788 tcp:8788` and open the same
  address: Chrome 154 installed it from there as a real app, Share-menu
  entry included. Uninstall it, and clear the site's data, when you finish.

### Approving

Nothing is public until an admin approves it on `/admin/queue` (#156), behind
the admin sign-in, as the albums are. The admin home says how
many photos and clips are waiting and how much of R2's free 10 GB everything
stored takes.
`CLAUDE.md`, The photo site, item 16 has the decisions.

- **All teams, Hoover JRT or COHSSA** (#227): the links at the top show one
  team's batches, at `/admin/queue?team=<team>`, and every press lands back on
  the same team.
- **Each batch is one press of Send**, oldest first, with its team, its album,
  when it was sent and how many photos it holds. A batch over 200 photos comes in parts
  of 200, and each part's Approve all and Reject all mean that part. Every
  photo shows its screen size large and its grid and full sizes beside it; each
  opens alone when tapped. Check each against the families who opted out of the
  media release.
- **Every button in a batch saves the captions typed in it.** Clear a caption
  to publish none; a caption stops at 200 characters. **Save captions** saves
  them alone, and Enter in a caption field presses it. A caption typed for a
  photo someone approved after the page loaded is not saved, and the page says
  so.
- **Approve** or **Approve all** approves photos, which puts them in the public
  albums at once (#157, below). **Reject** or
  **Reject all** asks first, then deletes each photo's row and its three files
  for good. Rejecting needs JavaScript.
- **Approve all and Reject all act on the photos the page showed.** A photo
  sent into the batch after the page loaded keeps waiting.
- **After a press the page lands on the next waiting photo** (#270), with what
  the press did said at the top of that photo: the next one in the batch, else
  the next batch's first, else the earliest photo still waiting, which is one
  you skipped. Save captions lands on the last caption it changed, and Move
  on the photo it moved. On a phone each photo fills the screen's width and
  names its event and team, its buttons stay at the bottom of the screen
  while it is on it, and Reject sits alone below Approve and Move.
- **Move a photo into its event** (#228). Choose the event under **Move to
  event** in the batch, then **Move** under a photo or **Move all** at the
  top. The list is the batch's team's events, newest first, open or closed;
  **A new event, below** makes one from the title, kind and date under it,
  for the same team, as **Add album** would. Any waiting photo moves: one in a
  team's **Not sure / other event**, or one a parent sent to the wrong event.
  A moved photo keeps waiting, with its captions and its batch, and shows as a
  batch of the event it is in now. A photo moves only within its team.
- **A batch in Not sure / other event has no Approve**, and says why: a photo
  there has no event to be public in, so it is moved first and approved in
  its event. A press naming one anyway (an old or forged page) approves
  nothing for it and says so, and migration 0015 refuses the change in the
  database too. Reject works on it as on any batch.
- **The first approval in a sender's event fixes its address** (#273;
  Albums, above). The press makes the address again from the event's date
  and title in the same batch as the approval, so the two land together or
  not at all. If the event was renamed while the press ran, its photos and
  clips keep waiting and the page says so; the next press approves them.
  Migration 0018 refuses an approval into an event whose address is still
  provisional, even one typed by hand.
- **Clips wait here too** (#198; `CLAUDE.md`, The photo site, item 33). A
  clip is a card in its batch, "Clip <id>", with how long it runs and its
  frame size, and plays when Play is pressed; nothing of it loads before.
  Approve, Move, Reject and its caption work as a photo's do, and every count
  and notice names photos and clips apart. **An approved clip is kept, and
  shown nowhere public yet** (#286 adds clips to the albums); the queue says
  so while it shows one. Rejecting a clip deletes its row and its one file.
  A clip still being sent is not shown.
- The pictures come from `GET /api/admin/photos/<id>/<size>` (`grid`, `screen`
  or `full`), and the clips from `GET /api/admin/clips/<id>`, which answers a
  player's byte ranges (`206`). Both answer only to an admin.

### The public albums

Anyone can browse them, with no code and no sign-in (#157; epic #147, D1).
Nothing but an approved photo is ever listed, counted or served.

- **`/`** leads to each team's section (#227): a row for Hoover JRT and one
  for COHSSA, each with how many albums and photos its section shows, under
  its newest album's first photo. A team with nothing posted keeps its row,
  saying so.
- **`/hoover-jrt/`** and **`/cohssa/`** each list that team's albums holding at
  least one approved photo, latest date first, each with its kind, day, count
  and first photo. An album whose photos are all waiting is not listed, and a
  closed album still is. A team's section is a file of its own under
  `photos/functions/`, plus two lines in `_routes.json`; a third team needs
  both, and the tests say so.
- **`/albums/<address>/`** shows an album's approved photos in the order they
  were taken, in the trip logs' lightbox. The address is the one `/admin/albums`
  shows, and once an album is listed it never changes, so a link sent to
  parents keeps working, a link sent before #227 included. A sender's event's
  address can change only before its first approval, while nothing in it is
  public (#273; Albums, above). Its eyebrow leads back to its team's
  section. An album with nothing approved answers the site's 404 page.
- **`/photos/<id>/<size>`** serves one size of an approved photo: `grid` in the
  album, `screen` in the lightbox, and `full` from **Download**, saved as
  `<address>-<nnn>.jpg` by its place in the album. Anything else is 404: a
  photo waiting, hidden or deleted, an unknown id, or another size.
- **A takedown holds from the next request.** Every photo response reads the
  photo's state first and may be kept for 300 seconds by a browser that already
  loaded it, never longer. Every page is `max-age=0`.
- **The pages are built from `photos/templates/page.html`**, which is never
  served. Edit the head, header or footer there. `tools/assetver.py` stamps it,
  and `tools/linkcheck.py` and `npm run check` read it like any page.

### The policy

`/policy` says who sees a photo, who can send one, what the site keeps and
how to have a photo taken down (#159). It is a static page,
`photos/public/policy.html`. Every page's footer links it, and the share page
links it beside the way to sign in (the join step until #226). `CLAUDE.md`,
The photo site, item 18 has the decisions.

- **It states what the code does.** Its head comment traces every claim to
  the file or decision behind it, so change the page in the same change as
  any of them. `npm test` fails if its 90 days, its hour, its 2,560 pixels or
  its 500 a day stop matching the code.
- **#192 changed it** (a coach's Access sign-in): who can send, the lede,
  and what is kept for a coach, the coaches' list and Cloudflare's record of
  each sign-in included. #158 ("Remove this photo") changed it before that:
  the button, what a taken-down photo keeps (its copies, `hidden_at` and the
  free-text `hidden_note`) and how long its limit keeps a scrambled address. `npm test`
  holds its 10 an hour and its 500 characters to the code too.
- **#219 added accounts** (epic #216): what an account keeps and who sees it,
  the admins' log, the two services that handle a request (Turnstile and
  Resend) and what each sees, and how to have an account deleted: by email,
  confirmed by a reply to the account's address, with the person's photos
  staying and no longer recording the account, and the database's 30 days of
  restore points named. It described accounts before the request form
  existed, worded as conditions so that it was true on any release. Most of
  it is built by later stories, and the head comment names which. #220 to
  #224 each carry a criterion to add their own records to the page, and #223
  the lede and "Who can send a photo". The sentence about matching a coach's
  send time to Cloudflare's sign-in record stayed until the cutover (#226,
  below).
- **#226 retired the invite link and the coaches' sign-in on it**: who can
  send is only an account an admin approved, per team, a coach being an
  account with the coach role, and the page says what replaced each retired
  way in. The invite-link and coaches' paragraphs went, with the coaches'
  list, Cloudflare's record of each sign-in and #192's sentence matching a
  coach's send time to it, since production held no photo sent through that
  sign-in; so did the failed-join paragraph, whose last rows are deleted by
  hand (The cutover (#226), above). A photo sent with the invite link before
  then keeps, in the past tense, which link it came with and when that phone
  opened it, and nothing naming who sent it. The phone's old cookie is
  deleted the next time it opens the share page or sends, and the daily
  count is per account.
- **#220 added the request form's records**: when a request was made, which
  teams still wait, whether the admins have been emailed, and the request
  limit, with how long it keeps a scrambled address and that the address's
  time matches the account's, to the second, for that hour (owner, at
  #220's review). `npm test` holds its 10 and 100 an hour to the code, and
  that the two times are equal.
- **#198 added clips**: the clip half of the location paragraph, the Clips
  section (the caps, the day's clip budget, what is kept for a clip and while
  one is sent, and how to have one deleted while there is no button), and
  clips in the daily count. Each claim has its own row in the head comment's
  clips' block. `npm test` holds its minutes and GB to `lib/photos.js`.
- **#310 named clips in the admins' log sentence**: an admin "hid every photo
  and clip it sent", since Hide all hides an account's clips too. Nothing
  public changed, and `npm test` holds the new sentence.
- **#273 added the events an account makes**: "What an account keeps" names
  the events the account made, and "Having an account deleted" says they
  stay and stop naming it. The page describes an event's title and promises
  no check of it: the team's senders see it at once, it is public from the
  event's first approved photo, one of the site's admins can change it, and
  children's names are to be left out of it. A public event's title stays in
  its address after a rename, and the address an event had before its first
  approval is kept with it. "Having an account deleted" offers to change the
  titles of the events the person made, as it offers to take their photos
  down; the address of an event already public stays as it is. The head comment traces each claim, and
  `photos/test/policy.test.js`'s list of tables no longer says albums name no
  account.
- **The header and footer live in five files**: `photos/public/404.html`,
  `policy.html`, `share/index.html`, `photos/templates/page.html` and
  `photos/lib/admin-page.js`. The header's nav holds one link, **Team
  photos**, to `/` (it read "All albums" until #227 made `/` the way into
  each team's section; `/policy` left it on 2026-10-01 and the footer links
  it). It marks no `aria-current`, so all five stay byte for byte the same.
  Every other link to `/`, each eyebrow included, is named Team photos too.
  The tests fail until they agree.

### Taking a photo down

Anyone can, with **Remove this photo** under each photo on an album page
(#158; epic #147, D7). `CLAUDE.md`, The photo site, item 19 has the
decisions.

- **It hides the photo from everyone at once.** A dialog says so first and
  takes an optional note of up to 500 characters; without JavaScript, the
  button opens a page that asks the same, at `/remove`. Both post to
  `POST /api/remove`, which sets the photo `hidden` with the time and the
  note. Its image routes answer 404 from the next request and its album page
  no longer lists it. A browser that already loaded the photo may keep it for
  300 seconds (`CLAUDE.md`, The photo site, item 3).
- **10 takedowns an hour from one network address**, then 429. Only a
  takedown that hid a photo counts, in `removal_requests` (migration 0006),
  which keeps the address as a keyed hash, as the request and sign-in limits
  do. A row is deleted once it is over an hour old by the next takedown, or
  sooner by the next load of `/admin` or `/admin/removals`.
- **An email takedown** (the policy gives `dave@madcowsailing.com`) is done
  the same way: open the photo's album and press the button. The photo's id
  is the number in its link, `/photos/<id>/screen`. When the button is
  refused, by the limit on your own network (429) or because the site cannot
  take photos down (503), do it by hand (below).

### Taking a photo down by hand

The fallback for when **Remove this photo** is refused (owner, at #158's
review): an admin handling several emailed takedowns can pass the 10 an hour
on their own network, and without `ADDRESS_HASH_KEY` the button answers 503.
From `photos/`, with the D1 token in `photos/.env` (above):

1. Find the photo's id: the number in its link on the album page,
   `/photos/<id>/screen`. If the sender attached the file instead, open the
   album and match it by eye.
2. Hide it:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "UPDATE photos SET state = 'hidden', hidden_at = unixepoch(), hidden_note = NULL WHERE id = <id> AND kind = 'photo' AND state = 'approved'"
   ```

3. Read it back. `--command "SELECT id, state FROM photos WHERE id = <id>"`
   must say `hidden`, and `https://photos.madcowsailing.com/photos/<id>/grid`
   must answer 404. A browser that already loaded the photo may keep it for 300
   seconds (`CLAUDE.md`, The photo site, item 3).

The photo then waits on `/admin/removals` like any other, with no note, and
no takedown is counted against anyone's limit. `photos/test/policy.test.js`
runs the step-2 statement against the real schema, so it fails if the schema
stops taking it.

### Deleting a clip by hand

A clip has no **Remove this photo** button while no public page shows clips
(#198; #286 brings them onto the album pages). `/policy` tells the sender to
email the address at the top of the page instead, and an admin deletes it for
good. A waiting clip is deleted with **Reject** under it on `/admin/queue`.
An approved one, which no page lists, is deleted by hand. From `photos/`,
with the D1 token in `photos/.env` (above):

1. Find it. This lists the approved clips, newest first, with each one's
   album, when it was sent and how many seconds it runs:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "SELECT photos.id, photos.media_key, albums.title, albums.held_on, datetime(photos.sent_at, 'unixepoch') AS sent, photos.duration_ms / 1000 AS seconds, photos.account_id FROM photos JOIN albums ON albums.id = photos.album_id WHERE photos.kind = 'clip' AND photos.state = 'approved' ORDER BY photos.sent_at DESC LIMIT 50"
   ```

   Signed in as an admin, `https://photos.madcowsailing.com/api/admin/clips/<id>`
   plays one, to match it by eye. Note its `media_key`.
2. Delete its row:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "DELETE FROM photos WHERE id = <id> AND kind = 'clip' AND state = 'approved'"
   ```

3. Delete its file. In the Cloudflare dashboard, R2 → `madcowphotos` →
   Objects, search for `photos/<media_key>/`, tick `clip` and delete it. The
   row goes first, as a reject's does (`CLAUDE.md`, The photo site, item 16):
   a file with no row is served by nothing, while a row whose file is gone
   would still be listed.
4. Read it back: step 1's statement no longer lists it,
   `/api/admin/clips/<id>` answers 404, and step 3's search finds nothing.

`photos/test/policy.test.js` runs the step-1 and step-2 statements against
the real schema, and fails if step 2 deletes anything but the approved clip
it names. The file is gone for good at step 3. The row stays in the
database's restore points for up to 30 days, as every deleted row does
(`/policy`, the end of Having an account deleted).

Since #310, **Hide all** on `/admin/people` takes every clip an account sent,
waiting or approved, to `/admin/removals`, where **Delete permanently**
deletes a clip's row and its one file, so a person who asks for everything
they sent to come down needs none of the steps above.

### Removal requests

Every photo taken down waits on `/admin/removals` (#158), behind the admin
sign-in, as the queue is, the oldest takedown first, with its album, its
team, when it was hidden, the account that sent it and the note. Since #310
so does every clip **Hide all** took down, or its fallback by hand (Hiding
every photo an account sent, by hand, below): a clip has no **Remove this
photo** until #286, so those are the only ways one arrives. A clip's row
gives its length and frame size and plays it through the admin clip route,
loading nothing until Play. A row no account names says "sent by a coach"
when a coach sent it (since #310, for both kinds). The admin home says how
many wait, photos and clips together.

- **All teams, Hoover JRT or COHSSA** (#227): the links at the top show one
  team's hidden photos and clips, at `/admin/removals?team=<team>`, and both
  presses land back on the same team.
- **Put it back** makes a photo approved and public again. When it was
  hidden and the note stay on its row as a record, and a later takedown
  writes over them. A photo an admin hid with **Hide all** while it was
  still waiting (#225) is marked "was waiting for approval", and putting it
  back returns it to the queue, never onto the site: it carries
  `approved_at` 0, the placeholder 0005's CHECK needs on a hidden row. A
  clip goes back the same way (#310): an approved one is approved again,
  kept but shown nowhere public until #286, and one hidden while waiting
  returns to the queue.
- **Delete permanently** asks first, in a dialog, then deletes the row and
  its files for good: a photo's three, or a clip's one (#310). It needs
  JavaScript.
- A hidden photo or clip keeps its row and its files until one of those, so
  nothing is lost while it waits. A clip still being sent is never hidden,
  so it never reaches this page.

### Email

The site sends plain-text email through Resend's HTTP API (#217;
`photos/lib/mail.js`, and `CLAUDE.md`, The photo site, item 21, for why).
Mail comes from `no-reply@photos.madcowsailing.com` as "Mad Cow Sailing
photos", and replies go to `dave@madcowsailing.com`. Set up on 2026-10-01 and
read back from Resend's dashboard and public DNS that day:

- **The Resend account is its own**, under `dave@madcowsailing.com`, signed in
  with email and password and an authenticator code (MFA on). It is not the
  login that holds Taskr's and Tender's domains, so its quota is the site's
  alone. Team `madcowsailing`, on the Free plan: 100 emails a day, 3,000 a
  month, 3 domains, 10 requests a second, and pay-as-you-go off, so nothing
  is sent past the limit and nothing is billed.
- **The domain** is `photos.madcowsailing.com`, region North Virginia
  (`us-east-1`), verified at 17:04 UTC. Sending is on and **receiving is
  off**, so there is no MX record: Resend counts mail it receives toward the
  same daily limit, and an MX would let anyone spend it. Click and open
  tracking are off (no tracking subdomain), so every link arrives as written.
  TLS is Opportunistic, the default.
- **The records**, written by Cloudflare's Auto configure (Domain Connect,
  groups `dkim`, `outbound` and `mta`), all DNS only:

  | Name | Type | Content |
  |---|---|---|
  | `resend._domainkey.photos` | TXT | the DKIM public key, `p=MIGfMA0…`, 218 characters |
  | `send.photos` | CNAME | `send.forge.rmta.net` |
  | `rsend.photos` | CNAME | `rsend.forge.rmta.net` |

  Read back from `dell.ns.cloudflare.com`, `1.1.1.1` and `8.8.8.8`, the DKIM
  value byte for byte equal to the key Resend sent Cloudflare. The apex's
  Zoho records (MX, SPF, `zmail._domainkey`, `_dmarc`) read the same after as
  before, and a message the owner sent from `dave@madcowsailing.com` through
  Zoho at 17:55 UTC read `spf=pass`, `dkim=pass` (selector `zmail`) and
  `dmarc=pass` at Gmail.
- **No DMARC record of its own** (owner, 2026-10-01). `_dmarc.madcowsailing.com`
  covers the subdomain by fallback, reports included. Resend's DMARC row
  therefore reads "not started" for good, which is expected. If one is ever
  added, it is `_dmarc.photos`: Resend suggests the bare `_dmarc`, which would
  replace the policy for all of madcowsailing.com.
- **Sending a test**: `/admin/mail` sends a fixed message to any address an
  admin types, naming the environment that sent it. It counts toward the
  daily limit like any other email.
- **Past the daily limit** Resend refuses each send with `429
  daily_quota_exceeded` until midnight UTC. Nothing is queued or retried: the
  site says so and logs the status and error name.
- **What the log holds**: the outcome, Resend's status and its error name.
  Never an address, a subject, a body, or Resend's own message, which can
  quote an address. `photos/test/mail.test.js` plants each one.
- **Locally**, `photos/.dev.vars` has no `RESEND_API_KEY`, and must not get
  the real one, so `/admin/mail` answers that it is not configured. The
  tests stand in for Resend.

**Replacing the key**: in Resend, API keys → Create, with the same name,
Sending access and the domain `photos.madcowsailing.com` (the picker offers
only verified domains). Copy it and paste it straight into `RESEND_API_KEY`
in production and in preview (Settings → Variables and Secrets, type
Secret). A secret applies from the next deployment, so redeploy both. Then
delete the old key in Resend.

### Password hashing

Every password the accounts epic (#216) stores is hashed by
`photos/lib/password.js`: scrypt from `node:crypto`, N=2^14, r=8, p=5
(#218; `CLAUDE.md`, The photo site, item 23, for why). Since #222 a password
set at `/set-password` is stored this way (Signing in, below).

- **Measuring its CPU** on the develop preview: open
  `https://develop.madcowphotos.pages.dev/admin/`, which takes the preview's
  Access PIN and then, since #224, the site's admin sign-in: an admin account
  on the preview database (Making the owner), its password and the emailed
  code. Then drive
  `GET /api/admin/password-probe` 20 times from inside that page, alone in one
  UTC minute, and `?run=none` the same way in another minute as the control.
  Read both minutes from the GraphQL Analytics API's
  `pagesFunctionsInvocationsAdaptiveGroups` by `datetimeMinute` and `status`,
  with a token holding Account → Account Analytics → Read only. Keep a minute
  only if its request total is the 20 sent **and it has 0 errors**, and write
  its `avg { sampleInterval }` beside the quantiles. The request total is
  scaled up from a sample, so a sampled minute still reads 20 while its
  quantiles come from fewer requests. A request cut for CPU answers `503`
  with the page *Worker exceeded resource limits* (Error 1102), and **this
  dataset's status reads `exceededResources`**, not the `exceededCpu` the
  Workers limits page names (*measured* 2026-10-05). So a minute with errors
  is not the hash's cost: it is the reading that the hash does not fit, and
  item 8 records it as that. The cut is not applied to every request: on the
  free plan 18 of 20 hashes ran at about 115 ms of CPU and 2 were cut.
  **Measure only on a deployment made after the last plan change.** The
  deployment that was live when the account moved to Workers Paid kept cutting
  at 50 ms, the old Bundled model's limit, until it was redeployed (Deployments
  → the row's *More actions* → *Retry deployment*).
  `CLAUDE.md` item 8 holds the readings.
- **`?run=hash` answers the hash it made**, so the deployed runtime's output
  can be checked in Node: it verifies against the probe's fixed password.
- **`?run=over-cap`** shows what the deployed runtime answers one step past
  its PBKDF2 and scrypt limits. Local wrangler's answer differs for PBKDF2, so
  read it on the preview.
- **The probe answers 404 on production**, so nothing there can be made to
  spend CPU through it.

### Account requests

Anyone can ask for an account at `/ask` (#220, the first story of epic #216
to keep anything about a person; `CLAUDE.md`, The photo site, item 25, has the
decisions). Nothing linked to it at first (owner, at #220's pickup). Since
#226 the share page links it ("No account yet? Ask for one"), and an old
invite link and `POST /api/join` point to it.

- **The form** takes a name, an email address, parent, coach or other, Hoover
  JRT, COHSSA or both, and an optional note of up to 500 characters. It asks
  no sailor's name, and the note's hint says to leave one out (D18).
- **Turnstile is checked on the server first.** A token siteverify does not
  pass is answered `403`, and nothing is kept. Only `/ask`'s CSP admits
  `https://challenges.cloudflare.com`; every other page keeps the site's.
  `photos/public/js/ask.js` adds Turnstile's script the first time someone
  focuses or touches the form, not with the page, which kept `/ask` over the
  performance floor (owner, at #220's review). A page sent back with a reason
  adds it at once.
- **10 requests an hour from one network address, and 100 an hour from
  everyone together**, then `429` with Retry-After. Only a request past
  Turnstile counts, and once the site's hour is spent a request writes
  nothing at all. `account_request_log` keeps each address as a keyed hash,
  as the takedown and sign-in limits do, and a row is deleted once it is over
  an hour old, by the next request the site takes or the next load of
  `/admin`.
- **One account per email address**, matched without regard to letter case.
  A request from an address the site already has writes nothing, and is
  answered with the same `303` to `/ask?sent` as a new one. That includes a
  turned-down address (owner, at #221's pickup): an admin who changes their
  mind approves it on `/admin/people` instead. **A revoked address writes
  nothing either** (#225), while its account exists and after it is
  deleted: its keyed hash stays in `revoked_addresses`, by the same
  statements, until an admin re-approves the account or, once it is
  deleted, lets the address ask again (Approving accounts, below).
- **The admins hear at most once an hour.** The first new request emails
  every admin at once (since #224 each account holding the admin role, where
  it was each address on `ADMIN_EMAILS`) and opens the hour; requests inside
  it send nothing; the first after it sends one email naming everyone since,
  by name, role and teams only, with a link to `/admin/people` (below). The
  admin home says how many requests wait, which is how a request that no
  later one follows is seen. If no admin's email goes through, the requests
  stay unnamed and the next request tries again.

### Approving accounts

`/admin/people` (#221; `CLAUDE.md`, The photo site, item 26, has the
decisions) lists every request for an account in four lists: **Waiting**,
**Approved**, **Revoked** (since #225) and **Turned down**. The admins' log
is under them.

- **Each team is decided on its own** (D16). A waiting request's form has a
  box per team, ticked, and the role the requester chose. **Approve** takes
  the ticked teams and the role. **Turn down** takes the ticked teams and
  sends nothing. A turned-down team keeps an unticked box under Approve, so a
  mistake can be undone.
- **Approving emails a link to set a password**, to the address on the
  request, from `no-reply@photos.madcowsailing.com`. The link is
  `/set-password?token=…`, and it works once, for 7 days. **"Send a new
  link"** on an approved person sends another, and once that email is sent the
  last one stops working. If Resend refuses the email, the page says why, the
  new link is deleted and the last one keeps working; if Resend does not
  answer, both work. The approval stands either way.
- **The link opens the form to choose a password** (#222; Signing in, below).
  Opening a link spends nothing, so a mail scanner fetching it cannot use it
  up. A used, expired, replaced or mistyped link answers `404` with one page
  for all of them.
- **The log** records who did what to whom, and when: each approval and
  turn-down per team, a role change, and each link sent, with how the email
  went; since #224 each admin made or removed, and since #225 each revoke per
  team, each set of photos hidden with how many (since #310 photos and
  clips, with how many of each), each delete, and each address let ask
  again. A link's entry is written with the link itself, so no link exists
  without one. It copies the person's name and address into every entry, so
  it still names them after their account is deleted. The page shows the
  newest 100, and nothing deletes from the table.
- **A link's row holds only the token's SHA-256** (`password_links`). An
  expired row is deleted by the next load of `/admin/people` or the next link
  sent.
- **Admins** (#224; `CLAUDE.md`, The photo site, item 30). Each person shows
  whether they are the owner or an admin. **"Make admin"**, on anyone approved
  for a team, is any admin's to press; **"Remove admin"**, on an admin, is
  the owner's alone, and the owner's own role can never be taken (the owner's
  choices at #224's pickup). Neither emails anyone. "Make admin" signs the
  person out on every phone and computer, and they open the admin pages at
  their next sign-in, which asks for an emailed code (Signing in, below, says
  where they are reached); so a cookie from before
  a removal cannot open them again if they are made an admin again (the
  owner's choice at #224's review). A removed one is refused from their next
  request, and their account still sends. Both are in the log. The owner is
  made once, by hand (Making the owner, below).
- **"Revoke, hide their photos or delete"** (#225; `CLAUDE.md`, The photo
  site, item 31) opens under each person, holding whichever of the three
  apply. Since #310 it names clips too for someone who sent any ("hide their
  photos and clips", or "hide their clips"). Revoke and Delete are not there
  for anyone holding the admin role: the owner presses "Remove admin" first
  (the owner's choice at #225's pickup), which keeps removing an admin the
  owner's alone.
  - **Revoke** takes the ticked teams away, none ticked to start with;
    ticking every one revokes the account. It signs the person out on every
    phone and computer at their next request, a single team's revoke
    included, and they sign in again only to the teams they keep. Their
    approved photos stay up, nothing is emailed, and their address is kept
    as a keyed hash (`revoked_addresses`), so a new request from it changes
    nothing. Someone revoked from every team moves to the **Revoked** list.
    Since #226 an account is the only way to send, so a revoke from every
    team ends the person's sending.
  - **Taking a revoked person back** is Approve, on the revoked team's
    unticked box. It emails the usual link to set a password, which someone
    who already has one can ignore. Once no team is left revoked, their
    address's hold is lifted in the same press. A session from before the
    revoke stays ended.
  - **Hide all their photos** takes down every photo the account sent,
    waiting or public, and since #310 every clip, waiting or approved; a clip
    still being sent is left alone. Its box names the count, which must be
    ticked. For someone who sent a clip, the box counts photos and clips
    apart, an approved clip is "approved", never "public" (nothing public
    shows a clip until #286), and the button reads **Hide all their photos
    and clips**, or **Hide all their clips** when they sent only clips. Each
    then waits on `/admin/removals` naming the account, with no note, and no
    takedown is counted against anyone's limit. One that was waiting is
    marked so there, and **"Put it back" returns it to the queue**, not onto
    the site.
  - **Delete the account** is for someone who asked by email. Write to the
    account's address and wait for a reply from it, as Deleting an account
    by hand (below) says; the box "… replied to confirm they asked for this"
    must be ticked, and is the admin's word for it, since the site cannot
    read the reply. The delete takes what README's statement by hand takes,
    and the log keeps naming the person. Each of the account's photos and
    clips keeps only the day it was taken down, not the second, which would
    otherwise match the log's "hid every photo" entry and name the person
    (the owner's choice at #225's review; the cut names no kind, so it
    reaches the clips Hide all takes since #310). If they asked for what they
    sent to come down too, press Hide all first: afterwards nothing finds it
    as a group. If they asked for the titles of the events they made to
    change, change each on `/admin/albums` first, where each names them
    (#273); the delete leaves every event they made at its address, naming
    nobody.
- **A deleted account's address**, under Revoked: when a revoked account is
  deleted its address stays held back, kept only as its keyed hash, so a new
  request from it changes nothing. Type the address and press **Let it ask
  again** to lift that. It needs a log entry naming the address as typed,
  and it is logged itself; nothing is emailed.

### Making the owner

The owner role goes to one account, once per database, by hand: no address
may go into this public repo, so no migration can name the owner (owner, at
#224's pickup). The database then refuses a second owner, and any change that
would demote, revoke or delete the owner (migration 0013). Both databases
have had their owner since 2026-10-07 (#224's closing comment). These steps
are for a database made again: it runs #224's code from its first request,
so there is no admin to approve the owner's account on `/admin/people`, and
the approval is made by hand (#260). From `photos/`, with the D1 token in
`photos/.env` (above), each statement on the database the steps are for
(`madcowphotos-preview --env preview`, or `madcowphotos --env production`):

1. Ask for the owner's account at `/ask`, with the owner's address, the role
   the owner sends as, and the teams. Step 3 keeps the role and the teams as
   asked. On the preview, Access's PIN comes first, as on every path there.
2. Find its id (step 1 of Deleting an account by hand, below). Read it, never
   assume it: the preview's ids go on from deleted rows, so its owner is not
   account 1.
3. Approve it by hand, with the two statements Approve runs on
   `/admin/people` (`teamLog`, then `teamChange`, in `lib/people.js`), their
   parameters written in. First the log entries, while the teams still wait:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) SELECT unixepoch(), a.email, 'approve', a.id, a.name, a.email, t.name FROM accounts AS a JOIN account_teams AS x ON x.account_id = a.id JOIN teams AS t ON t.team = x.team JOIN json_each(json_array('hoover-jrt', 'cohssa')) AS j ON j.value = x.team WHERE a.id = <id> AND x.state IN ('requested', 'rejected', 'revoked') ORDER BY j.key"
   ```

   then the teams:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "UPDATE account_teams SET state = 'approved' WHERE account_id = <id> AND team IN (SELECT value FROM json_each(json_array('hoover-jrt', 'cohssa'))) AND state IN ('requested', 'rejected', 'revoked')"
   ```

   Each changes 1 row for each team the request named; a team it did not
   name has no row, and is skipped. The log names the owner as the admin
   who approved, as the page would have. Run again, each changes nothing.
   `json_array` gives the teams as the JSON list the page passes, whose
   double quotes could not go inside `--command "…"`.
4. Ask for a link at `/forgot-password` with the owner's address, and set the
   password from it. Nothing sends the approval's email by hand, and a reset
   goes to any account approved for a team, with a password or without
   (Signing in, below). Its link works once, for 1 hour, where the
   approval's lasts 7 days, and it adds nothing to the log.
5. Make it the owner:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "UPDATE accounts SET admin_role = 'owner' WHERE id = <id> AND EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = accounts.id AND t.state = 'approved')"
   ```

   It changes 1 row, or none for an account approved for no team. A second
   run on the same account changes 1 row and alters nothing, because 0013's
   trigger skips an update that leaves the role as it was. Another account
   is refused: `there is an owner already`.
6. Read it back: `--command "SELECT id, email, admin_role FROM accounts WHERE
   admin_role IS NOT NULL"` lists the one owner.

The owner then signs in, opens the admin pages (Signing in, below, says
how), and makes the other admins on `/admin/people`.
`photos/test/policy.test.js` runs step 3's statements on one copy of the real
schema and the page's `approveTeams` on another, and fails unless every
table holds the same rows; then step 4's reset and step 5's statement on the
same account. It runs step 5's statement on an account approved for no team,
a second time on the owner, and on another account too.

**Until #268, Cloudflare Access stood in front of `/admin` on
`photos.madcowsailing.com`** (#224's criterion 7), so an admin not on its
policy opened the admin pages at `https://madcowphotos.pages.dev/admin/`, and
everyone on it met Access's PIN before the site's sign-in and its code. #268
deleted that application on 2026-10-07: every admin now signs in once, on
either hostname.

### Signing in

An approved person sets a password from their emailed link, signs in at
`/sign-in`, and resets a forgotten password at `/forgot-password` (#222;
`CLAUDE.md`, The photo site, item 27, has the decisions). Since #223 the share
page links `/sign-in` ("Have an account? Sign in"), and `/account` links the
share page, where an account sends (Uploads, above). Since #226 the share
page links `/ask` beside it ("No account yet? Ask for one").

- **The password**: 15 to 256 characters, counted after NFC, with no rules
  about mixing kinds. It is turned down when it is the person's own address
  or name or the site's name, or when Have I Been Pwned's Pwned Passwords has
  seen it in a breach. That check sends only the first 5 characters of the
  password's SHA-1, and if the service does not answer within 3 s the
  password is let through and the miss logged (owner, at #222's pickup).
- **The session** is the `__Host-account` cookie, signed with
  `SESSION_SIGNING_KEY`, for 90 days. It names the account and its session
  version. Signing out, setting a password and an admin's revoke of any team
  (#225) each add 1 to the version, which ends every session the account
  holds at its next request, on every device, so a re-approval brings no
  old cookie back. The guard also reads only an account approved for a
  team. `/account` is the page behind it, with Sign out.
- **Failed sign-ins**: 10 an hour per email address (counted for an address
  with no account too), 20 an hour per network, and 100 an hour for the whole
  site, after which nobody can sign in until the hour turns. Each try claims
  its units before the password is checked, so tries sent at once cannot all
  pass, and a sign-in that succeeds gives them back. Each failure is kept
  for an hour as keyed hashes in `sign_in_failures`. After 100 failures in a
  row an account's password stops working until a new one is set from a
  reset link. Every failure answers with the same page, after the same
  statements.
- **A reset** emails a link to `/set-password` that works once, for an hour,
  only to an account approved for a team, whether or not it had a password.
  At most one every 15 minutes per account while an earlier link waits to be
  used, 20 a day for the whole site, and 10 requests an hour per network. The form sits behind the `/ask` Turnstile
  widget, and its answer is the same `303` whether or not the address has an
  account; the email goes after the answer.
- **A password that stopped working** comes back only through a new
  password: from a reset, or from "Send a new link" on `/admin/people`.
  Setting it puts the count of failures in a row back to 0.
- **An admin's sign-in takes a code** (#224). Once an admin's password
  passes, the site emails a 6-digit code to the account's address and sends
  the browser to `/sign-in/code`. The code works once, for 10 minutes, with 5
  tries, only in that browser (a `__Host-sign-in-code` cookie names the
  sign-in), and is kept only as a keyed hash in `admin_codes`. The right code
  opens the account's 90-day session and an admin session, `__Host-admin`,
  which every admin page and admin API checks on every request: the role,
  the session version and an approved team. **The admin session lasts 12
  hours, or 30 days on a phone the admin asks the site to remember** (#274):
  the code step has a "Remember this phone for 30 days" box, unticked to
  start with, and a page showing the form again after a wrong code keeps the
  tick. The length is signed into the cookie with the rest, so a 12-hour
  cookie cannot be edited into a 30-day one, and the server checks the
  cookie's age itself rather than trusting the browser to drop it. Admin
  cookies from before #274's release are refused, so each admin who had the
  admin pages open then signs in once more. The right code lands on
  `/account`, whose "Open the admin pages" link opens them: until #268,
  Access stood in front of `/admin` on `photos.madcowsailing.com`, and
  Chromium and WebKit stopped a form's redirect into its login under the
  page's `form-action 'self'`, where a link went through (#224's review). An admin
  is sent at most 10 codes in any 24 hours; a code whose email Resend
  refused is deleted and does not count, and a new password deletes the
  account's codes, so a reset lifts the limit at once. A password's step at
  `/sign-in` and a new password delete any admin cookie the browser held,
  and the code step replaces it, so the browser is one person. The admin
  home says until when this session lasts, and holds two buttons (#274).
  **Forget this phone** ends the admin pages in this browser only: it stays
  signed in to send photos, and every other phone and computer is as it
  was. **Sign out** ends every session the account holds, as `/account`'s
  does. Forget writes nothing on the server, which keeps no list of admin
  cookies, so a copy of the cookie taken off the browser keeps working
  until its length runs out, 30 days for a remembered phone, or until Sign
  out, a new password, or the account losing its admin role. A lost phone
  cannot press Forget: Sign out on any other phone or computer, or set a
  new password through `/forgot-password`, and the lost phone's sessions
  end at its next request, its admin one included. A refused admin request
  lands on `/sign-in?admin`, which says so.
- **The way to the admin pages** (#260) is the `/admin/` address, which
  takes a browser with no admin session to `/sign-in?admin`, or the **Open
  the admin pages** button on `/account`. The button is drawn on each load
  of `/account` for an account holding the role, so a page loaded before the
  role was given has none until it is loaded again. Nothing on the home or
  team pages links either: #272's Add photos button is to lead from there to
  `/sign-in`.

### Hiding every photo an account sent, by hand

The fallback for **Hide all** on `/admin/people` (#225; Approving accounts,
above), for when the page cannot be reached (#223, criterion 6; #219's
review). Since #310 it takes the account's clips as the button does. Unlike
the button, it hides only the approved photos and clips, and turns the
waiting ones of both kinds down in step 4. Do it **before** the delete below:
deleting the account stops what it sent naming it, so afterwards nothing
finds it as a group. From `photos/`, with the D1 token in `photos/.env`
(above):

1. Find the account's id with step 1 of the delete below.
2. Hide every approved photo and clip it sent:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "UPDATE photos SET state = 'hidden', hidden_at = unixepoch(), hidden_note = NULL WHERE account_id = <id> AND state = 'approved'"
   ```

3. Read it back. `--command "SELECT state, COUNT(*) FROM photos WHERE account_id
   = <id> GROUP BY state"` must list no `approved`, of either kind.
4. Turn down its waiting photos and clips on `/admin/queue`, where each says
   who sent it. Turning down deletes them. A clip still being sent is left
   alone: once it arrives it waits in the queue with the rest, and one never
   finished is cleared a day after it started.

The hidden photos and clips wait on `/admin/removals`, each naming the
account, to be deleted for good or put back, and no takedown is counted
against anyone's limit. `photos/test/policy.test.js` runs the step-2
statement against the real schema: it hides exactly the account's approved
photos and clips, and nothing waiting, still being sent, hidden already, or
sent by anyone else.

### Deleting an account by hand

The fallback for **Delete the account** on `/admin/people` (#225; Approving
accounts, above), for when the page cannot be reached (#219; owner,
2026-10-05). **Only once a reply from the
account's own address confirms the request**, since a delete cannot be undone
and a request can come from anyone. If the request asks for the photos to come down too,
hide them first (above). If it asks for the titles of the events the account
made to change, change each under **Edit** on `/admin/albums` first, where
each names the account until the delete (#273). The button refuses an admin's account until the
owner removes the role; this statement refuses only the owner's and the last
admin's, so for an admin, have the owner press "Remove admin" on
`/admin/people` first. From `photos/`, with the D1 token in `photos/.env`
(above):

1. Find the account, and check it is the one the email is about (write any `'`
   in the address twice):

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "SELECT id, name, email FROM accounts WHERE email = '<address>'"
   ```

2. Write to that address asking for a reply to confirm, and wait for it.
3. Cut each of its photos' and clips' takedown time to the day, as the
   button does, so none's time matches a log entry naming the person (#225;
   a clip since #310, which the statement reaches since it names no kind):

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "UPDATE photos SET hidden_at = hidden_at - hidden_at % 86400 WHERE account_id = <id> AND hidden_at IS NOT NULL"
   ```

4. Delete it:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "DELETE FROM accounts WHERE id = <id>"
   ```

5. Read it back: step 1's statement must return no row.

Its teams, any unused link to set a password and, for an admin, its sign-in
codes go with it (`ON DELETE CASCADE`). The owner's account is never deleted,
and nor is the last admin's: the database refuses the statement (`the owner
account is kept`, migration 0013, #224). The photos it sent stay as they are and stop naming it: their
`account_id` becomes NULL (`ON DELETE SET NULL`, migration 0012, #223), and
each still says whether a coach's account sent it. The events it made stay
too, at their addresses and with their titles, and stop naming it: their
`albums.created_by` becomes NULL (`ON DELETE SET NULL`, migration 0018,
#273), with no statement of their own, and one still provisional is fixed
at its first approval as before. `photos/test/policy.test.js`
runs the step-3 and step-4 statements against the real schema, with a row in
every table, and fails if any row afterwards names the account's id or
address, or if a photo's or clip's takedown time still matches a log entry
naming the person. Only these
may: the admins' log entries (#221), which keep naming the person, as the test
also checks; and the day's upload count under `account.<id>`, until anyone's
first upload of a later day clears it (#223). A revoked account's address
stays too, as its keyed hash in `revoked_addresses` (#225), but that row stops
naming the account (`ON DELETE SET NULL`, migration 0014), and the test checks
it stays and that a new request from the address still changes nothing. The
database's restore points keep the account for up to 30 days, as `/policy`
says.

## The push guard

`githooks/pre-push` refuses a local push to `develop`, `main`, `master` or
`release`. It is the same driver cairn maintains, copied verbatim — check with:

```sh
sha256sum githooks/pre-push ~/Code/cairn/githooks/pre-push
```

A hash that differs means this repo is running an older driver, and every
divergence in that driver's history failed **silently**: CR stripping, hand-run
support, and a hang when stdin is an open pipe. None of them announced itself.

**It is not installed by cloning.** `.git/` is not tracked, so every clone and
every machine needs:

```sh
git config core.hooksPath githooks
```

Verify with `git config core.hooksPath`. An uninstalled hook produces no error
and no output — every symptom is an absence.

This is a local echo of the rule, not the rule itself. `--no-verify` skips it
and it only exists on a machine that installed it. The server-side half is
GitHub branch protection, and this repo being **public** means that is actually
available (GitHub gates rulesets on private repos behind Pro).

## Checks

`githooks/checks` and `.github/workflows/ci.yml` run the same list, so a red
push and a red build are the same event. `githooks/checks` is the authority; as
of #149 it is three commands:

```sh
npm ci                                            # once
npm run check                                     # html-validate over hq/, sailing/, photos/ and docs/
$PY tools/linkcheck.py hq sailing photos/public   # every internal href and src, against the tree
npm test                                          # the photo site's own tests, node --test
```

Run the whole list by hand with the pre-push hook, which also resolves `$PY`:

```sh
sh githooks/pre-push
```

`package.json` exists for two dev dependencies and nothing else: html-validate
for the gate, and wrangler, exact-pinned, to run the photo site locally and
apply its migrations. The sites themselves have no dependencies and no build
step beyond the one-line copy of `shared/` that Cloudflare Pages performs, and
Cloudflare's build never installs this `package.json`. Nothing in
`node_modules/` is served.

`no-inline-style` is switched off in `.htmlvalidate.json`, deliberately: the
trip-log gallery sets each photo's LQIP placeholder as an inline
`background-image` data URI, which is per-photo data and cannot become a class.
Every other recommended rule is on. **`photos/.htmlvalidate.json` switches it
back on for the photo site**, whose Content-Security-Policy has no
`'unsafe-inline'`: an inline style there would be dropped by the browser
without an error, so the gate refuses it instead.

## Tools

`tools/` is developer tooling. None of these runs in a build.

| Script | What it does |
|---|---|
| `photos.py` | Builds a trip log's AVIF/WebP derivatives and its `trip.json`. Strips EXIF always. Needs Pillow ≥ 11.3. |
| `assetver.py` | Writes `?v=<hash>` onto every page's URL for a file in `shared/css/` or `shared/js/`, on all three sites (`photos/public/` since #149), and, since #176, for a file in the page's own site's `css/` or `js/`. Since #157 it stamps `photos/templates/` too. Run it after editing one; `linkcheck.py` refuses a page whose version does not match the file (#95, #176). |
| `trace_logo.py` | Re-traces `shared/img/` from `docs/source/madcow-lockup.pdf`. Needs Pillow. |
| `app_icons.py` | Renders the photo site's four app icons into `photos/public/icons/` from `shared/img/madcow-mark.svg`, with `trace_logo.py`'s fill and the colours from `tokens.css` (#193). Needs Pillow. `photos/test/app.test.js` holds what it writes. |
| `quality_floor.mjs` | Measures the `CLAUDE.md` quality floor on both **production** domains — Lighthouse at a pinned version, 360px scroll, keyboard reach, contrast pairs — and rewrites the generated block of `docs/quality-floor.md`. Needs Node and Chrome. Not in CI, by decision recorded in that doc. |
| `h2proxy.mjs` | Serves the photo site from `wrangler pages dev` over HTTP/2, so Lighthouse reads it locally the way production serves it. The photo site's floor is read through it (`CLAUDE.md`, Quality floor; #155). Needs a throwaway self-signed certificate; the header has the recipe, including how to read a page behind a sign-in with an `__Host-account` cookie (from `/sign-in`, or the local stand-in; `__Host-upload` from `POST /api/join` until #226). |
