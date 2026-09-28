// The upload session cookie and the guard (#150, criteria 2 and 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COOKIE_NAME, SESSION_SECONDS, cookieValue, nowSeconds, readSession,
  requireUploadSession, sessionCookie, signSession,
} from '../lib/session.js';
import { d1, seedCodes } from './d1.js';

const KEY = 'test-session-signing-key-0123456789abcdef';
const OTHER_KEY = 'another-session-signing-key-fedcba9876543210';

const withCookie = (value) =>
  new Request('https://photos.madcowsailing.com/api/upload/session', {
    headers: value === undefined ? {} : { Cookie: `${COOKIE_NAME}=${value}` },
  });

// A value's three signed fields and its signature, for editing one of them.
const parts = (value) => {
  const [version, generation, issued, signature] = value.split('.');
  return { version, generation, issued, signature };
};

test('the cookie is HttpOnly, Secure, SameSite=Lax, Path=/ and lasts 90 days', async () => {
  const header = await sessionCookie(KEY, 1);
  const [pair, ...attributes] = header.split('; ');
  assert.ok(pair.startsWith(`${COOKIE_NAME}=`));
  assert.deepEqual(attributes.sort(), ['HttpOnly', `Max-Age=${SESSION_SECONDS}`, 'Path=/', 'SameSite=Lax', 'Secure']);
  assert.equal(SESSION_SECONDS, 90 * 24 * 60 * 60);
  // The __Host- prefix: the browser drops the cookie unless it is Secure,
  // Path=/ and has no Domain, so no other host can plant or read it.
  assert.ok(COOKIE_NAME.startsWith('__Host-'));
  assert.ok(!/Domain=/i.test(header));
});

test('the cookie names the generation it was opened with, and reads back', async () => {
  const issued = nowSeconds();
  const value = await signSession(KEY, 7, issued);
  assert.equal(parts(value).generation, '7');
  assert.deepEqual(await readSession(withCookie(value), KEY), { generation: 7, issued });
});

test('a cookie with its signature altered is refused', async () => {
  const value = await signSession(KEY, 1, nowSeconds());
  const { signature } = parts(value);
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  assert.equal(await readSession(withCookie(value.replace(signature, flipped)), KEY), null);
});

test('a cookie whose generation was edited, signature kept, is refused', async () => {
  // The attack the signature exists for: carry an old session onto the
  // current code by editing its generation.
  const { version, issued, signature } = parts(await signSession(KEY, 1, nowSeconds()));
  assert.equal(await readSession(withCookie(`${version}.2.${issued}.${signature}`), KEY), null);
});

test('a cookie whose issue time was moved later, signature kept, is refused', async () => {
  // The other edit worth making: extend a session past its age.
  const now = nowSeconds();
  const { version, generation, signature } = parts(await signSession(KEY, 1, now - 1000));
  assert.equal(await readSession(withCookie(`${version}.${generation}.${now}.${signature}`), KEY), null);
});

test('a cookie signed with another key is refused', async () => {
  const value = await signSession(OTHER_KEY, 1, nowSeconds());
  assert.equal(await readSession(withCookie(value), KEY), null);
});

test('a cookie is refused at 90 days old, and accepted a second before', async () => {
  const now = nowSeconds();
  const old = await signSession(KEY, 1, now - SESSION_SECONDS);
  const young = await signSession(KEY, 1, now - SESSION_SECONDS + 1);
  assert.equal(await readSession(withCookie(old), KEY, now), null);
  assert.deepEqual(await readSession(withCookie(young), KEY, now), { generation: 1, issued: now - SESSION_SECONDS + 1 });
});

test('a cookie issued in the future is refused, past a minute of clock skew', async () => {
  const now = nowSeconds();
  assert.ok(await readSession(withCookie(await signSession(KEY, 1, now + 60)), KEY, now));
  assert.equal(await readSession(withCookie(await signSession(KEY, 1, now + 61)), KEY, now), null);
});

test('no cookie, a malformed one, or no key: no session, and nothing throws', async () => {
  const good = await signSession(KEY, 1, nowSeconds());
  const { generation, issued, signature } = parts(good);
  for (const value of [
    undefined, '', 'v1', `v2.${generation}.${issued}.${signature}`, `v1.0.${issued}.${signature}`,
    `v1.${generation}.${issued}.${signature}.x`, `v1.x.${issued}.${signature}`, `v1.${generation}.${issued}.${signature}=`,
    `v1.${generation}.${issued}.${signature.slice(1)}`,
  ]) {
    assert.equal(await readSession(withCookie(value), KEY), null, String(value));
  }
  assert.equal(await readSession(withCookie(good), undefined), null);
  assert.equal(await readSession(withCookie(good), ''), null);
});

test('the session cookie is found among others, by exact name', () => {
  assert.equal(cookieValue(`a=1; ${COOKIE_NAME}=v; b=2`), 'v');
  assert.equal(cookieValue(`x${COOKIE_NAME}=v; b=2`), null);
  assert.equal(cookieValue(null), null);
});

// The guard, called directly. test/guard.test.js holds every route to it.

async function guard(request, db) {
  const env = { DB: db, SESSION_SIGNING_KEY: KEY };
  const context = { request, env, data: {}, next: async () => new Response('route ran', { status: 200 }) };
  return { response: await requireUploadSession(context), context };
}

test('the guard passes the current generation through, with the session on context.data', async () => {
  const db = d1();
  seedCodes(db, 'AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB');
  const issued = nowSeconds();
  const { response, context } = await guard(withCookie(await signSession(KEY, 2, issued)), db);
  assert.equal(response.status, 200);
  assert.deepEqual(context.data.session, { generation: 2, issued });
});

test('the guard answers 401 for an earlier generation, a tampered cookie, or none', async () => {
  const db = d1();
  seedCodes(db, 'AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB');
  const current = await signSession(KEY, 2, nowSeconds());
  // Alter the signature's FIRST character: the last one of a 32-byte
  // signature carries two padding bits, so A and B there can decode alike.
  const { signature } = parts(current);
  const tampered = current.replace(signature, (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1));
  for (const value of [await signSession(KEY, 1, nowSeconds()), tampered, undefined]) {
    const { response } = await guard(withCookie(value), db);
    assert.equal(response.status, 401, String(value));
    assert.deepEqual(await response.json(), { error: 'not-joined' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('with no code in the database, uploads stay closed: 401', async () => {
  const { response } = await guard(withCookie(await signSession(KEY, 1, nowSeconds())), d1());
  assert.equal(response.status, 401);
});

test('a database that does not answer fails closed: 503, and the route never runs', async (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = { prepare() { throw new Error('D1_ERROR: daily limit'); } };
  const { response } = await guard(withCookie(await signSession(KEY, 1, nowSeconds())), broken);
  assert.equal(response.status, 503);
  assert.notEqual(await response.text(), 'route ran');
});
