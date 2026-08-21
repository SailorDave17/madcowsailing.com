#!/usr/bin/env python3
"""Re-trace the Mad Cow mark from a flat raster into the six brief assets.

    python3 tools/trace_logo.py docs/source/madcow-lockup.pdf shared/img --check

This is how shared/img/ was produced on 2026-08-21, kept so the claims the design
brief makes about the trace can be re-run rather than taken on trust. It is not
part of the site build and nothing imports it.

The input is `docs/source/madcow-lockup.pdf`, the owner's export of the earlier
traced artwork. It carries the 1024x1024 lockup as stacked JPEG strips -- the
earlier vector rasterised, not a photograph of the transom. A flat PNG of the same
thing works too. Any pixel nearer #0067A1 than the background counts as ink.

What it does: walks the crack boundary of each connected region, fits cubic
Beziers to those boundaries by least squares while keeping detected corners sharp,
and writes the four SVGs plus two transparent PNGs rendered from the same
geometry. --check re-renders the result and reports the share of pixels that
disagree with the source, which is the number the brief quotes.

Needs Pillow. No other dependency, and deliberately no numpy.
"""

import argparse
import base64
import io
import json
import math
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("trace_logo.py needs Pillow: python3 -m pip install Pillow")

BLUE = (0x00, 0x67, 0xA1)



# ---- boundary tracing ----


PDF_IMAGE = re.compile(rb"<<([^>]*?)/Filter\s*/DCTDecode(.*?)>>\s*stream\r?\n", re.S)


def open_source(path):
    """A PNG of the lockup, or the PDF the artwork was exported as.

    The PDF holds the 1024x1024 render as a vertical stack of JPEG strips with
    no text and no vector content, so stacking them back in file order rebuilds
    the image exactly.
    """
    if not path.lower().endswith(".pdf"):
        return Image.open(path).convert("RGB")
    raw = open(path, "rb").read()
    strips = []
    for m in PDF_IMAGE.finditer(raw):
        length = re.search(rb"/Length (\d+)", m.group(0))
        if not length:
            continue
        start = m.end()
        strips.append(Image.open(io.BytesIO(raw[start:start + int(length.group(1))])).convert("RGB"))
    if not strips:
        sys.exit("no JPEG images in %s - is it the lockup export?" % path)
    W = max(i.width for i in strips)
    H = sum(i.height for i in strips)
    out = Image.new("RGB", (W, H), "white")
    y = 0
    for i in strips:
        out.paste(i, (0, y))
        y += i.height
    return out


def load_mask(path, bg=None):
    im = open_source(path)
    W, H = im.size
    px = im.load()
    if bg is None:
        bg = px[0, 0]
    d2 = lambda a, b: (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2
    m = bytearray(W * H)
    for y in range(H):
        row = y * W
        for x in range(W):
            p = px[x, y]
            if d2(p, BLUE) < d2(p, bg):
                m[row + x] = 1
    return m, W, H


def components(m, W, H, conn=8):
    """Label connected foreground components. Returns (labels, count)."""
    lab = [0] * (W * H)
    n = 0
    if conn == 8:
        nb = [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)]
    else:
        nb = [(0,-1),(-1,0),(1,0),(0,1)]
    for sy in range(H):
        for sx in range(W):
            if m[sy*W+sx] and not lab[sy*W+sx]:
                n += 1
                stack = [(sx, sy)]
                lab[sy*W+sx] = n
                while stack:
                    x, y = stack.pop()
                    for dx, dy in nb:
                        nx, ny = x+dx, y+dy
                        if 0 <= nx < W and 0 <= ny < H:
                            i = ny*W+nx
                            if m[i] and not lab[i]:
                                lab[i] = n
                                stack.append((nx, ny))
    return lab, n


