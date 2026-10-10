// A clip sent in parts (#198): the routes under functions/api/upload/clips/,
// through the chain Pages runs in front of them (the root middleware, then the
// upload directory's two guards), against a real SQLite holding the real
// migrations (test/d1.js), the R2 stand-in with its multipart calls
// (test/r2.js), and clips built byte by byte with fictional location and
// camera data (test/mp4.js). The guard's bad-cookie and foreign-Origin cases
// for these routes are test/guard.test.js's, which finds every route by itself.
// Each test names the criterion it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestGet as adminHomeRoute } from '../functions/admin/index.js';
import { onRequestPost as startRoute } from '../functions/api/upload/clips/index.js';
import { onRequestPut as partRoute } from '../functions/api/upload/clips/[id]/parts/[n].js';
import { onRequestPost as completeRoute } from '../functions/api/upload/clips/[id]/complete.js';
import { onRequestDelete as abandonRoute } from '../functions/api/upload/clips/[id]/index.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openList } from '../functions/api/albums/open.js';
import { signAccountSession, ACCOUNT_COOKIE } from '../lib/account-session.js';
import { createAlbum, setAlbumOpen } from '../lib/albums.js';
import {
  COMPLETE_MAX_BYTES, STALE_SECONDS, SWEEP_MAX, UPLOAD_HEADER, clearStaleClips, clipToken, partBytes, readClipToken,
} from '../lib/clips.js';
import {
  CLIP_BYTES, CLIP_DAY_BYTES, CLIP_SECONDS, DAILY_UPLOADS, clipObjectKey, refundDailyUpload, sessionKey, spendDailyClip,
  spendDailyUpload,
} from '../lib/photos.js';
import { nowSeconds } from '../lib/session.js';
import { PART_BYTES, partCount, partPieces, planClip } from '../public/js/clip.js';
import { adminData } from './admin.js';
import { d1 } from './d1.js';
import { RECORDED, androidMp4, ftyp, goproMp4, iphoneMov, mvhd, plainClip } from './mp4.js';
import { r2 } from './r2.js';

const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const COHSSA = { team: 'cohssa', title: 'COHSSA Fall Champs', kind: 'regatta', date: '2026-10-05' };

/**
 * A site with an open album for each team, and three accounts at session
 * version 1: 1, Pat, a parent approved for Hoover JRT; 2, Casey, a coach
 * approved for COHSSA; and 3, Cody, a coach approved for Hoover JRT.
 */
async function site(bucket = r2()) {
  const env = { DB: d1(), MEDIA: bucket, SITE_ENV: 'production', SESSION_SIGNING_KEY: KEY };
  const now = nowSeconds();
  const address = await createAlbum(env.DB, FALL, now);
  const cohssa = await createAlbum(env.DB, COHSSA, now);
  const add = env.DB.sqlite.prepare('INSERT INTO accounts (email, name, role, requested_at) VALUES (?, ?, ?, 1)');
  add.run('parent@example.org', 'Pat Parent', 'parent');
  add.run('coach.account@example.org', 'Casey Coach', 'coach');
  add.run('hoover.coach@example.org', 'Cody Coach', 'coach');
  env.DB.sqlite.exec("INSERT INTO account_teams (account_id, team, state) VALUES (1, 'hoover-jrt', 'approved'), (2, 'cohssa', 'approved'), (3, 'hoover-jrt', 'approved');");
  return { env, address, cohssa, now };
}

// The cookie a phone signed in to an account sends, its session opened at
// `issued` (lib/account-session.js); since #226 the only way in. parent() is
// Pat's, the one most tests send as, and coach() is Cody's.
const account = async (accountId, issued = nowSeconds()) => ({ Cookie: `${ACCOUNT_COOKIE}=${await signAccountSession(KEY, { accountId, version: 1 }, issued)}` });
const parent = (issued) => account(1, issued);
const coach = (issued) => account(3, issued);

/** Run `handlers` in order, as Pages does, with one context.data and the route's params. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const json = (body) => JSON.stringify(body);

/** POST /api/upload/clips: what the share page sends to start a clip. */
function start(env, cookies, changes = {}) {
  const fields = {
    album: changes.album, batch: BATCH, caption: 'Downwind at the gate', bytes: 4096, durationMs: 30_000,
    contentType: 'video/mp4', ...changes,
  };
  for (const [name, value] of Object.entries(fields)) if (value === undefined) delete fields[name];
  const request = new Request(`${SITE}/api/upload/clips`, {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', ...cookies }, body: json(fields),
  });
  return chain([root, ...uploadGuard, startRoute], request, env);
}

/** PUT one part, with the token and a Content-Length, as a browser sends a Blob. */
function part(env, cookies, id, n, bytes, { token, length = bytes.length, body } = {}) {
  const headers = { Origin: SITE, ...cookies };
  if (token !== undefined) headers[UPLOAD_HEADER] = token;
  if (length !== null) headers['Content-Length'] = String(length);
  const request = new Request(`${SITE}/api/upload/clips/${id}/parts/${n}`, {
    method: 'PUT', headers, body: body ?? bytes, ...(body ? { duplex: 'half' } : {}),
  });
  return chain([root, ...uploadGuard, partRoute], request, env, { id: String(id), n: String(n) });
}

function complete(env, cookies, id, token, body) {
  const request = new Request(`${SITE}/api/upload/clips/${id}/complete`, {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', [UPLOAD_HEADER]: token, ...cookies },
    body: json(body),
  });
  return chain([root, ...uploadGuard, completeRoute], request, env, { id: String(id) });
}

function abandon(env, cookies, id, token) {
  const headers = { Origin: SITE, ...cookies };
  if (token !== undefined) headers[UPLOAD_HEADER] = token;
  const request = new Request(`${SITE}/api/upload/clips/${id}`, { method: 'DELETE', headers });
  return chain([root, ...uploadGuard, abandonRoute], request, env, { id: String(id) });
}

const rows = (env) => env.DB.sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r }));
const sentToday = (env) => env.DB.sqlite.prepare('SELECT COALESCE(SUM(sent), 0) AS n FROM upload_counts').get().n;
// The day's clip budget spent, every session's together (0017).
const clipBytesToday = (env) => env.DB.sqlite.prepare('SELECT COALESCE(SUM(clip_bytes), 0) AS n FROM upload_counts').get().n;
const openUploads = (env) => [...env.MEDIA.uploads.values()].filter((u) => u.state === 'open');

/** A body that counts how much of it was read, for a route that must refuse before reading. */
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

// ---- Criterion 3: the caps, refused before any part is stored -------------

