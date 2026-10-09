// The approval queue (#156): /admin/queue, the three presses its forms send,
// the admins' image route and the admin home's counts. Every request runs
// through the chain Pages runs in front of the route (the root middleware,
// then the admin guards), against a real SQLite holding the real migrations
// (test/d1.js), an R2 stand-in (test/r2.js) and an admin's session minted by
// test/admin.js (#224; Access tokens until then). Photos are seeded as #154's
// upload route leaves them, a
// pending row and three objects; test/upload.test.js holds that route.
//
// A press is built from the page's own markup: the batch form's fields, the
// button pressed and any caption typed, as a browser would send them. So the
// page and the routes are tested as one contract. Each test names the
// criterion it holds.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as homePage } from '../functions/admin/index.js';
import { onRequestGet as queuePage } from '../functions/admin/queue.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequestGet as approveGet, onRequestPost as approvePost } from '../functions/api/admin/queue/approve.js';
import { onRequestGet as rejectGet, onRequestPost as rejectPost } from '../functions/api/admin/queue/reject.js';
import { onRequestGet as captionsGet, onRequestPost as captionsPost } from '../functions/api/admin/queue/captions.js';
import { onRequestGet as image } from '../functions/api/admin/photos/[id]/[size].js';
import { ADMIN_SIGN_IN } from '../lib/admin-session.js';
import {
  QUEUE_SCRIPT, TODO, adminHome, adminQueuePage, queueNotice, storageText, todoItem,
} from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { photoObjectKeys } from '../lib/photos.js';
import {
  FREE_STORAGE_BYTES, PART_PHOTOS, QUEUE_FORM_BYTES, nextWaiting, readPress, rejectPhotos, waitingBatches,
} from '../lib/queue.js';
import { nowSeconds } from '../lib/session.js';
import { ADMIN_KEY, adminCookieHeader, adminData, seedAdmin } from './admin.js';
import { d1 } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

// The page's time text is UTC and the script rewrites it into the reader's
// zone. Pinned to Chatham, which differs from UTC in date, hour and minutes,
// as test/removals.test.js and test/share.test.js pin it (and the invite code
// page's test did until #226); the first test checks the pin took.
process.env.TZ = 'Pacific/Chatham';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];

const SITE = 'https://photos.madcowsailing.com';
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const PRACTICE = { team: 'hoover-jrt', title: 'Tuesday practice', kind: 'practice', date: '2026-10-06' };
const BATCH_A = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';
const BATCH_B = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const T0 = 1_790_000_000; // 2026-09-21T14:13:20Z

afterEach(() => mock.restoreAll());

// The admin guard's one read a request (lib/admin-session.js, sessionAdmin):
// a test counting what a route asks D1 counts past it.
const GUARD_READ = /^SELECT a\.id, a\.name, a\.email, a\.admin_role FROM accounts AS a /;

/** A site with two open albums and nothing sent, and its owner, account 1, whose session admin() sends. */
async function site({ bucket = r2() } = {}) {
  const env = { DB: d1(), MEDIA: bucket, SESSION_SIGNING_KEY: ADMIN_KEY };
  seedAdmin(env.DB);
  const fall = await createAlbum(env.DB, FALL, T0);
  const practice = await createAlbum(env.DB, PRACTICE, T0);
  return { env, fall, practice };
}

const SHAPES = {
  landscape: { grid: [480, 360], screen: [1600, 1200], full: [2560, 1920] },
  portrait: { grid: [360, 480], screen: [1200, 1600], full: [1920, 2560] },
};

let keys = 0;

// One tiny JPEG stands in for every size when a test needs rows by the
// hundred and never reads a picture (objects: false).
const TINY = jpeg({ width: 8, height: 8 });

/**
 * A photo as #154's route stores it: one row, and three objects under its
 * media key, each a real JPEG at its size's dimensions (or, with objects:
 * false, the same tiny one for all three).
 */
function seedPhoto(env, album, { batch = BATCH_A, sentAt = T0, caption = null, state = 'pending', shape = 'landscape', objects: real = true } = {}) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(album).id;
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const dims = SHAPES[shape];
  const objects = Object.fromEntries(Object.entries(dims).map(([size, [width, height]]) => [size, real ? jpeg({ width, height }) : TINY]));
  const bytes = Object.values(objects).reduce((sum, o) => sum + o.length, 0);
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'caption, captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, ' +
    "bytes, approved_at) VALUES (?, 'photo', ?, ?, ?, 'parent', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(albumId, state, mediaKey, batch, sentAt - 60, caption, sentAt - 3600, sentAt, ...dims.full, ...dims.grid,
    ...dims.screen, bytes, state === 'pending' ? null : sentAt + 1);
  for (const [size, key] of Object.entries(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: objects[size], httpMetadata: { contentType: 'image/jpeg' } });
  }
  return Number(lastInsertRowid);
}

/** A clip waiting in the same table (#198's shape), which the queue must not show or touch. */
function seedClip(env, album) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(album).id;
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, bytes, content_type, duration_ms) ' +
    "VALUES (?, 'clip', 'pending', ?, ?, 'parent', 1, ?, ?, ?, 1920, 1080, 5000000, 'video/mp4', 30000)",
  ).run(albumId, 'c'.repeat(32), BATCH_A, T0 - 60, T0 - 3600, T0 + 5);
  return Number(lastInsertRowid);
}

const rows = (env) => env.DB.sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r }));
const row = (env, id) => rows(env).find((r) => r.id === id);
const objectsOf = (env, id) => {
  const r = row(env, id);
  return Object.values(photoObjectKeys(r.media_key)).filter((key) => env.MEDIA.objects.has(key));
};

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const ROUTES = {
  POST: { '/api/admin/queue/approve': approvePost, '/api/admin/queue/reject': rejectPost, '/api/admin/queue/captions': captionsPost },
  GET: {
    '/api/admin/queue/approve': approveGet, '/api/admin/queue/reject': rejectGet, '/api/admin/queue/captions': captionsGet,
    '/admin/queue': queuePage, '/admin': homePage,
  },
};

/** A request through the whole chain. `cookie: null` sends no admin session, `origin: null` no Origin. */
async function admin(env, method, path, { cookie, origin = SITE, body } = {}) {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (cookie !== null) headers.Cookie = cookie ?? await adminCookieHeader(1);
  if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const request = new Request(`${SITE}${path}`, { method, headers, body });
  const url = new URL(request.url);
  const photo = url.pathname.match(/^\/api\/admin\/photos\/([^/]+)\/([^/]+)$/);
  if (photo) return chain([root, ...adminApi, image], request, env, { id: photo[1], size: photo[2] });
  const route = ROUTES[method][url.pathname];
  const guards = url.pathname.startsWith('/api/') ? adminApi : adminPages;
  return chain([root, ...guards, route], request, env);
}

const page = async (env) => (await admin(env, 'GET', '/admin/queue', { origin: null })).text();

// ---- Reading the page's forms, as a browser submits them -------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);
const attr = (attrs, name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** The batch forms on the page, in order: id, action, input fields, buttons. */
function forms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
    .filter(([, attrs]) => attr(attrs, 'class') === 'batch-form')
    .map(([, attrs, inner]) => ({
      id: attr(attrs, 'id'),
      action: attr(attrs, 'action'),
      fields: [...inner.matchAll(/<input\b([^>]*)>/g)].map(([, a]) => [attr(a, 'name'), unescape(attr(a, 'value') ?? '')]),
      buttons: [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, a, text]) => ({
        type: attr(a, 'type'), formaction: attr(a, 'formaction'), name: attr(a, 'name'), value: attr(a, 'value'),
        reject: attr(a, 'data-reject'), form: attr(a, 'data-form'), text,
      })),
    }));
}

/** The reject dialog's confirm button, the only thing that posts a reject. */
function confirmButton(html) {
  const dialog = block(html, 'dialog');
  const [, attrs] = dialog.match(/<button\b([^>]*id="reject-confirm"[^>]*)>/);
  return { formaction: attr(attrs, 'formaction'), name: attr(attrs, 'name'), formmethod: attr(attrs, 'formmethod') };
}

/**
 * Press something in batch `index` (0-based) of the page `html`, with
 * `captions` typed first ({ id: text }), as the browser would send it:
 *   'save'               the form's default button, as Enter does
 *   { approve: id|all }  that Approve button
 *   { reject: id|all }   that Reject button, then the dialog's confirm
 */
async function press(env, html, index, which, captions = {}) {
  const form = forms(html)[index];
  const fields = form.fields.map(([name, value]) => {
    const id = name.startsWith('caption-') ? name.slice('caption-'.length) : null;
    return id !== null && Object.hasOwn(captions, id) ? [name, captions[id]] : [name, value];
  });
  let path;
  if (which === 'save') {
    const first = form.buttons.find((b) => b.type === 'submit');
    assert.equal(first.formaction, null, 'the default button posts to the form\'s own action');
    assert.equal(first.name, null);
    path = form.action;
  } else if (which.approve !== undefined) {
    const button = form.buttons.find((b) => b.name === 'approve' && b.value === String(which.approve));
    assert.ok(button, `no Approve button for ${which.approve} in batch ${index}`);
    assert.equal(button.type, 'submit');
    fields.push(['approve', button.value]);
    path = button.formaction;
  } else {
    const opener = form.buttons.find((b) => b.reject === String(which.reject));
    assert.ok(opener, `no Reject button for ${which.reject} in batch ${index}`);
    assert.equal(opener.form, form.id, 'the Reject button names its own batch form');
    const confirm = confirmButton(html);
    fields.push([confirm.name, opener.reject]);
    path = confirm.formaction;
  }
  const res = await admin(env, 'POST', path, { body: new URLSearchParams(fields).toString() });
  return { status: res.status, location: res.headers.get('Location') };
}

test('the zone pin took effect: this process is not on a whole-hour offset', () => {
  assert.notEqual(new Date(0).getTimezoneOffset() % 60, 0, `TZ=${process.env.TZ} did not apply`);
});

// ---- Criterion 1: grouped by batch, pictures through an admin-only route ----

