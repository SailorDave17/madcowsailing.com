// "Not sure / other event" (#228): each team's album for photos from an event
// nobody has added yet (migration 0015), the queue's "Move to event", and the
// refusal to approve a photo still in it. Every request runs through the
// chain Pages runs in front of the route, against a real SQLite holding the
// real migrations (test/d1.js), an R2 stand-in and an admin's session minted
// by test/admin.js. Each test names the criterion it holds. The share page's
// half of criterion 1 is in test/share.test.js, through the real upload route.
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as albumsPage } from '../functions/admin/albums.js';
import { onRequestGet as queuePage } from '../functions/admin/queue.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequestPost as closePost } from '../functions/api/admin/albums/close.js';
import { onRequestPost as reopenPost } from '../functions/api/admin/albums/reopen.js';
import { onRequestPost as updatePost } from '../functions/api/admin/albums/update.js';
import { onRequestPost as deletePost } from '../functions/api/admin/albums/delete.js';
import { onRequestPost as approvePost } from '../functions/api/admin/queue/approve.js';
import { onRequestGet as moveGet, onRequestPost as movePost } from '../functions/api/admin/queue/move.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openList } from '../functions/api/albums/open.js';
import * as listRoute from '../functions/index.js';
import * as albumRoute from '../functions/albums/[address]/index.js';
import * as imageRoute from '../functions/photos/[id]/[size].js';
import * as hooverRoute from '../functions/hoover-jrt/index.js';
import * as cohssaRoute from '../functions/cohssa/index.js';
import { queueNotice } from '../lib/admin-page.js';
import { NOT_SURE_TITLE, createAlbum, isDate, openAlbum, readAlbumFields } from '../lib/albums.js';
import { hidePhotos } from '../lib/people.js';
import { clipObjectKey, photoObjectKeys } from '../lib/photos.js';
import { PART_PHOTOS, movePhotos } from '../lib/queue.js';
import { WAITING_WHEN_HIDDEN, restorePhoto } from '../lib/removals.js';
import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import { nowSeconds } from '../lib/session.js';
import { TEAMS } from '../lib/teams.js';
import { ADMIN_KEY, adminCookieHeader, seedAdmin } from './admin.js';
import { d1 } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = new URL('../migrations/', import.meta.url);
const SITE = 'https://photos.madcowsailing.com';
const T0 = 1_790_000_000;
const BATCH_A = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';
const BATCH_B = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const SPRING = { team: 'hoover-jrt', title: 'Spring series', kind: 'regatta', date: '2026-05-02' };
const DISTRICTS = { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' };
const NOT_SURE = { 'hoover-jrt': '0001-01-01-not-sure-hoover-jrt', cohssa: '0001-01-01-not-sure-cohssa' };

afterEach(() => mock.restoreAll());

/**
 * A site with Hoover JRT's Fall Regatta (open) and Spring series (closed),
 * COHSSA's Districts, and the owner, account 1, whose session every admin
 * request sends.
 */
async function site() {
  const env = { DB: d1(), MEDIA: r2(), SESSION_SIGNING_KEY: ADMIN_KEY };
  seedAdmin(env.DB);
  const fall = await createAlbum(env.DB, FALL, T0);
  const spring = await createAlbum(env.DB, SPRING, T0);
  env.DB.sqlite.prepare('UPDATE albums SET closed_at = ? WHERE address = ?').run(T0, spring);
  const districts = await createAlbum(env.DB, DISTRICTS, T0);
  return { env, fall, spring, districts };
}

const albumId = (env, address) => env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;

let keys = 0;
const OBJECTS = { grid: jpeg({ width: 4, height: 3 }), screen: jpeg({ width: 8, height: 6 }), full: jpeg({ width: 16, height: 12 }) };

/**
 * A photo as the upload route leaves it, in `state`, with its three objects.
 * An approved or hidden one is approved a second after it was sent, unless
 * `approvedAt` says otherwise (0 is a photo hidden while it waited, #225).
 */
function seedPhoto(env, address, { batch = BATCH_A, state = 'pending', caption = null, sentAt = T0, approvedAt = sentAt + 1 } = {}) {
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'caption, captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, ' +
    "bytes, approved_at, hidden_at) VALUES (?, 'photo', ?, ?, ?, 'parent', 1, ?, ?, ?, ?, 2560, 1920, 480, 360, 1600, 1200, 1000, ?, ?)",
  ).run(albumId(env, address), state, mediaKey, batch, sentAt - 60, caption, sentAt - 3600, sentAt,
    state === 'pending' ? null : approvedAt, state === 'hidden' ? sentAt + 2 : null);
  for (const [size, key] of Object.entries(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: OBJECTS[size], httpMetadata: { contentType: 'image/jpeg' } });
  }
  return Number(lastInsertRowid);
}

const photo = (env, id) => ({ ...env.DB.sqlite.prepare(
  'SELECT p.state, p.caption, p.batch, a.address FROM photos AS p JOIN albums AS a ON a.id = p.album_id WHERE p.id = ?',
).get(id) });
const albumCount = (env) => env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM albums').get().n;

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const ADMIN_ROUTES = {
  '/admin/queue': queuePage,
  '/admin/albums': albumsPage,
  '/api/admin/queue/approve': approvePost,
  '/api/admin/queue/move': movePost,
  '/api/admin/albums/close': closePost,
  '/api/admin/albums/reopen': reopenPost,
  '/api/admin/albums/update': updatePost,
  '/api/admin/albums/delete': deletePost,
};

/** An admin's request: a GET of a page, or a form post to a route, with the site's Origin. */
async function admin(env, path, fields = null) {
  const url = new URL(path, SITE);
  const headers = { Cookie: await adminCookieHeader(1) };
  if (fields) Object.assign(headers, { Origin: SITE, 'Content-Type': 'application/x-www-form-urlencoded' });
  const request = new Request(url, { method: fields ? 'POST' : 'GET', headers, body: fields ? new URLSearchParams(fields).toString() : undefined });
  const guards = url.pathname.startsWith('/api/') ? adminApi : adminPages;
  return chain([root, ...guards, ADMIN_ROUTES[url.pathname]], request, env);
}

/** Where a press sent the browser: its path, query and fragment. */
const landing = (res) => {
  assert.equal(res.status, 303);
  const url = new URL(res.headers.get('Location'), SITE);
  return { path: url.pathname, query: Object.fromEntries(url.searchParams), hash: url.hash };
};

const queue = async (env, query = '') => (await admin(env, `/admin/queue${query}`)).text();

// ---- Reading the queue's forms, as a browser submits them --------------------

const attr = (attrs, name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** Each batch form: its section's id, its title, hidden fields, Move choices and buttons. */
function batches(html) {
  return [...html.matchAll(/<section class="wrap batch" id="([^"]+)"[\s\S]*?<h2 [^>]*>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/g)]
    .map(([, id, title, inner]) => ({
      id,
      title,
      inner,
      ids: inner.match(/<input type="hidden" name="ids" value="([^"]*)">/)[1],
      anchor: inner.match(/<input type="hidden" name="anchor" value="([^"]*)">/)[1],
      choices: [...(inner.match(/<select [^>]*name="to">([\s\S]*?)<\/select>/)?.[1] ?? '').matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
        .map(([, value, text]) => ({ value, text })),
      buttons: [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, a, text]) => ({
        formaction: attr(a, 'formaction'), name: attr(a, 'name'), value: attr(a, 'value'), label: attr(a, 'aria-label'), text,
      })),
    }));
}

/**
 * Press a Move button in `batch`: `which` is a photo's id or "all", `to` the
 * chosen value, and `extra` the new event's fields or typed captions.
 */
async function move(env, batch, which, to, extra = {}) {
  const button = batch.buttons.find((b) => b.name === 'move' && b.value === String(which));
  assert.ok(button, `no Move button for ${which}`);
  return admin(env, button.formaction, { ids: batch.ids, anchor: batch.anchor, move: button.value, to, ...extra });
}

const validator = new HtmlValidate(new FileSystemConfigLoader());
const problems = async (html) =>
  (await validator.validateString(html, join(ROOT, 'admin.html'))).results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

// ---- Criterion 5 and the guard: migration 0015 ---------------------------------