test('a clip starts: 201 with its id, a token and its part count, one uploading row naming its R2 upload, and one of the day\'s 500 spent', async () => {
  const { env, address } = await site();
  const bytes = 2 * PART_BYTES + 12_345;
  const res = await start(env, await parent(), { album: address, bytes, contentType: 'video/quicktime' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['id', 'parts', 'token']);
  assert.equal(body.parts, 3);
  assert.equal(body.parts, partCount(bytes));
  assert.match(body.token, new RegExp(`^clip1\\.${body.id}\\.${bytes}\\.[A-Za-z0-9_-]{43}$`));
  const [row] = rows(env);
  assert.equal(row.id, body.id);
  assert.equal(row.kind, 'clip');
  assert.equal(row.state, 'uploading');
  assert.equal(row.caption, 'Downwind at the gate');
  assert.equal(row.batch, BATCH);
  // Nothing the page declared is written while it uploads (0005).
  for (const column of ['content_type', 'duration_ms', 'width', 'height', 'captured_at', 'bytes']) {
    assert.equal(row[column], null, column);
  }
  const [upload] = openUploads(env);
  assert.equal(row.upload_id, [...env.MEDIA.uploads.keys()][0]);
  assert.equal(upload.key, clipObjectKey(row.media_key));
  assert.deepEqual(upload.httpMetadata, { contentType: 'video/quicktime' });
  assert.equal(sentToday(env), 1);
  assert.equal(clipBytesToday(env), bytes, 'the declared size of the day\'s clip budget');
});

test('each sender\'s caps: a parent\'s clip over 1 GiB or 3 minutes, a coach\'s over 4 GiB or 15, is refused before anything is stored or spent', async () => {
  const cases = [
    ['parent', parent, CLIP_BYTES.everyone, CLIP_SECONDS.everyone],
    ['coach', () => account(2), CLIP_BYTES.coach, CLIP_SECONDS.coach],
  ];
  for (const [who, cookies, bytes, seconds] of cases) {
    const { env, address, cohssa } = await site();
    const album = who === 'coach' ? cohssa : address;
    const over = [
      [{ bytes: bytes + 1 }, 413, 'too-large'],
      [{ durationMs: seconds * 1000 + 1 }, 413, 'too-long'],
    ];
    for (const [changes, status, error] of over) {
      const res = await start(env, await cookies(), { album, ...changes });
      assert.equal(res.status, status, `${who} ${error}`);
      assert.deepEqual(await res.json(), { error }, `${who} ${error}`);
    }
    assert.deepEqual(rows(env), [], who);
    assert.equal(env.MEDIA.uploads.size, 0, who);
    assert.equal(sentToday(env), 0, who);
    // The control: exactly at each cap starts.
    const res = await start(env, await cookies(), { album, bytes, durationMs: seconds * 1000 });
    assert.equal(res.status, 201, `${who} at the caps`);
  }
});

test('the open list gives each sender its own caps, so the page can refuse a clip as soon as it is chosen (#198)', async () => {
  const { env } = await site();
  const caps = async (cookies) => {
    const res = await chain([root, ...albumsGuard, openList], new Request(`${SITE}/api/albums/open`, { headers: cookies }), env);
    return (await res.json()).clip;
  };
  const everyone = { seconds: CLIP_SECONDS.everyone, bytes: CLIP_BYTES.everyone, dayBytes: CLIP_DAY_BYTES.everyone };
  const coaches = { seconds: CLIP_SECONDS.coach, bytes: CLIP_BYTES.coach, dayBytes: CLIP_DAY_BYTES.coach };
  assert.deepEqual(await caps(await account(1)), everyone);
  assert.deepEqual(await caps(await account(2)), coaches);
});

test('a start that is not a clip the site takes, or not the share page\'s fields, is refused, storing and spending nothing', async () => {
  const { env, address } = await site();
  const cases = [
    [{ contentType: 'video/webm' }, 415, { error: 'not-clip' }],
    [{ contentType: undefined }, 415, { error: 'not-clip' }],
    [{ batch: 'not-a-batch' }, 400, { error: 'batch' }],
    [{ caption: 'two\nlines' }, 400, { error: 'caption' }],
    [{ album: undefined }, 400, { error: 'form' }],
    [{ bytes: 0 }, 400, { error: 'form' }],
    [{ bytes: 1.5 }, 400, { error: 'form' }],
    [{ bytes: '4096' }, 400, { error: 'form' }],
    [{ durationMs: -1 }, 400, { error: 'form' }],
    [{ caption: 'x'.repeat(5000) }, 413, { error: 'too-large' }],
  ];
  for (const [changes, status, body] of cases) {
    const res = await start(env, await parent(), { album: address, ...changes });
    assert.equal(res.status, status, JSON.stringify(changes));
    assert.deepEqual(await res.json(), body, JSON.stringify(changes));
  }
  const notJson = new Request(`${SITE}/api/upload/clips`, { method: 'POST', headers: { Origin: SITE, ...(await parent()) }, body: 'album=x' });
  const res = await chain([root, ...uploadGuard, startRoute], notJson, env);
  assert.equal(res.status, 400);
  assert.deepEqual(rows(env), []);
  assert.equal(env.MEDIA.uploads.size, 0);
  assert.equal(sentToday(env), 0);
});

test('a start into an album that is not open is 409, another team\'s from an account is 403, and a spent day is 429: nothing stored', async () => {
  const { env, address, cohssa, now } = await site();
  await setAlbumOpen(env.DB, address, false, now);
  let res = await start(env, await parent(), { album: address });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'album' });
  res = await start(env, await account(1), { album: cohssa });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'team' });
  assert.equal(sentToday(env), 0, 'a refused start spent the day');
  await setAlbumOpen(env.DB, address, true, now);
  const day = Math.floor(nowSeconds() / 86400);
  env.DB.sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, ?)')
    .run(sessionKey({ accountId: 1 }), day, DAILY_UPLOADS);
  res = await start(env, await parent(), { album: address });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'daily-cap' });
  assert.ok(Number(res.headers.get('Retry-After')) > 0);
  assert.deepEqual(rows(env), []);
  assert.equal(env.MEDIA.uploads.size, 0);
  assert.equal(clipBytesToday(env), 0, 'a refused start spent some of the day\'s clip budget');
});

test('an album closed between the check and the row takes nothing: the R2 upload is aborted and the day given back', async () => {
  const { env, address, now } = await site();
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    if (sql.startsWith('INSERT INTO photos')) env.DB.sqlite.prepare('UPDATE albums SET closed_at = ? WHERE address = ?').run(now, address);
    return prepare(sql);
  };
  const res = await start(env, await parent(), { album: address });
  assert.equal(res.status, 409);
  assert.deepEqual(rows(env), []);
  assert.deepEqual([...env.MEDIA.uploads.values()].map((u) => u.state), ['aborted']);
  assert.equal(sentToday(env), 0);
  assert.equal(clipBytesToday(env), 0);
});

test('a team revoked between the check and the row takes nothing either: the R2 upload is aborted and the day given back (#198)', async () => {
  // Pat's account, approved for both teams, so it still signs in once Hoover
  // JRT's is revoked; the statement that writes the row checks the team again.
  const { env, address } = await site();
  env.DB.sqlite.exec("INSERT INTO account_teams (account_id, team, state) VALUES (1, 'cohssa', 'approved')");
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    if (sql.startsWith('INSERT INTO photos')) env.DB.sqlite.exec("UPDATE account_teams SET state = 'revoked' WHERE account_id = 1 AND team = 'hoover-jrt'");
    return prepare(sql);
  };
  const res = await start(env, await account(1), { album: address });
  assert.equal(res.status, 409);
  assert.deepEqual(rows(env), []);
  assert.deepEqual([...env.MEDIA.uploads.values()].map((u) => u.state), ['aborted']);
  assert.equal(sentToday(env), 0);
  assert.equal(clipBytesToday(env), 0);
});

test('a start the bucket does not take is 503, and gives back its one of the 500 and its size (#198)', async () => {
  const { env, address } = await site();
  env.MEDIA.createMultipartUpload = async () => { throw new Error('R2 unavailable'); };
  const res = await start(env, await parent(), { album: address, bytes: 5 * PART_BYTES });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'unavailable' });
  assert.deepEqual(rows(env), []);
  assert.equal(sentToday(env), 0);
  assert.equal(clipBytesToday(env), 0);
});

// ---- The day's clip budget (the security audit's SA-1; owner, at #198's review) ----

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const today = () => Math.floor(nowSeconds() / 86400);
const counts = (env) => env.DB.sqlite.prepare('SELECT * FROM upload_counts ORDER BY session').all().map((r) => ({ ...r }));

