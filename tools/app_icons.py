#!/usr/bin/env python3
"""Render the photo site's app icons from the Mad Cow mark (#193).

    python3 tools/app_icons.py

Writes four PNGs into photos/public/icons/, which photos/public/manifest.webmanifest
and the share page's <head> name:

    any-192.png         the mark, --blue on transparent, filling the square
    any-512.png         the same at 512
    maskable-512.png    the mark, --blue on --chalk, inside the maskable safe zone
    apple-touch-180.png the maskable composition at 180, for an iPhone's home screen

Like tools/trace_logo.py, this is not part of the site build and nothing imports
it: run it by hand when the mark or the two colours change, and commit what it
writes. The geometry is shared/img/madcow-mark.svg, filled with trace_logo.py's
own even-odd scanline fill, so the icons and the mark on every page come from the
same path. The colours are read from shared/css/tokens.css, never written here.

Why two compositions. A "maskable" icon is cut to the launcher's own shape (a
circle, a squircle, a rounded square), so it must be opaque to its edges, and
everything that matters must sit inside the safe zone: a circle centred on the
icon whose radius is 40% of its width (W3C Manifest, "icon masks"). The mark is
scaled so its farthest point from the centre is SAFE of that radius. An "any"
icon is shown as it is, so it keeps the favicon's transparent background. An
iPhone fills a transparent home-screen icon with black, so its icon is the
opaque maskable composition.

The owner chose the --blue mark on --chalk at #193's pickup (2026-10-01), over
the white mark on --blue or on --deep. test/app.test.js decodes each file and
holds it to that: sizes, opacity, the colours, and the safe zone.

Needs Pillow, as trace_logo.py does.
"""

import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trace_logo import Image, fill_mask, flatten  # noqa: E402  (Pillow is checked there)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = os.path.join(ROOT, 'shared', 'img', 'madcow-mark.svg')
TOKENS = os.path.join(ROOT, 'shared', 'css', 'tokens.css')
OUT = os.path.join(ROOT, 'photos', 'public', 'icons')

# The mark's farthest point from the centre, as a share of the safe zone's
# radius. Under 1 leaves a margin for the launcher's anti-aliasing at the mask.
SAFE = 0.92
# The safe zone's radius, as a share of the icon's width (W3C Manifest).
SAFE_RADIUS = 0.40
# The mark is filled once at this size, then scaled down for each icon.
RENDER = 2048


def token(name):
    """A colour from tokens.css as an (r, g, b) tuple."""
    with open(TOKENS, encoding='utf-8') as fh:
        m = re.search(r'--%s:\s*#([0-9A-Fa-f]{6})\s*;' % re.escape(name), fh.read())
    if not m:
        sys.exit('tokens.css has no --%s' % name)
    return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))


def mark_polygons():
    """The mark's outline and holes, in viewBox units, and the viewBox's size."""
    with open(MARK, encoding='utf-8') as fh:
        svg = fh.read()
    box = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
    if len(paths) != 1:
        sys.exit('expected one <path> in %s, found %d' % (MARK, len(paths)))
    return flatten(paths[0], steps=14), box[2], box[3]


def bounds(polys):
    xs = [x for poly in polys for x, _ in poly]
    ys = [y for poly in polys for _, y in poly]
    return min(xs), min(ys), max(xs), max(ys)


def coverage(polys, x0, y0, side):
    """The mark's ink as an 'L' image of RENDER x RENDER, the square of `side`
    viewBox units whose corner is (x0, y0) filling it."""
    scale = RENDER / side
    placed = [[((x - x0) * scale, (y - y0) * scale) for x, y in poly] for poly in polys]
    cov = fill_mask(placed, RENDER, RENDER, samples=2)
    img = Image.new('L', (RENDER, RENDER))
    img.putdata([255 if v else 0 for v in cov])
    return img


def main():
    blue, chalk = token('blue'), token('chalk')
    polys, _, _ = mark_polygons()
    x0, y0, x1, y1 = bounds(polys)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0

    # "any": the mark's bounding box centred in the square, filling it, as
    # trace_logo.py renders madcow-mark-512.png.
    side = max(x1 - x0, y1 - y0)
    fill = coverage(polys, cx - side / 2.0, cy - side / 2.0, side)

    # "maskable": the square around the mark's bbox centre whose inscribed safe
    # circle just holds the mark's farthest point, at SAFE of that radius.
    reach = max(math.hypot(x - cx, y - cy) for poly in polys for x, y in poly)
    square = reach / (SAFE_RADIUS * SAFE)
    safe = coverage(polys, cx - square / 2.0, cy - square / 2.0, square)

    os.makedirs(OUT, exist_ok=True)
    written = []

    def any_icon(size, name):
        img = Image.new('RGBA', (size, size), blue + (0,))
        img.putalpha(fill.resize((size, size), Image.LANCZOS))
        img.save(os.path.join(OUT, name), optimize=True)
        written.append(name)

    def opaque_icon(size, name):
        ink = Image.new('RGB', (size, size), blue)
        img = Image.new('RGB', (size, size), chalk)
        img.paste(ink, (0, 0), safe.resize((size, size), Image.LANCZOS))
        img.save(os.path.join(OUT, name), optimize=True)
        written.append(name)

    any_icon(192, 'any-192.png')
    any_icon(512, 'any-512.png')
    opaque_icon(512, 'maskable-512.png')
    opaque_icon(180, 'apple-touch-180.png')
    for name in written:
        print('wrote photos/public/icons/%s' % name)


if __name__ == '__main__':
    main()
