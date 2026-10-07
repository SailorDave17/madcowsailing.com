// An admin's sign-in (#224, criteria 1 and 2): the code emailed once an
// admin's password passes (lib/admin-code.js), /sign-in's admin branch and
// /sign-in/code (functions/sign-in.js, functions/sign-in/code.js), and the
// 12-hour admin session and its guard (lib/admin-session.js). Run through
// the root middleware as Pages runs them, against a real SQLite holding the
// real migrations (test/d1.js). Every admin route's refusals are
// test/guard.test.js's; the owner, the admins and the log are
// test/admins.test.js's; /policy's rows are test/policy.test.js's.
//
// fetch is stood in for: Resend's URL answers `resend`, and any other URL
// throws, so each code's email is read back from `sends`.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import * as signInRoute from '../functions/sign-in.js';
import * as codeRoute from '../functions/sign-in/code.js';
import * as signOutRoute from '../functions/sign-out.js';
import * as adminDir from '../functions/admin/_middleware.js';
import * as adminHome from '../functions/admin/index.js';
import * as accountDir from '../functions/account/_middleware.js';
import * as accountRoute from '../functions/account/index.js';
import { requestAccount } from '../lib/accounts.js';
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_SECONDS, signAccountSession } from '../lib/account-session.js';
import {
  CODES_PER_DAY, CODE_COOKIE, CODE_SECONDS, CODE_TRIES, checkCode, codeEmail, codeHashing, newCode, readCode, startCode, useCode,
} from '../lib/admin-code.js';
import {
  ADMIN_COOKIE, ADMIN_SESSION_HOURS, ADMIN_SESSION_SECONDS, ADMIN_SIGN_IN, readAdminSession, signAdminSession,
} from '../lib/admin-session.js';
import { PRODUCTION_SITE } from '../lib/invite.js';
import { RESEND_URL } from '../lib/mail.js';
import { makeLink, tokenHash } from '../lib/password-link.js';
import { nowSeconds } from '../lib/session.js';
import { emailHash, hashing, setPassword, signOut } from '../lib/sign-in.js';
import { demoteAdmin } from '../lib/people.js';
import { accountPage } from '../lib/sign-in-page.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEYS = {
  SESSION_SIGNING_KEY: 'test-session-signing-key-0123456789abcdef',
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
};
const PASSWORD = 'four unrelated words in a row';
// Not a real scrypt hash: hashing.verify is stood in for in every test that
// signs in (fastCheck), as test/sign-in.test.js does when it counts, since
// #222's own tests hold the real hash and this file's subject comes after it.
const STORED = 'stand-in-for-a-real-scrypt-hash';

let resend; // (body) => the Response Resend answers
let sends; // every message that reached Resend

beforeEach(() => {
  sends = [];
  resend = () => Response.json({ id: 'msg-224' });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url !== RESEND_URL) throw new Error(`fetched ${url}`);
    const body = JSON.parse(init.body);
    sends.push(body);
    return resend(body);
  });
});
afterEach(() => mock.restoreAll());

const fastCheck = (t) => t.mock.method(hashing, 'verify', async (typed, stored) => typed === PASSWORD && stored === STORED);

const site = (extra = {}) => ({ DB: d1(), SITE_ENV: 'preview', RESEND_API_KEY: 'test-key-not-real', ...KEYS, ...extra });

const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map((row) => ({ ...row }));
const one = (db, sql, ...args) => ({ ...db.sqlite.prepare(sql).get(...args) });

/**
 * An account, made by #220's own request, approved for its team with a
 * password, holding `adminRole` ('owner', 'admin' or null). Answers its id.
 */
let asked = 0;
async function account(db, { email = 'jane@example.org', name = 'Jane Rivers', adminRole = 'owner', approved = true } = {}) {
  asked += 1;
  await requestAccount(db, { request: { name, email, role: 'coach', teams: ['hoover-jrt'], note: null }, address: `address-${asked}`, now: nowSeconds() });
  const { id } = db.sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (approved) db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = ?").run(id);
  db.sqlite.prepare('UPDATE accounts SET password_hash = ?, admin_role = ? WHERE id = ?').run(STORED, adminRole, id);
  return id;
}

const HANDLERS = {
  '/sign-in': signInRoute,
  '/sign-in/code': codeRoute,
  '/sign-out': signOutRoute,
  '/admin': { chain: [...adminDir.onRequest], ...adminHome },
  '/account': { chain: [...accountDir.onRequest], ...accountRoute },
};

/**
 * One request through the root middleware and its directory's guards, to
 * `host` (the custom domain unless a test names another), with its Origin
 * unless `origin` says otherwise. `cookies` maps a name to a value.
 */
async function call(env, path, { method = 'GET', fields, host = SITE, origin = host, cookies = {}, query = '' } = {}) {
  const headers = { 'CF-Connecting-IP': '203.0.113.7' };
  let body;
  if (method === 'POST') {
    if (origin) headers.Origin = origin;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(fields ?? {}).toString();
  }
  const jar = Object.entries(cookies).filter(([, value]) => value !== undefined);
  if (jar.length) headers.Cookie = jar.map(([name, value]) => `${name}=${value}`).join('; ');
  const request = new Request(`${host}${path}${query}`, { method, headers, body });
  const route = HANDLERS[path];
  const handler = route[{ GET: 'onRequestGet', HEAD: 'onRequestHead', POST: 'onRequestPost' }[method]];
  const stack = [...(route.chain ?? []), handler];
  const data = {};
  const context = (i) => ({ request, env, params: {}, data, waitUntil() {}, next: () => stack[i + 1](context(i + 1)) });
  const response = await root({ ...context(-1), next: () => stack[0](context(0)) });
  return { response, html: method === 'HEAD' || !response.body ? '' : await response.clone().text() };
}

