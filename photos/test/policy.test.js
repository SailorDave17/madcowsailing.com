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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminHome } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { HTML_CACHE, albumListPage } from '../lib/public-page.js';
import { approvedPhoto } from '../lib/public.js';
import { DAILY_UPLOADS, SIZES, insertPhoto } from '../lib/photos.js';
import {
  NOTE_MAX, REMOVAL_LIMIT, REMOVAL_WINDOW_SECONDS, deletePhoto, requestRemoval, restorePhoto,
} from '../lib/removals.js';
import { SESSION_DAYS, coachListed, coachSessionCookie, readSession } from '../lib/session.js';
import { FAILURE_WINDOW_SECONDS } from '../functions/api/join.js';
import { d1 } from './d1.js';
import { r2 } from './r2.js';

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
  'the admin home, rendered': adminHome('owner@example.com', { waiting: 0, removals: 0, bytes: 0 }),
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

test('every page\'s header has the nav: All albums only, with no page marked current', () => {
  // Owner, at #159's review, gave the nav two links. The owner took
  // /policy back out of it on 2026-10-01: the footer's copy is enough. No
  // aria-current, so the five header copies stay byte for byte the same,
  // which site, admin-page and public tests hold.
  for (const [name, html] of Object.entries(everyPage())) {
    const nav = block(block(html, 'header') ?? '', 'nav');
    assert.ok(nav, `${name}'s header has no nav`);
    assert.match(nav, /^<nav class="site-nav" aria-label="Primary">/, name);
    const links = [...nav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(links, ['/ All albums'], name);
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
    'Nothing kept with a photo names who sent it: no name, no account and no email address', // A4
    'Someone sending with the invite link gives none of those at all.', // A4
    // #192: coaches sign in, and the page says what that keeps.
    'the team\'s coaches, who sign in, can send one',
    'only an address the site\'s admins have put on the coaches\' list gets in',
    'until the coach is taken off the list. Changing the invite link does not stop it.',
    'A coach\'s photos are checked like everyone else\'s.',
    'for a coach\'s photo, not which coach',
    'A coach\'s cookie holds their address only in a scrambled form, made with a secret key.',
    'The coaches\' list itself holds each coach\'s email address, and only the site\'s owner can change it, in Cloudflare\'s dashboard.',
    'records each sign-in in the site\'s account, with the coach\'s email address and network address',
    // Owner, at #192's review: the row keeps no sign-in time, and the page
    // says the time a photo was sent can still be matched.
    'So when a coach\'s photo was sent could still be matched against who signed in shortly before.',
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
    'which invite link it was sent with, and when that phone opened it, or for a coach\'s photo, only that a coach sent it.',
  ]);
  // The address is in the lede, on the first screen, and again in its own
  // section at the foot (owner, at #159's design review).
  const mailto = '<a href="mailto:dave@madcowsailing.com">dave@madcowsailing.com</a>';
  assert.equal(POLICY.split(mailto).length - 1, 2);
  assert.ok(POLICY.match(/<p class="lede">[\s\S]*?<\/p>/)[0].includes(mailto), 'the lede does not give the address');
});

