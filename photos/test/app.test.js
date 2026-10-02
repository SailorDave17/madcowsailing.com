// The installed app (#193): the manifest, its icons, the share page's head,
// the headers that let a change reach an installed phone, and the route that
// answers a share when no worker is there. The worker itself is
// test/sw.test.js's, and a share reaching the page is test/share.test.js's.
// Each test names the criterion it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { onRequest as root } from '../functions/_middleware.js';
import * as receiveRoute from '../functions/share/receive.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const SITE = 'https://photos.madcowsailing.com';

const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
const SHARE_HTML = read('public', 'share', 'index.html');
const WORKER = read('public', 'share', 'sw.js');
const SHARE_JS = read('public', 'js', 'share.js');
const head = (html) => html.match(/<head>([\s\S]*?)<\/head>/)[1];

// A colour from shared/css/tokens.css, as [r, g, b]: the manifest's colours
// and the icons' must be the design's, never a hex written by hand.
function token(name) {
  const hex = readFileSync(join(REPO, 'shared', 'css', 'tokens.css'), 'utf8').match(new RegExp(`--${name}:\\s*#([0-9A-Fa-f]{6})\\s*;`))[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
const hexOf = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

// ---- A PNG, decoded with no dependency --------------------------------

/**
 * The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, which is what
 * tools/app_icons.py writes through Pillow. Anything else fails loudly, so a
 * change in how the icons are written cannot pass by being misread.
 */
function decodePng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'not a PNG');
  let at = 8;
  let header = null;
  const data = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  assert.ok(header, 'no IHDR');
  assert.equal(header.depth, 8, 'bit depth');
  assert.equal(header.interlace, 0, 'interlaced');
  assert.ok([2, 6].includes(header.color), `colour type ${header.color}`);
  const channels = header.color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const out = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let value;
      if (filter === 0) value = row[x];
      else if (filter === 1) value = row[x] + left;
      else if (filter === 2) value = row[x] + up;
      else if (filter === 3) value = row[x] + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        value = row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      } else assert.fail(`unknown filter ${filter} on row ${y}`);
      out[y * stride + x] = value & 0xff;
    }
  }
  return {
    width: header.width,
    height: header.height,
    channels,
    pixel(x, y) {
      const i = (y * header.width + x) * channels;
      return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255];
    },
  };
}

