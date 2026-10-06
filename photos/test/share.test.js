// The share page's script (#155, with #150's join step): making each chosen
// photo's three JPEGs and sending them. public/js/share.js runs here in
// node:vm against hand-written stand-ins for the DOM, the canvas and the
// browser's image decoder, the repo's way with a page script since #152. Its
// fetch goes through the same chains Pages runs, into the real routes, a real
// SQLite holding the real migrations (test/d1.js) and an R2 stand-in
// (test/r2.js). So a photo this page sends is a photo the server stores, and
// the contract between them (seconds not milliseconds, a lowercase batch,
// three sizes of one shape) is tested from both ends at once.
//
// The stand-ins cannot show pixels. The browser runs on #155's pull request
// do: Chrome 154 against a local copy of the site, the stored JPEGs read back
// and their corners checked for colour.
//
// "Today" on the page is the phone's own date, and a capture time without an
// offset is read in the phone's own zone. Chatham is 12:45 or 13:45 ahead of
// UTC, so a slip into UTC moves the date, the hour and the minutes (the pin
// #152 chose for the same reason). The first test checks the pin took.
process.env.TZ = 'Pacific/Chatham';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openAlbumsRoute } from '../functions/api/albums/open.js';
import { onRequestPost as joinRoute } from '../functions/api/join.js';
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestPost as uploadRoute } from '../functions/api/upload/index.js';
import { onRequestGet as sessionRoute } from '../functions/api/upload/session.js';
import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import { createAlbum } from '../lib/albums.js';
import { readJpeg } from '../lib/jpeg.js';
import { CAPTION_MAX, DAILY_UPLOADS, SIZES, sizesAgree } from '../lib/photos.js';
import { COOKIE_NAME, coachTag, nowSeconds, signCoachSession } from '../lib/session.js';
import { COACH } from './access.js';
import { d1, seedCodes } from './d1.js';
import { idb } from './idb.js';
import { exif, exifWith, jpeg, metadataMarkers, withSegments, xmp } from './jpeg.js';
import { r2 } from './r2.js';
import { share, worker } from './worker.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const SCRIPT = read('public', 'js', 'share.js');
const HTML = read('public', 'share', 'index.html');

const SITE = 'https://photos.madcowsailing.com';
const OLD = 'Q2WE-R4TY-V6PA';
const CODE = 'K7QM-3XRD-9FWB';
const NEXT = 'M4TR-7KXW-2PHD';
const KEYS = {
  SESSION_SIGNING_KEY: 'test-session-signing-key-0123456789abcdef',
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
};
const BATCH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The page's clock, fixed at 20:00 UTC on 29 September 2026, when Chatham
// (daylight time since the 27th, UTC+13:45) is already at 09:45 on the 30th.
// So "today" on the phone and the UTC date differ in every run. With the real
// clock they differed only after 10:15 UTC, and a today() that slipped into
// UTC passed every run before then (#155's review measured 0 red at 02:13).
const CLOCK = Date.UTC(2026, 8, 29, 20, 0, 0);

// The page's Date: the fixed clock when asked for "now", and dates shown in
// a zone WEST of UTC by default. A calendar date shown without its own zone
// slips a day there; east of UTC, where the process is pinned, it never can,
// so the Chatham pin alone could not see heldOn() go wrong (#155's review).
class PageDate extends Date {
  constructor(...args) {
    if (args.length) super(...args);
    else super(CLOCK);
  }

  static now() {
    return CLOCK;
  }

  toLocaleDateString(locales, options = {}) {
    return super.toLocaleDateString(locales, { timeZone: 'Pacific/Honolulu', ...options });
  }
}

const pad = (n) => String(n).padStart(2, '0');
const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayOffset = (days) => localDay(new Date(CLOCK + days * 86_400_000));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---- A photo the test chooses ------------------------------------------

// What the decoder stand-in knows of each file it may be handed, by the
// sha256 of its bytes: the stored pixels' size and the EXIF orientation. A
// file the test did not describe does not decode (a HEIC in Chrome).
const described = new Map();

/**
 * A JPEG File of a width x height stored picture. `exif` builds its EXIF
 * segment (test/jpeg.js, exifWith), and the decoder stand-in is told the
 * same orientation, so the two cannot disagree; `segments` follow it.
 */
function photoFile({ width = 4032, height = 3024, exif: tags = null, segments = [], name = 'image.jpg', lastModified = 1_790_000_000_000 } = {}) {
  const bytes = withSegments(jpeg({ width, height }), ...(tags ? [exifWith(tags)] : []), ...segments);
  described.set(sha(bytes), { width, height, orientation: tags?.orientation ?? 1 });
  return new File([bytes], name, { type: 'image/jpeg', lastModified });
}

/** A PNG File with no EXIF, as a screenshot is. Only its IHDR is real. */
function pngFile({ width = 1170, height = 2532, name = 'screenshot.png', lastModified = 1_790_000_000_000 } = {}) {
  const ihdr = new Uint8Array(33);
  ihdr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(ihdr.buffer).setUint32(16, width);
  new DataView(ihdr.buffer).setUint32(20, height);
  described.set(sha(ihdr), { width, height, orientation: 1 });
  return new File([ihdr], name, { type: 'image/png', lastModified });
}

/** A file no decoder here opens: HEIF's brand, then noise. */
const heicFile = (name = 'IMG_0001.HEIC', type = 'image/heic') =>
  new File([Uint8Array.of(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 1, 2, 3, 4)], name, { type });

// The page's own probe, as test/jpeg.js builds it: 2 x 1, orientation 6.
const PROBE_BYTES = withSegments(jpeg({ width: 2, height: 1 }), exifWith({ orientation: 6 }));
described.set(sha(PROBE_BYTES), { width: 2, height: 1, orientation: 6 });

// ---- A DOM, just big enough for the page -------------------------------

class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = new Map();
    this.listeners = {};
    this.shown = true;
    this.className = '';
    this.id = '';
    this.text = '';
    this.textWrites = 0;
  }

  // Hiding the focused element blurs it at once, as Chrome 154 does: a
  // focusout to nothing, and document.activeElement is the body from then on.
  // Without this, a page that looks for the focus after hiding a button
  // passed here and failed in Chrome (#155's Try again).
  get hidden() {
    return !this.shown;
  }

  set hidden(value) {
    this.shown = !value;
    if (value && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }

  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this.text;
  }

  set textContent(value) {
    this.textWrites += 1;
    this.history?.push(String(value));
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = String(value);
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = '';
    this.selected = null;
    this.append(...nodes);
  }

  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  focus() { this.ownerDocument.activeElement = this; }

  // A <select>'s options in document order, an <optgroup>'s included, as a
  // browser's select.options lists them (#227 groups the albums by team).
  get options() {
    return this.children
      .flatMap((c) => (c.tagName === 'OPTGROUP' ? c.children : [c]))
      .filter((c) => c.tagName === 'OPTION');
  }

  // A <select>'s value is its selected option's, the first when none is.
  get value() {
    if (this.tagName !== 'SELECT') return this.ownValue ?? '';
    const { options } = this;
    return (this.selected && options.includes(this.selected) ? this.selected : options[0])?.value ?? '';
  }

  set value(value) {
    if (this.tagName === 'SELECT') {
      this.selected = this.options.find((c) => c.value === value) ?? null;
    } else if (this.type === 'file') {
      this.files = [];
    } else {
      this.ownValue = String(value);
    }
  }
}

/** A canvas that records what was drawn on it and answers toBlob with a real JPEG of its size. */
function canvasMaker(encoder, canvases) {
  return (document) => {
    const canvas = new Element(document, 'canvas');
    canvas.width = 300;
    canvas.height = 150;
    canvas.draws = [];
    canvas.qualities = [];
    const context = {
      matrix: [1, 0, 0, 1, 0, 0],
      setTransform(...m) { this.matrix = m; },
      drawImage(source, x, y, w, h) { canvas.draws.push({ source, x, y, w, h, matrix: [...this.matrix] }); },
    };
    canvas.getContext = (kind) => (kind === '2d' && !encoder.noContext ? context : null);
    canvas.toBlob = (callback, type, quality) => {
      canvas.qualities.push(quality);
      canvas.askedType = type;
      const { width, height } = canvas;
      setTimeout(() => {
        if (!width || !height) return callback(null);
        if (encoder.type && encoder.type !== 'image/jpeg') return callback(new Blob([Uint8Array.of(1, 2, 3)], { type: encoder.type }));
        // Bytes after the end-of-image marker stand in for a heavier encode:
        // the server drops them, and they count against the size's cap.
        const extra = encoder.extra?.({ width, height, quality }) ?? 0;
        callback(new Blob([jpeg({ width, height }), new Uint8Array(extra)], { type: 'image/jpeg' }));
      }, 0);
    };
    canvases.push(canvas);
    return canvas;
  };
}

/**
 * The page, loaded in a fresh vm context against a fresh site. `hash` is what
 * the address carries, `turns` whether the decoder turns photos upright by
 * their EXIF as it decodes them (Chrome 154 does), `intercept` answers an
 * upload instead of the route.
 *
 * For the installed app (#193): `search` is the address's query (share/sw.js
 * sends ?shared), `db` the browser's IndexedDB (none by default, as in a
 * browser without it), `session` a session this browser already holds when
 * the page opens ('parent', from an earlier invite link, 'coach', from
 * /coach, or 'account', signed in at /sign-in to an account approved for
 * `accountTeams`, #223), `register` how the browser answers the worker's registration
 * ('ok', 'refused', or 'absent' for a browser with no service workers at
 * all), and `holdJoin` holds POST /api/join until page.releaseJoin().
 */