test('0015 gives each team one open Not sure album, and every album made before it stays an event, unchanged', () => {
  // The schema before 0015, with albums in it, as production holds them.
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).sort().filter((f) => f < '0015')) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  const insert = sqlite.prepare('INSERT INTO albums (address, team, title, kind, held_on, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('2026-09-30-production-check-test', 'hoover-jrt', 'Production check (test)', 'regatta', '2026-09-30', 1, null);
  insert.run('2026-10-04-districts', 'cohssa', 'Districts', 'regatta', '2026-10-04', 2, 3);
  const schema = () => sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE name <> 'albums' ORDER BY type, name").all().map((r) => ({ ...r }));
  const all = () => sqlite.prepare('SELECT * FROM albums ORDER BY id').all().map((r) => ({ ...r }));
  const before = { rows: all(), schema: schema() };
  sqlite.exec(readFileSync(new URL('0015_not_sure_albums.sql', MIGRATIONS), 'utf8'));
  const after = { rows: all(), schema: schema() };
  assert.deepEqual(after.rows.slice(0, 2), before.rows.map((r) => ({ ...r, holding: 0 })));
  const made = after.rows.slice(2).map(({ address, team, title, closed_at: closed, holding }) => ({ address, team, title, closed, holding }));
  assert.deepEqual(made.sort((a, b) => a.team.localeCompare(b.team)), TEAMS.map(({ team }) => (
    { address: NOT_SURE[team], team, title: NOT_SURE_TITLE, closed: null, holding: 1 })).sort((a, b) => a.team.localeCompare(b.team)));
  const added = after.schema.filter((entry) => !before.schema.some((old) => old.name === entry.name));
  assert.deepEqual(added.map((entry) => `${entry.type} ${entry.name}`), [
    'index albums_holding_one_per_team',
    'trigger albums_holding_fixed', 'trigger albums_holding_kept_on_delete', 'trigger albums_holding_kept_on_replace',
    'trigger albums_holding_kept_on_update',
    'trigger photos_not_sure_never_shown_on_insert', 'trigger photos_not_sure_never_shown_on_update',
  ]);
  assert.deepEqual(after.schema.filter((entry) => before.schema.some((old) => old.name === entry.name)), before.schema);
});

test('the Not sure title is one sentence in the migration, lib/albums.js and the share page, and its date is one no admin form takes', () => {
  const sql = readFileSync(new URL('0015_not_sure_albums.sql', MIGRATIONS), 'utf8');
  assert.ok(sql.includes(`'${NOT_SURE_TITLE}'`));
  assert.match(readFileSync(join(ROOT, 'public', 'js', 'share.js'), 'utf8'), new RegExp(`const NOT_SURE = '${NOT_SURE_TITLE.replace('/', '\\/')}';`));
  // So no event's address can be one of these: an album is dated through
  // readAlbumFields, which refuses a year under 100.
  assert.equal(isDate('0001-01-01'), false);
  assert.deepEqual(readAlbumFields({ ...FALL, date: '0001-01-01' }), { error: 'date' });
  assert.equal(isDate('2026-10-04'), true, 'the control');
});

test('every team has exactly one Not sure album, and the database refuses a second', () => {
  const { sqlite } = d1();
  for (const { team } of TEAMS) {
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM albums WHERE holding = 1 AND team = ?').get(team).n, 1, team);
  }
  const second = (team, address) => sqlite.prepare(
    "INSERT INTO albums (address, team, title, kind, held_on, created_at, holding) VALUES (?, ?, 'x', 'regatta', '0001-01-01', 1, 1)",
  ).run(address, team);
  assert.throws(() => second('hoover-jrt', '0001-01-01-again'), /a Not sure album cannot be replaced/);
  // A REPLACE would resolve the unique index by deleting the team's own (it
  // is empty, so no reference stops it): the trigger refuses first.
  assert.throws(() => sqlite.prepare(
    "REPLACE INTO albums (address, team, title, kind, held_on, created_at, holding) VALUES ('0001-01-01-again', 'hoover-jrt', 'x', 'regatta', '0001-01-01', 1, 1)",
  ).run(), /a Not sure album cannot be replaced/);
  // Moving one team's onto the other: a Not sure album's team never changes,
  // plain or OR REPLACE, which would otherwise delete the other team's.
  for (const verb of ['UPDATE', 'UPDATE OR REPLACE']) {
    assert.throws(() => sqlite.prepare(`${verb} albums SET team = 'hoover-jrt' WHERE holding = 1 AND team = 'cohssa'`).run(),
      /a Not sure album cannot be replaced/, verb);
  }
  assert.deepEqual(sqlite.prepare('SELECT address FROM albums WHERE holding = 1 ORDER BY team').all().map((r) => r.address),
    [NOT_SURE.cohssa, NOT_SURE['hoover-jrt']]);
  // The control: a team with none can have one, once.
  sqlite.prepare("INSERT INTO teams (team, name) VALUES ('third', 'Third')").run();
  second('third', '0001-01-01-not-sure-third');
  assert.throws(() => second('third', '0001-01-01-third-again'), /a Not sure album cannot be replaced/);
});

