# madcowsailing.com

Monorepo for **three** sites that share one design system, despite the
repo's name. Two are static; the third runs server code:

| Site | Directory | Audience |
|---|---|---|
| madcowhq.com | `hq/` | Hiring managers, recruiters, collaborators |
| madcowsailing.com | `sailing/` | Sailors |
| photos.madcowsailing.com | `photos/` | The team's families: albums anyone can browse, uploads by invite (epic #147) |

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
  uploads after 7 days; the video stories shorten it to 1 day (CLAUDE.md item 10).
- R2 is on the account's R2 subscription and Zero Trust on its Free plan
  (50 seats). Both were taken out for #149, $0 unless usage passes the free
  allowances.
- **Zero Trust team: `madcowsailing`**, team domain
  `madcowsailing.cloudflareaccess.com`. It is the issuer #151 checks. `madcow`
  was wanted and is taken by another account: the rename answered `409`, while
  the confirmation dialog had already shown `madcow.cloudflareaccess.com`.
- Three Access applications, read back from Zero Trust → Access controls →
  Applications on 2026-09-28 (#151) and, for the coach one, 2026-10-01 (#192):

  | | Admin (#151) | Coach (#192) | Previews (#149) |
  |---|---|---|---|
  | Name | `madcowphotos admin` | `madcowphotos coach` | `madcowphotos - Cloudflare Pages` |
  | Destinations | `photos.madcowsailing.com/admin`, `…/admin/*` and `…/api/admin/*` | `photos.madcowsailing.com/coach` and `…/coach/*` | `*.madcowphotos.pages.dev` |
  | Policy | `Admins - photos admin`: Allow, Include Emails (the admins' addresses, the same list as `ADMIN_EMAILS`), Require Login Methods: One-time PIN | `Coaches - photos coach`: Allow, Include Emails (the coaches' addresses, the same list as `COACH_EMAILS`), Require Login Methods: One-time PIN | `Allow Members - Cloudflare Pages`: Allow, Include Emails (the address #149 set, since #151 the admins' addresses, and since #192 the coaches') |
  | Identity providers | One-time PIN only, instant authentication on | One-time PIN only, instant authentication on | as #149 left it |
  | Session | 24 hours | 24 hours | as #149 left it |
  | AUD tag | `78d0a143…` = `env.production.vars.ACCESS_AUD` | `3be126b6…` = `env.production.vars.ACCESS_COACH_AUD` | `da25aceb…` = `env.preview.vars.ACCESS_AUD` and `ACCESS_COACH_AUD` |

  Both of each pair of paths are listed because Access's `/admin/*` does not
  match `/admin`, nor `/coach/*` `/coach`. The coach tag was read twice on
  2026-10-01: in the application's settings, and in the `kid` of the 302 that
  `https://photos.madcowsailing.com/coach` answers to a visitor with no
  sign-in, beside `/admin`'s `78d0a143…` as the control.
  The coach application is its own, not more paths on the admin one, because
  a policy applies to a whole application: a coach on the admin application
  would pass Access's sign-in into `/admin` (CLAUDE.md, The photo site,
  item 20).
  `madcowphotos.pages.dev`, the project's production address, is behind
  neither. The admin application's destination list offered it on 2026-09-28,
  so Access could cover it too. It was left out, so that address answers the
  site's own `403`, which is the check #151's criteria read.
  **The site's own token check is the lock; Access is the door to it.**
  `photos/lib/access.js` reads the tag from `ACCESS_AUD` and the team domain
  (`https://madcowsailing.cloudflareaccess.com`, issuer and key URL both) from
  `ACCESS_TEAM_DOMAIN`, both in `photos/wrangler.jsonc`, one pair per
  environment. It reads the addresses from the `ADMIN_EMAILS` secret (below),
  so a person needs to be in a policy **and** in that environment's secret:
  the policy alone gets a PIN and then a `403`. A tag changes only if its application is
  deleted and recreated; then `ACCESS_AUD` must change with it, or `/admin`
  refuses everyone.
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
  - `SESSION_SIGNING_KEY` (#150) signs the upload session cookie, a parent's
    and a coach's, and since #222 the account session cookie,
    `__Host-account`. Changing it ends every session at once, a coach's and
    an account's included; rotating the code ends only the parents' (#192).
  - `ADDRESS_HASH_KEY` (#150; #158 uses it too) keys the hash a rate limit
    stores instead of a network address.
  - `ADMIN_EMAILS` (#151) is the comma-separated list of addresses the admin
    guard lets in, compared without regard to letter case. It is a secret
    only so the addresses stay out of this public repo (owner's choice,
    2026-09-28). Unset or empty, every admin request is refused. A secret
    cannot be read back or appended to, so changing the list means typing the
    whole of it again, **in both environments**. Adding an admin is four
    changes: `ADMIN_EMAILS` in production and in preview, the `Admins - photos
    admin` policy, and the `Allow Members - Cloudflare Pages` policy, which
    decides who can open a preview at all. Leave the last out only for an admin
    meant to have no preview access; they then get Access's refusal there.
  - `COACH_EMAILS` (#192) is the comma-separated list of coaches the coach
    sign-in at `/coach` lets in, kept as a secret for the same reason as
    `ADMIN_EMAILS`, and compared the same way. Unset or empty, `/coach`
    refuses everyone and every coach's session is refused. It held only the
    owner's address when #192 set it (owner's choice). **Adding a coach is
    four changes**: `COACH_EMAILS` in production and in preview, the
    `Coaches - photos coach` policy, and the `Allow Members - Cloudflare
    Pages` policy (leave that out for a coach meant to have no preview
    access). **Each coach takes one of Zero Trust Free's 50 seats** once
    they sign in, and keeps it until removed (CLAUDE.md, The photo site,
    item 8). **Taking a coach off is the same four, then a redeploy of each
    environment**: Cloudflare's bindings page says a secret "needs to be done
    before a deployment that uses those secrets", so the running deployment
    keeps the old list until a new one is built (Deployments → the newest
    production deployment → Retry deployment, and the same for `develop`'s
    preview). From the first request the new deployment serves, the coach's
    session is refused. *Read from the docs, not yet measured on a
    deployment.* Taking them off the policy stops a new sign-in at once, but
    not a session already open.
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
  different values. Without them, `POST /api/join`, `/sign-in` and
  `POST /set-password` answer `503` and open nothing, and without
  `ADDRESS_HASH_KEY`, `POST /api/remove`, `POST /ask` and `/forgot-password`
  answer `503` and change nothing. Check that all six exist in both
  environments on the dashboard, which shows a secret's name and never its
  value.
- **Local only, in `photos/.dev.vars`** (gitignored; `wrangler pages dev` reads
  it): the same two keys, with throwaway values. Make it with
  `node -e "const k=()=>require('crypto').randomBytes(32).toString('base64url');require('fs').writeFileSync('.dev.vars','SESSION_SIGNING_KEY='+k()+'\nADDRESS_HASH_KEY='+k()+'\n')"`
  from `photos/`, which prints nothing. For the admin pages, add the three
  lines under Running it locally.
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

It also needs `photos/.dev.vars` (Secrets, above). A local invite code is made
the way a real one is, on the admin page (below): open
`http://127.0.0.1:8789/admin/code`, press **Create code**, and open the
`http://127.0.0.1:8788/share/#code=…` link it shows.

`GET /api/health` should answer `200` with `"environment":"preview"`, both
bindings reachable, and the newest migration's name. The local database and
bucket are stand-ins under `photos/.wrangler/`, never the real ones.
`--no-install` keeps `npx` on the wrangler pinned in the root `package.json`.

**The admin pages run locally behind a stand-in for Access**, with the real
token check and no way around it (#151). Add three lines to `photos/.dev.vars`,
which `wrangler pages dev` reads in place of `wrangler.jsonc`'s values for
those names:

```sh
ACCESS_TEAM_DOMAIN=http://127.0.0.1:8789
ACCESS_AUD=local
ADMIN_EMAILS=<any address>
```

Then, beside `wrangler pages dev`, run `node scripts/access-dev.mjs` from
`photos/` and open `http://127.0.0.1:8789/admin/`. It generates a key pair,
publishes the public half where the guard fetches a team's keys, and forwards
each request to `:8788` with a freshly signed token. `/admin/` on `:8788`
directly answers `403`, which is the other half worth seeing. It passes its own
Origin on as the site's, as one host does on production, so the admin pages'
forms get past the site's Origin check (#152); any other Origin goes on
unchanged, and is refused.

**The coach sign-in runs locally the same way** (#192). Add two more lines:

```sh
ACCESS_COACH_AUD=local-coach
COACH_EMAILS=<any address>
```

Restart both, then open `http://127.0.0.1:8789/coach`. The stand-in signs
`/coach` and anything under it for the first coach address and
`ACCESS_COACH_AUD`, and every other path for the admin as before, so the
browser lands on `/share/` able to send. Without the two lines it forwards
`/coach` with no token, and the guard answers `403`.

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

**After restarting the stand-in, the admin pages answer `403` for up to a
minute.** It makes a new key each time it starts, and the guard fetches a
team's keys at most once a minute (`REFETCH_GAP_SECONDS` in `lib/access.js`),
so the new key is unknown until then. On #152, two reads after a restart
answered `403` and the next, 18 s after the second, `200`.

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

### The invite code

A parent joins by opening `https://photos.madcowsailing.com/share/#code=<code>`.
The code is made and changed on the admin page, `/admin/code` (#152), signed in
through Access: `https://photos.madcowsailing.com/admin/code` for production and
`https://develop.madcowphotos.pages.dev/admin/code` for the preview. **This
replaces the seed command #150 recorded**; `scripts/seed-code.mjs` is gone.

- **Create code.** A database with no code shows only this button, and parents'
  uploads stay closed until a code exists; a coach who signed in at `/coach`
  still sends (#192). It makes the first code, and only while there
  is still none, so a second press changes nothing. **Both remote databases
  already hold a code**: #150 seeded the preview's, and #151's close seeded
  production's (2026-09-28), each with the script this page replaced. So on both
  the page opens on that code, and Create code appears only on a fresh or local
  database.
- **Copy code** and **Copy invite link.** The page shows the current code, when
  it last changed, and the link. In production the link always names
  `https://photos.madcowsailing.com`. Anywhere else it names the address the
  page was opened on, so a preview's link opens the preview.
- **Rotate code.** It opens a dialog, and only the dialog's **Rotate now** makes
  a new code. Every parent's upload session opened with the old one is refused
  from its next request, and the old link tells whoever opens it that the
  invite has changed. Send the new link to the team. A coach's session has no
  code behind it, so it keeps working (#192, owner's choice); take a coach off
  the list instead (Secrets, above).

The code is never written to a file or to git; this repo is public.

### Coaches

A coach sends without the invite link (#192; epic #147, D9). They open
`https://photos.madcowsailing.com/coach`, sign in through Access with a
one-time PIN, and land on `/share/` able to send for 90 days. `CLAUDE.md`, The
photo site, item 20 has the decisions.

- **Who can sign in** is whoever is on both the `Coaches - photos coach`
  policy and `COACH_EMAILS`. Adding and taking off a coach are under Secrets,
  above, and taking one off needs a redeploy.
- **A coach's photos wait for approval** like a parent's, and the queue says
  "sent by a coach" beside each. The row keeps no address and no sign-in
  time, so it does not say which coach; when it was sent could still be
  matched against Cloudflare's sign-in log, which `/policy` says.
- **Opening the invite link keeps a coach's session**: `POST /api/join`
  answers a listed coach with 204 and leaves their cookie alone. A coach
  can also send when no invite code exists. The share page links `/coach`
  for a coach who lands there with no session.
- **On the preview** a coach opens `https://develop.madcowphotos.pages.dev/coach`,
  which needs the coach's address on the preview policy as well.
- `/coach` on `madcowphotos.pages.dev`, which no Access application covers,
  answers the site's own `403`, as `/admin` does there.

To read the current code without the page:
`npx --no-install wrangler d1 execute <database> --remote --env <env> --command "SELECT generation, code FROM invite_codes ORDER BY generation DESC LIMIT 1"`.

### Albums

Parents send photos into an album, one per regatta or practice day, kept on
`/admin/albums` (#153) behind the same Access sign-in as the code.

- **Add album** takes a title, Regatta or Practice, and the date. Its address,
  which a link to it names, is made then from the date and title
  (`2026-10-04-fall-regatta`) and never changes, so editing the title, kind or
  date under **Edit** keeps every link working. A second album with the same
  date and title gets `-2`.
- **Close** stops uploads to an album and takes it off the share page's list;
  its approved photos stay public. **Reopen** undoes both.
- **Delete** works only on an empty album. One holding any photo, waiting,
  approved or hidden, is refused and the page says how many it holds.
- `GET /api/albums/open` is the list the share page reads, newest first. It
  answers only to a live upload session.

### Uploads

`POST /api/upload` (#154) takes one photo into an open album, as the three
JPEG sizes the share page makes, and stores it **pending**: nothing is public
until the owner approves it. It answers only to a live upload session and the
site's own Origin. The fields and every answer are in the header comment of
`photos/functions/api/upload/index.js`, and the decisions in `CLAUDE.md`, The
photo site, item 14.

- **What is stored.** Three objects in the environment's bucket,
  `photos/<media_key>/grid.jpg`, `screen.jpg` and `full.jpg`, each rebuilt with
  every metadata segment removed (EXIF, GPS, XMP, the colour profile, comments,
  and anything after the image), and one `photos` row naming the album, the
  batch, the code generation and each size's dimensions.
- **What is refused, and stores nothing.** Anything that is not a JPEG (415), a
  file that breaks off (400), a file over its size's cap (413), three sizes that
  are not one picture's shape (400), a caption over 200 characters or holding a
  line break (400), an album that is not open (409), and a session's 501st
  stored photo in a UTC day (429, with `Retry-After`). An upload that fails after
  those checks leaves nothing in the bucket and does not count against the cap.
- **If the log says** `bucket did not delete photos/<key>/ after a failure`,
  `after a reject` or `after a delete` (below), objects were left in the
  bucket with no row. Delete them by that prefix.
- **The share page sends them** (#155). `/share/` makes each photo's three
  JPEGs on the phone as soon as it is chosen, and sends three at a time. A HEIC
  the browser cannot open says so and is left out. `CLAUDE.md`, The photo site,
  item 15 has the decisions. To try it locally, open the invite link from
  `/admin/code`, add an album on `/admin/albums`, and choose photos.

### The installed app

The share page installs to a phone as **Mad Cow photos** (#193). `CLAUDE.md`,
The photo site, item 22 has the decisions.

- **On Android**, in Chrome on `/share/`: menu → *Install and create shortcut*
  → *Install*. The gallery's Share menu then lists Mad Cow photos for photos
  (not clips, until #198). Shared photos open the app on the share page,
  ready to send. With no session they wait on the phone for a day, and the
  page says to open the invite link or sign in at `/coach`.
- **On an iPhone**, Safari → Share → *Add to Home Screen* should open it on
  the share page, where the photos are chosen with **Add photos**: an
  iPhone's Share menu never lists a web app. **Not read on an iPhone yet**
  (#210 carries it). A Home Screen app on iOS keeps its cookies apart from
  Safari, and an invite link opens in Safari, so a parent's installed app may
  not hold a session; until #210 reads it, send from Safari on an iPhone.
- **How a share travels.** The phone posts the photos to `/share/receive`.
  `public/share/sw.js`, the app's worker, takes that one request, keeps each
  photo in the phone's IndexedDB, and sends the browser to `/share/?shared`.
  Nothing reaches the server until Send, and a photo stays on the phone until
  it is sent or removed, so a reload or a second share offers it again. If the
  phone has no worker (its site data was cleared), `functions/share/receive.js`
  answers instead and the page says to share again. A share another site
  started (its `Origin` is that site's) is refused unread; Android's own
  share sends `Origin: null`.
- **The worker never caches.** Every other request goes to the network, so a
  takedown and a deploy both reach an installed app the next time it asks.
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
the same Access sign-in as the code and the albums. The admin home says how
many photos are waiting and how much of R2's free 10 GB the stored photos take.
`CLAUDE.md`, The photo site, item 16 has the decisions.

- **Each batch is one press of Send**, oldest first, with its album, when it
  was sent and how many photos it holds. A batch over 200 photos comes in parts
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
- The pictures come from `GET /api/admin/photos/<id>/<size>` (`grid`, `screen`
  or `full`), which answers only to an admin.

### The public albums

Anyone can browse them, with no code and no sign-in (#157; epic #147, D1).
Nothing but an approved photo is ever listed, counted or served.

- **`/`** lists every album holding at least one approved photo, latest date
  first, each with its kind, day, count and first photo. An album whose photos
  are all waiting is not listed, and a closed album still is.
- **`/albums/<address>/`** shows an album's approved photos in the order they
  were taken, in the trip logs' lightbox. The address is the one `/admin/albums`
  shows, and it never changes, so a link sent to parents keeps working. An
  album with nothing approved answers the site's 404 page.
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
links it beside the join step. `CLAUDE.md`, The photo site, item 18 has the
decisions.

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
  send time to Cloudflare's sign-in record stays until the cutover (#226).
- **#220 added the request form's records**: when a request was made, which
  teams still wait, whether the admins have been emailed, and the request
  limit, with how long it keeps a scrambled address and that the address's
  time matches the account's, to the second, for that hour (owner, at
  #220's review). `npm test` holds its 10 and 100 an hour to the code, and
  that the two times are equal.
- **The header and footer live in five files**: `photos/public/404.html`,
  `policy.html`, `share/index.html`, `photos/templates/page.html` and
  `photos/lib/admin-page.js`. The header's nav links the album list and
  `/policy`, and marks no `aria-current`, so all five stay byte for byte the
  same. The tests fail until they agree.

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
  which keeps the address as a keyed hash, as the join limit does. A row is
  deleted once it is over an hour old by the next takedown, or sooner by the
  next load of `/admin` or `/admin/removals`.
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

### Removal requests

Every photo taken down waits on `/admin/removals` (#158), behind the same
Access sign-in as the queue, the oldest takedown first, with its album, when
it was hidden and the note. The admin home says how many wait.

- **Put it back** makes it approved and public again. When it was hidden and
  the note stay on its row as a record, and a later takedown writes over
  them.
- **Delete permanently** asks first, in a dialog, then deletes its row and
  its three files for good. It needs JavaScript.
- A hidden photo keeps its row and its three files until one of those, so
  nothing is lost while it waits.

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

- **Measuring its CPU** on the develop preview: sign in to
  `https://develop.madcowphotos.pages.dev/admin/` through Access, then drive
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
decisions). Nothing links to it yet (owner, at #220's pickup): #226 points the
old invite link there.

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
  as the join and takedown limits do, and a row is deleted once it is over an
  hour old, by the next request the site takes or the next load of `/admin`.
- **One account per email address**, matched without regard to letter case.
  A request from an address the site already has writes nothing, and is
  answered with the same `303` to `/ask?sent` as a new one. That includes a
  turned-down address (owner, at #221's pickup): an admin who changes their
  mind approves it on `/admin/people` instead.
- **The admins hear at most once an hour.** The first new request emails
  every address on `ADMIN_EMAILS` at once and opens the hour; requests inside
  it send nothing; the first after it sends one email naming everyone since,
  by name, role and teams only, with a link to `/admin/people` (below). The
  admin home says how many requests wait, which is how a request that no
  later one follows is seen. If no admin's email goes through, the requests
  stay unnamed and the next request tries again.

### Approving accounts

`/admin/people` (#221; `CLAUDE.md`, The photo site, item 26, has the
decisions) lists every request for an account in three lists: **Waiting**,
**Approved** and **Turned down**. The admins' log is under them.

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
  went. A link's entry is written with the link itself, so no link exists
  without one. It copies the person's name and address into every entry, so
  it still names them after their account is deleted. The page shows the
  newest 100, and nothing deletes from the table.
- **A link's row holds only the token's SHA-256** (`password_links`). An
  expired row is deleted by the next load of `/admin/people` or the next link
  sent.

### Signing in

An approved person sets a password from their emailed link, signs in at
`/sign-in`, and resets a forgotten password at `/forgot-password` (#222;
`CLAUDE.md`, The photo site, item 27, has the decisions). Nothing public links
to `/sign-in` or `/forgot-password` yet, as nothing links to `/ask`: the
emails do, and #223 and #226 add the rest. Sending from an account is #223's.

- **The password**: 15 to 256 characters, counted after NFC, with no rules
  about mixing kinds. It is turned down when it is the person's own address
  or name or the site's name, or when Have I Been Pwned's Pwned Passwords has
  seen it in a breach. That check sends only the first 5 characters of the
  password's SHA-1, and if the service does not answer within 3 s the
  password is let through and the miss logged (owner, at #222's pickup).
- **The session** is the `__Host-account` cookie, signed with
  `SESSION_SIGNING_KEY`, for 90 days. It names the account and its session
  version. Signing out and setting a password each add 1 to the version,
  which ends every session the account holds at its next request, on every
  device. A revoke ends them too, since the guard reads only an account
  approved for a team; #225's revoke is to add 1 as well. `/account` is the
  page behind it, with Sign out.
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

### Deleting an account by hand

How an account is deleted until #225 builds the admin's button, and the
fallback after it (#219; owner, 2026-10-05). **Only once a reply from the
account's own address confirms the request**, since a delete cannot be undone
and a request can come from anyone. From `photos/`, with the D1 token in
`photos/.env` (above):

1. Find the account, and check it is the one the email is about (write any `'`
   in the address twice):

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "SELECT id, name, email FROM accounts WHERE email = '<address>'"
   ```

2. Write to that address asking for a reply to confirm, and wait for it.
3. Delete it:

   ```
   npx --no-install wrangler d1 execute madcowphotos --remote --env production --command "DELETE FROM accounts WHERE id = <id>"
   ```

4. Read it back: step 1's statement must return no row.

Its teams and any unused link to set a password go with it (`ON DELETE
CASCADE`). `photos/test/policy.test.js` runs the step-3 statement against the
real schema, with a row in every table, and fails if any row afterwards names
the account's id or address. Only two may: the admins' log entries (#221),
which keep naming the person, as the test also checks, and, for a revoked
account, its address kept as a keyed hash (#225). #223 and #225 keep that test
passing as they add tables. The database's restore points keep the account
for up to 30 days, as `/policy` says.

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
| `h2proxy.mjs` | Serves the photo site from `wrangler pages dev` over HTTP/2, so Lighthouse reads it locally the way production serves it. The photo site's floor is read through it (`CLAUDE.md`, Quality floor; #155). Needs a throwaway self-signed certificate; the header has the recipe. |
