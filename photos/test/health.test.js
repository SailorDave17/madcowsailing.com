// GET /api/health, against hand-written stand-ins for D1 and R2.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet, STORAGE_PROBE_KEY } from '../functions/api/health.js';

// A D1 stand-in that records every statement. `answers` maps a statement to
// the row it returns, or to an Error it throws.
function fakeDb(answers) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      statements.push(sql);
      return {
        async first() {
          const answer = answers[sql];
          if (answer instanceof Error) throw answer;
          return answer ?? null;
        },
      };
    },
  };
}

// An R2 stand-in with head() only, so a call to put, delete or list throws.
function fakeBucket(fail) {
  const keys = [];
  return {
    keys,
    async head(key) {
      keys.push(key);
      if (fail) throw new Error('bucket unreachable');
      return null;
    },
  };
}

const SELECT_1 = 'SELECT 1';
const LATEST = 'SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1';

async function call(env) {
  const res = await onRequestGet({ env });
  return { res, body: await res.json() };
}

test('both bindings answering: 200, the environment, and the newest migration', async () => {
  const DB = fakeDb({ [SELECT_1]: { 1: 1 }, [LATEST]: { name: '0001_baseline.sql' } });
  const MEDIA = fakeBucket(false);
  const { res, body } = await call({ DB, MEDIA, SITE_ENV: 'preview' });
  assert.equal(res.status, 200);
  assert.deepEqual(body, {
    ok: true,
    environment: 'preview',
    database: { reachable: true, migration: '0001_baseline.sql' },
    storage: { reachable: true },
  });
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(MEDIA.keys, [STORAGE_PROBE_KEY]);
});

test('a database with no migration applied is still reachable', async () => {
  const DB = fakeDb({ [SELECT_1]: { 1: 1 }, [LATEST]: new Error('no such table: d1_migrations') });
  const { res, body } = await call({ DB, MEDIA: fakeBucket(false), SITE_ENV: 'preview' });
  assert.equal(res.status, 200);
  assert.deepEqual(body.database, { reachable: true, migration: null });
});

test('a database that does not answer: 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const DB = fakeDb({ [SELECT_1]: new Error('D1_ERROR') });
  const { res, body } = await call({ DB, MEDIA: fakeBucket(false), SITE_ENV: 'production' });
  assert.equal(res.status, 503);
  assert.equal(body.ok, false);
  assert.deepEqual(body.database, { reachable: false, migration: null });
  assert.deepEqual(body.storage, { reachable: true });
});

test('a bucket that does not answer: 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const DB = fakeDb({ [SELECT_1]: { 1: 1 }, [LATEST]: { name: '0001_baseline.sql' } });
  const { res, body } = await call({ DB, MEDIA: fakeBucket(true), SITE_ENV: 'production' });
  assert.equal(res.status, 503);
  assert.equal(body.ok, false);
  assert.deepEqual(body.storage, { reachable: false });
});

test('no bindings at all: 503, and no environment', async () => {
  const { res, body } = await call({});
  assert.equal(res.status, 503);
  assert.deepEqual(body, {
    ok: false,
    environment: null,
    database: { reachable: false, migration: null },
    storage: { reachable: false },
  });
});

test('it only reads: every statement is a SELECT, and the bucket is asked for one header', async () => {
  const DB = fakeDb({ [SELECT_1]: { 1: 1 }, [LATEST]: { name: '0001_baseline.sql' } });
  const MEDIA = fakeBucket(false);
  await call({ DB, MEDIA, SITE_ENV: 'preview' });
  assert.ok(DB.statements.length > 0);
  for (const sql of DB.statements) assert.match(sql, /^SELECT\b/, sql);
  assert.equal(MEDIA.keys.length, 1);
});
