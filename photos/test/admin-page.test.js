// The admin home (#151, criteria 1 and 6): what the owner sees once the
// guard lets them through, and the copy of the site's chrome it carries.
//
// The page is rendered by a Function, so the gate's `npm run check` (which
// globs HTML files) never sees it. This validates the rendered page with the
// photo site's own html-validate config instead, and holds its header, footer
// and stylesheet stamps equal to the static pages'.
//
// Since #274 (criterion 4) "Your sign-in" says when this phone's admin
// session ends, which is its own length: 12 hours, or 30 days on a phone the
// admin asked the site to remember. Below it is "Forget this phone", on every
// home, remembered or not (the owner's choice at #274's pickup), above Sign
// out. The times are UTC by construction, and the process is pinned to a zone
// off UTC by a part-hour, so a slip into the local zone shows (below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { SECTIONS, TODO, adminHome, todoItem } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { onRequest as guards } from '../functions/admin/_middleware.js';
import { onRequestGet as home } from '../functions/admin/index.js';
import { onRequestGet as session } from '../functions/api/admin/session.js';
import { ADMIN_KEY, adminCookieHeader, seedAdmin } from './admin.js';
import { d1 } from './d1.js';

// Every time on the home is written in UTC (lib/admin-page.js, utcText reads
// getUTC*). Pinned to Chatham, which differs from UTC in date, hour and
// minutes, as test/queue.test.js pins it, so a slip into the local zone
// moves the times the tests below read, on any machine: the 12 hours' end,
// 02:13 UTC on 22 September, is 14:58 there, and the 30 days', 14:13 UTC on
// 21 October, is 03:58 on the 22nd (#274). Set before the first Date below;
// the first test checks the pin took.
process.env.TZ = 'Pacific/Chatham';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];

const EMAIL = 'owner@example.com';
// What the admin guard leaves on context.data.admin (#224): signed in at
// 2026-09-21T14:13:20Z, so the 12 hours end at 02:13 UTC the next day. Since
// #274 the guard also leaves `seconds`, the session's length; this one is
// built by hand without it, and reads as 12 hours (held below).
const ADMIN = { id: 1, name: 'Owner', email: EMAIL, role: 'owner', issued: 1_790_000_000 };
// The same admin on a remembered phone (#274): 30 days, which end at the
// same moment on 21 October.
const REMEMBERED = { ...ADMIN, seconds: 2_592_000 };
const EMPTY = { waiting: 0, removals: 0, bytes: 0 };
const page = adminHome(ADMIN, EMPTY);
const remembered = adminHome(REMEMBERED, EMPTY);

// Where the gate would find the page if it were a file: photos/, so the
// validator reads photos/.htmlvalidate.json and the root config above it.
const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html) => validator.validateString(html, join(ROOT, 'admin.html'));

function staticPages(dir = join(ROOT, 'public'), prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'assets') continue; // the build's copy of shared/
    if (statSync(full).isDirectory()) out.push(...staticPages(full, `${prefix}${name}/`));
    else if (name.endsWith('.html')) out.push(`${prefix}${name}`);
  }
  return out;
}

test('the zone pin took effect: this process is not on a whole-hour offset, and both ends read otherwise in it', () => {
  assert.notEqual(new Date(0).getTimezoneOffset() % 60, 0, `TZ=${process.env.TZ} did not apply`);
  // What a slip from getUTC* to the local getters would print instead.
  const local = (seconds) => { const d = new Date(seconds * 1000); return [d.getDate(), d.getHours(), d.getMinutes()]; };
  assert.deepEqual(local(1_790_043_200), [22, 14, 58]);
  assert.deepEqual(local(1_792_592_000), [22, 3, 58]);
});

test('the admin home says who is signed in, as the owner or an admin, and when the 12 hours end (#224)', () => {
  assert.match(page, /<p class="signed-in">Signed in as Owner, owner@example\.com, the owner\. The admin pages stay open until <time datetime="2026-09-22T02:13:20\.000Z">22 September 2026, 02:13 UTC<\/time>, then ask you to sign in again\.<\/p>/);
  assert.match(adminHome({ ...ADMIN, role: 'admin' }, EMPTY), /owner@example\.com, an admin\. /);
});

