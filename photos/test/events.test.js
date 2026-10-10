// POST /api/albums (#273, epic #267): an approved sender makes an event for
// their team from the share page's "Create a new event". Every request runs
// through the chain Pages runs in front of the route (the root middleware,
// then the albums directory's two guards, the upload session's and the
// Origin's) against a real SQLite holding every migration (test/d1.js), 0018's
// created_by, provisional and earlier_address among them. Each test names the
// criterion it holds.
//
// This file holds the create's half of the story: who may make an event
// (criterion 2), the Origin (criterion 8), each field's refusal and the date
// window (D4), the daily cap (criterion 6, D8), the address an event is made
// at (criterion 3's create half), and the open list right after a create
// (criterion 4's open-list half, criterion 7). The first approval's remake of
// the address, an upload to an earlier address (criterion 10), the admin
// page, the share page and /policy are held in their own files. Every way a
// session or an Origin can fail on every route here is in test/guard.test.js.
//
// The clock is fixed at noon UTC on 2026-10-09 in every test that makes or
// lists an event (site(), below), since the date window and the cap are both
// counted in UTC days and a run across midnight would move both. Nothing here
// renders a date, so no timezone is pinned: every date is a YYYY-MM-DD string
// the test wrote or the server's UTC day.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestPost as createRoute } from '../functions/api/albums/index.js';
import { onRequestGet as openList } from '../functions/api/albums/open.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequestPost as closeRoute } from '../functions/api/admin/albums/close.js';
import { onRequestPost as deleteRoute } from '../functions/api/admin/albums/delete.js';
import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import {
  EVENTS_A_DAY, EVENT_DAYS_AHEAD, EVENT_DAYS_BACK, MAX_SUFFIX, NOT_SURE_TITLE, TITLE_MAX, addressCandidates, allAlbums,
  baseAddress, createAlbum, createEvent,
} from '../lib/albums.js';
import { secondsToNextDay } from '../lib/photos.js';
import { nowSeconds } from '../lib/session.js';
import { adminCookieHeader, seedAdmin } from './admin.js';
import { d1 } from './d1.js';

const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const DAY = 86_400;

// The fixed clock: noon UTC on 2026-10-09, so its UTC day began 12 hours
// before and ends 12 hours after.
const NOW = Date.UTC(2026, 9, 9, 12) / 1000;
const DAY_START = NOW - (NOW % DAY);
const TODAY = '2026-10-09';
/** The date `days` from TODAY, as YYYY-MM-DD. */
const dayFrom = (days) => new Date((DAY_START + days * DAY) * 1000).toISOString().slice(0, 10);

// The accounts every test starts from, by id. The owner is seeded first, so
// it is 1 (test/admin.js); it closes and deletes events in the cap's tests.
// Each team an admin approved is 'approved'; a request still waiting is no
// team, so Pat is approved for one.
const OWNER = 1;
const PAT = 2; // approved for Hoover JRT; a COHSSA request still waits
const ROBIN = 3; // approved for Hoover JRT, a second sender there
const CASEY = 4; // approved for COHSSA alone
const OLI = 5; // approved for both teams
const WREN = 6; // approved for no team yet

/** A site with the owner and the five accounts above, and 0015's two Not sure albums. */
function seed() {
  const env = { DB: d1(), SITE_ENV: 'production', SESSION_SIGNING_KEY: KEY };
  seedAdmin(env.DB);
  const add = env.DB.sqlite.prepare("INSERT INTO accounts (id, email, name, role, requested_at) VALUES (?, ?, ?, 'parent', 1)");
  add.run(PAT, 'pat@example.org', 'Pat Parent');
  add.run(ROBIN, 'robin@example.org', 'Robin Rigger');
  add.run(CASEY, 'casey@example.org', 'Casey Coach');
  add.run(OLI, 'oli@example.org', 'Oli Other');
  add.run(WREN, 'wren@example.org', 'Wren Waiting');
  env.DB.sqlite.exec(
    'INSERT INTO account_teams (account_id, team, state) VALUES ' +
    `(${PAT}, 'hoover-jrt', 'approved'), (${PAT}, 'cohssa', 'requested'), (${ROBIN}, 'hoover-jrt', 'approved'), ` +
    `(${CASEY}, 'cohssa', 'approved'), (${OLI}, 'hoover-jrt', 'approved'), (${OLI}, 'cohssa', 'approved'), ` +
    `(${WREN}, 'hoover-jrt', 'requested');`,
  );
  return env;
}

/** seed(), with the clock fixed at NOW for the rest of test `t`. */
function site(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW * 1000 });
  return seed();
}

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** An account's live session cookie value, signed in now. */
const signedIn = (accountId) => signAccountSession(KEY, { accountId, version: 1 }, nowSeconds());

// What the share page posts for a practice today. A test spreads changes on
// top; a field set to undefined is left out of the JSON.
const PRACTICE = { title: 'Saturday Practice', kind: 'practice', date: TODAY };

