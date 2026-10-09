// The admin clip route (#198): GET and HEAD /api/admin/clips/<id>
// (functions/api/admin/clips/[id].js), which /admin/queue plays each waiting
// clip through. Every request runs through the chain Pages runs in front of
// the route (the root middleware, then the admin guards), against a real
// SQLite holding the real migrations (test/d1.js), the R2 stand-in
// (test/r2.js, whose get() takes a range, and sets `range` on every get, as
// miniflare does) and an admin's session minted by test/admin.js.
//
// A player reads a clip in ranges, and iOS plays media only from a server
// that answers them (CLAUDE.md, The photo site, item 10). RFC 9110 is the
// measure (sections 14.1.2 and 14.2): one range is 206 with Content-Range, a
// first byte past the end is 416 with the size alone, and a server may ignore
// anything else and answer 200 with the whole clip.
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as queuePage } from '../functions/admin/queue.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import * as clipRoute from '../functions/api/admin/clips/[id].js';
import { PHOTO_CACHE } from '../functions/photos/[id]/[size].js';
import { ADMIN_SIGN_IN } from '../lib/admin-session.js';
import { createAlbum } from '../lib/albums.js';
import { clipObjectKey, photoObjectKeys } from '../lib/photos.js';
import { ADMIN_KEY, adminCookieHeader, seedAdmin } from './admin.js';
import { d1 } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

const SITE = 'https://photos.madcowsailing.com';
const T0 = 1_790_000_000; // 2026-09-21T14:13:20Z
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';

// A clip's bytes: 10,000 of them, each its place in the clip mod 251, so a
// range read back shows where it came from. The route never parses them.
const SIZE = 10_000;
const BODY = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);

afterEach(() => mock.restoreAll());

/** A site with one open album, and its owner, account 1, whose session clip() sends. */
async function site() {
  const env = { DB: d1(), MEDIA: r2(), SESSION_SIGNING_KEY: ADMIN_KEY };
  seedAdmin(env.DB);
  const fall = await createAlbum(env.DB, FALL, T0);
  return { env, fall };
}

const albumId = (env, address) => env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;

let keys = 0;
const nextKey = () => (++keys).toString(16).padStart(32, '0');

/**
 * A clip as the clip routes leave it: once checked, `pending`, `approved` or
 * `hidden`, with its type, length, frame size and SIZE bytes on the row and
 * its one object under its own media key; or `uploading`, its parts still
 * arriving, with an upload id and nothing read from it (migration 0016 holds
 * both). `object` plants the object anyway, so a test can tell a refusal by
 * state from a missing object. Answers its id and its object's key.
 */
function seedClip(env, address, { state = 'pending', contentType = 'video/mp4', object = state !== 'uploading' } = {}) {
  const mediaKey = nextKey();
  const read = state !== 'uploading';
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, bytes, content_type, duration_ms, upload_id, approved_at, hidden_at) ' +
    "VALUES (?, 'clip', ?, ?, ?, 'parent', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(albumId(env, address), state, mediaKey, BATCH, T0 - 60, read ? T0 - 3600 : null, T0 + keys,
    read ? 1920 : null, read ? 1080 : null, read ? SIZE : null, read ? contentType : null, read ? 30_000 : null,
    read ? null : `upload-${mediaKey}`, state === 'approved' || state === 'hidden' ? T0 + 100 : null,
    state === 'hidden' ? T0 + 200 : null);
  const key = clipObjectKey(mediaKey);
  if (object) env.MEDIA.objects.set(key, { body: BODY, httpMetadata: { contentType } });
  return { id: Number(lastInsertRowid), key };
}

