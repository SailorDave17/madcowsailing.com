// The invite code on the admin page (#152): showing it, rotating it, and
// making the first one. Every request here runs through the same chain Pages
// runs in front of the route (the root middleware, then the admin guards),
// against a real SQLite holding the real migrations (test/d1.js), with an
// admin's session minted by test/admin.js (#224; Access tokens until then).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as codePage } from '../functions/admin/code.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequestGet as rotateGet, onRequestPost as rotate } from '../functions/api/admin/code/rotate.js';
import { onRequestGet as createGet, onRequestPost as create } from '../functions/api/admin/code/create.js';
import { onRequestPost as join_ } from '../functions/api/join.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestGet as uploadSession } from '../functions/api/upload/session.js';
import { CODE_SCRIPT, adminCodePage, adminHome, timeElement } from '../lib/admin-page.js';
import { ADMIN_SIGN_IN } from '../lib/admin-session.js';
import { ALPHABET, PRODUCTION_SITE, createFirstCode, currentCode, normalizeCode, rotateCode } from '../lib/invite.js';
import { COOKIE_NAME } from '../lib/session.js';
import { ADMIN_KEY, adminCookieHeader, adminData, seedAdmin } from './admin.js';
import { d1, seedCodes } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];

// The page's time text is UTC. Under a UTC clock, local time reads the same,
// so a page that slipped into local time would pass there, and CI's runner is
// UTC. Chatham is 12:45 or 13:45 ahead, so local and UTC differ in date, hour
// AND minutes; a whole-hour zone (Auckland, the first pin) let a minutes-only
// slip through, 0 red (review-fanout, #152). Measured on #152: the local-time
// mutation reddened 2 under Eastern time and 0 with TZ=UTC before any pin.
// Node applies a TZ set at run time, and falls back to UTC silently on a zone
// it cannot resolve, so the first test below checks the pin took.
process.env.TZ = 'Pacific/Chatham';

const SITE = PRODUCTION_SITE;
const OLD = 'Q2WE-R4TY-V6PA';
const CURRENT = 'K7QM-3XRD-9FWB';
const KEYS = {
  SESSION_SIGNING_KEY: ADMIN_KEY,
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
};

// The owner is account 1, whose admin session admin() sends (#224).
function site({ codes = [OLD, CURRENT], SITE_ENV = 'production' } = {}) {
  const DB = d1();
  seedCodes(DB, ...codes);
  seedAdmin(DB);
  return { DB, SITE_ENV, ...KEYS };
}

const codeRows = (env) =>
  env.DB.sqlite.prepare('SELECT generation, code, created_at FROM invite_codes ORDER BY generation').all().map((r) => ({ ...r }));

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

/**
 * A request through the whole chain: `session: null` sends no admin session,
 * `cookie` an upload session beside it, `origin: null` no Origin.
 */
async function admin(env, method, path, { session, origin = SITE, host = SITE, cookie } = {}) {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  const cookies = [
    ...(session !== null ? [session ?? await adminCookieHeader(1)] : []),
    ...(cookie ? [`${COOKIE_NAME}=${cookie}`] : []),
  ];
  if (cookies.length) headers.Cookie = cookies.join('; ');
  const request = new Request(`${host}${path}`, { method, headers });
  const api = {
    POST: { '/api/admin/code/rotate': rotate, '/api/admin/code/create': create },
    GET: { '/api/admin/code/rotate': rotateGet, '/api/admin/code/create': createGet },
  };
  const [guards, route] = path.startsWith('/api/')
    ? [adminApi, api[method][path]]
    : [adminPages, codePage];
  return chain([root, ...guards, route], request, env);
}

const page = async (env, options) => (await admin(env, 'GET', '/admin/code', options)).text();

/** An upload session opened with `code`, as its cookie value. */
async function joinWith(env, code) {
  const request = new Request(`${SITE}/api/join`, {
    method: 'POST',
    headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify({ code }),
  });
  const res = await join_({ request, env });
  const cookie = res.headers.getSetCookie()[0];
  return { status: res.status, error: res.status === 204 ? null : (await res.json()).error, cookie: cookie?.split(';')[0].split('=').slice(1).join('=') };
}

