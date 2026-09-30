// POST /api/upload (#154): a photo's three JPEG sizes, from a live upload
// session into an open album, stored with every metadata segment removed and
// waiting for approval. Every request runs through the chain Pages runs in
// front of the route (the root middleware, then the upload directory's two
// guards), against a real SQLite holding the real migrations (test/d1.js),
// an R2 stand-in (test/r2.js) and JPEGs built byte by byte (test/jpeg.js).
// Each test names the criterion it holds.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestPost as upload } from '../functions/api/upload/index.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestPost as deleteAlbum } from '../functions/api/admin/albums/delete.js';
import { onRequestGet as albumsPage } from '../functions/admin/albums.js';
import { TOKEN_HEADER, keyCache } from '../lib/access.js';
import { createAlbum } from '../lib/albums.js';
import { readJpeg } from '../lib/jpeg.js';
import {
  DAILY_UPLOADS, MAX_UPLOAD_BYTES, SIZES, photoObjectKeys, refundDailyUpload, secondsToNextDay, sessionKey,
  sizesAgree, spendDailyUpload,
} from '../lib/photos.js';
import { COOKIE_NAME, nowSeconds, signSession } from '../lib/session.js';
import { accessEnv, certs, keyPair, mint } from './access.js';
import { d1, seedCodes } from './d1.js';
import {
  PNG_SIGNATURE, exif, find, jpeg, metadataMarkers, otherMetadata, segment, withSegments, withTrailer, xmp,
} from './jpeg.js';
import { r2 } from './r2.js';

const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';
const FALL = { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const CAPTURED = 1_790_000_000;
const MIGRATIONS = new URL('../migrations/', import.meta.url);

// One landscape photo at the three sizes, each within its caps and carrying
// no metadata, so a stored copy must equal what was sent.
const SENT = {
  grid: jpeg({ width: 480, height: 360 }),
  screen: jpeg({ width: 1600, height: 1200 }),
  full: jpeg({ width: 2560, height: 1920 }),
};

const team = await keyPair();
beforeEach(() => {
  keyCache.clear();
  mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
});
afterEach(() => mock.restoreAll());

/** A site with generation 2 current, one open album, and a parent's live session. */
async function site() {
  const env = { DB: d1(), MEDIA: r2(), SITE_ENV: 'production', SESSION_SIGNING_KEY: KEY, ...accessEnv() };
  seedCodes(env.DB, 'Q2WE-R4TY-V6PA', 'K7QM-3XRD-9FWB');
  const now = nowSeconds();
  const address = await createAlbum(env.DB, FALL, now);
  return { env, address, issued: now, cookie: await signSession(KEY, 2, now) };
}

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** The share page's form: every field, with `changes` on top; undefined leaves one out. */
function form(address, changes = {}) {
  const fields = { album: address, batch: BATCH, captured: String(CAPTURED), caption: 'Rounding the windward mark', ...SENT, ...changes };
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const one of [value].flat()) {
      if (one instanceof Uint8Array) body.append(name, new Blob([one], { type: 'image/jpeg' }), `${name}.jpg`);
      else body.append(name, one);
    }
  }
  return body;
}

/** POST /api/upload through the whole chain. */
function send(env, { cookie, body, origin = SITE, headers = {}, duplex } = {}) {
  const all = { ...headers };
  if (origin !== null) all.Origin = origin;
  if (cookie) all.Cookie = `${COOKIE_NAME}=${cookie}`;
  const request = new Request(`${SITE}/api/upload`, { method: 'POST', headers: all, body, ...(duplex ? { duplex } : {}) });
  return chain([root, ...uploadGuard, upload], request, env);
}

const photoRows = (env) => env.DB.sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r }));
const countRows = (env) => env.DB.sqlite.prepare('SELECT * FROM upload_counts').all().map((r) => ({ ...r }));
const storedKeys = (env) => [...env.MEDIA.objects.keys()].sort();
// Uploads counted against the day's cap, across every session.
const sentToday = (env) => env.DB.sqlite.prepare('SELECT COALESCE(SUM(sent), 0) AS n FROM upload_counts').get().n;

// Waits for every put the route started to settle first: a leftover object
// exists only once its put has landed, which can be after the answer.
async function assertNothingStored(env, label) {
  await env.MEDIA.idle();
  assert.deepEqual(storedKeys(env), [], `${label}: objects left in the bucket`);
  assert.deepEqual(photoRows(env), [], `${label}: a row was written`);
}

/**
 * A body that counts how much of it was read, for a route that must refuse
 * before reading. highWaterMark 0: the default of 1 pulls once as soon as the
 * stream exists, which would count a read nobody made.
 */
