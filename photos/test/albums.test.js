// The albums (#153): adding, editing, closing, reopening and deleting them on
// /admin/albums, and the open list an upload session reads. Every request
// runs through the chain Pages runs in front of the route (the root
// middleware, then the directory's guards), against a real SQLite holding
// the real migrations (test/d1.js), with Access tokens minted by
// test/access.js. Each test names the criterion it holds.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as albumsPage } from '../functions/admin/albums.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import * as create from '../functions/api/admin/albums/create.js';
import * as update from '../functions/api/admin/albums/update.js';
import * as close from '../functions/api/admin/albums/close.js';
import * as reopen from '../functions/api/admin/albums/reopen.js';
import * as remove from '../functions/api/admin/albums/delete.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openList } from '../functions/api/albums/open.js';
import { TOKEN_HEADER, keyCache } from '../lib/access.js';
import { MAX_SUFFIX, baseAddress, openAlbum, slugify } from '../lib/albums.js';
import { COOKIE_NAME, nowSeconds, signSession } from '../lib/session.js';
import { accessEnv, certs, keyPair, mint } from './access.js';
import { d1, seedCodes } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const ROUTES = { create, update, close, reopen, delete: remove };

const team = await keyPair();
beforeEach(() => {
  keyCache.clear();
  mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
});
afterEach(() => mock.restoreAll());

function site() {
  const DB = d1();
  seedCodes(DB, 'Q2WE-R4TY-V6PA', 'K7QM-3XRD-9FWB'); // generation 2 is current
  return { DB, SITE_ENV: 'production', SESSION_SIGNING_KEY: KEY, ...accessEnv() };
}

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const FORM = 'application/x-www-form-urlencoded';

/** A press on the admin page: a form post to /api/admin/albums/<action>. */
async function post(env, action, fields, { type = FORM, body } = {}) {
  const request = new Request(`${SITE}/api/admin/albums/${action}`, {
    method: 'POST',
    headers: { Origin: SITE, [TOKEN_HEADER]: await mint(team), 'Content-Type': type },
    body: body ?? new URLSearchParams(fields).toString(),
  });
  return chain([root, ...adminApi, ROUTES[action].onRequestPost], request, env);
}

/** Where a press sent the browser, as its query: { done, error, album, photos }. */
const landing = (res) => {
  assert.equal(res.status, 303);
  const url = new URL(res.headers.get('Location'), SITE);
  assert.equal(url.pathname, '/admin/albums');
  return Object.fromEntries(url.searchParams);
};

/** GET /admin/albums, with `query` as the landing a press sent. */
async function page(env, query = '') {
  const request = new Request(`${SITE}/admin/albums${query}`, { headers: { [TOKEN_HEADER]: await mint(team) } });
  const res = await chain([root, ...adminPages, albumsPage], request, env);
  assert.equal(res.status, 200);
  return res.text();
}

/** GET /api/albums/open through the upload guard, with `cookie` if given. */
async function openCall(env, cookie) {
  const headers = cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {};
  const request = new Request(`${SITE}/api/albums/open`, { headers });
  return chain([root, albumsGuard, openList], request, env);
}

const session = () => signSession(KEY, 2, nowSeconds());
const openAddresses = async (env) => (await (await openCall(env, await session())).json()).albums.map((a) => a.address);

const rows = (env) => env.DB.sqlite.prepare('SELECT address, title, kind, held_on, closed_at FROM albums ORDER BY id').all().map((r) => ({ ...r }));

const FALL = { title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };

async function add(env, fields = FALL) {
  return landing(await post(env, 'create', fields)).album;
}

// A photos table standing in for #154's, until #154 makes the real one: each
// photo references its album, and nothing else here depends on its columns.
function photos(env, address, states) {
  const { sqlite } = env.DB;
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'photos'").get();
  if (!exists) {
    sqlite.exec(`CREATE TABLE photos (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums (id),
      state TEXT NOT NULL
    )`);
  }
  const { id } = sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address);
  for (const state of states) sqlite.prepare('INSERT INTO photos (album_id, state) VALUES (?, ?)').run(id, state);
}

const validator = new HtmlValidate(new FileSystemConfigLoader());
const problems = async (html) =>
  (await validator.validateString(html, join(ROOT, 'admin.html'))).results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

// ---- Criterion 1: adding an album, and its address ----------------------