test('waiting photos are grouped by batch and album, oldest batch first, each with its album, time sent and count', async () => {
  const { env, fall, practice } = await site();
  const a1 = seedPhoto(env, fall, { batch: BATCH_A, sentAt: T0 + 100 });
  const a2 = seedPhoto(env, fall, { batch: BATCH_A, sentAt: T0 + 101 });
  const b1 = seedPhoto(env, practice, { batch: BATCH_B, sentAt: T0 + 50 });
  // A photo retried into another album keeps its first batch (#155).
  const a3 = seedPhoto(env, practice, { batch: BATCH_A, sentAt: T0 + 102 });
  seedPhoto(env, fall, { batch: BATCH_A, sentAt: T0 + 103, state: 'approved' });
  seedClip(env, fall);

  const html = await page(env);
  const sections = [...html.matchAll(/<section class="wrap batch"[\s\S]*?<\/section>/g)].map((m) => m[0]);
  assert.equal(sections.length, 3);
  const heads = sections.map((s) => [s.match(/<h2 [^>]*>([^<]*)<\/h2>/)[1], s.match(/<p class="batch-facts"[^>]*>([\s\S]*?)<\/p>/)[1]]);
  // Each batch names its album's team first (#227).
  assert.deepEqual(heads, [
    ['Tuesday practice', `Hoover JRT · Batch 1 of 3 · 1 photo · sent <time datetime="${new Date((T0 + 50) * 1000).toISOString()}">21 September 2026, 14:14 UTC</time>`],
    ['Fall Regatta', `Hoover JRT · Batch 2 of 3 · 2 photos · sent <time datetime="${new Date((T0 + 100) * 1000).toISOString()}">21 September 2026, 14:15 UTC</time>`],
    ['Tuesday practice', `Hoover JRT · Batch 3 of 3 · 1 photo · sent <time datetime="${new Date((T0 + 102) * 1000).toISOString()}">21 September 2026, 14:15 UTC</time>`],
  ]);
  const idsIn = (s) => [...s.matchAll(/<li class="waiting" id="photo-(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual(sections.map(idsIn), [[b1], [a1, a2], [a3]]);
  assert.deepEqual(forms(html).map((f) => Object.fromEntries(f.fields).ids), [`${b1}`, `${a1} ${a2}`, `${a3}`]);
});

// ---- #227: the queue filters by team --------------------------------------

/** The team filter's links: [href, name, current]. The site header has a nav of its own. */
const filterLinks = (html) => [...html.match(/<nav class="team-filter"[\s\S]*?<\/nav>/)[0].matchAll(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)]
  .map(([, href, current, name]) => [href, name, Boolean(current)]);
const idsOf = (html) => forms(html).map((f) => Object.fromEntries(f.fields).ids);

test('#227: ?team= shows that team\'s batches only, the filter marks it, and an unknown team shows every team\'s', async () => {
  const { env, fall } = await site();
  const districts = await createAlbum(env.DB, { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' }, T0);
  const h = seedPhoto(env, fall, { batch: BATCH_A, sentAt: T0 + 10 });
  const c1 = seedPhoto(env, districts, { batch: BATCH_B, sentAt: T0 + 20 });
  const c2 = seedPhoto(env, districts, { batch: BATCH_B, sentAt: T0 + 21 });
  const at = async (query) => (await admin(env, 'GET', `/admin/queue${query}`, { origin: null })).text();

  const all = await at('');
  assert.deepEqual(idsOf(all), [`${h}`, `${c1} ${c2}`]);
  assert.match(all, /3 photos in 2 batches, oldest first\./);
  assert.deepEqual(filterLinks(all), [
    ['/admin/queue', 'All teams', true], ['/admin/queue?team=hoover-jrt', 'Hoover JRT', false], ['/admin/queue?team=cohssa', 'COHSSA', false],
  ]);
  const cohssa = await at('?team=cohssa');
  assert.deepEqual(idsOf(cohssa), [`${c1} ${c2}`]);
  assert.match(cohssa, /2 photos from COHSSA in 1 batch, oldest first\./);
  assert.match(cohssa, /<p class="batch-facts"[^>]*>COHSSA · Batch 1 of 1 · 2 photos/);
  assert.deepEqual(filterLinks(cohssa).map(([, name, current]) => [name, current]), [['All teams', false], ['Hoover JRT', false], ['COHSSA', true]]);
  assert.deepEqual(idsOf(await at('?team=hoover-jrt')), [`${h}`]);
  // Anything else in ?team= is every team, and marks All teams: a crafted
  // link shows nothing but the known names. Read while both teams have a
  // batch waiting, so every team and one team cannot read alike
  // (review-fanout at #227's review: read after Hoover JRT's was approved,
  // a filter quietly applied to COHSSA passed).
  for (const query of ['?team=boston', '?team=COHSSA', '?team=%3Cb%3E', '?team=']) {
    const html = await at(query);
    assert.deepEqual(idsOf(html), [`${h}`, `${c1} ${c2}`], query);
    assert.equal(filterLinks(html)[0][2], true, query);
    assert.doesNotMatch(html, /\?team=(?!hoover-jrt">|cohssa">)|<b>/, query);
  }
  // A team with nothing waiting says so in its own words.
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = 1 WHERE id = ?").run(h);
  assert.match(await at('?team=hoover-jrt'), /No photo from Hoover JRT is waiting\./);
});

test('#227: every press on a filtered queue lands back on the same team, and one on the whole queue names no team', async () => {
  const { env, fall } = await site();
  const districts = await createAlbum(env.DB, { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' }, T0);
  const ids = [1, 2, 3, 4, 5].map((i) => seedPhoto(env, districts, { batch: BATCH_B, sentAt: T0 + i }));
  const hoover = seedPhoto(env, fall, { batch: BATCH_A, sentAt: T0 });
  const at = async (query) => (await admin(env, 'GET', `/admin/queue${query}`, { origin: null })).text();
  const cohssa = await at('?team=cohssa');
  // Every place a press posts to carries the team in its address: the form's
  // own action, each Approve, and the reject dialog's confirm.
  const [form] = forms(cohssa);
  assert.equal(form.action, '/api/admin/queue/captions?team=cohssa');
  assert.ok(form.buttons.filter((b) => b.name === 'approve').every((b) => b.formaction === '/api/admin/queue/approve?team=cohssa'));
  assert.equal(confirmButton(cohssa).formaction, '/api/admin/queue/reject?team=cohssa');
  assert.ok(!form.fields.some(([name]) => name === 'team'), 'one source for the team: the address, not a field');
  const batch = `batch-${BATCH_B}-${env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(districts).id}`;
  const lands = (where) => `&at=${where}#${where}`;
  // Save captions lands on the caption it changed, or at its batch when it
  // changed none, and Approve and Reject at the next photo (#270), each on
  // the same team's list.
  assert.equal((await press(env, cohssa, 0, 'save', { [ids[0]]: 'Start' })).location, `/admin/queue?done=saved&n=1&team=cohssa${lands(`photo-${ids[0]}`)}`);
  assert.equal((await press(env, await at('?team=cohssa'), 0, 'save')).location, `/admin/queue?done=saved&n=0&team=cohssa${lands(batch)}`);
  assert.equal((await press(env, await at('?team=cohssa'), 0, { approve: ids[0] })).location, `/admin/queue?done=approved&photo=${ids[0]}&team=cohssa${lands(`photo-${ids[1]}`)}`);
  assert.equal((await press(env, await at('?team=cohssa'), 0, { reject: ids[1] })).location, `/admin/queue?done=rejected&photo=${ids[1]}&team=cohssa${lands(`photo-${ids[2]}`)}`);
  // #270: the team's last photo goes round to the team's earliest still
  // waiting, never to Hoover's, though Hoover's was sent first. Approve and
  // Reject each read the order by the team (review-fanout at #270's review:
  // only Approve's was held).
  assert.equal((await press(env, await at('?team=cohssa'), 0, { approve: ids[4] })).location, `/admin/queue?done=approved&photo=${ids[4]}&team=cohssa${lands(`photo-${ids[2]}`)}`);
  assert.equal((await press(env, await at('?team=cohssa'), 0, { reject: ids[3] })).location, `/admin/queue?done=rejected&photo=${ids[3]}&team=cohssa${lands(`photo-${ids[2]}`)}`);
  // A refused press keeps the team too.
  const refused = await admin(env, 'POST', '/api/admin/queue/approve?team=cohssa', { body: 'ids=x&approve=1' });
  assert.equal(refused.headers.get('Location'), '/admin/queue?error=form&team=cohssa');
  // A team the site does not have is dropped, never echoed into the address,
  // and a team in the body is not read at all.
  const crafted = await admin(env, 'POST', `/api/admin/queue/approve?team=${encodeURIComponent('<b>')}`, { body: 'ids=x&approve=1&team=cohssa' });
  assert.equal(crafted.headers.get('Location'), '/admin/queue?error=form');
  // The control: the unfiltered page's presses name no team, and land on the whole queue.
  const all = await at('');
  assert.ok(forms(all).every((f) => !f.action.includes('?') && f.buttons.every((b) => !(b.formaction ?? '').includes('?'))));
  assert.equal(confirmButton(all).formaction, '/api/admin/queue/reject');
  // And go round the whole queue, to Hoover's.
  assert.equal((await press(env, all, 1, { approve: ids[2] })).location, `/admin/queue?done=approved&photo=${ids[2]}${lands(`photo-${hoover}`)}`);
});

test('#227: a press that arrives as a GET, after the sign-in ran out, still lands on its team, and changes nothing', async () => {
  // review-fanout at #227's review: with the team in a hidden field, the GET
  // a lapsed Access sign-in replays carried no team.
  const { env, fall } = await site();
  const id = seedPhoto(env, fall);
  for (const path of ['/api/admin/queue/approve', '/api/admin/queue/reject', '/api/admin/queue/captions']) {
    const res = await admin(env, 'GET', `${path}?team=hoover-jrt`, { origin: null });
    assert.equal(res.headers.get('Location'), '/admin/queue?error=unchanged&team=hoover-jrt', path);
    // The control: the same GET from the whole queue names no team.
    assert.equal((await admin(env, 'GET', path, { origin: null })).headers.get('Location'), '/admin/queue?error=unchanged', path);
  }
  assert.equal(row(env, id).state, 'pending');
});

test('with nothing waiting, the page says so and shows no batch', async () => {
  const { env, fall } = await site();
  seedPhoto(env, fall, { state: 'approved' });
  const html = await page(env);
  assert.match(html, /No photo is waiting\. What parents send appears here, oldest first\./);
  assert.equal(forms(html).length, 0);
});

test('each size comes through the admin route: the stored bytes, as a JPEG, cached privately for 300 s at most', async () => {
  const { env, fall } = await site();
  const id = seedPhoto(env, fall, { shape: 'portrait' });
  for (const size of ['grid', 'screen', 'full']) {
    const res = await admin(env, 'GET', `/api/admin/photos/${id}/${size}`, { origin: null });
    assert.equal(res.status, 200, size);
    assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(res.headers.get('Cache-Control'), 'private, max-age=300');
    assert.equal(res.headers.get('Content-Disposition'), `inline; filename="photo-${id}-${size}.jpg"`);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
    const key = photoObjectKeys(row(env, id).media_key)[size];
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), env.MEDIA.objects.get(key).body, size);
  }
});

// Since #224 the guard sends a refused request to the sign-in, 303, whatever
// its method (lib/admin-session.js). Account 99 does not exist.
const REFUSED_SESSIONS = {
  'no admin session': async () => null,
  'an admin session signed with another key': () => adminCookieHeader(1, { key: `${ADMIN_KEY}-other` }),
  'an admin session for an account that does not exist': () => adminCookieHeader(99),
};

const assertSentToSignIn = (res) => {
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), ADMIN_SIGN_IN);
};

for (const [name, cookie] of Object.entries(REFUSED_SESSIONS)) {
  test(`the image route with ${name}: sent to the sign-in, and the bucket is never read`, async () => {
    const { env, fall } = await site();
    const id = seedPhoto(env, fall);
    const get = mock.method(env.MEDIA, 'get');
    const res = await admin(env, 'GET', `/api/admin/photos/${id}/full`, { cookie: await cookie(), origin: null });
    assertSentToSignIn(res);
    assert.equal(get.mock.callCount(), 0);
  });
}

test('the image route answers 404 for a photo or size that is not there, and never serves a clip', async () => {
  const { env, fall } = await site();
  const id = seedPhoto(env, fall);
  const clip = seedClip(env, fall);
  // An object where a photo's full size would be, under the clip's key, so
  // the clip is refused by its kind and not by a missing object (the first
  // mutation round: without it, dropping the kind check reddened nothing).
  env.MEDIA.objects.set(photoObjectKeys(row(env, clip).media_key).full, { body: jpeg({ width: 8, height: 8 }), httpMetadata: {} });
  for (const path of [`${id + 99}/full`, `${id}/thumb`, `${id}/constructor`, `0${id}/full`, `-1/full`, `abc/grid`, `${clip}/full`]) {
    const res = await admin(env, 'GET', `/api/admin/photos/${path}`, { origin: null });
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', path);
  }
  // A size that is not one of the three is refused before anything is read,
  // past the admin guard's own read of the admin (#224), one a request.
  const get = mock.method(env.MEDIA, 'get');
  env.DB.statements.length = 0;
  for (const size of ['thumb', 'constructor', '__proto__']) {
    assert.equal((await admin(env, 'GET', `/api/admin/photos/${id}/${size}`, { origin: null })).status, 404, size);
  }
  assert.equal(env.DB.statements.filter((sql) => GUARD_READ.test(sql)).length, 3);
  assert.deepEqual([get.mock.callCount(), env.DB.statements.filter((sql) => !GUARD_READ.test(sql)).length], [0, 0]);
  get.mock.restore();
  // An approved photo, and a hidden one, still open from the queue's links
  // (criterion 11 opens the full size after the approval).
  const approved = seedPhoto(env, fall, { sentAt: T0 + 1, state: 'approved' });
  const hidden = seedPhoto(env, fall, { sentAt: T0 + 2, state: 'approved' });
  env.DB.sqlite.prepare("UPDATE photos SET state = 'hidden', hidden_at = ? WHERE id = ?").run(T0 + 9, hidden);
  for (const other of [approved, hidden]) {
    assert.equal((await admin(env, 'GET', `/api/admin/photos/${other}/full`, { origin: null })).status, 200, `photo ${other}`);
  }
  // A row whose object is missing is 404 too, not a 500.
  env.MEDIA.objects.delete(photoObjectKeys(row(env, id).media_key).grid);
  assert.equal((await admin(env, 'GET', `/api/admin/photos/${id}/grid`, { origin: null })).status, 404);
  // The control: the same route serves the photo's other sizes.
  assert.equal((await admin(env, 'GET', `/api/admin/photos/${id}/full`, { origin: null })).status, 200);
});

// ---- Criterion 2: the media-release reminder is the first line --------------

test('the page\'s first line under its heading is the media-release reminder (D5)', async () => {
  const { env, fall } = await site();
  seedPhoto(env, fall);
  for (const html of [await page(env), adminQueuePage({ batches: [] })]) {
    const head = block(html, 'main').match(/<h1>([^<]*)<\/h1>\s*<p class="lede">([^<]*)<\/p>/);
    assert.ok(head, 'the lede does not follow the heading');
    assert.equal(head[1], 'Waiting for approval');
    assert.equal(head[2], 'Check each photo against the families who opted out of the media release before you approve it.');
    // Only the eyebrow comes before the heading.
    assert.match(block(html, 'main'), /^<main id="main">\s*<section class="wrap page-head">\s*<p class="eyebrow">Admin<\/p>\s*<h1>/);
  }
});

// ---- Criterion 3: all three sizes in view before approving ------------------

test('every waiting photo shows its screen, grid and full sizes, each at its stored dimensions, above its buttons', async () => {
  const { env, fall } = await site();
  const land = seedPhoto(env, fall);
  const port = seedPhoto(env, fall, { shape: 'portrait', sentAt: T0 + 1 });
  const html = await page(env);
  for (const [id, shape] of [[land, 'landscape'], [port, 'portrait']]) {
    const card = html.match(new RegExp(`<li class="waiting" id="photo-${id}">[\\s\\S]*?</li>`))[0];
    const images = [...card.matchAll(/<img\b([^>]*)>/g)].map(([, a]) => ({
      src: attr(a, 'src'), width: Number(attr(a, 'width')), height: Number(attr(a, 'height')), alt: attr(a, 'alt'),
    }));
    assert.deepEqual(images.map((i) => i.src), ['screen', 'grid', 'full'].map((s) => `/api/admin/photos/${id}/${s}`));
    for (const img of images) {
      const size = img.src.split('/').pop();
      assert.deepEqual([img.width, img.height], SHAPES[shape][size], `${id} ${size}`);
      assert.equal(img.alt, `Photo ${id} at ${size} size`);
    }
    // Each is also a link to itself, to open alone: how criterion 11 opens the full.
    for (const img of images) assert.match(card, new RegExp(`<a [^>]*href="${img.src}"[^>]*><img src="${img.src}"`));
    assert.ok(card.indexOf('<img') < card.indexOf('name="approve"'), 'a picture comes after the Approve button');
    assert.match(card, new RegExp(`<figcaption>Grid, ${SHAPES[shape].grid.join(' × ')}</figcaption>`));
    assert.match(card, new RegExp(`<figcaption>Full, ${SHAPES[shape].full.join(' × ')}</figcaption>`));
  }
  // The first screen-size picture loads at once; every other one waits until
  // it is near, the first of a second batch included.
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 5 });
  const lazy = [...block(await page(env), 'main').matchAll(/<img\b[^>]*>/g)].map((m) => /loading="lazy"/.test(m[0]));
  assert.deepEqual(lazy, [false, true, true, true, true, true, true, true, true]);
});

