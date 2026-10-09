// Requests for an account (#220): the rules in lib/accounts.js, against a
// real SQLite holding the real migrations (test/d1.js). The route, the page
// and Turnstile are test/ask.test.js's; this holds what a request writes,
// the two limits, the answer that cannot tell a known address from a new one,
// and the admins' email hour.
//
// The clock is a fixed number half way through an hour, so no test straddles
// an hour boundary by accident. fetch is stood in for: Resend's URL answers
// whatever `resend` returns, and any other URL throws.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_MAX, MAIL_WINDOW_SECONDS, NAME_MAX, NOTE_MAX, REQUEST_BUDGET_PER_HOUR, REQUEST_LIMIT, REQUEST_WINDOW_SECONDS,
  ROLES, TEAMS, adminsEmail, clearExpiredRequests, mailAdmins, readRequest, requestAccount, waitingRequests,
} from '../lib/accounts.js';
import { TODO, todoItem } from '../lib/admin-page.js';
import { RESEND_URL, TEXT_MAX } from '../lib/mail.js';
import { NOTE_MAX as REMOVAL_NOTE_MAX, readNote } from '../lib/removals.js';
import { onRequestGet as adminIndex } from '../functions/admin/index.js';
import { adminData, seedAdmin } from './admin.js';
import { emailKeyOf } from './address-key.js';
import { d1 } from './d1.js';

const HOUR = 497_222;
const NOW = HOUR * 3600 + 1800;
const SITE = 'https://photos.madcowsailing.com';

const REQUEST = Object.freeze({ name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', teams: ['hoover-jrt'], note: null });
const take = async (db, change = {}, { address = 'address-a', now = NOW } = {}) => {
  const request = { ...REQUEST, ...change };
  return requestAccount(db, { request, address, emailKey: await emailKeyOf(request.email), now });
};

const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map((row) => ({ ...row }));
const count = (db, table) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

let resend; // (body) => the Response Resend answers
let sends; // every message that reached Resend's URL

beforeEach(() => {
  sends = [];
  resend = () => Response.json({ id: 'msg-220' });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url !== RESEND_URL) throw new Error(`fetched ${url}, not Resend's`);
    const body = JSON.parse(init.body);
    sends.push(body);
    return resend(body);
  });
});
afterEach(() => mock.restoreAll());

// ---- What the tables hold -------------------------------------------------

test('the teams in code are migration 0007\'s rows, in the form\'s order', () => {
  const db = d1();
  const stored = rows(db, 'SELECT team, name FROM teams ORDER BY name');
  assert.deepEqual(stored, [...TEAMS].map((t) => ({ ...t })).sort((a, b) => a.name.localeCompare(b.name)));
  assert.deepEqual(TEAMS.map(({ team }) => team), ['hoover-jrt', 'cohssa']);
});

test('the roles in code are the ones 0007\'s CHECK takes, and no admin role is among them', () => {
  const db = d1();
  const insert = (email, role) =>
    db.sqlite.prepare('INSERT INTO accounts (email, name, role, requested_at) VALUES (?, ?, ?, ?)').run(email, 'A', role, NOW);
  ROLES.forEach((role, i) => insert(`r${i}@example.org`, role));
  for (const role of ['admin', 'owner', 'Parent', '']) {
    assert.throws(() => insert(`${role}x@example.org`, role), /CHECK constraint failed/, role);
  }
  assert.deepEqual([...ROLES], ['parent', 'coach', 'other']);
});

test('a name of NAME_MAX characters and a note of NOTE_MAX are stored, and one more of either is refused by the table', () => {
  assert.equal(NAME_MAX, 100);
  assert.equal(NOTE_MAX, 500);
  const db = d1();
  const insert = (email, name, note) =>
    db.sqlite.prepare('INSERT INTO accounts (email, name, role, note, requested_at) VALUES (?, ?, ?, ?, ?)').run(email, name, 'other', note, NOW);
  // Characters, not bytes or UTF-16 units: an emoji is one, as the code counts.
  insert('a@example.org', '😀'.repeat(NAME_MAX), '😀'.repeat(NOTE_MAX));
  assert.throws(() => insert('b@example.org', 'x'.repeat(NAME_MAX + 1), null), /CHECK/);
  assert.throws(() => insert('c@example.org', 'x', 'y'.repeat(NOTE_MAX + 1)), /CHECK/);
  assert.throws(() => insert('d@example.org', '', null), /CHECK/);
});