/** The value a Set-Cookie line gives `name`, or undefined. */
const setValue = (response, name) =>
  response.headers.getSetCookie().map((line) => line.split(';')[0]).find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1);

const codeIn = (message) => message.text.match(/^([0-9]{6})$/m)?.[1];

/** An admin's password step through /sign-in: the code cookie's token and the emailed code. */
async function passwordStep(env, email = 'jane@example.org', options = {}) {
  const { response } = await call(env, '/sign-in', { method: 'POST', fields: { email, password: PASSWORD }, ...options });
  assert.equal(response.status, 303, 'the password step did not pass');
  return { token: setValue(response, CODE_COOKIE), code: codeIn(sends.at(-1)), response };
}

const postCode = (env, token, code, options = {}) =>
  call(env, '/sign-in/code', { method: 'POST', fields: { code }, cookies: { [CODE_COOKIE]: token }, ...options });

// Another six digits than `code`.
const otherThan = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

/** A D1 stand-in that waits a macrotask before every statement and batch, so calls in flight interleave (cairn: a-race-test-through-the-request-chain-never-interleaves). */
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

/** A D1 stand-in whose statements matching `pattern` throw, alone or in a batch. */
function failOn(db, pattern) {
  const fail = async () => { throw new Error('D1 down'); };
  const wrap = (statement, sql) => (pattern.test(sql)
    ? { sql, values: statement.values, bind: (...v) => wrap(statement.bind(...v), sql), first: fail, all: fail, run: fail }
    : statement);
  return { ...db, prepare: (sql) => wrap(db.prepare(sql), sql), batch: async (list) => (list.some((s) => pattern.test(s.sql)) ? fail() : db.batch(list)) };
}

// ---- Criterion 1: the password, then a code emailed for that sign-in ---------

test('an account that is no admin signs in as before: its password alone, no code, no email, only the account\'s cookie', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB, { adminRole: null });
  const { response } = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane@example.org', password: PASSWORD } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/account');
  // The account's cookie, and any admin cookie the browser held deleted.
  assert.deepEqual(response.headers.getSetCookie().map((line) => line.split('=')[0]), [ACCOUNT_COOKIE, ADMIN_COOKIE]);
  assert.equal(setValue(response, ADMIN_COOKIE), '');
  assert.equal(sends.length, 0);
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes').n, 0);
});

test('an admin\'s right password opens no session: it emails a code to the account\'s own address and asks for it (criterion 1)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB, { email: 'Jane.Rivers@Example.org' });
  const { response } = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane.rivers@example.org', password: PASSWORD } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/sign-in/code');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  // The one cookie set ties the code to this browser's sign-in; the other
  // line deletes an admin cookie the browser may hold, whoever's it is.
  const set = response.headers.getSetCookie();
  assert.equal(set.length, 2);
  assert.match(set[0], new RegExp(`^${CODE_COOKIE}=[A-Za-z0-9_-]{43}; Max-Age=${CODE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax$`));
  assert.equal(set[1], `${ADMIN_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
  // One email, to the address as the account holds it, not as typed.
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].to, ['Jane.Rivers@Example.org']);
  assert.match(codeIn(sends[0]) ?? '', /^[0-9]{6}$/);
  // The wrong password, the control: refused as every failure is, and no code.
  const wrong = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane.rivers@example.org', password: 'not the password, long enough' } });
  assert.equal(wrong.response.status, 403);
  assert.equal(sends.length, 1);
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes').n, 1);
});

test('the right code opens the account\'s 90-day session and a 12-hour admin session, and the admin pages (criteria 1 and 2)', async (t) => {
  fastCheck(t);
  const env = site();
  const id = await account(env.DB);
  const { token, code } = await passwordStep(env);
  const page = await call(env, '/sign-in/code', { cookies: { [CODE_COOKIE]: token } });
  assert.equal(page.response.status, 200);
  assert.match(page.html, /<input id="sign-in-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"/);
  const { response } = await postCode(env, token, code);
  assert.equal(response.status, 303);
  // /account, which links the admin pages: until #226, a form's redirect
  // into Access in front of /admin is stopped by form-action 'self' in
  // Chromium and WebKit, and a link is not (#224's review).
  assert.equal(response.headers.get('Location'), '/account');
  const landing = await call(env, '/account', { cookies: { [ACCOUNT_COOKIE]: setValue(response, ACCOUNT_COOKIE) } });
  assert.equal(landing.response.status, 200);
  assert.match(landing.html, /<h1>You are signed in<\/h1>/);
  assert.match(landing.html, /<a class="button" href="\/admin\/">Open the admin pages<\/a>/);
  const set = response.headers.getSetCookie();
  assert.equal(set.length, 3);
  assert.match(set[0], new RegExp(`^${ACCOUNT_COOKIE}=a1\\.${id}\\.1\\.\\d+\\.[A-Za-z0-9_-]{43}; Max-Age=${ACCOUNT_SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax$`));
  assert.match(set[1], new RegExp(`^${ADMIN_COOKIE}=m1\\.${id}\\.1\\.\\d+\\.[A-Za-z0-9_-]{43}; Max-Age=${ADMIN_SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax$`));
  assert.equal(set[2], `${CODE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
  // The admin cookie opens the admin home, which names who is signed in.
  const admin = await call(env, '/admin', { cookies: { [ADMIN_COOKIE]: setValue(response, ADMIN_COOKIE) } });
  assert.equal(admin.response.status, 200);
  assert.match(admin.html, /Signed in as Jane Rivers, jane@example\.org, the owner\./);
  // The control: with no cookie the same page is the sign-in's.
  const none = await call(env, '/admin');
  assert.equal(none.response.status, 303);
  assert.equal(none.response.headers.get('Location'), ADMIN_SIGN_IN);
});

test('the code is kept only as an HMAC keyed with SESSION_SIGNING_KEY, and the sign-in only as its token\'s SHA-256 (criterion 1)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  const row = one(env.DB, 'SELECT * FROM admin_codes');
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('base64url'));
  assert.equal(row.token_hash, await tokenHash(token));
  // The HMAC of the code with its sign-in's hash, under the key...
  const message = `admin-code.${row.token_hash}.${code}`;
  assert.equal(row.code_hash, createHmac('sha256', KEYS.SESSION_SIGNING_KEY).update(message).digest('base64url'));
  // ...and so neither the plain hash a copy of the table could search a
  // million codes against, nor the HMAC under any other key.
  assert.notEqual(row.code_hash, createHash('sha256').update(message).digest('base64url'));
  assert.notEqual(row.code_hash, createHash('sha256').update(code).digest('base64url'));
  assert.notEqual(row.code_hash, createHmac('sha256', 'another key').update(message).digest('base64url'));
  // Nothing in the row is the code or the token.
  for (const value of Object.values(row)) {
    assert.ok(!String(value).includes(code), 'the row holds the code');
    assert.ok(!String(value).includes(token), 'the row holds the token');
  }
  assert.deepEqual(Object.keys(row).sort(), ['account_id', 'code_hash', 'expires_at', 'made_at', 'token_hash', 'tries', 'version']);
});