// ---- Criterion 4: the caption is an editable field -------------------------

test('each caption is a text field holding the stored caption, labelled for its photo', async () => {
  const { env, fall } = await site();
  const id = seedPhoto(env, fall, { caption: 'Rounding the windward mark' });
  const none = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const html = await page(env);
  const field = (n) => html.match(new RegExp(`<input id="caption-${n}"[^>]*>`))[0];
  assert.equal(field(id), `<input id="caption-${id}" name="caption-${id}" type="text" autocomplete="off" value="Rounding the windward mark">`);
  assert.equal(field(none), `<input id="caption-${none}" name="caption-${none}" type="text" autocomplete="off" value="">`);
  assert.match(html, new RegExp(`<label for="caption-${id}">Caption for photo ${id}</label>`));
});

test('an edited caption is what the approved photo keeps, and a cleared one keeps none', async () => {
  const { env, fall } = await site();
  const edited = seedPhoto(env, fall, { caption: 'Sam and Alex at the mark' });
  const cleared = seedPhoto(env, fall, { caption: 'Jo capsizing', sentAt: T0 + 1 });
  const html = await page(env);
  await press(env, html, 0, { approve: 'all' }, { [edited]: '  At the windward mark  ', [cleared]: '' });
  assert.equal(row(env, edited).caption, 'At the windward mark');
  assert.equal(row(env, cleared).caption, null);
  assert.equal(row(env, edited).state, 'approved');
  assert.equal(row(env, cleared).state, 'approved');
});

test('"Save captions", which Enter presses, saves every changed caption in the batch and approves nothing', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'one' });
  const b = seedPhoto(env, fall, { caption: 'two', sentAt: T0 + 1 });
  const c = seedPhoto(env, fall, { caption: 'three', sentAt: T0 + 2 });
  const html = await page(env);
  const res = await press(env, html, 0, 'save', { [a]: 'uno', [b]: '' });
  assert.equal(res.status, 303);
  // On the card of the last caption it changed, where Enter was pressed
  // (owner, at #270's review).
  assert.equal(res.location, `/admin/queue?done=saved&n=2&at=photo-${b}#photo-${b}`);
  assert.deepEqual([a, b, c].map((id) => [row(env, id).caption, row(env, id).state]),
    [['uno', 'pending'], [null, 'pending'], ['three', 'pending']]);
  // Nothing changed the second time: it says so, at the batch.
  const batch = `batch-${BATCH_A}-${row(env, a).album_id}`;
  assert.equal((await press(env, await page(env), 0, 'save')).location, `/admin/queue?done=saved&n=0&at=${batch}#${batch}`);
});

test('#270: Save captions lands on the last caption it changed in the page\'s order, not the order the database returns them', async () => {
  // Sent out of id order, so the page shows x, z, y: the last changed on the
  // page is y, the middle id, which neither end of an id order is.
  const { env, fall } = await site();
  const x = seedPhoto(env, fall, { sentAt: T0 });
  const y = seedPhoto(env, fall, { sentAt: T0 + 2 });
  const z = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const html = await page(env);
  assert.deepEqual(Object.fromEntries(forms(html)[0].fields).ids, `${x} ${z} ${y}`);
  const res = await press(env, html, 0, 'save', { [x]: 'one', [y]: 'two', [z]: 'three' });
  assert.equal(res.location, `/admin/queue?done=saved&n=3&at=photo-${y}#photo-${y}`);
  // A caption typed for a photo approved meanwhile is not saved, so it is
  // not where the press lands: y is passed over for z.
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = ? WHERE id = ?").run(T0 + 9, y);
  const stale = await press(env, html, 0, 'save', { [x]: 'uno', [y]: 'dos', [z]: 'tres' });
  assert.equal(stale.location, `/admin/queue?done=saved&n=2&unsaved=1&at=photo-${z}#photo-${z}`);
});

test('any press saves the captions typed in its batch: approving one photo saves another\'s caption, and that photo keeps waiting (owner, pickup)', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'one' });
  const b = seedPhoto(env, fall, { caption: 'two', sentAt: T0 + 1 });
  const html = await page(env);
  await press(env, html, 0, { approve: a }, { [b]: 'two, edited' });
  assert.equal(row(env, a).state, 'approved');
  assert.deepEqual([row(env, b).caption, row(env, b).state, row(env, b).approved_at], ['two, edited', 'pending', null]);
});

test('a caption over 200 characters changes nothing, the approval included, and the page names the photo', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'one' });
  const b = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const before = rows(env);
  const html = await page(env);
  const res = await press(env, html, 0, { approve: 'all' }, { [a]: 'fine', [b]: 'x'.repeat(201) });
  assert.equal(res.location, `/admin/queue?error=caption&photo=${b}`);
  assert.deepEqual(rows(env), before);
  // 200 characters is taken, counted as the table counts them: an emoji
  // outside the BMP is one character and two UTF-16 units, so a count of
  // units would refuse this (review: the sailboat, U+26F5, is one unit either
  // way and told nothing).
  const wave = String.fromCodePoint(0x1f30a);
  assert.equal(wave.repeat(200).length, 400);
  const ok = await press(env, html, 0, { approve: 'all' }, { [b]: wave.repeat(200) });
  assert.match(ok.location, /done=approved/);
  assert.equal(row(env, b).caption, wave.repeat(200));
});

test('a tab or other control character in a caption becomes a space rather than refusing the press (review finding 1)', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall);
  const b = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const sep = String.fromCharCode(0x2028);
  const res = await press(env, await page(env), 0, 'save', { [a]: `Sam\tand Alex`, [b]: `Jo${sep}and\u0007Kit` });
  assert.equal(res.location, `/admin/queue?done=saved&n=2&at=photo-${b}#photo-${b}`);
  assert.deepEqual([row(env, a).caption, row(env, b).caption], ['Sam and Alex', 'Jo and Kit']);
});

// ---- Criterion 5: approving ---------------------------------------------------

test('"Approve" on one photo approves it, with the time, and nothing else in the table changes', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'one' });
  const next = seedPhoto(env, fall, { sentAt: T0 + 1 });
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 2 });
  const before = rows(env);
  const html = await page(env);
  const start = nowSeconds();
  const res = await press(env, html, 0, { approve: a });
  assert.equal(res.status, 303);
  // #270: it lands on the next waiting photo.
  assert.equal(res.location, `/admin/queue?done=approved&photo=${a}&at=photo-${next}#photo-${next}`);
  const after = rows(env);
  const approved = after.find((r) => r.id === a);
  assert.equal(approved.state, 'approved');
  assert.ok(approved.approved_at >= start && approved.approved_at <= nowSeconds(), 'the approval time is now');
  assert.deepEqual(after.map((r) => (r.id === a ? { ...r, state: 'pending', approved_at: null } : r)), before);
});

