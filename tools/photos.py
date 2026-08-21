#!/usr/bin/env python3
"""Build the derivatives and the manifest for one trip log.

    python3 tools/photos.py --trip 2026-06-14-put-in-bay --src ~/Desktop/dump --root sailing

For every photo in --src it applies the EXIF orientation, throws the metadata
away, and writes AVIF and WebP at 400 / 1000 / 2000 wide into
<root>/assets/photos/<trip>/, skipping any width larger than the source. It then
writes <root>/logs/<trip>/trip.json with the real dimensions and a base64 LQIP,
keeping any alt and caption already written there.

Stripping metadata is not optional and there is deliberately no flag to turn it
off. Photos straight off a phone carry GPS coordinates that give away the marina,
the mooring, and usually the house. A photo that has been through Facebook has
generally been stripped already; one that has not, has not.

Exits non-zero when a photo has no alt text, so it can gate a commit hook.

Needs Pillow with AVIF and WebP support: python3 -m pip install "Pillow>=11.3".
"""

import argparse
import base64
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


def sources(src_dir):
    if not os.path.isdir(src_dir):
        die("--src is not a directory: " + src_dir)
    names = [n for n in sorted(os.listdir(src_dir))
             if n.lower().endswith(SOURCE_SUFFIXES) and not n.startswith(".")]
    if not names:
        die("no photos in " + src_dir)
    return names


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
        "photos": photos,
    }
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote %s (%d photos)" % (manifest_path, len(photos)))

    missing = [p["file"] for p in photos if not p["alt"].strip()]
    if missing:
        print("\nno alt text on: " + ", ".join(missing), file=sys.stderr)
        print("Write it into %s. Every photo needs it." % manifest_path, file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="photos.py",
        description="Build trip-log photo derivatives and trip.json.",
        epilog="EXIF is always stripped. There is no flag to keep it.",
    )
    p.add_argument("--trip", required=True, metavar="SLUG",
                   help="trip slug, e.g. 2026-06-14-put-in-bay")
    p.add_argument("--src", required=True, metavar="DIR",
                   help="folder of original photos")
    p.add_argument("--root", default="sailing", metavar="DIR",
                   help="site root holding assets/ and logs/ (default: sailing)")
    p.add_argument("--quality", type=int, default=62, metavar="N",
                   help="AVIF/WebP quality, 1-100 (default: 62)")
    p.add_argument("--force", action="store_true",
                   help="re-encode derivatives that are already up to date")
    args = p.parse_args(argv)
    if not 1 <= args.quality <= 100:
        p.error("--quality must be between 1 and 100")
    args.src = os.path.expanduser(args.src)
    args.root = os.path.expanduser(args.root)
    return build(args)


if __name__ == "__main__":
    sys.exit(main())