async function load({
  hash = `#code=${CODE}`, albums = null, turns = true, encoder = {}, hold = false, slow = false,
  search = '', db = null, session = null, register = 'ok', holdJoin = false, accountTeams = ['hoover-jrt'],
} = {}) {
  const env = { DB: d1(), MEDIA: r2(), SITE_ENV: 'production', COACH_EMAILS: COACH, ...KEYS };
  seedCodes(env.DB, OLD, CODE);
  const now = Math.floor(Date.now() / 1000);
  const made = {};
  // Hoover JRT's unless an album names its team (#227).
  for (const album of albums ?? [{ key: 'today', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0) }]) {
    made[album.key] = await createAlbum(env.DB, { team: 'hoover-jrt', ...album }, now);
  }

  const document = { activeElement: null, byId: new Map() };
  document.body = new Element(document, 'body');
  document.activeElement = document.body;
  // One element per id the page's HTML carries, hidden where the HTML hides it.
  for (const [, tag, attrs] of HTML.matchAll(/<(\w+)\s([^>]*\bid="[^"]+"[^>]*)>/g)) {
    const el = new Element(document, tag);
    el.id = attrs.match(/\bid="([^"]+)"/)[1];
    el.hidden = /\shidden(\s|$)/.test(` ${attrs}`);
    if (tag === 'input') el.type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? 'text';
    if (el.type === 'file') el.files = [];
    document.byId.set(el.id, el);
  }
  const canvases = [];
  const makeCanvas = canvasMaker(encoder, canvases);
  document.getElementById = (id) => document.byId.get(id) ?? null;
  document.createElement = (tag) => (tag === 'canvas' ? makeCanvas(document) : new Element(document, tag));

  const windowListeners = {};
  const location = { pathname: '/share/', search, hash };
  const history = {
    state: null,
    replaceState(state, title, url) {
      const next = new URL(url, `${SITE}${location.pathname}${location.search}${location.hash}`);
      location.pathname = next.pathname;
      location.search = next.search;
      location.hash = next.hash;
    },
  };

  // The decoder: a photo the test described decodes, turned upright or as
  // stored; anything else is refused, as Chrome refuses a HEIC.
  // `open` counts photos decoded and not yet let go; the probe is not one.
  // With `slow`, each photo's decode waits for page.decode() to let it go,
  // so a test can act while a photo is still being made ready.
  const bitmaps = [];
  const decoder = { turns, open: 0, maxOpen: 0, waiting: [] };
  const probeKnown = described.get(sha(PROBE_BYTES));
  async function createImageBitmap(blob) {
    const known = described.get(sha(new Uint8Array(await blob.arrayBuffer())));
    if (slow && known !== probeKnown) await new Promise((resolve) => decoder.waiting.push(resolve));
    if (!known) throw new Error('InvalidStateError: The source image could not be decoded.');
    const across = decoder.turns && known.orientation >= 5;
    const photo = known !== probeKnown;
    const bitmap = {
      width: across ? known.height : known.width,
      height: across ? known.width : known.height,
      known,
      upright: decoder.turns,
      closed: false,
      close() {
        if (!this.closed && photo) decoder.open -= 1;
        this.closed = true;
      },
    };
    if (photo) {
      decoder.open += 1;
      decoder.maxOpen = Math.max(decoder.maxOpen, decoder.open);
    }
    bitmaps.push(bitmap);
    return bitmap;
  }

  // fetch: through the chain Pages runs in front of each route, with a
  // browser's cookie jar and its Origin on a POST.
  const jar = new Map();
  const net = { posted: [], inFlight: 0, maxInFlight: 0, waiting: [], hold, intercept: null, albumsAnswer: null, calls: [] };
  const run = (handlers, request) => {
    const data = {};
    const step = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => step(i + 1) });
    return step(0);
  };
  async function fetch(path, init = {}) {
    const method = init.method ?? 'GET';
    net.calls.push(`${method} ${path}`);
    const headers = new Headers(init.headers ?? {});
    if (method !== 'GET') headers.set('Origin', SITE);
    headers.set('CF-Connecting-IP', '203.0.113.7');
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const request = new Request(`${SITE}${path}`, { method, headers, body: init.body });
    let response;
    if (path === '/api/upload') {
      net.inFlight += 1;
      net.maxInFlight = Math.max(net.maxInFlight, net.inFlight);
      try {
        const form = await request.clone().formData();
        net.posted.push(form);
        if (net.hold) await new Promise((resolve) => net.waiting.push(resolve));
        const canned = net.intercept?.(form, net.posted.length);
        if (canned === 'network') throw new TypeError('Failed to fetch');
        response = canned ?? await run([root, ...uploadGuard, uploadRoute], request);
      } finally {
        net.inFlight -= 1;
      }
    } else if (path === '/api/join') {
      if (holdJoin) await new Promise((resolve) => { net.joinHeld = resolve; });
      response = await run([root, joinRoute], request);
    }
    else if (path === '/api/upload/session') response = await run([root, ...uploadGuard, sessionRoute], request);
    else if (path === '/api/albums/open') {
      const canned = net.albumsAnswer?.();
      if (canned === 'network') throw new TypeError('Failed to fetch');
      response = canned ?? await run([root, albumsGuard, openAlbumsRoute], request);
    }
    else throw new Error(`the page fetched ${path}, which this stand-in does not serve`);
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) {
      const [pair] = cookie.split(';');
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }

  // A session this browser already holds: a parent's from an earlier invite
  // link, through the real join route, or a coach's, as /coach sets it.
  if (session === 'parent') {
    const answer = await run([root, joinRoute], new Request(`${SITE}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ code: CODE }),
    }));
    assert.equal(answer.status, 204);
    const [pair] = answer.headers.get('Set-Cookie').split(';');
    jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  } else if (session === 'coach') {
    jar.set(COOKIE_NAME, await signCoachSession(KEYS.SESSION_SIGNING_KEY, await coachTag(KEYS.SESSION_SIGNING_KEY, COACH), nowSeconds()));
  } else if (session === 'account') {
    // Account 1, a parent, approved for `accountTeams` (#223), as /sign-in
    // leaves the cookie.
    env.DB.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('pat@example.org', 'Pat Parent', 'parent', 1)").run();
    for (const team of accountTeams) {
      env.DB.sqlite.prepare("INSERT INTO account_teams (account_id, team, state) VALUES (1, ?, 'approved')").run(team);
    }
    jar.set(ACCOUNT_COOKIE, await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 1, version: 1 }, nowSeconds()));
  }

  // The browser's service workers: each registration the page asks for,
  // answered as `register` says.
  const registrations = [];
  const navigator = register === 'absent' ? {} : {
    serviceWorker: {
      register(url, options) {
        registrations.push({ url, options });
        return register === 'ok' ? Promise.resolve({ scope: `${SITE}/share/` }) : Promise.reject(new DOMException('Refused', 'SecurityError'));
      },
    },
  };

  const objectUrls = new Map();
  let urls = 0;
  const context = {
    document,
    window: { addEventListener: (type, fn) => (windowListeners[type] ??= []).push(fn) },
    location,
    history,
    fetch,
    createImageBitmap,
    URL: {
      createObjectURL: (blob) => {
        const url = `blob:${SITE}/${++urls}`;
        objectUrls.set(url, blob);
        return url;
      },
      revokeObjectURL: (url) => objectUrls.delete(url),
    },
    URLSearchParams, Blob, File, FormData, crypto, atob, console, setTimeout,
    Date: PageDate,
    navigator,
    ...(db ? { indexedDB: db.indexedDB } : {}),
  };
  vm.runInNewContext(SCRIPT, context);

  const $ = (id) => document.byId.get(id);
  const page = {
    env, made, net, jar, decoder, bitmaps, canvases, objectUrls, location, document, $, registrations, db,
    // Each photo's list item, read back into what a visitor sees.
    items: () => $('photo-list').children.map((li) => {
      const [frame, state, label, caption, counter, actions] = li.children;
      const [tryAgain, remove] = actions.children;
      return { li, state: li.getAttribute('data-state'), text: state.textContent, img: frame.children[0], label, caption, counter, tryAgain, remove };
    }),
    choose(...files) {
      $('photo-input').files = files;
      for (const fn of $('photo-input').listeners.change ?? []) fn({});
    },
    click(el) {
      el.focus();
      for (const fn of el.listeners.click ?? []) fn({});
    },
    type(input, value) {
      input.value = value;
      for (const fn of input.listeners.input ?? []) fn({});
    },
    fireWindow(type, event = {}) {
      for (const fn of windowListeners[type] ?? []) fn(event);
      return event;
    },
    release(n = Infinity) {
      for (let i = 0; i < n && net.waiting.length; i++) net.waiting.shift()();
    },
    decode: () => decoder.waiting.shift()(),
    releaseJoin: () => net.joinHeld(),
    rows: () => env.DB.sqlite.prepare('SELECT p.*, a.address FROM photos p JOIN albums a ON a.id = p.album_id ORDER BY p.id').all().map((r) => ({ ...r })),
    summary: () => $('send-status').textContent,
  };
  return page;
}

/**
 * Waits until `ready()` holds, turning the event loop, or fails naming
 * `what` after 10 seconds. By the clock, not by a count of turns: a count
 * ran out once on a cold first run while 35 photos were still being made.
 */
async function until(ready, what, ms = 10_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`never happened within ${ms} ms: ${what}`);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
// Settled means every listed photo is done AND no upload is in flight: a
// photo taken off the list is not listed, and an assertion that it was never
// sent means nothing if it is read while that upload could still land.
const settled = (page) => until(
  () => page.net.inFlight === 0 && page.items().every((i) => !['preparing', 'queued', 'sending'].includes(i.state)),
  'every photo settled, nothing in flight',
);
const joined = async (page) => {
  await until(() => page.$('join-status').textContent.startsWith("You're set"), 'joined');
  await until(() => page.$('album').options.some((o) => o.value), 'albums listed');
};

// ---- The harness ------------------------------------------------------

test('the zone pin took effect: this process is not on a whole-hour offset', () => {
  assert.notEqual(new Date(0).getTimezoneOffset() % 60, 0, `TZ=${process.env.TZ} did not apply`);
  // And the page's clock sits where the phone's date and the UTC date differ.
  assert.equal(dayOffset(0), '2026-09-30');
  assert.equal(new Date(CLOCK).toISOString().slice(0, 10), '2026-09-29');
});

test('the script names only elements the page carries, and never writes markup', () => {
  const ids = [...SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 10);
  for (const id of ids) assert.match(HTML, new RegExp(`\\bid="${id}"`), `share.js reaches for #${id}`);
  // An album title and a file name are data: set as text, never parsed.
  assert.doesNotMatch(SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('the orientation probe in the script is test/jpeg.js\'s build, and the server reads it as a 2 x 1 JPEG', () => {
  const b64 = SCRIPT.match(/const PROBE =\s*'([^']+)'/)[1];
  assert.deepEqual(new Uint8Array(Buffer.from(b64, 'base64')), PROBE_BYTES);
  const probe = readJpeg(PROBE_BYTES);
  assert.equal(probe.error, undefined);
  assert.deepEqual([probe.width, probe.height], [2, 1]);
});

// ---- Criterion 1: link, "Add photos", choose, "Send", nothing typed ----

test('a first-time parent sends 10 photos with the link, "Add photos", choosing them and "Send": today\'s album, nothing typed', async () => {
  const page = await load({
    albums: [
      { key: 'future', title: 'Fall Regatta', kind: 'regatta', date: dayOffset(5) },
      { key: 'today', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0) },
      { key: 'past', title: 'Club race', kind: 'regatta', date: dayOffset(-3) },
    ],
  });
  await joined(page);
  assert.equal(page.location.hash, '', 'the code was left in the address bar');
  assert.equal(page.$('sender').hidden, false);
  assert.equal(page.$('album').value, page.made.today, 'today\'s album is preselected over the future one');

  page.choose(...Array.from({ length: 10 }, (_, i) => photoFile({ width: 4032 + i, height: 3024 })));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ten ready');
  assert.equal(page.summary(), '10 photos ready to send.');
  assert.equal(page.$('send').hidden, false);
  page.click(page.$('send'));
  await settled(page);

  const rows = page.rows();
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.address === page.made.today && r.state === 'pending' && r.caption === null));
  assert.equal(new Set(rows.map((r) => r.batch)).size, 1, 'one press of Send is one batch');
  assert.match(rows[0].batch, BATCH);
  assert.equal(page.env.MEDIA.objects.size, 30);
  assert.equal(page.summary(), "Sent 10 photos. They'll appear in the album once they're reviewed.");
  assert.deepEqual(page.net.calls.filter((c) => c.startsWith('POST')).slice(0, 1), ['POST /api/join']);
});

