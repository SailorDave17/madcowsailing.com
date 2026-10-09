// "Remove this photo" (#158): anyone hides an approved photo at once, and an
// admin puts it back or deletes it on /admin/removals. Since #310 a clip that
// "Hide all" took down waits there too, to be put back or deleted the same
// way; the takedown itself still takes photos only, until #286.
//
// Every request runs through the chain Pages runs (the root middleware, the
// directory guards for an admin route, then the route), against a real
// SQLite holding the real migrations (test/d1.js) and an R2 stand-in
// (test/r2.js). Photos are seeded as the upload route and the queue leave
// them. Each section names the criterion it holds.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import * as albumRoute from '../functions/albums/[address]/index.js';
import * as listRoute from '../functions/index.js';
import * as hooverRoute from '../functions/hoover-jrt/index.js';
import * as cohssaRoute from '../functions/cohssa/index.js';
import * as imageRoute from '../functions/photos/[id]/[size].js';
import { onRequestPost as confirmRoute } from '../functions/remove.js';
import { onRequestPost as removeRoute } from '../functions/api/remove.js';
import { onRequest as adminPages } from '../functions/admin/_middleware.js';
import { onRequestGet as homePage } from '../functions/admin/index.js';
import { onRequestGet as removalsPage } from '../functions/admin/removals.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import { onRequestGet as adminImage } from '../functions/api/admin/photos/[id]/[size].js';
import { onRequestGet as adminClip } from '../functions/api/admin/clips/[id].js';
import { onRequestGet as restoreGet, onRequestPost as restorePost } from '../functions/api/admin/removals/restore.js';
import { onRequestGet as deleteGet, onRequestPost as deletePost } from '../functions/api/admin/removals/delete.js';
import { addressBlock } from '../lib/address.js';
import { REMOVALS_SCRIPT, adminRemovalsPage, clipBox, removalsNotice } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { base64url, hmac } from '../lib/crypto.js';
import { clipObjectKey, photoObjectKeys } from '../lib/photos.js';
import { REMOVED_NOTICE, TAKEDOWN_EMAIL } from '../lib/public-page.js';
import { waitingBatches } from '../lib/queue.js';
import {
  NOTE_MAX, REMOVAL_LIMIT, REMOVAL_WINDOW_SECONDS, REMOVE_FORM_BYTES, WAITING_WHEN_HIDDEN, hiddenPhotos, readNote, requestRemoval,
} from '../lib/removals.js';
import { nowSeconds } from '../lib/session.js';
import { ADMIN_KEY, adminCookieHeader, seedAdmin } from './admin.js';
import { d1 } from './d1.js';
import { jpeg } from './jpeg.js';
import { r2 } from './r2.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];
const sha10 = (...parts) => createHash('sha256').update(readFileSync(join(ROOT, ...parts))).digest('hex').slice(0, 10);

// The admin script rewrites each time into the reader's own zone. Pinned to
// Chatham, which differs from UTC in date, hour and minutes, so a script that
// kept UTC, or slipped by whole hours, fails (as test/queue.test.js pins it;
// #158's review found this file's first version asserting only that the text
// changed). Every time the server writes is UTC by construction.
process.env.TZ = 'Pacific/Chatham';

const SITE = 'https://photos.madcowsailing.com';
const T0 = 1_790_000_000; // 2026-09-21T14:13:20Z
const FALL = { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' };
const PRACTICE = { team: 'hoover-jrt', title: 'Tuesday practice', kind: 'practice', date: '2026-10-06' };
const ADDRESS_KEY = 'test-address-hash-key-fedcba9876543210';
const IP = '203.0.113.7';

afterEach(() => mock.restoreAll());

/** A site with two albums and nothing sent, and its owner, account 1, whose session admin() sends (#224). */
async function site({ bucket = r2(), env: extra = {} } = {}) {
  const env = { DB: d1(), MEDIA: bucket, ADDRESS_HASH_KEY: ADDRESS_KEY, SESSION_SIGNING_KEY: ADMIN_KEY, ...extra };
  seedAdmin(env.DB);
  const fall = await createAlbum(env.DB, FALL, T0);
  const practice = await createAlbum(env.DB, PRACTICE, T0);
  return { env, fall, practice };
}

let keys = 0;
const OBJECTS = { grid: jpeg({ width: 4, height: 3 }), screen: jpeg({ width: 8, height: 6 }), full: jpeg({ width: 16, height: 12 }) };

/**
 * A photo as the upload route and the queue leave it: a row in `state`, and
 * its three objects. A hidden one is hidden at `hiddenAt`, by default later
 * for each photo seeded; pass it to seed one hidden earlier than its id says.
 */
function seed(env, address, { state = 'approved', captured = T0, caption = null, note = null, hiddenAt = null } = {}) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'caption, captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, ' +
    "bytes, approved_at, hidden_at, hidden_note) VALUES (?, 'photo', ?, ?, ?, 'parent', 1, ?, ?, ?, ?, 2560, 1920, 480, 360, 1600, 1200, 1000, ?, ?, ?)",
  ).run(albumId, state, mediaKey, '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b', T0 - 60, caption, captured, T0 + keys,
    state === 'pending' ? null : T0 + 100, state === 'hidden' ? hiddenAt ?? T0 + 200 + keys : null, state === 'hidden' ? note : null);
  for (const [size, key] of Object.entries(photoObjectKeys(mediaKey))) {
    env.MEDIA.objects.set(key, { body: OBJECTS[size], httpMetadata: { contentType: 'image/jpeg' } });
  }
  return Number(lastInsertRowid);
}

// A clip's bytes, each its place mod 251, so a clip read back shows it is this one.
const CLIP = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

/**
 * A clip as the clip routes leave it (#198's shape), under a media key of its
 * own, with its one object in the bucket: `approved`, which a takedown must
 * leave alone until #286, `pending`, or `hidden`, as "Hide all" leaves one
 * since #310. A hidden one was approved when it was hidden, or with `waiting`
 * still waiting, so its approved_at is WAITING_WHEN_HIDDEN, as hidePhotos
 * writes it and 0005's CHECK needs. One `uploading` names `uploadId`, as
 * migration 0016 requires, and has nothing read from it and no object yet:
 * seedUploading() opens a real upload for it. Answers its id.
 */
function seedClip(env, address, {
  state = 'approved', waiting = false, hiddenAt = null, sender = 'parent', durationMs = 30_000, width = 1920,
  height = 1080, sentAt = T0, uploadId = null, mediaKey = (++keys).toString(16).padStart(32, '0'),
} = {}) {
  const albumId = env.DB.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id;
  const read = state !== 'uploading';
  const approvedAt = state === 'approved' || state === 'hidden' ? (waiting ? WAITING_WHEN_HIDDEN : T0 + 1) : null;
  const { lastInsertRowid } = env.DB.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, bytes, content_type, duration_ms, upload_id, approved_at, hidden_at) ' +
    "VALUES (?, 'clip', ?, ?, 'b', ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(albumId, state, mediaKey, sender, read ? T0 : null, sentAt, read ? width : null, read ? height : null,
    read ? CLIP.length : null, read ? 'video/mp4' : null, read ? durationMs : null, read ? null : uploadId, approvedAt,
    state === 'hidden' ? hiddenAt ?? T0 + 200 + keys : null);
  if (read) env.MEDIA.objects.set(clipObjectKey(mediaKey), { body: CLIP, httpMetadata: { contentType: 'video/mp4' } });
  return Number(lastInsertRowid);
}

/**
 * A clip still uploading (#198), its upload really open in the bucket under
 * the clip's object key, as the start route leaves one. Answers its id and
 * its upload's id. `sentAt` now keeps it from the admin home's sweep of
 * uploads abandoned a day (lib/clips.js, clearStaleClips).
 */
async function seedUploading(env, address, { sentAt = T0 } = {}) {
  const mediaKey = (++keys).toString(16).padStart(32, '0');
  const { uploadId } = await env.MEDIA.createMultipartUpload(clipObjectKey(mediaKey), { httpMetadata: { contentType: 'video/mp4' } });
  return { id: seedClip(env, address, { state: 'uploading', mediaKey, uploadId, sentAt }), uploadId };
}

/**
 * `db` with every statement whose SQL matches `pattern` throwing when it runs,
 * as a transient D1 error does, and every other statement untouched. The
 * statements still reach `db.statements`, so a test can see what was asked.
 */
function failOn(db, pattern) {
  const boom = async () => { throw new Error('transient D1 error'); };
  const broken = (statement) => ({ bind: (...values) => broken(statement.bind(...values)), first: boom, all: boom, run: boom });
  return { ...db, prepare: (sql) => (pattern.test(sql) ? broken(db.prepare(sql)) : db.prepare(sql)) };
}

const photoRow = (env, id) => env.DB.sqlite.prepare('SELECT * FROM photos WHERE id = ?').get(id);
const tables = (env) => ({
  photos: env.DB.sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r })),
  removals: env.DB.sqlite.prepare('SELECT * FROM removal_requests ORDER BY rowid').all().map((r) => ({ ...r })),
});
const removalRows = (env) => tables(env).removals;

/** Run `handlers` in order, as Pages does, with one context.data. */
function chain(handlers, request, env, params = {}) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const STATIC_404 = () => new Response('the site\'s 404 page', { status: 404, headers: { 'Content-Type': 'text/html' } });

/** A public GET through the chain: /, a team's section (#227), an album, or a photo. */
function get(env, path) {
  const url = new URL(path, SITE);
  const request = new Request(url);
  let m;
  if (url.pathname === '/') return chain([root, listRoute.onRequestGet], request, env);
  if (url.pathname === '/hoover-jrt/') return chain([root, hooverRoute.onRequestGet], request, env);
  if (url.pathname === '/cohssa/') return chain([root, cohssaRoute.onRequestGet], request, env);
  if ((m = url.pathname.match(/^\/albums\/([^/]+)\/$/))) {
    return chain([root, albumRoute.onRequestGet, STATIC_404], request, env, { address: m[1] });
  }
  if ((m = url.pathname.match(/^\/photos\/([^/]+)\/([^/]+)$/))) {
    return chain([root, imageRoute.onRequestGet], request, env, { id: m[1], size: m[2] });
  }
  throw new Error(`no route for ${path}`);
}

/**
 * A form post to /remove or /api/remove as a browser sends it. `origin: null`
 * sends none; `ip` is the visitor's address, as Cloudflare passes it.
 */
function post(env, path, fields, { origin = SITE, ip = IP, body } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip };
  if (origin !== null) headers.Origin = origin;
  const request = new Request(`${SITE}${path}`, {
    method: 'POST', headers, body: body ?? new URLSearchParams(fields).toString(),
  });
  const route = { '/remove': confirmRoute, '/api/remove': removeRoute }[path];
  return chain([root, route], request, env);
}

const takedown = (env, id, options = {}) => post(env, '/api/remove', { photo: String(id), ...(options.note === undefined ? {} : { note: options.note }) }, options);

const ADMIN_ROUTES = {
  POST: { '/api/admin/removals/restore': restorePost, '/api/admin/removals/delete': deletePost },
  GET: {
    '/api/admin/removals/restore': restoreGet, '/api/admin/removals/delete': deleteGet,
    '/admin/removals': removalsPage, '/admin': homePage,
  },
};

