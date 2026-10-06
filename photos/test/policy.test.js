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

import {
  REQUEST_BUDGET_PER_HOUR, REQUEST_LIMIT, REQUEST_WINDOW_SECONDS, requestAccount,
} from '../lib/accounts.js';
import { adminHome } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { HTML_CACHE, sectionPage, teamListPage } from '../lib/public-page.js';
import { approvedPhoto } from '../lib/public.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { LINK_SECONDS, clearExpiredLinks, tokenHash } from '../lib/password-link.js';
import { approveTeams, rejectTeams, sendLink } from '../lib/people.js';
import { RESEND_URL } from '../lib/mail.js';
import { DAILY_UPLOADS, SIZES, insertPhoto } from '../lib/photos.js';
import {
  NOTE_MAX, REMOVAL_LIMIT, REMOVAL_WINDOW_SECONDS, deletePhoto, requestRemoval, restorePhoto,
} from '../lib/removals.js';
import { SESSION_DAYS, coachListed, coachSessionCookie, nowSeconds, readSession } from '../lib/session.js';
import { TEAMS } from '../lib/teams.js';
import { FAILURE_WINDOW_SECONDS } from '../functions/api/join.js';
import { onRequestGet as adminHomeRoute } from '../functions/admin/index.js';
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_DAYS, accountCookie, readAccountSession, sessionAccount } from '../lib/account-session.js';
import { PWNED_RANGE_URL, pwned } from '../lib/password-rules.js';
import {
  RESET_EMAILS_PER_DAY, RESET_GAP_SECONDS, RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_SECONDS, RESET_SECONDS, sendReset,
} from '../lib/reset.js';
import {
  EMAIL_FAILURE_LIMIT, FAILED_IN_A_ROW, FAILURE_BUDGET_PER_HOUR, FAILURE_WINDOW_SECONDS as SIGN_IN_WINDOW_SECONDS,
  NETWORK_FAILURE_LIMIT, signOut,
} from '../lib/sign-in.js';
import { d1, seedCodes } from './d1.js';
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
  'the team list at /, rendered': teamListPage([]),
  'a team\'s section, rendered': sectionPage('cohssa', []),
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