test('the preselect: an album held today, else the latest past one, never a future one', async () => {
  const cases = [
    {
      albums: [
        { key: 'future', title: 'Next week', kind: 'regatta', date: dayOffset(7) },
        { key: 'recent', title: 'Saturday', kind: 'regatta', date: dayOffset(-2) },
        { key: 'older', title: 'Last month', kind: 'regatta', date: dayOffset(-30) },
      ],
      expected: 'recent',
    },
    { albums: [{ key: 'future', title: 'Next week', kind: 'regatta', date: dayOffset(1) }], expected: null },
    {
      albums: [
        { key: 'am', title: 'Morning', kind: 'practice', date: dayOffset(0) },
        { key: 'pm', title: 'Evening', kind: 'practice', date: dayOffset(0) },
      ],
      expected: 'pm', // the newer of two held today: the list gives it first
    },
  ];
  for (const { albums, expected } of cases) {
    const page = await load({ albums });
    await until(() => page.$('album').options.length > 0 && !page.$('album').options[0].textContent.startsWith('Loading'), 'listed');
    const select = page.$('album');
    if (expected === null) {
      assert.equal(select.value, '', 'a future album was preselected');
      assert.equal(select.options[0].textContent, 'Choose an album');
    } else {
      assert.equal(select.value, page.made[expected]);
    }
    assert.equal(select.options.filter((o) => o.value).length, albums.length, 'every open album stays in the list');
  }
});

test('with only a future album, Send asks for an album first and sends nothing', async () => {
  const page = await load({ albums: [{ key: 'future', title: 'Next week', kind: 'regatta', date: dayOffset(3) }] });
  await until(() => page.$('album').options.length > 0, 'listed');
  page.choose(photoFile());
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await tick();
  assert.equal(page.summary(), 'Choose an album first. 1 photo ready to send.');
  assert.equal(page.document.activeElement, page.$('album'));
  assert.equal(page.net.posted.length, 0);
  page.$('album').value = page.made.future;
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.rows()[0].address, page.made.future);
});

test('an album\'s title is shown as text, with its own day in any zone', async () => {
  // Shown on a phone west of UTC (PageDate's default display zone): 15 June
  // must not become the 14th, as it does when the day is made at midnight
  // and shown in the phone's zone.
  const page = await load({ albums: [{ key: 'today', title: '<b>Tuesday</b> practice', kind: 'practice', date: '2026-06-15' }] });
  await until(() => page.$('album').options.some((o) => o.value), 'listed');
  const [option] = page.$('album').options.filter((o) => o.value);
  assert.match(option.textContent, /^<b>Tuesday<\/b> practice \(.*15.*\)$/);
  assert.doesNotMatch(option.textContent, /14/);
});

test('#227: the albums are grouped under each team\'s name, in the order the teams first appear, newest first inside each', async () => {
  const page = await load({
    albums: [
      { key: 'districts', team: 'cohssa', title: 'Districts', kind: 'regatta', date: dayOffset(2) },
      { key: 'today', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0) },
      { key: 'league', team: 'cohssa', title: 'League day', kind: 'regatta', date: dayOffset(-1) },
      { key: 'past', title: 'Club race', kind: 'regatta', date: dayOffset(-3) },
    ],
  });
  await joined(page);
  const select = page.$('album');
  const groups = select.children.filter((c) => c.tagName === 'OPTGROUP');
  assert.deepEqual(groups.map((g) => g.getAttribute('label')), ['COHSSA', 'Hoover JRT']);
  assert.deepEqual(groups.map((g) => g.children.map((o) => o.value)), [
    [page.made.districts, page.made.league],
    [page.made.today, page.made.past],
  ]);
  // Every option sits in a group, and the preselect still finds today's album inside one.
  assert.deepEqual(select.children.map((c) => c.tagName), ['OPTGROUP', 'OPTGROUP']);
  assert.equal(select.value, page.made.today);
  // Sending from a grouped list goes to the album chosen in it.
  select.value = page.made.league;
  page.choose(photoFile());
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.rows()[0].address, page.made.league);
});

test('#227: the groups follow the list, not the teams\' names: Hoover JRT first when its album is newest', async () => {
  // The case above puts COHSSA first, which is also the alphabetical order of
  // the labels, so a sort by label passed it (review-fanout at #227's review).
  // Here the newest album is Hoover JRT's, which sorts after COHSSA by name.
  const page = await load({
    albums: [
      { key: 'regatta', title: 'Fall Regatta', kind: 'regatta', date: dayOffset(3) },
      { key: 'districts', team: 'cohssa', title: 'Districts', kind: 'regatta', date: dayOffset(1) },
    ],
  });
  await joined(page);
  const groups = page.$('album').children.filter((c) => c.tagName === 'OPTGROUP');
  assert.deepEqual(groups.map((g) => g.getAttribute('label')), ['Hoover JRT', 'COHSSA']);
});

test('#227: with nothing preselected, the blank choice comes before the groups, outside them', async () => {
  const page = await load({ albums: [{ key: 'future', team: 'cohssa', title: 'Next week', kind: 'regatta', date: dayOffset(3) }] });
  await joined(page);
  const select = page.$('album');
  assert.deepEqual(select.children.map((c) => [c.tagName, c.tagName === 'OPTION' ? c.textContent : c.getAttribute('label')]),
    [['OPTION', 'Choose an album'], ['OPTGROUP', 'COHSSA']]);
  assert.equal(select.value, '');
});

test('with no album open, the page says so and offers to check again, which lists one opened since', async () => {
  const page = await load({ albums: [] });
  await until(() => !page.$('album-note').hidden, 'note shown');
  assert.match(page.$('album-note').textContent, /^No album is taking photos right now/);
  assert.equal(page.$('album-again').hidden, false);
  const address = await createAlbum(page.env.DB, { team: 'hoover-jrt', title: 'Opened late', kind: 'practice', date: dayOffset(0) }, 1_790_000_000);
  page.click(page.$('album-again'));
  await until(() => page.$('album').value === address, 'the new album preselected');
  assert.equal(page.$('album-note').hidden, true);
  assert.equal(page.$('album-again').hidden, true);
  assert.equal(page.document.activeElement, page.$('album'), 'focus fell to the page with Check again hidden');
});

test('an album list that cannot be read says so, and the list stops saying it is loading', async () => {
  for (const [answer, status] of [
    [() => 'network', 'You\'re set to send photos from this phone.'],
    [() => Response.json({ error: 'session' }, { status: 401 }), 'Your sign-in or invite has ended. Sign in again, or open the newest invite link you were sent, then send again.'],
  ]) {
    const page = await load();
    page.net.albumsAnswer = answer;
    await until(() => page.$('album').options.length > 0, 'the list rebuilt');
    await tick();
    assert.deepEqual(page.$('album').options.map((o) => o.textContent), ['No albums loaded']);
    assert.equal(page.$('album').value, '');
    assert.equal(page.$('join-status').textContent, status);
  }
});

test('with no code and no session, nothing to send is shown', async () => {
  const page = await load({ hash: '' });
  await until(() => page.$('join-status').textContent.startsWith('Sign in, or open the invite'), 'no session');
  assert.equal(page.$('sender').hidden, true);
  assert.deepEqual(page.net.calls, ['GET /api/upload/session']);
});

// ---- Criterion 2: capture time, upright, three JPEGs through canvas -----

async function sendOne(file, options = {}) {
  const page = await load(options);
  await joined(page);
  page.choose(file);
  await until(() => page.items()[0]?.state === 'ready' || page.items()[0]?.state === 'unreadable', 'prepared');
  page.click(page.$('send'));
  await settled(page);
  return page;
}

test('the capture time is EXIF\'s DateTimeOriginal, with its offset, in Unix seconds, in either byte order', async () => {
  for (const order of ['II', 'MM']) {
    const file = photoFile({ exif: { order, orientation: 1, original: '2026:09:27 14:05:09', originalOffset: '-04:00' } });
    const page = await sendOne(file);
    // 14:05:09 at UTC-4 is 18:05:09 UTC.
    assert.equal(page.rows()[0].captured_at, Date.UTC(2026, 8, 27, 18, 5, 9) / 1000, order);
    assert.equal(page.net.posted[0].get('captured'), String(Date.UTC(2026, 8, 27, 18, 5, 9) / 1000));
  }
});