/**
 * POST /api/albums through the whole chain, as `accountId` (none when
 * falsy), with `fields` as JSON or `body` as it is, from `origin` (none when
 * null).
 */
async function create(env, accountId, fields, { origin = SITE, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin !== null) headers.Origin = origin;
  if (accountId) headers.Cookie = `${ACCOUNT_COOKIE}=${await signedIn(accountId)}`;
  const request = new Request(`${SITE}/api/albums`, { method: 'POST', headers, body: body ?? JSON.stringify(fields) });
  return chain([root, ...albumsGuard, createRoute], request, env);
}

/** An answer's status and JSON body, for one deepEqual. */
const reply = async (res) => ({ status: res.status, body: await res.json() });

/** GET /api/albums/open through the whole chain, as `accountId`: its JSON. */
async function openFor(env, accountId) {
  const request = new Request(`${SITE}/api/albums/open`, { headers: { Cookie: `${ACCOUNT_COOKIE}=${await signedIn(accountId)}` } });
  const res = await chain([root, ...albumsGuard, openList], request, env);
  assert.equal(res.status, 200);
  return res.json();
}

const ADMIN_ROUTES = { close: closeRoute, delete: deleteRoute };

/** A press of Close or Delete on /admin/albums, as the owner: where it sent the browser. */
async function adminPress(env, action, address) {
  const request = new Request(`${SITE}/api/admin/albums/${action}`, {
    method: 'POST',
    headers: { Origin: SITE, Cookie: await adminCookieHeader(OWNER, { key: KEY }), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ address }).toString(),
  });
  const res = await chain([root, ...adminApi, ADMIN_ROUTES[action]], request, env);
  assert.equal(res.status, 303);
  return res.headers.get('Location');
}

// Every album row, 0015's Not sure albums included, for "nothing was written".
const allRows = (env) => env.DB.sqlite.prepare('SELECT * FROM albums ORDER BY id').all().map((r) => ({ ...r }));
// The events alone, with the columns a create writes.
const events = (env) => env.DB.sqlite
  .prepare('SELECT address, team, title, kind, held_on, created_at, created_by, provisional, earlier_address, closed_at FROM albums WHERE holding = 0 ORDER BY id')
  .all().map((r) => ({ ...r }));
// The events `accountId` made in NOW's UTC day that still exist: what the cap counts.
const madeToday = (db, accountId) => db.sqlite
  .prepare('SELECT COUNT(*) AS n FROM albums WHERE created_by = ? AND created_at >= ?').get(accountId, DAY_START).n;

/** An event's fields as createEvent takes them: a Hoover JRT practice today named `title`. */
const hooverPractice = (title) => ({ team: 'hoover-jrt', title, kind: 'practice', date: TODAY });

test('the fixed clock is noon UTC on 2026-10-09, and dayFrom counts whole UTC days from it', () => {
  // The helpers every date below is written with, so a wrong one cannot pass
  // the window's tests by moving both sides at once.
  assert.equal(new Date(NOW * 1000).toISOString(), '2026-10-09T12:00:00.000Z');
  assert.equal(new Date(DAY_START * 1000).toISOString(), '2026-10-09T00:00:00.000Z');
  assert.deepEqual([dayFrom(0), dayFrom(-31), dayFrom(-32), dayFrom(2), dayFrom(3)], [TODAY, '2026-09-08', '2026-09-07', '2026-10-11', '2026-10-12']);
});

// ---- Criterion 2: only an account approved for the team creates in it ------

