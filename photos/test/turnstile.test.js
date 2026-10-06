// Turnstile checked on the server (#220, criterion 2): what lib/turnstile.js
// sends to siteverify, what each answer becomes, and that no log line holds
// the token, the secret or the network address.
//
// fetch is stood in for: siteverify's URL answers whatever `siteverify`
// returns, and any other URL throws, so a check sent anywhere else fails
// loudly.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { USER_AGENT } from '../lib/mail.js';
import { SITEVERIFY_URL, TIMEOUT_MS, TOKEN_FIELD, TOKEN_MAX, verifyTurnstile } from '../lib/turnstile.js';

const SECRET = 'turnstile-secret-for-tests';
const TOKEN = 'a-token-from-the-widget';
const IP = '203.0.113.7';

let siteverify; // (body, init) => the Response siteverify answers, or a throw
let calls; // every request that reached siteverify

beforeEach(() => {
  calls = [];
  siteverify = () => Response.json({ success: true, 'error-codes': [], hostname: 'photos.madcowsailing.com' });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url !== SITEVERIFY_URL) throw new Error(`fetched ${url}, not siteverify`);
    const body = JSON.parse(init.body);
    calls.push({ init, headers: new Headers(init.headers), body });
    return siteverify(body, init);
  });
});
afterEach(() => mock.restoreAll());

const env = (extra = {}) => ({ TURNSTILE_SECRET_KEY: SECRET, SITE_ENV: 'preview', ...extra });

test('siteverify is Cloudflare\'s, the widget\'s field is its default, and a token is at most 2,048 characters', () => {
  // Turnstile's "Validate the token" page and its widget configurations
  // (read 2026-10-05).
  assert.equal(SITEVERIFY_URL, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(TOKEN_FIELD, 'cf-turnstile-response');
  assert.equal(TOKEN_MAX, 2048);
  assert.equal(TIMEOUT_MS, 10_000);
});

test('a check is one POST of the secret, the token and the address, as JSON, with a User-Agent and a timeout', async () => {
  assert.equal(await verifyTurnstile(env(), TOKEN, IP), 'passed');
  assert.equal(calls.length, 1);
  const [{ init, headers, body }] = calls;
  assert.equal(init.method, 'POST');
  assert.equal(headers.get('Content-Type'), 'application/json');
  // workerd's fetch sends no User-Agent of its own (#217). siteverify answered
  // without one (measured 2026-10-05), but nothing here should rest on that.
  assert.equal(headers.get('User-Agent'), USER_AGENT);
  assert.ok(init.signal instanceof AbortSignal, 'no timeout: a hung siteverify would hang the request');
  assert.equal(init.signal.aborted, false, 'the signal had fired before the check was sent');
  assert.deepEqual(body, { secret: SECRET, response: TOKEN, remoteip: IP });
});

// The test's own timeout turns a signal that never fires into a failure
// rather than a suite that never ends, as test/mail.test.js's does.
test('a check siteverify never answers is given up after TIMEOUT_MS, as unavailable', { timeout: TIMEOUT_MS + 5000 }, async (t) => {
  t.mock.method(console, 'error', () => {});
  let signal;
  // Answers nothing until the request's own signal aborts it, as a hung
  // connection would.
  siteverify = (body, init) => {
    signal = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const started = performance.now();
  const pending = verifyTurnstile(env(), TOKEN, IP);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(signal.aborted, false, 'the signal fired at once, so no check would ever have time to land');
  assert.equal(await pending, 'unavailable');
  const took = performance.now() - started;
  assert.ok(took >= TIMEOUT_MS - 50 && took < TIMEOUT_MS + 2000, `gave up after ${Math.round(took)} ms`);
});

test('with no address the check goes without one', async () => {
  for (const remoteip of [null, undefined, '']) {
    calls = [];
    assert.equal(await verifyTurnstile(env(), TOKEN, remoteip), 'passed');
    assert.deepEqual(calls[0].body, { secret: SECRET, response: TOKEN });
  }
});

test('with no secret nothing is asked and the check is unavailable, never passed', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const secret of [undefined, '']) {
    assert.equal(await verifyTurnstile(env({ TURNSTILE_SECRET_KEY: secret }), TOKEN, IP), 'unavailable');
  }
  assert.equal(calls.length, 0);
});