def contours(pixels, W, H):
    """Crack-boundary contours of a pixel set. Returns list of closed point loops."""
    inside = pixels.__contains__
    edges = {}
    for (x, y) in pixels:
        if not inside((x, y-1)):
            edges.setdefault((x, y), []).append((x+1, y))
        if not inside((x+1, y)):
            edges.setdefault((x+1, y), []).append((x+1, y+1))
        if not inside((x, y+1)):
            edges.setdefault((x+1, y+1), []).append((x, y+1))
        if not inside((x-1, y)):
            edges.setdefault((x, y+1), []).append((x, y))
    loops = []
    while edges:
        start = next(iter(edges))
        loop = [start]
        cur = start
        prev = None
        while True:
            outs = edges.get(cur)
            if not outs:
                break
            if len(outs) == 1 or prev is None:
                nxt = outs.pop(0)
            else:
                # ambiguous vertex: take the sharpest clockwise turn
                vx, vy = cur[0]-prev[0], cur[1]-prev[1]
                def key(p):
                    wx, wy = p[0]-cur[0], p[1]-cur[1]
                    cross = vx*wy - vy*wx
                    dot = vx*wx + vy*wy
                    return -math.atan2(cross, dot)
                nxt = min(outs, key=key)
                outs.remove(nxt)
            if not outs:
                del edges[cur]
            prev, cur = cur, nxt
            if cur == start:
                break
            loop.append(cur)
        if len(loop) >= 4:
            loops.append(loop)
    return loops


def area(loop):
    a = 0.0
    n = len(loop)
    for i in range(n):
        x0, y0 = loop[i]
        x1, y1 = loop[(i+1) % n]
        a += x0*y1 - x1*y0
    return a / 2.0


def _dp(pts, tol, lo, hi, keep):
    if hi <= lo + 1:
        return
    x0, y0 = pts[lo]
    x1, y1 = pts[hi]
    dx, dy = x1-x0, y1-y0
    L = math.hypot(dx, dy)
    best, bi = -1.0, -1
    for i in range(lo+1, hi):
        px_, py_ = pts[i]
        if L == 0:
            d = math.hypot(px_-x0, py_-y0)
        else:
            d = abs(dx*(y0-py_) - (x0-px_)*dy) / L
        if d > best:
            best, bi = d, i
    if best > tol:
        keep[bi] = True
        _dp(pts, tol, lo, bi, keep)
        _dp(pts, tol, bi, hi, keep)


def simplify_closed(loop, tol):
    n = len(loop)
    if n < 4:
        return loop
    # anchor at the point furthest from the centroid so the split is stable
    cx = sum(p[0] for p in loop) / n
    cy = sum(p[1] for p in loop) / n
    a0 = max(range(n), key=lambda i: (loop[i][0]-cx)**2 + (loop[i][1]-cy)**2)
    pts = loop[a0:] + loop[:a0]
    pts.append(pts[0])
    keep = [False]*len(pts)
    keep[0] = keep[-1] = True
    _dp(pts, tol, 0, len(pts)-1, keep)
    out = [pts[i] for i in range(len(pts)-1) if keep[i]]
    return out


def turn_angle(a, b, c):
    v1 = (b[0]-a[0], b[1]-a[1])
    v2 = (c[0]-b[0], c[1]-b[1])
    cross = v1[0]*v2[1] - v1[1]*v2[0]
    dot = v1[0]*v2[0] + v1[1]*v2[1]
    return abs(math.atan2(cross, dot))


def to_bezier(pts, corner_deg=62.0, smooth=0.30):
    """Closed polygon -> cubic path data, keeping sharp corners sharp."""
    n = len(pts)
    if n < 3:
        return ''
    thr = math.radians(corner_deg)
    corner = [turn_angle(pts[(i-1) % n], pts[i], pts[(i+1) % n]) > thr for i in range(n)]
    tan = []
    for i in range(n):
        p0 = pts[(i-1) % n]
        p1 = pts[i]
        p2 = pts[(i+1) % n]
        if corner[i]:
            tan.append(((0.0, 0.0), (0.0, 0.0)))
        else:
            tx = (p2[0]-p0[0]) * smooth
            ty = (p2[1]-p0[1]) * smooth
            tan.append(((tx, ty), (tx, ty)))
    d = ['M %s %s' % (fmt(pts[0][0]), fmt(pts[0][1]))]
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i+1) % n]
        t1 = tan[i][1]
        t2 = tan[(i+1) % n][0]
        if t1 == (0.0, 0.0) and t2 == (0.0, 0.0):
            d.append('L %s %s' % (fmt(p2[0]), fmt(p2[1])))
        else:
            c1 = (p1[0] + t1[0], p1[1] + t1[1])
            c2 = (p2[0] - t2[0], p2[1] - t2[1])
            d.append('C %s %s %s %s %s %s' % (
                fmt(c1[0]), fmt(c1[1]), fmt(c2[0]), fmt(c2[1]), fmt(p2[0]), fmt(p2[1])))
    d.append('Z')
    return ' '.join(d)


