// A coach signs in through Cloudflare Access and uploads without the invite
// link (#192; epic #147, D9 and D10).
//
// /coach runs the admin guard's token check (#151) against the coaches'
// list and application, then sets an upload session that no code opened.
// Every request here runs through the chain Pages runs in front of the route
// (the root middleware, then the directory's guards), against a real SQLite
// holding the real migrations (test/d1.js) and an R2 stand-in (test/r2.js),
// with Access tokens minted from generated keys (test/access.js). Each test
// names the criterion it holds; criterion 9's guard half is in
// test/guard.test.js.
//
// Timing tests move the clock by literal seconds, never by the constants
// they test, so a changed constant turns them red (prove-tests shape 15).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as coachGuard } from '../functions/coach/_middleware.js';
import { onRequestGet as coachRoute } from '../functions/coach/index.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestPost as upload } from '../functions/api/upload/index.js';
import { onRequestGet as uploadSession } from '../functions/api/upload/session.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openAlbums } from '../functions/api/albums/open.js';
import { onRequestPost as join } from '../functions/api/join.js';
import { TOKEN_HEADER, keyCache } from '../lib/access.js';
import { adminQueuePage } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { base64url, hmac } from '../lib/crypto.js';
import { rotateCode } from '../lib/invite.js';
import { sessionKey } from '../lib/photos.js';
import { approvedPhoto } from '../lib/public.js';
import { approvePhotos, waitingBatches } from '../lib/queue.js';
import {
  COOKIE_NAME, SESSION_SECONDS, coachListed, coachTag, nowSeconds, readSession, requireUploadSession,
  signCoachSession, signSession,
} from '../lib/session.js';
import {
  AUD, COACH, COACH_AUD, OWNER, accessEnv, certs, claims, coachClaims, keyPair, mint, publicPem, segment,
} from './access.js';
import { d1, seedCodes } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const OTHER_KEY = 'another-session-signing-key-fedcba9876543210';
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';
const FALL = { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };

const team = await keyPair();
const stranger = await keyPair();
beforeEach(() => keyCache.clear());

const publishes = (t, keys = () => [team.jwk]) => t.mock.method(globalThis, 'fetch', certs(keys));
const now = () => Math.floor(Date.now() / 1000);

/** A site with generation 2 current and one open album. */
async function site(extra = {}) {
  const env = { DB: d1(), MEDIA: r2(), SITE_ENV: 'production', SESSION_SIGNING_KEY: KEY, ...accessEnv(), ...extra };
  seedCodes(env.DB, 'Q2WE-R4TY-V6PA', 'K7QM-3XRD-9FWB');
  const address = await createAlbum(env.DB, FALL, nowSeconds());
  return { env, address };
}

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/** GET /coach through the whole chain, as Access passes it on. */
function signIn(env, { token, url = `${SITE}/coach`, headers = {} } = {}) {
  const all = { ...headers };
  if (token !== undefined) all[TOKEN_HEADER] = token;
  return chain([root, ...coachGuard, coachRoute], new Request(url, { headers: all }), env);
}

const withCookie = (cookie, headers = {}) => (cookie ? { ...headers, Cookie: `${COOKIE_NAME}=${cookie}` } : headers);

/** GET /api/upload/session: the share page's "can this phone send?" */
const sessionCheck = (env, cookie) =>
  chain([root, ...uploadGuard, uploadSession], new Request(`${SITE}/api/upload/session`, { headers: withCookie(cookie) }), env);

/** GET /api/albums/open: the share page's album list. */
const albumList = (env, cookie) =>
  chain([root, albumsGuard, openAlbums], new Request(`${SITE}/api/albums/open`, { headers: withCookie(cookie) }), env);

/** The share page's form for one photo into `address`. */
function form(address) {
  const body = new FormData();
  body.append('album', address);
  body.append('batch', BATCH);
  body.append('captured', '1790000000');
  for (const [name, [width, height]] of Object.entries({ grid: [480, 360], screen: [1600, 1200], full: [2560, 1920] })) {
    body.append(name, new Blob([jpeg({ width, height })], { type: 'image/jpeg' }), `${name}.jpg`);
  }
  return body;
}