test('#228 criterion 4, in the database: a photo in a Not sure album is never approved, and is hidden only while waiting, however it is written', async () => {
  const { env, fall } = await site();
  const { sqlite } = env.DB;
  const notSure = NOT_SURE['hoover-jrt'];
  assert.throws(() => seedPhoto(env, notSure, { state: 'approved' }), /a photo in a Not sure album is never approved/);
  // Hidden after an approval (#158's takedown) is refused; hidden while
  // waiting (#225's Hide all, approved_at 0) is not.
  assert.throws(() => seedPhoto(env, notSure, { state: 'hidden' }), /a photo in a Not sure album is never approved/);
  const hiddenWaiting = seedPhoto(env, notSure, { state: 'hidden', approvedAt: 0 });
  // ...and it cannot be given an approval time while it sits there, which
  // "Put it back" would read as an approved photo's.
  assert.throws(() => sqlite.prepare('UPDATE photos SET approved_at = 5 WHERE id = ?').run(hiddenWaiting), /never approved/);
  // The control for each: the same rows go into an event.
  seedPhoto(env, fall, { state: 'approved' });
  seedPhoto(env, fall, { state: 'hidden' });
  const waiting = seedPhoto(env, notSure);
  assert.throws(() => sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = ?").run(waiting), /never approved/);
  assert.throws(() => sqlite.prepare("UPDATE photos SET state = 'hidden', approved_at = 5, hidden_at = 6 WHERE id = ?").run(waiting), /never approved/);
  // A photo approved in an event cannot be moved in.
  const shown = seedPhoto(env, fall, { state: 'approved' });
  assert.throws(() => sqlite.prepare('UPDATE photos SET album_id = ? WHERE id = ?').run(albumId(env, notSure), shown), /never approved/);
  assert.equal(photo(env, shown).address, fall);
  // The controls: the same approval in an event goes through, and a waiting
  // photo moves into a Not sure album and out again.
  sqlite.prepare('UPDATE photos SET album_id = ? WHERE id = ?').run(albumId(env, fall), waiting);
  sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = ?").run(waiting);
  assert.equal(photo(env, waiting).state, 'approved');
  const another = seedPhoto(env, fall);
  sqlite.prepare('UPDATE photos SET album_id = ? WHERE id = ?').run(albumId(env, notSure), another);
  assert.equal(photo(env, another).address, notSure);
});

test('holding never changes, a Not sure album is never deleted, and no REPLACE makes or removes one', async () => {
  const { env, fall } = await site();
  const { sqlite } = env.DB;
  const notSure = NOT_SURE['hoover-jrt'];
  assert.equal(sqlite.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0, 'the case the replace trigger exists for');
  assert.throws(() => sqlite.prepare('UPDATE albums SET holding = 0 WHERE address = ?').run(notSure), /albums\.holding never changes/);
  assert.throws(() => sqlite.prepare('UPDATE albums SET holding = 1 WHERE address = ?').run(fall), /albums\.holding never changes/);
  assert.throws(() => sqlite.prepare('DELETE FROM albums WHERE address = ?').run(notSure), /a Not sure album cannot be deleted/);
  const id = albumId(env, notSure);
  for (const sql of [
    // Its id or its address taken by an event, which would make its photos an event's.
    `REPLACE INTO albums (id, address, team, title, kind, held_on, created_at) VALUES (${id}, '2026-10-09-x', 'hoover-jrt', 'x', 'regatta', '2026-10-09', 1)`,
    `INSERT OR REPLACE INTO albums (address, team, title, kind, held_on, created_at) VALUES ('${notSure}', 'hoover-jrt', 'x', 'regatta', '2026-10-09', 1)`,
    // An event made a Not sure album, with whatever it holds.
    `REPLACE INTO albums (address, team, title, kind, held_on, created_at, holding) VALUES ('${fall}', 'cohssa', 'x', 'regatta', '0001-01-01', 1, 1)`,
  ]) {
    assert.throws(() => sqlite.prepare(sql).run(), /a Not sure album cannot be replaced/, sql);
  }
  assert.equal(sqlite.prepare('SELECT holding FROM albums WHERE address = ?').get(notSure).holding, 1);
  assert.equal(sqlite.prepare('SELECT holding FROM albums WHERE address = ?').get(fall).holding, 0);
  // Making one over an event for a team that has none: only the NEW.holding
  // arm can refuse it, since the clashing row is an event and the team has
  // no Not sure album yet (review-fanout at #228's review).
  sqlite.prepare("INSERT INTO teams (team, name) VALUES ('third', 'Third')").run();
  sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at) VALUES ('2026-10-09-third', 'third', 'x', 'regatta', '2026-10-09', 1)").run();
  assert.throws(() => sqlite.prepare(
    "REPLACE INTO albums (address, team, title, kind, held_on, created_at, holding) VALUES ('2026-10-09-third', 'third', 'x', 'regatta', '0001-01-01', 1, 1)",
  ).run(), /a Not sure album cannot be replaced/);
  assert.equal(sqlite.prepare("SELECT holding FROM albums WHERE address = '2026-10-09-third'").get().holding, 0);
  // UPDATE OR REPLACE, both ways (review-fanout at #228's review). The worst
  // case: the Not sure album taking an event's id deletes the event and puts
  // its approved photo inside the Not sure album, with no write to photos.
  const shown = seedPhoto(env, fall, { state: 'approved' });
  const spring = sqlite.prepare("SELECT address FROM albums WHERE title = 'Spring series'").get().address;
  for (const sql of [
    `UPDATE OR REPLACE albums SET id = ${albumId(env, fall)} WHERE address = '${notSure}'`,
    `UPDATE OR REPLACE albums SET address = '${fall}' WHERE address = '${notSure}'`,
    `UPDATE OR REPLACE albums SET id = ${id} WHERE address = '${spring}'`,
    `UPDATE OR REPLACE albums SET address = '${notSure}' WHERE address = '${spring}'`,
  ]) {
    assert.throws(() => sqlite.prepare(sql).run(), /a Not sure album cannot be replaced/, sql);
  }
  assert.deepEqual(photo(env, shown), { state: 'approved', caption: null, batch: BATCH_A, address: fall });
  assert.equal(albumId(env, notSure), id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM albums WHERE address IN (?, ?)').get(fall, spring).n, 2);
  // The controls: a title edit and a close of a Not sure album go through, so
  // does a statement naming its address and team with their own values, and
  // an event moved or replaced by an event is no concern of these triggers.
  sqlite.prepare("UPDATE albums SET title = 'y', closed_at = 1 WHERE address = ?").run(notSure);
  sqlite.prepare('UPDATE albums SET address = address, team = team WHERE holding = 1').run();
  sqlite.prepare(`UPDATE OR REPLACE albums SET id = 999 WHERE address = '${spring}'`).run();
  sqlite.prepare(`REPLACE INTO albums (address, team, title, kind, held_on, created_at) VALUES ('${spring}', 'hoover-jrt', 'Spring', 'regatta', '2026-05-02', 1)`).run();
});

test('#228 criterion 5: photos.album_id keeps its reference, so an event holding a moved photo, and a Not sure album, are not deleted', async () => {
  const { env, fall } = await site();
  const id = seedPhoto(env, NOT_SURE['hoover-jrt']);
  const [batch] = batches(await queue(env));
  landing(await move(env, batch, id, fall));
  assert.deepEqual(landing(await admin(env, '/api/admin/albums/delete', { address: fall })).query, { error: 'not-empty', album: fall, photos: '1' });
  // #198: a clip moved in holds it too, counted apart from the photo.
  const clip = seedClip(env, NOT_SURE['hoover-jrt'], { batch: BATCH_B });
  landing(await move(env, batches(await queue(env)).find((b) => b.ids === String(clip)), clip, fall));
  assert.deepEqual(landing(await admin(env, '/api/admin/albums/delete', { address: fall })).query, { error: 'not-empty', album: fall, photos: '1', clips: '1' });
  for (const address of Object.values(NOT_SURE)) {
    assert.deepEqual(landing(await admin(env, '/api/admin/albums/delete', { address })).query, { error: 'not-sure' }, address);
  }
  assert.equal(albumCount(env), 5);
  // The reference itself: photos.album_id names albums (id), with no ON DELETE.
  const [ref] = env.DB.sqlite.prepare("SELECT * FROM pragma_foreign_key_list('photos') WHERE \"table\" = 'albums'").all();
  assert.deepEqual({ from: ref.from, to: ref.to, onDelete: ref.on_delete }, { from: 'album_id', to: 'id', onDelete: 'NO ACTION' });
});

// ---- Criterion 1: offered to senders, kept by the admins ----------------------

// The open list as a sender approved for both teams sees it: an account is
// offered its approved teams' albums only (#223), and since #226 an account's
// is the only session. Account 50, so it meets none a test makes itself.
const SENDER = 50;
async function openCall(env) {
  env.DB.sqlite.prepare("INSERT OR IGNORE INTO accounts (id, email, name, role, requested_at) VALUES (?, 'sender@example.org', 'Sam Sender', 'parent', 1)").run(SENDER);
  for (const { team } of TEAMS) {
    env.DB.sqlite.prepare("INSERT OR IGNORE INTO account_teams (account_id, team, state) VALUES (?, ?, 'approved')").run(SENDER, team);
  }
  const cookie = await signAccountSession(ADMIN_KEY, { accountId: SENDER, version: 1 }, nowSeconds());
  const request = new Request(`${SITE}/api/albums/open`, { headers: { Cookie: `${ACCOUNT_COOKIE}=${cookie}` } });
  return (await chain([root, albumsGuard, openList], request, { ...env, SESSION_SIGNING_KEY: ADMIN_KEY })).json();
}

test('#228 criterion 1: the open list gives each team\'s Not sure album apart from the events, and a closed one is not offered', async () => {
  const { env, fall, districts } = await site();
  // In the teams' order whatever order the rows were made in: COHSSA's is
  // given the later id here, so newest-made first would list it first.
  env.DB.sqlite.prepare('UPDATE albums SET id = 99 WHERE address = ?').run(NOT_SURE.cohssa);
  const listed = await openCall(env);
  assert.deepEqual(listed.albums.map((a) => a.address), [districts, fall], 'the events, newest first, and only them');
  assert.deepEqual(listed.other, [
    { address: NOT_SURE['hoover-jrt'], team: 'hoover-jrt', teamName: 'Hoover JRT' },
    { address: NOT_SURE.cohssa, team: 'cohssa', teamName: 'COHSSA' },
  ]);
  // An upload can name it while it is open, and not once it is closed.
  assert.equal((await openAlbum(env.DB, NOT_SURE.cohssa)).holding, true);
  landing(await admin(env, '/api/admin/albums/close', { address: NOT_SURE.cohssa }));
  assert.deepEqual((await openCall(env)).other.map((a) => a.team), ['hoover-jrt']);
  assert.equal(await openAlbum(env.DB, NOT_SURE.cohssa), null);
  landing(await admin(env, '/api/admin/albums/reopen', { address: NOT_SURE.cohssa }));
  assert.deepEqual((await openCall(env)).other.map((a) => a.team), ['hoover-jrt', 'cohssa']);
});

test('/admin/albums lists each team\'s Not sure album apart, with Close and Reopen only, named with its team', async () => {
  const { env, fall } = await site();
  let html = await (await admin(env, '/admin/albums')).text();
  const section = html.split('<h2 id="not-sure-albums">')[1];
  assert.ok(section, 'the section');
  assert.deepEqual([...section.matchAll(/<h3 id="album-\d+">([^<]*)<\/h3>/g)].map((m) => m[1]).sort(), ['COHSSA', 'Hoover JRT']);
  for (const address of Object.values(NOT_SURE)) {
    const forms = [...html.matchAll(new RegExp(`<form method="post" action="([^"]+)"[^>]*>\\s*<input type="hidden" name="address" value="${address}">`, 'g'))];
    assert.deepEqual(forms.map((m) => m[1]), ['/api/admin/albums/close'], `${address}: Close, and no Edit or Delete`);
  }
  assert.match(html, /aria-label="Close Not sure \/ other event for Hoover JRT">Close<\/button>/);
  // The events' lists hold no Not sure album; the control is that its own section does.
  const [events, own] = html.split('<section class="wrap" aria-labelledby="not-sure-albums">');
  assert.doesNotMatch(events, /0001-01-01-not-sure/);
  assert.match(own, /0001-01-01-not-sure-hoover-jrt/);
  assert.deepEqual(await problems(html), []);
  // Closing says what it does to a Not sure album, which has no public photos.
  const closed = landing(await admin(env, '/api/admin/albums/close', { address: NOT_SURE['hoover-jrt'] }));
  html = await (await admin(env, `/admin/albums?${new URLSearchParams(closed.query)}`)).text();
  assert.match(html, /<p role="status">Closed Not sure \/ other event for Hoover JRT\. Parents can no longer choose it; its waiting photos stay in the queue\.<\/p>/);
  assert.match(html, /aria-label="Reopen Not sure \/ other event for Hoover JRT">Reopen<\/button>/);
  // An event's notice is as before: the control.
  const event = landing(await admin(env, '/api/admin/albums/close', { address: fall }));
  assert.match(await (await admin(env, `/admin/albums?${new URLSearchParams(event.query)}`)).text(), /Closed Fall Regatta\. Parents can no longer send photos to it, and its approved photos stay public\./);
});

test('an edit or a delete naming a Not sure album changes nothing, and the page says why', async () => {
  const { env, fall } = await site();
  const notSure = NOT_SURE['hoover-jrt'];
  const before = env.DB.sqlite.prepare('SELECT * FROM albums WHERE address = ?').get(notSure);
  assert.deepEqual(landing(await admin(env, '/api/admin/albums/update', { ...FALL, address: notSure })).query, { error: 'not-sure' });
  assert.deepEqual(landing(await admin(env, '/api/admin/albums/delete', { address: notSure })).query, { error: 'not-sure' });
  assert.deepEqual({ ...env.DB.sqlite.prepare('SELECT * FROM albums WHERE address = ?').get(notSure) }, { ...before });
  assert.match(await (await admin(env, '/admin/albums?error=not-sure')).text(),
    /<p role="status">Nothing was changed: a team's "Not sure \/ other event" is only closed and reopened, never edited or deleted\.<\/p>/);
  // The controls: an event edits and deletes, and an unknown address is missing, not a Not sure album.
  assert.equal(landing(await admin(env, '/api/admin/albums/update', { ...FALL, title: 'Fall', address: fall })).query.done, 'saved');
  assert.equal(landing(await admin(env, '/api/admin/albums/delete', { address: fall })).query.done, 'deleted');
  assert.deepEqual(landing(await admin(env, '/api/admin/albums/update', { ...FALL, address: '2026-10-09-nothing' })).query, { error: 'missing' });
});

// ---- Criterion 2: nothing public lists or links it, or serves its photos -------

const STATIC_404 = () => new Response('the site\'s 404 page', { status: 404 });
const SECTIONS = { 'hoover-jrt': hooverRoute, cohssa: cohssaRoute };

function publicGet(env, path) {
  const url = new URL(path, SITE);
  let handlers;
  let params = {};
  let m;
  if (url.pathname === '/') handlers = [root, listRoute.onRequestGet];
  else if ((m = url.pathname.match(/^\/([a-z-]+)\/$/)) && SECTIONS[m[1]]) handlers = [root, SECTIONS[m[1]].onRequestGet];
  else if ((m = url.pathname.match(/^\/albums\/([^/]+)\/$/))) {
    handlers = [root, albumRoute.onRequestGet, STATIC_404];
    params = { address: m[1] };
  } else if ((m = url.pathname.match(/^\/photos\/(\d+)\/([a-z]+)$/))) {
    handlers = [root, imageRoute.onRequestGet];
    params = { id: m[1], size: m[2] };
  }
  return chain(handlers, new Request(url), env, params);
}

test('#228 criterion 2: nothing public lists or links Not sure / other event, and none of its photos is served', async () => {
  const { env, fall } = await site();
  const shown = seedPhoto(env, fall, { state: 'approved' });
  const waiting = [seedPhoto(env, NOT_SURE['hoover-jrt']), seedPhoto(env, NOT_SURE.cohssa)];
  for (const path of ['/', '/hoover-jrt/', '/cohssa/']) {
    const res = await publicGet(env, path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.doesNotMatch(html, /not-sure|Not sure|other event|0001-01-01/i, path);
  }
  for (const address of Object.values(NOT_SURE)) {
    assert.equal((await publicGet(env, `/albums/${address}/`)).status, 404, address);
  }
  for (const id of waiting) {
    for (const size of ['grid', 'screen', 'full']) {
      assert.equal((await publicGet(env, `/photos/${id}/${size}`)).status, 404, `${id}/${size}`);
    }
  }
  // The controls: the event's approved photo and page are served, and so is
  // a Not sure photo once it is moved into the event and approved there.
  assert.match(await (await publicGet(env, '/hoover-jrt/')).text(), /Fall Regatta/);
  assert.equal((await publicGet(env, `/albums/${fall}/`)).status, 200);
  assert.equal((await publicGet(env, `/photos/${shown}/grid`)).status, 200);
  const [batch] = batches(await queue(env, '?team=hoover-jrt'));
  landing(await move(env, batch, waiting[0], fall));
  const [moved] = batches(await queue(env, '?team=hoover-jrt'));
  landing(await admin(env, moved.buttons.find((b) => b.name === 'approve').formaction, { ids: moved.ids, anchor: moved.anchor, approve: String(waiting[0]) }));
  assert.equal((await publicGet(env, `/photos/${waiting[0]}/grid`)).status, 200);
});

// ---- Criterion 3: "Move to event" ---------------------------------------------

test('#228 criterion 3: each batch offers its team\'s events, open or closed, newest first, then a new one; never another team\'s, a Not sure album, or its own', async () => {
  const { env, fall, spring } = await site();
  seedPhoto(env, NOT_SURE['hoover-jrt']);
  seedPhoto(env, NOT_SURE['hoover-jrt']);
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 5 });
  const [notSure, inFall] = batches(await queue(env));
  assert.equal(notSure.title, 'Not sure / other event');
  assert.deepEqual(notSure.choices, [
    { value: '', text: 'Choose an event' },
    { value: fall, text: 'Fall Regatta (4 October 2026)' },
    { value: spring, text: 'Spring series (2 May 2026, closed)' },
    { value: 'new', text: 'A new event, below' },
  ]);
  // A batch in an event is offered the team's others.
  assert.deepEqual(inFall.choices.map((c) => c.value), ['', spring, 'new']);
  // Move under each photo, and Move all for a batch of two, each named.
  const moves = notSure.buttons.filter((b) => b.name === 'move');
  assert.deepEqual(moves.map((b) => [b.value, b.text]), [['all', 'Move all 2'], ...notSure.ids.split(' ').map((id) => [id, 'Move'])]);
  assert.ok(moves.every((b) => b.formaction === '/api/admin/queue/move'));
  assert.match(moves[1].label, /^Move photo \d+ to the event chosen above$/);
  assert.match(notSure.inner, /<legend>A new event for Hoover JRT<\/legend>/);
});

test('#228 criterion 3: Move takes one photo, then the rest, into the chosen event, waiting, with the captions typed and its batch, and lands there', async () => {
  const { env, fall } = await site();
  const one = seedPhoto(env, NOT_SURE['hoover-jrt'], { caption: 'old' });
  const two = seedPhoto(env, NOT_SURE['hoover-jrt']);
  const three = seedPhoto(env, NOT_SURE['hoover-jrt']);
  let [batch] = batches(await queue(env));
  const where = landing(await move(env, batch, one, fall, { [`caption-${one}`]: 'Start line', [`caption-${two}`]: 'Mark rounding' }));
  // On the moved photo, ready to approve in its event (owner, at #270's pickup).
  assert.deepEqual(where.query, { done: 'moved', photo: String(one), album: fall, at: `photo-${one}` });
  assert.equal(where.hash, `#photo-${one}`);
  assert.deepEqual(photo(env, one), { state: 'pending', caption: 'Start line', batch: BATCH_A, address: fall });
  // Every press saves the batch's captions; the photo not moved keeps waiting where it was.
  assert.deepEqual(photo(env, two), { state: 'pending', caption: 'Mark rounding', batch: BATCH_A, address: NOT_SURE['hoover-jrt'] });
  const html = await queue(env, `?${new URLSearchParams(where.query)}`);
  assert.match(html, new RegExp(`<p role="status">Moved photo ${one} to Fall Regatta \\(Hoover JRT, 4 October 2026\\)\\. It waits there, ready to approve\\.</p>`));
  // The moved photo is now a batch of the event, which can be approved.
  const moved = batches(html).find((b) => b.ids === String(one));
  assert.equal(moved.title, 'Fall Regatta');
  assert.ok(moved.buttons.some((b) => b.name === 'approve' && b.value === String(one)));
  [batch] = batches(html).filter((b) => b.title === 'Not sure / other event');
  const all = landing(await move(env, batch, 'all', fall));
  // Move all lands on the first photo it moved.
  assert.deepEqual(all.query, { done: 'moved', n: '2', album: fall, at: `photo-${two}` });
  assert.deepEqual([one, two, three].map((id) => photo(env, id).address), [fall, fall, fall]);
});

test('#228 criterion 3: any waiting photo moves, from an event too, and into a closed event', async () => {
  const { env, fall, spring } = await site();
  const id = seedPhoto(env, fall);
  const [batch] = batches(await queue(env));
  assert.deepEqual(landing(await move(env, batch, id, spring)).query, { done: 'moved', photo: String(id), album: spring, at: `photo-${id}` });
  assert.deepEqual(photo(env, id), { state: 'pending', caption: null, batch: BATCH_A, address: spring });
});

test('#228 criterion 3: "A new event" adds the batch\'s team\'s event from the queue and moves the photos into it', async () => {
  const { env } = await site();
  const ids = [seedPhoto(env, NOT_SURE.cohssa), seedPhoto(env, NOT_SURE.cohssa)];
  const [batch] = batches(await queue(env));
  const before = albumCount(env);
  const where = landing(await move(env, batch, 'all', 'new', { 'new-title': 'League day', 'new-kind': 'practice', 'new-date': '2026-10-03' }));
  assert.deepEqual(where.query, { done: 'moved', n: '2', album: '2026-10-03-league-day', made: '1', at: `photo-${ids[0]}` });
  assert.equal(albumCount(env), before + 1);
  const made = env.DB.sqlite.prepare('SELECT team, title, kind, held_on, closed_at, holding FROM albums WHERE address = ?').get('2026-10-03-league-day');
  assert.deepEqual({ ...made }, { team: 'cohssa', title: 'League day', kind: 'practice', held_on: '2026-10-03', closed_at: null, holding: 0 });
  assert.deepEqual(ids.map((id) => photo(env, id).address), ['2026-10-03-league-day', '2026-10-03-league-day']);
  assert.match(await queue(env, `?${new URLSearchParams(where.query)}`),
    /<p role="status">Added League day \(COHSSA, 3 October 2026\) to the events\. Moved 2 photos to League day \(COHSSA, 3 October 2026\)\. They wait there, ready to approve\.<\/p>/);
});

test('#228 criterion 3: no event chosen, or a new one with a wrong field, moves nothing and adds nothing, and keeps the captions typed', async () => {
  const { env } = await site();
  const id = seedPhoto(env, NOT_SURE['hoover-jrt']);
  const [batch] = batches(await queue(env));
  const before = albumCount(env);
  const cases = [
    ['', {}, 'target'],
    ['new', { 'new-kind': 'regatta', 'new-date': '2026-10-03' }, 'new-title'],
    ['new', { 'new-title': 'x'.repeat(81), 'new-kind': 'regatta', 'new-date': '2026-10-03' }, 'new-title'],
    ['new', { 'new-title': 'League day', 'new-date': '2026-10-03' }, 'new-kind'],
    ['new', { 'new-title': 'League day', 'new-kind': 'regatta', 'new-date': '2026-02-30' }, 'new-date'],
    ['new', { 'new-title': 'League day', 'new-kind': 'regatta', 'new-date': '0001-01-01' }, 'new-date'],
  ];
  for (const [to, extra, error] of cases) {
    const where = landing(await move(env, batch, id, to, { ...extra, [`caption-${id}`]: `typed ${error}` }));
    assert.equal(where.query.error, error, JSON.stringify(extra));
    // At the batch, where its Move choices are (#270; review-fanout at #270's
    // review: held by no test).
    assert.deepEqual([where.query.at, where.hash], [batch.id, `#${batch.id}`], JSON.stringify(extra));
    assert.deepEqual(photo(env, id), { state: 'pending', caption: `typed ${error}`, batch: BATCH_A, address: NOT_SURE['hoover-jrt'] });
  }
  assert.equal(albumCount(env), before);
  assert.match(await queue(env, '?error=target'), /<p role="status">No photo was moved: choose one of the team's events under "Move to event", or "A new event" and its title, kind and date\.<\/p>/);
  // When every address the new event's date and title can take is held, it says so.
  for (let n = 1; n <= 50; n++) {
    env.DB.sqlite.prepare("INSERT INTO albums (address, team, title, kind, held_on, created_at) VALUES (?, 'hoover-jrt', 'x', 'regatta', '2026-10-03', 1)")
      .run(n === 1 ? '2026-10-03-league-day' : `2026-10-03-league-day-${n}`);
  }
  assert.equal(landing(await move(env, batch, id, 'new', { 'new-title': 'League day', 'new-kind': 'regatta', 'new-date': '2026-10-03' })).query.error, 'new-full');
  assert.equal(photo(env, id).address, NOT_SURE['hoover-jrt']);
});

test('#228 criterion 3: a move never crosses a team or lands in a Not sure album, however the press is made', async () => {
  const { env, fall, districts } = await site();
  const hoover = seedPhoto(env, NOT_SURE['hoover-jrt']);
  const cohssa = seedPhoto(env, districts, { batch: BATCH_B });
  const inFall = seedPhoto(env, fall, { batch: BATCH_B });
  const [batch] = batches(await queue(env)).filter((b) => b.ids === String(hoover));
  for (const to of [districts, NOT_SURE.cohssa, NOT_SURE['hoover-jrt'], '2026-10-09-nothing', '<b>x</b>']) {
    assert.equal(landing(await move(env, batch, hoover, to)).query.error, 'target', to);
  }
  // A press naming both teams' photos (a stale page, or a forged one) moves
  // neither, with its own word, since the captions it carried were saved.
  const both = landing(await admin(env, '/api/admin/queue/move', { ids: `${hoover} ${cohssa}`, move: 'all', to: fall, [`caption-${hoover}`]: 'kept' }));
  assert.equal(both.query.error, 'teams');
  assert.deepEqual([hoover, cohssa].map((id) => photo(env, id).address), [NOT_SURE['hoover-jrt'], districts]);
  assert.equal(photo(env, hoover).caption, 'kept');
  assert.match(await queue(env, '?error=teams'), /<p role="status">No photo was moved: those photos are in two teams' events now, since this page was loaded\. Reload the page and move each batch from there\. The captions typed were saved\.<\/p>/);
  env.DB.sqlite.prepare('UPDATE photos SET caption = NULL WHERE id = ?').run(hoover);
  // The statement holds it too, whatever a route checked first. Since #198 it
  // answers the ids moved and which of them are clips.
  const none = { moved: [], clips: [] };
  assert.deepEqual(await movePhotos(env.DB, [hoover], districts), none);
  assert.deepEqual(await movePhotos(env.DB, [inFall], NOT_SURE['hoover-jrt']), none);
  env.DB.sqlite.prepare("UPDATE albums SET team = 'cohssa' WHERE address = ?").run(fall);
  assert.deepEqual(await movePhotos(env.DB, [hoover], fall), none, 'an event moved to the other team meanwhile takes nothing');
  assert.equal(photo(env, hoover).address, NOT_SURE['hoover-jrt']);
  // The control: the same call into its own team's event moves it.
  env.DB.sqlite.prepare("UPDATE albums SET team = 'hoover-jrt' WHERE address = ?").run(fall);
  assert.deepEqual(await movePhotos(env.DB, [hoover], fall), { moved: [hoover], clips: [] });
});

test('#228 criterion 3: a photo no longer waiting is not moved, and the queue says so', async () => {
  const { env, fall, spring } = await site();
  const id = seedPhoto(env, fall);
  const [batch] = batches(await queue(env));
  // The statement moves no photo already in that event, and the control: it moves this one elsewhere.
  assert.deepEqual(await movePhotos(env.DB, [id], fall), { moved: [], clips: [] });
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = ?").run(id);
  assert.equal(landing(await move(env, batch, id, spring)).query.error, 'gone');
  assert.equal(photo(env, id).address, fall);
  // The statement holds it too, not only the route's read before it.
  assert.deepEqual(await movePhotos(env.DB, [id], spring), { moved: [], clips: [] });
  env.DB.sqlite.prepare("UPDATE photos SET state = 'pending', approved_at = NULL WHERE id = ?").run(id);
  assert.deepEqual(await movePhotos(env.DB, [id], spring), { moved: [id], clips: [] }, 'the control: waiting, it moves');
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5, album_id = ? WHERE id = ?").run(albumId(env, fall), id);
  assert.match(await queue(env, '?error=gone'), /No photo was approved, rejected or moved: those photos are no longer waiting/);
  // Nor is a new event made for it: the photos are read before the event is.
  const before = albumCount(env);
  assert.deepEqual(landing(await move(env, batch, id, 'new', { 'new-title': 'League day', 'new-kind': 'regatta', 'new-date': '2026-10-03' })).query,
    { error: 'gone' });
  assert.equal(albumCount(env), before);
  // When the photos go between that read and the move, the event made is
  // kept, and the notice says both.
  await createAlbum(env.DB, { team: 'hoover-jrt', title: 'League day', kind: 'regatta', date: '2026-10-03' }, T0);
  assert.match(await queue(env, '?error=gone&album=2026-10-03-league-day&made=1'),
    /<p role="status">Added League day \(Hoover JRT, 3 October 2026\) to the events\. No photo was moved into it: those photos are no longer waiting/);
});

test('#270: a Move on photos no longer waiting lands on the next that is, past those taken meanwhile, not at the top', async () => {
  // review-fanout at #270's review: every gone fixture had nothing else waiting.
  const { env, fall, spring } = await site();
  const [a, b, c] = [0, 1, 2].map((i) => seedPhoto(env, fall, { sentAt: T0 + i }));
  const d = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 10 });
  const [batch] = batches(await queue(env));
  const take = (...ids) => ids.forEach((id) => env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = ?").run(id));
  take(a, b);
  assert.deepEqual(landing(await move(env, batch, a, spring)), { path: '/admin/queue', query: { error: 'gone', at: `photo-${c}` }, hash: `#photo-${c}` });
  take(c);
  assert.deepEqual(landing(await move(env, batch, 'all', spring)), { path: '/admin/queue', query: { error: 'gone', at: `photo-${d}` }, hash: `#photo-${d}` });
  assert.deepEqual([a, b, c, d].map((id) => photo(env, id).address), [fall, fall, fall, fall]);
});

test('#270: when the read that places a Move\'s landing fails, the answer is still the 303 saying what happened, the event it made included', async (t) => {
  // review-fanout at #270's review: uncaught, that read turned the notice
  // into a 500 after createAlbum had committed the event.
  const { env, fall } = await site();
  const id = seedPhoto(env, fall);
  const later = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 10 });
  const [batch] = batches(await queue(env));
  const before = albumCount(env);
  const NEW = { 'new-title': 'League day', 'new-kind': 'regatta', 'new-date': '2026-10-03' };
  const boom = async () => { throw new Error('transient D1 error'); };
  // Another admin approves the photo while the event is being made, after
  // the press read it as waiting; and, when `orderFails`, the queue's order
  // cannot be read.
  const raced = (orderFails) => ({
    ...env.DB,
    prepare: (sql) => {
      if (/^INSERT INTO albums/.test(sql)) env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = ?").run(id);
      if (orderFails && /^SELECT p\.id, p\.batch, p\.sender/.test(sql)) return { bind: () => ({ all: boom }), all: boom };
      return env.DB.prepare(sql);
    },
  });
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const where = landing(await move({ ...env, DB: raced(true) }, batch, id, 'new', NEW));
  assert.deepEqual(where, { path: '/admin/queue', query: { error: 'gone', album: '2026-10-03-league-day', made: '1' }, hash: '' });
  assert.equal(albumCount(env), before + 1);
  assert.deepEqual(logged, ['queue: could not read the queue to land a move on: transient D1 error']);
  // The control: the same race with the read working lands on the photo
  // still waiting, and logs nothing.
  logged.length = 0;
  env.DB.sqlite.prepare("UPDATE photos SET state = 'pending', approved_at = NULL WHERE id = ?").run(id);
  assert.deepEqual(landing(await move({ ...env, DB: raced(false) }, batch, id, 'new', NEW)),
    { path: '/admin/queue', query: { error: 'gone', album: '2026-10-03-league-day-2', made: '1', at: `photo-${later}` }, hash: `#photo-${later}` });
  assert.deepEqual(logged, []);
});

