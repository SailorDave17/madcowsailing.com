// Uploads from an account (#223, epic #216): the upload guard takes an
// account's session beside the invite link's and a coach's, an account is
// offered and may send to its approved teams' open albums only, each photo
// records the account, admins alone see its name, a coach's clip length goes
// by role, and the daily cap is the account's. Every request runs through the
// chain Pages runs (the root middleware, then the directory's guards) against
// a real SQLite holding the real migrations (test/d1.js) and the R2 stand-in.
// The guard's bad-cookie cases for every upload route are in
// test/guard.test.js, and /policy's in test/policy.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestPost as uploadRoute } from '../functions/api/upload/index.js';
import { onRequestGet as sessionRoute } from '../functions/api/upload/session.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openList } from '../functions/api/albums/open.js';
import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import { adminQueuePage, adminRemovalsPage } from '../lib/admin-page.js';
import { createAlbum, setAlbumOpen } from '../lib/albums.js';
import { CLIP_SECONDS, DAILY_UPLOADS, clipSeconds, sendsAsCoach, sessionKey } from '../lib/photos.js';
import { waitingBatches } from '../lib/queue.js';
import { hiddenPhotos } from '../lib/removals.js';
import {
  COOKIE_NAME, coachTag, nowSeconds, requireUploadSession, signCoachSession, signSession,
} from '../lib/session.js';
import { COACH, accessEnv } from './access.js';
import { d1, seedCodes } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

const FUNCTIONS = fileURLToPath(new URL('../functions/', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';
const SENT = {
  grid: jpeg({ width: 480, height: 360 }),
  screen: jpeg({ width: 1600, height: 1200 }),
  full: jpeg({ width: 2560, height: 1920 }),
};

// The accounts every test starts from, by id. Each team an admin approved is
// 'approved'; the others still wait.
const PARENT = 1; // a parent, approved for Hoover JRT, still waiting for COHSSA
const COACH_ACCOUNT = 2; // a coach, approved for COHSSA
const OTHER = 3; // 'other', approved for both
const WAITING = 4; // approved for no team yet

/**
 * A site with generation 2 current, one open album per team (COHSSA's the
 * newer), and the four accounts above.
 */
async function site({ names = {} } = {}) {
  const env = {
    DB: d1(), MEDIA: r2(), SITE_ENV: 'production', SESSION_SIGNING_KEY: KEY, ADDRESS_HASH_KEY: 'test-address-key',
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA', ...accessEnv(),
  };
  seedCodes(env.DB, 'Q2WE-R4TY-V6PA', 'K7QM-3XRD-9FWB');
  const now = nowSeconds();
  const hoover = await createAlbum(env.DB, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, now);
  const cohssa = await createAlbum(env.DB, { team: 'cohssa', title: 'COHSSA Fall Champs', kind: 'regatta', date: '2026-10-05' }, now);
  const add = env.DB.sqlite.prepare('INSERT INTO accounts (email, name, role, requested_at) VALUES (?, ?, ?, 1)');
  add.run('parent@example.org', names[PARENT] ?? 'Pat Parent', 'parent');
  add.run('coach.account@example.org', names[COACH_ACCOUNT] ?? 'Casey Coach', 'coach');
  add.run('other@example.org', names[OTHER] ?? 'Oli Other', 'other');
  add.run('waiting@example.org', names[WAITING] ?? 'Wren Waiting', 'parent');
  env.DB.sqlite.exec(
    'INSERT INTO account_teams (account_id, team, state) VALUES ' +
    `(${PARENT}, 'hoover-jrt', 'approved'), (${PARENT}, 'cohssa', 'requested'), (${COACH_ACCOUNT}, 'cohssa', 'approved'), ` +
    `(${OTHER}, 'hoover-jrt', 'approved'), (${OTHER}, 'cohssa', 'approved'), (${WAITING}, 'hoover-jrt', 'requested');`,
  );
  return { env, hoover, cohssa, now };
}

const account = (accountId, { version = 1, issued = nowSeconds(), key = KEY } = {}) =>
  signAccountSession(key, { accountId, version }, issued);
const invite = (issued = nowSeconds()) => signSession(KEY, 2, issued);
const coach = async (issued = nowSeconds()) => signCoachSession(KEY, await coachTag(KEY, COACH), issued);

// Alter the signature's first character, as test/guard.test.js does.
const tamper = (value) => {
  const signature = value.split('.').pop();
  return value.replace(signature, (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1));
};

function cookieHeader({ account: held, upload } = {}) {
  const parts = [];
  if (upload) parts.push(`${COOKIE_NAME}=${upload}`);
  if (held) parts.push(`${ACCOUNT_COOKIE}=${held}`);
  return parts.length ? { Cookie: parts.join('; ') } : {};
}

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** The share page's form for one photo into `address`. */
function form(address) {
  const body = new FormData();
  body.append('album', address);
  body.append('batch', BATCH);
  body.append('captured', '1790000000');
  for (const [size, bytes] of Object.entries(SENT)) body.append(size, new Blob([bytes], { type: 'image/jpeg' }), `${size}.jpg`);
  return body;
}

/** POST /api/upload through the whole chain, with the cookies given. */
function send(env, address, cookies) {
  const request = new Request(`${SITE}/api/upload`, { method: 'POST', headers: { Origin: SITE, ...cookieHeader(cookies) }, body: form(address) });
  return chain([root, ...uploadGuard, uploadRoute], request, env);
}

/** GET /api/albums/open through its guard: the addresses offered, in order. */
async function offered(env, cookies) {
  const res = await chain([root, albumsGuard, openList], new Request(`${SITE}/api/albums/open`, { headers: cookieHeader(cookies) }), env);
  if (res.status !== 200) return res.status;
  return (await res.json()).albums.map((album) => album.address);
}

/** The session the upload guard leaves for a request carrying `cookies`, or the guard's answer. */
async function guarded(env, cookies) {
  const data = {};
  const request = new Request(`${SITE}/api/upload/session`, { headers: cookieHeader(cookies) });
  const res = await requireUploadSession({ request, env, data, params: {}, next: () => new Response(null, { status: 204 }) });
  return res.status === 204 ? data.session : res.status;
}

const photoRows = (env) => env.DB.sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r }));
const counts = (env) => env.DB.sqlite.prepare('SELECT session, sent FROM upload_counts ORDER BY session').all().map((r) => ({ ...r }));