/** POST /api/upload through the whole chain, from the site's own Origin. */
const send = (env, cookie, address) =>
  chain([root, ...uploadGuard, upload], new Request(`${SITE}/api/upload`, {
    method: 'POST', headers: withCookie(cookie, { Origin: SITE }), body: form(address),
  }), env);

/** The session value a Set-Cookie header carries. */
const cookieOf = (response) => response.headers.get('Set-Cookie')?.match(new RegExp(`^${COOKIE_NAME}=([^;]+)`))?.[1];

const photoRows = (env) => env.DB.sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r }));

async function assertRefused(response, status = 403) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Set-Cookie'), null, 'a refusal set a session');
  assert.equal(response.headers.get('Location'), null, 'a refusal sent the browser on');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await response.text(), /coach@example\.com/);
}

// ---- Criterion 1: a listed coach lands on the share page with a session ---

test('criterion 1: a coach\'s token at /coach answers 303 to /share/ with an upload session, and the share page finds it', async (t) => {
  publishes(t);
  const { env } = await site();
  const res = await signIn(env, { token: await mint(team, coachClaims()) });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/share/');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  const [pair, ...attributes] = res.headers.get('Set-Cookie').split('; ');
  assert.ok(pair.startsWith(`${COOKIE_NAME}=c1.`), pair);
  assert.deepEqual(attributes.sort(), ['HttpOnly', `Max-Age=${SESSION_SECONDS}`, 'Path=/', 'SameSite=Lax', 'Secure']);

  // What the share page does next, with no code in its address: ask whether
  // this browser can send. It can, and it sees the album to send to.
  const cookie = cookieOf(res);
  assert.equal((await sessionCheck(env, cookie)).status, 204);
  const albums = await albumList(env, cookie);
  assert.equal(albums.status, 200);
  assert.deepEqual((await albums.json()).albums.map((a) => a.title), ['Fall Regatta']);
  // The control: without the cookie, the same check says this phone cannot.
  assert.equal((await sessionCheck(env, undefined)).status, 401);
});

test('criterion 1: the coach typed and followed no code: /coach answers the same whatever the code, and with none', async (t) => {
  publishes(t);
  // A database that has never held an invite code: no parent can join, and
  // a coach still signs in and sends.
  const env = { DB: d1(), MEDIA: r2(), SESSION_SIGNING_KEY: KEY, ...accessEnv() };
  const address = await createAlbum(env.DB, FALL, nowSeconds());
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  assert.equal((await sessionCheck(env, cookie)).status, 204);
  assert.equal((await send(env, cookie, address)).status, 201);
  // The control: a parent's cookie for generation 1 is refused here, since no code exists.
  assert.equal((await sessionCheck(env, await signSession(KEY, 1, nowSeconds()))).status, 401);
});

test('criterion 1: the cookie names the coach by a keyed hash, never the address', async (t) => {
  publishes(t);
  const { env } = await site();
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  const session = await readSession(new Request(SITE, { headers: withCookie(cookie) }), KEY);
  assert.equal(session.sender, 'coach');
  assert.equal(session.coach, await coachTag(KEY, COACH));
  for (const form of [COACH, COACH.split('@')[0], base64url(new TextEncoder().encode(COACH)), encodeURIComponent(COACH)]) {
    assert.ok(!cookie.includes(form), `the cookie carries ${form}`);
  }
  // Keyed: another key gives another tag, so the tag cannot be matched
  // against a guessed address without the site's key.
  assert.notEqual(await coachTag(OTHER_KEY, COACH), await coachTag(KEY, COACH));
  // And it is the address as the list compares it: case and spaces aside.
  assert.equal(await coachTag(KEY, ' Coach@Example.COM '), await coachTag(KEY, COACH));
});