function countingBody(bytes) {
  const read = { pulled: 0 };
  const stream = new ReadableStream({
    pull(controller) {
      read.pulled += bytes.length;
      controller.enqueue(bytes);
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { stream, read };
}

// ---- Criterion 1: a photo is stored, three objects and one pending row ---

test('a photo\'s three sizes from a live session into an open album: 201, three objects and one pending row', async () => {
  const { env, address, issued, cookie } = await site();
  const before = nowSeconds();
  const res = await send(env, { cookie, body: form(address) });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  const { id } = await res.json();

  const [row] = photoRows(env);
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  assert.equal(row.id, id);
  assert.match(row.media_key, /^[0-9a-f]{32}$/);
  assert.ok(row.sent_at >= before && row.sent_at <= nowSeconds());
  assert.deepEqual({ ...row, media_key: undefined, sent_at: undefined }, {
    id, album_id: albumId, kind: 'photo', state: 'pending', media_key: undefined, batch: BATCH,
    sender: 'parent', code_generation: 2, session_issued: issued, caption: 'Rounding the windward mark',
    captured_at: CAPTURED, sent_at: undefined, width: 2560, height: 1920, grid_width: 480, grid_height: 360,
    screen_width: 1600, screen_height: 1200, bytes: SENT.grid.length + SENT.screen.length + SENT.full.length,
    content_type: null, duration_ms: null, upload_id: null, approved_at: null, hidden_at: null, hidden_note: null,
  });

  const keys = photoObjectKeys(row.media_key);
  assert.deepEqual(storedKeys(env), Object.values(keys).sort());
  for (const size of Object.keys(SIZES)) {
    const object = env.MEDIA.objects.get(keys[size]);
    assert.equal(object.httpMetadata.contentType, 'image/jpeg', size);
    assert.deepEqual(object.body, SENT[size], `${size} is not the picture that was sent`);
  }
});

test('a photo sent with no caption, or a blank one, stores none', async () => {
  const { env, address, cookie } = await site();
  for (const caption of [undefined, '', '   ']) {
    assert.equal((await send(env, { cookie, body: form(address, { caption }) })).status, 201, String(caption));
  }
  assert.deepEqual(photoRows(env).map((r) => r.caption), [null, null, null]);
});

test('each photo gets its own id and its own random key', async () => {
  const { env, address, cookie } = await site();
  const first = await (await send(env, { cookie, body: form(address) })).json();
  const second = await (await send(env, { cookie, body: form(address) })).json();
  assert.notEqual(first.id, second.id);
  const [a, b] = photoRows(env);
  assert.notEqual(a.media_key, b.media_key);
  assert.equal(storedKeys(env).length, 6);
});

test('a deleted row\'s id is never given to a later photo', async () => {
  // AUTOINCREMENT: without it SQLite reuses the highest id once its row is
  // deleted, and a rejected photo's id (#156) would name the next one sent.
  const { env, address, cookie } = await site();
  const { id } = await (await send(env, { cookie, body: form(address) })).json();
  env.DB.sqlite.prepare('DELETE FROM photos WHERE id = ?').run(id);
  const next = await (await send(env, { cookie, body: form(address) })).json();
  assert.ok(next.id > id);
});

// ---- Criterion 2: no metadata segment is stored ---------------------------

const MOTION_VIDEO = new TextEncoder().encode('\0\0\0\x18ftypmp42 a motion photo keeps its clip here');
const tagged = (image) => withTrailer(withSegments(image, exif(), xmp(), ...otherMetadata()), MOTION_VIDEO);
// Tag 0x8825, type LONG, little-endian: exif() writes an 'II' TIFF, as
// iPhones and most Android phones do, so this is the byte order present.
const GPS_TAG_LE = [0x25, 0x88, 0x04, 0x00];

test('the fixture carries what a phone writes, so the scan below can see it', () => {
  // The control for the next test: every signature it looks for is there
  // before the upload.
  const image = tagged(SENT.full);
  assert.ok(find(image, 'Exif\0\0') > 0);
  assert.ok(find(image, GPS_TAG_LE) > 0);
  assert.ok(find(image, 'GPSLatitude') > 0);
  assert.ok(find(image, 'FictionCam') > 0);
  assert.ok(find(image, 'JFIF') > 0);
  assert.ok(find(image, 'ftypmp42') > 0);
  assert.deepEqual(metadataMarkers(image).sort(), ['e0', 'e1', 'e1', 'e2', 'ed', 'ef', 'fe']);
  assert.equal(find(SENT.full, 'Exif\0\0'), -1);
});

test('a JPEG whose APP1 holds EXIF with a GPS position is stored with no metadata segment, and the picture unchanged', async () => {
  const { env, address, cookie } = await site();
  const res = await send(env, {
    cookie,
    body: form(address, { grid: tagged(SENT.grid), screen: tagged(SENT.screen), full: tagged(SENT.full) }),
  });
  assert.equal(res.status, 201);
  const [row] = photoRows(env);
  const keys = photoObjectKeys(row.media_key);
  for (const size of Object.keys(SIZES)) {
    const stored = env.MEDIA.objects.get(keys[size]).body;
    assert.deepEqual(metadataMarkers(stored), [], `${size} kept an APPn or COM segment`);
    for (const needle of ['Exif\0\0', GPS_TAG_LE, 'GPSLatitude', 'FictionCam', 'JFIF', 'ICC_PROFILE', 'Photoshop', 'ftypmp42']) {
      assert.equal(find(stored, needle), -1, `${size} still holds ${needle}`);
    }
    assert.deepEqual(stored.subarray(-2), Uint8Array.of(0xff, 0xd9), `${size} does not end at its end-of-image marker`);
    // The compressed picture is copied as it came: stripping the fixture
    // gives back exactly the image it was built on.
    assert.deepEqual(stored, SENT[size], `${size} changed the picture`);
  }
  assert.equal(row.bytes, SENT.grid.length + SENT.screen.length + SENT.full.length);
});

// The walk itself, on the shapes a real encoder writes that the fixture's
// flat baseline image does not.

/** `image` with `bytes` spliced in at the first occurrence of `marker`. */
function spliceBefore(image, marker, ...parts) {
  const at = find(image, [0xff, marker]);
  assert.ok(at > 0, `no ${marker.toString(16)} marker`);
  return Uint8Array.from([...image.subarray(0, at), ...parts.flatMap((p) => [...p]), ...image.subarray(at)]);
}

test('metadata between the tables, or between two scans, is dropped too', () => {
  const base = SENT.grid;
  const midway = spliceBefore(base, 0xc0, exif(), segment(0xfe, new TextEncoder().encode('note')));
  assert.deepEqual(readJpeg(midway).clean, base);

  // A progressive file's shape: a second table and scan after the first, with
  // an APP1 between them.
  const eoi = base.length - 2;
  const firstScan = base.subarray(0, eoi);
  const table = base.subarray(find(base, [0xff, 0xc4]), find(base, [0xff, 0xda]));
  const scan = base.subarray(find(base, [0xff, 0xda]), eoi);
  const twoScans = Uint8Array.from([...firstScan, ...exif(), ...table, ...scan, 0xff, 0xd9]);
  const read = readJpeg(twoScans);
  assert.deepEqual(read.clean, Uint8Array.from([...firstScan, ...table, ...scan, 0xff, 0xd9]));
  assert.equal(find(read.clean, 'Exif\0\0'), -1);
});

test('compressed data keeps its stuffed 0xFF00 and restart markers, and fill bytes before a marker are allowed', () => {
  const base = SENT.grid;
  const sos = find(base, [0xff, 0xda]);
  const dataAt = sos + 2 + ((base[sos + 2] << 8) | base[sos + 3]);
  // Data holding a stuffed 0xFF, a restart marker and a fill run before EOI.
  const data = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff];
  const image = Uint8Array.from([...base.subarray(0, dataAt), ...data, 0xff, 0xd9]);
  const read = readJpeg(image);
  assert.equal(read.error, undefined);
  assert.deepEqual(read.clean, image);

  const filled = Uint8Array.from([...base.subarray(0, 2), 0xff, 0xff, ...base.subarray(2)]);
  assert.deepEqual(readJpeg(filled).clean, base);
});

test('a greyscale JPEG is taken, and a lossless, arithmetic, 12-bit or four-colour one is not', () => {
  assert.equal(readJpeg(jpeg({ width: 40, height: 30, components: 1 })).width, 40);
  const base = jpeg({ width: 40, height: 30 });
  const sof = find(base, [0xff, 0xc0]);
  const variant = (at, value) => {
    const copy = Uint8Array.from(base);
    copy[at] = value;
    return readJpeg(copy).error;
  };
  assert.equal(variant(sof + 1, 0xc3), 'not-jpeg', 'lossless');
  assert.equal(variant(sof + 1, 0xc9), 'not-jpeg', 'arithmetic');
  assert.equal(variant(sof + 4, 12), 'not-jpeg', '12-bit');
  assert.equal(variant(sof + 1, 0xc2), undefined, 'progressive');
  assert.equal(variant(sof + 1, 0xc1), undefined, 'extended');
  // A four-colour frame with all four component entries, so only the
  // component rule can refuse it, not a frame too short for its count.
  assert.equal(readJpeg(jpeg({ width: 40, height: 30, components: 4 })).error, 'not-jpeg', 'CMYK');
  assert.equal(readJpeg(jpeg({ width: 40, height: 30, components: 2 })).error, 'not-jpeg', 'two components');
  // A frame that says three components and carries one component's entry,
  // its length set to match what it carries.
  const short = segment(0xc0, Uint8Array.of(8, 0, 30, 0, 40, 3, 1, 0x11, 0));
  const end = find(base, [0xff, 0xc4]);
  const cut = Uint8Array.from([...base.subarray(0, sof), ...short, ...base.subarray(end)]);
  assert.equal(readJpeg(cut).error, 'not-jpeg', 'a frame shorter than its component count');
});

test('a JPEG whose segments are out of order or missing is malformed', () => {
  const base = SENT.grid;
  const at = (marker) => find(base, [0xff, marker]);
  const sof = base.subarray(at(0xc0), at(0xc4));
  const tables = base.subarray(at(0xc4), at(0xda));
  const scan = base.subarray(at(0xda), base.length - 2);
  const dqt = base.subarray(at(0xdb), at(0xc0));
  const build = (...parts) => Uint8Array.from([0xff, 0xd8, ...parts.flatMap((p) => [...p]), 0xff, 0xd9]);
  // The control: the same parts in the right order read as the image.
  assert.deepEqual(readJpeg(build(dqt, sof, tables, scan)).clean, base);
  // A marker that takes no length is followed here by 00 02, which would read
  // as an empty segment, so only the rule refusing that marker can refuse it.
  const lengthless = (marker) => [0xff, marker, 0x00, 0x02];
  const cases = {
    'a scan before its frame, and the frame after': build(dqt, tables, scan, sof, scan),
    'two frames': build(dqt, sof, sof, tables, scan),
    'a frame with no scan': build(dqt, sof, tables),
    'a restart marker between segments': build(dqt, lengthless(0xd0), sof, tables, scan),
    'a second start of image': build(dqt, lengthless(0xd8), sof, tables, scan),
    'a stuffed 0xFF00 where a marker belongs': build(dqt, lengthless(0x00), sof, tables, scan),
    'a TEM marker between segments': build(dqt, lengthless(0x01), sof, tables, scan),
    'a zero-length segment': build(dqt, [0xff, 0xe1, 0x00, 0x00], sof, tables, scan),
    'a segment running past the end': build(dqt, [0xff, 0xe1, 0xff, 0xf0], sof, tables, scan),
    // Lengths on segments that are kept, where the walk cannot drop them
    // and refuse the file for another reason on its next pass.
    'a scan header of length 0': build(dqt, sof, tables, [0xff, 0xda, 0, 0, ...scan.subarray(4)]),
    'a scan header of length 1': build(dqt, sof, tables, [0xff, 0xda, 0, 1, ...scan.subarray(4)]),
    'a frame header of length 0': build(dqt, [0xff, 0xc0, 0, 0, ...sof.subarray(4)], tables, scan),
  };
  for (const [name, image] of Object.entries(cases)) {
    assert.equal(readJpeg(image).error, 'malformed', name);
  }
  const flat = Uint8Array.from([...sof.subarray(0, 5), 0, 0, ...sof.subarray(7)]);
  assert.equal(readJpeg(build(dqt, flat, tables, scan)).error, 'not-jpeg', 'a frame 0 pixels tall');
  const narrow = Uint8Array.from([...sof.subarray(0, 7), 0, 0, ...sof.subarray(9)]);
  assert.equal(readJpeg(build(dqt, narrow, tables, scan)).error, 'not-jpeg', 'a frame 0 pixels wide');
});

// ---- Criterion 3: what is not a JPEG within its caps is refused ----------

const SIZE_NAMES = Object.keys(SIZES);

test('a PNG renamed .jpg is refused 415, whichever size it is, and nothing is stored', async () => {
  const { env, address, cookie } = await site();
  const png = Uint8Array.from([...PNG_SIGNATURE, ...new Array(64).fill(7)]);
  for (const size of SIZE_NAMES) {
    const res = await send(env, { cookie, body: form(address, { [size]: png }) });
    assert.equal(res.status, 415, size);
    assert.deepEqual(await res.json(), { error: 'not-jpeg', size });
  }
  await assertNothingStored(env, 'png');
  assert.deepEqual(countRows(env), [], 'a refused upload spent the cap');
});

test('a truncated JPEG is refused 400, however it was cut, and nothing is stored', async () => {
  const { env, address, cookie } = await site();
  const cuts = {
    'half the file': (b) => b.subarray(0, Math.floor(b.length / 2)),
    'no end-of-image marker': (b) => b.subarray(0, b.length - 2),
    'inside a segment header': (b) => b.subarray(0, find(b, [0xff, 0xc0]) + 3),
    'the start of image alone': (b) => b.subarray(0, 4),
  };
  for (const size of SIZE_NAMES) {
    for (const [name, cut] of Object.entries(cuts)) {
      const res = await send(env, { cookie, body: form(address, { [size]: cut(SENT[size]) }) });
      assert.equal(res.status, 400, `${size}, ${name}`);
      assert.deepEqual(await res.json(), { error: 'malformed', size }, `${size}, ${name}`);
    }
  }
  await assertNothingStored(env, 'truncated');
});

test('a JPEG one pixel past its size\'s long edge is refused 413, wide or tall, and one at it is taken', async () => {
  const { env, address, cookie } = await site();
  for (const [size, cap] of Object.entries(SIZES)) {
    for (const over of [jpeg({ width: cap.longEdge + 1, height: 10 }), jpeg({ width: 10, height: cap.longEdge + 1 })]) {
      const res = await send(env, { cookie, body: form(address, { [size]: over }) });
      assert.equal(res.status, 413, size);
      assert.deepEqual(await res.json(), { error: 'too-large', size });
    }
  }
  await assertNothingStored(env, 'long edge');
  // One portrait picture at each size's cap: 360x480, 1200x1600, 1920x2560.
  const atCaps = Object.fromEntries(Object.entries(SIZES).map(([size, cap]) => [size, jpeg({ width: cap.longEdge * 3 / 4, height: cap.longEdge })]));
  assert.equal((await send(env, { cookie, body: form(address, atCaps) })).status, 201);
});

/** `image` padded to exactly `total` bytes with comment segments after its start. */
function padTo(image, total) {
  const pads = [];
  let remaining = total - image.length;
  assert.ok(remaining >= 4);
  while (remaining > 0) {
    let size = Math.min(remaining, 65537);
    if (remaining - size > 0 && remaining - size < 4) size -= 4;
    pads.push(segment(0xfe, new Uint8Array(size - 4)));
    remaining -= size;
  }
  const out = withSegments(image, ...pads);
  assert.equal(out.length, total);
  return out;
}

test('a JPEG one byte past its size\'s file cap is refused 413, and one at the cap is taken', async () => {
  const { env, address, cookie } = await site();
  for (const [size, cap] of Object.entries(SIZES)) {
    const res = await send(env, { cookie, body: form(address, { [size]: padTo(SENT[size], cap.maxBytes + 1) }) });
    assert.equal(res.status, 413, size);
    assert.deepEqual(await res.json(), { error: 'too-large', size });
  }
  await assertNothingStored(env, 'file size');
  const atCaps = Object.fromEntries(Object.entries(SIZES).map(([size, cap]) => [size, padTo(SENT[size], cap.maxBytes)]));
  assert.equal((await send(env, { cookie, body: form(address, atCaps) })).status, 201);
  // The padding was comment segments, so what is stored is the picture alone.
  const [row] = photoRows(env);
  assert.deepEqual(env.MEDIA.objects.get(photoObjectKeys(row.media_key).full).body, SENT.full);
});

test('the caps are CLAUDE.md item 9\'s table, and the body cap is theirs plus at most 64 KiB of framing', () => {
  // Written out, not read from SIZES: the tests above build their inputs
  // from the caps, so only this one fails when a cap is copied wrong.
  assert.deepEqual(SIZES, {
    grid: { longEdge: 480, maxBytes: 153_600 },
    screen: { longEdge: 1600, maxBytes: 1_048_576 },
    full: { longEdge: 2560, maxBytes: 3_145_728 },
  });
  const files = 153_600 + 1_048_576 + 3_145_728;
  assert.ok(MAX_UPLOAD_BYTES > files, `${MAX_UPLOAD_BYTES} leaves no room for the form's framing`);
  assert.ok(MAX_UPLOAD_BYTES <= files + 64 * 1024, `${MAX_UPLOAD_BYTES} lets a body far past the three files through`);
});

test('a body past every cap together is refused 413 before it is parsed, by its length or as it arrives', async () => {
  const { env, cookie } = await site();
  const declared = await send(env, {
    cookie, body: 'x', headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(MAX_UPLOAD_BYTES + 1) },
  });
  assert.equal(declared.status, 413);
  assert.deepEqual(await declared.json(), { error: 'too-large' });

  // No Content-Length: a stream that keeps coming is cut off at the cap.
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024);
  const stream = new ReadableStream({
    pull(controller) {
      pulled += chunk.length;
      controller.enqueue(chunk);
    },
  });
  const streamed = await send(env, { cookie, body: stream, duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } });
  assert.equal(streamed.status, 413);
  assert.ok(pulled <= MAX_UPLOAD_BYTES + 2 * chunk.length, `read ${pulled} bytes of a body it had refused`);
  await assertNothingStored(env, 'body');
});

