/* The photo site's service worker (#193): it takes the photos and clips
 * another app shares to the installed site, and does nothing else.
 *
 * On Android, a phone's gallery lists the installed site in its Share menu
 * (manifest.webmanifest, share_target), for clips as well as photos since
 * #198. Sharing to it is a POST of the chosen files to /share/receive, as a
 * page navigation. This worker answers that one POST: it puts the files in
 * this phone's browser storage (IndexedDB), one record per file, and sends
 * the browser on to the share page, /share/?shared, which offers them in its
 * list (js/share.js). Nothing is sent anywhere: a file reaches the server
 * only when the sender presses Send, made into the three JPEGs the share page
 * makes of any photo, or, for a clip, sent in parts with its location and
 * camera details overwritten (js/clip.js). A clip is kept here as it was
 * shared, as a photo is, so this file needed no change of code for #198.
 *
 * The files wait in storage, not in memory, so they survive what unloads the
 * page: the sign-in round trip (a coach with no upload session signs in at
 * /coach and comes back, owner at #193's pickup), a second share before Send,
 * a reload. The share page deletes a file's record once its upload is stored
 * or the sender removes it (owner, at #193's review). Over a day old, a record
 * is deleted the next time the store is opened, by the page or by a new share,
 * and never offered. Nothing deletes it sooner: Pages runs no scheduled job,
 * so a share to an app never opened again stays on the phone until it is.
 *
 * What it never does: cache. It holds no Cache Storage, and it calls
 * respondWith for nothing but that POST. Every other request in its scope,
 * the share page, its scripts, /api/*, goes to the network exactly as it
 * would with no worker installed. That is what keeps two promises:
 *   - a photo taken down is gone at its next request (CLAUDE.md, The photo
 *     site, item 3): a worker that cached one would serve it after its
 *     takedown;
 *   - a new deploy reaches an installed app the next time it opens: the
 *     page comes from the network, never from a copy the worker kept (cairn's
 *     vite-plugin-pwa-autoupdate-ships-no-reload records a worker that kept
 *     the old code running).
 * test/sw.test.js runs this file's fetch handler over every kind of request
 * and holds both.
 *
 * Its scope is /share/, the folder it is served from, and a worker can never
 * control a page above that. So the album pages, the photos, /, /policy and
 * /admin never meet it at all. */
'use strict';

// The share target's address and form field (manifest.webmanifest).
const RECEIVE = '/share/receive';
const FIELD = 'photos';
// The store the share page reads (js/share.js holds the same three names).
// Changing a record's shape needs a new name here and there: a worker and a
// page from two deploys can meet on one phone.
const INBOX = 'madcow-shared';
const INBOX_VERSION = 1;
const FILES = 'files';
// How long a shared file is offered: a day.
const KEEP_MS = 24 * 60 * 60 * 1000;

// A new worker takes over at once. It keeps nothing, so there is no old copy
// for a page to be left running, and the share target's handling is always
// the newest deploy's.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== RECEIVE) return;
  event.respondWith(receive(request));
});

// The share page, told how the share went: ?shared when the files are kept,
// ?shared=empty when the share carried no file the worker could read (a
// share from Chrome itself arrives that way, measured on Android for #193),
// ?shared=failed when they could not be kept. A 303, so the page loads with a
// GET and a reload never posts the files again.
const back = (how) => Response.redirect(new URL(how ? `/share/?shared=${how}` : '/share/?shared', self.location.origin).href, 303);

// Who may start a share. Android's Share menu sends `Origin: null` (measured
// on a Samsung SM-S918U, Chrome 154, at #193's review), and a form on this
// site sends the site's own origin. A form on another site sends that site's
// origin and is refused, files unread: otherwise any page could put photos on
// the share page as if the sender had shared them (#193's security audit).
// A sandboxed frame can send `null` too, so that route stays open; what
// stands in front of it is the sender's own Send and an admin's approval.
const trusted = (origin) => origin === null || origin === 'null' || origin === self.location.origin;

async function receive(request) {
  if (!trusted(request.headers.get('Origin'))) {
    return Response.redirect(new URL('/share/', self.location.origin).href, 303);
  }
  let files;
  try {
    const form = await request.formData();
    // A form field is a string or a file; only a file with bytes is a photo
    // or a clip, and which it is the share page decides (#198). A string has
    // no size, so the size test alone would drop it too: the typeof says
    // what is meant, and no test can tell the two apart.
    files = form.getAll(FIELD).filter((entry) => typeof entry !== 'string' && entry.size > 0);
  } catch {
    return back('failed');
  }
  if (files.length === 0) return back('empty');
  try {
    await keep(files);
  } catch {
    // Storage refused them, most likely full. The page says to share again.
    return back('failed');
  }
  return back('');
}

// Stores one record per file, in the order shared, and deletes every record
// over a day old, in one transaction: either all of it happens or none of it.
function keep(files) {
  return inbox('readwrite', (store) => {
    const now = Date.now();
    const share = crypto.randomUUID();
    files.forEach((file, index) => store.put({ id: crypto.randomUUID(), share, index, at: now, file }));
    const all = store.getAll();
    all.onsuccess = () => {
      for (const record of all.result) if (now - record.at > KEEP_MS) store.delete(record.id);
    };
  });
}

// Opens the store, runs `work` in one transaction, and settles once that
// transaction has committed or failed.
function inbox(mode, work) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(INBOX, INBOX_VERSION);
    open.onupgradeneeded = () => open.result.createObjectStore(FILES, { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const done = (err) => {
        db.close();
        if (err) reject(err);
        else resolve();
      };
      let tx;
      try {
        tx = db.transaction(FILES, mode);
      } catch (err) {
        done(err);
        return;
      }
      tx.oncomplete = () => done(null);
      tx.onabort = () => done(tx.error ?? new Error('aborted'));
      try {
        work(tx.objectStore(FILES));
      } catch {
        tx.abort();
      }
    };
  });
}