def fmt(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return s if s not in ('', '-0') else '0'


# ---- curve fitting ----

def _norm(v):
    L = math.hypot(v[0], v[1])
    return (v[0]/L, v[1]/L) if L else (0.0, 0.0)


def _chord_params(pts):
    u = [0.0]
    for i in range(1, len(pts)):
        u.append(u[-1] + math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]))
    tot = u[-1]
    if tot == 0:
        return [i/(len(pts)-1) for i in range(len(pts))]
    return [v/tot for v in u]


def _bez(p0, p1, p2, p3, t):
    v = 1-t
    a, b, c, d = v*v*v, 3*v*v*t, 3*v*t*t, t*t*t
    return (a*p0[0]+b*p1[0]+c*p2[0]+d*p3[0],
            a*p0[1]+b*p1[1]+c*p2[1]+d*p3[1])


def _fit_one(pts, u, t1, t2):
    """Least-squares control points with fixed end tangents t1 (out of P0), t2 (into P3)."""
    p0, p3 = pts[0], pts[-1]
    c00 = c01 = c11 = x0 = x1 = 0.0
    for i, ui in enumerate(u):
        v = 1-ui
        b0 = v*v*v
        b1 = 3*v*v*ui
        b2 = 3*v*ui*ui
        b3 = ui*ui*ui
        a1 = (t1[0]*b1, t1[1]*b1)
        a2 = (t2[0]*b2, t2[1]*b2)
        c00 += a1[0]*a1[0] + a1[1]*a1[1]
        c01 += a1[0]*a2[0] + a1[1]*a2[1]
        c11 += a2[0]*a2[0] + a2[1]*a2[1]
        tmpx = pts[i][0] - (b0*p0[0] + b1*p0[0] + b2*p3[0] + b3*p3[0])
        tmpy = pts[i][1] - (b0*p0[1] + b1*p0[1] + b2*p3[1] + b3*p3[1])
        x0 += a1[0]*tmpx + a1[1]*tmpy
        x1 += a2[0]*tmpx + a2[1]*tmpy
    det = c00*c11 - c01*c01
    if abs(det) < 1e-12:
        seg = math.hypot(p3[0]-p0[0], p3[1]-p0[1]) / 3.0
        a = b = seg
    else:
        a = (x0*c11 - x1*c01) / det
        b = (c00*x1 - c01*x0) / det
        seg = math.hypot(p3[0]-p0[0], p3[1]-p0[1])
        if a < 1e-6 or b < 1e-6:
            a = b = seg / 3.0
    return (p0, (p0[0]+t1[0]*a, p0[1]+t1[1]*a),
            (p3[0]+t2[0]*b, p3[1]+t2[1]*b), p3)


def _max_err(pts, u, bez):
    worst, wi = 0.0, len(pts)//2
    for i, ui in enumerate(u):
        q = _bez(*bez, ui)
        d = (q[0]-pts[i][0])**2 + (q[1]-pts[i][1])**2
        if d > worst:
            worst, wi = d, i
    return worst, wi