/** A waiting photo with its three objects (#154's shape), and an object where a clip of its media key would be. */
function seedPhoto(env, address) {
  const mediaKey = nextKey();
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes) ' +
    "VALUES (?, 'photo', 'pending', ?, ?, 'parent', 1, ?, ?, ?, 8, 8, 8, 8, 8, 8, 3000)",
  ).run(albumId(env, address), mediaKey, BATCH, T0 - 60, T0 - 3600, T0);
  for (const key of Object.values(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: jpeg({ width: 8, height: 8 }), httpMetadata: { contentType: 'image/jpeg' } });
  }
  env.MEDIA.objects.set(clipObjectKey(mediaKey), { body: BODY, httpMetadata: { contentType: 'video/mp4' } });
  return Number(lastInsertRowid);
}

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** GET (or HEAD) /api/admin/clips/<id> through the whole chain, with `range` as its Range; `cookie: null` sends no admin session. */
async function clip(env, id, { method = 'GET', range, cookie } = {}) {
  const headers = {};
  if (cookie !== null) headers.Cookie = cookie ?? await adminCookieHeader(1);
  if (range !== undefined) headers.Range = range;
  const request = new Request(`${SITE}/api/admin/clips/${id}`, { method, headers });
  const route = method === 'HEAD' ? clipRoute.onRequestHead : clipRoute.onRequestGet;
  return chain([root, ...adminApi, route], request, env, { id: String(id) });
}

const bytes = async (res) => new Uint8Array(await res.arrayBuffer());
const headersOf = (res, names) => Object.fromEntries(names.map((name) => [name, res.headers.get(name)]));

// ---- 200: the whole clip -------------------------------------------------------

test('no Range is 200 with the whole clip: its type, an inline name, cached privately for 300 s, its ETag and Accept-Ranges, and no Content-Range or Content-Length', async () => {
  const { env, fall } = await site();
  const { id, key } = seedClip(env, fall);
  // The stand-in sets `range` on a plain get, as miniflare does, so a route
  // that answered 206 whenever the object carried one would answer 206 here.
  assert.deepEqual((await env.MEDIA.get(key)).range, { offset: 0, length: SIZE });
  const res = await clip(env, id);
  assert.equal(res.status, 200);
  assert.deepEqual(headersOf(res, ['Content-Type', 'Content-Disposition', 'Cache-Control', 'Accept-Ranges', 'ETag', 'Content-Range', 'Content-Length', 'X-Robots-Tag']), {
    'Content-Type': 'video/mp4',
    'Content-Disposition': `inline; filename="clip-${id}.mp4"`,
    'Cache-Control': 'private, max-age=300',
    'Accept-Ranges': 'bytes',
    ETag: (await env.MEDIA.head(key)).httpEtag,
    'Content-Range': null,
    'Content-Length': null,
    'X-Robots-Tag': 'noindex',
  });
  assert.equal(PHOTO_CACHE, 'private, max-age=300', 'the photos\' cache, CLAUDE.md item 3');
  assert.deepEqual(await bytes(res), BODY);
});

test('a QuickTime clip is served as video/quicktime, named clip-<id>.mov', async () => {
  const { env, fall } = await site();
  const { id } = seedClip(env, fall, { contentType: 'video/quicktime' });
  const res = await clip(env, id, { range: 'bytes=0-3' });
  assert.equal(res.status, 206);
  assert.deepEqual(headersOf(res, ['Content-Type', 'Content-Disposition']), {
    'Content-Type': 'video/quicktime', 'Content-Disposition': `inline; filename="clip-${id}.mov"`,
  });
});

test('several ranges, a range it cannot read, and a last before its first are ignored: 200 with the whole clip, as RFC 9110 lets a server do', async () => {
  const { env, fall } = await site();
  const { id } = seedClip(env, fall);
  for (const range of ['bytes=0-1,5-6', 'bytes=0-1, 5-6', 'bytes=5-3', 'bytes=abc', 'bytes=', 'bytes=-', 'bytes=1.5-2', 'items=0-5', 'bytes 0-5', '0-5']) {
    const res = await clip(env, id, { range });
    assert.equal(res.status, 200, range);
    assert.deepEqual(headersOf(res, ['Content-Range', 'Accept-Ranges']), { 'Content-Range': null, 'Accept-Ranges': 'bytes' }, range);
    assert.deepEqual(await bytes(res), BODY, range);
  }
});

// ---- 206: one range ---------------------------------------------------------------