/** Today's count for `session`, as if it had sent `sent` uploads and `bytes` of clips. */
function spentToday(env, session, sent, bytes) {
  env.DB.sqlite.prepare('INSERT INTO upload_counts (session, day, sent, clip_bytes) VALUES (?, ?, ?, ?)')
    .run(sessionKey(session), today(), sent, bytes);
}

test('an account\'s clips may total 10 GiB a day, a coach\'s 40 GiB: a clip filling the budget exactly starts, the next is 429 clip-bytes storing and spending nothing, and a photo still goes (#198, SA-1)', async () => {
  const cases = [
    ['parent', () => account(1), { sender: 'account', accountId: 1 }, CLIP_DAY_BYTES.everyone, CLIP_BYTES.everyone],
    ['coach', () => account(2), { sender: 'account', accountId: 2 }, CLIP_DAY_BYTES.coach, CLIP_BYTES.coach],
  ];
  // A day's budget always holds the largest clip, so a day's first clip fits.
  for (const who of ['everyone', 'coach']) assert.ok(CLIP_BYTES[who] <= CLIP_DAY_BYTES[who], who);
  for (const [who, cookies, session, budget, largest] of cases) {
    const { env, address, cohssa } = await site();
    const album = who === 'coach' ? cohssa : address;
    spentToday(env, session, 3, budget - largest);
    let res = await start(env, await cookies(), { album, bytes: largest });
    assert.equal(res.status, 201, `${who}: the clip that fills the budget`);
    assert.deepEqual([sentToday(env), clipBytesToday(env)], [4, budget], who);
    res = await start(env, await cookies(), { album, bytes: 1 });
    assert.equal(res.status, 429, `${who}: a byte past the budget`);
    assert.deepEqual(await res.json(), { error: 'clip-bytes' }, who);
    assert.ok(Number(res.headers.get('Retry-After')) > 0, who);
    assert.equal(rows(env).length, 1, `${who}: the refused start wrote a row`);
    assert.equal(env.MEDIA.uploads.size, 1, `${who}: the refused start began an R2 upload`);
    assert.deepEqual([sentToday(env), clipBytesToday(env)], [4, budget], `${who}: the refused start spent something`);
    // The budget is for clips: the day's photos still go.
    assert.equal(await spendDailyUpload(env.DB, session, nowSeconds()), true, `${who}: a photo`);
  }
});

test('a start past the 500 says daily-cap whatever its bytes, since photos stop too; past the bytes alone, clip-bytes (#198, SA-1)', async () => {
  const session = { sender: 'account', accountId: 1 };
  for (const [sent, bytes, error] of [
    [DAILY_UPLOADS, CLIP_DAY_BYTES.everyone, 'daily-cap'],
    [DAILY_UPLOADS, 0, 'daily-cap'],
    [DAILY_UPLOADS - 1, CLIP_DAY_BYTES.everyone, 'clip-bytes'],
  ]) {
    const { env, address } = await site();
    spentToday(env, session, sent, bytes);
    const res = await start(env, await parent(), { album: address });
    assert.equal(res.status, 429, `${sent} sent, ${bytes} bytes`);
    assert.deepEqual(await res.json(), { error }, `${sent} sent, ${bytes} bytes`);
    assert.deepEqual(rows(env), []);
  }
});

test('the 500 and the bytes are spent in one statement: two clips together cannot both take the last of the budget, a give-back never goes below 0, and a photo\'s leaves the bytes (#198, SA-1)', async () => {
  const { env } = await site();
  const db = env.DB;
  const now = nowSeconds();
  const session = { sender: 'account', accountId: 1, role: 'parent' };
  const key = sessionKey(session);
  // An earlier day's row, which the day's first spend clears, as a photo's does.
  db.sqlite.prepare('INSERT INTO upload_counts (session, day, sent, clip_bytes) VALUES (?, ?, ?, ?)').run('9.1', today() - 1, 3, 77);
  assert.equal(await spendDailyClip(db, session, now, 1000), null);
  assert.deepEqual(counts(env), [{ session: key, day: today(), sent: 1, clip_bytes: 1000 }]);

  db.sqlite.prepare('UPDATE upload_counts SET clip_bytes = ?').run(CLIP_DAY_BYTES.everyone - 1000);
  const both = await Promise.all([spendDailyClip(db, session, now, 1000), spendDailyClip(db, session, now, 1000)]);
  assert.deepEqual(both, [null, 'clip-bytes']);
  assert.deepEqual(counts(env), [{ session: key, day: today(), sent: 2, clip_bytes: CLIP_DAY_BYTES.everyone }]);

  // A clip's give-back returns its size with its one.
  await refundDailyUpload(db, session, now, 1000);
  assert.deepEqual(counts(env), [{ session: key, day: today(), sent: 1, clip_bytes: CLIP_DAY_BYTES.everyone - 1000 }]);
  // One larger than the row holds stops at 0 and still gives back the one.
  db.sqlite.prepare('UPDATE upload_counts SET clip_bytes = 10').run();
  await refundDailyUpload(db, session, now, 1000);
  assert.deepEqual(counts(env), [{ session: key, day: today(), sent: 0, clip_bytes: 0 }]);
  // A photo's give-back names no bytes and leaves them.
  db.sqlite.prepare('UPDATE upload_counts SET sent = 2, clip_bytes = 500').run();
  await refundDailyUpload(db, session, now);
  assert.deepEqual(counts(env), [{ session: key, day: today(), sent: 1, clip_bytes: 500 }]);
});

test('0017 adds one column to upload_counts and nothing else: every count before it reads 0 bytes, and none can go below 0 or be empty (#198, SA-1)', () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).sort().filter((f) => f < '0017')) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  const insert = sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, ?)');
  insert.run('2.1790000000', 20_734, 12);
  insert.run('account.1', 20_734, DAILY_UPLOADS);
  const schema = () => sqlite.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all().map((r) => ({ ...r }));
  const objects = () => sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n;
  const all = () => sqlite.prepare('SELECT * FROM upload_counts ORDER BY session').all().map((r) => ({ ...r }));
  const before = { schema: schema(), objects: objects(), rows: all() };

  sqlite.exec(readFileSync(new URL('0017_clip_day_bytes.sql', MIGRATIONS), 'utf8'));

  assert.deepEqual(all(), before.rows.map((r) => ({ ...r, clip_bytes: 0 })));
  // Only upload_counts' own entry changes, and no object is added: 67 at 0016
  // and 67 after, the figure the read-back compares with once it is applied.
  const changed = schema().filter((entry) => !before.schema.some((old) => JSON.stringify(old) === JSON.stringify(entry)));
  assert.deepEqual(changed.map((entry) => entry.name), ['upload_counts']);
  assert.deepEqual([before.objects, objects()], [67, 67]);
  assert.throws(() => sqlite.exec('UPDATE upload_counts SET clip_bytes = -1'), /CHECK constraint failed/);
  assert.throws(() => sqlite.exec('UPDATE upload_counts SET clip_bytes = NULL'), /NOT NULL constraint failed/);
  // The control: a size the budget can hold is taken.
  sqlite.exec(`UPDATE upload_counts SET clip_bytes = ${CLIP_DAY_BYTES.coach}`);
});

// ---- Criterion 2: parts, each the right size, only from the account that started it ----

async function started(env, address, cookies, bytes) {
  const res = await start(env, cookies, { album: address, bytes });
  assert.equal(res.status, 201);
  return res.json();
}