def _reparam(pts, u, bez):
    p0, p1, p2, p3 = bez
    out = []
    for i, ui in enumerate(u):
        q = _bez(p0, p1, p2, p3, ui)
        v = 1-ui
        d1 = (3*v*v*(p1[0]-p0[0]) + 6*v*ui*(p2[0]-p1[0]) + 3*ui*ui*(p3[0]-p2[0]),
              3*v*v*(p1[1]-p0[1]) + 6*v*ui*(p2[1]-p1[1]) + 3*ui*ui*(p3[1]-p2[1]))
        d2 = (6*v*(p2[0]-2*p1[0]+p0[0]) + 6*ui*(p3[0]-2*p2[0]+p1[0]),
              6*v*(p2[1]-2*p1[1]+p0[1]) + 6*ui*(p3[1]-2*p2[1]+p1[1]))
        nx = (q[0]-pts[i][0])*d1[0] + (q[1]-pts[i][1])*d1[1]
        dn = d1[0]*d1[0] + d1[1]*d1[1] + (q[0]-pts[i][0])*d2[0] + (q[1]-pts[i][1])*d2[1]
        out.append(ui if dn == 0 else min(1.0, max(0.0, ui - nx/dn)))
    out[0], out[-1] = 0.0, 1.0
    for i in range(1, len(out)):
        if out[i] <= out[i-1]:
            out[i] = min(1.0, out[i-1] + 1e-6)
    return out


def fit_run(pts, tol, t1=None, t2=None, depth=0):
    """Fit a polyline run with cubics under `tol` max deviation."""
    if len(pts) < 2:
        return []
    if len(pts) == 2:
        p0, p3 = pts
        return [(p0, (p0[0]+(p3[0]-p0[0])/3, p0[1]+(p3[1]-p0[1])/3),
                 (p0[0]+2*(p3[0]-p0[0])/3, p0[1]+2*(p3[1]-p0[1])/3), p3)]
    if t1 is None:
        t1 = _norm((pts[1][0]-pts[0][0], pts[1][1]-pts[0][1]))
    if t2 is None:
        t2 = _norm((pts[-2][0]-pts[-1][0], pts[-2][1]-pts[-1][1]))
    u = _chord_params(pts)
    bez = _fit_one(pts, u, t1, t2)
    err, wi = _max_err(pts, u, bez)
    if err <= tol*tol:
        return [bez]
    if depth < 24 and err <= (tol*tol)*16:
        for _ in range(3):
            u = _reparam(pts, u, bez)
            bez = _fit_one(pts, u, t1, t2)
            err, wi = _max_err(pts, u, bez)
            if err <= tol*tol:
                return [bez]
    if depth >= 24 or wi <= 0 or wi >= len(pts)-1:
        return [bez]
    tc = _norm((pts[wi+1][0]-pts[wi-1][0], pts[wi+1][1]-pts[wi-1][1]))
    left = fit_run(pts[:wi+1], tol, t1, (-tc[0], -tc[1]), depth+1)
    right = fit_run(pts[wi:], tol, tc, t2, depth+1)
    return left + right


def _dp_idx(pts, tol, lo, hi, keep):
    if hi <= lo + 1:
        return
    x0, y0 = pts[lo]
    x1, y1 = pts[hi]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    best, bi = -1.0, -1
    for i in range(lo + 1, hi):
        qx, qy = pts[i]
        d = math.hypot(qx - x0, qy - y0) if L == 0 else abs(dx * (y0 - qy) - (x0 - qx) * dy) / L
        if d > best:
            best, bi = d, i
    if best > tol:
        keep[bi] = True
        _dp_idx(pts, tol, lo, bi, keep)
        _dp_idx(pts, tol, bi, hi, keep)


