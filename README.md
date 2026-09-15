# madcowsailing.com

Monorepo for **two** static sites that share one design system, despite the
repo's name:

| Site | Directory | Audience |
|---|---|---|
| madcowhq.com | `hq/` | Hiring managers, recruiters, collaborators |
| madcowsailing.com | `sailing/` | Sailors |

They share `shared/` — tokens, base CSS, the logo files. They share no content.
`CLAUDE.md` is the project context and the quality floor; `docs/design-brief.md`
is the visual direction. Read those before writing anything.

## Branch model

Three long-lived branches. The rule underneath is that **the branch a deploy is
built from is never pushed to by hand.**

| Branch | What it is | How it is entered |
|---|---|---|
| `develop` | Integration, and the repo default. Cloudflare Pages builds a **preview** from it — and from it alone; see [Previews](#previews-build-from-develop-only) below. | A pull request from a feature branch, merged by the owner. |
| `release` | **Production.** Pages builds madcowhq.com and madcowsailing.com from it. | A pull request **from `develop`**, merged by the owner. Nothing else. |
| `main` | The **backup branch**: a known-good working version to fall back to if `release` breaks and cannot be fixed in place. Not deployed. **Not yet in that state here** — *measured 2026-09-01*, it is still the frozen pre-`develop` pointer, 13 commits behind `release`, never promoted to. | A pull request **from `release`**, merged by the owner — from the branch production actually ran, never from `develop`. Nothing else. |

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

Two Cloudflare Pages projects from this one repo. **The dashboard is the only
other copy of these settings** — if a project is ever deleted or recreated, this
table is what rebuilds it.

| Setting | hq project | sailing project |
|---|---|---|
| Project name | `madcowhq` (`madcowhq.pages.dev`) | `madcowsailing` (`madcowsailing.pages.dev`) |
| Production branch | `release` | `release` |
| Root directory | `hq` | `sailing` |
| Build command | `mkdir -p assets/shared && cp -R ../shared/. assets/shared/` | same |
| Output directory | `.` | `.` |
| Watch paths (include) | `hq/*`, `shared/*` | `sailing/*`, `shared/*` |
| Custom domains | `madcowhq.com`, `www.madcowhq.com` | `madcowsailing.com`, `www.madcowsailing.com` |
| Preview branches | `develop` only | `develop` only |
| Preview access policy | not enabled | not enabled |
| Framework preset | None | None |

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

**A missing path answers `200` with the home page, so a status code cannot tell
a deployed page from a missing one.** Neither site has a `404.html`, and Pages
serves `index.html` for any path its output directory does not hold. *Measured
2026-09-14 (#28)*: a random `madcowsailing.com/__probe_…` answered `200` with
the sailing home page's title and canonical, and the same path on madcowhq.com
with hq's. An uptime monitor, a status-code link sweep and
`curl -w '%{http_code}'` all report a page healthy whether or not it was ever
deployed.

The check that works reads the body, not the status: the page's own `<title>`
**and** its self-referencing `rel="canonical"`, with a path that certainly does
not exist fetched **in the same run** as a negative control. Without the
control, a matching title is equally consistent with every path serving that
title. Two details catch a first attempt:

- Pages strips `.html` with a `308` (`/apps/race-timer/support.html` →
  `/apps/race-timer/support`). Follow redirects (`curl -L`) and record the hop,
  or the check reads an empty redirect body.
- The home page cannot pass the title test, because its title *is* the
  fallback's. Check `/` by its content instead.

Internal links are held by `tools/linkcheck.py`, which resolves them against
the tree and never asks the host, for the same reason. #36 adds a `404.html` to
each site; after it a `404` does prove a path is missing, but a `200` still
proves only that something was served, so the title-and-canonical check stays
the way to show a page is its own. Re-read this paragraph when #36 ships.

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

`githooks/checks` and `.github/workflows/ci.yml` run the same single command, so
a red push and a red build are the same event:

```sh
npm ci          # once
npm run check   # html-validate over hq/, sailing/ and docs/
```

`npm run check` is also what the pre-push hook runs on a hand invocation:

```sh
sh githooks/pre-push
```

`package.json` exists for that one dev dependency and nothing else — the sites
themselves have no dependencies and no build step beyond the one-line copy of
`shared/` that Cloudflare Pages performs. Nothing in `node_modules/` is served.

`no-inline-style` is switched off in `.htmlvalidate.json`, deliberately: the
trip-log gallery sets each photo's LQIP placeholder as an inline
`background-image` data URI, which is per-photo data and cannot become a class.
Every other recommended rule is on.

## Tools

`tools/` is developer tooling. None of these runs in a build.

| Script | What it does |
|---|---|
| `photos.py` | Builds a trip log's AVIF/WebP derivatives and its `trip.json`. Strips EXIF always. Needs Pillow ≥ 11.3. |
| `assetver.py` | Writes `?v=<hash>` onto every page's URL for a file in `shared/css/` or `shared/js/`. Run it after editing one; `linkcheck.py` refuses a page whose version does not match the file (#95). |
| `trace_logo.py` | Re-traces `shared/img/` from `docs/source/madcow-lockup.pdf`. Needs Pillow. |
| `quality_floor.mjs` | Measures the `CLAUDE.md` quality floor on both **production** domains — Lighthouse at a pinned version, 360px scroll, keyboard reach, contrast pairs — and rewrites the generated block of `docs/quality-floor.md`. Needs Node and Chrome. Not in CI, by decision recorded in that doc. |