test('each part must be exactly its size, checked from Content-Length before any of it is read', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const bytes = PART_BYTES + 100;
  const { id, token } = await started(env, address, cookies, bytes);
  assert.equal(partBytes(bytes, 1), PART_BYTES);
  assert.equal(partBytes(bytes, 2), 100);
  for (const [n, length] of [[1, PART_BYTES - 1], [1, PART_BYTES + 1], [2, 99], [2, PART_BYTES], [3, 100], [0, 100]]) {
    const { stream, read } = countingBody(new Uint8Array(length));
    const res = await part(env, cookies, id, n, null, { token, length, body: stream });
    assert.equal(res.status, 400, `part ${n} of ${length}`);
    assert.deepEqual(await res.json(), { error: 'part' });
    assert.equal(read.pulled, 0, `part ${n} of ${length} was read`);
  }
  const noLength = await part(env, cookies, id, 2, new Uint8Array(100), { token, length: null });
  assert.equal(noLength.status, 400, 'a part with no Content-Length');
  assert.equal([...env.MEDIA.uploads.values()][0].parts.size, 0);
  // The control: each part at its size is stored.
  let res = await part(env, cookies, id, 2, new Uint8Array(100), { token });
  assert.equal(res.status, 200);
  assert.match((await res.json()).etag, /^[A-Za-z0-9_-]{171}$/, 'the etag the binding gives a part');
  res = await part(env, cookies, id, 1, new Uint8Array(PART_BYTES), { token });
  assert.equal(res.status, 200);
  assert.deepEqual([...[...env.MEDIA.uploads.values()][0].parts.keys()].sort(), [1, 2]);
});

test('a part needs the token its start gave this account: none, another id\'s, another account\'s or a tampered one is 404 and stores nothing, and another phone signed in to the account carries on', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const { id, token } = await started(env, address, cookies, 4096);
  const other = await started(env, address, cookies, 4096);
  const signature = token.split('.').pop();
  const tampered = token.replace(signature, (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1));
  // The token this upload's start would have given the coach's account.
  const coachToken = await clipToken(KEY, id, 4096, { sender: 'account', accountId: 3 });
  // The size is signed with the rest: a page that edits it holds no token. Were
  // it read, this part would meet the size check instead and answer 400.
  const resized = token.replace(`.${id}.4096.`, `.${id}.8192.`);
  assert.notEqual(resized, token);
  const cases = [
    [cookies, undefined, 'no token'],
    [cookies, other.token, 'another upload\'s token'],
    [cookies, tampered, 'a tampered token'],
    [cookies, coachToken, 'a token for another account'],
    [cookies, resized, 'a token whose size was edited'],
    [await coach(), token, 'the token from another account\'s phone'],
  ];
  for (const [held, presented, label] of cases) {
    const res = await part(env, held, id, 1, new Uint8Array(4096), { token: presented });
    assert.equal(res.status, 404, label);
    assert.deepEqual(await res.json(), { error: 'upload' }, label);
  }
  const upload = env.MEDIA.uploads.get(rows(env)[0].upload_id);
  assert.equal(upload.parts.size, 0);
  // The control: the right token with the session that started it.
  let res = await part(env, cookies, id, 1, new Uint8Array(4096), { token });
  assert.equal(res.status, 200);
  assert.equal(upload.parts.size, 1);
  // Another phone signed in to the same account, its session opened a minute
  // apart, carries on with the token: the token names the account, never when
  // a phone signed in (sessionKey). Its part takes the first one's place.
  res = await part(env, await parent(nowSeconds() - 60), id, 1, new Uint8Array(4096), { token });
  assert.equal(res.status, 200, 'another phone signed in to the account');
  assert.equal(upload.parts.get(1).etag, (await res.json()).etag);
});

test('the token holds the size and the account it was made for, and reads as nothing for anything else', async () => {
  const session = { sender: 'account', accountId: 7, role: 'parent', teams: ['cohssa'], issued: 1 };
  const token = await clipToken(KEY, 12, 4096, session);
  const asked = (value, id = 12, held = session, key = KEY) =>
    readClipToken(new Request(SITE, { headers: { [UPLOAD_HEADER]: value } }), key, held, id);
  assert.deepEqual(await asked(token), { bytes: 4096 });
  // An account's phones share the account's key, so another of its phones may
  // carry on (sessionKey); another account may not.
  assert.deepEqual(await asked(token, 12, { ...session, issued: 99 }), { bytes: 4096 });
  assert.equal(await asked(token, 12, { ...session, accountId: 8 }), null);
  assert.equal(await asked(token, 13), null);
  assert.equal(await asked(token, 12, session, 'another-key-0123456789abcdef0123'), null);
  assert.equal(await asked(token.replace('.4096.', '.4097.')), null);
  assert.equal(await asked(`c1${token.slice(5)}`), null);
  assert.equal(await asked(''), null);
});

test('a part for an upload no longer uploading is 404: abandoned, or cleared', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const { id, token } = await started(env, address, cookies, 4096);
  assert.equal((await abandon(env, cookies, id, token)).status, 204);
  const res = await part(env, cookies, id, 1, new Uint8Array(4096), { token });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'upload' });
});

// ---- Abandoning, and the uploads nobody finished --------------------------------

test('abandoning an upload takes back its row and its R2 upload, and gives the day back on the day it was spent', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const { id, token } = await started(env, address, cookies, PART_BYTES + 10);
  assert.equal((await part(env, cookies, id, 2, new Uint8Array(10), { token })).status, 200);
  assert.equal(sentToday(env), 1);
  assert.equal(clipBytesToday(env), PART_BYTES + 10);
  // Another account's try first, as a control: nothing moves.
  let res = await abandon(env, await coach(), id, token);
  assert.equal(res.status, 404);
  assert.equal(rows(env).length, 1);
  res = await abandon(env, cookies, id, token);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(rows(env), []);
  assert.deepEqual([...env.MEDIA.uploads.values()].map((u) => u.state), ['aborted']);
  assert.equal(sentToday(env), 0);
  assert.equal(clipBytesToday(env), 0, 'its size was not given back to the day\'s clip budget');
  // Again: nothing left to take back.
  assert.equal((await abandon(env, cookies, id, token)).status, 404);
});

test('an upload abandoned more than a day ago is cleared at the next start: row, R2 upload and any object; a younger one, and a pending clip, stay', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const old = await started(env, address, cookies, 4096);
  const young = await started(env, address, cookies, 4096);
  const now = nowSeconds();
  env.DB.sqlite.prepare('UPDATE photos SET sent_at = ? WHERE id = ?').run(now - STALE_SECONDS - 1, old.id);
  env.DB.sqlite.prepare('UPDATE photos SET sent_at = ? WHERE id = ?').run(now - STALE_SECONDS + 60, young.id);
  const oldRow = rows(env).find((r) => r.id === old.id);
  // An object made by a complete whose row never moved on goes too.
  env.MEDIA.objects.set(clipObjectKey(oldRow.media_key), { body: new Uint8Array(8), httpMetadata: {} });
  env.DB.sqlite.prepare(
    "INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, caption, captured_at, sent_at, width, height, bytes, content_type, duration_ms) " +
    "SELECT id, 'clip', 'pending', ?, ?, 'parent', 2, 1, NULL, 1, ?, 1920, 1080, 10, 'video/mp4', 1000 FROM albums WHERE address = ?",
  ).run('d'.repeat(32), BATCH, now - 10 * STALE_SECONDS, address);
  const res = await start(env, cookies, { album: address });
  assert.equal(res.status, 201);
  const left = rows(env).map((r) => r.id);
  assert.ok(!left.includes(old.id), 'the abandoned upload\'s row stayed');
  assert.ok(left.includes(young.id), 'an upload under a day old was cleared');
  assert.equal(rows(env).filter((r) => r.state === 'pending').length, 1, 'a pending clip was cleared');
  assert.equal(env.MEDIA.uploads.get(oldRow.upload_id).state, 'aborted');
  assert.equal(env.MEDIA.objects.has(clipObjectKey(oldRow.media_key)), false);
});