// The admin guard's one read a request (lib/admin-session.js), which the
// count below leaves out, as test/queue.test.js's does.
const GUARD_READ = /^SELECT a\.id, a\.name, a\.email, a\.admin_role FROM accounts AS a /;

test('#270: a Move is five statements into an event, its read traded for createAlbum\'s tries into a new one, as CLAUDE.md counts them', async () => {
  // review-fanout at #270's review: CLAUDE.md's counts were reasoned, and
  // wrong. Every press sends each photo's caption, as the page's form does.
  const { env, fall, districts } = await site();
  const count = async (fn) => {
    env.DB.statements.length = 0;
    await fn();
    return env.DB.statements.filter((sql) => !GUARD_READ.test(sql)).length;
  };
  const press = async (which, to, extra = {}) => {
    const [batch] = batches(await queue(env));
    const captions = Object.fromEntries(batch.ids.split(' ').map((id) => [`caption-${id}`, '']));
    return count(() => move(env, batch, which, to, { ...captions, ...extra }));
  };
  const NEW = { 'new-title': 'League day', 'new-kind': 'regatta', 'new-date': '2026-10-03' };
  const id = () => seedPhoto(env, NOT_SURE['hoover-jrt']);
  let one = id();
  assert.equal(await press(one, fall), 5, 'into an event');
  env.DB.sqlite.prepare('DELETE FROM photos').run();
  one = id();
  assert.equal(await press(one, 'new', NEW), 5, 'into a new event at its first address');
  env.DB.sqlite.prepare('DELETE FROM photos').run();
  one = id();
  assert.equal(await press(one, 'new', NEW), 6, 'into a new event whose first address is held: one more try');
  env.DB.sqlite.prepare('DELETE FROM photos').run();
  one = id();
  assert.equal(await press(one, districts), 4, 'another team\'s event, refused: the event read, and nothing moved');
  assert.equal(await press(one, '<b>'), 3, 'no address at all is refused unread (albumAt)');
  // Rejected between the teams read and the move: the move finds none, then
  // the order is read to land on.
  let [batch] = batches(await queue(env));
  const raced = {
    ...env.DB,
    prepare: (sql) => {
      if (/^UPDATE photos SET album_id/.test(sql)) env.DB.sqlite.prepare('DELETE FROM photos WHERE id = ?').run(one);
      return env.DB.prepare(sql);
    },
  };
  assert.equal(await count(() => move({ ...env, DB: raced }, batch, one, fall, { [`caption-${one}`]: '' })), 6, 'gone at the move');
  // Rejected before the press: the teams read finds none, then the order.
  one = id();
  [batch] = batches(await queue(env));
  env.DB.sqlite.prepare('DELETE FROM photos WHERE id = ?').run(one);
  assert.equal(await count(() => move(env, batch, one, fall, { [`caption-${one}`]: '' })), 4, 'gone at the teams read');
});