test('an email address is one account whatever its letter case, and a team the site does not have is refused', () => {
  const db = d1();
  db.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('Jane@Example.org', 'Jane', 'parent', 1)").run();
  assert.throws(
    () => db.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('jane@example.ORG', 'J', 'coach', 2)").run(),
    /UNIQUE constraint failed: accounts.email/,
  );
  assert.throws(() => db.sqlite.prepare("INSERT INTO account_teams VALUES (1, 'sailing-team', 'requested')").run(), /FOREIGN KEY/);
  assert.throws(() => db.sqlite.prepare("INSERT INTO account_teams VALUES (1, 'cohssa', 'pending')").run(), /CHECK/);
});

// ---- Reading the form -------------------------------------------------------

const form = (fields) => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) for (const one of [].concat(value)) params.append(name, one);
  return params;
};
const GOOD = { name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', team: 'hoover-jrt', note: '' };

test('a complete form reads as the request, with its teams in the form\'s order and no note as null', () => {
  assert.deepEqual(readRequest(form(GOOD)), {
    request: { name: 'Jane Rivers', email: 'jane@example.org', role: 'parent', teams: ['hoover-jrt'], note: null },
  });
  const both = readRequest(form({ ...GOOD, team: ['cohssa', 'hoover-jrt', 'cohssa'] }));
  assert.deepEqual(both.request.teams, ['hoover-jrt', 'cohssa']);
});

test('a name is one line: spaces, breaks and control characters fold to one space, and the ends are trimmed', () => {
  const read = (name) => readRequest(form({ ...GOOD, name })).request?.name;
  assert.equal(read('  Jane \t\r\n  Rivers  '), 'Jane Rivers');
  assert.equal(read(`Jane${String.fromCharCode(0x2028)}Rivers\u0000!`), 'Jane Rivers !');
  assert.equal(read('😀'.repeat(NAME_MAX)), '😀'.repeat(NAME_MAX));
});

test('a bidirectional control is dropped from a name, a name of only format characters is empty, and other format characters stay', () => {
  const ch = (...codes) => String.fromCharCode(...codes);
  const read = (name) => readRequest(form({ ...GOOD, name })).request?.name;
  // U+202E would show the rest of the admins' email line backwards.
  assert.equal(read(`Jane ${ch(0x202e)}Rivers${ch(0x202c)}`), 'Jane Rivers');
  assert.equal(read(`${ch(0x2067)}Jane${ch(0x2069)} ${ch(0x200f)}Rivers${ch(0x061c)}`), 'Jane Rivers');
  // Zero-width space, word joiner, soft hyphen, a byte order mark, a bidi
  // isolate: no name at all, however many.
  for (const name of [ch(0x200b), `${ch(0x2060)} ${ch(0x00ad)}`, ch(0xfeff, 0x200b, 0x2066)]) {
    assert.deepEqual(readRequest(form({ ...GOOD, name })).errors, [{ field: 'name', message: 'Enter your name.' }], name.length);
  }
  // The control: a zero-width non-joiner inside a name is kept, as some
  // scripts need it.
  assert.equal(read(`Mohammad${ch(0x200c)}Reza`), `Mohammad${ch(0x200c)}Reza`);
});

test('the email is trimmed and kept as typed; the note keeps its line breaks and is cut at NOTE_MAX', () => {
  const read = (change) => readRequest(form({ ...GOOD, ...change })).request;
  assert.equal(read({ email: '  Jane.Rivers@Example.org ' }).email, 'Jane.Rivers@Example.org');
  assert.equal(read({ note: ' Two lines,\r\nthe second. ' }).note, 'Two lines,\nthe second.');
  assert.equal(read({ note: 'x'.repeat(NOTE_MAX + 40) }).note, 'x'.repeat(NOTE_MAX));
  assert.equal(read({ note: '   ' }).note, null);
});

test('readNote cuts at the cap it is given, by characters, and at a takedown note\'s when given none', () => {
  // Both caps are 500 today, so only a direct call shows `max` is read.
  assert.equal(readNote('x'.repeat(10), 3), 'xxx');
  assert.equal(readNote('😀'.repeat(5), 2), '😀😀');
  assert.equal(readNote('x'.repeat(REMOVAL_NOTE_MAX + 1)), 'x'.repeat(REMOVAL_NOTE_MAX));
});

test('each field that is wrong gives its reason, in the form\'s order, and nothing is read as a request', () => {
  const reasons = (fields) => readRequest(form(fields)).errors?.map(({ field }) => field);
  assert.deepEqual(reasons({}), ['name', 'email', 'role', 'team']);
  assert.deepEqual(reasons({ ...GOOD, name: ' \n ' }), ['name']);
  assert.deepEqual(reasons({ ...GOOD, name: 'x'.repeat(NAME_MAX + 1) }), ['name']);
  for (const email of ['jane', 'jane@example', 'a@b.co, c@d.co', 'Jane <jane@example.org>', `${'x'.repeat(250)}@b.co`]) {
    assert.deepEqual(reasons({ ...GOOD, email }), ['email'], email);
  }
  for (const role of ['admin', 'Parent', '']) assert.deepEqual(reasons({ ...GOOD, role }), ['role'], role);
  for (const team of [[], ['sailing-team'], ['hoover-jrt', 'sailing-team']]) {
    assert.deepEqual(reasons({ ...GOOD, team }), ['team'], team.join());
  }
  const { errors, request } = readRequest(form({ ...GOOD, name: '' }));
  assert.equal(request, undefined);
  assert.deepEqual(errors, [{ field: 'name', message: 'Enter your name.' }]);
});

// ---- Taking a request -------------------------------------------------------

test('a request from a new address makes the account and its teams, and counts once against the address and the site', async () => {
  const db = d1();
  const result = await take(db, { teams: ['hoover-jrt', 'cohssa'], note: 'Two boats' });
  assert.deepEqual(result, { outcome: 'taken', created: true });
  assert.deepEqual(rows(db, 'SELECT email, name, role, note, requested_at, admins_emailed FROM accounts'), [
    { email: 'jane@example.org', name: 'Jane Rivers', role: 'parent', note: 'Two boats', requested_at: NOW, admins_emailed: 0 },
  ]);
  assert.deepEqual(rows(db, 'SELECT team, state FROM account_teams ORDER BY team'), [
    { team: 'cohssa', state: 'requested' }, { team: 'hoover-jrt', state: 'requested' },
  ]);
  assert.deepEqual(rows(db, 'SELECT address_hash, requested_at FROM account_request_log'), [{ address_hash: 'address-a', requested_at: NOW }]);
  assert.deepEqual(rows(db, 'SELECT hour, requested FROM account_request_budget'), [{ hour: HOUR, requested: 1 }]);
});

test('a request from an address the site has, in any letter case and any state, writes nothing about the account, by the same statements', async () => {
  for (const state of ['requested', 'approved', 'rejected', 'revoked']) {
    const db = d1();
    await take(db, { teams: ['hoover-jrt'] }, { now: NOW - 100 });
    db.sqlite.prepare('UPDATE account_teams SET state = ?').run(state);
    const before = rows(db, 'SELECT * FROM accounts');
    const teamsBefore = rows(db, 'SELECT * FROM account_teams');

    // A second database in the same state, one request already in this hour,
    // since the hour's first request also tidies the budget's old rows.
    const newAddress = d1();
    await take(newAddress, { email: 'earlier@example.org' }, { now: NOW - 100 });
    const mark = newAddress.statements.length;
    assert.deepEqual(await take(newAddress, { email: 'new@example.org' }, { now: NOW - 50 }), { outcome: 'taken', created: true });

    const known = db.statements.length;
    const result = await take(db, { email: 'JANE@Example.ORG', name: 'Someone Else', role: 'coach', teams: ['cohssa'], note: 'hi' });
    assert.deepEqual(result, { outcome: 'taken', created: false }, state);
    assert.deepEqual(rows(db, 'SELECT * FROM accounts'), before, state);
    assert.deepEqual(rows(db, 'SELECT * FROM account_teams'), teamsBefore, state);
    // It still counts, so the limits cannot tell the two apart either.
    assert.equal(count(db, 'account_request_log'), 2);
    // The same SQL, in the same order, as a new address (criterion 4).
    assert.deepEqual(db.statements.slice(known), newAddress.statements.slice(mark), state);
  }
});

test('a repeat in the same second adds no team, and nor does a repeat for an account whose team rows are gone', async () => {
  // The teams statement has two conditions, and each covers a case the
  // other does not: an account made this very second (NOT EXISTS), and an
  // account holding no team row at all (requested_at, the moment it was
  // made). Between them, a known address writes no team in any state.
  const db = d1();
  await take(db, { teams: ['hoover-jrt'] });
  assert.equal((await take(db, { teams: ['cohssa'] })).created, false);
  assert.deepEqual(rows(db, 'SELECT team FROM account_teams'), [{ team: 'hoover-jrt' }], 'a repeat in the same second added a team');

  db.sqlite.prepare('DELETE FROM account_teams').run();
  assert.equal((await take(db, { teams: ['cohssa'] }, { now: NOW + 60 })).created, false);
  assert.deepEqual(rows(db, 'SELECT team FROM account_teams'), [], 'a repeat gave a teamless account a team');
});

test('the batch is one transaction: when the teams cannot be written, the account is not kept either, and both units go back', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  await take(db, { email: 'first@example.org' }, { now: NOW - 10 });
  // The teams statement, and only it, is pointed at a table that does not exist.
  const broken = {
    ...db,
    prepare: (sql) => db.prepare(sql.startsWith('INSERT INTO account_teams') ? 'INSERT INTO no_such_table VALUES (1)' : sql),
  };
  await assert.rejects(() => take(broken, { email: 'second@example.org' }), /no such table/);
  assert.deepEqual(rows(db, 'SELECT email FROM accounts'), [{ email: 'first@example.org' }]);
  assert.equal(count(db, 'account_request_log'), 1, 'the address unit was not given back');
  assert.deepEqual(rows(db, 'SELECT requested FROM account_request_budget'), [{ requested: 1 }], 'the budget unit was not given back');
});