test('one range is 206 with exactly its bytes and Content-Range: a-b, a-, and -n, a last past the end cut to it, and a suffix past the start the whole clip', async () => {
  const { env, fall } = await site();
  const { id, key } = seedClip(env, fall);
  const etag = (await env.MEDIA.head(key)).httpEtag;
  for (const [range, first, last] of [
    ['bytes=0-0', 0, 0],
    ['bytes=10-19', 10, 19],
    ['bytes=9990-', 9990, 9999],
    ['bytes=0-', 0, 9999],
    ['bytes=-10', 9990, 9999],
    ['bytes=-1', 9999, 9999],
    ['bytes=-20000', 0, 9999],
    ['bytes=9995-20000', 9995, 9999],
    ['bytes=9999-9999', 9999, 9999],
    // The unit is compared in any case (RFC 9110, section 14.1).
    ['Bytes=5-9', 5, 9],
  ]) {
    const res = await clip(env, id, { range });
    assert.equal(res.status, 206, range);
    assert.deepEqual(headersOf(res, ['Content-Range', 'Accept-Ranges', 'Content-Type', 'ETag', 'Cache-Control', 'Content-Length']), {
      'Content-Range': `bytes ${first}-${last}/${SIZE}`,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      ETag: etag,
      'Cache-Control': PHOTO_CACHE,
      'Content-Length': null,
    }, range);
    assert.deepEqual(await bytes(res), BODY.slice(first, last + 1), range);
  }
});

test('a range is read from the bucket as that range alone, and the whole clip with no range asked', async () => {
  const { env, fall } = await site();
  const { id, key } = seedClip(env, fall);
  const get = mock.method(env.MEDIA, 'get');
  await clip(env, id, { range: 'bytes=10-19' });
  await clip(env, id, { range: 'bytes=-10' });
  await clip(env, id);
  await clip(env, id, { range: 'bytes=0-1,5-6' });
  assert.deepEqual(get.mock.calls.map((call) => call.arguments), [
    [key, { range: { offset: 10, length: 10 } }],
    [key, { range: { offset: 9990, length: 10 } }],
    [key, undefined],
    [key, undefined],
  ]);
});

// ---- 416: a range past the end ----------------------------------------------------

