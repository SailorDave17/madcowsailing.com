// Email through Resend (#217): what lib/mail.js sends and how, what it
// refuses before sending, what each answer from Resend becomes, and that no
// log line carries an address, a subject or a body (criterion 6). Then the
// admin test send, /admin/mail and /api/admin/mail/test, through the whole
// request chain.
//
// fetch is stood in for: the Access certs URL answers the test team's key,
// Resend's URL answers whatever `resend` returns, and any other URL throws, so
// a send to the wrong address fails loudly.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as mailPage } from '../functions/admin/mail.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import * as testSend from '../functions/api/admin/mail/test.js';
import { TOKEN_HEADER, keyCache } from '../lib/access.js';
import { adminMailPage, mailNotice } from '../lib/admin-page.js';
import {
  MAIL_FROM, MAIL_REPLY_TO, RESEND_URL, SUBJECT_MAX, TEXT_MAX, TIMEOUT_MS, USER_AGENT, isEmailAddress, sendMail,
} from '../lib/mail.js';
import { OWNER, TEAM, accessEnv, keyPair, mint } from './access.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
// Not Resend's key shape on purpose: a re_-prefixed value here reads as a
// leaked key to gitleaks and could stop the push at GitHub's push protection.
const API_KEY = 'test-key-not-real';

const team = await keyPair();
let resend; // (init) => the Response Resend answers, or a throw
let calls; // every request that reached Resend's URL

beforeEach(() => {
  keyCache.clear();
  calls = [];
  resend = () => Response.json({ id: 'msg-217' });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [team.jwk], public_cert: {}, public_certs: [] });
    if (url !== RESEND_URL) throw new Error(`fetched ${url}, not Resend's`);
    calls.push({ init, headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return resend(init);
  });
});
afterEach(() => mock.restoreAll());

const site = (extra = {}) => ({ RESEND_API_KEY: API_KEY, SITE_ENV: 'preview', ...accessEnv(), ...extra });

const MESSAGE = { to: 'someone@example.org', subject: 'A subject', text: 'A body.\nSecond line.' };

// ---- What a send is ------------------------------------------------------

test('a send is one POST to Resend, with the key, JSON, a User-Agent and a timeout', async () => {
  const result = await sendMail(site(), MESSAGE);
  assert.deepEqual(result, { ok: true, id: 'msg-217' });
  assert.equal(calls.length, 1);
  const [{ init, headers, body }] = calls;
  assert.equal(init.method, 'POST');
  assert.equal(headers.get('Authorization'), `Bearer ${API_KEY}`);
  assert.equal(headers.get('Content-Type'), 'application/json');
  // Resend refuses a request without one, 403; a Worker's fetch may not add it.
  assert.equal(headers.get('User-Agent'), USER_AGENT);
  assert.match(USER_AGENT, /^madcowphotos\/\S+ /);
  assert.ok(init.signal instanceof AbortSignal, 'no timeout signal: a hung Resend would hang the request');
  assert.equal(init.signal.aborted, false);
  assert.deepEqual(body, {
    from: MAIL_FROM, to: [MESSAGE.to], reply_to: MAIL_REPLY_TO, subject: MESSAGE.subject, text: MESSAGE.text,
  });
});

test('mail comes from photos.madcowsailing.com, and replies go to the owner\'s mailbox', () => {
  assert.match(MAIL_FROM, /^[^<>@]+ <no-reply@photos\.madcowsailing\.com>$/);
  assert.equal(MAIL_REPLY_TO, 'dave@madcowsailing.com');
});

test('a 2xx is a send even when its body is not JSON', async () => {
  resend = () => new Response('accepted', { status: 200 });
  assert.deepEqual(await sendMail(site(), MESSAGE), { ok: true, id: null });
});

test('with no RESEND_API_KEY nothing is sent, and the result says why', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const env of [site({ RESEND_API_KEY: undefined }), site({ RESEND_API_KEY: '' })]) {
    assert.deepEqual(await sendMail(env, MESSAGE), { ok: false, reason: 'not-configured' });
  }
  assert.equal(calls.length, 0);
});

// ---- What is refused before sending ---------------------------------------

// An address of exactly `length` characters, every part at or under its own
// cap: a 64-character local part and labels of 63, so only the total decides.
const ofLength = (length) => `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - 196)}.co`;