test('with no offset the time is the phone\'s own zone; DateTimeDigitized stands in for a missing original', async () => {
  // Chatham in June is UTC+12:45, so 12:00 there is 23:15 UTC the day before.
  const local = Date.UTC(2026, 5, 14, 23, 15, 0) / 1000;
  let page = await sendOne(photoFile({ exif: { original: '2026:06:15 12:00:00' } }));
  assert.equal(page.rows()[0].captured_at, local);
  page = await sendOne(photoFile({ exif: { digitized: '2026:06:15 12:00:00', digitizedOffset: '+05:30' } }));
  assert.equal(page.rows()[0].captured_at, Date.UTC(2026, 5, 15, 6, 30, 0) / 1000);
});

test('EXIF is found behind the other segments a phone writes, and only the first EXIF segment is read', async () => {
  const jfif = Uint8Array.of(0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 0, 0, 72, 0, 72, 0, 0);
  const timed = exifWith({ order: 'MM', original: '2026:09:20 08:00:00', originalOffset: '+00:00' });
  let page = await sendOne(photoFile({ segments: [jfif, xmp(), timed] }));
  assert.equal(page.rows()[0].captured_at, Date.UTC(2026, 8, 20, 8, 0, 0) / 1000);
  // #154's fixture first: a make and a GPS position, and no time. The time
  // then falls back to the file's date rather than a later segment's.
  page = await sendOne(photoFile({ segments: [jfif, exif(), timed] }));
  assert.equal(page.rows()[0].captured_at, 1_790_000_000);
});

test('DateTimeOriginal wins over DateTimeDigitized, and the last-change DateTime is never read', async () => {
  let page = await sendOne(photoFile({ exif: { original: '2026:09:20 08:00:00', originalOffset: '+00:00', digitized: '2026:09:21 09:00:00', digitizedOffset: '+00:00' } }));
  assert.equal(page.rows()[0].captured_at, Date.UTC(2026, 8, 20, 8, 0, 0) / 1000);
  // A photo edited later: IFD0's DateTime moved, and the file's date is what
  // stands in for a capture time the camera never wrote.
  page = await sendOne(photoFile({ exif: { modified: '2026:09:25 10:00:00' }, lastModified: 1_790_123_456_789 }));
  assert.equal(page.rows()[0].captured_at, 1_790_123_456);
});

test('without a usable EXIF time, the capture time is the file\'s date, in seconds, never milliseconds', async () => {
  const lastModified = 1_790_123_456_789;
  // Each bad time is refused by one clause of when() and no other, so each
  // clause has a fixture only it refuses.
  const bad = [
    ['0000:00:00 00:00:00'], // every part out of range at once
    ['2026:02:30 10:00:00'], // a day the month does not have
    ['2026:13:01 10:00:00'], // month 13
    ['2026:09:29 24:00:00'], // hour 24
    ['2026:09:29 10:60:00'], // minute 60
    ['2026:09:29 10:00:60'], // second 60
    // Before 1970, but after it in UTC: 23:00 at UTC-12 is 11:00 on 1 January
    // 1970. Without the offset the seconds-below-zero check refuses it too,
    // and the year clause would have a spare.
    ['1969:12:31 23:00:00', '-12:00'],
    ['garbage'],
  ];
  for (const segments of [[], ...bad.map(([original, originalOffset = null]) => [exifWith({ original, originalOffset })])]) {
    const page = await sendOne(photoFile({ segments, lastModified }));
    assert.equal(page.rows()[0].captured_at, 1_790_123_456, JSON.stringify(segments.length ? 'bad time' : 'no EXIF'));
  }
  const page = await sendOne(pngFile({ lastModified }));
  assert.equal(page.rows()[0].captured_at, 1_790_123_456);
});

test('a truncated or malformed EXIF block does not stop the photo sending', async () => {
  const full = exifWith({ orientation: 6, original: '2026:09:27 14:05:09' });
  const cut = full.slice(0, 30);
  cut[2] = 0;
  cut[3] = 28; // the segment's length now matches what is left
  const wild = exifWith({ original: '2026:09:27 14:05:09' });
  new DataView(wild.buffer).setUint32(10 + 4, 0x7fffffff, true); // IFD0 pointer far past the end
  for (const segment of [cut, wild]) {
    const page = await sendOne(photoFile({ segments: [segment] }));
    assert.equal(page.rows().length, 1);
    assert.equal(page.rows()[0].captured_at, 1_790_000_000);
  }
});

// Where the upright picture's top-left, top-right and bottom-right corners
// are in the stored pixels (w x h), for each EXIF orientation. Pillow's
// exif_transpose agrees with these on the browser run.
const STORED_CORNERS = {
  1: (w, h) => [[0, 0], [w, 0], [w, h]],
  2: (w, h) => [[w, 0], [0, 0], [0, h]],
  3: (w, h) => [[w, h], [0, h], [0, 0]],
  4: (w, h) => [[0, h], [w, h], [w, 0]],
  5: (w, h) => [[0, 0], [0, h], [w, h]],
  6: (w, h) => [[0, h], [0, 0], [w, 0]],
  7: (w, h) => [[w, h], [w, 0], [0, 0]],
  8: (w, h) => [[w, 0], [w, h], [0, h]],
};

/** Where a draw put the source's upright corners on its canvas. */
function landed(canvas) {
  const [draw] = canvas.draws;
  const { source, w, h, matrix: [a, b, c, d, e, f] } = draw;
  const corners = source.known && !source.upright
    ? STORED_CORNERS[source.known.orientation](source.width, source.height)
    : STORED_CORNERS[1](source.width, source.height);
  return corners.map(([x, y]) => {
    const [X, Y] = [(x * w) / source.width, (y * h) / source.height];
    return [Math.round(a * X + c * Y + e), Math.round(b * X + d * Y + f)];
  });
}

test('every orientation arrives upright, whether or not the browser turns it as it decodes', async () => {
  for (const turns of [true, false]) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const across = orientation >= 5;
      // An upright 3024 x 4032 portrait, stored as the orientation says.
      const file = photoFile({ width: across ? 4032 : 3024, height: across ? 3024 : 4032, exif: { orientation } });
      const page = await sendOne(file, { turns });
      const label = `orientation ${orientation}, ${turns ? 'a browser that turns' : 'a browser that does not'}`;
      const [full, screen, grid] = page.canvases;
      assert.deepEqual([full.width, full.height, full.draws.length], [0, 0, 1], label); // emptied after use
      assert.deepEqual(landed(full), [[0, 0], [1920, 0], [1920, 2560]], label);
      for (const canvas of [screen, grid]) assert.deepEqual(canvas.draws[0].matrix, [1, 0, 0, 1, 0, 0], label);
      const row = page.rows()[0];
      assert.deepEqual([row.width, row.height, row.screen_width, row.screen_height, row.grid_width, row.grid_height], [1920, 2560, 1200, 1600, 360, 480], label);
    }
  }
});

test('the probe is asked once, and a browser that turns is never turned again', async () => {
  const page = await load();
  await joined(page);
  page.choose(...[6, 8, 5].map((orientation) => photoFile({ width: 4032, height: 3024, exif: { orientation } })));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  const probes = page.bitmaps.filter((b) => b.known.width === 2);
  assert.equal(probes.length, 1);
  for (const canvas of page.canvases.filter((c) => c.draws[0]?.source.known)) {
    assert.deepEqual(canvas.draws[0].matrix, [1, 0, 0, 1, 0, 0]);
  }
});

test('the three sizes are the caps\' long edges, never scaled up, and always one picture\'s shape to the server', async () => {
  const page = await load();
  await joined(page);
  // Shapes from a panorama to a sliver, big and small, odd sizes included.
  // The rounding itself was checked against sizesAgree over a million random
  // shapes on #155, with no disagreement; these run it through the page.
  const shapes = [[4032, 3024], [3024, 4032], [8000, 1000], [1000, 8000], [2561, 1441], [1601, 901], [481, 481], [300, 200], [1, 1], [4001, 3], [2559, 1919]];
  let seed = 155;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  for (let i = 0; i < 24; i++) shapes.push([1 + Math.floor(random() * 7000), 1 + Math.floor(random() * 7000)]);
  page.choose(...shapes.map(([width, height]) => photoFile({ width, height })));
  await until(() => page.items().every((i) => i.state === 'ready'), 'all ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.rows().length, shapes.length, 'the server took every one');
  for (const form of page.net.posted) {
    const dims = {};
    for (const size of Object.keys(SIZES)) {
      const file = form.get(size);
      assert.equal(file.type, 'image/jpeg');
      const read = readJpeg(new Uint8Array(await file.arrayBuffer()));
      dims[size] = { width: read.width, height: read.height };
      assert.ok(Math.max(read.width, read.height) <= SIZES[size].longEdge, size);
      assert.ok(file.size <= SIZES[size].maxBytes, size);
    }
    assert.ok(sizesAgree(dims), JSON.stringify(dims));
  }
  const byShape = (w, h) => page.rows().find((r) => r.width === w && r.height === h);
  assert.ok(byShape(2560, 1920) && byShape(1920, 2560), 'a 12 MP photo fills the full size\'s long edge');
  assert.ok(byShape(300, 200), 'a small photo is sent at its own size');
  assert.equal(byShape(300, 200).grid_width, 300);
});

test('the three JPEGs are asked of the canvas as JPEG, at quality 0.85 first', async () => {
  const page = await sendOne(photoFile());
  for (const canvas of page.canvases) {
    assert.equal(canvas.askedType, 'image/jpeg');
    assert.deepEqual(canvas.qualities, [0.85]);
  }
});

test('a size over its cap is made again at a lower quality until it fits', async () => {
  // The grid comes out at 200 KiB above quality 0.8: one step down fits it.
  const encoder = { extra: ({ width, quality }) => (width <= 480 && quality > 0.8 ? 200 * 1024 : 0) };
  const page = await sendOne(photoFile(), { encoder });
  const grid = page.canvases[2];
  assert.deepEqual(grid.qualities, [0.85, 0.75]);
  assert.ok(page.net.posted[0].get('grid').size <= SIZES.grid.maxBytes);
  assert.equal(page.rows().length, 1);
});

test('a photo that fits no cap at any quality, or a browser that hands back another type, is not sent', async () => {
  for (const encoder of [{ extra: () => 4 * 1024 * 1024 }, { type: 'image/png' }, { noContext: true }]) {
    const page = await sendOne(photoFile(), { encoder });
    const [item] = page.items();
    assert.equal(item.state, 'unreadable');
    assert.equal(item.text, "This browser couldn't get this photo ready to send, so it won't be sent. Try adding it from another browser.");
    assert.equal(page.net.posted.length, 0);
  }
});

test('photos are made ready one at a time, and every decoded photo and canvas is let go', async () => {
  const page = await load();
  await joined(page);
  page.choose(...Array.from({ length: 6 }, () => photoFile()));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  assert.equal(page.decoder.maxOpen, 1, 'more than one photo was decoded at once');
  assert.ok(page.bitmaps.every((b) => b.closed));
  assert.ok(page.canvases.every((c) => c.width === 0 && c.height === 0));
  assert.equal(page.canvases.length, 18);
});

test('the preview is the grid JPEG, with its own size', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile({ width: 3024, height: 4032 }));
  await until(() => page.items()[0].state === 'ready', 'ready');
  const { img } = page.items()[0];
  assert.equal(img.hidden, false);
  assert.deepEqual([img.width, img.height], [360, 480]);
  const blob = page.objectUrls.get(img.src);
  assert.deepEqual(readJpeg(new Uint8Array(await blob.arrayBuffer())).width, 360);
});