test('an admin home load clears an upload abandoned more than a day ago, as the next start does; a younger one stays (#198)', async () => {
  // /policy: the record goes "the next time anyone starts sending a clip or
  // one of the site's admins opens the admin home page".
  const { env, address } = await site();
  const cookies = await parent();
  const old = await started(env, address, cookies, 4096);
  const young = await started(env, address, cookies, 4096);
  const stale = (id) => env.DB.sqlite.prepare('UPDATE photos SET sent_at = ? WHERE id = ?').run(nowSeconds() - STALE_SECONDS - 1, id);
  stale(old.id);
  const oldRow = rows(env).find((r) => r.id === old.id);
  const res = await adminHomeRoute({ data: adminData(), env });
  assert.equal(res.status, 200);
  assert.deepEqual(rows(env).map((r) => r.id), [young.id]);
  assert.equal(env.MEDIA.uploads.get(oldRow.upload_id).state, 'aborted');
  // With no bucket bound it clears nothing: no row goes whose parts it could
  // not let go of, as the start, which answers 503 then, clears none.
  stale(young.id);
  assert.equal((await adminHomeRoute({ data: adminData(), env: { DB: env.DB } })).status, 200);
  assert.deepEqual(rows(env).map((r) => r.id), [young.id]);
});

test('the sweep reaches an upload a day old behind SWEEP_MAX older rows that are not uploading, and leaves those rows (#198\'s review)', async () => {
  // The rows sorted ahead of the upload are what hold the sweep's own state
  // filter: without it the oldest SWEEP_MAX rows of any state are picked,
  // none of them is deleted, and the upload behind them is never reached.
  // One row fewer ahead of it lets it through either way (measured at #198's
  // review: 19 rows ahead, the filter removed, the upload still cleared).
  const { env, address } = await site();
  const stale = await started(env, address, await parent(), 4096);
  const now = nowSeconds();
  env.DB.sqlite.prepare('UPDATE photos SET sent_at = ? WHERE id = ?').run(now - STALE_SECONDS - 1, stale.id);
  const [upload] = rows(env);
  // Clips stored from uploads that started before it, SWEEP_MAX waiting and
  // SWEEP_MAX approved: anything but uploading. With that many of each, a
  // filter letting either state through fills the limit with it as surely
  // as no filter does (the verifier's round at #198's review: with half of
  // each, `state <> 'approved'` still reached the upload).
  const insert = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, captured_at, ' +
    "sent_at, width, height, bytes, content_type, duration_ms, approved_at) SELECT id, 'clip', ?, ?, ?, 'parent', 2, 1, 1, " +
    "?, 1920, 1080, 10, 'video/mp4', 1000, ? FROM albums WHERE address = ?",
  );
  let n = 0;
  for (const state of ['pending', 'approved']) {
    for (let i = 0; i < SWEEP_MAX; i++, n++) {
      insert.run(state, n.toString(16).padStart(32, 'f'), BATCH, now - STALE_SECONDS - 100 - n, state === 'approved' ? now : null, address);
    }
  }
  const ahead = rows(env).filter((r) => r.id !== upload.id).map((r) => r.id);
  assert.equal(ahead.length, 2 * SWEEP_MAX);
  assert.equal(await clearStaleClips(env, now), 1);
  assert.deepEqual(rows(env).map((r) => r.id), ahead, 'the upload was not cleared, or a stored clip was');
  assert.equal(env.MEDIA.uploads.get(upload.upload_id).state, 'aborted');
});

test('clearing abandoned uploads is best effort: a database that does not answer clears nothing and fails nothing', async () => {
  const { env } = await site();
  const db = { prepare() { throw new Error('D1 unavailable'); } };
  assert.equal(await clearStaleClips({ ...env, DB: db }, nowSeconds()), 0);
});

// ---- Criterion 5: a complete that is not a clip the site keeps --------------------

test('parts that join into something that is not a clip are deleted with the row, and the day given back: 415', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const bytes = 4096;
  const { id, token } = await started(env, address, cookies, bytes);
  const stored = await part(env, cookies, id, 1, new Uint8Array(bytes).fill(7), { token });
  const { etag } = await stored.json();
  const res = await complete(env, cookies, id, token, { parts: [{ partNumber: 1, etag }], captured: 1_790_000_000 });
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { error: 'not-clip' });
  await env.MEDIA.idle();
  assert.deepEqual(rows(env), []);
  assert.deepEqual([...env.MEDIA.objects.keys()], []);
  assert.equal(sentToday(env), 0);
});

test('a complete naming the wrong parts is 400 and takes the upload back; one with no captured time or a stranger\'s token stores nothing', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const bytes = PART_BYTES + 10;
  const { id, token } = await started(env, address, cookies, bytes);
  const one = await (await part(env, cookies, id, 1, new Uint8Array(PART_BYTES), { token })).json();
  const two = await (await part(env, cookies, id, 2, new Uint8Array(10), { token })).json();
  const good = [{ partNumber: 1, etag: one.etag }, { partNumber: 2, etag: two.etag }];
  for (const [body, error] of [
    [{ parts: good }, 'captured'],
    [{ parts: good, captured: 'soon' }, 'captured'],
    [{ parts: [good[0]], captured: 1 }, 'parts'],
    [{ parts: [good[0], good[0]], captured: 1 }, 'parts'],
    [{ parts: [good[0], { partNumber: 3, etag: two.etag }], captured: 1 }, 'parts'],
    [{ parts: 'all', captured: 1 }, 'parts'],
  ]) {
    const res = await complete(env, cookies, id, token, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { error }, JSON.stringify(body));
  }
  assert.equal(rows(env).length, 1, 'a refused complete took the upload back before reading it');
  const stranger = await complete(env, await coach(), id, token, { parts: good, captured: 1 });
  assert.equal(stranger.status, 404);
  // An etag R2 does not hold: the parts do not join, and the upload goes.
  const res = await complete(env, cookies, id, token, { parts: [good[0], { partNumber: 2, etag: 'f'.repeat(32) }], captured: 1 });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'parts' });
  assert.deepEqual(rows(env), []);
  assert.equal(sentToday(env), 0);
});

test('a part\'s etag is taken as the binding gives it, opaque and up to 1,024 characters, and the complete\'s cap holds a coach\'s 164 such parts (#198)', async () => {
  // The stand-in gives each part the 171-character etag local dev gave in
  // #198's browser run, which a 128-character bound refused on every clip.
  const { env, address } = await site();
  const cookies = await parent();
  const { id, token } = await started(env, address, cookies, 4096);
  const { etag } = await (await part(env, cookies, id, 1, new Uint8Array(4096), { token })).json();
  assert.equal(etag.length, 171);
  // One over the bound is refused before the bucket is asked, and the upload stays.
  let res = await complete(env, cookies, id, token, { parts: [{ partNumber: 1, etag: 'e'.repeat(1025) }], captured: 1 });
  assert.equal(res.status, 400);
  assert.equal(rows(env).length, 1);
  // At the bound it reaches the bucket, which holds no such part: taken back.
  res = await complete(env, cookies, id, token, { parts: [{ partNumber: 1, etag: 'e'.repeat(1024) }], captured: 1 });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'parts' });
  assert.deepEqual(rows(env), []);
  // A coach's 4 GiB is 164 parts; with every etag at the bound, its complete
  // still fits the body the route reads. Sent through the route, since a
  // comparison with the constant passes whatever cap the route reads (#198's
  // review: START_MAX_BYTES there left the suite green, and with the
  // 171-character etags local dev gives, a clip of 21 parts or more would
  // have sent every part and then been refused 413; at the 32 hex digits R2's
  // documentation shows, 68 or more). The token is a one-part upload's, so a
  // body read whole is refused on its count, 400 parts, before the bucket is
  // asked.
  const parts = partCount(CLIP_BYTES.coach);
  assert.equal(parts, 164);
  const body = { parts: Array.from({ length: parts }, (_, i) => ({ partNumber: i + 1, etag: 'e'.repeat(1024) })), captured: 1_790_000_000 };
  const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
  assert.ok(bytes < COMPLETE_MAX_BYTES, `${bytes} bytes`);
  const one = await started(env, address, cookies, 4096);
  res = await complete(env, cookies, one.id, one.token, body);
  assert.equal(res.status, 400, `a complete of ${bytes} bytes`);
  assert.deepEqual(await res.json(), { error: 'parts' });
  assert.deepEqual(rows(env).map((r) => [r.id, r.state]), [[one.id, 'uploading']]);
  // And from above: a body past the cap is refused before it is parsed (the
  // verifier's round: a cap of any size left the suite green).
  const over = { parts: body.parts.map((part) => ({ ...part, etag: 'e'.repeat(1700) })), captured: 1_790_000_000 };
  assert.ok(new TextEncoder().encode(JSON.stringify(over)).length > COMPLETE_MAX_BYTES);
  res = await complete(env, cookies, one.id, one.token, over);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'too-large' });
  assert.deepEqual(rows(env).map((r) => [r.id, r.state]), [[one.id, 'uploading']]);
});