/** An admin request through the whole chain, with the owner's session. */
async function admin(env, method, path, { body, origin = SITE } = {}) {
  const headers = { Cookie: await adminCookieHeader(1) };
  if (origin !== null) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const request = new Request(`${SITE}${path}`, { method, headers, body });
  const url = new URL(request.url);
  const photo = url.pathname.match(/^\/api\/admin\/photos\/([^/]+)\/([^/]+)$/);
  if (photo) return chain([root, ...adminApi, adminImage], request, env, { id: photo[1], size: photo[2] });
  // #310: a hidden clip's player asks the admin clip route.
  const clip = url.pathname.match(/^\/api\/admin\/clips\/([^/]+)$/);
  if (clip) return chain([root, ...adminApi, adminClip], request, env, { id: clip[1] });
  const guards = url.pathname.startsWith('/api/') ? adminApi : adminPages;
  return chain([root, ...guards, ADMIN_ROUTES[method][url.pathname]], request, env);
}

const removals = async (env) => (await admin(env, 'GET', '/admin/removals', { origin: null })).text();

/** The notice the removals page shows at `location`, where a press answered to, or null for none. */
const noticeAt = async (env, location) => (await (await admin(env, 'GET', location, { origin: null })).text())
  .match(/<p role="status">([^<]*)<\/p>/)?.[1] ?? null;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const words = (html) => unescape(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Each figure's "Remove this photo" form on an album page: its action and its button. */
function removeForms(html) {
  return [...html.matchAll(/<figure>([\s\S]*?)<\/figure>/g)].map(([, fig]) => {
    const form = fig.match(/<form class="remove"[^>]*>/)?.[0];
    const button = fig.match(/<form class="remove"[^>]*><button\b([^>]*)>([^<]*)<\/button><\/form>/);
    return {
      action: form && attr(form, 'action'),
      method: form && attr(form, 'method'),
      type: button && attr(button[1], 'type'),
      name: button && attr(button[1], 'name'),
      value: button && attr(button[1], 'value'),
      label: button && attr(button[1], 'aria-label'),
      text: button?.[2],
    };
  });
}

// ---- Criterion 1: the control, the dialog, and the page without JavaScript --

test('every approved photo on an album page has "Remove this photo", a form posting its id to the confirmation page', async () => {
  const { env, fall } = await site();
  const ids = [seed(env, fall), seed(env, fall, { captured: T0 + 1 })];
  const html = await (await get(env, `/albums/${fall}/`)).text();
  const forms = removeForms(html);
  assert.equal(forms.length, 2);
  forms.forEach((f, i) => {
    assert.deepEqual(
      { action: f.action, method: f.method, type: f.type, name: f.name, value: f.value, text: f.text },
      { action: '/remove', method: 'post', type: 'submit', name: 'photo', value: String(ids[i]), text: 'Remove this photo' },
    );
    // The name starts with the words on the button (WCAG 2.5.3), and names
    // which photo, so a list of them can be told apart by ear.
    assert.equal(f.label, `Remove this photo: photo ${i + 1} of 2`);
  });
});

test('the album page carries one takedown dialog: its words, the note of 500 characters, Cancel first, and a confirm posting to /api/remove', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  const html = await (await get(env, `/albums/${fall}/`)).text();
  const dialog = block(html, 'dialog');
  assert.ok(dialog, 'no dialog on the album page');
  assert.equal(html.split('<dialog').length - 1, 1);
  assert.match(dialog, /^<dialog id="remove-dialog" class="confirm" aria-labelledby="remove-title">/);
  const form = dialog.match(/<form\b[^>]*>/)[0];
  assert.equal(attr(form, 'method'), 'post');
  assert.equal(attr(form, 'action'), '/api/remove');
  const text = words(dialog);
  assert.match(text, /^Remove this photo\?/);
  assert.match(text, /It will be hidden from everyone right away\./);
  assert.match(text, /One of the site's admins then reviews it, and either puts it back or deletes it for good\./);
  // The note: optional, labelled, 500 characters.
  const note = dialog.match(/<textarea\b[^>]*>/)[0];
  assert.equal(attr(note, 'name'), 'note');
  assert.equal(attr(note, 'maxlength'), String(NOTE_MAX));
  assert.equal(NOTE_MAX, 500);
  assert.doesNotMatch(note, /\srequired\b/);
  assert.match(dialog, new RegExp(`<label for="${attr(note, 'id')}">`));
  assert.match(text, /Up to 500 characters\. Only the site's admins read it\./);
  // Cancel first, taking the focus, closing without a post; then the confirm.
  const buttons = [...dialog.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(([, a, t]) => ({ a, t }));
  assert.deepEqual(buttons.map((b) => b.t), ['Cancel', 'Remove it']);
  assert.equal(attr(buttons[0].a, 'formmethod'), 'dialog');
  assert.match(buttons[0].a, /\sautofocus\b/);
  assert.equal(attr(buttons[1].a, 'type'), 'submit');
  assert.equal(attr(buttons[1].a, 'id'), 'remove-confirm');
  assert.equal(attr(buttons[1].a, 'name'), 'photo');
  assert.equal(attr(buttons[1].a, 'formaction'), null);
});

test('the list page carries no takedown dialog, and no "Remove this photo"', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  // The page's main: the template's head comment names the dialog.
  const main = block(await (await get(env, '/')).text(), 'main');
  assert.match(main, /album-row/, 'the control: the list shows the album');
  assert.doesNotMatch(main, /<dialog|Remove this photo/);
});

test('without JavaScript, the button opens a page that asks first: the same words, the photo, the note, and "Remove it", with nothing changed', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall, { caption: 'Start of race 2' });
  const before = tables(env);
  const res = await post(env, '/remove', { photo: String(id) }, { origin: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  const html = await res.text();
  const main = block(html, 'main');
  const text = words(main);
  assert.match(text, /Remove this photo\? It will be hidden from everyone right away\. One of the site's admins then reviews it, and either puts it back or deletes it for good\./);
  // The photo itself, so the reader sees which one, and the way back.
  assert.match(main, new RegExp(`<img src="/photos/${id}/grid" width="480" height="360" alt="Start of race 2">`));
  assert.match(main, new RegExp(`<a class="button button-quiet" href="/albums/${fall}/">Keep it</a>`));
  const form = main.match(/<form\b[^>]*>/)[0];
  assert.equal(attr(form, 'action'), '/api/remove');
  assert.equal(attr(form, 'method'), 'post');
  assert.match(main, new RegExp(`<textarea id="remove-note" name="note" rows="4" maxlength="${NOTE_MAX}"`));
  assert.match(main, new RegExp(`<button type="submit" class="button button-accent" name="photo" value="${id}">Remove it</button>`));
  // Asking changes nothing.
  assert.deepEqual(tables(env), before);
});

test('the page without JavaScript, followed through as a browser would: its "Remove it" takes the photo down with the note', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  seed(env, fall, { captured: T0 + 1 });
  // Album page → the photo's form → the confirmation page → its form.
  const album = await (await get(env, `/albums/${fall}/`)).text();
  const [first] = removeForms(album);
  const page = await (await post(env, first.action, { [first.name]: first.value }, { origin: null })).text();
  const button = page.match(/<button type="submit"[^>]*name="photo"[^>]*>/)[0];
  const action = attr(page.match(/<form method="post" action="[^"]*" class="remove-form">/)[0], 'action');
  const res = await post(env, action, { note: 'My son\'s face, please', [attr(button, 'name')]: attr(button, 'value') });
  assert.equal(res.status, 303);
  assert.equal(photoRow(env, id).state, 'hidden');
  assert.equal(photoRow(env, id).hidden_note, 'My son\'s face, please');
});

test('the confirmation page for a photo that is not public is the "isn\'t showing" page, 404, and says nothing about which', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  const pending = seed(env, fall, { state: 'pending' });
  const hidden = seed(env, fall, { state: 'hidden' });
  const clip = seedClip(env, fall);
  const bodies = new Set();
  for (const photo of [String(pending), String(hidden), String(clip), '999999', 'abc', undefined]) {
    const res = await post(env, '/remove', photo === undefined ? {} : { photo }, { origin: null });
    assert.equal(res.status, 404, String(photo));
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const html = await res.text();
    assert.match(words(block(html, 'main')), /That photo isn't showing/);
    bodies.add(html);
  }
  assert.equal(bodies.size, 1, 'every refusal is the same page');
  // A database that does not answer is a 503, not a 404.
  const res = await post({ ...env, DB: { prepare() { throw new Error('D1 down'); } } }, '/remove', { photo: '1' }, { origin: null });
  assert.equal(res.status, 503);
});

// ---- The script (public/js/remove.js) ----------------------------------------
//
// Run as the browser runs it, against hand-written stand-ins for the few DOM
// calls it makes, as test/queue.test.js runs the queue's script.

const SCRIPT = read('public', 'js', 'remove.js');

test('the script names only elements the album page carries', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  const html = await (await get(env, `/albums/${fall}/`)).text();
  const ids = [...SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['remove-dialog', 'remove-confirm', 'remove-note']);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `remove.js reaches for #${id}, which the page lacks`);
  for (const [, selector] of SCRIPT.matchAll(/querySelectorAll\('([^']+)'\)/g)) {
    assert.equal(selector, 'button.remove-open');
    assert.match(html, /<button [^>]*class="remove-open"/);
  }
});

function runScript({ dialog = true } = {}) {
  const el = (props = {}) => ({ value: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, ...props });
  const calls = [];
  const nodes = dialog
    ? {
      'remove-dialog': el({ showModal: () => calls.push('showModal'), show: () => calls.push('show') }),
      // Neither value the script writes, so a script that never wrote is seen.
      'remove-confirm': el({ value: 'stale id' }),
      'remove-note': el({ value: 'a note typed for another photo' }),
    }
    : {};
  const buttons = [el({ value: '12' }), el({ value: '13' })];
  const document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelectorAll: (selector) => {
      calls.push(`querySelectorAll ${selector}`);
      if (selector !== 'button.remove-open') throw new Error(`the script asked for ${selector}`);
      return buttons;
    },
  };
  vm.runInNewContext(SCRIPT, { document });
  const click = (button) => {
    let prevented = false;
    button.listeners.click?.({ preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { nodes, buttons, calls, click };
}

test('the script: "Remove this photo" opens the dialog as a modal instead of posting, for that photo, with the note cleared', () => {
  const s = runScript();
  assert.equal(s.click(s.buttons[1]), true, 'the press still posts the form to /remove');
  assert.deepEqual(s.calls.filter((c) => !c.startsWith('querySelectorAll')), ['showModal']);
  assert.equal(s.nodes['remove-confirm'].value, '13');
  assert.equal(s.nodes['remove-note'].value, '');
  s.nodes['remove-note'].value = 'typed, then cancelled';
  s.click(s.buttons[0]);
  assert.equal(s.nodes['remove-confirm'].value, '12');
  assert.equal(s.nodes['remove-note'].value, '');
});

test('the script: on a page without the dialog it stops before touching anything', () => {
  const s = runScript({ dialog: false });
  assert.deepEqual(s.calls, []);
  assert.equal(s.click(s.buttons[0]), false);
});

// ---- Criterion 2: a confirmed request hides the photo from the next request ---

test('a takedown hides the photo: its three image routes answer 404 on the next request, and its album page no longer lists it', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  const other = seed(env, fall, { captured: T0 + 1 });
  for (const size of ['grid', 'screen', 'full']) assert.equal((await get(env, `/photos/${id}/${size}`)).status, 200, `${size} before`);
  const before = nowSeconds();
  const res = await takedown(env, id, { note: 'Please take this one down' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `/albums/${fall}/?removed`);
  for (const size of ['grid', 'screen', 'full']) assert.equal((await get(env, `/photos/${id}/${size}`)).status, 404, size);
  const html = await (await get(env, `/albums/${fall}/`)).text();
  assert.doesNotMatch(html, new RegExp(`/photos/${id}/`));
  assert.match(html, new RegExp(`/photos/${other}/grid`), 'the album\'s other photo is still listed');
  // What the row keeps: hidden, when, the note; its objects stay in the bucket.
  const row = photoRow(env, id);
  assert.equal(row.state, 'hidden');
  assert.ok(row.hidden_at >= before && row.hidden_at <= nowSeconds() + 1, String(row.hidden_at));
  assert.equal(row.hidden_note, 'Please take this one down');
  for (const key of Object.values(photoObjectKeys(row.media_key))) assert.ok(env.MEDIA.objects.has(key), key);
});

test('the album page the takedown lands on says so; the same address without ?removed does not', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  seed(env, fall, { captured: T0 + 1 });
  const location = (await takedown(env, id)).headers.get('Location');
  const status = (html) => block(html, 'main').match(/<p role="status">([^<]*)<\/p>/)?.[1] ?? null;
  assert.equal(status(await (await get(env, location)).text()), REMOVED_NOTICE);
  assert.equal(status(await (await get(env, `/albums/${fall}/`)).text()), null);
  assert.equal(REMOVED_NOTICE, 'The photo is hidden from everyone. One of the site\'s admins will review it.');
});

test('taking down an album\'s last public photo lands on its team\'s section, which says so and no longer lists the album', async () => {
  const { env, fall, practice } = await site();
  const id = seed(env, fall);
  seed(env, practice);
  const res = await takedown(env, id);
  // The album's own team's list (#227), where the parent came from.
  assert.equal(res.headers.get('Location'), '/hoover-jrt/?removed');
  const html = await (await get(env, '/hoover-jrt/?removed')).text();
  assert.match(block(html, 'main'), new RegExp(`<p role="status">${REMOVED_NOTICE}</p>`));
  assert.doesNotMatch(html, new RegExp(`/albums/${fall}/`));
  assert.match(html, new RegExp(`/albums/${practice}/`));
  assert.equal((await get(env, `/albums/${fall}/`)).status, 404);
});

test('#227: a COHSSA album\'s last public photo lands on COHSSA\'s section, not on the first team\'s or the default\'s', async () => {
  // Hoover JRT is TEAMS[0] and 0010's default, so only a COHSSA album shows
  // that the redirect reads the album's own team (review-fanout at #227's
  // review: a redirect hard-coding Hoover JRT read 0 red without this).
  const { env, fall } = await site();
  const districts = await createAlbum(env.DB, { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' }, T0);
  const id = seed(env, districts);
  seed(env, fall);
  const res = await takedown(env, id);
  assert.equal(res.headers.get('Location'), '/cohssa/?removed');
  const html = await (await get(env, '/cohssa/?removed')).text();
  assert.match(block(html, 'main'), new RegExp(`<p role="status">${REMOVED_NOTICE}</p>`));
  assert.doesNotMatch(html, new RegExp(`/albums/${districts}/`));
  // The control: Hoover JRT's section still lists its album, without the notice.
  const hoover = await (await get(env, '/hoover-jrt/')).text();
  assert.match(hoover, new RegExp(`/albums/${fall}/`));
  assert.doesNotMatch(hoover, /role="status"/);
});

test('a note keeps its line breaks, turns other control characters into spaces, and stops at 500 characters', () => {
  assert.equal(readNote('  line one\r\nline two\rthree\tend  x  '), 'line one\nline two\nthree end  x');
  assert.equal(readNote('   \r\n\t '), null);
  assert.equal(readNote(undefined), null);
  const wave = String.fromCodePoint(0x1f30a);
  // Counted in characters, as 0005's CHECK counts them: an emoji is one.
  assert.equal([...readNote(wave.repeat(NOTE_MAX))].length, NOTE_MAX);
  assert.equal([...readNote(wave.repeat(NOTE_MAX + 7))].length, NOTE_MAX, 'a longer note is cut, not refused');
  assert.equal(readNote(`${'a'.repeat(NOTE_MAX - 1)} b`), 'a'.repeat(NOTE_MAX - 1), 'what the cut leaves is trimmed');
});

test('a note past 500 characters still takes the photo down, keeping its first 500, which the table\'s CHECK accepts', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  const res = await takedown(env, id, { note: 'n'.repeat(NOTE_MAX + 300) });
  assert.equal(res.status, 303);
  assert.equal(photoRow(env, id).hidden_note, 'n'.repeat(NOTE_MAX));
});

test('a note of 500 four-byte characters, past readForm\'s own 4 KiB, still takes the photo down with the whole note', async () => {
  // #158's review: the only long note sent through the route was ASCII, which
  // fits the default cap as well, so the route's own cap was never proved.
  const { env, fall } = await site();
  const id = seed(env, fall);
  const wave = String.fromCodePoint(0x1f30a);
  const body = new URLSearchParams({ photo: String(id), note: wave.repeat(NOTE_MAX) }).toString();
  assert.ok(body.length > 4096 && body.length < REMOVE_FORM_BYTES, `the body is ${body.length} bytes`);
  const res = await post(env, '/api/remove', null, { body });
  assert.equal(res.status, 303);
  assert.equal(photoRow(env, id).state, 'hidden');
  assert.equal([...photoRow(env, id).hidden_note].length, NOTE_MAX);
});

// ---- Criterion 3: 10 an hour from one address, then 429 ---------------------

test('the limit is 10 takedowns an hour (owner, at #158\'s pickup)', () => {
  assert.equal(REMOVAL_LIMIT, 10);
  assert.equal(REMOVAL_WINDOW_SECONDS, 60 * 60);
});

test('10 takedowns from one address in an hour: the 11th answers 429 with Retry-After, and changes nothing', async () => {
  const { env, fall } = await site();
  const ids = Array.from({ length: REMOVAL_LIMIT + 1 }, (_, i) => seed(env, fall, { captured: T0 + i }));
  for (const id of ids.slice(0, REMOVAL_LIMIT)) assert.equal((await takedown(env, id)).status, 303, `takedown of ${id}`);
  const before = tables(env);
  const res = await takedown(env, ids[REMOVAL_LIMIT]);
  assert.equal(res.status, 429);
  const retry = Number(res.headers.get('Retry-After'));
  assert.ok(retry > REMOVAL_WINDOW_SECONDS - 60 && retry <= REMOVAL_WINDOW_SECONDS, String(retry));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(words(block(await res.text(), 'main')), /at most 10 photos an hour from one network.*Try again in 60 minutes, or email dave@madcowsailing\.com/);
  assert.deepEqual(tables(env), before, 'the 11th changed something');
  assert.equal(photoRow(env, ids[REMOVAL_LIMIT]).state, 'approved');
  // The control: another address still takes it down.
  assert.equal((await takedown(env, ids[REMOVAL_LIMIT], { ip: '198.51.100.9' })).status, 303);
});

test('an address past the limit is 429 whatever it names, and no photo is read', async () => {
  // The limit is read first. Without that read, the claim statement would
  // still refuse an 11th takedown of a public photo, so only a request naming
  // nothing public tells the two orders apart: 429 here, 404 the other way.
  const { env, fall } = await site();
  const hash = base64url(await hmac(ADDRESS_KEY, IP));
  const insert = env.DB.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)');
  for (let i = 0; i < REMOVAL_LIMIT; i++) insert.run(hash, nowSeconds() - 60);
  const pending = seed(env, fall, { state: 'pending' });
  for (const photo of [999_999, pending]) {
    env.DB.statements.length = 0;
    assert.equal((await takedown(env, photo)).status, 429, String(photo));
    assert.ok(env.DB.statements.every((sql) => !/\bFROM photos\b|\bUPDATE photos\b/.test(sql)), env.DB.statements.join('\n'));
  }
  // The control: one fewer in the hour, and the same request is a 404.
  env.DB.sqlite.prepare('DELETE FROM removal_requests WHERE rowid = (SELECT MIN(rowid) FROM removal_requests)').run();
  assert.equal((await takedown(env, 999_999)).status, 404);
});

test('a takedown naming nothing public prepares no write at all, so a wrong id costs no D1 write', async () => {
  // Not only "nothing changed": a claim given straight back leaves the tables
  // as they were too, and still spends D1's daily writes.
  const { env, fall } = await site();
  const pending = seed(env, fall, { state: 'pending' });
  const hidden = seed(env, fall, { state: 'hidden' });
  const writes = /^\s*(INSERT|UPDATE|DELETE)\b/i;
  for (const photo of [pending, hidden, 999_999]) {
    env.DB.statements.length = 0;
    assert.equal((await takedown(env, photo)).status, 404);
    assert.deepEqual(env.DB.statements.filter((sql) => writes.test(sql)), [], `a takedown of ${photo} prepared a write`);
  }
  // The control: the matcher sees the writes a takedown does make.
  env.DB.statements.length = 0;
  assert.equal((await takedown(env, seed(env, fall))).status, 303);
  assert.ok(env.DB.statements.filter((sql) => writes.test(sql)).length >= 2, env.DB.statements.join('\n'));
});

test('only a takedown counts: requests naming nothing public, from the same address, spend none of its 10', async () => {
  const { env, fall } = await site();
  const pending = seed(env, fall, { state: 'pending' });
  for (let i = 0; i < REMOVAL_LIMIT * 2; i++) assert.equal((await takedown(env, i % 2 ? pending : 999_999)).status, 404);
  assert.deepEqual(removalRows(env), [], 'a refusal wrote a row');
  const ids = Array.from({ length: REMOVAL_LIMIT }, (_, i) => seed(env, fall, { captured: T0 + i }));
  for (const id of ids) assert.equal((await takedown(env, id)).status, 303);
  assert.equal(removalRows(env).length, REMOVAL_LIMIT);
});

test('the address is kept only as its keyed hash, an IPv6 address by its /64', async () => {
  const { env, fall } = await site();
  const ids = Array.from({ length: REMOVAL_LIMIT + 2 }, (_, i) => seed(env, fall, { captured: T0 + i }));
  await takedown(env, ids[0]);
  const [row] = removalRows(env);
  assert.equal(row.address_hash, base64url(await hmac(ADDRESS_KEY, IP)));
  assert.doesNotMatch(JSON.stringify(tables(env)), /203\.0\.113\.7/);
  // Two addresses in one /64 are one network: 10 between them, then 429.
  assert.equal(addressBlock('2001:db8:1:2::a'), addressBlock('2001:db8:1:2:ffff::1'));
  for (let i = 1; i <= REMOVAL_LIMIT; i++) {
    const ip = i % 2 ? '2001:db8:1:2::a' : '2001:db8:1:2:ffff::1';
    assert.equal((await takedown(env, ids[i], { ip })).status, 303, `takedown ${i}`);
  }
  // A third address in the same /64 is the 11th from that network.
  assert.equal((await takedown(env, ids[REMOVAL_LIMIT + 1], { ip: '2001:db8:1:2::beef' })).status, 429);
  // The control: the IPv4 address that took one down has nine left.
  assert.equal((await takedown(env, ids[REMOVAL_LIMIT + 1])).status, 303);
});

test('the block an address counts as: an IPv6 address\'s /64 written out in full, an IPv4 one whole, mapped or not, and none at all as one', () => {
  // test/join.test.js held these until #226 rewrote it with the join limit
  // gone; the limits here, at /ask, /sign-in and /forgot-password still read
  // them (lib/address.js).
  assert.equal(addressBlock('2001:DB8::1'), '2001:0db8:0000:0000');
  assert.equal(addressBlock('2001:db8:1:2:3:4:5:6'), '2001:0db8:0001:0002');
  assert.equal(addressBlock('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(addressBlock('192.0.2.1'), '192.0.2.1');
  assert.equal(addressBlock(null), 'unknown');
  assert.equal(addressBlock(''), 'unknown');
});

test('the window: takedowns over an hour old neither count nor stay, and the next takedown deletes them', async () => {
  const { env, fall } = await site();
  const hash = base64url(await hmac(ADDRESS_KEY, IP));
  const now = nowSeconds();
  const insert = env.DB.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)');
  // 10 an hour and a second ago, and 9 inside the hour.
  for (let i = 0; i < REMOVAL_LIMIT; i++) insert.run(hash, now - REMOVAL_WINDOW_SECONDS - 1);
  for (let i = 0; i < REMOVAL_LIMIT - 1; i++) insert.run(hash, now - 60);
  const id = seed(env, fall);
  assert.equal((await takedown(env, id)).status, 303, 'the old ten counted');
  assert.equal(removalRows(env).length, REMOVAL_LIMIT, 'the old ten stayed');
  assert.ok(removalRows(env).every((r) => r.requested_at > now - REMOVAL_WINDOW_SECONDS));
  // And now the hour holds 10, so the next is refused.
  assert.equal((await takedown(env, seed(env, fall, { captured: T0 + 1 }))).status, 429);
});

test('a refusal never tidies the log: rows over an hour old stay until a takedown', async () => {
  const { env } = await site();
  env.DB.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)').run('x', nowSeconds() - 2 * REMOVAL_WINDOW_SECONDS);
  assert.equal((await takedown(env, 999_999)).status, 404);
  assert.equal(removalRows(env).length, 1);
});

test('two takedowns at once from an address with one left: exactly one hides its photo', async () => {
  // Called on the library, not the route: through the whole request chain
  // each request runs start to end before the other begins, so a race never
  // interleaves there (cairn: a-race-test-through-the-request-chain-never-interleaves).
  const { env, fall } = await site();
  const now = T0 + 10_000;
  const insert = env.DB.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)');
  for (let i = 0; i < REMOVAL_LIMIT - 1; i++) insert.run('h', now - 60);
  const [a, b] = [seed(env, fall), seed(env, fall, { captured: T0 + 1 })];
  const results = await Promise.all([a, b].map((id) => requestRemoval(env.DB, { id, note: null, address: 'h', now })));
  assert.deepEqual(results.map((r) => r.outcome).sort(), ['hidden', 'limited']);
  assert.equal(removalRows(env).length, REMOVAL_LIMIT);
  assert.deepEqual([photoRow(env, a).state, photoRow(env, b).state].sort(), ['approved', 'hidden']);
});

test('two takedowns of one photo at once: one hides it, the other is 404 and gives its unit back', async () => {
  const { env, fall } = await site();
  const now = T0 + 10_000;
  const id = seed(env, fall);
  const results = await Promise.all([1, 2].map(() => requestRemoval(env.DB, { id, note: null, address: 'h', now })));
  assert.deepEqual(results.map((r) => r.outcome).sort(), ['gone', 'hidden']);
  assert.equal(removalRows(env).length, 1, 'the losing takedown kept its unit');
});

test('Retry-After counts from the oldest takedown in the hour, not the newest, nor a flat hour', async () => {
  // #158's review: every fixture reading Retry-After took its ten in one
  // second, so MIN, MAX and a flat 3,600 all passed.
  const { env, fall } = await site();
  const hash = base64url(await hmac(ADDRESS_KEY, IP));
  const now = nowSeconds();
  const insert = env.DB.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)');
  insert.run(hash, now - REMOVAL_WINDOW_SECONDS + 60); // the oldest: a minute left in its hour
  for (let i = 0; i < REMOVAL_LIMIT - 1; i++) insert.run(hash, now - 60);
  const res = await takedown(env, seed(env, fall));
  assert.equal(res.status, 429);
  const retry = Number(res.headers.get('Retry-After'));
  assert.ok(retry >= 55 && retry <= 60, `Retry-After ${retry}`);
  assert.match(words(block(await res.text(), 'main')), /Try again in a minute,/);
});

