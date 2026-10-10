// A sender's event and its address (#273): made provisional on the share
// page, made again from its date and title at its first approval, in the
// approval's own batch, and fixed from then on; the address it had before
// keeps taking photos and clips from a share page loaded before that
// approval (criterion 10). Every request runs through the chain Pages runs in
// front of the route (the root middleware, then the directory's guards),
// against a real SQLite holding the real migrations (test/d1.js), the R2
// stand-in (test/r2.js), an admin's session minted by test/admin.js and an
// account's session signed with the same key. Photos and clips are sent
// through the real upload routes and approved through the real approve
// route, so the event's address is only ever changed by the code that
// changes it in production. Migration 0018's triggers and its additivity are
// held here too. Each test names the criterion it holds.
//
// No page here renders a date or a time, so no zone is pinned; createEvent's
// clock is fixed (NOW), since its cap counts a UTC day.
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestPost as uploadRoute } from '../functions/api/upload/index.js';
import { onRequestPost as startRoute } from '../functions/api/upload/clips/index.js';
import { onRequestPut as partRoute } from '../functions/api/upload/clips/[id]/parts/[n].js';
import { onRequestPost as completeRoute } from '../functions/api/upload/clips/[id]/complete.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequestPost as approveRoute } from '../functions/api/admin/queue/approve.js';
import { onRequestPost as updateRoute } from '../functions/api/admin/albums/update.js';
import { onRequestPost as closeRoute } from '../functions/api/admin/albums/close.js';
import { onRequestPost as reopenRoute } from '../functions/api/admin/albums/reopen.js';
import { onRequestPost as deleteRoute } from '../functions/api/admin/albums/delete.js';
import { onRequestPost as moveRoute } from '../functions/api/admin/queue/move.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as albumsPageRoute } from '../functions/admin/albums.js';
import * as albumPage from '../functions/albums/[address]/index.js';
import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import { MAX_SUFFIX, addressCandidates, createAlbum, createEvent, fixAddress, openAlbum } from '../lib/albums.js';
import { UPLOAD_HEADER } from '../lib/clips.js';
import { approvePhotos, leftWaiting, provisionalAlbums, waitingBatches } from '../lib/queue.js';
import { nowSeconds } from '../lib/session.js';
import { partPieces, planClip } from '../public/js/clip.js';
import { ADMIN_KEY, adminCookieHeader, seedAdmin } from './admin.js';
import { d1 } from './d1.js';
import { jpeg } from './jpeg.js';
import { RECORDED, plainClip } from './mp4.js';
import { r2 } from './r2.js';

const SITE = 'https://photos.madcowsailing.com';
const MIGRATIONS = new URL('../migrations/', import.meta.url);
// createEvent's clock: 2026-09-21T14:13:20Z, mid-way through a UTC day.
const NOW = 1_790_000_000;
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';

// The sender's event, the address it is made at, and the rename every
// criterion 3 test gives it before its first approval: a new title and a new
// date, the two things its address is made from, and the address the
// approval then makes from them.
const EVENT = { team: 'hoover-jrt', title: 'Saturday regatta', kind: 'regatta', date: '2026-09-19' };
const MADE = '2026-09-19-saturday-regatta';
const RENAME = { title: 'Harbour cup', date: '2026-09-20' };
const REMADE = '2026-09-20-harbour-cup';

// 0018's words, as its triggers raise them.
const SAYS = {
  oneWay: 'an album address once fixed stays fixed',
  earlier: 'an earlier album address stays with its album',
  shown: 'a photo is approved only once its album address is fixed',
};

// The admin guard's one read a request (lib/admin-session.js), which a count
// of what a press asks D1 leaves out, as test/queue.test.js's does.
const GUARD_READ = /^SELECT a\.id, a\.name, a\.email, a\.admin_role FROM accounts AS a /;

afterEach(() => mock.restoreAll());

/** An account approved for Hoover JRT at session version 1, as an admin's approval leaves it: its id. */
function addSender(db, email) {
  const { lastInsertRowid } = db.sqlite
    .prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES (?, 'Sam Sender', 'parent', 1)").run(email);
  db.sqlite.prepare("INSERT INTO account_teams (account_id, team, state) VALUES (?, 'hoover-jrt', 'approved')").run(lastInsertRowid);
  return Number(lastInsertRowid);
}

/**
 * A site with its owner, account 1, whose session every admin press sends,
 * and a sender, account 2, who has made EVENT from the share page: provisional
 * at MADE. `id` is the event's, which a remade address does not change.
 */
async function site() {
  const env = { DB: d1(), MEDIA: r2(), SITE_ENV: 'production', SESSION_SIGNING_KEY: ADMIN_KEY };
  seedAdmin(env.DB);
  const sender = addSender(env.DB, 'sender@example.org');
  assert.deepEqual(await createEvent(env.DB, EVENT, sender, NOW), { address: MADE });
  const id = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(MADE).id;
  return { env, sender, id, cookies: await signedIn(sender) };
}

/** The cookie a phone signed in to `accountId` sends. */
const signedIn = async (accountId) => ({
  Cookie: `${ACCOUNT_COOKIE}=${await signAccountSession(ADMIN_KEY, { accountId, version: 1 }, nowSeconds())}`,
});

/** An album's address and what it is made from, by id. */
const album = (env, id) => ({ ...env.DB.sqlite.prepare(
  'SELECT address, title, kind, held_on AS date, provisional, earlier_address AS earlier FROM albums WHERE id = ?',
).get(id) });

/** A row's state and album, by id. */
const row = (env, id) => ({ ...env.DB.sqlite.prepare('SELECT state, album_id AS album FROM photos WHERE id = ?').get(id) });

/** Run `handlers` in order, as Pages does, with one context.data and the route's params. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** Where a press sent the browser: its query, as an object. */
function landing(res) {
  assert.equal(res.status, 303);
  return Object.fromEntries(new URL(res.headers.get('Location'), SITE).searchParams);
}

// ---- Sending, as the share page sends ---------------------------------------

// A photo too small to scale, so its three sizes are one and the same, which
// the upload route takes (test/upload.test.js).
const SMALL = jpeg({ width: 400, height: 300 });

/** POST /api/upload: one photo into the album at `address`, as the share page sends it. */
function sendPhoto(env, cookies, address) {
  const body = new FormData();
  const fields = { album: address, batch: BATCH, captured: String(NOW - 3600), caption: 'Rounding the windward mark' };
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  for (const size of ['grid', 'screen', 'full']) body.append(size, new Blob([SMALL], { type: 'image/jpeg' }), `${size}.jpg`);
  const request = new Request(`${SITE}/api/upload`, { method: 'POST', headers: { Origin: SITE, ...cookies }, body });
  return chain([root, ...uploadGuard, uploadRoute], request, env);
}

/** A photo sent and stored: its id. */
async function sentPhoto(env, cookies, address) {
  const res = await sendPhoto(env, cookies, address);
  assert.equal(res.status, 201, `a photo to ${address}`);
  return (await res.json()).id;
}