// ---- Criterion 1: requireUploadSession takes an account's session ----------

test('an account\'s session passes the upload guard, which leaves the account, its role and its approved teams for the route (#223, criterion 1)', async () => {
  const { env } = await site();
  const issued = nowSeconds() - 60;
  assert.deepEqual(await guarded(env, { account: await account(PARENT, { issued }) }),
    { sender: 'account', accountId: PARENT, role: 'parent', teams: ['hoover-jrt'], issued });
  // Teams in TEAMS order, whatever order they were approved in.
  assert.deepEqual(await guarded(env, { account: await account(OTHER, { issued }) }),
    { sender: 'account', accountId: OTHER, role: 'other', teams: ['hoover-jrt', 'cohssa'], issued });
  assert.deepEqual(await guarded(env, { account: await account(COACH_ACCOUNT, { issued }) }),
    { sender: 'account', accountId: COACH_ACCOUNT, role: 'coach', teams: ['cohssa'], issued });
  // Through the route the share page asks: 204, as for the invite link.
  const res = await chain([root, ...uploadGuard, sessionRoute], new Request(`${SITE}/api/upload/session`, { headers: cookieHeader({ account: await account(PARENT) }) }), env);
  assert.equal(res.status, 204);
});

test('a live account session wins over an upload cookie on the same phone, and one that no longer holds leaves the upload cookie to answer (owner, at #223\'s pickup)', async () => {
  const { env } = await site();
  const live = await account(PARENT);
  const sender = async (cookies) => {
    const session = await guarded(env, cookies);
    return typeof session === 'number' ? session : session.sender;
  };
  // Both held: the account sends, whichever upload cookie is beside it.
  assert.equal(await sender({ account: live, upload: await invite() }), 'account');
  assert.equal(await sender({ account: live, upload: await coach() }), 'account');
  // An account session that no longer holds is no session: the upload cookie
  // beside it answers as it would alone.
  for (const [name, dead] of Object.entries({
    'another version (signed out, or a new password)': await account(PARENT, { version: 2 }),
    'an account approved for no team': await account(WAITING),
    'an account that does not exist': await account(99),
    'a tampered signature': tamper(live),
    'another key': await account(PARENT, { key: `${KEY}-other` }),
  })) {
    assert.equal(await sender({ account: dead, upload: await invite() }), 'parent', name);
    assert.equal(await sender({ account: dead, upload: await coach() }), 'coach', name);
    assert.equal(await sender({ account: dead }), 401, `${name}, with no upload cookie`);
  }
});