test('a code works once: used, it is cleared, and posting it again finds nothing (criterion 1)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  assert.equal((await postCode(env, token, code)).response.status, 303);
  assert.equal(one(env.DB, 'SELECT code_hash FROM admin_codes').code_hash, null);
  const again = await postCode(env, token, code);
  assert.equal(again.response.status, 403);
  assert.match(again.html, /<h1>Sign in again<\/h1>/);
  assert.equal(setValue(again.response, ADMIN_COOKIE), undefined);
});

test('the right code posted twice at once signs in once: the second finds it used (criterion 1)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  // Through the route, where the code is spent after the reads, with every
  // statement a macrotask late so the two posts interleave.
  const both = await Promise.all([1, 2].map(() => postCode({ ...env, DB: slow(env.DB) }, token, code)));
  assert.deepEqual(both.map(({ response }) => response.status).sort(), [303, 403]);
  assert.equal(both.filter(({ response }) => setValue(response, ADMIN_COOKIE)).length, 1, 'two admin sessions opened');
  assert.match(both.find(({ response }) => response.status === 403).html, /<h1>Sign in again<\/h1>/);
  // Both claimed a try and passed the check before either spent the code.
  assert.equal(one(env.DB, 'SELECT tries FROM admin_codes').tries, 2);
  assert.equal(one(env.DB, 'SELECT code_hash FROM admin_codes').code_hash, null);
  // useCode alone: of two at once, one spends it.
  const again = await passwordStep(env);
  const spent = await Promise.all([1, 2].map(() => useCode(slow(env.DB), again.token)));
  assert.deepEqual(spent.sort(), [false, true]);
});

test('a code expires in 10 minutes: one second before, it passes; at 10 minutes, it has ended (criterion 1)', async () => {
  assert.equal(CODE_SECONDS, 600);
  const T = 1_790_000_000;
  for (const [after, outcome] of [[599, 'right'], [600, 'ended']]) {
    const env = site();
    const id = await account(env.DB);
    const started = await startCode(env, { accountId: id, version: 1, email: 'jane@example.org', now: T, site: SITE });
    const result = await checkCode(env, { token: started.token, code: codeIn(sends.at(-1)), now: T + after });
    assert.equal(result.outcome, outcome, `${after} s on`);
  }
});

test('a code allows 5 tries: four wrong say how many are left, the fifth ends it, and the right code is then refused too (criterion 1)', async (t) => {
  fastCheck(t);
  assert.equal(CODE_TRIES, 5);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  const wrong = otherThan(code);
  for (const [i, left] of [[1, '4 more tries are'], [2, '3 more tries are'], [3, '2 more tries are'], [4, '1 more try is']]) {
    const { response, html } = await postCode(env, token, wrong);
    assert.equal(response.status, 403, `try ${i}`);
    assert.ok(html.includes(`That is not the code. ${left} allowed before it stops working.`), `try ${i}`);
    assert.equal(setValue(response, CODE_COOKIE), undefined, 'a wrong try ended the sign-in early');
  }
  const fifth = await postCode(env, token, wrong);
  assert.equal(fifth.response.status, 403);
  assert.match(fifth.html, /it was the last of its 5 tries, so the code no longer works/);
  assert.equal(setValue(fifth.response, CODE_COOKIE), '');
  const right = await postCode(env, token, code);
  assert.equal(right.response.status, 403);
  assert.equal(setValue(right.response, ADMIN_COOKIE), undefined);
  assert.equal(one(env.DB, 'SELECT tries FROM admin_codes').tries, 5);
});