test('the policy\'s figures are the code\'s: a session\'s days, the join limit\'s hour, the full size\'s long edge and the daily cap', () => {
  // A parent's phone, a coach's (#192) and the cookie: three times.
  assert.equal(MAIN.match(new RegExp(`\\b${SESSION_DAYS} days\\b`, 'g'))?.length, 3, `the page names ${SESSION_DAYS} days three times`);
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

// ---- #158: "Remove this photo" on the page ------------------------------------

const section = (heading) => {
  const start = POLICY.indexOf(`<h2>${heading}</h2>`);
  assert.ok(start > 0, `no "${heading}" section`);
  return POLICY.slice(start, POLICY.indexOf('</section>', start));
};

test('"Having a photo taken down" names "Remove this photo" beside the email, and the lede and the check both give the button', () => {
  const takedown = words(section('Having a photo taken down'));
  assert.match(takedown, /^Having a photo taken down Press "Remove this photo" under it on its album page\. It is hidden from everyone at once/);
  assert.match(takedown, /Or email dave@madcowsailing\.com with the photo attached/);
  assert.ok(section('Having a photo taken down').includes('<a href="mailto:dave@madcowsailing.com">'));
  // words() leaves a space where the link's closing tag was.
  assert.match(words(POLICY.match(/<p class="lede">[\s\S]*?<\/p>/)[0]), /To take a photo down, press "Remove this photo" under it, or email dave@madcowsailing\.com ?\.$/);
  assert.match(words(section('Every photo is checked first')), /press "Remove this photo" under it, or email the address above, and it comes down\./);
});

test('"What the site keeps" says what a taken-down photo keeps, that a put-back photo keeps it, and how long the limit keeps its scrambled address', () => {
  const kept = words(section('What the site keeps'));
  for (const claim of [
    // hidden_at, hidden_note and the three objects, which a takedown leaves.
    'When someone takes a photo down with "Remove this photo", nothing is deleted yet. The site keeps the photo\'s three copies, when it was taken down, and the note left with it, if any, which can hold a name',
    // Owner, at #158's pickup: restorePhoto leaves both on the row.
    'The time and the note stay with the photo if an admin puts it back, and go with it when an admin deletes it.',
    'kept only in the same scrambled form',
    // Owner, at #158's review: the admin pages clear the log too.
    'A takedown counts for an hour. After that it is deleted the next time anyone takes a photo down or one of the site\'s admins opens the admin pages.',
    'Pressing it on a photo that is not showing counts for nothing, and nothing is kept.',
  ]) {
    assert.ok(kept.includes(claim), `"What the site keeps" no longer says "${claim}"`);
  }
});

test('the takedown figures are the code\'s: 10 an hour, the hour, and 500 characters', () => {
  assert.match(MAIN, new RegExp(`one network can take down at most ${REMOVAL_LIMIT} photos an hour\\.`));
  assert.equal(REMOVAL_WINDOW_SECONDS, 60 * 60, 'the takedown limit\'s window moved; the page says "an hour"');
  assert.match(MAIN, new RegExp(`a note for the site's admins, up to ${NOTE_MAX} characters\\.`));
});

test('the page\'s promises about a takedown are what the code does', async () => {
  // "It is hidden from everyone at once", "the time and the note stay with the
  // photo if an admin puts it back", "and go with it when an admin deletes it".
  const db = d1();
  const bucket = r2();
  const address = await createAlbum(db, { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
  const album = db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const photo = (state, key) => Number(db.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at) ' +
    "VALUES (?, 'photo', ?, ?, 'b', 'parent', 1, 1, 1, 2, 4, 3, 4, 3, 4, 3, 10, ?)",
  ).run(album, state, key, state === 'pending' ? null : 3).lastInsertRowid);
  const target = photo('approved', 'a'.repeat(32));
  const other = photo('approved', 'b'.repeat(32));
  const row = () => db.sqlite.prepare('SELECT state, hidden_at, hidden_note FROM photos WHERE id = ?').get(target);

  assert.equal(await approvedPhoto(db, target), 'a'.repeat(32), 'the fixture photo is public before the takedown');
  const result = await requestRemoval(db, { id: target, note: 'My daughter', address: 'h', now: 1_790_000_500 });
  assert.equal(result.outcome, 'hidden');
  assert.equal(await approvedPhoto(db, target), null, 'the photo is still public');
  assert.equal(await approvedPhoto(db, other), 'b'.repeat(32), 'another photo was taken down');
  assert.deepEqual({ ...row() }, { state: 'hidden', hidden_at: 1_790_000_500, hidden_note: 'My daughter' });
  assert.equal(await restorePhoto(db, target), true);
  assert.deepEqual({ ...row() }, { state: 'approved', hidden_at: 1_790_000_500, hidden_note: 'My daughter' });
  // A later takedown writes its own time and note over the kept ones.
  await requestRemoval(db, { id: target, note: null, address: 'h', now: 1_790_000_600 });
  assert.deepEqual({ ...row() }, { state: 'hidden', hidden_at: 1_790_000_600, hidden_note: null });
  assert.equal((await deletePhoto(db, bucket, target)).deleted, true);
  assert.equal(row(), undefined, 'a deleted photo keeps its time and note');
});

test('the head comment traces every takedown claim to a file that exists', () => {
  const comment = POLICY.match(/<!-- Story #159[\s\S]*?-->/)[0];
  for (const source of ['lib/removals.js', 'functions/api/remove.js', 'migrations/0006_removal_requests.sql',
    'REMOVAL_LIMIT', 'NOTE_MAX', 'restorePhoto', 'deletePhoto', 'requestRemoval', 'clearExpiredTakedowns',
    'Taking a photo down by hand']) {
    assert.ok(comment.includes(source), `the trace table does not name ${source}`);
  }
  // Every file the table names is one on disk, so a rename cannot leave the
  // trace pointing nowhere.
  const files = [...comment.matchAll(/\b((?:lib|functions|migrations|public)\/[\w./-]+\.(?:js|sql|html))\b/g)].map((m) => m[1]);
  assert.ok(files.length >= 8, files.join(', '));
  for (const file of files) assert.ok(existsSync(join(ROOT, file)), `the trace table names ${file}, which does not exist`);
  // The control: a name the pattern reads that is not there is caught.
  assert.equal(existsSync(join(ROOT, 'lib/no-such-file.js')), false);
});

// ---- #192: a coach's sign-in on the page ------------------------------------

test('the head comment traces every coach claim to the code behind it, and the code still has it', async () => {
  const comment = POLICY.match(/<!-- Story #159[\s\S]*?-->/)[0];
  // Each identifier the trace names, and the module that must still export
  // it, so a rename cannot leave the trace pointing at nothing (#192's review).
  const exported = {
    requireCoach: '../lib/access.js',
    coachListed: '../lib/session.js',
    coachTag: '../lib/session.js',
    readSession: '../lib/session.js',
    insertPhoto: '../lib/photos.js',
  };
  for (const [name, module] of Object.entries(exported)) {
    assert.ok(comment.includes(name), `the trace table does not name ${name}`);
    assert.equal(typeof (await import(module))[name], 'function', `${module} no longer exports ${name}`);
  }
  for (const source of ['lib/access.js', 'functions/coach/_middleware.js', 'COACH_EMAILS', 'Access authentication']) {
    assert.ok(comment.includes(source), `the trace table does not name ${source}`);
  }
  // COACH_EMAILS is the name the guard reads, not only a word in the comment.
  assert.equal((await import('../lib/access.js')).COACHES.list, 'COACH_EMAILS');
  // The control: a name the code does not export reads as missing.
  assert.equal((await import('../lib/session.js')).isListedCoach, undefined);
  assert.doesNotMatch(comment, /will change this page/, 'the comment still says #192 is to come');
});

test('the page\'s coach claims are what the code does: no address in the cookie, no invite link on the row, and the list decides', async () => {
  const KEY = 'test-session-signing-key-0123456789abcdef';
  const COACH = 'coach@example.com';
  // "A coach's cookie holds their address only in a scrambled form."
  const cookie = await coachSessionCookie(KEY, COACH, 1_790_000_000);
  assert.ok(!cookie.toLowerCase().includes('coach@'), 'the coach\'s cookie carries the address');
  const request = new Request('https://photos.madcowsailing.com/', { headers: { Cookie: cookie.split(';')[0] } });
  const session = await readSession(request, KEY, 1_790_000_100);
  assert.equal(session.sender, 'coach');
  // "... until the coach is taken off the list."
  assert.equal(await coachListed(KEY, session.coach, COACH), true);
  assert.equal(await coachListed(KEY, session.coach, 'someone@example.com'), false);
  // "For a coach's photo, only that a coach sent it": the row says coach and
  // names no invite link, and nothing on it names the coach.
  const db = d1();
  const address = await createAlbum(db, { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
  const id = await insertPhoto(db, address, {
    mediaKey: 'd'.repeat(32), batch: '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b', session, caption: null,
    captured: 1, sentAt: 2, full: { width: 4, height: 3 }, grid: { width: 4, height: 3 }, screen: { width: 4, height: 3 }, bytes: 10,
  });
  const row = { ...db.sqlite.prepare('SELECT * FROM photos WHERE id = ?').get(id) };
  assert.equal(row.sender, 'coach');
  assert.equal(row.code_generation, null);
  // "Only that a coach sent it": no session time, which Cloudflare's sign-in
  // log would turn into a name (owner, at #192's review).
  assert.equal(row.session_issued, null);
  assert.equal(row.state, 'pending', 'a coach\'s photo is checked like everyone else\'s');
  for (const value of Object.values(row)) assert.ok(!String(value).includes(session.coach.slice(0, 12)), 'the row names the coach');
});

test('README gives the button as the route for an email request, and the hand takedown for when it is refused', () => {
  const readme = read('..', 'README.md');
  const takedown = readme.split('### Taking a photo down\n')[1]?.split(/\n## |\n### /)[0] ?? '';
  assert.match(takedown, /\*\*Remove this photo\*\*/);
  assert.match(takedown, /\*\*An email takedown\*\*/);
  assert.match(takedown, /When the button is\s+refused, by the limit on your own network \(429\) or because the site cannot\s+take photos down \(503\), do it by hand \(below\)\./);
  assert.match(readme.split('### Removal requests\n')[1] ?? '', /`\/admin\/removals`/);
});

// ---- The promise behind "it comes down": README's hand takedown ------------

test('README\'s hand takedown, the fallback when the button is refused, hides the approved photo it names, and nothing else', async () => {
  // Kept at #158's review (owner): past the button's limit on an admin's own
  // network, or at a 503, this statement is what makes "email ... and the
  // photo comes down" true. It is read from README, so the schema cannot move
  // out from under the runbook unnoticed.
  const section = read('..', 'README.md').split('### Taking a photo down by hand')[1]?.split(/\n## |\n### /)[0] ?? '';
  const sql = section.match(/--command "(UPDATE photos [^"]+)"/)?.[1];
  assert.ok(sql && sql.includes('<id>'), 'README has no takedown statement naming <id>');

  const db = d1();
  const address = await createAlbum(db, { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
  const album = db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const photo = (state, key, note = null) => Number(db.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at, hidden_note) ' +
    "VALUES (?, 'photo', ?, ?, 'b', 'parent', 1, 1, 1, 2, 4, 3, 4, 3, 4, 3, 10, ?, ?)",
  ).run(album, state, key, state === 'pending' ? null : 3, note).lastInsertRowid);
  // The target was taken down and put back once, so it carries a kept note.
  const target = photo('approved', 'a'.repeat(32), 'an earlier takedown\'s note');
  const other = photo('approved', 'b'.repeat(32));
  const waiting = photo('pending', 'c'.repeat(32));
  const run = (id) => db.sqlite.prepare(sql.replace('<id>', '?')).run(id).changes;

  assert.equal(await approvedPhoto(db, target), 'a'.repeat(32), 'the fixture photo is public before the takedown');
  assert.equal(run(target), 1);
  assert.equal(await approvedPhoto(db, target), null, 'the photo is still public');
  const row = db.sqlite.prepare('SELECT state, hidden_at, hidden_note FROM photos WHERE id = ?').get(target);
  assert.equal(row.state, 'hidden');
  assert.ok(row.hidden_at > 1_790_000_000, 'the time it was hidden is now');
  assert.equal(row.hidden_note, null, 'a takedown by hand writes over a kept note, as the button does');
  assert.equal(await approvedPhoto(db, other), 'b'.repeat(32), 'another photo was taken down');
  // Only an approved photo is taken down: a waiting one is untouched.
  assert.equal(run(waiting), 0);
  assert.equal(db.sqlite.prepare('SELECT state FROM photos WHERE id = ?').get(waiting).state, 'pending');
});