test('a first byte at or past the end, or a suffix of 0 bytes, is 416 with Content-Range bytes */size, the size from the row, with no bucket read', async () => {
  const { env, fall } = await site();
  const { id } = seedClip(env, fall);
  const get = mock.method(env.MEDIA, 'get');
  const head = mock.method(env.MEDIA, 'head');
  for (const range of ['bytes=10000-', 'bytes=10000-10005', 'bytes=12345-', 'bytes=99999999999999999999-', 'bytes=-0']) {
    const res = await clip(env, id, { range });
    assert.equal(res.status, 416, range);
    assert.deepEqual(headersOf(res, ['Content-Range', 'Accept-Ranges', 'Cache-Control', 'ETag', 'Content-Type']), {
      'Content-Range': `bytes */${SIZE}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ETag: null, 'Content-Type': null,
    }, range);
    assert.equal((await bytes(res)).length, 0, range);
  }
  assert.deepEqual([get.mock.callCount(), head.mock.callCount()], [0, 0]);
  // The control: the last byte is a range that holds, read with one get.
  const res = await clip(env, id, { range: 'bytes=9999-' });
  assert.equal(res.status, 206);
  assert.deepEqual([get.mock.callCount(), head.mock.callCount()], [1, 0]);
});

// ---- HEAD -----------------------------------------------------------------------------

test('HEAD answers as GET does: 200, 206 or 416, with the same headers', async () => {
  const { env, fall } = await site();
  const { id } = seedClip(env, fall);
  assert.equal(clipRoute.onRequestHead, clipRoute.onRequestGet);
  for (const [range, status] of [[undefined, 200], ['bytes=10-19', 206], ['bytes=10000-', 416], ['bytes=0-1,5-6', 200]]) {
    const get = await clip(env, id, { range });
    const head = await clip(env, id, { range, method: 'HEAD' });
    assert.deepEqual([get.status, head.status], [status, status], String(range));
    assert.deepEqual([...head.headers], [...get.headers], String(range));
  }
});

// ---- 404: no clip to serve ---------------------------------------------------------

test('a photo\'s id, a clip still uploading, an unknown id and an id that is not one are 404, each before any bucket read', async () => {
  const { env, fall } = await site();
  const { id: shown } = seedClip(env, fall);
  // Each with an object under the key a clip of its media key would have,
  // so each is refused by its row, never by a missing object.
  const photo = seedPhoto(env, fall);
  const { id: uploading } = seedClip(env, fall, { state: 'uploading', object: true });
  const get = mock.method(env.MEDIA, 'get');
  const head = mock.method(env.MEDIA, 'head');
  for (const path of [photo, uploading, shown + 99, 'abc', '0', '-1', `0${shown}`, '1.5', '1234567890123456', '']) {
    for (const range of [undefined, 'bytes=0-1']) {
      const res = await clip(env, path, { range });
      assert.equal(res.status, 404, `${path} ${range}`);
      assert.deepEqual(headersOf(res, ['Cache-Control', 'Content-Type', 'Content-Range']), {
        'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'Content-Range': null,
      }, `${path} ${range}`);
      assert.equal(await res.text(), 'No such clip.\n');
    }
  }
  assert.deepEqual([get.mock.callCount(), head.mock.callCount()], [0, 0]);
  // The control: the clip beside them is served, by one bucket read.
  assert.equal((await clip(env, shown)).status, 200);
  assert.equal(get.mock.callCount(), 1);
});

test('a clip is served in any state but uploading, so one opened from the queue still plays once approved; a row whose object is gone is 404, not a 500', async () => {
  const { env, fall } = await site();
  for (const state of ['pending', 'approved', 'hidden']) {
    const { id } = seedClip(env, fall, { state });
    assert.equal((await clip(env, id)).status, 200, state);
    assert.equal((await clip(env, id, { range: 'bytes=0-1' })).status, 206, state);
  }
  const { id, key } = seedClip(env, fall);
  env.MEDIA.objects.delete(key);
  for (const range of [undefined, 'bytes=0-1']) {
    const res = await clip(env, id, { range });
    assert.equal(res.status, 404, String(range));
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
});

// ---- The admin guard ---------------------------------------------------------------

// Since #224 the guard sends a refused request to the sign-in, 303, whatever
// its method (lib/admin-session.js). Account 99 does not exist.
const REFUSED_SESSIONS = {
  'no admin session': async () => null,
  'an admin session signed with another key': () => adminCookieHeader(1, { key: `${ADMIN_KEY}-other` }),
  'an admin session for an account that does not exist': () => adminCookieHeader(99),
};

for (const [name, cookie] of Object.entries(REFUSED_SESSIONS)) {
  test(`with ${name}: sent to the sign-in, and the bucket is never read`, async () => {
    const { env, fall } = await site();
    const { id } = seedClip(env, fall);
    const get = mock.method(env.MEDIA, 'get');
    for (const method of ['GET', 'HEAD']) {
      const res = await clip(env, id, { method, range: 'bytes=0-1', cookie: await cookie() });
      assert.equal(res.status, 303, method);
      assert.equal(res.headers.get('Location'), ADMIN_SIGN_IN, method);
    }
    assert.equal(get.mock.callCount(), 0);
  });
}

// ---- The page and the route, as one contract ----------------------------------------

test('the queue\'s player names this route for its clip, and what it names plays: a range is 206, and no range the whole clip', async () => {
  const { env, fall } = await site();
  const { id } = seedClip(env, fall);
  const request = new Request(`${SITE}/admin/queue`, { headers: { Cookie: await adminCookieHeader(1) } });
  const html = await (await chain([root, ...adminPages, queuePage], request, env)).text();
  const src = html.match(/<video\b[^>]*\ssrc="\/api\/admin\/clips\/([^"]+)"/)?.[1];
  assert.equal(src, String(id));
  const ranged = await clip(env, src, { range: 'bytes=100-199' });
  assert.equal(ranged.status, 206);
  assert.deepEqual(await bytes(ranged), BODY.slice(100, 200));
  assert.equal((await clip(env, src)).status, 200);
});