test('once the photo is hidden the answer is 303, even when reading its album fails: to /, and the log says it is hidden', async (t) => {
  // #158's review: this failure answered 503 "Nothing was changed" for a
  // photo that was hidden, with its unit spent. With no album read, there is
  // no team to send the browser to, so it lands on / (#227).
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const { env, fall } = await site();
  const id = seed(env, fall);
  seed(env, fall, { captured: T0 + 1 });
  const res = await takedown({ ...env, DB: failOn(env.DB, /^SELECT a\.address, a\.team, EXISTS/) }, id);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/?removed');
  assert.equal(photoRow(env, id).state, 'hidden');
  assert.equal(removalRows(env).length, 1, 'the takedown hid a photo, so it keeps its unit');
  assert.deepEqual(logged, [`remove: photo ${id} is hidden, but its album could not be read: transient D1 error`]);
});

test('a hide that throws gives its unit back: 503, the photo still public, and nothing kept', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  const id = seed(env, fall);
  const res = await takedown({ ...env, DB: failOn(env.DB, /^UPDATE photos SET state = 'hidden'/) }, id);
  assert.equal(res.status, 503);
  assert.match(words(block(await res.text(), 'main')), /Nothing was changed\./);
  assert.equal(photoRow(env, id).state, 'approved');
  assert.deepEqual(removalRows(env), [], 'a takedown that hid nothing kept its unit');
});

