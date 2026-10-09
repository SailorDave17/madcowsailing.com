// POST /api/join since #226: the one answer an old invite link gets. Until
// #226 it traded the invite code for an upload session (#150); accounts
// replaced the link (epic #216), so it opens nothing now, reads no body, and
// needs no database, secret or binding. test/guard.test.js lists it public,
// so this file is what holds its answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as route from '../functions/api/join.js';
import { onRequest as rootMiddleware } from '../functions/_middleware.js';
import { UPLOAD_COOKIE, coachCookie, parentCookie } from './legacy-cookies.js';

const { onRequestPost } = route;

const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const CODE = 'K7QM-3XRD-9FWB'; // a code as an invite link carried one
const REPLACED = { error: 'replaced', ask: '/ask' };
// The upload cookie's deletion, as the upload guard sends it (lib/session.js).
const DELETE_OLD = '__Host-upload=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';

// An env that throws on any read. The route needs nothing from it, so every
// call here passes this one: a route that reached for the database, a secret
// or a binding would fail the test that called it.
const UNTOUCHABLE = new Proxy({}, {
  get(_, key) { throw new Error(`the route read env.${String(key)}`); },
  has(_, key) { throw new Error(`the route asked for env.${String(key)}`); },
});

function joinRequest({ origin = SITE, cookie, body = JSON.stringify({ code: CODE }) } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' };
  if (origin !== null) headers.Origin = origin;
  if (cookie !== undefined) headers.Cookie = cookie;
  return new Request(`${SITE}/api/join`, { method: 'POST', headers, body });
}

const join = (options) => onRequestPost({ request: joinRequest(options), env: UNTOUCHABLE, data: {}, params: {} });

async function replaced(res, label) {
  assert.equal(res.status, 410, label);
  assert.deepEqual(await res.json(), REPLACED, label);
  assert.equal(res.headers.get('Cache-Control'), 'no-store', label);
  assert.match(res.headers.get('Content-Type'), /^application\/json/, label);
}

const now = Math.floor(Date.now() / 1000);
const parentLive = await parentCookie(KEY, 2, now);
const coachLive = await coachCookie(KEY, 'coach@example.com', now);

test('the route answers POST alone, and keeps nothing else (#226)', () => {
  // The failure limit, its window and the code comparison went with the
  // invite link; Pages answers any other method 405 with no handler.
  assert.deepEqual(Object.keys(route), ['onRequestPost']);
});

test('a POST from the site itself: 410, the link was replaced, pointing to /ask, and no cookie set', async () => {
  const res = await join();
  await replaced(res);
  assert.deepEqual(res.headers.getSetCookie(), []);
});

test('whatever an old link sends, the answer is the same, and opens nothing', async () => {
  for (const body of [
    JSON.stringify({ code: CODE }), JSON.stringify({ code: 'Q2WE-R4TY-V6PA' }), JSON.stringify({ code: 'ZZZZ-ZZZZ-ZZZZ' }),
    JSON.stringify({ code: 'k7qm 3xrd 9fwb' }), '{"code": 12}', '{}', '[]', 'null', 'not json', CODE, '',
    `{"code": "${'x'.repeat(5_000_000)}"}`,
  ]) {
    const res = await join({ body });
    await replaced(res, body.slice(0, 30));
    assert.deepEqual(res.headers.getSetCookie(), [], body.slice(0, 30));
  }
});

test('the body is never read', async () => {
  // A body that fails the moment anything reads it, and is not pulled before.
  let pulled = 0;
  const body = new ReadableStream({ pull(controller) { pulled++; controller.error(new Error('the route read the body')); } }, { highWaterMark: 0 });
  const request = new Request(`${SITE}/api/join`, { method: 'POST', headers: { Origin: SITE }, body, duplex: 'half' });
  await replaced(await onRequestPost({ request, env: UNTOUCHABLE }));
  assert.equal(pulled, 0);
  assert.equal(request.bodyUsed, false);
});

test('no database, secret or binding is needed: no env at all is the same answer, never a 503', async () => {
  await replaced(await onRequestPost({ request: joinRequest() }));
  await replaced(await onRequestPost({ request: joinRequest(), env: {} }));
});

test('a request carrying the old upload cookie: the same 410, and the answer deletes the cookie', async () => {
  for (const [name, value] of [
    ['a parent\'s live cookie', parentLive],
    ['a coach\'s live cookie', coachLive],
    ['a malformed one', 'v1'],
    ['an empty one', ''],
  ]) {
    for (const cookie of [`${UPLOAD_COOKIE}=${value}`, `a=1; ${UPLOAD_COOKIE}=${value}; __Host-account=a1.x`]) {
      const res = await join({ cookie });
      await replaced(res, `${name}: ${cookie.slice(0, 30)}`);
      assert.deepEqual(res.headers.getSetCookie(), [DELETE_OLD], name);
    }
  }
});

test('a request carrying no old upload cookie is sent no deletion', async () => {
  for (const cookie of ['__Host-account=a1.x', `x${UPLOAD_COOKIE}=v1`, 'a=1; b=2']) {
    const res = await join({ cookie });
    await replaced(res, cookie);
    assert.deepEqual(res.headers.getSetCookie(), [], cookie);
  }
});

for (const [name, origin] of [
  ['no Origin', null],
  ['another site\'s Origin', 'https://evil.example'],
  ['a look-alike Origin', 'https://photos.madcowsailing.com.evil.example'],
  ['the sibling site\'s Origin', 'https://madcowsailing.com'],
]) {
  test(`${name}: 403, as before #226, and nothing set`, async () => {
    for (const cookie of [undefined, `${UPLOAD_COOKIE}=${parentLive}`]) {
      const res = await join({ origin, cookie });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: 'origin' });
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
  });
}

test('nothing is logged, through the site\'s own middleware as on Pages', async (t) => {
  // Every console method, captured, through every answer the route gives.
  // The root middleware is where an error escaping the route would be logged.
  const logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    t.mock.method(console, method, (...args) => logged.push(args.map(String).join(' ')));
  }
  const viaSite = async (options) => {
    const request = joinRequest(options);
    return rootMiddleware({ request, next: () => onRequestPost({ request, env: UNTOUCHABLE }) });
  };
  const answers = [
    await viaSite(),
    await viaSite({ body: CODE }),
    await viaSite({ cookie: `${UPLOAD_COOKIE}=${parentLive}` }),
    await viaSite({ origin: 'https://evil.example' }),
  ];
  assert.deepEqual(answers.map((res) => res.status), [410, 410, 410, 403]);
  assert.deepEqual(answers[2].headers.getSetCookie(), [DELETE_OLD]);
  assert.deepEqual(logged, []);
});
