// The installed app's service worker (#193), public/share/sw.js, run in
// node:vm against stand-ins for the worker's global scope and for IndexedDB
// (test/idb.js). Its one job is the share target's POST; every other request
// must go to the network as if it were not installed, and it must never
// cache. Each section names the criterion it holds.
//
// Requests that pass the worker by go on through the chains Pages runs, into
// the real routes and a real SQLite holding the real migrations, so #158's
// takedown is re-run here with the worker in front of it (criterion 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest as root } from '../functions/_middleware.js';
import * as albumRoute from '../functions/albums/[address]/index.js';
import * as imageRoute from '../functions/photos/[id]/[size].js';
import { onRequestPost as removeRoute } from '../functions/api/remove.js';
import { createAlbum } from '../lib/albums.js';
import { photoObjectKeys } from '../lib/photos.js';
import { d1 } from './d1.js';
import { idb } from './idb.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';
import { SCRIPT, SITE, share, worker as load } from './worker.js';

const INBOX = 'madcow-shared';
const FILES = 'files';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1, 18, 0, 0);

// The script with its comments taken out, for reading what it does rather
// than what it says about it.
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The worker (test/worker.js) on this file's clock. */
const worker = ({ db = idb(), now = NOW, network = null } = {}) => load({ db, now, network });

/** A shared photo, as a phone's gallery hands it over. */
const photo = (name, bytes = jpeg({ width: 40, height: 30 })) => new File([bytes], name, { type: 'image/jpeg', lastModified: NOW - 60_000 });

/** The store's records, one per file. */
const records = (w) => w.db.rows(INBOX, FILES);
const names = (w) => records(w).map((r) => r.file.name).sort();
/** A record as the worker writes it, for seeding the store directly. */
const record = (id, file, { share = `share-${id}`, index = 0, at = NOW } = {}) => ({ id, share, index, at, file });

// ---- Criterion 6: a new worker takes over at once --------------------------

test('a new worker takes over at once: install skips waiting, and activate claims every open page', async () => {
  const w = worker();
  await w.lifecycle('install');
  assert.equal(w.calls.skipWaiting, 1);
  await w.lifecycle('activate');
  assert.equal(w.calls.claim, 1);
});

// ---- Criterion 5: it never caches, and lets every other request go by -------

// Every kind of request criterion 5 names, and the share page's own, each in
// the method a page or a browser would use. A clip's address is not built
// yet (#198), so the shapes it could take are all here.
const PASSES = [
  ['GET', '/photos/12/grid'], ['GET', '/photos/12/screen'], ['GET', '/photos/12/full'], ['HEAD', '/photos/12/full'],
  ['GET', '/photos/12/clip'], ['GET', '/photos/12/video'], ['GET', '/clips/12'], ['GET', '/clips/12/play'],
  ['GET', '/albums/2026-10-04-fall-regatta/'], ['GET', '/albums/2026-10-04-fall-regatta'], ['GET', '/'],
  ['POST', '/api/upload'], ['GET', '/api/upload/session'], ['POST', '/api/join'], ['GET', '/api/albums/open'],
  ['POST', '/api/remove'], ['GET', '/api/health'], ['POST', '/api/admin/queue/approve'], ['GET', '/api/admin/photos/12/screen'],
  ['GET', '/admin'], ['GET', '/admin/'], ['GET', '/admin/queue'], ['GET', '/admin/removals'], ['POST', '/admin/code'],
  ['GET', '/share/'], ['GET', '/share/sw.js'], ['GET', '/js/share.js?v=0123456789'], ['GET', '/css/site.css'],
  ['GET', '/manifest.webmanifest'], ['GET', '/icons/maskable-512.png'], ['GET', '/policy'], ['GET', '/coach'], ['POST', '/remove'],
  // The share target's own address, by any other method, or on another site.
  ['GET', '/share/receive'], ['HEAD', '/share/receive'], ['PUT', '/share/receive'],
  ['POST', 'https://madcowsailing.com/share/receive'], ['POST', 'https://evil.example/share/receive'],
  // Another path that merely starts or ends like it.
  ['POST', '/share/receive/'], ['POST', '/share/receive2'], ['POST', '/api/share/receive'],
];