def fit_closed(raw, tol=0.8, poly_tol=1.4, corner_deg=58.0):
    """Closed integer contour -> list of cubic segments, corners kept sharp.

    Works entirely in index space so a contour that revisits a pixel corner
    (a pinch point) cannot scramble the run boundaries.
    """
    n = len(raw)
    if n < 8:
        return None
    # anchor furthest from the centroid so the DP split is stable
    cx = sum(p[0] for p in raw) / n
    cy = sum(p[1] for p in raw) / n
    a0 = max(range(n), key=lambda i: (raw[i][0] - cx) ** 2 + (raw[i][1] - cy) ** 2)
    rot = raw[a0:] + raw[:a0]
    seq = rot + [rot[0]]
    keep = [False] * len(seq)
    keep[0] = keep[-1] = True
    _dp_idx(seq, poly_tol, 0, len(seq) - 1, keep)
    marks = [i for i in range(len(seq) - 1) if keep[i]]
    if len(marks) < 3:
        return None
    thr = math.radians(corner_deg)
    mn = len(marks)
    corners = []
    for k in range(mn):
        a = seq[marks[(k - 1) % mn]]
        b = seq[marks[k]]
        c = seq[marks[(k + 1) % mn]]
        if turn_angle(a, b, c) > thr:
            corners.append(marks[k])
    segs = []
    if len(corners) < 2:
        segs = fit_run(seq, tol)
    else:
        for k in range(len(corners)):
            a = corners[k]
            b = corners[(k + 1) % len(corners)]
            run = seq[a:b + 1] if b > a else rot[a:] + rot[:b + 1] + [rot[b]] * 0
            if len(run) >= 2:
                segs += fit_run(run, tol)
    return segs


def segs_to_d(segs):
    if not segs:
        return ''
    d = ['M %s %s' % (fmt(segs[0][0][0]), fmt(segs[0][0][1]))]
    for p0, p1, p2, p3 in segs:
        d.append('C %s %s %s %s %s %s' % (
            fmt(p1[0]), fmt(p1[1]), fmt(p2[0]), fmt(p2[1]), fmt(p3[0]), fmt(p3[1])))
    d.append('Z')
    return ' '.join(d)


# ---- rasterising, for --check and for the PNGs ----

TOK = re.compile(r'[MLCZ]|-?\d*\.?\d+')


def flatten(d, steps=12):
    """Path data -> list of closed polygons (point lists)."""
    toks = TOK.findall(d)
    i = 0
    polys = []
    cur = []
    px = py = 0.0
    start = (0.0, 0.0)
    while i < len(toks):
        t = toks[i]
        if t == 'M':
            if len(cur) > 2:
                polys.append(cur)
            px, py = float(toks[i+1]), float(toks[i+2])
            start = (px, py)
            cur = [(px, py)]
            i += 3
        elif t == 'L':
            px, py = float(toks[i+1]), float(toks[i+2])
            cur.append((px, py))
            i += 3
        elif t == 'C':
            x1, y1, x2, y2, x3, y3 = (float(v) for v in toks[i+1:i+7])
            for s in range(1, steps+1):
                u = s / steps
                v = 1 - u
                bx = v*v*v*px + 3*v*v*u*x1 + 3*v*u*u*x2 + u*u*u*x3
                by = v*v*v*py + 3*v*v*u*y1 + 3*v*u*u*y2 + u*u*u*y3
                cur.append((bx, by))
            px, py = x3, y3
            i += 7
        elif t == 'Z':
            if len(cur) > 2:
                cur.append(start)
                polys.append(cur)
            cur = []
            px, py = start
            i += 1
        else:
            i += 1
    if len(cur) > 2:
        polys.append(cur)
    return polys


def fill_mask(polys, W, H, samples=2):
    """Even-odd scanline fill at `samples` sub-scanlines per pixel row."""
    edges = []
    for poly in polys:
        n = len(poly)
        for k in range(n):
            x0, y0 = poly[k]
            x1, y1 = poly[(k+1) % n]
            if y0 != y1:
                edges.append((y0, y1, x0, x1))
    cov = bytearray(W * H)
    inv = 1.0 / samples
    for y in range(H):
        acc = [0] * W
        for s in range(samples):
            sy = y + (s + 0.5) * inv
            xs = []
            for (y0, y1, x0, x1) in edges:
                if (y0 <= sy < y1) or (y1 <= sy < y0):
                    xs.append(x0 + (sy - y0) * (x1 - x0) / (y1 - y0))
            if not xs:
                continue
            xs.sort()
            for k in range(0, len(xs) - 1, 2):
                a = int(round(xs[k]))
                b = int(round(xs[k+1]))
                if b <= 0 or a >= W:
                    continue
                a = max(a, 0); b = min(b, W)
                for x in range(a, b):
                    acc[x] += 1
        row = y * W
        half = samples / 2.0
        for x in range(W):
            if acc[x] >= half:
                cov[row + x] = 1
    return cov

