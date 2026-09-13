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
import shutil
import subprocess
import sys

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - environment problem, not a code path
    sys.exit("photos.py needs Pillow: python3 -m pip install 'Pillow>=11.3'")

WIDTHS = (("thumb", 400), ("med", 1000), ("full", 2000))
SOURCE_SUFFIXES = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp")
VIDEO_SUFFIXES = (".mp4", ".mov", ".m4v")
LQIP_WIDTH = 20

# Video. Phones shoot HEVC, which Safari plays and Chrome and Firefox largely do
# not, so a source file copied straight in would play for a minority of readers
# while looking fine in review - a silent failure wearing the costume of a
# supported format. Every video is therefore re-encoded to H.264, which plays
# everywhere that matters. No WebM sibling: the compatibility gap it would cover
# has no browser in it today, and it would double what the repo stores forever
# (owner decision, 2026-09-12).
#
# VIDEO_LONG_EDGE caps the LONG edge, not the height. That distinction is the
# whole point: the July 2026 Mullett Lake dump had a 3840x2160 clip carrying
# rotation=-90, so its true display shape is portrait, and a scale=-2:1080
# filter set the height of the ROTATED frame and produced 608x1080. Capping
# max(iw,ih) cannot be inverted by a rotation flag. Measured on that dump:
# 76.5MB of HEVC became 5.87MB, and all three clips together 12.48MB, against
# Cloudflare Pages' 25MB per-file limit.
VIDEO_LONG_EDGE = 720
VIDEO_CRF = 26
VIDEO_AUDIO_KBPS = 96
VIDEO_SCALE = ("scale=w='min(%d,max(iw,ih))':h=-2"
               ":force_original_aspect_ratio=decrease:force_divisible_by=2")
# Poster frames come from a second or two in, never frame 0: the first frame of
# a phone clip is routinely the blurred one from before the sensor settled.
#
# One second is only a default, and a weak one - it picks whatever the camera
# happened to be pointing at as the clip opened. Measured on the Mullett Lake
# clips: at 1s the Straits video is a frame of bare water, while at 9s it is
# the shot of Cruz being lowered into the lake with the bridge behind, which is
# what the clip is actually about. A poster is the only frame most readers ever
# see, so a manifest entry may name its own timestamp in "poster_seek" and that
# wins over this default.
POSTER_SEEK = "00:00:01"
POSTER_QUALITY = 3
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


def is_video(name):
    return name.lower().endswith(VIDEO_SUFFIXES)


def ffmpeg_tool(name):
    """Locate ffmpeg/ffprobe, or die with the install line rather than a stack.

    Looked up per call rather than cached at import, so a run with no videos in
    it never needs either binary present - which keeps ffmpeg a dependency of
    the video path alone, not of the whole script.
    """
    found = shutil.which(name)
    if not found:
        die("%s is needed for video and is not on PATH.\n"
            "  Install it (Windows: winget install Gyan.FFmpeg) and reopen the shell."
            % name)
    return found