test('a give-back that fails too is logged, and the answer stays the true one', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const { env, fall } = await site();
  const id = seed(env, fall);
  const db = failOn(env.DB, /^UPDATE photos SET state = 'hidden'|^DELETE FROM removal_requests WHERE rowid/);
  const res = await takedown({ ...env, DB: db }, id);
  assert.equal(res.status, 503, 'the photo is still public, so "Nothing was changed" is true');
  assert.equal(photoRow(env, id).state, 'approved');
  assert.equal(removalRows(env).length, 1, 'the unit could not be given back');
  assert.ok(logged.some((line) => line.startsWith('remove: could not give back a takedown that hid nothing:')), logged.join('\n'));
});

// ---- Criterion 4: what is refused, and that nothing changes ----------------

test('a takedown naming a pending, hidden or unknown photo answers 404, and nothing changes', async () => {
  const { env, fall } = await site();
  const pending = seed(env, fall, { state: 'pending' });
  const hidden = seed(env, fall, { state: 'hidden', note: 'the first note' });
  const approved = seed(env, fall);
  const clip = seedClip(env, fall);
  const before = tables(env);
  const bodies = new Set();
  for (const [name, photo] of [['pending', pending], ['hidden', hidden], ['unknown', 999_999], ['a clip', clip], ['not an id', 'abc'], ['none', '']]) {
    const res = await post(env, '/api/remove', { photo: String(photo), note: 'x' });
    assert.equal(res.status, 404, name);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', name);
    bodies.add(await res.text());
    assert.deepEqual(tables(env), before, `${name} changed something`);
  }
  assert.equal(bodies.size, 1, 'the 404s differ, so a page says which state a photo is in');
  assert.match(words(block([...bodies][0], 'main')), /That photo isn't showing It may already have been taken down, or it was never public\. Nothing was changed\./);
  // The control: the same request for an approved photo takes it down.
  assert.equal((await takedown(env, approved)).status, 303);
});

test('a takedown carrying a foreign Origin, or none, answers 403 and changes nothing', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  const before = tables(env);
  for (const origin of [null, 'https://evil.example', 'https://madcowsailing.com', 'http://photos.madcowsailing.com']) {
    const res = await takedown(env, id, { origin });
    assert.equal(res.status, 403, String(origin));
    assert.deepEqual(await res.json(), { error: 'origin' });
    assert.deepEqual(tables(env), before, `${origin} changed something`);
  }
  assert.equal((await takedown(env, id)).status, 303, 'the site\'s own Origin takes it down');
});

test('a missing database or address key, or a database that does not answer, is a 503 that takes nothing down', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  for (const missing of ['DB', 'ADDRESS_HASH_KEY']) {
    const { env, fall } = await site();
    const id = seed(env, fall);
    const res = await takedown({ ...env, [missing]: undefined }, id);
    assert.equal(res.status, 503, missing);
    assert.match(words(block(await res.text(), 'main')), /Photos can't be taken down right now Nothing was changed\./);
    assert.equal(photoRow(env, id).state, 'approved');
  }
  const { env } = await site();
  const res = await takedown({ ...env, DB: { prepare() { throw new Error('D1 down'); } } }, 1);
  assert.equal(res.status, 503);
  assert.ok(logged.every((line) => !line.includes(ADDRESS_KEY) && !line.includes(IP)), logged.join('\n'));
});

// ---- Criterion 5: /admin/removals ---------------------------------------------