test('adding a title, a kind and a date makes the album, at an address built from the date and title', async () => {
  const env = site();
  const res = await post(env, 'create', FALL);
  assert.deepEqual(landing(res), { done: 'created', album: '2026-10-04-fall-regatta' });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(rows(env), [{ address: '2026-10-04-fall-regatta', title: 'Fall Regatta', kind: 'regatta', held_on: '2026-10-04', closed_at: null }]);
});

test('the page then names the new album and its address, and lists it with its kind and date', async () => {
  const env = site();
  await add(env);
  const html = await page(env, '?done=created&album=2026-10-04-fall-regatta');
  assert.match(html, /<p role="status">Added Fall Regatta\. Its address is <code>2026-10-04-fall-regatta<\/code>\.<\/p>/);
  assert.match(html, /<h3 id="album-1">Fall Regatta<\/h3>/);
  assert.match(html, /Regatta · <time datetime="2026-10-04">4 October 2026<\/time> · <code>2026-10-04-fall-regatta<\/code>/);
});

test('an address drops accents, makes every run of punctuation one hyphen, and cuts a long title at a word', () => {
  const at = (title, kind = 'regatta') => baseAddress({ title, kind, date: '2026-10-04' });
  assert.equal(at('Fall Regatta'), '2026-10-04-fall-regatta');
  assert.equal(at('Régate d’Automne!!'), '2026-10-04-regate-d-automne');
  assert.equal(at('Practice #3 — light air'), '2026-10-04-practice-3-light-air');
  assert.equal(at('  --Spring  Series-- '), '2026-10-04-spring-series');
  // 74 characters in full; the cut ends at the last whole word inside 60.
  assert.equal(slugify('Midwinter Championship of the Southern Lakes Invitational Series, Final Day'),
    'midwinter-championship-of-the-southern-lakes-invitational');
  assert.equal(slugify('x'.repeat(70)), 'x'.repeat(60), 'one word longer than the cut is cut inside it');
});

test('a title with no letter or digit takes its kind\'s name, so every address has a word', () => {
  assert.equal(baseAddress({ title: '&', kind: 'practice', date: '2026-10-04' }), '2026-10-04-practice');
  assert.equal(baseAddress({ title: '<>', kind: 'regatta', date: '2026-10-04' }), '2026-10-04-regatta');
});

test('a second album with the same date and title gets -2, then -3', async () => {
  const env = site();
  assert.equal(await add(env), '2026-10-04-fall-regatta');
  assert.equal(await add(env), '2026-10-04-fall-regatta-2');
  assert.equal(await add(env, { ...FALL, title: 'FALL  regatta!' }), '2026-10-04-fall-regatta-3');
  assert.equal(rows(env).length, 3);
});

test('when every address a date and title can take is held, adding says so on the page, not in a 500', async () => {
  const env = site();
  // Held by albums renamed since: an address keeps its slot whatever the title says now.
  const insert = env.DB.sqlite.prepare('INSERT INTO albums (address, title, kind, held_on, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    insert.run(n === 1 ? '2026-10-04-fall-regatta' : `2026-10-04-fall-regatta-${n}`, `Renamed ${n}`, 'regatta', '2026-10-04', 1);
  }
  assert.deepEqual(landing(await post(env, 'create', FALL)), { error: 'full' });
  assert.equal(rows(env).length, MAX_SUFFIX);
  assert.match(await page(env, '?error=full'), /<p role="status">Nothing was saved: 50 albums already hold every address this date and title can have\. Change the title\.<\/p>/);
  // The control: free one slot, and the same add takes it.
  env.DB.sqlite.prepare("DELETE FROM albums WHERE address = '2026-10-04-fall-regatta-37'").run();
  assert.equal(await add(env), '2026-10-04-fall-regatta-37');
});

test('editing the title, kind and date keeps the address, so a shared link keeps working', async () => {
  const env = site();
  const address = await add(env);
  const res = await post(env, 'update', { address, title: 'Fall Regatta, day one', kind: 'practice', date: '2026-10-05' });
  assert.deepEqual(landing(res), { done: 'saved', album: address });
  assert.deepEqual(rows(env), [{ address, title: 'Fall Regatta, day one', kind: 'practice', held_on: '2026-10-05', closed_at: null }]);
  assert.equal((await openAlbum(env.DB, address)).title, 'Fall Regatta, day one');
  assert.equal(await openAlbum(env.DB, '2026-10-05-fall-regatta-day-one'), null);
  assert.match(await page(env, `?done=saved&album=${address}`), /Saved Fall Regatta, day one\. Its address stays <code>2026-10-04-fall-regatta<\/code>\./);
});