def run(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        die("%s failed:\n%s" % (os.path.basename(cmd[0]), proc.stderr.strip()[-800:]))
    return proc.stdout


def video_shape(path):
    """(width, height, capture time) as the video will DISPLAY, rotation applied.

    ffprobe reports the stored frame, which for a phone clip shot in portrait on
    a landscape sensor is 3840x2160 with a separate rotation=-90 side-data tag.
    Reading width/height alone therefore gets the aspect ratio exactly wrong for
    those files, and the gallery prices every figure by aspect ratio - so a
    rotated clip would be packed into the row as a landscape slot and drawn
    portrait. Swap here, once, where the fact is known.
    """
    out = run([ffmpeg_tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=width,height",
               "-show_entries", "stream_side_data=rotation",
               "-show_entries", "format_tags=creation_time",
               "-of", "json", path])
    data = json.loads(out)
    stream = (data.get("streams") or [{}])[0]
    w, h = int(stream.get("width", 0)), int(stream.get("height", 0))
    rotation = 0
    for side in stream.get("side_data_list", []) or []:
        if "rotation" in side:
            rotation = int(side["rotation"])
    if abs(rotation) % 180 == 90:
        w, h = h, w
    stamp = (data.get("format", {}).get("tags", {}) or {}).get("creation_time", "")
    # ISO 8601 UTC from the container; reshaped to EXIF's spelling so both sort
    # against each other as plain strings, the same contract taken_at() keeps.
    if stamp:
        try:
            when = datetime.datetime.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S")
            stamp = when.replace(tzinfo=datetime.timezone.utc).astimezone().strftime(
                "%Y:%m:%d %H:%M:%S")
        except ValueError:
            stamp = ""
    return w, h, stamp


def video_out_size(path):
    """The encoded clip's own (width, height), rotation applied.

    Read off the OUTPUT rather than computed from the input and the scale
    filter: force_divisible_by rounds, force_original_aspect_ratio clamps, and
    a clip already under the cap is not scaled at all, so the arithmetic has
    three branches and the file has the answer.
    """
    w, h, _ = video_shape(path)
    return w, h


def encode_video(src, dest):
    run([ffmpeg_tool("ffmpeg"), "-y", "-v", "error", "-i", src,
         "-vf", VIDEO_SCALE % VIDEO_LONG_EDGE,
         "-c:v", "libx264", "-preset", "slow", "-crf", str(VIDEO_CRF),
         "-profile:v", "high", "-pix_fmt", "yuv420p",
         # faststart moves the moov atom to the front so the browser can begin
         # playing before the whole file lands. Without it a 6MB clip buffers
         # to completion first, which reads as a broken play button.
         "-movflags", "+faststart",
         "-c:a", "aac", "-b:a", "%dk" % VIDEO_AUDIO_KBPS, dest])


def poster_frame(src, dest, seek=POSTER_SEEK):
    """One JPEG from `seek` into the clip, at the source's own size.

    The caller resizes, so this stays the only place that knows how to pull a
    frame; `seek` is a manifest-supplied override per clip (see POSTER_SEEK).
    """
    run([ffmpeg_tool("ffmpeg"), "-y", "-v", "error", "-ss", seek, "-i", src,
         "-frames:v", "1", "-q:v", str(POSTER_QUALITY), dest])


def taken_at(path):
    """The capture time as a sortable string: EXIF first, file mtime as fallback.

    The fallback is not a nicety. Returning "" for a photo with no EXIF sorts it
    BEFORE every real timestamp, because "" precedes every digit - so the files
    with the least metadata open the gallery. A dump is full of them: anything
    that came back over a messaging app has been recompressed and stripped, and
    in the July 2026 Mullet Lake dump that was four of fifty photos, all four of
    them the softest in the set, all four landing at positions 1-4.

    mtime is a weaker signal than EXIF and is deliberately not pretended
    otherwise - a copied file carries the copy's time. But it is monotonic with
    when the file reached this machine, which for a single dump is close enough
    to keep those photos among their neighbours instead of at the front.

    Formatted to match EXIF's "YYYY:MM:DD HH:MM:SS" so the two sort against each
    other as plain strings, which is what lets the one sort key below stay a
    string compare rather than growing a type union.
    """
    if is_video(path):
        # Pillow cannot open an MP4, so without this a video falls straight
        # through to mtime and lands at the end of the trip rather than in it.
        try:
            stamp = video_shape(path)[2]
            if stamp:
                return stamp
        except SystemExit:
            raise
        except Exception:
            pass
    else:
        try:
            with Image.open(path) as im:
                ex = im.getexif()
                stamp = ex.get_ifd(EXIF_IFD).get(EXIF_DATETIME_ORIGINAL) or ex.get(EXIF_DATETIME)
                if stamp:
                    return str(stamp)
        except Exception:
            pass
    try:
        return datetime.datetime.fromtimestamp(
            os.path.getmtime(path)).strftime("%Y:%m:%d %H:%M:%S")
    except OSError:
        return ""


def sources(src_dir):
    if not os.path.isdir(src_dir):
        die("--src is not a directory: " + src_dir)
    names = [n for n in os.listdir(src_dir)
             if n.lower().endswith(SOURCE_SUFFIXES + VIDEO_SUFFIXES)
             and not n.startswith(".")]
    if not names:
        die("no photos or videos in " + src_dir)
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
        video = is_video(name)

        if video:
            # The poster is the image the gallery lays out, so it goes through
            # exactly the same derivative ladder as a photo below: the grid, the
            # sizes attribute and the LQIP are then one code path rather than
            # two, and a video is just a figure whose largest derivative happens
            # to sit behind a play control.
            #
            # The clip itself is encoded once, to one file, at one size. There is
            # no srcset for video - the browser cannot choose between sources on
            # viewport the way <picture> does, and a second rendition would double
            # what the repo carries forever to serve a choice nobody makes.
            mp4 = os.path.join(out_dir, "%s.mp4" % fid)
            if args.force or not os.path.exists(mp4) \
                    or os.path.getmtime(mp4) < os.path.getmtime(src_path):
                encode_video(src_path, mp4)
            poster_src = os.path.join(out_dir, "%s-poster.jpg" % fid)
            prior_seek = (by_source.get(name) or by_file.get(fid) or {}).get("poster_seek")
            poster_frame(src_path, poster_src, prior_seek or POSTER_SEEK)
            with Image.open(poster_src) as raw:
                im = scrubbed(raw)
            vw, vh, _ = video_shape(src_path)
            if vw and vh and (im.width > im.height) != (vw > vh):
                # ffmpeg applies the rotation when it decodes, so the poster is
                # already upright and this should not fire; it is here because a
                # poster whose orientation disagrees with the clip would be
                # packed into the wrong row shape, and silently.
                im = im.rotate(-90, expand=True)
            os.remove(poster_src)
        else:
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
        if video:
            # The renderer keys off this rather than off the source extension,
            # which is not in the manifest, and never off a filename convention.
            entry["video"] = "%s.mp4" % fid
            # width/height above describe the largest POSTER derivative, which
            # is what <picture> needs and what the row packer prices. The clip
            # is a different size - 720 on its long edge - and gallery.js hands
            # these to the <video> element, so record them separately rather
            # than letting the poster's numbers stand in for the clip's.
            # Measured: without this a 720x1280 clip reported 2000x3556.
            entry["video_width"], entry["video_height"] = video_out_size(
                os.path.join(out_dir, "%s.mp4" % fid))
            if prior_seek:
                # Preserved across re-runs for the same reason alt text is: it
                # is a hand-made choice about this clip, and losing it silently
                # reverts the poster to whatever the first second happened to
                # catch.
                entry["poster_seek"] = prior_seek
        photos.append(entry)
        print("  %s  %-32s %dx%d%s"
              % (fid, name, emitted[0], emitted[1], "  video" if video else ""))

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


def meta_description(log, heading, location):
    """A meta description for a trip page, aimed at 70-160 characters.

    first_line() stops at the first sentence, which is right for an index row
    and routinely too short for a description - Put-in-Bay's was 39. So take
    whole sentences off the top of the log until adding the next one would
    pass 160, then append the location if there is still room. A description
    under 70 is worse than a long one, so a single over-long first sentence is
    returned as-is rather than cut mid-clause.
    """
    head = log.strip().split("\n\n")[0].strip().replace("\n", " ")
    parts = re.findall(r".+?[.!?](?:\s|$)", head) or [head]
    out = ""
    for part in parts:
        candidate = (out + " " + part.strip()).strip() if out else part.strip()
        if out and len(candidate) > 160:
            break
        out = candidate
    if not out:
        out = heading
    tail = " Photos from %s." % location
    if location and location not in out and len(out) + len(tail) <= 160:
        out += tail
    return out


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
    #
    # So the caption is carried to the lightbox as a data-caption attribute
    # rather than as visible text, and ONLY when the manifest entry has one.
    # Writing an empty attribute onto all 24 photos that have no caption is
    # noise in the generated page, and gallery.js treats absent and empty
    # alike. Today no entry has one, so the attribute appears on no figure and
    # the lightbox shows the counter alone. Add a caption to trip.json, re-run
    # this script, and it appears - no change to the CSS or to the script
    # (owner decision, 2026-09-04, story #12).
    caption = entry.get("caption")
    caption_attr = ' data-caption="%s"' % esc(caption) if caption else ""

    # A video figure is a photo figure whose link points at the clip instead of
    # at the largest still, plus a play badge. Deliberately the SAME <picture>
    # and the same sizes: the poster went through the identical derivative
    # ladder, so the grid, the LQIP and the lazy/eager split need no special
    # case, and a reader with JavaScript off gets a plain link to an MP4 that
    # the browser plays on its own - the no-JS baseline #12 protects, unchanged.
    video = entry.get("video")
    if video:
        href = "/assets/photos/%s/%s" % (trip, video)
        badge = ('          <span class="play-badge" aria-hidden="true">'
                 '<svg viewBox="0 0 24 24" focusable="false">'
                 '<path d="M8 5v14l11-7z" /></svg></span>')
        # The clip's own size, not the poster's. gallery.js sets width/height on
        # the <video> so the stage reserves the right box before the first frame
        # decodes; handing it the poster's numbers sized a 720x1280 clip as
        # 2000x3556 (measured), which is a layout shift waiting for playback.
        vdim = ""
        if entry.get("video_width") and entry.get("video_height"):
            vdim = ' data-vw="%d" data-vh="%d"' % (entry["video_width"], entry["video_height"])
        return "\n".join([
            '      <figure style="--share: %.4f; --nshare: %.4f; --nn: %d">' % (share, nshare, nn),
            '        <a class="frame is-video" href="%s"%s data-poster="%s-%s.webp"%s style="--ar: %.4f; background-image: url(%s)">'
            % (href, caption_attr, base, largest_label(entry), vdim, ar, entry["lqip"]),
            '          <picture>',
            '            <source type="image/avif" srcset="%s" sizes="%s">' % (srcset(base, entry, "avif"), sizes),
            '            <source type="image/webp" srcset="%s" sizes="%s">' % (srcset(base, entry, "webp"), sizes),
            '            <img src="%s-%s.webp" width="%d" height="%d" %s decoding="async" alt="%s">'
            % (base, largest_label(entry), entry["width"], entry["height"], loading, esc(entry["alt"])),
            '          </picture>',
            badge,
            '        </a>',
            '      </figure>',
        ])

    return "\n".join([
        '      <figure style="--share: %.4f; --nshare: %.4f; --nn: %d">' % (share, nshare, nn),
        '        <a class="frame" href="%s-%s.webp"%s style="--ar: %.4f; background-image: url(%s)">'
        % (base, largest_label(entry), caption_attr, ar, entry["lqip"]),
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
        "description": esc(meta_description(manifest["log"], heading, manifest["location"])),
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