test('/admin/removals lists the hidden photos and, since #310, the hidden clips, the oldest takedown first, each with its album, when it was hidden and its note', async () => {
  const { env, fall, practice } = await site();
  seed(env, fall);
  seed(env, fall, { state: 'pending' });
  // The later-made photo was taken down first, so the order is the
  // takedowns', not the ids' (#158's review: seed() once hid them in id order,
  // and ORDER BY id read the same).
  const second = seed(env, fall, { state: 'hidden', hiddenAt: T0 + 900 });
  const first = seed(env, practice, { state: 'hidden', note: 'Taken at my request', hiddenAt: T0 + 300 });
  assert.ok(first > second, 'the control: the first takedown has the higher id');
  // With no clip hidden the summary reads as it did before clips (#198's
  // rule for counts), and says nothing of putting a clip back.
  const photosOnly = await removals(env);
  assert.deepEqual(hiddenIds(photosOnly), [first, second]);
  assert.match(photosOnly, /<p>2 photos are hidden, the oldest takedown first\. Putting a photo back makes it public again, or returns it to the queue if it was hidden before anyone approved it\. Deleting it removes it and all three of its sizes for good\.<\/p>/);
  assert.doesNotMatch(photosOnly, /A clip put back|Clip \d/);
  assert.match(photosOnly, /<section class="wrap" aria-label="Hidden photos">/);
  // A clip "Hide all" took down (#310, criterion 4) joins the one list in its
  // takedown's place, between the two, the latest-made row of the three.
  const clip = seedClip(env, fall, { state: 'hidden', hiddenAt: T0 + 600 });
  const html = await removals(env);
  const items = [...html.matchAll(/<li class="removal" id="photo-(\d+)">([\s\S]*?)<\/li>/g)];
  assert.deepEqual(items.map((m) => Number(m[1])), [first, clip, second]);
  const [one, , two] = items.map((m) => m[2]);
  assert.match(one, /<p class="removal-facts">In Tuesday practice · Hoover JRT · hidden <time datetime="[^"]+">/);
  const hiddenAt = photoRow(env, first).hidden_at;
  assert.match(one, new RegExp(`<time datetime="${new Date(hiddenAt * 1000).toISOString()}">`));
  assert.match(one, /<p class="removal-note">Taken at my request<\/p>/);
  assert.match(two, /<p class="removal-facts">In Fall Regatta ·/);
  assert.match(two, /No note was left\./);
  // The picture comes through the admin image route, which serves a hidden photo.
  assert.match(one, new RegExp(`<img src="/api/admin/photos/${first}/grid"`));
  const image = await admin(env, 'GET', `/api/admin/photos/${first}/grid`, { origin: null });
  assert.equal(image.status, 200);
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), OBJECTS.grid);
  // The summary counts each kind (owner, at #198's pickup), with the clip,
  // and the list's name says what it holds, as its rows do.
  assert.match(html, /2 photos and 1 clip are hidden, the oldest takedown first\./);
  assert.match(html, /<section class="wrap" aria-label="Hidden photos and clips">/);
  // With only clips hidden it names clips alone.
  const clipsOnly = adminRemovalsPage({ photos: (await hiddenPhotos(env.DB)).filter((row) => row.kind === 'clip') });
  assert.match(clipsOnly, /<section class="wrap" aria-label="Hidden clips">/);
});

test('#310: a hidden clip\'s row is "Clip <id>", its album, when it was hidden, its length and frame size and who sent it, and a player through the admin clip route that loads nothing until Play (#310, criterion 4)', async () => {
  const { env, fall } = await site();
  env.DB.sqlite.prepare("INSERT INTO accounts (id, email, name, role, requested_at) VALUES (2, 'pat@example.org', 'Pat Parent', 'parent', 1)").run();
  // Hidden while approved, from an account; and hidden while it still
  // waited, sent by a coach no account names (before #226, or since deleted).
  const clip = seedClip(env, fall, { state: 'hidden', durationMs: 61_001, width: 1080, height: 1920 });
  env.DB.sqlite.prepare('UPDATE photos SET account_id = 2, code_generation = 0, session_issued = 0 WHERE id = ?').run(clip);
  const held = seedClip(env, fall, { state: 'hidden', waiting: true, sender: 'coach' });
  const photo = seed(env, fall, { state: 'hidden' });
  const html = await removals(env);
  const row = (id) => html.match(new RegExp(`<li class="removal" id="photo-${id}">([\\s\\S]*?)</li>`))?.[1];
  const facts = (r) => r.match(/<p class="removal-facts">([\s\S]*?)<\/p>/)[1].replace(/<time datetime="[^"]+">[^<]*<\/time>/, 'T');
  const c = row(clip);
  assert.match(c, new RegExp(`^\\s*<h2>Clip ${clip}</h2>`));
  // How long it runs (m:ss, rounded up) and its frame size, as its queue card
  // says them, then who sent it, which ends the line as it does a photo's.
  assert.equal(facts(c), 'In Fall Regatta · Hoover JRT · hidden T · 1:02 long · 1080 × 1920 · sent by Pat Parent');
  assert.equal(facts(row(held)), 'In Fall Regatta · Hoover JRT · hidden T · 0:30 long · 1920 × 1080 · sent by a coach · was waiting for approval, so putting it back returns it to the queue');
  // The player, as the queue's (test/queue.test.js): the admin clip route,
  // and nothing loaded until Play. The link inside is for a browser with no
  // video element. Its size is a photo row's (the owner's choice at #310's
  // review): the frame scaled to a grid image's 480 px long edge, so this
  // portrait clip is 270 x 480, where a cap on width alone left it 480 x 853.
  const [, attrs, inside] = c.match(/<div class="removal-clip">\s*<video\b([^>]*)>([\s\S]*?)<\/video>\s*<\/div>/);
  assert.match(attrs, /^ controls /);
  assert.deepEqual(['preload', 'width', 'height', 'src'].map((name) => attr(attrs, name)), ['none', '270', '480', `/api/admin/clips/${clip}`]);
  const heldAttrs = row(held).match(/<video\b([^>]*)>/)[1];
  assert.deepEqual(['width', 'height'].map((name) => attr(heldAttrs, name)), ['480', '270'], 'a landscape clip, 1920 x 1080');
  // Never past its frame: a clip smaller than a grid image keeps its size,
  // and a square one fills the long edge both ways.
  assert.deepEqual(clipBox({ width: 320, height: 240 }), { width: 320, height: 240 });
  assert.deepEqual(clipBox({ width: 1000, height: 1000 }), { width: 480, height: 480 });
  assert.deepEqual(clipBox({ width: 720, height: 1280 }), { width: 270, height: 480 });
  assert.doesNotMatch(attrs, /autoplay|poster/);
  assert.equal(inside, `<a href="/api/admin/clips/${clip}">Open clip ${clip}</a>`);
  assert.doesNotMatch(c, /<img\b|\/api\/admin\/photos\//, 'a clip\'s row shows a picture');
  // The route the player asks plays it while it is hidden: this clip, whole.
  const played = await admin(env, 'GET', `/api/admin/clips/${clip}`, { origin: null });
  assert.equal(played.status, 200);
  assert.deepEqual(new Uint8Array(await played.arrayBuffer()), CLIP);
  // Its presses are a photo's by name and value, so each takes the clip as it
  // takes a photo; each is named for a clip, and Delete permanently tells the
  // dialog which kind it opens for.
  const buttons = (r) => [...r.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)]
    .map(([, a, text]) => [text, attr(a, 'name'), attr(a, 'value') ?? attr(a, 'data-delete'), attr(a, 'data-kind'), attr(a, 'aria-label')]);
  assert.deepEqual(buttons(c), [
    ['Put it back', 'photo', String(clip), null, `Put it back: clip ${clip}`],
    ['Delete permanently', null, String(clip), 'clip', `Delete permanently: clip ${clip}`],
  ]);
  // The control: the photo beside it keeps a photo's row, picture and buttons.
  const p = row(photo);
  assert.match(p, new RegExp(`^\\s*<h2>Photo ${photo}</h2>`));
  assert.match(p, new RegExp(`<a class="removal-picture" href="/api/admin/photos/${photo}/screen"><img src="/api/admin/photos/${photo}/grid" width="480" height="360" alt="Photo ${photo}, hidden" loading="lazy"></a>`));
  assert.doesNotMatch(p, /<video|removal-clip| long · /);
  assert.deepEqual(buttons(p), [
    ['Put it back', 'photo', String(photo), null, `Put it back: photo ${photo}`],
    ['Delete permanently', null, String(photo), null, `Delete permanently: photo ${photo}`],
  ]);
  // The summary counts each kind, and says what putting a clip back and
  // deleting one do, which differ from a photo's.
  const text = words(block(html, 'main'));
  assert.match(text, /1 photo and 2 clips are hidden, the oldest takedown first\./);
  assert.match(text, /A clip put back is approved again, kept but not shown on the site yet, or returns to the queue the same way\. Deleting a clip removes its file for good\./);
});

test('#310: a hidden photo or clip whose coach\'s account is gone says a coach sent it, as the queue does; a parent\'s says nothing (the owner\'s choice at #310\'s pickup)', async () => {
  const { env, fall } = await site();
  env.DB.sqlite.prepare("INSERT INTO accounts (id, email, name, role, requested_at) VALUES (3, 'casey@example.org', 'Casey Coach', 'coach', 1)").run();
  const coachPhoto = seed(env, fall, { state: 'hidden' });
  const coachClip = seedClip(env, fall, { state: 'hidden', sender: 'coach' });
  const parentPhoto = seed(env, fall, { state: 'hidden' });
  const parentClip = seedClip(env, fall, { state: 'hidden' });
  env.DB.sqlite.prepare("UPDATE photos SET sender = 'coach', account_id = 3, code_generation = 0, session_issued = 0 WHERE id IN (?, ?)").run(coachPhoto, coachClip);
  const facts = async (id) => (await removals(env)).match(new RegExp(`<li class="removal" id="photo-${id}">[\\s\\S]*?<p class="removal-facts">([\\s\\S]*?)</p>`))?.[1];
  // While the account stands, it is named, not "a coach".
  assert.match(await facts(coachPhoto), /· sent by Casey Coach$/);
  assert.match(await facts(coachClip), / long · 1920 × 1080 · sent by Casey Coach$/);
  // Deleted, its rows stay and no longer name it (/policy, #219); the role
  // the row was sent under still says a coach sent it. Until #310 the list
  // never read it, so a hidden photo said nothing.
  env.DB.sqlite.prepare('DELETE FROM accounts WHERE id = 3').run();
  assert.equal(photoRow(env, coachPhoto).account_id, null);
  assert.match(await facts(coachPhoto), /· sent by a coach$/);
  assert.match(await facts(coachClip), / long · 1920 × 1080 · sent by a coach$/);
  // The control: a parent's row that no account names says nothing.
  assert.doesNotMatch(await facts(parentPhoto), /sent by/);
  assert.doesNotMatch(await facts(parentClip), /sent by/);
});

test('a note and an album title holding markup are shown as text, line breaks kept as text', async () => {
  const { env } = await site();
  const address = await createAlbum(env.DB, { team: 'hoover-jrt', title: '<b>Bold</b> & "regatta"', kind: 'regatta', date: '2026-10-11' }, T0);
  seed(env, address, { state: 'hidden', note: '<img src=x onerror=alert(1)>\nsecond line' });
  const html = await removals(env);
  assert.match(html, /In &lt;b&gt;Bold&lt;\/b&gt; &amp; &quot;regatta&quot; ·/);
  assert.match(html, /<p class="removal-note">&lt;img src=x onerror=alert\(1\)&gt;\nsecond line<\/p>/);
  assert.doesNotMatch(html, /<img src=x|<b>Bold/);
  // The stylesheet is what keeps the line break.
  assert.match(read('public', 'css', 'site.css'), /\.removal-note \{[^}]*white-space: pre-line;/);
});

test('with nothing hidden, the page says so and lists nothing', async () => {
  const { env, fall } = await site();
  seed(env, fall);
  const html = await removals(env);
  assert.match(html, /No photo is hidden\. A photo someone takes down with "Remove this photo" appears here\./);
  assert.doesNotMatch(html, /class="removal"/);
});