/** POST /api/upload/clips: the start of a clip. */
function start(env, cookies, fields) {
  const request = new Request(`${SITE}/api/upload/clips`, {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', ...cookies },
    body: JSON.stringify({ batch: BATCH, caption: 'Downwind at the gate', ...fields }),
  });
  return chain([root, ...uploadGuard, startRoute], request, env);
}

/** PUT one part, with its token. */
function part(env, cookies, id, n, bytes, token) {
  const request = new Request(`${SITE}/api/upload/clips/${id}/parts/${n}`, {
    method: 'PUT', headers: { Origin: SITE, [UPLOAD_HEADER]: token, 'Content-Length': String(bytes.length), ...cookies }, body: bytes,
  });
  return chain([root, ...uploadGuard, partRoute], request, env, { id: String(id), n: String(n) });
}

/** POST the complete. */
function complete(env, cookies, id, token, body) {
  const request = new Request(`${SITE}/api/upload/clips/${id}/complete`, {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', [UPLOAD_HEADER]: token, ...cookies },
    body: JSON.stringify(body),
  });
  return chain([root, ...uploadGuard, completeRoute], request, env, { id: String(id) });
}

/**
 * A clip sent whole to `address`, as the share page sends one: walked first
 * (public/js/clip.js), then the start, each part, `before()`, and the
 * complete. Answers the start's body and the complete's answer.
 */
async function sendClip(env, cookies, address, { before = async () => {} } = {}) {
  const { file } = plainClip();
  const planned = await planClip(async (offset, length) => file.subarray(offset, offset + length), file.length);
  assert.equal(planned.error, undefined, `the walker refused the fixture: ${planned.error}`);
  const res = await start(env, cookies, {
    album: address, bytes: planned.bytes, durationMs: planned.durationMs, contentType: planned.contentType,
  });
  assert.equal(res.status, 201, `the start at ${address}`);
  const started = await res.json();
  const parts = [];
  for (let n = 1; n <= started.parts; n++) {
    const pieces = partPieces(planned, n).map((piece) => (piece instanceof Uint8Array ? piece : file.subarray(piece.from, piece.to)));
    const sent = await part(env, cookies, started.id, n, new Uint8Array(await new Blob(pieces).arrayBuffer()), started.token);
    assert.equal(sent.status, 200, `part ${n}`);
    parts.push({ partNumber: n, etag: (await sent.json()).etag });
  }
  await before(started);
  const done = await complete(env, cookies, started.id, started.token, { parts, captured: planned.recordedAt ?? RECORDED });
  return { ...started, res: done };
}

// ---- What the admins press -----------------------------------------------------

