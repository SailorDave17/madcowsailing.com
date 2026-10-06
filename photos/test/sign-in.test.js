// Signing in (#222): the password rules (lib/password-rules.js), sign-in,
// sign-out and setting a password (lib/sign-in.js), the session cookie and its
// guard (lib/account-session.js), the reset (lib/reset.js), and the routes
// /sign-in, /sign-out, /forgot-password, /set-password and /account, run
// through the root middleware as Pages runs them, against a real SQLite
// holding the real migrations (test/d1.js). The guard's refusal cases for
// every route under /account are test/guard.test.js's; /policy's rows are
// test/policy.test.js's.
//
// fetch is stood in for: siteverify's URL answers `siteverify`, Resend's
// `resend`, Pwned Passwords' range URL `pwnedAnswer`, and any other URL throws.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import * as signInRoute from '../functions/sign-in.js';
import * as signOutRoute from '../functions/sign-out.js';
import * as forgotRoute from '../functions/forgot-password.js';
import * as setRoute from '../functions/set-password.js';
import * as accountDir from '../functions/account/_middleware.js';
import * as accountRoute from '../functions/account/index.js';
import { requestAccount } from '../lib/accounts.js';
import {
  ACCOUNT_COOKIE, ACCOUNT_SESSION_SECONDS, accountCookie, readAccountSession, sessionAccount, signAccountSession,
} from '../lib/account-session.js';
import { addressHash } from '../lib/address.js';
import { sendLink } from '../lib/people.js';
import { TURNSTILE_CSP, SITE_HEADERS } from '../lib/headers.js';
import { RESEND_URL } from '../lib/mail.js';
import { makeLink, tokenHash } from '../lib/password-link.js';
import { SCRYPT, hashPassword, phcParams, verifyPassword } from '../lib/password.js';
import {
  MESSAGES, PASSWORD_MAX, PASSWORD_MIN, PWNED_RANGE_URL, PWNED_TIMEOUT_MS, SITE_WORDS, normalizePassword, passwordLength, pwned, readNewPassword,
} from '../lib/password-rules.js';
import {
  RESET_EMAILS_PER_DAY, RESET_GAP_SECONDS, RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_SECONDS, RESET_SECONDS, claimResetRequest,
  clearExpiredResetRequests, sendReset,
} from '../lib/reset.js';
import {
  EMAIL_FAILURE_LIMIT, FAILED_IN_A_ROW, FAILURE_BUDGET_PER_HOUR, FAILURE_WINDOW_SECONDS, NETWORK_FAILURE_LIMIT, STAND_IN_HASH,
  clearExpiredSignIns, emailHash, hashing, setPassword, signIn, signOut,
} from '../lib/sign-in.js';
import { nowSeconds } from '../lib/session.js';
import { SITEVERIFY_URL, TOKEN_FIELD } from '../lib/turnstile.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const IP = '203.0.113.7';
const KEYS = {
  SESSION_SIGNING_KEY: 'test-session-signing-key-0123456789abcdef',
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
  TURNSTILE_SITE_KEY: '0x4AAAAAAA-test-site-key',
  TURNSTILE_SECRET_KEY: 'turnstile-secret-for-tests',
};
const TURNSTILE = 'XXXX.DUMMY.TOKEN.XXXX';

// A password that meets every rule, and its real scrypt hash, made once.
const PASSWORD = 'four unrelated words in a row';
const KNOWN_HASH = await hashPassword(PASSWORD);

const sha1 = (text) => createHash('sha1').update(text, 'utf8').digest('hex').toUpperCase();

let siteverify; // () => the Response siteverify answers
let resend; // (body) => the Response Resend answers
let pwnedAnswer; // (prefix) => the Response Pwned Passwords answers
let sends; // every message that reached Resend
let ranges; // every prefix Pwned Passwords was asked
let resendGate; // when set, Resend answers only once this settles

beforeEach(() => {
  sends = [];
  ranges = [];
  resendGate = null;
  siteverify = () => Response.json({ success: true, 'error-codes': [] });
  resend = () => Response.json({ id: 'msg-222' });
  // By default no password is breached: the range holds a padded line only.
  pwnedAnswer = () => new Response(`${'0'.repeat(35)}:0\r\n`);
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === SITEVERIFY_URL) return siteverify(JSON.parse(init.body));
    if (url === RESEND_URL) {
      sends.push(JSON.parse(init.body));
      if (resendGate) await resendGate;
      return resend(JSON.parse(init.body));
    }
    if (url.startsWith(PWNED_RANGE_URL)) {
      const prefix = url.slice(PWNED_RANGE_URL.length);
      ranges.push({ prefix, headers: init.headers, signal: init.signal });
      return pwnedAnswer(prefix);
    }
    throw new Error(`fetched ${url}`);
  });
});
afterEach(() => mock.restoreAll());

const site = (extra = {}) => ({ DB: d1(), SITE_ENV: 'preview', RESEND_API_KEY: 'test-key-not-real', ...KEYS, ...extra });

const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map((row) => ({ ...row }));
const count = (db, table) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const tables = (db) => db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
const snapshot = (db) => Object.fromEntries(tables(db).map((t) => [t, rows(db, `SELECT * FROM "${t}"`)]));

/**
 * An account, made by #220's own request, then set as the test needs:
 * approved for its teams or still waiting, a password hash or none, and a
 * count of failures in a row. Answers its id.
 */
let asked = 0;
async function account(db, {
  email = 'jane@example.org', name = 'Jane Rivers', teams = ['cohssa'], approved = true, hash = KNOWN_HASH, failed = 0, now = nowSeconds(),
} = {}) {
  asked += 1;
  await requestAccount(db, { request: { name, email, role: 'parent', teams, note: null }, address: `address-${asked}`, now });
  const { id } = db.sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (approved) db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = ?").run(id);
  db.sqlite.prepare('UPDATE accounts SET password_hash = ?, failed_sign_ins = ? WHERE id = ?').run(hash, failed, id);
  return id;
}

const encode = (fields) => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) params.append(name, value);
  return params.toString();
};

const HANDLERS = {
  '/sign-in': signInRoute,
  '/sign-out': signOutRoute,
  '/forgot-password': forgotRoute,
  '/set-password': setRoute,
  '/account': { chain: [...accountDir.onRequest], ...accountRoute },
};

/**
 * One request through the root middleware, and the account directory's
 * guard for /account. Returns the response, its page, and the work it left
 * for after it (waitUntil).
 */
async function call(env, path, { method = 'GET', fields, origin = SITE, ip = IP, cookie } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  let body;
  if (method === 'POST') {
    if (origin) headers.Origin = origin;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encode(fields ?? {});
  }
  if (cookie) headers.Cookie = `${ACCOUNT_COOKIE}=${cookie}`;
  const request = new Request(`${SITE}${path}`, { method, headers, body });
  const later = [];
  const data = {};
  const route = HANDLERS[new URL(request.url).pathname];
  const handler = route[{ GET: 'onRequestGet', HEAD: 'onRequestHead', POST: 'onRequestPost' }[method]];
  const stack = [...(route.chain ?? []), handler];
  const context = (i) => ({ request, env, params: {}, data, waitUntil(promise) { later.push(promise); }, next: () => stack[i + 1](context(i + 1)) });
  const response = await root({ ...context(-1), next: () => stack[0](context(0)) });
  return { response, later, html: method === 'HEAD' || !response.body ? '' : await response.clone().text() };
}

const cookieOf = (response) => {
  const line = response.headers.get('Set-Cookie');
  return line ? line.split(';')[0].slice(`${ACCOUNT_COOKIE}=`.length) : null;
};

// ---- Criterion 1: the password rules ----------------------------------------

const form = (password, confirm = password) => new URLSearchParams({ password, confirm });
const person = { email: 'jane.rivers@example.org', name: 'Jane Rivers' };
const reason = (password, confirm) => readNewPassword(form(password, confirm), person).errors?.[0]?.message ?? null;

test('the length rule is NIST\'s: 15 characters at least, 256 at most, each code point one character, counted after NFC (criterion 1)', () => {
  // NIST SP 800-63B-4, section 3.1.1.2 (read 2026-10-06): "a minimum of 15
  // characters" for a single-factor password; "a maximum password length of
  // at least 64 characters"; "Each Unicode code point SHALL be counted as a
  // single character"; NFC "before hashing".
  assert.equal(PASSWORD_MIN, 15);
  assert.ok(PASSWORD_MAX >= 64);
  assert.equal(PASSWORD_MAX, 256);
  assert.equal(reason('x'.repeat(14)), MESSAGES.short);
  assert.equal(reason('x'.repeat(15)), null);
  assert.equal(reason('x'.repeat(256)), null);
  assert.equal(reason('x'.repeat(257)), MESSAGES.long);
  assert.equal(reason(''), MESSAGES.missing);
  // A character outside the BMP is one code point and two UTF-16 units.
  assert.equal(reason('🙂'.repeat(15)), null);
  assert.equal(reason('🙂'.repeat(14)), MESSAGES.short);
  // e and a combining acute are two code points, and one after NFC: 15 of
  // them count 15, and 14 count 14, though each spelling is 28 code points.
  const decomposed = 'é';
  assert.equal(passwordLength(decomposed.repeat(15)), 15);
  assert.equal(reason(decomposed.repeat(15)), null);
  assert.equal(reason(decomposed.repeat(14)), MESSAGES.short);
  // The password handed on is the NFC form, which is what is hashed.
  assert.equal(readNewPassword(form(decomposed.repeat(15)), person).password, 'é'.repeat(15));
  assert.equal(normalizePassword(decomposed), 'é');
});