// ---- #227: the removals page filters by team --------------------------------

/** The team filter's links: [href, name, current]. The site header has a nav of its own. */
const filterLinks = (html) => [...html.match(/<nav class="team-filter"[\s\S]*?<\/nav>/)[0].matchAll(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)]
  .map(([, href, current, name]) => [href, name, Boolean(current)]);
const hiddenIds = (html) => [...html.matchAll(/<li class="removal" id="photo-(\d+)">/g)].map((m) => Number(m[1]));

/**
 * Submit the form holding `marker` on the page `html` as a browser does:
 * every input in it, plus the pressed button's name and `value`.
 */
function submit(env, html, marker, value) {
  const form = [...html.matchAll(/<form method="post" action="([^"]+)">([\s\S]*?)<\/form>/g)].find(([, , inner]) => inner.includes(marker));
  assert.ok(form, `no form holding ${marker}`);
  const fields = [...form[2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(([, n, v]) => [n, v]);
  fields.push(['photo', String(value)]);
  return admin(env, 'POST', form[1], { body: new URLSearchParams(fields).toString() });
}

test('#227: ?team= shows that team\'s hidden photos only, the filter marks it, and an unknown team shows every team\'s', async () => {
  const { env, fall } = await site();
  const districts = await createAlbum(env.DB, { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' }, T0);
  const h = seed(env, fall, { state: 'hidden', hiddenAt: T0 + 100 });
  const c = seed(env, districts, { state: 'hidden', hiddenAt: T0 + 200 });
  const at = async (query) => (await admin(env, 'GET', `/admin/removals${query}`, { origin: null })).text();
  const all = await at('');
  assert.deepEqual(hiddenIds(all), [h, c]);
  assert.deepEqual(filterLinks(all), [
    ['/admin/removals', 'All teams', true], ['/admin/removals?team=hoover-jrt', 'Hoover JRT', false], ['/admin/removals?team=cohssa', 'COHSSA', false],
  ]);
  const cohssa = await at('?team=cohssa');
  assert.deepEqual(hiddenIds(cohssa), [c]);
  assert.match(cohssa, /1 photo from COHSSA is hidden, the oldest takedown first\./);
  assert.match(cohssa, /<p class="removal-facts">In Districts · COHSSA · hidden /);
  assert.deepEqual(filterLinks(cohssa).map(([, name, current]) => [name, current]), [['All teams', false], ['Hoover JRT', false], ['COHSSA', true]]);
  assert.deepEqual(hiddenIds(await at('?team=hoover-jrt')), [h]);
  // Anything else in ?team= is every team, read while both teams have a
  // photo hidden, so every team and one team cannot read alike
  // (review-fanout at #227's review).
  for (const query of ['?team=boston', '?team=Hoover%20JRT', '?team=']) {
    const html = await at(query);
    assert.deepEqual(hiddenIds(html), [h, c], query);
    assert.equal(filterLinks(html)[0][2], true, query);
    assert.doesNotMatch(html, /action="[^"]*\?team=/, query);
  }
  env.DB.sqlite.prepare("UPDATE photos SET state = 'approved' WHERE id = ?").run(h);
  assert.match(await at('?team=hoover-jrt'), /No photo from Hoover JRT is hidden\./);
});

test('#227: "Put it back" and "Delete permanently" on a filtered page land back on the same team', async () => {
  const { env } = await site();
  const districts = await createAlbum(env.DB, { team: 'cohssa', title: 'Districts', kind: 'regatta', date: '2026-10-05' }, T0);
  const [a, b] = [seed(env, districts, { state: 'hidden' }), seed(env, districts, { state: 'hidden' })];
  const at = async (query) => (await admin(env, 'GET', `/admin/removals${query}`, { origin: null })).text();
  const filtered = await at('?team=cohssa');
  // Both forms post with the team in their address, and carry no field for it.
  assert.deepEqual([...filtered.matchAll(/<form method="post" action="([^"]+)">/g)].map((m) => m[1]),
    ['/api/admin/removals/restore?team=cohssa', '/api/admin/removals/restore?team=cohssa', '/api/admin/removals/delete?team=cohssa']);
  assert.doesNotMatch(filtered, /name="team"/);
  const back = await submit(env, filtered, `value="${a}" aria-label="Put it back`, a);
  assert.equal(back.headers.get('Location'), `/admin/removals?done=restored&photo=${a}&team=cohssa`);
  const del = await submit(env, block(await at('?team=cohssa'), 'dialog'), 'id="delete-confirm"', b);
  assert.equal(del.headers.get('Location'), `/admin/removals?done=deleted&photo=${b}&team=cohssa`);
  assert.equal(photoRow(env, b), undefined);
  // A refused press keeps it; a team the site does not have is dropped, and
  // one in the body is not read.
  const refused = await admin(env, 'POST', '/api/admin/removals/restore?team=cohssa', { body: 'photo=x' });
  assert.equal(refused.headers.get('Location'), '/admin/removals?error=form&team=cohssa');
  const crafted = await admin(env, 'POST', `/api/admin/removals/delete?team=${encodeURIComponent('"><b>')}`, { body: 'photo=x&team=cohssa' });
  assert.equal(crafted.headers.get('Location'), '/admin/removals?error=form');
  // A press that arrives as a GET, after the sign-in ran out, keeps its team too.
  for (const path of ['/api/admin/removals/restore', '/api/admin/removals/delete']) {
    assert.equal((await admin(env, 'GET', `${path}?team=cohssa`, { origin: null })).headers.get('Location'), '/admin/removals?error=unchanged&team=cohssa', path);
  }
});

/** The removals page's presses, as a browser submits them. */
async function restore(env, id) {
  const html = await removals(env);
  const button = html.match(new RegExp(`<form method="post" action="([^"]+)">\\s*<button type="submit" class="button" name="photo" value="${id}"[^>]*>Put it back</button>`));
  assert.ok(button, `no Put it back for photo ${id}`);
  return admin(env, 'POST', button[1], { body: new URLSearchParams({ photo: String(id) }).toString() });
}

async function remove(env, id) {
  const html = await removals(env);
  const opener = html.match(new RegExp(`<button type="button" class="button button-quiet" data-delete="${id}"[^>]*>Delete permanently</button>`));
  assert.ok(opener, `no Delete permanently for photo ${id}`);
  const dialog = block(html, 'dialog');
  const form = dialog.match(/<form method="post" action="([^"]+)">/);
  const confirm = dialog.match(/<button type="submit" class="button button-accent" id="delete-confirm" name="([^"]+)" value="">Delete<\/button>/);
  assert.ok(form && confirm, 'the dialog has no confirm posting the photo');
  return admin(env, 'POST', form[1], { body: new URLSearchParams({ [confirm[1]]: String(id) }).toString() });
}

/**
 * Every list of keys the bucket is asked to delete from now on, in order.
 * The stand-in records no delete, and deleting a key it does not hold is
 * silent (test/r2.js), so a delete asking for more than it should reads the
 * same in the bucket afterwards unless a test records what it asked.
 */
function deletesAsked(env) {
  const asked = [];
  const original = env.MEDIA.delete;
  env.MEDIA.delete = async (keys) => {
    asked.push([keys].flat());
    return original(keys);
  };
  return asked;
}

test('"Put it back" makes the photo approved and public again, keeping when it was hidden and the note (owner, at pickup)', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall);
  await takedown(env, id, { note: 'wrong photo, sorry' });
  const hidden = photoRow(env, id);
  const res = await restore(env, id);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `/admin/removals?done=restored&photo=${id}`);
  const row = photoRow(env, id);
  assert.equal(row.state, 'approved');
  assert.equal(row.hidden_at, hidden.hidden_at);
  assert.equal(row.hidden_note, 'wrong photo, sorry');
  assert.equal(row.approved_at, hidden.approved_at, 'the first approval is not moved');
  assert.equal((await get(env, `/photos/${id}/grid`)).status, 200);
  assert.match(await (await get(env, `/albums/${fall}/`)).text(), new RegExp(`/photos/${id}/grid`));
  assert.doesNotMatch(await removals(env), new RegExp(`id="photo-${id}"`));
  // A later takedown writes its own time and note over them.
  await takedown(env, id);
  assert.equal(photoRow(env, id).hidden_note, null);
});

test('#310: "Put it back" returns a clip hidden while approved to approved, kept but not public, and one hidden while waiting to the queue, and each notice names a clip (#310, criterion 4)', async () => {
  const { env, fall } = await site();
  const approved = seedClip(env, fall, { state: 'hidden' });
  const waiting = seedClip(env, fall, { state: 'hidden', waiting: true });
  const hidden = photoRow(env, approved);
  const res = await restore(env, approved);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `/admin/removals?done=restored&clip=${approved}`);
  const row = photoRow(env, approved);
  assert.equal(row.state, 'approved');
  assert.equal(row.approved_at, hidden.approved_at, 'the first approval is not moved');
  assert.equal(row.hidden_at, hidden.hidden_at, 'when it was hidden stays on the row, as a photo\'s does');
  // Approved, not public: nothing public shows a clip until #286, so the
  // notice says so rather than a photo's "public again".
  assert.equal(await noticeAt(env, res.headers.get('Location')), `Put clip ${approved} back. It is approved again, kept but not shown on the site yet.`);
  // Hidden while it waited: back in the queue, waiting, with no approval
  // time, as restorePhoto returns a photo hidden so.
  const queued = await restore(env, waiting);
  assert.equal(queued.headers.get('Location'), `/admin/removals?done=queued&clip=${waiting}`);
  assert.deepEqual([photoRow(env, waiting).state, photoRow(env, waiting).approved_at], ['pending', null]);
  assert.deepEqual((await waitingBatches(env.DB)).flatMap((batch) => batch.photos).map((p) => [p.id, p.kind]), [[waiting, 'clip']]);
  assert.equal(await noticeAt(env, queued.headers.get('Location')), `Put clip ${waiting} back in the queue. It was waiting for approval when it was hidden, so it waits for an admin again.`);
  // Neither waits here any more.
  assert.deepEqual(hiddenIds(await removals(env)), []);
});

test('"Delete permanently", confirmed in the dialog, removes the row and all three stored objects, and reading the storage back finds none', async () => {
  const { env, fall } = await site();
  const id = seed(env, fall, { state: 'hidden' });
  const other = seed(env, fall, { state: 'hidden' });
  const mediaKey = photoRow(env, id).media_key;
  const keys = Object.values(photoObjectKeys(mediaKey));
  // #310: since a delete reaches clips too, a decoy where a clip of the
  // photo's media key would be, which a photo's delete must not take.
  env.MEDIA.objects.set(clipObjectKey(mediaKey), { body: CLIP, httpMetadata: { contentType: 'video/mp4' } });
  const asked = deletesAsked(env);
  const res = await remove(env, id);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `/admin/removals?done=deleted&photo=${id}`);
  assert.equal(photoRow(env, id), undefined);
  for (const key of keys) assert.equal(await env.MEDIA.get(key), null, key);
  assert.deepEqual(asked, [keys], 'the bucket is asked for the photo\'s three sizes, and nothing else');
  assert.ok(env.MEDIA.objects.has(clipObjectKey(mediaKey)), 'a photo\'s delete took a clip\'s key');
  assert.equal((await admin(env, 'GET', `/api/admin/photos/${id}/grid`, { origin: null })).status, 404);
  // The other hidden photo keeps its row and its objects.
  for (const key of Object.values(photoObjectKeys(photoRow(env, other).media_key))) assert.ok(env.MEDIA.objects.has(key), key);
});