test('REQUEST_LIMIT requests an hour from one address are taken, the next is refused with when to retry, and writes nothing', async () => {
  assert.equal(REQUEST_LIMIT, 10);
  assert.equal(REQUEST_WINDOW_SECONDS, 3600);
  const db = d1();
  for (let i = 0; i < REQUEST_LIMIT; i++) {
    assert.equal((await take(db, { email: `p${i}@example.org` }, { now: NOW - 600 + i })).outcome, 'taken');
  }
  const before = { accounts: count(db, 'accounts'), log: count(db, 'account_request_log'), budget: rows(db, 'SELECT * FROM account_request_budget') };
  assert.deepEqual(await take(db, { email: 'eleventh@example.org' }), { outcome: 'limited', retryAfter: 3000 });
  assert.equal(count(db, 'accounts'), before.accounts);
  assert.equal(count(db, 'account_request_log'), before.log);
  assert.deepEqual(rows(db, 'SELECT * FROM account_request_budget'), before.budget);
  // Another address is not held back by this one.
  assert.equal((await take(db, { email: 'other@example.org' }, { address: 'address-b' })).outcome, 'taken');
  // Once the oldest is an hour old, this address may ask again.
  assert.equal((await take(db, { email: 'later@example.org' }, { now: NOW - 600 + 3600 })).outcome, 'taken');
});