// ---- Criteria 2, 4 and 5: a walked clip, sent as the share page sends it -----------

/** planClip over a byte array, as the page runs it over file.slice reads. */
const plan = (file) => planClip(async (offset, length) => file.subarray(offset, offset + length), file.length);

/** Part n of a walked clip as the page makes it: the file's own bytes between the walker's edits. */
async function walkedPart(file, planned, n) {
  const pieces = partPieces(planned, n).map((piece) => (piece instanceof Uint8Array ? piece : file.subarray(piece.from, piece.to)));
  return new Uint8Array(await new Blob(pieces).arrayBuffer());
}

/**
 * A clip sent whole, as the share page sends one: the start, saying what the
 * clip says of itself (`declare` changes that), each part in turn (`partOf(n)`
 * holds part n), then the complete. `before(started, parts)` runs between the
 * last part and the complete. Answers the start's body, the complete's answer,
 * and `again()`, which sends the same complete again.
 */
async function sendClip(env, cookies, address, {
  bytes, durationMs, contentType, partOf, captured = RECORDED, declare = {}, before = async () => {},
}) {
  const res = await start(env, cookies, { album: address, bytes, durationMs, contentType, ...declare });
  assert.equal(res.status, 201, 'the start');
  const started = await res.json();
  const parts = [];
  for (let n = 1; n <= started.parts; n++) {
    const sent = await part(env, cookies, started.id, n, await partOf(n), { token: started.token });
    assert.equal(sent.status, 200, `part ${n}`);
    parts.push({ partNumber: n, etag: (await sent.json()).etag });
  }
  await before(started, parts);
  const again = () => complete(env, cookies, started.id, started.token, { parts, captured });
  return { ...started, res: await again(), again };
}

/** A clip the walker planned first, so what is sent is what the page sends. */
async function sendWalked(env, cookies, address, file, options = {}) {
  const planned = await plan(file);
  assert.equal(planned.error, undefined, `the walker refused the fixture: ${planned.error}`);
  const sent = await sendClip(env, cookies, address, {
    bytes: planned.bytes, durationMs: planned.durationMs, contentType: planned.contentType,
    partOf: (n) => walkedPart(file, planned, n), captured: planned.recordedAt ?? RECORDED, ...options,
  });
  return { planned, ...sent };
}

/** A clip sent as it was recorded, never walked. */
const sendRecorded = (env, cookies, address, file, options = {}) => sendClip(env, cookies, address, {
  bytes: file.length, durationMs: 4500, contentType: 'video/quicktime',
  partOf: async (n) => file.subarray((n - 1) * PART_BYTES, Math.min(n * PART_BYTES, file.length)), ...options,
});

/** Where `needle` (text, one byte a character, or bytes) first occurs in `haystack`, or -1. */
const find = (haystack, needle) => Buffer.from(haystack.buffer, haystack.byteOffset, haystack.length)
  .indexOf(typeof needle === 'string' ? Buffer.from(needle, 'latin1') : Buffer.from(needle));

/** What the bucket holds for a clip's row, or null. */
const stored = (env, row) => env.MEDIA.objects.get(clipObjectKey(row.media_key))?.body ?? null;

/** The row's own and the bucket's: nothing left of a clip taken back. */
async function takenBack(env, label) {
  await env.MEDIA.idle();
  assert.deepEqual(rows(env), [], `${label}: its row stayed`);
  assert.deepEqual([...env.MEDIA.objects.keys()], [], `${label}: the clip stayed in the bucket`);
  assert.deepEqual(openUploads(env), [], `${label}: its R2 upload stayed open`);
  assert.equal(sentToday(env), 0, `${label}: its day was not given back`);
  assert.equal(clipBytesToday(env), 0, `${label}: its size was not given back to the day's clip budget`);
}

test('a walked clip arrives in its parts and waits for approval, with the server\'s own reading of it and nothing the walker blanked (#198, criteria 2, 4 and 5)', async () => {
  const { env, address } = await site();
  // An iPhone's MOV with media enough for two parts, its moov in the second.
  const { file, planted } = iphoneMov({ clip: { tail: PART_BYTES } });
  const sent = await sendWalked(env, await parent(), address, file);
  assert.equal(sent.parts, 2);
  assert.equal(sent.res.status, 201);
  assert.equal(sent.res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await sent.res.json(), { id: sent.id });
  const [row] = rows(env);
  assert.equal(row.id, sent.id);
  assert.equal(row.kind, 'clip');
  assert.equal(row.state, 'pending');
  assert.equal(row.upload_id, null);
  // The server's own reading: the type from the ftyp, the length from mvhd,
  // the frame as it is shown (a quarter turn), and the size R2 stored.
  assert.equal(row.content_type, 'video/quicktime');
  assert.equal(row.duration_ms, 4500);
  assert.deepEqual([row.width, row.height], [1080, 1920]);
  assert.equal(row.bytes, sent.planned.bytes);
  assert.equal(row.captured_at, RECORDED, 'the time the page read before the walker zeroed it');
  assert.equal(row.caption, 'Downwind at the gate');
  // The bucket holds what the page made, and none of what the camera planted;
  // the original held every one of them (the control).
  const object = stored(env, row);
  assert.equal(object.length, sent.planned.bytes);
  for (const [what, value] of Object.entries(planted)) {
    assert.ok(find(file, value) >= 0, `the fixture never held its ${what}`);
    assert.equal(find(object, value), -1, `the stored clip still holds its ${what}`);
  }
  assert.deepEqual(openUploads(env), []);
  assert.equal(sentToday(env), 1);
});

test('an Android phone\'s MP4 and an action camera\'s, walked, are taken too, each with its own reading and nothing planted left (#198, criterion 4)', async () => {
  for (const [name, make, reading] of [
    ['Android', androidMp4, { content_type: 'video/mp4', duration_ms: 4500, width: 1920, height: 1080 }],
    ['GoPro', goproMp4, { content_type: 'video/mp4', duration_ms: 2002, width: 1920, height: 1080 }],
  ]) {
    const { env, address } = await site();
    const { file, planted } = make();
    const sent = await sendWalked(env, await parent(), address, file);
    assert.equal(sent.res.status, 201, name);
    const [row] = rows(env);
    const { content_type, duration_ms, width, height } = row;
    assert.deepEqual({ content_type, duration_ms, width, height }, reading, name);
    const object = stored(env, row);
    for (const [what, value] of Object.entries(planted)) {
      assert.ok(find(file, value) >= 0, `the ${name} fixture never held its ${what}`);
      assert.equal(find(object, value), -1, `the stored ${name} clip still holds its ${what}`);
    }
  }
});

