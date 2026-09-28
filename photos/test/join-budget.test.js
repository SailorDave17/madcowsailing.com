// The hourly budget for recording failed joins (#177), against a real SQLite
// holding the real migrations (test/d1.js). The clock is fixed mid-hour, so no
// test can straddle an hour boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FAILURE_BUDGET_PER_HOUR, FAILURE_LIMIT, onRequestPost } from '../functions/api/join.js';
import { d1, seedCodes } from './d1.js';

const SITE = 'https://photos.madcowsailing.com';
const CURRENT = 'K7QM-3XRD-9FWB';
const WRONG = 'ZZZZ-ZZZZ-ZZZZ';
const KEYS = {
  SESSION_SIGNING_KEY: 'test-session-signing-key-0123456789abcdef',
  ADDRESS_HASH_KEY: 'test-address-hash-key-fedcba9876543210',
};

// Half past an hour, in milliseconds, and that hour as the budget keys it.
const NOW_MS = (491_667 * 3600 + 1800) * 1000;
const HOUR = 491_667;

function site(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW_MS });
  const DB = d1();
  seedCodes(DB, CURRENT);
  return { DB, ...KEYS };
}

const join = (env, { code = CURRENT, ip = '203.0.113.7' } = {}) =>
  onRequestPost({
    request: new Request(`${SITE}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: SITE },
      body: JSON.stringify({ code }),
    }),
    env,
  });

const failures = (env) => env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM join_failures').get().n;
const budget = (env) => env.DB.sqlite.prepare('SELECT hour, recorded FROM join_budget ORDER BY hour').all()
  .map((row) => ({ ...row }));
const setBudget = (env, hour, recorded) =>
  env.DB.sqlite.prepare('INSERT INTO join_budget (hour, recorded) VALUES (?, ?)').run(hour, recorded);

// The only statements the join route may run against join_failures. A count
// over the whole table would grow with the flood it is meant to survive.
const FAILURE_STATEMENTS = [
  'DELETE FROM join_failures WHERE failed_at <= ?',
  'SELECT COUNT(*) AS failures, MIN(failed_at) AS oldest FROM join_failures WHERE address_hash = ? AND failed_at > ?',
  'INSERT INTO join_failures (address_hash, failed_at) VALUES (?, ?)',
];

test('the budget is 100 recorded failures an hour', () => {
  assert.equal(FAILURE_BUDGET_PER_HOUR, 100);
});

test("a recorded failure spends one unit of the hour's budget, through one counter row", async (t) => {
  const env = site(t);
  assert.equal((await join(env, { code: WRONG })).status, 403);
  assert.equal(failures(env), 1);
  assert.deepEqual(budget(env), [{ hour: HOUR, recorded: 1 }]);
  assert.equal((await join(env, { code: WRONG, ip: '203.0.113.8' })).status, 403);
  assert.deepEqual(budget(env), [{ hour: HOUR, recorded: 2 }]);

  const touching = env.DB.statements.filter((sql) => sql.includes('join_failures'));
  for (const sql of touching) assert.ok(FAILURE_STATEMENTS.includes(sql), `unexpected: ${sql}`);
  const spending = env.DB.statements.filter((sql) => sql.includes('join_budget') && sql.startsWith('INSERT'));
  assert.equal(spending.length, 2, 'one budget statement per recorded failure');
});

test('the 101st failure in an hour is answered 403 and recorded nowhere', async (t) => {
  const env = site(t);
  for (let i = 1; i <= FAILURE_BUDGET_PER_HOUR; i++) {
    assert.equal((await join(env, { code: WRONG, ip: `198.51.100.${i}` })).status, 403);
  }
  assert.equal(failures(env), FAILURE_BUDGET_PER_HOUR);
  const res = await join(env, { code: WRONG, ip: '192.0.2.1' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'wrong' });
  assert.equal(failures(env), FAILURE_BUDGET_PER_HOUR);
  assert.deepEqual(budget(env), [{ hour: HOUR, recorded: FAILURE_BUDGET_PER_HOUR }]);
});

test("with the hour's budget spent, a wrong code changes neither table", async (t) => {
  const env = site(t);
  setBudget(env, HOUR, FAILURE_BUDGET_PER_HOUR);
  const res = await join(env, { code: WRONG });
  assert.equal(res.status, 403);
  assert.equal(failures(env), 0);
  assert.deepEqual(budget(env), [{ hour: HOUR, recorded: FAILURE_BUDGET_PER_HOUR }]);
});

test('with the budget spent, the current code joins, and an address already at its limit is still refused', async (t) => {
  const env = site(t);
  for (let i = 0; i < FAILURE_LIMIT; i++) await join(env, { code: WRONG, ip: '203.0.113.99' });
  assert.equal(failures(env), FAILURE_LIMIT);
  env.DB.sqlite.prepare('UPDATE join_budget SET recorded = ?').run(FAILURE_BUDGET_PER_HOUR);

  assert.equal((await join(env, { ip: '192.0.2.50' })).status, 204);
  assert.equal((await join(env, { ip: '203.0.113.99' })).status, 429);
});

test('the next hour records again, and counter rows over a day old are deleted', async (t) => {
  const env = site(t);
  setBudget(env, HOUR - 1, FAILURE_BUDGET_PER_HOUR);
  setBudget(env, HOUR - 24, 3);
  setBudget(env, HOUR - 25, 5);
  assert.equal((await join(env, { code: WRONG })).status, 403);
  assert.equal(failures(env), 1);
  assert.deepEqual(budget(env), [
    { hour: HOUR - 24, recorded: 3 },
    { hour: HOUR - 1, recorded: FAILURE_BUDGET_PER_HOUR },
    { hour: HOUR, recorded: 1 },
  ]);
});