test('the site takes REQUEST_BUDGET_PER_HOUR an hour; past it a request is refused until the hour turns, and the address keeps its unit', async () => {
  assert.equal(REQUEST_BUDGET_PER_HOUR, 100);
  const db = d1();
  db.sqlite.prepare('INSERT INTO account_request_budget (hour, requested) VALUES (?, ?)').run(HOUR, REQUEST_BUDGET_PER_HOUR - 1);
  assert.equal((await take(db, { email: 'last@example.org' })).outcome, 'taken');
  const mark = db.statements.length;
  assert.deepEqual(await take(db, { email: 'over@example.org' }), { outcome: 'busy', retryAfter: 1800 });
  // A spent hour writes nothing at all, not even a row it then deletes: the
  // budget is read before the address is claimed (the owner's choice at
  // #220's review), as #177's join budget was until #226.
  const ran = db.statements.slice(mark);
  assert.ok(ran.length > 0 && ran.every((sql) => /^SELECT\b/.test(sql)), `a spent hour ran ${ran.join(' | ')}`);
  assert.equal(count(db, 'account_request_log'), 1, 'the refused request kept its address unit');
  assert.deepEqual(rows(db, 'SELECT email FROM accounts'), [{ email: 'last@example.org' }]);
  // The next hour takes requests again, and a budget row over a day old goes.
  db.sqlite.prepare('INSERT INTO account_request_budget (hour, requested) VALUES (?, 3), (?, 4)').run(HOUR - 23, HOUR - 25);
  assert.equal((await take(db, { email: 'next@example.org' }, { now: NOW + 3600 })).outcome, 'taken');
  assert.deepEqual(rows(db, 'SELECT hour, requested FROM account_request_budget ORDER BY hour'), [
    { hour: HOUR - 23, requested: 3 }, { hour: HOUR, requested: REQUEST_BUDGET_PER_HOUR }, { hour: HOUR + 1, requested: 1 },
  ]);
});

// The read before the claim answered as if the hour had a unit left: what
// another request taking the last one between the read and the spend looks
// like from here.
const readsRoom = (db) => ({
  ...db,
  prepare: (sql) => db.prepare(sql.startsWith('SELECT requested FROM account_request_budget') ? 'SELECT ? AS requested WHERE 0' : sql),
});