test('#273 criterion 2: an account approved for the team makes the event: 201 {address}, a row naming the account, provisional, at its date and title\'s address', async (t) => {
  const env = site(t);
  const res = await create(env, PAT, { ...PRACTICE, team: 'hoover-jrt' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { address: '2026-10-09-saturday-practice' });
  assert.deepEqual(events(env), [{
    address: '2026-10-09-saturday-practice', team: 'hoover-jrt', title: 'Saturday Practice', kind: 'practice', held_on: TODAY,
    created_at: NOW, created_by: PAT, provisional: 1, earlier_address: null, closed_at: null,
  }]);
});

test('#273 criterion 2: an account not approved for the team is refused 403 {"error":"team"} and nothing is written', async (t) => {
  const env = site(t);
  const before = allRows(env);
  // The INSERTs the route asks D1 to make. A team the guard did not list is
  // refused by the route before it asks for one; createEvent's own check is
  // for a team revoked after the guard read it (the test below).
  const inserts = () => env.DB.statements.filter((sql) => sql.startsWith('INSERT INTO albums')).length;
  for (const [who, accountId, team] of [
    ['an account whose COHSSA request still waits', PAT, 'cohssa'],
    ['an account approved for COHSSA alone', CASEY, 'hoover-jrt'],
  ]) {
    const res = await create(env, accountId, { ...PRACTICE, team });
    assert.deepEqual(await reply(res), { status: 403, body: { error: 'team' } }, who);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', who);
  }
  assert.deepEqual(allRows(env), before);
  assert.equal(inserts(), 0, 'the route asked D1 to write an event in a team the guard did not list');
  // The control: the same two accounts make one in their own team, so the
  // 403s are for the team and not for the account, and each success is one
  // INSERT asked for.
  assert.equal((await create(env, PAT, { ...PRACTICE, team: 'hoover-jrt' })).status, 201);
  assert.equal((await create(env, CASEY, { ...PRACTICE, team: 'cohssa' })).status, 201);
  assert.equal(inserts(), 2);
  assert.deepEqual(events(env).map((e) => [e.team, e.created_by]), [['hoover-jrt', PAT], ['cohssa', CASEY]]);
});

test('#273 criterion 2: no session is refused 401, as is an account approved for no team, and nothing is written', async (t) => {
  const env = site(t);
  const before = allRows(env);
  // From the site's own Origin, so the 401 is the session's.
  assert.deepEqual(await reply(await create(env, null, { ...PRACTICE, team: 'hoover-jrt' })), { status: 401, body: { error: 'not-joined' } });
  assert.deepEqual(await reply(await create(env, WREN, { ...PRACTICE, team: 'hoover-jrt' })), { status: 401, body: { error: 'not-joined' } });
  assert.deepEqual(allRows(env), before);
  // The control: an approved account's same request is made.
  assert.equal((await create(env, PAT, { ...PRACTICE, team: 'hoover-jrt' })).status, 201);
});

test('#273 criterion 2: a team revoked after the guard read it makes nothing: createEvent refuses "team", and the route answers 403', async (t) => {
  const env = site(t);
  const before = allRows(env);
  // Straight to createEvent, after the revoke: the route's check of the
  // guard's teams is behind it, so only the INSERT's own check can refuse.
  env.DB.sqlite.prepare("UPDATE account_teams SET state = 'revoked' WHERE account_id = ? AND team = 'hoover-jrt'").run(PAT);
  assert.deepEqual(await createEvent(env.DB, hooverPractice('Saturday Practice'), PAT, NOW), { refused: 'team' });
  assert.deepEqual(allRows(env), before);
  // The control: an account still approved for the team is made, by the same call.
  assert.ok((await createEvent(env.DB, hooverPractice('Saturday Practice'), ROBIN, NOW)).address);

  // Through the route: the guard reads Robin's teams, and the revoke lands as
  // the event's INSERT is prepared, after the route has checked the team.
  const mid = allRows(env);
  const prepare = env.DB.prepare;
  env.DB = {
    ...env.DB,
    prepare: (sql) => {
      if (sql.startsWith('INSERT INTO albums')) env.DB.sqlite.exec(`UPDATE account_teams SET state = 'revoked' WHERE account_id = ${ROBIN}`);
      return prepare(sql);
    },
  };
  assert.deepEqual(await reply(await create(env, ROBIN, { ...PRACTICE, title: 'Sunday Practice' })), { status: 403, body: { error: 'team' } });
  assert.deepEqual(allRows(env), mid);
});

// ---- Criterion 8: a create from another origin is refused ------------------

test('#273 criterion 8: a create from another origin, or with none, is refused 403 {"error":"origin"} and writes nothing', async (t) => {
  const env = site(t);
  const before = allRows(env);
  for (const [name, origin] of Object.entries({
    'no Origin': null,
    'another site\'s Origin': 'https://evil.example',
    'the sibling site\'s Origin': 'https://madcowsailing.com',
    'the site\'s own host over http': 'http://photos.madcowsailing.com',
  })) {
    const res = await create(env, PAT, PRACTICE, { origin });
    assert.deepEqual(await reply(res), { status: 403, body: { error: 'origin' } }, name);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', name);
  }
  assert.deepEqual(allRows(env), before);
  // The control: the same request from the site's own Origin is made.
  assert.deepEqual(await reply(await create(env, PAT, PRACTICE)), { status: 201, body: { address: '2026-10-09-saturday-practice' } });
});

// ---- The fields: each its own refusal, and the date window (D4) -----------

test('#273 criterion 1: an account approved for one team may leave the team out, and the event is that team\'s; one approved for two must name it (400 team)', async (t) => {
  const env = site(t);
  // Pat's COHSSA request still waits, so Hoover JRT is its one team.
  assert.equal((await create(env, PAT, PRACTICE)).status, 201);
  assert.deepEqual(events(env).map((e) => [e.team, e.created_by]), [['hoover-jrt', PAT]]);
  const before = allRows(env);
  assert.deepEqual(await reply(await create(env, OLI, PRACTICE)), { status: 400, body: { error: 'team' } });
  assert.deepEqual(allRows(env), before);
  // The control: naming either of its teams, the same account makes one.
  assert.equal((await create(env, OLI, { ...PRACTICE, team: 'cohssa', title: 'COHSSA Practice' })).status, 201);
  assert.equal(events(env).at(-1).team, 'cohssa');
});

test('#273 criterion 1: each wrong field is refused 400 with its own word, the first in the form\'s order, and writes nothing', async (t) => {
  const env = site(t);
  const before = allRows(env);
  for (const [name, accountId, fields, word] of [
    ['a team that is not one of the site\'s', PAT, { ...PRACTICE, team: 'nowhere' }, 'team'],
    ['a team that is not a string', PAT, { ...PRACTICE, team: 1 }, 'team'],
    ['no team, from an account approved for two', OLI, PRACTICE, 'team'],
    ['no title', PAT, { ...PRACTICE, title: undefined }, 'title'],
    ['a title of spaces alone', PAT, { ...PRACTICE, title: '   ' }, 'title'],
    [`a title of ${TITLE_MAX + 1} characters`, PAT, { ...PRACTICE, title: 'x'.repeat(TITLE_MAX + 1) }, 'title'],
    ['a title on two lines', PAT, { ...PRACTICE, title: 'Saturday\nPractice' }, 'title'],
    ['a title that is not a string', PAT, { ...PRACTICE, title: 42 }, 'title'],
    ['no kind', PAT, { ...PRACTICE, kind: undefined }, 'kind'],
    ['a kind the form does not offer', PAT, { ...PRACTICE, kind: 'race' }, 'kind'],
    ['a kind named after a property every object has', PAT, { ...PRACTICE, kind: 'toString' }, 'kind'],
    ['no date', PAT, { ...PRACTICE, date: undefined }, 'date'],
    ['a day that does not exist', PAT, { ...PRACTICE, date: '2026-09-31' }, 'date'],
    ['a date not written YYYY-MM-DD', PAT, { ...PRACTICE, date: '10/09/2026' }, 'date'],
    // The order the form shows them: team, title, kind, date.
    ['every field wrong', PAT, { team: 'nowhere', title: '', kind: 'race', date: 'soon' }, 'team'],
    ['the title, kind and date wrong', PAT, { title: '', kind: 'race', date: 'soon' }, 'title'],
    ['the kind and date wrong', PAT, { ...PRACTICE, kind: 'race', date: 'soon' }, 'kind'],
  ]) {
    const res = await create(env, accountId, fields);
    assert.deepEqual(await reply(res), { status: 400, body: { error: word } }, name);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', name);
  }
  assert.deepEqual(allRows(env), before);
  // The control at the title's edge: TITLE_MAX characters, with spaces around
  // them that are trimmed, is made, so the long title above was refused for
  // its length.
  assert.equal((await create(env, PAT, { ...PRACTICE, title: `  ${'x'.repeat(TITLE_MAX)}  ` })).status, 201);
  assert.equal(events(env)[0].title, 'x'.repeat(TITLE_MAX));
});

test('#273: a body that is not a JSON object is 400 {"error":"form"}, and one over 4 KiB is 413 {"error":"too-large"}, writing nothing', async (t) => {
  const env = site(t);
  const before = allRows(env);
  for (const [name, body] of Object.entries({
    'a form post': 'title=Saturday+Practice&kind=practice&date=2026-10-09',
    'a JSON list': '[]',
    'JSON null': 'null',
    'a JSON string': '"Saturday Practice"',
    'an empty body': '',
  })) {
    assert.deepEqual(await reply(await create(env, PAT, null, { body })), { status: 400, body: { error: 'form' } }, name);
  }
  // A valid event padded with a field the route ignores, to an exact size.
  const padded = (bytes) => {
    const shell = JSON.stringify({ ...PRACTICE, pad: '' });
    return JSON.stringify({ ...PRACTICE, pad: 'x'.repeat(bytes - shell.length) });
  };
  assert.equal(new TextEncoder().encode(padded(4097)).length, 4097);
  assert.deepEqual(await reply(await create(env, PAT, null, { body: padded(4097) })), { status: 413, body: { error: 'too-large' } });
  assert.deepEqual(allRows(env), before);
  // The control: 4 KiB to the byte is read, and made.
  assert.equal(new TextEncoder().encode(padded(4096)).length, 4096);
  assert.equal((await create(env, PAT, null, { body: padded(4096) })).status, 201);
});

test('#273 D4: a sender may date an event 31 days back through 2 ahead of the server\'s UTC day; 32 back and 3 ahead are 400 date', async (t) => {
  // The owner's window at #273's pickup: the share page offers 30 days back
  // through tomorrow on the phone's own date, and the server, whose day is
  // UTC's, takes one day more each way, since a phone's date is at most a day
  // either side of UTC's.
  assert.equal(EVENT_DAYS_BACK, 30);
  assert.equal(EVENT_DAYS_AHEAD, 1);
  const env = site(t);
  const taken = [-(EVENT_DAYS_BACK + 1), EVENT_DAYS_AHEAD + 1];
  const refused = [-(EVENT_DAYS_BACK + 2), EVENT_DAYS_AHEAD + 2];
  for (const days of taken) {
    assert.deepEqual(await reply(await create(env, PAT, { ...PRACTICE, date: dayFrom(days) })),
      { status: 201, body: { address: `${dayFrom(days)}-saturday-practice` } }, `${days} days`);
  }
  const before = allRows(env);
  for (const days of refused) {
    assert.deepEqual(await reply(await create(env, PAT, { ...PRACTICE, date: dayFrom(days) })),
      { status: 400, body: { error: 'date' } }, `${days} days`);
  }
  assert.deepEqual(allRows(env), before);
  // The window is the UTC day's, not the 24 hours around the clock: the same
  // at its last second and at its first.
  t.mock.timers.setTime((DAY_START + DAY - 1) * 1000);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'Late', date: dayFrom(taken[0]) })).status, 201);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'Late', date: dayFrom(refused[1]) })).status, 400);
  t.mock.timers.setTime(DAY_START * 1000);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'Early', date: dayFrom(taken[1]) })).status, 201);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'Early', date: dayFrom(refused[0]) })).status, 400);
});

