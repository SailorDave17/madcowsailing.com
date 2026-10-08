// POST /api/join (#150, criteria 2, 3, 4, 7 and 8), against a real SQLite
// holding the real migrations (test/d1.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FAILURE_LIMIT, FAILURE_WINDOW_SECONDS, onRequestPost } from '../functions/api/join.js';
import { onRequest as rootMiddleware } from '../functions/_middleware.js';
import { addressBlock } from '../lib/address.js';
import { base64url, hmac, timing } from '../lib/crypto.js';
import { COOKIE_NAME, SESSION_SECONDS, nowSeconds, readSession } from '../lib/session.js';
import { d1, seedCodes } from './d1.js';

const SITE = 'https://photos.madcowsailing.com';
const OLD = 'Q2WE-R4TY-V6PA'; // an earlier generation's code
const CURRENT = 'K7QM-3XRD-9FWB';
const KEYS = {
  SESSION_SIGNING_KEY: 'test-session-signing-key-0123456789abcdef',
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
};

function site({ codes = [OLD, CURRENT] } = {}) {
  const DB = d1();
  seedCodes(DB, ...codes);
  return { DB, ...KEYS };
}

function joinRequest({ code = CURRENT, origin = SITE, ip = '203.0.113.7', body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin !== null) headers.Origin = origin;
  return new Request(`${SITE}/api/join`, {
    method: 'POST', headers, body: body ?? JSON.stringify({ code }),
  });
}

const join = (env, options) => onRequestPost({ request: joinRequest(options), env });
const failureRows = (env) => env.DB.sqlite.prepare('SELECT address_hash, failed_at FROM join_failures').all();

async function fail(env, times, options = {}) {
  for (let i = 0; i < times; i++) {
    const res = await join(env, { code: 'ZZZZ-ZZZZ-ZZZZ', ...options });
    assert.equal(res.status, 403);
  }
}

test('the current code, from the site itself: 204 and exactly one cookie, the session', async () => {
  const env = site();
  const res = await join(env);
  assert.equal(res.status, 204);
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  const [pair, ...attributes] = cookies[0].split('; ');
  assert.ok(pair.startsWith(`${COOKIE_NAME}=`));
  assert.deepEqual(attributes.sort(), ['HttpOnly', `Max-Age=${SESSION_SECONDS}`, 'Path=/', 'SameSite=Lax', 'Secure']);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');

  // Signed with the Cloudflare-held key, naming the current code's generation.
  const back = new Request(`${SITE}/`, { headers: { Cookie: pair } });
  const session = await readSession(back, KEYS.SESSION_SIGNING_KEY);
  assert.equal(session.generation, 2);
  assert.ok(Math.abs(session.issued - nowSeconds()) <= 2);
  assert.equal(await readSession(back, 'some-other-key-entirely-0123456789'), null);
});

test('the code is accepted however it was copied: case, dashes and look-alikes', async () => {
  const env = site({ codes: ['01AB-CDEF-GHJK'] });
  for (const code of ['01ab-cdef-ghjk', '01ABCDEFGHJK', 'OIAB CDEF GHJK', 'olab-cdef-ghjk']) {
    assert.equal((await join(env, { code })).status, 204, code);
  }
});

for (const [name, options, error] of [
  ['a wrong code', { code: 'ZZZZ-ZZZZ-ZZZZ' }, 'wrong'],
  ['something that cannot be a code', { code: 'hello' }, 'wrong'],
  ['a foreign Origin, carrying the right code', { origin: 'https://evil.example' }, 'origin'],
  ['a look-alike Origin, carrying the right code', { origin: 'https://photos.madcowsailing.com.evil.example' }, 'origin'],
  ['no Origin, carrying the right code', { origin: null }, 'origin'],
]) {
  test(`${name}: 403 and no cookie`, async () => {
    const res = await join(site(), options);
    assert.equal(res.status, 403);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(await res.json(), { error });
  });
}