test('no composition rules: letters alone, digits alone, spaces and symbols all pass the rules (criterion 1)', () => {
  // "SHALL NOT impose other composition rules".
  for (const password of ['a'.repeat(15), '1'.repeat(15), ' '.repeat(15), '!@#$%^&*()_+-=[', 'ALL CAPITALS AND SPACES']) {
    assert.equal(reason(password), null, JSON.stringify(password));
  }
});

test('the two fields must match, compared after NFC', () => {
  assert.equal(reason(PASSWORD, `${PASSWORD} `), MESSAGES.confirm);
  assert.equal(reason(PASSWORD, ''), MESSAGES.confirm);
  assert.equal(reason('é'.repeat(15), 'é'.repeat(15)), null);
});

test('the blocklist\'s own half: the whole password against the person\'s address and name and the site\'s names, never a part of it (criterion 1)', () => {
  // "context-specific words, such as the name of the service, the username";
  // "The entire password SHALL be subject to comparison, not substrings".
  const long = { email: 'jane.rivers.sailing@example.org', name: 'Jane Elizabeth Rivers' };
  const refused = (password) => readNewPassword(form(password), long).errors?.[0]?.message;
  assert.equal(refused('jane.rivers.sailing@example.org'), MESSAGES.context);
  assert.equal(refused('JANE.RIVERS.SAILING'), MESSAGES.context); // the address before the @, folded
  assert.equal(refused('Jane Elizabeth Rivers'), MESSAGES.context);
  assert.equal(refused('jane elizabeth rivers!'), MESSAGES.context);
  assert.equal(refused('Mad Cow Sailing photos'), MESSAGES.context);
  assert.equal(refused('photos.madcowsailing.com'), MESSAGES.context);
  assert.equal(refused('Hoover Sailing Club'), MESSAGES.context);
  // Containing one is not being one.
  assert.equal(refused('Jane Elizabeth Rivers sails on Sundays'), undefined);
  assert.equal(refused('madcowsailing photos are lovely'), undefined);
  assert.ok(SITE_WORDS.includes('madcowsailingphotos'));
});

test('Pwned Passwords: a suffix it lists with a count is a breach; padding, absence, any other answer and no answer are not (criterion 1)', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const hash = sha1(PASSWORD);
  const [prefix, suffix] = [hash.slice(0, 5), hash.slice(5)];
  pwnedAnswer = () => new Response(`ABCDEF0123456789ABCDEF0123456789ABC:3\r\n${suffix}:17\r\n`);
  assert.equal(await pwned(PASSWORD), 'breached');
  assert.deepEqual(ranges.map((r) => r.prefix), [prefix]);
  assert.equal(ranges[0].headers['Add-Padding'], 'true');
  assert.match(ranges[0].headers['User-Agent'], /^madcowphotos\//);
  // A padded line for the same suffix counts 0: not a breach.
  pwnedAnswer = () => new Response(`${suffix}:0\r\n`);
  assert.equal(await pwned(PASSWORD), 'clear');
  // Absent from the range.
  pwnedAnswer = () => new Response('ABCDEF0123456789ABCDEF0123456789ABC:3\r\n');
  assert.equal(await pwned(PASSWORD), 'clear');
  // A lowercase suffix is not the API's, and does not match ours.
  pwnedAnswer = () => new Response(`${suffix.toLowerCase()}:9\r\n`);
  assert.equal(await pwned(PASSWORD), 'clear');
  // Unavailable: an error status, a refused fetch, and the timeout.
  assert.equal(errors.mock.callCount(), 0);
  pwnedAnswer = () => new Response('busy', { status: 503 });
  assert.equal(await pwned(PASSWORD), 'unavailable');
  pwnedAnswer = () => { throw new TypeError('network down'); };
  assert.equal(await pwned(PASSWORD), 'unavailable');
  pwnedAnswer = () => { throw new DOMException('The operation timed out.', 'TimeoutError'); };
  assert.equal(await pwned(PASSWORD), 'unavailable');
  assert.equal(errors.mock.callCount(), 3);
  // The owner's 3 s.
  assert.equal(PWNED_TIMEOUT_MS, 3000);
  // It hashes the NFC form it is given: a decomposed spelling asks another
  // range, which is why the routes normalise first.
  await pwned('é'.repeat(15));
  assert.equal(ranges.at(-1).prefix, sha1('é'.repeat(15)).slice(0, 5));
});

test('Pwned Passwords waits PWNED_TIMEOUT_MS and no longer: the signal handed to fetch is a timeout of that length', async (t) => {
  t.mock.method(console, 'error', () => {});
  // The timeout's own signal, made recognisable, must be the one fetch gets:
  // a timeout made and never passed on would wait for ever (#222's review).
  const marker = new AbortController().signal;
  const timeouts = t.mock.method(AbortSignal, 'timeout', () => marker);
  await pwned(PASSWORD);
  assert.deepEqual(timeouts.mock.calls.map((c) => c.arguments[0]), [PWNED_TIMEOUT_MS]);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].signal, marker);
});

// ---- Criterion 2: one answer, one path --------------------------------------

test('the stand-in hash is a real scrypt hash at SCRYPT\'s cost, which nothing typed matches', async () => {
  assert.equal(STAND_IN_HASH.split('$')[2], phcParams(SCRYPT));
  for (const typed of [PASSWORD, '', 'x'.repeat(15)]) assert.equal(await verifyPassword(typed, STAND_IN_HASH), false);
});

const failing = {
  'an address with no account': async (db) => ({ email: 'nobody@example.org' }),
  'a wrong password': async (db) => { await account(db); return { email: 'jane@example.org' }; },
  'an account not yet approved': async (db) => { await account(db, { approved: false }); return { email: 'jane@example.org', password: PASSWORD }; },
  'an approved account with no password yet': async (db) => { await account(db, { hash: null }); return { email: 'jane@example.org', password: PASSWORD }; },
  'a password stopped after 100 failures in a row': async (db) => { await account(db, { failed: FAILED_IN_A_ROW }); return { email: 'jane@example.org', password: PASSWORD }; },
};

test('every failure runs the same statements and checks one hash at SCRYPT\'s cost, so none answers sooner (criterion 2)', async (t) => {
  const checks = t.mock.method(hashing, 'verify');
  const paths = {};
  for (const [name, seed] of Object.entries(failing)) {
    const db = d1();
    const { email, password = 'not the password at all' } = await seed(db);
    const before = db.statements.length;
    checks.mock.resetCalls();
    const result = await signIn(db, { email, password, emailKey: await emailHash(KEYS.ADDRESS_HASH_KEY, email), address: 'net', now: nowSeconds() });
    assert.deepEqual(result, { outcome: 'refused' }, name);
    paths[name] = db.statements.slice(before);
    assert.equal(checks.mock.callCount(), 1, `${name}: ${checks.mock.callCount()} password checks`);
    const stored = checks.mock.calls[0].arguments[1];
    assert.equal(stored.split('$')[2], phcParams(SCRYPT), `${name} checked a hash of another cost`);
    assert.equal(stored, name === 'a wrong password' ? KNOWN_HASH : STAND_IN_HASH, name);
  }
  const [first, ...rest] = Object.entries(paths);
  for (const [name, path] of rest) assert.deepEqual(path, first[1], `${name} ran other statements than ${first[0]}`);
  assert.ok(first[1].length >= 5, 'too few statements recorded to compare');
});

test('every failure answers the same page: 403, the same message, whatever was wrong (criterion 2)', async () => {
  let first = null;
  for (const [name, seed] of Object.entries(failing)) {
    const env = site();
    const { email, password = 'not the password at all' } = await seed(env.DB);
    const { response, html } = await call(env, '/sign-in', { method: 'POST', fields: { email, password } });
    assert.equal(response.status, 403, name);
    assert.equal(response.headers.get('Set-Cookie'), null, name);
    const page = html.replace(`value="${email}"`, 'value="…"');
    assert.ok(page.includes('The email address and password don\'t match an account that can sign in.'), name);
    first ??= page;
    assert.equal(page, first, `${name} answered differently`);
  }
});

// ---- Criterion 4: a session that signs in, and what ends it ------------------

