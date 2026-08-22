# Mad Cow HQ — Design Brief

**This supersedes the earlier brief with three directions.** Those were proposals
for an identity that didn't exist yet. It does exist — it's painted on the boat.
Discard Chart & Compass, Ear Tag, and Two-Ink. Build this instead.

## Scope

One design system, two sites. `shared/css/tokens.css` is the single source of truth
for both madcowhq.com and madcowsailing.com — same palette, same type, same mark.

They differ only in emphasis. **hq leads with the mark**: the face is the hero, the
page is restrained, photography is incidental. **sailing leads with the boat**: a
photograph is the hero, the mark shrinks to the header, and the navy fields do more
work because they sit better against grey-blue water. Do not fork the tokens to
achieve this; it is a layout difference, not a colour one.

## The source

The identity comes from the transom of the boat: a hand-drawn face with radiating
hair, spiral eyes, and an open-O mouth, above hand-lettered caps reading MAD COW,
flanked on the hull by drawn quotation marks. One ink, no gradients, no shading.

**The blue is `#0067A1`.** That value is sampled from the decal, not chosen. Do not
adjust it, do not "modernise" it, do not shift it toward navy or teal. It is the one
fixed point in this system, and every other decision defers to it.

The liberties are everywhere else: a warmer base, a deeper ink for text, and an
accent the original didn't have.

## What makes this work

Most personal sites invent a visual identity in the design phase, and it shows —
the marks look like they came from a logo generator because effectively they did.
This one came off a boat. It is genuinely hand-drawn, genuinely weird, and already
attached to a real object with a name. That is an unfair advantage over every other
portfolio in the stack, and the entire job here is to not squander it.

Which mostly means restraint. The mark is loud. Everything around it should be
quiet, precise, and slightly straight-faced. The humour is in the face; the site
should behave like it doesn't notice.

## Palette

```css
--hull:      #EDF0F0   /* base — gelcoat grey, cooled and lifted */
--chalk:     #FAFBFB   /* raised surfaces, cards */
--blue:      #0067A1   /* sampled from the decal. Fixed. */
--blue-deep: #004E7C   /* hover / pressed */
--deep:      #05273C   /* body text, inverted fields — night water */
--spray:     #9BC3D6   /* dividers, muted secondary */
--ensign:    #B3123C   /* accent on light surfaces */
--ensign-lt: #FF7D99   /* the same accent, on --deep fields */
```

Two liberties worth explaining.

**The base is grey, not white.** Straight white would be the obvious choice and it
makes the blue look like a corporate marine logo — think boat insurance. The hull
grey from the photos is warmer and softer, the blue sits into it rather than
vibrating against it, and it gives you `--chalk` as a genuine lift for cards.

**The accent is ensign red.** The original is monochrome, which is honest but flat
over a whole site — you get no way to signal "click this" other than more blue. Red
is warm enough to carry that job without the sportiness an orange brings, and it
isn't arbitrary: port-side lights and the red ensign come from the same world as the
rest of this.

**The accent is one colour at two values.** `--ensign` on light surfaces,
`--ensign-lt` on `--deep` fields. This is not a decorative pair — it exists because
any red dark enough to clear 4.5:1 on `#EDF0F0` is too dark to read on `#05273C`,
and the reverse. Never cross them; each fails badly on the other's background.

Measured contrast:

| | on `--hull` | on `--deep` |
|---|---|---|
| `--deep` | 15.1:1 | — |
| `--chalk` | — | 14.4:1 |
| `--blue` | 5.4:1 | fails |
| `--ensign` | 6.0:1 | fails |
| `--ensign-lt` | fails | 6.3:1 |
| `--spray` | 1.8:1 — never text | 8.9:1 |

## Type

The wordmark is **artwork, not type**. It ships as SVG. Never re-set "MAD COW" in a
font, never substitute a marker font for it, never letter-space it. The irregularity
is the point and any font approximation reads as a knock-off of your own logo.

For everything else:

- **Display — Bricolage Grotesque.** Variable width and weight, with a slightly
  irregular skeleton that rhymes with the hand-drawn mark without imitating it. Set
  headings around `wdth 88–92`, `wght 620–700`.
- **Body — Instrument Sans.** Clean, good x-height, gets out of the way.
- **Utility — DM Mono.** Eyebrows, dates, stack tags, coordinates, nav.

Three families, and the mono carries all the small structural text. That's what
keeps the page from feeling like a template: the labels are doing a job.