test('criterion 1: with SESSION_SIGNING_KEY unset, a coach\'s token gets 503 and no session: closed, never open', async (t) => {
  publishes(t);
  t.mock.method(console, 'error', () => {});
  const { env } = await site({ SESSION_SIGNING_KEY: undefined });
  const res = await signIn(env, { token: await mint(team, coachClaims()) });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

// ---- Criterion 2: every refusal is 403, and sets no session --------------

const REFUSALS = {
  'no token': async () => undefined,
  'a malformed token, not-a-jwt': async () => 'not-a-jwt',
  'three parts whose header is not JSON': async () => {
    const [, payload, signature] = (await mint(team, coachClaims())).split('.');
    return `${base64url(new TextEncoder().encode('{not json'))}.${payload}.${signature}`;
  },
  'characters outside base64url in the signature': async () => `${(await mint(team, coachClaims())).split('.').slice(0, 2).join('.')}.!!!`,
  'an expired token': () => mint(team, coachClaims({ exp: now() - 1 })),
  'a token with no exp': () => mint(team, coachClaims({ exp: undefined })),
  'a token not yet valid (nbf an hour ahead)': () => mint(team, coachClaims({ nbf: now() + 3600 })),
  'a token with no nbf': () => mint(team, coachClaims({ nbf: undefined })),
  'alg none with no signature': async () => `${segment({ alg: 'none', typ: 'JWT', kid: team.kid })}.${segment(coachClaims())}.`,
  'alg none over a real RS256 signature': () => mint(team, coachClaims(), { header: { alg: 'none' } }),
  'HS256 signed with the public key': async () => {
    const pem = await publicPem(team);
    return mint(team, coachClaims(), { header: { alg: 'HS256' }, sign: (input) => hmac(pem, input) });
  },
  'a header naming RS512 over a real RS256 signature': () => mint(team, coachClaims(), { header: { alg: 'RS512' } }),
  // The key-confusion case above is refused twice over: by the alg check and
  // by the RS256 the code pins, so neither alone reddens it (#151's R14).
  // This one has a real RS256 signature, so the alg check alone refuses it.
  'a header naming HS256 over a real RS256 signature': () => mint(team, coachClaims(), { header: { alg: 'HS256' } }),
  'a token signed by a key the team does not publish': () => mint(stranger, coachClaims()),
  'the team\'s kid, signed by another key': () => mint(stranger, coachClaims(), { header: { kid: team.kid } }),
  'a payload altered after signing': async () => {
    const [head, , signature] = (await mint(team, coachClaims({ email: 'intruder@example.com' }))).split('.');
    return `${head}.${segment(coachClaims())}.${signature}`;
  },
  'a token issued by another team': () => mint(team, coachClaims({ iss: 'https://otherteam.cloudflareaccess.com' })),
  'a token with no aud': () => mint(team, coachClaims({ aud: undefined })),
  'a token for another Access application': () => mint(team, coachClaims({ aud: ['b'.repeat(64)] })),
  'the coach\'s address in a token for the admin application': () => mint(team, coachClaims({ aud: [AUD] })),
  'an address not on the coach list': () => mint(team, coachClaims({ email: 'someone@example.com' })),
  'an admin\'s address, which is not on the coach list, for the coaches\' application': () => mint(team, coachClaims({ email: OWNER })),
  'the owner\'s admin token': () => mint(team, claims()),
  'a token with no email (a service token)': () => mint(team, coachClaims({ email: undefined, common_name: 'x.access' })),
};

for (const [name, token] of Object.entries(REFUSALS)) {
  test(`criterion 2: /coach with ${name}: 403, no session`, async (t) => {
    publishes(t);
    const { env } = await site();
    await assertRefused(await signIn(env, { token: await token() }));
  });
}

test('criterion 2: a token at exactly its exp, and one whose nbf is 61 s ahead: 403; 60 s ahead passes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  publishes(t);
  const { env } = await site();
  await assertRefused(await signIn(env, { token: await mint(team, coachClaims({ exp: now() })) }));
  await assertRefused(await signIn(env, { token: await mint(team, coachClaims({ nbf: now() + 61 })) }));
  assert.equal((await signIn(env, { token: await mint(team, coachClaims({ nbf: now() + 60 })) })).status, 303);
});

test('criterion 2: with COACH_EMAILS or ACCESS_COACH_AUD unset, a coach\'s valid token is refused', async (t) => {
  publishes(t);
  for (const extra of [{ COACH_EMAILS: undefined }, { COACH_EMAILS: ' , ' }, { ACCESS_COACH_AUD: undefined }]) {
    const { env } = await site(extra);
    await assertRefused(await signIn(env, { token: await mint(team, coachClaims()) }));
  }
  // The case only the config check stops: no tag set, and a token with no aud.
  const { env } = await site({ ACCESS_COACH_AUD: undefined });
  await assertRefused(await signIn(env, { token: await mint(team, coachClaims({ aud: undefined })) }));
});

test('criterion 2: keys that cannot be fetched answer 503 and set no session', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network down'); });
  const { env } = await site();
  await assertRefused(await signIn(env, { token: await mint(team, coachClaims()) }), 503);
});

