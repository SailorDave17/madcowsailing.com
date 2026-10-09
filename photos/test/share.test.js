// The share page's script (#155, with #150's status line): making each chosen
// photo's three JPEGs and sending them. public/js/share.js runs here in
// node:vm against hand-written stand-ins for the DOM, the canvas and the
// browser's image decoder, the repo's way with a page script since #152. Its
// fetch goes through the same chains Pages runs, into the real routes, a real
// SQLite holding the real migrations (test/d1.js) and an R2 stand-in
// (test/r2.js). So a photo this page sends is a photo the server stores, and
// the contract between them (seconds not milliseconds, a lowercase batch,
// three sizes of one shape) is tested from both ends at once. Since #198 the
// same holds for a clip: test/mp4.js's byte-built clips go through
// js/clip.js's walker on the page and the real clip routes into the bucket.
//
// The stand-ins cannot show pixels. The browser runs on #155's pull request
// do: Chrome 154 against a local copy of the site, the stored JPEGs read back
// and their corners checked for colour.
//
// The phone sends from an account (#223) unless a test says otherwise: since
// #226 that is the only session there is. Until then the page opened with an
// invite link (/share/#code=…) and joined through POST /api/join, and these
// tests did too; an old link now only says it was replaced (#226, criterion
// 3).
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
import { onRequest as uploadGuard } from '../functions/api/upload/_middleware.js';
import { onRequestPost as clipStartRoute } from '../functions/api/upload/clips/index.js';
import { onRequestDelete as clipAbandonRoute } from '../functions/api/upload/clips/[id]/index.js';
import { onRequestPost as clipCompleteRoute } from '../functions/api/upload/clips/[id]/complete.js';
import { onRequestPut as clipPartRoute } from '../functions/api/upload/clips/[id]/parts/[n].js';
import { onRequestPost as uploadRoute } from '../functions/api/upload/index.js';
import { onRequestGet as sessionRoute } from '../functions/api/upload/session.js';
import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import { clipLength } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { STALE_SECONDS, clearStaleClips } from '../lib/clips.js';
import { readJpeg } from '../lib/jpeg.js';
import {
  CAPTION_MAX, CLIP_BYTES, CLIP_DAY_BYTES, CLIP_SECONDS, DAILY_UPLOADS, SIZES, clipObjectKey, sizesAgree,
} from '../lib/photos.js';
import { nowSeconds } from '../lib/session.js';
import { PART_BYTES, partCount, partPieces, planClip } from '../public/js/clip.js';
import { d1 } from './d1.js';
import { idb } from './idb.js';
import { exif, exifWith, jpeg, metadataMarkers, withSegments, xmp } from './jpeg.js';
import { UPLOAD_COOKIE, parentCookie } from './legacy-cookies.js';
import { RECORDED, SINCE_1904, androidMp4, iphoneMov, mvhd, plainClip, rawTrailer } from './mp4.js';
import { r2 } from './r2.js';
import { share, worker } from './worker.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const SCRIPT = read('public', 'js', 'share.js');
const HTML = read('public', 'share', 'index.html');
const CLIP_SCRIPT = readFileSync(join(ROOT, 'public', 'js', 'clip.js'));

// The clip routes (#198), served by pattern, since their paths carry the
// upload's id and the part's number: the step's name, its method, its path,
// and the route behind it.
const CLIP_ROUTES = [
  ['start', 'POST', /^\/api\/upload\/clips$/, clipStartRoute],
  ['part', 'PUT', /^\/api\/upload\/clips\/([^/]+)\/parts\/([^/]+)$/, clipPartRoute],
  ['complete', 'POST', /^\/api\/upload\/clips\/([^/]+)\/complete$/, clipCompleteRoute],
  ['abandon', 'DELETE', /^\/api\/upload\/clips\/([^/]+)$/, clipAbandonRoute],
];