test('tries sent at once cannot pass 5: of 8 wrong codes at once, 5 are checked and 3 find the code ended (criterion 1)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  const checks = t.mock.method(codeHashing, 'verify');
  const now = nowSeconds();
  const all = await Promise.all(Array.from({ length: 8 }, () => checkCode({ ...env, DB: slow(env.DB) }, { token, code: otherThan(code), now })));
  assert.deepEqual(all.map((r) => r.outcome).sort(), ['ended', 'ended', 'ended', 'wrong', 'wrong', 'wrong', 'wrong', 'wrong']);
  assert.deepEqual(all.filter((r) => r.outcome === 'wrong').map((r) => r.triesLeft).sort(), [0, 1, 2, 3, 4]);
  assert.equal(checks.mock.callCount(), 5);
});

test('a code belongs to the sign-in it was emailed for: another browser\'s cookie, a made-up one or none finds nothing to check (criterion 1)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const first = await passwordStep(env);
  const second = await passwordStep(env);
  // The first email's code under the second sign-in's cookie is a wrong try
  // there, and its own sign-in is untouched.
  assert.equal((await postCode(env, second.token, first.code)).response.status, 403);
  assert.deepEqual(rows(env.DB, 'SELECT tries FROM admin_codes ORDER BY made_at, tries').map((r) => r.tries).sort(), [0, 1]);
  for (const cookie of [undefined, 'A'.repeat(43), 'not-a-token']) {
    const { response, html } = await postCode(env, cookie, first.code);
    assert.equal(response.status, 403, String(cookie));
    assert.match(html, /<h1>Sign in again<\/h1>/);
    assert.equal(setValue(response, ADMIN_COOKIE), undefined);
  }
  // GET with no sign-in to finish goes back to the sign-in.
  const get = await call(env, '/sign-in/code');
  assert.equal(get.response.status, 303);
  assert.equal(get.response.headers.get('Location'), '/sign-in');
  // The control: each code works in its own browser.
  assert.equal((await postCode(env, first.token, first.code)).response.status, 303);
  assert.equal((await postCode(env, second.token, second.code)).response.status, 303);
});

test('the code may be typed with spaces or a hyphen; anything but 6 digits is a 400 that spends no try', async (t) => {
  fastCheck(t);
  assert.equal(readCode('123 456'), '123456');
  assert.equal(readCode(' 123-456 '), '123456');
  for (const typed of ['', '12345', '1234567', 'abcdef', '12345a', '١٢٣٤٥٦', '123\u0000456', '1'.repeat(65)]) {
    assert.equal(readCode(typed), null, JSON.stringify(typed));
  }
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  const short = await postCode(env, token, code.slice(0, 5));
  assert.equal(short.response.status, 400);
  assert.match(short.html, /Enter the 6 digits from the email\./);
  assert.equal(one(env.DB, 'SELECT tries FROM admin_codes').tries, 0);
  assert.equal((await postCode(env, token, `${code.slice(0, 3)} ${code.slice(3)}`)).response.status, 303);
});

test('POST /sign-in/code from another site, or with no Origin, is refused 403 before any try is spent', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  for (const origin of [null, 'https://evil.example', 'https://madcowsailing.com']) {
    const { response } = await postCode(env, token, code, { origin });
    assert.equal(response.status, 403, String(origin));
    assert.deepEqual(await response.json(), { error: 'origin' });
  }
  assert.equal(one(env.DB, 'SELECT tries FROM admin_codes').tries, 0);
});

test('an admin is sent at most 10 codes in any 24 hours; the 11th sign-in makes none and says when to try again', async (t) => {
  fastCheck(t);
  assert.equal(CODES_PER_DAY, 10);
  const env = site();
  const id = await account(env.DB);
  const T = nowSeconds();
  for (let i = 0; i < CODES_PER_DAY; i += 1) {
    assert.equal((await startCode(env, { accountId: id, version: 1, email: 'jane@example.org', now: T - 100 + i, site: SITE })).outcome, 'sent');
  }
  const { response, html } = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane@example.org', password: PASSWORD } });
  assert.equal(response.status, 429);
  const wait = Number(response.headers.get('Retry-After'));
  assert.ok(wait > 86_200 && wait <= 86_300, `Retry-After ${wait}`);
  assert.match(html, /Your account has been sent 10 sign-in codes in the last 24 hours, the most the site sends one admin\. Try again in 24 hours\./);
  assert.equal(sends.length, CODES_PER_DAY);
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes').n, CODES_PER_DAY);
  // A day after the first, it no longer counts, and one more is sent; the
  // rows over a day old go with it.
  assert.equal((await startCode(env, { accountId: id, version: 1, email: 'jane@example.org', now: T - 100 + 86_400, site: SITE })).outcome, 'sent');
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes').n, CODES_PER_DAY);
  // Another admin's day is their own.
  const other = await account(env.DB, { email: 'other@example.org', adminRole: 'admin' });
  assert.equal((await startCode(env, { accountId: other, version: 1, email: 'other@example.org', now: T, site: SITE })).outcome, 'sent');
});