test('a missing or wrong field saves nothing, and the page says which', async () => {
  const env = site();
  const cases = [
    [{ ...FALL, title: '' }, 'title'],
    [{ ...FALL, title: '   ' }, 'title'],
    [{ ...FALL, title: 'x'.repeat(81) }, 'title'],
    [{ ...FALL, title: 'Fall\nRegatta' }, 'title'],
    [{ ...FALL, title: `Fall${String.fromCharCode(0x85)}Regatta` }, 'title'], // NEL, a C1 control
    [{ ...FALL, title: `Fall${String.fromCharCode(0x2028)}Regatta` }, 'title'],
    [{ kind: 'regatta', date: '2026-10-04' }, 'title'],
    [{ ...FALL, kind: 'race' }, 'kind'],
    [{ ...FALL, kind: '__proto__' }, 'kind'],
    [{ ...FALL, date: '2026-02-30' }, 'date'],
    [{ ...FALL, date: '04/10/2026' }, 'date'],
    [{ ...FALL, date: '' }, 'date'],
  ];
  for (const [fields, error] of cases) {
    assert.deepEqual(landing(await post(env, 'create', fields)), { error }, JSON.stringify(fields));
  }
  assert.deepEqual(rows(env), []);
  // The control: the longest title allowed, and 29 February in a leap year, save.
  assert.equal(await add(env, { ...FALL, title: 'x'.repeat(80), date: '2028-02-29' }), `2028-02-29-${'x'.repeat(60)}`);
  assert.match(await page(env, '?error=date'), /<p role="status">Nothing was saved: the date is not a real day\.<\/p>/);
});

test('an edit with a wrong field, or of an album that is not there, changes nothing', async () => {
  const env = site();
  const address = await add(env);
  const before = rows(env);
  assert.deepEqual(landing(await post(env, 'update', { address, ...FALL, title: '' })), { error: 'title' });
  assert.deepEqual(landing(await post(env, 'update', { ...FALL, address: '2026-10-04-no-such-album' })), { error: 'missing' });
  assert.deepEqual(landing(await post(env, 'update', { ...FALL, address: '../../etc' })), { error: 'missing' });
  assert.deepEqual(rows(env), before);
});

test('a body that is not a form saves nothing, and is not a 500', async () => {
  const env = site();
  for (const [type, body] of [['application/json', JSON.stringify(FALL)], ['text/plain', '{}'], [`${FORM}x`, new URLSearchParams(FALL).toString()]]) {
    assert.deepEqual(landing(await post(env, 'create', null, { type, body })), { error: 'title' }, type);
  }
  assert.deepEqual(landing(await post(env, 'create', null, { body: `${new URLSearchParams(FALL)}&pad=${'x'.repeat(5000)}` })), { error: 'title' });
  assert.deepEqual(rows(env), []);
  // The control: the same fields as a form, with a charset, save.
  assert.equal(landing(await post(env, 'create', FALL, { type: `${FORM}; charset=UTF-8` })).album, '2026-10-04-fall-regatta');
});

// ---- Criterion 2: closing and reopening ---------------------------------

test('closing an album takes it off the open list and out of the upload check; reopening puts it back', async () => {
  const env = site();
  const fall = await add(env);
  const practice = await add(env, { title: 'Tuesday practice', kind: 'practice', date: '2026-09-29' });
  assert.deepEqual(await openAddresses(env), [fall, practice]);

  assert.deepEqual(landing(await post(env, 'close', { address: fall })), { done: 'closed', album: fall });
  assert.deepEqual(await openAddresses(env), [practice]);
  assert.equal(await openAlbum(env.DB, fall), null, 'an upload naming a closed album would be taken');
  assert.equal((await openAlbum(env.DB, practice)).address, practice);
  const closed = await page(env, `?done=closed&album=${fall}`);
  assert.match(closed, /Closed Fall Regatta\. Parents can no longer send photos to it, and its approved photos stay public\./);
  const [, openSection, closedSection] = closed.split(/<section class="wrap" aria-labelledby="(?:open|closed)-albums">/);
  assert.doesNotMatch(openSection, /Fall Regatta/);
  assert.match(closedSection, /aria-label="Reopen Fall Regatta">Reopen<\/button>/);

  assert.deepEqual(landing(await post(env, 'reopen', { address: fall })), { done: 'reopened', album: fall });
  assert.deepEqual(await openAddresses(env), [fall, practice]);
  assert.equal((await openAlbum(env.DB, fall)).address, fall);
  assert.match(await page(env, `?done=reopened&album=${fall}`), /Reopened Fall Regatta\. Parents can send photos to it again\./);
});