/** GET /api/upload/session with `cookie`: an upload call through the upload guard. */
async function uploadCall(env, cookie) {
  const request = new Request(`${SITE}/api/upload/session`, { headers: { Cookie: `${COOKIE_NAME}=${cookie}` } });
  // The directory's guard is a list since #154 (the session, then the Origin).
  return (await chain([root, uploadGuard, uploadSession].flat(), request, env)).status;
}

test('the zone pin took effect: this process is not on a whole-hour offset', () => {
  assert.notEqual(new Date(0).getTimezoneOffset() % 60, 0, `TZ=${process.env.TZ} did not apply`);
});

// ---- Criterion 1: what the page shows ---------------------------------

test('the page shows the current code, the invite link, and a copy button for each', async (t) => {
  const html = await page(site());
  assert.match(html, /<code id="invite-code">K7QM-3XRD-9FWB<\/code>/);
  assert.match(html, /<code id="invite-link">https:\/\/photos\.madcowsailing\.com\/share\/#code=K7QM-3XRD-9FWB<\/code>/);
  assert.match(html, /<button type="button" class="button" data-copy="invite-code">Copy code<\/button>/);
  assert.match(html, /<button type="button" class="button" data-copy="invite-link">Copy invite link<\/button>/);
  assert.match(html, /<p id="copy-status" role="status"><\/p>/);
  assert.doesNotMatch(html, new RegExp(OLD), 'an earlier code is on the page');
});

test('the page says when the code last changed: rotated, or created and never rotated', () => {
  const at = 1_790_000_061; // 2026-09-21T14:14:21Z
  const rotated = adminCodePage({ current: { generation: 2, code: CURRENT, createdAt: at }, site: SITE });
  assert.match(rotated, /Last rotated <time datetime="2026-09-21T14:14:21\.000Z">21 September 2026, 14:14 UTC<\/time>\./);
  const first = adminCodePage({ current: { generation: 1, code: CURRENT, createdAt: at }, site: SITE });
  assert.match(first, /Created <time datetime="2026-09-21T14:14:21\.000Z">21 September 2026, 14:14 UTC<\/time>\. It has never been rotated\./);
  assert.doesNotMatch(first, /Last rotated/);
});

test('the time is UTC, zero-padded, whatever the machine running it', () => {
  assert.equal(timeElement(0), '<time datetime="1970-01-01T00:00:00.000Z">1 January 1970, 00:00 UTC</time>');
  assert.equal(timeElement(1_798_761_599), '<time datetime="2026-12-31T23:59:59.000Z">31 December 2026, 23:59 UTC</time>');
});

test('the invite link names production\'s domain there, and the page\'s own origin anywhere else', async (t) => {
  // Production, reached on its pages.dev address with an admin's session: still the domain.
  const prod = await page(site(), { host: 'https://madcowphotos.pages.dev', origin: null });
  assert.match(prod, /<code id="invite-link">https:\/\/photos\.madcowsailing\.com\/share\/#code=/);
  const preview = await page(site({ SITE_ENV: 'preview' }), { host: 'https://develop.madcowphotos.pages.dev', origin: null });
  assert.match(preview, /<code id="invite-link">https:\/\/develop\.madcowphotos\.pages\.dev\/share\/#code=K7QM-3XRD-9FWB<\/code>/);
  const local = await page(site({ SITE_ENV: 'preview' }), { host: 'http://127.0.0.1:8788', origin: null });
  assert.match(local, /<code id="invite-link">http:\/\/127\.0\.0\.1:8788\/share\/#code=K7QM-3XRD-9FWB<\/code>/);
});

test('a code is escaped on the page, so a stored value cannot put markup there', () => {
  const html = adminCodePage({ current: { generation: 2, code: '<b>"x"</b>', createdAt: 0 }, site: SITE });
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /<code id="invite-code">&lt;b&gt;&quot;x&quot;&lt;\/b&gt;<\/code>/);
});

test('GET /admin/code answers HTML that no cache may keep, since it carries the code', async (t) => {
  const res = await admin(site(), 'GET', '/admin/code');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
});

test('the admin home links to the page', () => {
  assert.match(block(adminHome(adminData().admin, { waiting: 0, bytes: 0 }), 'main'), /<a href="\/admin\/code">Invite code<\/a>/);
});

// ---- Criterion 2: the dialog --------------------------------------------

// Markup only. What the button DOES, opening the dialog with showModal(), is
// held by the script tests at the end of this file.
test('"Rotate code" is a plain button outside every form, and the page carries the native dialog it opens', () => {
  const html = adminCodePage({ current: { generation: 2, code: CURRENT, createdAt: 0 }, site: SITE });
  const opener = html.match(/<button[^>]*id="rotate-open"[^>]*>([^<]*)<\/button>/);
  assert.ok(opener, 'no rotate-open button');
  assert.equal(opener[1], 'Rotate code');
  assert.match(opener[0], /type="button"/);
  // Outside every form, so it cannot submit one whatever its type.
  const outside = html.replace(/<form[\s\S]*?<\/form>/g, '');
  assert.ok(outside.includes(opener[0]));

  const dialog = block(html, 'dialog');
  assert.ok(dialog, 'no <dialog>');
  assert.match(dialog, /^<dialog id="rotate-dialog" class="confirm" aria-labelledby="rotate-title">/);
  assert.match(dialog, /<h2 id="rotate-title">/);
  assert.match(dialog, /Every parent signed in to upload will need the new link\./);
  // A coach's session survives a rotation (#192, owner at pickup), and the
  // dialog says so rather than promising to end every session.
  assert.match(dialog, /Coaches\s+who signed in at \/coach keep sending\./);
});

test('only the dialog\'s confirm button rotates: one form posts there, and its other button closes the dialog', () => {
  const html = adminCodePage({ current: { generation: 2, code: CURRENT, createdAt: 0 }, site: SITE });
  const posting = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0])
    .filter((f) => /action="\/api\/admin\/code\/rotate"/.test(f));
  assert.equal(posting.length, 1, 'one form, and only one, posts to rotate');
  const [form] = posting;
  assert.match(form, /^<form method="post" action="\/api\/admin\/code\/rotate">/);
  assert.ok(block(html, 'dialog').includes(form), 'the rotate form is inside the dialog');

  const buttons = [...form.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(([, attrs, name]) => ({ attrs, name }));
  const posts = buttons.filter((b) => /type="submit"/.test(b.attrs) && !/formmethod="dialog"/.test(b.attrs));
  assert.deepEqual(posts.map((b) => b.name), ['Rotate now']);
  const cancel = buttons.find((b) => b.name === 'Cancel');
  assert.match(cancel.attrs, /formmethod="dialog"/);
  // Cancel first: the form's default button, so Enter cancels, and the focus when it opens.
  assert.equal(buttons[0].name, 'Cancel');
  assert.match(cancel.attrs, /\sautofocus\b/);
  assert.equal(html.match(/action="\/api\/admin\/code\/create"/), null, 'a page with a code offers no create');
});

test('rotating makes the next generation a new, well-formed code, and answers 303 back to the page', async (t) => {
  const env = site();
  const res = await admin(env, 'POST', '/api/admin/code/rotate');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/admin/code');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');

  const rows = codeRows(env);
  assert.deepEqual(rows.map((r) => r.generation), [1, 2, 3]);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.code), [OLD, CURRENT], 'earlier codes are kept');
  const made = rows[2];
  assert.notEqual(made.code, CURRENT);
  assert.match(made.code, new RegExp(`^[${ALPHABET}]{4}-[${ALPHABET}]{4}-[${ALPHABET}]{4}$`));
  assert.equal(normalizeCode(made.code), made.code.replaceAll('-', ''));
  assert.ok(Math.abs(made.created_at - Date.now() / 1000) <= 2);
});