test('#228 criterion 3: a move that leaves the batch over PART_PHOTOS in its event lands on the moved photo, in whichever part the page shows it', async () => {
  // review-fanout at #228's review: the unsplit id named no section. Since
  // #270 a move lands on the photo's card, which has one id whatever part it
  // is in.
  const { env, fall } = await site();
  for (let i = 0; i <= PART_PHOTOS; i++) seedPhoto(env, NOT_SURE['hoover-jrt'], { sentAt: T0 + i });
  // One of the batch already approved in Fall: the queue does not show it,
  // so the count that decides the parts must leave it out.
  seedPhoto(env, fall, { state: 'approved', sentAt: T0 - 5 });
  const [first] = batches(await queue(env));
  assert.equal(first.ids.split(' ').length, PART_PHOTOS);
  // PART_PHOTOS into Fall: one section, unsplit, landing on its first photo.
  let where = landing(await move(env, first, 'all', fall));
  assert.equal(where.hash, `#photo-${first.ids.split(' ')[0]}`);
  assert.ok((await queue(env)).includes(`id="${where.hash.slice(1)}"`));
  // The last one, alone in its part, by its own Move: Fall then holds
  // PART_PHOTOS + 1 of the batch, shown in two parts, the moved one in the
  // second.
  const [rest] = batches(await queue(env)).filter((b) => b.title === NOT_SURE_TITLE);
  assert.equal(rest.ids.split(' ').length, 1);
  where = landing(await move(env, rest, rest.ids, fall));
  assert.equal(where.hash, `#photo-${rest.ids}`);
  const html = await queue(env);
  assert.ok(html.includes(`id="${where.hash.slice(1)}"`), 'the page has the card the move lands on');
  assert.equal(batches(html).find((b) => b.id === `batch-${BATCH_A}-${albumId(env, fall)}-part-2`).ids, rest.ids);
});