const SITE = 'https://photos.madcowsailing.com';
// An old invite link's code, as /share/#code=<code> carried it until #226.
const CODE = 'K7QM-3XRD-9FWB';
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
 * `session` is the session this browser already holds when the page opens:
 * 'account' (the default), signed in at /sign-in to account 1, approved for
 * `accountTeams` with `role` (#223), or null for none. Both teams by
 * default, so every album a test makes is offered, as the invite link
 * offered every one until #226. `upload` puts the upload cookie the invite
 * link or a coach's sign-in set until #226 in the browser's jar too.
 *
 * For the installed app (#193): `search` is the address's query (share/sw.js
 * sends ?shared), `db` the browser's IndexedDB (none by default, as in a
 * browser without it), `register` how the browser answers the worker's
 * registration ('ok', 'refused', or 'absent' for a browser with no service
 * workers at all), and `holdSession` holds GET /api/upload/session until
 * page.releaseSession().
 *
 * Every database holds each team's "Not sure / other event" album, open
 * (migration 0015, #228); `made.notSure` names them by team. `notSure: false`
 * closes both before the page opens, for a site with nothing open at all.
 *
 * For clips (#198): the page has js/clip.js's four as the module puts them
 * on window, planClip counted in `page.walker.plans`. `net.clipCalls` holds
 * every request to the clip routes ({ step, id, n, attempt, bytes, body,
 * token, aborted }), `net.clipIntercept(call)` answers one instead of the
 * route (a Response; 'network', no answer; or 'lost', the route run and its
 * answer lost on the way back), and `net.clipHold(call)` holds one until
 * page.releaseClip(), or until the page aborts it. `timers: 'fast'` gives the
 * page a setTimeout that waits no time, and `timers: 'held'` one that never
 * fires; either records each wait asked for in `page.waits`.
 */
async function load({
  hash = '', albums = null, turns = true, encoder = {}, hold = false, slow = false,
  search = '', db = null, session = 'account', register = 'ok', holdSession = false,
  accountTeams = ['hoover-jrt', 'cohssa'], role = 'parent', upload = null, notSure = true, timers = 'real',
} = {}) {
  const env = { DB: d1(), MEDIA: r2(), SITE_ENV: 'production', ...KEYS };
  const now = Math.floor(Date.now() / 1000);
  const made = {};
  // Hoover JRT's unless an album names its team (#227).
  for (const album of albums ?? [{ key: 'today', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0) }]) {
    made[album.key] = await createAlbum(env.DB, { team: 'hoover-jrt', ...album }, now);
  }
  made.notSure = Object.fromEntries(env.DB.sqlite.prepare('SELECT team, address FROM albums WHERE holding = 1').all().map((r) => [r.team, r.address]));
  if (!notSure) env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE holding = 1').run();

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
  // `asked` counts every decode asked for, the probe's and a refused one's.
  const decoder = { turns, open: 0, maxOpen: 0, waiting: [], asked: 0 };
  const probeKnown = described.get(sha(PROBE_BYTES));
  async function createImageBitmap(blob) {
    decoder.asked += 1;
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
  // browser's cookie jar and its Origin on a POST. It serves only the routes
  // the page may ask for; anything else, POST /api/join among them since
  // #226, throws, and every request is in net.calls either way.
  const jar = new Map();
  const net = {
    posted: [], inFlight: 0, maxInFlight: 0, waiting: [], hold, intercept: null, albumsAnswer: null, sessionAnswer: null, calls: [], cookies: [],
    clipCalls: [], clipIntercept: null, clipHold: null, clipWaiting: [], clipsInFlight: 0, maxClipsInFlight: 0,
  };
  const run = (handlers, request, params = {}) => {
    const data = {};
    const step = (i) => handlers[i]({ request, env, data, params, waitUntil() {}, next: () => step(i + 1) });
    return step(0);
  };
  const aborted = () => new DOMException('This operation was aborted', 'AbortError');
  // A held clip request: it goes on when page.releaseClip() lets it, and a
  // page that aborts it meanwhile gets an AbortError, as from a browser.
  const held = (call, signal) => new Promise((resolve, reject) => {
    const go = () => resolve();
    net.clipWaiting.push(go);
    signal?.addEventListener('abort', () => {
      const at = net.clipWaiting.indexOf(go);
      if (at === -1) return;
      net.clipWaiting.splice(at, 1);
      call.aborted = true;
      reject(aborted());
    });
  });
  async function fetch(path, init = {}) {
    const method = init.method ?? 'GET';
    net.calls.push(`${method} ${path}`);
    const headers = new Headers(init.headers ?? {});
    if (method !== 'GET') headers.set('Origin', SITE);
    headers.set('CF-Connecting-IP', '203.0.113.7');
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    // A browser sends a Blob's length (a clip's part, #198), and the part
    // route reads it before any byte. Other bodies are counted as they come.
    if (init.body instanceof Blob) headers.set('Content-Length', String(init.body.size));
    net.cookies.push(headers.get('Cookie'));
    const request = new Request(`${SITE}${path}`, { method, headers, body: init.body });
    const clip = CLIP_ROUTES.find(([, verb, pattern]) => verb === method && pattern.test(path));
    let response;
    if (clip) {
      const [step, , pattern, route] = clip;
      const [, id, n] = pattern.exec(path);
      const call = {
        step, id: id === undefined ? null : Number(id), n: n === undefined ? null : Number(n), aborted: false,
        bytes: init.body instanceof Blob ? init.body.size : null, token: headers.get('Clip-Upload'),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      };
      call.attempt = net.clipCalls.filter((c) => c.step === step && c.id === call.id && c.n === call.n).length + 1;
      net.clipCalls.push(call);
      net.inFlight += 1;
      net.clipsInFlight += 1;
      net.maxInFlight = Math.max(net.maxInFlight, net.inFlight);
      net.maxClipsInFlight = Math.max(net.maxClipsInFlight, net.clipsInFlight);
      try {
        if (init.signal?.aborted) throw aborted();
        if (net.clipHold?.(call)) await held(call, init.signal);
        const canned = net.clipIntercept?.(call);
        if (canned === 'network') throw new TypeError('Failed to fetch');
        const params = { ...(id === undefined ? {} : { id }), ...(n === undefined ? {} : { n }) };
        if (canned === 'lost') {
          await run([root, ...uploadGuard, route], request, params);
          throw new TypeError('Failed to fetch');
        }
        response = canned ?? await run([root, ...uploadGuard, route], request, params);
      } finally {
        net.inFlight -= 1;
        net.clipsInFlight -= 1;
      }
    } else if (path === '/api/upload') {
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
    } else if (path === '/api/upload/session') {
      if (holdSession) await new Promise((resolve) => { net.sessionHeld = resolve; });
      const canned = net.sessionAnswer?.();
      if (canned === 'network') throw new TypeError('Failed to fetch');
      response = canned ?? await run([root, ...uploadGuard, sessionRoute], request);
    } else if (path === '/api/albums/open') {
      const canned = net.albumsAnswer?.();
      if (canned === 'network') throw new TypeError('Failed to fetch');
      response = canned ?? await run([root, albumsGuard, openAlbumsRoute], request);
    }
    else throw new Error(`the page fetched ${path}, which this stand-in does not serve`);
    // Each Set-Cookie as a browser takes it: Max-Age=0 deletes the cookie.
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const at = pair.indexOf('=');
      if (attributes.some((a) => /^\s*Max-Age=0\s*$/i.test(a))) jar.delete(pair.slice(0, at));
      else jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }

  // A session this browser already holds: account 1, approved for
  // `accountTeams` with `role` (#223), as /sign-in leaves the cookie.
  if (session === 'account') {
    env.DB.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('pat@example.org', 'Pat Parent', ?, 1)").run(role);
    for (const team of accountTeams) {
      env.DB.sqlite.prepare("INSERT INTO account_teams (account_id, team, state) VALUES (1, ?, 'approved')").run(team);
    }
    jar.set(ACCOUNT_COOKIE, await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 1, version: 1 }, nowSeconds()));
  } else assert.equal(session, null, `no such session: ${session}`);
  if (upload) jar.set(UPLOAD_COOKIE, upload);

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

  // js/clip.js's four, as the module puts them on window for the page to
  // find (#198), with planClip counted so a test sees what reached it.
  const walker = { plans: 0 };
  const MadcowClip = Object.freeze({
    PART_BYTES, partCount, partPieces,
    planClip: (...args) => {
      walker.plans += 1;
      return planClip(...args);
    },
  });
  const waits = [];
  const pageTimeout = {
    real: setTimeout,
    fast: (fn, ms) => {
      waits.push(ms);
      return setTimeout(fn, 0);
    },
    held: (fn, ms) => {
      waits.push(ms);
      return -1;
    },
  }[timers];

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
    URLSearchParams, Blob, File, FormData, crypto, atob, console, setTimeout: pageTimeout, clearTimeout,
    AbortController, MadcowClip,
    Date: PageDate,
    navigator,
    ...(db ? { indexedDB: db.indexedDB } : {}),
  };
  vm.runInNewContext(SCRIPT, context);

  const $ = (id) => document.byId.get(id);
  const page = {
    env, made, net, jar, decoder, bitmaps, canvases, objectUrls, location, document, $, registrations, db, walker, waits,
    // Each photo's or clip's list item, read back into what a visitor sees.
    // `status` is the element `text` is read from; `frame` holds a photo's
    // preview, or a clip's name and length (#198).
    items: () => $('photo-list').children.map((li) => {
      const [frame, state, label, caption, counter, actions] = li.children;
      const [tryAgain, remove] = actions.children;
      return { li, state: li.getAttribute('data-state'), text: state.textContent, status: state, frame, img: frame.children[0], label, caption, counter, tryAgain, remove };
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
    releaseClip(n = Infinity) {
      for (let i = 0; i < n && net.clipWaiting.length; i++) net.clipWaiting.shift()();
    },
    // The day's uploads spent, every session's together, and the bucket's
    // multipart uploads, for a clip's tests.
    sentToday: () => env.DB.sqlite.prepare('SELECT COALESCE(SUM(sent), 0) AS n FROM upload_counts').get().n,
    uploads: () => [...env.MEDIA.uploads.values()],
    decode: () => decoder.waiting.shift()(),
    releaseSession: () => net.sessionHeld(),
    // Signed in again elsewhere, as another tab at /sign-in would leave this
    // browser's jar: account 1 at `version`.
    signIn: async (version) => jar.set(ACCOUNT_COOKIE, await signAccountSession(KEYS.SESSION_SIGNING_KEY, { accountId: 1, version }, nowSeconds())),
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
// sent means nothing if it is read while that upload could still land. A
// clip's requests count as in flight too (#198), and a clip Remove is still
// asking about is not done, between the tries of its question too (#198's
// review). It is read at once, so a press that starts a request only some
// turns later (Remove during a clip's wait between tries) needs its own wait
// for that request.
const settled = (page) => until(
  () => page.net.inFlight === 0 && page.items().every((i) => !['preparing', 'queued', 'sending', 'checking'].includes(i.state)),
  'every photo settled, nothing in flight',
);
// The phone holds a session and the albums are listed. Named for #150's join
// step, whose element ids the status line keeps (#226).
const joined = async (page) => {
  await until(() => page.$('join-status').textContent.startsWith("You're set"), 'ready to send');
  await until(() => page.$('album').options.some((o) => o.value), 'albums listed');
};

// What the status line says (share.js, MESSAGES), written out so a change to
// the words shows here. Since #226: no session, an old invite link with none
// and with one, and a session that ended.
const NONE = 'Sign in to start sending photos to the team, or ask for an account if you have none.';
const REPLACED = "The team's invite link has been replaced by accounts. Sign in, or ask for an account below, to send photos.";
const READY_REPLACED = "That invite link has been replaced by accounts. This phone is signed in, so you're set to send photos.";
const ENDED = 'Your sign-in has ended. Sign in again, then send again.';
const FAILED_ENDED = 'Failed. Your sign-in has ended. Sign in again, then try again.';

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

// ---- Criterion 1: "Add photos", choose, "Send", nothing typed ----------

test('a parent signed in sends 10 photos with "Add photos", choosing them and "Send": today\'s album, nothing typed', async () => {
  const page = await load({
    albums: [
      { key: 'future', title: 'Fall Regatta', kind: 'regatta', date: dayOffset(5) },
      { key: 'today', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0) },
      { key: 'past', title: 'Club race', kind: 'regatta', date: dayOffset(-3) },
    ],
  });
  await joined(page);
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
  // The session is asked about first, and every post is a photo: the page
  // posted to /api/join first until #226.
  assert.equal(page.net.calls[0], 'GET /api/upload/session');
  assert.deepEqual([...new Set(page.net.calls.filter((c) => c.startsWith('POST')))], ['POST /api/upload']);
  assert.ok(page.rows().every((r) => r.account_id === 1), 'sent as the account');
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
    // Each team's Not sure album too (#228), never preselected.
    assert.equal(select.options.filter((o) => o.value).length, albums.length + 2, 'every open album stays in the list');
    assert.notEqual(select.value, page.made.notSure['hoover-jrt']);
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
  // Each group ends with its team's "Not sure / other event" (#228).
  assert.deepEqual(groups.map((g) => g.children.map((o) => o.value)), [
    [page.made.districts, page.made.league, page.made.notSure.cohssa],
    [page.made.today, page.made.past, page.made.notSure['hoover-jrt']],
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
  // Hoover JRT has no event open, so its group holds only its Not sure
  // choice (#228), after the teams with events.
  assert.deepEqual(select.children.map((c) => [c.tagName, c.tagName === 'OPTION' ? c.textContent : c.getAttribute('label')]),
    [['OPTION', 'Choose an album'], ['OPTGROUP', 'COHSSA'], ['OPTGROUP', 'Hoover JRT']]);
  assert.equal(select.value, '');
});

test('#228 criterion 1: each team\'s "Not sure / other event" comes after its events, is never preselected, and a photo sent there waits in it', async () => {
  // Only a future event: nothing is preselected, although the Not sure
  // albums are dated 0001-01-01, before any "latest past" album.
  const page = await load({ albums: [{ key: 'future', title: 'Next week', kind: 'regatta', date: dayOffset(3) }] });
  await joined(page);
  const select = page.$('album');
  const groups = select.children.filter((c) => c.tagName === 'OPTGROUP');
  assert.deepEqual(groups.map((g) => [g.getAttribute('label'), g.children.map((o) => o.value)]), [
    ['Hoover JRT', [page.made.future, page.made.notSure['hoover-jrt']]],
    ['COHSSA', [page.made.notSure.cohssa]],
  ]);
  assert.deepEqual(select.options.filter((o) => Object.values(page.made.notSure).includes(o.value)).map((o) => o.textContent),
    ['Not sure / other event', 'Not sure / other event']);
  assert.equal(select.value, '');
  select.value = page.made.notSure['hoover-jrt'];
  page.choose(photoFile());
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  const [row] = page.rows();
  assert.deepEqual({ address: row.address, state: row.state }, { address: page.made.notSure['hoover-jrt'], state: 'pending' });
  // With no event open at all, the Not sure choices are a list, not "no album".
  const none = await load({ albums: [] });
  await joined(none);
  assert.equal(none.$('album-note').hidden, true);
  assert.deepEqual(none.$('album').options.map((o) => o.value), ['', none.made.notSure['hoover-jrt'], none.made.notSure.cohssa]);
  assert.equal(none.$('album').options[0].textContent, 'Choose an album');
  // The control: with both closed, neither is offered.
  const closed = await load({ notSure: false });
  await joined(closed);
  assert.deepEqual(closed.$('album').options.map((o) => o.value), [closed.made.today]);
});

test('with no album open, the page says so and offers to check again, which lists one opened since', async () => {
  // Nothing at all: no event, and each team's Not sure album closed (#228).
  const page = await load({ albums: [], notSure: false });
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
    [() => Response.json({ error: 'session' }, { status: 401 }), 'Your sign-in has ended. Sign in again, then send again.'],
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

test('with no session, nothing to send is shown, and the page says to sign in or ask for an account', async () => {
  const page = await load({ session: null });
  await until(() => page.$('join-status').textContent === NONE, 'no session');
  assert.equal(page.$('sender').hidden, true);
  assert.equal(page.$('join-retry').hidden, true);
  assert.deepEqual(page.net.calls, ['GET /api/upload/session']);
});

// ---- #226 criterion 3: an old invite link says it has been replaced ---
//
// /share/#code=<code> was how a parent joined until #226. The links live on
// in group chats and bookmarks, so the page still knows one: it takes the
// code out of the address bar, sends it nowhere, and says the link has been
// replaced, pointing to the request page (/ask) and the sign-in.

test('an old invite link with no session: the code leaves the address bar at once, goes nowhere, and the page says the link was replaced (#226, criterion 3)', async () => {
  const page = await load({ hash: `#code=${CODE}`, session: null });
  // Taken out as the script starts, before it has waited on anything.
  assert.equal(page.location.hash, '', 'the code was left in the address bar');
  await until(() => page.$('join-status').textContent === REPLACED, 'replaced');
  assert.equal(page.$('sender').hidden, true);
  assert.equal(page.$('join-retry').hidden, true);
  // One request, the session check, which carries no code: until #226 the
  // page posted the code to /api/join. Nothing set a cookie.
  assert.deepEqual(page.net.calls, ['GET /api/upload/session']);
  assert.equal(page.jar.size, 0);
  assert.deepEqual(page.rows(), []);
});

test('an old invite link on a phone signed in: the page says the link was replaced, and the phone sends as its account (#226, criterion 3)', async () => {
  const page = await load({ hash: `#code=${CODE}` });
  assert.equal(page.location.hash, '', 'the code was left in the address bar');
  await until(() => page.$('join-status').textContent === READY_REPLACED, 'replaced, and ready');
  await until(() => page.$('album').options.some((o) => o.value), 'albums listed');
  assert.equal(page.$('sender').hidden, false);
  page.choose(photoFile());
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(page.rows().map((r) => [r.address, r.account_id]), [[page.made.today, 1]]);
  assert.deepEqual(page.net.calls.filter((c) => !c.startsWith('POST /api/upload') && c !== 'GET /api/albums/open'), ['GET /api/upload/session']);
});

test('an old invite link opened in a tab already on the page is answered the same way; a change after # with no code is not (#226)', async () => {
  for (const [session, before, after] of [[null, NONE, REPLACED], ['account', "You're set to send photos from this phone.", READY_REPLACED]]) {
    const page = await load({ session });
    await until(() => page.$('join-status').textContent === before, `${session}: first answer`);
    const calls = page.net.calls.filter((c) => c === 'GET /api/upload/session').length;
    // A fragment with no code: nothing is asked, and the address is left alone.
    page.location.hash = '#main';
    page.fireWindow('hashchange');
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(page.location.hash, '#main', `${session}: a fragment with no code was taken out`);
    assert.equal(page.net.calls.filter((c) => c === 'GET /api/upload/session').length, calls, `${session}: asked again for no code`);
    assert.equal(page.$('join-status').textContent, before);
    // An old link: taken out at once, and the session asked about again.
    page.location.hash = `#code=${CODE}`;
    page.fireWindow('hashchange');
    assert.equal(page.location.hash, '', `${session}: the code was left in the address bar`);
    await until(() => page.$('join-status').textContent === after, `${session}: replaced`);
    assert.equal(page.net.calls.filter((c) => c === 'GET /api/upload/session').length, calls + 1);
    assert.ok(!page.net.calls.some((c) => c.includes('/api/join')), `${session}: the page posted to /api/join`);
  }
});

test('an old invite link whose session check cannot reach the site offers Try again, which still says the link was replaced (#226)', async () => {
  const page = await load({ hash: `#code=${CODE}`, session: null, holdSession: true });
  page.net.sessionAnswer = () => 'network';
  page.releaseSession();
  await until(() => page.$('join-status').textContent === "Couldn't reach the photo site. Check your signal, then try again.", 'offline');
  assert.equal(page.$('join-retry').hidden, false);
  page.net.sessionAnswer = null;
  page.click(page.$('join-retry'));
  await until(() => page.net.calls.length === 2, 'asked again');
  page.releaseSession();
  await until(() => page.$('join-status').textContent === REPLACED, 'replaced, after Try again');
  assert.equal(page.$('join-retry').hidden, true);
});

test('a signed-in phone whose session check meets the guard\'s 503 is told to try again, never to sign in, and Try again opens the sender (#226 review)', async () => {
  // The guard answers 503 only to a phone holding an account's session whose
  // account it could not read (lib/session.js). Telling that phone to sign in,
  // or that its old link was replaced and it should ask for an account, is
  // wrong; it is signed in, and the site is what failed.
  const UNAVAILABLE = "The photo site isn't answering right now. Try again in a few minutes.";
  for (const [hash, after] of [['', "You're set to send photos from this phone."], [`#code=${CODE}`, READY_REPLACED]]) {
    const page = await load({ hash, holdSession: true });
    page.net.sessionAnswer = () => Response.json({ error: 'unavailable' }, { status: 503 });
    page.releaseSession();
    await until(() => page.$('join-status').textContent === UNAVAILABLE, `unavailable${hash ? ', old link' : ''}`);
    assert.equal(page.$('join-retry').hidden, false, 'no Try again on a 503');
    assert.equal(page.$('sender').hidden, true);
    page.net.sessionAnswer = null;
    page.click(page.$('join-retry'));
    await until(() => page.net.calls.filter((c) => c === 'GET /api/upload/session').length === 2, 'asked again');
    page.releaseSession();
    await until(() => page.$('join-status').textContent === after, `${after}, after Try again`);
    assert.equal(page.$('join-retry').hidden, true);
    assert.equal(page.$('sender').hidden, false);
  }
});

test('a phone still holding the old upload cookie loses it the first time the page opens, signed in or not (#226)', async () => {
  // /policy: the phone's old cookie is deleted the next time it opens the
  // sending page. Valid or not, the session check's answer deletes it.
  for (const [session, status] of [[null, NONE], ['account', "You're set to send photos from this phone."]]) {
    const page = await load({ session, upload: await parentCookie(KEYS.SESSION_SIGNING_KEY, 2, nowSeconds()) });
    await until(() => page.$('join-status').textContent === status, `${session}: answered`);
    // The session check carried it, and its answer deleted it.
    assert.match(page.net.cookies[0], new RegExp(`(^|; )${UPLOAD_COOKIE}=v1\\.`), `${session}: the phone never sent the old cookie`);
    assert.equal(page.jar.has(UPLOAD_COOKIE), false, `${session}: the old cookie was kept`);
    assert.equal(page.jar.has(ACCOUNT_COOKIE), session !== null, `${session}: the account's cookie went with it`);
    // Nothing after it carries the old cookie.
    assert.ok(page.net.cookies.slice(1).every((cookie) => !cookie?.includes(UPLOAD_COOKIE)), `${session}: sent again`);
  }
});

test('the page links /sign-in and /ask and no longer /coach, and says before its script runs what the script says with no session (#226)', () => {
  assert.match(HTML, /<p>Have an account\? <a href="\/sign-in">Sign in<\/a>\.<\/p>/);
  assert.match(HTML, /<p>No account yet\? <a href="\/ask">Ask for one<\/a>\.<\/p>/);
  assert.doesNotMatch(HTML, /href="\/coach"/);
  const lede = HTML.match(/<p class="lede" id="join-status" role="status">([^<]*)<\/p>/)?.[1];
  assert.equal(lede?.replace(/\s+/g, ' '), NONE);
  assert.match(HTML, /<noscript><p>This page needs JavaScript to send photos\. Turn it on, then\s+reload\.<\/p><\/noscript>/);
  // Nothing a visitor reads names the invite link, comments aside. Comments
  // come out until none is left, so taking one out cannot leave another
  // behind (CodeQL js/incomplete-multi-character-sanitization, at #226's PR).
  let visible = HTML;
  for (let before = null; before !== visible;) {
    before = visible;
    visible = visible.replace(/<!--[\s\S]*?-->/g, '');
  }
  assert.doesNotMatch(visible, /invite/i);
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

test('#228: a choice of "Not sure / other event" stays chosen when the list reloads after another album closes mid-send', async () => {
  const page = await load({ hold: true, albums: TWO_ALBUMS });
  await joined(page);
  page.choose(photoFile());
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 1, 'held');
  // While the first photo is on its way to today's album, the parent picks Not sure for the next.
  page.$('album').value = page.made.notSure['hoover-jrt'];
  page.env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE address = ?').run(page.made.today);
  page.net.hold = false;
  page.release();
  await until(() => page.items()[0].state === 'failed', 'failed');
  await until(() => !page.$('album').options.some((o) => o.value === page.made.today), 'the list reloaded without the closed album');
  assert.equal(page.$('album').value, page.made.notSure['hoover-jrt']);
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
  // The blank, the past album, and each team's Not sure choice (#228).
  assert.equal(page.$('album').options.length, 4);
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

// #223: a phone signed in to an account. The session route answers 204 and
// the album list is the account's: its approved teams' albums only.
const BOTH_TEAMS = [
  { key: 'hoover', title: 'Tuesday practice', kind: 'practice', date: dayOffset(0), team: 'hoover-jrt' },
  { key: 'cohssa', title: 'COHSSA scrimmage', kind: 'regatta', date: dayOffset(0), team: 'cohssa' },
];
const TEAM_REFUSED = "Failed. Your account can't send to that team's albums. Choose another album above, then try again.";
const signedIn = (page) => until(() => !page.$('sender').hidden && page.$('album').options.some((o) => o.value), 'signed in, albums listed');

test('signed in to an account, the page lists only its approved teams\' albums, and a photo sent records the account (#223, criteria 2 and 3)', async () => {
  const page = await load({ albums: BOTH_TEAMS, accountTeams: ['hoover-jrt'] });
  await signedIn(page);
  assert.equal(page.$('join-status').textContent, "You're set to send photos from this phone.");
  // Its own team's Not sure choice too (#228), and not COHSSA's.
  assert.deepEqual(page.$('album').options.map((o) => o.value), [page.made.hoover, page.made.notSure['hoover-jrt']], 'COHSSA is not this account\'s');
  page.choose(photoFile());
  await until(() => page.items()[0]?.state === 'ready', 'made ready');
  page.click(page.$('send'));
  await settled(page);
  const [row] = page.rows();
  assert.equal(page.rows().length, 1);
  assert.deepEqual({ address: row.address, account_id: row.account_id, sender: row.sender, code_generation: row.code_generation },
    { address: page.made.hoover, account_id: 1, sender: 'parent', code_generation: 0 });
  // The control: an account approved for both teams is offered both.
  const both = await load({ albums: BOTH_TEAMS, accountTeams: ['hoover-jrt', 'cohssa'] });
  await signedIn(both);
  assert.deepEqual(both.$('album').options.map((o) => o.value).filter(Boolean).sort(),
    [both.made.cohssa, both.made.hoover, ...Object.values(both.made.notSure)].sort());
});

test('a team taken off the account while sending: every photo queued for its album stops with the team\'s words, and the list reloads without it (#223)', async () => {
  const page = await load({ albums: BOTH_TEAMS, accountTeams: ['hoover-jrt', 'cohssa'], hold: true });
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

// The account signed out everywhere, or set a new password (#222): its
// version moves, and every session on the old one ends at its next request.
// Until #226 the same test rotated the invite code.
const endSession = (page) => page.env.DB.sqlite.prepare('UPDATE accounts SET session_version = 2 WHERE id = 1').run();

test('a sign-in ended mid-send: every queued photo stops at once, the status says why, and signing in again carries on', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.choose(...Array.from({ length: 6 }, (_, i) => photoFile({ width: 3000 + i, height: 2000 })));
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three held');
  endSession(page);
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.equal(page.net.posted.length, 3, 'the three queued behind a 401 were sent anyway');
  assert.ok(page.items().every((i) => i.text === FAILED_ENDED));
  assert.equal(page.$('join-status').textContent, ENDED);

  // Signed in again in another tab, which leaves the new session in this
  // browser: each Try again sends, with no reload, and the photos waited.
  // Until #226 the new invite link opened in this tab did this.
  await page.signIn(2);
  for (const item of page.items()) page.click(item.tryAgain);
  await settled(page);
  assert.equal(page.rows().length, 6);
  assert.ok(page.rows().every((r) => r.account_id === 1));
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
  endSession(page);
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
  assert.equal(after.text, FAILED_ENDED);
  assert.equal(after.tryAgain.hidden, false);

  await page.signIn(2);
  for (const item of page.items()) page.click(item.tryAgain);
  await settled(page);
  assert.equal(page.rows().length, 2);
});

test('an account at the day\'s cap: the photo and every queued one fail, and nothing more is sent', async () => {
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
  // Every sender is an account since #226, whose 500 are shared by its
  // phones (#223), so the words name the account and not "this phone"; and
  // it counts clips as well since #198, so the message says so.
  assert.ok(page.items().every((i) => i.text === `Failed. Your account has sent today's limit of ${DAILY_UPLOADS} photos and clips. Try again tomorrow.`));
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
const SHARED_FAILED = "What you shared couldn't be kept on this phone. Share it again.";
const SHARED_EMPTY = "Nothing arrived with that share. Share from your phone's gallery or Files app instead.";
const waiting = (n, noun = n === 1 ? 'it' : 'they') =>
  `${n} photo${n === 1 ? '' : 's'} you shared ${n === 1 ? 'is' : 'are'} waiting on this phone. ` +
  `Sign in, and ${noun} will be ready to send. Shared photos are kept here for a day.`;

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
  const page = await load({ search: '?shared', db });
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
  const before = await load({ search: '?shared', db, session: null });
  await until(() => note(before) !== null, 'the note');
  assert.equal(before.$('join-status').textContent, NONE);
  assert.equal(note(before), waiting(2));
  assert.equal(before.$('sender').hidden, true);
  assert.equal(before.items().length, 0);
  assert.equal(inboxFiles(db).length, 2, 'the photos stayed in storage');
  // The way to sign in, at /sign-in since #226 (at /coach until then).
  assert.match(HTML, /<a href="\/sign-in">Sign in<\/a>/, 'the page carries the way to sign in');
  assert.match(HTML, /<p id="shared-note" role="status" hidden><\/p>/, 'the note is a live region, hidden until written');

  // /sign-in signs the coach in to an account with the coach role (#223),
  // and /account links back to /share/, with no ?shared.
  const after = await load({ db, role: 'coach' });
  await joined(after);
  await until(() => after.items().length === 2 && after.items().every((i) => i.state === 'ready'), 'two ready');
  assert.equal(note(after), null);
  assert.equal(inboxFiles(db).length, 2, 'still in storage until sent');
  after.click(after.$('send'));
  await settled(after);
  assert.deepEqual(stored(after), [[1920, 2560], [2560, 1920]]);
  assert.ok(after.rows().every((r) => r.sender === 'coach' && r.account_id === 1), 'sent as the coach\'s account');
  await until(() => inboxFiles(db).length === 0, 'records deleted once stored');
});

test('#193 criterion 3, a parent: an old invite link opened in the same tab says it was replaced, and the shared photos keep waiting (#226)', async () => {
  // Until #226 the link joined here and took the waiting photos in.
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]));
  const page = await load({ search: '?shared', db, session: null });
  await until(() => note(page) !== null, 'the note');
  assert.equal(note(page), waiting(1));
  const closes = page.db.state.closes;
  page.location.hash = `#code=${CODE}`;
  page.fireWindow('hashchange');
  await until(() => page.$('join-status').textContent === REPLACED, 'replaced');
  assert.equal(page.location.hash, '', 'the code was left in the address bar');
  // Read again for the new answer, and still only waiting: by the store
  // closing after that read, then the page's turns to act on it.
  await until(() => page.db.state.closes > closes, 'the second read finished');
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(note(page), waiting(1));
  assert.equal(page.items().length, 0);
  assert.equal(page.$('sender').hidden, true);
  assert.equal(inboxFiles(db).length, 1, 'kept until sent');
  assert.deepEqual(page.net.calls, ['GET /api/upload/session', 'GET /api/upload/session']);
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
  const page = await load({ db });
  await until(() => page.items().length === 3 && page.items().every((i) => i.state === 'ready'), 'three ready');
  assert.deepEqual(madeOrder(page), SHAPES);
});

test('#193: a share over a day old is forgotten, not offered, with or without a session', async () => {
  for (const session of [null, 'account']) {
    const db = idb();
    await shareFrom(db, shaped([SHAPES[0]]), CLOCK - DAY - 1);
    await shareFrom(db, shaped([SHAPES[1]]), CLOCK - DAY);
    const page = await load({ db, session });
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
  const lone = await load({ search: '?shared=failed', db: idb(), session: null });
  await until(() => note(lone) !== null, 'the note');
  assert.equal(note(lone), SHARED_FAILED);
  assert.equal(lone.location.search, '');

  const signed = await load({ search: '?shared=failed', db: idb(), role: 'coach' });
  await joined(signed);
  await until(() => note(signed) !== null, 'the note');
  assert.equal(note(signed), SHARED_FAILED);
  assert.equal(signed.items().length, 0);
});

test('#193: storage that cannot be read after a share says to share again; without a share it says nothing', async () => {
  const broken = () => idb({ fail: { open: new DOMException('Blocked', 'UnknownError') } });
  const shared = await load({ search: '?shared', db: broken() });
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
  const plain = await load({ db: broken() });
  await joined(plain);
  await settledRead(plain);
  assert.equal(note(plain), null);
  assert.equal(plain.$('sender').hidden, false, 'the page still sends');

  // The same two, with no session: the note is written while the page waits.
  const waitingShared = await load({ search: '?shared', db: broken(), session: null });
  await until(() => note(waitingShared) !== null, 'the note');
  assert.equal(note(waitingShared), SHARED_FAILED);
  const waitingPlain = await load({ db: broken(), session: null });
  await until(() => waitingPlain.$('join-status').textContent === NONE, 'no session');
  await settledRead(waitingPlain);
  assert.equal(note(waitingPlain), null);
});

test('#193: the page registers the worker for /share/ only, checked for updates past the browser\'s cache', async () => {
  const page = await load();
  await joined(page);
  // As plain data: the options object was made inside the page's context.
  assert.deepEqual(JSON.parse(JSON.stringify(page.registrations)), [{ url: '/share/sw.js', options: { scope: '/share/', updateViaCache: 'none' } }]);
});

test('#193: a browser that refuses the worker, has no service workers at all, or has no IndexedDB, still opens the sender and sends', async () => {
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
  for (const session of [null, 'account']) {
    const page = await load({ search: '?shared=empty', db, session });
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
  const first = await load({ search: '?shared', db });
  await until(() => first.items().length === 1 && first.items()[0].state === 'ready', 'the first share ready');
  // A second share navigates the app: a new page on the same storage.
  await shareFrom(db, shaped(SHAPES.slice(1)), CLOCK - 30_000);
  const second = await load({ search: '?shared', db });
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
  const page = await load({ search: '?shared', db });
  await until(() => page.items().length === 2 && page.items().every((i) => i.state === 'ready'), 'two ready');
  page.click(page.items()[0].remove);
  await until(() => inboxFiles(db).length === 1, 'the removed photo\'s record deleted');
  const again = await load({ db });
  await until(() => again.items().length === 1 && again.items()[0].state === 'ready', 'one offered again');
  assert.deepEqual(madeOrder(again), [SHAPES[1]]);
});

test('#193 (review): a shared photo whose upload fails stays in storage, and the next load offers it again', async () => {
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]));
  const page = await load({ search: '?shared', db });
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.net.intercept = () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].state, 'failed');
  // The next load's read is queued behind anything the failure started on
  // the store, so it sees the store as the failure left it.
  const again = await load({ db });
  await until(() => again.items()[0]?.state === 'ready', 'offered again');
  assert.equal(inboxFiles(db).length, 1);
});

test('#193 (review): an old invite link opened on an open page does not list a shared photo twice', async () => {
  // A rejoin until #226; since then the link starts a second session check
  // (share.js, takeOldLink), whose answer asks for the shared photos again.
  const db = idb();
  await shareFrom(db, shaped(SHAPES.slice(0, 2)));
  const page = await load({ search: '?shared', db });
  await until(() => page.items().length === 2 && page.items().every((i) => i.state === 'ready'), 'two ready');
  // Waited for by the store closing, after the read's transaction commits:
  // the read opening is too early, since a duplicate would be added only
  // once it answers (#193's round-2 mutation: dropping the dedupe read 0 red
  // here when this waited on the open).
  const closes = page.db.state.closes;
  page.location.hash = `#code=${CODE}`;
  page.fireWindow('hashchange');
  await until(() => page.db.state.closes > closes, 'the second read finished');
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(page.$('join-status').textContent, READY_REPLACED);
  assert.equal(page.items().length, 2);
});

test('#193 (review): two session checks answering at once (the page\'s own, and an old invite link\'s opened in the same moment) list a shared photo once', async () => {
  const db = idb();
  await shareFrom(db, shaped(SHAPES.slice(0, 2)));
  const closes = db.state.closes;
  const page = await load({ search: '?shared', db });
  // The old link is opened before the page's own session check answers, so
  // two answers that open the sender arrive close together and each asks for
  // the shared photos. IndexedDB runs the two reads in order (test/idb.js
  // keeps that), and the dedupe is what stops the second listing them again.
  page.location.hash = `#code=${CODE}`;
  page.fireWindow('hashchange');
  await until(() => page.items().length >= 2 && page.items().every((i) => i.state === 'ready'), 'ready');
  await until(() => db.state.closes >= closes + 2, 'both reads finished');
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(page.items().length, 2);
});

test('#193: while the session check is out, the page does not read the store or describe a share as waiting', async () => {
  // Until #226 this held the join an invite link started; an old link now
  // starts the session check, and the page waits on that the same way.
  const db = idb();
  await shareFrom(db, shaped([SHAPES[0]]));
  const opensBefore = db.state.opens;
  const page = await load({ hash: `#code=${CODE}`, db, holdSession: true });
  await until(() => page.net.calls.length === 1, 'the session check sent');
  // A read would open the store synchronously, and a note would follow it
  // within a few of the stand-in's timer turns; 100 ms outlasts both.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(db.state.opens, opensBefore, 'the page read the store before the session check answered');
  assert.equal(note(page), null);
  page.releaseSession();
  await until(() => page.$('join-status').textContent === READY_REPLACED, 'answered');
  await until(() => page.items()[0]?.state === 'ready', 'taken in once answered');
});

// ---- #198: clips, sent in parts ------------------------------------------
//
// A clip goes through js/clip.js's walker on the phone, then through the real
// clip routes into the bucket, as a photo goes through the upload route. The
// clips are test/mp4.js's, each shaped like one camera's, and every location,
// make, model and serial planted in them is FICTIONAL: a test reads that each
// planted value was in the file chosen and is nowhere in what the bucket
// holds.

/** A clip as a phone's picker hands it over. */
const clipFile = (bytes, { name = 'IMG_0001.MOV', type = 'video/quicktime', lastModified = 1_790_000_000_000 } = {}) =>
  new File([bytes], name, { type, lastModified });

/** A clip `seconds` long in one small part, holding nothing to blank: test/mp4.js's plainClip. */
const lasting = (seconds, options = {}) =>
  plainClip({ clip: { movie: mvhd({ time: [0, 0], timescale: 600, duration: 600 * seconds }), ...options } }).file;

// The iPhone's clip with media enough for two parts, its moov in the second,
// as test/clip-upload.test.js sends it: 25 MiB, so it is made once.
let twoParts = null;
const iphoneTwoParts = () => (twoParts ??= iphoneMov({ clip: { tail: PART_BYTES } }));

/** The walker's plan of `bytes`, as the page makes it. */
const planOf = (bytes) => planClip(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length);

/** `bytes` as `plan` says to send them: up to plan.bytes, with every edit made. */
function applied(bytes, plan) {
  const out = bytes.slice(0, plan.bytes);
  for (const edit of plan.edits) {
    if (edit.zeros === undefined) out.set(edit.bytes, edit.offset);
    else out.fill(0, edit.offset, edit.offset + edit.zeros);
  }
  return out;
}

/** Where `needle` (text read one byte a character, or bytes) first sits in `haystack`, or -1. */
const find = (haystack, needle) => Buffer.from(haystack.buffer, haystack.byteOffset, haystack.length)
  .indexOf(typeof needle === 'string' ? Buffer.from(needle, 'latin1') : Buffer.from(needle));

/** What the bucket holds for a clip's row, or null. */
const storedClip = (page, row) => page.env.MEDIA.objects.get(clipObjectKey(row.media_key))?.body ?? null;

/** The clip requests the page made, in order: "start", "part 1", "complete", "abandon". */
const steps = (page) => page.net.clipCalls.map((c) => (c.n === null ? c.step : `${c.step} ${c.n}`));

/** A File that records how the page reads it: each slice, and any read of the whole. */
class WatchedFile extends File {
  slices = [];
  whole = 0;

  slice(...range) {
    this.slices.push(range);
    return super.slice(...range);
  }

  arrayBuffer() {
    this.whole += 1;
    return super.arrayBuffer();
  }
}

const CLIP_UNCHECKABLE = "The photo site can't check this file as a clip, so it won't be sent. It takes MP4 and MOV clips as a phone or camera records them.";
const CLIP_UNREAD = "Couldn't read this clip from the phone, so it won't be sent. Remove it, then add it again.";
const OFFLINE = "Failed. Couldn't reach the photo site. Check your signal, then try again.";
const CLIP_REFUSED = "Failed. The photo site couldn't take this clip. Try again, and if it fails again, leave it out.";
const CLIP_KEPT = "Failed. The photo site found details still in this clip that it doesn't keep, and deleted it. Leave this clip out.";
const CLIP_GONE = 'Failed. The photo site lost track of this clip before it was finished. Try again to send it from the start.';
const CLIP_OVER = 'Failed. The photo site says this clip is too long or too large for you to send. Trim it, then add it again.';
// The figure is the list's dayBytes for a parent's account, lib/photos.js's
// own. Every sender is an account since #226, whose budget is shared by its
// phones, so the words name the account and not "this phone".
const CLIP_DAY = `Failed. Your account has sent today's ${CLIP_DAY_BYTES.everyone / 1024 ** 3} GB of clips. Photos can still go; try clips again tomorrow.`;

test('#198: the page loads the walker as a module ahead of share.js, stamped from its own bytes, and finds the four names clip.js puts on window', () => {
  const scripts = [...HTML.match(/<head>([\s\S]*?)<\/head>/)[1].matchAll(/<script\b([^>]*)><\/script>/g)].map((m) => m[1].trim());
  // Deferred scripts, a module's included, run in the order they are written.
  assert.deepEqual(scripts.map((s) => s.match(/src="([^"?]+)/)[1]), ['/js/clip.js', '/js/share.js']);
  assert.match(scripts[0], /^type="module" src="\/js\/clip\.js\?v=[0-9a-f]{10}"$/);
  assert.match(scripts[1], /\bdefer\b/);
  // tools/assetver.py's stamp, the first 10 hex digits of the file's sha256:
  // a stale one serves a browser the walker it kept for up to 4 hours.
  assert.equal(scripts[0].match(/\?v=([0-9a-f]{10})/)[1], sha(CLIP_SCRIPT).slice(0, 10));
  // What this harness hands the page is what the module puts on window, and
  // the page reaches for nothing else of it.
  assert.match(CLIP_SCRIPT.toString('utf8'), /\nif \(typeof window !== 'undefined'\) window\.MadcowClip = Object\.freeze\(\{ PART_BYTES, partCount, partPieces, planClip \}\);\n$/);
  assert.deepEqual([...new Set([...SCRIPT.matchAll(/MadcowClip\.(\w+)/g)].map((m) => m[1]))].sort(), ['partCount', 'partPieces', 'planClip']);
});

test('#198: beside Add photos, the page says clips can go too, in D11\'s minutes, and its picker offers videos', () => {
  const sender = HTML.match(/<div class="sender" id="sender" hidden>([\s\S]*?)<\/div>/)[1];
  const words = sender.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const [, parent, coach] = words.match(/You can send clips too, up to (\d+) minutes long, or (\d+) minutes if you're a coach\./) ?? [];
  assert.equal(Number(parent) * 60, CLIP_SECONDS.everyone);
  assert.equal(Number(coach) * 60, CLIP_SECONDS.coach);
  assert.match(sender, />Add photos<input type="file" id="photo-input" accept="image\/\*,video\/\*" multiple><\/label>/);
});

test('#198: a file is a clip by its type or its name, whatever its bytes; anything else, a HEIC included, takes the photo path, and a clip is never decoded', async () => {
  // Every file here holds a HEIC's first bytes, an ftyp box as an MP4's
  // starts, so only the type and the name can tell the paths apart.
  const heic = new Uint8Array(await heicFile().arrayBuffer());
  const page = await load();
  await joined(page);
  const clips = [['upload', 'video/mp4'], ['IMG_0001.MOV', ''], ['clip.mp4', ''], ['GOPR0001.M4V', ''], ['old.3gp', ''], ['screen.mkv', 'video/x-matroska']];
  page.choose(...clips.map(([name, type]) => new File([heic], name, { type })));
  await until(() => page.items().every((i) => i.state === 'unreadable'), 'each refused');
  assert.deepEqual(page.items().map((i) => i.text), new Array(clips.length).fill(CLIP_UNCHECKABLE));
  assert.equal(page.walker.plans, clips.length);
  assert.equal(page.decoder.asked, 0, 'a clip was handed to the image decoder');
  const [first] = page.items();
  assert.equal(first.frame.textContent, 'Clip 1');
  assert.equal(first.remove.getAttribute('aria-label'), 'Remove clip 1');
  assert.equal(page.summary(), "6 clips can't be sent.");

  // The control: the same bytes, typed or named as photos.
  const shots = [['IMG_0002.HEIC', 'image/heic'], ['photo.heif', ''], ['clip.mp4.jpg', ''], ['movie.mpeg', '']];
  page.choose(...shots.map(([name, type]) => new File([heic], name, { type })));
  await until(() => page.items().length === 10 && page.items().every((i) => i.state === 'unreadable'), 'each refused');
  const said = page.items().slice(clips.length).map((i) => i.text);
  assert.deepEqual(said.map((text) => (text.includes('HEIC') ? 'heic' : text.includes('as a photo') ? 'decode' : text)), ['heic', 'heic', 'decode', 'decode']);
  assert.equal(page.walker.plans, clips.length, 'a photo reached the clip walker');
  assert.ok(page.decoder.asked >= shots.length);
  assert.equal(page.items()[clips.length].img.alt, 'Photo 7');
  assert.equal(page.items()[clips.length].remove.getAttribute('aria-label'), 'Remove photo 7');
  assert.equal(page.summary(), "4 photos and 6 clips can't be sent.");
});

test('#198: a clip the phone cannot hand over, or that changed after it was chosen, says to add it again, not that it is no clip', async () => {
  class GoneClip extends File {
    slice() {
      return { arrayBuffer: () => Promise.reject(new DOMException('The file could not be read.', 'NotReadableError')) };
    }
  }
  // Grown since it was chosen: its size says 100 bytes more than it holds,
  // so a read the walker makes past its last box comes back short.
  class ChangedClip extends File {
    get size() {
      return super.size + 100;
    }
  }
  const page = await load();
  await joined(page);
  page.choose(new GoneClip([lasting(30)], 'IMG_0003.MOV', { type: 'video/quicktime' }), new ChangedClip([lasting(30)], 'IMG_0004.MOV', { type: 'video/quicktime' }));
  await until(() => page.items().every((i) => i.state === 'unreadable'), 'both refused');
  assert.deepEqual(page.items().map((i) => i.text), [CLIP_UNREAD, CLIP_UNREAD]);
  // The control: the same clip, as it is, is taken.
  page.choose(clipFile(lasting(30), { name: 'IMG_0005.MOV' }));
  await until(() => page.items()[2]?.state === 'ready', 'the clip as it is, ready');
});

test('#198: an iPhone\'s clip goes in its two parts, each its own size, through the real routes; the bucket holds nothing the camera planted, and the row waits with the server\'s reading', async () => {
  const { file: bytes, planted } = iphoneTwoParts();
  const plan = await planOf(bytes);
  assert.equal(partCount(plan.bytes), 2, 'the fixture is two parts long');
  const file = new WatchedFile([bytes], 'IMG_0001.MOV', { type: 'video/quicktime', lastModified: 1_790_000_000_000 });
  const page = await load();
  await joined(page);
  page.choose(file);
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  const [item] = page.items();
  // No picture: its name and its length, as the admin queue shows a length.
  assert.equal(item.frame.textContent, `Clip 1, ${clipLength(plan.durationMs)}`);
  assert.equal(item.label.textContent, 'Caption for clip 1 (optional)');
  assert.equal(item.tryAgain.getAttribute('aria-label'), 'Try again: clip 1');
  assert.equal(page.summary(), '1 clip ready to send.');
  // Made ready from small reads of the file, never the whole of it, and no
  // part of its media read at all.
  assert.ok(file.slices.length > 0 && file.slices.every(([from, to]) => to - from <= 64 * 1024), JSON.stringify(file.slices));
  page.type(item.caption, ' Downwind at the gate ');
  item.status.history = [];
  page.click(page.$('send'));
  await settled(page);
  await page.env.MEDIA.idle();

  // One start, declaring what the walker plans to send; each part its own
  // size with the start's token; one complete naming both.
  assert.deepEqual(steps(page), ['start', 'part 1', 'part 2', 'complete']);
  const [start, one, two, complete] = page.net.clipCalls;
  assert.match(start.body.batch, BATCH);
  assert.deepEqual(start.body, {
    album: page.made.today, batch: start.body.batch, caption: 'Downwind at the gate', bytes: plan.bytes,
    durationMs: plan.durationMs, contentType: 'video/quicktime',
  });
  assert.deepEqual([one.bytes, two.bytes], [PART_BYTES, plan.bytes - PART_BYTES]);
  assert.ok([one, two, complete].every((c) => c.token === one.token && /^clip1\./.test(c.token)));
  assert.deepEqual(complete.body.parts.map((p) => p.partNumber), [1, 2]);
  assert.equal(complete.body.captured, RECORDED, 'the time its mvhd held before the walker zeroed it');

  // Waiting for approval, with the server's own reading of it.
  const [row] = page.rows();
  assert.deepEqual(
    { kind: row.kind, state: row.state, type: row.content_type, ms: row.duration_ms, frame: [row.width, row.height], bytes: row.bytes, captured: row.captured_at, caption: row.caption, address: row.address, upload: row.upload_id },
    { kind: 'clip', state: 'pending', type: 'video/quicktime', ms: plan.durationMs, frame: [1080, 1920], bytes: plan.bytes, captured: RECORDED, caption: 'Downwind at the gate', address: page.made.today, upload: null },
  );
  // The bucket holds exactly what the walker planned and nothing the camera
  // planted; the file chosen held every one of them (the control).
  const stored = storedClip(page, row);
  assert.ok(Buffer.from(stored).equals(Buffer.from(applied(bytes, plan))), 'the bucket holds other bytes than the plan');
  for (const [what, value] of Object.entries(planted)) {
    assert.ok(find(bytes, value) >= 0, `the fixture never held its ${what}`);
    assert.equal(find(stored, value), -1, `the stored clip still holds its ${what}`);
  }
  // Its own text counted the parts; the summary never did.
  assert.deepEqual(item.status.history, ['Queued', 'Sending…', 'Sending… 1 of 2', 'Sending… 2 of 2', 'Sending… 2 of 2', 'Sent']);
  assert.equal(page.summary(), "Sent 1 clip. Clips aren't shown on the site yet.");
  assert.equal(file.whole, 0, 'the clip was read whole to send it');
  assert.equal(page.sentToday(), 1);
});

test('#198: a clip with a raw trailer after its last box declares and sends only its boxes, and the trailer stays on the phone', async () => {
  const trailer = rawTrailer();
  const { file: bytes } = androidMp4({ clip: { trailer } });
  const plan = await planOf(bytes);
  assert.equal(plan.bytes, bytes.length - trailer.length);
  const page = await sendOne(clipFile(bytes, { name: 'VID_20261001_101500.mp4', type: 'video/mp4' }));
  const [row] = page.rows();
  assert.equal(row.state, 'pending');
  assert.equal(page.net.clipCalls[0].body.bytes, plan.bytes);
  assert.deepEqual(page.net.clipCalls.filter((c) => c.step === 'part').map((c) => c.bytes), [plan.bytes]);
  const stored = storedClip(page, row);
  assert.equal(stored.length, plan.bytes);
  // The trailer's fictional serial: in the file chosen, not in the bucket.
  assert.ok(find(bytes, 'IXS9F1CT10N0') >= 0);
  assert.equal(find(stored, 'IXS9F1CT10N0'), -1);
});

test('#198: a parent\'s clip over 3 minutes, or over 1 GB, says so with its own figures and sends nothing; the same long clip from a coach goes', async () => {
  // A file the size of a long 4K clip that never holds it: a small clip's
  // boxes, its mdat running to the end, and a size that says 2 GB.
  class BigFile extends File {
    get size() {
      return 2 * 1024 ** 3;
    }
  }
  const page = await load();
  await joined(page);
  page.choose(clipFile(lasting(240)), new BigFile([plainClip({ clip: { mdat: 'toEnd' } }).file], 'GX010001.MP4', { type: 'video/mp4' }));
  await until(() => page.items().every((i) => i.state === 'unreadable'), 'both refused');
  assert.deepEqual(page.items().map((i) => i.text), [
    "This clip runs 4:00, longer than the 3 minutes you can send, so it won't be sent. Trim it, then add it again.",
    "This clip is 2 GB, larger than the 1 GB you can send, so it won't be sent. Trim it, then add it again.",
  ]);
  assert.equal(CLIP_BYTES.everyone, 1024 ** 3, 'the page\'s figure is the server\'s cap');
  page.click(page.$('send'));
  await tick();
  assert.deepEqual(page.net.clipCalls, [], 'a clip over its caps was sent');
  assert.equal(page.summary(), "Nothing new to send. Add photos first. 2 clips can't be sent.");

  // The same 4 minutes from a coach's account, whose cap is 15.
  const coach = await sendOne(clipFile(lasting(240)), { role: 'coach' });
  const [row] = coach.rows();
  assert.deepEqual([row.state, row.duration_ms, row.sender], ['pending', 240_000, 'coach']);
});

test('#198: a clip at its caps exactly is not refused: 3:00 from a parent goes, and 1 GB reaches the start', async () => {
  const page = await sendOne(clipFile(lasting(180)));
  assert.deepEqual([page.rows()[0].state, page.rows()[0].duration_ms], ['pending', 180_000]);
  class GigFile extends File {
    get size() {
      return 1024 ** 3;
    }
  }
  const gig = await load();
  await joined(gig);
  gig.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'unavailable' }, { status: 503 }) : undefined);
  gig.choose(new GigFile([plainClip({ clip: { mdat: 'toEnd' } }).file], 'GX010002.MP4', { type: 'video/mp4' }));
  await until(() => gig.items()[0]?.state === 'ready', 'not refused');
  gig.click(gig.$('send'));
  await settled(gig);
  assert.deepEqual(steps(gig), ['start']);
  assert.equal(gig.net.clipCalls[0].body.bytes, 1024 ** 3);
  assert.equal(gig.items()[0].text, "Failed. The photo site isn't taking clips right now. Try again in a few minutes.");
});