test('a new password lifts the day\'s limit: someone with the old one spends the codes, the admin resets, and the next sign-in is sent a code (#224\'s review)', async (t) => {
  fastCheck(t);
  const env = site();
  const id = await account(env.DB);
  const T = nowSeconds();
  for (let i = 0; i < CODES_PER_DAY; i += 1) {
    assert.equal((await startCode(env, { accountId: id, version: 1, email: 'jane@example.org', now: T - 100 + i, site: SITE })).outcome, 'sent');
  }
  const fields = { email: 'jane@example.org', password: PASSWORD };
  const limited = await call(env, '/sign-in', { method: 'POST', fields });
  assert.equal(limited.response.status, 429);
  assert.match(limited.html, /someone else knows your password: <a href="\/forgot-password">reset it<\/a>\. A new password lets you sign in again at once\./);
  // The reset, as the email's link sets it (STORED stands in for the hash).
  const { token } = await makeLink(env.DB, id, T);
  const version = await setPassword(env.DB, { accountId: id, token, passwordHash: STORED, emailKey: await emailHash(KEYS.ADDRESS_HASH_KEY, 'jane@example.org'), now: T });
  assert.equal(version, 2);
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes WHERE account_id = ?', id).n, 0);
  const signedIn = await call(env, '/sign-in', { method: 'POST', fields });
  assert.equal(signedIn.response.status, 303);
  assert.equal(signedIn.response.headers.get('Location'), '/sign-in/code');
  assert.equal(sends.length, CODES_PER_DAY + 1);
  // The control: another admin's codes are not theirs to lose.
  const other = await account(env.DB, { email: 'other@example.org', adminRole: 'admin' });
  await startCode(env, { accountId: other, version: 1, email: 'other@example.org', now: T, site: SITE });
  const { token: otherLink } = await makeLink(env.DB, id, T);
  await setPassword(env.DB, { accountId: id, token: otherLink, passwordHash: STORED, emailKey: await emailHash(KEYS.ADDRESS_HASH_KEY, 'jane@example.org'), now: T });
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes WHERE account_id = ?', other).n, 1);
});

test('a code Resend refused is deleted and does not count; quota says when it resets; one Resend did not confirm is kept, and the page says so', async (t) => {
  fastCheck(t);
  t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  const fields = { email: 'jane@example.org', password: PASSWORD };
  resend = () => Response.json({ name: 'validation_error' }, { status: 422 });
  const refused = await call(env, '/sign-in', { method: 'POST', fields });
  assert.equal(refused.response.status, 503);
  assert.match(refused.html, /The email with your sign-in code could not be sent just now\./);
  assert.equal(setValue(refused.response, CODE_COOKIE), undefined);
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes').n, 0);
  resend = () => Response.json({ name: 'daily_quota_exceeded' }, { status: 429 });
  const quota = await call(env, '/sign-in', { method: 'POST', fields });
  assert.equal(quota.response.status, 503);
  assert.match(quota.html, /Try again after midnight UTC, when the limit resets\./);
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes').n, 0);
  resend = () => new Response('busy', { status: 502 });
  const unconfirmed = await call(env, '/sign-in', { method: 'POST', fields });
  assert.equal(unconfirmed.response.status, 303);
  assert.equal(unconfirmed.response.headers.get('Location'), '/sign-in/code?unconfirmed');
  assert.equal(one(env.DB, 'SELECT COUNT(*) AS n FROM admin_codes WHERE code_hash IS NOT NULL').n, 1);
  const page = await call(env, '/sign-in/code', { query: '?unconfirmed', cookies: { [CODE_COOKIE]: setValue(unconfirmed.response, CODE_COOKIE) } });
  assert.match(page.html, /<p role="status">The email service did not confirm that it sent your code\./);
});

test('a database that does not answer closes both steps with a 503, and opens nothing', async (t) => {
  fastCheck(t);
  t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  const start = await call({ ...env, DB: failOn(env.DB, /^INSERT INTO admin_codes/) }, '/sign-in', { method: 'POST', fields: { email: 'jane@example.org', password: PASSWORD } });
  assert.equal(start.response.status, 503);
  assert.equal(sends.length, 0);
  const { token, code } = await passwordStep(env);
  const check = await postCode({ ...env, DB: failOn(env.DB, /^UPDATE admin_codes SET tries/) }, token, code);
  assert.equal(check.response.status, 503);
  assert.equal(setValue(check.response, ADMIN_COOKIE), undefined);
  // The control: the same code, with the database answering.
  assert.equal((await postCode(env, token, code)).response.status, 303);
});