# ---- assembling the six assets ----

TOL, PTOL, CD = 1.3, 1.6, 58.0
HDR = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" '
       'fill="currentColor" fill-rule="evenodd" role="img" aria-label="%s">')
IDS_NOTE = (
    '  <!-- The eyes and mouth are holes, but they must move independently for the\n'
    '       cursor-tracking hero, and a subpath of an even-odd path cannot be\n'
    '       transformed on its own. They are therefore cut with a luminance mask:\n'
    '       translate #mc-eye-left / #mc-eye-right and the hole moves with them. -->\n')
MASK_MARGIN = 60


def seg_bbox(segs):
    xs, ys = [], []
    for p0, p1, p2, p3 in segs:
        for p in (p0, p3):
            xs.append(p[0]); ys.append(p[1])
    return min(xs), min(ys), max(xs), max(ys)


def shift(segs, dx, dy):
    return [tuple((p[0] + dx, p[1] + dy) for p in seg) for seg in segs]


def bb_union(groups):
    xs, ys, xe, ye = 1e9, 1e9, -1e9, -1e9
    for segs in groups:
        a, b, c, d = seg_bbox(segs)
        xs = min(xs, a); ys = min(ys, b); xe = max(xe, c); ye = max(ye, d)
    return xs, ys, xe, ye


def trace(src):
    """Raster -> (face outline, [holes], [wordmark loops]) as fitted segments."""
    m, W, H = load_mask(src)
    lab, n = components(m, W, H, conn=8)
    comp = {}
    for y in range(H):
        for x in range(W):
            l = lab[y * W + x]
            if l:
                comp.setdefault(l, set()).add((x, y))
    if not comp:
        sys.exit("no ink found in %s - is it the right image?" % src)
    order = sorted(comp, key=lambda l: -len(comp[l]))
    face_px = comp[order[0]]                       # the face and hair are one blob
    word_px = set()
    for l in order[1:]:
        word_px |= comp[l]

    def fit_all(px):
        out = []
        for lp in contours(px, W, H):
            segs = fit_closed(lp, tol=TOL, poly_tol=PTOL, corner_deg=CD)
            if segs:
                out.append((area(lp), segs))
        return out

    face = fit_all(face_px)
    outer = [s for a, s in face if a > 0]
    holes = [s for a, s in face if a < 0]
    if len(outer) != 1 or len(holes) != 3:
        sys.exit("expected one face outline and three holes (two eyes, one mouth); "
                 "got %d and %d" % (len(outer), len(holes)))
    word = [s for a, s in fit_all(word_px)]
    return outer[0], holes, word, m, W, H


def classify(holes):
    """The mouth sits lowest; of the other two, left is left."""
    hb = sorted(((seg_bbox(s), s) for s in holes), key=lambda t: t[0][1])
    eyes = sorted(hb[:2], key=lambda t: t[0][0])
    return eyes[0][1], eyes[1][1], hb[2][1]


def render_png(groups, bb, size, path, square=True):
    x0, y0, x1, y1 = bb
    w, h = x1 - x0, y1 - y0
    side = max(w, h) if square else w
    offx, offy = ((side - w) / 2.0, (side - h) / 2.0) if square else (0.0, 0.0)
    SS = 4
    R = size * SS
    scale = R / side
    polys = []
    for segs in groups:
        for poly in flatten(segs_to_d(shift(segs, -x0 + offx, -y0 + offy)), steps=14):
            polys.append([(px * scale, py * scale) for px, py in poly])
    cov = fill_mask(polys, R, R, samples=2)
    big = Image.new('L', (R, R))
    big.putdata([255 if v else 0 for v in cov])
    img = Image.new('RGBA', (size, size), BLUE + (0,))
    img.putalpha(big.resize((size, size), Image.LANCZOS))
    img.save(path, optimize=True)


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text if text.endswith('\n') else text + '\n')