test('an earlier code: 403, no cookie, and a reason the page can tell from a wrong code', async () => {
  const env = site();
  const res = await join(env, { code: OLD });
  assert.equal(res.status, 403);
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.deepEqual(await res.json(), { error: 'rotated' });
  assert.equal(failureRows(env).length, 1, 'an earlier code is a failed attempt');
});

test('with no code in the database, nothing opens a session', async () => {
  const res = await join(site({ codes: [] }), { code: CURRENT });
  assert.equal(res.status, 403);
  assert.deepEqual(res.headers.getSetCookie(), []);
});

test('the comparison is constant-time: every stored code is compared, as equal-length digests', async (t) => {
  const env = site({ codes: [OLD, 'AAAA-BBBB-CCCC', CURRENT] });
  const seen = t.mock.method(timing, 'equal');
  for (const code of [CURRENT, OLD, 'ZZZZ-ZZZZ-ZZZZ', 'x']) {
    seen.mock.resetCalls();
    await join(env, { code });
    assert.equal(seen.mock.callCount(), 3, `${code}: compared with every row, whichever matched`);
    for (const { arguments: [a, b] } of seen.mock.calls) {
      assert.equal(a.length, 32);
      assert.equal(b.length, 32);
    }
  }
});

test('timing.equal reads every byte of both, even after the first difference', () => {
  const reads = [];
  const watched = (name, bytes) => new Proxy(bytes, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(`${name}${key}`);
      return target[key];
    },
  });
  const a = watched('a', new Uint8Array(32).fill(1));
  const b = watched('b', new Uint8Array(32).fill(2));
  assert.equal(timing.equal(a, b), false);
  assert.equal(reads.length, 64);
  assert.equal(timing.equal(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(timing.equal(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
});

test(`${FAILURE_LIMIT} failures from one address in an hour: the next is 429, even with the right code`, async () => {
  assert.equal(FAILURE_LIMIT, 10);
  const env = site();
  await fail(env, FAILURE_LIMIT);
  const res = await join(env, { code: CURRENT });
  assert.equal(res.status, 429);
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.deepEqual(await res.json(), { error: 'too-many' });
  const retryAfter = Number(res.headers.get('Retry-After'));
  assert.ok(retryAfter > 0 && retryAfter <= FAILURE_WINDOW_SECONDS, `Retry-After ${retryAfter}`);
  assert.equal(failureRows(env).length, FAILURE_LIMIT, 'a refused 429 records nothing more');
});

test('nine failures leave the tenth attempt its answer', async () => {
  const env = site();
  await fail(env, FAILURE_LIMIT - 1);
  assert.equal((await join(env, { code: CURRENT })).status, 204);
});

test('a success does not count, and does not clear earlier failures', async () => {
  const env = site();
  await fail(env, 5);
  for (let i = 0; i < 20; i++) assert.equal((await join(env)).status, 204);
  await fail(env, 5);
  assert.equal((await join(env)).status, 429);
});

test("another address's failures do not count against this one", async () => {
  const env = site();
  await fail(env, FAILURE_LIMIT, { ip: '198.51.100.1' });
  assert.equal((await join(env, { ip: '198.51.100.2' })).status, 204);
});

test('an IPv6 address counts by its /64, so stepping through the block gains nothing', async () => {
  const env = site();
  for (let i = 1; i <= FAILURE_LIMIT; i++) {
    await fail(env, 1, { ip: `2001:db8:1:2::${i.toString(16)}` });
  }
  assert.equal((await join(env, { ip: '2001:db8:1:2:ffff:ffff:ffff:ffff' })).status, 429);
  assert.equal((await join(env, { ip: '2001:db8:1:3::1' })).status, 204);
  assert.equal(addressBlock('2001:DB8::1'), '2001:0db8:0000:0000');
  assert.equal(addressBlock('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(addressBlock('192.0.2.1'), '192.0.2.1');
  assert.equal(addressBlock(null), 'unknown');
});

test('the window expires: failures older than an hour neither count nor stay', async () => {
  const env = site();
  await fail(env, FAILURE_LIMIT);
  env.DB.sqlite.prepare('UPDATE join_failures SET failed_at = failed_at - ?').run(FAILURE_WINDOW_SECONDS);
  assert.equal((await join(env)).status, 204);
  assert.equal(failureRows(env).length, 0, 'expired rows are deleted by the next join');
});

test('the address is stored only as a keyed hash', async () => {
  const env = site();
  await fail(env, 1, { ip: '203.0.113.7' });
  const [{ address_hash: stored }] = failureRows(env);
  assert.ok(!stored.includes('203'), stored);
  assert.equal(stored, base64url(await hmac(KEYS.ADDRESS_HASH_KEY, '203.0.113.7')));
  assert.notEqual(stored, base64url(await hmac('another-key-entirely-0123456789', '203.0.113.7')));
});

test('a body that is not {"code": "<string>"}: 400, not counted, no cookie', async () => {
  const env = site();
  for (const body of ['not json', '{"code": 12}', '[]', 'null', '{}', 'x'.repeat(2000)]) {
    const res = await join(env, { body });
    assert.equal(res.status, 400, body.slice(0, 20));
    assert.deepEqual(res.headers.getSetCookie(), []);
  }
  assert.equal(failureRows(env).length, 0);
});

test('a missing database or secret closes joining (503) rather than opening it', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const missing of ['DB', 'SESSION_SIGNING_KEY', 'ADDRESS_HASH_KEY']) {
    const env = site();
    delete env[missing];
    const res = await join(env);
    assert.equal(res.status, 503, missing);
    assert.deepEqual(res.headers.getSetCookie(), []);
  }
});

test('nothing logged anywhere carries the code, the cookie or either key', async (t) => {
  // Every console method, captured, through every answer the route gives.
  // Each call goes through the root middleware, as on Pages, because that is
  // where an error escaping the route gets logged.
  const logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    t.mock.method(console, method, (...args) => logged.push(args.map(String).join(' ')));
  }
  const viaSite = (env, options) => {
    const request = joinRequest(options);
    return rootMiddleware({ request, next: () => onRequestPost({ request, env }) });
  };

  const env = site();
  const ok = await viaSite(env);
  assert.equal(ok.status, 204);
  const cookie = ok.headers.getSetCookie()[0].split('; ')[0].split('=')[1];
  await viaSite(env, { code: OLD });
  await viaSite(env, { code: 'ZZZZ-ZZZZ-ZZZZ' });
  await viaSite(env, { origin: 'https://evil.example' });
  // Bodies that are not JSON and hold the code. V8's JSON.parse error quotes
  // both of these whole ("Unexpected token 'K', "K7QM-…" is not valid JSON"),
  // so if the route let that error out, the middleware would log the code.
  // An unterminated {"code":"…" would not do: its error gives a position only.
  assert.equal((await viaSite(env, { body: CURRENT })).status, 400);
  assert.equal((await viaSite(env, { body: `code=${CURRENT}` })).status, 400);
  // Up to the limit and past it: two failures above already count.
  for (let i = 0; i < FAILURE_LIMIT; i++) await viaSite(env, { code: 'ZZZZ-ZZZZ-ZZZZ' });
  assert.equal((await viaSite(env)).status, 429);
  await viaSite({ ...env, SESSION_SIGNING_KEY: undefined });
  const broken = { ...env, DB: { prepare() { throw new Error('D1_ERROR: no such table'); } } };
  assert.equal((await viaSite(broken)).status, 500);

  assert.ok(logged.length > 0, 'the battery logged something, so the scan below read real output');
  const secrets = [CURRENT, CURRENT.replaceAll('-', ''), OLD, cookie, cookie.split('.').pop(),
    KEYS.SESSION_SIGNING_KEY, KEYS.ADDRESS_HASH_KEY, '203.0.113.7'];
  for (const line of logged) {
    for (const secret of secrets) assert.ok(!line.includes(secret), `a log line carries ${secret}: ${line}`);
  }
});