test('"Approve all" approves one batch while a second batch waits untouched', async () => {
  const { env, fall } = await site();
  const a = [seedPhoto(env, fall), seedPhoto(env, fall, { sentAt: T0 + 1 })];
  const b = [seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 2 }), seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 3 })];
  const before = rows(env);
  const html = await page(env);
  const res = await press(env, html, 0, { approve: 'all' });
  // #270: on the next batch's first photo.
  assert.equal(res.location, `/admin/queue?done=approved&n=2&at=photo-${b[0]}#photo-${b[0]}`);
  assert.deepEqual(a.map((id) => row(env, id).state), ['approved', 'approved']);
  assert.ok(a.every((id) => row(env, id).approved_at !== null));
  assert.deepEqual(rows(env).filter((r) => b.includes(r.id)), before.filter((r) => b.includes(r.id)));
  // And the page now shows the second batch alone.
  assert.deepEqual(forms(await page(env)).map((f) => Object.fromEntries(f.fields).ids), [b.join(' ')]);
});

test('"Approve all" approves the photos the page showed, and one that joined the batch since waits', async () => {
  const { env, fall } = await site();
  const shown = seedPhoto(env, fall);
  const html = await page(env);
  const late = seedPhoto(env, fall, { sentAt: T0 + 1 });
  // A batch of one shows no "Approve all", so press the photo's own Approve,
  // with the form the page rendered before the late photo arrived.
  await press(env, html, 0, { approve: shown });
  assert.equal(row(env, shown).state, 'approved');
  assert.equal(row(env, late).state, 'pending');
  // The same with "Approve all" on a batch of two.
  const two = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 5 });
  const twoB = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 6 });
  const html2 = await page(env);
  const lateB = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 7 });
  const index = forms(html2).findIndex((f) => Object.fromEntries(f.fields).ids === `${two} ${twoB}`);
  await press(env, html2, index, { approve: 'all' });
  assert.deepEqual([two, twoB, lateB].map((id) => row(env, id).state), ['approved', 'approved', 'pending']);
});

test('a batch of one offers no "Approve all", "Move all" or "Reject all"; a batch of two offers all three, naming the count', async () => {
  const { env, fall } = await site();
  seedPhoto(env, fall);
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 1 });
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 2 });
  const [one, two] = forms(await page(env));
  assert.equal(one.buttons.filter((b) => b.value === 'all' || b.reject === 'all').length, 0);
  assert.deepEqual(two.buttons.filter((b) => b.value === 'all' || b.reject === 'all').map((b) => b.text), ['Approve all 2', 'Move all 2', 'Reject all 2']);
});

test('a press naming a photo outside its batch, or no batch at all, changes nothing', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall);
  const other = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 1 });
  const before = rows(env);
  for (const [route, body] of [
    ['approve', `ids=${a}&caption-${a}=x&approve=${other}`],
    ['approve', `ids=${a}&approve=`],
    ['approve', `approve=${a}`],
    ['approve', `ids=${a}+${a}&approve=${a}`],
    ['approve', `ids=${a}+01&approve=${a}`],
    ['approve', 'ids=&approve=all'],
    // No ids field at all: only the empty-list check refuses these (review:
    // every body above was also refused by a neighbouring check).
    ['approve', 'approve=all'],
    ['captions', `caption-${a}=x`],
  ]) {
    const res = await admin(env, 'POST', `/api/admin/queue/${route}`, { body });
    assert.equal(res.status, 303, body);
    assert.equal(res.headers.get('Location'), '/admin/queue?error=form', body);
    assert.deepEqual(rows(env), before, body);
  }
});

test('the anchor a press carries back must be a batch\'s own id, or the answer has none', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall);
  const albumId = row(env, a).album_id;
  // Save captions lands at its batch, by the anchor; since #270 Approve and
  // Reject land on a photo, whatever the anchor.
  const location = async (anchor) =>
    (await admin(env, 'POST', '/api/admin/queue/captions', { body: `ids=${a}&anchor=${encodeURIComponent(anchor)}` })).headers.get('Location');
  assert.equal(await location('evil"><b>'), '/admin/queue?done=saved&n=0');
  const part = `batch-${BATCH_A}-${albumId}-part-2`;
  assert.equal(await location(part), `/admin/queue?done=saved&n=0&at=${part}#${part}`);
});

test('an approve for photos no longer waiting says another admin got there first, and changes nothing, the caption included', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'as approved' });
  const html = await page(env);
  await press(env, html, 0, { approve: a });
  const before = rows(env);
  // The same stale page, with the caption changed: a public caption changes
  // only through a waiting photo's approval.
  const again = await press(env, html, 0, { approve: a }, { [a]: 'changed on a stale page' });
  // Nothing waits, so it lands at the top (#270).
  assert.equal(again.location, '/admin/queue?error=gone&unsaved=1');
  assert.deepEqual(rows(env), before, 'the approved row changed');
  const saved = await press(env, html, 0, 'save', { [a]: 'changed on a stale page' });
  assert.match(saved.location, /^\/admin\/queue\?done=saved&n=0&unsaved=1&at=batch-/);
  assert.deepEqual(rows(env), before, 'Save changed an approved photo\'s caption');
  // Its caption left as it was is no unsaved caption.
  assert.match((await press(env, html, 0, 'save', { [a]: 'as approved' })).location, /^\/admin\/queue\?done=saved&n=0&at=batch-/);
});

test('a caption typed for a photo approved since the page loaded is not saved, and the notice says so (review finding 7)', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'one' });
  const b = seedPhoto(env, fall, { caption: 'two', sentAt: T0 + 1 });
  const c = seedPhoto(env, fall, { caption: 'three', sentAt: T0 + 2 });
  const html = await page(env);
  // Another admin approves a and b.
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = ? WHERE id IN (?, ?)").run(T0 + 9, a, b);
  const res = await press(env, html, 0, 'save', { [a]: 'uno', [b]: 'dos', [c]: 'tres' });
  // On c's card, the one caption saved.
  assert.equal(res.location, `/admin/queue?done=saved&n=1&unsaved=2&at=photo-${c}#photo-${c}`);
  assert.deepEqual([a, b, c].map((id) => row(env, id).caption), ['one', 'two', 'tres']);
  const notice = queueNotice(new URLSearchParams(res.location.split('?')[1].split('#')[0]));
  assert.match(notice, /Saved 1 caption\. 2 captions were not saved: their photos were approved or hidden after this page was loaded\./);
  // An approve counts before its own approval: approving a photo with its
  // caption changed is not an unsaved caption. Nothing waits after d, so it
  // lands back on c, the one photo still waiting (#270).
  const d = seedPhoto(env, fall, { caption: 'four', sentAt: T0 + 3 });
  const ok = await press(env, await page(env), 0, { approve: d }, { [d]: 'cuatro' });
  assert.equal(ok.location, `/admin/queue?done=approved&photo=${d}&at=photo-${c}#photo-${c}`);
  assert.equal(row(env, d).caption, 'cuatro');
  // And a reject says so too: e is approved behind the page's back.
  const e = seedPhoto(env, fall, { caption: 'five', sentAt: T0 + 4 });
  const f = seedPhoto(env, fall, { caption: 'six', sentAt: T0 + 5 });
  const html3 = await page(env);
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = ? WHERE id = ?").run(T0 + 9, e);
  const gone = await press(env, html3, 0, { reject: f }, { [e]: 'cinco' });
  assert.equal(gone.location, `/admin/queue?done=rejected&photo=${f}&unsaved=1&at=photo-${c}#photo-${c}`);
});

test('a clip\'s id posted in a press is neither approved nor rejected, and its caption is not changed', async () => {
  const { env, fall } = await site();
  const clip = seedClip(env, fall);
  for (const route of ['approve', 'reject', 'captions']) {
    const res = await admin(env, 'POST', `/api/admin/queue/${route}`, { body: `ids=${clip}&caption-${clip}=a+caption&${route}=${clip}` });
    // Exactly: a clip's caption is no unsaved caption either.
    assert.equal(res.headers.get('Location'), route === 'captions' ? '/admin/queue?done=saved&n=0' : '/admin/queue?error=gone', route);
    assert.deepEqual([row(env, clip).state, row(env, clip).caption], ['pending', null], route);
  }
  // An approved clip, which only the kind test keeps out of the unsaved
  // count (round 3: the pending clip above was kept out by its state).
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = ? WHERE id = ?").run(T0 + 9, clip);
  const res = await admin(env, 'POST', '/api/admin/queue/captions', { body: `ids=${clip}&caption-${clip}=a+caption` });
  assert.equal(res.headers.get('Location'), '/admin/queue?done=saved&n=0');
});

// ---- Criterion 6: rejecting, confirmed in a native dialog --------------------

test('"Reject" on one photo, confirmed, deletes its row and its three objects, and nothing else', async () => {
  const { env, fall } = await site();
  const gone = seedPhoto(env, fall);
  const kept = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const approved = seedPhoto(env, fall, { sentAt: T0 + 2, state: 'approved' });
  const goneKeys = Object.values(photoObjectKeys(row(env, gone).media_key));
  const others = rows(env).filter((r) => r.id !== gone);
  const html = await page(env);
  const res = await press(env, html, 0, { reject: gone });
  // #270: on the next waiting photo, never the approved one between.
  assert.equal(res.location, `/admin/queue?done=rejected&photo=${gone}&at=photo-${kept}#photo-${kept}`);
  assert.equal(row(env, gone), undefined);
  // Reading the storage back finds no object under those keys.
  for (const key of goneKeys) assert.equal(await env.MEDIA.get(key), null, key);
  for (const key of goneKeys) assert.equal(await env.MEDIA.head(key), null, key);
  assert.deepEqual(rows(env), others);
  assert.equal(objectsOf(env, kept).length, 3);
  assert.equal(objectsOf(env, approved).length, 3);
});

test('a reject saves the captions typed in its batch, as every press does', async () => {
  const { env, fall } = await site();
  const gone = seedPhoto(env, fall, { caption: 'one' });
  const kept = seedPhoto(env, fall, { caption: 'two', sentAt: T0 + 1 });
  await press(env, await page(env), 0, { reject: gone }, { [kept]: 'two, edited before the reject' });
  assert.equal(row(env, gone), undefined);
  assert.deepEqual([row(env, kept).caption, row(env, kept).state], ['two, edited before the reject', 'pending']);
});

test('"Reject all", confirmed, deletes the batch\'s rows and objects while another batch keeps its own', async () => {
  const { env, fall } = await site();
  const a = [seedPhoto(env, fall), seedPhoto(env, fall, { sentAt: T0 + 1 }), seedPhoto(env, fall, { sentAt: T0 + 2 })];
  const b = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 3 });
  const keysA = a.flatMap((id) => Object.values(photoObjectKeys(row(env, id).media_key)));
  const html = await page(env);
  const res = await press(env, html, 0, { reject: 'all' });
  assert.equal(res.location, `/admin/queue?done=rejected&n=3&at=photo-${b}#photo-${b}`);
  assert.deepEqual(rows(env).map((r) => r.id), [b]);
  for (const key of keysA) assert.equal(await env.MEDIA.get(key), null, key);
  assert.equal(objectsOf(env, b).length, 3);
  assert.equal(env.MEDIA.objects.size, 3);
});