test('a body that is not the form, or a field missing, repeated, or not what it should be: 400', async () => {
  const { env, address, cookie } = await site();
  const cases = {
    'a JSON body': [{ body: JSON.stringify({ album: address }), headers: { 'Content-Type': 'application/json' } }, 'form'],
    'no body': [{ headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }, 'form'],
    'no album': [{ body: form(address, { album: undefined }) }, 'form'],
    'no full size': [{ body: form(address, { full: undefined }) }, 'form'],
    'the full size as text': [{ body: form(address, { full: 'a photo' }) }, 'form'],
    'two full sizes': [{ body: form(address, { full: [SENT.full, SENT.full] }) }, 'form'],
    'two albums': [{ body: form(address, { album: [address, address] }) }, 'form'],
    'the album as a file': [{ body: form(address, { album: SENT.grid }) }, 'form'],
    'no batch': [{ body: form(address, { batch: undefined }) }, 'batch'],
    'a batch that is not a UUID': [{ body: form(address, { batch: 'batch-1' }) }, 'batch'],
    'an upper-case UUID': [{ body: form(address, { batch: BATCH.toUpperCase() }) }, 'batch'],
    'no capture time': [{ body: form(address, { captured: undefined }) }, 'captured'],
    'a capture time as a date': [{ body: form(address, { captured: '2026-09-28T10:00:00Z' }) }, 'captured'],
    'a negative capture time': [{ body: form(address, { captured: '-1' }) }, 'captured'],
    'a capture time past 9999': [{ body: form(address, { captured: '253402300800' }) }, 'captured'],
    'a caption sent as a file': [{ body: form(address, { caption: SENT.grid }) }, 'caption'],
  };
  for (const [name, [options, error]] of Object.entries(cases)) {
    const res = await send(env, { cookie, ...options });
    assert.equal(res.status, 400, name);
    assert.deepEqual(await res.json(), { error }, name);
  }
  await assertNothingStored(env, 'form');
  // The control: the same form with nothing changed is taken.
  assert.equal((await send(env, { cookie, body: form(address) })).status, 201);
  // And the capture time's two ends are taken, the last second of 9999
  // among them, as stored.
  for (const captured of ['0', '253402300799']) {
    assert.equal((await send(env, { cookie, body: form(address, { captured }) })).status, 201, captured);
  }
  assert.deepEqual(photoRows(env).map((r) => r.captured_at), [CAPTURED, 0, 253_402_300_799]);
});

