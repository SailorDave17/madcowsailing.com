// /ask, the request form (#220), through the root middleware as Pages runs
// it: the page, each answer a request can get, what each leaves in the
// database, and what is logged. The rules behind it are test/accounts.test.js's
// and Turnstile's check is test/turnstile.test.js's.
//
// fetch is stood in for: siteverify's URL answers whatever `siteverify`
// returns, Resend's whatever `resend` does, and any other URL throws.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import * as route from '../functions/ask.js';
import { ASK_FORM_BYTES, NAME_MAX, NOTE_MAX, REQUEST_BUDGET_PER_HOUR, REQUEST_LIMIT } from '../lib/accounts.js';
import { addressHash } from '../lib/address.js';
import { ASK_SCRIPT, TURNSTILE_SCRIPT } from '../lib/ask-page.js';
import { MAX_FORM_BYTES } from '../lib/form.js';
import { SITE_HEADERS, TURNSTILE_CSP } from '../lib/headers.js';
import { RESEND_URL } from '../lib/mail.js';
import { HTML_CACHE } from '../lib/public-page.js';
import { SITEVERIFY_URL, TOKEN_FIELD } from '../lib/turnstile.js';
import { approveTeams, deleteAccount, revokeTeams } from '../lib/people.js';
import { seedAdmin } from './admin.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const IP = '203.0.113.7';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const KEYS = {
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
  TURNSTILE_SITE_KEY: '0x4AAAAAAA-test-site-key',
  TURNSTILE_SECRET_KEY: 'turnstile-secret-for-tests',
};

let siteverify; // (body) => the Response siteverify answers
let verified; // every body sent to siteverify
let sends; // every message sent to Resend
let resendGate; // when set, Resend answers only once this promise settles

beforeEach(() => {
  verified = [];
  sends = [];
  resendGate = null;
  siteverify = () => Response.json({ success: true, 'error-codes': [], hostname: 'photos.madcowsailing.com' });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === SITEVERIFY_URL) {
      const body = JSON.parse(init.body);
      verified.push(body);
      return siteverify(body);
    }
    if (url === RESEND_URL) {
      sends.push(JSON.parse(init.body));
      if (resendGate) await resendGate;
      return Response.json({ id: 'msg-220' });
    }
    throw new Error(`fetched ${url}`);
  });
});
afterEach(() => mock.restoreAll());

// No admin unless a test seeds one: since #224 the admins' email goes to the
// accounts holding the admin role (lib/accounts.js, adminAddresses), where it
// went to the ADMIN_EMAILS secret before.
const site = (extra = {}) => ({
  DB: d1(), SITE_ENV: 'preview', RESEND_API_KEY: 'test-key-not-real', ...KEYS, ...extra,
});

const GOOD = Object.freeze({
  name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', team: ['hoover-jrt'], note: '', [TOKEN_FIELD]: TOKEN,
});

const encode = (fields) => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) for (const one of [].concat(value)) params.append(name, one);
  return params.toString();
};

/**
 * One request to /ask through the root middleware. Returns the response and
 * the work the route left for after it (waitUntil).
 */
async function call(env, { method = 'GET', path = '/ask', fields = GOOD, origin = SITE, ip = IP } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  let body;
  if (method === 'POST') {
    if (origin) headers.Origin = origin;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encode(fields);
  }
  const request = new Request(`${SITE}${path}`, { method, headers, body });
  const later = [];
  const context = { request, env, params: {}, data: {}, waitUntil(promise) { later.push(promise); } };
  const handler = { GET: route.onRequestGet, HEAD: route.onRequestHead, POST: route.onRequestPost }[method];
  const response = await root({ ...context, next: () => handler(context) });
  return { response, later, html: method === 'HEAD' ? '' : await response.clone().text() };
}
const post = (env, fields = GOOD, options = {}) => call(env, { method: 'POST', fields, ...options });