test('rejecting 340 photos deletes every object, in calls R2 accepts: no more than 1,000 keys each (review finding 5)', async (t) => {
  // Through the library: a press names at most 200 photos (PART_PHOTOS),
  // 600 keys, so the chunking is the library's own guarantee.
  const { env, fall } = await site();
  const ids = [];
  for (let i = 0; i < 340; i++) ids.push(seedPhoto(env, fall, { sentAt: T0 + i, objects: false }));
  const calls = [];
  const del = env.MEDIA.delete.bind(env.MEDIA);
  env.MEDIA.delete = (keys) => { calls.push([keys].flat().length); return del(keys); };
  t.mock.method(console, 'error', () => {});
  const { rejected, kept } = await rejectPhotos(env.DB, env.MEDIA, ids);
  assert.deepEqual([rejected.length, kept], [340, 0]);
  assert.deepEqual([rows(env).length, env.MEDIA.objects.size], [0, 0]);
  assert.ok(calls.every((n) => n <= 1000), `calls of ${calls.join(', ')} keys`);
  assert.equal(calls.reduce((a, b) => a + b, 0), 1020);
});

test('a reject naming an approved photo deletes nothing', async () => {
  const { env, fall } = await site();
  const approved = seedPhoto(env, fall, { state: 'approved' });
  const before = rows(env);
  const res = await admin(env, 'POST', '/api/admin/queue/reject', { body: `ids=${approved}&reject=${approved}` });
  assert.equal(res.headers.get('Location'), '/admin/queue?error=gone');
  assert.deepEqual(rows(env), before);
  assert.equal(objectsOf(env, approved).length, 3);
});

test('a bucket that refuses the delete: the rows still go, the page says the files stayed, and the log names each photo\'s folder', async (t) => {
  const { env, fall } = await site({ bucket: r2({ failDelete: true }) });
  const a = seedPhoto(env, fall);
  const b = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const prefixes = [a, b].map((id) => `photos/${row(env, id).media_key}/`);
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const res = await press(env, await page(env), 0, { reject: 'all' });
  // Nothing waits after, so the top of the queue (#270).
  assert.equal(res.location, '/admin/queue?done=rejected&n=2&kept=2');
  assert.deepEqual(rows(env), []);
  assert.equal(logged.length, 2);
  prefixes.forEach((prefix, i) => assert.match(logged[i], new RegExp(`^queue: bucket did not delete ${prefix} after a reject:`)));
});

test('"Reject" and "Reject all" are plain buttons that post nothing; the dialog\'s confirm is the only way to reject', async () => {
  const { env, fall } = await site();
  seedPhoto(env, fall);
  seedPhoto(env, fall, { sentAt: T0 + 1 });
  const html = await page(env);
  const [form] = forms(html);
  const rejects = form.buttons.filter((b) => b.reject !== null);
  assert.equal(rejects.length, 3);
  assert.ok(rejects.every((b) => b.type === 'button' && b.formaction === null && b.name === null));
  // Nothing on the page names the reject route but the dialog's confirm button.
  assert.equal(html.match(/\/api\/admin\/queue\/reject/g).length, 1);

  const dialog = block(html, 'dialog');
  assert.match(dialog, /^<dialog id="reject-dialog" class="confirm" aria-labelledby="reject-title">/);
  assert.match(dialog, /<form method="dialog">/);
  const buttons = [...dialog.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(([, attrs, text]) => ({ attrs, text }));
  assert.deepEqual(buttons.map((b) => b.text), ['Cancel', 'Reject']);
  // Cancel first: the dialog form's default button, so Enter cancels, and the focus when it opens.
  assert.match(buttons[0].attrs, /type="submit"/);
  assert.match(buttons[0].attrs, /\sautofocus\b/);
  assert.doesNotMatch(buttons[0].attrs, /formaction|formmethod/);
  assert.deepEqual(confirmButton(html), { formaction: '/api/admin/queue/reject', name: 'reject', formmethod: 'post' });
  // The dialog follows every batch, so no batch form's first button can be its confirm.
  assert.ok(html.lastIndexOf('</form>', html.indexOf('<dialog')) > html.lastIndexOf('class="batch-form"'));
});

// ---- Criterion 7: a caption with markup renders as text ---------------------

test('a caption of <img src=x onerror=alert(1)> is shown as text in its field, and an album title with markup as text', async () => {
  const { env } = await site();
  const hostile = await createAlbum(env.DB, { team: 'hoover-jrt', title: '<b>"Hostile"</b> & co', kind: 'regatta', date: '2026-10-05' }, T0);
  const caption = '<img src=x onerror=alert(1)>';
  const id = seedPhoto(env, hostile, { caption });
  const html = await page(env);
  assert.match(html, new RegExp(`name="caption-${id}" type="text" autocomplete="off" value="&lt;img src=x onerror=alert\\(1\\)&gt;">`));
  assert.ok(!html.includes('<img src=x'), 'the caption is on the page as markup');
  assert.ok(!html.includes('<b>"Hostile"'), 'the album title is on the page as markup');
  assert.match(html, /<h2 [^>]*>&lt;b&gt;&quot;Hostile&quot;&lt;\/b&gt; &amp; co<\/h2>/);
  // And the round trip: the field's value, sent back, stores the caption unchanged.
  await press(env, html, 0, 'save', {});
  assert.equal(row(env, id).caption, caption);
});

test('a stored batch holding markup is escaped wherever the page names it (security-audit SA-1)', async () => {
  const { env, fall } = await site();
  // No writer today stores anything but a UUID; the column's CHECK does not
  // say so, so the page must not rely on it.
  const id = seedPhoto(env, fall, { batch: 'x"><script>alert(1)</script>' });
  const html = await page(env);
  assert.ok(!html.includes('<script>alert(1)'), 'the batch is on the page as markup');
  assert.match(html, /<section class="wrap batch" id="batch-x&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;-\d+"/);
  // The presses still work. Save captions lands by the anchor, which is
  // refused as not a batch's id, so the answer has no fragment; an approve
  // lands by photo ids (#270), and nothing waits after this one.
  assert.equal((await press(env, html, 0, 'save')).location, '/admin/queue?done=saved&n=0');
  const res = await press(env, html, 0, { approve: id });
  assert.equal(res.location, `/admin/queue?done=approved&photo=${id}`);
});

// ---- Criterion 8: the admin home's counts ----------------------------------

test('the admin home shows how many photos wait and the storage every stored row takes, against the free 10 GB', async () => {
  const { env, fall } = await site();
  const pending = [seedPhoto(env, fall), seedPhoto(env, fall, { sentAt: T0 + 1 }), seedPhoto(env, fall, { sentAt: T0 + 2 })];
  const approved = seedPhoto(env, fall, { sentAt: T0 + 3, state: 'approved' });
  const clip = seedClip(env, fall);
  // Sizes chosen so each state's share shows in the total: a sum over
  // waiting rows alone would read 8 MB (review of the first mutation round,
  // where a 5 MB waiting clip made every sum read the same).
  const setBytes = env.DB.sqlite.prepare('UPDATE photos SET bytes = ? WHERE id = ?');
  for (const id of pending) setBytes.run(1_000_000, id);
  setBytes.run(2_000_000_000, approved);
  setBytes.run(5_000_000, clip);
  env.DB.sqlite.prepare("UPDATE photos SET state = 'hidden', hidden_at = ? WHERE id = ?").run(T0 + 9, seedPhoto(env, fall, { sentAt: T0 + 4, state: 'approved' }));
  setBytes.run(1_000_000_000, rows(env).at(-1).id);
  const html = await (await admin(env, 'GET', '/admin', { origin: null })).text();
  assert.match(block(html, 'main'), /<a class="button todo-item" href="\/admin\/queue"><span class="todo-count">3<\/span> <span>photos waiting for approval<\/span><\/a>/);
  assert.match(block(html, 'main'), /<p class="admin-storage">Storage used: 3\.01 GB of the free 10 GB \(30\.1%\)\.<\/p>/);
});

test('the counts read right at their edges', () => {
  const queue = TODO.find((t) => t.href === '/admin/queue');
  assert.match(todoItem(queue, 0), /<span class="todo-count">0<\/span> <span>photos waiting for approval\. Nothing to do\.<\/span>/);
  assert.match(todoItem(queue, 1), /<span class="todo-count">1<\/span> <span>photo waiting for approval<\/span>/);
  assert.match(todoItem(queue, 2), /<span class="todo-count">2<\/span> <span>photos waiting for approval<\/span>/);
  assert.equal(FREE_STORAGE_BYTES, 10_000_000_000);
  assert.equal(storageText(0), 'Storage used: 0 KB of the free 10 GB (0.0%).');
  assert.equal(storageText(999_499), 'Storage used: 999 KB of the free 10 GB (0.0%).');
  // Rounded before the unit is chosen: never "1000 KB" or "1000 MB".
  assert.equal(storageText(999_500), 'Storage used: 1 MB of the free 10 GB (0.0%).');
  assert.equal(storageText(999_499_999), 'Storage used: 999 MB of the free 10 GB (10.0%).');
  assert.equal(storageText(999_500_000), 'Storage used: 1.00 GB of the free 10 GB (10.0%).');
  assert.equal(storageText(250_000_000), 'Storage used: 250 MB of the free 10 GB (2.5%).');
  assert.equal(storageText(1_234_567_890), 'Storage used: 1.23 GB of the free 10 GB (12.3%).');
  assert.equal(storageText(10_000_000_000), 'Storage used: 10.00 GB of the free 10 GB (100.0%).');
  assert.equal(storageText(10_500_000_000), 'Storage used: 10.50 GB of the free 10 GB (105.0%). R2 bills what is over it every month.');
});

// ---- Criterion 10: refused without an admin, or from another site -----------

const REFUSALS = {
  ...Object.fromEntries(Object.entries(REFUSED_SESSIONS).map(([name, cookie]) => [name, { cookie, status: 303 }])),
  'a foreign Origin': { origin: 'https://evil.example', status: 403 },
  'a sibling site\'s Origin': { origin: 'https://madcowsailing.com', status: 403 },
  'no Origin': { origin: null, status: 403 },
  'the opaque Origin "null"': { origin: 'null', status: 403 },
};

for (const route of ['approve', 'reject', 'captions']) {
  for (const [name, { status, ...options }] of Object.entries(REFUSALS)) {
    test(`POST /api/admin/queue/${route} with ${name}: ${status}, and no row or object changes`, async () => {
      const { env, fall } = await site();
      const a = seedPhoto(env, fall, { caption: 'one' });
      const before = rows(env);
      const objects = [...env.MEDIA.objects.keys()];
      const cookie = options.cookie ? await options.cookie() : undefined;
      const res = await admin(env, 'POST', `/api/admin/queue/${route}`, {
        ...options, cookie, body: `ids=${a}&caption-${a}=changed&${route}=${a}`,
      });
      if (status === 303) assertSentToSignIn(res);
      else assert.equal(res.status, 403);
      assert.deepEqual(rows(env), before);
      assert.deepEqual([...env.MEDIA.objects.keys()], objects);
    });
  }

  test(`POST /api/admin/queue/${route} with an admin's session and the site's Origin goes through: the control`, async () => {
    const { env, fall } = await site();
    const a = seedPhoto(env, fall, { caption: 'one' });
    const before = rows(env);
    const res = await admin(env, 'POST', `/api/admin/queue/${route}`, { body: `ids=${a}&caption-${a}=changed&${route}=${a}` });
    assert.equal(res.status, 303);
    assert.notDeepEqual(rows(env), before);
  });

  test(`GET /api/admin/queue/${route} changes nothing and goes back to the queue, saying so`, async () => {
    const { env, fall } = await site();
    seedPhoto(env, fall);
    const before = rows(env);
    const res = await admin(env, 'GET', `/api/admin/queue/${route}`, { origin: null });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), '/admin/queue?error=unchanged');
    assert.deepEqual(rows(env), before);
  });
}

