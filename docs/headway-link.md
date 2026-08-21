# Headway Sailing Link — Spec

Addendum to `CLAUDE.md` and `docs/sailing-site.md`.

**Updated for the two-site split.** This now lives on **madcowsailing.com**, not on
madcowhq.com. That resolves the awkwardness in the earlier version: an RC gear
recommendation sitting under a portfolio was a non-sequitur, but on a site built for
sailors it is simply a recommendation to the right audience.

## Context

Headway Sailing sells RC sailboat gear. It is run by a friend or family member of
the site owner. There is **no commission or payment** — this is a personal
recommendation, not an affiliate arrangement.

## Decisions

- **Not in the main nav.** The nav stays `work · apps · about`. A shop link at the
  top level reframes the site as a storefront for the employer audience.
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

Do not put it in the sailing nav. The nav is `apps · logs · about`, and a shop link
beside them makes the site look like a storefront for someone else's business.

## Required disclosure

The FTC endorsement guides treat a **family or close personal relationship as a
material connection**, the same category as payment. The relationship must be
disclosed clearly and near the link — not in the footer, not behind a tooltip, not
in smaller type.

Plain language is sufficient and preferable. The disclosure and the reason to click
are the same sentence.

## Markup

```html
<section class="recommendation">
  <h2>RC gear</h2>
  <p>
    I get asked where to start with RC sailboats. I point people at
    <a href="https://headwaysailing.com">Headway Sailing</a> — it's run by my
    brother, so take that for what it's worth, but he'll actually answer an email
    about which rig suits a beginner, which is not true of most of the internet.
  </p>
</section>
```

Replace the placeholder URL and the relationship with the real ones. Rewrite the
copy in the owner's voice — the specific reason to trust the shop is the whole
point, and a generic "check them out" wastes the link.

- Standard `<a>`. No `rel="sponsored"` — nothing is sponsored. No `rel="nofollow"`.
- No `target="_blank"` unless every external link on the site opens in a new tab.
  Be consistent.
- Style `.recommendation` with the chosen direction's tokens. It should read as part
  of the page, not as an inserted unit.

## Note on the RC / keelboat mismatch

The sailing section currently holds keelboat trip photos. An RC gear link sitting
under those is a non-sequitur and will read as advertising regardless of how it is
written. Two fixes, in order of preference:

1. Post actual RC content — a build log, a race day, a comparison of two rigs. Then
   the link is obvious rather than inserted.
2. If there is no RC content, cut the section and move the link to
   `sailing/about.html` under a "things I recommend" line, where a personal
   recommendation needs no topical justification.

The mismatch is smaller than it was — a keelboat sailor and an RC sailor are closer
neighbours than a hiring manager and an RC sailor — but it has not vanished.

Do not build the section with keelboat-only content and hope it reads naturally.