// ---- Criterion 6: at most 10 events an account a UTC day (D8) --------------

test('#273 criterion 6: the cap is the owner\'s 10 events an account a UTC day', () => {
  // Written out, since the tests below count up to the constant and would
  // pass at any cap.
  assert.equal(EVENTS_A_DAY, 10);
});

test('#273 criterion 6: the 10th event of a UTC day is made and the 11th refused 429 {"error":"events"} until the next UTC day, writing nothing; yesterday\'s events and another account\'s do not count', async (t) => {
  const env = site(t);
  // Made the second before today began: yesterday's, so not counted.
  assert.ok((await createEvent(env.DB, { ...hooverPractice('Yesterday'), date: dayFrom(-1) }, PAT, DAY_START - 1)).address);
  // Three of Robin's today, counted against Robin and not against Pat.
  for (const n of [1, 2, 3]) assert.equal((await create(env, ROBIN, { ...PRACTICE, title: `Robin practice ${n}` })).status, 201);
  // Made the second today began: today's, so counted as Pat's first.
  assert.ok((await createEvent(env.DB, hooverPractice('Dawn Practice'), PAT, DAY_START)).address);
  for (let n = 2; n <= EVENTS_A_DAY; n++) {
    assert.equal((await create(env, PAT, { ...PRACTICE, title: `Practice ${n}` })).status, 201, `event ${n} of ${EVENTS_A_DAY}`);
  }
  assert.equal(madeToday(env.DB, PAT), EVENTS_A_DAY);

  const before = allRows(env);
  const refused = await create(env, PAT, { ...PRACTICE, title: 'Practice 11' });
  assert.deepEqual(await reply(refused), { status: 429, body: { error: 'events' } });
  assert.equal(refused.headers.get('Cache-Control'), 'no-store');
  assert.equal(refused.headers.get('Retry-After'), String(secondsToNextDay(NOW)));
  assert.equal(refused.headers.get('Retry-After'), '43200', 'noon to the next UTC midnight');
  assert.deepEqual(allRows(env), before);

  // The cap is Pat's alone: Robin, with three, makes a fourth.
  assert.equal((await create(env, ROBIN, { ...PRACTICE, title: 'Robin practice 4' })).status, 201);
  // The next UTC day, Pat makes one again.
  t.mock.timers.setTime((NOW + secondsToNextDay(NOW)) * 1000);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'Practice 11' })).status, 201);
});