test('a Move press that arrives as a GET changes nothing, and keeps its team', async () => {
  assert.deepEqual(landing(moveGet({ request: new Request(`${SITE}/api/admin/queue/move?team=cohssa`) })).query, { error: 'unchanged', team: 'cohssa' });
});

// ---- Criterion 4: approving a photo still in Not sure is refused, and the queue says why

test('#228 criterion 4: a Not sure batch offers no Approve and says why; an event\'s batch keeps them', async () => {
  const { env, fall } = await site();
  seedPhoto(env, NOT_SURE['hoover-jrt']);
  seedPhoto(env, NOT_SURE['hoover-jrt']);
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 5 });
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 6 });
  const html = await queue(env);
  const [notSure, inFall] = batches(html);
  assert.deepEqual(notSure.buttons.filter((b) => b.name === 'approve'), []);
  assert.match(notSure.inner, /<p class="batch-why">A photo in "Not sure \/ other event" has no event to be public in, so it cannot be approved\. Move it into its event below, then approve it there\.<\/p>/);
  // Reject still works on it.
  assert.ok(notSure.buttons.some((b) => b.text === 'Reject all 2'));
  // The control: an event's batch has Approve all and Approve, and no why.
  assert.deepEqual(inFall.buttons.filter((b) => b.name === 'approve').map((b) => b.text), ['Approve all 2', 'Approve', 'Approve']);
  assert.doesNotMatch(inFall.inner, /batch-why/);
  assert.deepEqual(await problems(html), []);
});