const GOOD = [
  'a@b.co', 'first.last+tag@sub.example.org', "o'brien@example.ie", 'x@xn--bcher-kva.example',
  ofLength(254), `a@${'x'.repeat(63)}.co`, `${'x'.repeat(64)}@b.co`,
];
// Each of the first group is refused by one clause of the pattern alone, so
// dropping that clause reddens its line.
const BAD = [
  'a,b@c.de', 'a;b@c.de', 'a<b@c.de', 'a>b@c.de', 'a:b@c.de', 'a(b@c.de', 'a"b@c.de', 'a[b@c.de',
  'a\u007fb@c.de', `a@${'x'.repeat(64)}.co`, 'a@b.c0m', ofLength(255),
  '', 'a', 'a@b', 'a@b.c', '@b.co', 'a@', 'a b@c.de', 'a@b.co,c@d.co', 'a@b.co;c@d.co',
  'a@b.co\r\nBcc: c@d.co', 'a@b.co\n', 'a\u0000@b.co', 'Name <a@b.co>', '<a@b.co>', '"a"@b.co',
  'a@-b.co', 'a@b-.co', 'a@b..co', 'a@@b.co', `${'x'.repeat(65)}@b.co`,
  // 260 characters, each label within 63: too long only as a whole.
  `a@${'d'.repeat(63)}.${'e'.repeat(63)}.${'f'.repeat(63)}.${'g'.repeat(63)}.co`,
  null, undefined, 42, ['a@b.co'], { toString: () => 'a@b.co' },
];

test('the length fixtures are the lengths they claim', () => {
  assert.equal(ofLength(254).length, 254);
  assert.equal(ofLength(255).length, 255);
});

test('one plain address is accepted, and anything else is not', () => {
  for (const address of GOOD) assert.equal(isEmailAddress(address), true, address);
  for (const address of BAD) assert.equal(isEmailAddress(address), false, JSON.stringify(address));
});

test('a send to anything but one plain address never reaches Resend', async () => {
  for (const to of BAD) {
    assert.deepEqual(await sendMail(site(), { ...MESSAGE, to }), { ok: false, reason: 'address' }, JSON.stringify(to));
  }
  assert.equal(calls.length, 0);
});

test('an empty, multi-line or overlong subject, or an empty or overlong text, never reaches Resend', async (t) => {
  t.mock.method(console, 'error', () => {});
  const bad = [
    { subject: '' }, { subject: '   ' }, { subject: 'a\nb' }, { subject: 'a\rb' }, { subject: 'x'.repeat(SUBJECT_MAX + 1) },
    { text: '' }, { text: ' \n ' }, { text: 'a\u0000b' }, { text: 'x'.repeat(TEXT_MAX + 1) }, { subject: 7 },
  ];
  for (const change of bad) {
    assert.deepEqual(await sendMail(site(), { ...MESSAGE, ...change }), { ok: false, reason: 'message' }, JSON.stringify(change).slice(0, 60));
  }
  assert.equal(calls.length, 0);
  // The controls: the longest allowed subject and text are sent.
  assert.equal((await sendMail(site(), { ...MESSAGE, subject: 'x'.repeat(SUBJECT_MAX), text: 'y'.repeat(TEXT_MAX) })).ok, true);
});

// ---- What each answer from Resend becomes ---------------------------------

// Resend's error names and statuses, from its API reference's Errors page,
// read 2026-10-01.
const ANSWERS = [
  [429, { name: 'daily_quota_exceeded', message: 'You have exceeded your daily email sending quota.' }, 'quota'],
  [429, { name: 'monthly_quota_exceeded', message: 'You have exceeded your monthly email sending quota.' }, 'quota'],
  [429, { name: 'rate_limit_exceeded', message: 'Too many requests.' }, 'rate'],
  [429, 'not json', 'rate'],
  [403, { name: 'validation_error', message: 'The domain is not verified.' }, 'refused'],
  [401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails.' }, 'refused'],
  [422, { name: 'missing_required_field', message: 'The request body is missing one or more required fields.' }, 'refused'],
  [500, { name: 'application_error', message: 'An unexpected error occurred.' }, 'unreachable'],
  [503, 'not json', 'unreachable'],
];

test('each answer from Resend becomes its reason, with the status and Resend\'s error name', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [status, body, reason] of ANSWERS) {
    resend = () => (typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status }));
    const error = typeof body === 'string' ? 'unknown' : body.name;
    assert.deepEqual(await sendMail(site(), MESSAGE), { ok: false, reason, status, error }, `${status} ${error}`);
  }
});