test('a database that does not answer while the account is read: 503, closed, even beside a live upload cookie', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env } = await site();
  // Only the account's read fails, so the 503 is the account branch's.
  const prepare = env.DB.prepare;
  env.DB = { ...env.DB, prepare: (sql) => { if (/\bFROM accounts\b/.test(sql)) throw new Error('D1 down'); return prepare(sql); } };
  assert.equal(await guarded(env, { account: await account(PARENT), upload: await invite() }), 503);
  // The control: the same database still lets the invite link through.
  assert.equal((await guarded(env, { upload: await invite() })).sender, 'parent');
});

// ---- Criterion 2: only the approved teams' open events ------------------------

test('the album list offers an account only its approved teams\' open albums, and the invite link and a coach every one (#223, criterion 2)', async () => {
  const { env, hoover, cohssa, now } = await site();
  // A closed album of an approved team is offered to nobody.
  const closed = await createAlbum(env.DB, { team: 'hoover-jrt', title: 'Closed', kind: 'practice', date: '2026-10-06' }, now);
  await setAlbumOpen(env.DB, closed, false, now);
  assert.deepEqual(await offered(env, { account: await account(PARENT) }), [hoover], 'COHSSA still waits for this account');
  assert.deepEqual(await offered(env, { account: await account(COACH_ACCOUNT) }), [cohssa]);
  assert.deepEqual(await offered(env, { account: await account(OTHER) }), [cohssa, hoover], 'both, newest first');
  // The two ways in that have no team are offered every open album (#227).
  assert.deepEqual(await offered(env, { upload: await invite() }), [cohssa, hoover]);
  assert.deepEqual(await offered(env, { upload: await coach() }), [cohssa, hoover]);
  // A phone holding both is offered what its account is.
  assert.deepEqual(await offered(env, { account: await account(COACH_ACCOUNT), upload: await invite() }), [cohssa]);
  // A team revoked leaves the list at the next request.
  env.DB.sqlite.prepare(`UPDATE account_teams SET state = 'revoked' WHERE account_id = ${OTHER} AND team = 'cohssa'`).run();
  assert.deepEqual(await offered(env, { account: await account(OTHER) }), [hoover]);
});

test('a send into another team\'s album is refused 403 and stores nothing, spending none of the cap (#223, criterion 2)', async () => {
  const { env, hoover, cohssa } = await site();
  for (const [name, cookies] of Object.entries({
    'an account approved for Hoover JRT, whose COHSSA request still waits': { account: await account(PARENT) },
    'the same account, with the invite link beside it': { account: await account(PARENT), upload: await invite() },
  })) {
    const res = await send(env, cohssa, cookies);
    assert.equal(res.status, 403, name);
    assert.deepEqual(await res.json(), { error: 'team' }, name);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    await env.MEDIA.idle();
    assert.deepEqual([...env.MEDIA.objects.keys()], [], `${name}: objects stored`);
    assert.deepEqual(photoRows(env), [], `${name}: a row was written`);
    assert.deepEqual(counts(env), [], `${name}: the cap was spent`);
  }
  // The control: the same account into its own team's album is stored.
  assert.equal((await send(env, hoover, { account: await account(PARENT) })).status, 201);
  assert.equal(photoRows(env).length, 1);
});

test('a team taken off the account while a photo is on its way stores nothing, and gives the unit back', async () => {
  const { env, hoover } = await site();
  // The revoke lands after the route has checked the team and as the cap is
  // spent, so only the insert's own check can catch it.
  const prepare = env.DB.prepare;
  env.DB = {
    ...env.DB,
    prepare: (sql) => {
      if (sql.startsWith('INSERT INTO upload_counts')) env.DB.sqlite.exec(`UPDATE account_teams SET state = 'revoked' WHERE account_id = ${PARENT}`);
      return prepare(sql);
    },
  };
  const res = await send(env, hoover, { account: await account(PARENT) });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'album' });
  await env.MEDIA.idle();
  assert.deepEqual([...env.MEDIA.objects.keys()], []);
  assert.deepEqual(photoRows(env), []);
  assert.deepEqual(counts(env), [{ session: `account.${PARENT}`, sent: 0 }], 'the unit was not given back');
});