test('the right password signs in: 303 to /account, and a __Host- cookie for 90 days naming the account and its version (criterion 4)', async () => {
  const env = site();
  const id = await account(env.DB, { email: 'Jane@Example.org' });
  // The address is matched without regard to letter case, as it is stored.
  const { response } = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane@example.ORG', password: PASSWORD } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/account');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Set-Cookie'), new RegExp(`^${ACCOUNT_COOKIE}=a1\\.${id}\\.1\\.\\d+\\.[A-Za-z0-9_-]{43}; Max-Age=7776000; Path=/; Secure; HttpOnly; SameSite=Lax$`));
  assert.equal(ACCOUNT_SESSION_SECONDS, 90 * 24 * 60 * 60);
  // The cookie opens /account.
  const page = await call(env, '/account', { cookie: cookieOf(response) });
  assert.equal(page.response.status, 200);
  assert.match(page.html, /<h1>You are signed in<\/h1>/);
  assert.match(page.html, /As Jane Rivers, Jane@Example\.org, approved for COHSSA\./);
  assert.equal(page.response.headers.get('Cache-Control'), 'no-store');
});

test('the password is set and checked as NFC, through the routes: set in one spelling, it signs in with the other, both ways', async () => {
  // Through POST /set-password, so the set route's own normalising is what
  // is tested, not a hash the test made (#222's review).
  for (const [set, typed] of [['é'.repeat(15), 'é'.repeat(15)], ['é'.repeat(15), 'é'.repeat(15)]]) {
    const env = site();
    const { token } = await linked(env);
    assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(token, set) })).response.status, 303);
    const stored = env.DB.sqlite.prepare('SELECT password_hash FROM accounts').get().password_hash;
    assert.equal(await verifyPassword('é'.repeat(15), stored), true, 'the stored hash is not of the NFC form');
    const { response } = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane@example.org', password: typed } });
    assert.equal(response.status, 303);
  }
});

test('the cookie is signed, and lasts 90 days to the second: a changed byte, another key, an older or a later one are refused', async () => {
  const now = 1_790_000_000;
  const key = KEYS.SESSION_SIGNING_KEY;
  const value = await signAccountSession(key, { accountId: 4, version: 7 }, now);
  const request = (v) => new Request(`${SITE}/account`, { headers: { Cookie: `other=1; ${ACCOUNT_COOKIE}=${v}` } });
  assert.deepEqual(await readAccountSession(request(value), key, now), { accountId: 4, version: 7, issued: now });
  assert.deepEqual(await readAccountSession(request(value), key, now + ACCOUNT_SESSION_SECONDS - 1), { accountId: 4, version: 7, issued: now });
  assert.equal(await readAccountSession(request(value), key, now + ACCOUNT_SESSION_SECONDS), null);
  assert.equal(await readAccountSession(request(value), `${key}x`, now), null);
  assert.equal(await readAccountSession(request(value.replace('a1.4.7.', 'a1.4.8.')), key, now), null);
  assert.equal(await readAccountSession(request(value.replace('a1.4.', 'a1.5.')), key, now), null);
  // Issued more than a minute ahead of the clock is forged.
  assert.ok(await readAccountSession(request(await signAccountSession(key, { accountId: 4, version: 7 }, now + 60)), key, now));
  assert.equal(await readAccountSession(request(await signAccountSession(key, { accountId: 4, version: 7 }, now + 61)), key, now), null);
  // An upload cookie in its place is not one.
  assert.equal(await readAccountSession(new Request(SITE, { headers: { Cookie: `${ACCOUNT_COOKIE}=v1.2.${now}.${'A'.repeat(43)}` } }), key, now), null);
  assert.equal(await readAccountSession(request(value), undefined, now), null);
});

test('setting a password and signing out each add 1 to the version, and every session on the older one ends at its next request (criterion 4)', async () => {
  const db = d1();
  const id = await account(db);
  const now = nowSeconds();
  const phone = { accountId: id, version: 1, issued: now };
  const laptop = { accountId: id, version: 1, issued: now - 3600 };
  assert.ok(await sessionAccount(db, phone));
  const { token } = await makeLink(db, id, now);
  assert.equal(await setPassword(db, { accountId: id, token, passwordHash: KNOWN_HASH, emailKey: 'k', now }), 2);
  assert.equal(await sessionAccount(db, phone), null);
  assert.equal(await sessionAccount(db, laptop), null);
  const fresh = { accountId: id, version: 2, issued: now };
  assert.ok(await sessionAccount(db, fresh));
  assert.equal(await signOut(db, fresh), true);
  assert.equal(await sessionAccount(db, fresh), null);
  // A second sign-out of the same session finds nothing to end.
  assert.equal(await signOut(db, fresh), false);
  assert.equal(db.sqlite.prepare('SELECT session_version FROM accounts WHERE id = ?').get(id).session_version, 3);
  // A revoke (#225) ends sessions the same way: the version moves on.
});

test('the guard reads the account every request: an account approved for no team, or gone, is signed out at its next request', async () => {
  const env = site();
  const id = await account(env.DB);
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  assert.equal((await call(env, '/account', { cookie })).response.status, 200);
  env.DB.sqlite.prepare("UPDATE account_teams SET state = 'revoked' WHERE account_id = ?").run(id);
  const refused = await call(env, '/account', { cookie });
  assert.equal(refused.response.status, 303);
  assert.equal(refused.response.headers.get('Location'), '/sign-in');
});

test('a database that does not answer closes the account page with 503, never opens it', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const env = site({ DB: { ...db, prepare: () => { throw new Error('D1 down'); } } });
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 1, version: 1 }, nowSeconds());
  assert.equal((await call(env, '/account', { cookie })).response.status, 503);
});

// ---- Criterion 3: the limits ------------------------------------------------

// A fast check in place of scrypt, for the tests that count to a limit: the
// real one takes about 170 ms, and these make hundreds. The path tests above
// use the real one.
const fastCheck = (t) => t.mock.method(hashing, 'verify', async (typed, stored) => typed === PASSWORD && stored === KNOWN_HASH);

const tryAs = (db, { email = 'jane@example.org', password = 'wrong password, long enough', address = 'net-1', now }) => (async () => signIn(db, {
  email, password, emailKey: await emailHash(KEYS.ADDRESS_HASH_KEY, email), address, now,
}))();

test('10 failures an hour for one address, an address with no account counted the same; the 11th is refused unchecked and writes nothing (criterion 3)', async (t) => {
  const checks = fastCheck(t);
  for (const email of ['jane@example.org', 'nobody@example.org']) {
    const db = d1();
    await account(db);
    const now = 1_790_000_000;
    for (let i = 0; i < EMAIL_FAILURE_LIMIT; i += 1) {
      // Each from its own network, so only the address's count can bind.
      assert.deepEqual(await tryAs(db, { email, address: `net-${i}`, now: now + i }), { outcome: 'refused' }, `${email} try ${i + 1}`);
    }
    checks.mock.resetCalls();
    const before = snapshot(db);
    const statements = db.statements.length;
    // The right password, from a fresh network: still refused.
    const limited = await tryAs(db, { email, password: PASSWORD, address: 'net-new', now: now + 100 });
    assert.deepEqual(limited, { outcome: 'limited', scope: 'email', retryAfter: FAILURE_WINDOW_SECONDS - 100 });
    assert.equal(checks.mock.callCount(), 0, 'a limited try was checked');
    assert.deepEqual(snapshot(db), before, 'a limited try wrote something');
    // Its one write is the guarded claim, which inserted nothing.
    assert.deepEqual(db.statements.slice(statements).filter((sql) => !/^SELECT /.test(sql)).map((sql) => sql.split(' ')[0]), ['INSERT']);
    // An hour after the first failure it counts no more.
    assert.equal((await tryAs(db, { email, address: 'net-new', now: now + FAILURE_WINDOW_SECONDS })).outcome, 'refused');
  }
  assert.equal(EMAIL_FAILURE_LIMIT, 10);
});

test('20 failures an hour from one network, across addresses; the 21st is refused unchecked (criterion 3)', async (t) => {
  const checks = fastCheck(t);
  const db = d1();
  await account(db);
  const now = 1_790_000_000;
  for (let i = 0; i < NETWORK_FAILURE_LIMIT; i += 1) {
    assert.equal((await tryAs(db, { email: `person${i}@example.org`, address: 'one-network', now })).outcome, 'refused');
  }
  checks.mock.resetCalls();
  const limited = await tryAs(db, { email: 'jane@example.org', password: PASSWORD, address: 'one-network', now: now + 5 });
  assert.deepEqual(limited, { outcome: 'limited', scope: 'network', retryAfter: FAILURE_WINDOW_SECONDS - 5 });
  assert.equal(checks.mock.callCount(), 0);
  // Another network signs in.
  assert.equal((await tryAs(db, { email: 'jane@example.org', password: PASSWORD, address: 'other-network', now: now + 5 })).outcome, 'signed-in');
  assert.equal(NETWORK_FAILURE_LIMIT, 20);
});

