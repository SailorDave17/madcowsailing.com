// The public pages (#157): the album list, each album at /albums/<address>/,
// and the image route /photos/<id>/<size>. Since #227 / leads to each team's
// section, /hoover-jrt/ and /cohssa/, and each section is the album list for
// its own team. Every request runs through the chain Pages runs (the root
// middleware, then the route), against a real SQLite holding the real
// migrations (test/d1.js) and an R2 stand-in (test/r2.js). Photos are seeded
// as the upload route and the queue leave them: a row in a state, and three
// objects. Each test names the criterion it holds; #227's say so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import TEMPLATE from '../templates/page.html';
import { onRequest as root } from '../functions/_middleware.js';
import * as listRoute from '../functions/index.js';
import * as albumRoute from '../functions/albums/[address]/index.js';
import * as imageRoute from '../functions/photos/[id]/[size].js';
import * as hooverRoute from '../functions/hoover-jrt/index.js';
import * as cohssaRoute from '../functions/cohssa/index.js';
import { createAlbum, setAlbumOpen } from '../lib/albums.js';
import { photoObjectKeys } from '../lib/photos.js';
import { FIRST_ROW, HTML_CACHE, albumPage, renderPage } from '../lib/public-page.js';
import { downloadName, publicAlbum, publicAlbums } from '../lib/public.js';
import { TEAMS } from '../lib/teams.js';
import { d1 } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];
const sha10 = (...parts) => createHash('sha256').update(readFileSync(join(ROOT, ...parts))).digest('hex').slice(0, 10);

const SITE = 'https://photos.madcowsailing.com';
const T0 = 1_790_000_000; // 2026-09-21T14:13:20Z
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const PRACTICE = { team: 'hoover-jrt', title: 'Tuesday practice', kind: 'practice', date: '2026-10-06' };
const SPRING = { team: 'hoover-jrt', title: 'Spring series', kind: 'regatta', date: '2026-05-02' };
// COHSSA's (#227): its date sits between Hoover JRT's, so a section that
// leaked the other team's albums would show it inside the sorted list.
const DISTRICTS = { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' };

// Each team's section route (#227), as Pages routes it: by the file under
// functions/ named for the team.
const SECTIONS = { 'hoover-jrt': hooverRoute, cohssa: cohssaRoute };

// What each stored size is, as columns on the row. The objects themselves are
// small JPEGs of three different sizes, so a test can tell which one it got.
const SHAPES = {
  landscape: { grid: [480, 360], screen: [1600, 1200], full: [2560, 1920] },
  portrait: { grid: [360, 480], screen: [1200, 1600], full: [1920, 2560] },
};
const OBJECTS = { grid: jpeg({ width: 4, height: 3 }), screen: jpeg({ width: 8, height: 6 }), full: jpeg({ width: 16, height: 12 }) };

async function site() {
  const env = { DB: d1(), MEDIA: r2() };
  const albums = {};
  for (const [name, album] of Object.entries({ fall: FALL, practice: PRACTICE, spring: SPRING, districts: DISTRICTS })) {
    albums[name] = await createAlbum(env.DB, album, T0);
  }
  return { env, ...albums };
}

let keys = 0;

/**
 * A photo as the upload route and the queue leave it: a row in `state`, and
 * its three objects. Approved and hidden rows carry approved_at, and hidden
 * ones hidden_at, as the table's CHECKs require.
 */
function seed(env, address, { state = 'approved', captured = T0, caption = null, shape = 'landscape' } = {}) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const dims = SHAPES[shape];
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'caption, captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, ' +
    "bytes, approved_at, hidden_at) VALUES (?, 'photo', ?, ?, ?, 'parent', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(albumId, state, mediaKey, '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b', T0 - 60, caption, captured, T0 + keys,
    ...dims.full, ...dims.grid, ...dims.screen, 1000,
    state === 'pending' ? null : T0 + 100, state === 'hidden' ? T0 + 200 : null);
  for (const [size, key] of Object.entries(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: OBJECTS[size], httpMetadata: { contentType: 'image/jpeg' } });
  }
  return Number(lastInsertRowid);
}

/** An approved clip (#198's shape), which nothing public may list or serve yet. */
function seedClip(env, address, { captured = T0 } = {}) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, bytes, content_type, duration_ms, approved_at) ' +
    "VALUES (?, 'clip', 'approved', ?, ?, 'parent', 1, ?, ?, ?, 1920, 1080, 5000000, 'video/mp4', 30000, ?)",
  ).run(albumId, mediaKey, '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b', T0 - 60, captured, T0, T0 + 100);
  for (const key of Object.values(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: OBJECTS.full, httpMetadata: { contentType: 'image/jpeg' } });
  }
  return Number(lastInsertRowid);
}

// Pages' static files, which a route's next() reaches: nothing is under
// /albums/, so the answer is public/404.html with a 404.
const STATIC_404 = () => new Response('the site\'s 404 page', { status: 404, headers: { 'Content-Type': 'text/html' } });

const { PHOTO_CACHE } = imageRoute;

/**
 * `path` as Pages would route it: the root middleware, then the route's
 * handler for `method`. Pages calls a route only through the handler named
 * for the request's method, so a route with no onRequestHead never sees a
 * HEAD; this throws in that case rather than calling another handler.
 */