// ---- What a press costs D1 ----------------------------------------------------

// Each press on a fresh site, so no earlier press has already done its work
// (the first mutation round: an approve that skipped saving the captions
// passed here, because a Save press before it had saved them).
for (const which of ['save', { approve: 'all' }, { reject: 'all' }]) {
  test(`${JSON.stringify(which)} on a batch of 60 with every caption at 200 characters: at most four statements beside the guard's one, since D1 allows 50 a request on the free plan, and a form far past the albums' 4,096 bytes`, async () => {
    const { env, fall } = await site();
    for (let i = 0; i < 60; i++) seedPhoto(env, fall, { sentAt: T0 + i, caption: `photo ${i}` });
    const html = await page(env);
    const long = (id) => `edited ${id} `.padEnd(200, 'x');
    const edits = Object.fromEntries(rows(env).map((r) => [r.id, long(r.id)]));
    const body = new URLSearchParams(forms(html)[0].fields.map(([n, v]) => [n, n.startsWith('caption-') ? edits[n.slice(8)] : v])).toString();
    assert.ok(body.length > 12_000, `the form is ${body.length} bytes`);
    env.DB.statements.length = 0;
    const res = await press(env, html, 0, which, edits);
    assert.equal(res.status, 303);
    // Since #224 the admin guard reads the admin once a request. The press's
    // own were three, whatever the batch's size, until #270 added the read
    // of the queue's order that an approve or reject lands by: four now, and
    // Save captions, which lands at its batch, still two.
    assert.equal(env.DB.statements.filter((sql) => GUARD_READ.test(sql)).length, 1);
    const own = env.DB.statements.filter((sql) => !GUARD_READ.test(sql)).length;
    assert.equal(own, which === 'save' ? 2 : 4, `made ${own} statements`);
    if (which === 'save') assert.ok(rows(env).every((r) => r.state === 'pending' && r.caption === long(r.id)));
    if (which.approve) assert.ok(rows(env).every((r) => r.state === 'approved' && r.caption === long(r.id)));
    if (which.reject) assert.deepEqual([rows(env).length, env.MEDIA.objects.size], [0, 0]);
  });
}

test('a form past the queue\'s 512 KiB changes nothing', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall, { caption: 'one' });
  const before = rows(env);
  const body = `ids=${a}&approve=${a}&caption-${a}=x&pad=${'y'.repeat(512 * 1024)}`;
  const res = await admin(env, 'POST', '/api/admin/queue/approve', { body });
  assert.equal(res.headers.get('Location'), '/admin/queue?error=form');
  assert.deepEqual(rows(env), before);
  // The control: the same press, short, goes through.
  const ok = await admin(env, 'POST', '/api/admin/queue/approve', { body: `ids=${a}&approve=${a}&caption-${a}=x` });
  assert.match(ok.headers.get('Location'), /done=approved/);
});

test('readPress takes a part at its 200 photos and refuses 201', () => {
  assert.equal(PART_PHOTOS, 200);
  const ids = Array.from({ length: 200 }, (_, i) => i + 1);
  assert.deepEqual(readPress({ ids: ids.join(' '), approve: 'all' }, 'approve').targets, ids);
  assert.deepEqual(readPress({ ids: [...ids, 201].join(' '), approve: 'all' }, 'approve'), { error: 'form' });
});

test('a batch over 200 photos is shown in parts of 200, each its own form, and "Approve all" means its part (review finding 2)', async () => {
  const { env, fall } = await site();
  for (let i = 0; i < 450; i++) seedPhoto(env, fall, { sentAt: T0 + i, objects: false });
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 1000, objects: false });
  const html = await page(env);
  const parts = forms(html);
  assert.deepEqual(parts.map((f) => Object.fromEntries(f.fields).ids.split(' ').length), [200, 200, 50, 1]);
  const facts = [...html.matchAll(/<p class="batch-facts"[^>]*>([^<]*)</g)].map((m) => m[1].replace(/ · sent $/, ''));
  assert.deepEqual(facts, [
    'Hoover JRT · Batch 1 of 2 · part 1 of 3 · 200 photos', 'Hoover JRT · Batch 1 of 2 · part 2 of 3 · 200 photos',
    'Hoover JRT · Batch 1 of 2 · part 3 of 3 · 50 photos', 'Hoover JRT · Batch 2 of 2 · 1 photo',
  ]);
  assert.match(html, /451 photos in 2 batches, oldest first\./);
  assert.equal(new Set(parts.map((f) => f.id)).size, 4, 'two parts share a form id');
  assert.match(html, /aria-label="Approve all 200 in batch 1, part 2 of 3, Fall Regatta">Approve all 200</);
  const res = await press(env, html, 1, { approve: 'all' });
  // #270: on part 3's first photo, the next waiting.
  const next = rows(env)[400].id;
  assert.equal(res.location, `/admin/queue?done=approved&n=200&at=photo-${next}#photo-${next}`);
  const states = rows(env).map((r) => r.state);
  assert.deepEqual([states.slice(0, 200), states.slice(200, 400), states.slice(400)].map((s) => [...new Set(s)]),
    [['pending'], ['approved'], ['pending']]);
});

test('the worst part a parent can fill, 200 photos each captioned with 200 emoji outside the BMP, still posts under the cap', async () => {
  const { env, fall } = await site();
  const wave = String.fromCodePoint(0x1f30a).repeat(200);
  for (let i = 0; i < 200; i++) seedPhoto(env, fall, { sentAt: T0 + i, caption: wave, objects: false });
  const html = await page(env);
  const body = new URLSearchParams(forms(html)[0].fields).toString();
  // The cap is held between this body and the 512 KiB refusal above it.
  assert.ok(body.length > 480_000 && body.length < QUEUE_FORM_BYTES, `the form is ${body.length} characters`);
  const res = await press(env, html, 0, { approve: 'all' });
  assert.equal(res.location, '/admin/queue?done=approved&n=200');
});

// ---- The notices -----------------------------------------------------------------

test('each notice is a known sentence, and anything else in the address bar shows none', () => {
  const say = (query) => queueNotice(new URLSearchParams(query)).replace(/^\s*<p role="status">|<\/p>$/g, '');
  assert.equal(say('done=approved&photo=12'), 'Approved photo 12.');
  assert.equal(say('done=approved&n=4'), 'Approved 4 photos.');
  assert.equal(say('done=rejected&photo=12'), 'Rejected photo 12. It is deleted, with its three sizes.');
  assert.equal(say('done=rejected&n=3&kept=1'), 'Rejected 3 photos. They are deleted, with their three sizes. The storage did not delete the files of 1 photo; the log names each one\'s folder.');
  assert.equal(say('done=saved&n=1'), 'Saved 1 caption.');
  assert.equal(say('done=saved&n=0'), 'No caption had changed.');
  assert.equal(say('error=caption&photo=7'), 'Nothing was changed: the caption typed for photo 7 was over 200 characters. The captions typed in that batch were not saved, so type them again, keeping that one to 200.');
  assert.equal(say('done=saved&n=1&unsaved=1'), 'Saved 1 caption. 1 caption was not saved: its photo was approved or hidden after this page was loaded.');
  assert.equal(say('done=approved&photo=3&unsaved=2'), 'Approved photo 3. 2 captions were not saved: their photos were approved or hidden after this page was loaded.');
  assert.match(say('error=gone&unsaved=1'), /^No photo was approved, rejected or moved.* 1 caption was not saved: its photo was approved or hidden after this page was loaded\.$/);
  // Beside an error that saved nothing, unsaved says nothing.
  assert.equal(say('error=form&unsaved=1'), say('error=form'));
  assert.match(say('error=gone'), /^No photo was approved, rejected or moved/);
  assert.match(say('error=form'), /^Nothing was changed: the press did not say which photos/);
  assert.match(say('error=unchanged'), /^Nothing was changed\. The press reached the site as a page load/);
  for (const query of ['', 'done=approved', 'done=approved&photo=<b>', 'error=caption&photo=x', 'error=constructor', 'done=__proto__&n=1', 'error=caption']) {
    assert.equal(queueNotice(new URLSearchParams(query)), '', query);
  }
});

test('the page shows the notice from its address', async () => {
  const { env } = await site();
  const html = await (await admin(env, 'GET', '/admin/queue?done=approved&n=2', { origin: null })).text();
  assert.match(block(html, 'main'), /<p role="status">Approved 2 photos\.<\/p>/);
});

// ---- #270: the queue on a phone ------------------------------------------------

// A waiting photo's card, as the page renders it.
const card = (html, id) => html.match(new RegExp(`<li class="waiting" id="photo-${id}">[\\s\\S]*?</li>`))?.[0];
const get = async (env, location) => (await admin(env, 'GET', location.split('#')[0], { origin: null })).text();