test('100 recorded failures an hour for the whole site; then nobody signs in, nothing is written, until the hour turns (criterion 3)', async (t) => {
  const checks = fastCheck(t);
  const db = d1();
  await account(db);
  const hour = 1_790_000_000 - (1_790_000_000 % 3600);
  for (let i = 0; i < FAILURE_BUDGET_PER_HOUR; i += 1) {
    assert.equal((await tryAs(db, { email: `p${i}@example.org`, address: `net-${i}`, now: hour + 10 })).outcome, 'refused', `failure ${i + 1}`);
  }
  assert.equal(count(db, 'sign_in_failures'), FAILURE_BUDGET_PER_HOUR);
  checks.mock.resetCalls();
  const before = snapshot(db);
  const busy = await tryAs(db, { email: 'jane@example.org', password: PASSWORD, address: 'fresh', now: hour + 1000 });
  assert.deepEqual(busy, { outcome: 'busy', retryAfter: 3600 - 1000 });
  assert.equal(checks.mock.callCount(), 0);
  assert.deepEqual(snapshot(db), before);
  // The next clock hour signs in.
  assert.equal((await tryAs(db, { email: 'jane@example.org', password: PASSWORD, address: 'fresh', now: hour + 3600 })).outcome, 'signed-in');
  assert.equal(FAILURE_BUDGET_PER_HOUR, 100);
});

test('two failures racing for the hour\'s last unit: the guarded spend gives it to one, and the other is busy, unrecorded', async (t) => {
  // The read before the hash lets both through when the hour holds 99; only
  // the spend's own ceiling (WHERE failed < ?) decides between them.
  fastCheck(t);
  const db = d1();
  const hour = Math.floor(1_790_000_000 / 3600);
  db.sqlite.prepare('INSERT INTO sign_in_budget (hour, failed) VALUES (?, ?)').run(hour, FAILURE_BUDGET_PER_HOUR - 1);
  const both = await Promise.all(['a', 'b'].map((who) => (async () => signIn(slow(db), {
    email: `${who}@example.org`, password: 'wrong password, long enough',
    emailKey: await emailHash(KEYS.ADDRESS_HASH_KEY, `${who}@example.org`), address: `net-${who}`, now: hour * 3600 + 10,
  }))()));
  assert.deepEqual(both.map((r) => r.outcome).sort(), ['busy', 'refused']);
  assert.deepEqual(rows(db, 'SELECT failed FROM sign_in_budget'), [{ failed: FAILURE_BUDGET_PER_HOUR }]);
  assert.equal(count(db, 'sign_in_failures'), 1);
});

// A D1 whose statements matching `pattern` throw, alone or in a batch, which
// then rolls back whole as D1's does; every other statement runs.
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

test('a failure costs the budget\'s unit, one log row and the account\'s count; a try that cannot finish gives every unit back and is a 503', async (t) => {
  fastCheck(t);
  t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  const hour = Math.floor(nowSeconds() / 3600);
  const wrong = { email: 'jane@example.org', password: 'wrong password, long enough' };
  // Fails after the claim and the hour's unit, at the account's lookup.
  const broken = failOn(env.DB, /^SELECT a\.id, a\.password_hash/);
  const { response } = await call({ ...env, DB: broken }, '/sign-in', { method: 'POST', fields: wrong });
  assert.equal(response.status, 503);
  assert.deepEqual(rows(env.DB, 'SELECT hour, failed FROM sign_in_budget'), [{ hour, failed: 0 }]);
  assert.equal(count(env.DB, 'sign_in_failures'), 0);
  assert.equal(env.DB.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, 0);
  // A working one keeps all three.
  await call(env, '/sign-in', { method: 'POST', fields: wrong });
  assert.deepEqual(rows(env.DB, 'SELECT failed FROM sign_in_budget'), [{ failed: 1 }]);
  assert.equal(count(env.DB, 'sign_in_failures'), 1);
  assert.equal(env.DB.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, 1);
});

test('a burst at one address: of 12 tries at once, 10 are checked and recorded, and 2 are limited unchecked (criterion 3)', async (t) => {
  const checks = fastCheck(t);
  const db = d1();
  await account(db);
  const now = 1_790_000_000;
  const all = await Promise.all(Array.from({ length: 12 }, (_, i) => tryAs(slow(db), { address: `net-${i}`, now })));
  assert.deepEqual(all.map((r) => r.outcome).sort(), [...Array(10).fill('refused'), 'limited', 'limited'].sort());
  assert.ok(all.filter((r) => r.outcome === 'limited').every((r) => r.scope === 'email'));
  assert.equal(checks.mock.callCount(), EMAIL_FAILURE_LIMIT);
  assert.equal(count(db, 'sign_in_failures'), EMAIL_FAILURE_LIMIT);
  assert.equal(db.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, EMAIL_FAILURE_LIMIT);
  assert.deepEqual(rows(db, 'SELECT failed FROM sign_in_budget'), [{ failed: EMAIL_FAILURE_LIMIT }]);
});

test('a burst from one network: of 25 tries at once across addresses, 20 are checked and 5 limited unchecked (criterion 3)', async (t) => {
  const checks = fastCheck(t);
  const db = d1();
  const now = 1_790_000_000;
  const all = await Promise.all(Array.from({ length: 25 }, (_, i) => tryAs(slow(db), { email: `p${i}@example.org`, address: 'one-network', now })));
  assert.equal(all.filter((r) => r.outcome === 'refused').length, NETWORK_FAILURE_LIMIT);
  assert.equal(all.filter((r) => r.outcome === 'limited' && r.scope === 'network').length, 5);
  assert.equal(checks.mock.callCount(), NETWORK_FAILURE_LIMIT);
});

test('the 100th failure in a row is the last checked, whatever arrives at once (NIST 3.2.2)', async (t) => {
  const checks = fastCheck(t);
  const db = d1();
  await account(db, { failed: FAILED_IN_A_ROW - 2 });
  const now = 1_790_000_000;
  // Five at once from five networks: two land at 99 and 100 and are checked
  // against the real hash, three past the cap against the stand-in.
  await Promise.all(Array.from({ length: 5 }, (_, i) => tryAs(slow(db), { address: `n${i}`, now })));
  const real = checks.mock.calls.filter((c) => c.arguments[1] === KNOWN_HASH).length;
  assert.equal(real, 2);
  assert.equal(checks.mock.callCount(), 5);
  assert.equal(db.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, FAILED_IN_A_ROW + 3);
});

test('the failed tries\' rows hold keyed hashes, never the address or the network, and go after an hour', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  await call(env, '/sign-in', { method: 'POST', fields: { email: 'Jane@Example.org', password: 'wrong password, long enough' } });
  const [row] = rows(env.DB, 'SELECT * FROM sign_in_failures');
  assert.equal(row.email_hash, await emailHash(KEYS.ADDRESS_HASH_KEY, 'jane@example.org'));
  assert.equal(row.address_hash, await addressHash(KEYS.ADDRESS_HASH_KEY, new Request(SITE, { headers: { 'CF-Connecting-IP': IP } })));
  for (const value of Object.values(row)) assert.ok(!String(value).toLowerCase().includes('jane') && !String(value).includes(IP));
  // The admin home's clear deletes it once it is an hour old, and not before.
  await clearExpiredSignIns(env.DB, row.failed_at + FAILURE_WINDOW_SECONDS - 1);
  assert.equal(count(env.DB, 'sign_in_failures'), 1);
  await clearExpiredSignIns(env.DB, row.failed_at + FAILURE_WINDOW_SECONDS);
  assert.equal(count(env.DB, 'sign_in_failures'), 0);
});

test('a sign-in that succeeds forgets its address\'s failed tries and the count in a row; another address\'s stay', async (t) => {
  fastCheck(t);
  const db = d1();
  await account(db);
  const now = 1_790_000_000;
  for (let i = 0; i < 3; i += 1) await tryAs(db, { address: `n${i}`, now });
  await tryAs(db, { email: 'nobody@example.org', now });
  assert.equal(db.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, 3);
  assert.deepEqual(rows(db, 'SELECT failed FROM sign_in_budget'), [{ failed: 4 }]);
  assert.equal((await tryAs(db, { password: PASSWORD, now })).outcome, 'signed-in');
  assert.equal(db.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, 0);
  assert.equal(count(db, 'sign_in_failures'), 1, 'the other address\'s try went too');
  // The success's own unit of the hour came back: the budget counts failures.
  assert.deepEqual(rows(db, 'SELECT failed FROM sign_in_budget'), [{ failed: 4 }]);
});

test('after 100 failures in a row the right password is refused like any failure, until a new password is set (NIST 3.2.2)', async (t) => {
  fastCheck(t);
  const db = d1();
  const id = await account(db, { failed: FAILED_IN_A_ROW - 1 });
  const now = 1_790_000_000;
  // The 99th in a row still lets the right password in; the 100th failure stops it.
  await tryAs(db, { now });
  assert.equal(db.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, FAILED_IN_A_ROW);
  assert.deepEqual(await tryAs(db, { password: PASSWORD, address: 'n2', now: now + 1 }), { outcome: 'refused' });
  const { token } = await makeLink(db, id, now);
  assert.equal(await setPassword(db, { accountId: id, token, passwordHash: KNOWN_HASH, emailKey: 'k', now: now + 2 }), 2);
  assert.equal(db.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, 0);
  assert.equal((await tryAs(db, { password: PASSWORD, address: 'n3', now: now + 3 })).outcome, 'signed-in');
  assert.equal(FAILED_IN_A_ROW, 100);
  // The other side of the cap, on a fresh account (a sign-in resets the
  // count): at 99 in a row, the right password still signs in (#222's review).
  const fresh = d1();
  await account(fresh, { failed: FAILED_IN_A_ROW - 1 });
  assert.equal((await tryAs(fresh, { password: PASSWORD, now })).outcome, 'signed-in');
  assert.equal(fresh.sqlite.prepare('SELECT failed_sign_ins FROM accounts').get().failed_sign_ins, 0);
});