const png = (src) => decodePng(readFileSync(join(PUBLIC, ...src.replace(/^\//, '').split('/'))));
const icon = (purpose, sizes) => manifest.icons.find((i) => i.purpose === purpose && i.sizes === sizes);

// ---- Criterion 1: installable ------------------------------------------

test('the manifest names the app, starts on the share page, and opens standalone', () => {
  assert.equal(manifest.name, 'Mad Cow Sailing photos');
  assert.equal(manifest.short_name, 'Mad Cow photos', 'the label the owner chose at #193\'s pickup');
  assert.equal(manifest.start_url, '/share/');
  assert.equal(manifest.id, '/share/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.description.length > 0);
  assert.equal(manifest.prefer_related_applications, undefined, 'it would hand installing to a store app');
});

test('the manifest\'s colours are the page\'s own --hull, from tokens.css', () => {
  assert.equal(manifest.background_color, hexOf(token('hull')));
  assert.equal(manifest.theme_color, hexOf(token('hull')));
});

test('the manifest lists a 192 px and a 512 px icon and a maskable one, each a PNG of its stated size', () => {
  assert.ok(icon('any', '192x192'));
  assert.ok(icon('any', '512x512'));
  assert.ok(icon('maskable', '512x512'));
  assert.equal(manifest.icons.length, 3);
  for (const { src, sizes, type } of manifest.icons) {
    assert.equal(type, 'image/png');
    assert.ok(existsSync(join(PUBLIC, ...src.replace(/^\//, '').split('/'))), `${src} is not in public/`);
    const { width, height } = png(src);
    assert.equal(`${width}x${height}`, sizes, src);
  }
});

test('the two "any" icons are the mark in --blue on transparent, the shared mark itself', () => {
  const mark = decodePng(readFileSync(join(REPO, 'shared', 'img', 'madcow-mark-512.png')));
  const blue = token('blue');
  for (const { src, sizes } of [icon('any', '192x192'), icon('any', '512x512')]) {
    const img = png(src);
    assert.equal(img.channels, 4, `${src} has no transparency`);
    for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]]) {
      assert.equal(img.pixel(x, y)[3], 0, `${src}'s corner ${x},${y} is not transparent`);
    }
    let ink = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g, b, a] = img.pixel(x, y);
        if (a === 255) {
          ink += 1;
          assert.deepEqual([r, g, b], blue, `${src} at ${x},${y}`);
        }
      }
    }
    assert.ok(ink > img.width * img.height * 0.2, `${src} holds almost no mark (${ink} px)`);
    assert.ok(sizes);
  }
  // Made from shared/img/ (criterion 1): the 512 px icon's coverage is the
  // shared 512 px mark's, rendered from the same path. Measured 0.89 of 255
  // apart on average, and nowhere by more than half; the shared mark moved
  // 4 px sideways reads 13.3 and 5% over half, which is the control.
  const any = png(icon('any', '512x512').src);
  const compare = (dx) => {
    let total = 0;
    let far = 0;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const theirs = x - dx >= 0 ? mark.pixel(x - dx, y)[3] : 0;
        const diff = Math.abs(any.pixel(x, y)[3] - theirs);
        total += diff;
        if (diff > 128) far += 1;
      }
    }
    return { mean: total / (512 * 512), far };
  };
  const same = compare(0);
  assert.ok(same.mean < 3 && same.far === 0, JSON.stringify(same));
  const moved = compare(4);
  assert.ok(moved.mean >= 3 || moved.far > 0, `the control could not tell a moved mark apart: ${JSON.stringify(moved)}`);
});

/**
 * Holds an opaque icon to the owner's choice and the maskable rules: opaque
 * to every edge, --chalk everywhere outside the safe zone (a circle of 40%
 * of the width, W3C Manifest), and the --blue mark inside it, filling it to
 * within tools/app_icons.py's margin rather than shrunk to a dot.
 */
function holdsTheSafeZone(src) {
  const img = png(src);
  const chalk = token('chalk');
  const blue = token('blue');
  const centre = (img.width - 1) / 2;
  const safe = img.width * 0.4;
  let reach = 0;
  let ink = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = img.pixel(x, y);
      assert.equal(a, 255, `${src} is not opaque at ${x},${y}`);
      const d = Math.hypot(x - centre, y - centre);
      if (r === chalk[0] && g === chalk[1] && b === chalk[2]) continue;
      assert.ok(d <= safe, `${src} has ink outside the safe zone at ${x},${y}, ${d.toFixed(1)} px from the centre (safe ${safe})`);
      reach = Math.max(reach, d);
      if (r === blue[0] && g === blue[1] && b === blue[2]) ink += 1;
    }
  }
  assert.ok(reach >= safe * 0.85, `${src}'s mark reaches only ${reach.toFixed(1)} of ${safe} px`);
  assert.ok(ink > 0, `${src} has no --blue`);
  return img;
}

test('the maskable icon is the --blue mark on --chalk, opaque, with the mark inside the safe zone (owner, at pickup)', () => {
  holdsTheSafeZone(icon('maskable', '512x512').src);
});

