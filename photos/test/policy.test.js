// The policy at /policy (#159), and the links to it.
//
// The page's figures are held to the code that makes them true, so a change
// to a session's length, the join limit's window, the largest photo size or
// the daily cap fails here until the page states the new figure. Every other
// claim on the page is traced in the table in its head comment; this file
// holds the parts a test can read, and runs README's manual takedown against
// the real schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminHome } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { HTML_CACHE, albumListPage } from '../lib/public-page.js';
import { approvedPhoto } from '../lib/public.js';
import { DAILY_UPLOADS, SIZES } from '../lib/photos.js';
import { SESSION_DAYS } from '../lib/session.js';
import { FAILURE_WINDOW_SECONDS } from '../functions/api/join.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];

// Every .html under public/, skipping the build's copy of shared/.
function staticPages(dir = join(ROOT, 'public'), prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (prefix === '' && name === 'assets') continue;
    if (statSync(full).isDirectory()) out.push(...staticPages(full, `${prefix}${name}/`));
    else if (name.endsWith('.html')) out.push(`${prefix}${name}`);
  }
  return out;
}

// Every page the site serves, by where its header and footer come from.
const everyPage = () => ({
  ...Object.fromEntries(staticPages().map((file) => [`public/${file}`, read('public', ...file.split('/'))])),
  'templates/page.html': read('templates', 'page.html'),
  'the album list, rendered': albumListPage([]),
  'the admin home, rendered': adminHome('owner@example.com', { waiting: 0, bytes: 0 }),
});

// What a reader sees: comments and tags out, whitespace folded.
const words = (html) => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const POLICY = read('public', 'policy.html');
const MAIN = words(block(POLICY, 'main'));
const LINK = '<a href="/policy">Who sees these photos</a>';

// ---- Criterion 4: every page links /policy --------------------------------

test('every page\'s footer links /policy: the static pages, the public template, and a rendered public and admin page', () => {
  const pages = everyPage();
  assert.ok(Object.keys(pages).length >= 6, Object.keys(pages).join(', '));
  assert.ok('public/policy.html' in pages, 'the policy page itself is a static page');
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(block(html, 'footer')?.includes(LINK), `${name}'s footer does not link /policy`);
  }
});