test('a database that fails after the code passed leaves the code unspent, so sending it again signs in (#224\'s review)', async (t) => {
  fastCheck(t);
  const errors = t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  // The read of who the code signs in, and the statement that spends it:
  // either failing is a 503 that spends nothing, and says so.
  for (const pattern of [/^SELECT a\.id, a\.name, a\.email, a\.admin_role/, /^UPDATE admin_codes SET code_hash = NULL/]) {
    const { token, code } = await passwordStep(env);
    const failed = await postCode({ ...env, DB: failOn(env.DB, pattern) }, token, code);
    assert.equal(failed.response.status, 503, String(pattern));
    assert.match(failed.html, /The code can't be checked right now\. Try again in a few minutes\./);
    assert.deepEqual(failed.response.headers.getSetCookie(), [], String(pattern));
    assert.match(String(errors.mock.calls.at(-1).arguments[0]), /so the code was not used/);
    const row = one(env.DB, 'SELECT code_hash, tries FROM admin_codes WHERE token_hash = ?', await tokenHash(token));
    assert.notEqual(row.code_hash, null, `${pattern} spent the code`);
    assert.equal(row.tries, 1);
    // Sent again with the database answering, the same code signs in.
    const again = await postCode(env, token, code);
    assert.equal(again.response.status, 303, String(pattern));
    assert.ok(setValue(again.response, ADMIN_COOKIE), String(pattern));
  }
});

test('a sign-out or a new password between the two steps ends the code; a demotion signs in the account without the admin pages', async (t) => {
  fastCheck(t);
  const env = site();
  const owner = await account(env.DB, { email: 'owner@example.org' });
  const id = await account(env.DB, { adminRole: 'admin' });
  const signedOut = await passwordStep(env);
  assert.equal(await signOut(env.DB, { accountId: id, version: 1 }), true);
  const ended = await postCode(env, signedOut.token, signedOut.code);
  assert.equal(ended.response.status, 403);
  assert.deepEqual(ended.response.headers.getSetCookie(), [`${CODE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`]);
  // At the account's new version, the owner takes the role away mid-sign-in.
  const demoted = await passwordStep(env);
  assert.equal(await demoteAdmin(env.DB, { accountId: id, actorId: owner, admin: 'owner@example.org', now: nowSeconds() }), true);
  const { response } = await postCode(env, demoted.token, demoted.code);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/account');
  assert.match(setValue(response, ACCOUNT_COOKIE) ?? '', new RegExp(`^a1\\.${id}\\.2\\.`));
  // No admin session opens, and any admin cookie the browser held is deleted.
  assert.equal(setValue(response, ADMIN_COOKIE), '');
  // Its /account draws no link to the admin pages.
  const landing = await call(env, '/account', { cookies: { [ACCOUNT_COOKIE]: setValue(response, ACCOUNT_COOKIE) } });
  assert.equal(landing.response.status, 200);
  assert.ok(!landing.html.includes('Open the admin pages'));
});

test('the email carries the code and names nobody; it says how long and where it works, and what to do if it was not asked for', async (t) => {
  fastCheck(t);
  // Each environment on a host that is not its link, so which site the
  // sign-in hands the email is what is tested (#224's review: on one host
  // for both, either wrong choice passed). Production reached on pages.dev
  // still links the custom domain; a preview links itself.
  const PREVIEW = 'https://develop.madcowphotos.pages.dev';
  for (const [SITE_ENV, host, link] of [['production', 'https://madcowphotos.pages.dev', PRODUCTION_SITE], ['preview', PREVIEW, PREVIEW]]) {
    const env = site({ SITE_ENV });
    await account(env.DB, { name: 'Planted Name' });
    const { code } = await passwordStep(env, 'jane@example.org', { host });
    const [{ subject, text }] = sends.splice(0);
    assert.equal(subject, 'Your sign-in code for the Mad Cow Sailing photo site');
    assert.ok(!subject.includes(code));
    assert.ok(!text.includes('Planted') && !text.includes('jane@example.org'));
    assert.ok(text.includes(`\n\n${code}\n\n`));
    assert.match(text, /It works once, for the next 10 minutes, and only in the browser where you just typed your password\./);
    assert.ok(text.includes(`Set a new one at ${link}/forgot-password, which also signs everyone out of your account.`), SITE_ENV);
    assert.deepEqual(codeEmail({ code, site: link }), { subject, text });
  }
});

test('codes are 6 digits, every value equally likely: a draw past the last whole million is drawn again, and leading zeros stay', () => {
  const draws = (...values) => (array) => { array[0] = values.shift(); return array; };
  assert.equal(newCode(draws(42)), '000042');
  // 4,294,000,000 is the first draw past the last whole million a 32-bit
  // value holds; it and anything above it would favour codes 0 to 967,295.
  assert.equal(newCode(draws(4_294_000_000, 4_294_967_295, 999_999)), '999999');
  assert.equal(newCode(draws(4_293_999_999)), '999999');
  const seen = new Set(Array.from({ length: 200 }, () => newCode()));
  assert.ok([...seen].every((c) => /^[0-9]{6}$/.test(c)));
  assert.ok(seen.size > 190, 'codes repeat');
});

test('GET /sign-in?admin says the admin pages need a sign-in, and that a press there changed nothing', async () => {
  const { response, html } = await call(site(), '/sign-in', { query: '?admin' });
  assert.equal(response.status, 200);
  assert.match(html, /<p role="status">Sign in to open the admin pages\. An admin's sign-in lasts 12 hours\. If you pressed a button there, nothing was changed: press it again once you are signed in\.<\/p>/);
});

test('a refused admin request is sent where that notice is: its Location, followed, is /sign-in saying so (#224\'s review)', async () => {
  // Every refusal test compares Location with ADMIN_SIGN_IN itself, so the
  // constant is pinned here, and one refusal is followed to the page it names.
  assert.equal(ADMIN_SIGN_IN, '/sign-in?admin');
  const env = site();
  const refused = await call(env, '/admin');
  assert.equal(refused.response.status, 303);
  const target = new URL(refused.response.headers.get('Location'), SITE);
  assert.equal(target.origin, SITE);
  assert.equal(target.pathname, '/sign-in');
  const { response, html } = await call(env, target.pathname, { query: target.search });
  assert.equal(response.status, 200);
  assert.match(html, /<p role="status">Sign in to open the admin pages\./);
});

// ---- Criterion 2: 12 hours at most, and the role read on every request ------

test('an admin session lasts 12 hours: the cookie asks no longer, and the server refuses it at 12 hours to the second (criterion 2)', async (t) => {
  assert.equal(ADMIN_SESSION_HOURS, 12);
  assert.equal(ADMIN_SESSION_SECONDS, 43_200);
  t.mock.timers.enable({ apis: ['Date'], now: 1_790_000_000_000 });
  const env = site();
  const id = await account(env.DB);
  const issued = nowSeconds();
  const value = await signAdminSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, issued);
  const request = new Request(`${SITE}/admin/`, { headers: { Cookie: `${ADMIN_COOKIE}=${value}` } });
  assert.deepEqual(await readAdminSession(request, KEYS.SESSION_SIGNING_KEY, issued + 43_199), { accountId: id, version: 1, issued });
  assert.equal(await readAdminSession(request, KEYS.SESSION_SIGNING_KEY, issued + 43_200), null);
  // Issued more than a minute ahead of the clock: refused, as the account's is.
  assert.equal(await readAdminSession(request, KEYS.SESSION_SIGNING_KEY, issued - 61), null);
  assert.ok(await readAdminSession(request, KEYS.SESSION_SIGNING_KEY, issued - 60));
  // Through the guard, on the clock.
  t.mock.timers.tick(43_199 * 1000);
  assert.equal((await call(env, '/admin', { cookies: { [ADMIN_COOKIE]: value } })).response.status, 200);
  t.mock.timers.tick(1000);
  const late = await call(env, '/admin', { cookies: { [ADMIN_COOKIE]: value } });
  assert.equal(late.response.status, 303);
  assert.equal(late.response.headers.get('Location'), ADMIN_SIGN_IN);
});

test('the role is read on every request: a demotion closes the admin pages at the next one, and the account still signs in to send (criterion 2)', async () => {
  const env = site();
  const owner = await account(env.DB, { email: 'owner@example.org' });
  const id = await account(env.DB, { adminRole: 'admin' });
  const now = nowSeconds();
  const admin = await signAdminSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, now);
  const accountSession = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, now);
  assert.equal((await call(env, '/admin', { cookies: { [ADMIN_COOKIE]: admin } })).response.status, 200);
  assert.equal(await demoteAdmin(env.DB, { accountId: id, actorId: owner, admin: 'owner@example.org', now }), true);
  const next = await call(env, '/admin', { cookies: { [ADMIN_COOKIE]: admin } });
  assert.equal(next.response.status, 303);
  assert.equal(next.response.headers.get('Location'), ADMIN_SIGN_IN);
  assert.equal(setValue(next.response, ADMIN_COOKIE), '', 'the dead admin cookie was left');
  // Their account's own session still holds.
  assert.equal((await call(env, '/account', { cookies: { [ACCOUNT_COOKIE]: accountSession } })).response.status, 200);
});