for (const [method, path] of PASSES) {
  test(`${method} ${path}: the worker lets it go by, answering nothing and touching no storage`, async () => {
    const w = worker();
    const request = new Request(new URL(path, SITE), {
      method,
      headers: path.includes('/clips/') || path.endsWith('/clip') ? { Range: 'bytes=0-1048575' } : {},
      body: ['GET', 'HEAD'].includes(method) ? undefined : 'x',
    });
    assert.equal(await w.fetch(request), null, 'the worker answered it');
    assert.deepEqual(w.calls.caches, []);
    assert.deepEqual(w.calls.network, [], 'the worker fetched something itself');
    assert.equal(w.db.state.opens, 0, 'the worker opened its storage for it');
  });
}

test('the control: the share target\'s POST is the one request the worker answers', async () => {
  const w = worker();
  const answer = await w.fetch(share([photo('a.jpg')]));
  assert.notEqual(answer, null);
  assert.equal((await answer).status, 303);
});

test('the worker never names Cache Storage, and answers nothing but the share target', () => {
  // A worker that kept a photo would serve it after its takedown (CLAUDE.md,
  // The photo site, item 3); one that kept the page would keep old code
  // running after a deploy (criterion 6). The trap above catches a use at
  // run time; this catches one on a path no test drives.
  assert.doesNotMatch(CODE, /\bcaches\b|\bCache\b|\bcache\s*\.|\bcacheName|workbox|precache/i);
  assert.equal((CODE.match(/respondWith\(/g) ?? []).length, 1, 'one respondWith, for the share target');
  assert.match(CODE, /const RECEIVE = '\/share\/receive';/);
  assert.match(CODE, /if \(request\.method !== 'POST'\) return;/);
});

// ---- Criterion 5: #158's takedown, re-run with the worker installed --------

const STATIC_404 = () => new Response('the site\'s 404 page', { status: 404, headers: { 'Content-Type': 'text/html' } });

function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** The site, as the network reaches it: the routes, with no worker in front. */
function routes(env) {
  return (request) => {
    const url = new URL(request.url);
    let m;
    if ((m = url.pathname.match(/^\/albums\/([^/]+)\/$/))) {
      return chain([root, albumRoute.onRequestGet, STATIC_404], request, env, { address: m[1] });
    }
    if ((m = url.pathname.match(/^\/photos\/([^/]+)\/([^/]+)$/))) {
      return chain([root, imageRoute.onRequestGet], request, env, { id: m[1], size: m[2] });
    }
    if (url.pathname === '/api/remove') return chain([root, removeRoute], request, env);
    throw new Error(`no route for ${url.pathname}`);
  };
}

/**
 * A browser with the worker installed: each request goes to the worker
 * first, and only one it lets go by reaches the routes. `answered` counts
 * the requests the worker answered itself.
 */
function browser(w, env) {
  const seen = { answered: 0, passed: 0 };
  const network = routes(env);
  async function fetch(request) {
    const answer = await w.fetch(request.clone());
    if (answer) {
      seen.answered += 1;
      return answer;
    }
    seen.passed += 1;
    return network(request);
  }
  return { fetch, seen };
}

const OBJECTS = { grid: jpeg({ width: 4, height: 3 }), screen: jpeg({ width: 8, height: 6 }), full: jpeg({ width: 16, height: 12 }) };
const T0 = 1_790_000_000;

/** An approved photo, as the upload route and the queue leave it (test/removals.test.js's seed). */
function seed(env, address, n) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const mediaKey = n.toString(16).padStart(32, '0');
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at) ' +
    "VALUES (?, 'photo', 'approved', ?, '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b', 'parent', 1, ?, ?, ?, 2560, 1920, 480, 360, 1600, 1200, 1000, ?)",
  ).run(albumId, mediaKey, T0 - 60, T0 + n, T0 + n, T0 + 100);
  for (const [size, key] of Object.entries(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: OBJECTS[size], httpMetadata: { contentType: 'image/jpeg' } });
  }
  return Number(lastInsertRowid);
}

