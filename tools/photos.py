#!/usr/bin/env python3
"""Build the derivatives, the manifest and the pages for the trip logs.

    python3 tools/photos.py --trip 2025-07-12-put-in-bay --src ~/Desktop/dump --root sailing
    python3 tools/photos.py --root sailing            # re-render every log from its trip.json

For every photo in --src it applies the EXIF orientation, throws the metadata
away, and writes AVIF and WebP at 400 / 1000 / 2000 wide into
<root>/assets/photos/<trip>/, skipping any width larger than the source. It then
writes <root>/logs/<trip>/trip.json with the real dimensions and a base64 LQIP,
keeping any alt and caption already written there.

Photos are ordered by the capture time in their EXIF, then by filename. A dump
from two phones interleaves badly on filename alone (PXL_* sorts after every
2025MMDD_* file), and the order of the manifest is the order of the page.

Stripping metadata is not optional and there is deliberately no flag to turn it
off. Photos straight off a phone carry GPS coordinates that give away the marina,
the mooring, and usually the house. A photo that has been through Facebook has
generally been stripped already; one that has not, has not.

Exits non-zero when a photo has no alt text, so it can gate a commit hook - and
in that case it writes the manifest and NO page, so an empty alt never reaches
a page that the quality floor says must carry one.

When every photo has alt text it renders <root>/logs/<trip>/index.html from
tools/templates/trip.html and regenerates <root>/logs/index.html from every
trip.json under <root>/logs/. Rendering here rather than in the browser is the
decision story #11 records: the page is static HTML with the <picture> elements,
sizes and eager/lazy attributes already in it, so the first row loads without
waiting for a script, and Cloudflare Pages still runs nothing but its one copy
line. Without --src the script only renders, so alt text can be edited on a
machine that does not have the originals.

Needs Pillow with AVIF and WebP support: python3 -m pip install "Pillow>=11.3".
"""

import argparse
import base64
import datetime
import glob
import html
import io
import json
import os
import re
import sys

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - environment problem, not a code path
    sys.exit("photos.py needs Pillow: python3 -m pip install 'Pillow>=11.3'")

WIDTHS = (("thumb", 400), ("med", 1000), ("full", 2000))
SOURCE_SUFFIXES = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp")
LQIP_WIDTH = 20
SLUG_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)$")
HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, "templates")

# The gallery's layout constants. They describe the page the CSS in
# sailing/css/site.css draws, so the sizes attribute can state the real slot
# width: a .wrap is 72rem at its widest with 1.5rem padding each side, and
# the rows use --space-2 (0.5rem) between figures. Change them together.
PAGE_MAX_REM = 72.0
WRAP_PAD_REM = 3.0
GAP_REM = 0.5
ROW_TARGET = 4.2   # aspect ratios summed per row, wide layout; ~3 landscape across
NARROW_MAX_REM = 46.0   # below this the CSS lets the rows re-wrap (--sail-narrow)
NARROW_TARGET = 1.9  # aspect ratios per line at phone width; at most 3 portraits, so the label under a 360px thumb still fits
SITE_NAME = "Mad Cow Sailing"
SITE_ORIGIN = "https://madcowsailing.com"

EXIF_DATETIME_ORIGINAL = 36867
EXIF_DATETIME = 306
EXIF_IFD = 0x8769


def die(msg):
    sys.exit("photos.py: " + msg)


def scrubbed(im):
    """Orientation applied, every scrap of metadata gone."""
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    clean = Image.new(im.mode, im.size)
    clean.paste(im)          # pixels only; info, EXIF and ICC do not follow a paste
    return clean


def encode(im, path, quality):
    fmt = "AVIF" if path.endswith(".avif") else "WEBP"
    im.save(path, format=fmt, quality=quality)


def lqip(im):
    w = LQIP_WIDTH
    h = max(1, round(im.height * w / im.width))
    small = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, format="WEBP", quality=40)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def taken_at(path):
    """The EXIF capture time as a sortable string, or '' when there is none."""
    try:
        with Image.open(path) as im:
            ex = im.getexif()
            return ex.get_ifd(EXIF_IFD).get(EXIF_DATETIME_ORIGINAL) or ex.get(EXIF_DATETIME) or ""
    except Exception:
        return ""