test('the share page names the manifest and an iPhone\'s home-screen icon and label, and no other page does', () => {
  const h = head(SHARE_HTML);
  assert.match(h, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(h, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-180\.png">/);
  assert.equal(h.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)">/)[1], manifest.short_name);
  const img = holdsTheSafeZone('/icons/apple-touch-180.png');
  assert.deepEqual([img.width, img.height], [180, 180]);
  // The app starts on the share page, and nowhere else offers to install it.
  for (const file of [['public', '404.html'], ['public', 'policy.html'], ['templates', 'page.html'], ['lib', 'admin-page.js']]) {
    assert.doesNotMatch(read(...file), /rel="manifest"|apple-touch-icon/, file.join('/'));
  }
});

// What this holds is _headers' own text. On photos.madcowsailing.com the zone
// can still raise a cached type to 4 hours whatever these rules say (#193's
// review measured it on /js/share.js), so the worker's update rests on
// updateViaCache 'none', held by the test after this one; the domain's
// headers are read on production at #193's step 9.
test('_headers names the manifest and the worker with no lifetime of their own, and never immutable', () => {
  const text = read('public', '_headers');
  for (const path of ['/manifest.webmanifest', '/share/sw.js']) {
    const rule = text.match(new RegExp(`^${path.replace(/[.]/g, '\\.')}\\n((?:[ \\t]+.*\\n?)+)`, 'm'));
    assert.ok(rule, `_headers has no rule for ${path}`);
    assert.match(rule[1], /^\s+Cache-Control: public, max-age=0, must-revalidate$/m, path);
    assert.doesNotMatch(rule[1], /immutable/);
  }
});

test('the share page registers the worker it is served beside, for /share/, past the browser\'s cache', () => {
  assert.ok(existsSync(join(PUBLIC, 'share', 'sw.js')));
  assert.match(SHARE_JS, /navigator\.serviceWorker\.register\('\/share\/sw\.js', \{ scope: '\/share\/', updateViaCache: 'none' \}\)/);
});

// ---- Criterion 2: the Android share target, photos only until #198 -------

test('the share target posts the chosen photos as a form to /share/receive, inside the app\'s scope', () => {
  const target = manifest.share_target;
  assert.equal(target.action, '/share/receive');
  assert.ok(target.action.startsWith(manifest.scope));
  assert.equal(target.method, 'POST');
  assert.equal(target.enctype, 'multipart/form-data');
  assert.deepEqual(Object.keys(target.params), ['files'], 'a share of text or a link has no use here');
});

test('the share target\'s field is the one the worker reads, and its address the one the worker answers', () => {
  const [files] = manifest.share_target.params.files;
  assert.equal(WORKER.match(/const FIELD = '([^']+)';/)[1], files.name);
  assert.equal(WORKER.match(/const RECEIVE = '([^']+)';/)[1], manifest.share_target.action);
});

test('the share target takes photos only, until #198 lets a clip be sent (owner, at pickup)', () => {
  assert.deepEqual(manifest.share_target.params.files.map((f) => f.accept), [['image/*']]);
});

// ---- Criterion 4: on an iPhone the photos are chosen in the page -----------

test('the share page says to choose photos with Add photos, beside the button, since an iPhone\'s Share menu lists no web app', () => {
  const sender = SHARE_HTML.match(/<div class="sender" id="sender" hidden>([\s\S]*?)<\/div>/)[1];
  const words = sender.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(words, /Choose photos here with Add photos\./);
  assert.match(sender, />Add photos<input type="file"/);
});

// ---- The share target's address with no worker installed ----------------

test('/share/receive is a Function, and the share page and the worker stay static files', () => {
  const routes = JSON.parse(read('public', '_routes.json'));
  assert.ok(routes.include.includes('/share/receive'));
  assert.ok(!routes.include.some((p) => p === '/share/' || p === '/share/*' || p === '/share/sw.js'));
});

test('a share that reaches the server, with no worker to take it, goes to the share page saying to share again, reading nothing', async () => {
  // A body that counts every read. highWaterMark 0, or the stream pulls once
  // on its own to fill its buffer, and that reads as the route reading it.
  let read = 0;
  const body = new ReadableStream({
    pull() {
      read += 1;
      throw new Error('the route read the body');
    },
  }, { highWaterMark: 0 });
  const request = new Request(`${SITE}/share/receive`, {
    method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
  });
  const answer = await root({ request, env: {}, data: {}, params: {}, waitUntil() {}, next: () => receiveRoute.onRequestPost({ request }) });
  assert.equal(answer.status, 303);
  assert.equal(answer.headers.get('Location'), '/share/?shared=failed');
  assert.equal(answer.headers.get('Cache-Control'), 'no-store');
  assert.equal(answer.headers.get('X-Robots-Tag'), 'noindex', 'the site headers are on it');
  assert.equal(read, 0);
  // The control: reading this body is seen.
  await assert.rejects(request.text(), /the route read the body/);
  assert.equal(read, 1);
  assert.deepEqual(Object.keys(receiveRoute), ['onRequestPost'], 'a GET falls through to the static 404, as before');
});