test('#270 criterion 1: each waiting photo names its event and team, its sender where the site knows one, and has its caption field', async () => {
  const { env, fall } = await site();
  const districts = await createAlbum(env.DB, { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' }, T0);
  const named = seedPhoto(env, fall);
  const linked = seedPhoto(env, fall, { sentAt: T0 + 1 });
  const cohssa = seedPhoto(env, districts, { batch: BATCH_B, sentAt: T0 + 2 });
  env.DB.sqlite.prepare("INSERT INTO accounts (id, email, name, role, requested_at) VALUES (2, 'pat@example.org', 'Pat Parent', 'parent', 1)").run();
  env.DB.sqlite.prepare('UPDATE photos SET account_id = 2, code_generation = 0, session_issued = 0 WHERE id = ?').run(named);
  const html = await page(env);
  const facts = (id) => [...card(html, id).matchAll(/<p class="waiting-(album|facts)">([\s\S]*?)<\/p>/g)].map((m) => m[2].replace(/<time[^>]*>[^<]*<\/time>/, 'T'));
  // Each card says it, under its own heading, so a photo landed on far below
  // its batch's heading is still placed.
  assert.deepEqual(facts(named), ['Fall Regatta · Hoover JRT', 'Taken T · sent by Pat Parent']);
  assert.deepEqual(facts(linked), ['Fall Regatta · Hoover JRT', 'Taken T'], 'the invite link names nobody (#223, D17)');
  assert.deepEqual(facts(cohssa), ['Districts · COHSSA', 'Taken T']);
  for (const id of [named, linked, cohssa]) {
    assert.match(card(html, id), new RegExp(`<label for="caption-${id}">Caption for photo ${id}</label>\\s*<input id="caption-${id}" name="caption-${id}" type="text"`));
  }
  // A photo in a team's Not sure album says so.
  const notSure = env.DB.sqlite.prepare("SELECT address FROM albums WHERE holding = 1 AND team = 'hoover-jrt'").get().address;
  const held = seedPhoto(env, notSure, { batch: BATCH_A, sentAt: T0 + 3 });
  assert.match(card(await page(env), held), /<p class="waiting-album">Not sure \/ other event · Hoover JRT<\/p>/);
});

test('#270 criterion 1: every button on the queue is at least 44 px by the stylesheet, and on a phone each picture runs edge to edge and Reject sits alone at the end of its row', () => {
  const css = read('public', 'css', 'site.css');
  const tokens = read('..', 'shared', 'css', 'tokens.css');
  const px = (token) => Number(tokens.match(new RegExp(`${token}:\\s*([0-9.]+)rem;`))?.[1]) * 16;
  const rule = (text, selector) => text.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.()[\]:]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  const buttons = rule(css, '.batch .button,\n#reject-dialog .button');
  for (const side of ['min-height', 'min-width']) {
    const token = buttons.match(new RegExp(`${side}: var\\((--[a-z0-9-]+)\\);`))?.[1];
    assert.ok(token, `no ${side} token on the queue's buttons`);
    assert.ok(px(token) >= 44, `${side} ${token} is ${px(token)} px, under 44`);
  }
  // The phone block, 320 to 430 inside it.
  const phone = css.match(/@media \(max-width: 30rem\) \{([\s\S]*?)\n\}/g)?.find((m) => m.includes('.waiting-screen'));
  assert.ok(phone, 'no phone block for the queue');
  assert.ok(Number(phone.match(/max-width: ([0-9.]+)rem/)[1]) * 16 >= 430);
  // Edge to edge: the list steps out by exactly the page's own margin.
  assert.match(rule(read('..', 'shared', 'css', 'base.css'), '.wrap'), /padding-inline: var\(--space-4\);/);
  assert.match(rule(phone, '.queue'), /margin-inline: calc\(-1 \* var\(--space-4\)\);/);
  assert.match(rule(phone, '.waiting'), /padding-inline: 0;/);
  // Reject on its own row, at the end, after a full-width break, by order
  // alone. Its rule is the fill rule's selector and an attribute more, so it
  // outranks that rule wherever either sits in the file: it keeps its own
  // width rather than filling the row (review-fanout at #270's review: the
  // pair rested on rule order the file did not state).
  assert.match(rule(phone, '.batch .actions .button'), /flex: 1 1 auto;/);
  assert.match(rule(phone, '.batch .actions .button[data-reject]'), /order: 2;[\s\S]*flex: 0 0 auto;[\s\S]*margin-inline-start: auto;/);
  assert.match(rule(phone, '.batch .actions:has([data-reject])::after'), /content: '';[\s\S]*flex-basis: 100%;[\s\S]*order: 1;/);
  // Each photo's buttons stay at the bottom of the screen while its card is
  // on it (owner, at #270's review), on a ground of their own, and a focused
  // field is scrolled clear of them (WCAG 2.4.11).
  assert.match(rule(phone, '.waiting > .actions'), /position: sticky;[\s\S]*bottom: 0;[\s\S]*background: var\(--chalk\);/);
  assert.match(rule(phone, 'html:has(.queue)'), /scroll-padding-bottom: calc\(/);
  // The picture's focus ring is two rings, --chalk outside and --deep inside,
  // at least 9:1 against each other, so one of them reads 3:1 on any photo
  // (WCAG C40; review-fanout at #270's review: one --blue ring read 1.14:1
  // on deep water).
  const ring = rule(phone, '.waiting-screen:focus-visible').match(/outline-color: var\((--[a-z]+)\);/)?.[1];
  const inner = rule(phone, '.waiting-screen:focus-visible img').match(/outline: [^;]* solid var\((--[a-z]+)\);/)?.[1];
  assert.deepEqual([ring, inner], ['--chalk', '--deep']);
  const lum = (token) => {
    const hex = tokens.match(new RegExp(`${token}:\\s*#([0-9A-Fa-f]{6});`))[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (p, q) => (Math.max(lum(p), lum(q)) + 0.05) / (Math.min(lum(p), lum(q)) + 0.05);
  assert.ok(ratio(ring, inner) >= 9, `the rings read ${ratio(ring, inner).toFixed(2)}:1`);
  // The control: the one --blue ring the review measured falls short.
  assert.ok(ratio('--blue', '--chalk') < 9);
  // The new event's fieldset may be narrower than its title field.
  assert.match(rule(css, '.move fieldset'), /min-inline-size: 0;/);
  // The control: the matcher reads a rule's body, and a rule that is not there reads empty.
  assert.equal(rule(css, '.no-such-rule'), '');
});

test('#270 criterion 2: nextWaiting lands on the photo after the press, then the next batch, then the earliest still waiting', () => {
  // Two batches as the page shows them: [1, 2, 3] then [4, 5].
  const order = [1, 2, 3, 4, 5];
  assert.equal(nextWaiting(order, [1, 2, 3], [1], [1]), 2, 'the next in its batch');
  assert.equal(nextWaiting(order, [1, 2, 3], [2], [2]), 3, 'on down the batch, not back to 1, which waits');
  assert.equal(nextWaiting(order, [1, 2, 3], [3], [3]), 4, 'the last of its batch: the next batch\'s first');
  assert.equal(nextWaiting(order, [1, 2, 3], [1, 2, 3], [1, 2, 3]), 4, 'all of a batch: the next batch\'s first');
  assert.equal(nextWaiting(order, [4, 5], [5], [5]), 1, 'nothing after it: the earliest still waiting');
  assert.equal(nextWaiting([1, 2], [1, 2], [2], [2]), 1, 'going round never lands on what the press did');
  assert.equal(nextWaiting([5], [4, 5], [5], [5]), null, 'nothing waits: the top');
  // Taken by another admin before the press: the order lacks them.
  assert.equal(nextWaiting([1, 3, 4, 5], [1, 2, 3], [2], []), 3, 'the next the batch showed');
  assert.equal(nextWaiting([1, 3, 4, 5], [1, 2, 3], [1], [1]), 3,
    'the one after it taken meanwhile: on past it, which the page will not show (review-fanout at #270\'s review)');
  assert.equal(nextWaiting([1, 4, 5], [1, 2, 3], [1], [1]), 4, 'and every one after it: the next batch');
  assert.equal(nextWaiting([4, 5], [1, 2, 3], [1, 2, 3], []), 4, 'the whole batch gone: the earliest');
  // A named photo the press left waiting (a Not sure one) is passed over too.
  assert.equal(nextWaiting([1, 2, 3], [1, 2, 3], [1, 2], [2]), 3);
  // A part of a batch: [3, 4] of the order's six.
  assert.equal(nextWaiting([1, 2, 3, 4, 5, 6], [3, 4], [3, 4], [3, 4]), 5);
});

test('#270 criterion 2: after a press the page lands on the next waiting photo, the notice in its card, and the captions typed in the batch survive it', async () => {
  const { env, fall } = await site();
  const [a, b, c] = [0, 1, 2].map((i) => seedPhoto(env, fall, { sentAt: T0 + i }));
  const d = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 10 });
  // Approve a, with captions typed for b and c (#156: every press saves them).
  let res = await press(env, await page(env), 0, { approve: a }, { [b]: 'Mark rounding', [c]: 'Finish' });
  assert.equal(res.location, `/admin/queue?done=approved&photo=${a}&at=photo-${b}#photo-${b}`);
  let html = await get(env, res.location);
  assert.match(card(html, b), new RegExp(`^<li class="waiting" id="photo-${b}">\\s*<p role="status">Approved photo ${a}\\.</p>\\s*<h3>Photo ${b}</h3>`));
  assert.equal(html.match(/role="status"/g).length, 1, 'the notice shows once, in the card');
  assert.match(card(html, b), /name="caption-\d+" type="text" autocomplete="off" value="Mark rounding">/);
  assert.match(card(html, c), /value="Finish">/);
  assert.deepEqual([b, c].map((id) => row(env, id).caption), ['Mark rounding', 'Finish']);
  // Reject b, from that page, with c's caption changed again: on to c.
  res = await press(env, html, 0, { reject: b }, { [c]: 'Finish line' });
  assert.equal(res.location, `/admin/queue?done=rejected&photo=${b}&at=photo-${c}#photo-${c}`);
  html = await get(env, res.location);
  assert.match(card(html, c), new RegExp(`<p role="status">Rejected photo ${b}\\. It is deleted, with its three sizes\\.</p>`));
  assert.match(card(html, c), /value="Finish line">/);
  // Approve c, the last of its batch: on to d, the next batch's first.
  res = await press(env, html, 0, { approve: c });
  assert.equal(res.location, `/admin/queue?done=approved&photo=${c}&at=photo-${d}#photo-${d}`);
  assert.match(card(await get(env, res.location), d), new RegExp(`<p role="status">Approved photo ${c}\\.</p>`));
  // Approve d, the last: nothing waits, so the top, which says so.
  res = await press(env, await page(env), 0, { approve: d });
  assert.equal(res.location, `/admin/queue?done=approved&photo=${d}`);
  assert.match(block(await get(env, res.location), 'section'), /<p role="status">Approved photo \d+\.<\/p>/);
});

test('#270 criterion 2: Approve all and Reject all on a later batch land on the batch after it, not back on one skipped above', async () => {
  // The order is read before the press: read after it, the pressed batch is
  // gone from it, and the earliest photo still waiting, the skipped one, would
  // look like the next.
  const { env, fall } = await site();
  const skipped = seedPhoto(env, fall, { batch: BATCH_A });
  const b = [1, 2].map((i) => seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + i }));
  const c = [3, 4].map((i) => seedPhoto(env, fall, { batch: 'c0c0c0c0-0000-4000-8000-000000000003', sentAt: T0 + i }));
  const d = seedPhoto(env, fall, { batch: 'd0d0d0d0-0000-4000-8000-000000000004', sentAt: T0 + 5 });
  let res = await press(env, await page(env), 1, { approve: 'all' });
  assert.equal(res.location, `/admin/queue?done=approved&n=2&at=photo-${c[0]}#photo-${c[0]}`);
  res = await press(env, await page(env), 1, { reject: 'all' });
  assert.equal(res.location, `/admin/queue?done=rejected&n=2&at=photo-${d}#photo-${d}`);
  // The control: with nothing after it, the skipped one is next.
  res = await press(env, await page(env), 1, { approve: d });
  assert.equal(res.location, `/admin/queue?done=approved&photo=${d}&at=photo-${skipped}#photo-${skipped}`);
  assert.deepEqual([skipped, ...b, d].map((id) => row(env, id).state), ['pending', 'approved', 'approved', 'approved']);
});

test('#270: an Approve or Reject on photos no longer waiting lands on the next that is, past those taken meanwhile, not at the top', async () => {
  // review-fanout at #270's review: every gone fixture had nothing else
  // waiting, so a gone press landing at the top, or on a card the page no
  // longer shows, passed.
  const { env, fall } = await site();
  const [a, b, c] = [0, 1, 2].map((i) => seedPhoto(env, fall, { sentAt: T0 + i }));
  const d = seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 10 });
  const html = await page(env);
  // Another admin approves a and b behind this page's back.
  const take = (...ids) => ids.forEach((id) => env.DB.sqlite.prepare("UPDATE photos SET state = 'approved', approved_at = ? WHERE id = ?").run(T0 + 9, id));
  take(a, b);
  assert.equal((await press(env, html, 0, { approve: a })).location, `/admin/queue?error=gone&at=photo-${c}#photo-${c}`);
  assert.equal((await press(env, html, 0, { reject: a })).location, `/admin/queue?error=gone&at=photo-${c}#photo-${c}`);
  assert.match(card(await get(env, `/admin/queue?error=gone&at=photo-${c}`), c),
    /<p role="status">No photo was approved, rejected or moved: those photos are no longer waiting/);
  // c taken too: on to the next batch's first.
  take(c);
  assert.equal((await press(env, html, 0, { approve: b })).location, `/admin/queue?error=gone&at=photo-${d}#photo-${d}`);
  assert.equal((await press(env, html, 0, { reject: 'all' })).location, `/admin/queue?error=gone&at=photo-${d}#photo-${d}`);
  assert.deepEqual([a, b, c, d].map((id) => row(env, id).state), ['approved', 'approved', 'approved', 'pending']);
});