test('#228 criterion 4: an approve press naming a Not sure photo leaves it waiting and says why; beside an event\'s photo it approves only that one', async () => {
  const { env, fall } = await site();
  const held = seedPhoto(env, NOT_SURE['hoover-jrt']);
  const shown = seedPhoto(env, fall, { batch: BATCH_B });
  let where = landing(await admin(env, '/api/admin/queue/approve', { ids: String(held), approve: String(held) }));
  assert.deepEqual(where.query, { error: 'not-sure', n: '1' });
  assert.equal(photo(env, held).state, 'pending');
  assert.match(await queue(env, `?${new URLSearchParams(where.query)}`),
    /<p role="status">Nothing was approved\. A photo in "Not sure \/ other event" has no event to be public in, so it cannot be approved\. Move it into its event below, then approve it there\.<\/p>/);
  // Made from the page, with its batch's anchor, it lands at that batch,
  // where the Move choices are, and says so there (#270; review-fanout at
  // #270's review: held by no test).
  const [heldBatch] = batches(await queue(env)).filter((b) => b.ids === String(held));
  where = landing(await admin(env, '/api/admin/queue/approve', { ids: heldBatch.ids, anchor: heldBatch.anchor, approve: String(held) }));
  assert.deepEqual(where.query, { error: 'not-sure', n: '1', at: heldBatch.id });
  assert.equal(where.hash, `#${heldBatch.id}`);
  const [landed] = batches(await queue(env, `?${new URLSearchParams(where.query)}`)).filter((b) => b.id === heldBatch.id);
  assert.match(landed.inner, /<p role="status">Nothing was approved\./);
  where = landing(await admin(env, '/api/admin/queue/approve', { ids: `${held} ${shown}`, approve: 'all' }));
  // It lands on the one left waiting (#270).
  assert.deepEqual(where.query, { done: 'approved', photo: String(shown), 'not-sure': '1', at: `photo-${held}` });
  assert.deepEqual([held, shown].map((id) => photo(env, id).state), ['pending', 'approved']);
  assert.match(await queue(env, `?${new URLSearchParams(where.query)}`),
    new RegExp(`<p role="status">Approved photo ${shown}\\. 1 photo was left waiting\\. A photo in "Not sure / other event" has no event`));
});

test('"Hide all their photos" takes down an account\'s Not sure photo with the rest, and "Put it back" returns it to the queue, still in Not sure', async () => {
  // review-fanout at #228's review: the first build of 0015 refused this, so
  // Hide all rolled back whole and left the person's public photo up.
  const { env, fall } = await site();
  const { sqlite } = env.DB;
  sqlite.prepare("INSERT INTO accounts (id, email, name, role, requested_at) VALUES (2, 'pat@example.org', 'Pat Parent', 'parent', 1)").run();
  const shown = seedPhoto(env, fall, { state: 'approved' });
  const held = seedPhoto(env, NOT_SURE['hoover-jrt']);
  const other = seedPhoto(env, NOT_SURE['hoover-jrt']); // the invite link's, which Hide all leaves alone
  sqlite.prepare('UPDATE photos SET account_id = 2, code_generation = 0, session_issued = 0 WHERE id IN (?, ?)').run(shown, held);
  assert.deepEqual(await hidePhotos(env.DB, { accountId: 2, admin: 'owner@example.org', now: T0 + 50 }), { hidden: 2, waiting: 1 });
  assert.deepEqual([shown, held, other].map((id) => photo(env, id).state), ['hidden', 'hidden', 'pending']);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'hide'").get().n, 1);
  assert.equal(sqlite.prepare('SELECT approved_at FROM photos WHERE id = ?').get(held).approved_at, WAITING_WHEN_HIDDEN);
  // Nothing in Not sure is public before, during or after.
  assert.equal((await publicGet(env, `/photos/${held}/grid`)).status, 404);
  assert.equal(await restorePhoto(env.DB, held), 'pending');
  assert.deepEqual(photo(env, held), { state: 'pending', caption: null, batch: BATCH_A, address: NOT_SURE['hoover-jrt'] });
  assert.equal(await restorePhoto(env.DB, shown), 'approved', 'the control: the event photo goes back public');
  assert.equal((await publicGet(env, `/photos/${held}/grid`)).status, 404);
});

// ---- The notices ----------------------------------------------------------------