test('the route says how long to wait: 429 with Retry-After, and a message for an address, a network or the site', async (t) => {
  fastCheck(t);
  const env = site();
  await account(env.DB);
  const wrong = { email: 'jane@example.org', password: 'wrong password, long enough' };
  for (let i = 0; i < EMAIL_FAILURE_LIMIT; i += 1) await call(env, '/sign-in', { method: 'POST', fields: wrong, ip: `198.51.100.${i}` });
  const { response, html } = await call(env, '/sign-in', { method: 'POST', fields: wrong, ip: '198.51.100.200' });
  assert.equal(response.status, 429);
  assert.match(response.headers.get('Retry-After'), /^\d+$/);
  assert.ok(html.includes(`There have been ${EMAIL_FAILURE_LIMIT} failed sign-ins for this email address in the last hour`));
  assert.ok(html.includes('value="jane@example.org"'));
  assert.ok(!html.includes('wrong password'), 'the page echoed the password');
});

// ---- The sign-in route's other answers ----------------------------------------

test('POST /sign-in from another site, or with no Origin, is refused 403 before anything is read', async () => {
  for (const origin of [null, 'https://evil.example', 'https://madcowsailing.com']) {
    const env = site();
    await account(env.DB);
    const before = env.DB.statements.length;
    const { response } = await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane@example.org', password: PASSWORD }, origin });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'origin' });
    assert.equal(env.DB.statements.length, before);
  }
});

test('an empty field is a 400 naming it, before the database is asked; a missing binding or secret is a 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const before = env.DB.statements.length;
  const { response, html } = await call(env, '/sign-in', { method: 'POST', fields: { email: ' ', password: '' } });
  assert.equal(response.status, 400);
  assert.ok(html.includes('Enter your email address.') && html.includes('Enter your password.'));
  assert.equal(env.DB.statements.length, before);
  for (const name of ['DB', 'SESSION_SIGNING_KEY', 'ADDRESS_HASH_KEY']) {
    assert.equal((await call(site({ [name]: undefined }), '/sign-in')).response.status, 503, name);
    assert.equal((await call(site({ [name]: undefined }), '/sign-in', { method: 'POST', fields: { email: 'a@b.c', password: 'x' } })).response.status, 503, name);
  }
});

test('GET /sign-in is the form: the address and password fields as password managers expect, no Turnstile, the site\'s CSP', async () => {
  const { response, html } = await call(site(), '/sign-in');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Security-Policy'), SITE_HEADERS['Content-Security-Policy']);
  assert.match(html, /<form method="post" action="\/sign-in" class="ask-form">/);
  assert.match(html, /name="email" type="email" autocomplete="username"/);
  assert.match(html, /name="password" type="password" autocomplete="current-password"/);
  assert.match(html, /<a href="\/forgot-password">Forgot your password\?<\/a>/);
  assert.doesNotMatch(html, /cf-turnstile|ask\.js/);
  // After a sign-out, it says so.
  assert.match((await call(site(), '/sign-in?signed-out')).html, /<p role="status">You are signed out, on every phone and computer that was signed in to your account\.<\/p>/);
});

// ---- Criterion 7: sign out ------------------------------------------------------