test('closing leaves the album and every photo in it where they are', async () => {
  const env = site();
  const fall = await add(env);
  photos(env, fall, ['approved', 'approved', 'pending']);
  await post(env, 'close', { address: fall });
  assert.equal(rows(env).length, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 3);
});

test('closing twice keeps the time it was first closed; an unknown album is missing', async () => {
  const env = site();
  const fall = await add(env);
  await post(env, 'close', { address: fall });
  env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE address = ?').run(fall);
  assert.deepEqual(landing(await post(env, 'close', { address: fall })), { done: 'closed', album: fall });
  assert.equal(rows(env)[0].closed_at, 1);
  for (const action of ['close', 'reopen']) {
    assert.deepEqual(landing(await post(env, action, { address: '2026-10-04-nothing' })), { error: 'missing' }, action);
    assert.deepEqual(landing(await post(env, action, {})), { error: 'missing' }, action);
  }
});

test('an unknown or malformed address is never an open album', async () => {
  const env = site();
  await add(env);
  for (const address of ['2026-10-04-nothing', '', undefined, null, 42, "2026-10-04-fall-regatta' OR 1=1 --", '2026-10-04-FALL-REGATTA']) {
    assert.equal(await openAlbum(env.DB, address), null, String(address));
  }
});

// ---- Criterion 3: deleting ----------------------------------------------

test('an empty album deletes', async () => {
  const env = site();
  const fall = await add(env);
  assert.deepEqual(landing(await post(env, 'delete', { address: fall })), { done: 'deleted', album: fall });
  assert.deepEqual(rows(env), []);
  assert.match(await page(env, `?done=deleted&album=${fall}`), /<p role="status">Deleted <code>2026-10-04-fall-regatta<\/code>\.<\/p>/);
  assert.deepEqual(landing(await post(env, 'delete', { address: fall })), { error: 'missing' });
});

test('an album holding a photo in any state is not deleted, and the page says how many', async () => {
  const env = site();
  const fall = await add(env);
  const practice = await add(env, { title: 'Tuesday practice', kind: 'practice', date: '2026-09-29' });
  photos(env, fall, ['pending', 'approved', 'hidden']);
  photos(env, practice, ['hidden']);

  assert.deepEqual(landing(await post(env, 'delete', { address: fall })), { error: 'not-empty', album: fall, photos: '3' });
  assert.deepEqual(landing(await post(env, 'delete', { address: practice })), { error: 'not-empty', album: practice, photos: '1' });
  assert.equal(rows(env).length, 2);
  assert.match(await page(env, `?error=not-empty&album=${fall}&photos=3`),
    /<p role="status">Fall Regatta was not deleted: it holds 3 photos\. Only an empty album can be deleted\. Close it instead to stop uploads to it\.<\/p>/);
  assert.match(await page(env, `?error=not-empty&album=${practice}&photos=1`), /Tuesday practice was not deleted: it holds 1 photo\./);
});