// ---- Criterion 3: a photo the browser cannot open ---------------------

test('a HEIC this browser cannot open says what to do instead, and the rest still send', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile(), heicFile(), photoFile({ width: 3000, height: 2000 }));
  await until(() => page.items().every((i) => i.state === 'ready' || i.state === 'unreadable'), 'prepared');
  const [, heic] = page.items();
  assert.equal(heic.state, 'unreadable');
  assert.equal(heic.text, "This browser can't open HEIC photos, so this one won't be sent. Add a JPEG copy of it instead. On an iPhone, choosing it from Photos rather than Files gives one.");
  assert.equal(heic.caption.hidden, true, 'no caption for a photo that will not send');
  assert.equal(heic.remove.hidden, false);
  assert.equal(page.summary(), "2 photos ready to send. 1 photo can't be sent from this browser.");
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.rows().length, 2);
  assert.equal(page.summary(), "Sent 2 photos. They'll appear in the album once they're reviewed. 1 photo can't be sent from this browser.");
});

test('HEIC is named by its type or its extension; anything else unopenable gets the plain message', async () => {
  const page = await load();
  await joined(page);
  page.choose(heicFile('photo.heif', ''), heicFile('IMG_2.jpg', 'image/heic'), heicFile('notes.jpg', 'image/jpeg'));
  await until(() => page.items().every((i) => i.state === 'unreadable'), 'refused');
  const texts = page.items().map((i) => i.text);
  assert.match(texts[0], /HEIC/);
  assert.match(texts[1], /HEIC/);
  assert.equal(texts[2], "This browser can't open this file as a photo, so it won't be sent. Add a JPEG copy of it instead.");
});

test('a photo the phone cannot hand over is not called a format problem, and says to add it again', async () => {
  // A picker entry for a file that has since gone (seen on #155's phone run)
  // or a cloud copy that fails to download: the bytes cannot be read at all.
  class GoneFile extends File {
    slice() {
      return { arrayBuffer: () => Promise.reject(new DOMException('The file could not be read.', 'NotReadableError')) };
    }
  }
  const page = await load();
  await joined(page);
  page.choose(new GoneFile([Uint8Array.of(1)], 'IMG_0002.HEIC', { type: 'image/heic' }), photoFile());
  await until(() => page.items().every((i) => i.state === 'ready' || i.state === 'unreadable'), 'prepared');
  const [gone] = page.items();
  assert.equal(gone.state, 'unreadable');
  assert.equal(gone.text, "Couldn't read this photo from the phone, so it won't be sent. Remove it, then add it again.");
  assert.equal(page.bitmaps.filter((b) => b.known !== described.get(sha(PROBE_BYTES))).length, 1, 'the unreadable one was decoded');
});

test('a caption being typed in when its photo turns out unreadable hands focus to its Remove', async () => {
  const page = await load({ slow: true });
  await joined(page);
  page.choose(heicFile());
  const [item] = page.items();
  page.click(item.caption);
  assert.equal(page.document.activeElement, item.caption);
  await until(() => page.decoder.waiting.length === 1, 'decode waiting');
  page.decode();
  await until(() => page.items()[0].state === 'unreadable', 'refused');
  assert.equal(item.caption.hidden, true);
  assert.equal(page.document.activeElement, item.remove, 'focus fell to the page with the caption hidden');
});

// ---- Criterion 4: 30 photos, three at a time, each showing its state ----