/**
 * A File of `size` bytes that never holds them: `head`, then zeros made of
 * one MiB shared by reference (a Blob of Blobs is not copied), then `tail`.
 */
function composed(head, size, tail, name = 'GX010003.MP4') {
  const mib = new Blob([new Uint8Array(1024 * 1024)]);
  const fill = size - head.length - tail.length;
  return new File([head, ...new Array(Math.floor(fill / 2 ** 20)).fill(mib), new Uint8Array(fill % 2 ** 20), tail], name, { type: 'video/mp4' });
}

/** A small clip whose last box, a 64-bit mdat, says it runs to byte `end` of the file. */
function mdatTo(end) {
  const head = plainClip({ clip: { mdat: 'large' } }).file;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let at = 0;
  while (String.fromCharCode(...head.subarray(at + 4, at + 8)) !== 'mdat') at += view.getUint32(at);
  view.setBigUint64(at + 8, BigInt(end - at));
  return head;
}

test('#198: the caps are held to what is sent: boxes that fit 1 GB go, though a trailer takes the file past it, and boxes a byte over do not', async () => {
  const GiB = 1024 ** 3;
  const trailer = rawTrailer();
  const page = await load();
  await joined(page);
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'unavailable' }, { status: 503 }) : undefined);
  page.choose(composed(mdatTo(GiB), GiB + trailer.length, trailer), composed(mdatTo(GiB + 1), GiB + 1 + trailer.length, trailer));
  await until(() => page.items().every((i) => ['ready', 'unreadable'].includes(i.state)), 'both judged');
  const [fits, over] = page.items();
  assert.equal(fits.state, 'ready', 'a trailer the page does not send was held to the cap');
  assert.equal(over.text, "This clip is 1.1 GB, larger than the 1 GB you can send, so it won't be sent. Trim it, then add it again.");
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(steps(page), ['start']);
  assert.equal(page.net.clipCalls[0].body.bytes, GiB, 'the start declared the file, not the boxes');
});