test('a remembered phone\'s home says it is remembered, and when its 30 days end (#274, criterion 4)', () => {
  assert.match(remembered, /<p class="signed-in">Signed in as Owner, owner@example\.com, the owner\. This phone is remembered: the admin pages stay open on it until <time datetime="2026-10-21T14:13:20\.000Z">21 October 2026, 14:13 UTC<\/time>, then ask you to sign in again\.<\/p>/);
  assert.match(adminHome({ ...REMEMBERED, role: 'admin' }, EMPTY), /owner@example\.com, an admin\. This phone is remembered: /);
  // It says nothing of 12 hours, nor of their end.
  assert.doesNotMatch(remembered, /The admin pages stay open until|2026-09-22T02:13:20/);
});

test('a 12-hour session never reads as remembered, whether the guard names its length or a hand-built admin leaves it out (#274, criterion 4)', () => {
  // `page` is ADMIN's home, built with no `seconds`, which the #224 test
  // above reads as 12 hours. The guard's own 12-hour admin names 43_200, and
  // draws the same page byte for byte.
  assert.equal(Object.hasOwn(ADMIN, 'seconds'), false);
  assert.equal(adminHome({ ...ADMIN, seconds: 43_200 }, EMPTY), page);
  assert.doesNotMatch(page, /remembered/);
  // The control: the comparison can tell the two lengths apart.
  assert.notEqual(remembered, page);
});

/** GET /admin through the admin directory's guards (functions/admin/_middleware.js), as Pages runs them, carrying `cookie`. */
async function throughGuards(db, cookie) {
  const request = new Request('https://photos.madcowsailing.com/admin', { headers: { Cookie: cookie } });
  const env = { DB: db, SESSION_SIGNING_KEY: ADMIN_KEY };
  const stack = [...guards, home];
  const data = {};
  const context = (i) => ({ request, env, params: {}, data, waitUntil() {}, next: () => stack[i + 1](context(i + 1)) });
  return stack[0](context(0));
}

test('through the guard, the home names the end of the cookie\'s own length: 30 days on, read 13 hours after sign-in (#274, criterion 4)', async (t) => {
  // 13 hours after 14:13:20 UTC on 21 September, past any 12-hour session,
  // so a page drawn here can only be a remembered one. A guard that dropped
  // the length on the way would draw the 12-hour sentence, naming an end
  // already an hour gone.
  t.mock.timers.enable({ apis: ['Date'], now: 1_790_046_800_000 });
  const db = d1();
  const id = seedAdmin(db);
  const res = await throughGuards(db, await adminCookieHeader(id, { issued: 1_790_000_000, seconds: 2_592_000 }));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /This phone is remembered: the admin pages stay open on it until <time datetime="2026-10-21T14:13:20\.000Z">21 October 2026, 14:13 UTC<\/time>, then ask you to sign in again\./);
  // The control, at the same clock: the same sign-in without the tick is
  // refused, to the sign-in.
  const twelve = await throughGuards(db, await adminCookieHeader(id, { issued: 1_790_000_000 }));
  assert.equal(twelve.status, 303);
  assert.equal(twelve.headers.get('Location'), '/sign-in?admin');
});

/** The "Your sign-in" section of `html`'s <main>, which carries both of the home's buttons. */
const signInSection = (html) => block(html, 'main').match(/<section class="wrap admin-sign-in" aria-labelledby="admin-you">[\s\S]*?<\/section>/)?.[0];

