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
| `develop` | Integration, and the repo default. Cloudflare Pages builds a **preview** from it. | A pull request from a feature branch, merged by the owner. |
| `release` | **Production.** Pages builds madcowhq.com and madcowsailing.com from it. | A pull request **from `develop`**, merged by the owner. Nothing else. |
| `main` | Frozen pointer to the pre-`develop` history. Not deployed, not merged into, kept so old links and clones resolve. | Nothing. It is retired. |

### How work reaches `develop`

Branch from `develop`, name it `feature/<issue>-<slug>`, open a PR back into
`develop`. CI runs on the PR (see below) and Pages posts a preview URL. The
owner merges.

### How `develop` is promoted to `release`

A pull request from `develop` into `release`, merged by the owner. **Merging
that PR is the production deploy** — there is no separate publish step, so the
merge is the moment the two domains change. Promote deliberately, not as
housekeeping.

That coupling is the reason `release` exists at all rather than deploying from
`develop`: it puts a decision between "this is merged" and "this is live".

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

`tools/` is developer tooling. Neither script runs in a build.

| Script | What it does |
|---|---|
| `photos.py` | Builds a trip log's AVIF/WebP derivatives and its `trip.json`. Strips EXIF always. Needs Pillow ≥ 11.3. |
| `trace_logo.py` | Re-traces `shared/img/` from `docs/source/madcow-lockup.pdf`. Needs Pillow. |