test('#198: a clip exactly one part long goes in one part, counted from what is sent, its trailer left behind', async () => {
  // An iPhone's clip whose boxes end at exactly PART_BYTES, then a trailer:
  // counted by the file's size it would be two parts.
  const tail = PART_BYTES - iphoneMov().file.length;
  const trailer = rawTrailer();
  const { file: boxes } = iphoneMov({ clip: { tail, trailer } });
  assert.equal(boxes.length, PART_BYTES + trailer.length);
  assert.deepEqual([partCount(PART_BYTES), partCount(boxes.length)], [1, 2]);
  const page = await sendOne(clipFile(boxes));
  assert.deepEqual(steps(page), ['start', 'part 1', 'complete']);
  assert.deepEqual([page.net.clipCalls[0].body.bytes, page.net.clipCalls[1].bytes], [PART_BYTES, PART_BYTES]);
  const [row] = page.rows();
  assert.deepEqual([row.state, row.bytes, storedClip(page, row).length], ['pending', PART_BYTES, PART_BYTES]);
});

test('#198: a part that fails twice is tried again alone, after 1 then 3 seconds, and the clip still arrives', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  const answers = ['network', Response.json({ error: 'unavailable' }, { status: 503 })];
  page.net.clipIntercept = (call) => (call.step === 'part' && call.n === 2 ? answers[call.attempt - 1] : undefined);
  page.choose(clipFile(iphoneTwoParts().file));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(steps(page), ['start', 'part 1', 'part 2', 'part 2', 'part 2', 'complete']);
  assert.deepEqual(page.waits, [1000, 3000]);
  assert.equal(page.rows()[0].state, 'pending');
  assert.equal(page.items()[0].text, 'Sent');
});

