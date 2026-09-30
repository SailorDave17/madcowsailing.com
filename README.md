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
| Framework preset | None | None | None |

*The photos column was read back from the dashboard on 2026-09-27 (UTC), after
the project was created for #149.* Two of its values are not what the create
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
refuses the link before the push.

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
- Two Access applications, read back from Zero Trust → Access controls →
  Applications on 2026-09-28 (#151):

  | | Admin (#151) | Previews (#149) |
  |---|---|---|
  | Name | `madcowphotos admin` | `madcowphotos - Cloudflare Pages` |
  | Destinations | `photos.madcowsailing.com/admin`, `…/admin/*` and `…/api/admin/*` | `*.madcowphotos.pages.dev` |
  | Policy | `Admins - photos admin`: Allow, Include Emails (the admins' addresses, the same list as `ADMIN_EMAILS`), Require Login Methods: One-time PIN | `Allow Members - Cloudflare Pages`: Allow, Include Emails (the address #149 set, and since #151 the admins' addresses too) |
  | Identity providers | One-time PIN only, instant authentication on | as #149 left it |
  | AUD tag | `78d0a143…` = `env.production.vars.ACCESS_AUD` | `da25aceb…` = `env.preview.vars.ACCESS_AUD` |

  Both paths are listed because Access's `/admin/*` does not match `/admin`.
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

### Secrets

By name only; a value never goes in this repo.

- **Pages secrets**, one value per environment, set in the dashboard under the
  project's Settings → Variables and Secrets, as type *Secret*:
  - `SESSION_SIGNING_KEY` (#150) signs the upload session cookie. Changing it
    ends every session at once, as rotating the code does.
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

  The first two are 32 random bytes each, base64url-encoded. Preview and production get
  different values. Without them, `POST /api/join` answers `503` and opens
  nothing. Check that all three exist in both environments on the dashboard, which
  shows a secret's name and never its value.
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

### The invite code

A parent joins by opening `https://photos.madcowsailing.com/share/#code=<code>`.
The code is made and changed on the admin page, `/admin/code` (#152), signed in
through Access: `https://photos.madcowsailing.com/admin/code` for production and
`https://develop.madcowphotos.pages.dev/admin/code` for the preview. **This
replaces the seed command #150 recorded**; `scripts/seed-code.mjs` is gone.

- **Create code.** A database with no code shows only this button, and uploads
  stay closed until a code exists. It makes the first code, and only while there
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
  a new code. Every upload session opened with the old one is refused from its
  next request, and the old link tells whoever opens it that the invite has
  changed. Send the new link to the team.

The code is never written to a file or to git; this repo is public.

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
  objects were left in the bucket with no row. Delete them by that prefix.
- **The share page sends them** (#155). `/share/` makes each photo's three
  JPEGs on the phone as soon as it is chosen, and sends three at a time. A HEIC
  the browser cannot open says so and is left out. `CLAUDE.md`, The photo site,
  item 15 has the decisions. To try it locally, open the invite link from
  `/admin/code`, add an album on `/admin/albums`, and choose photos.
- **To look at what is waiting** before the approval page exists (#156):
  `npx --no-install wrangler d1 execute <database> --remote --env <env> --command "SELECT id, album_id, batch, sent_at, caption FROM photos WHERE state = 'pending' ORDER BY sent_at"`.

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
| `assetver.py` | Writes `?v=<hash>` onto every page's URL for a file in `shared/css/` or `shared/js/`, on all three sites (`photos/public/` since #149), and, since #176, for a file in the page's own site's `css/` or `js/`. Run it after editing one; `linkcheck.py` refuses a page whose version does not match the file (#95, #176). |
| `trace_logo.py` | Re-traces `shared/img/` from `docs/source/madcow-lockup.pdf`. Needs Pillow. |
| `quality_floor.mjs` | Measures the `CLAUDE.md` quality floor on both **production** domains — Lighthouse at a pinned version, 360px scroll, keyboard reach, contrast pairs — and rewrites the generated block of `docs/quality-floor.md`. Needs Node and Chrome. Not in CI, by decision recorded in that doc. |
| `h2proxy.mjs` | Serves the photo site from `wrangler pages dev` over HTTP/2, so Lighthouse reads it locally the way production serves it. The photo site's floor is read through it (`CLAUDE.md`, Quality floor; #155). Needs a throwaway self-signed certificate; the header has the recipe. |