test('no token, an empty one, one that is not a string, or one past 2,048 characters is refused without asking', async () => {
  for (const token of [null, undefined, '', 42, ['x'], 'x'.repeat(TOKEN_MAX + 1)]) {
    assert.equal(await verifyTurnstile(env(), token, IP), 'refused', String(token).slice(0, 20));
  }
  assert.equal(calls.length, 0);
  // The control: a token of exactly 2,048 is asked about.
  assert.equal(await verifyTurnstile(env(), 'x'.repeat(TOKEN_MAX), IP), 'passed');
  assert.equal(calls.length, 1);
});

test('a token siteverify says is not valid, forged, expired or already used, is refused', async () => {
  for (const code of ['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response', 'bad-request']) {
    siteverify = () => Response.json({ success: false, 'error-codes': [code] });
    assert.equal(await verifyTurnstile(env(), TOKEN, IP), 'refused', code);
  }
});

test('when the check itself fails it is unavailable, and closed: never passed, never the token\'s fault', async (t) => {
  t.mock.method(console, 'error', () => {});
  const answers = {
    'its own internal error': () => Response.json({ success: false, 'error-codes': ['internal-error'] }),
    'a secret it does not accept': () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }),
    'a missing secret': () => Response.json({ success: false, 'error-codes': ['missing-input-secret'] }),
    'a code it adds later': () => Response.json({ success: false, 'error-codes': ['something-new'] }),
    'a token error beside its own': () => Response.json({ success: false, 'error-codes': ['invalid-input-response', 'internal-error'] }),
    'no code at all': () => Response.json({ success: false, 'error-codes': [] }),
    'no codes field': () => Response.json({ success: false }),
    'success that is not true': () => Response.json({ success: 'true' }),
    'a 500': () => new Response('down', { status: 500 }),
    // Its own control: a body that would pass, behind a status that says the
    // answer is not siteverify's. Every other non-2xx here is not JSON, so
    // only this case can tell whether the status is read at all.
    'a 502 whose body says success': () => Response.json({ success: true, 'error-codes': [] }, { status: 502 }),
    'a 400': () => new Response('bad', { status: 400 }),
    'a body that is not JSON': () => new Response('<html>', { status: 200 }),
    'JSON null': () => new Response('null', { status: 200 }),
    'no answer': () => { throw new TypeError('network'); },
    'a timeout': () => { throw new DOMException('timed out', 'TimeoutError'); },
  };
  for (const [name, answer] of Object.entries(answers)) {
    siteverify = answer;
    assert.equal(await verifyTurnstile(env(), TOKEN, IP), 'unavailable', name);
  }
});

test('a test key\'s pass is trusted on a preview and never in production', async (t) => {
  t.mock.method(console, 'error', () => {});
  // Cloudflare's always-pass test secret answers this for any token at all
  // (measured 2026-10-05, the token "not-a-token" included).
  siteverify = () => Response.json({ success: true, 'error-codes': [], hostname: 'example.com', metadata: { result_with_testing_key: true } });
  assert.equal(await verifyTurnstile(env({ SITE_ENV: 'production' }), TOKEN, IP), 'unavailable');
  assert.equal(await verifyTurnstile(env({ SITE_ENV: 'preview' }), TOKEN, IP), 'passed');
  // The control: production passes a real key's answer.
  siteverify = () => Response.json({ success: true, 'error-codes': [], hostname: 'photos.madcowsailing.com', metadata: {} });
  assert.equal(await verifyTurnstile(env({ SITE_ENV: 'production' }), TOKEN, IP), 'passed');
});

test('nothing logged holds the token, the secret or the address', async (t) => {
  const logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    t.mock.method(console, method, (...args) => logged.push(args.map(String).join(' ')));
  }
  const answers = [
    () => Response.json({ success: false, 'error-codes': ['internal-error', `leak ${TOKEN}`] }),
    () => new Response(`echo ${SECRET}`, { status: 500 }),
    () => new Response(`not json ${TOKEN}`),
    () => { throw new TypeError(`failed for ${IP} ${TOKEN}`); },
    () => Response.json({ success: true, metadata: { result_with_testing_key: true } }),
  ];
  for (const answer of answers) {
    siteverify = answer;
    await verifyTurnstile(env({ SITE_ENV: 'production' }), TOKEN, IP);
  }
  await verifyTurnstile(env({ TURNSTILE_SECRET_KEY: undefined }), TOKEN, IP);
  assert.ok(logged.length >= answers.length, `only ${logged.length} lines logged: is the capture working?`);
  for (const line of logged) {
    for (const planted of [TOKEN, SECRET, IP]) assert.ok(!line.includes(planted), `logged ${planted}: ${line}`);
  }
  // The control: the capture sees a planted value.
  console.error('control', TOKEN);
  assert.ok(logged.at(-1).includes(TOKEN));
});