test('#198: a part that fails four times fails the clip with Try again and gives its upload back, and Try again sends it from the start', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  let down = true;
  page.net.clipIntercept = (call) => (down && call.step === 'part' && call.n === 2 ? 'network' : undefined);
  page.choose(clipFile(iphoneTwoParts().file));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(steps(page), ['start', 'part 1', 'part 2', 'part 2', 'part 2', 'part 2', 'abandon']);
  assert.deepEqual(page.waits, [1000, 3000, 9000]);
  const [item] = page.items();
  assert.deepEqual([item.state, item.text, item.tryAgain.hidden], ['failed', OFFLINE, false]);
  // Abandoned: no row, the bucket's upload aborted and its part gone, and
  // the day's upload given back.
  assert.deepEqual(page.rows(), []);
  assert.deepEqual(page.uploads().map((u) => [u.state, u.parts.size]), [['aborted', 0]]);
  assert.equal(page.sentToday(), 0);

  down = false;
  page.click(item.tryAgain);
  await settled(page);
  assert.deepEqual(steps(page).slice(7), ['start', 'part 1', 'part 2', 'complete'], 'Try again did not start a new upload from its first part');
  assert.equal(page.rows()[0].state, 'pending');
  assert.deepEqual(page.uploads().map((u) => u.state), ['aborted', 'completed']);
  assert.equal(page.sentToday(), 1);
});

test('#198: the complete is tried again too, and one whose answer was lost is answered as stored, with nothing sent twice', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  // The route joins and checks the clip; its answer never reaches the page.
  page.net.clipIntercept = (call) => (call.step === 'complete' && call.attempt === 1 ? 'lost' : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(steps(page), ['start', 'part 1', 'complete', 'complete']);
  assert.deepEqual(page.waits, [1000]);
  assert.equal(page.items()[0].text, 'Sent');
  assert.deepEqual(page.rows().map((r) => r.state), ['pending']);
  assert.equal(page.sentToday(), 1);
});

// What a clip says for each answer it can get, where it gets it, and
// whether the page then abandons its upload (the server has let go of it
// already after a 404, and a start that failed made none).
// Each answer: where it comes, the words it gives, whether the upload is then
// abandoned, and whether the clip is refused for good. A 422 or a 413 offers
// no Try again, since sending the clip again meets the same refusal (owner,
// at #198's review).
const CLIP_ANSWERS = [
  ['start', () => 'network', OFFLINE, false, false],
  ['start', () => Response.json({ error: 'unavailable' }, { status: 503 }), "Failed. The photo site isn't taking clips right now. Try again in a few minutes.", false, false],
  ['start', () => Response.json({ error: 'too-long' }, { status: 413 }), CLIP_OVER, false, true],
  ['start', () => Response.json({ error: 'daily-cap' }, { status: 429 }), `Failed. Your account has sent today's limit of ${DAILY_UPLOADS} photos and clips. Try again tomorrow.`, false, false],
  // The day's clip budget (SA-1, owner at #198's review), named from the list.
  ['start', () => Response.json({ error: 'clip-bytes' }, { status: 429 }), CLIP_DAY, false, false],
  ['part', () => Response.json({ error: 'part' }, { status: 400 }), CLIP_REFUSED, true, false],
  ['part', () => Response.json({ error: 'upload' }, { status: 404 }), CLIP_GONE, false, false],
  ['part', () => Response.json({ error: 'session' }, { status: 401 }), FAILED_ENDED, true, false],
  ['complete', () => Response.json({ error: 'kept' }, { status: 422 }), CLIP_KEPT, true, true],
  ['complete', () => Response.json({ error: 'upload' }, { status: 404 }), CLIP_GONE, false, false],
  ['complete', () => Response.json({ error: 'too-long' }, { status: 413 }), CLIP_OVER, true, true],
  ['complete', () => Response.json({ error: 'not-clip' }, { status: 415 }), CLIP_REFUSED, true, false],
  // The one complete refusal that leaves the row uploading (complete.js), so
  // only the page's abandon gives the day back (#198's review).
  ['complete', () => Response.json({ error: 'parts' }, { status: 400 }), CLIP_REFUSED, true, false],
];

test('#198: each answer a clip can get says why in its own words, is never tried again under 500, and Try again then sends it, unless the clip is refused for good', async () => {
  for (const [step, answer, message, abandoned, final] of CLIP_ANSWERS) {
    const label = `${step}: ${message}`;
    const page = await load({ timers: 'fast' });
    await joined(page);
    let once = true;
    page.net.clipIntercept = (call) => {
      if (call.step !== step || !once) return undefined;
      once = false;
      return answer();
    };
    page.choose(clipFile(lasting(30)));
    await until(() => page.items()[0]?.state === 'ready', 'ready');
    page.click(page.$('send'));
    await settled(page);
    const [item] = page.items();
    assert.deepEqual([item.state, item.text, item.tryAgain.hidden], ['failed', message, final], label);
    assert.equal(page.net.clipCalls.filter((c) => c.step === step).length, 1, `${label}: tried again`);
    assert.equal(steps(page).includes('abandon'), abandoned, `${label}: abandoned or not`);
    assert.deepEqual(page.waits, [], label);
    // The summary asks for Try again only where it is offered.
    assert.equal(page.summary().includes('press Try again'), !final, `${label}: ${page.summary()}`);
    // A clip refused for good stays as it is; a 401 ends the session, which
    // signing in again restores; the rest go again.
    if (final || message.includes('has ended')) continue;
    page.click(item.tryAgain);
    await settled(page);
    assert.equal(page.items()[0].state, 'sent', label);
  }
});

test('#198: a start whose part count is not the walker\'s is abandoned with nothing sent', async () => {
  const page = await load();
  await joined(page);
  const token = `clip1.41.4096.${'A'.repeat(43)}`;
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ id: 41, token, parts: 2 }, { status: 201 }) : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(steps(page), ['start', 'abandon']);
  assert.deepEqual([page.net.clipCalls[1].id, page.net.clipCalls[1].token], [41, token]);
  assert.equal(page.items()[0].text, CLIP_REFUSED);
  // The control: the route's own count, one part, goes on.
  page.net.clipIntercept = null;
  page.click(page.items()[0].tryAgain);
  await settled(page);
  assert.deepEqual(steps(page).slice(2), ['start', 'part 1', 'complete']);
});

test('#198: Remove while a clip sends cuts off its part in flight, abandons its upload, and the bucket keeps nothing of it', async () => {
  const page = await load();
  await joined(page);
  page.net.clipHold = (call) => call.step === 'part' && call.n === 2;
  page.choose(clipFile(iphoneTwoParts().file));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'part 2 in flight');
  const [item] = page.items();
  assert.deepEqual([item.state, item.text, item.remove.hidden], ['sending', 'Sending… 2 of 2', false]);
  assert.equal(page.uploads()[0].parts.size, 1, 'part 1 is in the bucket');
  page.click(item.remove);
  assert.equal(page.items().length, 0);
  assert.equal(page.document.activeElement, page.$('photo-input'), 'focus went to the page with the last item removed');
  await settled(page);
  await page.env.MEDIA.idle();
  const part = page.net.clipCalls.find((c) => c.step === 'part' && c.n === 2);
  assert.equal(part.aborted, true, 'the part in flight went on');
  assert.deepEqual(steps(page), ['start', 'part 1', 'part 2', 'abandon']);
  assert.equal(page.net.clipCalls.at(-1).token, part.token);
  assert.deepEqual(page.rows(), []);
  assert.deepEqual(page.uploads().map((u) => [u.state, u.parts.size]), [['aborted', 0]]);
  assert.equal(page.env.MEDIA.objects.size, 0);
  assert.equal(page.sentToday(), 0, 'its day was not given back');
  assert.equal(page.summary(), '');
});

test('#198: a clip removed while its upload starts is abandoned once the start answers; Remove is withdrawn while the server checks its parts', async () => {
  const page = await load();
  await joined(page);
  page.net.clipHold = (call) => call.step === 'start';
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the start in flight');
  page.click(page.items()[0].remove);
  page.releaseClip();
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(steps(page), ['start', 'abandon']);
  assert.deepEqual(page.rows(), []);
  assert.deepEqual(page.uploads().map((u) => u.state), ['aborted']);
  assert.equal(page.sentToday(), 0);

  // Offered while its part goes; withdrawn, focus and all, once the server
  // is joining and checking the parts, when it may be stored already.
  const late = await load();
  await joined(late);
  late.net.clipHold = (call) => call.step === 'part' || call.step === 'complete';
  late.choose(clipFile(lasting(30)));
  await until(() => late.items()[0]?.state === 'ready', 'ready');
  late.click(late.$('send'));
  await until(() => late.net.clipWaiting.length === 1, 'the part in flight');
  const [item] = late.items();
  assert.equal(item.remove.hidden, false);
  item.remove.focus();
  late.releaseClip();
  await until(() => late.net.clipCalls.at(-1).step === 'complete' && late.net.clipWaiting.length === 1, 'the complete in flight');
  assert.deepEqual([item.state, item.remove.hidden], ['sending', true]);
  assert.equal(late.document.activeElement, item.caption, 'focus fell to the page with Remove hidden');
  late.releaseClip();
  await settled(late);
  assert.equal(late.items()[0].state, 'sent');
});