test('after rotating, the page shows the new code and not the old one', async (t) => {
  const env = site();
  await admin(env, 'POST', '/api/admin/code/rotate');
  const { code } = await currentCode(env.DB);
  const html = await page(env);
  assert.match(html, new RegExp(`<code id="invite-code">${code}</code>`));
  assert.match(html, new RegExp(`share/#code=${code}</code>`));
  assert.doesNotMatch(html, new RegExp(CURRENT));
  assert.match(html, /Last rotated <time/);
});

test('two rotations make two generations, and each new code differs from every earlier one', async (t) => {
  const env = site();
  await admin(env, 'POST', '/api/admin/code/rotate');
  await admin(env, 'POST', '/api/admin/code/rotate');
  const rows = codeRows(env);
  assert.deepEqual(rows.map((r) => r.generation), [1, 2, 3, 4]);
  assert.equal(new Set(rows.map((r) => r.code)).size, 4);
});

// ---- Criterion 3: every session ends at once ------------------------------

test('two sessions opened with the old code: after a rotation each next upload call is 401, the old link reads rotated, and the new one joins', async (t) => {
  const env = site();
  const a = await joinWith(env, CURRENT);
  const b = await joinWith(env, CURRENT);
  assert.equal(a.status, 204);
  assert.equal(b.status, 204);
  // The control: both sessions work before the rotation.
  assert.equal(await uploadCall(env, a.cookie), 204);
  assert.equal(await uploadCall(env, b.cookie), 204);

  assert.equal((await admin(env, 'POST', '/api/admin/code/rotate')).status, 303);

  assert.equal(await uploadCall(env, a.cookie), 401);
  assert.equal(await uploadCall(env, b.cookie), 401);
  const old = await joinWith(env, CURRENT);
  assert.deepEqual([old.status, old.error, old.cookie], [403, 'rotated', undefined]);

  const { code } = await currentCode(env.DB);
  const c = await joinWith(env, code);
  assert.equal(c.status, 204);
  assert.equal(await uploadCall(env, c.cookie), 204);
});