## Structure

**No border radius anywhere.** The decal is cut vinyl with hard edges. A rounded
card next to that mark looks borrowed from a different project.

**Section dividers are hand-drawn.** Not `border-bottom` — an SVG path with a slight
wobble, matching the marker stroke of the original. It appears between major
sections and nowhere else. One irregular element, used consistently, reads as
intentional; irregularity sprinkled everywhere reads as noise.

**Scare quotes from the transom.** The hull has MAD COW in drawn quotation marks,
which is funny and yours. Use the quote motif once per page at most — on the
tagline. Not on every heading.

**Cards offset on hover** into a hard blue shadow, no blur. Cut vinyl, not
Material Design.

## Signature: the eyes follow the cursor

The spiral eyes track the pointer, capped at 16 SVG units of travel with a 90ms
ease. Subtle enough that a visitor notices it a beat after they notice the face,
which is the correct order.

It works because the eyes are separate closed contours in the traced SVG
(`#mc-eye-left`, `#mc-eye-right`), so they translate independently inside the face
shape.

They are holes rather than white shapes, so the page colour shows through them —
and a subpath of an even-odd path cannot be transformed on its own. So in
`madcow-mark-ids.svg` the eyes and mouth are cut with a luminance mask and the
mask paths carry the ids: translate `#mc-eye-left` and the hole moves with it.
`madcow-mark.svg` has no mask and no ids — it is one even-odd path, which is why
the header copy cannot collide with the hero's.

Re-verified 2026-08-21 in Chromium, from disk, on `docs/preview/theme-preview.html`:
pointer up-left and down-right of the face gave each eye its own vector, both
measuring exactly 16.00 units of travel, and the eyes stayed well within the head
at that maximum offset. The eye region really re-renders — the two pointer
positions differ pixel-for-pixel, while a `prefers-reduced-motion: reduce` run at
the same two positions held both transforms at zero and produced byte-identical
pixels.

This is the one bold thing on the page. Everything else stays disciplined. Under
`prefers-reduced-motion` the transform is disabled entirely, not just shortened.

Only the hero mark is interactive. The header mark is static, and its ids are
stripped so they don't collide.

## Assets

| File | Use |
|---|---|
| `madcow-lockup.svg` | Face + wordmark. Social cards, print, favicon source. |
| `madcow-mark.svg` | Face only, no ids. Header, small placements. |
| `madcow-mark-ids.svg` | Face with `#mc-face`, `#mc-eye-left`, `#mc-eye-right`, `#mc-mouth`. Hero only. |
| `madcow-wordmark.svg` | Lettering only. Header lockup, footer. |
| `madcow-lockup-1024.png` | Transparent raster fallback. |
| `madcow-mark-512.png` | Favicon / app icon source. |

All SVGs use `fill="currentColor"`, so colour comes from CSS — set `color: var(--blue)`
on the parent and the mark follows. They also use `fill-rule="evenodd"`; the eyes and
mouth are holes, and dropping that attribute fills them solid. Both confirmed
2026-08-21 by grep across all four files, and in Chromium: the same inline mark
computes `fill` as `--blue`, `--ensign` and `--ensign-lt` under three different
parent colours.

**The consequence of `currentColor` is that these marks cannot be used through
`<img>`.** An `<img>`-loaded SVG has no parent to inherit from, so it renders
black — measured, not assumed. Inline the SVG where the colour matters. CSS
`mask-image` with `background: currentColor` is the other way to keep a single
file reference, and it works over HTTP but is blocked over `file://`, which is
why the preview inlines its header marks.

These were re-traced on 2026-08-21 from `docs/source/madcow-lockup.pdf` — the
owner's export of the earlier traced artwork, carrying it as a 1024×1024 raster.
Not from the transom photograph, and not from an original vector. Because the
source is the earlier vector rasterised rather than a photo, the geometry came back
closely.

`tools/trace_logo.py` is the tracer, kept in the repo so that closeness is
checkable rather than asserted:

```
python3 tools/trace_logo.py docs/source/madcow-lockup.pdf shared/img --check
```

It rewrites all six files byte-for-byte identically to the committed ones, and
`--check` re-renders the result against the source and reports **1.51%** of ink
pixels disagreeing — roughly a quarter of a pixel along the outline at 1024px.
Raise the tolerance constants in that file if a future story wants a closer trace
at a larger file size.