test('#198: Remove while a clip waits to try a part again ends the wait, and the upload is abandoned with nothing tried after it', async () => {
  const page = await load({ timers: 'held' });
  await joined(page);
  page.net.clipIntercept = (call) => (call.step === 'part' ? 'network' : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await until(() => page.waits.length === 1, 'waiting to try the part again');
  const [item] = page.items();
  assert.deepEqual([item.state, item.remove.hidden, page.waits], ['sending', false, [1000]]);
  page.click(item.remove);
  // Nothing is in flight as Remove is pressed, so settled() alone would
  // read the store before the abandon has started.
  await until(() => steps(page).includes('abandon') && page.net.inFlight === 0, 'the upload abandoned');
  await page.env.MEDIA.idle();
  assert.deepEqual(steps(page), ['start', 'part 1', 'abandon']);
  assert.deepEqual(page.rows(), []);
  assert.deepEqual(page.uploads().map((u) => u.state), ['aborted']);
  assert.equal(page.sentToday(), 0);
});

test('#198: a clip waits for its caps without holding up the photos chosen after it', async () => {
  const page = await load();
  page.net.albumsAnswer = () => 'network';
  await until(() => !page.$('sender').hidden && !page.$('album-note').hidden, 'the albums could not be read');
  page.choose(clipFile(lasting(30)), photoFile());
  await until(() => page.items()[1]?.state === 'ready', 'the photo made ready while the clip waits');
  assert.equal(page.items()[0].state, 'preparing');
  assert.equal(page.items()[0].frame.textContent, 'Clip 1, 0:30', 'planned, though not yet held to its caps');
  page.net.albumsAnswer = null;
  page.click(page.$('album-again'));
  await until(() => page.items()[0].state === 'ready', 'the clip ready once its caps came');
});

test('#198: one clip sends at a time, in one of the three places, and photos take the others and pass a clip waiting its turn', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.net.clipHold = (call) => call.step === 'part';
  page.choose(clipFile(lasting(30)), clipFile(lasting(40), { name: 'IMG_0002.MOV' }), photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1 && page.net.waiting.length === 2, 'a clip and two photos in flight');
  for (let i = 0; i < 200; i++) await tick();
  assert.deepEqual(page.items().map((i) => i.state), ['sending', 'queued', 'sending', 'sending', 'queued']);
  // A photo done: the next photo goes, past the clip waiting for the first.
  page.release(1);
  await until(() => page.items()[4].state === 'sending', 'the last photo passed the waiting clip');
  assert.equal(page.items()[1].state, 'queued');
  page.net.hold = false;
  page.release();
  page.net.clipHold = null;
  page.releaseClip();
  await settled(page);
  assert.ok(page.items().every((i) => i.state === 'sent'));
  assert.equal(page.net.maxClipsInFlight, 1, 'two clips were sent at once');
  assert.equal(page.net.maxInFlight, 3);
  assert.deepEqual(page.rows().filter((r) => r.kind === 'clip').map((r) => r.duration_ms), [30_000, 40_000]);
  assert.equal(page.summary(), "Sent 3 photos and 2 clips. The photos will appear in the album once they're reviewed. Clips aren't shown on the site yet.");
});

test('#198: the summary names photos and clips while a clip is among them, written once per change, and a clip\'s parts never reach it', async () => {
  const page = await load({ hold: true });
  await joined(page);
  const summary = page.$('send-status');
  summary.history = [];
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), clipFile(iphoneTwoParts().file));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  await tick();
  assert.deepEqual(summary.history, ['2 photos and 1 clip ready to send.'], 'choosing wrote more than once');

  summary.history = [];
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 2, 'the two photos held');
  assert.deepEqual(summary.history, ['Sending 2 photos and 1 clip: 0 sent.'], 'one press of Send wrote more than once');
  await until(() => page.items()[2].state === 'sent', 'the clip sent, its two parts counted in its own text');
  page.net.hold = false;
  page.release();
  await settled(page);
  await tick();
  const writes = summary.history;
  assert.equal(writes.at(-1), "Sent 2 photos and 1 clip. The photos will appear in the album once they're reviewed. Clips aren't shown on the site yet.");
  const counts = writes.slice(1, -1).map((text) => Number(/^Sending 2 photos and 1 clip: ([12]) sent\.$/.exec(text)?.[1]));
  assert.ok(counts.every((n, i) => n > (i ? counts[i - 1] : 0)), JSON.stringify(writes));
  for (let i = 1; i < writes.length; i++) assert.notEqual(writes[i], writes[i - 1], 'written again with the words it already held');

  // One photo beside a clip is named as one.
  const two = await load();
  await joined(two);
  two.choose(photoFile(), clipFile(lasting(30)));
  await until(() => two.items().every((i) => i.state === 'ready'), 'ready');
  assert.equal(two.summary(), '1 photo and 1 clip ready to send.');
  two.click(two.$('send'));
  await settled(two);
  assert.equal(two.summary(), "Sent 1 photo and 1 clip. The photo will appear in the album once it's reviewed. Clips aren't shown on the site yet.");
});

test('#198: a clip\'s capture time is the time its camera recorded when a phone could have recorded it then, else the file\'s date', async () => {
  const lastModified = 1_790_123_456_789;
  const fileDate = 1_790_123_456;
  const now = CLOCK / 1000;
  const dated = (unix) => plainClip({ clip: { movie: mvhd({ timescale: 600, duration: 600 * 30, time: [unix + SINCE_1904, unix + SINCE_1904] }) } }).file;
  // [what the clip's mvhd says, in Unix seconds, and what its row keeps]
  const cases = [
    [RECORDED, RECORDED],
    [946_684_801, 946_684_801], // a second into 2000
    [946_684_800, fileDate], // 2000 beginning: a camera's clock never set
    [0, fileDate], // 1970
    [now + 24 * 60 * 60, now + 24 * 60 * 60], // a day ahead of the phone's clock
    [now + 24 * 60 * 60 + 1, fileDate], // further ahead
  ];
  const page = await load();
  await joined(page);
  // The last says nothing at all (a zero time), as plainClip's clips do.
  page.choose(...cases.map(([unix], i) => clipFile(dated(unix), { name: `IMG_${i}.MOV`, lastModified })), clipFile(lasting(30), { lastModified }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual(page.rows().map((r) => r.captured_at), [...cases.map(([, kept]) => kept), fileDate]);
});

test('#198: an album closed while a clip\'s parts go: the complete is refused, the clip fails with the album\'s words, and the list reloads choosing nothing', async () => {
  const page = await load({ albums: TWO_ALBUMS });
  await joined(page);
  page.net.clipHold = (call) => call.step === 'part';
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the part in flight');
  page.env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE address = ?').run(page.made.today);
  page.net.clipHold = null;
  page.releaseClip();
  await settled(page);
  await page.env.MEDIA.idle();
  assert.equal(page.items()[0].text, CLOSED);
  assert.deepEqual(page.rows(), []);
  assert.equal(page.env.MEDIA.objects.size, 0, 'the refused clip was left in the bucket');
  assert.equal(page.sentToday(), 0);
  await until(() => !page.$('album').options.some((o) => o.value === page.made.today), 'the list reloaded without the closed album');
  assert.equal(page.$('album').value, '');
});

test('#198: a clip shared from the gallery through the real worker is offered, sent, and its record deleted once stored; while it waits the note names it', async () => {
  const shared = (name) => clipFile(androidMp4().file, { name, type: 'video/mp4' });
  const db = idb();
  await shareFrom(db, [shared('VID_20261001_101500.mp4')]);
  const page = await load({ search: '?shared', db });
  await joined(page);
  await until(() => page.items()[0]?.state === 'ready', 'offered, ready to send');
  assert.equal(page.items()[0].frame.textContent, 'Clip 1, 0:05');
  assert.equal(inboxFiles(db).length, 1, 'kept until it is stored');
  page.click(page.$('send'));
  await settled(page);
  const [row] = page.rows();
  assert.deepEqual([row.kind, row.state, row.content_type], ['clip', 'pending', 'video/mp4']);
  await until(() => inboxFiles(db).length === 0, 'its record deleted once stored');

  // With no session, the note counts what waits by kind.
  const alone = idb();
  await shareFrom(alone, [shared('VID_1.mp4')]);
  const one = await load({ search: '?shared', db: alone, session: null });
  await until(() => note(one) !== null, 'the note');
  assert.equal(note(one), '1 clip you shared is waiting on this phone. Sign in, and it will be ready to send. Shared clips are kept here for a day.');
  const mixed = idb();
  await shareFrom(mixed, [photoFile(), shared('VID_2.mp4')]);
  const both = await load({ search: '?shared', db: mixed, session: null });
  await until(() => note(both) !== null, 'the note');
  assert.equal(note(both), '1 photo and 1 clip you shared are waiting on this phone. Sign in, and they will be ready to send. Shared photos and clips are kept here for a day.');
});

// ---- #198's review: the share page's skeptic, kept as tests ----------------
//
// A read-only skeptic tried to break the clip path once it was built. Each
// test below began as one of its repros: the first three hold what was then
// fixed, and the rest paths that no test held, each shown by a mutant the
// suite let through.

test('#198: Try again starts a clip afresh, "Sending…" with Remove offered while the new start runs, whether the last try failed at a part or was refused at the complete', async () => {
  // Part 2 fails four times; then Try again, the new start held.
  let page = await load({ timers: 'fast' });
  await joined(page);
  let down = true;
  page.net.clipIntercept = (call) => (down && call.step === 'part' && call.n === 2 ? 'network' : undefined);
  page.choose(clipFile(iphoneTwoParts().file));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].state, 'failed');
  down = false;
  page.net.clipHold = (call) => call.step === 'start';
  page.click(page.items()[0].tryAgain);
  await until(() => page.net.clipWaiting.length === 1, 'the new start held');
  assert.deepEqual([page.items()[0].text, page.items()[0].remove.hidden], ['Sending…', false], 'after a part failed');
  page.releaseClip();
  await settled(page);
  assert.equal(page.items()[0].state, 'sent');

  // The complete refused once; then Try again, the new start held: the last
  // try's finishing no longer hides Remove.
  page = await load({ timers: 'fast' });
  await joined(page);
  let once = true;
  page.net.clipIntercept = (call) => {
    if (call.step !== 'complete' || !once) return undefined;
    once = false;
    return Response.json({ error: 'not-clip' }, { status: 415 });
  };
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].state, 'failed');
  page.net.clipHold = (call) => call.step === 'start';
  page.click(page.items()[0].tryAgain);
  await until(() => page.net.clipWaiting.length === 1, 'the new start held');
  assert.deepEqual([page.items()[0].text, page.items()[0].remove.hidden], ['Sending…', false], 'after the complete failed');
  page.releaseClip();
  await settled(page);

  // The control: a first send reads the same while its start runs.
  page = await load();
  await joined(page);
  page.net.clipHold = (call) => call.step === 'start';
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the start held');
  assert.deepEqual([page.items()[0].text, page.items()[0].remove.hidden], ['Sending…', false], 'a first send');
  page.releaseClip();
  await settled(page);
});

test('#198: an abandon that got no answer is sent again before Try again\'s new start, so the day counts one upload for one clip', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  let down = true;
  page.net.clipIntercept = (call) => (down && (call.step === 'part' || call.step === 'abandon') ? 'network' : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  // Four lost parts and a lost abandon: the upload is still the server's.
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['uploading'], 1]);
  down = false;
  page.click(page.items()[0].tryAgain);
  await settled(page);
  assert.deepEqual(steps(page).slice(-4), ['abandon', 'start', 'part 1', 'complete']);
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
});

test('#198: Remove on a failed clip whose abandon got no answer sends the abandon again, and the day is given back', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  let down = true;
  page.net.clipIntercept = (call) => (down && (call.step === 'part' || call.step === 'abandon') ? 'network' : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['uploading'], 1]);
  down = false;
  page.click(page.items()[0].remove);
  await until(() => page.net.inFlight === 0 && steps(page).filter((s) => s === 'abandon').length === 2, 'abandoned again');
  await page.env.MEDIA.idle();
  assert.deepEqual([page.items().length, page.rows().length, page.sentToday()], [0, 0, 0]);
});

test('#198: a clip removed while its upload starts keeps its turn until that upload is let go of: no second clip starts beside it', async () => {
  const page = await load();
  await joined(page);
  page.net.clipHold = (call) => call.step === 'start' && page.net.clipCalls.filter((c) => c.step === 'start').length === 1;
  page.choose(clipFile(lasting(30)), clipFile(lasting(40), { name: 'IMG_0002.MOV' }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the first start held');
  page.click(page.items()[0].remove);
  // A photo made ready runs the queue again.
  page.choose(photoFile());
  await until(() => page.items().at(-1)?.state === 'ready', 'the photo ready');
  for (let i = 0; i < 50; i += 1) await tick();
  assert.deepEqual(steps(page), ['start'], 'a second clip started beside the first');
  page.releaseClip();
  await settled(page);
  await until(() => page.net.inFlight === 0, 'quiet');
  assert.equal(page.net.maxClipsInFlight, 1);
  assert.deepEqual(steps(page), ['start', 'abandon', 'start', 'part 1', 'complete']);
});

test('#198: Remove on a shared clip while it sends deletes its record from the phone and abandons its upload', async () => {
  const db = idb();
  await shareFrom(db, [clipFile(androidMp4().file, { name: 'VID_9.mp4', type: 'video/mp4' })]);
  const page = await load({ search: '?shared', db });
  await joined(page);
  await until(() => page.items()[0]?.state === 'ready', 'offered');
  page.net.clipHold = (call) => call.step === 'part';
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the part in flight');
  assert.equal(inboxFiles(db).length, 1);
  page.click(page.items()[0].remove);
  await until(() => inboxFiles(db).length === 0, 'its record deleted on Remove');
  await until(() => steps(page).includes('abandon') && page.net.inFlight === 0, 'abandoned');
  await page.env.MEDIA.idle();
  assert.deepEqual(page.uploads().map((u) => u.state), ['aborted']);
});

test('#198: a coach\'s clip over a parent\'s 1 GiB but under 4 GiB is not refused, and reaches the start declaring its size', async () => {
  const GiB = 1024 ** 3;
  const page = await load({ role: 'coach' });
  await until(() => page.$('album').options.some((o) => o.value), 'albums listed');
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'unavailable' }, { status: 503 }) : undefined);
  page.choose(composed(mdatTo(2 * GiB), 2 * GiB, new Uint8Array(0)));
  await until(() => ['ready', 'unreadable'].includes(page.items()[0]?.state), 'judged');
  assert.equal(page.items()[0].state, 'ready', page.items()[0].text);
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.net.clipCalls[0]?.body.bytes, 2 * GiB);
});

test('#198: Send pressed while a clip still waits its turn to be made ready queues it, and it is sent', async () => {
  const page = await load();
  await joined(page);
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }), clipFile(lasting(30)));
  assert.equal(page.items()[3].state, 'preparing');
  page.click(page.$('send'));
  assert.equal(page.items()[3].state, 'queued');
  await settled(page);
  assert.deepEqual(page.items().map((i) => i.state), ['sent', 'sent', 'sent', 'sent']);
});