// ---- Criterion 4: refused without the owner, or from another site ---------

// Since #224 a request with no admin session that holds is sent to the
// sign-in, 303 (lib/admin-session.js); one from another site is the Origin
// guard's 403, as before. Account 99 does not exist.
const REFUSALS = {
  'no admin session': { session: null, status: 303 },
  'an admin session signed with another key': { session: () => adminCookieHeader(1, { key: `${ADMIN_KEY}-other` }), status: 303 },
  'an admin session for an account that does not exist': { session: () => adminCookieHeader(99), status: 303 },
  'a foreign Origin': { origin: 'https://evil.example', status: 403 },
  'a sibling site\'s Origin': { origin: 'https://madcowsailing.com', status: 403 },
  'no Origin': { origin: null, status: 403 },
  // What a sandboxed frame or a data: URL page sends: a check that let the
  // opaque origin through would be open to any page that sandboxes itself.
  'the opaque Origin "null"': { origin: 'null', status: 403 },
  'the origin spelled with another scheme': { origin: 'http://photos.madcowsailing.com', status: 403 },
};

for (const path of ['/api/admin/code/rotate', '/api/admin/code/create']) {
  for (const [name, { status, ...options }] of Object.entries(REFUSALS)) {
    test(`POST ${path} with ${name}: ${status}, and the codes are unchanged`, async () => {
      const env = site({ codes: path.endsWith('create') ? [] : [OLD, CURRENT] });
      const before = codeRows(env);
      const session = typeof options.session === 'function' ? await options.session() : options.session;
      const res = await admin(env, 'POST', path, { ...options, session });
      assert.equal(res.status, status);
      if (status === 303) assert.equal(res.headers.get('Location'), ADMIN_SIGN_IN);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(codeRows(env), before);
    });
  }
}

test('a foreign Origin is refused by the Origin guard, with its own reason', async (t) => {
  const res = await admin(site(), 'POST', '/api/admin/code/rotate', { origin: 'https://evil.example' });
  assert.deepEqual(await res.json(), { error: 'origin' });
});