test('three sizes that are not one picture\'s shape are refused 400, and nothing is stored', async () => {
  const { env, address, cookie } = await site();
  const cases = {
    'a grid larger than the screen size': { grid: jpeg({ width: 480, height: 360 }), screen: jpeg({ width: 400, height: 300 }) },
    'a screen size larger than the full': { screen: jpeg({ width: 1600, height: 1200 }), full: jpeg({ width: 1200, height: 900 }) },
    'a portrait grid for a landscape photo': { grid: jpeg({ width: 360, height: 480 }) },
    'a screen size of another shape': { screen: jpeg({ width: 1600, height: 900 }) },
    'a full size a few pixels off its shape': { full: jpeg({ width: 2560, height: 1900 }) },
  };
  for (const [name, changes] of Object.entries(cases)) {
    const res = await send(env, { cookie, body: form(address, changes) });
    assert.equal(res.status, 400, name);
    assert.deepEqual(await res.json(), { error: 'sizes' }, name);
  }
  await assertNothingStored(env, 'sizes');
  assert.equal(sentToday(env), 0, 'a refusal spent the cap');
  // The controls: a photo whose sizes the browser rounded, and a photo too
  // small to scale, whose three sizes are one and the same.
  const rounded = { grid: jpeg({ width: 480, height: 320 }), screen: jpeg({ width: 1600, height: 1067 }), full: jpeg({ width: 2560, height: 1707 }) };
  assert.equal((await send(env, { cookie, body: form(address, rounded) })).status, 201, 'rounded');
  const small = jpeg({ width: 400, height: 300 });
  assert.equal((await send(env, { cookie, body: form(address, { grid: small, screen: small, full: small }) })).status, 201, 'small');
});