test('an error name that is not Resend\'s shape is reported as unknown', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const name of ['Daily Quota', 'a'.repeat(65), 42, null, 'x-y']) {
    resend = () => Response.json({ name }, { status: 403 });
    assert.equal((await sendMail(site(), MESSAGE)).error, 'unknown', String(name));
  }
});

test('a send waits 10 seconds at most', () => {
  // The admin page's notice says "within 10 seconds"; this holds the two equal.
  assert.equal(TIMEOUT_MS, 10_000);
});

// The test's own timeout turns a signal that never fires into a failure
// rather than a suite that never ends.
test('a send Resend never answers is given up after TIMEOUT_MS, as unreachable', { timeout: TIMEOUT_MS + 5000 }, async (t) => {
  t.mock.method(console, 'error', () => {});
  let signal;
  // Answers nothing until the request's own signal aborts it, as a hung
  // connection would.
  resend = (init) => {
    signal = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const started = performance.now();
  const pending = sendMail(site(), MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(signal.aborted, false, 'the signal fired at once, so no send would ever have time to land');
  assert.deepEqual(await pending, { ok: false, reason: 'unreachable' });
  const took = performance.now() - started;
  assert.ok(took >= TIMEOUT_MS - 50 && took < TIMEOUT_MS + 2000, `gave up after ${Math.round(took)} ms`);
});

test('no answer at all, or a timeout, is unreachable, and never throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const failure of [new TypeError('fetch failed'), new DOMException('The operation timed out.', 'TimeoutError')]) {
    resend = () => { throw failure; };
    assert.deepEqual(await sendMail(site(), MESSAGE), { ok: false, reason: 'unreachable' }, failure.name);
  }
});

// ---- Criterion 6: nothing logs a recipient, a subject or a body -----------

const PLANTED = {
  to: 'planted.recipient.217@example.org',
  subject: 'Planted subject 7f3a',
  text: 'Planted body 9c1e.\nPlanted second line b2d4.',
};
// Each planted value, and a fragment of each, so a log line that kept only
// part of one is caught too.
const NEEDLES = [PLANTED.to, 'planted.recipient', PLANTED.subject, '7f3a', 'Planted body', '9c1e', 'b2d4'];

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

const leaks = (lines) => lines.filter((line) => NEEDLES.some((needle) => line.includes(needle)));

// What Resend might answer with the planted address in it. Its own message for
// an unverified sender quotes an address; a network error's can carry the
// request. Neither may reach a log.
const LEAKY_ANSWERS = {
  'a send': () => Response.json({ id: 'msg-217' }),
  'a refusal quoting the address': () => Response.json({ statusCode: 403, name: 'validation_error', message: `You can only send testing emails to your own email address (${PLANTED.to}).` }, { status: 403 }),
  'an error name that is the address': () => Response.json({ name: PLANTED.to, message: PLANTED.subject }, { status: 422 }),
  'the daily limit': () => Response.json({ name: 'daily_quota_exceeded', message: `quota for ${PLANTED.to}` }, { status: 429 }),
  'a 500 echoing the body': () => new Response(JSON.stringify(PLANTED), { status: 500 }),
  'a network error naming the address': () => { throw new TypeError(`fetch to ${PLANTED.to} failed: ${PLANTED.text}`); },
};

test('the leak detector finds a planted value in a log line, so a clean result below is a reading', async () => {
  const lines = await logsOf(() => {
    console.error('mail failed for', PLANTED.to);
    console.warn(new Error(`subject was ${PLANTED.subject}`));
    console.log({ text: PLANTED.text });
  });
  assert.equal(lines.length, 3);
  assert.equal(leaks(lines).length, 3);
});

for (const [name, answer] of Object.entries(LEAKY_ANSWERS)) {
  test(`a send meeting ${name} logs no recipient, subject or body`, async () => {
    resend = answer;
    const lines = await logsOf(() => sendMail(site(), PLANTED));
    assert.deepEqual(leaks(lines), []);
    if (name !== 'a send') {
      // The failure was logged, so the capture above read real lines.
      assert.ok(lines.some((line) => line.startsWith('mail: ')), `nothing was logged for ${name}`);
    }
  });
}

test('a refused address and a missing key log no recipient either', async () => {
  const lines = [
    ...await logsOf(() => sendMail(site(), { ...PLANTED, to: `${PLANTED.to}, other@example.org` })),
    ...await logsOf(() => sendMail(site({ RESEND_API_KEY: undefined }), PLANTED)),
  ];
  assert.ok(lines.length > 0);
  assert.deepEqual(leaks(lines), []);
});