function get(env, path, method = 'GET') {
  const url = new URL(path, SITE);
  const handler = (route) => {
    const fn = route[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
    if (!fn) throw new Error(`no ${method} handler`);
    return fn;
  };
  let handlers;
  let params = {};
  let m;
  if (url.pathname === '/') {
    handlers = [root, handler(listRoute)];
  } else if ((m = url.pathname.match(/^\/([a-z-]+)\/?$/)) && Object.hasOwn(SECTIONS, m[1])) {
    handlers = [root, handler(SECTIONS[m[1]])];
  } else if ((m = url.pathname.match(/^\/albums\/([^/]+)\/?$/))) {
    handlers = [root, handler(albumRoute), STATIC_404];
    params = { address: decodeURIComponent(m[1]) };
  } else if ((m = url.pathname.match(/^\/photos\/([^/]+)\/([^/]+)$/))) {
    handlers = [root, handler(imageRoute)];
    params = { id: m[1], size: m[2] };
  } else {
    throw new Error(`no route for ${path}`);
  }
  const request = new Request(url, { method });
  const run = (i) => handlers[i]({ request, env, params, data: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** Each album row on the list: its title, facts line and cover. */
function listRows(html) {
  return [...html.matchAll(/<li class="album-row">([\s\S]*?)<\/li>/g)].map(([, row]) => ({
    href: attr(row.match(/<h2><a [^>]*>/)[0], 'href'),
    title: row.match(/<h2><a [^>]*>([\s\S]*?)<\/a><\/h2>/)[1],
    facts: row.match(/<p class="meta">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, ''),
    cover: attr(row.match(/<img\b[^>]*>/)[0], 'src'),
    width: attr(row.match(/<img\b[^>]*>/)[0], 'width'),
    height: attr(row.match(/<img\b[^>]*>/)[0], 'height'),
    loading: attr(row.match(/<img\b[^>]*>/)[0], 'loading'),
    priority: attr(row.match(/<img\b[^>]*>/)[0], 'fetchpriority'),
  }));
}

/** Each figure on an album page: its frame, image, caption and Download link. */
function figures(html) {
  return [...html.matchAll(/<figure>([\s\S]*?)<\/figure>/g)].map(([, fig]) => {
    const frame = fig.match(/<a class="frame"[^>]*>/)[0];
    const img = fig.match(/<img\b[^>]*>/)[0];
    const download = fig.match(/<a class="download"[^>]*>/)[0];
    return {
      frameHref: attr(frame, 'href'),
      dataCaption: attr(frame, 'data-caption'),
      imgInFrame: /<a class="frame"[^>]*><img\b[^>]*><\/a>/.test(fig),
      src: attr(img, 'src'),
      width: attr(img, 'width'),
      height: attr(img, 'height'),
      alt: attr(img, 'alt'),
      loading: attr(img, 'loading'),
      figcaption: fig.match(/<figcaption>([\s\S]*?)<\/figcaption>/)[1],
      downloadHref: attr(download, 'href'),
      downloadName: attr(download, 'download'),
      downloadLabel: attr(download, 'aria-label'),
    };
  });
}

const idOf = (src) => Number(src.match(/^\/photos\/(\d+)\//)[1]);

// ---- Criterion 1: the list, which is each team's section since #227 -------

test('a team\'s section lists every album of its own holding an approved photo, newest first, with its title, kind, date, count and cover', async () => {
  const { env, fall, practice, spring, districts } = await site();
  // COHSSA's album, dated between Hoover JRT's, holds an approved photo too.
  seed(env, districts);
  // Fall: three approved, taken out of the order they were sent, plus one of
  // each state that is not public and an approved clip, none of which count.
  seed(env, fall, { captured: T0 + 30 });
  const cover = seed(env, fall, { captured: T0 + 10, shape: 'portrait' });
  seed(env, fall, { captured: T0 + 20 });
  seed(env, fall, { state: 'pending', captured: T0 });
  seed(env, fall, { state: 'hidden', captured: T0 + 1 });
  seedClip(env, fall, { captured: T0 + 2 });
  // Practice, two days later: one approved photo.
  const practiceCover = seed(env, practice);
  // Spring was made last, so it has the highest id, and holds the oldest
  // date: date order and making order disagree only here, which is what
  // shows the list is sorted by date. Its pending photo and approved clip
  // count nowhere.
  const springCover = seed(env, spring);
  seed(env, spring, { state: 'pending' });
  seedClip(env, spring);

  const res = await get(env, '/hoover-jrt/');
  assert.equal(res.status, 200);
  const rows = listRows(await res.text());
  assert.deepEqual(rows.map((r) => r.title), ['Tuesday practice', 'Fall Regatta', 'Spring series']);
  assert.deepEqual(rows.map((r) => r.href), [`/albums/${practice}/`, `/albums/${fall}/`, `/albums/${spring}/`]);
  assert.deepEqual(rows.map((r) => r.facts), [
    'Practice · 6 October 2026 · 1 photo',
    'Regatta · 4 October 2026 · 3 photos',
    'Regatta · 2 May 2026 · 1 photo',
  ]);
  assert.deepEqual(rows.map((r) => r.cover), [`/photos/${practiceCover}/grid`, `/photos/${cover}/grid`, `/photos/${springCover}/grid`]);
  // Each cover carries its stored grid size, so the row does not shift as it
  // arrives, and only the first row's cover loads at once.
  assert.deepEqual(rows.map((r) => [r.width, r.height]), [['480', '360'], ['360', '480'], ['480', '360']]);
  assert.deepEqual(rows.map((r) => [r.loading, r.priority]), [['eager', 'high'], ['lazy', null], ['lazy', null]]);
});

test('an album whose photos are all waiting is not listed, and an empty section says nothing is posted', async () => {
  const { env, fall } = await site();
  seed(env, fall, { state: 'pending' });
  const html = await (await get(env, '/hoover-jrt/')).text();
  assert.deepEqual(listRows(html), []);
  assert.match(block(html, 'main'), /Nothing is posted yet\./);
  // The control: the same album is listed once one photo is approved.
  seed(env, fall);
  assert.equal(listRows(await (await get(env, '/hoover-jrt/')).text()).length, 1);
});

test('a closed album\'s approved photos stay public: its section and its page show it (#153)', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  assert.ok(await setAlbumOpen(env.DB, fall, false, T0 + 500));
  assert.deepEqual(listRows(await (await get(env, '/hoover-jrt/')).text()).map((r) => r.title), ['Fall Regatta']);
  const res = await get(env, `/albums/${fall}/`);
  assert.equal(res.status, 200);
  assert.deepEqual(figures(await res.text()).map((f) => idOf(f.src)), [id]);
});

test('two albums on one date list the later made first, as the admin list does', async () => {
  const { env, fall } = await site();
  const twin = await createAlbum(env.DB, { ...FALL, title: 'Fall Regatta day 2' }, T0 + 1);
  seed(env, fall);
  seed(env, twin);
  const albums = await publicAlbums(env.DB);
  assert.deepEqual(albums.map((a) => a.address), [twin, fall]);
});

test('the list covers each album with the first approved photo in capture order, the earlier sent on a tie', async () => {
  const { env, fall } = await site();
  seed(env, fall, { captured: T0 + 5 });
  const first = seed(env, fall, { captured: T0 });
  seed(env, fall, { captured: T0 });
  const [album] = await publicAlbums(env.DB);
  assert.deepEqual(album.cover, { id: first, width: 480, height: 360 });
});

// ---- #227: / leads to each team's section, which lists only its own --------

/** Each team row on /: where it leads, its name, its facts, and its cover's src or null. */
function teamRows(html) {
  return [...block(html, 'main').matchAll(/<li class="album-row">([\s\S]*?)<\/li>/g)].map(([, row]) => ({
    href: attr(row.match(/<h2><a [^>]*>/)[0], 'href'),
    name: row.match(/<h2><a [^>]*>([\s\S]*?)<\/a><\/h2>/)[1],
    facts: row.match(/<p class="meta">([\s\S]*?)<\/p>/)[1],
    cover: row.match(/<img\b[^>]*>/) ? attr(row.match(/<img\b[^>]*>/)[0], 'src') : null,
    coverLink: row.match(/<a class="album-cover" [^>]*>/) ? attr(row.match(/<a class="album-cover" [^>]*>/)[0], 'href') : null,
  }));
}

test('#227: / has one row per team, leading to its section, with its album and photo counts under its newest album\'s cover', async () => {
  const { env, fall, practice, districts } = await site();
  seed(env, fall);
  seed(env, fall, { captured: T0 + 1 });
  seed(env, fall, { state: 'pending' }); // counts nowhere
  const practiceCover = seed(env, practice);
  const districtsCover = seed(env, districts, { shape: 'portrait' });
  seedClip(env, districts); // counts nowhere
  const res = await get(env, '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.deepEqual(teamRows(html), [
    { href: '/hoover-jrt/', name: 'Hoover JRT', facts: '2 albums · 3 photos', cover: `/photos/${practiceCover}/grid`, coverLink: '/hoover-jrt/' },
    { href: '/cohssa/', name: 'COHSSA', facts: '1 album · 1 photo', cover: `/photos/${districtsCover}/grid`, coverLink: '/cohssa/' },
  ]);
  // No album is listed on / itself: a COHSSA parent scrolls past nothing of Hoover JRT's.
  assert.doesNotMatch(block(html, 'main'), /\/albums\//);
  assert.equal(TEAMS.length, 2, 'a third team needs a row here, and this test a third expected row');
});

test('#227: a team with nothing posted keeps its row on /, saying so, with an empty tile where the cover goes', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  seed(env, fall, { state: 'hidden' });
  const html = await (await get(env, '/')).text();
  const [hoover, cohssa] = teamRows(html);
  assert.equal(hoover.facts, '1 album · 1 photo');
  assert.deepEqual(cohssa, { href: '/cohssa/', name: 'COHSSA', facts: 'Nothing posted yet', cover: null, coverLink: null });
  assert.match(html, /<span class="album-cover album-cover-none" aria-hidden="true"><\/span>/);
  // An empty site: both rows say so, and the page is still a page.
  const empty = teamRows(await (await get({ DB: d1(), MEDIA: r2() }, '/')).text());
  assert.deepEqual(empty.map((r) => r.facts), ['Nothing posted yet', 'Nothing posted yet']);
});

test('#227: on /, the first cover loads at once, even when the first team has nothing posted', async () => {
  // review-fanout at #227's review: eager went by row, so a first team with
  // no cover left no picture on / eager or high priority.
  const covers = (html) => [...block(html, 'main').matchAll(/<img\b[^>]*>/g)].map(([img]) => [idOf(attr(img, 'src')), attr(img, 'loading'), attr(img, 'fetchpriority')]);
  const { env, fall, districts } = await site();
  const c = seed(env, districts);
  assert.deepEqual(covers(await (await get(env, '/')).text()), [[c, 'eager', 'high']]);
  // The control: with both teams covered, the first row's cover is the eager one.
  const h = seed(env, fall);
  assert.deepEqual(covers(await (await get(env, '/')).text()), [[h, 'eager', 'high'], [c, 'lazy', null]]);
});

test('#227: each section lists only its own team\'s albums, and the other team\'s answer nothing there', async () => {
  const { env, fall, practice, districts } = await site();
  seed(env, fall);
  seed(env, practice);
  seed(env, districts);
  const hoover = listRows(await (await get(env, '/hoover-jrt/')).text());
  const cohssa = listRows(await (await get(env, '/cohssa/')).text());
  assert.deepEqual(hoover.map((r) => r.href), [`/albums/${practice}/`, `/albums/${fall}/`]);
  assert.deepEqual(cohssa.map((r) => r.href), [`/albums/${districts}/`]);
  // Moving an album moves it between sections at the next load, and its
  // address, so every link to it, stays.
  env.DB.sqlite.prepare("UPDATE albums SET team = 'cohssa' WHERE address = ?").run(fall);
  assert.deepEqual(listRows(await (await get(env, '/hoover-jrt/')).text()).map((r) => r.href), [`/albums/${practice}/`]);
  assert.deepEqual(listRows(await (await get(env, '/cohssa/')).text()).map((r) => r.href), [`/albums/${districts}/`, `/albums/${fall}/`]);
  assert.equal((await get(env, `/albums/${fall}/`)).status, 200);
});

test('#227: a section names its team, leads back to /, and reads only its own team\'s photos', async () => {
  const { env, fall, districts } = await site();
  seed(env, fall);
  seed(env, districts);
  const html = await (await get(env, '/cohssa/')).text();
  assert.match(html, /<title>COHSSA — Mad Cow Sailing photos<\/title>/);
  const main = block(html, 'main');
  assert.match(main, /<p class="eyebrow"><a href="\/">Team photos<\/a><\/p>/);
  assert.match(main, /<h1>COHSSA photos<\/h1>/);
  assert.match(main, /Photos from COHSSA's regattas and practices/);
  // The section's one query names its team, bound, so the window scans only
  // that team's photos.
  env.DB.statements.length = 0;
  await get(env, '/cohssa/');
  assert.equal(env.DB.statements.length, 1);
  assert.match(env.DB.statements[0], /album_id IN \(SELECT id FROM albums WHERE team = \?\)/);
  // And SQLite reaches them through photos_by_album, by the team's album ids,
  // which the text alone cannot show (review-fanout at #227's review). The
  // plan is SQLite's; D1 runs the same engine, so this is a reading of it,
  // not of D1's rows-read meter.
  const plan = (sql, ...values) => env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map((r) => r.detail).join('\n');
  assert.match(plan(env.DB.statements[0], 'cohssa'), /SEARCH photos USING INDEX photos_by_album \(album_id=\?/);
  // The control: the list for every team, with no team, reads photos_by_state instead.
  env.DB.statements.length = 0;
  await get(env, '/');
  assert.doesNotMatch(plan(env.DB.statements[0]), /photos_by_album/);
});

test('#227: a section without its trailing slash is sent to the one with it, query kept', async () => {
  const { env } = await site();
  for (const { team } of TEAMS) {
    const res = await get(env, `/${team}?removed`);
    assert.equal(res.status, 308, team);
    assert.equal(res.headers.get('Location'), `/${team}/?removed`, team);
  }
});

test('#227: every team has its section route file, its _routes.json lines, and lists its own albums', async () => {
  const routes = JSON.parse(read('public', '_routes.json')).include;
  const { env, fall, practice, districts } = await site();
  seed(env, fall);
  seed(env, practice);
  seed(env, districts);
  // Named outright, not read back from the database the route reads: a
  // read-back passes whatever team the rows carry, and orders by id where the
  // page orders by date (the mutation round on #227 reddened it only on order).
  const expected = { 'hoover-jrt': [`/albums/${practice}/`, `/albums/${fall}/`], cohssa: [`/albums/${districts}/`] };
  assert.deepEqual(Object.keys(expected), TEAMS.map(({ team }) => team), 'a new team needs its expected list here');
  for (const { team } of TEAMS) {
    // Loaded by path, so a team in lib/teams.js with no file fails here
    // rather than in an import at the top.
    const route = await import(new URL(`../functions/${team}/index.js`, import.meta.url));
    assert.equal(typeof route.onRequestGet, 'function', team);
    assert.equal(route.onRequestHead, route.onRequestGet, team);
    assert.ok(routes.includes(`/${team}`) && routes.includes(`/${team}/`), `_routes.json invokes /${team} and /${team}/`);
    const html = await (await route.onRequestGet({ request: new Request(`${SITE}/${team}/`), env })).text();
    assert.deepEqual(listRows(html).map((r) => r.href), expected[team], team);
  }
});

test('#227: an album page leads back to its own team\'s section, by name', async () => {
  const { env, fall, districts } = await site();
  seed(env, fall);
  seed(env, districts);
  const hoover = block(await (await get(env, `/albums/${fall}/`)).text(), 'main');
  const cohssa = block(await (await get(env, `/albums/${districts}/`)).text(), 'main');
  assert.match(hoover, /<p class="eyebrow"><a href="\/hoover-jrt\/">Hoover JRT photos<\/a><\/p>/);
  assert.match(cohssa, /<p class="eyebrow"><a href="\/cohssa\/">COHSSA photos<\/a><\/p>/);
});

// ---- Criterion 2: the album page --------------------------------------------

test('/albums/<address>/ shows the approved photos in capture order as figure, a.frame and img, each with width, height and alt', async () => {
  const { env, fall, practice } = await site();
  const c = seed(env, fall, { captured: T0 + 30 });
  const a = seed(env, fall, { captured: T0 + 10, shape: 'portrait' });
  const b1 = seed(env, fall, { captured: T0 + 20 });
  const b2 = seed(env, fall, { captured: T0 + 20 }); // the same second: sent later, so after
  seed(env, fall, { state: 'pending', captured: T0 });
  seed(env, fall, { state: 'hidden', captured: T0 });
  seedClip(env, fall, { captured: T0 });
  seed(env, practice, { captured: T0 }); // another album's photo

  const res = await get(env, `/albums/${fall}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const figs = figures(html);
  assert.deepEqual(figs.map((f) => idOf(f.src)), [a, b1, b2, c]);
  for (const f of figs) {
    assert.ok(f.imgInFrame, 'the img sits directly in a.frame, as gallery.js reads it');
    assert.match(f.frameHref, /^\/photos\/\d+\/screen$/);
    assert.equal(idOf(f.frameHref), idOf(f.src));
    assert.match(f.src, /^\/photos\/\d+\/grid$/);
    assert.ok(f.alt);
  }
  assert.deepEqual([figs[0].width, figs[0].height], ['360', '480']);
  assert.deepEqual([figs[1].width, figs[1].height], ['480', '360']);
  assert.match(html, /<div class="gallery">/);
  assert.match(block(html, 'main'), /<h1>Fall Regatta<\/h1>/);
  assert.match(block(html, 'main'), /Regatta · <time datetime="2026-10-04">4 October 2026<\/time> · 4 photos/);
});

test(`the first row, ${FIRST_ROW} photos, loads at once at high priority, and every photo below it lazily`, async () => {
  // FIRST_ROW's value is held to the CSS by the next test; this one holds
  // the page to FIRST_ROW.
  const { env, fall } = await site();
  for (let i = 0; i < FIRST_ROW + 3; i++) seed(env, fall, { captured: T0 + i });
  const html = await (await get(env, `/albums/${fall}/`)).text();
  const figs = figures(html);
  assert.equal(figs.length, FIRST_ROW + 3);
  assert.deepEqual(figs.map((f) => f.loading), [
    ...Array(FIRST_ROW).fill('eager'),
    ...Array(3).fill('lazy'),
  ]);
  const priorities = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => attr(m[0], 'fetchpriority'));
  assert.deepEqual(priorities, [...Array(FIRST_ROW).fill('high'), ...Array(3).fill(null)]);
});

test('FIRST_ROW is the grid\'s fewest columns in site.css, a phone\'s two, so no photo below a first row loads at once', () => {
  // The server marks eager only the photos in the first row at every width
  // (criterion 2: lazy below the first row; photos.py's rule for a trip).
  // Every .gallery rule's column count:
  const css = read('public', 'css', 'site.css');
  const counts = [...css.matchAll(/\.gallery\s*\{[^}]*?grid-template-columns:\s*repeat\((\d+),/g)].map((m) => Number(m[1]));
  assert.deepEqual(counts, [2, 3, 4, 5]);
  assert.equal(Math.min(...counts), FIRST_ROW);
});

test('the page loads shared/js/gallery.js and js/remove.js, each stamped with its own hash, and no inline script or style', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  const html = await (await get(env, `/albums/${fall}/`)).text();
  const gallery = `<script src="/assets/shared/js/gallery.js?v=${sha10('..', 'shared', 'js', 'gallery.js')}" defer></script>`;
  // "Remove this photo"'s dialog (#158).
  const remove = `<script src="/js/remove.js?v=${sha10('public', 'js', 'remove.js')}" defer></script>`;
  for (const script of [gallery, remove]) {
    assert.equal(block(html, 'head').split(script).length, 2, `the head carries ${script} once, at its current version`);
  }
  assert.doesNotMatch(html.replace(gallery, '').replace(remove, ''), /<script|<style|\sstyle="|\son[a-z]+="/i);
});

test('an unknown address, a malformed one, and an album with nothing approved answer the site\'s 404', async () => {
  const { env, fall, spring } = await site();
  seed(env, fall);
  seed(env, spring, { state: 'pending' });
  for (const path of [`/albums/${spring}/`, '/albums/2026-10-04-no-such-album/', '/albums/not-an-address/', '/albums/2026-10-04-UPPER/']) {
    const res = await get(env, path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), 'the site\'s 404 page', path);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex', path);
  }
  // The control: the album that has an approved photo is a page.
  assert.equal((await get(env, `/albums/${fall}/`)).status, 200);
});

test('an album\'s address without its trailing slash is sent to the one with it; a path that is no address is 404 at once', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  const res = await get(env, `/albums/${fall}?from=text`);
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('Location'), `/albums/${fall}/?from=text`);
  // No redirect to spend on a path that can never be a page, and the
  // database is not asked.
  env.DB.statements.length = 0;
  for (const path of ['/albums/Not_An_Address', '/albums/2026-10-04-UPPER', '/albums/fall-regatta']) {
    const miss = await get(env, path);
    assert.equal(miss.status, 404, path);
    assert.equal(await miss.text(), 'the site\'s 404 page', path);
  }
  assert.deepEqual(env.DB.statements, []);
});

test('a size that is not one of the three, or an id that is not one, asks neither the database nor the bucket', async () => {
  // The 404s above would come out the same if a later lookup found nothing,
  // so this holds each check by what it saves: no query, no bucket read.
  const { env, fall } = await site();
  const id = seed(env, fall);
  const reads = [];
  const bucketGet = env.MEDIA.get.bind(env.MEDIA);
  env.MEDIA.get = (key) => { reads.push(key); return bucketGet(key); };
  env.DB.statements.length = 0;
  for (const path of [`/photos/${id}/original`, `/photos/${id}/GRID`, `/photos/${id}/full.jpg`, `/photos/${id}/toString`,
    '/photos/abc/grid', '/photos/0/full', `/photos/0${id}/screen`, `/photos/${id}.5/grid`]) {
    assert.equal((await get(env, path)).status, 404, path);
  }
  assert.deepEqual(env.DB.statements, []);
  assert.deepEqual(reads, []);
  // The control: the same photo at a real size asks both.
  assert.equal((await get(env, `/photos/${id}/grid`)).status, 200);
  assert.equal(env.DB.statements.length, 1);
  assert.equal(reads.length, 1);
});

test('publicAlbum asks the database nothing for a string that is not an address', async () => {
  const { env } = await site();
  env.DB.statements.length = 0;
  for (const text of ['not an address', '2026-10-04', '2026-10-04-UPPER', '', null]) {
    assert.equal(await publicAlbum(env.DB, text), null);
  }
  assert.deepEqual(env.DB.statements, []);
});

test('HEAD answers each public path as GET does, with the same status and headers', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  const pending = seed(env, fall, { state: 'pending' });
  for (const path of ['/', '/hoover-jrt/', '/cohssa/', '/cohssa', `/albums/${fall}/`, `/albums/${fall}`, '/albums/2026-10-04-no-such-album/',
    `/photos/${id}/grid`, `/photos/${id}/full`, `/photos/${pending}/screen`]) {
    const [head, getRes] = [await get(env, path, 'HEAD'), await get(env, path)];
    assert.equal(head.status, getRes.status, path);
    for (const name of ['Content-Type', 'Cache-Control', 'Content-Disposition', 'Location', 'X-Robots-Tag']) {
      assert.equal(head.headers.get(name), getRes.headers.get(name), `${path}: ${name}`);
    }
  }
  assert.equal((await get(env, '/', 'HEAD')).status, 200);
});

// ---- Criterion 3: the image route --------------------------------------------

test('an approved photo\'s three sizes answer 200 image/jpeg, noindex, cached privately for no more than 300 seconds', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  for (const size of ['grid', 'screen', 'full']) {
    const res = await get(env, `/photos/${id}/${size}`);
    assert.equal(res.status, 200, size);
    assert.equal(res.headers.get('Content-Type'), 'image/jpeg', size);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex', size);
    const cache = res.headers.get('Cache-Control');
    assert.equal(cache, PHOTO_CACHE, size);
    assert.match(cache, /\bprivate\b/);
    assert.ok(Number(cache.match(/max-age=(\d+)/)[1]) <= 300, cache);
    assert.doesNotMatch(cache, /immutable|stale-while-revalidate|s-maxage/);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), OBJECTS[size], `${size} is the stored ${size} object`);
  }
});

test('a photo that is pending, hidden, deleted, unknown or a clip, or a size that is not one of the three, answers 404', async () => {
  const { env, fall } = await site();
  const approved = seed(env, fall);
  const pending = seed(env, fall, { state: 'pending' });
  const hidden = seed(env, fall, { state: 'hidden' });
  const deleted = seed(env, fall);
  env.DB.sqlite.prepare('DELETE FROM photos WHERE id = ?').run(deleted);
  const clip = seedClip(env, fall);
  // Every size of every photo that is not public: the full size is read by a
  // query of its own (lib/public.js, downloadPhoto), so each needs asking.
  const states = { pending, hidden, deleted, unknown: 99999, 'a clip': clip };
  const cases = Object.fromEntries(Object.entries(states).flatMap(([name, id]) =>
    ['grid', 'screen', 'full'].map((size) => [`${name}, ${size}`, `/photos/${id}/${size}`])));
  Object.assign(cases, {
    'not an id': '/photos/abc/grid',
    'a zero id': '/photos/0/grid',
    'a padded id': `/photos/0${approved}/grid`,
    'another size': `/photos/${approved}/original`,
    'a size in capitals': `/photos/${approved}/GRID`,
    'a size with an extension': `/photos/${approved}/full.jpg`,
  });
  for (const [name, path] of Object.entries(cases)) {
    const res = await get(env, path);
    assert.equal(res.status, 404, name);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', name);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex', name);
    assert.equal(await res.text(), 'No such photo.\n', name);
  }
  // The control: the approved photo in the same album is served.
  assert.equal((await get(env, `/photos/${approved}/grid`)).status, 200);
});

test('a photo taken down after the page loaded is 404 on the next request', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  assert.equal((await get(env, `/photos/${id}/screen`)).status, 200);
  env.DB.sqlite.prepare("UPDATE photos SET state = 'hidden', hidden_at = ? WHERE id = ?").run(T0 + 300, id);
  assert.equal((await get(env, `/photos/${id}/screen`)).status, 404);
});

test('a database that does not answer serves no photo, and a missing object is 404', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  const id = seed(env, fall);
  const broken = { ...env, DB: { prepare() { throw new Error('D1_ERROR: daily read limit'); } } };
  for (const size of ['grid', 'full']) {
    const res = await get(broken, `/photos/${id}/${size}`);
    assert.equal(res.status, 404, size);
  }
  assert.equal(logged.mock.callCount(), 2);
  env.MEDIA.objects.delete(photoObjectKeys(env.DB.sqlite.prepare('SELECT media_key FROM photos WHERE id = ?').get(id).media_key).grid);
  assert.equal((await get(env, `/photos/${id}/grid`)).status, 404);
  assert.equal((await get(env, `/photos/${id}/screen`)).status, 200);
});

// ---- Criterion 4: captions -----------------------------------------------------

test('a caption is the figure\'s caption and the image\'s alt, escaped, and the lightbox\'s through data-caption', async () => {
  const { env, fall } = await site();
  const caption = 'Sam & Alex <img src=x onerror=alert(1)> at the "mark" \'19 $& {{main}}';
  seed(env, fall, { caption });
  const html = await (await get(env, `/albums/${fall}/`)).text();
  const [f] = figures(html);
  const escaped = 'Sam &amp; Alex &lt;img src=x onerror=alert(1)&gt; at the &quot;mark&quot; &#39;19 $&amp; {{main}}';
  assert.equal(f.alt, escaped);
  assert.equal(f.dataCaption, escaped);
  assert.match(f.figcaption, new RegExp(`^<span class="caption-text">${escaped.replace(/[$&()[\]{}.*+?^|\\]/g, '\\$&')}</span> `));
  assert.doesNotMatch(html, /<img src=x/);
  // A caption spelling a placeholder is shown as text in its three places,
  // and fills nothing: the page holds one gallery.
  assert.equal(html.split('{{main}}').length - 1, 3);
  assert.equal(html.split('<div class="gallery">').length - 1, 1);
});

test('a photo with no caption gets an alt naming its album and its place in it, and no caption', async () => {
  const { env, fall } = await site();
  env.DB.sqlite.prepare('UPDATE albums SET title = ? WHERE address = ?').run('Fall <Regatta> & "friends"', fall);
  seed(env, fall, { captured: T0, caption: 'Start line' });
  seed(env, fall, { captured: T0 + 1 });
  seed(env, fall, { captured: T0 + 2 });
  const figs = figures(await (await get(env, `/albums/${fall}/`)).text());
  assert.deepEqual(figs.map((f) => f.alt), [
    'Start line',
    'Fall &lt;Regatta&gt; &amp; &quot;friends&quot;, photo 2 of 3',
    'Fall &lt;Regatta&gt; &amp; &quot;friends&quot;, photo 3 of 3',
  ]);
  assert.deepEqual(figs.map((f) => f.dataCaption), ['Start line', null, null]);
  assert.doesNotMatch(figs[1].figcaption, /caption-text/);
});

test('an album title is escaped wherever it shows: its section\'s list, the heading and the page title (#153)', async () => {
  const { env, fall } = await site();
  // Both placeholders' spellings, so a renderer filling either one first
  // and splitting again would show it (a title-first renderer 500s on
  // {{main}}, a main-first one on {{title}}).
  const title = '<script>alert(1)</script> & {{title}} {{main}}';
  env.DB.sqlite.prepare('UPDATE albums SET title = ? WHERE address = ?').run(title, fall);
  seed(env, fall);
  const escaped = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; {{title}} {{main}}';
  const list = await (await get(env, '/hoover-jrt/')).text();
  assert.equal(listRows(list)[0].title, escaped);
  const page = await (await get(env, `/albums/${fall}/`)).text();
  assert.match(page, new RegExp(`<title>${escaped.replace(/[&()[\]{}.*+?^|\\/]/g, '\\$&')} — Mad Cow Sailing photos</title>`));
  assert.match(block(page, 'main'), new RegExp(`<h1>${escaped.replace(/[&()[\]{}.*+?^|\\/]/g, '\\$&')}</h1>`));
  assert.doesNotMatch(list + page, /<script>alert/);
});

// ---- Criterion 5: Download ----------------------------------------------------

test('Download under each photo saves the full size, named from the album address and its place', async () => {
  const { env, fall, practice } = await site();
  const ids = [
    seed(env, fall, { captured: T0 + 20 }),
    seed(env, fall, { captured: T0 }),
    seed(env, fall, { captured: T0 }), // the same second as the one before
  ];
  // Each of these would shift every place if the count reached it: waiting
  // and hidden photos in this album, an approved photo in another album and
  // an approved clip in this one, both taken before any photo here.
  seed(env, fall, { state: 'pending', captured: T0 + 5 });
  seed(env, fall, { state: 'hidden', captured: T0 + 6 });
  seed(env, practice, { captured: T0 - 100 });
  seedClip(env, fall, { captured: T0 - 50 });
  const figs = figures(await (await get(env, `/albums/${fall}/`)).text());
  assert.deepEqual(figs.map((f) => idOf(f.src)), [ids[1], ids[2], ids[0]]);
  for (const [i, f] of figs.entries()) {
    const name = `${fall}-${String(i + 1).padStart(3, '0')}.jpg`;
    assert.equal(f.downloadHref, `/photos/${idOf(f.src)}/full`);
    assert.equal(f.downloadName, name);
    assert.equal(f.downloadLabel, `Download photo ${i + 1}`);
    // Download is the caption's last link; only "Remove this photo"'s form
    // (#158) follows it.
    assert.match(f.figcaption, />Download<\/a>\s*<form class="remove"[^>]*><button\b[^>]*>Remove this photo<\/button><\/form>$/);
    const res = await get(env, f.downloadHref);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), `attachment; filename="${name}"`, `photo ${i + 1}`);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), OBJECTS.full);
  }
  // The grid and screen sizes open in the page rather than downloading.
  const screen = await get(env, `/photos/${ids[0]}/screen`);
  assert.match(screen.headers.get('Content-Disposition'), /^inline;/);
});

test('a name is at least three digits, and grows past them', () => {
  assert.equal(downloadName('2026-10-04-fall-regatta', 7), '2026-10-04-fall-regatta-007.jpg');
  assert.equal(downloadName('2026-10-04-fall-regatta', 1234), '2026-10-04-fall-regatta-1234.jpg');
});

// ---- Criterion 6: the template ---------------------------------------------------

test('the template holds its two placeholders once each, and nothing else in braces', () => {
  assert.equal(TEMPLATE, read('templates', 'page.html'), 'the loader hands the file over as it is');
  assert.deepEqual([...TEMPLATE.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]), ['{{title}}', '{{main}}']);
  assert.throws(() => renderPage({ title: 't', main: 'm' }, TEMPLATE.replace('{{main}}', '')), /\{\{main\}\} exactly once, not 0/);
  assert.throws(() => renderPage({ title: 't', main: 'm' }, `${TEMPLATE}{{title}}`), /\{\{title\}\} exactly once, not 2/);
});

test('the template\'s stylesheets and script carry the ?v= tools/assetver.py writes', () => {
  // linkcheck refuses a stale one in the gate; this names which file to run it on.
  const refs = [...block(TEMPLATE, 'head').matchAll(/\s(?:href|src)="(\/(?:assets\/shared\/)?(?:css|js)\/[^"?]+)\?v=([0-9a-f]+)"/g)];
  assert.deepEqual(refs.map((m) => m[1]), [
    '/assets/shared/css/tokens.css', '/assets/shared/css/base.css', '/css/site.css', '/assets/shared/js/gallery.js',
    '/js/remove.js',
  ]);
  for (const [, url, version] of refs) {
    const file = url.startsWith('/assets/shared/') ? ['..', 'shared', ...url.slice('/assets/shared/'.length).split('/')] : ['public', ...url.slice(1).split('/')];
    assert.equal(version, sha10(...file), url);
  }
});

test('no photo is served from under /assets/: every picture and link on an album page is /photos/', async () => {
  const { env, fall } = await site();
  seed(env, fall, { caption: 'x' });
  seed(env, fall, { captured: T0 + 1 });
  const main = block(await (await get(env, `/albums/${fall}/`)).text(), 'main');
  // All but the eyebrow's way back to the album's section (#227).
  const urls = [...main.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]).filter((u) => u !== '/hoover-jrt/');
  assert.ok(urls.length >= 6);
  for (const url of urls) assert.match(url, /^\/photos\/\d+\/(grid|screen|full)$/);
  for (const path of ['/', '/hoover-jrt/']) {
    const list = block(await (await get(env, path)).text(), 'main');
    const srcs = [...list.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(srcs.length >= 1, path);
    for (const url of srcs) assert.match(url, /^\/photos\/\d+\/grid$/, path);
  }
});

const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html) => validator.validateString(html, join(ROOT, 'public.html'));
const problems = (report) => report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

test('/, a section, an album page and the unavailable page pass the photo site\'s html-validate config, and the validator can fail them', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  seed(env, fall, { caption: 'Rounding the mark' });
  for (let i = 1; i < 8; i++) seed(env, fall, { captured: T0 + i, shape: i % 2 ? 'portrait' : 'landscape' });
  const pages = {
    teams: await (await get(env, '/')).text(), // COHSSA's row is the empty one
    section: await (await get(env, '/hoover-jrt/')).text(),
    album: await (await get(env, `/albums/${fall}/`)).text(),
    'empty /': await (await get({ DB: d1(), MEDIA: r2() }, '/')).text(),
    'empty section': await (await get(env, '/cohssa/')).text(),
    unavailable: await (await get({ ...env, DB: { prepare() { throw new Error('down'); } } }, '/')).text(),
  };
  for (const [name, html] of Object.entries(pages)) {
    assert.deepEqual(problems(await validate(html)), [], name);
    for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      assert.match(url, /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i, `${name}: ${url}`);
    }
    assert.equal(html.match(/<h1[\s>]/g).length, 1, name);
  }
  // The controls: a second h1, and an inline style the CSP would drop.
  assert.equal((await validate(pages.album.replace('<div class="gallery">', '<h1>again</h1><div class="gallery">'))).valid, false);
  assert.equal((await validate(pages.album.replace('<figure>', '<figure style="color: red">'))).valid, false);
});

test('its header and footer are every static page\'s, byte for byte', () => {
  // Every .html under public/, not a list: a list missed #159's policy page
  // (its mutation round). assets/ is the build's copy of shared/.
  const pages = readdirSync(join(ROOT, 'public'), { recursive: true })
    .map((file) => String(file).replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.html') && !file.startsWith('assets/'));
  assert.ok(pages.length >= 3 && pages.includes('policy.html'), pages.join(', '));
  for (const file of pages) {
    const html = read('public', ...file.split('/'));
    assert.equal(block(TEMPLATE, 'header'), block(html, 'header'), file);
    assert.equal(block(TEMPLATE, 'footer'), block(html, 'footer'), file);
  }
});

// ---- Criterion 8: the pages' headers ---------------------------------------------

test('every HTML response says public, max-age=0, must-revalidate, and noindex', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  seed(env, fall);
  const broken = { ...env, DB: { prepare() { throw new Error('down'); } } };
  const responses = {
    list: await get(env, '/'),
    album: await get(env, `/albums/${fall}/`),
    'list, database down': await get(broken, '/'),
    'album, database down': await get(broken, `/albums/${fall}/`),
  };
  // #227's new pages, each team's section, in both states.
  for (const { team } of TEAMS) {
    responses[`/${team}/`] = await get(env, `/${team}/`);
    responses[`/${team}/, database down`] = await get(broken, `/${team}/`);
  }
  for (const [name, res] of Object.entries(responses)) {
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate', name);
    assert.equal(res.headers.get('Cache-Control'), HTML_CACHE, name);
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8', name);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex', name);
  }
  assert.equal(responses.list.status, 200);
  assert.equal(responses.album.status, 200);
  for (const { team } of TEAMS) {
    assert.equal(responses[`/${team}/`].status, 200, team);
    assert.equal(responses[`/${team}/, database down`].status, 503, team);
  }
});

// ---- What a public route may do ----------------------------------------------------

test('a database that does not answer is a 503 page, never an empty list', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  seed(env, fall);
  const broken = { ...env, DB: { prepare() { throw new Error('D1_ERROR: daily read limit'); } } };
  const paths = ['/', ...TEAMS.map(({ team }) => `/${team}/`), `/albums/${fall}/`];
  for (const path of paths) {
    const res = await get(broken, path);
    assert.equal(res.status, 503, path);
    const main = block(await res.text(), 'main');
    assert.match(main, /The photos can&#39;t be shown right now|The photos can't be shown right now/, path);
    assert.doesNotMatch(main, /Nothing (is )?posted/, path);
  }
  assert.equal(logged.mock.callCount(), paths.length);
});

test('a public GET only reads: every statement the public routes send is a SELECT', async () => {
  // CLAUDE.md, The photo site, item 4: a public GET never writes to D1.
  const { env, fall } = await site();
  const id = seed(env, fall);
  env.DB.statements.length = 0;
  await get(env, '/');
  for (const { team } of TEAMS) await get(env, `/${team}/`); // #227
  await get(env, `/albums/${fall}/`);
  for (const size of ['grid', 'screen', 'full']) await get(env, `/photos/${id}/${size}`);
  assert.equal(env.DB.statements.length, 5 + TEAMS.length);
  for (const sql of env.DB.statements) assert.match(sql, /^SELECT\b/, sql);
});

test('publicAlbum and the album page agree on what the page shows', async () => {
  const { env, fall } = await site();
  seed(env, fall, { caption: 'One' });
  seed(env, fall, { captured: T0 + 1 });
  const album = await publicAlbum(env.DB, fall);
  const html = albumPage(album);
  assert.deepEqual(figures(html).map((f) => idOf(f.src)), album.photos.map((p) => p.id));
  assert.equal(await publicAlbum(env.DB, 'not an address'), null);
});