test('30 photos: no more than 3 upload at once, and each shows queued, sending or sent', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.choose(...Array.from({ length: 30 }, (_, i) => photoFile({ width: 4000 + i, height: 3000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  // Let the queue run: nothing starts a fourth while three are held.
  for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.net.waiting.length, 3);
  const states = page.items().map((i) => i.state);
  assert.equal(states.filter((s) => s === 'sending').length, 3);
  assert.equal(states.filter((s) => s === 'queued').length, 27);
  assert.deepEqual([...new Set(page.items().map((i) => i.text))].sort(), ['Queued', 'Sending…']);
  assert.equal(page.summary(), 'Sending 30 photos: 0 sent.');

  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(page.net.maxInFlight, 3);
  assert.equal(page.rows().length, 30);
  assert.ok(page.items().every((i) => i.state === 'sent' && i.text === 'Sent'));
});

const ANSWERS = [
  [() => 'network', "Failed. Couldn't reach the photo site. Check your signal, then try again."],
  [() => Response.json({ error: 'unavailable' }, { status: 503 }), "Failed. The photo site isn't taking photos right now. Try again in a few minutes."],
  [() => Response.json({ error: 'sizes' }, { status: 400 }), "Failed. The photo site couldn't take this photo. Try again, and if it fails again, leave it out."],
  [() => Response.json({ error: 'too-large', size: 'full' }, { status: 413 }), "Failed. The photo site couldn't take this photo. Try again, and if it fails again, leave it out."],
  [() => Response.json({ error: 'not-jpeg', size: 'grid' }, { status: 415 }), "Failed. The photo site couldn't take this photo. Try again, and if it fails again, leave it out."],
];

test('a failed upload says why and offers Try again, which sends it again in its first batch', async () => {
  for (const [answer, message] of ANSWERS) {
    const page = await load();
    await joined(page);
    page.net.intercept = (form, n) => (n === 2 ? answer() : undefined);
    page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
    page.click(page.$('send'));
    await settled(page);
    const failed = page.items().filter((i) => i.state === 'failed');
    assert.equal(failed.length, 1, message);
    assert.equal(failed[0].text, message);
    assert.equal(failed[0].tryAgain.hidden, false);
    assert.equal(page.summary(), 'Sent 2 of 3. 1 failed: press Try again on it.');
    const batch = page.rows()[0].batch;

    page.net.intercept = null;
    page.click(failed[0].tryAgain);
    assert.equal(page.document.activeElement, failed[0].caption, 'focus left the hidden Try again for the caption');
    await settled(page);
    assert.equal(page.rows().length, 3);
    assert.ok(page.rows().every((r) => r.batch === batch));
    assert.equal(page.summary(), "Sent 3 photos. They'll appear in the album once they're reviewed.");
  }
});

const TWO_ALBUMS = [
  { key: 'today', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0) },
  { key: 'past', title: 'Club race', kind: 'regatta', date: dayOffset(-3) },
];
const CLOSED = 'Failed. That album has closed. Choose another album above, then try again.';

test('an album closed while sending: every photo queued for it stops at once, and photos for another album still go', async () => {
  const page = await load({ hold: true, albums: TWO_ALBUMS });
  await joined(page);
  page.choose(...Array.from({ length: 6 }, (_, i) => photoFile({ width: 3000 + i, height: 2000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  // A second Send, for the other album, while the first three are held.
  page.$('album').value = page.made.past;
  page.choose(photoFile({ width: 2000, height: 3000 }), photoFile({ width: 2001, height: 3000 }));
  await until(() => page.items().slice(6).every((i) => i.state === 'ready'), 'two more ready');
  page.click(page.$('send'));
  page.env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE address = ?').run(page.made.today);
  page.net.hold = false;
  page.release();
  await settled(page);
  const items = page.items();
  assert.deepEqual(items.slice(0, 6).map((i) => i.text), new Array(6).fill(CLOSED));
  assert.deepEqual(items.slice(6).map((i) => i.state), ['sent', 'sent']);
  // The three held were refused; the three queued behind them were never
  // sent. Before the fix all six went, and each reloaded the list.
  assert.equal(page.net.posted.filter((f) => f.get('album') === page.made.today).length, 3);
  assert.equal(page.rows().length, 2);
  assert.ok(page.rows().every((r) => r.address === page.made.past));
  assert.ok(page.net.calls.filter((c) => c === 'GET /api/albums/open').length <= 4);
  assert.equal(page.$('album').value, page.made.past, 'a choice still open stays chosen');
});

test('after an album closes mid-send, nothing is preselected: Try again asks for an album first', async () => {
  const page = await load({ hold: true, albums: TWO_ALBUMS });
  await joined(page);
  page.choose(photoFile());
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 1, 'held');
  page.env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE address = ?').run(page.made.today);
  page.net.hold = false;
  page.release();
  await until(() => page.items()[0].state === 'failed', 'failed');
  assert.equal(page.items()[0].text, CLOSED);
  await until(() => !page.$('album').options.some((o) => o.value === page.made.today), 'the list reloaded without the closed album');
  assert.equal(page.$('album').options.length, 2);
  // Not quietly the past album: the parent picks where these photos go.
  assert.equal(page.$('album').value, '');
  assert.equal(page.$('album').options[0].textContent, 'Choose an album');
  page.click(page.items()[0].tryAgain);
  await tick();
  assert.equal(page.summary().startsWith('Choose an album first.'), true);
  assert.equal(page.items()[0].state, 'failed');
  assert.equal(page.net.posted.length, 1);
  page.$('album').value = page.made.past;
  page.click(page.items()[0].tryAgain);
  await settled(page);
  assert.equal(page.rows()[0].address, page.made.past);
});

// #223: a phone signed in to an account. The page has no code of its own for
// it: the session route answers 204 and the album list is the account's.
const BOTH_TEAMS = [
  { key: 'hoover', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0), team: 'hoover-jrt' },
  { key: 'cohssa', title: 'COHSSA scrimmage', kind: 'regatta', date: dayOffset(0), team: 'cohssa' },
];
const TEAM_REFUSED = "Failed. Your account can't send to that team's albums. Choose another album above, then try again.";
const signedIn = (page) => until(() => !page.$('sender').hidden && page.$('album').options.some((o) => o.value), 'signed in, albums listed');

test('signed in to an account, the page lists only its approved teams\' albums, and a photo sent records the account (#223, criteria 2 and 3)', async () => {
  const page = await load({ hash: '', session: 'account', albums: BOTH_TEAMS });
  await signedIn(page);
  assert.equal(page.$('join-status').textContent, "You're set to send photos from this phone.");
  assert.deepEqual(page.$('album').options.map((o) => o.value), [page.made.hoover], 'COHSSA is not this account\'s');
  page.choose(photoFile());
  await until(() => page.items()[0]?.state === 'ready', 'made ready');
  page.click(page.$('send'));
  await settled(page);
  const [row] = page.rows();
  assert.equal(page.rows().length, 1);
  assert.deepEqual({ address: row.address, account_id: row.account_id, sender: row.sender, code_generation: row.code_generation },
    { address: page.made.hoover, account_id: 1, sender: 'parent', code_generation: 0 });
  // The control: an account approved for both teams is offered both.
  const both = await load({ hash: '', session: 'account', albums: BOTH_TEAMS, accountTeams: ['hoover-jrt', 'cohssa'] });
  await signedIn(both);
  assert.deepEqual(both.$('album').options.map((o) => o.value).filter(Boolean).sort(), [both.made.cohssa, both.made.hoover].sort());
});

test('a team taken off the account while sending: every photo queued for its album stops with the team\'s words, and the list reloads without it (#223)', async () => {
  const page = await load({ hash: '', session: 'account', albums: BOTH_TEAMS, accountTeams: ['hoover-jrt', 'cohssa'], hold: true });
  await signedIn(page);
  page.$('album').value = page.made.cohssa;
  page.choose(...Array.from({ length: 4 }, (_, i) => photoFile({ width: 3000 + i, height: 2000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  page.env.DB.sqlite.prepare("UPDATE account_teams SET state = 'revoked' WHERE account_id = 1 AND team = 'cohssa'").run();
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.deepEqual(page.items().map((i) => i.text), new Array(4).fill(TEAM_REFUSED));
  // The three held were refused; the one queued behind them was never sent.
  assert.equal(page.net.posted.length, 3);
  assert.equal(page.rows().length, 0);
  await until(() => !page.$('album').options.some((o) => o.value === page.made.cohssa), 'the list reloaded without COHSSA');
  assert.equal(page.$('album').value, '', 'nothing preselected, as after a 409');
  assert.equal(page.items()[0].tryAgain.hidden, false);
});

test('an invite rotated mid-send: every queued photo stops at once, the status says why, and the new link carries on', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.choose(...Array.from({ length: 6 }, (_, i) => photoFile({ width: 3000 + i, height: 2000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  page.env.DB.sqlite.prepare('INSERT INTO invite_codes (generation, code, created_at) VALUES (3, ?, 1790000100)').run(NEXT);
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(page.net.posted.length, 3, 'the three queued behind a 401 were sent anyway');
  assert.ok(page.items().every((i) => i.text === 'Failed. Your sign-in or invite has ended. Sign in again, or open the newest invite link you were sent, then try again.'));
  assert.equal(page.$('join-status').textContent, 'Your sign-in or invite has ended. Sign in again, or open the newest invite link you were sent, then send again.');

  // The new link, opened in this tab, joins without a reload; the photos wait.
  page.location.hash = `#code=${NEXT}`;
  page.fireWindow('hashchange');
  await until(() => page.$('join-status').textContent.startsWith("You're set"), 'joined again');
  for (const item of page.items()) page.click(item.tryAgain);
  await settled(page);
  assert.equal(page.rows().length, 6);
  assert.ok(page.rows().every((r) => r.code_generation === 3));
});

test('a photo failed while it was still being made ready keeps its failure and its Try again once it is ready', async () => {
  // Found by the test above, which failed 2 runs in 3 before the fix: the
  // second photo came back "Ready to send", with no Try again, and was never
  // sent. Here the order is forced rather than left to timing.
  const page = await load({ slow: true });
  await joined(page);
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }));
  page.click(page.$('send'));
  await until(() => page.decoder.waiting.length === 1, 'the first decode waiting');
  page.env.DB.sqlite.prepare('INSERT INTO invite_codes (generation, code, created_at) VALUES (3, ?, 1790000100)').run(NEXT);
  page.decode();
  await until(() => page.items()[0].state === 'failed', 'the first sent and refused');
  const second = page.items()[1];
  assert.equal(second.state, 'failed', 'the queued photo was not failed with the first');
  await until(() => page.decoder.waiting.length === 1, 'the second decode waiting');
  page.decode();
  await until(() => !page.items()[1].img.hidden, 'the second made ready');
  await tick();
  const after = page.items()[1];
  assert.equal(after.state, 'failed');
  assert.equal(after.text, 'Failed. Your sign-in or invite has ended. Sign in again, or open the newest invite link you were sent, then try again.');
  assert.equal(after.tryAgain.hidden, false);

  page.location.hash = `#code=${NEXT}`;
  page.fireWindow('hashchange');
  await until(() => page.$('join-status').textContent.startsWith("You're set"), 'joined again');
  for (const item of page.items()) page.click(item.tryAgain);
  await settled(page);
  assert.equal(page.rows().length, 2);
});

test('a phone at the day\'s cap: the photo and every queued one fail, and nothing more is sent', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.net.intercept = () => Response.json({ error: 'daily-cap' }, { status: 429, headers: { 'Retry-After': '3600' } });
  page.choose(...Array.from({ length: 5 }, (_, i) => photoFile({ width: 3000 + i, height: 2000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(page.net.posted.length, 3);
  // The number is the server's own cap, so the message cannot drift from it.
  assert.ok(page.items().every((i) => i.text === `Failed. This phone, or your account, has sent today's limit of ${DAILY_UPLOADS} photos. Try again tomorrow.`));
});

test('the summary is a live region written once per change: choosing is one write, Send one, then each photo done', async () => {
  assert.match(HTML, /<p id="send-status" role="status"><\/p>/);
  const page = await load();
  await joined(page);
  const summary = page.$('send-status');
  // Every write to the region from here on, as a screen reader would get it.
  summary.history = [];
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  await tick();
  assert.deepEqual(summary.history, ['3 photos ready to send.'], 'choosing three photos wrote more than once');

  summary.history = [];
  page.net.hold = true;
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  assert.deepEqual(summary.history, ['Sending 3 photos: 0 sent.'], 'one press of Send wrote more than once');
  page.net.hold = false;
  page.release();
  await settled(page);
  await tick();
  const writes = summary.history;
  assert.equal(writes.at(-1), "Sent 3 photos. They'll appear in the album once they're reviewed.");
  // Two photos finishing in one turn are one write, so the count may skip a
  // number; it only ever goes up, and no write repeats the one before it.
  const counts = writes.slice(1, -1).map((text) => Number(/^Sending 3 photos: ([12]) sent\.$/.exec(text)?.[1]));
  assert.ok(counts.every((n, i) => n > (i ? counts[i - 1] : 0)), JSON.stringify(writes));
  for (let i = 1; i < writes.length; i++) assert.notEqual(writes[i], writes[i - 1], 'written again with the words it already held');
});

// ---- Criterion 5: leaving mid-send asks first; the end says how many ----

test('leaving while photos are queued or sending asks first, and not before Send or after the last', async () => {
  const page = await load({ hold: true });
  await joined(page);
  const leave = () => {
    const event = { returnValue: undefined, prevented: false, preventDefault() { this.prevented = true; } };
    page.fireWindow('beforeunload', event);
    return event.prevented && event.returnValue === '';
  };
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  assert.equal(leave(), false, 'chosen but not sent');
  assert.equal(page.$('keep-open').hidden, true);
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 2, 'held');
  assert.equal(leave(), true);
  assert.equal(page.$('keep-open').hidden, false);
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(leave(), false);
  assert.equal(page.$('keep-open').hidden, true);
  assert.equal(page.summary(), "Sent 2 photos. They'll appear in the album once they're reviewed.");
});

// ---- Criterion 6: an optional caption under each photo -----------------

test('each photo has its own caption field, labelled with the photo it belongs to, and a counter', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }));
  const [first, second] = page.items();
  assert.equal(first.label.textContent, 'Caption for photo 1 (optional)');
  assert.equal(second.label.textContent, 'Caption for photo 2 (optional)');
  assert.equal(first.label.getAttribute('for'), first.caption.id);
  assert.notEqual(first.caption.id, second.caption.id);
  assert.equal(first.caption.getAttribute('aria-describedby'), first.counter.id);
  // The page's limit is a copy of the server's: held equal here.
  assert.equal(first.counter.textContent, `0 of ${CAPTION_MAX}`);
  assert.equal(first.caption.type, 'text');
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  assert.equal(first.img.alt, 'Photo 1');
});

test('the counter counts characters as the server does, and stops at 200 without splitting an emoji', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile());
  const [item] = page.items();
  page.type(item.caption, '🌊'.repeat(150));
  assert.equal(item.counter.textContent, `150 of ${CAPTION_MAX}`);
  page.type(item.caption, '⛵'.repeat(CAPTION_MAX - 1) + '🌊🌊🌊');
  assert.equal([...item.caption.value].length, CAPTION_MAX);
  assert.equal(item.caption.value, '⛵'.repeat(CAPTION_MAX - 1) + '🌊');
  assert.equal(item.counter.textContent, `${CAPTION_MAX} of ${CAPTION_MAX}`);
});

test('a caption is sent as one line, trimmed, and stored as typed; an empty or blank one is not sent', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  const [first, second] = page.items();
  page.type(first.caption, `  Rounding the\twindward\nmark 🌊 <b>go</b>${String.fromCharCode(0x2028)}! `);
  page.type(second.caption, ' \t  ');
  page.click(page.$('send'));
  await settled(page);
  const expected = 'Rounding the windward mark 🌊 <b>go</b> !';
  // What the page sent, not only what the server kept: the server trims as
  // well, so a stored row alone could not tell whether the page did.
  const sent = page.net.posted.filter((f) => f.has('caption')).map((f) => f.get('caption'));
  assert.deepEqual(sent, [expected], 'a blank caption was sent, or one was sent untrimmed');
  assert.deepEqual(page.rows().map((r) => r.caption).sort(), [null, null, expected].sort());
});

test('a caption cannot change once its photo is sending or sent, and can again after a failure', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.net.intercept = () => Response.json({ error: 'unavailable' }, { status: 503 });
  page.choose(photoFile());
  const [item] = page.items();
  assert.equal(item.caption.readOnly, false);
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 1, 'held');
  assert.equal(item.caption.readOnly, true);
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(item.caption.readOnly, false);
  page.net.intercept = null;
  page.click(item.tryAgain);
  await settled(page);
  assert.equal(item.caption.readOnly, true);
});

