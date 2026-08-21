# madcowsailing.com — Site Spec

Replaces `sailing-photos.md`. That document assumed the sailing content was a
section of madcowhq.com. It is now its own site with its own domain, and the parts
about redirects and about splitting later are void. The photo pipeline and gallery
requirements carry over intact.

Read `CLAUDE.md` first for the shared conventions and quality floor.

## What this site is

A destination for sailors. Two kinds of content, and they support each other: apps
that are useful on the water, and logs from actually being on the water. The logs
are what make the apps credible — anyone can ship a sailing app, fewer people can
show you the boat.

The professional framing lives on madcowhq.com and stays there. No stack tags, no
architecture talk, no résumé links beyond one line in the footer.

## Sail number

The boat races under **1340**. It's a real identifier, so it gets to behave like
one: it labels trip photos and appears in the footer. Set in mono, `--ensign` on
light and `--ensign-lt` on the navy field. There is one number and it belongs to one
boat — never invent siblings for it.

## Apps

### `sailing/apps/index.html`

One card per sailing app. Name, one sentence, platform badges, price or "free",
status. Links to the product page.

### `sailing/apps/<slug>/index.html`

Written for a sailor, not an employer. The opening sentence should be something a
sailor would actually say out loud — "works out your start line bias in about ten
seconds" beats "a tactical race-start optimisation utility."

- Hero: what it does, one screenshot of a real screen
- Who it's for and when you'd use it
- Three or four features, each a sentence, no icon grid
- Platform, price, download buttons
- Short FAQ from real questions once you have them
- Links to support and privacy
- Footer link to the case study on madcowhq.com for anyone curious how it was built

Self-referencing `rel="canonical"`. The case study on hq is a different document for
a different reader, not a variant — never cross-canonical the two, and never reuse
sentences between them.

### `sailing/apps/<slug>/support.html`

Required by both stores. Contact email, realistic response time, known issues,
version history. Plain and boring on purpose. Its job is to unblock review and to
put a frustrated user in touch with a human.

### `sailing/apps/<slug>/privacy.html`

Required by both stores. What the app collects, what it does not, who it goes to,
how to request deletion. If it collects nothing, say exactly that in one sentence —
that is a selling point, not a formality.

**Build both shells before submitting anything.** Store review blocks on a missing
support or privacy URL, and discovering that mid-submission wastes a review cycle.

## Trip logs

### Structure

```
sailing/
├── logs/
│   ├── index.html                    Reverse chronological
│   └── 2026-06-14-put-in-bay/
│       ├── index.html
│       └── trip.json                 The only file you hand-edit
└── assets/photos/2026-06-14-put-in-bay/
    ├── 001-thumb.avif                400w
    ├── 001-med.avif                  1000w
    ├── 001-full.avif                 2000w
    └── (.webp siblings for each)
```

Slug format `YYYY-MM-DD-short-name` sorts chronologically in the filesystem.

### `trip.json`

```json
{
  "title": "Put-in-Bay, June",
  "date": "2026-06-14",
  "location": "South Bass Island, Lake Erie",
  "log": "Two nights out. Twenty knots on the way over and almost nothing coming back.",
  "photos": [
    {
      "file": "001",
      "alt": "Mainsail close-hauled against grey water and low cloud",
      "caption": "Beating across the passage",
      "width": 2000,
      "height": 1333,
      "lqip": "data:image/webp;base64,UklGRh..."
    }
  ]
}
```

`alt` is required and the script must not invent it. `caption` is optional — a
caption on every photo reads as filler.

**`log` is the most valuable field on the page.** Two or three sentences is the
difference between a gallery and a log, and the log is the part people read.

### Index

Each trip is a row: cover photo, title, date, location, photo count, first line of
the log. Reverse chronological.

## Photo pipeline

`tools/photos.py` — written in Python, tested end to end.

```
python3 tools/photos.py --trip 2026-06-14-put-in-bay --src ~/Desktop/dump --root sailing
```

It applies EXIF orientation and then discards all metadata, emits AVIF and WebP at
400 / 1000 / 2000 skipping any size larger than the source, generates the base64
LQIP, records real dimensions, and preserves hand-written `alt` and `caption` across
re-runs. It exits non-zero when any photo is missing alt text, so it can gate a
commit hook.

**EXIF stripping is not optional and there is deliberately no flag to disable it.**
Phone photos carry GPS coordinates that expose your marina, your mooring, and often
your house. Note that a photo which has passed through Facebook or similar has
usually been stripped already — photos straight off the phone have not.

Posting workflow: dump photos in a folder, run the script, write two sentences in
`trip.json`, fill in the alt text, commit. Five minutes per trip.

## Gallery

**Grid.** Justified rows using the real aspect ratios from the manifest, via CSS
`aspect-ratio`. Not a uniform square grid — cropping a sailing photo square throws
away the horizon, which is the subject.

**Loading.** First row `loading="eager"` with `fetchpriority="high"`, everything
else lazy. `<picture>` with AVIF source and WebP fallback, `srcset` across the three
widths, and a `sizes` attribute matching the actual grid. The `lqip` string is the
wrapper's background, revealed as the image fades in.

**Lightbox.** Vanilla JS on the native `<dialog>` element — it provides the focus
trap, backdrop, and Escape-to-close, which is most of the accessibility work.

- Arrow keys and Escape; swipe on touch
- Loads the `full` derivative
- Preloads only the next and previous image
- Caption and a counter (`4 / 37`)
- Focus returns to the triggering thumbnail on close
- Instant transitions under `prefers-reduced-motion`

Roughly eighty lines. No lightbox library.

## Performance

The gallery is where the Lighthouse floor is genuinely at risk. Test with a real
forty-photo trip loaded, not an empty page. When performance drops below 95 the
cause is almost always a wrong `sizes` attribute causing the browser to download
`full` derivatives for thumbnails.

## Cross-linking

- Sailing footer: one line, "Built by ⟨name⟩" linking to madcowhq.com. Not a nav
  item — this audience did not come for the portfolio.
- Each app product page footer: a quiet link to its case study on hq.
- hq case studies link out to the product page as "get it".
- hq `/apps` index rows link to both.

## Headway Sailing

The RC gear recommendation now has a natural home — see `docs/headway-link.md`. It
belongs at the bottom of `sailing/index.html` or in the logs section, in first
person, with the family relationship disclosed next to the link as the FTC
endorsement guides require. Still no product catalog, still no nav item.