test('every page\'s header has the nav: Team photos only, with no page marked current', () => {
  // Owner, at #159's review, gave the nav two links. The owner took
  // /policy back out of it on 2026-10-01: the footer's copy is enough. No
  // aria-current, so the five header copies stay byte for byte the same,
  // which site, admin-page and public tests hold. The link read "All
  // albums" until #227 made / the way into each team's section (owner, at
  // #227's review: every link to / is "Team photos", the page's own title).
  for (const [name, html] of Object.entries(everyPage())) {
    const nav = block(block(html, 'header') ?? '', 'nav');
    assert.ok(nav, `${name}'s header has no nav`);
    assert.match(nav, /^<nav class="site-nav" aria-label="Primary">/, name);
    const links = [...nav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(links, ['/ Team photos'], name);
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

test('the policy covers, in order, who sees a photo, who sends, the check, the metadata, what is kept, an account, for how long, and removal', () => {
  const headings = [...POLICY.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, [
    'Who can see a photo',
    'Who can send a photo',
    'Every photo is checked first',
    'Location and camera details stay on the phone',
    'What the site keeps',
    'What an account keeps', // #219
    'How long photos stay',
    'Having a photo taken down',
    'Having an account deleted', // #219
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
    // A4, for the two ways in that predate accounts. #219 narrowed it to
    // them: a photo sent from an account names the account (D17).
    'A photo sent with the invite link, or by a coach, keeps nothing that names who sent it: no name, no account and no email address',
    'Someone sending with the invite link gives none of those at all.',
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
    'which invite link it was sent with, and when that phone opened it, or for a coach\'s photo, only that a coach sent it;',
    'for a photo sent from an account, which account sent it.', // D17; #219
  ]);
  // The address is in the lede, on the first screen, and again in its own
  // section at the foot (owner, at #159's design review), and in the
  // account-deletion section (#219).
  const mailto = '<a href="mailto:dave@madcowsailing.com">dave@madcowsailing.com</a>';
  assert.equal(POLICY.split(mailto).length - 1, 3);
  assert.ok(POLICY.match(/<p class="lede">[\s\S]*?<\/p>/)[0].includes(mailto), 'the lede does not give the address');
});

test('the policy\'s figures are the code\'s: a session\'s days, the join limit\'s hour, the full size\'s long edge and the daily cap', () => {
  // A parent's phone, a coach's (#192) and the cookie: three times. The
  // account's session (#222) is a fourth, which is held to its own constant
  // below, so the two must agree.
  assert.equal(ACCOUNT_SESSION_DAYS, SESSION_DAYS);
  assert.equal(MAIN.match(new RegExp(`\\b${SESSION_DAYS} days\\b`, 'g'))?.length, 4, `the page names ${SESSION_DAYS} days four times`);
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
  const address = await createAlbum(db, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
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

test('"What the site keeps" says shared photos wait on the phone until sent or removed, and the day is the scripts\' own (#193)', () => {
  assert.match(MAIN, /Photos shared to the installed app from a phone's gallery wait in this site's storage on that phone, exactly as they were shared, location included, until each is sent or removed\./);
  assert.match(MAIN, /One not sent within a day is no longer offered, and is deleted the next time the app opens or is shared to\./);
  // The day on the page is KEEP_MS in the worker that keeps the files and
  // the page that offers them; either moving fails here.
  const day = (text) => text.match(/const KEEP_MS = ([^;]+);/)?.[1];
  for (const script of [['public', 'share', 'sw.js'], ['public', 'js', 'share.js']]) {
    assert.equal(day(read(...script)), '24 * 60 * 60 * 1000', script.join('/'));
  }
  const comment = POLICY.match(/<!-- Story #159[\s\S]*?-->/)[0];
  for (const source of ['public/share/sw.js', 'public/js/share.js', 'KEEP_MS']) {
    assert.ok(comment.includes(source), `the trace table does not name ${source}`);
  }
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
  const address = await createAlbum(db, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
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
  const address = await createAlbum(db, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, 1_790_000_000);
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

// ---- #219: accounts on the page ---------------------------------------------
//
// The page says what an account keeps before the request form (#220) takes
// its first request, so most of what it describes is built by later stories
// of epic #216. Each claim's source is in the head comment's trace table, and
// the stories that build them carry it in their criteria.

const has = (text, claims, where) => {
  for (const claim of claims) assert.ok(text.includes(claim), `${where} no longer says "${claim}"`);
};

test('"What an account keeps" lists what an account keeps, who sees it, and for how long (#219, criterion 1)', () => {
  const html = section('What an account keeps');
  // A list, as for a photo, so a phrase elsewhere cannot stand in for an item.
  const items = [...block(html, 'ul').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => words(m[1]));
  assert.deepEqual(items, [
    'your name and email address;',
    'your role, the teams you asked for, and which of them an admin approved;', // D16
    // #220, criterion 9: the request's time and state (0007).
    'when you asked, which teams still wait for an admin\'s answer, and whether the admins have been emailed about your request;',
    'the note you left with your request, if any;',
    'your password, only as a hash, which can check a password typed in but cannot be turned back into it;', // D14
    // #222: failed_sign_ins (0009), NIST's count in a row.
    'how many times in a row signing in to it has failed, until a sign-in succeeds;',
    // #221, criteria 2 and 7: the link's token, kept as its SHA-256.
    'a link to set your password, while it waits to be used, only as a hash, which can check the link but cannot be turned back into it;',
    'which photos you sent from it.', // D17
  ]);
  has(words(html), [
    // D13, D16. A condition, not "anyone can ask", so the page is true on a
    // release before #220 builds the form (owner, at #219's review).
    'If you ask for an account, as a parent, a coach or anyone else, for Hoover JRT, COHSSA or both, it keeps:',
    // D17. "On the site": Resend, named below, sees what it sends.
    'On the site, only its admins see any of it.',
    'Every admin sees every account, for both teams.', // D15's admin role has no team
    'No public page, photo or download shows who sent a photo.', // #223's criterion 3
    // #221's link: 7 days (owner, at #221's pickup), once, replaced by a
    // newer one only once that one's email is sent (#221's review), and
    // deleted by /admin/people's load or the next link made, an approval's
    // or a reset's. #222: setting a password ends every link the account
    // holds (setPassword).
    'When an admin approves your account for a team, the site emails you a link to set your password. It can be used once, for 7 days, and a newer link replaces it once the newer one\'s email is sent. Once its 7 days are up, it is deleted the next time an admin opens the list of accounts or any link is sent. Setting a password with a link uses up every link the account holds.',
    // #221's log (criterion 5: who, what, whom, when), and #225's revoke and
    // delete entries (owner, at #219's review). The name and address are
    // copied into each entry (migration 0008).
    'The admins also keep a log of what they do with each account: who approved it or turned it down for each team, changed its role, sent it a link to set a password, revoked it or deleted it, and when. Each entry names the person whose account it was, by name and email address. The log has no set limit.',
    'The request asks for no sailor\'s name, so leave sailors\' names out of the note too.', // D18
    'An account, and a request for one, is kept until it is deleted. There is no set limit.', // owner, at #219's pickup
  ], '"What an account keeps"');
  assert.doesNotMatch(MAIN, /Anyone can ask for an account/);
});

test('the page names Turnstile and Resend as handling a request, and says what each sees (#219, criterion 2)', () => {
  has(words(section('What an account keeps')), [
    'Two other services handle a request.',
    // The Turnstile Privacy Addendum's section 3 lists "client IP address,
    // TLS Fingerprint, User-Agent Header and Sitekey and associated origin",
    // and Turnstile's docs say it "does not access, store, or transmit ...
    // form entries" (both read 2026-10-05).
    // #222 put Turnstile on the reset form too (the owner's choice at pickup).
    'Cloudflare Turnstile checks that the request form, and the form to reset a password, were filled in by a person, not a program.',
    'it sees your network address, what your browser reports about itself, details of how it connects, and which site the form is on, but not what you type into the form.',
    'not to identify, profile or target anyone, and also uses them to improve Turnstile.',
    // #217's sender, and #220's email to the admins naming each requester.
    'Resend sends the site\'s email.',
    'the site emails its admins through Resend with your name, role and teams',
    // Resend's Free plan, "30-day data retention" (resend.com/pricing).
    'Resend sees each email\'s address and everything in it, and keeps each one for 30 days.',
  ], '"What an account keeps"');
  // Resend's 30 days is said twice, and the two must agree. (The database's
  // restore points are a different 30 days, and are not matched here.)
  assert.deepEqual([...MAIN.matchAll(/Resend[^.]*?(\d+) days/g)].map((m) => m[1]), ['30', '30']);
});

test('"Having an account deleted" gives the email and the check, says the photos stay but no longer record the account, and what is not deleted (#219, criterion 3)', () => {
  const html = section('Having an account deleted');
  assert.ok(html.includes('<a href="mailto:dave@madcowsailing.com">dave@madcowsailing.com</a>'), 'the section does not link the address');
  has(words(html), [
    // By email (owner, at #219's pickup), confirmed by a reply to the
    // account's own address (owner, at #219's review): a delete cannot be
    // undone, and a request can come from anyone.
    'Email dave@madcowsailing.com and ask. An admin writes to the address on the account to check the request came from you, and deletes the account once you confirm: your name, email address, role, teams, note and password hash all go.',
    // Owner, at #219's pickup: D17's rule for revoking, applied to a delete.
    'The photos you sent stay, approved or still waiting, and are checked as usual, but they no longer record which account sent them.',
    'To have them taken down as well, press "Remove this photo" under each, or say so in the same email.',
    // Owner, at #219's review: the log keeps its entries, and a revoked
    // address stays scrambled so a revoke survives a delete.
    'Some things stay. The admins\' log keeps its entries about your account, and they still name you.',
    'If an admin had revoked the account, the site keeps its email address in a scrambled form, made with a secret key, so that a new request from it is still held back.',
    'Emails already sent are not deleted with it: Resend keeps each for its 30 days, and the email telling the admins about your request stays in their mailboxes.',
    // D1 Time Travel: 7 days on Free, 30 on Workers Paid, always on.
    'The site\'s database can be put back as it was at any moment in the last 30 days, so a deleted account stays in those restore points, which only the site\'s owner can use, for up to 30 days.',
  ], '"Having an account deleted"');
  // The promise a log that names the person would break.
  assert.doesNotMatch(MAIN, /nothing links them to you/);
});

test('the page no longer promises that every photo is anonymous, and keeps #192\'s matching sentence until the cutover (#219, criterion 4)', () => {
  // The promise #192 left, which an account's photo would break (D17).
  assert.doesNotMatch(MAIN, /Nothing kept with a photo names who sent it/);
  has(MAIN, [
    'A photo sent from an account is different: the site records which account sent it, and only the site\'s admins see it.',
    // Removed at the cutover, #226, with the coaches' sign-in. Not before.
    'So when a coach\'s photo was sent could still be matched against who signed in shortly before.',
  ], 'the policy');
});

// The trace table's account rows, in order, each with the sources its own
// cell must name. A row's cell runs from its first line to the next row's,
// read from column 41, so a source in one row cannot stand in for another's.
// #219's review found a whole-comment search let 6 of 13 rows go at 0 red.
const ACCOUNT_ROWS = [
  ['A photo sent with the invite', ['insertPhoto', 'D17', '#223']],
  ['If you ask for an account, for', ['D13', 'D16', '#220', '#219\'s review', '#158\'s precedent']],
  ['What an account keeps: name,', ['#220\'s criteria 1 and 6', '#221']],
  ['When you asked, which teams', ['requested_at', 'admins_emailed', 'account_teams', 'migrations/0007_accounts.sql', 'requestAccount', 'mailAdmins', '#220', '/admin/people', 'peopleLists', '#221']],
  ['The password, only as a hash', ['hashPassword', 'verifyPassword', 'lib/password.js', 'setPassword', 'lib/sign-in.js', '#222', 'normalizePassword', 'lib/password-rules.js']],
  // #222, criterion 8: what this story adds, each in its own row.
  ['Failed sign-ins in a row, until', ['failed_sign_ins', 'migrations/0009_sign_in.sql', 'signIn', 'setPassword', 'lib/sign-in.js', '#222']],
  // #221, criterion 7: the link's token kept as a hash, and how long it lasts.
  ['A link to set a password, only', ['password_links', 'migrations/0008_admin_people.sql', 'tokenHash', 'newLink', 'lib/password-link.js', '#221\'s criterion 2']],
  ['Approval emails it; once, 7', ['sendLink', 'lib/people.js', 'functions/api/admin/people/', 'LINK_SECONDS', 'setPassword', 'lib/sign-in.js', '#222', 'replaceOthers', 'dropLink', '#221\'s pickup', '#221\'s review']],
  ['Deleted once its 7 days are up,', ['clearExpiredLinks', 'lib/password-link.js', 'functions/admin/people.js', 'newLink', '#221', 'sendReset', 'lib/reset.js', '#222']],
  ['Signing in: one cookie, 90', ['ACCOUNT_COOKIE', 'ACCOUNT_SESSION_DAYS', 'signAccountSession', 'lib/account-session.js', '#222\'s criterion 4']],
  ['Signing out, a new password or', ['signOut', 'setPassword', 'lib/sign-in.js', 'session_version', 'migrations/0009_sign_in.sql', 'requireAccount', '#222\'s pickup', 'sessionAccount', '#225\'s criterion']],
  ['Failed sign-ins: 10 an hour', ['EMAIL_FAILURE_LIMIT', 'NETWORK_FAILURE_LIMIT', 'FAILURE_BUDGET_PER_HOUR', 'lib/sign-in.js', '#222\'s pickup']],
  ['Each failed try, scrambled, an', ['sign_in_failures', 'migrations/0009_sign_in.sql', 'emailHash', 'addressHash', 'clearExpiredSignIns', 'functions/admin/index.js', '#222\'s criterion 3']],
  ['100 failed in a row stops the', ['FAILED_IN_A_ROW', 'NIST SP 800-63B-4', '3.2.2', '"no more than 100"']],
  ['A reset emails a link: once,', ['sendReset', 'RESET_SECONDS', 'lib/reset.js', 'newLink', 'password_links', '#222\'s criterion 5', '#222\'s pickup']],
  ['One every 15 minutes for an', ['RESET_GAP_SECONDS', 'RESET_EMAILS_PER_DAY', 'reset_mail_budget', 'migrations/0009_sign_in.sql']],
  ['10 reset requests an hour from', ['RESET_REQUEST_LIMIT', 'claimResetRequest', 'reset_request_log', 'migrations/0009_sign_in.sql', 'clearExpiredResetRequests', 'functions/admin/index.js']],
  ['Pwned Passwords sees 5', ['pwned', 'PWNED_RANGE_URL', 'lib/password-rules.js', 'https://api.pwnedpasswords.com/range/', 'https://haveibeenpwned.com/API/v3', '2026-10-06', '#222\'s pickup']],
  ['Which photos it sent', ['D17', '#223']],
  ['On the site, only the admins', ['D17', 'D15']],
  ['The admins\' log names the person,', ['#221\'s criterion 5', 'admin_log', 'migrations/0008_admin_people.sql', 'no foreign key', 'approveTeams', 'rejectTeams', 'sendLink', 'same batch as the link', '#225', '#219\'s review']],
  ['Approved or turned down per', ['D16', 'approveTeams', 'rejectTeams', 'lib/people.js', 'nothing deletes from admin_log']],
  ['No sailor\'s name', ['D18']],
  ['Kept until it is deleted', ['#219\'s pickup']],
  ['Turnstile, and what it sees', ['Turnstile Privacy Addendum', 'https://www.cloudflare.com/turnstile-privacy-policy/', '2025-06-18', 'form entries', 'verifyTurnstile', 'lib/turnstile.js', 'functions/ask.js', 'functions/forgot-password.js']],
  // #220, criterion 9: the request limit, and how long it keeps a scrambled
  // address.
  ['10 requests an hour from one', ['REQUEST_LIMIT', 'REQUEST_BUDGET_PER_HOUR', 'lib/accounts.js', '#220\'s']],
  ['The request\'s scrambled', ['account_request_log', 'migrations/0007_accounts.sql', 'clearExpiredRequests', '#220', 'request taken', 'admin home']],
  ['Its time is the account\'s, to', ['requested_at', 'account_request_log', 'requestAccount', 'migrations/0007_accounts.sql', '#220\'s review']],
  ['Resend sends the site\'s email,', ['sendMail', 'lib/mail.js', '#220\'s criterion 5', 'mailAdmins']],
  ['Resend keeps each 30 days', ['https://resend.com/pricing', '"30-day data retention"']],
  ['Deleted on request, by email,', ['#219\'s pickup', '#219\'s review', 'confirmed by reply', '#220', '#225']],
  ['A revoked address stays, as a', ['#219\'s review', '#225']],
  ['The photos stay, and no longer', ['#219\'s pickup', 'D17']],
  ['Restore points, up to 30 days', ['"30 days (Workers Paid) / 7 days (Free)"', 'https://developers.cloudflare.com/d1/platform/limits/']],
];

test('the head comment traces every account claim in its own row, and the code it names still has it (#219)', async () => {
  const lines = POLICY.match(/<!-- Story #159[\s\S]*?-->/)[0].split('\n');
  const starts = ACCOUNT_ROWS.map(([head]) => lines.findIndex((line) => line.startsWith(`       ${head}`)));
  ACCOUNT_ROWS.forEach(([head], i) => {
    assert.ok(starts[i] > 0, `the trace table has no "${head}" row`);
    if (i > 0) assert.ok(starts[i] > starts[i - 1], `the "${head}" row is out of order`);
  });
  // The last row's cell ends at the blank line closing the table.
  const end = lines.findIndex((line, j) => j > starts.at(-1) && line.trim() === '');
  ACCOUNT_ROWS.forEach(([head, sources], i) => {
    const cell = lines.slice(starts[i], starts[i + 1] ?? end).map((line) => line.slice(41).trim()).join(' ');
    for (const source of sources) assert.ok(cell.includes(source), `the "${head}" row does not name ${source}`);
  });
  const exported = {
    hashPassword: '../lib/password.js',
    verifyPassword: '../lib/password.js',
    sendMail: '../lib/mail.js',
    requestAccount: '../lib/accounts.js',
    mailAdmins: '../lib/accounts.js',
    clearExpiredRequests: '../lib/accounts.js',
    verifyTurnstile: '../lib/turnstile.js',
    newLink: '../lib/password-link.js',
    replaceOthers: '../lib/password-link.js',
    dropLink: '../lib/password-link.js',
    tokenHash: '../lib/password-link.js',
    clearExpiredLinks: '../lib/password-link.js',
    // #222
    setPassword: '../lib/sign-in.js',
    signIn: '../lib/sign-in.js',
    signOut: '../lib/sign-in.js',
    emailHash: '../lib/sign-in.js',
    clearExpiredSignIns: '../lib/sign-in.js',
    signAccountSession: '../lib/account-session.js',
    requireAccount: '../lib/account-session.js',
    normalizePassword: '../lib/password-rules.js',
    pwned: '../lib/password-rules.js',
    sendReset: '../lib/reset.js',
    claimResetRequest: '../lib/reset.js',
    clearExpiredResetRequests: '../lib/reset.js',
    addressHash: '../lib/address.js',
    approveTeams: '../lib/people.js',
    rejectTeams: '../lib/people.js',
    sendLink: '../lib/people.js',
    peopleLists: '../lib/people.js',
  };
  for (const [name, module] of Object.entries(exported)) {
    assert.equal(typeof (await import(module))[name], 'function', `${module} no longer exports ${name}`);
  }
});

test('"only as a hash" is what lib/password.js stores: a PHC string and nothing more, with no run of the password in its salt or hash, that still checks it', async () => {
  const password = 'Fall regatta, 2026';
  const stored = await hashPassword(password);
  // Exactly the PHC shape, so nothing rides along after the hash.
  assert.match(stored, /^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.ok(!stored.includes(password), 'the stored hash holds the password');
  // The salt and hash, decoded, hold no 4-byte run of the password, so it
  // cannot hide inside the salt either (#219's review). Random bytes match a
  // run by chance about once in six million runs.
  const bytes = Buffer.from(password, 'utf8');
  const [, , , salt, hash] = stored.split('$');
  const decoded = Buffer.concat([Buffer.from(salt, 'base64'), Buffer.from(hash, 'base64')]);
  assert.equal(decoded.length, 16 + 32);
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    assert.equal(decoded.indexOf(bytes.subarray(i, i + 4)), -1, `the stored hash holds bytes ${i} to ${i + 3} of the password`);
  }
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword('Fall regatta, 2025', stored), false);
});

// ---- #220: what a request keeps, and the request limit ----------------------

test('the request limit\'s figures are the code\'s: 10 an hour from a network, 100 from everyone, an hour kept, and the admin home clears it', () => {
  const kept = words(section('What an account keeps'));
  assert.match(kept, new RegExp(`one network can send at most ${REQUEST_LIMIT} requests an hour, and the site takes at most ${REQUEST_BUDGET_PER_HOUR} an hour from everyone together\.`));
  assert.equal(REQUEST_WINDOW_SECONDS, 60 * 60, 'the request limit\'s window moved; the page says "an hour"');
  has(kept, [
    'It counts them by the network address each came from, kept only in a scrambled form, made with a secret key.',
    'A request counts for an hour, and is deleted after that, the next time the site takes a request or one of the site\'s admins opens the admin home page.',
    'Until then, the scrambled address is kept with the time of the request, to the second.',
    'A request that made an account gave the account that same time, so for that hour the two could be matched.',
  ], '"What an account keeps"');
  // "Opens the admin home page" is the admin home's own load.
  assert.match(read('functions', 'admin', 'index.js'), /await clearExpiredRequests\(env\.DB, now\);/);
});

test('"the two could be matched" is true: a request that makes an account gives its log row the account\'s time, to the second (#220\'s review)', async () => {
  // Said on /policy rather than changed (owner, at #220's review): if the
  // account's time is ever made coarser, this fails and the sentence goes.
  const db = d1();
  const now = 1_790_000_123;
  const request = { name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', teams: ['cohssa'], note: null };
  assert.deepEqual(await requestAccount(db, { request, address: 'address-a', now }), { outcome: 'taken', created: true });
  const account = db.sqlite.prepare('SELECT requested_at FROM accounts').get().requested_at;
  const logged = db.sqlite.prepare('SELECT requested_at FROM account_request_log').get().requested_at;
  assert.equal(account, now);
  assert.equal(logged, account);
});

// ---- #221: the link to set a password, and the admins' log ------------------

test('the link\'s figures are the code\'s: 7 days, and /admin/people\'s load clears the expired ones (#221, criterion 7)', () => {
  assert.equal(LINK_SECONDS, 7 * 24 * 60 * 60, 'the link\'s lifetime moved; the page says "7 days"');
  const kept = words(section('What an account keeps'));
  assert.equal([...kept.matchAll(/(\d+) days/g)].filter((m) => m[0] === '7 days').length, 2, 'the page names the 7 days twice');
  // "the next time an admin opens the list of accounts" is that page's load.
  assert.match(read('functions', 'admin', 'people.js'), /await clearExpiredLinks\(env\.DB, nowSeconds\(\)\);/);
});

test('"only as a hash" is what a link\'s row holds: the token\'s SHA-256, never the token, and a newer link replaces it once its email is sent (#221)', async (t) => {
  const db = d1();
  const now = 1_790_000_000;
  await requestAccount(db, { request: { name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'a', now });
  await approveTeams(db, { accountId: 1, teams: ['cohssa'], role: 'parent', admin: 'owner@example.com', now });
  // Two links emailed, the way /admin/people sends them, each send accepted.
  const tokens = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, RESEND_URL);
    tokens.push(JSON.parse(init.body).text.match(/token=([A-Za-z0-9_-]{43})/)[1]);
    return Response.json({ id: 'msg-221' });
  });
  const send = (at) => sendLink({ DB: db, RESEND_API_KEY: 'test-key' }, { accountId: 1, admin: 'owner@example.com', now: at, site: 'https://photos.madcowsailing.com' });
  assert.equal(await send(now), 'sent');
  assert.equal(await send(now + 60), 'sent');
  const [first, second] = tokens.map((token) => ({ token }));
  const stored = db.sqlite.prepare('SELECT * FROM password_links').all().map((row) => ({ ...row }));
  // One row: the newer link, once its email was sent, replaced the first.
  assert.deepEqual(stored, [{ token_hash: await tokenHash(second.token), account_id: 1, made_at: now + 60, expires_at: now + 60 + LINK_SECONDS }]);
  for (const { token } of [first, second]) {
    for (const value of Object.values(stored[0])) {
      if (typeof value === 'string') assert.ok(!value.includes(token.slice(0, 8)), 'a stored column holds part of the token');
    }
  }
  // Expired links go on the next clear, and nothing else does.
  await clearExpiredLinks(db, now + 60 + LINK_SECONDS - 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM password_links').get().n, 1);
  await clearExpiredLinks(db, now + 60 + LINK_SECONDS);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM password_links').get().n, 0);
});

// ---- #222: signing in, failed sign-ins, the reset, Pwned Passwords ----------

test('the sign-in figures are the code\'s: 90 days, 10 an hour per address, 20 per network, 100 from everyone, an hour kept, 100 in a row (#222, criterion 8)', () => {
  const kept = words(section('What an account keeps'));
  assert.equal(ACCOUNT_SESSION_DAYS, 90);
  assert.equal(ACCOUNT_COOKIE, '__Host-account');
  assert.match(kept, new RegExp(`Signing in leaves one small cookie on that phone or computer, which keeps it signed in for ${ACCOUNT_SESSION_DAYS} days\\.`));
  has(kept, [
    'The cookie holds your account\'s number, a session number and when you signed in, signed with a secret key so it cannot be changed, and no password, name or email address.',
    // Every device: the owner's choice at #222's pickup. A revoke ends every
    // session today through sessionAccount's approved-team read
    // (test/sign-in.test.js); #225 is to add 1 to the version as well.
    'Signing out, setting a new password, or an admin revoking the account ends every session the account has, on every phone and computer, the next time each is used.',
  ], '"What an account keeps"');
  assert.match(kept, new RegExp(`at most ${EMAIL_FAILURE_LIMIT} an hour for one email address, whether or not it has an account, and ${NETWORK_FAILURE_LIMIT} an hour from one network\\.`));
  assert.match(kept, new RegExp(`The site takes at most ${FAILURE_BUDGET_PER_HOUR} failed sign-ins an hour from everyone together, and after that nobody can sign in until the hour is up\\.`));
  assert.match(kept, new RegExp(`After ${FAILED_IN_A_ROW} failed sign-ins in a row, an account's password stops working until a new one is set\\.`));
  assert.equal(SIGN_IN_WINDOW_SECONDS, 60 * 60, 'the failed sign-in window moved; the page says "an hour"');
  has(kept, [
    'It keeps each failed try for an hour, with the email address that was typed and the network address it came from, both only in a scrambled form, made with a secret key.',
    'After that hour it is deleted, the next time a sign-in fails or one of the site\'s admins opens the admin home page, and a sign-in that succeeds deletes its address\'s tries at once.',
  ], '"What an account keeps"');
});

test('"opens the admin home page" deletes failed sign-ins and reset requests over an hour old, and keeps the rest (#222)', async () => {
  // The admin home itself, loaded, rather than a regex over its source,
  // which a commented-out call still matched (#222's review).
  const db = d1();
  const now = nowSeconds();
  const insertTry = db.sqlite.prepare('INSERT INTO sign_in_failures (email_hash, address_hash, failed_at) VALUES (?, ?, ?)');
  const insertAsk = db.sqlite.prepare('INSERT INTO reset_request_log (address_hash, requested_at) VALUES (?, ?)');
  for (const [name, at] of [['old', now - 2 * 3600], ['fresh', now - 60]]) {
    insertTry.run(`e-${name}`, `a-${name}`, at);
    insertAsk.run(`a-${name}`, at);
  }
  const response = await adminHomeRoute({ data: { owner: { email: 'owner@example.com' } }, env: { DB: db } });
  assert.equal(response.status, 200);
  assert.deepEqual(db.sqlite.prepare('SELECT email_hash FROM sign_in_failures').all().map((r) => r.email_hash), ['e-fresh']);
  assert.deepEqual(db.sqlite.prepare('SELECT address_hash FROM reset_request_log').all().map((r) => r.address_hash), ['a-fresh']);
});

test('the reset figures are the code\'s: an hour, once, a hash, one every 15 minutes, 20 a day, 10 requests an hour per network (#222, criterion 8)', () => {
  const kept = words(section('What an account keeps'));
  assert.equal(RESET_SECONDS, 60 * 60, 'the reset link\'s lifetime moved; the page says "for an hour"');
  assert.equal(RESET_REQUEST_WINDOW_SECONDS, 60 * 60, 'the reset request window moved; the page says "an hour"');
  has(kept, [
    'If you forget your password, the form to reset it emails a link to set a new one, but only to an address with an account the site\'s admins approved.',
    'The link works once, for an hour, and is kept only as a hash, like the link an approval sends.',
  ], '"What an account keeps"');
  // "While an earlier one waits": the gap is read from the links the account
  // still holds, and a used link is gone (#222's review).
  assert.match(kept, new RegExp(`The site sends one account at most one link every ${RESET_GAP_SECONDS / 60} minutes while an earlier one waits to be used, and at most ${RESET_EMAILS_PER_DAY} reset emails a day for everyone together\\.`));
  assert.match(kept, new RegExp(`One network can ask at most ${RESET_REQUEST_LIMIT} times an hour, counted by its network address in the same scrambled form, which is kept for an hour and deleted after that, the next time anyone asks or one of the site's admins opens the admin home page\\.`));
});

test('"no password, name or email address" is what the cookie holds, and a changed byte is refused (#222)', async () => {
  const db = d1();
  const now = 1_790_000_000;
  await requestAccount(db, { request: { name: 'Jane Rivers', email: 'jane.rivers@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'a', now });
  await approveTeams(db, { accountId: 1, teams: ['cohssa'], role: 'parent', admin: 'owner@example.com', now });
  const key = 'test-session-signing-key-0123456789abcdef';
  const line = await accountCookie(key, { accountId: 1, version: 1 }, now);
  const value = line.split(';')[0].slice(`${ACCOUNT_COOKIE}=`.length);
  for (const part of ['jane', 'rivers', 'example', 'Jane Rivers']) assert.ok(!value.toLowerCase().includes(part.toLowerCase()), `the cookie holds "${part}"`);
  assert.match(value, /^a1\.1\.1\.1790000000\.[A-Za-z0-9_-]{43}$/);
  const request = (cookie) => new Request('https://photos.madcowsailing.com/account', { headers: { Cookie: `${ACCOUNT_COOKIE}=${cookie}` } });
  assert.deepEqual(await readAccountSession(request(value), key, now), { accountId: 1, version: 1, issued: now });
  // The control: the same cookie naming another account is refused.
  assert.equal(await readAccountSession(request(value.replace(/^a1\.1\./, 'a1.2.')), key, now), null);
});

test('"ends every session the account has, on every phone and computer" is what signing out does (#222, criterion 7)', async () => {
  const db = d1();
  const now = 1_790_000_000;
  await requestAccount(db, { request: { name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'a', now });
  await approveTeams(db, { accountId: 1, teams: ['cohssa'], role: 'parent', admin: 'owner@example.com', now });
  // Two devices, both signed in at version 1.
  const phone = { accountId: 1, version: 1, issued: now };
  const laptop = { accountId: 1, version: 1, issued: now + 60 };
  assert.ok(await sessionAccount(db, phone));
  assert.ok(await sessionAccount(db, laptop));
  assert.equal(await signOut(db, phone), true);
  assert.equal(await sessionAccount(db, phone), null);
  assert.equal(await sessionAccount(db, laptop), null, 'signing out on one device left another signed in');
});

test('"only the first 5 characters of the password\'s SHA-1 hash, never the password" is what the breach check sends (#222)', async (t) => {
  const password = 'four unrelated words in a row';
  const sha1 = (await import('node:crypto')).createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    asked.push({ url, init });
    return new Response(`${sha1.slice(5)}:0\r\n${'0'.repeat(35)}:3\r\n`);
  });
  // A padded line counts 0, so the password reads clear.
  assert.equal(await pwned(password), 'clear');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, `${PWNED_RANGE_URL}${sha1.slice(0, 5)}`);
  assert.equal(PWNED_RANGE_URL, 'https://api.pwnedpasswords.com/range/');
  assert.equal(asked[0].init.headers['Add-Padding'], 'true');
  const sent = JSON.stringify(asked[0]);
  assert.ok(!sent.includes(password) && !sent.includes(sha1.slice(5)), 'the check sent the password or the rest of its hash');
  assert.equal(words(section('What an account keeps')).includes('It sends the service only the first 5 characters of the password\'s SHA-1 hash, never the password, and gets back every breached hash that starts with them, so the service never learns which password was checked.'), true);
});

test('"kept only as a hash" is what a reset link\'s row holds, and it lasts an hour (#222, criterion 5)', async (t) => {
  const db = d1();
  const now = 1_790_000_000;
  await requestAccount(db, { request: { name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'a', now });
  await approveTeams(db, { accountId: 1, teams: ['cohssa'], role: 'parent', admin: 'owner@example.com', now });
  let token = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, RESEND_URL);
    token = JSON.parse(init.body).text.match(/token=([A-Za-z0-9_-]{43})/)[1];
    return Response.json({ id: 'msg-222' });
  });
  assert.equal(await sendReset({ DB: db, RESEND_API_KEY: 'test-key' }, { email: 'jane@example.org', now, site: 'https://photos.madcowsailing.com' }), 'sent');
  const stored = db.sqlite.prepare('SELECT * FROM password_links').all().map((row) => ({ ...row }));
  assert.deepEqual(stored, [{ token_hash: await tokenHash(token), account_id: 1, made_at: now, expires_at: now + RESET_SECONDS }]);
  for (const value of Object.values(stored[0])) {
    if (typeof value === 'string') assert.ok(!value.includes(token.slice(0, 8)), 'a stored column holds part of the token');
  }
});

// Every table the schema holds, and what each can hold about an account. A
// table this list does not know fails the test below: a later story adding
// one (#223's sender, #225's revoked addresses) seeds it there and says
// whether it may keep naming an account after a delete.
const TABLES = {
  accounts: 'the account itself',
  account_teams: 'its teams, deleted with it (ON DELETE CASCADE)',
  password_links: 'its links to set a password, deleted with it (ON DELETE CASCADE) (#221)',
  admin_log: 'the admins\' log, which copies the person\'s name and address into each entry and keeps them after a delete (#221)',
  teams: 'the two teams, which name no account',
  account_request_log: 'keyed network addresses, which name no account; a row\'s time matches its account\'s for the hour it is kept, and nothing once the account is gone',
  account_request_budget: 'a count per hour',
  account_request_mail: 'when the admins were last emailed',
  albums: 'albums, which name no account',
  photos: 'photos; none names an account until #223',
  upload_counts: 'a count per upload session',
  invite_codes: 'the invite codes',
  join_failures: 'keyed network addresses',
  join_budget: 'a count per hour',
  removal_requests: 'keyed network addresses',
  // #222. A failed try keeps the typed email address as a keyed hash, which
  // names no account by id and holds no address; a deleted account's stay
  // until their hour is up, as /policy says every failed try is kept.
  sign_in_failures: 'keyed email and network addresses, each kept an hour',
  sign_in_budget: 'a count per hour',
  reset_request_log: 'keyed network addresses',
  reset_mail_budget: 'a count per day',
  // A counter, not a reference: the highest id each AUTOINCREMENT table has
  // given, which can equal a deleted account's.
  sqlite_sequence: 'the highest id each AUTOINCREMENT table has given',
};

// What may keep naming an account after README's delete, each by the story
// that makes it: the admins' log entries (#221) and, for a revoked account,
// its address as a keyed hash (#225), which does not exist yet.
const SURVIVORS = new Set(['admin_log']);

test('README\'s by-hand account delete, run only once the account\'s own address confirms, leaves no row naming the account (#220, criterion 8)', async (t) => {
  const readme = read('..', 'README.md');
  const steps = readme.split('### Deleting an account by hand\n')[1]?.split(/\n## |\n### /)[0] ?? '';
  assert.match(steps, /\*\*Only once a reply from the\s+account's own address confirms the request\*\*/);
  const sql = steps.match(/--command "(DELETE FROM accounts [^"]+)"/)?.[1];
  assert.ok(sql && sql.includes('<id>'), 'README has no delete statement naming <id>');

  // A row in every table, two accounts among them: the one to delete, and one
  // that must stay.
  const db = d1();
  const now = 1_790_000_000;
  const ask = (email, address) => requestAccount(db, {
    request: { name: email.split('@')[0], email, role: 'parent', teams: ['hoover-jrt', 'cohssa'], note: 'a note' }, address, now,
  });
  await ask('Delete.Me@Example.org', 'address-one');
  await ask('stays@example.org', 'address-two');
  seedCodes(db, 'K7QM-3XRD-9FWB');
  db.sqlite.prepare('INSERT INTO join_failures (address_hash, failed_at) VALUES (?, ?)').run('h', now);
  db.sqlite.prepare('INSERT INTO join_budget (hour, recorded) VALUES (?, 1)').run(Math.floor(now / 3600));
  db.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)').run('h', now);
  db.sqlite.prepare('INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, 1)').run('1.1', Math.floor(now / 86400));
  db.sqlite.prepare('INSERT INTO account_request_mail (id, sent_at) VALUES (1, ?)').run(now);
  // #222's: a failed sign-in for the address to delete, the hour's and the
  // day's counts, and a reset request.
  db.sqlite.prepare('INSERT INTO sign_in_failures (email_hash, address_hash, failed_at) VALUES (?, ?, ?)').run('keyed-email', 'h', now);
  db.sqlite.prepare('INSERT INTO sign_in_budget (hour, failed) VALUES (?, 1)').run(Math.floor(now / 3600));
  db.sqlite.prepare('INSERT INTO reset_request_log (address_hash, requested_at) VALUES (?, ?)').run('h', now);
  db.sqlite.prepare('INSERT INTO reset_mail_budget (day, sent) VALUES (?, 1)').run(Math.floor(now / 86400));
  const address = await createAlbum(db, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, now);
  const album = db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  db.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at) ' +
    "VALUES (?, 'photo', 'approved', ?, 'b', 'parent', 1, 1, 1, 2, 4, 3, 4, 3, 4, 3, 10, 3)",
  ).run(album, 'a'.repeat(32));
  // #221: both accounts approved through the admins' own functions, so the
  // log and the links hold real rows about each: a role change, an approval,
  // a turn-down and a link sent for the one to delete (the seeding cairn's
  // a-timestamp-joins-to-the-log-that-names-it asks for, or the log would
  // pass by never being seen).
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, RESEND_URL);
    return Response.json({ id: 'msg-221' });
  });
  const env = { DB: db, RESEND_API_KEY: 'test-key' };
  const admin = 'owner@example.com';
  for (const accountId of [1, 2]) {
    assert.deepEqual(await approveTeams(db, { accountId, teams: ['hoover-jrt'], role: 'coach', admin, now }), ['hoover-jrt']);
    assert.equal(await sendLink(env, { accountId, admin, now, site: 'https://photos.madcowsailing.com' }), 'sent');
  }
  assert.deepEqual(await rejectTeams(db, { accountId: 1, teams: ['cohssa'], admin, now }), ['cohssa']);
  const logged = db.sqlite.prepare('SELECT action, name, email FROM admin_log WHERE account_id = 1 ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(logged.map((r) => r.action), ['role', 'approve', 'link', 'reject']);

  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, Object.keys(TABLES).sort(), 'a table this test does not know: seed it here, and say whether it may name an account');
  for (const table of tables) {
    assert.ok(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n > 0, `${table} holds no row, so the check below could not see one`);
  }

  // What names the account: its id in a column that refers to accounts, or a
  // column named for an account's id, and its address in any letter case.
  const target = db.sqlite.prepare("SELECT id, email FROM accounts WHERE email = 'Delete.Me@Example.org'").get();
  const naming = () => {
    const found = [];
    for (const table of tables) {
      if (SURVIVORS.has(table)) continue;
      const idColumns = new Set([
        ...db.sqlite.prepare(`SELECT "from" AS col FROM pragma_foreign_key_list('${table}') WHERE "table" = 'accounts'`).all().map((r) => r.col),
        ...db.sqlite.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name).filter((name) => /(^|_)account(_id)?$/.test(name)),
      ]);
      if (table === 'accounts') idColumns.add('id');
      for (const row of db.sqlite.prepare(`SELECT * FROM "${table}"`).all()) {
        for (const [column, value] of Object.entries(row)) {
          if (idColumns.has(column) && value === target.id) found.push(`${table}.${column}`);
          if (typeof value === 'string' && value.toLowerCase().includes(target.email.toLowerCase())) found.push(`${table}.${column}`);
        }
      }
    }
    return [...new Set(found)].sort();
  };
  // The control: before the delete, the check finds the account, its teams
  // and its link (#221).
  assert.deepEqual(naming(), ['account_teams.account_id', 'accounts.email', 'accounts.id', 'password_links.account_id']);

  assert.equal(db.sqlite.prepare(sql.replace('<id>', '?')).run(target.id).changes, 1);
  assert.deepEqual(naming(), []);
  // The other account is as it was, teams, link and all.
  assert.deepEqual(db.sqlite.prepare('SELECT email FROM accounts').all().map((r) => r.email), ['stays@example.org']);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM account_teams').get().n, 2);
  assert.deepEqual(db.sqlite.prepare('SELECT account_id FROM password_links').all().map((r) => r.account_id), [2]);
  // The admins' log, the one survivor, still names the person, as /policy
  // promises: every entry, by name and address, and the delete changed none.
  const after = db.sqlite.prepare('SELECT action, name, email FROM admin_log WHERE account_id = ? ORDER BY id').all(target.id).map((r) => ({ ...r }));
  assert.deepEqual(after, logged);
  assert.ok(after.every((r) => r.name === 'Delete.Me' && r.email === 'Delete.Me@Example.org'), 'a log entry no longer names the person');
  // And README's read-back finds nothing, as step 4 says.
  const lookup = steps.match(/--command "(SELECT id, name, email FROM accounts WHERE email = '<address>')"/)?.[1];
  assert.ok(lookup, 'README has no lookup statement');
  const find = db.sqlite.prepare(lookup.replace("'<address>'", '?'));
  assert.deepEqual(find.all('Delete.Me@Example.org'), []);
  // The lookup matches whatever letter case the address is written in.
  assert.equal(find.all('STAYS@example.org').length, 1);
});

// ---- #238: which release covers which team's photos -------------------------
//
// Hoover JRT's photos are checked against the families who opted out of its
// release, and COHSSA's release has none (CLAUDE.md, The photo site, item
// 24). COHSSA's wording is not recorded yet, so the page names the release
// and does not quote it (owner, at #238's gate).

// One paragraph of the check, whole: the capture stops at its own </p>, so a
// claim in the paragraph after it cannot stand in for one in it.
const checkParagraph = (lead) => {
  const found = section('Every photo is checked first').match(new RegExp(`<p>(${lead}(?:(?!</p>)[\\s\\S])*)</p>`));
  assert.ok(found, `the check has no paragraph starting "${lead}"`);
  return words(found[1]);
};

test('/policy names COHSSA\'s season-registration release and says it has no opt-out (#238, criterion 2)', () => {
  const cohssa = checkParagraph('For COHSSA,');
  has(cohssa, [
    'COHSSA\'s season-registration release',
    'which COHSSA issues as part of registering for its season', // item 24, #194
    'It has no opt-out, so there is no list of families to check a COHSSA photo against.',
  ], 'COHSSA\'s paragraph');
  assert.doesNotMatch(cohssa, /opted out/);
});

test('the check says which release covers each team\'s photos, and Hoover JRT\'s reads as it did (#238, criterion 3)', () => {
  const check = section('Every photo is checked first');
  const paragraphs = [...check.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => words(m[1]));
  assert.ok(paragraphs[0].includes('checks it against the media release that covers its team.'), paragraphs[0]);
  // One paragraph for each team, in the order every page lists them, each
  // naming its release. A third team fails here until the page names its.
  const teams = paragraphs.filter((paragraph) => paragraph.startsWith('For '));
  assert.deepEqual(teams.map((paragraph) => paragraph.match(/^For ([^,]+),/)?.[1]), TEAMS.map(({ name }) => name));
  for (const paragraph of teams) assert.match(paragraph, /release/);
  // Hoover JRT's check against the families who opted out, in the words the
  // whole check used before #238.
  assert.equal(teams[0], 'For Hoover JRT, that is the media release families sign when they register with the team. '
    + 'The admin turns down any photo they recognize as showing a sailor whose family opted out.');
});

// The trace table's #238 rows, in order, each with the sources its own cell
// must name, read from column 41 up to the next row's first line, as for
// ACCOUNT_ROWS. The last row ends where the row after it begins.
const RELEASE_ROWS = [
  ['Every photo and caption checked', ['D5', '#159\'s review', 'albums.team', 'migrations/0010_album_teams.sql', '#227']],
  ['Hoover JRT: the release families', ['D5', '#238\'s criterion 3']],
  ['COHSSA: its season-registration', ['item 24', '2026-10-05 (#194)', 'not recorded yet', '#238\'s gate']],
  ['Turned down means deleted', []],
];

test('the head comment traces which release covers which team, each in its own row (#238)', () => {
  const lines = POLICY.match(/<!-- Story #159[\s\S]*?-->/)[0].split('\n');
  const starts = RELEASE_ROWS.map(([head]) => lines.findIndex((line) => line.startsWith(`       ${head}`)));
  RELEASE_ROWS.forEach(([head], i) => {
    assert.ok(starts[i] > 0, `the trace table has no "${head}" row`);
    if (i > 0) assert.ok(starts[i] > starts[i - 1], `the "${head}" row is out of order`);
  });
  RELEASE_ROWS.slice(0, -1).forEach(([head, sources], i) => {
    const cell = lines.slice(starts[i], starts[i + 1]).map((line) => line.slice(41).trim()).join(' ');
    for (const source of sources) assert.ok(cell.includes(source), `the "${head}" row does not name ${source}`);
  });
});