test('an admin session met by a database that does not answer is a 503, closed: the page never runs (criterion 2)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const id = await account(env.DB);
  const value = await signAdminSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  const down = await call({ ...env, DB: failOn(env.DB, /^SELECT a\.id, a\.name, a\.email, a\.admin_role/) }, '/admin', { cookies: { [ADMIN_COOKIE]: value } });
  assert.equal(down.response.status, 503);
  assert.deepEqual(await down.response.json(), { error: 'unavailable' });
  assert.equal(down.response.headers.get('Cache-Control'), 'no-store');
  // The control: the same session, with the database answering, opens the page.
  assert.equal((await call(env, '/admin', { cookies: { [ADMIN_COOKIE]: value } })).response.status, 200);
});

test('signing out from the admin home ends the admin session and the account\'s, everywhere, and deletes both cookies (criterion 2)', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  const { response } = await postCode(env, token, code);
  const cookies = { [ACCOUNT_COOKIE]: setValue(response, ACCOUNT_COOKIE), [ADMIN_COOKIE]: setValue(response, ADMIN_COOKIE) };
  const home = await call(env, '/admin', { cookies });
  assert.match(home.html, /<form method="post" action="\/sign-out">/);
  // Only the admin cookie, as the admin pages hold it after the account's
  // cookie went: still enough to sign out.
  const out = await call(env, '/sign-out', { method: 'POST', cookies: { [ADMIN_COOKIE]: cookies[ADMIN_COOKIE] } });
  assert.equal(out.response.status, 303);
  assert.deepEqual(out.response.headers.getSetCookie().map((line) => line.split(';')[0]), [`${ACCOUNT_COOKIE}=`, `${ADMIN_COOKIE}=`]);
  assert.equal((await call(env, '/admin', { cookies })).response.status, 303);
  assert.equal((await call(env, '/account', { cookies })).response.status, 303);
});

