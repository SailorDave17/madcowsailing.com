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

import { SECTIONS, adminHome } from '../lib/admin-page.js';
import { onRequestGet as home } from '../functions/admin/index.js';
import { onRequestGet as session } from '../functions/api/admin/session.js';
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
  assert.match(page, /<p class="lede">Signed in as Owner, owner@example\.com, the owner\. The admin pages stay open until <time datetime="2026-09-22T02:13:20\.000Z">22 September 2026, 02:13 UTC<\/time>, then ask you to sign in again\.<\/p>/);
  assert.match(adminHome({ ...ADMIN, role: 'admin' }, EMPTY), /owner@example\.com, an admin\. /);
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

test('it links to each section the later stories fill', () => {
  const hrefs = [...block(page, 'main').matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/admin/code', '/admin/albums', '/admin/queue', '/admin/removals', '/admin/people', '/admin/mail']);
  assert.deepEqual(hrefs, SECTIONS.map((s) => s.href));
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