test('"Forget this phone" is on every admin home, 12-hour and remembered, in "Your sign-in", above Sign out (#274, criterion 4)', () => {
  for (const [name, html] of [['12-hour', page], ['remembered', remembered]]) {
    const section = signInSection(html);
    assert.ok(section, `the ${name} home has no "Your sign-in" section with class admin-sign-in`);
    assert.match(section, /^<section[^>]*>\s*<h2 id="admin-you">Your sign-in<\/h2>\s*<p class="signed-in">/);
    // Two forms, Forget this phone first, so a thumb reaching for the
    // narrower one meets it before the one that ends every device.
    const forms = [...section.matchAll(/<form method="post" action="([^"]+)">[\s\S]*?<\/form>/g)];
    assert.deepEqual(forms.map((m) => m[1]), ['/api/admin/forget', '/sign-out'], name);
    // The whole form: its hint, its one button described by the hint, and
    // nothing else posted.
    assert.match(forms[0][0], /^<form method="post" action="\/api\/admin\/forget">\s*<p class="hint" id="admin-forget-hint">Forgetting this phone closes the admin pages in this browser only\. It stays signed in to send photos, and your other phones and computers are not changed\.<\/p>\s*<p class="actions"><button type="submit" class="button" aria-describedby="admin-forget-hint">Forget this phone<\/button><\/p>\s*<\/form>$/, name);
    // Sign out, exactly as the #224 test reads it.
    assert.match(forms[1][0], /<button type="submit" class="button" aria-describedby="admin-sign-out-hint">Sign out<\/button>/, name);
    assert.match(forms[1][0], /<p class="hint" id="admin-sign-out-hint">Signing out signs you out on every phone and computer signed in to your account, for sending photos as well\.<\/p>/, name);
    // Nowhere else on the page posts to it.
    assert.equal(html.match(/\/api\/admin\/forget/g).length, 1, name);
  }
  // The control: a page with the forms swapped is read as out of order.
  const swapped = page.replace(/(<form method="post" action="\/api\/admin\/forget">[\s\S]*?<\/form>)(\s*)(<form method="post" action="\/sign-out">[\s\S]*?<\/form>)/, '$3$2$1');
  assert.notEqual(swapped, page);
  assert.deepEqual([...signInSection(swapped).matchAll(/<form method="post" action="([^"]+)">/g)].map((m) => m[1]), ['/sign-out', '/api/admin/forget']);
});

// ---- #269: the home is a to-do list of what is waiting ----------------------

const T0 = 1_790_000_000;
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };

/** The `<ul class="todo">`'s items: each one's classes, link, count and words, in page order. */
function todoList(html) {
  const list = block(html, 'main').match(/<ul class="todo">([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(list, 'no to-do list');
  return [...list.matchAll(/<li><a class="([^"]+)" href="([^"]+)"><span class="todo-count">(\d+)<\/span> <span>([^<]*)<\/span><\/a><\/li>/g)]
    .map(([, classes, href, count, words]) => ({ classes, href, count: Number(count), words }));
}

/**
 * A photo row in `state` (#154's shape), or a clip (#198's), in the album at
 * `address`. A clip `uploading` names its upload, as migration 0016 requires,
 * and one in any other state names none.
 */
function seedRow(db, address, { kind = 'photo', state }) {
  const albumId = db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const key = db.sqlite.prepare('SELECT COUNT(*) AS n FROM photos').get().n.toString(16).padStart(32, '0');
  const approvedAt = state === 'pending' || state === 'uploading' ? null : T0 + 1;
  const hiddenAt = state === 'hidden' ? T0 + 2 : null;
  if (kind === 'clip') {
    db.sqlite.prepare(
      'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
      'captured_at, sent_at, width, height, bytes, content_type, duration_ms, upload_id, approved_at, hidden_at) ' +
      "VALUES (?, 'clip', ?, ?, 'b', 'parent', 1, 1, ?, ?, 1920, 1080, 5000000, 'video/mp4', 30000, ?, ?, ?)",
    ).run(albumId, state, key, T0, T0, state === 'uploading' ? `upload-${key}` : null, approvedAt, hiddenAt);
    return;
  }
  db.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at, hidden_at) ' +
    "VALUES (?, 'photo', ?, ?, 'b', 'parent', 1, 1, ?, ?, 2560, 1920, 480, 360, 1600, 1200, 1000, ?, ?)",
  ).run(albumId, state, key, T0, T0, approvedAt, hiddenAt);
}

/** An account asking for `teams` in `state`, as #220's form and #221's decisions leave it. */
function seedPerson(db, email, teams) {
  const { lastInsertRowid } = db.sqlite
    .prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES (?, ?, 'parent', ?)")
    .run(email, email.split('@')[0], T0);
  for (const [team, state] of Object.entries(teams)) {
    db.sqlite.prepare('INSERT INTO account_teams (account_id, team, state) VALUES (?, ?, ?)').run(lastInsertRowid, team, state);
  }
}

/** GET /admin over `db`, as the guard leaves it. */
const homeOf = async (db) => (await home({ data: { admin: ADMIN }, env: { DB: db } })).text();

test('/admin opens on what is waiting: photos and clips, account requests and removal requests, in that order, each counted from the rows (#269, criterion 1; #198; #310, criterion 6)', async () => {
  const db = d1();
  seedAdmin(db);
  const fall = await createAlbum(db, FALL, T0);
  // Counts chosen apart, 3 photos and 4 clips, 2 and 5, so two counts
  // swapped between items read wrong. Since #198 a waiting clip counts beside
  // the photos, named apart (owner, at #198's pickup). Since #310 a hidden
  // clip is a removal request, as a hidden photo is, since "Hide all" takes
  // an account's clips to /admin/removals with its photos: one hidden photo
  // and four hidden clips, one number. Beside each, rows that must not count:
  // an approved photo, an approved clip, and a clip whose parts are still
  // arriving; for the requests, a person asking for both teams (one person,
  // counted once), and people approved, turned down or revoked.
  for (let i = 0; i < 3; i++) seedRow(db, fall, { state: 'pending' });
  for (let i = 0; i < 4; i++) seedRow(db, fall, { kind: 'clip', state: 'pending' });
  seedRow(db, fall, { state: 'approved' });
  seedRow(db, fall, { kind: 'clip', state: 'approved' });
  seedRow(db, fall, { kind: 'clip', state: 'uploading' });
  seedRow(db, fall, { state: 'hidden' });
  for (let i = 0; i < 4; i++) seedRow(db, fall, { kind: 'clip', state: 'hidden' });
  seedPerson(db, 'both@example.org', { 'hoover-jrt': 'requested', cohssa: 'requested' });
  seedPerson(db, 'one@example.org', { 'hoover-jrt': 'approved', cohssa: 'requested' });
  seedPerson(db, 'done@example.org', { 'hoover-jrt': 'approved' });
  seedPerson(db, 'no@example.org', { cohssa: 'rejected' });
  seedPerson(db, 'gone@example.org', { 'hoover-jrt': 'revoked' });
  const html = await homeOf(db);
  assert.deepEqual(todoList(html), [
    { classes: 'button todo-item', href: '/admin/queue', count: 3, words: 'photos and 4 clips waiting for approval' },
    { classes: 'button todo-item', href: '/admin/people', count: 2, words: 'account requests waiting' },
    { classes: 'button todo-item', href: '/admin/removals', count: 5, words: 'removal requests waiting' },
  ]);
  // It opens on them: the list is the section right after the page's head,
  // ahead of the links and of who is signed in.
  const headings = [...block(html, 'main').matchAll(/<h[12][^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Photo site admin', 'Waiting for you', 'Manage the site', 'Your sign-in']);
});

test('a zero is shown, in the quiet button, and reads as nothing to do; a count above it does not (#269, criteria 1 and 2)', async () => {
  // Zero included: an empty site, its admin the one account, approved.
  const db = d1();
  seedAdmin(db);
  await createAlbum(db, FALL, T0);
  assert.deepEqual(todoList(await homeOf(db)), [
    { classes: 'button button-quiet todo-item', href: '/admin/queue', count: 0, words: 'photos waiting for approval. Nothing to do.' },
    { classes: 'button button-quiet todo-item', href: '/admin/people', count: 0, words: 'account requests waiting. Nothing to do.' },
    { classes: 'button button-quiet todo-item', href: '/admin/removals', count: 0, words: 'removal requests waiting. Nothing to do.' },
  ]);
  // Mixed: each item reads its own count, so one zero among two others stays a zero.
  const mixed = todoList(adminHome(ADMIN, { waiting: 2, requests: 0, removals: 1, bytes: 0 }));
  assert.deepEqual(mixed.map(({ count, classes }) => [count, classes]), [
    [2, 'button todo-item'], [0, 'button button-quiet todo-item'], [1, 'button todo-item'],
  ]);
  assert.deepEqual(mixed.map(({ words }) => words.includes('Nothing to do')), [false, true, false]);
});

test('each item reads one and many right', () => {
  const [photos, requests, removals] = TODO;
  assert.match(todoItem(photos, 1), /<span>photo waiting for approval<\/span>/);
  assert.match(todoItem(photos, 2), /<span>photos waiting for approval<\/span>/);
  assert.match(todoItem(requests, 1), /<span>account request waiting<\/span>/);
  assert.match(todoItem(requests, 12), /<span>account requests waiting<\/span>/);
  assert.match(todoItem(removals, 1), /<span>removal request waiting<\/span>/);
  assert.match(todoItem(removals, 0), /<span>removal requests waiting\. Nothing to do\.<\/span>/);
});

test('each to-do item is a full-width button at least 44 px tall, by the stylesheet (#269, criterion 1)', () => {
  const css = read('public', 'css', 'site.css');
  const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  const item = rule('.todo-item');
  assert.match(item, /display: flex;/);
  assert.match(item, /width: 100%;/);
  const height = item.match(/min-height: var\((--[a-z0-9-]+)\);/)?.[1];
  assert.ok(height, 'no min-height token on .todo-item');
  // The token, resolved: rem at the browser's 16 px.
  const rem = Number(read('..', 'shared', 'css', 'tokens.css').match(new RegExp(`${height}:\\s*([0-9.]+)rem;`))?.[1]);
  assert.ok(rem * 16 >= 44, `${height} is ${rem * 16} px, under 44`);
  // The control: the matcher reads a rule's body, and a rule that is not there reads empty.
  assert.equal(rule('.no-such-rule'), '');
});

test('the admin home has Sign out, a form posting to /sign-out that says it ends every session (#224)', () => {
  const form = block(page, 'main').match(/<form method="post" action="\/sign-out">[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'no sign-out form');
  assert.match(form, /<button type="submit" class="button" aria-describedby="admin-sign-out-hint">Sign out<\/button>/);
  assert.match(form, /<p class="hint" id="admin-sign-out-hint">Signing out signs you out on every phone and computer signed in to your account, for sending photos as well\.<\/p>/);
});

test('the name and email are escaped, so an account cannot put markup on the page', () => {
  const html = adminHome({ ...ADMIN, name: '<i>Jo</i>', email: 'a<b>"c\'&@example.com' }, EMPTY);
  assert.match(html, /Signed in as &lt;i&gt;Jo&lt;\/i&gt;, a&lt;b&gt;&quot;c&#39;&amp;@example\.com, the owner\./);
  assert.doesNotMatch(html, /a<b>|<i>Jo/);
});

test('albums, people and email follow the list as links, then the storage (#269, criterion 2; the invite code went at #226)', () => {
  const main = block(page, 'main');
  // Every link on the page: the three items, then the three sections. The
  // invite code was the first section until #226 retired the invite link.
  const hrefs = [...main.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/admin/queue', '/admin/people', '/admin/removals', '/admin/albums', '/admin/people', '/admin/mail']);
  assert.deepEqual(hrefs.slice(0, 3), TODO.map((t) => t.href));
  assert.deepEqual(hrefs.slice(3), SECTIONS.map((s) => s.href));
  // The links are a list under "Manage the site", and the storage a line after it.
  const manage = main.match(/<h2 id="admin-sections">Manage the site<\/h2>\s*<ul class="admin-links">([\s\S]*?)<\/ul>\s*<p class="admin-storage">([^<]*)<\/p>/);
  assert.ok(manage, 'no list of links followed by the storage line');
  assert.deepEqual([...manage[1].matchAll(/<li><a href="([^"]+)">([^<]+)<\/a>: /g)].map((m) => m[2]), ['Albums', 'People', 'Email']);
  assert.equal(manage[2], 'Storage used: 0 KB of the free 10 GB (0.0%).');
});

test('it has one h1, a main, a skip link to it, and noindex', () => {
  assert.equal(page.match(/<h1[\s>]/g).length, 1);
  assert.match(page, /<main id="main">/);
  assert.match(page, /<a class="skip-link" href="#main">/);
  assert.match(page, /<meta name="robots" content="noindex">/);
});

test('it passes the photo site\'s html-validate config, and the validator can fail it', async () => {
  const report = await validate(page);
  assert.deepEqual(report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)), []);
  assert.equal(report.valid, true);
  // The controls: a second h1, and an inline style the CSP would drop, must
  // each fail it, so a green result above is a reading.
  assert.equal((await validate(page.replace('<h2 ', '<h1>again</h1><h2 '))).valid, false);
  assert.equal((await validate(page.replace('<main id="main">', '<main id="main" style="color: red">'))).valid, false);
});

test('the remembered home passes it too (#274, criterion 4)', async () => {
  // Its own state first, since an empty body validates clean: the remembered
  // sentence and both buttons.
  assert.match(remembered, /This phone is remembered: the admin pages stay open on it until <time datetime="2026-10-21T14:13:20\.000Z">/);
  assert.match(remembered, />Forget this phone<\/button>[\s\S]*>Sign out<\/button>/);
  const report = await validate(remembered);
  assert.deepEqual(report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)), []);
  assert.equal(report.valid, true);
  // The control: the two hints sharing one id must fail it.
  assert.equal((await validate(remembered.replace('id="admin-sign-out-hint"', 'id="admin-forget-hint"'))).valid, false);
});

test('it carries no inline script or style, which the CSP would drop', () => {
  assert.doesNotMatch(page, /<script|<style|\sstyle="|\son[a-z]+="/i);
});

test('every href and src on it is root-relative, absolute or a fragment', () => {
  for (const [, url] of page.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    assert.match(url, /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i, url);
  }
});

test('its header and footer are every static page\'s and the public pages\' template\'s, byte for byte', () => {
  // The public pages a Function renders take theirs from templates/page.html
  // (#157), which replaced the static holding page at /.
  const pages = [...staticPages().map((file) => `public/${file}`), 'templates/page.html'];
  assert.ok(pages.length >= 3, pages.join(', '));
  for (const file of pages) {
    const html = read(...file.split('/'));
    assert.equal(block(page, 'header'), block(html, 'header'), `the admin header differs from ${file}'s: copy it into lib/admin-page.js`);
    assert.equal(block(page, 'footer'), block(html, 'footer'), `the admin footer differs from ${file}'s: copy it into lib/admin-page.js`);
  }
});

test('its stylesheets, fonts and icon are the share page\'s, stamps included', () => {
  // tools/assetver.py restamps HTML files only. After it runs, this fails
  // until lib/admin-page.js carries the new ?v= values too. Only those kinds
  // of link: the share page also names the installed app's manifest and an
  // iPhone's home-screen icon (#193), which belong to the app's start page
  // alone (test/app.test.js holds them there).
  const links = (html) => [...block(html, 'head').matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0].replace(/\s+/g, ' '))
    .filter((l) => /\brel="(preload|stylesheet|icon)"/.test(l));
  const share = links(read('public', 'share', 'index.html'));
  assert.ok(share.some((l) => /site\.css\?v=[0-9a-f]{10}/.test(l)));
  assert.deepEqual(links(page), share);
});

test('GET /admin answers the page, as HTML, never cached', async () => {
  // An empty database: nothing waiting, nothing stored (#156's counts are
  // held in test/queue.test.js).
  const res = await home({ data: { admin: ADMIN }, env: { DB: d1() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(await res.text(), page);
});

test('GET /api/admin/session answers the signed-in email, never cached', async () => {
  const res = session({ data: { admin: ADMIN } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { email: EMAIL });
});