// Every row of every table, to show that a refusal changed nothing anywhere.
const tables = (db) => db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
const snapshot = (db) => Object.fromEntries(tables(db).map((t) => [t, db.sqlite.prepare(`SELECT * FROM "${t}"`).all().map((r) => ({ ...r }))]));
const count = (db, table) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

// ---- The page ---------------------------------------------------------------

test('GET /ask is the form: each field the criteria name, no sailor\'s, Turnstile\'s widget and script, and the form\'s CSP', async () => {
  const env = site();
  const { response, html } = await call(env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), HTML_CACHE);
  assert.equal(response.headers.get('Content-Security-Policy'), TURNSTILE_CSP);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
  assert.match(html, /<title>Ask for an account — Mad Cow Sailing photos<\/title>/);
  assert.match(html, /<h1>Ask for an account<\/h1>/);
  assert.match(html, /<form method="post" action="\/ask" class="ask-form">/);
  // Criterion 1: name, email, role, team(s) and the note, and nothing else
  // a person types.
  const fields = [...html.matchAll(/<(?:input|textarea)[^>]* name="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(fields, ['name', 'email', 'role', 'role', 'role', 'team', 'team', 'note']);
  assert.match(html, new RegExp(`<input id="ask-name" name="name" type="text" autocomplete="name" maxlength="${NAME_MAX}" required value="">`));
  assert.match(html, /<input id="ask-email" name="email" type="email" autocomplete="email" maxlength="254" spellcheck="false" required aria-describedby="ask-email-hint" value="">/);
  for (const role of ['parent', 'coach', 'other']) assert.match(html, new RegExp(`type="radio" id="ask-role-${role}" name="role" value="${role}" required>`));
  assert.match(html, /value="hoover-jrt"> Hoover JRT<\/label>/);
  assert.match(html, /value="cohssa"> COHSSA<\/label>/);
  assert.match(html, new RegExp(`<textarea id="ask-note" name="note" rows="4" maxlength="${NOTE_MAX}" aria-describedby="ask-note-hint"></textarea>`));
  // D18: no sailor's name is asked, and the note's hint says to leave one out.
  assert.doesNotMatch(html, /name="[^"]*sailor/i);
  assert.match(html, /<span class="hint" id="ask-note-hint">Up to 500 characters\. Leave out any sailor's name: the site keeps none\.<\/span>/);
  // Turnstile's widget, with this environment's site key. Its script is not
  // loaded with the page: the page's own script adds it once someone starts
  // on the form (owner, at #220's review).
  assert.match(html, new RegExp(`<div class="cf-turnstile" data-sitekey="${KEYS.TURNSTILE_SITE_KEY}" data-theme="light" data-size="flexible"></div>`));
  assert.ok(html.includes(ASK_SCRIPT), 'the page does not load public/js/ask.js');
  assert.ok(!html.includes(TURNSTILE_SCRIPT), 'Turnstile\'s script loads with the page');
  assert.match(html, /<a href="\/policy">Who sees these photos<\/a>/);
  // A clean page has no reasons, and its title says no error.
  assert.doesNotMatch(html, /error-summary|aria-invalid|Error:/);
});

test('HEAD /ask answers as GET does, so it never falls through to a 404', async () => {
  const env = site();
  const { response } = await call(env, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Security-Policy'), TURNSTILE_CSP);
  assert.equal(route.onRequestHead, route.onRequestGet);
});

test('GET /ask?sent says the request is in, with no form and no Turnstile', async () => {
  const { response, html } = await call(site(), { path: '/ask?sent' });
  assert.equal(response.status, 200);
  assert.match(html, /<h1>Your request is in<\/h1>/);
  assert.match(html, /If yours is approved, an email comes to the address you gave, with a link to set a password\./);
  assert.doesNotMatch(html, /<form|challenges\.cloudflare\.com/);
});

test('without the database, the address key or either Turnstile key, /ask says requests are closed, 503, and names only what is missing', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  for (const name of ['DB', 'ADDRESS_HASH_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
    const env = site({ [name]: undefined });
    for (const method of ['GET', 'POST']) {
      const { response, html } = await call(env, { method, fields: GOOD });
      assert.equal(response.status, 503, `${method} without ${name}`);
      assert.match(html, /<h1>Requests can't be taken right now<\/h1>/);
      assert.doesNotMatch(html, /<form/);
    }
    assert.ok(logged.at(-1).endsWith(`: ${name}`), logged.at(-1));
  }
  assert.equal(verified.length, 0, 'siteverify was asked with requests closed');
  for (const line of logged) assert.ok(!Object.values(KEYS).some((value) => line.includes(value)), line);
});

// ---- Refusals change nothing ------------------------------------------------

test('a post with no Origin or another site\'s is refused 403 before anything else, and changes nothing', async () => {
  const env = site();
  const before = snapshot(env.DB);
  for (const origin of [null, 'https://evil.example', 'http://photos.madcowsailing.com']) {
    const { response } = await post(env, GOOD, { origin });
    assert.equal(response.status, 403, String(origin));
    assert.deepEqual(await response.json(), { error: 'origin' });
  }
  assert.deepEqual(snapshot(env.DB), before);
  assert.equal(verified.length, 0);
});

test('a request Turnstile does not pass is refused 403 and writes nothing, in any table, and its limits are not spent', async () => {
  const env = site();
  const before = snapshot(env.DB);
  siteverify = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  const { response, html } = await post(env, { ...GOOD, name: 'Jane & Co' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(html, /The check that you are a person did not pass\./);
  // The form comes back as it was typed.
  assert.match(html, /<input id="ask-name" name="name" [^>]*value="Jane &amp; Co">/);
  assert.match(html, /value="parent" required checked>/);
  assert.deepEqual(snapshot(env.DB), before);
  // It was the token and the address that siteverify was asked about.
  assert.deepEqual(verified, [{ secret: KEYS.TURNSTILE_SECRET_KEY, response: TOKEN, remoteip: IP }]);
});

test('a request with no token, or an empty one, is refused 403 without asking siteverify, and writes nothing', async () => {
  const env = site();
  const before = snapshot(env.DB);
  const { [TOKEN_FIELD]: _, ...noToken } = GOOD;
  for (const fields of [noToken, { ...GOOD, [TOKEN_FIELD]: '' }]) {
    assert.equal((await post(env, fields)).response.status, 403);
  }
  assert.equal(verified.length, 0);
  assert.deepEqual(snapshot(env.DB), before);
});

test('Turnstile is asked before any field is read: a bad token with bad fields is 403, not 400', async () => {
  siteverify = () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
  const { response, html } = await post(site(), { [TOKEN_FIELD]: TOKEN, email: 'not an address' });
  assert.equal(response.status, 403);
  assert.doesNotMatch(html, /Enter one email address/);
});

test('when Turnstile cannot be asked, the request is refused 503, as closed, and writes nothing', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const before = snapshot(env.DB);
  siteverify = () => new Response('down', { status: 502 });
  const { response, html } = await post(env);
  assert.equal(response.status, 503);
  assert.match(html, /Requests can't be taken right now\. Try again in a few minutes\./);
  assert.match(html, /<form method="post" action="\/ask"/, 'the form is not shown again to retry');
  assert.deepEqual(snapshot(env.DB), before);
});

test('a field that is wrong comes back 400 with its reason linked from the summary and beside the field, the typed values escaped, and nothing written', async () => {
  const env = site();
  const before = snapshot(env.DB);
  const fields = {
    name: '', email: '"><script>alert(1)</script>', role: 'admin', team: [], note: '</textarea><b>bold</b>', [TOKEN_FIELD]: TOKEN,
  };
  const { response, html } = await post(env, fields);
  assert.equal(response.status, 400);
  assert.deepEqual(snapshot(env.DB), before);
  assert.match(html, /<title>Error: Ask for an account — Mad Cow Sailing photos<\/title>/);
  // The summary takes the focus, and links each reason to its field. It is a
  // <section>, a region once named: ARIA prohibits naming a <div> with no role.
  assert.match(html, /<section class="error-summary" id="ask-problems" tabindex="-1" autofocus aria-labelledby="ask-problems-title">/);
  assert.doesNotMatch(html, /<div[^>]*aria-labelledby/);
  const links = [...html.matchAll(/<li><a href="#([^"]+)">([^<]+)<\/a><\/li>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(links, [
    'ask-name Enter your name.',
    'ask-email Enter one email address, like name@example.com.',
    'ask-role-parent Choose parent, coach or other.',
    'ask-team-hoover-jrt Choose Hoover JRT, COHSSA or both.',
  ]);
  // Every link's target is an element on the page.
  for (const link of links) assert.ok(html.includes(`id="${link.split(' ')[0]}"`), link);
  // Beside each field: the reason, and the field marked invalid and pointing at it.
  assert.match(html, /<span class="field-error" id="ask-name-error">Enter your name\.<\/span>\s*<input id="ask-name" name="name" [^>]*required aria-invalid="true" aria-describedby="ask-name-error"/);
  assert.match(html, /<input id="ask-email" [^>]*aria-invalid="true" aria-describedby="ask-email-hint ask-email-error"/);
  assert.match(html, /<fieldset class="field" aria-describedby="ask-role-error">/);
  assert.match(html, /<fieldset class="field" aria-describedby="ask-team-hint ask-team-error">/);
  // What was typed comes back as text, never as markup.
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'));
  assert.ok(!html.includes('</textarea><b>bold</b>'));
  assert.ok(html.includes('&lt;/textarea&gt;&lt;b&gt;bold&lt;/b&gt;</textarea>'));
});

// ---- A request taken ----------------------------------------------------------

test('a request taken is answered 303 to /ask?sent; the account, its teams and the scrambled address are kept, and the admins are told after', async () => {
  const env = site();
  seedAdmin(env.DB, { email: 'admin@example.org', name: 'Admin' });
  // Resend does not answer until the test says so: the page's answer must
  // arrive anyway, since the email is not part of it.
  let answer;
  resendGate = new Promise((resolve) => { answer = resolve; });
  const { response, later } = await post(env, { ...GOOD, team: ['hoover-jrt', 'cohssa'], note: 'Two boats, one parent.' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/ask?sent');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const account = env.DB.sqlite.prepare('SELECT email, name, role, note, admins_emailed FROM accounts WHERE admin_role IS NULL').get();
  assert.deepEqual({ ...account }, { email: 'jane@example.org', name: 'Jane Rivers', role: 'parent', note: 'Two boats, one parent.', admins_emailed: 0 });
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM account_teams WHERE account_id = (SELECT id FROM accounts WHERE email = 'jane@example.org')").get().n, 2);
  // The network address only as its keyed hash.
  const { address_hash: stored } = env.DB.sqlite.prepare('SELECT address_hash FROM account_request_log').get();
  const request = new Request(SITE, { headers: { 'CF-Connecting-IP': IP } });
  assert.equal(stored, await addressHash(KEYS.ADDRESS_HASH_KEY, request));
  assert.ok(!JSON.stringify(snapshot(env.DB)).includes(IP), 'the address is stored as it is');
  // The answer came while the email was still waiting on Resend.
  assert.equal(later.length, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT admins_emailed FROM accounts WHERE admin_role IS NULL').get().admins_emailed, 0);
  answer();
  assert.deepEqual(await later[0], { outcome: 'sent', named: 1, sent: 1 });
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].to, ['admin@example.org']);
  assert.equal(env.DB.sqlite.prepare('SELECT admins_emailed FROM accounts WHERE admin_role IS NULL').get().admins_emailed, 1);
});

test('a note of NOTE_MAX four-byte characters, a form past readForm\'s 4 KiB default, is taken whole', async () => {
  const env = site();
  const note = '😀'.repeat(NOTE_MAX);
  const fields = { ...GOOD, team: ['hoover-jrt', 'cohssa'], note };
  // The form this sends is past the default, and inside ASK_FORM_BYTES; it
  // is all ASCII once encoded, so its length is its bytes.
  const bytes = encode(fields).length;
  assert.ok(bytes > MAX_FORM_BYTES && bytes <= ASK_FORM_BYTES, `${bytes} bytes`);
  const { response, later } = await post(env, fields);
  await Promise.all(later);
  assert.equal(response.status, 303);
  assert.equal(env.DB.sqlite.prepare('SELECT note FROM accounts').get().note, note);
});

test('a second request from the address, in another letter case, is answered exactly as a new address is, and keeps nothing new', async () => {
  const env = site();
  await Promise.all((await post(env)).later);
  const accounts = env.DB.sqlite.prepare('SELECT * FROM accounts').all().map((r) => ({ ...r }));
  const known = await post(env, { ...GOOD, email: 'Jane@EXAMPLE.org', name: 'Someone else', role: 'coach', team: ['cohssa'] });
  const fresh = await post(env, { ...GOOD, email: 'new.person@example.org' }, { ip: '198.51.100.9' });
  assert.equal(known.response.status, fresh.response.status);
  assert.deepEqual([...known.response.headers], [...fresh.response.headers]);
  assert.equal(known.html, fresh.html);
  assert.deepEqual(env.DB.sqlite.prepare("SELECT * FROM accounts WHERE email LIKE 'jane@%'").all().map((r) => ({ ...r })), accounts);
  assert.equal(count(env.DB, 'account_teams'), 2, 'the known address added a team');
  assert.equal(known.later.length, 0, 'the known address emailed the admins');
  assert.equal(fresh.later.length, 1);
});

test('a revoked address that asks through /ask after its account is deleted is held back: the key /ask makes is the one the revoke kept (#225, criterion 5)', async () => {
  const env = site();
  await Promise.all((await post(env)).later);
  const { id } = env.DB.sqlite.prepare("SELECT id FROM accounts WHERE email = 'jane@example.org'").get();
  const admin = 'owner@example.com';
  const now = Math.floor(Date.now() / 1000);
  await approveTeams(env.DB, { accountId: id, teams: ['hoover-jrt'], role: 'parent', admin, now });
  // Revoked with the route's own key, then deleted: only the hash stays.
  assert.deepEqual(await revokeTeams(env.DB, { accountId: id, teams: ['hoover-jrt'], hashKey: KEYS.ADDRESS_HASH_KEY, admin, now }), ['hoover-jrt']);
  assert.equal(await deleteAccount(env.DB, { accountId: id, admin, now }), true);
  assert.equal(count(env.DB, 'accounts'), 0);
  const held = await post(env, { ...GOOD, email: 'JANE@Example.org', name: 'Jane Again' }, { ip: '198.51.100.20' });
  const fresh = await post(env, { ...GOOD, email: 'sam@example.org', name: 'Sam Lee' }, { ip: '198.51.100.21' });
  assert.equal(held.response.status, 303);
  assert.equal(held.html, fresh.html);
  assert.deepEqual([...held.response.headers], [...fresh.response.headers]);
  // The control is the fresh address: the same route made its account.
  assert.deepEqual(env.DB.sqlite.prepare('SELECT email FROM accounts').all().map((r) => r.email), ['sam@example.org']);
  assert.equal(held.later.length, 0, 'the held-back address emailed the admins');
});

test(`the request after ${REQUEST_LIMIT} in an hour from one network is refused 429 with when to retry, keeps the form, and writes nothing`, async () => {
  const env = site();
  for (let i = 0; i < REQUEST_LIMIT; i++) {
    assert.equal((await post(env, { ...GOOD, email: `p${i}@example.org` })).response.status, 303);
  }
  const before = snapshot(env.DB);
  const { response, html } = await post(env, { ...GOOD, email: 'one.more@example.org' });
  assert.equal(response.status, 429);
  assert.match(response.headers.get('Retry-After'), /^\d+$/);
  assert.ok(Number(response.headers.get('Retry-After')) > 3500);
  assert.match(html, new RegExp(`This network has sent ${REQUEST_LIMIT} requests in the last hour, the most the site takes from one network\\. Try again in \\d+ minutes\\.`));
  assert.match(html, /value="one\.more@example\.org"/);
  assert.deepEqual(snapshot(env.DB), before);
});

test('past the site\'s budget for the hour a request is refused 429, and the page says when to try again', async (t) => {
  // Half past an hour, so the hour cannot turn under the test.
  const hour = 497_222;
  t.mock.timers.enable({ apis: ['Date'], now: (hour * 3600 + 1800) * 1000 });
  const env = site();
  env.DB.sqlite.prepare('INSERT INTO account_request_budget (hour, requested) VALUES (?, ?)').run(hour, REQUEST_BUDGET_PER_HOUR);
  const { response, html } = await post(env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '1800');
  assert.match(html, /The site has taken all the requests it takes in an hour\. Try again in 30 minutes\./);
  assert.equal(count(env.DB, 'accounts'), 0);
  assert.equal(count(env.DB, 'account_request_log'), 0, 'the address kept the unit a busy site refused');
});

test('when the database fails mid-request the answer is 503, as closed, and nothing of the request is kept', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const db = env.DB;
  env.DB = { ...db, batch: async () => { throw new Error('D1 down'); } };
  const { response, html } = await post(env);
  assert.equal(response.status, 503);
  assert.match(html, /Requests can't be taken right now/);
  for (const table of ['accounts', 'account_teams', 'account_request_log']) assert.equal(count(db, table), 0, table);
  assert.deepEqual(db.sqlite.prepare('SELECT requested FROM account_request_budget').all().map((r) => r.requested), [0]);
});

// ---- What is logged -------------------------------------------------------------

test('nothing logged through any answer holds a name, an address, a note, the network address, the token or the secret', async (t) => {
  const logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    t.mock.method(console, method, (...args) => logged.push(args.map(String).join(' ')));
  }
  const fields = { ...GOOD, name: 'Planted Name', email: 'planted.address@example.org', note: 'planted note' };
  const env = site();
  const passes = () => Response.json({ success: true, 'error-codes': [] });
  // Each run sets siteverify's answer, so no run inherits the one before.
  const runs = [
    [passes, () => post(env, fields)],
    [passes, () => post(env, { ...fields, email: 'PLANTED.ADDRESS@example.org' })],
    [passes, () => post(env, { ...fields, role: 'nope' })],
    [() => new Response('x', { status: 500 }), () => post(env, fields)],
    [() => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }), () => post(env, fields)],
    [passes, () => post(site({ TURNSTILE_SECRET_KEY: undefined }), fields)],
    [passes, () => post({ ...site(), DB: { ...d1(), batch: async () => { throw new Error('D1 down'); } } }, fields)],
    [passes, () => post(site({ RESEND_API_KEY: undefined }), fields)],
  ];
  for (const [answer, run] of runs) {
    siteverify = answer;
    const { later } = await run();
    await Promise.all(later);
  }
  // At least: siteverify's 500, the missing secret, the database, and the
  // email with no key (lib/mail.js, and mailAdmins after it).
  assert.ok(logged.length >= 5, `only ${logged.length} lines logged: is the capture working?`);
  for (const line of logged) {
    for (const planted of ['Planted Name', 'planted.address', 'PLANTED', 'planted note', IP, TOKEN, KEYS.TURNSTILE_SECRET_KEY]) {
      assert.ok(!line.includes(planted), `logged ${planted}: ${line}`);
    }
  }
});

// ---- Every page passes the site's own validator -----------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const problems = async (html) => (await validator.validateString(html, join(ROOT, 'public.html')))
  .results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

test('the form, its every refusal, the page after a request and the closed page pass the photo site\'s html-validate config, which can fail them', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site();
  const pages = {
    form: (await call(env)).html,
    sent: (await call(env, { path: '/ask?sent' })).html,
    closed: (await call(site({ DB: undefined }))).html,
    fields: (await post(env, { [TOKEN_FIELD]: TOKEN, name: '', email: 'x', role: '', note: 'n' })).html,
  };
  siteverify = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  pages.turnstile = (await post(env)).html;
  siteverify = () => new Response('down', { status: 500 });
  pages.unavailable = (await post(env)).html;
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.length > 500, name);
    assert.deepEqual(await problems(html), [], name);
  }
  // The control: a second <h1> on the form fails it.
  assert.notDeepEqual(await problems(pages.form.replace('<h1>', '<h1>Planted</h1><h1>')), []);
});