test('when the hour\'s last unit goes between the read and the spend, the request is busy and the address unit goes back', async () => {
  const db = d1();
  db.sqlite.prepare('INSERT INTO account_request_budget (hour, requested) VALUES (?, ?)').run(HOUR, REQUEST_BUDGET_PER_HOUR);
  assert.deepEqual(await take(readsRoom(db)), { outcome: 'busy', retryAfter: 1800 });
  assert.ok(db.statements.some((sql) => sql.startsWith('INSERT INTO account_request_log')), 'the address was never claimed, so nothing was given back');
  assert.equal(count(db, 'account_request_log'), 0, 'the address kept the unit a busy site refused');
  assert.equal(count(db, 'accounts'), 0);
});

test('when spending the site\'s unit fails, the address unit goes back and the error is thrown', async () => {
  const db = d1();
  const broken = {
    ...db,
    prepare: (sql) => db.prepare(sql.startsWith('INSERT INTO account_request_budget') ? 'INSERT INTO no_such_table VALUES (1)' : sql),
  };
  await assert.rejects(() => take(broken), /no such table/);
  assert.equal(count(db, 'account_request_log'), 0, 'the address unit was not given back');
  assert.equal(count(db, 'accounts'), 0);
});

test('when deleting budget rows over a day old fails, the request is still taken, and the failure is logged', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const db = d1();
  db.sqlite.prepare('INSERT INTO account_request_budget (hour, requested) VALUES (?, 4)').run(HOUR - 25);
  const broken = {
    ...db,
    prepare: (sql) => db.prepare(sql.startsWith('DELETE FROM account_request_budget') ? 'DELETE FROM no_such_table' : sql),
  };
  // The hour's first request, which is the one that tidies.
  assert.deepEqual(await take(broken), { outcome: 'taken', created: true });
  assert.ok(db.statements.includes('DELETE FROM no_such_table'), 'the tidy never ran, so nothing failed');
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments.join(' '), /^accounts: could not delete budget rows over a day old: /);
  assert.deepEqual(rows(db, 'SELECT hour, requested FROM account_request_budget ORDER BY hour'), [
    { hour: HOUR - 25, requested: 4 }, { hour: HOUR, requested: 1 },
  ]);
  assert.equal(count(db, 'account_request_log'), 1);
});

test('an address log row is deleted once over an hour old, by the next request taken or by clearExpiredRequests, never by a refusal', async () => {
  const db = d1();
  const seed = (address, at) => db.sqlite.prepare('INSERT INTO account_request_log (address_hash, requested_at) VALUES (?, ?)').run(address, at);
  seed('old', NOW - 3600);
  seed('young', NOW - 3599);
  for (let i = 0; i < REQUEST_LIMIT; i++) seed('full', NOW - 10);
  assert.equal((await take(db, {}, { address: 'full' })).outcome, 'limited');
  assert.equal(rows(db, "SELECT * FROM account_request_log WHERE address_hash = 'old'").length, 1, 'a refusal tidied the log');
  assert.equal((await take(db)).outcome, 'taken');
  assert.deepEqual(rows(db, 'SELECT DISTINCT address_hash FROM account_request_log ORDER BY address_hash').map((r) => r.address_hash), ['address-a', 'full', 'young']);
  await clearExpiredRequests(db, NOW + 3600);
  assert.deepEqual(rows(db, 'SELECT address_hash FROM account_request_log'), []);
});

test('waiting requests are the accounts with a team no admin has answered', async () => {
  const db = d1();
  assert.equal(await waitingRequests(db), 0);
  await take(db, { email: 'a@example.org', teams: ['hoover-jrt', 'cohssa'] });
  await take(db, { email: 'b@example.org' });
  await take(db, { email: 'c@example.org' });
  assert.equal(await waitingRequests(db), 3);
  db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = (SELECT id FROM accounts WHERE email = 'a@example.org') AND team = 'hoover-jrt'").run();
  db.sqlite.prepare("UPDATE account_teams SET state = 'rejected' WHERE account_id = (SELECT id FROM accounts WHERE email = 'b@example.org')").run();
  assert.equal(await waitingRequests(db), 2, 'an account with one team still asked for is still waiting');
});