test('with the owner\'s session and the site\'s Origin, on any hostname, the same POST goes through', async (t) => {
  // The control for the refusals above: each one is the guard's.
  for (const host of [SITE, 'https://madcowphotos.pages.dev', 'http://localhost:8788']) {
    const env = site();
    const res = await admin(env, 'POST', '/api/admin/code/rotate', { host, origin: host });
    assert.equal(res.status, 303, host);
    assert.equal(codeRows(env).length, 3, host);
  }
});

// ---- Criterion 5: no code yet ---------------------------------------------

test('with no code, the page offers "Create code" and nothing to copy or rotate', async (t) => {
  const html = await page(site({ codes: [] }));
  assert.match(html, /<form method="post" action="\/api\/admin\/code\/create">\s*<p><button type="submit" class="button">Create code<\/button><\/p>\s*<\/form>/);
  // A coach needs no code (#192, owner at its review), so the page says no
  // parent can send, not that nobody can.
  assert.match(html, /There is no invite code, so no parent can send photos\. Coaches\s+who\s+signed in at \/coach still can\./);
  for (const absent of ['<dialog', 'data-copy', 'invite-code"', '/api/admin/code/rotate', 'rotate-open']) {
    assert.ok(!html.includes(absent), `the no-code page carries ${absent}`);
  }
});

test('with no code, parents\' uploads stay closed: no code joins and no session passes the upload guard', async (t) => {
  const env = site({ codes: [] });
  for (const code of [CURRENT, OLD, '0000-0000-0000']) {
    const j = await joinWith(env, code);
    assert.deepEqual([j.status, j.cookie], [403, undefined], code);
  }
});

test('"Create code" makes generation 1, and the page then shows it', async (t) => {
  const env = site({ codes: [] });
  const res = await admin(env, 'POST', '/api/admin/code/create');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/admin/code');
  const rows = codeRows(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].generation, 1);
  assert.match(rows[0].code, new RegExp(`^[${ALPHABET}]{4}-[${ALPHABET}]{4}-[${ALPHABET}]{4}$`));
  const html = await page(env);
  assert.match(html, new RegExp(`<code id="invite-code">${rows[0].code}</code>`));
  assert.match(html, /It has never been rotated\./);

  // And uploads open: the new code joins.
  const j = await joinWith(env, rows[0].code);
  assert.equal(j.status, 204);
});

test('"Create code" once a code exists changes nothing, so a stale page cannot end a session', async (t) => {
  const env = site();
  const s = await joinWith(env, CURRENT);
  const before = codeRows(env);
  const res = await admin(env, 'POST', '/api/admin/code/create');
  assert.equal(res.status, 303);
  assert.deepEqual(codeRows(env), before);
  assert.equal(await uploadCall(env, s.cookie), 204);
});

// Through the whole chain each request runs start to end before the other
// gets going, so this cannot see a read-then-write race (review-fanout, #152,
// measured 0 red on one). It holds the answer; the two below hold the race.
test('two presses of "Create code" both answer 303 and leave one code', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = site({ codes: [] });
  const both = await Promise.all([admin(env, 'POST', '/api/admin/code/create'), admin(env, 'POST', '/api/admin/code/create')]);
  assert.deepEqual(both.map((r) => r.status), [303, 303]);
  assert.equal(codeRows(env).length, 1);
});

// Called directly, both calls reach the database before either has finished,
// so a version that read the table first and wrote after would make two codes
// (create) or collide on a generation (rotate). lib/invite.js says each is
// one statement for exactly this.
test('createFirstCode twice at once makes one code, and neither call fails', async () => {
  const env = site({ codes: [] });
  await Promise.all([createFirstCode(env.DB, 100), createFirstCode(env.DB, 100)]);
  assert.deepEqual(codeRows(env).map((r) => r.generation), [1]);
});

test('rotateCode twice at once makes two new generations, and neither call fails', async () => {
  const env = site();
  await Promise.all([rotateCode(env.DB, 100), rotateCode(env.DB, 100)]);
  assert.deepEqual(codeRows(env).map((r) => r.generation), [1, 2, 3, 4]);
});

// ---- A press that arrives as a GET (review-fanout #9) ---------------------