test('criterion 2: no hostname, environment, header or cookie opens /coach without the token', async (t) => {
  // The shapes a bypass would take: a local or pages.dev host, a dev flag, a
  // header claiming to be Access, and a valid token in the CF_Authorization
  // cookie, which is never read. Each must still answer 403.
  publishes(t);
  const valid = await mint(team, coachClaims());
  const hosts = ['http://localhost:8788', 'http://127.0.0.1:8788', 'https://madcowphotos.pages.dev', 'https://develop.madcowphotos.pages.dev', SITE];
  const envs = [{}, { SITE_ENV: 'dev' }, { SITE_ENV: 'preview' }, { SITE_ENV: 'local', DEV: 'true' }];
  const headers = [{}, { 'X-Dev-Bypass': '1' }, { 'Cf-Access-Authenticated-User-Email': COACH }, { Cookie: `CF_Authorization=${valid}` }];
  let refused = 0;
  for (const host of hosts) {
    for (const extra of envs) {
      const { env } = await site(extra);
      for (const header of headers) {
        await assertRefused(await signIn(env, { url: `${host}/coach`, headers: header }));
        refused++;
      }
      // The control: the same host and environment with the token pass.
      assert.equal((await signIn(env, { url: `${host}/coach`, token: valid })).status, 303, host);
    }
  }
  assert.equal(refused, hosts.length * envs.length * headers.length);
});

// ---- Criteria 3 and 4: the upload knows it is a coach's, and waits --------

test('criteria 3 and 4: a coach\'s upload is stored as the coach\'s, naming no code, and waits for approval', async (t) => {
  publishes(t);
  const { env, address } = await site();
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  const res = await send(env, cookie, address);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const [row] = photoRows(env);
  assert.equal(row.id, id);
  assert.equal(row.sender, 'coach');
  assert.equal(row.code_generation, null);
  // No session time either (owner, at #192's review): the second a coach
  // signed in sits beside their address in Cloudflare's sign-in log.
  assert.equal(row.session_issued, null);
  assert.equal(row.state, 'pending');
  assert.equal(row.approved_at, null);
  // Not public until an admin approves it (D10), and public once one does.
  assert.equal(await approvedPhoto(env.DB, id), null);
  await approvePhotos(env.DB, [id], nowSeconds());
  assert.equal(await approvedPhoto(env.DB, id), row.media_key);
});

test('criterion 3: the upload guard puts a coach\'s session on context.data, marked as a coach\'s', async () => {
  const { env } = await site();
  const issued = nowSeconds();
  const coach = await coachTag(KEY, COACH);
  const context = {
    request: new Request(`${SITE}/api/upload`, { headers: withCookie(await signCoachSession(KEY, coach, issued)) }),
    env,
    data: {},
    next: async () => new Response('route ran'),
  };
  assert.equal((await requireUploadSession(context)).status, 200);
  assert.deepEqual(context.data.session, { sender: 'coach', coach, issued });
});