def sources(src_dir):
    if not os.path.isdir(src_dir):
        die("--src is not a directory: " + src_dir)
    names = [n for n in os.listdir(src_dir)
             if n.lower().endswith(SOURCE_SUFFIXES) and not n.startswith(".")]
    if not names:
        die("no photos in " + src_dir)
    return sorted(names, key=lambda n: (taken_at(os.path.join(src_dir, n)), n))


def load_manifest(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as e:
            die("%s is not valid JSON (%s) - fix or delete it" % (path, e))


def existing_entries(manifest):
    """Index prior entries by source filename, falling back to the file id.

    Keying on `source` is what makes a re-run safe after a photo is inserted in
    the middle: the numbering shifts, and alt text keyed on the number alone
    would silently move to the wrong photo.

    The file-id index is only a migration path for a manifest written before
    `source` was recorded, so it is returned empty once any entry carries one.
    Falling back to it per photo instead hands a brand new photo the alt text of
    whatever used to hold its number, and the missing-alt gate then passes.
    """
    by_source, by_file = {}, {}
    for e in manifest.get("photos", []):
        if e.get("source"):
            by_source[e["source"]] = e
        if e.get("file"):
            by_file[e["file"]] = e
    if by_source:
        by_file = {}
    return by_source, by_file


def build(args):
    trip = args.trip
    root = args.root
    out_dir = os.path.join(root, "assets", "photos", trip)
    log_dir = os.path.join(root, "logs", trip)
    manifest_path = os.path.join(log_dir, "trip.json")

    names = sources(args.src)
    manifest = load_manifest(manifest_path)
    by_source, by_file = existing_entries(manifest)

    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)

    photos = []
    for i, name in enumerate(names, start=1):
        fid = "%03d" % i
        src_path = os.path.join(args.src, name)
        with Image.open(src_path) as raw:
            im = scrubbed(raw)

        emitted = None
        for label, w in WIDTHS:
            if w > im.width:
                continue
            h = max(1, round(im.height * w / im.width))
            resized = im.resize((w, h), Image.LANCZOS)
            emitted = (w, h)
            for ext in ("avif", "webp"):
                dest = os.path.join(out_dir, "%s-%s.%s" % (fid, label, ext))
                if not args.force and os.path.exists(dest) \
                        and os.path.getmtime(dest) >= os.path.getmtime(src_path):
                    continue
                encode(resized, dest, args.quality)
        if emitted is None:
            # narrower than the smallest derivative: emit it at its own size
            emitted = (im.width, im.height)
            for ext in ("avif", "webp"):
                encode(im, os.path.join(out_dir, "%s-thumb.%s" % (fid, ext)), args.quality)

        prior = by_source.get(name) or by_file.get(fid) or {}
        entry = {
            "file": fid,
            "source": name,
            "alt": prior.get("alt", ""),
            "width": emitted[0],
            "height": emitted[1],
            "lqip": lqip(im),
        }
        if prior.get("caption"):
            entry["caption"] = prior["caption"]
        photos.append(entry)
        print("  %s  %-32s %dx%d" % (fid, name, emitted[0], emitted[1]))

    m = SLUG_DATE.match(trip)
    out = {
        "title": manifest.get("title") or (m.group(2).replace("-", " ").title() if m else trip),
        "date": manifest.get("date") or (m.group(1) if m else ""),
        "location": manifest.get("location", ""),
        "log": manifest.get("log", ""),
    }
    if manifest.get("cover"):
        out["cover"] = manifest["cover"]
    out["photos"] = photos
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote %s (%d photos)" % (manifest_path, len(photos)))

    missing = [p["file"] for p in photos if not p["alt"].strip()]
    if missing:
        print("\nno alt text on: " + ", ".join(missing), file=sys.stderr)
        print("Write it into %s. Every photo needs it." % manifest_path, file=sys.stderr)
        print("No page was written; re-run once the alt text is in.", file=sys.stderr)
        return 1
    return render(root, [trip])