test('sign out deletes the cookie and ends that session, and every other one on the account (criterion 7)', async () => {
  const env = site();
  const id = await account(env.DB);
  const now = nowSeconds();
  const phone = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, now);
  const laptop = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, now - 600);
  const { response } = await call(env, '/sign-out', { method: 'POST', cookie: phone });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/sign-in?signed-out');
  assert.equal(response.headers.get('Set-Cookie'), `${ACCOUNT_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
  for (const cookie of [phone, laptop]) {
    const page = await call(env, '/account', { cookie });
    assert.equal(page.response.status, 303, 'a session survived the sign-out');
  }
});

test('sign out with no session that holds deletes the cookie and writes nothing; from another site it is refused', async () => {
  const env = site();
  await account(env.DB);
  const before = snapshot(env.DB);
  for (const cookie of [undefined, 'garbage', await signAccountSession('another key', { accountId: 1, version: 1 }, nowSeconds())]) {
    const { response } = await call(env, '/sign-out', { method: 'POST', cookie });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  }
  assert.deepEqual(snapshot(env.DB), before);
  const valid = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 1, version: 1 }, nowSeconds());
  const foreign = await call(env, '/sign-out', { method: 'POST', cookie: valid, origin: 'https://evil.example' });
  assert.equal(foreign.response.status, 403);
  assert.deepEqual(snapshot(env.DB), before);
});

test('sign out with no signing key or database configured ends nothing, keeps the cookie and says so (#222\'s review)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const id = await account(env.DB);
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  for (const missing of ['SESSION_SIGNING_KEY', 'DB']) {
    const { response, html } = await call({ ...env, [missing]: undefined }, '/sign-out', { method: 'POST', cookie });
    assert.equal(response.status, 503, missing);
    assert.equal(response.headers.get('Set-Cookie'), null, missing);
    assert.match(html, /<h1>Not signed out<\/h1>/);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT session_version FROM accounts').get().session_version, 1);
});

test('sign out when the database does not answer keeps the cookie and says so, so the button still works', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const broken = { ...env.DB, prepare: () => { throw new Error('D1 down'); } };
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 1, version: 1 }, nowSeconds());
  const { response, html } = await call({ ...env, DB: broken }, '/sign-out', { method: 'POST', cookie });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.match(html, /<h1>Not signed out<\/h1>/);
});

test('/account holds Sign out as a post to /sign-out, and says sending from an account is not open yet', async () => {
  const env = site();
  const id = await account(env.DB, { teams: ['hoover-jrt', 'cohssa'] });
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  const { html } = await call(env, '/account?password-set', { cookie });
  assert.match(html, /<form method="post" action="\/sign-out" class="ask-form">/);
  assert.match(html, /approved for Hoover JRT and COHSSA\./);
  assert.match(html, /Sending photos from your account isn't open yet\./);
  assert.match(html, /<p role="status">Your password is set, and you are signed in\./);
});

// ---- Criteria 1, 4, 5: setting a password with a link ---------------------------

async function linked(env, { teams = ['cohssa'], hash = null, seconds } = {}) {
  const id = await account(env.DB, { teams, hash });
  const { token, expiresAt } = await makeLink(env.DB, id, nowSeconds(), seconds ? { seconds } : undefined);
  return { id, token, expiresAt };
}

const setFields = (token, password = PASSWORD, confirm = password) => ({ token, password, confirm });

test('POST /set-password stores the hash, uses up every link the account holds, ends other sessions and signs this browser in', async () => {
  const env = site();
  const { id, token } = await linked(env);
  const other = await makeLink(env.DB, id, nowSeconds());
  const before = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  const { response } = await call(env, '/set-password', { method: 'POST', fields: setFields(token) });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/account?password-set');
  const stored = env.DB.sqlite.prepare('SELECT password_hash, session_version FROM accounts WHERE id = ?').get(id);
  assert.match(stored.password_hash, /^\$scrypt\$ln=14,r=8,p=5\$/);
  assert.equal(await verifyPassword(PASSWORD, stored.password_hash), true);
  assert.equal(stored.session_version, 2);
  assert.equal(count(env.DB, 'password_links'), 0, `a link survived (${other.token.slice(0, 4)})`);
  // The new cookie opens /account; the session from before does not.
  assert.equal((await call(env, '/account', { cookie: cookieOf(response) })).response.status, 200);
  assert.equal((await call(env, '/account', { cookie: before })).response.status, 303);
  // The link is used up: a second post, and the page, answer 404.
  assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(token) })).response.status, 404);
  assert.equal((await call(env, `/set-password?token=${token}`)).response.status, 404);
  // And the password signs in.
  assert.equal((await call(env, '/sign-in', { method: 'POST', fields: { email: 'jane@example.org', password: PASSWORD } })).response.status, 303);
});

test('a password the rules turn down is a 400 naming the reason, and nothing is written', async () => {
  for (const [fields, message] of [
    [setFields('', 'x'.repeat(14)), MESSAGES.short],
    [setFields('', PASSWORD, `${PASSWORD}!`), MESSAGES.confirm],
    [setFields('', 'jane@example.org.long'), null],
    [setFields('', 'Mad Cow Sailing photos'), MESSAGES.context],
  ]) {
    const env = site();
    const { token } = await linked(env);
    const before = snapshot(env.DB);
    const { response, html } = await call(env, '/set-password', { method: 'POST', fields: { ...fields, token } });
    if (message === null) { assert.equal(response.status, 303); continue; }
    assert.equal(response.status, 400, message);
    assert.ok(html.includes(message.replace(/'/g, '&#39;')), message);
    assert.ok(html.includes(`value="${token}"`), 'the form lost its token');
    // Neither password field is filled back in. (The text itself can be on
    // the page anyway: "Mad Cow Sailing photos" is every title's.)
    assert.equal((html.match(/<input [^>]*type="password"[^>]*>/g) ?? []).length, 2);
    assert.doesNotMatch(html, /<input [^>]*type="password"[^>]* value=/);
    assert.deepEqual(snapshot(env.DB), before, message);
  }
});

test('a password too long for the form\'s usual size is told it is too long, not shown the dead-link page (#222\'s review)', async () => {
  const env = site();
  const { token } = await linked(env);
  // 700 characters of two encoded bytes each, twice: past 8 KiB encoded.
  const long = 'é'.repeat(700);
  const { response, html } = await call(env, '/set-password', { method: 'POST', fields: setFields(token, long) });
  assert.ok(encode(setFields(token, long)).length > 8 * 1024, 'the body is not past 8 KiB');
  assert.equal(response.status, 400);
  assert.ok(html.includes(MESSAGES.long));
  assert.ok(html.includes(`value="${token}"`));
});

test('a breached password is a 400 with the reason; Pwned Passwords not answering lets it through (the owner\'s fail-open)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const { token } = await linked(env);
  const suffix = sha1(PASSWORD).slice(5);
  pwnedAnswer = () => new Response(`${suffix}:52\r\n`);
  const refused = await call(env, '/set-password', { method: 'POST', fields: setFields(token) });
  assert.equal(refused.response.status, 400);
  assert.ok(refused.html.includes('This password has appeared in a data breach elsewhere'));
  assert.equal(env.DB.sqlite.prepare('SELECT password_hash FROM accounts').get().password_hash, null);
  pwnedAnswer = () => new Response('down', { status: 500 });
  const passed = await call(env, '/set-password', { method: 'POST', fields: setFields(token) });
  assert.equal(passed.response.status, 303);
  // Only the first 5 characters of its SHA-1 went out, each time.
  assert.deepEqual(ranges.map((r) => r.prefix), [sha1(PASSWORD).slice(0, 5), sha1(PASSWORD).slice(0, 5)]);
});

// A D1 whose every statement and batch waits a macrotask before it runs, as a
// real D1 call is I/O: two calls in flight interleave between statements, and
// work a route leaves to waitUntil cannot run ahead of its answer. The plain
// stand-in settles in microtasks (cairn:
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

test('two posts of one link at once: the first sets the password, the second changes nothing and answers 404', async () => {
  const env = site();
  const { id, token } = await linked(env);
  const both = await Promise.all([1, 2].map(() => call({ ...env, DB: slow(env.DB) }, '/set-password', { method: 'POST', fields: setFields(token) })));
  assert.deepEqual(both.map(({ response }) => response.status).sort(), [303, 404]);
  assert.equal(env.DB.sqlite.prepare('SELECT session_version FROM accounts WHERE id = ?').get(id).session_version, 2);
});

test('setPassword holds only while the link is the account\'s, unexpired, and the account approved: otherwise null, and nothing changes', async () => {
  const db = d1();
  const jane = await account(db, { hash: null });
  const sam = await account(db, { email: 'sam@example.org', hash: null });
  const now = nowSeconds();
  const janes = await makeLink(db, jane, now);
  const sams = await makeLink(db, sam, now);
  // A failed try under the key the calls below pass, so a stale use that
  // forgot it would show in the snapshot.
  db.sqlite.prepare('INSERT INTO sign_in_failures (email_hash, address_hash, failed_at) VALUES (?, ?, ?)').run('k', 'net', now);
  const before = snapshot(db);
  // Jane's link for Sam's account; an expired link; a link never made.
  assert.equal(await setPassword(db, { accountId: sam, token: janes.token, passwordHash: KNOWN_HASH, emailKey: 'k', now }), null);
  assert.equal(await setPassword(db, { accountId: jane, token: janes.token, passwordHash: KNOWN_HASH, emailKey: 'k', now: now + 7 * 24 * 3600 }), null);
  assert.equal(await setPassword(db, { accountId: jane, token: 'Q'.repeat(43), passwordHash: KNOWN_HASH, emailKey: 'k', now }), null);
  // Jane no longer approved.
  db.sqlite.prepare("UPDATE account_teams SET state = 'revoked' WHERE account_id = ?").run(jane);
  assert.equal(await setPassword(db, { accountId: jane, token: janes.token, passwordHash: KNOWN_HASH, emailKey: 'k', now }), null);
  db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = ?").run(jane);
  assert.deepEqual(snapshot(db), before);
  // Sam's own link still works, and leaves Jane's alone.
  assert.equal(await setPassword(db, { accountId: sam, token: sams.token, passwordHash: KNOWN_HASH, emailKey: 'k', now }), 2);
  assert.deepEqual(rows(db, 'SELECT account_id FROM password_links').map((r) => r.account_id), [jane]);
});

test('setting a password forgets that address\'s failed sign-ins, and only that address\'s', async (t) => {
  fastCheck(t);
  const db = d1();
  const id = await account(db);
  const now = nowSeconds();
  await tryAs(db, { now });
  await tryAs(db, { email: 'nobody@example.org', now });
  const { token } = await makeLink(db, id, now);
  await setPassword(db, { accountId: id, token, passwordHash: KNOWN_HASH, emailKey: await emailHash(KEYS.ADDRESS_HASH_KEY, 'jane@example.org'), now });
  assert.deepEqual(rows(db, 'SELECT email_hash FROM sign_in_failures'), [{ email_hash: await emailHash(KEYS.ADDRESS_HASH_KEY, 'nobody@example.org') }]);
});

test('POST /set-password from another site is refused; a token of the wrong shape is a 404 before the database is asked', async () => {
  const env = site();
  const { token } = await linked(env);
  assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(token), origin: 'https://evil.example' })).response.status, 403);
  const before = env.DB.statements.length;
  assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields('short') })).response.status, 404);
  assert.equal(env.DB.statements.length, before);
});

// ---- Criterion 5: the reset ---------------------------------------------------

const resetFields = (email) => ({ email, [TOKEN_FIELD]: TURNSTILE });

test('a reset answers the same whether or not the address has an account: one 303, after the same statements (criterion 5)', async () => {
  const answers = {};
  for (const [name, seed] of Object.entries({
    'an approved account': (db) => account(db),
    'no account': async () => null,
    'an account not approved': (db) => account(db, { approved: false }),
  })) {
    const env = site();
    await seed(env.DB);
    const before = env.DB.statements.length;
    // Resend holds its answer, so the page has answered while the email is
    // still on its way: the answer does not wait for it. Each statement is
    // I/O, as on D1, so the email's work cannot run ahead of the answer; the
    // email's first lookup is prepared before the answer, in every case.
    let release;
    resendGate = new Promise((resolve) => { release = resolve; });
    const { response, later } = await call({ ...env, DB: slow(env.DB) }, '/forgot-password', { method: 'POST', fields: resetFields('jane@example.org') });
    answers[name] = {
      status: response.status,
      location: response.headers.get('Location'),
      headers: [...response.headers].filter(([h]) => h !== 'date'),
      statements: env.DB.statements.slice(before),
    };
    release();
    await Promise.all(later);
    answers[name].sent = sends.length;
    sends = [];
  }
  const [first, ...rest] = Object.values(answers);
  assert.equal(first.status, 303);
  assert.equal(first.location, '/forgot-password?sent');
  for (const [name, answer] of Object.entries(answers)) {
    const { sent, ...shown } = answer;
    const { sent: _, ...firstShown } = first;
    assert.deepEqual(shown, firstShown, `${name} answered differently`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(answers).map(([n, a]) => [n, a.sent])), { 'an approved account': 1, 'no account': 0, 'an account not approved': 0 });
  assert.equal(rest.length, 2);
});

test('the reset email carries a link that works once, for an hour, and sets a new password whether or not there was one (criterion 5)', async () => {
  for (const hash of [KNOWN_HASH, null]) {
    sends = [];
    const env = site();
    const id = await account(env.DB, { hash });
    const now = nowSeconds();
    assert.equal(await sendReset(env, { email: 'jane@example.org', now, site: SITE }), 'sent');
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0].to, ['jane@example.org']);
    assert.match(sends[0].subject, /Reset your password/);
    const link = new URL(sends[0].text.match(/https:\/\/\S+/)[0]);
    assert.equal(link.pathname, '/set-password');
    const row = env.DB.sqlite.prepare('SELECT * FROM password_links WHERE account_id = ?').get(id);
    assert.equal(row.expires_at - row.made_at, RESET_SECONDS);
    assert.equal(row.token_hash, await tokenHash(link.searchParams.get('token')));
    const page = await call(env, `/set-password${link.search}`);
    assert.equal(page.response.status, 200);
    assert.match(page.html, hash ? /<h1>Choose a new password<\/h1>/ : /<h1>Choose a password<\/h1>/);
    const token = link.searchParams.get('token');
    const newPassword = 'a completely different passphrase';
    assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(token, newPassword) })).response.status, 303);
    assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(token, newPassword) })).response.status, 404);
    assert.equal(await verifyPassword(newPassword, env.DB.sqlite.prepare('SELECT password_hash FROM accounts').get().password_hash), true);
  }
  assert.equal(RESET_SECONDS, 60 * 60);
});

test('a reset link runs out after its hour', async () => {
  const env = site();
  const id = await account(env.DB);
  const now = nowSeconds();
  const { token } = await makeLink(env.DB, id, now - RESET_SECONDS, { seconds: RESET_SECONDS });
  assert.equal((await call(env, `/set-password?token=${token}`)).response.status, 404);
  const fresh = await makeLink(env.DB, id, now - RESET_SECONDS + 5, { seconds: RESET_SECONDS });
  assert.equal((await call(env, `/set-password?token=${fresh.token}`)).response.status, 200);
});

test('a reset does not replace the approval link the person holds; setting a password with either ends both', async () => {
  const env = site();
  const id = await account(env.DB, { hash: null });
  const now = nowSeconds();
  const approval = await makeLink(env.DB, id, now - 7200);
  assert.equal(await sendReset(env, { email: 'jane@example.org', now, site: SITE }), 'sent');
  const reset = new URL(sends[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  assert.equal(count(env.DB, 'password_links'), 2);
  assert.equal((await call(env, `/set-password?token=${approval.token}`)).response.status, 200);
  assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(reset) })).response.status, 303);
  assert.equal((await call(env, `/set-password?token=${approval.token}`)).response.status, 404);
});

test('one reset email per account every 15 minutes, and 20 a day for the whole site (criterion 5; the owner\'s choice at pickup)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  const day = Math.floor(nowSeconds() / 86400) * 86400;
  assert.equal(await sendReset(env, { email: 'jane@example.org', now: day + 100, site: SITE }), 'sent');
  assert.equal(await sendReset(env, { email: 'jane@example.org', now: day + 100 + RESET_GAP_SECONDS - 1, site: SITE }), 'recent');
  assert.equal(await sendReset(env, { email: 'jane@example.org', now: day + 100 + RESET_GAP_SECONDS, site: SITE }), 'sent');
  assert.equal(RESET_GAP_SECONDS, 15 * 60);
  for (let i = 2; i < RESET_EMAILS_PER_DAY; i += 1) {
    await account(env.DB, { email: `p${i}@example.org` });
    assert.equal(await sendReset(env, { email: `p${i}@example.org`, now: day + 2000, site: SITE }), 'sent', `reset ${i + 1}`);
  }
  await account(env.DB, { email: 'one.more@example.org' });
  const before = count(env.DB, 'password_links');
  assert.equal(await sendReset(env, { email: 'one.more@example.org', now: day + 3000, site: SITE }), 'budget');
  assert.equal(count(env.DB, 'password_links'), before, 'a link was made past the day\'s budget');
  assert.equal(sends.length, RESET_EMAILS_PER_DAY);
  // The next UTC day sends again.
  assert.equal(await sendReset(env, { email: 'one.more@example.org', now: day + 86400, site: SITE }), 'sent');
  assert.equal(RESET_EMAILS_PER_DAY, 20);
});

test('a reset Resend refused deletes its link and gives the day\'s unit back; one it did not confirm keeps both', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  const now = nowSeconds();
  resend = () => Response.json({ name: 'daily_quota_exceeded', message: 'quota' }, { status: 429 });
  assert.equal(await sendReset(env, { email: 'jane@example.org', now, site: SITE }), 'quota');
  assert.equal(count(env.DB, 'password_links'), 0);
  assert.deepEqual(rows(env.DB, 'SELECT sent FROM reset_mail_budget'), [{ sent: 0 }]);
  resend = () => { throw new TypeError('network down'); };
  assert.equal(await sendReset(env, { email: 'jane@example.org', now, site: SITE }), 'unreachable');
  assert.equal(count(env.DB, 'password_links'), 1);
  assert.deepEqual(rows(env.DB, 'SELECT sent FROM reset_mail_budget'), [{ sent: 1 }]);
});

test('resets sent at once for one account: the link\'s own insert carries the 15-minute gap, so one is sent (#222\'s review)', async () => {
  const env = site();
  await account(env.DB);
  const now = nowSeconds();
  const all = await Promise.all([1, 2, 3].map(() => sendReset({ ...env, DB: slow(env.DB) }, { email: 'jane@example.org', now, site: SITE })));
  assert.deepEqual(all.sort(), ['recent', 'recent', 'sent']);
  assert.equal(sends.length, 1);
  assert.equal(count(env.DB, 'password_links'), 1);
  assert.deepEqual(rows(env.DB, 'SELECT sent FROM reset_mail_budget'), [{ sent: 1 }]);
});

test('a reset link that could not be stored spends none of the day\'s 20, and sends nothing (#222\'s review)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  await account(env.DB);
  const broken = failOn(env.DB, /^INSERT INTO password_links/);
  assert.equal(await sendReset({ ...env, DB: broken }, { email: 'jane@example.org', now: nowSeconds(), site: SITE }), 'unsaved');
  assert.equal(count(env.DB, 'password_links'), 0);
  assert.equal(count(env.DB, 'reset_mail_budget'), 0);
  assert.equal(sends.length, 0);
});

test('a used link ends the gap: having set a password, a person can ask for another reset at once', async () => {
  const env = site();
  await account(env.DB);
  const now = nowSeconds();
  assert.equal(await sendReset(env, { email: 'jane@example.org', now, site: SITE }), 'sent');
  const token = new URL(sends[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  assert.equal((await call(env, '/set-password', { method: 'POST', fields: setFields(token) })).response.status, 303);
  assert.equal(await sendReset(env, { email: 'jane@example.org', now: now + 60, site: SITE }), 'sent');
});

test('an admin\'s new link, once its email goes, replaces a pending reset link too, and itself sets a password', async () => {
  const env = site();
  const id = await account(env.DB, { hash: null });
  const now = nowSeconds();
  assert.equal(await sendReset(env, { email: 'jane@example.org', now, site: SITE }), 'sent');
  const reset = new URL(sends[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  assert.equal(await sendLink(env, { accountId: id, admin: 'owner@example.com', now: now + 5, site: SITE }), 'sent');
  const approval = new URL(sends[1].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  assert.equal((await call(env, `/set-password?token=${reset}`)).response.status, 404);
  assert.equal((await call(env, `/set-password?token=${approval}`)).response.status, 200);
});

test('the reset form: Turnstile first, then the address, then 10 requests an hour from one network', async () => {
  const env = site();
  await account(env.DB);
  siteverify = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  const before = snapshot(env.DB);
  const refused = await call(env, '/forgot-password', { method: 'POST', fields: resetFields('jane@example.org') });
  assert.equal(refused.response.status, 403);
  assert.deepEqual(snapshot(env.DB), before);
  // The order: a request failing both checks is answered on Turnstile's, so
  // the address is never read for one no person sent (#222's review).
  const both = await call(env, '/forgot-password', { method: 'POST', fields: resetFields('not an address') });
  assert.equal(both.response.status, 403);
  assert.ok(both.html.includes('The check that you are a person did not pass.'));
  siteverify = () => Response.json({ success: true, 'error-codes': [] });
  assert.equal((await call(env, '/forgot-password', { method: 'POST', fields: resetFields('not an address') })).response.status, 400);
  for (let i = 0; i < RESET_REQUEST_LIMIT; i += 1) {
    const { response, later } = await call(env, '/forgot-password', { method: 'POST', fields: resetFields(`p${i}@example.org`) });
    assert.equal(response.status, 303);
    await Promise.all(later);
  }
  const { response, html } = await call(env, '/forgot-password', { method: 'POST', fields: resetFields('jane@example.org') });
  assert.equal(response.status, 429);
  assert.match(response.headers.get('Retry-After'), /^\d+$/);
  assert.ok(html.includes(`This network has asked for ${RESET_REQUEST_LIMIT} password resets in the last hour`));
  // Another network is not counted with it.
  assert.equal((await call(env, '/forgot-password', { method: 'POST', fields: resetFields('jane@example.org'), ip: '198.51.100.9' })).response.status, 303);
  assert.equal(await claimResetRequest(env.DB, 'net-x', nowSeconds()), null);
});

test('a reset request\'s scrambled network address is kept an hour, and the next claim or clear deletes it after that', async () => {
  const db = d1();
  const at = 1_790_000_000;
  assert.equal(await claimResetRequest(db, 'net-a', at), null);
  await clearExpiredResetRequests(db, at + RESET_REQUEST_WINDOW_SECONDS - 1);
  assert.equal(count(db, 'reset_request_log'), 1);
  await clearExpiredResetRequests(db, at + RESET_REQUEST_WINDOW_SECONDS);
  assert.equal(count(db, 'reset_request_log'), 0);
  // A claim clears too: an hour on, another network's claim deletes it.
  assert.equal(await claimResetRequest(db, 'net-a', at), null);
  assert.equal(await claimResetRequest(db, 'net-b', at + RESET_REQUEST_WINDOW_SECONDS), null);
  assert.deepEqual(rows(db, 'SELECT address_hash FROM reset_request_log'), [{ address_hash: 'net-b' }]);
  assert.equal(RESET_REQUEST_WINDOW_SECONDS, 60 * 60);
});

test('GET /forgot-password is the form, with Turnstile\'s widget and /ask\'s script, under the CSP that admits it', async () => {
  const { response, html } = await call(site(), '/forgot-password');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Security-Policy'), TURNSTILE_CSP);
  assert.match(html, /<form method="post" action="\/forgot-password" class="ask-form">/);
  assert.match(html, new RegExp(`data-sitekey="${KEYS.TURNSTILE_SITE_KEY}"`));
  assert.match(html, /<script src="\/js\/ask\.js\?v=[0-9a-f]{10}" defer><\/script>/);
  const sent = await call(site(), '/forgot-password?sent');
  assert.match(sent.html, /<h1>Check your email<\/h1>/);
  assert.match(sent.html, /No email comes for an address with no account/);
});

// ---- Criterion 6: nothing logs a password, token, hash or address ---------------

const PLANTED = Object.freeze({
  password: 'Planted Password Value 2026',
  email: 'planted.person@example.org',
  name: 'Planted Person',
  ip: '198.51.100.77',
});

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

/** Every console line `run` writes, each argument rendered as it would print. */
async function logsOf(run) {
  const lines = [];
  const render = (arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}\n${arg.stack}`
    : typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg));
  const mocks = CONSOLE.map((method) => mock.method(console, method, (...args) => { lines.push(args.map(render).join(' ')); }));
  try {
    await run();
  } finally {
    for (const fn of mocks) fn.mock.restore();
  }
  return lines;
}