test('the refusal is the database\'s own, so no route and no race can get past it', async () => {
  // D1 enforces foreign keys in every query, as node:sqlite does here. A
  // DELETE sent straight to the database fails the same way, which is what
  // makes a count taken first unnecessary.
  const env = site();
  const fall = await add(env);
  photos(env, fall, ['pending']);
  assert.throws(() => env.DB.sqlite.prepare('DELETE FROM albums WHERE address = ?').run(fall), /FOREIGN KEY constraint failed/);
  assert.equal(env.DB.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

// What is wrong with how a schema's tables point at albums, as sentences. The
// delete refusal rests on #154's table being exactly photos, with album_id
// REFERENCES albums (id) and no ON DELETE action, because deleteAlbum counts
// `FROM photos WHERE album_id`. So any other table that references albums,
// or has a column naming an album, is a problem, and so is a photos table
// whose album_id carries no reference, or one that cascades or nulls.
function albumReferenceProblems(sqlite) {
  const problems = [];
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('albums', 'd1_migrations')")
    .all().map((r) => r.name);
  for (const table of tables) {
    const refs = sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all().filter((r) => r.table === 'albums');
    const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name).filter((c) => /album/i.test(c));
    if (table !== 'photos') {
      if (refs.length || columns.length) problems.push(`${table} names albums, but deleteAlbum counts photos`);
      continue;
    }
    if (columns.join() !== 'album_id') problems.push(`photos names albums by ${columns.join(', ') || 'nothing'}, not album_id alone`);
    const ref = refs.find((r) => r.from === 'album_id');
    if (!ref || ref.to !== 'id') problems.push('photos.album_id does not reference albums (id)');
    else if (!['NO ACTION', 'RESTRICT'].includes(ref.on_delete)) problems.push(`photos.album_id is ON DELETE ${ref.on_delete}`);
  }
  return problems;
}

test('every table that names albums is #154\'s photos, with album_id referencing albums (id) and no ON DELETE', () => {
  // The real schema, every migration applied. Before #154 no table names
  // albums, and this holds; from #154 on, it holds only if the delete
  // refusal's reference is there, under the name the count reads.
  assert.deepEqual(albumReferenceProblems(site().DB.sqlite), []);
});

test('the reference check fails a table under another name, a missing reference, and a cascade', () => {
  // The controls, each a migrated schema plus one table #154 might write.
  const withTable = (sql) => {
    const { sqlite } = site().DB;
    sqlite.exec(sql);
    return albumReferenceProblems(sqlite);
  };
  assert.deepEqual(withTable('CREATE TABLE photos (id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES albums (id))'), []);
  assert.deepEqual(withTable('CREATE TABLE photos (id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES albums (id) ON DELETE RESTRICT)'), []);
  assert.deepEqual(withTable('CREATE TABLE uploads (id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES albums (id))'),
    ['uploads names albums, but deleteAlbum counts photos']);
  assert.deepEqual(withTable('CREATE TABLE uploads (id INTEGER PRIMARY KEY, album TEXT NOT NULL)'),
    ['uploads names albums, but deleteAlbum counts photos']);
  assert.deepEqual(withTable('CREATE TABLE photos (id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL)'),
    ['photos.album_id does not reference albums (id)']);
  assert.deepEqual(withTable('CREATE TABLE photos (id INTEGER PRIMARY KEY, album_address TEXT NOT NULL)'),
    ['photos names albums by album_address, not album_id alone', 'photos.album_id does not reference albums (id)']);
  assert.deepEqual(withTable('CREATE TABLE photos (id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES albums (id) ON DELETE CASCADE)'),
    ['photos.album_id is ON DELETE CASCADE']);
  assert.deepEqual(withTable('CREATE TABLE photos (id INTEGER PRIMARY KEY, album_id INTEGER REFERENCES albums (id) ON DELETE SET NULL)'),
    ['photos.album_id is ON DELETE SET NULL']);
});

// ---- Criterion 4: a title is shown as text --------------------------------

const HOSTILE = '<script>alert(1)</script> & "Co" \'s <img src=x onerror=alert(2)>';
const ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot; &#39;s &lt;img src=x onerror=alert(2)&gt;';

test('a title holding markup is stored as typed, and shown as text everywhere the page puts it', async () => {
  const env = site();
  const address = await add(env, { ...FALL, title: HOSTILE });
  assert.equal(address, '2026-10-04-script-alert-1-script-co-s-img-src-x-onerror-alert-2');
  assert.equal(rows(env)[0].title, HOSTILE);
  const html = await page(env, `?done=created&album=${address}`);
  assert.ok(html.includes(`<h3 id="album-1">${ESCAPED}</h3>`), 'the heading');
  assert.ok(html.includes(`value="${ESCAPED}"`), 'the edit field');
  assert.ok(html.includes(`aria-label="Close ${ESCAPED}"`), 'a button\'s name');
  assert.ok(html.includes(`<p role="status">Added ${ESCAPED}.`), 'the notice');
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.deepEqual(await problems(html), []);
});

test('the not-empty notice shows the title as text too, and never text from the address bar', async () => {
  const env = site();
  const address = await add(env, { ...FALL, title: HOSTILE });
  photos(env, address, ['pending']);
  const html = await page(env, `?error=not-empty&album=${address}&photos=1`);
  assert.ok(html.includes(`<p role="status">${ESCAPED} was not deleted`));
  // A crafted link: nothing it carries but a known sentence reaches the page.
  for (const query of ['?done=created&album=<b>x</b>', '?done=deleted&album=<b>x</b>', '?error=<b>x</b>', '?done=created&album=2026-10-04-nothing']) {
    assert.doesNotMatch(await page(env, query), /role="status"/, query);
  }
  assert.match(await page(env, `?error=not-empty&album=${address}&photos=<b>9</b>`), /was not deleted: it holds photos\./);
});

test('/api/albums/open gives a title as the text it is, in JSON, for the share page to set as text', async () => {
  const env = site();
  await add(env, { ...FALL, title: HOSTILE });
  const res = await openCall(env, await session());
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
  assert.equal((await res.json()).albums[0].title, HOSTILE);
});

// ---- Criterion 5: GET /api/albums/open ----------------------------------

test('GET /api/albums/open with a session: the open albums, newest first, and nothing else about them', async () => {
  const env = site();
  const september = await add(env, { title: 'Harvest Moon', kind: 'regatta', date: '2026-09-20' });
  const earlier = await add(env, { title: 'Morning practice', kind: 'practice', date: '2026-10-04' });
  const later = await add(env, { title: 'Afternoon practice', kind: 'practice', date: '2026-10-04' });
  const august = await add(env, { title: 'Summer Series', kind: 'regatta', date: '2026-08-01' });
  await post(env, 'close', { address: august });
  const res = await openCall(env, await session());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.deepEqual(await res.json(), {
    albums: [
      { address: later, title: 'Afternoon practice', kind: 'practice', date: '2026-10-04' },
      { address: earlier, title: 'Morning practice', kind: 'practice', date: '2026-10-04' },
      { address: september, title: 'Harvest Moon', kind: 'regatta', date: '2026-09-20' },
    ],
  });
});

test('GET /api/albums/open without a live session: 401, and no album in the answer', async () => {
  const env = site();
  await add(env);
  for (const cookie of [undefined, await signSession(KEY, 1, nowSeconds()), await signSession('another-key-0123456789abcdef0123', 2, nowSeconds())]) {
    const res = await openCall(env, cookie);
    assert.equal(res.status, 401);
    assert.doesNotMatch(await res.text(), /Fall Regatta/);
  }
});

test('an open list with nothing open is empty, not an error', async () => {
  const env = site();
  assert.deepEqual(await (await openCall(env, await session())).json(), { albums: [] });
});

// ---- The page itself ------------------------------------------------------

test('the page is valid HTML with albums open and closed and a notice, and the validator can fail it', async () => {
  const env = site();
  const fall = await add(env);
  await add(env, { title: 'Tuesday practice', kind: 'practice', date: '2026-09-29' });
  await post(env, 'close', { address: fall });
  const html = await page(env, `?done=closed&album=${fall}`);
  assert.deepEqual(await problems(html), []);
  assert.notDeepEqual(await problems(html.replace('<h2 ', '<h1>again</h1><h2 ')), []);
  assert.notDeepEqual(await problems(html.replace('<label for="new-title">Title</label>', '')), []);
  assert.deepEqual(await problems(await page(site())), [], 'the page with no album at all');
});

test('it has one h1, no inline script or style, and every form posts to an album route', async () => {
  const env = site();
  await add(env);
  const html = await page(env);
  assert.equal(html.match(/<h1[\s>]/g).length, 1);
  assert.doesNotMatch(html, /<script|<style|\sstyle="|\son[a-z]+="/i);
  const actions = [...html.matchAll(/<form method="post" action="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(actions, ['/api/admin/albums/create', '/api/admin/albums/update', '/api/admin/albums/close', '/api/admin/albums/delete']);
  assert.equal((html.match(/<form /g) ?? []).length, actions.length);
});

test('each album\'s controls are named for it, and the new-album form preselects no kind', async () => {
  const env = site();
  await add(env);
  const html = await page(env);
  assert.match(html, /<summary aria-label="Edit Fall Regatta">Edit<\/summary>/);
  assert.match(html, /aria-label="Close Fall Regatta">Close<\/button>/);
  assert.match(html, /aria-label="Delete Fall Regatta">Delete<\/button>/);
  assert.match(html, /<input type="radio" name="kind" value="regatta" required checked> Regatta/, 'the edit form keeps the kind');
  const addForm = html.split('<form')[1];
  assert.doesNotMatch(addForm, /checked/);
});

test('an empty site says no album is open', async () => {
  assert.match(await page(site()), /No album is open, so parents have nowhere to send photos\./);
});

test('a press that arrives as a GET changes nothing, and the page says so', async () => {
  const env = site();
  const fall = await add(env);
  for (const [name, route] of Object.entries(ROUTES)) {
    const res = route.onRequestGet();
    assert.deepEqual(landing(res), { error: 'unchanged' }, name);
  }
  assert.deepEqual(rows(env).map((r) => r.address), [fall]);
  assert.match(await page(env, '?error=unchanged'), /Nothing was changed\. The press reached the site as a page load/);
});