# ---------------------------------------------------------------- rendering


def fill(template_name, values):
    """Substitute {{tokens}}, refusing a template with a token nothing fills.

    A bare str.replace() is a silent no-op when its target is absent, so a
    renamed token would ship the literal braces into a page. Every token in
    the template must be in `values`, and every value must be used.
    """
    path = os.path.join(TEMPLATES, template_name)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    tokens = set(re.findall(r"{{(\w+)}}", text))
    unused = set(values) - tokens
    unfilled = tokens - set(values)
    if unused or unfilled:
        die("%s: tokens without a value %s; values without a token %s"
            % (template_name, sorted(unfilled), sorted(unused)))
    for k, v in values.items():
        text = text.replace("{{%s}}" % k, v)
    assert "{{" not in text
    return text


def esc(s):
    return html.escape(str(s), quote=True)


def date_text(iso):
    try:
        d = datetime.date.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso
    return "%d %s %d" % (d.day, d.strftime("%B"), d.year)


def first_line(log):
    """The first line of the log, for the index row - a paragraph break or a
    sentence end, whichever comes first."""
    head = log.strip().split("\n")[0].strip()
    m = re.match(r"(.+?[.!?])(\s|$)", head)
    return m.group(1) if m else head


def log_html(log):
    paras = [p.strip() for p in re.split(r"\n\s*\n", log.strip()) if p.strip()]
    return "\n".join("    <p>%s</p>" % esc(p) for p in paras)


def largest_label(entry):
    """Which derivative is the biggest one that was emitted for this photo -
    the manifest's width is the width of that file."""
    for label, w in reversed(WIDTHS):
        if entry["width"] >= w:
            return label
    return "thumb"


def srcset(base, entry, ext):
    parts = []
    for label, w in WIDTHS:
        if entry["width"] >= w:
            parts.append("%s-%s.%s %dw" % (base, label, ext, w))
    if not parts:
        parts.append("%s-thumb.%s %dw" % (base, ext, entry["width"]))
    return ", ".join(parts)


def pack_rows(photos, target):
    """Greedy justified-row packing against a target sum of aspect ratios.

    Returns a list of rows; each row is a list of (entry, share) where share
    is that photo's fraction of the row width. A row closes when adding the
    next photo would take it further from the target than stopping short.
    The last row is priced as if it were full, so it does not stretch.

    Called twice per gallery: once at ROW_TARGET for the wide layout, whose
    rows are real <div>s, and once at NARROW_TARGET for phone width, where
    the CSS dissolves those divs and re-wraps the figures on the narrow
    shares. Both packings are written into the page, so the sizes attribute
    can state the real slot at either width.
    """
    rows, row, total = [], [], 0.0
    for e in photos:
        ar = e["width"] / e["height"]
        if row and abs(total + ar - target) > abs(total - target):
            rows.append((row, total))
            row, total = [], 0.0
        row.append((e, ar))
        total += ar
    if row:
        rows.append((row, max(total, target)))
    return [[(e, ar / total) for e, ar in row] for row, total in rows]


def sizes_attr(share, n, nshare, nn):
    """The slot width this photo gets, stated for the browser, in three tiers.

    Widest: the wrap is capped at PAGE_MAX_REM minus its padding, and the
    photo has `share` of a row of `n`. Middle: the same row on a wrap that is
    the viewport minus padding. Below NARROW_MAX_REM the rows re-wrap and the
    photo has `nshare` of a line of `nn`. Every tier subtracts the gaps.
    """
    gaps = (n - 1) * GAP_REM
    ngaps = (nn - 1) * GAP_REM
    return "(min-width: %grem) %.2frem, (min-width: %grem) calc(%.2fvw - %.2frem), calc(%.2fvw - %.2frem)" % (
        PAGE_MAX_REM, (PAGE_MAX_REM - WRAP_PAD_REM - gaps) * share,
        NARROW_MAX_REM, share * 100, (WRAP_PAD_REM + gaps) * share,
        nshare * 100, (WRAP_PAD_REM + ngaps) * nshare)