test('criterion 3: a coach\'s daily count is kept under a key of its own, apart from every parent\'s', async (t) => {
  publishes(t);
  const { env, address } = await site();
  const parent = await signSession(KEY, 2, nowSeconds());
  const coachCookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  assert.equal((await send(env, parent, address)).status, 201);
  assert.equal((await send(env, coachCookie, address)).status, 201);
  const keys = env.DB.sqlite.prepare('SELECT session, sent FROM upload_counts ORDER BY session').all().map((r) => ({ ...r }));
  const coachSession = await readSession(new Request(SITE, { headers: withCookie(coachCookie) }), KEY);
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => k.session === sessionKey(coachSession) && k.sent === 1));
  assert.match(sessionKey(coachSession), /^coach\.[A-Za-z0-9_-]{43}\.\d+$/);
  assert.deepEqual(photoRows(env).map((r) => r.sender), ['parent', 'coach']);
});

test('criterion 3: the approval queue says "sent by a coach" beside a coach\'s photo, and not beside a parent\'s', async (t) => {
  publishes(t);
  const { env, address } = await site();
  const parentId = (await (await send(env, await signSession(KEY, 2, nowSeconds()), address)).json()).id;
  const coachCookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  const coachId = (await (await send(env, coachCookie, address)).json()).id;
  const html = adminQueuePage({ batches: await waitingBatches(env.DB) });
  const item = (id) => html.match(new RegExp(`<li class="waiting" id="photo-${id}">[\\s\\S]*?</li>`))?.[0];
  assert.match(item(coachId), /<p class="waiting-facts">Taken <time[^>]*>[^<]*<\/time> · sent by a coach<\/p>/);
  assert.doesNotMatch(item(parentId), /coach/);
  assert.equal(html.match(/sent by a coach/g).length, 1);
});

// ---- Criterion 5: off the list, refused from the next request -------------

test('criterion 5: an address taken off the coach list is refused from its next request, and sends nothing', async (t) => {
  publishes(t);
  const { env, address } = await site({ COACH_EMAILS: `${COACH},second@example.com` });
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  assert.equal((await sessionCheck(env, cookie)).status, 204);

  env.COACH_EMAILS = 'second@example.com';
  for (const res of [await sessionCheck(env, cookie), await albumList(env, cookie), await send(env, cookie, address)]) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'not-joined' });
  }
  await env.MEDIA.idle();
  assert.deepEqual([...env.MEDIA.objects.keys()], []);
  assert.deepEqual(photoRows(env), []);

  // The controls: the coach still on the list keeps sending, and putting the
  // address back opens the same session again, so the refusal was the list.
  const second = cookieOf(await signIn(env, { token: await mint(team, coachClaims({ email: 'second@example.com' })) }));
  assert.equal((await sessionCheck(env, second)).status, 204);
  env.COACH_EMAILS = ` ${COACH.toUpperCase()} , second@example.com`;
  assert.equal((await sessionCheck(env, cookie)).status, 204);
});

test('criterion 5: with COACH_EMAILS unset or empty, every coach\'s session is refused', async () => {
  const cookie = await signCoachSession(KEY, await coachTag(KEY, COACH), nowSeconds());
  for (const list of [undefined, '', ' , ']) {
    const { env } = await site({ COACH_EMAILS: list });
    assert.equal((await sessionCheck(env, cookie)).status, 401, String(list));
  }
});

test('criterion 5: coachListed compares the tag with every listed address, and only those', async () => {
  const tag = await coachTag(KEY, COACH);
  assert.equal(await coachListed(KEY, tag, `first@example.com, ${COACH}`), true);
  assert.equal(await coachListed(KEY, tag, 'first@example.com'), false);
  // A tag made with another key names nobody here.
  assert.equal(await coachListed(KEY, await coachTag(OTHER_KEY, COACH), COACH), false);
});

// ---- Criterion 6: a rotation leaves coaches alone (owner, at pickup) ------

test('criterion 6: rotating the code ends every parent session and leaves a coach\'s sending', async (t) => {
  publishes(t);
  const { env, address } = await site();
  const parent = await signSession(KEY, 2, nowSeconds());
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  await rotateCode(env.DB, nowSeconds());
  assert.equal((await sessionCheck(env, cookie)).status, 204);
  assert.equal((await send(env, cookie, address)).status, 201);
  // The control: the parent's session from the same moment is over.
  assert.equal((await sessionCheck(env, parent)).status, 401);
  assert.equal((await send(env, parent, address)).status, 401);
});

// ---- The share page points a coach to /coach (#192's review) --------------