// ---- Criterion 3: each photo records the account ------------------------------

test('a photo from an account records the account, with its role as the sender and the placeholders 0005 needs (#223, criterion 3)', async () => {
  const { env, hoover, cohssa, now } = await site();
  const issued = now - 30;
  assert.equal((await send(env, hoover, { account: await account(PARENT, { issued }) })).status, 201);
  assert.equal((await send(env, cohssa, { account: await account(COACH_ACCOUNT, { issued }) })).status, 201);
  assert.equal((await send(env, hoover, { account: await account(OTHER, { issued }) })).status, 201);
  // A phone holding the invite link as well sends as the account.
  assert.equal((await send(env, hoover, { account: await account(PARENT, { issued }), upload: await invite(issued) })).status, 201);
  // The control: the invite link alone names no account, and its generation.
  assert.equal((await send(env, hoover, { upload: await invite(issued) })).status, 201);
  const sent = photoRows(env).map(({ sender, code_generation, session_issued, account_id, state }) =>
    ({ sender, code_generation, session_issued, account_id, state }));
  assert.deepEqual(sent, [
    { sender: 'parent', code_generation: 0, session_issued: 0, account_id: PARENT, state: 'pending' },
    { sender: 'coach', code_generation: 0, session_issued: 0, account_id: COACH_ACCOUNT, state: 'pending' },
    { sender: 'parent', code_generation: 0, session_issued: 0, account_id: OTHER, state: 'pending' },
    { sender: 'parent', code_generation: 0, session_issued: 0, account_id: PARENT, state: 'pending' },
    { sender: 'parent', code_generation: 2, session_issued: issued, account_id: null, state: 'pending' },
  ]);
});

test('the queue and removals pages name the account that sent each photo, escaped; the invite link and a deleted account say nothing (#223, criterion 3)', async () => {
  const name = 'Pat <b>Parent</b> & "co"';
  const { env, hoover, cohssa } = await site({ names: { [PARENT]: name } });
  assert.equal((await send(env, hoover, { account: await account(PARENT) })).status, 201);
  assert.equal((await send(env, cohssa, { account: await account(COACH_ACCOUNT) })).status, 201);
  assert.equal((await send(env, hoover, { upload: await invite() })).status, 201);
  assert.equal((await send(env, hoover, { upload: await coach() })).status, 201);
  const escaped = 'Pat &lt;b&gt;Parent&lt;/b&gt; &amp; &quot;co&quot;';
  const facts = (html, id) => html.match(new RegExp(`<li class="(?:waiting|removal)" id="photo-${id}">[\\s\\S]*?<p class="(?:waiting|removal)-facts">([\\s\\S]*?)</p>`))?.[1];

  const queue = adminQueuePage({ batches: await waitingBatches(env.DB) });
  assert.match(facts(queue, 1), new RegExp(`· sent by ${escaped}$`));
  assert.ok(!queue.includes('<b>Parent</b>'), 'the name reached the page as markup');
  assert.match(facts(queue, 2), /· sent by Casey Coach$/, 'a coach account is named, not "a coach"');
  assert.doesNotMatch(facts(queue, 3), /sent by/, 'the invite link names nobody');
  assert.match(facts(queue, 4), /· sent by a coach$/, 'a coach\'s Access sign-in says only that (#192)');

  env.DB.sqlite.exec("UPDATE photos SET state = 'hidden', approved_at = 5, hidden_at = 6");
  const removals = adminRemovalsPage({ photos: await hiddenPhotos(env.DB) });
  assert.match(facts(removals, 1), new RegExp(`· sent by ${escaped}$`));
  assert.match(facts(removals, 2), /· sent by Casey Coach$/);
  assert.doesNotMatch(facts(removals, 3), /sent by/);

  // A deleted account's photos stay, and no longer name it (/policy, #219).
  env.DB.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(PARENT);
  assert.equal(env.DB.sqlite.prepare('SELECT account_id FROM photos WHERE id = 1').get().account_id, null);
  assert.doesNotMatch(facts(adminRemovalsPage({ photos: await hiddenPhotos(env.DB) }), 1), /sent by/);
  env.DB.sqlite.exec("UPDATE photos SET state = 'pending', approved_at = NULL, hidden_at = NULL");
  assert.doesNotMatch(facts(adminQueuePage({ batches: await waitingBatches(env.DB) }), 1), /sent by/);
});

