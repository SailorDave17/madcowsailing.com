// The installed app's service worker (#193), public/share/sw.js, loaded in
// node:vm against a stand-in for a worker's global scope. test/sw.test.js
// tests it, and test/share.test.js hands it the same IndexedDB as the share
// page, so the store the worker writes and the page reads is tested from both
// ends at once, as #155 tests the page and the upload route.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { idb } from './idb.js';

export const SCRIPT = readFileSync(new URL('../public/share/sw.js', import.meta.url), 'utf8');
export const SITE = 'https://photos.madcowsailing.com';

/**
 * The worker in a fresh global scope. `db` is the IndexedDB it sees (a fresh
 * one by default), and `now` its clock. `caches` is a trap: any use of Cache
 * Storage throws and is recorded in `calls.caches`. `network` is the worker's
 * own `fetch`: by default one that fails, so a worker reaching for the
 * network shows up; a test that wants it to work routes it to the Functions.
 */
export function worker({ db = idb(), now = Date.now(), network = null } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0, caches: [] };
  const caches = new Proxy({}, {
    get(_, name) {
      calls.caches.push(String(name));
      throw new Error(`the worker used caches.${String(name)}`);
    },
  });
  class WorkerDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(now);
    }

    static now() {
      return now;
    }
  }
  const self = {
    location: new URL(`${SITE}/share/sw.js`),
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    skipWaiting: () => {
      calls.skipWaiting += 1;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        calls.claim += 1;
        return Promise.resolve();
      },
    },
    caches,
  };
  calls.network = [];
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.network.push(`${request.method} ${new URL(request.url).pathname}`);
    if (!network) throw new TypeError('This test gave the worker no network');
    return network(request);
  };
  self.fetch = fetch;
  vm.runInNewContext(SCRIPT, {
    self, caches, fetch, indexedDB: db.indexedDB, Response, Request, URL, crypto, Date: WorkerDate, console, setTimeout,
  });

  return {
    db,
    calls,
    listeners,
    /**
     * Dispatches a fetch event: the worker's answer, or null when it let the
     * request go by. Whatever the worker handed waitUntil is settled before
     * this returns, as a browser keeps the worker alive for it, so work done
     * in the background has happened by the next request.
     */
    async fetch(request) {
      let answer = null;
      const waited = [];
      const event = {
        request,
        respondWith(response) {
          assert.equal(answer, null, 'respondWith was called twice');
          answer = Promise.resolve(response);
        },
        waitUntil(promise) {
          waited.push(Promise.resolve(promise));
        },
      };
      for (const fn of listeners.fetch ?? []) fn(event);
      if (answer) await answer.catch(() => {});
      await Promise.allSettled(waited);
      return answer;
    },
    /** Runs a lifecycle event, settling with what it handed waitUntil. */
    async lifecycle(type) {
      const waited = [];
      for (const fn of listeners[type] ?? []) fn({ waitUntil: (p) => waited.push(p) });
      return Promise.all(waited);
    },
  };
}

/**
 * The share target's POST, as Chrome sends it: the manifest's form,
 * multipart, with `Origin: null`, which is what a launch from Android's Share
 * menu carried (measured on a Samsung, Chrome 154, at #193's review). Pass
 * `origin` to send another, or `undefined` for none.
 */
export function share(files, { field = 'photos', url = `${SITE}/share/receive`, extra = [], origin = 'null' } = {}) {
  const form = new FormData();
  for (const file of files) form.append(field, file);
  for (const [name, value] of extra) form.append(name, value);
  return new Request(url, { method: 'POST', body: form, headers: origin === undefined ? {} : { Origin: origin } });
}