test('the admin home says how many requests wait, and its load deletes the address log\'s rows over an hour old (criterion 5)', async (t) => {
  // The route's own work, behind the guard test/guard.test.js holds it to.
  t.mock.timers.enable({ apis: ['Date'], now: NOW * 1000 });
  const db = d1();
  await take(db, { email: 'a@example.org' }, { address: 'one', now: NOW - 20 });
  await take(db, { email: 'b@example.org' }, { address: 'two', now: NOW - 10 });
  await take(db, { email: 'c@example.org' }, { address: 'three', now: NOW - 5 });
  db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = (SELECT id FROM accounts WHERE email = 'c@example.org')").run();
  // An hour-old row put in after the requests, whose own tidying would
  // otherwise have deleted it: only the home's load can.
  db.sqlite.prepare("UPDATE account_request_log SET requested_at = ? WHERE address_hash = 'one'").run(NOW - 3600);
  const res = await adminIndex({ data: adminData(), env: { DB: db } });
  const html = await res.text();
  assert.match(html, /<a class="button todo-item" href="\/admin\/people"><span class="todo-count">2<\/span> <span>account requests waiting<\/span><\/a>/);
  assert.deepEqual(rows(db, 'SELECT address_hash FROM account_request_log ORDER BY address_hash').map((r) => r.address_hash), ['three', 'two']);
  const requests = TODO.find((t) => t.href === '/admin/people');
  assert.match(todoItem(requests, 0), /<span>account requests waiting\. Nothing to do\.<\/span>/);
  assert.match(todoItem(requests, 1), /<span>account request waiting<\/span>/);
});

// ---- The admins' email --------------------------------------------------------

// The admins (#224): every account holding the admin role and an approved
// team, the owner's included. Until #224 they were the addresses on the
// ADMIN_EMAILS secret, which nothing reads now. Seeded ahead of the requests,
// so named() leaves them out.
const ADMINS = ['first.admin@example.org', 'Second.Admin@example.org'];
const seedAdmins = (db, emails = ADMINS) =>
  emails.forEach((email, i) => seedAdmin(db, { email, name: `Admin ${i + 1}`, role: i === 0 ? 'owner' : 'admin' }));
const mailEnv = (db, extra = {}) => ({ DB: db, RESEND_API_KEY: 'test-key-not-real', ...extra });
const named = (db) => rows(db, 'SELECT email, admins_emailed FROM accounts WHERE admin_role IS NULL ORDER BY id').map((r) => `${r.email}:${r.admins_emailed}`);
const sentAt = (db) => db.sqlite.prepare('SELECT sent_at FROM account_request_mail').get()?.sent_at;

test('the first request emails every admin at once, each a send of their own, and names it', async () => {
  assert.equal(MAIL_WINDOW_SECONDS, 3600);
  const db = d1();
  seedAdmins(db);
  await take(db, { teams: ['hoover-jrt', 'cohssa'] });
  assert.deepEqual(await mailAdmins(mailEnv(db), { now: NOW, site: SITE }), { outcome: 'sent', named: 1, sent: 2 });
  // Each to the address its account holds, as typed when it asked.
  assert.deepEqual(sends.map((s) => s.to), [['first.admin@example.org'], ['Second.Admin@example.org']]);
  assert.equal(sends[0].subject, 'An account request is waiting on the photo site');
  assert.match(sends[0].text, /^- Jane Rivers, parent: Hoover JRT and COHSSA$/m);
  assert.match(sends[0].text, new RegExp(`Review it at ${SITE}/admin/people\\n`));
  assert.deepEqual(named(db), ['jane@example.org:1']);
  assert.equal(sentAt(db), NOW);
});

test('inside the hour a request sends nothing, and the first after it names every request since', async () => {
  const db = d1();
  seedAdmins(db);
  const env = mailEnv(db);
  await take(db, { email: 'one@example.org', name: 'One' });
  assert.equal((await mailAdmins(env, { now: NOW, site: SITE })).outcome, 'sent');
  sends = [];
  await take(db, { email: 'two@example.org', name: 'Two', role: 'coach' }, { now: NOW + 600 });
  assert.deepEqual(await mailAdmins(env, { now: NOW + 600, site: SITE }), { outcome: 'waiting' });
  assert.equal(await mailAdmins(env, { now: NOW + MAIL_WINDOW_SECONDS - 1, site: SITE }).then((r) => r.outcome), 'waiting');
  assert.equal(sends.length, 0);
  await take(db, { email: 'three@example.org', name: 'Three', role: 'other', teams: ['cohssa'] }, { now: NOW + 3600 });
  assert.deepEqual(await mailAdmins(env, { now: NOW + MAIL_WINDOW_SECONDS, site: SITE }), { outcome: 'sent', named: 2, sent: 2 });
  assert.equal(sends[0].subject, '2 account requests are waiting on the photo site');
  const lines = sends[0].text.split('\n').filter((line) => line.startsWith('- '));
  assert.deepEqual(lines, ['- Two, coach: Hoover JRT', '- Three, other: COHSSA']);
  assert.deepEqual(named(db), ['one@example.org:1', 'two@example.org:1', 'three@example.org:1']);
});