test('#310: "Delete permanently" on a hidden clip removes its row and its one object, asks the bucket for that key alone, and touches no photo\'s (#310, criterion 5)', async () => {
  const { env, fall } = await site();
  const clip = seedClip(env, fall, { state: 'hidden', waiting: true });
  const other = seed(env, fall, { state: 'hidden' });
  const mediaKey = photoRow(env, clip).media_key;
  const key = clipObjectKey(mediaKey);
  // Decoys where a photo's three sizes would be under the clip's media key:
  // a delete taking a photo's keys for a clip too would take them, and the
  // stand-in deletes a key it does not hold without a word.
  const decoys = Object.values(photoObjectKeys(mediaKey));
  for (const decoy of decoys) env.MEDIA.objects.set(decoy, { body: OBJECTS.grid, httpMetadata: { contentType: 'image/jpeg' } });
  const others = Object.values(photoObjectKeys(photoRow(env, other).media_key));
  // Read before the press: the object is there and plays, so its absence
  // after is the delete's.
  assert.deepEqual(env.MEDIA.objects.get(key).body, CLIP);
  assert.equal((await admin(env, 'GET', `/api/admin/clips/${clip}`, { origin: null })).status, 200);
  const asked = deletesAsked(env);
  const res = await remove(env, clip);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `/admin/removals?done=deleted&clip=${clip}`);
  assert.equal(photoRow(env, clip), undefined);
  assert.deepEqual(asked, [[key]], 'the bucket is asked for the clip\'s one object, and nothing else');
  assert.equal(await env.MEDIA.get(key), null);
  assert.equal((await admin(env, 'GET', `/api/admin/clips/${clip}`, { origin: null })).status, 404);
  for (const decoy of decoys) assert.ok(env.MEDIA.objects.has(decoy), decoy);
  // The control: the other hidden photo keeps its row and its three objects.
  assert.equal(photoRow(env, other).state, 'hidden');
  for (const k of others) assert.ok(env.MEDIA.objects.has(k), k);
  assert.equal(await noticeAt(env, res.headers.get('Location')), `Deleted clip ${clip}.`);
});

test('"Delete permanently" is a plain button that posts nothing; the dialog\'s confirm is the only way to delete', async () => {
  const { env, fall } = await site();
  seed(env, fall, { state: 'hidden' });
  const html = await removals(env);
  const main = block(html, 'main');
  const outside = main.replace(block(main, 'dialog'), '');
  assert.doesNotMatch(outside, /action="\/api\/admin\/removals\/delete"/);
  const dialog = block(main, 'dialog');
  const buttons = [...dialog.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(([, a, t]) => ({ a, t }));
  assert.deepEqual(buttons.map((b) => b.t), ['Cancel', 'Delete']);
  assert.equal(attr(buttons[0].a, 'formmethod'), 'dialog');
  assert.match(buttons[0].a, /\sautofocus\b/);
  assert.match(words(dialog), /deleted for good, with all three of its sizes\. This cannot be undone\./);
  // #310: the words sit in their own element, a photo's as the page writes
  // them, so the script can give a clip its own and a photo these back.
  assert.match(dialog, /<p id="delete-text">The photo is deleted for good, with all three of its sizes\. This cannot be undone\.<\/p>/);
});

test('Put it back and Delete permanently change only a hidden photo or clip: an approved or waiting one, or a clip still uploading, is left, and the page says so (#310, criterion 5)', async () => {
  const { env, fall } = await site();
  const approved = seed(env, fall);
  const pending = seed(env, fall, { state: 'pending' });
  // #310: a clip in each state but hidden. The one still uploading has its
  // upload really open, as the start route leaves it; 0016 never lets it be
  // hidden, so no press here may reach it, its row or its upload.
  const approvedClip = seedClip(env, fall);
  const pendingClip = seedClip(env, fall, { state: 'pending' });
  const uploading = await seedUploading(env, fall);
  const before = tables(env);
  for (const path of ['/api/admin/removals/restore', '/api/admin/removals/delete']) {
    for (const id of [approved, pending, approvedClip, pendingClip, uploading.id, 999_999]) {
      const res = await admin(env, 'POST', path, { body: `photo=${id}` });
      assert.equal(res.headers.get('Location'), '/admin/removals?error=gone', `${path} ${id}`);
    }
    const res = await admin(env, 'POST', path, { body: 'photo=abc' });
    assert.equal(res.headers.get('Location'), '/admin/removals?error=form');
  }
  assert.deepEqual(tables(env), before);
  for (const key of Object.values(photoObjectKeys(photoRow(env, approved).media_key))) assert.ok(env.MEDIA.objects.has(key));
  for (const id of [approvedClip, pendingClip]) assert.ok(env.MEDIA.objects.has(clipObjectKey(photoRow(env, id).media_key)), String(id));
  assert.equal(photoRow(env, uploading.id).state, 'uploading');
  assert.equal(env.MEDIA.uploads.get(uploading.uploadId).state, 'open', 'a press reached the upload of a clip still being sent');
});

test('a bucket that refuses the delete: the row still goes, the page says the files stayed, and the log names the folder; for a clip, its one file (#310)', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const { env, fall } = await site({ bucket: r2({ failDelete: true }) });
  const id = seed(env, fall, { state: 'hidden' });
  const mediaKey = photoRow(env, id).media_key;
  const res = await remove(env, id);
  assert.equal(res.headers.get('Location'), `/admin/removals?done=deleted&photo=${id}&kept=1`);
  assert.equal(photoRow(env, id), undefined);
  assert.deepEqual(logged, [`removals: bucket did not delete photos/${mediaKey}/ after a delete: bucket unreachable`]);
  assert.match(removalsNotice(new URLSearchParams(`done=deleted&photo=${id}&kept=1`)), /The storage did not delete its files; the log names their folder\./);
  // A clip's one object, refused the same way: its row goes, its file stays
  // under the folder the log names, and the notice says one file.
  const clip = seedClip(env, fall, { state: 'hidden' });
  const clipKey = photoRow(env, clip).media_key;
  const gone = await remove(env, clip);
  assert.equal(gone.headers.get('Location'), `/admin/removals?done=deleted&clip=${clip}&kept=1`);
  assert.equal(photoRow(env, clip), undefined);
  assert.ok(env.MEDIA.objects.has(clipObjectKey(clipKey)));
  assert.deepEqual(logged.slice(1), [`removals: bucket did not delete photos/${clipKey}/ after a delete: bucket unreachable`]);
  assert.equal(await noticeAt(env, gone.headers.get('Location')), `Deleted clip ${clip}. The storage did not delete its file; the log names its folder.`);
});

test('a press arriving as a GET changes nothing and says so', async () => {
  const { env, fall } = await site();
  seed(env, fall, { state: 'hidden' });
  const before = tables(env);
  for (const path of ['/api/admin/removals/restore', '/api/admin/removals/delete']) {
    const res = await admin(env, 'GET', path, { origin: null });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), '/admin/removals?error=unchanged');
  }
  assert.deepEqual(tables(env), before);
});

test('each notice is a known sentence, and anything else in the address bar shows none', () => {
  const notice = (query) => removalsNotice(new URLSearchParams(query)).replace(/^\n\s*<p role="status">|<\/p>$/g, '');
  // A photo's read as they did before clips.
  assert.equal(notice('done=restored&photo=12'), 'Put photo 12 back. It is public again.');
  assert.equal(notice('done=queued&photo=12'), 'Put photo 12 back in the queue. It was waiting for approval when it was hidden, so it is not public until an admin approves it.');
  assert.equal(notice('done=deleted&photo=12'), 'Deleted photo 12, with its three sizes.');
  assert.equal(notice('done=deleted&photo=12&kept=1'), 'Deleted photo 12, with its three sizes. The storage did not delete its files; the log names their folder.');
  // #310: a clip's, carried as clip=. One put back is approved, never
  // "public", until #286 shows clips; one deleted had one file, not three sizes.
  assert.equal(notice('done=restored&clip=12'), 'Put clip 12 back. It is approved again, kept but not shown on the site yet.');
  assert.equal(notice('done=queued&clip=12'), 'Put clip 12 back in the queue. It was waiting for approval when it was hidden, so it waits for an admin again.');
  assert.equal(notice('done=deleted&clip=12'), 'Deleted clip 12.');
  assert.equal(notice('done=deleted&clip=12&kept=1'), 'Deleted clip 12. The storage did not delete its file; the log names its folder.');
  // The refusals name both kinds, since either press may carry either.
  assert.match(notice('error=gone'), /^Nothing was changed: that photo or clip is no longer waiting here/);
  assert.match(notice('error=form'), /^Nothing was changed: the press did not say which photo or clip/);
  assert.match(notice('error=unchanged'), /^Nothing was changed\. The press reached the site as a page load/);
  for (const query of [
    'done=restored', 'done=restored&photo=<b>', 'done=deleted&photo=0', 'error=<script>', 'done=approved&photo=1', '',
    'done=restored&clip=<b>x</b>', 'done=deleted&clip=0', 'done=queued&clip=', 'done=restored&clip=1e3', 'done=approved&clip=1',
  ]) {
    assert.equal(removalsNotice(new URLSearchParams(query)), '', query);
  }
});

test('GET /admin/removals answers HTML that no cache may keep, and its script is stamped with its own hash', async () => {
  const { env } = await site();
  const res = await admin(env, 'GET', '/admin/removals', { origin: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(REMOVALS_SCRIPT, `<script src="/js/admin-removals.js?v=${sha10('public', 'js', 'admin-removals.js')}" defer></script>`);
  const html = await res.text();
  assert.equal(block(html, 'head').split(REMOVALS_SCRIPT).length, 2);
  assert.doesNotMatch(html.replace(REMOVALS_SCRIPT, ''), /<script|<style|\sstyle="|\son[a-z]+="/i);
});

// ---- The removals script (public/js/admin-removals.js) ------------------------

const ADMIN_SCRIPT = read('public', 'js', 'admin-removals.js');

test('the removals script names only elements the page carries', async () => {
  const { env, fall } = await site();
  const photo = seed(env, fall, { state: 'hidden' });
  const clip = seedClip(env, fall, { state: 'hidden' });
  const html = await removals(env);
  const ids = [...ADMIN_SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.includes('delete-text'), 'the control: the script reaches for the dialog\'s words (#310)');
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `admin-removals.js reaches for #${id}, which the page lacks`);
  }
  assert.match(html, /<button type="button"[^>]*data-delete="\d+"/);
  // #310: the kind it reads is on a clip's button, and on no photo's.
  assert.match(html, new RegExp(`<button type="button"[^>]*data-delete="${clip}" data-kind="clip"`));
  assert.doesNotMatch(html.match(new RegExp(`<button type="button"[^>]*data-delete="${photo}"[^>]*>`))[0], /data-kind/);
});