// ---- Remove (owner's addition at #155's pickup) ------------------------

test('Remove takes a photo out before it sends, renumbers the rest, and moves focus to the next Remove', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  const [, second, third] = page.items();
  page.click(second.remove);
  assert.equal(page.items().length, 2);
  assert.equal(page.document.activeElement, third.remove);
  assert.equal(third.label.textContent, 'Caption for photo 2 (optional)');
  assert.equal(third.remove.getAttribute('aria-label'), 'Remove photo 2');
  assert.equal(page.objectUrls.has(second.img.src), false, 'its preview was let go');
  page.click(page.$('send'));
  await settled(page);
  // The 3000 x 2000 photo was removed; the landscape and the portrait went.
  assert.deepEqual(page.rows().map((r) => `${r.width}x${r.height}`).sort(), ['1707x2560', '2560x1920']);
});

test('a photo removed while it is still being made ready is never decoded or shown, and the last one hands focus to Add photos', async () => {
  // The list removal alone keeps a removed photo from being sent, so the
  // test has to look at the work makeReady skips: a photo removed before its
  // turn is never decoded, and one removed while it decodes never gets a
  // preview. Sending alone passed with both checks deleted (#155's review).
  const page = await load({ slow: true });
  await joined(page);
  page.choose(photoFile({ width: 4001, height: 3000 }), photoFile({ width: 4002, height: 3000 }), photoFile({ width: 4003, height: 3000 }));
  const [, second, third] = page.items();
  assert.equal(third.state, 'preparing');
  await until(() => page.decoder.waiting.length === 1, 'the first decode waiting');
  page.click(third.remove);
  page.decode();
  await until(() => page.items()[0].state === 'ready' && page.decoder.waiting.length === 1, 'the second decoding');
  page.click(second.remove);
  page.decode();
  // Wait for the second photo's work to finish, not for a number of turns:
  // its canvases are emptied only once its JPEGs are made. Counting turns
  // read before it finished, and so did counting decoded photos, since the
  // slow decoder holds a decode that was asked for (0 red, round two).
  await until(() => page.canvases.length === 6 && page.canvases.every((c) => c.width === 0), 'the second photo made and let go');
  await tick();
  await tick();
  assert.equal(page.decoder.waiting.length, 0, 'the photo removed before its turn was sent to be decoded');
  const decodedWidths = page.bitmaps.filter((b) => b.known !== described.get(sha(PROBE_BYTES))).map((b) => b.known.width).sort();
  assert.deepEqual(decodedWidths, [4001, 4002]);
  assert.ok(page.bitmaps.every((b) => b.closed));
  assert.equal(page.objectUrls.size, 1, 'the photo removed while decoding got a preview');
  assert.equal(second.img.src, undefined);
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.rows().length, 1);
  assert.equal(page.net.posted.length, 1);
  assert.equal(page.items()[0].state, 'sent');

  const alone = await load();
  await joined(alone);
  alone.choose(photoFile());
  await tick();
  assert.equal(alone.$('send').hidden, false);
  alone.click(alone.items()[0].remove);
  assert.equal(alone.document.activeElement, alone.$('photo-input'));
  await tick();
  assert.equal(alone.$('send').hidden, true);
});