test('#198: a clip\'s length is rounded up, so one 0.4 s over a parent\'s 3 minutes reads past the cap, in its words and its frame', async () => {
  const page = await load();
  await joined(page);
  const over = plainClip({ clip: { movie: mvhd({ time: [0, 0], timescale: 1000, duration: 180_400 }) } }).file;
  page.choose(clipFile(over));
  await until(() => page.items()[0]?.state === 'unreadable', 'refused');
  assert.equal(page.items()[0].text, "This clip runs 3:01, longer than the 3 minutes you can send, so it won't be sent. Trim it, then add it again.");
  assert.equal(page.items()[0].frame.textContent, 'Clip 1, 3:01');
});

test('#198: a part answered 401 fails the clip and every queued photo, and the session ends', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.net.clipIntercept = (call) => (call.step === 'part' ? Response.json({ error: 'session' }, { status: 401 }) : undefined);
  page.choose(clipFile(lasting(30)), photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }), photoFile({ width: 3100, height: 2000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await until(() => page.items()[0].state === 'failed', 'the clip failed');
  assert.deepEqual(page.items().map((i) => i.state), ['failed', 'sending', 'sending', 'failed', 'failed']);
  assert.equal(page.$('join-status').textContent, ENDED);
  page.net.hold = false;
  page.release();
  await settled(page);
});

test('#198: a clip refused 403 team at its start fails the photos queued for that album, and the list reloads choosing nothing', async () => {
  const page = await load({ albums: BOTH_TEAMS, accountTeams: ['hoover-jrt', 'cohssa'], hold: true });
  await signedIn(page);
  page.$('album').value = page.made.cohssa;
  page.net.clipHold = (call) => call.step === 'start';
  page.choose(clipFile(lasting(30)), photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1 && page.net.waiting.length === 2, 'the clip\'s start and two photos in flight');
  page.env.DB.sqlite.prepare("UPDATE account_teams SET state = 'revoked' WHERE account_id = 1 AND team = 'cohssa'").run();
  page.releaseClip();
  await until(() => page.items()[0].state === 'failed', 'the clip failed');
  assert.equal(page.items()[0].text, TEAM_REFUSED);
  assert.equal(page.items()[3].text, TEAM_REFUSED);
  await until(() => !page.$('album').options.some((o) => o.value === page.made.cohssa), 'reloaded without the team');
  assert.equal(page.$('album').value, '');
  page.net.hold = false;
  page.release();
  await settled(page);
});

test('#198: a clip refused 429 at its start fails every queued item, a clip behind it included', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.net.clipHold = (call) => call.step === 'start';
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'daily-cap' }, { status: 429 }) : undefined);
  page.choose(clipFile(lasting(30)), photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }), clipFile(lasting(40), { name: 'IMG_0002.MOV' }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1 && page.net.waiting.length === 2, 'in flight');
  page.releaseClip();
  await until(() => page.items()[0].state === 'failed', 'the clip failed');
  assert.deepEqual(page.items().map((i) => i.state), ['failed', 'sending', 'sending', 'failed', 'failed']);
  assert.ok(page.items()[4].text.includes('500 photos and clips'));
  page.net.hold = false;
  page.release();
  await settled(page);
});

test('#198: a clip refused 429 clip-bytes at its start fails every queued clip, and the photos still go (SA-1)', async () => {
  const page = await load({ hold: true });
  await joined(page);
  page.net.clipHold = (call) => call.step === 'start';
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'clip-bytes' }, { status: 429 }) : undefined);
  page.choose(clipFile(lasting(30)), photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }), clipFile(lasting(40), { name: 'IMG_0002.MOV' }));
  await until(() => page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1 && page.net.waiting.length === 2, 'in flight');
  page.releaseClip();
  await until(() => page.items()[0].state === 'failed', 'the clip failed');
  assert.equal(page.items()[4].state, 'failed', 'the clip queued behind it');
  assert.notEqual(page.items()[3].state, 'failed', 'a queued photo, which the budget does not count');
  assert.deepEqual([page.items()[0].text, page.items()[4].text], [CLIP_DAY, CLIP_DAY]);
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.deepEqual(page.items().map((i) => i.state), ['failed', 'sent', 'sent', 'sent', 'failed']);
  assert.equal(page.net.clipCalls.filter((c) => c.step === 'start').length, 1, 'the clip queued behind it was sent, only to be refused');
});

test('#198: a clip refused clip-bytes by a list that named no day\'s budget says "today\'s limit of clips", not a figure it does not have', async () => {
  const page = await load();
  page.net.albumsAnswer = () => Response.json({
    albums: [{ address: page.made.today, title: 'Tuesday practice', kind: 'practice', date: dayOffset(0), team: 'hoover-jrt', teamName: 'Hoover JRT' }],
    other: [],
    clip: { seconds: CLIP_SECONDS.everyone, bytes: CLIP_BYTES.everyone },
  });
  await joined(page);
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'clip-bytes' }, { status: 429 }) : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].text, 'Failed. Your account has sent today\'s limit of clips. Photos can still go; try clips again tomorrow.');
});

test('#198: a complete refused 400 parts, which leaves the row uploading, is abandoned by the page, and the day is given back', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.net.clipIntercept = (call) => (call.step === 'complete' ? Response.json({ error: 'parts' }, { status: 400 }) : undefined);
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(steps(page), ['start', 'part 1', 'complete', 'abandon']);
  assert.deepEqual([page.rows().length, page.sentToday()], [0, 0]);
});

test('#198: a part answered a plain 500, as the runtime answers an uncaught error, is tried again after a second, and the clip arrives', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  let once = true;
  page.net.clipIntercept = (call) => {
    if (call.step !== 'part' || !once) return undefined;
    once = false;
    return new Response('Internal Server Error', { status: 500 });
  };
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].state, 'sent');
  assert.deepEqual(steps(page), ['start', 'part 1', 'part 1', 'complete']);
  assert.deepEqual(page.waits, [1000]);
});

test('#198: a clip whose camera recorded no time and whose file is dated before 1970 is captured at 0, a time the server takes', async () => {
  const page = await load();
  await joined(page);
  page.choose(clipFile(lasting(30), { lastModified: -5_000 }));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  assert.equal(page.items()[0].state, 'sent', page.items()[0].text);
  assert.equal(page.rows()[0].captured_at, 0);
});

// ---- #198's review: a complete that got no answer -----------------------
//
// Any one of a complete's four tries can store the clip and lose its answer
// on the way back. The review's refuter showed what the page did then: it
// abandoned the upload, the DELETE was answered as settled, and Try again
// stored the clip a second time, spending a second of the day's 500; or
// Remove took the item off while the clip waited in the queue. The owner's
// decisions at the review gate: the page keeps the complete on the clip, Try
// again sends that complete again before anything else, and Remove asks with
// the DELETE, whose 409 says the clip arrived. The refuter's probes A, C, D,
// F and G are each one of the tests below.

/**
 * Sends the page's clips with every try of each complete answered as
 * `complete(call)` says ('lost', the route run and its answer lost;
 * 'network'; or a Response), then lets every request through again.
 */
async function sendLosing(page, complete) {
  page.net.clipIntercept = (call) => (call.step === 'complete' ? complete(call) : undefined);
  await until(() => page.items().length > 0 && page.items().every((i) => i.state === 'ready'), 'ready');
  page.click(page.$('send'));
  await settled(page);
  page.net.clipIntercept = null;
}

const ARRIVED = 'Sent. It reached the photo site before you pressed Remove.';
const UNAVAILABLE = "Failed. The photo site isn't taking clips right now. Try again in a few minutes.";

test('#198 (review): a complete that stored the clip and lost every answer fails with Try again, which sends that complete again: Sent, stored once, nothing else sent', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'lost');
  await page.env.MEDIA.idle();
  // Stored by its first try, and nothing abandoned.
  assert.deepEqual(steps(page), ['start', 'part 1', 'complete', 'complete', 'complete', 'complete']);
  const [item] = page.items();
  assert.deepEqual([item.state, item.text, item.tryAgain.hidden, item.remove.hidden], ['failed', OFFLINE, false, false]);
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
  assert.equal(page.summary(), 'Sent 0 of 1. 1 failed: press Try again on it.');
  // Its caption went with the start, so it is fixed while the complete is
  // kept (owner, at #198's review).
  assert.equal(item.caption.readOnly, true, 'the caption of a clip whose complete is kept can be edited');
  const lost = page.net.clipCalls.at(-1);

  page.click(item.tryAgain);
  await settled(page);
  // The same complete, under the same token, and nothing more.
  assert.deepEqual(steps(page).slice(6), ['complete']);
  const again = page.net.clipCalls.at(-1);
  assert.deepEqual([again.id, again.token, again.body], [lost.id, lost.token, lost.body]);
  assert.equal(page.items()[0].text, 'Sent');
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
  assert.deepEqual(page.uploads().map((u) => u.state), ['completed']);
  assert.equal(page.summary(), "Sent 1 clip. Clips aren't shown on the site yet.");
});

for (const [what, later, words] of [
  ['never reach the site', () => 'network', OFFLINE],
  ['are answered 503', () => Response.json({ error: 'unavailable' }, { status: 503 }), UNAVAILABLE],
]) {
  test(`#198 (review): a complete whose first try stored the clip and whose three more ${what} fails in that answer's words, abandons nothing, and Try again sends it again: stored once`, async () => {
    const page = await load({ timers: 'fast' });
    await joined(page);
    page.choose(clipFile(lasting(30)));
    await sendLosing(page, (call) => (call.attempt === 1 ? 'lost' : later()));
    const [item] = page.items();
    assert.deepEqual([item.state, item.text, item.tryAgain.hidden, item.remove.hidden], ['failed', words, false, false]);
    assert.deepEqual(steps(page), ['start', 'part 1', 'complete', 'complete', 'complete', 'complete']);
    assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
    page.click(item.tryAgain);
    await settled(page);
    assert.deepEqual(steps(page).slice(6), ['complete']);
    assert.equal(page.items()[0].text, 'Sent');
    assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
  });
}

test('#198 (review): a complete that never arrived is joined by Try again from the parts already in the bucket, with no part sent again', async () => {
  const { file: bytes } = iphoneTwoParts();
  const plan = await planOf(bytes);
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(bytes));
  await sendLosing(page, () => 'network');
  // Nothing abandoned: the row still uploading, both parts in the bucket.
  assert.deepEqual(steps(page), ['start', 'part 1', 'part 2', 'complete', 'complete', 'complete', 'complete']);
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['uploading'], 1]);
  assert.deepEqual(page.uploads().map((u) => [u.state, u.parts.size]), [['open', 2]]);
  page.click(page.items()[0].tryAgain);
  await settled(page);
  assert.deepEqual(steps(page).slice(7), ['complete']);
  assert.equal(page.items()[0].text, 'Sent');
  const [row] = page.rows();
  assert.deepEqual([row.state, page.sentToday()], ['pending', 1]);
  assert.ok(Buffer.from(storedClip(page, row)).equals(Buffer.from(applied(bytes, plan))), 'the bucket holds other bytes than the plan');
});

test('#198 (review): a complete sent again and answered 404, its upload cleared by the sweep a day on, starts afresh in the same press, into the album chosen now', async () => {
  const page = await load({ timers: 'fast', albums: TWO_ALBUMS });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'network');
  assert.deepEqual(page.rows().map((r) => [r.state, r.address]), [['uploading', page.made.today]]);
  assert.equal(await clearStaleClips(page.env, Math.floor(Date.now() / 1000) + STALE_SECONDS), 1, 'the sweep cleared nothing');
  page.$('album').value = page.made.past;
  page.net.clipHold = (call) => call.step === 'complete' || call.step === 'start';
  page.click(page.items()[0].tryAgain);
  await until(() => page.net.clipWaiting.length === 1, 'the complete sent again, held');
  // A complete sent again is a complete: Remove is withdrawn while it goes.
  assert.deepEqual([steps(page).at(-1), page.items()[0].text, page.items()[0].remove.hidden], ['complete', 'Sending…', true]);
  page.releaseClip();
  await until(() => steps(page).at(-1) === 'start' && page.net.clipWaiting.length === 1, 'the new start, held');
  // Offered again while the new start runs, as for any start.
  assert.deepEqual([page.items()[0].text, page.items()[0].remove.hidden], ['Sending…', false]);
  page.net.clipHold = null;
  page.releaseClip();
  await settled(page);
  assert.deepEqual(steps(page).slice(6), ['complete', 'start', 'part 1', 'complete']);
  assert.equal(page.items()[0].text, 'Sent');
  assert.deepEqual(page.rows().map((r) => [r.state, r.address]), [['pending', page.made.past]]);
});

test('#198 (review): a complete sent again and refused for good says so in today\'s words, offers no Try again, and gives the upload back', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'network');
  page.net.clipIntercept = (call) => (call.step === 'complete' ? Response.json({ error: 'kept' }, { status: 422 }) : undefined);
  page.click(page.items()[0].tryAgain);
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(steps(page).slice(6), ['complete', 'abandon']);
  const [item] = page.items();
  assert.deepEqual([item.state, item.text, item.tryAgain.hidden, item.remove.hidden], ['failed', CLIP_KEPT, true, false]);
  assert.equal(item.caption.readOnly, false, 'a clip refused at its complete kept its caption fixed');
  assert.equal(page.summary(), 'Sent 0 of 1. 1 failed.');
  assert.deepEqual([page.rows().length, page.sentToday()], [0, 0]);
});

test('#198 (review): a complete sent again into an album that has closed fails in the album\'s words, stops only what is queued for that album, and stores nothing', async () => {
  const page = await load({ timers: 'fast', albums: TWO_ALBUMS, hold: true });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'network');
  // Its upload started in today's album, which closes; the sender has the
  // other one chosen when they press Try again.
  page.env.DB.sqlite.prepare('UPDATE albums SET closed_at = 1 WHERE address = ?').run(page.made.today);
  page.$('album').value = page.made.past;
  page.net.clipHold = (call) => call.step === 'complete';
  page.click(page.items()[0].tryAgain);
  await until(() => page.net.clipWaiting.length === 1, 'the complete sent again, held');
  // Three photos for the album chosen now: two go beside the clip, one waits.
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().slice(1).every((i) => i.state === 'ready'), 'the photos ready');
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 2, 'two photos held');
  assert.equal(page.items()[3].state, 'queued');
  page.net.clipHold = null;
  page.releaseClip();
  await until(() => page.items()[0].state === 'failed', 'the clip failed');
  assert.deepEqual([page.items()[0].text, page.items()[0].tryAgain.hidden], [CLOSED, false]);
  assert.notEqual(page.items()[3].state, 'failed', 'a photo queued for the album chosen now was stopped as if that album had closed');
  page.net.hold = false;
  page.release();
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(page.items().map((i) => i.state), ['failed', 'sent', 'sent', 'sent']);
  assert.deepEqual(page.rows().map((r) => [r.kind, r.address]), new Array(3).fill(['photo', page.made.past]));
  assert.deepEqual(steps(page).slice(6), ['complete', 'abandon']);
  assert.equal(page.sentToday(), 3);
  // Refused, its complete is not kept: Try again starts afresh, into the
  // album chosen now, with no complete sent first.
  page.click(page.items()[0].tryAgain);
  await settled(page);
  assert.deepEqual(steps(page).slice(8), ['start', 'part 1', 'complete']);
  assert.deepEqual([page.items()[0].text, page.rows().filter((r) => r.kind === 'clip').map((r) => r.address)], ['Sent', [page.made.past]]);
});