test('#273 criterion 6 (D8): an event an admin deletes the same day frees one place, and one closed frees none', async (t) => {
  const env = site(t);
  const made = [];
  for (let n = 1; n <= EVENTS_A_DAY; n++) made.push((await (await create(env, PAT, { ...PRACTICE, title: `Practice ${n}` })).json()).address);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'One more' })).status, 429);
  // Closed, an event still exists, and still counts.
  assert.equal(await adminPress(env, 'close', made[1]), `/admin/albums?done=closed&album=${encodeURIComponent(made[1])}`);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'One more' })).status, 429, 'a closed event freed a place');
  // Deleted, it frees its place (owner, at #273's pickup).
  assert.equal(await adminPress(env, 'delete', made[0]), `/admin/albums?done=deleted&album=${encodeURIComponent(made[0])}`);
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'One more' })).status, 201, 'the deleted event did not free its place');
  assert.equal((await create(env, PAT, { ...PRACTICE, title: 'And another' })).status, 429, 'one place, not more');
});

// A D1 whose every statement and batch waits a macrotask before it runs, as a
// real D1 call is I/O: two calls in flight interleave between statements. The
// plain stand-in settles in microtasks (cairn:
// a-race-test-through-the-request-chain-never-interleaves). Copied from
// test/sign-in.test.js, where it was written.
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
 * The create as it would be written with the count read first and the event
 * inserted after: the shape cairn's a-count-then-record-limit-is-not-a-limit
 * warns of, here only to prove the race test below can catch it.
 */
