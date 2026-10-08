// An IndexedDB stand-in, just big enough for the installed app's store of
// shared photos (#193): public/share/sw.js writes it, public/js/share.js
// reads it. Hand-written, as test/d1.js and test/r2.js are, with no
// dependency.
//
// It keeps the three properties the two scripts rest on, so a script that
// breaks one fails here as it would in a browser:
//   - a transaction is all or nothing: its writes reach the store only when
//     it commits, and a failed request rolls every one of them back;
//   - transactions on one store run one at a time, in the order they were
//     made, so a read made after a write sees it;
//   - a transaction commits once its last request has answered and nothing
//     new was asked in that answer, which is when a browser commits it.
// Every event fires on a later turn of the event loop, never inside the call
// that caused it, as a browser's do.
//
// What it does not do: real structured cloning (a stored record is copied,
// objects and arrays one level at a time, and a File is kept as the same
// object, which a browser's clone of a File cannot be told apart from),
// indexes, cursors, key ranges, or version changes beyond the first open.

const later = (fn) => setTimeout(fn, 0);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

/**
 * A fresh, empty IndexedDB. `fail` makes requests throw: `fail.put` an error
 * for every put (a full disk is QuotaExceededError), `fail.open` an error for
 * every open.
 */
export function idb({ fail = {} } = {}) {
  const databases = new Map();
  // `answered` counts opens whose success or error has fired, so a test that
  // asserts nothing happened after a read can wait for the read to finish
  // first, by an event rather than by a count of turns (a fixed count of
  // turns can finish inside this stand-in's own timer).
  const state = { opens: 0, answered: 0, closes: 0, fail };

  function open(name, version = 1) {
    state.opens += 1;
    const request = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    later(() => {
      if (state.fail.open) {
        request.error = state.fail.open;
        state.answered += 1;
        request.onerror?.({ target: request });
        return;
      }
      let data = databases.get(name);
      if (data && version < data.version) {
        request.error = new DOMException(`${name} is at version ${data.version}`, 'VersionError');
        state.answered += 1;
        request.onerror?.({ target: request });
        return;
      }
      const upgrading = !data || version > data.version;
      if (!data) {
        data = { version: 0, stores: new Map() };
        databases.set(name, data);
      }
      const db = connection(data, upgrading);
      request.result = db;
      if (upgrading) {
        const oldVersion = data.version;
        data.version = version;
        request.onupgradeneeded?.({ target: request, oldVersion, newVersion: version });
        db.upgrading = false;
      }
      state.answered += 1;
      request.onsuccess?.({ target: request });
    });
    return request;
  }

  function connection(data, upgrading) {
    const db = {
      upgrading,
      closed: false,
      objectStoreNames: { contains: (n) => data.stores.has(n) },
      createObjectStore(storeName, { keyPath } = {}) {
        if (!db.upgrading) throw new DOMException('Not in an upgrade', 'InvalidStateError');
        if (data.stores.has(storeName)) throw new DOMException(`${storeName} exists`, 'ConstraintError');
        data.stores.set(storeName, { keyPath, rows: new Map(), active: null, waiting: [] });
      },
      transaction(storeName, mode = 'readonly') {
        if (db.closed) throw new DOMException('The connection is closed', 'InvalidStateError');
        const store = data.stores.get(storeName);
        if (!store) throw new DOMException(`No store named ${storeName}`, 'NotFoundError');
        return transaction(store, storeName, mode);
      },
      close() {
        if (db.closed) return;
        db.closed = true;
        state.closes += 1;
      },
    };
    return db;
  }

  function transaction(store, storeName, mode) {
    let staged = null;
    const queue = [];
    let finished = false;
    let scheduled = false;

    // Ends this transaction and, if it held the store, hands the store to the
    // next one waiting. One aborted while still waiting just leaves the line.
    const finish = () => {
      finished = true;
      queue.length = 0;
      if (store.active !== tx) {
        store.waiting.splice(store.waiting.indexOf(start), 1);
        return;
      }
      store.active = null;
      const next = store.waiting.shift();
      if (next) next();
    };

    const tx = {
      mode,
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore(name) {
        if (name !== storeName) throw new DOMException(`${name} is not in this transaction`, 'NotFoundError');
        return objectStore;
      },
      abort() {
        if (finished) throw new DOMException('The transaction has finished', 'InvalidStateError');
        finish();
        later(() => tx.onabort?.({ target: tx }));
      },
    };

    function schedule() {
      if (scheduled || finished || store.active !== tx) return;
      scheduled = true;
      later(step);
    }

    function step() {
      scheduled = false;
      if (finished) return;
      const next = queue.shift();
      if (!next) {
        store.rows = staged;
        finish();
        tx.oncomplete?.({ target: tx });
        return;
      }
      try {
        next.req.result = next.run();
      } catch (err) {
        next.req.error = err;
        next.req.onerror?.({ target: next.req });
        tx.error = err;
        tx.onerror?.({ target: tx });
        finish();
        tx.onabort?.({ target: tx });
        return;
      }
      next.req.onsuccess?.({ target: next.req });
      schedule();
    }

    const ask = (run) => {
      if (finished) throw new DOMException('The transaction has finished', 'TransactionInactiveError');
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      queue.push({ req, run });
      schedule();
      return req;
    };
    const writable = () => {
      if (mode !== 'readwrite') throw new DOMException('The transaction is read-only', 'ReadOnlyError');
    };

    const objectStore = {
      put(value) {
        writable();
        return ask(() => {
          if (state.fail.put) throw state.fail.put;
          const key = value[store.keyPath];
          if (key === undefined) throw new DOMException(`No ${store.keyPath} on the record`, 'DataError');
          staged.set(key, clone(value));
          return key;
        });
      },
      get: (key) => ask(() => clone(staged.get(key))),
      // In key order, as IndexedDB answers.
      getAll: () => ask(() => [...staged.keys()].sort().map((key) => clone(staged.get(key)))),
      delete(key) {
        writable();
        return ask(() => {
          staged.delete(key);
        });
      },
      clear() {
        writable();
        return ask(() => {
          staged.clear();
        });
      },
    };

    // One transaction at a time on a store, in the order they were made. A
    // started transaction always takes a step, so one that never asks
    // anything still commits.
    function start() {
      store.active = tx;
      staged = new Map(store.rows);
      schedule();
    }
    if (store.active) store.waiting.push(start);
    else start();
    return tx;
  }

  return {
    indexedDB: { open },
    state,
    /** A store's committed records, in key order. */
    rows(name, storeName) {
      const store = databases.get(name)?.stores.get(storeName);
      return store ? [...store.rows.keys()].sort().map((key) => store.rows.get(key)) : [];
    },
    /** Puts records straight into a store, as an earlier visit would have left them. */
    seed(name, storeName, keyPath, records) {
      let data = databases.get(name);
      if (!data) {
        data = { version: 1, stores: new Map() };
        databases.set(name, data);
      }
      if (!data.stores.has(storeName)) data.stores.set(storeName, { keyPath, rows: new Map(), active: null, waiting: [] });
      for (const record of records) data.stores.get(storeName).rows.set(record[keyPath], clone(record));
    },
  };
}