test('sizesAgree allows a pixel of rounding on each side and no more', () => {
  const size = (width, height) => ({ width, height });
  const full = size(2560, 1920);
  const screen = size(1600, 1200);
  assert.equal(sizesAgree({ grid: size(480, 360), screen, full }), true);
  assert.equal(sizesAgree({ grid: size(480, 361), screen, full }), true, 'one pixel of rounding');
  assert.equal(sizesAgree({ grid: size(480, 359), screen, full }), true, 'one pixel the other way');
  assert.equal(sizesAgree({ grid: size(480, 364), screen, full }), false, 'four pixels');
  assert.equal(sizesAgree({ grid: size(480, 360), screen: size(1600, 1206), full }), false, 'six pixels on the screen size');
  assert.equal(sizesAgree({ grid: size(2560, 1920), screen: size(2560, 1920), full }), true, 'all three the same');
  assert.equal(sizesAgree({ grid: size(2561, 1921), screen, full }), false, 'grid larger than the rest');
});

// ---- Criterion 4: no session, a rotated one, a foreign Origin, a closed album

test('no session, a rotated session, a foreign Origin, a closed album and an unknown album: 401, 401, 403, 409 and 409, and nothing stored', async () => {
  const { env, address, cookie } = await site();
  const earlier = await signSession(KEY, 1, nowSeconds());

  assert.equal((await send(env, { body: form(address) })).status, 401, 'no session');
  assert.equal((await send(env, { cookie: earlier, body: form(address) })).status, 401, 'an earlier code\'s session');
  for (const origin of ['https://evil.example', 'https://madcowsailing.com', null]) {
    const res = await send(env, { cookie, body: form(address), origin });
    assert.equal(res.status, 403, String(origin));
    assert.deepEqual(await res.json(), { error: 'origin' });
  }
  for (const album of ['2026-10-05-nothing-here', 'not an address', '']) {
    const res = await send(env, { cookie, body: form(address, { album }) });
    assert.equal(res.status, 409, album);
    assert.deepEqual(await res.json(), { error: 'album' });
  }
  env.DB.sqlite.prepare('UPDATE albums SET closed_at = ? WHERE address = ?').run(nowSeconds(), address);
  assert.equal((await send(env, { cookie, body: form(address) })).status, 409, 'a closed album');

  // Rotating the code (#152) ends the session that was live a moment ago.
  env.DB.sqlite.prepare('UPDATE albums SET closed_at = NULL WHERE address = ?').run(address);
  env.DB.sqlite.prepare('INSERT INTO invite_codes (generation, code, created_at) VALUES (3, ?, ?)').run('ZZZZ-ZZZZ-ZZZZ', nowSeconds());
  assert.equal((await send(env, { cookie, body: form(address) })).status, 401, 'a rotated session');

  await assertNothingStored(env, 'refusals');
  assert.deepEqual(countRows(env), []);
});

test('an album closed or deleted while the photo was being sent takes nothing, and its objects are deleted again', async () => {
  for (const [name, sql] of [
    ['closed', 'UPDATE albums SET closed_at = 1 WHERE address = ?'],
    ['deleted', 'DELETE FROM albums WHERE address = ?'],
  ]) {
    const { env, address, cookie } = await site();
    // The race: the album goes between the route's check and its insert.
    const prepare = env.DB.prepare;
    env.DB.prepare = (text) => {
      if (/^INSERT INTO photos/.test(text)) env.DB.sqlite.prepare(sql).run(address);
      return prepare(text);
    };
    const res = await send(env, { cookie, body: form(address) });
    assert.equal(res.status, 409, name);
    assert.deepEqual(await res.json(), { error: 'album' });
    await assertNothingStored(env, name);
    assert.equal(sentToday(env), 0, `${name}: a photo not stored still counts against the cap`);
  }
});

// ---- Criterion 5: the caption ---------------------------------------------

