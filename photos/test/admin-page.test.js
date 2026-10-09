// The admin home (#151, criteria 1 and 6): what the owner sees once the
// guard lets them through, and the copy of the site's chrome it carries.
//
// The page is rendered by a Function, so the gate's `npm run check` (which
// globs HTML files) never sees it. This validates the rendered page with the
// photo site's own html-validate config instead, and holds its header, footer
// and stylesheet stamps equal to the static pages'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { SECTIONS, TODO, adminHome, todoItem } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { onRequestGet as home } from '../functions/admin/index.js';
import { onRequestGet as session } from '../functions/api/admin/session.js';
import { seedAdmin } from './admin.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];

const EMAIL = 'owner@example.com';
// What the admin guard leaves on context.data.admin (#224): signed in at
// 2026-09-21T14:13:20Z, so the 12 hours end at 02:13 UTC the next day.
const ADMIN = { id: 1, name: 'Owner', email: EMAIL, role: 'owner', issued: 1_790_000_000 };
const EMPTY = { waiting: 0, removals: 0, bytes: 0 };
const page = adminHome(ADMIN, EMPTY);

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

test('the admin home says who is signed in, as the owner or an admin, and when the 12 hours end (#224)', () => {
  assert.match(page, /<p class="signed-in">Signed in as Owner, owner@example\.com, the owner\. The admin pages stay open until <time datetime="2026-09-22T02:13:20\.000Z">22 September 2026, 02:13 UTC<\/time>, then ask you to sign in again\.<\/p>/);
  assert.match(adminHome({ ...ADMIN, role: 'admin' }, EMPTY), /owner@example\.com, an admin\. /);
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

test('/admin opens on what is waiting: photos and clips, account requests and removal requests, in that order, each counted from the rows (#269, criterion 1; #198)', async () => {
  const db = d1();
  seedAdmin(db);
  const fall = await createAlbum(db, FALL, T0);
  // Counts chosen apart, 3 photos and 4 clips, 2 and 1, so two counts
  // swapped between items read wrong. Since #198 a waiting clip counts beside
  // the photos, named apart (owner, at #198's pickup). Beside each, rows that
  // must not count: an approved photo, a clip whose parts are still
  // arriving, and a hidden clip, which is no removal request until #286
  // brings clips into removals; for the requests, a person asking for both
  // teams (one person, counted once), and people approved, turned down or
  // revoked.
  for (let i = 0; i < 3; i++) seedRow(db, fall, { state: 'pending' });
  for (let i = 0; i < 4; i++) seedRow(db, fall, { kind: 'clip', state: 'pending' });
  seedRow(db, fall, { state: 'approved' });
  seedRow(db, fall, { kind: 'clip', state: 'uploading' });
  seedRow(db, fall, { state: 'hidden' });
  seedRow(db, fall, { kind: 'clip', state: 'hidden' });
  seedPerson(db, 'both@example.org', { 'hoover-jrt': 'requested', cohssa: 'requested' });
  seedPerson(db, 'one@example.org', { 'hoover-jrt': 'approved', cohssa: 'requested' });
  seedPerson(db, 'done@example.org', { 'hoover-jrt': 'approved' });
  seedPerson(db, 'no@example.org', { cohssa: 'rejected' });
  seedPerson(db, 'gone@example.org', { 'hoover-jrt': 'revoked' });
  const html = await homeOf(db);
  assert.deepEqual(todoList(html), [
    { classes: 'button todo-item', href: '/admin/queue', count: 3, words: 'photos and 4 clips waiting for approval' },
    { classes: 'button todo-item', href: '/admin/people', count: 2, words: 'account requests waiting' },
    { classes: 'button todo-item', href: '/admin/removals', count: 1, words: 'removal request waiting' },
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
