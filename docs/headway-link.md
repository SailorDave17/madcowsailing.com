# Headway Sailing Link — Spec

Addendum to `CLAUDE.md` and `docs/sailing-site.md`.

**Updated for the two-site split.** This now lives on **madcowsailing.com**, not on
madcowhq.com. That resolves the awkwardness in the earlier version: an RC gear
recommendation sitting under a portfolio was a non-sequitur, but on a site built for
sailors it is simply a recommendation to the right audience.

## Context

HeadwayRC (`https://headwayrc.net`) sells RC sailboat gear — DragonFlite DF-95
and DF-65 parts. It is run by a **close friend** of the site owner. There is **no
commission or payment** — this is a personal recommendation, not an affiliate
arrangement.

The relationship and URL above are the **real ones**, supplied by the owner on
2026-09-04 and shipped in `sailing/about.html` that day. They replaced
placeholders (`headwaysailing.com`, "my brother") that had stood here since the
document was written; nothing had ever verified them, and the placeholder pair
read exactly like settled fact. The URL was checked live before shipping: 200,
title *"DF-95 & DF-65 Parts, DragonFlite RC boats – HeadwayRC"*.

## Decisions

- **Not in the main nav.** The sailing nav stays `apps · logs · photos · about`. A shop link
  at the top level reframes the site as a storefront for someone else's business.
  *(This bullet said `work · apps · about` — the hq nav — until 2026-09-04, left
  over from when this document lived on madcowhq.com.)*
- **No product catalog, no price list, no inventory.** One link to the shop itself.
  Stock changes and this repo cannot track it; a stale product grid is worse than
  no grid.
- **No logo-and-button treatment.** That reads as an ad. Plain text recommendation
  in first person.
- Lives on **madcowsailing.com**, never on madcowhq.com.

## Placement

**Primary:** a short block at the bottom of `sailing/index.html`, below the apps
and logs. Not a card, not a banner — a paragraph with a link, styled like body copy.

**Secondary:** inline mentions inside any trip log where RC sailing actually comes
up. Contextual and occasional. Do not template this into every trip page.

If RC sailing gets enough content to justify it (more than two or three logs), it
earns its own `sailing/rc/` subsection, and the link moves there. Not before.

Do not put it in the sailing nav. The nav is `apps · logs · photos · about`, and a shop link
beside them makes the site look like a storefront for someone else's business.

## Required disclosure

The FTC endorsement guides treat a **family or close personal relationship as a
material connection**, the same category as payment. The relationship must be
disclosed clearly and near the link — not in the footer, not behind a tooltip, not
in smaller type.

Plain language is sufficient and preferable. The disclosure and the reason to click
are the same sentence.

## Markup

**As shipped** in `sailing/about.html` (story #9, 2026-09-04):

```html
<section class="wrap recommendation">
  <h2>Things I recommend</h2>
  <p>I get asked where to start with RC sailboats more than anything else on
    this site. I point people at
    <a href="https://headwayrc.net/">HeadwayRC</a> &mdash; it is run by a
    good friend of mine, so weigh that as you like, but he stocks DragonFlite
    parts properly and he will answer an email about which rig suits a
    beginner, which is not true of most of the internet.</p>
</section>
```

Note "actually" is gone from the shipped copy: story #30 bans it along with
*really, truly, simply, just* as a tell that creeps in when copy tries to pop.
The specific reason to trust the shop is the whole point, and a generic "check
them out" wastes the link.

- Standard `<a>`. No `rel="sponsored"` — nothing is sponsored. No `rel="nofollow"`.
- No `target="_blank"` unless every external link on the site opens in a new tab.
  Be consistent.
- Style `.recommendation` with the chosen direction's tokens. It should read as part
  of the page, not as an inserted unit.

## Note on the RC / keelboat mismatch — RESOLVED 2026-09-04, via route 2

The sailing section holds keelboat trip photos. An RC gear link sitting under those
is a non-sequitur and will read as advertising regardless of how it is written. Two
fixes were listed, in order of preference:

1. Post actual RC content — a build log, a race day, a comparison of two rigs. Then
   the link is obvious rather than inserted.
2. If there is no RC content, cut the section and move the link to
   `sailing/about.html` under a "things I recommend" line, where a personal
   recommendation needs no topical justification.

**Route 2 is what shipped**, in story #9. There is still no RC content, so the
*Placement* section above is now history: the link is **not** on `sailing/index.html`
and the "primary / secondary" split there describes a page that was never built.
The about page is the only placement.

Route 1 remains the better end state and is not foreclosed — if RC sailing ever gets
its own logs, the link moves to them and the `sailing/rc/` rule above applies.

One thing the mismatch argument did not anticipate: the shop turned out to sell
**DragonFlite** parts, and the DF-95 is the fleet `buoyant` is being built against.
So the recommendation is closer to this site's subject than "RC gear" suggested.

Do not build the section with keelboat-only content and hope it reads naturally.