test('the leak detector finds a planted value in a log line, so a clean run below is a reading', async () => {
  const lines = await logsOf(() => {
    console.error('sign-in failed with', PLANTED.password);
    console.warn(new Error(`for ${PLANTED.email}`));
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes(PLANTED.password) && lines[1].includes(PLANTED.email));
});

test('no route or rule logs a password, a token, a hash or an address, through every answer including failures (criterion 6)', async () => {
  const env = site({ RESEND_API_KEY: undefined });
  const id = await account(env.DB, { email: PLANTED.email, name: PLANTED.name, hash: await hashPassword(PLANTED.password) });
  const link = await makeLink(env.DB, id, nowSeconds());
  const stored = env.DB.sqlite.prepare('SELECT password_hash FROM accounts').get().password_hash;
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  const broken = { ...env.DB, prepare: () => { throw new Error('D1 down'); }, batch: async () => { throw new Error('D1 down'); } };
  const fields = { email: PLANTED.email, password: PLANTED.password };
  const lines = await logsOf(async () => {
    const runs = [
      () => call(env, '/sign-in', { method: 'POST', fields, ip: PLANTED.ip }),
      () => call(env, '/sign-in', { method: 'POST', fields: { ...fields, password: 'wrong planted password' }, ip: PLANTED.ip }),
      () => call({ ...env, DB: broken }, '/sign-in', { method: 'POST', fields, ip: PLANTED.ip }),
      () => call({ ...env, DB: broken }, '/sign-out', { method: 'POST', cookie }),
      () => call({ ...env, DB: broken }, '/account', { cookie }),
      () => call({ ...env, DB: broken }, `/set-password?token=${link.token}`),
      () => call({ ...env, DB: broken }, '/forgot-password', { method: 'POST', fields: resetFields(PLANTED.email), ip: PLANTED.ip }),
      async () => { pwnedAnswer = () => { throw new TypeError(`fetch failed for ${PLANTED.password}`); }; },
      () => call(env, '/set-password', { method: 'POST', fields: setFields(link.token, PLANTED.password), ip: PLANTED.ip }),
      // No Resend key: the reset's send is refused as not configured, and logged.
      () => call(env, '/forgot-password', { method: 'POST', fields: resetFields(PLANTED.email), ip: PLANTED.ip }),
      () => call(site({ DB: undefined }), '/sign-in'),
      () => sendReset({ DB: broken }, { email: PLANTED.email, now: nowSeconds(), site: SITE }),
    ];
    for (const run of runs) {
      const result = await run();
      if (result?.later) await Promise.all(result.later);
    }
  });
  assert.ok(lines.length >= 8, `only ${lines.length} lines logged: is the capture working?`);
  const needles = [
    PLANTED.password, 'planted password', PLANTED.email, 'planted.person', PLANTED.name, PLANTED.ip,
    link.token, await tokenHash(link.token), stored, stored.split('$')[4], stored.split('$')[3],
    await emailHash(KEYS.ADDRESS_HASH_KEY, PLANTED.email),
    await addressHash(KEYS.ADDRESS_HASH_KEY, new Request(SITE, { headers: { 'CF-Connecting-IP': PLANTED.ip } })),
    `range/${sha1(PLANTED.password).slice(0, 5)}`, sha1(PLANTED.password).slice(5),
    cookie, cookie.split('.').pop(),
  ];
  for (const line of lines) {
    for (const needle of needles) assert.ok(!line.toLowerCase().includes(needle.toLowerCase()), `logged ${needle}: ${line}`);
  }
});

// ---- Every page passes the site's own validator -----------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const problems = async (html) => (await validator.validateString(html, join(ROOT, 'public.html')))
  .results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

test('every page and every refusal passes the photo site\'s html-validate config, which can fail them', async (t) => {
  t.mock.method(console, 'error', () => {});
  fastCheck(t);
  const env = site();
  const id = await account(env.DB);
  const { token } = await makeLink(env.DB, id, nowSeconds());
  const cookie = await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: id, version: 1 }, nowSeconds());
  const pages = {
    'sign-in': (await call(env, '/sign-in')).html,
    'signed out': (await call(env, '/sign-in?signed-out')).html,
    'sign-in refused': (await call(env, '/sign-in', { method: 'POST', fields: { email: 'x@example.org', password: 'nope nope nope' } })).html,
    'sign-in empty': (await call(env, '/sign-in', { method: 'POST', fields: { email: '', password: '' } })).html,
    'sign-in closed': (await call(site({ DB: undefined }), '/sign-in')).html,
    forgot: (await call(env, '/forgot-password')).html,
    'forgot sent': (await call(env, '/forgot-password?sent')).html,
    'forgot bad address': (await call(env, '/forgot-password', { method: 'POST', fields: resetFields('nope') })).html,
    'set-password': (await call(env, `/set-password?token=${token}`)).html,
    'set-password refused': (await call(env, '/set-password', { method: 'POST', fields: setFields(token, 'short', 'other') })).html,
    account: (await call(env, '/account?password-set', { cookie })).html,
  };
  siteverify = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  pages['forgot turnstile'] = (await call(env, '/forgot-password', { method: 'POST', fields: resetFields('jane@example.org') })).html;
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.length > 500, name);
    assert.deepEqual(await problems(html), [], name);
  }
  assert.notDeepEqual(await problems(pages['sign-in'].replace('<h1>', '<h1>Planted</h1><h1>')), []);
});