They're faithful at any size the site will use, but if the original artwork exists
as a real vector file somewhere, that's better — swap it in and keep the ids.

## The sail number

The boat races under **1340**. That is a real identifier, not a decorative numeral,
which means it earns the structural role that arbitrary `01 / 02 / 03` markers do
not. It appears in the footer and as the label on trip photos, set in mono — `--ensign`
on light, `--ensign-lt` on the navy field. Use it sparingly and never invent siblings for it — there is one number
and it belongs to one boat.

## Palette check against real photographs

Sampled from the on-the-water photo: sky `#B4C8DF`, water `#969999`, horizon haze
`#8C9EAF`. Lake Erie under overcast is almost entirely desaturated blue-grey, and
the `--hull` base is essentially that water colour lifted — so photographs sit into
the page instead of fighting it.

The consequence worth planning around: **the ensign red is the only warm colour
anywhere, including in the photography.** That makes it extremely high-value and
extremely easy to overspend. One accent element per viewport. On these grey-blue
images it reads as a signal from across the room — exactly what you want on a call
to action over a photo, and exactly what ruins the page if it's also on the tags,
the eyebrows, and the nav.

This is why project stack tags stay `--blue` rather than red. Three cards with red
tags is three accents in one viewport, which spends the whole budget on the least
important text on the page.

## Photo pipeline

`tools/photos.py` replaces the untested Node sketch in the earlier spec. It is
written in Python and does what the spec asked for: applies EXIF orientation then
discards all metadata including GPS, emits AVIF and WebP at 400 / 1000 / 2000
(skipping any size larger than the source), generates the base64 LQIP, records real
dimensions, and preserves hand-written `alt` and `caption` across re-runs.

It exits non-zero when any photo is missing alt text, so it can gate a commit hook.

Run end to end on 2026-08-21 against the 1340 photo (814×1001, the copy that
survived in `Downloads/`). What that run actually showed:

- **One** derivative, not two: at 814px wide, only the 400 width is under the
  source, so 1000 and 2000 are correctly skipped. 16 KB AVIF, 15 KB WebP. The
  earlier "two derivative sizes at 12 KB and 34 KB" cannot be reproduced from this
  copy of the photo and is withdrawn rather than restated — it was presumably
  measured against a larger original.
- Zero EXIF tags on both outputs, against a source carrying `exif`, `photoshop`
  and `xmp` blocks.
- `python3 tools/photos.py --help` exits 0.
- Alt preservation was tested by inserting a photo that sorts *first* and re-running.
  It failed the first time — the new photo inherited the alt text of whatever
  previously held its number, and the missing-alt gate passed at exit 0. Entries are
  now keyed on a `source` field recorded in `trip.json`; the file-id match survives
  only as a migration path for a manifest written before that field existed. Both
  paths were then re-run and behave.

That last one is the reason the manifest carries a `source` key the spec in
`sailing-site.md` does not show. It is additive, and the gallery ignores it.

## Sailing-site notes

The cursor-tracking eyes are an **hq-only** signature. On the sailing site the hero
is a photograph, the mark appears only in the header at ~30px, and eye tracking at
that size is invisible fidgeting. One signature, one place.

Photography sits naturally on this palette — the sampled water and sky values are
close to `--hull`. The trade-off is that `--ensign` is the only warm colour on
either site including in the photos, so on the sailing site it is even easier to
overspend. One accent element per viewport still holds.

## Preview

`docs/preview/theme-preview.html` is a working demo: header, hero with the live eye
tracking, work cards, an inverted sailing strip using the real 1340 photo through a
proper `<picture>` element, and a palette reference. Open it in a browser and move
the cursor near the face. Keep the folder together — it references `assets/`. It
reads `shared/css/tokens.css` and `base.css` directly rather than copying them, so
it cannot drift away from the real design system.

The copy in it is placeholder and should be rewritten before any of it ships.

The layout caveat is discharged. It was written because no browser was available;
one was, on 2026-08-21, and the page was rendered from disk in Chromium at 360px
and 1440px. Both widths came back with no horizontal scroll and no element
extending past the viewport, `--hull` on the body and Bricolage Grotesque on the
headings. One thing was off and is fixed: `base.css` resets paragraph margins and
never puts them back, so paragraphs in the navy strip ran together. The rule lives
in the preview's own `<style>` for now rather than in `shared/`, because a real
page should settle it.

Anything other than 360px and 1440px is still unverified.