/** POST an approve through the admin chain, with `fields` as the queue's form sends them. */
async function approvePress(env, fields) {
  const request = new Request(`${SITE}/api/admin/queue/approve`, {
    method: 'POST',
    headers: { Origin: SITE, Cookie: await adminCookieHeader(1), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return chain([root, ...adminApi, approveRoute], request, env);
}

/**
 * "Approve all" on the photos and clips `ids`, as a batch's form sends it,
 * with an emptied caption field for each when `captions`, as the page always
 * sends: where the press lands.
 */
async function approve(env, ids, { captions = false } = {}) {
  const fields = { ids: ids.join(' '), approve: 'all' };
  if (captions) for (const id of ids) fields[`caption-${id}`] = '';
  return landing(await approvePress(env, fields));
}

/** /admin/albums' Edit form on the album `id`: its fields as they stand, with `changes` on top. */
async function rename(env, id, changes) {
  const { address, title, kind, date } = album(env, id);
  const fields = { address, team: EVENT.team, title, kind, date, ...changes };
  const request = new Request(`${SITE}/api/admin/albums/update`, {
    method: 'POST',
    headers: { Origin: SITE, Cookie: await adminCookieHeader(1), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  assert.equal(landing(await chain([root, ...adminApi, updateRoute], request, env)).done, 'saved');
}

// A D1 whose statements matching `pattern` throw, alone or in a batch, which
// then rolls back whole as D1's does; every other statement runs. Copied from
// test/sign-in.test.js.
function failOn(db, pattern) {
  const fail = async () => { throw new Error('D1 down'); };
  const wrap = (statement, sql) => (pattern.test(sql)
    ? { sql, values: statement.values, bind: (...v) => wrap(statement.bind(...v), sql), first: fail, all: fail, run: fail }
    : statement);
  return {
    ...db,
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: async (list) => (list.some((s) => pattern.test(s.sql)) ? fail() : db.batch(list)),
  };
}

// A D1 whose every statement and batch waits a macrotask before it runs, as a
// real D1 call is I/O, so two presses in flight interleave between
// statements. Copied from test/sign-in.test.js (cairn:
// a-race-test-through-the-request-chain-never-interleaves).
function slow(db) {
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const wrap = (statement) => ({
    sql: statement.sql,
    values: statement.values,
    bind: (...values) => wrap(statement.bind(...values)),
    first: async (...args) => { await tick(); return statement.first(...args); },
    all: async () => { await tick(); return statement.all(); },
    run: async () => { await tick(); return statement.run(); },
  });
  return { ...db, prepare: (sql) => wrap(db.prepare(sql)), batch: async (list) => { await tick(); return db.batch(list); } };
}

/**
 * `land` awaited just before the first statement starting with `prefix` runs
 * its first(), as a writer landing between a route's check and that
 * statement. Only the first such statement waits, so whatever `land` sends
 * runs straight through. Copied from test/clip-upload.test.js.
 */
function landsBefore(env, prefix, land) {
  const prepare = env.DB.prepare.bind(env.DB);
  let landed = false;
  env.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (landed || !sql.startsWith(prefix)) return statement;
    landed = true;
    return { bind: (...values) => ({ first: async (column) => { await land(); return statement.bind(...values).first(column); } }) };
  };
}

// ---- Criterion 3: the address is made again at the first approval ------------

test('#273 criterion 3: a rename before the first approval is in the address the event goes public under, and the address it was made with stays its earlier address', async () => {
  const { env, id, cookies } = await site();
  const photo = await sentPhoto(env, cookies, MADE);
  await rename(env, id, RENAME);
  // An admin's rename keeps the address while it is provisional, as every
  // edit does: only the approval makes it again.
  assert.deepEqual(album(env, id), { address: MADE, ...RENAME, kind: 'regatta', provisional: 1, earlier: null });
  assert.deepEqual(await approve(env, [photo]), { done: 'approved', photo: String(photo) });
  assert.deepEqual(album(env, id), { address: REMADE, ...RENAME, kind: 'regatta', provisional: 0, earlier: MADE });
  assert.deepEqual(row(env, photo), { state: 'approved', album: id });
});

test('#273 criterion 3: once the first approval has fixed the address, a rename changes the title and never the address, at the next approval too', async () => {
  const { env, id, cookies } = await site();
  await rename(env, id, RENAME);
  await approve(env, [await sentPhoto(env, cookies, MADE)]);
  const fixed = album(env, id);
  assert.deepEqual([fixed.address, fixed.provisional], [REMADE, 0]);
  await rename(env, id, { title: 'Harbour cup, day one', date: '2026-09-21' });
  const later = await sentPhoto(env, cookies, REMADE);
  assert.deepEqual(await approve(env, [later]), { done: 'approved', photo: String(later) });
  assert.deepEqual(album(env, id), {
    address: REMADE, title: 'Harbour cup, day one', kind: 'regatta', date: '2026-09-21', provisional: 0, earlier: MADE,
  });
  assert.equal(row(env, later).state, 'approved');
});

test('#273 criterion 3: the first approval of a clip alone fixes the address (owner, 2026-10-09)', async () => {
  const { env, id, cookies } = await site();
  await rename(env, id, RENAME);
  const clip = await sendClip(env, cookies, MADE);
  assert.equal(clip.res.status, 201);
  assert.deepEqual(row(env, clip.id), { state: 'pending', album: id });
  assert.deepEqual(await approve(env, [clip.id]), { done: 'approved', clip: String(clip.id) });
  assert.deepEqual(album(env, id), { address: REMADE, ...RENAME, kind: 'regatta', provisional: 0, earlier: MADE });
  assert.equal(row(env, clip.id).state, 'approved');
});

test('#273 criterion 3: an event never renamed keeps the address it was made with, and has no earlier address', async () => {
  const { env, id, cookies } = await site();
  await approve(env, [await sentPhoto(env, cookies, MADE)]);
  assert.deepEqual(album(env, id), { address: MADE, title: EVENT.title, kind: 'regatta', date: EVENT.date, provisional: 0, earlier: null });
});

test('#273 criterion 3: an event made at -2 keeps -2 at its first approval, even once the first address has come free', async () => {
  const env = { DB: d1(), MEDIA: r2(), SITE_ENV: 'production', SESSION_SIGNING_KEY: ADMIN_KEY };
  seedAdmin(env.DB);
  const sender = addSender(env.DB, 'sender@example.org');
  // An admin's album holds the first address, so the sender's event is made
  // at the next one.
  assert.equal(await createAlbum(env.DB, EVENT, NOW), MADE);
  assert.deepEqual(await createEvent(env.DB, EVENT, sender, NOW), { address: `${MADE}-2` });
  const id = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(`${MADE}-2`).id;
  // The admin's album is deleted, empty, so the first address is free when
  // the approval makes the event's again.
  env.DB.sqlite.prepare('DELETE FROM albums WHERE address = ?').run(MADE);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM albums WHERE address = ? OR earlier_address = ?').get(MADE, MADE).n, 0);
  await approve(env, [await sentPhoto(env, await signedIn(sender), `${MADE}-2`)]);
  // An address already among its own date and title's is kept (lib/albums.js,
  // fixAddress): the remake moves an address only when what it is made from
  // has changed.
  assert.deepEqual(album(env, id), { address: `${MADE}-2`, title: EVENT.title, kind: 'regatta', date: EVENT.date, provisional: 0, earlier: null });
});

test('#273 criterion 3 and D5: with every address of its new title held by other albums, the event keeps the address it was made with, and the photo is approved', async () => {
  const { env, id, cookies } = await site();
  const hold = env.DB.sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at) VALUES (?, 'hoover-jrt', 'Harbour cup', 'regatta', '2026-09-20', 1)");
  const candidates = addressCandidates(REMADE);
  assert.equal(candidates.length, MAX_SUFFIX);
  for (const address of candidates) hold.run(address);
  await rename(env, id, RENAME);
  const photo = await sentPhoto(env, cookies, MADE);
  assert.deepEqual(await approve(env, [photo]), { done: 'approved', photo: String(photo) });
  assert.deepEqual(album(env, id), { address: MADE, ...RENAME, kind: 'regatta', provisional: 0, earlier: null });
  assert.equal(row(env, photo).state, 'approved');
  // The control: a second event renamed the same way, with the last of the
  // fifty free, takes it, so it was the fifty held that kept the first.
  env.DB.sqlite.prepare('DELETE FROM albums WHERE address = ?').run(candidates.at(-1));
  const sender = env.DB.sqlite.prepare("SELECT id FROM accounts WHERE email = 'sender@example.org'").get().id;
  const { address } = await createEvent(env.DB, { ...EVENT, title: 'Sunday regatta' }, sender, NOW);
  const second = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  await rename(env, second, RENAME);
  await approve(env, [await sentPhoto(env, cookies, address)]);
  assert.deepEqual(album(env, second), { address: `${REMADE}-50`, ...RENAME, kind: 'regatta', provisional: 0, earlier: address });
});

test('#273 criterion 3: a change of kind moves the address only when the title has no letter or digit, which the kind then names', async () => {
  const { env, id, sender, cookies } = await site();
  // A title of no letter or digit takes its kind's name (lib/albums.js,
  // baseAddress).
  const { address } = await createEvent(env.DB, { ...EVENT, title: '&' }, sender, NOW);
  assert.equal(address, '2026-09-19-regatta');
  const bare = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  await rename(env, bare, { kind: 'practice' });
  await rename(env, id, { kind: 'practice' });
  await approve(env, [await sentPhoto(env, cookies, address)]);
  await approve(env, [await sentPhoto(env, cookies, MADE)]);
  assert.deepEqual(album(env, bare), { address: '2026-09-19-practice', title: '&', kind: 'practice', date: EVENT.date, provisional: 0, earlier: address });
  // The control: a title with words in it keeps its address whatever its kind.
  assert.deepEqual(album(env, id), { address: MADE, title: EVENT.title, kind: 'practice', date: EVENT.date, provisional: 0, earlier: null });
});

// ---- The approval's batch ---------------------------------------------------------

test('#273 criterion 3: the remake and the approval land together: an approval that fails leaves the event provisional at its address and the photo waiting', async (t) => {
  const { env, id, cookies } = await site();
  const photo = await sentPhoto(env, cookies, MADE);
  await rename(env, id, RENAME);
  const before = album(env, id);
  const broken = { ...env, DB: failOn(env.DB, /^UPDATE photos SET state = 'approved'/) };
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  // The root middleware answers a route that throws with its plain 500.
  assert.equal((await approvePress(broken, { ids: String(photo), approve: 'all' })).status, 500);
  assert.deepEqual(logged, ['Unhandled error in a Function: D1 down']);
  // Run apart, the remake would have landed and the approval not: the
  // address made again, and nothing public under it.
  assert.deepEqual(album(env, id), before);
  assert.deepEqual(before, { address: MADE, ...RENAME, kind: 'regatta', provisional: 1, earlier: null });
  assert.equal(row(env, photo).state, 'pending');
  // The control: the same press on a working database fixes and approves.
  assert.deepEqual(await approve(env, [photo]), { done: 'approved', photo: String(photo) });
  assert.deepEqual([album(env, id).address, row(env, photo).state], [REMADE, 'approved']);
});

test('#273 criterion 3: a rename landing after the press read the queue leaves the photo waiting and the event provisional, and the queue says why, beside photos approved in another event too', async () => {
  const { env, id, sender, cookies } = await site();
  const photo = await sentPhoto(env, cookies, MADE);
  // An admin renames the event as the press's batch is put together: after
  // its read of the queue, which gave the remake the old title.
  const prepare = env.DB.prepare;
  let renamed = 0;
  env.DB.prepare = (sql) => {
    if (sql.startsWith('UPDATE albums SET earlier_address')) {
      renamed += 1;
      env.DB.sqlite.prepare('UPDATE albums SET title = ? WHERE id = ?').run(`Renamed ${renamed}`, id);
    }
    return prepare(sql);
  };
  assert.deepEqual(await approve(env, [photo]), { error: 'changed', n: '1' });
  assert.equal(renamed, 1, 'the press made no remake to land beside');
  assert.deepEqual(album(env, id), { address: MADE, title: 'Renamed 1', kind: 'regatta', date: EVENT.date, provisional: 1, earlier: null });
  assert.equal(row(env, photo).state, 'pending');

  // Again, in a press naming a photo in an event an admin made too, as a
  // stale or forged page could: that one is approved, and the press says how
  // many it left waiting for the change and lands on the first of them.
  const fixed = await createAlbum(env.DB, { ...EVENT, title: 'Club day' }, NOW);
  const other = await sentPhoto(env, cookies, fixed);
  assert.deepEqual(await approve(env, [photo, other]), { done: 'approved', photo: String(other), changed: '1', at: `photo-${photo}` });
  assert.deepEqual([row(env, photo).state, row(env, other).state], ['pending', 'approved']);
  assert.equal(album(env, id).provisional, 1);

  // The control: the next press, with nothing landing, fixes the address from
  // the title as it is now, and approves.
  env.DB.prepare = prepare;
  assert.deepEqual(await approve(env, [photo]), { done: 'approved', photo: String(photo) });
  assert.deepEqual(album(env, id), { address: '2026-09-19-renamed-2', title: 'Renamed 2', kind: 'regatta', date: EVENT.date, provisional: 0, earlier: MADE });

  // The same, a statement down: a fix read before a rename changes nothing
  // and approves nothing, and leftWaiting counts the photo.
  const next = await createEvent(env.DB, { ...EVENT, title: 'Sunday regatta' }, sender, NOW);
  const nextId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(next.address).id;
  const waiting = await sentPhoto(env, cookies, next.address);
  const [stale] = provisionalAlbums(await waitingBatches(env.DB), [waiting]);
  env.DB.sqlite.prepare("UPDATE albums SET title = 'Sunday race' WHERE id = ?").run(nextId);
  assert.deepEqual(await approvePhotos(env.DB, [waiting], NOW, [stale]), { approved: [], clips: [] });
  assert.deepEqual({ ...(await leftWaiting(env.DB, [waiting])) }, { photos: 0, clips: 0, provisional: 1 });
  assert.equal(album(env, nextId).provisional, 1);
});

test('#273 criterion 3: a reject or a Hide all landing after the press read the queue fixes no address, since nothing in the event is approved', async () => {
  const { env, sender, cookies } = await site();
  // Read as the press reads it, then the photo leaves the queue, then the
  // batch runs: rejected (its row deleted), or hidden while waiting.
  const pressAfter = async (title, leave) => {
    const made = await createEvent(env.DB, { ...EVENT, title }, sender, NOW);
    const id = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(made.address).id;
    // A second photo waits in the event, which the press does not name, as an
    // Approve on one photo of a batch leaves the others (#273's review): the
    // fix needs one of the press's own photos waiting, not any photo.
    await sentPhoto(env, cookies, made.address);
    const photo = await sentPhoto(env, cookies, made.address);
    const fixes = provisionalAlbums(await waitingBatches(env.DB), [photo]);
    assert.equal(fixes.length, 1, 'the press read the event as provisional');
    env.DB.sqlite.prepare('UPDATE albums SET title = ? WHERE id = ?').run(`${title} renamed`, id);
    fixes[0].title = `${title} renamed`;
    leave?.(photo);
    const result = await approvePhotos(env.DB, [photo], NOW, fixes);
    return { result, album: album(env, id), made: made.address };
  };
  const rejected = await pressAfter('Reject race', (photo) => env.DB.sqlite.prepare('DELETE FROM photos WHERE id = ?').run(photo));
  assert.deepEqual(rejected.result, { approved: [], clips: [] });
  assert.equal(rejected.album.provisional, 1, 'still provisional after a reject');
  assert.equal(rejected.album.address, rejected.made, 'its address is the one it was made with');
  const hidden = await pressAfter('Hide race', (photo) =>
    env.DB.sqlite.prepare("UPDATE photos SET state = 'hidden', approved_at = 0, hidden_at = ? WHERE id = ?").run(NOW, photo));
  assert.deepEqual(hidden.result, { approved: [], clips: [] });
  assert.equal(hidden.album.provisional, 1, 'still provisional after a Hide all');
  assert.equal(hidden.album.address, hidden.made);
  // The control: the same press with the photo still waiting fixes the
  // address from the renamed title and approves the photo.
  const kept = await pressAfter('Kept race');
  assert.equal(kept.result.approved.length, 1);
  assert.equal(kept.album.provisional, 0);
  assert.equal(kept.album.address, '2026-09-19-kept-race-renamed');
});

test('#273 review: a press from an admin page loaded before the address was made again acts on the event by its earlier address, and the notice names it', async () => {
  const { env, id, cookies } = await site();
  // Renamed, then approved: the address is made again, the old one kept.
  await rename(env, id, RENAME);
  const photo = await sentPhoto(env, cookies, MADE);
  assert.deepEqual(await approve(env, [photo]), { done: 'approved', photo: String(photo) });
  assert.deepEqual([album(env, id).address, album(env, id).earlier], [REMADE, MADE]);
  const press = async (path, route, fields) => chain([root, ...adminApi, route], new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { Origin: SITE, Cookie: await adminCookieHeader(1), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }), env);
  const notice = async (res) => {
    const page = await chain([root, ...adminPages, albumsPageRoute], new Request(new URL(res.headers.get('Location'), SITE), {
      headers: { Cookie: await adminCookieHeader(1) },
    }), env);
    return (await page.text()).match(/<p role="status">([\s\S]*?)<\/p>/)?.[1] ?? '';
  };
  const closedAt = () => env.DB.sqlite.prepare('SELECT closed_at FROM albums WHERE id = ?').get(id).closed_at;

  // Close, from the old page: the event closes, and the notice names it.
  const closed = await press('/api/admin/albums/close', closeRoute, { address: MADE });
  assert.equal(landing(closed).done, 'closed');
  assert.notEqual(closedAt(), null);
  assert.match(await notice(closed), /^Closed Harbour cup\./);
  // Reopen, the same way.
  assert.equal(landing(await press('/api/admin/albums/reopen', reopenRoute, { address: MADE })).done, 'reopened');
  assert.equal(closedAt(), null);
  // Edit: the title changes, and the address it went public under does not.
  const saved = await press('/api/admin/albums/update', updateRoute,
    { address: MADE, team: EVENT.team, title: 'Harbour cup, day one', kind: 'regatta', date: RENAME.date });
  assert.equal(landing(saved).done, 'saved');
  assert.deepEqual([album(env, id).title, album(env, id).address], ['Harbour cup, day one', REMADE]);
  assert.match(await notice(saved), new RegExp(`^Saved Harbour cup, day one\\. Its address stays <code>${REMADE}</code>\\.`));
  // Delete: refused as the event holds a photo, not "missing".
  assert.equal(landing(await press('/api/admin/albums/delete', deleteRoute, { address: MADE })).error, 'not-empty');
  // Move: a waiting photo of the team's Not sure album moves into the event
  // named by its old address.
  const waiting = await sentPhoto(env, cookies, '0001-01-01-not-sure-hoover-jrt');
  const moved = await press('/api/admin/queue/move', moveRoute, { ids: String(waiting), move: String(waiting), to: MADE });
  assert.equal(landing(moved).done, 'moved');
  assert.equal(row(env, waiting).album, id);
  // The control: an address no album has, or had, is still missing.
  assert.equal(landing(await press('/api/admin/albums/close', closeRoute, { address: '2026-09-19-never-made' })).error, 'missing');
});

test('#273 criterion 3: a date change, or a kind change on a title with no letter or digit, landing after the press read the queue fixes no address', async () => {
  const { env, sender, cookies } = await site();
  // As the press reads it: the event provisional with one photo waiting. Then
  // `change` lands before the batch, and the batch runs with the fix it read.
  const pressAfter = async (event, change) => {
    const made = await createEvent(env.DB, event, sender, NOW);
    const id = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(made.address).id;
    const photo = await sentPhoto(env, cookies, made.address);
    const fixes = provisionalAlbums(await waitingBatches(env.DB), [photo]);
    if (change) env.DB.sqlite.prepare(`UPDATE albums SET ${change} WHERE id = ?`).run(id);
    return { result: await approvePhotos(env.DB, [photo], NOW, fixes), album: album(env, id), made: made.address };
  };
  // The date: under a remake that ignored it, the old date's address would
  // be fixed and the event made public under it (#273's review measured it).
  const dated = await pressAfter({ ...EVENT, title: 'Date race' }, "held_on = '2026-09-20'");
  assert.deepEqual(dated.result, { approved: [], clips: [] });
  assert.deepEqual([dated.album.provisional, dated.album.address], [1, dated.made]);
  // The kind names the address only when the title has none of its own
  // (baseAddress): '&' makes `<date>-regatta`, and a practice would be
  // `<date>-practice`.
  const kinded = await pressAfter({ ...EVENT, title: '&' }, "kind = 'practice'");
  assert.equal(kinded.made, '2026-09-19-regatta');
  assert.deepEqual(kinded.result, { approved: [], clips: [] });
  assert.deepEqual([kinded.album.provisional, kinded.album.address], [1, '2026-09-19-regatta']);
  // The control: the same press with nothing changed approves and fixes.
  const kept = await pressAfter({ ...EVENT, title: '&', kind: 'practice' });
  assert.equal(kept.result.approved.length, 1);
  assert.deepEqual([kept.album.provisional, kept.album.address], [0, '2026-09-19-practice']);
});

test('#273 criterion 3: two approvals at once fix the address once, and both photos end approved', async () => {
  const { env, id, cookies } = await site();
  const first = await sentPhoto(env, cookies, MADE);
  const second = await sentPhoto(env, cookies, MADE);
  await rename(env, id, RENAME);
  // Each press's queue read and batch, logged as they reach the database,
  // under the macrotask each statement waits. The guards' signature checks
  // run on crypto's own threads, so the two presses do not keep in step by
  // themselves: the first batch waits, by the clock, until both presses have
  // read the queue, which is the race at its narrowest.
  const order = [];
  const reads = () => order.filter((step) => step === 'read').length;
  const watched = {
    ...env.DB,
    prepare: (sql) => {
      const statement = env.DB.prepare(sql);
      if (!/^SELECT p\.id, p\.batch, p\.sender/.test(sql)) return statement;
      return { ...statement, all: async () => { order.push('read'); return statement.all(); } };
    },
    batch: async (list) => {
      const deadline = Date.now() + 5000;
      while (reads() < 2) {
        assert.ok(Date.now() < deadline, 'the other press never read the queue');
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      order.push('batch');
      return env.DB.batch(list);
    },
  };
  const racing = { ...env, DB: slow(watched) };
  const [a, b] = await Promise.all([approve(racing, [first]), approve(racing, [second])]);
  // The race was run: both presses read the event as provisional before
  // either batch, so both carried a remake.
  assert.deepEqual(order, ['read', 'read', 'batch', 'batch']);
  // Each lands on the other's photo, which its read saw still waiting (#270).
  assert.deepEqual([a, b], [
    { done: 'approved', photo: String(first), at: `photo-${second}` },
    { done: 'approved', photo: String(second), at: `photo-${first}` },
  ]);
  assert.deepEqual([row(env, first).state, row(env, second).state], ['approved', 'approved']);
  // Fixed once: a second remake would find REMADE among its title's
  // addresses, keep it, and clear the earlier address the share pages loaded
  // before still send to.
  assert.deepEqual(album(env, id), { address: REMADE, ...RENAME, kind: 'regatta', provisional: 0, earlier: MADE });
});

test('#273 criterion 3: an approval press is five statements with one provisional event among its targets, one more for each, and stays four without, beside the guard\'s read', async () => {
  const { env, id, sender, cookies } = await site();
  const count = async (fn) => {
    env.DB.statements.length = 0;
    await fn();
    return env.DB.statements.filter((sql) => !GUARD_READ.test(sql)).length;
  };
  const fixed = await createAlbum(env.DB, { ...EVENT, title: 'Club day' }, NOW);
  const inFixed = await sentPhoto(env, cookies, fixed);
  assert.equal(await count(() => approve(env, [inFixed], { captions: true })), 4, 'an event an admin made');
  const inEvent = await sentPhoto(env, cookies, MADE);
  assert.equal(await count(() => approve(env, [inEvent], { captions: true })), 5, 'one provisional event');
  assert.equal(album(env, id).provisional, 0);
  // Fixed now, its next approval is four again.
  const again = await sentPhoto(env, cookies, MADE);
  assert.equal(await count(() => approve(env, [again], { captions: true })), 4, 'an event already fixed');
  // Two provisional events in one press, as a stale or forged page could name
  // them: a remake each.
  const events = [];
  for (const title of ['Sunday regatta', 'Monday practice']) {
    const { address } = await createEvent(env.DB, { ...EVENT, title }, sender, NOW);
    events.push(await sentPhoto(env, cookies, address));
  }
  assert.equal(await count(() => approve(env, events, { captions: true })), 6, 'two provisional events');
  // A remake that changed nothing, the event renamed meanwhile, leaves the
  // photo waiting, and the press reads why: four, the remake and that read.
  const { address } = await createEvent(env.DB, { ...EVENT, title: 'Tuesday practice' }, sender, NOW);
  const renamed = await sentPhoto(env, cookies, address);
  const prepare = env.DB.prepare;
  env.DB.prepare = (sql) => {
    if (sql.startsWith('UPDATE albums SET earlier_address')) env.DB.sqlite.prepare("UPDATE albums SET title = 'x' WHERE address = ?").run(address);
    return prepare(sql);
  };
  assert.equal(await count(() => approve(env, [renamed], { captions: true })), 6, 'a remake that changed nothing');
  assert.equal(row(env, renamed).state, 'pending');
});

test('#273 criterion 3: provisionalAlbums names each provisional event among a press\'s photos once, and no event fixed or not named', () => {
  const event = (id, provisional) => ({ id, address: `2026-09-19-e${id}`, title: `E${id}`, kind: 'regatta', date: '2026-09-19', provisional, team: 'hoover-jrt', holding: false });
  const batch = (album, ...ids) => ({ album, photos: ids.map((id) => ({ id })) });
  const shown = event(1, true);
  const batches = [
    batch(shown, 1, 2),
    // The same event's second batch, and a batch shown in two parts, which
    // waitingBatches gives as two entries naming one album.
    batch(shown, 3),
    batch(event(2, true), 4),
    batch(event(2, true), 5),
    batch(event(3, false), 6),
    batch(event(4, true), 7),
  ];
  const named = (album) => ({ id: album.id, address: album.address, title: album.title, kind: album.kind, date: album.date });
  assert.deepEqual(provisionalAlbums(batches, [1, 3, 4, 5, 6]), [named(shown), named(event(2, true))]);
  // The controls: naming the last event's photo lists it, and naming none lists none.
  assert.deepEqual(provisionalAlbums(batches, [7]), [named(event(4, true))]);
  assert.deepEqual(provisionalAlbums(batches, []), []);
});

// ---- Migration 0018 ------------------------------------------------------------

/** A database with every migration, an admin's event and a sender's, as createAlbum and createEvent leave them. */
async function database() {
  const db = d1();
  const sender = addSender(db, 'sender@example.org');
  await createAlbum(db, { ...EVENT, title: 'Club day' }, NOW);
  await createEvent(db, EVENT, sender, NOW);
  const id = (address) => db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  return { db, sqlite: db.sqlite, club: id('2026-09-19-club-day'), event: id(MADE) };
}

test('#273 migration 0018: an album\'s address goes from provisional to fixed and never back, however it is written', async () => {
  const { sqlite, club, event } = await database();
  const set = (id, value) => sqlite.prepare('UPDATE albums SET provisional = ? WHERE id = ?').run(value, id);
  assert.throws(() => set(club, 1), { message: SAYS.oneWay }, 'an admin\'s album, fixed from the start');
  assert.throws(() => set(club, null), { message: SAYS.oneWay }, 'NULL is not 0 either');
  // The control: a provisional one is fixed, and is then held as any other.
  set(event, 0);
  assert.throws(() => set(event, 1), { message: SAYS.oneWay }, 'a sender\'s event once fixed');
  // A statement naming the value it has changes nothing, and is taken.
  set(event, 0);
  // Only 0 and 1, and a new album may start provisional, as createEvent's does.
  assert.throws(() => sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at, provisional) VALUES ('2026-09-19-x', 'hoover-jrt', 'x', 'regatta', '2026-09-19', 1, 2)").run(), /CHECK constraint failed/);
  sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at, provisional) VALUES ('2026-09-19-x', 'hoover-jrt', 'x', 'regatta', '2026-09-19', 1, 1)").run();
});

test('#273 migration 0018: no album\'s address is another album\'s earlier address, nor its earlier address another\'s address, however it is written', async () => {
  const { db, sqlite, club, event } = await database();
  // The event renamed and its address made again, by the approval's own
  // statement: REMADE, kept MADE.
  sqlite.prepare('UPDATE albums SET title = ?, held_on = ? WHERE id = ?').run(RENAME.title, RENAME.date, event);
  // The approval's photo, waiting in the event: the fix lands only beside one.
  const waiting = Number(sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, captured_at, sent_at, ' +
    "width, height, grid_width, grid_height, screen_width, screen_height, bytes) VALUES (?, 'photo', 'pending', ?, ?, 'parent', 2, 1, 1, 1, " +
    '2560, 1920, 480, 360, 1600, 1200, 10)',
  ).run(event, 'f'.repeat(32), BATCH).lastInsertRowid);
  const stmt = fixAddress(db, { id: event, address: MADE, kind: 'regatta', ...RENAME }, [waiting]);
  assert.equal(sqlite.prepare(stmt.sql).run(...stmt.values).changes, 1);
  assert.deepEqual({ ...sqlite.prepare('SELECT address, earlier_address FROM albums WHERE id = ?').get(event) }, { address: REMADE, earlier_address: MADE });
  const insert = (address, earlier = null, verb = 'INSERT') => sqlite.prepare(
    `${verb} INTO albums (address, team, title, kind, held_on, created_at, earlier_address) VALUES (?, 'hoover-jrt', 'x', 'regatta', '2026-09-19', 1, ?)`,
  ).run(address, earlier);
  const update = (id, column, value) => sqlite.prepare(`UPDATE albums SET ${column} = ? WHERE id = ?`).run(value, id);
  const refused = {
    'an album made at the event\'s earlier address': () => insert(MADE),
    'the same, as a REPLACE': () => insert(MADE, null, 'REPLACE'),
    'the same, as INSERT OR REPLACE': () => insert(MADE, null, 'INSERT OR REPLACE'),
    'an album made keeping another album\'s address as its earlier one': () => insert('2026-09-19-new', REMADE),
    'an album moved to the event\'s earlier address': () => update(club, 'address', MADE),
    'an album given another album\'s address as its earlier one': () => update(club, 'earlier_address', REMADE),
  };
  for (const [name, write] of Object.entries(refused)) assert.throws(write, { message: SAYS.earlier }, name);
  // Two albums keeping one earlier address: the index refuses it, in its words.
  assert.throws(() => update(club, 'earlier_address', MADE), /UNIQUE constraint failed: albums\.earlier_address/);
  assert.deepEqual(sqlite.prepare('SELECT address, earlier_address FROM albums WHERE id IN (?, ?) ORDER BY id').all(club, event).map((r) => ({ ...r })),
    [{ address: '2026-09-19-club-day', earlier_address: null }, { address: REMADE, earlier_address: MADE }]);
  // The controls, each one field from a refusal: a new address, an earlier
  // address no album holds, an edit that keeps the event's own two, and an
  // admin's empty event replaced by its own address, as 0015's tests hold.
  insert('2026-09-19-new');
  insert('2026-09-19-newer', '2026-09-19-never-used');
  sqlite.prepare('UPDATE albums SET title = ?, address = address, earlier_address = earlier_address WHERE id = ?').run('Harbour cup, day one', event);
  sqlite.prepare("REPLACE INTO albums (address, team, title, kind, held_on, created_at) VALUES ('2026-09-19-club-day', 'hoover-jrt', 'Club day', 'practice', '2026-09-19', 1)").run();
  assert.equal(sqlite.prepare("SELECT kind FROM albums WHERE address = '2026-09-19-club-day'").get().kind, 'practice');
});

test('#273 migration 0018: a photo or clip in a provisional event is never approved by hand, and is hidden only while waiting', async () => {
  const { sqlite, club, event } = await database();
  let keys = 0;
  const PHOTO = {
    kind: 'photo', state: 'pending', batch: BATCH, sender: 'parent', code_generation: 2, session_issued: 1, captured_at: 1,
    sent_at: 1, width: 2560, height: 1920, grid_width: 480, grid_height: 360, screen_width: 1600, screen_height: 1200, bytes: 10,
  };
  const CLIP = {
    kind: 'clip', state: 'pending', batch: BATCH, sender: 'parent', code_generation: 2, session_issued: 1, captured_at: 1,
    sent_at: 1, width: 1920, height: 1080, bytes: 10, content_type: 'video/mp4', duration_ms: 30_000,
  };
  const write = (albumId, seed, changes = {}) => {
    const full = { album_id: albumId, media_key: (++keys).toString(16).padStart(32, '0'), ...seed, ...changes };
    const names = Object.keys(full);
    return Number(sqlite.prepare(`INSERT INTO photos (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...Object.values(full)).lastInsertRowid);
  };
  const change = (id, sql, ...values) => sqlite.prepare(`UPDATE photos SET ${sql} WHERE id = ?`).run(...values, id);
  const approved = { state: 'approved', approved_at: 5 };
  const takenDown = { state: 'hidden', approved_at: 5, hidden_at: 6 };
  const hiddenWaiting = { state: 'hidden', approved_at: 0, hidden_at: 6 };
  for (const [name, seed] of [['photo', PHOTO], ['clip', CLIP]]) {
    // Written in already shown: refused in the event, and the control, taken
    // in an admin's.
    for (const [what, changes] of [['approved', approved], ['taken down after its approval', takenDown]]) {
      assert.throws(() => write(event, seed, changes), { message: SAYS.shown }, `a ${name} written in ${what}`);
      write(club, seed, changes);
    }
    // Hidden while it waits, as Hide all leaves one (approved_at 0): taken.
    const hidden = write(event, seed, hiddenWaiting);
    assert.throws(() => change(hidden, 'approved_at = 5'), { message: SAYS.shown }, `a hidden waiting ${name} given an approval time`);
    // Approved, or taken down, by an UPDATE of a waiting one.
    const waiting = write(event, seed);
    assert.throws(() => change(waiting, "state = 'approved', approved_at = 5"), { message: SAYS.shown }, `a waiting ${name} approved`);
    assert.throws(() => change(waiting, "state = 'hidden', approved_at = 5, hidden_at = 6"), { message: SAYS.shown }, `a waiting ${name} taken down`);
    change(waiting, "state = 'hidden', approved_at = 0, hidden_at = 6");
    // An approved one moved in from an admin's event.
    const shown = write(club, seed, approved);
    assert.throws(() => change(shown, 'album_id = ?', event), { message: SAYS.shown }, `an approved ${name} moved in`);
    // The control: a waiting one moves in, and out again.
    const moving = write(club, seed);
    change(moving, 'album_id = ?', event);
    change(moving, 'album_id = ?', club);
  }
  // Once the address is fixed, the same approval goes through.
  const waiting = write(event, PHOTO);
  sqlite.prepare('UPDATE albums SET provisional = 0 WHERE id = ?').run(event);
  change(waiting, "state = 'approved', approved_at = 5");
  assert.equal(sqlite.prepare('SELECT state FROM photos WHERE id = ?').get(waiting).state, 'approved');
});

test('#273 migration 0018: it adds three columns to albums, two indexes and five triggers, and every object and row stored before it stays as it was', () => {
  // The schema before 0018, holding events, an account and its photos and
  // clip in the states a database holds when 0018 reaches it.
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).sort().filter((f) => f < '0018')) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('sender@example.org', 'Sam Sender', 'parent', 1)").run();
  sqlite.prepare("INSERT INTO account_teams (account_id, team, state) VALUES (1, 'hoover-jrt', 'approved')").run();
  const album = sqlite.prepare('INSERT INTO albums (address, team, title, kind, held_on, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const open = Number(album.run(MADE, 'hoover-jrt', EVENT.title, 'regatta', EVENT.date, NOW, null).lastInsertRowid);
  album.run('2026-09-12-club-day', 'cohssa', 'Club day', 'practice', '2026-09-12', NOW - 1, NOW);
  const photo = sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, account_id, captured_at, ' +
    'sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, content_type, duration_ms, approved_at, hidden_at) ' +
    "VALUES (?, ?, ?, ?, ?, 'parent', 0, 0, 1, 1, 1, ?, ?, ?, ?, ?, ?, 10, ?, ?, ?, ?)",
  );
  let key = 0;
  const seedRow = (kind, state, approvedAt = null, hiddenAt = null) => photo.run(open, kind, state, (++key).toString(16).padStart(32, '0'), BATCH,
    ...(kind === 'photo' ? [2560, 1920, 480, 360, 1600, 1200, null, null] : [1920, 1080, null, null, null, null, 'video/mp4', 30_000]),
    approvedAt, hiddenAt);
  seedRow('photo', 'pending');
  seedRow('photo', 'approved', 5);
  seedRow('photo', 'hidden', 0, 6);
  seedRow('clip', 'approved', 5);

  const tables = () => sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
  const everyRow = () => Object.fromEntries(tables().map((table) => [
    table, sqlite.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify({ ...r })).sort(),
  ]));
  const schema = () => sqlite.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all().map((r) => ({ ...r }));
  const objects = () => sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n;
  const before = { rows: everyRow(), schema: schema(), objects: objects() };
  assert.equal(before.rows.photos.length, 4);

  sqlite.exec(readFileSync(new URL('0018_sender_events.sql', MIGRATIONS), 'utf8'));
  const after = { rows: everyRow(), schema: schema(), objects: objects() };

  // Every row of every table as it was, the albums' with the three new
  // columns at their defaults: made by no account, fixed, no earlier address.
  const fresh = { created_by: null, provisional: 0, earlier_address: null };
  assert.deepEqual(after.rows, {
    ...before.rows,
    albums: before.rows.albums.map((r) => JSON.stringify({ ...JSON.parse(r), ...fresh })).sort(),
  });
  // Exactly the objects 0018 declares, on the tables it names.
  const added = after.schema.filter((entry) => !before.schema.some((old) => old.name === entry.name));
  assert.deepEqual(added.map((entry) => `${entry.type} ${entry.name} on ${entry.tbl_name}`), [
    'index albums_by_creator on albums', 'index albums_by_earlier_address on albums',
    'trigger albums_earlier_address_kept_on_insert on albums', 'trigger albums_earlier_address_kept_on_update on albums',
    'trigger albums_provisional_one_way on albums',
    'trigger photos_provisional_never_shown_on_insert on photos', 'trigger photos_provisional_never_shown_on_update on photos',
  ]);
  // Every object before it identical, but the albums table's own entry,
  // which ADD COLUMN rewrites to carry the three columns.
  const kept = after.schema.filter((entry) => before.schema.some((old) => old.name === entry.name));
  const changed = kept.filter((entry) => !before.schema.some((old) => JSON.stringify(old) === JSON.stringify(entry)));
  assert.deepEqual(changed.map((entry) => `${entry.type} ${entry.name}`), ['table albums']);
  const columns = sqlite.prepare("SELECT name, type, \"notnull\" AS required, dflt_value AS fallback FROM pragma_table_info('albums')").all().map((r) => ({ ...r }));
  assert.deepEqual(columns.slice(-3), [
    { name: 'created_by', type: 'INTEGER', required: 0, fallback: null },
    { name: 'provisional', type: 'INTEGER', required: 1, fallback: '0' },
    { name: 'earlier_address', type: 'TEXT', required: 0, fallback: null },
  ]);
  // 74 objects after it, from 67 at 0017: the figures the read-back on
  // preview and production compares with, after applying it.
  assert.deepEqual([before.objects, after.objects], [67, 74]);
  assert.equal(after.objects - before.objects, added.length);

  // created_by names an account (criterion 9): REFERENCES accounts (id), ON
  // DELETE SET NULL, so deleting the account keeps its event, made by no one.
  const [ref] = sqlite.prepare("SELECT * FROM pragma_foreign_key_list('albums') WHERE \"from\" = 'created_by'").all();
  assert.deepEqual({ table: ref.table, to: ref.to, onDelete: ref.on_delete }, { table: 'accounts', to: 'id', onDelete: 'SET NULL' });
  const made = Number(sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at, created_by, provisional) VALUES ('2026-09-20-made', 'hoover-jrt', 'Made', 'regatta', '2026-09-20', 1, 1, 1)").run().lastInsertRowid);
  assert.throws(() => sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at, created_by) VALUES ('2026-09-20-nobody', 'hoover-jrt', 'x', 'regatta', '2026-09-20', 1, 99)").run(), /FOREIGN KEY constraint failed/);
  sqlite.prepare('DELETE FROM accounts WHERE id = 1').run();
  assert.deepEqual({ ...sqlite.prepare('SELECT created_by, provisional FROM albums WHERE id = ?').get(made) }, { created_by: null, provisional: 1 });
});

// ---- Criterion 10: a share page loaded before the first approval ----------------

/** A site whose event was renamed and then approved: its address made again, REMADE, MADE kept as its earlier one. */
async function remade() {
  const made = await site();
  await rename(made.env, made.id, RENAME);
  await approve(made.env, [await sentPhoto(made.env, made.cookies, MADE)]);
  assert.deepEqual([album(made.env, made.id).address, album(made.env, made.id).earlier], [REMADE, MADE]);
  return made;
}

test('#273 criterion 10: a photo sent to the address an event had before its first approval lands in the event, after that approval made a new one', async () => {
  const { env, id, cookies } = await remade();
  const res = await sendPhoto(env, cookies, MADE);
  assert.equal(res.status, 201, 'the address the share page loaded with');
  const { id: photo } = await res.json();
  assert.deepEqual(row(env, photo), { state: 'pending', album: id });
  assert.equal((await openAlbum(env.DB, MADE)).address, REMADE, 'the upload\'s check finds the event by either');
  // The controls: an address no event ever had is still 409 album, and the
  // earlier address of a closed event is closed too.
  for (const address of ['2026-09-19-saturday-race', `${MADE}-2`]) {
    const refused = await sendPhoto(env, cookies, address);
    assert.equal(refused.status, 409, address);
    assert.deepEqual(await refused.json(), { error: 'album' }, address);
  }
  env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE id = ?').run(id);
  const closed = await sendPhoto(env, cookies, MADE);
  assert.equal(closed.status, 409, 'the event closed');
  assert.deepEqual(await closed.json(), { error: 'album' });
});

test('#273 criterion 10: a clip started at the address an event had before its first approval goes through to its row in the event', async () => {
  const { env, id, cookies } = await remade();
  const clip = await sendClip(env, cookies, MADE);
  assert.equal(clip.res.status, 201);
  assert.deepEqual(await clip.res.json(), { id: clip.id });
  assert.deepEqual(row(env, clip.id), { state: 'pending', album: id });
});

test('#273 criterion 10: a first approval landing between the upload route\'s check and its insert still lands the photo in the event', async () => {
  const { env, id, cookies } = await site();
  await rename(env, id, RENAME);
  const first = await sentPhoto(env, cookies, MADE);
  // The upload's check finds the event at MADE, provisional; then an admin
  // approves, which makes REMADE, while the sizes are stored, just before the
  // photo's own insert.
  let approved = null;
  landsBefore(env, 'INSERT INTO photos', async () => {
    assert.deepEqual(album(env, id).address, MADE, 'the check ran before the approval');
    approved = await approve(env, [first]);
  });
  const res = await sendPhoto(env, cookies, MADE);
  assert.deepEqual(approved, { done: 'approved', photo: String(first) }, 'the approval landed before the insert');
  assert.equal(res.status, 201);
  const { id: photo } = await res.json();
  assert.deepEqual(row(env, photo), { state: 'pending', album: id });
  assert.deepEqual([album(env, id).address, album(env, id).earlier], [REMADE, MADE]);
});

test('#273 criterion 10: a clip started before the first approval completes after it, in the event, since its parts and its complete go by its id', async () => {
  const { env, id, cookies } = await site();
  await rename(env, id, RENAME);
  const photo = await sentPhoto(env, cookies, MADE);
  let approval = [];
  const clip = await sendClip(env, cookies, MADE, {
    before: async () => {
      // Cleared first, so the control below reads the approval's own
      // statements and not every one since the site was made (#273's review:
      // createEvent's insert alone satisfied it with no approval at all).
      env.DB.statements.length = 0;
      assert.deepEqual(await approve(env, [photo]), { done: 'approved', photo: String(photo) });
      approval = [...env.DB.statements];
      env.DB.statements.length = 0;
    },
  });
  assert.equal(clip.res.status, 201);
  assert.deepEqual(row(env, clip.id), { state: 'pending', album: id });
  assert.deepEqual([album(env, id).address, album(env, id).earlier], [REMADE, MADE]);
  // The control: the complete reads and writes the clip by its id and its
  // album_id, and names no address, which the approval's statements do.
  assert.ok(approval.some((sql) => /\baddress\b/.test(sql)), 'the approval named no address, so the check below proves nothing');
  assert.ok(env.DB.statements.length > 0);
  assert.deepEqual(env.DB.statements.filter((sql) => /\baddress\b/.test(sql)), []);
});

test('#273 criterion 10: the address an event had before its first approval never opens its public album page; the address it has does', async () => {
  const { env } = await remade();
  const get = (address) => chain(
    [root, albumPage.onRequestGet, () => new Response('the site\'s 404 page', { status: 404 })],
    new Request(`${SITE}/albums/${address}/`), env, { address },
  );
  const old = await get(MADE);
  assert.equal(old.status, 404);
  assert.equal(await old.text(), 'the site\'s 404 page');
  assert.equal((await get(REMADE)).status, 200);
});