async function countThenInsert(db, accountId, title) {
  const { made } = await db.prepare('SELECT COUNT(*) AS made FROM albums WHERE created_by = ? AND created_at >= ?').bind(accountId, DAY_START).first();
  if (made >= EVENTS_A_DAY) return { refused: 'cap' };
  const address = baseAddress(hooverPractice(title));
  await db.prepare(
    "INSERT INTO albums (address, team, title, kind, held_on, created_at, created_by, provisional) VALUES (?, 'hoover-jrt', ?, 'practice', ?, ?, ?, 1)",
  ).bind(address, title, TODAY, NOW, accountId).run();
  return { address };
}

test('#273 criterion 6: two creates at once with 9 made leave exactly 10, one refused "cap", since the count is inside the one INSERT', async (t) => {
  const env = site(t);
  for (let n = 1; n < EVENTS_A_DAY; n++) assert.ok((await createEvent(env.DB, hooverPractice(`Practice ${n}`), PAT, NOW)).address);
  const both = await Promise.all(['A', 'B'].map((x) => createEvent(slow(env.DB), hooverPractice(`Race ${x}`), PAT, NOW)));
  assert.deepEqual(both.map((r) => (r.address ? 'made' : r.refused)).sort(), ['cap', 'made']);
  assert.equal(madeToday(env.DB, PAT), EVENTS_A_DAY);
  // The control: the count read first and the insert after, through the same
  // stand-in, lets both presses through to 11, so this stand-in interleaves
  // enough to catch a create rewritten that way.
  for (let n = 1; n < EVENTS_A_DAY; n++) assert.ok((await createEvent(env.DB, hooverPractice(`Robin ${n}`), ROBIN, NOW)).address);
  const naive = await Promise.all(['A', 'B'].map((x) => countThenInsert(slow(env.DB), ROBIN, `Naive ${x}`)));
  assert.deepEqual(naive.map((r) => (r.address ? 'made' : r.refused)), ['made', 'made']);
  assert.equal(madeToday(env.DB, ROBIN), EVENTS_A_DAY + 1);
});