// ---- The test send: POST /api/admin/mail/test ------------------------------

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const FORM = 'application/x-www-form-urlencoded';

async function press(env, fields, { method = 'POST', type = FORM } = {}) {
  const request = new Request(`${SITE}/api/admin/mail/test`, {
    method,
    headers: { Origin: SITE, [TOKEN_HEADER]: await mint(team), 'Content-Type': type },
    body: method === 'POST' ? new URLSearchParams(fields).toString() : undefined,
  });
  const handler = method === 'POST' ? testSend.onRequestPost : testSend.onRequestGet;
  return chain([root, ...adminApi, handler], request, env);
}

/** Where a press sent the browser, as its query. */
const landing = (res) => {
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const url = new URL(res.headers.get('Location'), SITE);
  assert.equal(url.pathname, '/admin/mail');
  return Object.fromEntries(url.searchParams);
};

test('a press sends the fixed test message to the typed address, naming the environment, and says so', async () => {
  const before = Date.now();
  assert.deepEqual(landing(await press(site(), { to: '  someone@example.org ' })), { done: 'sent' });
  assert.equal(calls.length, 1);
  const { body } = calls[0];
  assert.deepEqual(body.to, ['someone@example.org']);
  assert.equal(body.subject, testSend.TEST_SUBJECT);
  assert.equal(body.from, MAIL_FROM);
  assert.equal(body.reply_to, MAIL_REPLY_TO);
  assert.match(body.text, /sent by the preview site at (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)/);
  const at = Date.parse(body.text.match(/at (\S+Z)/)[1]);
  assert.ok(at >= before - 1000 && at <= Date.now(), 'the time in the message is not the time it was sent');
  assert.match(body.text, /A reply to it goes to dave@madcowsailing\.com\./);
});

test('production\'s test message says production', async () => {
  await press(site({ SITE_ENV: 'production' }), { to: OWNER });
  assert.match(calls[0].body.text, /sent by the production site at/);
});

test('the address never travels in the query the press answers with', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const make of [() => Response.json({ id: 'x' }), () => Response.json({ name: 'validation_error' }, { status: 403 })]) {
    resend = make;
    const res = await press(site(), { to: PLANTED.to });
    assert.doesNotMatch(res.headers.get('Location'), /planted|example\.org/i);
  }
});

test('a press with no address, or not one address, sends nothing and says so', async () => {
  for (const fields of [{}, { to: '' }, { to: 'not an address' }, { to: 'a@b.co, c@d.co' }]) {
    assert.deepEqual(landing(await press(site(), fields)), { error: 'address' }, JSON.stringify(fields));
  }
  // A body of another type reads as an empty form (lib/form.js).
  assert.deepEqual(landing(await press(site(), { to: OWNER }, { type: 'text/plain' })), { error: 'address' });
  assert.equal(calls.length, 0);
});

test('each failure lands on the page with its reason, and a refusal with its status', async (t) => {
  t.mock.method(console, 'error', () => {});
  assert.deepEqual(landing(await press(site({ RESEND_API_KEY: undefined }), { to: OWNER })), { error: 'not-configured' });
  const cases = [
    [() => Response.json({ name: 'daily_quota_exceeded' }, { status: 429 }), { error: 'quota' }],
    [() => Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }), { error: 'rate' }],
    [() => Response.json({ name: 'validation_error' }, { status: 403 }), { error: 'refused', status: '403' }],
    [() => new Response('', { status: 502 }), { error: 'unreachable' }],
    [() => { throw new TypeError('fetch failed'); }, { error: 'unreachable' }],
  ];
  for (const [answer, expected] of cases) {
    resend = answer;
    assert.deepEqual(landing(await press(site(), { to: OWNER })), expected);
  }
});

test('a GET sends nothing', async () => {
  assert.deepEqual(landing(await press(site(), {}, { method: 'GET' })), { error: 'unchanged' });
  assert.equal(calls.length, 0);
});

test('a press logs no recipient, subject or body, whatever Resend answers', async () => {
  for (const answer of Object.values(LEAKY_ANSWERS)) {
    resend = answer;
    const lines = await logsOf(() => press(site(), { to: PLANTED.to }));
    assert.deepEqual(leaks(lines), []);
  }
  // The test message's own subject and a line of its text are not logged either.
  const lines = await logsOf(async () => {
    resend = () => Response.json({ name: 'validation_error', message: testSend.TEST_SUBJECT }, { status: 403 });
    await press(site(), { to: OWNER });
  });
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(!line.includes(testSend.TEST_SUBJECT) && !line.includes(OWNER) && !line.includes('Nothing needs doing'), line);
  }
});