test('#270: Save captions shows its notice in the card it changed, or in its batch when it changed none, and a ?at= the page does not show puts it at the top, unechoed', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall);
  seedPhoto(env, fall, { sentAt: T0 + 1 });
  const res = await press(env, await page(env), 0, 'save', { [a]: 'Start' });
  assert.equal(res.location, `/admin/queue?done=saved&n=1&at=photo-${a}#photo-${a}`);
  let html = await get(env, res.location);
  assert.match(card(html, a), new RegExp(`^<li class="waiting" id="photo-${a}">\\s*<p role="status">Saved 1 caption\\.</p>\\s*<h3>`));
  assert.equal(html.match(/role="status"/g).length, 1, 'the notice shows once, in the card');
  const nothing = await press(env, html, 0, 'save');
  const batch = `batch-${BATCH_A}-${row(env, a).album_id}`;
  assert.equal(nothing.location, `/admin/queue?done=saved&n=0&at=${batch}#${batch}`);
  html = await get(env, nothing.location);
  const section = html.match(new RegExp(`<section class="wrap batch" id="${batch}"[\\s\\S]*?</section>`))[0];
  assert.match(section, /<p class="batch-facts"[^>]*>[\s\S]*?<\/p>\s*<p role="status">No caption had changed\.<\/p>\s*<form /);
  assert.doesNotMatch(block(html, 'section'), /role="status"/);
  // Anything else in ?at= shows the notice at the top: a photo not waiting,
  // a batch not on the page, an id the page has that is neither, and markup.
  for (const at of ['photo-999', `batch-${BATCH_B}-1`, 'main', 'reject-dialog', `photo-${a}"><b>x</b>`]) {
    const other = await get(env, `/admin/queue?done=saved&n=1&at=${encodeURIComponent(at)}`);
    assert.match(block(other, 'section'), /<p role="status">Saved 1 caption\.<\/p>/, at);
    assert.equal(other.match(/role="status"/g).length, 1, at);
    assert.ok(!other.includes('<b>x</b>'), 'the address is echoed');
  }
  // With no notice there is nothing to place, whatever ?at= says.
  assert.doesNotMatch(await get(env, `/admin/queue?at=photo-${a}`), /role="status"/);
});

// ---- The page itself ---------------------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html) => validator.validateString(html, join(ROOT, 'admin.html'));

test('every state of the page passes the photo site\'s html-validate config, and the validator can fail it', async () => {
  const { env, fall, practice } = await site();
  const empty = await page(env);
  seedPhoto(env, fall);
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 1, caption: 'a "quoted" <caption>' });
  seedPhoto(env, fall, { batch: BATCH_B, sentAt: T0 + 2, shape: 'portrait' });
  // Two batches in one album: two regions, which need two names.
  seedPhoto(env, practice, { batch: BATCH_A, sentAt: T0 + 3 });
  const full = await page(env);
  const batches = await waitingBatches(env.DB);
  const notice = queueNotice(new URLSearchParams('done=approved&n=2'));
  const noticed = adminQueuePage({ batches, notice });
  // #270: the notice in a photo's card, and in a batch's section.
  const inCard = adminQueuePage({ batches, notice, at: `photo-${batches[1].photos[1].id}` });
  const inBatch = adminQueuePage({ batches, notice, at: batches[1].id });
  assert.ok([inCard, inBatch].every((html) => !block(html, 'section').includes('role="status"')), 'a landed notice left at the top');
  for (const html of [empty, full, noticed, inCard, inBatch]) {
    const report = await validate(html);
    assert.deepEqual(report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)), []);
    // The control plants a second h1 beside the lede. Not before the first
    // h2: on the empty page that is the dialog's, and a <dialog> starts its
    // own heading order, so an h1 there is valid (measured: the plant passed).
    assert.equal((await validate(html.replace('<p class="lede">', '<h1>again</h1><p class="lede">'))).valid, false);
  }
  const home = adminHome(adminData().admin, { waiting: 3, bytes: 1_234_567_890 });
  assert.equal((await validate(home)).valid, true);
});

test('one h1, a main, noindex, and no inline script, style or handler', async () => {
  const { env, fall } = await site();
  seedPhoto(env, fall);
  const html = await page(env);
  assert.equal(html.match(/<h1[\s>]/g).length, 1);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html.replace(QUEUE_SCRIPT, ''), /<script|<style|\sstyle="|\son[a-z]+="/i);
});

test('GET /admin/queue answers HTML that no cache may keep', async () => {
  const { env } = await site();
  const res = await admin(env, 'GET', '/admin/queue', { origin: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
});

test('its chrome and stylesheets are the admin home\'s, and its one script is stamped with its own hash', () => {
  const home = adminHome(adminData().admin, { waiting: 0, bytes: 0 });
  const html = adminQueuePage({ batches: [] });
  assert.equal(block(html, 'header'), block(home, 'header'));
  assert.equal(block(html, 'footer'), block(home, 'footer'));
  assert.equal(block(html, 'head').replace(`\n${QUEUE_SCRIPT}`, '').replace(/<title>[^<]*<\/title>/, ''),
    block(home, 'head').replace(/<title>[^<]*<\/title>/, ''));
  const version = createHash('sha256').update(readFileSync(join(ROOT, 'public', 'js', 'admin-queue.js'))).digest('hex').slice(0, 10);
  assert.equal(QUEUE_SCRIPT, `<script src="/js/admin-queue.js?v=${version}" defer></script>`,
    'public/js/admin-queue.js changed: copy its new ?v= into QUEUE_SCRIPT in lib/admin-page.js');
});

test('the admin home links to the queue', () => {
  assert.match(block(adminHome(adminData().admin, { waiting: 0, bytes: 0 }), 'main'), /<a class="button button-quiet todo-item" href="\/admin\/queue">/);
});

// ---- The script (public/js/admin-queue.js) ------------------------------------
//
// Run as the browser runs it, against hand-written stand-ins for the few DOM
// calls it makes, as test/removals.test.js runs its page's scripts (and the
// invite code page's test ran its until #226).

const SCRIPT = read('public', 'js', 'admin-queue.js');

test('the script names only elements the page carries', async () => {
  const { env, fall } = await site();
  seedPhoto(env, fall);
  const html = await page(env);
  for (const [, id] of SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)) {
    assert.match(html, new RegExp(`id="${id}"`), `admin-queue.js reaches for #${id}, which the page lacks`);
  }
});

function runScript() {
  const el = (props = {}) => {
    const attributes = {};
    return {
      textContent: '', value: '', dataset: {}, listeners: {}, attributes,
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute(name, value) { attributes[name] = String(value); },
      ...props,
    };
  };
  const calls = [];
  const nodes = {
    'reject-dialog': el({ showModal: () => calls.push('showModal'), show: () => calls.push('show') }),
    'reject-title': el({ textContent: 'stale title' }),
    // Neither label the script writes, so writing one is seen (review: this
    // started at 'Reject', so a script that never wrote it passed).
    'reject-confirm': el({ textContent: 'stale label' }),
  };
  const one = el({ dataset: { reject: '12', form: 'batch-a-form' } });
  const all = el({ dataset: { reject: 'all', count: '5', form: 'batch-b-form' } });
  const time = el({ dateTime: '2026-09-21T14:14:21.000Z', textContent: '21 September 2026, 14:14 UTC' });
  const captions = [el(), el()];
  const selectors = { 'button[data-reject]': [one, all], 'time[datetime]': [time], 'input[name^="caption-"]': captions };
  const document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelectorAll: (selector) => {
      if (!(selector in selectors)) throw new Error(`the script asked for ${selector}, which this stand-in does not know`);
      return selectors[selector];
    },
  };
  vm.runInNewContext(SCRIPT, { document, Date });
  const type = (field, value) => { field.value = value; field.listeners.input?.(); };
  return { nodes, one, all, time, captions, calls, type, click: (element) => element.listeners.click?.() };
}

test('the script: a caption stops at 200 characters, counted as the server counts them, and one under the limit is left alone', () => {
  const s = runScript();
  const wave = String.fromCodePoint(0x1f30a);
  s.type(s.captions[0], `${'a'.repeat(190)}${wave.repeat(15)}`);
  assert.equal([...s.captions[0].value].length, 200);
  assert.equal(s.captions[0].value, `${'a'.repeat(190)}${wave.repeat(10)}`);
  s.type(s.captions[1], wave.repeat(200));
  assert.equal(s.captions[1].value, wave.repeat(200), '200 emoji are 200 characters, not 400');
  s.type(s.captions[1], 'short');
  assert.equal(s.captions[1].value, 'short');
});

test('the script: after a "Reject all", a single photo\'s Reject puts the label and the target back to that photo', () => {
  const s = runScript();
  s.click(s.all);
  s.click(s.one);
  const confirm = s.nodes['reject-confirm'];
  assert.deepEqual([confirm.textContent, confirm.value, confirm.attributes.form, s.nodes['reject-title'].textContent],
    ['Reject', '12', 'batch-a-form', 'Reject photo 12?']);
});

test('the script: "Reject" opens the dialog as a modal, pointing its confirm at the photo and its batch form', () => {
  const s = runScript();
  assert.deepEqual(s.calls, [], 'the dialog opened before anything was pressed');
  s.click(s.one);
  assert.deepEqual(s.calls, ['showModal']);
  const confirm = s.nodes['reject-confirm'];
  assert.equal(confirm.value, '12');
  assert.equal(confirm.attributes.form, 'batch-a-form');
  assert.equal(confirm.textContent, 'Reject');
  assert.equal(s.nodes['reject-title'].textContent, 'Reject photo 12?');
});

test('the script: "Reject all" points the confirm at every photo of its own batch, and names how many', () => {
  const s = runScript();
  s.click(s.one);
  s.click(s.all);
  assert.deepEqual(s.calls, ['showModal', 'showModal']);
  const confirm = s.nodes['reject-confirm'];
  assert.equal(confirm.value, 'all');
  assert.equal(confirm.attributes.form, 'batch-b-form');
  assert.equal(confirm.textContent, 'Reject 5');
  assert.equal(s.nodes['reject-title'].textContent, 'Reject all 5 photos in this batch?');
});

test('the script: each time is rewritten into the reader\'s own zone', () => {
  // Pinned to Chatham above, 14:14 UTC on the 21st is 02:59 on the 22nd.
  const { time } = runScript();
  assert.notEqual(time.textContent, '21 September 2026, 14:14 UTC');
  assert.match(time.textContent, /22/);
  assert.match(time.textContent, /59/);
});

test('the page\'s buttons carry what the script reads: each Reject its photo or "all", its form, and a count for "all"', async () => {
  const { env, fall } = await site();
  const a = seedPhoto(env, fall);
  seedPhoto(env, fall, { sentAt: T0 + 1 });
  const html = await page(env);
  const [form] = forms(html);
  const openers = [...html.matchAll(/<button\b[^>]*data-reject="([^"]+)"[^>]*>/g)].map((m) => m[0]);
  for (const opener of openers) assert.match(opener, new RegExp(`data-form="${form.id}"`));
  assert.match(openers.find((o) => o.includes('data-reject="all"')), /data-count="2"/);
  assert.ok(openers.some((o) => o.includes(`data-reject="${a}"`)));
  assert.match(html, new RegExp(`<form method="post" action="/api/admin/queue/captions" id="${form.id}" class="batch-form">`));
});