test('the removals script: "Delete permanently" opens the dialog as a modal, pointing its confirm at the photo or clip, naming which, and each time is rewritten', () => {
  const el = (props = {}) => ({ textContent: '', value: '', dataset: {}, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, ...props });
  const calls = [];
  // The dialog's words as the page writes them, a photo's, which the script
  // reads once and gives back to the next photo after a clip (#310).
  const PHOTO_WORDS = 'The photo is deleted for good, with all three of its sizes. This cannot be undone.';
  const nodes = {
    'delete-dialog': el({ showModal: () => calls.push('showModal'), show: () => calls.push('show') }),
    'delete-title': el({ textContent: 'stale title' }),
    'delete-text': el({ textContent: PHOTO_WORDS }),
    'delete-confirm': el({ value: 'stale id' }),
  };
  const buttons = [el({ dataset: { delete: '41' } }), el({ dataset: { delete: '42' } }), el({ dataset: { delete: '43', kind: 'clip' } })];
  const time = el({ dateTime: '2026-09-21T14:14:21.000Z', textContent: '21 September 2026, 14:14 UTC' });
  const selectors = { 'button[data-delete]': buttons, 'time[datetime]': [time] };
  const document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelectorAll: (selector) => {
      if (!(selector in selectors)) throw new Error(`the script asked for ${selector}`);
      return selectors[selector];
    },
  };
  vm.runInNewContext(ADMIN_SCRIPT, { document, Date });
  buttons[1].listeners.click();
  assert.deepEqual(calls, ['showModal']);
  assert.equal(nodes['delete-confirm'].value, '42');
  assert.equal(nodes['delete-title'].textContent, 'Delete photo 42 permanently?');
  assert.equal(nodes['delete-text'].textContent, PHOTO_WORDS);
  // #310: a clip's button names a clip, and says its one file goes, not
  // three sizes.
  buttons[2].listeners.click();
  assert.deepEqual(calls, ['showModal', 'showModal']);
  assert.equal(nodes['delete-confirm'].value, '43');
  assert.equal(nodes['delete-title'].textContent, 'Delete clip 43 permanently?');
  assert.equal(nodes['delete-text'].textContent, 'The clip is deleted for good. This cannot be undone.');
  // The next photo after it gets a photo's title and words back.
  buttons[0].listeners.click();
  assert.equal(nodes['delete-confirm'].value, '41');
  assert.equal(nodes['delete-title'].textContent, 'Delete photo 41 permanently?');
  assert.equal(nodes['delete-text'].textContent, PHOTO_WORDS);
  // Pinned to Chatham above, 14:14 UTC on the 21st is 02:59 on the 22nd: a
  // script that kept UTC reads 21 and 14, and one off by whole hours keeps 14.
  assert.notEqual(new Date(0).getTimezoneOffset() % 60, 0, `TZ=${process.env.TZ} did not apply`);
  assert.match(time.textContent, /22/);
  assert.match(time.textContent, /59/);
});

// ---- Criterion 3: the address is kept only until the hash expires -----------

test('each load of /admin and /admin/removals deletes the takedowns over an hour old, and keeps the rest (owner, at #158\'s review)', async () => {
  const { env } = await site();
  const now = nowSeconds();
  const insert = env.DB.sqlite.prepare('INSERT INTO removal_requests (address_hash, requested_at) VALUES (?, ?)');
  for (const path of ['/admin', '/admin/removals']) {
    env.DB.sqlite.prepare('DELETE FROM removal_requests').run();
    insert.run('old', now - REMOVAL_WINDOW_SECONDS - 1);
    insert.run('old', now - REMOVAL_WINDOW_SECONDS - 3600 * 24 * 90);
    insert.run('new', now - 60);
    assert.equal((await admin(env, 'GET', path, { origin: null })).status, 200, path);
    assert.deepEqual(removalRows(env).map((r) => r.address_hash), ['new'], path);
  }
  // The control: a load with nothing expired leaves the log as it was.
  const before = removalRows(env);
  await admin(env, 'GET', '/admin/removals', { origin: null });
  assert.deepEqual(removalRows(env), before);
});

test('an admin page loads even when clearing the log fails, and the log says so', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const { env } = await site();
  const broken = { ...env, DB: failOn(env.DB, /^DELETE FROM removal_requests WHERE requested_at/) };
  for (const path of ['/admin', '/admin/removals']) {
    assert.equal((await admin(broken, 'GET', path, { origin: null })).status, 200, path);
  }
  assert.deepEqual(logged, Array(2).fill('remove: could not clear takedowns more than an hour old: transient D1 error'));
});

// ---- WCAG 2.5.8: Download and "Remove this photo" each a 24 px target ----------

test('Download and "Remove this photo" each have the same 24 px box, so neither leans on the other\'s spacing (#158\'s ux-design audit)', () => {
  // The audit's axe run read target-size on every Download once the button
  // sat 3 px under it, and none on the same page without the remove forms.
  // Both are --text-xs; the block padding of --space-1 each side is what
  // lifts the 16 px line to 24 px.
  const css = read('public', 'css', 'site.css');
  const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  const download = rule('.download');
  assert.match(download, /display: inline-block;/);
  assert.match(download, /font-size: var\(--text-xs\);/);
  assert.match(download, /padding-block: var\(--space-1\);/);
  const button = rule('.remove-open');
  assert.match(button, /font-size: var\(--text-xs\);/);
  assert.match(button, /padding: var\(--space-1\) 0;/);
  // The control: the matcher reads a rule's body, and a rule that is not there reads empty.
  assert.equal(rule('.no-such-rule'), '');
});

// ---- Criterion 6: the admin home counts the requests waiting ----------------

test('the admin home says how many removal requests wait: hidden photos and, since #310, hidden clips, nothing in another state (#310, criterion 6)', async () => {
  const { env, fall } = await site();
  const home = async () => words(block(await (await admin(env, 'GET', '/admin', { origin: null })).text(), 'main'));
  assert.match(await home(), / 0 removal requests waiting\. Nothing to do\. /);
  seed(env, fall);
  seed(env, fall, { state: 'pending' });
  // The controls: a clip in each state but hidden. The one still uploading
  // was sent now, so the home's sweep of uploads abandoned a day
  // (lib/clips.js, clearStaleClips) leaves it for the count to read.
  seedClip(env, fall);
  seedClip(env, fall, { state: 'pending' });
  const uploading = await seedUploading(env, fall, { sentAt: nowSeconds() });
  const id = seed(env, fall, { state: 'hidden' });
  assert.match(await home(), / 1 removal request waiting /);
  // A clip "Hide all" took down is one too, whether it was approved or still
  // waiting when it was hidden, and is counted with the photos as one number.
  const clip = seedClip(env, fall, { state: 'hidden' });
  assert.match(await home(), / 2 removal requests waiting /);
  seedClip(env, fall, { state: 'hidden', waiting: true });
  assert.match(await home(), / 3 removal requests waiting /);
  seed(env, fall, { state: 'hidden' });
  assert.match(await home(), / 4 removal requests waiting /);
  // It follows the table: a photo or a clip put back is no longer waiting.
  await restore(env, id);
  assert.match(await home(), / 3 removal requests waiting /);
  await restore(env, clip);
  assert.match(await home(), / 2 removal requests waiting /);
  // The uploading control was still there to be read, and not counted.
  assert.equal(photoRow(env, uploading.id).state, 'uploading');
  // And it links the page (#269: as a button).
  assert.match(await (await admin(env, 'GET', '/admin', { origin: null })).text(), /<a class="button todo-item" href="\/admin\/removals"><span class="todo-count">2<\/span>/);
});

// ---- The pages themselves -----------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html, name) => validator.validateString(html, join(ROOT, name));
const problems = (report) => report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

test('every page this adds passes the photo site\'s html-validate config, and the validator can fail it', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, fall } = await site();
  const id = seed(env, fall, { caption: 'Start <b>line</b>' });
  seed(env, fall, { captured: T0 + 1 });
  const hidden = seed(env, fall, { state: 'hidden', note: 'please\nremove' });
  // #310: a clip row of each kind, so a bad attribute on one, a player
  // sized from a photo's null grid size among them, fails the page.
  const clips = [seedClip(env, fall, { state: 'hidden' }), seedClip(env, fall, { state: 'hidden', waiting: true, durationMs: 61_001 })];
  const pages = {
    'the album page': await (await get(env, `/albums/${fall}/?removed`)).text(),
    'the list after a takedown': await (await get(env, '/?removed')).text(),
    'the confirmation page': await (await post(env, '/remove', { photo: String(id) }, { origin: null })).text(),
    'the 404': await (await takedown(env, 999_999)).text(),
    'the 503': await (await takedown({ ...env, ADDRESS_HASH_KEY: undefined }, id)).text(),
    'the removals page': await removals(env),
    'the removals page, with a clip\'s notice': await (await admin(env, 'GET', `/admin/removals?done=deleted&clip=${clips[0]}&kept=1`, { origin: null })).text(),
    'the removals page, empty, with a notice': await (async () => {
      for (const row of [hidden, ...clips]) await admin(env, 'POST', '/api/admin/removals/restore', { body: `photo=${row}` });
      return (await admin(env, 'GET', `/admin/removals?done=restored&photo=${hidden}`, { origin: null })).text();
    })(),
  };
  // The control on the clip rows: the page holds both players, and the
  // validator fails one sized from nothing.
  const players = pages['the removals page'].match(/<video\b[^>]*>/g);
  assert.equal(players.length, 2);
  const unsized = pages['the removals page'].replace(players[0], players[0].replace(/ width="\d+"/, ' width="null"'));
  assert.notEqual(unsized, pages['the removals page']);
  assert.deepEqual(problems(await validate(unsized, 'admin.html')), ['attribute-allowed-values: Attribute "width" has invalid value "null"']);
  for (let i = 0; i < REMOVAL_LIMIT; i++) {
    await takedown(env, seed(env, fall, { captured: T0 + 10 + i }), { ip: '192.0.2.1' });
  }
  pages['the 429'] = await (await takedown(env, id, { ip: '192.0.2.1' })).text();
  for (const [name, html] of Object.entries(pages)) {
    const file = name.startsWith('the removals') ? 'admin.html' : 'public.html';
    const report = await validate(html, file);
    assert.deepEqual(problems(report), [], name);
    assert.equal(html.match(/<h1[\s>]/g).length, 1, name);
    // The controls: a second h1 beside the first, and an inline style the CSP
    // would drop, each fail it.
    assert.equal((await validate(html.replace(/<\/h1>/, '</h1><h1>again</h1>'), file)).valid, false, name);
    assert.equal((await validate(html.replace('<main id="main">', '<main id="main" style="color: red">'), file)).valid, false, name);
  }
});

test('the takedown email on the refusal pages is the one /policy gives', () => {
  assert.equal(TAKEDOWN_EMAIL, 'dave@madcowsailing.com');
  assert.ok(read('public', 'policy.html').includes(`<a href="mailto:${TAKEDOWN_EMAIL}">${TAKEDOWN_EMAIL}</a>`));
});