test('a clip sent as it was recorded, its location and camera details in it, is refused 422 and deleted, and its day given back (#198, criterion 5)', async () => {
  const { env, address } = await site();
  const { file } = iphoneMov();
  const sent = await sendRecorded(env, await parent(), address, file);
  assert.equal(sent.res.status, 422);
  assert.deepEqual(await sent.res.json(), { error: 'kept' });
  await takenBack(env, 'the clip as recorded');
  // The control: the same clip walked first is taken.
  assert.equal((await sendWalked(env, await parent(), address, file)).res.status, 201);
});

test('a clip the server reads as longer than its sender may send is refused 413 and deleted, whatever its start said; a coach\'s may run 15 minutes (#198, criterion 3)', async () => {
  const fourMinutes = () => plainClip({ clip: { movie: mvhd({ time: [0, 0], timescale: 600, duration: 600 * 240 }) } }).file;
  const { env, address } = await site();
  // Its start says 30 seconds; the clip says 4 minutes.
  const sent = await sendWalked(env, await parent(), address, fourMinutes(), { declare: { durationMs: 30_000 } });
  assert.equal(sent.res.status, 413);
  assert.deepEqual(await sent.res.json(), { error: 'too-long' });
  await takenBack(env, 'a parent\'s 4 minutes');
  // The control: a coach's clips run 15 minutes, so the same clip is taken.
  const coached = await sendWalked(env, await coach(), address, fourMinutes(), { declare: { durationMs: 30_000 } });
  assert.equal(coached.res.status, 201);
  assert.equal(rows(env)[0].duration_ms, 240_000);
});

test('a clip that is not the type it started as is refused 415 and deleted; one started as what it is is kept under that type (#198, criterion 5)', async () => {
  const mov = () => plainClip({ clip: { brand: ftyp('qt  ', 'qt  ') } }).file;
  const { env, address } = await site();
  const sent = await sendWalked(env, await parent(), address, mov(), { declare: { contentType: 'video/mp4' } });
  assert.equal(sent.res.status, 415);
  assert.deepEqual(await sent.res.json(), { error: 'not-clip' });
  await takenBack(env, 'a MOV started as an MP4');
  // The control.
  assert.equal((await sendWalked(env, await parent(), address, mov())).res.status, 201);
  const [row] = rows(env);
  assert.equal(row.content_type, 'video/quicktime');
  assert.equal(env.MEDIA.objects.get(clipObjectKey(row.media_key)).httpMetadata.contentType, 'video/quicktime');
});

test('abandoning a clip this account already stored is 409 stored and takes nothing back; another account\'s try is still 404 (#198\'s review)', async () => {
  const { env, address } = await site();
  const cookies = await parent();
  const sent = await sendWalked(env, cookies, address, androidMp4().file);
  assert.equal(sent.res.status, 201);
  const before = rows(env);
  // The page's Remove after a complete whose answer it never got.
  let res = await abandon(env, cookies, sent.id, sent.token);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'stored' });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(rows(env), before, 'the stored clip was touched');
  assert.equal(env.MEDIA.objects.size, 1);
  assert.equal(sentToday(env), 1, 'its day was given back');
  // An approved one answers the same: stored is stored.
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = ? WHERE id = ?").run(nowSeconds(), sent.id);
  assert.equal((await abandon(env, cookies, sent.id, sent.token)).status, 409);
  // Another account learns nothing about it.
  res = await abandon(env, await coach(), sent.id, sent.token);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'upload' });
});

test('a complete sent again after its answer was lost is 201 and changes nothing (#198)', async () => {
  const { env, address } = await site();
  const sent = await sendWalked(env, await parent(), address, androidMp4().file);
  assert.equal(sent.res.status, 201);
  const before = rows(env);
  const res = await sent.again();
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: sent.id });
  assert.deepEqual(rows(env), before);
  assert.equal(env.MEDIA.objects.size, 1);
  assert.equal(sentToday(env), 1, 'a day was spent or given back twice');
});

test('a clip whose album closed, or whose account lost the album\'s team, while its parts arrived is refused 409 and deleted, its day given back (#198)', async () => {
  const { env, address, now } = await site();
  let sent = await sendWalked(env, await parent(), address, plainClip().file, {
    before: () => setAlbumOpen(env.DB, address, false, now),
  });
  assert.equal(sent.res.status, 409);
  assert.deepEqual(await sent.res.json(), { error: 'album' });
  await takenBack(env, 'an album closed meanwhile');

  // Pat's account, approved for both teams, loses Hoover JRT's meanwhile; it
  // still signs in, for COHSSA.
  await setAlbumOpen(env.DB, address, true, now);
  env.DB.sqlite.exec("INSERT INTO account_teams (account_id, team, state) VALUES (1, 'cohssa', 'approved')");
  const revoke = (state) => env.DB.sqlite.prepare("UPDATE account_teams SET state = ? WHERE account_id = 1 AND team = 'hoover-jrt'").run(state);
  sent = await sendWalked(env, await account(1), address, plainClip().file, { before: () => revoke('revoked') });
  assert.equal(sent.res.status, 409);
  assert.deepEqual(await sent.res.json(), { error: 'album' });
  await takenBack(env, 'a team revoked meanwhile');

  // The control: with the team still approved, the same clip is taken.
  revoke('approved');
  assert.equal((await sendWalked(env, await account(1), address, plainClip().file)).res.status, 201);
});

test('a complete whose upload R2 had already joined finishes from the stored clip; one whose upload is gone is 404, and its day given back (#198)', async () => {
  const { env, address } = await site();
  const { file } = androidMp4();
  const upload = ({ id }) => {
    const row = rows(env).find((r) => r.id === id);
    return env.MEDIA.resumeMultipartUpload(clipObjectKey(row.media_key), row.upload_id);
  };
  // Joined by a complete whose answer was lost before its row moved on.
  let sent = await sendWalked(env, await parent(), address, file, { before: (started, parts) => upload(started).complete(parts) });
  assert.equal(sent.res.status, 201);
  assert.equal(rows(env)[0].state, 'pending');
  // Aborted, by the bucket's rule a day on or by the sweep.
  sent = await sendWalked(env, await parent(), address, file, { before: (started) => upload(started).abort() });
  assert.equal(sent.res.status, 404);
  assert.deepEqual(await sent.res.json(), { error: 'upload' });
  await env.MEDIA.idle();
  assert.deepEqual(rows(env).map((r) => r.state), ['pending'], 'the aborted upload\'s row stayed');
  assert.equal(sentToday(env), 1, 'the aborted upload\'s day was not given back');
});

test('a complete that loses the race to another complete of its upload answers 201, and leaves the clip as the other stored it (#198)', async () => {
  const { env, address } = await site();
  const { file } = androidMp4();
  // The other complete makes the row pending just as this one's own statement
  // runs, so this one's finds no row still uploading.
  const sent = await sendWalked(env, await parent(), address, file, {
    before: ({ id }) => {
      const prepare = env.DB.prepare.bind(env.DB);
      let raced = false;
      env.DB.prepare = (sql) => {
        if (!raced && sql.startsWith("UPDATE photos SET state = 'pending'")) {
          raced = true;
          env.DB.sqlite.prepare(
            "UPDATE photos SET state = 'pending', content_type = 'video/mp4', duration_ms = 4500, width = 1920, height = 1080, " +
            'captured_at = 1, bytes = ?, upload_id = NULL WHERE id = ?',
          ).run(file.length, id);
        }
        return prepare(sql);
      };
    },
  });
  assert.equal(sent.res.status, 201);
  assert.deepEqual(await sent.res.json(), { id: sent.id });
  await env.MEDIA.idle();
  const [row] = rows(env);
  assert.equal(row.state, 'pending', 'the clip the other complete stored was taken back');
  assert.ok(stored(env, row), 'the clip the other complete stored was deleted from the bucket');
  assert.equal(sentToday(env), 1, 'the day was given back for a clip that stayed');
});