test('Remove is offered until a photo starts sending, and a queued one removed never sends', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.choose(...Array.from({ length: 5 }, (_, i) => photoFile({ width: 3000 + i, height: 2000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  // Made ready and queued, so only the list stands between it and a slot:
  // a photo removed before it is made ready is also stopped by makeReady's
  // own check, which kept this test green with the list removal deleted.
  await until(() => page.items().every((i) => !i.img.hidden), 'all five made ready');
  const items = page.items();
  assert.deepEqual(items.map((i) => i.remove.hidden), [true, true, true, false, false]);
  page.click(items[4].remove);
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(page.net.posted.length, 4, 'the removed photo was posted');
  assert.equal(page.rows().length, 4);
  assert.ok(page.items().every((i) => i.remove.hidden), 'Remove offered on a sent photo');
});

// ---- #193: photos shared to the installed app from another app ----------
//
// share/sw.js keeps a share in IndexedDB, one record per file, and opens the
// page with ?shared. Each test hands the worker (test/worker.js) and the page
// one IndexedDB (test/idb.js), on the page's clock, so what the worker keeps
// is what the page reads. A record stays until its photo is stored or
// removed (owner, at #193's review).

const INBOX = 'madcow-shared';
const FILES = 'files';
const DAY = 24 * 60 * 60 * 1000;
const SHARED_FAILED = "The photos you shared couldn't be kept on this phone. Share them again.";
const SHARED_EMPTY = "No photos arrived with that share. Share them from your phone's gallery or Files app instead.";
const waiting = (n, noun = n === 1 ? 'it' : 'they') =>
  `${n} photo${n === 1 ? '' : 's'} you shared ${n === 1 ? 'is' : 'are'} waiting on this phone. ` +
  `Open your invite link, or sign in as a coach, and ${noun} will be ready to send. Shared photos are kept here for a day.`;

/** A gallery's share, kept by the worker on the page's clock: its answer. */
async function shareFrom(db, files, now = CLOCK) {
  return (await worker({ db, now }).fetch(share(files)));
}

const inboxFiles = (db) => db.rows(INBOX, FILES).map((r) => r.file);
const note = (page) => (page.$('shared-note').hidden ? null : page.$('shared-note').textContent);
// Three shapes whose stored full sizes differ (2560 x 1920, 1920 x 2560, 2560
// x 1280), so each row can be told apart from the others.
const SHAPES = [[4000, 3000], [3000, 4000], [4000, 2000]];
const shaped = (shapes) => shapes.map(([width, height]) => photoFile({ width, height }));
// The order the page made its photos ready in, which is the list's order:
// it makes one at a time, top to bottom. The orientation probe is left out.
const madeOrder = (page) => page.bitmaps.filter((b) => b.known.width > 2).map((b) => [b.known.width, b.known.height]);
const stored = (page) => page.rows().map((r) => [r.width, r.height]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('#193 criterion 2: photos shared from the gallery arrive ready to send, with nothing chosen again, and Send stores them', async () => {
  const db = idb();
  const answer = await shareFrom(db, shaped(SHAPES));
  assert.equal(answer.headers.get('Location'), 'https://photos.madcowsailing.com/share/?shared');

  // The browser follows the 303 to the share page, holding a session.
  const page = await load({ hash: '', search: '?shared', db, session: 'parent' });
  await joined(page);
  assert.equal(page.location.search, '', '?shared was left in the address bar');
  await until(() => page.items().length === 3 && page.items().every((i) => i.state === 'ready'), 'three ready');
  assert.equal(page.summary(), '3 photos ready to send.');
  assert.deepEqual(madeOrder(page), SHAPES, 'in the order they were shared');
  assert.equal(page.$('photo-input').files.length, 0, 'nothing was chosen in the picker');
  assert.equal(inboxFiles(db).length, 3, 'listed, and still in storage until each is stored');
  assert.equal(note(page), null);

  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(stored(page), [[1920, 2560], [2560, 1280], [2560, 1920]], 'each shared photo stored as its own');
  await until(() => inboxFiles(db).length === 0, 'each record deleted once its photo was stored');
  const rows = page.rows();
  assert.ok(rows.every((r) => r.address === page.made.today && r.state === 'pending' && r.sender === 'parent'));
  assert.equal(new Set(rows.map((r) => r.batch)).size, 1, 'one press of Send, one batch');
});

test('#193 criterion 3: with no session the shared photos wait and the page says how to sign in; after the coach signs in they are there, ready to send', async () => {
  const db = idb();
  await shareFrom(db, shaped(SHAPES.slice(0, 2)));

  // No session: /api/upload/session answers 401.
  const before = await load({ hash: '', search: '?shared', db });
  await until(() => note(before) !== null, 'the note');
  assert.equal(before.$('join-status').textContent, 'Sign in, or open the invite link you were sent, to start sending photos to the team.');
  assert.equal(note(before), waiting(2));
  assert.equal(before.$('sender').hidden, true);
  assert.equal(before.items().length, 0);
  assert.equal(inboxFiles(db).length, 2, 'the photos stayed in storage');
  assert.match(HTML, /<a href="\/coach">Sign in at \/coach<\/a>/, 'the page carries the way to sign in');
  assert.match(HTML, /<p id="shared-note" role="status" hidden><\/p>/, 'the note is a live region, hidden until written');

  // /coach signs the coach in and sends the browser back to /share/, with no ?shared.
  const after = await load({ hash: '', db, session: 'coach' });
  await joined(after);
  await until(() => after.items().length === 2 && after.items().every((i) => i.state === 'ready'), 'two ready');
  assert.equal(note(after), null);
  assert.equal(inboxFiles(db).length, 2, 'still in storage until sent');
  after.click(after.$('send'));
  await settled(after);
  assert.deepEqual(stored(after), [[1920, 2560], [2560, 1920]]);
  assert.ok(after.rows().every((r) => r.sender === 'coach'), 'sent as the coach');
  await until(() => inboxFiles(db).length === 0, 'records deleted once stored');
});

test('#193 criterion 3, a parent: opening the invite link in the same tab takes the waiting photos in', async () => {
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]));
  const page = await load({ hash: '', search: '?shared', db });
  await until(() => note(page) !== null, 'the note');
  assert.equal(note(page), waiting(1));
  page.location.hash = `#code=${CODE}`;
  page.fireWindow('hashchange');
  await joined(page);
  await until(() => page.items().length === 1 && page.items()[0].state === 'ready', 'one ready');
  assert.equal(note(page), null);
  assert.equal(inboxFiles(db).length, 1, 'listed, and kept until sent');
});

test('#193: two shares are taken in the order they were shared, oldest first, and each share\'s files in order', async () => {
  // Storage answers in key order, and the worker's keys are random, so the
  // records are seeded in its shape with keys that sort the newer share
  // first, and within the older share the second file first: a page that
  // trusted key order would offer them in the wrong order every run, not
  // every other run.
  const db = idb();
  const [first, second, third] = shaped(SHAPES);
  db.seed(INBOX, FILES, 'id', [
    { id: '00000000-0000-4000-8000-000000000001', share: 'b', index: 0, at: CLOCK - 60_000, file: third },
    { id: 'eeeeeeee-eeee-4eee-beee-eeeeeeeeeeee', share: 'a', index: 1, at: CLOCK - 120_000, file: second },
    { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff', share: 'a', index: 0, at: CLOCK - 120_000, file: first },
  ]);
  const page = await load({ hash: '', db, session: 'parent' });
  await until(() => page.items().length === 3 && page.items().every((i) => i.state === 'ready'), 'three ready');
  assert.deepEqual(madeOrder(page), SHAPES);
});

test('#193: a share over a day old is forgotten, not offered, with or without a session', async () => {
  for (const session of [null, 'parent']) {
    const db = idb();
    await shareFrom(db, shaped([SHAPES[0]]), CLOCK - DAY - 1);
    await shareFrom(db, shaped([SHAPES[1]]), CLOCK - DAY);
    const page = await load({ hash: '', db, session });
    if (session) {
      await joined(page);
      await until(() => page.items().length === 1 && page.items()[0].state === 'ready', 'one ready');
      assert.deepEqual(madeOrder(page), [SHAPES[1]], 'the day-old share is offered, the older one not');
      assert.equal(inboxFiles(db).length, 1, 'the share over a day old was deleted; the offered one waits until sent');
    } else {
      await until(() => note(page) !== null, 'the note');
      assert.equal(note(page), waiting(1), 'the day-old share is counted, the older one not');
      assert.equal(inboxFiles(db).length, 1, 'the share over a day old was deleted');
    }
  }
});

test('#193: ?shared=failed says to share again, with or without a session, and nothing else is claimed', async () => {
  const lone = await load({ hash: '', search: '?shared=failed', db: idb() });
  await until(() => note(lone) !== null, 'the note');
  assert.equal(note(lone), SHARED_FAILED);
  assert.equal(lone.location.search, '');

  const signed = await load({ hash: '', search: '?shared=failed', db: idb(), session: 'coach' });
  await joined(signed);
  await until(() => note(signed) !== null, 'the note');
  assert.equal(note(signed), SHARED_FAILED);
  assert.equal(signed.items().length, 0);
});

test('#193: storage that cannot be read after a share says to share again; without a share it says nothing', async () => {
  const broken = () => idb({ fail: { open: new DOMException('Blocked', 'UnknownError') } });
  const shared = await load({ hash: '', search: '?shared', db: broken(), session: 'parent' });
  await joined(shared);
  await until(() => note(shared) !== null, 'the note');
  assert.equal(note(shared), SHARED_FAILED);

  // "Says nothing" is read only once the failed read has answered and the
  // page has had its turns to act on it: twenty turns alone could finish
  // inside the stand-in's timer, before the read failed (#193's mutation
  // round: a page saying "failed" here read 0 red against 1 predicted).
  const settledRead = async (page) => {
    await until(() => page.db.state.answered >= 1, 'the storage read answered');
    for (let i = 0; i < 20; i++) await tick();
  };
  const plain = await load({ hash: '', db: broken(), session: 'parent' });
  await joined(plain);
  await settledRead(plain);
  assert.equal(note(plain), null);
  assert.equal(plain.$('sender').hidden, false, 'the page still sends');

  // The same two, with no session: the note is written while the page waits.
  const waitingShared = await load({ hash: '', search: '?shared', db: broken() });
  await until(() => note(waitingShared) !== null, 'the note');
  assert.equal(note(waitingShared), SHARED_FAILED);
  const waitingPlain = await load({ hash: '', db: broken() });
  await until(() => waitingPlain.$('join-status').textContent.startsWith('Sign in, or open the invite link'), 'no session');
  await settledRead(waitingPlain);
  assert.equal(note(waitingPlain), null);
});

test('#193: the page registers the worker for /share/ only, checked for updates past the browser\'s cache', async () => {
  const page = await load();
  await joined(page);
  // As plain data: the options object was made inside the page's context.
  assert.deepEqual(JSON.parse(JSON.stringify(page.registrations)), [{ url: '/share/sw.js', options: { scope: '/share/', updateViaCache: 'none' } }]);
});

test('#193: a browser that refuses the worker, has no service workers at all, or has no IndexedDB, still joins and sends', async () => {
  for (const options of [{ register: 'refused' }, { register: 'absent' }, {}]) {
    const page = await load(options);
    await joined(page);
    page.choose(photoFile());
    await until(() => page.items()[0]?.state === 'ready', 'ready');
    page.click(page.$('send'));
    await settled(page);
    assert.equal(page.rows().length, 1);
    assert.equal(note(page), null);
  }
});

test('#193: a share that carried no photos (Chrome\'s own) says to share from the gallery, with or without a session', async () => {
  const db = idb();
  const answer = await worker({ db, now: CLOCK }).fetch(share([]));
  assert.equal(answer.headers.get('Location'), 'https://photos.madcowsailing.com/share/?shared=empty');
  for (const session of [null, 'coach']) {
    const page = await load({ hash: '', search: '?shared=empty', db, session });
    if (session) await joined(page);
    await until(() => note(page) !== null, 'the note');
    assert.equal(note(page), SHARED_EMPTY, String(session));
    assert.equal(page.location.search, '');
    assert.equal(page.items().length, 0);
  }
});

test('#193 (review): a second share before Send keeps the first: the new page offers both, oldest first, and Send stores them all', async () => {
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]), CLOCK - 60_000);
  const first = await load({ hash: '', search: '?shared', db, session: 'parent' });
  await until(() => first.items().length === 1 && first.items()[0].state === 'ready', 'the first share ready');
  // A second share navigates the app: a new page on the same storage.
  await shareFrom(db, shaped(SHAPES.slice(1)), CLOCK - 30_000);
  const second = await load({ hash: '', search: '?shared', db, session: 'parent' });
  await until(() => second.items().length === 3 && second.items().every((i) => i.state === 'ready'), 'both shares ready');
  assert.deepEqual(madeOrder(second), SHAPES);
  second.click(second.$('send'));
  await settled(second);
  assert.deepEqual(stored(second), [[1920, 2560], [2560, 1280], [2560, 1920]]);
  await until(() => inboxFiles(db).length === 0, 'records deleted once stored');
});

test('#193 (review): Remove deletes a shared photo\'s record, so the next load does not offer it; the other stays', async () => {
  const db = idb();
  await shareFrom(db, shaped(SHAPES.slice(0, 2)));
  const page = await load({ hash: '', search: '?shared', db, session: 'parent' });
  await until(() => page.items().length === 2 && page.items().every((i) => i.state === 'ready'), 'two ready');
  page.click(page.items()[0].remove);
  await until(() => inboxFiles(db).length === 1, 'the removed photo\'s record deleted');
  const again = await load({ hash: '', db, session: 'parent' });
  await until(() => again.items().length === 1 && again.items()[0].state === 'ready', 'one offered again');
  assert.deepEqual(madeOrder(again), [SHAPES[1]]);
});

test('#193 (review): a shared photo whose upload fails stays in storage, and the next load offers it again', async () => {
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]));
  const page = await load({ hash: '', search: '?shared', db, session: 'parent' });
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.net.intercept = () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].state, 'failed');
  // The next load's read is queued behind anything the failure started on
  // the store, so it sees the store as the failure left it.
  const again = await load({ hash: '', db, session: 'parent' });
  await until(() => again.items()[0]?.state === 'ready', 'offered again');
  assert.equal(inboxFiles(db).length, 1);
});

test('#193 (review): joining again on an open page does not list a shared photo twice', async () => {
  const db = idb();
  await shareFrom(db, shaped(SHAPES.slice(0, 2)));
  const page = await load({ hash: '', search: '?shared', db, session: 'parent' });
  await until(() => page.items().length === 2 && page.items().every((i) => i.state === 'ready'), 'two ready');
  // Waited for by the store closing, after the read's transaction commits:
  // the read opening is too early, since a duplicate would be added only
  // once it answers (#193's round-2 mutation: dropping the dedupe read 0 red
  // here when this waited on the open).
  const closes = page.db.state.closes;
  page.location.hash = `#code=${CODE}`;
  page.fireWindow('hashchange');
  await until(() => page.db.state.closes > closes, 'the rejoin read finished');
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(page.items().length, 2);
});

test('#193 (review): two sessions answering at once (the stored one, and an invite opened in the same moment) list a shared photo once', async () => {
  const db = idb();
  await shareFrom(db, shaped(SHAPES.slice(0, 2)));
  const closes = db.state.closes;
  const page = await load({ hash: '', search: '?shared', db, session: 'parent' });
  // The invite link is opened before the page's own session check answers,
  // so two "ready"s arrive close together and each asks for the shared
  // photos. IndexedDB runs the two reads in order (test/idb.js keeps that),
  // and the dedupe is what stops the second listing them again.
  page.location.hash = `#code=${CODE}`;
  page.fireWindow('hashchange');
  await until(() => page.items().length >= 2 && page.items().every((i) => i.state === 'ready'), 'ready');
  await until(() => db.state.closes >= closes + 2, 'both reads finished');
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(page.items().length, 2);
});

test('#193: while an invite is opening, the page does not read the store or describe a share as waiting', async () => {
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]));
  const opensBefore = db.state.opens;
  const page = await load({ hash: `#code=${CODE}`, db, holdJoin: true });
  await until(() => page.$('join-status').textContent === 'Opening your invite…', 'joining');
  // A read would open the store synchronously, and a note would follow it
  // within a few of the stand-in's timer turns; 100 ms outlasts both.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(db.state.opens, opensBefore, 'the page read the store while joining');
  assert.equal(note(page), null);
  page.releaseJoin();
  await joined(page);
  await until(() => page.items()[0]?.state === 'ready', 'taken in once joined');
});