// ---- public/js/ask.js: Turnstile on the form's first focus or touch -----------
//
// Run as the browser runs it, against hand-written stand-ins for the few DOM
// calls it makes, the repo's way (test/admin-code.test.js).

const ASK_JS = readFileSync(join(ROOT, 'public', 'js', 'ask.js'), 'utf8');

test('the page names public/js/ask.js by its own hash, and the script adds Turnstile from the one URL its docs allow', () => {
  const version = createHash('sha256').update(readFileSync(join(ROOT, 'public', 'js', 'ask.js'))).digest('hex').slice(0, 10);
  assert.equal(ASK_SCRIPT, `<script src="/js/ask.js?v=${version}" defer></script>`,
    'public/js/ask.js changed: copy its new ?v= into ASK_SCRIPT in lib/ask-page.js');
  assert.equal(TURNSTILE_SCRIPT, 'https://challenges.cloudflare.com/turnstile/v0/api.js');
  assert.equal(ASK_JS.match(/https:\/\/challenges\.cloudflare\.com\/[^'"]*/g)?.join(), TURNSTILE_SCRIPT);
});

function runAskScript({ problems = false, form = true } = {}) {
  const added = [];
  const formEl = {
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
  };
  const document = {
    querySelector: (selector) => {
      if (selector !== '.ask-form') throw new Error(`the script asked for ${selector}, which this stand-in does not know`);
      return form ? formEl : null;
    },
    getElementById: (id) => (id === 'ask-problems' && problems ? {} : null),
    createElement: (tag) => ({ tag }),
    head: { append: (node) => added.push(node) },
  };
  vm.runInNewContext(ASK_JS, { document });
  const fire = (type) => { for (const fn of formEl.listeners[type] ?? []) fn(); };
  return { added, fire };
}

test('the script adds nothing at load, then Turnstile\'s script once, async, on the form\'s first focus', () => {
  const page = runAskScript();
  assert.deepEqual(page.added, [], 'Turnstile was added before anyone started on the form');
  page.fire('focusin');
  assert.deepEqual(page.added, [{ tag: 'script', src: TURNSTILE_SCRIPT, async: true }]);
  page.fire('focusin');
  page.fire('pointerdown');
  assert.equal(page.added.length, 1, 'a second start added Turnstile again');
});

test('a touch is a start too, and a page sent back with a reason adds Turnstile at once', () => {
  const touched = runAskScript();
  touched.fire('pointerdown');
  assert.equal(touched.added.length, 1);
  const refused = runAskScript({ problems: true });
  assert.deepEqual(refused.added, [{ tag: 'script', src: TURNSTILE_SCRIPT, async: true }]);
  refused.fire('focusin');
  assert.equal(refused.added.length, 1);
  // A page with no form, which /ask never serves, adds nothing and throws nothing.
  assert.deepEqual(runAskScript({ form: false }).added, []);
});

test('the site\'s headers are on every answer, and only /ask\'s carry Turnstile\'s CSP', async () => {
  const env = site();
  for (const { response } of [await call(env), await post(env), await post(env, GOOD, { origin: null })]) {
    assert.equal(response.headers.get('Content-Security-Policy'), TURNSTILE_CSP);
    for (const name of ['X-Robots-Tag', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) {
      assert.equal(response.headers.get(name), SITE_HEADERS[name], name);
    }
  }
});