/**
 * `land` awaited just before the complete's own statement making its row
 * pending runs, as a writer landing between the clip's check and that
 * statement. Only the first such statement waits, so a complete that `land`
 * sends itself runs straight through.
 */
function landsBeforeFinish(env, land) {
  const prepare = env.DB.prepare.bind(env.DB);
  let landed = false;
  env.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (landed || !sql.startsWith("UPDATE photos SET state = 'pending'")) return statement;
    landed = true;
    return { bind: (...values) => ({ first: async (column) => { await land(); return statement.bind(...values).first(column); } }) };
  };
}

test('a complete whose upload is taken back while it checks the clip, by the day-old sweep or by another complete refused meanwhile, is 404 upload, never 201 (#198\'s review)', async () => {
  // A 201 shows the clip Sent with no Try again, and nothing is left of it.
  const { file } = androidMp4();
  const cookies = await parent();
  const dayOld = (env, id) => env.DB.sqlite.prepare('UPDATE photos SET sent_at = ? WHERE id = ?').run(nowSeconds() - STALE_SECONDS - 1, id);

  // The sweep, run by a clip's start or an admin home load, clears the
  // upload, a day old, just before this complete's statement.
  let { env, address } = await site();
  let sent = await sendWalked(env, cookies, address, file, {
    before: ({ id }) => {
      dayOld(env, id);
      landsBeforeFinish(env, () => clearStaleClips(env, nowSeconds()));
    },
  });
  assert.equal(sent.res.status, 404, 'cleared by the sweep');
  assert.deepEqual(await sent.res.json(), { error: 'upload' });
  await env.MEDIA.idle();
  assert.deepEqual(rows(env), []);
  assert.deepEqual([...env.MEDIA.objects.keys()], []);
  assert.equal(sentToday(env), 1, 'the sweep gives no day back: that day is over');

  // Two completes of one upload whose album closed while its parts arrived:
  // the other one is refused 409 and takes the upload back while this one
  // checks the same clip.
  ({ env, address } = await site());
  let other;
  sent = await sendWalked(env, cookies, address, file, {
    before: async (started, parts) => {
      await setAlbumOpen(env.DB, address, false, nowSeconds());
      landsBeforeFinish(env, async () => {
        other = await complete(env, cookies, started.id, started.token, { parts, captured: RECORDED });
      });
    },
  });
  assert.equal(other.status, 409);
  assert.equal(sent.res.status, 404, 'taken back by the other complete');
  assert.deepEqual(await sent.res.json(), { error: 'upload' });
  await takenBack(env, 'two completes of a closed album\'s upload');

  // A database that does not answer the read that tells the two apart is
  // 503, which the page sends again; then there is no upload: 404.
  ({ env, address } = await site());
  sent = await sendWalked(env, cookies, address, file, {
    before: ({ id }) => {
      dayOld(env, id);
      landsBeforeFinish(env, () => clearStaleClips(env, nowSeconds()));
      const prepare = env.DB.prepare;
      let reads = 0;
      env.DB.prepare = (sql) => (sql.startsWith('SELECT media_key, upload_id, state, sent_at FROM photos') && ++reads === 2
        ? { bind: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) }
        : prepare(sql));
    },
  });
  assert.equal(sent.res.status, 503, 'the read after the take-back did not answer');
  assert.deepEqual(await sent.res.json(), { error: 'unavailable' });
  const again = await sent.again();
  assert.equal(again.status, 404);
  assert.deepEqual(await again.json(), { error: 'upload' });
});

/** `land` awaited just before the first statement starting with `prefix` runs, as landsBeforeFinish does for the complete's. */
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

test('Remove\'s abandon and a complete still running, interleaved: a clip stored between the abandon\'s read and its take-back is 409 stored, never 404; an abandon that lands while the complete checks makes that complete 404 (#198\'s review)', async () => {
  // A 404 tells Remove nothing was stored, and the page drops the item while
  // the clip waits in the queue: the outcome the owner turned down.
  const { file } = androidMp4();
  const cookies = await parent();

  // The complete stores the clip just before the abandon takes it back.
  let { env, address } = await site();
  let stored;
  let asked;
  let sent = await sendWalked(env, cookies, address, file, {
    before: async ({ id, token }, parts) => {
      landsBefore(env, "DELETE FROM photos WHERE id = ? AND kind = 'clip' AND state = 'uploading'", async () => {
        stored = await complete(env, cookies, id, token, { parts, captured: RECORDED });
      });
      asked = await abandon(env, cookies, id, token);
    },
  });
  assert.equal(stored.status, 201);
  assert.equal(asked.status, 409, 'the abandon read a stored clip as never sent');
  assert.deepEqual(await asked.json(), { error: 'stored' });
  assert.equal(sent.res.status, 201, 'the page\'s own complete, sent after');
  assert.deepEqual(rows(env).map((r) => r.state), ['pending']);
  assert.equal(env.MEDIA.objects.size, 1);
  assert.equal(sentToday(env), 1);

  // The mirror: the abandon takes the upload back while the complete checks
  // it, so that complete has nothing to store.
  ({ env, address } = await site());
  let dropped;
  sent = await sendWalked(env, cookies, address, file, {
    before: ({ id, token }) => {
      landsBeforeFinish(env, async () => { dropped = await abandon(env, cookies, id, token); });
    },
  });
  assert.equal(dropped.status, 204);
  assert.equal(sent.res.status, 404, 'a complete with nothing left to store answered other than 404');
  assert.deepEqual(await sent.res.json(), { error: 'upload' });
  await takenBack(env, 'an abandon landing while the complete checked');

  // The sweep clears the upload, a day old, between the abandon's read and
  // its take-back: nothing is stored, so 404.
  ({ env, address } = await site());
  const stale = await started(env, address, cookies, 4096);
  env.DB.sqlite.prepare('UPDATE photos SET sent_at = ? WHERE id = ?').run(nowSeconds() - STALE_SECONDS - 1, stale.id);
  landsBefore(env, "DELETE FROM photos WHERE id = ? AND kind = 'clip' AND state = 'uploading'", () => clearStaleClips(env, nowSeconds()));
  const res = await abandon(env, cookies, stale.id, stale.token);
  assert.equal(res.status, 404, 'a clip the sweep cleared was read as stored');
  assert.deepEqual(await res.json(), { error: 'upload' });
  assert.deepEqual(rows(env), []);
});

test('a stored clip of another size than its start declared is refused 400 and deleted (#198)', async () => {
  const { env, address } = await site();
  const { file } = androidMp4();
  // Only a complete R2 reports gone can meet it: the parts' own sizes are
  // checked as they arrive.
  const sent = await sendWalked(env, await parent(), address, file, {
    before: async ({ id }) => {
      const row = rows(env).find((r) => r.id === id);
      const key = clipObjectKey(row.media_key);
      await env.MEDIA.resumeMultipartUpload(key, row.upload_id).abort();
      const longer = new Uint8Array(file.length + 1);
      longer.set(file);
      await env.MEDIA.put(key, longer, { httpMetadata: { contentType: 'video/mp4' } });
    },
  });
  assert.equal(sent.res.status, 400);
  assert.deepEqual(await sent.res.json(), { error: 'parts' });
  await takenBack(env, 'a clip of another size');
});