test('the share page\'s join step links /coach, beside the invite-link wording a coach cannot act on', () => {
  const html = readFileSync(new URL('../public/share/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('id="join-status"');
  const end = html.indexOf('<div class="sender"');
  assert.ok(start > 0 && end > start, `join step not found (${start}, ${end})`);
  const step = html.slice(start, end);
  assert.ok(step.includes('<p>A coach? <a href="/coach">Sign in at /coach</a> instead.</p>'));
  // Outside the sender block, so it shows before and after joining, and
  // share.js never hides it: no id for the script to reach.
  assert.doesNotMatch(step.match(/<p>A coach\?.*<\/p>/)[0], /\bid=|\bhidden\b/);
});

// ---- The invite link keeps a coach's session (owner, at #192's review) ----

/** POST /api/join with the share page's body, from the site's own Origin. */
const joinWith = (env, cookie, code, origin = SITE) =>
  chain([root, join], new Request(`${SITE}/api/join`, {
    method: 'POST',
    headers: withCookie(cookie, { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }),
    body: JSON.stringify({ code }),
  }), env);

const joinKeys = { ADDRESS_HASH_KEY: 'test-address-hash-key-0123456789abcdef' };
const failures = (env) => env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM join_failures').get().n;

test('a listed coach who opens the current invite link keeps the coach\'s session: 204 with no Set-Cookie', async (t) => {
  publishes(t);
  const { env, address } = await site(joinKeys);
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  const res = await joinWith(env, cookie, 'K7QM-3XRD-9FWB');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Set-Cookie'), null, 'joining replaced the coach\'s session');
  // Still a coach's: the photo says so, and a rotation leaves it sending.
  assert.equal((await send(env, cookie, address)).status, 201);
  assert.equal(photoRows(env)[0].sender, 'coach');
  await rotateCode(env.DB, nowSeconds());
  assert.equal((await sessionCheck(env, cookie)).status, 204);
});

test('a listed coach\'s session with a wrong code: 204, no cookie, and no failure recorded', async (t) => {
  publishes(t);
  const { env } = await site(joinKeys);
  const cookie = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  const res = await joinWith(env, cookie, '0000-0000-0000');
  assert.deepEqual([res.status, res.headers.get('Set-Cookie')], [204, null]);
  assert.equal(failures(env), 0);
});

test('the controls: a coach off the list, and a parent, join as before; and the Origin is still checked first', async (t) => {
  publishes(t);
  const { env } = await site(joinKeys);
  const coach = cookieOf(await signIn(env, { token: await mint(team, coachClaims()) }));
  // Off the list, the coach's cookie counts for nothing: the current code
  // sets a parent's session in its place.
  env.COACH_EMAILS = 'second@example.com';
  const off = await joinWith(env, coach, 'K7QM-3XRD-9FWB');
  assert.equal(off.status, 204);
  assert.match(cookieOf(off) ?? '', /^v1\.2\./);
  // A parent's cookie is replaced by the current code's session, as since #150.
  const parent = await joinWith(env, await signSession(KEY, 1, nowSeconds()), 'K7QM-3XRD-9FWB');
  assert.match(cookieOf(parent) ?? '', /^v1\.2\./);
  // A listed coach's cookie does not get past a missing Origin.
  env.COACH_EMAILS = COACH;
  const foreign = await joinWith(env, coach, 'K7QM-3XRD-9FWB', null);
  assert.equal(foreign.status, 403);
  assert.deepEqual(await foreign.json(), { error: 'origin' });
});

// ---- The coach's cookie, read directly -----------------------------------

const withValue = (value) => new Request(`${SITE}/api/upload/session`, { headers: withCookie(value) });

test('a coach\'s cookie with its coach tag swapped for another listed coach\'s, signature kept, is refused', async () => {
  // The attack the signature covers: carry a session onto another coach.
  const value = await signCoachSession(KEY, await coachTag(KEY, 'former@example.com'), nowSeconds());
  const [version, , issued, signature] = value.split('.');
  const edited = `${version}.${await coachTag(KEY, COACH)}.${issued}.${signature}`;
  assert.equal(await readSession(withValue(edited), KEY), null);
});

test('a coach\'s cookie whose issue time was moved later, signature kept, is refused', async () => {
  const [version, coach, , signature] = (await signCoachSession(KEY, await coachTag(KEY, COACH), nowSeconds() - 1000)).split('.');
  assert.equal(await readSession(withValue(`${version}.${coach}.${nowSeconds()}.${signature}`), KEY), null);
});

test('a coach\'s cookie signed with another key is refused', async () => {
  const value = await signCoachSession(OTHER_KEY, await coachTag(KEY, COACH), nowSeconds());
  assert.equal(await readSession(withValue(value), KEY), null);
});

test('a coach\'s cookie is refused at 90 days old, and accepted a second before', async () => {
  const t0 = nowSeconds();
  const coach = await coachTag(KEY, COACH);
  assert.equal(await readSession(withValue(await signCoachSession(KEY, coach, t0 - 7_776_000)), KEY, t0), null);
  assert.deepEqual(
    await readSession(withValue(await signCoachSession(KEY, coach, t0 - 7_775_999)), KEY, t0),
    { sender: 'coach', coach, issued: t0 - 7_775_999 },
  );
});

test('a coach\'s cookie issued in the future is refused, past a minute of clock skew', async () => {
  const t0 = nowSeconds();
  const coach = await coachTag(KEY, COACH);
  assert.ok(await readSession(withValue(await signCoachSession(KEY, coach, t0 + 60)), KEY, t0));
  assert.equal(await readSession(withValue(await signCoachSession(KEY, coach, t0 + 61)), KEY, t0), null);
});

test('a malformed coach\'s cookie reads as no session, and nothing throws', async () => {
  const good = await signCoachSession(KEY, await coachTag(KEY, COACH), nowSeconds());
  const [, coach, issued, signature] = good.split('.');
  for (const value of [
    `c2.${coach}.${issued}.${signature}`, `c1.${coach.slice(1)}.${issued}.${signature}`, `c1.${coach}.0.${signature}`,
    `c1.${coach}.${issued}.${signature}.x`, `c1.${coach}.${issued}.${signature.slice(1)}`, `c1.${coach}=.${issued}.${signature}`,
    // A parent's fields under the coach's version, and the reverse.
    `c1.2.${issued}.${signature}`, `v1.${coach}.${issued}.${signature}`,
    // Values only the pattern stops: atob throws on a 41-character
    // signature and on one carrying a character outside base64url, so a
    // looser pattern would turn these into a 500 (#192's review).
    // (The tag is never decoded, so its bound guards nothing from atob; a
    // tag the pattern let through would still fail the signature.)
    `c1.${coach}.${issued}.${signature.slice(2)}`, `c1.${coach}.${issued}.!${signature.slice(1)}`,
  ]) {
    assert.equal(await readSession(withValue(value), KEY), null, value);
  }
  // The control: atob does throw on those signatures, so the pattern is
  // what keeps them from reaching it.
  assert.throws(() => atob(signature.slice(2)));
  assert.throws(() => atob(`!${signature.slice(1)}`));
});

test('a malformed coach\'s cookie at the upload guard is a 401, never a throw', async () => {
  const { env } = await site();
  const good = await signCoachSession(KEY, await coachTag(KEY, COACH), nowSeconds());
  const [, coach, issued, signature] = good.split('.');
  for (const value of [`c1.${coach}.${issued}.${signature.slice(2)}`, `c1.${coach}.${issued}.!${signature.slice(1)}`]) {
    const res = await sessionCheck(env, value);
    assert.equal(res.status, 401, value);
  }
  // The control: the well-formed cookie passes the same guard.
  assert.equal((await sessionCheck(env, good)).status, 204);
});

test('the coach\'s session values are the documented ones', () => {
  // Literal, so a change is a decision someone sees in review: a coach's
  // session lasts as a parent's does (CLAUDE.md, The photo site, item 20).
  assert.equal(SESSION_SECONDS, 7_776_000);
  assert.equal(COACH_AUD.length, 64);
  assert.notEqual(COACH_AUD, AUD);
});