test('when no admin\'s email goes through, the hour goes back and the requests stay unnamed, so the next request sends', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  seedAdmins(db);
  const env = mailEnv(db);
  await take(db);
  resend = () => new Response('down', { status: 503 });
  assert.deepEqual(await mailAdmins(env, { now: NOW, site: SITE }), { outcome: 'unsent' });
  assert.deepEqual(named(db), ['jane@example.org:0']);
  assert.equal(sentAt(db), NOW - MAIL_WINDOW_SECONDS, 'the hour was kept');
  resend = () => Response.json({ id: 'ok' });
  sends = [];
  await take(db, { email: 'next@example.org', name: 'Next' }, { now: NOW + 60 });
  assert.equal((await mailAdmins(env, { now: NOW + 60, site: SITE })).outcome, 'sent');
  assert.equal(sends[0].text.split('\n').filter((line) => line.startsWith('- ')).length, 2);
});

test('one admin\'s email going through is enough: the requests are named and the hour is kept', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  seedAdmins(db);
  await take(db);
  resend = (body) => (body.to[0].startsWith('first') ? new Response('no', { status: 503 }) : Response.json({ id: 'ok' }));
  assert.deepEqual(await mailAdmins(mailEnv(db), { now: NOW, site: SITE }), { outcome: 'sent', named: 1, sent: 1 });
  assert.deepEqual(named(db), ['jane@example.org:1']);
  assert.equal(sentAt(db), NOW);
});

test('with no admin who can sign in nothing is claimed or sent; with nothing unnamed the hour goes back', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  await take(db);
  // No admin at all; then an admin approved for no team, who cannot sign in;
  // then that admin with the role taken away (#224). The ADMIN_EMAILS secret
  // counts for nothing now, whatever it holds.
  assert.deepEqual(await mailAdmins(mailEnv(db, { ADMIN_EMAILS: 'old.list@example.org' }), { now: NOW, site: SITE }), { outcome: 'no-admins' });
  db.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at, admin_role) VALUES ('unteamed@example.org', 'Unteamed', 'parent', 1, 'owner')").run();
  assert.deepEqual(await mailAdmins(mailEnv(db), { now: NOW, site: SITE }), { outcome: 'no-admins' });
  assert.equal(sentAt(db), undefined);
  // The control: approved for a team, the same account is an admin who is
  // emailed, so the refusals above were the team and the role, not the query.
  db.sqlite.prepare("INSERT INTO account_teams (account_id, team, state) SELECT id, 'cohssa', 'approved' FROM accounts WHERE email = 'unteamed@example.org'").run();
  assert.deepEqual(await mailAdmins(mailEnv(db), { now: NOW, site: SITE }), { outcome: 'sent', named: 1, sent: 1 });
  assert.deepEqual(sends.map((s) => s.to), [['unteamed@example.org']]);
  db.sqlite.prepare("DELETE FROM account_request_mail").run();
  sends = [];
  // A plain admin without the role is no admin: seeded beside the owner, then
  // demoted, which the last-admin rule allows while the owner stays.
  seedAdmin(db, { email: 'former@example.org', name: 'Former', role: 'admin' });
  db.sqlite.prepare("UPDATE accounts SET admin_role = NULL WHERE email = 'former@example.org'").run();
  await take(db, { email: 'second@example.org', name: 'Second' }, { now: NOW + 1 });
  assert.deepEqual(await mailAdmins(mailEnv(db), { now: NOW + 1, site: SITE }), { outcome: 'sent', named: 1, sent: 1 });
  assert.deepEqual(sends.map((s) => s.to), [['unteamed@example.org']]);
  // With nothing left unnamed, the hour claimed goes back.
  sends = [];
  db.sqlite.prepare("UPDATE account_teams SET state = 'approved'").run();
  const later = NOW + 1 + MAIL_WINDOW_SECONDS;
  assert.deepEqual(await mailAdmins(mailEnv(db), { now: later, site: SITE }), { outcome: 'nothing' });
  assert.equal(sentAt(db), later - MAIL_WINDOW_SECONDS);
  assert.equal(sends.length, 0);
});