test('every page\'s header has the nav: All albums and Who sees these photos, with no page marked current', () => {
  // Owner, at #159's review. No aria-current, so the five header copies stay
  // byte for byte the same, which site, admin-page and public tests hold.
  for (const [name, html] of Object.entries(everyPage())) {
    const nav = block(block(html, 'header') ?? '', 'nav');
    assert.ok(nav, `${name}'s header has no nav`);
    assert.match(nav, /^<nav class="site-nav" aria-label="Primary">/, name);
    const links = [...nav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(links, ['/ All albums', '/policy Who sees these photos'], name);
    assert.doesNotMatch(nav, /aria-current/, name);
  }
});

test('/policy is a static file with the HTML\'s Cache-Control, and no Function answers it', () => {
  // Pages serves public/policy.html at /policy. _headers applies to static
  // files only, and the rule's path must be the one served.
  const headers = read('public', '_headers');
  const rule = headers.match(/^\/policy\n((?:[ \t]+.+\n?)+)/m);
  assert.ok(rule, 'public/_headers has no /policy rule');
  assert.match(rule[1], new RegExp(`^\\s+Cache-Control: ${HTML_CACHE}$`, 'm'));
  // _routes.json's patterns as Cloudflare reads them: a trailing /* matches
  // that prefix at any depth, anything else matches exactly.
  const matches = (pattern, path) => (pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
  const routes = JSON.parse(read('public', '_routes.json'));
  const invoked = routes.include.some((p) => matches(p, '/policy')) && !routes.exclude.some((p) => matches(p, '/policy'));
  assert.equal(invoked, false, 'a Function would answer /policy');
  // The matcher's control: a catch-all include is read as reaching /policy.
  assert.equal(matches('/*', '/policy'), true);
});

// ---- Criterion 3: the share page ------------------------------------------

test('the share page links the policy in its join step, and asks senders to leave children\'s full names out of captions', () => {
  const html = read('public', 'share', 'index.html');
  // The join step runs from its status line to the sending block. Both ends
  // must be found, in order, and the slice must stop before the footer,
  // whose copy of the link would otherwise pass for this one.
  const start = html.indexOf('id="join-status"');
  const end = html.indexOf('<div class="sender"');
  assert.ok(start > 0 && end > start, `join step not found (${start}, ${end})`);
  const join = html.slice(start, end);
  assert.doesNotMatch(join, /<footer|<header/);
  assert.ok(join.includes(`<p>${LINK}</p>`), 'the policy is not linked beside the join step');
  const sender = block(html.slice(end), 'div');
  assert.match(words(sender), /leave children's full names out of it\./);
});

// ---- Criteria 1 and 2: what the page says ---------------------------------

test('the policy covers, in order, who sees a photo, who sends, the check, the metadata, what is kept, for how long, and removal', () => {
  const headings = [...POLICY.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, [
    'Who can see a photo',
    'Who can send a photo',
    'Every photo is checked first',
    'Location and camera details stay on the phone',
    'What the site keeps',
    'How long photos stay',
    'Having a photo taken down',
  ]);
  assert.equal(POLICY.match(/<h1[\s>]/g).length, 1);
});

test('the policy states each thing criterion 1 lists, and the answers the owner gave', () => {
  for (const claim of [
    'asks search engines not to list it', // noindex (D6)
    'parents, sailors and coaches', // owner, at pickup
    'checks it against the media release', // D5
    'turns down any photo they recognize as showing', // owner, at review: the check, not an outcome
    'A check can miss one.',
    'no location, no camera make or model', // stripped on the phone (#155)
    'only in a scrambled form, made with a secret key', // lib/address.js
    'No names, no accounts and no email addresses are kept', // A4
    'There is no set limit.', // owner, at pickup
    'with the photo attached, or its link', // the review: a download's number moves
  ]) {
    assert.ok(MAIN.includes(claim), `the policy no longer says "${claim}"`);
  }
  // What a photo's row keeps, item by item (migration 0005). A list, so a
  // phrase repeated elsewhere on the page cannot stand in for an item.
  const kept = [...block(block(POLICY, 'main'), 'ul').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => words(m[1]));
  assert.deepEqual(kept, [
    'three copies of it, sized for the album page, the screen and download;',
    'its caption, if it has one;',
    'the album it was sent to;',
    'when it was taken, and when it was sent;',
    'which invite link it was sent with, and when that phone opened it.',
  ]);
  // The address is in the lede, on the first screen, and again in its own
  // section at the foot (owner, at #159's design review).
  const mailto = '<a href="mailto:dave@madcowsailing.com">dave@madcowsailing.com</a>';
  assert.equal(POLICY.split(mailto).length - 1, 2);
  assert.ok(POLICY.match(/<p class="lede">[\s\S]*?<\/p>/)[0].includes(mailto), 'the lede does not give the address');
});

test('the policy\'s figures are the code\'s: a session\'s days, the join limit\'s hour, the full size\'s long edge and the daily cap', () => {
  assert.equal(MAIN.match(new RegExp(`\\b${SESSION_DAYS} days\\b`, 'g'))?.length, 2, `the page names ${SESSION_DAYS} days twice`);
  assert.equal(FAILURE_WINDOW_SECONDS, 60 * 60, 'the join limit\'s window moved; the page says "an hour"');
  assert.match(MAIN, /An attempt counts for an hour/);
  assert.match(MAIN, new RegExp(`the largest at most ${SIZES.full.longEdge.toLocaleString('en-US')} pixels on its long side`));
  assert.match(MAIN, new RegExp(`no phone can send more than ${DAILY_UPLOADS}\\.`));
});

// ---- Criterion 5: the words -------------------------------------------------

test('the policy uses none of CLAUDE.md\'s banned words, nor actually, really, truly, simply or just', () => {
  const line = read('..', 'CLAUDE.md').match(/^- Banned: (.+)\.$/m);
  assert.ok(line, 'CLAUDE.md\'s Writing rules have no "- Banned:" line');
  const banned = [...line[1].split(/,\s*/), 'actually', 'really', 'truly', 'simply', 'just'];
  assert.ok(banned.length >= 11, banned.join(', '));
  // A word that starts with a banned one counts, as a grep for it would find
  // it: "seamlessly" is "seamless". The round that proved this test planted
  // exactly that, and a pattern closed at both ends read 0.
  const pattern = new RegExp(`\\b(?:${banned.join('|')})`, 'gi');
  // The controls: the same pattern finds a planted banned word from each set,
  // and one with an ending.
  assert.deepEqual('We simply leverage a seamless journey, seamlessly.'.match(pattern), ['simply', 'leverage', 'seamless', 'journey', 'seamless']);
  const seen = [words(POLICY.match(/<title>[\s\S]*?<\/title>/)[0]), POLICY.match(/name="description" content="([^"]+)"/)[1], MAIN];
  assert.deepEqual(seen.join(' ').match(pattern), null);
});

// ---- The promise behind "it comes down": README's manual takedown ---------

test('README\'s manual takedown hides the approved photo it names, and nothing else', async () => {
  // Until #158, this statement is what makes "email ... and it comes down"
  // true (owner, at #159's review). It is read from README, so the schema
  // cannot move out from under the runbook unnoticed.
  const section = read('..', 'README.md').split('### Taking a photo down by hand')[1]?.split(/\n## |\n### /)[0] ?? '';
  const sql = section.match(/--command "(UPDATE photos [^"]+)"/)?.[1];
  assert.ok(sql && sql.includes('<id>'), 'README has no takedown statement naming <id>');

  const db = d1();
  const address = await createAlbum(db, { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
  const album = db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const photo = (state, key) => Number(db.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at) ' +
    "VALUES (?, 'photo', ?, ?, 'b', 'parent', 1, 1, 1, 2, 4, 3, 4, 3, 4, 3, 10, ?)",
  ).run(album, state, key, state === 'pending' ? null : 3).lastInsertRowid);
  const target = photo('approved', 'a'.repeat(32));
  const other = photo('approved', 'b'.repeat(32));
  const waiting = photo('pending', 'c'.repeat(32));
  const run = (id) => db.sqlite.prepare(sql.replace('<id>', '?')).run(id).changes;

  assert.equal(await approvedPhoto(db, target), 'a'.repeat(32), 'the fixture photo is public before the takedown');
  assert.equal(run(target), 1);
  assert.equal(await approvedPhoto(db, target), null, 'the photo is still public');
  assert.equal(db.sqlite.prepare('SELECT state FROM photos WHERE id = ?').get(target).state, 'hidden');
  assert.equal(await approvedPhoto(db, other), 'b'.repeat(32), 'another photo was taken down');
  // Only an approved photo is taken down: a waiting one is untouched.
  assert.equal(run(waiting), 0);
  assert.equal(db.sqlite.prepare('SELECT state FROM photos WHERE id = ?').get(waiting).state, 'pending');
});
