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

Each entry also carries a `source` key naming the original filename. It is not
shown above because nothing reads it at render time — it exists so a re-run can
match your alt text to the right photo after one is inserted in the middle and the
numbering shifts. Do not delete it by hand.

**`log` is the most valuable field on the page.** Two or three sentences is the
difference between a gallery and a log, and the log is the part people read.

### Index

Each trip is a row: cover photo, title, date, location, photo count, first line of
the log. Reverse chronological.

The cover is shown cut to 4:3, and since #96 it is served that way. `photos.py`
gives the cover its own ladder, `<file>-cover400`, `-cover640` and `-cover1200`
in AVIF and WebP, cut from the cover's largest derivative with the same centred
crop `object-fit: cover` makes. Before that the row fetched the uncropped `-med`,
and Mullett Lake's portrait cover cost 198 KB to show 56% of the picture. The
cut runs on every render, so changing `cover` in `trip.json` and re-running the
script without `--src` is enough. The previous cover's files are not deleted;
remove them by hand. The index's performance floor is 90, not 95, while two
covers share its first screen (`CLAUDE.md`, #96).

## Photo pipeline

`tools/photos.py` — written in Python. Run end to end on 2026-08-21 against one
photo; what that run measured, and the alt-preservation bug it found, are recorded
in `design-brief.md` under Photo pipeline. Not yet run against a real multi-photo
trip.

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

### Video

Clips go in the same `--src` folder as the photos and sort into the same
chronology. `.mp4`, `.mov` and `.m4v` are picked up; everything else about the
workflow is unchanged.

**Every clip is re-encoded, and that is not an optimisation.** Phones shoot
HEVC, which Safari plays and Chrome and Firefox largely do not — so a source
file copied straight in plays for a minority of readers while looking perfect
in review. H.264 plays everywhere that matters. The July 2026 Mullett Lake dump
also carried a 76.5 MB clip, over Cloudflare Pages' **25 MB per-file limit**,
which would not have deployed at all. Re-encoded, the three clips came to 10 MB
total.

**Needs ffmpeg on PATH** (`winget install Gyan.FFmpeg` on Windows). It is a dev
dependency like Pillow and ships nothing to the site; a run with no videos in it
never looks for it.

No WebM sibling. The compatibility gap it would cover has no browser in it
today, and it would double what the repo carries forever (owner decision,
2026-09-12).

**The size cap is on the LONG edge, not the height**, and that distinction is
load-bearing. One clip in that dump stored 3840×2160 with a `rotation=-90` tag,
so its true display shape is portrait: a `scale=-2:1080` filter set the height
of the *rotated* frame and produced 608×1080. Capping `max(iw,ih)` cannot be
inverted by a rotation flag. `video_shape()` applies the same swap when reading
dimensions, because the gallery prices every figure by aspect ratio and a
rotated clip would otherwise be packed as a landscape slot and drawn portrait.

**Each clip carries a poster frame**, which is what the grid lays out — through
the identical derivative ladder as a photo, so the packing, the `sizes`
attribute and the LQIP are one code path. Posters default to one second in
(never frame 0, which on a phone is routinely the blurred pre-focus frame), and
a manifest entry may override that with `poster_seek`:

```json
{ "file": "029", "video": "029.mp4", "poster_seek": "00:00:09" }
```

Worth setting deliberately. At the default, the Straits clip's poster was a
frame of bare water; at nine seconds it is Cruz being lowered into the lake with
the bridge behind — which is what the clip is actually about, and the only frame
most readers will ever see. Like `alt`, it survives re-runs.

The manifest also records `video_width` / `video_height` separately from
`width` / `height`. The latter describe the poster derivative and are right for
the `<picture>`; the former describe the clip, which is what the `<video>`
element needs. Conflating them sized a 720×1280 clip as 2000×3556.

In the gallery a clip is a figure whose link points at the MP4 instead of at the
largest still, plus a play badge. With JavaScript off that link is a plain MP4
the browser plays on its own — the same no-JS baseline the lightbox keeps for
photos. With it on, the clip opens in the existing `<dialog>` with native
controls, and nothing autoplays: `preload="none"` means a clip costs its bytes
when someone presses play, not when they arrow past it.

## Gallery

**Grid.** Justified rows using the real aspect ratios from the manifest, via CSS
`aspect-ratio`. Not a uniform square grid — cropping a sailing photo square throws
away the horizon, which is the subject.

**Loading.** `loading="eager"` with `fetchpriority="high"` only on the photos on
the first screen of both layouts: the wide first row **and** the phone's first
line. Everything else is lazy. One page serves both widths and the wide first row
re-wraps on a phone, so "first row" alone loaded photos below a phone's first
screen eager and at high priority (#53). `<picture>` with AVIF source and WebP
fallback, `srcset` across the three widths, and a `sizes` attribute matching the actual grid. The `lqip` string is the
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
- hq `/work/` index rows link to both (the `/apps/` index folded into it in #81).

## Headway Sailing

The RC gear recommendation now has a natural home — see `docs/headway-link.md`. It
belongs at the bottom of `sailing/index.html` or in the logs section, in first
person, with the family relationship disclosed next to the link as the FTC
endorsement guides require. Still no product catalog, still no nav item.