test('a caption over 200 characters, or holding a line break anywhere, is refused 400', async () => {
  const { env, address, cookie } = await site();
  const separators = String.fromCharCode(0x2028, 0x2029);
  const wave = String.fromCodePoint(0x1f30a);
  for (const caption of [
    'x'.repeat(201), `${'x'.repeat(199)}${wave}${wave}`, 'Mark\nrounding', 'Mark\r\nrounding', 'Mark\rrounding',
    `Mark${separators[0]}rounding`, `Mark${separators[1]}rounding`, 'Mark rounding\n', '\nMark rounding', 'Mark\trounding',
    `Mark${String.fromCharCode(0x85)}rounding`,
  ]) {
    const res = await send(env, { cookie, body: form(address, { caption }) });
    assert.equal(res.status, 400, JSON.stringify(caption));
    assert.deepEqual(await res.json(), { error: 'caption' });
  }
  await assertNothingStored(env, 'caption');
});

test('a caption of 200 characters is stored, counted as the table counts them, spaces round it trimmed', async () => {
  const { env, address, cookie } = await site();
  // The wave is outside the Basic Multilingual Plane: one character, two
  // UTF-16 code units, as most emoji are. 190 letters and 10 waves make 200
  // characters and 210 code units.
  const wave = String.fromCodePoint(0x1f30a);
  const emoji = `${'x'.repeat(190)}${wave.repeat(10)}`;
  assert.equal([...emoji].length, 200);
  assert.equal(emoji.length, 210);
  for (const caption of ['y'.repeat(200), `   ${'z'.repeat(200)}   `, emoji]) {
    assert.equal((await send(env, { cookie, body: form(address, { caption }) })).status, 201, JSON.stringify(caption).slice(0, 40));
  }
  const stored = photoRows(env).map((r) => r.caption);
  assert.deepEqual(stored, ['y'.repeat(200), 'z'.repeat(200), emoji]);
  assert.equal(env.DB.sqlite.prepare('SELECT length(caption) AS n FROM photos WHERE id = 3').get().n, 200);
});

test('a caption holding markup is stored as the text it is', async () => {
  const { env, address, cookie } = await site();
  const caption = '<img src=x onerror=alert(1)> & "Co" \'s <b>win</b>';
  assert.equal((await send(env, { cookie, body: form(address, { caption: `  ${caption} ` }) })).status, 201);
  assert.equal(photoRows(env)[0].caption, caption);
});

// ---- Criterion 6: the daily cap --------------------------------------------

// A fixed clock mid-way through a UTC day, so no test runs across midnight.
const NOON = 1_790_000_000; // 2026-09-21T14:13:20Z
const day = (seconds) => Math.floor(seconds / 86_400);

test('the cap is the owner\'s 500 a session a UTC day', () => {
  // Owner's choice at #154's pickup, 2026-09-29, confirming the story's 500.
  // Written out, since the test below seeds the count and would pass at any cap.
  assert.equal(DAILY_UPLOADS, 500);
});

test('a session that has sent 500 today is refused 429 until the next UTC day; another session, and yesterday, are not', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOON * 1000 });
  const { env, address, issued, cookie } = await site();
  const mine = sessionKey({ generation: 2, issued });
  env.DB.sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, ?)').run(mine, day(NOON), 499);

  assert.equal((await send(env, { cookie, body: form(address) })).status, 201, 'the 500th');
  const refused = await send(env, { cookie, body: form(address) });
  assert.equal(refused.status, 429, 'the 501st');
  assert.deepEqual(await refused.json(), { error: 'daily-cap' });
  assert.equal(refused.headers.get('Retry-After'), String(secondsToNextDay(NOON)));
  assert.equal(Number(refused.headers.get('Retry-After')), (day(NOON) + 1) * 86_400 - NOON);
  assert.equal(photoRows(env).length, 1, 'the refused upload wrote a row');
  assert.equal(storedKeys(env).length, 3, 'the refused upload stored objects');

  // Another parent's session is not held to this one's count.
  const other = await signSession(KEY, 2, issued - 60);
  assert.equal((await send(env, { cookie: other, body: form(address) })).status, 201, 'another session');

  // The next UTC day, the same session sends again.
  t.mock.timers.setTime((NOON + secondsToNextDay(NOON)) * 1000);
  assert.equal((await send(env, { cookie, body: form(address) })).status, 201, 'the next day');
});

test('the cap is spent in one statement, so the last upload cannot be taken twice, and earlier days are cleared', async () => {
  const db = d1();
  const session = { generation: 2, issued: 1_789_999_000 };
  db.sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, ?)').run(sessionKey(session), day(NOON) - 1, 7);
  db.sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, ?)').run('9.1', day(NOON) - 2, 3);

  assert.equal(await spendDailyUpload(db, session, NOON), true);
  assert.deepEqual(countRows({ DB: db }), [{ session: sessionKey(session), day: day(NOON), sent: 1 }], 'earlier days were kept');

  db.sqlite.prepare('UPDATE upload_counts SET sent = ?').run(DAILY_UPLOADS - 1);
  const both = await Promise.all([spendDailyUpload(db, session, NOON), spendDailyUpload(db, session, NOON)]);
  assert.deepEqual(both, [true, false]);
  assert.equal(countRows({ DB: db })[0].sent, DAILY_UPLOADS);
  assert.equal(await spendDailyUpload(db, session, NOON), false);
  assert.equal(countRows({ DB: db })[0].sent, DAILY_UPLOADS, 'a refusal wrote to the count');

  // A unit given back after a failure frees the last one again, and giving
  // back never takes the count below 0 or touches another day or session.
  await refundDailyUpload(db, session, NOON);
  assert.equal(countRows({ DB: db })[0].sent, DAILY_UPLOADS - 1);
  assert.equal(await spendDailyUpload(db, session, NOON), true);
  db.sqlite.prepare('UPDATE upload_counts SET sent = 0').run();
  await refundDailyUpload(db, session, NOON);
  assert.equal(countRows({ DB: db })[0].sent, 0, 'a refund took the count below 0');
  // With units to give back, another session's refund and tomorrow's
  // refund leave this row alone.
  db.sqlite.prepare('UPDATE upload_counts SET sent = 5').run();
  await refundDailyUpload(db, { generation: 3, issued: 1 }, NOON);
  await refundDailyUpload(db, session, NOON + 86_400);
  assert.deepEqual(countRows({ DB: db }), [{ session: sessionKey(session), day: day(NOON), sent: 5 }]);
});