test('a GET on either write route changes nothing and goes back to the page, saying so', async (t) => {
  for (const [path, codes, key] of [['/api/admin/code/rotate', [OLD, CURRENT], 'rotate'], ['/api/admin/code/create', [], 'create']]) {
    const env = site({ codes });
    const before = codeRows(env);
    // No Origin: a GET needs none, which is why it must never write.
    const res = await admin(env, 'GET', path, { origin: null });
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get('Location'), `/admin/code?unchanged=${key}`, path);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', path);
    assert.deepEqual(codeRows(env), before, path);
  }
});

test('the page says nothing changed, only in the state its button lives in', async (t) => {
  const statuses = (html) => [...html.matchAll(/<p role="status">([^<]*)<\/p>/g)].map((m) => m[1].split('.')[0]);
  const withCode = site();
  const empty = site({ codes: [] });
  const read =async (env, query) => statuses(await (await admin(env, 'GET', `/admin/code${query}`, { origin: null })).text());
  assert.deepEqual(await read(withCode, '?unchanged=rotate'), ['The code was not rotated']);
  assert.deepEqual(await read(withCode, '?unchanged=create'), []);
  assert.deepEqual(await read(empty, '?unchanged=create'), ['No code was made']);
  assert.deepEqual(await read(empty, '?unchanged=rotate'), []);
  assert.deepEqual(await read(withCode, '?unchanged=constructor'), []);
  assert.deepEqual(await read(withCode, ''), []);
});

// ---- The page itself --------------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html) => validator.validateString(html, join(ROOT, 'admin.html'));
const withCode = adminCodePage({ current: { generation: 2, code: CURRENT, createdAt: 1_790_000_000 }, site: SITE });
const noCode = adminCodePage({ current: null, site: SITE });

test('every state passes the photo site\'s html-validate config, and the validator can fail it', async () => {
  const notices = [
    adminCodePage({ current: { generation: 2, code: CURRENT, createdAt: 1_790_000_000 }, site: SITE, unchanged: 'rotate' }),
    adminCodePage({ current: null, site: SITE, unchanged: 'create' }),
  ];
  assert.ok(notices.every((html) => html.includes('<p role="status">')), 'the notice states carry their notice');
  for (const html of [withCode, noCode, ...notices]) {
    const report = await validate(html);
    assert.deepEqual(report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)), []);
    assert.equal(report.valid, true);
    assert.equal((await validate(html.replace('<h2 ', '<h1>again</h1><h2 '))).valid, false);
  }
});

test('one h1, a main, noindex, and no inline script, style or handler', () => {
  for (const html of [withCode, noCode]) {
    assert.equal(html.match(/<h1[\s>]/g).length, 1);
    assert.match(html, /<main id="main">/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(html.replace(CODE_SCRIPT, ''), /<script|<style|\sstyle="|\son[a-z]+="/i);
  }
});

test('its chrome and stylesheets are the admin home\'s, and its one script is stamped with its own hash', () => {
  const home = adminHome(adminData().admin, { waiting: 0, bytes: 0 });
  for (const html of [withCode, noCode]) {
    assert.equal(block(html, 'header'), block(home, 'header'));
    assert.equal(block(html, 'footer'), block(home, 'footer'));
    assert.equal(block(html, 'head').replace(`\n${CODE_SCRIPT}`, '').replace(/<title>[^<]*<\/title>/, ''),
      block(home, 'head').replace(/<title>[^<]*<\/title>/, ''));
  }
  const bytes = readFileSync(join(ROOT, 'public', 'js', 'admin-code.js'));
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  assert.equal(CODE_SCRIPT, `<script src="/js/admin-code.js?v=${version}" defer></script>`,
    'public/js/admin-code.js changed: copy its new ?v= into CODE_SCRIPT in lib/admin-page.js');
});

test('the script is a static file outside /admin, and names every element it reaches for', () => {
  const script = read('public', 'js', 'admin-code.js');
  for (const id of script.matchAll(/getElementById\('([^']+)'\)/g)) {
    assert.match(withCode, new RegExp(`id="${id[1]}"`), `admin-code.js reaches for #${id[1]}, which the page lacks`);
  }
  for (const [, target] of withCode.matchAll(/data-copy="([^"]+)"/g)) {
    assert.match(script, new RegExp(`'${target}':`), `no copied message for ${target}`);
    assert.match(withCode, new RegExp(`id="${target}"`));
  }
});