test('#273 criterion 6: a create is one INSERT carrying the team check and the day\'s count, and the read saying why is made only on a refusal', async (t) => {
  const env = site(t);
  const { DB } = env;
  // What createEvent asks D1, as test/d1.js records every statement prepared.
  const asked = async (...args) => {
    const from = DB.statements.length;
    const result = await createEvent(DB, ...args);
    return { result, sql: DB.statements.slice(from) };
  };
  const made = await asked(hooverPractice('Saturday Practice'), PAT, NOW);
  assert.ok(made.result.address);
  assert.equal(made.sql.length, 1, made.sql.join('\n'));
  assert.match(made.sql[0], /^INSERT INTO albums \(/);
  assert.match(made.sql[0], /\(SELECT COUNT\(\*\) FROM albums WHERE created_by = \? AND created_at >= \?\) < \?/);
  assert.match(made.sql[0], /EXISTS \(SELECT 1 FROM account_teams WHERE account_id = \? AND team = \? AND state = 'approved'\)/);
  // Each refusal: the same INSERT, writing nothing, then one read saying why.
  for (let n = 1; n <= EVENTS_A_DAY; n++) assert.ok((await createEvent(DB, hooverPractice(`Robin ${n}`), ROBIN, NOW)).address);
  for (const [why, accountId] of [['team', CASEY], ['cap', ROBIN]]) {
    const before = allRows(env);
    const { result, sql } = await asked(hooverPractice('Sunday Practice'), accountId, NOW);
    assert.deepEqual(result, { refused: why });
    assert.equal(sql.length, 2, sql.join('\n'));
    assert.equal(sql[0], made.sql[0], why);
    assert.match(sql[1], /^SELECT EXISTS \(SELECT 1 FROM account_teams/, why);
    assert.deepEqual(allRows(env), before, why);
  }
});

// ---- Criterion 3, the create's half: the address --------------------------

test('#273 criterion 3: an event\'s address is made from its date and title as an admin\'s album\'s is: the same fields give the same address, a second takes -2, a title with no letter takes its kind', async (t) => {
  const env = site(t);
  // A second site, where an admin adds the same albums on /admin/albums.
  const admins = d1();
  const fields = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
  assert.equal(await createAlbum(admins, fields, NOW), '2026-10-04-fall-regatta');
  assert.deepEqual(await reply(await create(env, PAT, fields)), { status: 201, body: { address: '2026-10-04-fall-regatta' } });
  assert.equal(await createAlbum(admins, fields, NOW), '2026-10-04-fall-regatta-2');
  assert.deepEqual(await reply(await create(env, ROBIN, fields)), { status: 201, body: { address: '2026-10-04-fall-regatta-2' } });
  // A title with no letter or digit in it takes its kind's name.
  assert.equal(await createAlbum(admins, { ...fields, title: '& & &' }, NOW), '2026-10-04-regatta');
  assert.deepEqual(await reply(await create(env, PAT, { ...fields, title: '& & &' })), { status: 201, body: { address: '2026-10-04-regatta' } });
});

test('#273 criterion 3: a sender\'s create passes over an admin\'s album\'s address and another event\'s earlier address', async (t) => {
  const env = site(t);
  const fields = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
  // The base, an admin's album.
  assert.equal(await createAlbum(env.DB, fields, NOW), '2026-10-04-fall-regatta');
  // base-2, the earlier address of an event whose first approval made it a
  // new one, as lib/albums.js's fixAddress leaves a row.
  env.DB.sqlite.prepare(
    'INSERT INTO albums (address, team, title, kind, held_on, created_at, created_by, earlier_address) ' +
    "VALUES ('2026-10-04-fall-regatta-day-one', 'hoover-jrt', 'Fall Regatta Day One', 'regatta', '2026-10-04', ?, ?, '2026-10-04-fall-regatta-2')",
  ).run(NOW, ROBIN);
  assert.deepEqual(await reply(await create(env, PAT, fields)), { status: 201, body: { address: '2026-10-04-fall-regatta-3' } });
  // The control: on a site where base-2 is nobody's earlier address, the same
  // create takes base-2, so -3 above was for the earlier address.
  const plain = seed();
  await createAlbum(plain.DB, fields, NOW);
  assert.deepEqual(await reply(await create(plain, PAT, fields)), { status: 201, body: { address: '2026-10-04-fall-regatta-2' } });
});

test('#273 criterion 3: with every address the date and title can take held, an earlier address among them, the create is refused 409 {"error":"full"} and writes nothing', async (t) => {
  assert.equal(MAX_SUFFIX, 50);
  const env = site(t);
  const fields = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
  const candidates = addressCandidates(baseAddress(fields));
  assert.deepEqual([candidates.length, candidates[0], candidates[1], candidates.at(-1)],
    [MAX_SUFFIX, '2026-10-04-fall-regatta', '2026-10-04-fall-regatta-2', '2026-10-04-fall-regatta-50']);
  // The last, another event's earlier address; base … base-49, admins' albums.
  env.DB.sqlite.prepare(
    'INSERT INTO albums (address, team, title, kind, held_on, created_at, created_by, earlier_address) ' +
    "VALUES ('2026-10-04-fall-regatta-day-one', 'hoover-jrt', 'Fall Regatta Day One', 'regatta', '2026-10-04', ?, ?, ?)",
  ).run(NOW, ROBIN, candidates.at(-1));
  for (let n = 1; n < MAX_SUFFIX; n++) await createAlbum(env.DB, fields, NOW);
  assert.deepEqual(
    env.DB.sqlite.prepare("SELECT address FROM albums WHERE title = 'Fall Regatta' ORDER BY id").all().map((r) => r.address),
    candidates.slice(0, -1),
  );

  const before = allRows(env);
  const res = await create(env, PAT, fields);
  assert.deepEqual(await reply(res), { status: 409, body: { error: 'full' } });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(allRows(env), before);
  // createEvent's answer, and its two statements: the INSERT, then the read
  // saying why, made only now that nothing was written.
  const from = env.DB.statements.length;
  assert.deepEqual(await createEvent(env.DB, fields, PAT, NOW), { refused: 'full' });
  assert.equal(env.DB.statements.length - from, 2);
  assert.deepEqual(allRows(env), before);

  // The control: with that earlier address let go, the same create is made
  // at base-50, so the 409 counted it as held.
  env.DB.sqlite.prepare('UPDATE albums SET earlier_address = NULL WHERE earlier_address = ?').run(candidates.at(-1));
  assert.deepEqual(await reply(await create(env, PAT, fields)), { status: 201, body: { address: candidates.at(-1) } });
});

// ---- Criterion 4's open-list half, and criterion 7 -------------------------

test('#273 criterion 4: a new event is in GET /api/albums/open at once for every account approved for its team, and for no other', async (t) => {
  const env = site(t);
  const { address } = await (await create(env, PAT, PRACTICE)).json();
  // Listed as every album is, with nothing saying a sender made it.
  const entry = { address, title: 'Saturday Practice', kind: 'practice', date: TODAY, team: 'hoover-jrt', teamName: 'Hoover JRT' };
  for (const [who, accountId] of [
    ['the account that made it', PAT],
    ['another account approved for Hoover JRT', ROBIN],
    ['an account approved for both teams', OLI],
  ]) {
    assert.deepEqual((await openFor(env, accountId)).albums, [entry], who);
  }
  assert.deepEqual((await openFor(env, CASEY)).albums, [], 'an account approved for COHSSA alone');
  // The control for that empty list: an event made in COHSSA is offered to
  // Casey, and not to Pat, whose COHSSA request still waits.
  const cohssa = (await (await create(env, OLI, { ...PRACTICE, team: 'cohssa', title: 'COHSSA Practice' })).json()).address;
  assert.deepEqual((await openFor(env, CASEY)).albums.map((a) => a.address), [cohssa]);
  assert.deepEqual((await openFor(env, PAT)).albums.map((a) => a.address), [address]);
});

test('#273 criteria 1 and 7: the open list names the account\'s teams, and each team\'s "Not sure / other event" is still offered apart, in other, after creates', async (t) => {
  const env = site(t);
  const made = [];
  for (const team of ['hoover-jrt', 'cohssa']) made.push((await (await create(env, OLI, { ...PRACTICE, team })).json()).address);
  const both = await openFor(env, OLI);
  assert.deepEqual(both.teams, [{ team: 'hoover-jrt', teamName: 'Hoover JRT' }, { team: 'cohssa', teamName: 'COHSSA' }]);
  assert.deepEqual(both.albums.map((a) => a.address).sort(), [...made].sort());
  assert.deepEqual(both.other, [
    { address: '0001-01-01-not-sure-hoover-jrt', team: 'hoover-jrt', teamName: 'Hoover JRT' },
    { address: '0001-01-01-not-sure-cohssa', team: 'cohssa', teamName: 'COHSSA' },
  ]);
  // Both Not sure albums are as 0015 made them, and still open.
  assert.deepEqual(
    env.DB.sqlite.prepare('SELECT title, holding, closed_at, created_by, provisional FROM albums WHERE holding = 1 ORDER BY id').all().map((r) => ({ ...r })),
    [1, 2].map(() => ({ title: NOT_SURE_TITLE, holding: 1, closed_at: null, created_by: null, provisional: 0 })),
  );
  assert.deepEqual((await openFor(env, PAT)).teams, [{ team: 'hoover-jrt', teamName: 'Hoover JRT' }], 'a request still waiting is no team');
  // Why the list names the teams: with no open event and its Not sure album
  // closed, a team appears nowhere else in it, and the share page still asks
  // for it.
  env.DB.sqlite.prepare("UPDATE albums SET closed_at = ? WHERE holding = 1 AND team = 'cohssa'").run(NOW);
  env.DB.sqlite.prepare('UPDATE albums SET closed_at = ? WHERE address = ?').run(NOW, made[1]);
  const casey = await openFor(env, CASEY);
  assert.deepEqual([casey.albums, casey.other], [[], []]);
  assert.deepEqual(casey.teams, [{ team: 'cohssa', teamName: 'COHSSA' }]);
});

test('#273 criterion 5: the open list never says who made an event: no key names the creator, and the creator\'s name and address are nowhere in it', async (t) => {
  const env = site(t);
  const name = 'Planted Creator Q7ZV';
  const email = 'planted.creator.q7zv@example.org';
  env.DB.sqlite.prepare('UPDATE accounts SET name = ?, email = ? WHERE id = ?').run(name, email, PAT);
  assert.equal((await create(env, PAT, PRACTICE)).status, 201);

  // Every key at every depth of a JSON value.
  const keysOf = (value) => (value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, inner]) => [...(Array.isArray(value) ? [] : [key]), ...keysOf(inner)])
    : []);
  const leaks = (label, body) => {
    assert.deepEqual(keysOf(body).filter((key) => /creat|made|account|sender/i.test(key)), [], `${label} has a key naming the creator`);
    const text = JSON.stringify(body).toLowerCase();
    for (const planted of [name, email, 'Q7ZV']) assert.ok(!text.includes(planted.toLowerCase()), `${label} names the creator (${planted})`);
  };
  // The scanner's two controls. The admin pages' reader, which must name the
  // creator (criterion 5), fails on its key; a list carrying the name in a
  // title fails on the name.
  const admins = await allAlbums(env.DB);
  assert.equal(admins.find((album) => album.title === PRACTICE.title).madeBy, name);
  assert.throws(() => leaks('allAlbums', admins), /has a key naming the creator/);
  assert.throws(() => leaks('a planted list', { albums: [{ title: name }] }), /names the creator/);

  for (const [who, accountId] of [['the account that made it', PAT], ['another account approved for Hoover JRT', ROBIN], ['an account approved for both teams', OLI]]) {
    const body = await openFor(env, accountId);
    assert.equal(body.albums.length, 1, who);
    leaks(`the open list for ${who}`, body);
  }
});