test('a failure clearing earlier days\' counts does not fail the upload', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const { env, address, cookie } = await site();
  const prepare = env.DB.prepare;
  env.DB.prepare = (text) => {
    if (/^DELETE FROM upload_counts/.test(text)) throw new Error('D1_ERROR: the database did not answer');
    return prepare(text);
  };
  const res = await send(env, { cookie, body: form(address) });
  assert.equal(res.status, 201);
  assert.equal(photoRows(env).length, 1);
  assert.equal(sentToday(env), 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not clear the counts of earlier days/);
});

// ---- Failures after the checks leave nothing behind ------------------------

test('a bucket that fails partway: 503, no row, nothing left in the bucket, and the unit given back', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const failing of SIZE_NAMES) {
    const { env, address, cookie } = await site();
    // The failing put rejects at once while the others are still landing
    // (test/r2.js), so a route that stopped waiting at the first failure
    // would delete before they landed and leave them behind.
    env.MEDIA = r2({ failPut: (key) => key.endsWith(`/${failing}.jpg`) });
    const res = await send(env, { cookie, body: form(address) });
    assert.equal(res.status, 503, failing);
    assert.deepEqual(await res.json(), { error: 'unavailable' });
    assert.equal(env.MEDIA.puts.length, 3, `${failing}: not every size was put`);
    // Only once every put has settled can "nothing left" be read.
    await env.MEDIA.idle();
    await assertNothingStored(env, failing);
    assert.equal(sentToday(env), 0, `${failing}: a photo not stored still counts against the cap`);
  }
});

test('a cleanup the bucket also refuses logs where the objects were left', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const { env, address, cookie } = await site();
  env.MEDIA = r2({ failPut: (key) => key.endsWith('/full.jpg'), failDelete: true });
  assert.equal((await send(env, { cookie, body: form(address) })).status, 503);
  await env.MEDIA.idle();
  const left = storedKeys(env);
  assert.equal(left.length, 2, 'the two sizes that landed are still there');
  const prefix = left[0].slice(0, left[0].lastIndexOf('/') + 1);
  assert.match(prefix, /^photos\/[0-9a-f]{32}\/$/);
  assert.ok(errors.some((line) => line.includes(prefix)), `no log names ${prefix}: ${errors.join(' | ')}`);
});

test('a database that fails on the insert: 503, and the objects are deleted again', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, address, cookie } = await site();
  const prepare = env.DB.prepare;
  env.DB.prepare = (text) => {
    if (/^INSERT INTO photos/.test(text)) throw new Error('D1_ERROR: the database did not answer');
    return prepare(text);
  };
  const res = await send(env, { cookie, body: form(address) });
  assert.equal(res.status, 503);
  await assertNothingStored(env, 'insert failure');
  assert.equal(sentToday(env), 0, 'a photo not stored still counts against the cap');
});

test('no bucket or no database bound: 503, closed, before any of the body is read', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, address } = await site();
  // Straight to the route, past the session guard, which reads the database
  // itself. Without the binding check, a missing database would still end
  // in a 503 once openAlbum threw, but only after the body was read and
  // parsed; the body's own count is what tells the two apart.
  // One encoding, so the body and its boundary in Content-Type agree.
  const encoding = new Response(form(address));
  const type = encoding.headers.get('Content-Type');
  const encoded = new Uint8Array(await encoding.arrayBuffer());
  for (const [name, changes] of [['no bucket', { MEDIA: undefined }], ['no database', { DB: undefined }]]) {
    const { stream, read } = countingBody(encoded);
    const request = new Request(`${SITE}/api/upload`, {
      method: 'POST', body: stream, duplex: 'half', headers: { Origin: SITE, 'Content-Type': type },
    });
    const res = await chain([upload], request, { ...env, ...changes });
    assert.equal(res.status, 503, name);
    assert.deepEqual(await res.json(), { error: 'unavailable' }, name);
    assert.equal(read.pulled, 0, `${name}: the body was read`);
  }
  await assertNothingStored(env, 'unbound');
  // The control: the same kind of body, with both bindings and a session,
  // is read and stored, so a count of 0 above is the route not reading.
  const { stream, read } = countingBody(encoded);
  const cookie = await signSession(KEY, 2, nowSeconds());
  const res = await send(env, { cookie, body: stream, duplex: 'half', headers: { 'Content-Type': type } });
  assert.equal(res.status, 201);
  assert.equal(read.pulled, encoded.length);
});

// ---- Criterion 7: one migration carries every state -------------------------

// Whether a migration's SQL makes or changes the photos table or one of its
// indexes, comments aside. A later table that only references photos, as
// #158's removal log might, does not change it.
const PHOTOS = String.raw`["\x60\[]?photos["\x60\]]?(?!\w)`;
const TOUCHES_PHOTOS = [
  new RegExp(String.raw`\b(?:TABLE|INTO|FROM|UPDATE|ON)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?${PHOTOS}`, 'i'),
  new RegExp(String.raw`\bINDEX\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["\x60\[]?photos_`, 'i'),
];
const touchesPhotos = (sql) => {
  const code = sql.replace(/--[^\n]*/g, '');
  return TOUCHES_PHOTOS.some((pattern) => pattern.test(code));
};

test('one migration makes the photos table, and no other touches it', () => {
  const files = readdirSync(MIGRATIONS).sort();
  const touching = files.filter((file) => touchesPhotos(readFileSync(new URL(file, MIGRATIONS), 'utf8')));
  assert.deepEqual(touching, ['0005_photos.sql']);
});

test('the check above sees every way a later migration could change the table', () => {
  for (const sql of [
    'CREATE TABLE photos (id INTEGER)', 'ALTER TABLE photos ADD COLUMN x TEXT', 'ALTER TABLE "photos" ADD COLUMN x TEXT',
    'ALTER TABLE `photos` RENAME COLUMN a TO b', 'CREATE INDEX photos_by_x ON photos (x)', 'CREATE INDEX x ON [photos] (x)',
    'CREATE INDEX IF NOT EXISTS photos_by_y ON "photos" (y)', 'DROP INDEX photos_by_state', 'UPDATE photos SET x = 1',
    'DELETE FROM photos', 'INSERT INTO photos (id) VALUES (1)', 'CREATE TRIGGER t AFTER INSERT ON photos BEGIN SELECT 1; END',
    'DROP TABLE IF EXISTS photos',
  ]) {
    assert.equal(touchesPhotos(sql), true, sql);
  }
  for (const sql of [
    'CREATE TABLE photo_tags (id INTEGER)', 'CREATE TABLE removals (photo_id INTEGER REFERENCES photos (id))',
    '-- ALTER TABLE photos ADD COLUMN x, in a comment only\nSELECT 1;', 'CREATE TABLE photos_archive (id INTEGER)',
  ]) {
    assert.equal(touchesPhotos(sql), false, sql);
  }
});