def build(src, out_dir, check=False):
    face, holes, word, m, W, H = trace(src)
    eye_l, eye_r, mouth = classify(holes)
    face_all = [face] + holes
    word_all = list(word)
    FB, WB = bb_union(face_all), bb_union(word_all)
    LB = bb_union(face_all + word_all)
    os.makedirs(out_dir, exist_ok=True)

    def path_d(groups, bb):
        return ' '.join(segs_to_d(shift(s, -bb[0], -bb[1])) for s in groups)

    def one_path(name, groups, bb):
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        write(os.path.join(out_dir, name),
              HDR % (fmt(w), fmt(h), 'Mad Cow') +
              '\n  <path d="%s"/>\n</svg>' % path_d(groups, bb))

    one_path('madcow-mark.svg', face_all, FB)
    one_path('madcow-wordmark.svg', word_all, WB)
    one_path('madcow-lockup.svg', face_all + word_all, LB)

    fw, fh = FB[2] - FB[0], FB[3] - FB[1]
    dx, dy = -FB[0], -FB[1]
    mm, mw, mh = MASK_MARGIN, fw + 2 * MASK_MARGIN, fh + 2 * MASK_MARGIN
    write(os.path.join(out_dir, 'madcow-mark-ids.svg'),
          HDR % (fmt(fw), fmt(fh), 'Mad Cow') + '\n' + IDS_NOTE +
          '  <mask id="mc-holes" maskUnits="userSpaceOnUse" x="%s" y="%s" width="%s" height="%s">\n'
          '    <rect x="%s" y="%s" width="%s" height="%s" fill="#fff"/>\n'
          '    <path id="mc-eye-left" fill="#000" fill-rule="evenodd" d="%s"/>\n'
          '    <path id="mc-eye-right" fill="#000" fill-rule="evenodd" d="%s"/>\n'
          '    <path id="mc-mouth" fill="#000" fill-rule="evenodd" d="%s"/>\n'
          '  </mask>\n'
          '  <path id="mc-face" mask="url(#mc-holes)" d="%s"/>\n'
          '</svg>' % (fmt(-mm), fmt(-mm), fmt(mw), fmt(mh),
                      fmt(-mm), fmt(-mm), fmt(mw), fmt(mh),
                      segs_to_d(shift(eye_l, dx, dy)),
                      segs_to_d(shift(eye_r, dx, dy)),
                      segs_to_d(shift(mouth, dx, dy)),
                      segs_to_d(shift(face, dx, dy))))

    render_png(face_all + word_all, LB, 1024, os.path.join(out_dir, 'madcow-lockup-1024.png'))
    render_png(face_all, FB, 512, os.path.join(out_dir, 'madcow-mark-512.png'))

    for n in ('madcow-lockup.svg', 'madcow-mark.svg', 'madcow-mark-ids.svg',
              'madcow-wordmark.svg', 'madcow-lockup-1024.png', 'madcow-mark-512.png'):
        print('  %-24s %7d bytes' % (n, os.path.getsize(os.path.join(out_dir, n))))

    if check:
        d = ' '.join(segs_to_d(s) for s in face_all + word_all)
        cov = fill_mask(flatten(d, steps=10), W, H, samples=2)
        ink = sum(m)
        bad = sum(1 for i in range(W * H) if cov[i] != m[i])
        print('fidelity: %d of %d ink pixels disagree with the source (%.2f%%)'
              % (bad, ink, 100.0 * bad / ink))


def main(argv=None):
    p = argparse.ArgumentParser(
        prog='trace_logo.py',
        description='Re-trace the Mad Cow mark from a flat raster of the lockup.')
    p.add_argument('source', help='the lockup PDF export, or a flat two-colour PNG of it')
    p.add_argument('out', nargs='?', default='shared/img', help='output directory')
    p.add_argument('--check', action='store_true',
                   help='re-render the trace and report pixel disagreement with the source')
    a = p.parse_args(argv)
    build(a.source, a.out, a.check)
    return 0


if __name__ == '__main__':
    sys.exit(main())