test('#198 (review): Remove on a clip whose complete stored it and lost every answer asks first, and the clip shows Sent, saying it arrived before Remove; Remove sends no complete', async () => {
  const db = idb();
  await shareFrom(db, [clipFile(androidMp4().file, { name: 'VID_7.mp4', type: 'video/mp4' })]);
  const page = await load({ search: '?shared', db, timers: 'fast' });
  await joined(page);
  await sendLosing(page, () => 'lost');
  assert.equal(inboxFiles(db).length, 1, 'its record deleted while the page could not say it had arrived');
  page.net.clipHold = (call) => call.step === 'abandon';
  page.click(page.items()[0].remove);
  await until(() => page.net.clipWaiting.length === 1, 'the question held');
  // The item stays while the server is asked: Remove and Try again
  // withdrawn, the caption fixed, and the focus on it.
  const asking = page.items()[0];
  assert.deepEqual(
    [asking.state, asking.text, asking.remove.hidden, asking.tryAgain.hidden, asking.caption.readOnly],
    ['checking', 'Checking whether it arrived…', true, true, true],
  );
  assert.equal(page.document.activeElement, asking.caption, 'focus fell to the page with Remove hidden');
  page.releaseClip();
  await settled(page);
  const [item] = page.items();
  assert.deepEqual([item.state, item.text, item.remove.hidden, item.tryAgain.hidden], ['sent', ARRIVED, true, true]);
  assert.deepEqual(steps(page).slice(6), ['abandon'], 'Remove sent more than its question');
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
  assert.equal(page.summary(), "Sent 1 clip. Clips aren't shown on the site yet.");
  await until(() => inboxFiles(db).length === 0, 'its record deleted once it was known to have arrived');
});

test('#198 (review): Remove on a clip whose complete never arrived asks first; the DELETE takes the upload back, and the item goes with the day given back', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'network');
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['uploading'], 1]);
  page.click(page.items()[0].remove);
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(steps(page).slice(6), ['abandon'], 'Remove sent more than its question');
  assert.deepEqual([page.items().length, page.rows().length, page.sentToday()], [0, 0, 0]);
  assert.deepEqual(page.uploads().map((u) => u.state), ['aborted']);
  assert.equal(page.document.activeElement, page.$('photo-input'), 'focus went to the page with the last item removed');
});

test('#198 (review): a clip that goes once the server answers moves the focus as Remove does only from where Remove left it; a sender who moved on keeps their place', async () => {
  for (const movedOn of [false, true]) {
    const page = await load({ timers: 'fast' });
    await joined(page);
    page.choose(clipFile(lasting(30)));
    await sendLosing(page, () => 'network');
    page.choose(photoFile());
    await until(() => page.items()[1]?.state === 'ready', 'the photo ready');
    page.net.clipHold = (call) => call.step === 'abandon';
    page.click(page.items()[0].remove);
    await until(() => page.net.clipWaiting.length === 1, 'the question held');
    const photo = page.items()[1];
    if (movedOn) photo.caption.focus();
    page.releaseClip();
    await settled(page);
    assert.equal(page.items().length, 1);
    assert.equal(
      page.document.activeElement, movedOn ? photo.caption : photo.remove,
      movedOn ? 'the focus was taken from the caption the sender had moved to' : 'the focus did not move to the next Remove',
    );
  }
});

test('#198 (review): Remove whose question gets no answer, or a 5xx, through all its tries leaves the clip failed with Remove and Try again; a later Remove that is answered settles it', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'lost');
  for (const [answer, words] of [[() => 'network', OFFLINE], [() => Response.json({ error: 'unavailable' }, { status: 503 }), UNAVAILABLE]]) {
    page.net.clipIntercept = (call) => (call.step === 'abandon' ? answer() : undefined);
    page.waits.length = 0;
    page.click(page.items()[0].remove);
    await settled(page);
    const [item] = page.items();
    assert.deepEqual([item.state, item.text, item.remove.hidden, item.tryAgain.hidden], ['failed', words, false, false]);
    assert.deepEqual(page.waits, [1000, 3000, 9000], 'the question was not tried again as a complete is');
  }
  assert.deepEqual(steps(page).slice(6), new Array(8).fill('abandon'));
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
  page.net.clipIntercept = null;
  page.click(page.items()[0].remove);
  await settled(page);
  assert.equal(page.items()[0].text, ARRIVED);
  assert.deepEqual(steps(page).slice(14), ['abandon']);
});

test('#198 (review): an abandon answered 409 after a part failed is settled, as any answer under 500 is: Try again starts afresh, and Remove takes the item at once', async () => {
  for (const press of ['tryAgain', 'remove']) {
    const page = await load({ timers: 'fast' });
    await joined(page);
    let down = true;
    page.net.clipIntercept = (call) => {
      if (!down) return undefined;
      if (call.step === 'part') return 'network';
      return call.step === 'abandon' ? Response.json({ error: 'stored' }, { status: 409 }) : undefined;
    };
    page.choose(clipFile(lasting(30)));
    await until(() => page.items()[0]?.state === 'ready', 'ready');
    page.click(page.$('send'));
    await settled(page);
    assert.deepEqual(steps(page), ['start', 'part 1', 'part 1', 'part 1', 'part 1', 'abandon']);
    assert.deepEqual([page.items()[0].state, page.items()[0].text], ['failed', OFFLINE]);
    // The control for the caption: a clip that failed at a part keeps none.
    assert.equal(page.items()[0].caption.readOnly, false, 'a clip that failed at a part had its caption fixed');
    down = false;
    page.click(page.items()[0][press]);
    await settled(page);
    assert.deepEqual(steps(page).slice(6), press === 'tryAgain' ? ['start', 'part 1', 'complete'] : [], `${press}: the 409 was read as anything but settled`);
    assert.deepEqual(page.items().map((i) => i.state), press === 'tryAgain' ? ['sent'] : []);
  }
});

test('#198 (review): Remove on a clip holding both an abandon that got no answer and a complete that got none lets go of the first before it asks about the second', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  // Its first press: four lost parts, and the abandon lost too. Its second:
  // that abandon lost again, then a new upload whose complete stored it and
  // lost every answer.
  let press = 1;
  page.net.clipIntercept = (call) => {
    if (press === 1 && (call.step === 'part' || call.step === 'abandon')) return 'network';
    if (press === 2 && call.step === 'abandon') return 'network';
    return press === 2 && call.step === 'complete' ? 'lost' : undefined;
  };
  page.choose(clipFile(lasting(30)));
  await until(() => page.items()[0]?.state === 'ready', 'ready');
  page.click(page.$('send'));
  await settled(page);
  press = 2;
  page.click(page.items()[0].tryAgain);
  await settled(page);
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['uploading', 'pending'], 2]);
  const [left, stored] = page.rows().map((r) => r.id);
  press = 3;
  page.click(page.items()[0].remove);
  await settled(page);
  await page.env.MEDIA.idle();
  assert.deepEqual(page.net.clipCalls.slice(-2).map((c) => [c.step, c.id]), [['abandon', left], ['abandon', stored]]);
  assert.equal(page.items()[0].text, ARRIVED);
  assert.deepEqual([page.rows().map((r) => [r.id, r.state]), page.sentToday()], [[[stored, 'pending']], 1]);
});

// The verifier's round on the fix (#198's review) found each of these held
// by no test: a one-line change to any of them passed the whole suite.

for (const [what, answer, words] of [
  ['gets no answer', () => 'network', OFFLINE],
  ['is answered 503', () => Response.json({ error: 'unavailable' }, { status: 503 }), UNAVAILABLE],
]) {
  test(`#198 (review): a complete sent again that ${what} through all its tries is kept, tried as a complete is; a later press sends it once more, and it is stored once`, async () => {
    const page = await load({ timers: 'fast' });
    await joined(page);
    page.choose(clipFile(lasting(30)));
    await sendLosing(page, () => 'lost');
    page.net.clipIntercept = (call) => (call.step === 'complete' ? answer() : undefined);
    page.waits.length = 0;
    page.click(page.items()[0].tryAgain);
    await settled(page);
    let [item] = page.items();
    assert.deepEqual([item.state, item.text, item.tryAgain.hidden, item.remove.hidden], ['failed', words, false, false]);
    // Not abandoned, and not refused: abandoning it here is the duplicate
    // the review found, one press later.
    assert.deepEqual(steps(page).slice(6), ['complete', 'complete', 'complete', 'complete']);
    assert.deepEqual(page.waits, [1000, 3000, 9000], 'the complete sent again was not tried as a complete is');
    assert.equal(item.caption.readOnly, true, 'the caption of a clip whose complete is kept can be edited');
    page.net.clipIntercept = null;
    page.click(item.tryAgain);
    await settled(page);
    assert.deepEqual(steps(page).slice(10), ['complete']);
    [item] = page.items();
    assert.equal(item.text, 'Sent');
    assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
  });
}

test('#198 (review): Remove on a clip whose upload the sweep has cleared asks, the DELETE answers 404, and the item goes; a focus a tap never moved, on the page\'s body, moves as Remove moves it', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'network');
  page.choose(photoFile());
  await until(() => page.items()[1]?.state === 'ready', 'the photo ready');
  assert.equal(await clearStaleClips(page.env, Math.floor(Date.now() / 1000) + STALE_SECONDS), 1, 'the sweep cleared nothing');
  page.net.clipHold = (call) => call.step === 'abandon';
  page.click(page.items()[0].remove);
  await until(() => page.net.clipWaiting.length === 1, 'the question held');
  // Safari does not focus a tapped button, so the focus can be the body.
  page.document.body.focus();
  const photo = page.items()[1];
  page.net.clipHold = null;
  page.releaseClip();
  await settled(page);
  assert.deepEqual(steps(page).slice(6), ['abandon']);
  assert.deepEqual(page.items().map((i) => i.state), ['ready'], 'a clip with nothing stored could not be removed');
  assert.equal(page.document.activeElement, photo.remove, 'the focus stayed on the page\'s body');
});

test('#198 (review): Remove on a clip whose complete got no answer, queued by Try again behind a clip that sends, asks first too: Sent, saying it arrived, and never started again', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'lost');
  page.choose(clipFile(lasting(40), { name: 'IMG_0002.MOV' }));
  await until(() => page.items()[1]?.state === 'ready', 'the second clip ready');
  page.net.clipHold = (call) => call.step === 'start';
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the second clip\'s start held');
  page.click(page.items()[0].tryAgain);
  assert.deepEqual([page.items()[0].state, page.items()[0].remove.hidden], ['queued', false]);
  page.net.clipHold = null;
  page.click(page.items()[0].remove);
  await until(() => page.items()[0].state !== 'checking', 'the question answered');
  assert.deepEqual([page.items()[0].state, page.items()[0].text], ['sent', ARRIVED]);
  page.releaseClip();
  await settled(page);
  // The second clip's start, Remove's question, then the second clip's part
  // and complete: no start for the first.
  assert.deepEqual(steps(page).slice(6), ['start', 'abandon', 'part 1', 'complete']);
  assert.deepEqual([page.items().map((i) => i.state), page.rows().map((r) => r.state)], [['sent', 'sent'], ['pending', 'pending']]);
});

test('#198 (review): a photo refused 429 for the day stops the queue but for a clip whose complete got no answer, which then goes and is stored at once, spending nothing', async () => {
  const page = await load({ timers: 'fast', hold: true });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'lost');
  page.choose(photoFile(), photoFile({ width: 3000, height: 2000 }), photoFile({ width: 2000, height: 3000 }));
  await until(() => page.items().slice(1).every((i) => i.state === 'ready'), 'the photos ready');
  page.click(page.$('send'));
  await until(() => page.net.waiting.length === 3, 'three photos held');
  // Try again queues the clip behind them.
  page.click(page.items()[0].tryAgain);
  assert.equal(page.items()[0].state, 'queued');
  page.net.intercept = () => Response.json({ error: 'daily-cap' }, { status: 429 });
  page.release(1);
  await until(() => page.items()[0].state !== 'queued', 'the clip went or was stopped');
  assert.notEqual(page.items()[0].state, 'failed', 'the day\'s 500 stopped a clip whose Try again spends none of them');
  page.net.hold = false;
  page.release();
  await settled(page);
  assert.deepEqual([page.items()[0].state, page.items()[0].text], ['sent', 'Sent']);
  assert.deepEqual(steps(page).slice(6), ['complete']);
  assert.deepEqual(page.rows().filter((r) => r.kind === 'clip').map((r) => r.state), ['pending']);
});

test('#198 (review): a clip refused 429 clip-bytes stops the clips queued behind it but for one whose complete got no answer, which then goes and is stored at once', async () => {
  const page = await load({ timers: 'fast' });
  await joined(page);
  page.choose(clipFile(lasting(30)));
  await sendLosing(page, () => 'lost');
  page.choose(clipFile(lasting(40), { name: 'IMG_0002.MOV' }));
  await until(() => page.items()[1]?.state === 'ready', 'the second clip ready');
  page.net.clipHold = (call) => call.step === 'start';
  page.net.clipIntercept = (call) => (call.step === 'start' ? Response.json({ error: 'clip-bytes' }, { status: 429 }) : undefined);
  page.click(page.$('send'));
  await until(() => page.net.clipWaiting.length === 1, 'the second clip\'s start held');
  page.click(page.items()[0].tryAgain);
  assert.equal(page.items()[0].state, 'queued');
  page.net.clipHold = null;
  page.releaseClip();
  await settled(page);
  assert.deepEqual(page.items().map((i) => [i.state, i.text]), [['sent', 'Sent'], ['failed', CLIP_DAY]]);
  assert.deepEqual(steps(page).slice(6), ['start', 'complete']);
  assert.deepEqual([page.rows().map((r) => r.state), page.sentToday()], [['pending'], 1]);
});