// ---- The script itself (review-fanout #1) -------------------------------------
//
// public/js/admin-code.js, run as the browser runs it, against hand-written
// stand-ins for the few DOM calls it makes: the repo's way with D1 and R2,
// with no DOM library. Before these, deleting the Rotate listener, calling
// show() for showModal(), a wrong copy target or .value for .textContent each
// reddened only the ?v= stamp test (the review's refuter measured all four).
// The browser run on #152's PR shows the same behaviour in Chrome.

const SCRIPT = read('public', 'js', 'admin-code.js');
const LINK = `${SITE}/share/#code=${CURRENT}`;

function runScript({ clipboard = 'works' } = {}) {
  const el = (props = {}) => ({
    textContent: '', dataset: {}, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    ...props,
  });
  const calls = [];
  const nodes = {
    'invite-code': el({ textContent: CURRENT }),
    'invite-link': el({ textContent: LINK }),
    'copy-status': el(),
    'rotate-open': el(),
    'rotate-dialog': el({ showModal: () => calls.push('showModal'), show: () => calls.push('show') }),
  };
  const copyButtons = [el({ dataset: { copy: 'invite-code' } }), el({ dataset: { copy: 'invite-link' } })];
  const time = el({ dateTime: '2026-09-21T14:14:21.000Z', textContent: '21 September 2026, 14:14 UTC' });
  const selectors = { 'button[data-copy]': copyButtons, 'time[datetime]': [time] };
  const copied = [];
  const document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelectorAll: (selector) => {
      if (!(selector in selectors)) throw new Error(`the script asked for ${selector}, which this stand-in does not know`);
      return selectors[selector];
    },
  };
  const navigator = {
    clipboard: {
      async writeText(text) {
        if (clipboard === 'refuses') throw new Error('NotAllowedError');
        copied.push(text);
      },
    },
  };
  vm.runInNewContext(SCRIPT, { document, navigator, Date });
  const click = async (element) => { await element.listeners.click?.(); };
  return { nodes, copyButtons, time, calls, copied, click };
}

test('the script: "Copy code" copies the code and "Copy invite link" the link, and each says so', async () => {
  const page = runScript();
  await page.click(page.copyButtons[0]);
  assert.deepEqual(page.copied, [CURRENT]);
  assert.equal(page.nodes['copy-status'].textContent, 'Code copied.');
  await page.click(page.copyButtons[1]);
  assert.deepEqual(page.copied, [CURRENT, LINK]);
  assert.equal(page.nodes['copy-status'].textContent, 'Invite link copied.');
});

test('the script: a refused clipboard says to copy by hand, and copies nothing', async () => {
  const page = runScript({ clipboard: 'refuses' });
  await page.click(page.copyButtons[1]);
  assert.deepEqual(page.copied, []);
  assert.equal(page.nodes['copy-status'].textContent, "Couldn't copy. Select it above and copy it by hand.");
});

test('the script: "Rotate code" opens the dialog as a modal, once, and nothing else does', async () => {
  const page = runScript();
  assert.deepEqual(page.calls, [], 'the dialog opened before anything was pressed');
  await page.click(page.copyButtons[0]);
  assert.deepEqual(page.calls, []);
  await page.click(page.nodes['rotate-open']);
  assert.deepEqual(page.calls, ['showModal']);
});

test('the script: the change time is rewritten into the reader\'s own zone', () => {
  // Pinned to Chatham above, 14:14 UTC on the 21st is 02:59 on the 22nd.
  const { time } = runScript();
  assert.notEqual(time.textContent, '21 September 2026, 14:14 UTC');
  assert.match(time.textContent, /22/);
  assert.match(time.textContent, /2026/);
  assert.match(time.textContent, /59/);
});