// ---- Migration 0009 ------------------------------------------------------------------

test('migration 0009 is additive: columns added with defaults, tables and indexes made, nothing dropped or rewritten', () => {
  const sql = readFileSync(join(ROOT, 'migrations', '0009_sign_in.sql'), 'utf8')
    .replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of sql) {
    assert.match(statement, /^(ALTER TABLE accounts ADD COLUMN|CREATE TABLE|CREATE INDEX)\b/, statement);
  }
  assert.equal(sql.filter((s) => s.startsWith('ALTER')).length, 3);
  // Every account 0007 made reads as one with no password, version 1 and no
  // failures, so an approved person's first sign-in waits for their link.
  const db = d1();
  db.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('a@b.c', 'A', 'parent', 1)").run();
  assert.deepEqual({ ...db.sqlite.prepare('SELECT password_hash, session_version, failed_sign_ins FROM accounts').get() }, { password_hash: null, session_version: 1, failed_sign_ins: 0 });
});

// The cookie line itself, held to the attributes criterion 4 names.
test('the cookie line is __Host-, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, Max-Age 90 days', async () => {
  const line = await accountCookie(KEYS.SESSION_SIGNING_KEY, { accountId: 3, version: 2 }, 1_790_000_000);
  assert.equal(line, `${ACCOUNT_COOKIE}=${await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 3, version: 2 }, 1_790_000_000)}; Max-Age=7776000; Path=/; Secure; HttpOnly; SameSite=Lax`);
  assert.ok(ACCOUNT_COOKIE.startsWith('__Host-'));
  assert.doesNotMatch(line, /Domain=/i);
});