test('#158\'s takedown with the worker installed: the three image routes answer 404 on the next request, and the album page drops the photo', async () => {
  const env = { DB: d1(), MEDIA: r2(), ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210' };
  const fall = await createAlbum(env.DB, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, T0);
  const id = seed(env, fall, 1);
  const other = seed(env, fall, 2);
  // The worker reaches the same routes the browser does, so a worker that
  // fetched and kept a copy, in the foreground or in waitUntil, could; the
  // harness waits for whatever it hands waitUntil before the next request
  // (#193's review found the first version could not express one).
  const w = worker({ network: routes(env) });
  await w.lifecycle('install');
  await w.lifecycle('activate');
  const { fetch, seen } = browser(w, env);
  const get = (path) => fetch(new Request(new URL(path, SITE)));

  for (const size of ['grid', 'screen', 'full']) assert.equal((await get(`/photos/${id}/${size}`)).status, 200, `${size} before`);
  assert.match(await (await get(`/albums/${fall}/`)).text(), new RegExp(`/photos/${id}/grid`));

  const takedown = await fetch(new Request(`${SITE}/api/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE, 'CF-Connecting-IP': '203.0.113.7' },
    body: new URLSearchParams({ photo: String(id) }).toString(),
  }));
  assert.equal(takedown.status, 303);

  for (const size of ['grid', 'screen', 'full']) assert.equal((await get(`/photos/${id}/${size}`)).status, 404, `${size} after`);
  const html = await (await get(`/albums/${fall}/`)).text();
  assert.doesNotMatch(html, new RegExp(`/photos/${id}/`));
  assert.match(html, new RegExp(`/photos/${other}/grid`), 'the album\'s other photo is still listed');

  // Every request went to the routes; the worker answered none, fetched
  // nothing itself and kept nothing.
  assert.equal(seen.answered, 0);
  assert.equal(seen.passed, 9, 'three sizes and the album, the takedown, then the three sizes and the album again');
  assert.deepEqual(w.calls.network, []);
  assert.deepEqual(w.calls.caches, []);
  assert.equal(w.db.state.opens, 0);
});

// ---- Criteria 2 and 3: receiving a share -------------------------------------

test('a share is kept: one record per file, in order, bytes and names intact, and the browser goes to /share/?shared with a 303', async () => {
  const w = worker();
  const files = [photo('20261001_101500.jpg'), photo('20261001_101502.jpg', jpeg({ width: 30, height: 40 })), photo('20261001_101503.jpg')];
  const answer = await (await w.fetch(share(files)));
  assert.equal(answer.status, 303, 'a 303, so the page loads with a GET and a reload never posts the files again');
  assert.equal(answer.headers.get('Location'), `${SITE}/share/?shared`);

  const kept = records(w).sort((a, b) => a.index - b.index);
  assert.equal(kept.length, 3);
  assert.equal(new Set(kept.map((r) => r.id)).size, 3, 'each file its own record');
  assert.ok(kept.every((r) => /^[0-9a-f-]{36}$/.test(r.id) && r.share === kept[0].share && r.at === NOW));
  assert.match(kept[0].share, /^[0-9a-f-]{36}$/);
  assert.deepEqual(kept.map((r) => r.index), [0, 1, 2]);
  assert.deepEqual(kept.map((r) => [r.file.name, r.file.type, r.file.size]), files.map((f) => [f.name, f.type, f.size]));
  for (let i = 0; i < files.length; i++) {
    assert.deepEqual(new Uint8Array(await kept[i].file.arrayBuffer()), new Uint8Array(await files[i].arrayBuffer()), files[i].name);
  }
  assert.equal(w.db.state.closes, w.db.state.opens, 'every connection the worker opened, it closed');
});

test('a later share is kept beside an earlier one still waiting, each its own share', async () => {
  const w = worker();
  await w.fetch(share([photo('a.jpg')]));
  const later = worker({ db: w.db, now: NOW + 60_000 });
  await (await later.fetch(share([photo('b.jpg'), photo('c.jpg')])));
  assert.deepEqual(names(w), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(new Set(records(w).map((r) => r.share)).size, 2);
});

test('a record over a day old is deleted when the next share is kept; one at exactly a day stays', async () => {
  const w = worker();
  w.db.seed(INBOX, FILES, 'id', [record('old', photo('old.jpg'), { at: NOW - DAY - 1 }), record('day', photo('day.jpg'), { at: NOW - DAY })]);
  await (await w.fetch(share([photo('new.jpg')])));
  assert.deepEqual(names(w), ['day.jpg', 'new.jpg']);
});

test('only the manifest\'s field, and only a file with bytes, is kept; a share with nothing in it goes to ?shared=empty', async () => {
  const w = worker();
  const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
  await (await w.fetch(share([photo('kept.jpg'), empty], { extra: [['photos', 'a string'], ['title', 'Shared from Gallery'], ['other', photo('other.jpg')]] })));
  assert.deepEqual(names(w), ['kept.jpg']);

  // Chrome's own shares arrived on Android as a form with no files (#193).
  const none = worker();
  const answer = await (await none.fetch(share([], { extra: [['title', 'nothing']] })));
  assert.equal(answer.status, 303);
  assert.equal(answer.headers.get('Location'), `${SITE}/share/?shared=empty`);
  assert.deepEqual(records(none), []);
  assert.equal(none.db.state.opens, 0, 'nothing to keep, so storage is not opened');
});

test('a body that is not a form goes to ?shared=failed, and nothing is kept', async () => {
  const w = worker();
  const answer = await (await w.fetch(new Request(`${SITE}/share/receive`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', Origin: 'null' }, body: 'not a form' })));
  assert.equal(answer.status, 303);
  assert.equal(answer.headers.get('Location'), `${SITE}/share/?shared=failed`);
  assert.equal(w.db.state.opens, 0);
});

test('storage that refuses the files (a full phone) goes to ?shared=failed, and the transaction keeps nothing, the day\'s tidy included', async () => {
  const db = idb({ fail: { put: new DOMException('The quota has been exceeded.', 'QuotaExceededError') } });
  db.seed(INBOX, FILES, 'id', [record('old', photo('old.jpg'), { at: NOW - 2 * DAY })]);
  const w = worker({ db });
  const answer = await (await w.fetch(share([photo('a.jpg')])));
  assert.equal(answer.status, 303);
  assert.equal(answer.headers.get('Location'), `${SITE}/share/?shared=failed`);
  assert.deepEqual(records(w).map((r) => r.id), ['old'], 'all or nothing: the failed put rolled the tidy back too');
  assert.equal(db.state.closes, db.state.opens);
});

test('storage that cannot be opened goes to ?shared=failed', async () => {
  const w = worker({ db: idb({ fail: { open: new DOMException('Blocked', 'UnknownError') } }) });
  const answer = await (await w.fetch(share([photo('a.jpg')])));
  assert.equal(answer.headers.get('Location'), `${SITE}/share/?shared=failed`);
});

// ---- Who may start a share (#193's security audit) ----------------------------

test('a share whose Origin is null (Android\'s Share menu), absent, or the site\'s own is kept', async () => {
  for (const origin of ['null', undefined, SITE]) {
    const w = worker();
    const answer = await (await w.fetch(share([photo('a.jpg')], { origin })));
    assert.equal(answer.headers.get('Location'), `${SITE}/share/?shared`, String(origin));
    assert.deepEqual(names(w), ['a.jpg'], String(origin));
  }
});

test('a share another site started is refused unread: the share page, no flag, nothing kept', async () => {
  for (const origin of ['https://evil.example', 'https://madcowsailing.com', 'http://photos.madcowsailing.com', 'https://photos.madcowsailing.com.evil.example']) {
    const w = worker();
    // A body that throws if read: a refused share is not parsed.
    let read = 0;
    const body = new ReadableStream({ pull() { read += 1; throw new Error('the worker read a refused share'); } }, { highWaterMark: 0 });
    const request = new Request(`${SITE}/share/receive`, {
      method: 'POST', body, duplex: 'half', headers: { Origin: origin, 'Content-Type': 'multipart/form-data; boundary=x' },
    });
    const answer = await (await w.fetch(request));
    assert.equal(answer.status, 303, origin);
    assert.equal(answer.headers.get('Location'), `${SITE}/share/`, origin);
    assert.equal(read, 0, origin);
    assert.equal(w.db.state.opens, 0, origin);
  }
});