// ---- The page: GET /admin/mail ---------------------------------------------

async function page(env, query = '') {
  const request = new Request(`${SITE}/admin/mail${query}`, { headers: { [TOKEN_HEADER]: await mint(team) } });
  const res = await chain([root, ...adminPages, mailPage], request, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  return res.text();
}

const validator = new HtmlValidate(new FileSystemConfigLoader());
const problems = async (html) =>
  (await validator.validateString(html, join(ROOT, 'admin.html'))).results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

test('the page says who mail comes from and where replies go, and its form posts the address to the test send', async () => {
  const html = await page(site());
  assert.match(html, /<code>no-reply@photos\.madcowsailing\.com<\/code>/);
  assert.match(html, /<code>dave@madcowsailing\.com<\/code>/);
  assert.match(html, /<form method="post" action="\/api\/admin\/mail\/test" class="album-form">/);
  // The field starts with the signed-in admin's own address.
  assert.match(html, new RegExp(`<input id="mail-to" name="to" [^>]*value="${OWNER.replace(/\./g, '\\.')}">`));
  assert.match(html, /<label for="mail-to">Send to<\/label>/);
  assert.doesNotMatch(html, /role="status"/);
});

test('the admin\'s address is escaped in the field', () => {
  const html = adminMailPage({ email: 'a"><script>x</script>@example.com' });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /value="a&quot;&gt;&lt;script&gt;x&lt;\/script&gt;@example\.com"/);
});

test('every reason a send can fail with has a sentence on the page', () => {
  for (const reason of ['not-configured', 'address', 'message', 'quota', 'rate', 'refused', 'unchanged']) {
    assert.match(mailNotice(new URLSearchParams({ error: reason })), /<p role="status">Nothing was sent/, reason);
  }
  assert.match(mailNotice(new URLSearchParams({ done: 'sent' })), /<p role="status">Sent\./);
});

test('a refusal the site made itself does not blame Resend', () => {
  // 'message' is sendMail's own check, which never contacts Resend.
  assert.match(mailNotice(new URLSearchParams({ error: 'message' })), /never contacted Resend/);
});

test('an unconfirmed send is not called unsent, so nobody presses twice on a send that landed', () => {
  const notice = mailNotice(new URLSearchParams({ error: 'unreachable' }));
  assert.doesNotMatch(notice, /Nothing was sent/);
  assert.match(notice, /did not confirm the send: it did not answer within 10 seconds/);
  assert.match(notice, /may still arrive, so look for it before pressing again/);
});

test('a subject or text the site will not send is logged as such, and nothing of it', async () => {
  const lines = await logsOf(() => sendMail(site(), { ...PLANTED, subject: `${PLANTED.subject}\nsecond line` }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^mail: the subject or the text/);
  assert.deepEqual(leaks(lines), []);
  assert.equal(calls.length, 0);
});

test('a crafted query shows only a known sentence and a status code', () => {
  assert.equal(mailNotice(new URLSearchParams({ error: 'nope' })), '');
  assert.equal(mailNotice(new URLSearchParams({ done: '<b>' })), '');
  assert.equal(mailNotice(new URLSearchParams({ error: 'toString' })), '');
  assert.match(mailNotice(new URLSearchParams({ error: 'refused', status: '403' })), /refused the message \(status 403\)\./);
  // '<b>403' and 'x403' hold the pattern's start anchor and '4033' its end.
  for (const status of ['<script>', '<b>403', 'x403', '403<b>', '4033', '200', '500', '']) {
    assert.match(mailNotice(new URLSearchParams({ error: 'refused', status })), /refused the message\. /, status);
  }
});

test('the page shows the notice a press sent it back with', async () => {
  assert.match(await page(site(), '?done=sent'), /<p role="status">Sent\. /);
  assert.match(await page(site(), '?error=quota'), /<p role="status">Nothing was sent: Resend's free limit is used up\./);
});

test('the page passes the photo site\'s html-validate config, and the validator can fail it', async () => {
  for (const query of ['', '?done=sent', '?error=refused&status=403']) {
    assert.deepEqual(await problems(await page(site(), query)), [], query);
  }
  // The control: a second h1 must fail it, so the green results above are readings.
  const html = await page(site());
  assert.notDeepEqual(await problems(html.replace('<h2 ', '<h1>again</h1><h2 ')), []);
});