// Every Function route outside the guarded directories: what anyone can ask
// for with no session, by the same walk test/guard.test.js makes.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full).map((p) => `${name}/${p}`));
    else out.push(name);
  }
  return out;
}
const GUARDED = /^(?:(?:api\/)?admin|coach|account|api\/upload|api\/albums)\//;
const publicRoutes = walk(FUNCTIONS).filter((f) => f.endsWith('.js') && !/(^|\/)_middleware\.js$/.test(f) && !GUARDED.test(f));

async function stackFor(file, method) {
  const dirs = file.split('/').slice(0, -1);
  const stack = [];
  for (let depth = 0; depth <= dirs.length; depth++) {
    const path = join(FUNCTIONS, ...dirs.slice(0, depth), '_middleware.js');
    if (!existsSync(path)) continue;
    const mod = await import(pathToFileURL(path));
    stack.push(...[mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`] ?? mod.onRequest ?? []].flat());
  }
  const route = await import(pathToFileURL(join(FUNCTIONS, file)));
  const handler = route[`onRequest${method[0]}${method.slice(1).toLowerCase()}`] ?? route.onRequest;
  if (!handler) return null;
  // Past the route, Pages serves its static files; here, a plain 404.
  return [...stack, handler, () => new Response('static 404', { status: 404 })];
}

test('no public route, response or image names the account that sent a photo (#223, criterion 3)', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const name = 'Planted Sender Q7XK';
  const email = 'planted.sender.q7xk@example.org';
  const { env, hoover } = await site();
  env.DB.sqlite.prepare('UPDATE accounts SET name = ?, email = ? WHERE id = ?').run(name, email, PARENT);
  assert.equal((await send(env, hoover, { account: await account(PARENT) })).status, 201);
  assert.equal((await send(env, hoover, { account: await account(PARENT) })).status, 201);
  // One approved and public, one hidden, so the takedown's pages read a row too.
  env.DB.sqlite.exec("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = 1");
  env.DB.sqlite.exec("UPDATE photos SET state = 'hidden', approved_at = 5, hidden_at = 6 WHERE id = 2");
  const id = 1;

  const leaks = (label, text) => {
    for (const planted of [name, email, name.toLowerCase(), email.toUpperCase(), 'Q7XK']) {
      assert.ok(!text.toLowerCase().includes(planted.toLowerCase()), `${label} names the account (${planted})`);
    }
  };
  const read = async (res) => {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return `${res.status} ${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${new TextDecoder('latin1').decode(bytes)}`;
  };
  // The scanner's control: the admins' queue, which must name the account,
  // reads as a leak, so a public page carrying the name would too.
  env.DB.sqlite.exec("UPDATE photos SET state = 'pending', approved_at = NULL WHERE id = 1");
  const queue = adminQueuePage({ batches: await waitingBatches(env.DB) });
  assert.throws(() => leaks('the admin queue', queue), /names the account/);
  env.DB.sqlite.exec("UPDATE photos SET state = 'approved', approved_at = 5 WHERE id = 1");

  // A directory's index is served at its path with the slash (#227).
  const pathFor = (file, size) => `/${file.replace(/\.js$/, '').replace('[address]', hoover).replace('[id]', String(id)).replace('[size]', size).replace(/(^|\/)index$/, '$1')}`;
  const paramsFor = (size) => ({ address: hoover, id: String(id), size });
  // No public route reaches another service here: Turnstile, Resend and
  // Pwned Passwords each answer as if down.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('no network in this test'); });
  // The takedown runs last, since it hides the photo every other route reads.
  const ordered = [...publicRoutes.filter((f) => f !== 'api/remove.js'), 'api/remove.js'];
  const answered = [];
  for (const file of ordered) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const stack = await stackFor(file, method);
      if (!stack) continue;
      for (const size of file.includes('[size]') ? ['grid', 'screen', 'full'] : ['-']) {
        const path = pathFor(file, size);
        // A post carries the one field a public post reads about a photo,
        // its id (/remove, /api/remove), from the site's own Origin.
        const init = method === 'POST'
          ? { method, headers: { Origin: SITE, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' }, body: `photo=${id}` }
          : { method, headers: { 'CF-Connecting-IP': '192.0.2.1' } };
        const res = await chain(stack, new Request(`${SITE}${path}`, init), env, paramsFor(size));
        const text = await read(res);
        leaks(`${method} ${path}`, text);
        answered.push(`${method} ${path} ${res.status}`);
      }
    }
  }
  // The routes that read the photo were reached and answered with it: the
  // list, the photo's section, the album, the three sizes and the takedown's
  // confirmation, each 200. A 404 here would scan a page that holds nothing.
  for (const reached of [
    'GET / 200', 'GET /hoover-jrt/ 200', `GET /albums/${hoover}/ 200`, `GET /photos/${id}/grid 200`,
    `GET /photos/${id}/screen 200`, `GET /photos/${id}/full 200`, 'POST /remove 200', 'POST /api/remove 303',
  ]) {
    assert.ok(answered.includes(reached), `not reached: ${reached}\n${answered.join('\n')}`);
  }
});

// ---- Criterion 4: a coach's clip, by role ----------------------------------

test('a coach\'s clip may run 15 minutes and everyone else\'s 3, by role, read from the session the guard leaves (#223, criterion 4; D11)', async () => {
  assert.deepEqual(CLIP_SECONDS, { coach: 15 * 60, everyone: 3 * 60 });
  const { env } = await site();
  const clip = async (cookies) => clipSeconds(await guarded(env, cookies));
  assert.equal(await clip({ upload: await invite() }), 180, 'the invite link');
  assert.equal(await clip({ upload: await coach() }), 900, 'a coach\'s Access sign-in (#192)');
  assert.equal(await clip({ account: await account(COACH_ACCOUNT) }), 900, 'an account with the coach role');
  assert.equal(await clip({ account: await account(PARENT) }), 180, 'a parent\'s account');
  assert.equal(await clip({ account: await account(OTHER) }), 180, 'an account with the other role');
  // A coach's account beside an invite link sends as the coach it is.
  assert.equal(await clip({ account: await account(COACH_ACCOUNT), upload: await invite() }), 900);
  // The role is read on every request: changed at approval, it applies next.
  env.DB.sqlite.prepare("UPDATE accounts SET role = 'coach' WHERE id = ?").run(PARENT);
  assert.equal(await clip({ account: await account(PARENT) }), 900);
  assert.equal(sendsAsCoach({ sender: 'account', role: 'coach' }), true);
  assert.equal(sendsAsCoach({ sender: 'parent', role: 'coach' }), false, 'only an account carries a role');
});

// ---- Criterion 5: the daily cap is the account's ------------------------------

test('an account\'s 500 a day are shared by every phone signed in to it, and kept apart from the invite link\'s and other accounts\' (#223, criterion 5)', async () => {
  const { env, hoover, now } = await site();
  assert.equal(sessionKey({ sender: 'account', accountId: PARENT, issued: now }), `account.${PARENT}`);
  // One short of the cap, spent from the account's first phone.
  const day = Math.floor(nowSeconds() / 86400);
  env.DB.sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, ?)').run(`account.${PARENT}`, day, DAILY_UPLOADS - 1);
  // A second phone, signed in at another time, takes the last one.
  assert.equal((await send(env, hoover, { account: await account(PARENT, { issued: now - 3600 }) })).status, 201);
  // A third phone, signed in again since: the account's day is spent.
  const capped = await send(env, hoover, { account: await account(PARENT, { issued: now - 10 }) });
  assert.equal(capped.status, 429);
  assert.deepEqual(await capped.json(), { error: 'daily-cap' });
  assert.ok(Number(capped.headers.get('Retry-After')) > 0);
  // The invite link on the same phone is the account's while signed in, and
  // its own once signed out; another account counts on its own.
  assert.equal((await send(env, hoover, { account: await account(PARENT), upload: await invite() })).status, 429);
  assert.equal((await send(env, hoover, { upload: await invite() })).status, 201);
  assert.equal((await send(env, hoover, { account: await account(OTHER) })).status, 201);
  assert.deepEqual(counts(env).find((row) => row.session === `account.${PARENT}`), { session: `account.${PARENT}`, sent: DAILY_UPLOADS });
});