def figure(trip, entry, share, n, nshare, nn, eager):
    base = "/assets/photos/%s/%s" % (trip, entry["file"])
    ar = entry["width"] / entry["height"]
    sizes = sizes_attr(share, n, nshare, nn)
    loading = ('loading="eager" fetchpriority="high"' if eager else 'loading="lazy"')
    # No figcaption: the brief's per-photo 1340 label was dropped at the #11
    # commit gate (owner decision, 2026-09-04) - 24 accent-red labels on one
    # page spent the "one accent element per viewport" budget the same brief
    # sets, and the sail number keeps its place in the footer. A photo's
    # optional caption is the lightbox's to show (#12), with the counter.
    return "\n".join([
        '      <figure style="--share: %.4f; --nshare: %.4f; --nn: %d">' % (share, nshare, nn),
        '        <a class="frame" href="%s-%s.webp" style="--ar: %.4f; background-image: url(%s)">'
        % (base, largest_label(entry), ar, entry["lqip"]),
        '          <picture>',
        '            <source type="image/avif" srcset="%s" sizes="%s">' % (srcset(base, entry, "avif"), sizes),
        '            <source type="image/webp" srcset="%s" sizes="%s">' % (srcset(base, entry, "webp"), sizes),
        '            <img src="%s-%s.webp" width="%d" height="%d" %s decoding="async" alt="%s">'
        % (base, largest_label(entry), entry["width"], entry["height"], loading, esc(entry["alt"])),
        '          </picture>',
        '        </a>',
        '      </figure>',
    ])


def gallery_html(trip, photos):
    narrow = {}
    for line in pack_rows(photos, NARROW_TARGET):
        for e, nshare in line:
            narrow[e["file"]] = (nshare, len(line))
    out = []
    for r, row in enumerate(pack_rows(photos, ROW_TARGET)):
        n = len(row)
        out.append('    <div class="gallery-row" style="--n: %d">' % n)
        for e, share in row:
            nshare, nn = narrow[e["file"]]
            out.append(figure(trip, e, share, n, nshare, nn, eager=(r == 0)))
        out.append('    </div>')
    # Absorbs the free space on the last narrow line, so the figures there
    # keep their packed widths instead of stretching to fill it. Hidden at
    # wide widths, where the rows are explicit and there is nothing to absorb.
    out.append('    <div class="gallery-spacer" aria-hidden="true"></div>')
    return "\n".join(out)


def cover_of(manifest):
    photos = manifest["photos"]
    wanted = manifest.get("cover")
    for p in photos:
        if p["file"] == wanted:
            return p
    if wanted:
        die("cover %r names no photo in the manifest" % wanted)
    return photos[0]


def render_trip(root, trip):
    manifest_path = os.path.join(root, "logs", trip, "trip.json")
    manifest = load_manifest(manifest_path)
    if not manifest.get("photos"):
        die("%s has no photos" % manifest_path)
    missing = [p["file"] for p in manifest["photos"] if not p.get("alt", "").strip()]
    if missing:
        die("%s: no alt text on %s - not rendering" % (manifest_path, ", ".join(missing)))
    heading = manifest["title"]
    page = fill("trip.html", {
        "title": esc("%s — trip log — %s" % (heading, SITE_NAME)),
        "description": esc(first_line(manifest["log"]) or heading),
        "canonical": "%s/logs/%s/" % (SITE_ORIGIN, trip),
        "generated_from": "logs/%s/trip.json" % trip,
        "template": "trip.html",
        "date_iso": esc(manifest["date"]),
        "date_text": esc(date_text(manifest["date"])),
        "heading": esc(heading),
        "location": esc(manifest["location"]),
        "count": str(len(manifest["photos"])),
        "log_html": log_html(manifest["log"]),
        "gallery": gallery_html(trip, manifest["photos"]),
    })
    out = os.path.join(root, "logs", trip, "index.html")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print("wrote %s" % out)