test('someone signing in where an admin left theirs open is not that admin, and their Sign out ends only their own sessions (#224\'s review)', async (t) => {
  fastCheck(t);
  const env = site();
  const admin = await account(env.DB);
  const parent = await account(env.DB, { email: 'parent@example.org', name: 'Parent B', adminRole: null });
  const { token, code } = await passwordStep(env);
  const signedIn = await postCode(env, token, code);
  const jar = { [ACCOUNT_COOKIE]: setValue(signedIn.response, ACCOUNT_COOKIE), [ADMIN_COOKIE]: setValue(signedIn.response, ADMIN_COOKIE) };
  // B signs in with a password in the same browser: B's cookie is set and
  // the admin's is deleted, so the jar holds B alone.
  const b = await call(env, '/sign-in', { method: 'POST', fields: { email: 'parent@example.org', password: PASSWORD }, cookies: jar });
  assert.equal(b.response.status, 303);
  assert.equal(setValue(b.response, ADMIN_COOKIE), '');
  const after = { [ACCOUNT_COOKIE]: setValue(b.response, ACCOUNT_COOKIE) };
  assert.equal((await call(env, '/admin', { cookies: after })).response.status, 303);
  const out = await call(env, '/sign-out', { method: 'POST', cookies: after });
  assert.equal(out.response.status, 303);
  const version = (id) => one(env.DB, 'SELECT session_version AS v FROM accounts WHERE id = ?', id).v;
  assert.deepEqual([version(admin), version(parent)], [1, 2]);
  // The admin's own cookies, standing in for their other devices, still hold.
  assert.equal((await call(env, '/admin', { cookies: jar })).response.status, 200);
});

test('sign-out ends an account in one statement, whichever versions its cookies carry, so a 503 means nothing ended (#224\'s review)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const id = await account(env.DB);
  const now = nowSeconds();
  const statements = [];
  const counting = { ...env.DB, prepare: (sql) => { statements.push(sql); return env.DB.prepare(sql); } };
  const bumps = () => statements.filter((sql) => sql.startsWith('UPDATE accounts SET session_version')).length;
  const version = () => one(env.DB, 'SELECT session_version AS v FROM accounts WHERE id = ?', id).v;
  const cookiesAt = async (accountVersion, adminVersion) => ({
    [ACCOUNT_COOKIE]: await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: accountVersion }, now),
    [ADMIN_COOKIE]: await signAdminSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: adminVersion }, now),
  });
  // Both cookies at one version, as one sign-in sets them: one statement.
  assert.equal((await call({ ...env, DB: counting }, '/sign-out', { method: 'POST', cookies: await cookiesAt(1, 1) })).response.status, 303);
  assert.equal(bumps(), 1);
  assert.equal(version(), 2);
  // The account's cookie newer than the admin's (a new password between):
  // still one statement, and it ends the current one.
  statements.length = 0;
  assert.equal((await call({ ...env, DB: counting }, '/sign-out', { method: 'POST', cookies: await cookiesAt(2, 1) })).response.status, 303);
  assert.equal(bumps(), 1);
  assert.equal(version(), 3);
  // That one statement failing is the only 503, and then nothing ended.
  const down = await call({ ...env, DB: failOn(env.DB, /^UPDATE accounts SET session_version/) }, '/sign-out', { method: 'POST', cookies: await cookiesAt(3, 3) });
  assert.equal(down.response.status, 503);
  assert.equal(version(), 3);
});

// ---- The pages ---------------------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());

test('the code page and its every state pass the photo site\'s html-validate config, and the validator can fail it', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const { token, code } = await passwordStep(env);
  const pages = [
    (await call(env, '/sign-in/code', { cookies: { [CODE_COOKIE]: token } })).html,
    (await call(env, '/sign-in/code', { query: '?unconfirmed', cookies: { [CODE_COOKIE]: token } })).html,
    (await postCode(env, token, '12')).html,
    (await postCode(env, token, otherThan(code))).html,
    (await postCode(env, 'B'.repeat(43), code)).html,
  ];
  // Each is the state it is named for before it is validated: an empty body
  // validates clean, so a state that stopped rendering would pass unseen
  // (the mutation round's M16: every code passing turned the wrong-code page
  // into a bodiless 303, and this test stayed green).
  const states = ['<h1>Enter your code</h1>', 'did not confirm that it sent your code', 'Enter the 6 digits from the email.', 'That is not the code.', '<h1>Sign in again</h1>'];
  pages.forEach((html, i) => assert.ok(html.includes(states[i]), `state ${i} is not the page it is named for`));
  for (const html of pages) {
    const report = await validator.validateString(html, join(ROOT, 'code.html'));
    assert.equal(report.valid, true, report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)).join('\n'));
  }
  // The control: a second h1 is caught.
  const broken = pages[0].replace('<h1>', '<h1>Planted</h1><h1>');
  assert.equal((await validator.validateString(broken, join(ROOT, 'code.html'))).valid, false);
  // A reason links its field, and the field points at it.
  assert.match(pages[2], /<a href="#sign-in-code">Enter the 6 digits from the email\.<\/a>/);
  assert.match(pages[2], /<input id="sign-in-code" [^>]*aria-invalid="true" aria-describedby="sign-in-code-hint sign-in-code-error"/);
});

test('/account links the admin pages for the owner and an admin, and for nobody else, and still validates (#224\'s review)', async () => {
  const base = { name: 'Jane Rivers', email: 'jane@example.org', teams: ['hoover-jrt'] };
  const link = '<a class="button" href="/admin/">Open the admin pages</a>';
  for (const adminRole of ['owner', 'admin']) {
    const html = accountPage({ ...base, adminRole });
    assert.ok(html.includes(link), adminRole);
    const report = await validator.validateString(html, join(ROOT, 'account.html'));
    assert.equal(report.valid, true, report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)).join('\n'));
  }
  for (const page of [accountPage({ ...base, adminRole: null }), accountPage(base)]) assert.ok(!page.includes('/admin/'));
});