test('a database failure gives the hour back before an email goes, and keeps it after one has', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = (db, pattern) => ({
    ...db,
    prepare: (sql) => (pattern.test(sql) ? { bind: () => ({ all: async () => { throw new Error('D1 down'); }, run: async () => { throw new Error('D1 down'); } }) } : db.prepare(sql)),
  });
  const before = d1();
  seedAdmins(before);
  await take(before);
  assert.deepEqual(await mailAdmins(mailEnv(failing(before, /^SELECT a\.id/)), { now: NOW, site: SITE }), { outcome: 'failed' });
  assert.equal(sentAt(before), NOW - MAIL_WINDOW_SECONDS, 'a failure before sending kept the hour');
  assert.equal(sends.length, 0);

  // Reading who the admins are fails before any hour is claimed (#224).
  const unread = d1();
  seedAdmins(unread);
  await take(unread);
  assert.deepEqual(await mailAdmins(mailEnv(failing(unread, /^SELECT a\.email/)), { now: NOW, site: SITE }), { outcome: 'failed' });
  assert.equal(sentAt(unread), undefined, 'a failure reading the admins claimed the hour');
  assert.equal(sends.length, 0);

  const after = d1();
  seedAdmins(after);
  await take(after);
  assert.deepEqual(await mailAdmins(mailEnv(failing(after, /^UPDATE accounts/)), { now: NOW, site: SITE }), { outcome: 'failed' });
  assert.equal(sends.length, 2);
  assert.equal(sentAt(after), NOW, 'a failure after sending gave the hour back, so a second email could follow at once');
});

test('one email names at most LIST_MAX requests and says how many more wait; the next names those', async () => {
  assert.equal(LIST_MAX, 50);
  const db = d1();
  seedAdmins(db, ['admin@example.org']);
  const env = mailEnv(db);
  for (let i = 0; i < LIST_MAX + 3; i++) {
    db.sqlite.prepare('INSERT INTO accounts (email, name, role, requested_at) VALUES (?, ?, ?, ?)').run(`p${i}@example.org`, `Person ${i}`, 'parent', NOW);
    db.sqlite.prepare("INSERT INTO account_teams VALUES (last_insert_rowid(), 'cohssa', 'requested')").run();
  }
  assert.deepEqual(await mailAdmins(env, { now: NOW, site: SITE }), { outcome: 'sent', named: LIST_MAX, sent: 1 });
  assert.equal(sends[0].subject, `${LIST_MAX + 3} account requests are waiting on the photo site`);
  assert.equal(sends[0].text.split('\n').filter((line) => /^- Person/.test(line)).length, LIST_MAX);
  assert.match(sends[0].text, /^- and 3 more requests, to be named in the next email$/m);
  assert.equal(await waitingRequests(db), LIST_MAX + 3);
  assert.equal(await mailAdmins(env, { now: NOW + MAIL_WINDOW_SECONDS, site: SITE }).then((r) => r.named), 3);
});

test('the widest email LIST_MAX requests can make is one lib/mail.js sends', async () => {
  // A name of NAME_MAX characters outside the BMP is twice that in UTF-16
  // units, which TEXT_MAX counts.
  const widest = Array.from({ length: LIST_MAX }, () => ({ name: '😀'.repeat(NAME_MAX), role: 'parent', teams: ['hoover-jrt', 'cohssa'] }));
  const { subject, text } = adminsEmail(widest, SITE, 999_999);
  assert.ok(text.length <= TEXT_MAX, `${text.length} > ${TEXT_MAX}`);
  const db = d1();
  seedAdmins(db, ['admin@example.org']);
  for (const [i, { name }] of widest.entries()) {
    db.sqlite.prepare('INSERT INTO accounts (email, name, role, requested_at) VALUES (?, ?, ?, ?)').run(`w${i}@example.org`, name, 'parent', NOW);
    db.sqlite.prepare("INSERT INTO account_teams VALUES (last_insert_rowid(), 'hoover-jrt', 'requested'), (last_insert_rowid(), 'cohssa', 'requested')").run();
  }
  assert.equal((await mailAdmins(mailEnv(db), { now: NOW, site: SITE })).outcome, 'sent');
  assert.equal(subject.length > 0, true);
});

test('the email names each requester by name, role and teams, and never their address or note; the subject names nobody', async () => {
  const db = d1();
  seedAdmins(db);
  await take(db, { email: 'private.address@example.org', name: 'Pat Lee', role: 'coach', teams: ['cohssa'], note: 'A private note' });
  await mailAdmins(mailEnv(db), { now: NOW, site: 'https://develop.madcowphotos.pages.dev' });
  const [{ subject, text }] = sends;
  assert.equal(text.includes('Pat Lee'), true);
  for (const planted of ['private.address', 'example.org', 'A private note']) {
    assert.equal(text.includes(planted), false, planted);
    assert.equal(subject.includes(planted), false, planted);
  }
  assert.equal(subject.includes('Pat'), false);
  assert.match(text, /^Review it at https:\/\/develop\.madcowphotos\.pages\.dev\/admin\/people$/m);
});