/** A photos row with every required column, and `changes` on top. */
function insertRow(sqlite, changes = {}) {
  const albumId = sqlite.prepare('SELECT id FROM albums').get().id;
  const row = {
    album_id: albumId, kind: 'photo', state: 'pending', media_key: `k${Math.random()}`, batch: BATCH,
    sender: 'parent', code_generation: 2, session_issued: 1, captured_at: 1, sent_at: 1, width: 2560, height: 1920,
    grid_width: 480, grid_height: 360, screen_width: 1600, screen_height: 1200, bytes: 10, ...changes,
  };
  const names = Object.keys(row);
  sqlite.prepare(`INSERT INTO photos (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...Object.values(row));
}

test('the table holds every state the epic needs, and refuses a row no story should write', async () => {
  const { env } = await site();
  const { sqlite } = env.DB;
  const clip = { kind: 'clip', grid_width: null, grid_height: null, screen_width: null, screen_height: null };
  const allowed = {
    'a pending photo': {},
    'an approved photo (#156)': { state: 'approved', approved_at: 5 },
    'a hidden photo with its note (#158)': { state: 'hidden', approved_at: 5, hidden_at: 6, hidden_note: 'please take this down' },
    'a clip still uploading (#198)': { ...clip, state: 'uploading', content_type: 'video/mp4', upload_id: 'u1', duration_ms: 90_000 },
    'a clip still uploading, nothing about it checked yet (#198)': {
      ...clip, state: 'uploading', upload_id: 'u2', captured_at: null, width: null, height: null, bytes: null,
    },
    'a pending clip': { ...clip, content_type: 'video/quicktime', duration_ms: 180_000 },
    'a coach\'s upload, with no code behind it (#192)': { sender: 'coach', code_generation: null, session_issued: null },
    'a caption of 200 characters': { caption: 'c'.repeat(200) },
  };
  for (const [name, changes] of Object.entries(allowed)) {
    assert.doesNotThrow(() => insertRow(sqlite, changes), name);
  }
  const refused = {
    'a photo still uploading': { state: 'uploading' },
    'a rejected state, which is a delete instead': { state: 'rejected' },
    'an approved photo with no time': { state: 'approved' },
    'a hidden photo with no hidden time': { state: 'hidden', approved_at: 5 },
    'a hidden photo never approved': { state: 'hidden', hidden_at: 6 },
    'a parent\'s photo with no code generation': { code_generation: null },
    'a parent\'s photo with no session': { session_issued: null },
    'a photo with no grid width': { grid_width: null },
    'a photo with no grid height': { grid_height: null },
    'a photo with no screen width': { screen_width: null },
    'a photo with no screen height': { screen_height: null },
    'a photo with a clip\'s duration': { duration_ms: 1000 },
    'a photo with a clip\'s upload id': { upload_id: 'u1' },
    'a photo with a clip\'s content type': { content_type: 'video/mp4' },
    'a photo with no capture time': { captured_at: null },
    'a photo with no width': { width: null },
    'a photo with no height': { height: null },
    'a photo with no byte count': { bytes: null },
    'a pending clip with no frame size': { ...clip, content_type: 'video/mp4', width: null },
    'an approved clip with no capture time': { ...clip, state: 'approved', approved_at: 5, captured_at: null },
    'an empty caption, which is no caption': { caption: '' },
    'a caption over 200': { caption: 'c'.repeat(201) },
    'a note over 500': { state: 'hidden', approved_at: 5, hidden_at: 6, hidden_note: 'n'.repeat(501) },
    'an unknown sender': { sender: 'someone' },
    'an unknown kind': { kind: 'gif' },
    'a zero width': { width: 0 },
    'a zero height': { height: 0 },
    'a negative byte count': { bytes: -1 },
    'an album that does not exist': { album_id: 999 },
  };
  for (const [name, changes] of Object.entries(refused)) {
    assert.throws(() => insertRow(sqlite, changes), /constraint failed/, name);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM photos').get().n, Object.keys(allowed).length);
});

// ---- Criterion 8: the album-delete refusal, against the real table ---------

test('an album holding a photo sent through this route is not deleted, and the admin page says how many', async () => {
  const { env, address, cookie } = await site();
  assert.equal((await send(env, { cookie, body: form(address) })).status, 201);

  const press = async () => {
    const request = new Request(`${SITE}/api/admin/albums/delete`, {
      method: 'POST',
      headers: { Origin: SITE, [TOKEN_HEADER]: await mint(team), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ address }).toString(),
    });
    const res = await chain([root, ...adminApi, deleteAlbum], request, env);
    assert.equal(res.status, 303);
    return Object.fromEntries(new URL(res.headers.get('Location'), SITE).searchParams);
  };
  assert.deepEqual(await press(), { error: 'not-empty', album: address, photos: '1' });

  // Every state counts: approve the first, hide a second, leave a third pending.
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5").run();
  assert.equal((await send(env, { cookie, body: form(address) })).status, 201);
  assert.equal((await send(env, { cookie, body: form(address) })).status, 201);
  env.DB.sqlite.prepare("UPDATE photos SET state = 'hidden', approved_at = 5, hidden_at = 6 WHERE id = (SELECT MAX(id) FROM photos)").run();
  assert.deepEqual(photoRows(env).map((r) => r.state), ['approved', 'pending', 'hidden']);
  assert.deepEqual(await press(), { error: 'not-empty', album: address, photos: '3' });
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM albums').get().n, 1);

  const request = new Request(`${SITE}/admin/albums?error=not-empty&album=${address}&photos=3`, { headers: { [TOKEN_HEADER]: await mint(team) } });
  const html = await (await chain([root, ...adminPages, albumsPage], request, env)).text();
  assert.match(html, /Fall Regatta was not deleted: it holds 3 photos\./);
});