test('each #228 notice is a known sentence, and an album named in the address bar shows only if the page lists it as an event', () => {
  const albums = [
    { address: '2026-10-04-fall-regatta', title: '<b>Fall</b>', team: 'hoover-jrt', date: '2026-10-04', holding: false },
    { address: NOT_SURE['hoover-jrt'], title: NOT_SURE_TITLE, team: 'hoover-jrt', date: '0001-01-01', holding: true },
  ];
  const say = (query) => queueNotice(new URLSearchParams(query), albums).replace(/^\s*<p role="status">|<\/p>$/g, '');
  assert.equal(say('done=moved&photo=4&album=2026-10-04-fall-regatta'), 'Moved photo 4 to &lt;b&gt;Fall&lt;/b&gt; (Hoover JRT, 4 October 2026). It waits there, ready to approve.');
  assert.equal(say('done=moved&n=3&album=2026-10-04-fall-regatta&unsaved=1'),
    'Moved 3 photos to &lt;b&gt;Fall&lt;/b&gt; (Hoover JRT, 4 October 2026). They wait there, ready to approve. 1 caption was not saved: its photo was approved or hidden after this page was loaded.');
  assert.match(say('error=target&unsaved=2'), /^No photo was moved: .* 2 captions were not saved/);
  assert.match(say('error=teams&unsaved=1'), /^No photo was moved: those photos are in two teams' events now.* 1 caption was not saved/);
  assert.match(say('error=new-date'), /^No photo was moved and no event was added: the new event's date is not a real day\.$/);
  assert.match(say('error=new-kind'), /Regatta or Practice/);
  assert.match(say('error=new-full'), /50 albums already hold every address/);
  // An album the page does not list as an event, a Not sure album, or a
  // crafted address names nothing, so the moved notice is not shown.
  for (const query of ['done=moved&photo=4&album=2026-10-09-nothing', `done=moved&photo=4&album=${NOT_SURE['hoover-jrt']}`,
    'done=moved&photo=4&album=<b>x</b>', 'done=moved&album=2026-10-04-fall-regatta', 'error=new-other']) {
    assert.equal(queueNotice(new URLSearchParams(query), albums), '', query);
  }
  // "made" without an album the page lists says nothing of an event.
  assert.match(say('error=gone&made=1&album=2026-10-09-nothing'), /^No photo was approved, rejected or moved/);
});

// ---- #198: a clip in Not sure, and a clip moved -------------------------------

/** A waiting clip (#198), as the clip routes leave it once checked, with its one object. */
function seedClip(env, address, { batch = BATCH_A, sentAt = T0, caption = null } = {}) {
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, caption, ' +
    'captured_at, sent_at, width, height, bytes, content_type, duration_ms) ' +
    "VALUES (?, 'clip', 'pending', ?, ?, 'parent', 1, ?, ?, ?, ?, 1920, 1080, 4, 'video/mp4', 30000)",
  ).run(albumId(env, address), mediaKey, batch, sentAt - 60, caption, sentAt - 3600, sentAt);
  env.MEDIA.objects.set(clipObjectKey(mediaKey), { body: new Uint8Array([0, 0, 0, 8]), httpMetadata: { contentType: 'video/mp4' } });
  return Number(lastInsertRowid);
}

const notSureWhy = (what) => `A ${what} in "${NOT_SURE_TITLE}" has no event to be public in, so it cannot be approved. Move it into its event below, then approve it there.`;

test('#198: a clip in Not sure has no Approve, and its batch says why in a clip\'s words, or a photo\'s or clip\'s beside a photo; an event\'s clip keeps its Approve', async () => {
  const { env, fall } = await site();
  const held = seedClip(env, NOT_SURE['hoover-jrt']);
  seedPhoto(env, NOT_SURE.cohssa, { batch: BATCH_B, sentAt: T0 + 1 });
  seedClip(env, NOT_SURE.cohssa, { batch: BATCH_B, sentAt: T0 + 2 });
  const shown = seedClip(env, fall, { batch: BATCH_B, sentAt: T0 + 3 });
  const html = await queue(env);
  const [clipOnly, mixed, inFall] = batches(html);
  assert.ok(clipOnly.inner.includes(`<p class="batch-why">${notSureWhy('clip')}</p>`), clipOnly.inner);
  assert.ok(mixed.inner.includes(`<p class="batch-why">${notSureWhy('photo or clip')}</p>`), mixed.inner);
  assert.deepEqual([clipOnly, mixed].map((b) => b.buttons.filter((x) => x.name === 'approve')), [[], []]);
  // Move stays, to take it into its event.
  assert.ok(clipOnly.buttons.some((b) => b.name === 'move' && b.value === String(held)));
  // The control: an event's clip has its Approve, named for a clip, and no why.
  assert.deepEqual(inFall.buttons.filter((b) => b.name === 'approve').map((b) => [b.value, b.label]), [[String(shown), `Approve clip ${shown}`]]);
  assert.doesNotMatch(inFall.inner, /batch-why/);
  assert.deepEqual(await problems(html), []);
});

test('#198: an approve naming a Not sure clip leaves it waiting and says so in a clip\'s words; beside an event\'s photo it approves only the photo', async () => {
  const { env, fall } = await site();
  const held = seedClip(env, NOT_SURE['hoover-jrt']);
  const shown = seedPhoto(env, fall, { batch: BATCH_B });
  let where = landing(await admin(env, '/api/admin/queue/approve', { ids: String(held), approve: String(held) }));
  assert.deepEqual(where.query, { error: 'not-sure', clips: '1' });
  assert.equal(photo(env, held).state, 'pending');
  assert.ok((await queue(env, `?${new URLSearchParams(where.query)}`)).includes(`<p role="status">Nothing was approved. ${notSureWhy('clip')}</p>`));
  where = landing(await admin(env, '/api/admin/queue/approve', { ids: `${held} ${shown}`, approve: 'all' }));
  // It lands on the clip left waiting (#270).
  assert.deepEqual(where.query, { done: 'approved', photo: String(shown), 'not-sure-clips': '1', at: `photo-${held}` });
  assert.deepEqual([held, shown].map((id) => photo(env, id).state), ['pending', 'approved']);
  assert.ok((await queue(env, `?${new URLSearchParams(where.query)}`)).includes(`<p role="status">Approved photo ${shown}. 1 clip was left waiting. ${notSureWhy('clip')}</p>`));
  // The database refuses it too, whatever the statement checks: 0015's
  // triggers name no kind.
  assert.throws(() => env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = ?").run(held), /never approved/);
});

test('#198: Move takes a clip into its team\'s event, still waiting, with its caption and its batch, lands on its card and names it a clip; Move all names each kind', async () => {
  const { env, fall } = await site();
  const clip = seedClip(env, NOT_SURE['hoover-jrt'], { caption: 'old' });
  const still = seedPhoto(env, NOT_SURE['hoover-jrt'], { sentAt: T0 + 1 });
  const other = seedClip(env, NOT_SURE['hoover-jrt'], { sentAt: T0 + 2 });
  let [batch] = batches(await queue(env));
  let where = landing(await move(env, batch, clip, fall, { [`caption-${clip}`]: 'Start line' }));
  assert.deepEqual(where.query, { done: 'moved', clip: String(clip), album: fall, at: `photo-${clip}` });
  assert.equal(where.hash, `#photo-${clip}`);
  assert.deepEqual(photo(env, clip), { state: 'pending', caption: 'Start line', batch: BATCH_A, address: fall });
  const html = await queue(env, `?${new URLSearchParams(where.query)}`);
  assert.ok(html.includes(`<p role="status">Moved clip ${clip} to Fall Regatta (Hoover JRT, 4 October 2026). It waits there, ready to approve.</p>`));
  // A batch of its event now, where it can be approved.
  const moved = batches(html).find((b) => b.ids === String(clip));
  assert.equal(moved.title, 'Fall Regatta');
  assert.ok(moved.buttons.some((b) => b.name === 'approve' && b.value === String(clip)));
  // Move all on what is left in Not sure: a photo and a clip, each named.
  [batch] = batches(html).filter((b) => b.title === NOT_SURE_TITLE);
  where = landing(await move(env, batch, 'all', fall));
  assert.deepEqual(where.query, { done: 'moved', n: '1', clips: '1', album: fall, at: `photo-${still}` });
  assert.ok((await queue(env, `?${new URLSearchParams(where.query)}`))
    .includes('<p role="status">Moved 1 photo and 1 clip to Fall Regatta (Hoover JRT, 4 October 2026). They wait there, ready to approve.</p>'));
  assert.deepEqual([clip, still, other].map((id) => photo(env, id).address), [fall, fall, fall]);
});