def index_row(root, trip, manifest):
    cover = cover_of(manifest)
    base = "/assets/photos/%s/%s" % (trip, cover["file"])
    sizes = "(min-width: 46rem) 16rem, calc(100vw - 3rem)"  # the cover is 16rem wide, cropped to 4:3 by the CSS
    return "\n".join([
        '      <li class="log-row">',
        '        <a class="log-cover" href="/logs/%s/" tabindex="-1" aria-hidden="true">' % trip,
        '          <picture>',
        '            <source type="image/avif" srcset="%s" sizes="%s">' % (srcset(base, cover, "avif"), sizes),
        '            <source type="image/webp" srcset="%s" sizes="%s">' % (srcset(base, cover, "webp"), sizes),
        '            <img src="%s-thumb.webp" width="%d" height="%d" loading="lazy" decoding="async" alt="">'
        % (base, cover["width"], cover["height"]),
        '          </picture>',
        '        </a>',
        '        <div class="log-meta">',
        '          <h2><a href="/logs/%s/">%s</a></h2>' % (trip, esc(manifest["title"])),
        '          <p class="meta"><time datetime="%s">%s</time> &middot; %s &middot; %d photos</p>'
        % (esc(manifest["date"]), esc(date_text(manifest["date"])), esc(manifest["location"]), len(manifest["photos"])),
        '          <p>%s</p>' % esc(first_line(manifest["log"])),
        '        </div>',
        '      </li>',
    ])


def render_index(root):
    trips = []
    for path in glob.glob(os.path.join(root, "logs", "*", "trip.json")):
        trip = os.path.basename(os.path.dirname(path))
        trips.append((trip, load_manifest(path)))
    if not trips:
        die("no trip.json under %s/logs/ - nothing to index" % root)
    trips.sort(key=lambda t: (t[1].get("date", ""), t[0]), reverse=True)
    rows = "\n".join(index_row(root, trip, m) for trip, m in trips)
    page = fill("logs-index.html", {
        "title": esc("Trip logs — %s" % SITE_NAME),
        "description": esc("Trip logs and photos from Mad Cow, sail number 1340: where we went and how it went."),
        "canonical": "%s/logs/" % SITE_ORIGIN,
        "generated_from": "every logs/<slug>/trip.json",
        "template": "logs-index.html",
        "rows": rows,
    })
    out = os.path.join(root, "logs", "index.html")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print("wrote %s (%d trips)" % (out, len(trips)))


def render(root, trips=None):
    if trips is None:
        trips = sorted(os.path.basename(os.path.dirname(p))
                       for p in glob.glob(os.path.join(root, "logs", "*", "trip.json")))
        if not trips:
            die("no trip.json under %s/logs/ - nothing to render" % root)
    for trip in trips:
        render_trip(root, trip)
    render_index(root)
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="photos.py",
        description="Build trip-log photo derivatives, trip.json, and the log pages.",
        epilog="EXIF is always stripped. There is no flag to keep it. "
               "Without --src, only the pages are re-rendered from trip.json.",
    )
    p.add_argument("--trip", metavar="SLUG",
                   help="trip slug, e.g. 2026-06-14-put-in-bay (required with --src)")
    p.add_argument("--src", metavar="DIR",
                   help="folder of original photos; omit to re-render only")
    p.add_argument("--root", default="sailing", metavar="DIR",
                   help="site root holding assets/ and logs/ (default: sailing)")
    p.add_argument("--quality", type=int, default=62, metavar="N",
                   help="AVIF/WebP quality, 1-100 (default: 62)")
    p.add_argument("--force", action="store_true",
                   help="re-encode derivatives that are already up to date")
    args = p.parse_args(argv)
    if not 1 <= args.quality <= 100:
        p.error("--quality must be between 1 and 100")
    args.root = os.path.expanduser(args.root)
    if args.src:
        if not args.trip:
            p.error("--trip is required with --src")
        args.src = os.path.expanduser(args.src)
        return build(args)
    return render(args.root, [args.trip] if args.trip else None)


if __name__ == "__main__":
    sys.exit(main())
