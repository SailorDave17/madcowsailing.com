// Revoking a person, hiding everything they sent, deleting an account on
// request, and letting a deleted revoked account's address ask again (#225,
// epic #216): lib/people.js's revokeTeams, hidePhotos, deleteAccount and
// allowAddress, approveTeams' lift, requestAccount's hold, restorePhoto's way
// back to the queue, the four presses under functions/api/admin/people/, and
// what /admin/people and /admin/removals show. Against a real SQLite holding
// the real migrations (test/d1.js). The guards in front of every admin route
// are test/guard.test.js's; /policy's rows and README's delete by hand are
// test/policy.test.js's.
//
// fetch is stood in for: Resend's URL answers 200, and any other URL throws.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as albumsGuard } from '../functions/api/albums/_middleware.js';
import { onRequestGet as openList } from '../functions/api/albums/open.js';
import * as allowRoute from '../functions/api/admin/people/allow.js';
import * as approveRoute from '../functions/api/admin/people/approve.js';
import * as deleteRoute from '../functions/api/admin/people/delete.js';
import * as hideRoute from '../functions/api/admin/people/hide.js';
import * as revokeRoute from '../functions/api/admin/people/revoke.js';
import * as restoreRoute from '../functions/api/admin/removals/restore.js';
import { requestAccount } from '../lib/accounts.js';
import { ACCOUNT_COOKIE, sessionAccount, signAccountSession } from '../lib/account-session.js';
import { adminRemovalsPage, removalsNotice } from '../lib/admin-page.js';
import { createAlbum } from '../lib/albums.js';
import { RESEND_URL } from '../lib/mail.js';
import {
  ACTIONS, HIDDEN_DAY_SECONDS, adminLog, allowAddress, approveTeams, deleteAccount, hidePhotos, peopleLists, rejectTeams, revokeTeams,
} from '../lib/people.js';
import { adminPeoplePage, peopleLocation, peopleNotice } from '../lib/people-page.js';
import { approvedPhoto, publicAlbum } from '../lib/public.js';
import { waitingBatches } from '../lib/queue.js';
import { WAITING_WHEN_HIDDEN, deletePhoto, hiddenPhotos, restorePhoto } from '../lib/removals.js';
import { requireUploadSession } from '../lib/session.js';
import { emailHash } from '../lib/sign-in.js';
import { ADDRESS_KEY, emailKeyOf } from './address-key.js';
import { seedAdmin } from './admin.js';
import { d1 } from './d1.js';
import { r2 } from './r2.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const ADMIN = 'owner@example.com';
const NOW = 1_790_000_000;
const SESSION_KEY = 'test-session-signing-key-0123456789abcdef';
// The owner, viewing the page, so every button an owner may press is drawn.
const VIEWER = { id: 999, name: 'Owner', email: ADMIN, role: 'owner', issued: 1 };

const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map((row) => ({ ...row }));
const count = (db, table) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const states = (db, id) => Object.fromEntries(rows(db, 'SELECT team, state FROM account_teams WHERE account_id = ?', id).map((r) => [r.team, r.state]));
const version = (db, id) => db.sqlite.prepare('SELECT session_version AS v FROM accounts WHERE id = ?').get(id)?.v;
const logOf = (db) => rows(db, 'SELECT at, admin, action, account_id, name, email, detail FROM admin_log ORDER BY id');

let sends;
beforeEach(() => {
  sends = [];
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url !== RESEND_URL) throw new Error(`fetched ${url}, not Resend's`);
    sends.push(JSON.parse(init.body));
    return Response.json({ id: 'msg-225' });
  });
});
afterEach(() => mock.restoreAll());

// One request through #220's own function, so the rows are the ones a real
// request writes. Answers the account's id.
let asked = 0;
async function ask(db, { name = 'Jane Rivers', email = 'jane@example.org', role = 'parent', teams = ['hoover-jrt', 'cohssa'], now = NOW } = {}) {
  asked += 1;
  const result = await requestAccount(db, { request: { name, email, role, teams, note: null }, address: `address-${asked}`, emailKey: await emailKeyOf(email), now });
  assert.deepEqual(result, { outcome: 'taken', created: true });
  return db.sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email).id;
}

// A request, approved for every team it asked for, through #221's function.
async function approved(db, options = {}) {
  const id = await ask(db, options);
  await approveTeams(db, { accountId: id, teams: options.teams ?? ['hoover-jrt', 'cohssa'], role: options.role ?? 'parent', admin: ADMIN, now: NOW });
  return id;
}

const revoke = (db, accountId, teams, now = NOW + 60) => revokeTeams(db, { accountId, teams, hashKey: ADDRESS_KEY, admin: ADMIN, now });
const holdOf = async (db, email) => rows(db, 'SELECT account_id FROM revoked_addresses WHERE email_hash = ?', await emailKeyOf(email));

// An album of `team`, answering its id and address.
async function album(db, team = 'hoover-jrt', title = 'Fall Regatta') {
  const address = await createAlbum(db, { team, title, kind: 'regatta', date: '2026-10-04' }, NOW);
  return { id: db.sqlite.prepare('SELECT id FROM albums WHERE address = ?').get(address).id, address };
}

// A photo row in `state`, sent by `account` (or, as before #226, by the invite
// link when null), as insertPhoto writes one (0012's placeholders for an
// account's row).
let media = 0;
function photo(db, albumId, { account = null, state = 'approved' } = {}) {
  media += 1;
  const { lastInsertRowid } = db.sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, account_id, ' +
    'captured_at, sent_at, width, height, grid_width, grid_height, screen_width, screen_height, bytes, approved_at, hidden_at, hidden_note) ' +
    "VALUES (?, 'photo', ?, ?, 'b', 'parent', ?, ?, ?, ?, ?, 4, 3, 4, 3, 4, 3, 10, ?, ?, ?)",
  ).run(
    albumId, state, media.toString(16).padStart(32, '0'),
    account === null ? 1 : 0, account === null ? 1 : 0, account,
    NOW - 1000 + media, NOW - 500 + media,
    state === 'pending' ? null : NOW - 100,
    state === 'hidden' ? NOW - 50 : null,
    state === 'hidden' ? 'a takedown note' : null,
  );
  return Number(lastInsertRowid);
}
const photoState = (db, id) => ({ ...db.sqlite.prepare('SELECT state, approved_at, hidden_at, hidden_note, account_id FROM photos WHERE id = ?').get(id) });

// ---- Criteria 1 and 2: a revoke ends the person's sessions ------------------

test('revoking one team: that team is revoked and the other stays, the session version goes up by 1, and each team is logged (criteria 1, 2 and 6)', async () => {
  const db = d1();
  const id = await approved(db);
  assert.equal(version(db, id), 1);
  assert.deepEqual(await revoke(db, id, ['cohssa']), ['cohssa']);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'approved', cohssa: 'revoked' });
  assert.equal(version(db, id), 2);
  assert.deepEqual(logOf(db).filter((e) => e.action === 'revoke'), [
    { at: NOW + 60, admin: ADMIN, action: 'revoke', account_id: id, name: 'Jane Rivers', email: 'jane@example.org', detail: 'COHSSA' },
  ]);
  // The address is held, as a keyed hash naming the account while it exists.
  assert.deepEqual(await holdOf(db, 'jane@example.org'), [{ account_id: id }]);
  const [row] = rows(db, 'SELECT email_hash FROM revoked_addresses');
  assert.equal(row.email_hash, await emailHash(ADDRESS_KEY, 'jane@example.org'));
  assert.doesNotMatch(JSON.stringify(rows(db, 'SELECT * FROM revoked_addresses')), /jane/i);
});

test('revoking every team is revoking the account: both teams logged in the form\'s order, and the person moves to the Revoked list (criterion 1)', async () => {
  const db = d1();
  const id = await approved(db);
  assert.deepEqual(await revoke(db, id, ['cohssa', 'hoover-jrt']), ['hoover-jrt', 'cohssa']);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'revoked', cohssa: 'revoked' });
  assert.deepEqual(logOf(db).filter((e) => e.action === 'revoke').map((e) => e.detail), ['COHSSA', 'Hoover JRT']);
  const lists = await peopleLists(db);
  assert.deepEqual(lists.revoked.map((p) => p.id), [id]);
  assert.deepEqual([...lists.waiting, ...lists.approved, ...lists.turnedDown], []);
  // In TEAMS order, as the route's readTeams gives it: not the table's own
  // order (alphabetical, its primary key's), so the log's ORDER BY is what
  // decides it (review-fanout, over its cap).
  const sam = await approved(db, { name: 'Sam Lee', email: 'sam@example.org' });
  await revoke(db, sam, ['hoover-jrt', 'cohssa']);
  assert.deepEqual(logOf(db).filter((e) => e.action === 'revoke' && e.account_id === sam).map((e) => e.detail), ['Hoover JRT', 'COHSSA']);
});

test('someone revoked from one team and turned down for the other is listed under Revoked, with both boxes under one legend (review-fanout, over its cap)', async () => {
  const db = d1();
  const id = await ask(db);
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  await rejectTeams(db, { accountId: id, teams: ['hoover-jrt'], admin: ADMIN, now: NOW });
  await revoke(db, id, ['cohssa']);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'rejected', cohssa: 'revoked' });
  const lists = await peopleLists(db);
  assert.deepEqual(lists.revoked.map((p) => p.id), [id]);
  assert.deepEqual(lists.turnedDown, []);
  const html = adminPeoplePage({ lists, log: await adminLog(db), viewer: VIEWER });
  const form = html.match(new RegExp(`<li class="person" id="person-${id}">[\\s\\S]*?action="/api/admin/people/approve"[\\s\\S]*?</form>`))[0];
  assert.match(form, /<legend>Teams turned down or revoked<\/legend>/);
  assert.deepEqual([...form.matchAll(/name="team" value="([^"]+)"( checked)?/g)].map((m) => `${m[1]}${m[2] ? '*' : ''}`), ['hoover-jrt', 'cohssa']);
});

test('every session the account holds ends at its next request, and re-approving cannot bring a cookie from before the revoke back (criterion 2)', async () => {
  const db = d1();
  const id = await approved(db);
  const at = (v) => sessionAccount(db, { accountId: id, version: v, issued: NOW });
  assert.ok(await at(1), 'the control: the session from before any revoke holds');
  await revoke(db, id, ['cohssa']);
  assert.equal(await at(1), null, 'a cookie from before the one-team revoke still holds');
  assert.deepEqual((await at(2)).teams, ['hoover-jrt']);
  await revoke(db, id, ['hoover-jrt'], NOW + 120);
  assert.equal(await at(2), null);
  assert.equal(await at(3), null, 'an account revoked from every team still signs in');
  // Re-approved: a new sign-in works, and no cookie from before either revoke.
  assert.deepEqual(await approveTeams(db, { accountId: id, teams: ['hoover-jrt', 'cohssa'], role: 'parent', admin: ADMIN, now: NOW + 180 }), ['hoover-jrt', 'cohssa']);
  assert.equal(await at(1), null);
  assert.equal(await at(2), null);
  assert.deepEqual((await at(3)).teams, ['hoover-jrt', 'cohssa']);
});

/** A chain of handlers, as Pages runs them, with one context.data. */
function chain(handlers, request, env) {
  const data = {};
  const run = (i) => handlers[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

test('revoking one team takes its events out of the person\'s choices on the share page, and the old session out of the upload guard (criterion 1)', async () => {
  const db = d1();
  const env = { DB: db, MEDIA: r2(), SITE_ENV: 'production', SESSION_SIGNING_KEY: SESSION_KEY, ADDRESS_HASH_KEY: ADDRESS_KEY };
  const hoover = await album(db, 'hoover-jrt', 'Fall Regatta');
  const cohssa = await album(db, 'cohssa', 'COHSSA Fall Champs');
  const id = await approved(db);
  const cookie = async (v) => ({ Cookie: `${ACCOUNT_COOKIE}=${await signAccountSession(SESSION_KEY, { accountId: id, version: v }, Math.floor(Date.now() / 1000))}` });
  const offered = async (v) => {
    const res = await chain([root, albumsGuard, openList], new Request(`${SITE}/api/albums/open`, { headers: await cookie(v) }), env);
    return res.status === 200 ? (await res.json()).albums.map((a) => a.address).sort() : res.status;
  };
  const guarded = async (v) => {
    const data = {};
    const res = await requireUploadSession({ request: new Request(`${SITE}/api/upload/session`, { headers: await cookie(v) }), env, data, params: {}, next: () => new Response(null, { status: 204 }) });
    return res.status === 204 ? data.session.teams : res.status;
  };
  assert.deepEqual(await offered(1), [cohssa.address, hoover.address].sort());
  assert.deepEqual(await guarded(1), ['hoover-jrt', 'cohssa']);
  await revoke(db, id, ['cohssa']);
  assert.equal(await guarded(1), 401, 'the session from before the revoke still passes the upload guard');
  assert.equal(await offered(1), 401);
  // Signed in again: only the team it keeps.
  assert.deepEqual(await offered(2), [hoover.address]);
  assert.deepEqual(await guarded(2), ['hoover-jrt']);
});

// ---- Criterion 3: approved photos stay -----------------------------------------

test('revoking leaves the person\'s approved photos public, and their waiting ones waiting (criterion 3, D17)', async () => {
  const db = d1();
  const { id: albumId, address } = await album(db);
  const id = await approved(db);
  const shown = photo(db, albumId, { account: id });
  const waiting = photo(db, albumId, { account: id, state: 'pending' });
  await revoke(db, id, ['hoover-jrt', 'cohssa']);
  assert.ok(await approvedPhoto(db, shown), 'a revoked person\'s approved photo is no longer served');
  assert.deepEqual((await publicAlbum(db, address)).photos.map((p) => p.id), [shown]);
  assert.equal(photoState(db, waiting).state, 'pending');
  assert.equal(photoState(db, shown).account_id, id);
});

// ---- What a revoke refuses -------------------------------------------------------

test('a revoke refuses an admin and the owner, a team not approved, a gone account and a second press, and changes nothing (owner, at #225\'s pickup)', async () => {
  const db = d1();
  const owner = seedAdmin(db, { email: 'owner@example.org', role: 'owner' });
  const admin = seedAdmin(db, { email: 'admin@example.org', name: 'Ada Admin', role: 'admin' });
  const id = await approved(db, { teams: ['hoover-jrt'] });
  // A team still waiting, and one turned down, beside an approved one: the
  // REVOCABLE filter is what refuses these, where a team never asked for has
  // no row at all (review-fanout's finding).
  const waits = await ask(db, { name: 'Wes Waiting', email: 'wes@example.org' });
  await approveTeams(db, { accountId: waits, teams: ['hoover-jrt'], role: 'parent', admin: ADMIN, now: NOW });
  const down = await ask(db, { name: 'Dee Down', email: 'dee@example.org' });
  await approveTeams(db, { accountId: down, teams: ['hoover-jrt'], role: 'parent', admin: ADMIN, now: NOW });
  await rejectTeams(db, { accountId: down, teams: ['cohssa'], admin: ADMIN, now: NOW });
  const before = { log: count(db, 'admin_log'), holds: count(db, 'revoked_addresses'), versions: rows(db, 'SELECT id, session_version FROM accounts ORDER BY id') };
  for (const accountId of [owner, admin]) assert.equal(await revoke(db, accountId, ['hoover-jrt']), null, `account ${accountId}`);
  assert.equal(await revoke(db, id, ['cohssa']), null, 'a team never asked for');
  assert.equal(await revoke(db, waits, ['cohssa']), null, 'a team still waiting');
  assert.equal(await revoke(db, down, ['cohssa']), null, 'a team turned down');
  assert.deepEqual([states(db, waits).cohssa, states(db, down).cohssa], ['requested', 'rejected']);
  assert.equal(await revoke(db, id + 50, ['hoover-jrt']), null, 'an account that is not there');
  assert.deepEqual(rows(db, 'SELECT account_id, state FROM account_teams WHERE account_id IN (?, ?)', owner, admin).map((r) => r.state), ['approved', 'approved']);
  assert.deepEqual({ log: count(db, 'admin_log'), holds: count(db, 'revoked_addresses'), versions: rows(db, 'SELECT id, session_version FROM accounts ORDER BY id') }, before);
  // Pressed twice: the second finds nothing approved.
  assert.deepEqual(await revoke(db, id, ['hoover-jrt']), ['hoover-jrt']);
  const logged = count(db, 'admin_log');
  assert.equal(await revoke(db, id, ['hoover-jrt'], NOW + 90), null);
  assert.equal(count(db, 'admin_log'), logged);
  assert.equal(version(db, id), 2);
  // The control: an admin's teams are revocable once the role is gone.
  db.sqlite.prepare('UPDATE accounts SET admin_role = NULL WHERE id = ?').run(admin);
  assert.deepEqual(await revoke(db, admin, ['hoover-jrt']), ['hoover-jrt']);
});

test('a revoke is all or nothing: when its last statement fails, the log entries, the hash and the version roll back with it', async () => {
  const db = d1();
  const id = await approved(db);
  const logged = count(db, 'admin_log');
  db.sqlite.exec("CREATE TRIGGER fail_team AFTER UPDATE ON account_teams BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  await assert.rejects(revoke(db, id, ['cohssa']), /D1_ERROR/);
  assert.equal(count(db, 'admin_log'), logged);
  assert.equal(count(db, 'revoked_addresses'), 0);
  assert.equal(version(db, id), 1);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'approved', cohssa: 'approved' });
});

test('a revoke with no key refuses before anything is read or written', async () => {
  const db = d1();
  const id = await approved(db);
  const before = db.statements.length;
  for (const hashKey of [undefined, '']) {
    await assert.rejects(revokeTeams(db, { accountId: id, teams: ['cohssa'], hashKey, admin: ADMIN, now: NOW }), /no hashKey/);
  }
  assert.equal(db.statements.length, before);
});

// ---- Criterion 5: a revoked address is held back ---------------------------------

// The statements a request runs, from the first after `mark`.
const ran = (db, mark) => db.statements.slice(mark);

test('a revoked address that asks again, before or after a delete, writes nothing and runs the same statements as a new address (criterion 5; #220\'s criterion 4)', async () => {
  const db = d1();
  const id = await approved(db, { email: 'Jane@Example.org' });
  await revoke(db, id, ['hoover-jrt', 'cohssa']);
  const take = async (email, address, now) => {
    const mark = db.statements.length;
    const result = await requestAccount(db, { request: { name: 'Jane Again', email, role: 'coach', teams: ['cohssa'], note: 'please' }, address, emailKey: await emailKeyOf(email), now });
    return { result, statements: ran(db, mark) };
  };
  const fresh = await take('new@example.org', 'address-new', NOW + 100);
  assert.deepEqual(fresh.result, { outcome: 'taken', created: true });
  const accounts = () => rows(db, 'SELECT id, name, role, note FROM accounts ORDER BY id');
  const teams = () => rows(db, 'SELECT * FROM account_teams ORDER BY account_id, team');
  const before = { accounts: accounts(), teams: teams() };

  // Revoked, the account still there.
  const revoked = await take('jane@example.org', 'address-r', NOW + 200);
  assert.deepEqual(revoked.result, { outcome: 'taken', created: false });
  assert.deepEqual(revoked.statements, fresh.statements);
  assert.deepEqual({ accounts: accounts(), teams: teams() }, before);

  // Deleted, by the admin's press: only the hash stays.
  assert.equal(await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 250 }), true);
  assert.deepEqual(await holdOf(db, 'jane@example.org'), [{ account_id: null }]);
  const after = { accounts: accounts(), teams: teams() };
  for (const [email, address] of [['jane@example.org', 'address-d1'], ['JANE@EXAMPLE.ORG', 'address-d2']]) {
    const held = await take(email, address, NOW + 300);
    assert.deepEqual(held.result, { outcome: 'taken', created: false }, email);
    assert.deepEqual(held.statements, fresh.statements, email);
  }
  assert.deepEqual({ accounts: accounts(), teams: teams() }, after);
  // Not back as a fresh request: the only one waiting is the new address's.
  assert.deepEqual((await peopleLists(db)).waiting.map((p) => p.email), ['new@example.org']);
  // The control: another address is taken as new.
  assert.deepEqual((await take('sam@example.org', 'address-s', NOW + 400)).result, { outcome: 'taken', created: true });
});

test('re-approving lifts the hold once no team is left revoked, so a later delete holds nothing back (criterion 5: the owner allows it)', async () => {
  const db = d1();
  const id = await approved(db);
  await revoke(db, id, ['hoover-jrt', 'cohssa']);
  assert.equal(count(db, 'revoked_addresses'), 1);
  // One of the two back: still held.
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW + 100 });
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'revoked', cohssa: 'approved' });
  assert.deepEqual(await holdOf(db, 'jane@example.org'), [{ account_id: id }]);
  // Both back: lifted, in the approval's own batch.
  await approveTeams(db, { accountId: id, teams: ['hoover-jrt'], role: 'parent', admin: ADMIN, now: NOW + 200 });
  assert.equal(count(db, 'revoked_addresses'), 0);
  assert.deepEqual(logOf(db).filter((e) => e.action === 'approve').map((e) => e.detail), ['Hoover JRT', 'COHSSA', 'COHSSA', 'Hoover JRT']);
  // Deleted now, the address asks again and is taken.
  await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 300 });
  const result = await requestAccount(db, { request: { name: 'Jane', email: 'jane@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'x', emailKey: await emailKeyOf('jane@example.org'), now: NOW + 400 });
  assert.deepEqual(result, { outcome: 'taken', created: true });
});

test('approving one person lifts no one else\'s hold, a deleted account\'s included (criterion 5; review-fanout\'s finding)', async () => {
  // The lift's account_id scoping: every other test reaching it had one
  // account holding a hold. An ordinary approval leaves its account with no
  // revoked team, which is when an unscoped lift would delete every hold.
  const db = d1();
  const ann = await approved(db, { name: 'Ann Both', email: 'ann@example.org' });
  const bob = await approved(db, { name: 'Bob Gone', email: 'bob@example.org' });
  await revoke(db, ann, ['hoover-jrt', 'cohssa']);
  await revoke(db, bob, ['cohssa']);
  await deleteAccount(db, { accountId: bob, admin: ADMIN, now: NOW + 100 });
  const cal = await ask(db, { name: 'Cal New', email: 'cal@example.org' });
  assert.deepEqual(await approveTeams(db, { accountId: cal, teams: ['hoover-jrt', 'cohssa'], role: 'parent', admin: ADMIN, now: NOW + 200 }), ['hoover-jrt', 'cohssa']);
  assert.deepEqual(rows(db, 'SELECT account_id FROM revoked_addresses ORDER BY account_id').map((r) => r.account_id), [null, ann]);
  const asks = await requestAccount(db, { request: { name: 'Bob', email: 'bob@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'x', emailKey: await emailKeyOf('bob@example.org'), now: NOW + 300 });
  assert.deepEqual(asks, { outcome: 'taken', created: false });
});

test('"Let it ask again" names the newest account the log has for the address (review-fanout\'s finding)', async () => {
  // The address had an account deleted unrevoked, asked again under a new
  // name, and was revoked and deleted: the lift's entry names the second.
  const db = d1();
  const first = await approved(db, { name: 'Pat Old', email: 'pat@example.org' });
  await deleteAccount(db, { accountId: first, admin: ADMIN, now: NOW + 10 });
  const second = await approved(db, { name: 'Pat New', email: 'pat@example.org' });
  await revoke(db, second, ['hoover-jrt', 'cohssa'], NOW + 20);
  await deleteAccount(db, { accountId: second, admin: ADMIN, now: NOW + 30 });
  const logged = count(db, 'admin_log');
  assert.equal(await allowAddress(db, { email: 'pat@example.org', hashKey: ADDRESS_KEY, admin: ADMIN, now: NOW + 40 }), 'allowed');
  assert.equal(count(db, 'admin_log'), logged + 1);
  const entry = logOf(db).at(-1);
  assert.deepEqual([entry.action, entry.account_id, entry.name], ['allow', second, 'Pat New']);
  assert.notEqual(first, second);
});

test('a request with no emailKey is refused before anything is read or written, so no caller can skip the hold', async () => {
  const db = d1();
  const before = db.statements.length;
  for (const emailKey of [undefined, null, '', 42]) {
    await assert.rejects(requestAccount(db, { request: { name: 'J', email: 'j@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'a', emailKey, now: NOW }), /no emailKey/);
  }
  assert.equal(db.statements.length, before);
  assert.equal(count(db, 'account_request_log'), 0);
});

test('"Let it ask again" lifts a deleted account\'s hold and logs it by the name the log knows; the next request is taken as new (criterion 5)', async () => {
  const db = d1();
  const id = await approved(db, { name: 'Jane Rivers', email: 'Jane@Example.org' });
  await revoke(db, id, ['hoover-jrt', 'cohssa']);
  // Still an account: re-approving is the way back, and nothing changes.
  assert.equal(await allowAddress(db, { email: 'jane@example.org', hashKey: ADDRESS_KEY, admin: ADMIN, now: NOW + 100 }), 'account');
  await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 200 });
  const logged = count(db, 'admin_log');
  assert.equal(await allowAddress(db, { email: 'nobody@example.org', hashKey: ADDRESS_KEY, admin: ADMIN, now: NOW + 250 }), 'not-held');
  assert.equal(count(db, 'admin_log'), logged);
  // Typed in another letter case: the hash and the log match it.
  assert.equal(await allowAddress(db, { email: 'JANE@example.org', hashKey: ADDRESS_KEY, admin: 'admin2@example.org', now: NOW + 300 }), 'allowed');
  assert.equal(count(db, 'revoked_addresses'), 0);
  // One press, one entry, although five entries name her (review-fanout).
  assert.equal(count(db, 'admin_log'), logged + 1);
  assert.deepEqual(logOf(db).at(-1), { at: NOW + 300, admin: 'admin2@example.org', action: 'allow', account_id: id, name: 'Jane Rivers', email: 'Jane@Example.org', detail: null });
  // A second press finds nothing held.
  assert.equal(await allowAddress(db, { email: 'jane@example.org', hashKey: ADDRESS_KEY, admin: ADMIN, now: NOW + 310 }), 'not-held');
  const result = await requestAccount(db, { request: { name: 'Jane', email: 'jane@example.org', role: 'parent', teams: ['cohssa'], note: null }, address: 'x', emailKey: await emailKeyOf('jane@example.org'), now: NOW + 400 });
  assert.deepEqual(result, { outcome: 'taken', created: true });
});

test('"Let it ask again" changes nothing when no log entry names the address as typed, so a lift is never unlogged', async () => {
  const db = d1();
  // A hold whose address the log names only in another case of a letter
  // outside A to Z, which COLLATE NOCASE does not fold.
  const id = await approved(db, { email: 'émile@example.org' });
  await revoke(db, id, ['hoover-jrt', 'cohssa']);
  await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 100 });
  const logged = count(db, 'admin_log');
  assert.equal(await allowAddress(db, { email: 'Émile@example.org', hashKey: ADDRESS_KEY, admin: ADMIN, now: NOW + 200 }), 'unmatched');
  assert.equal(count(db, 'revoked_addresses'), 1);
  assert.equal(count(db, 'admin_log'), logged);
  // As the log shows it, it lifts.
  assert.equal(await allowAddress(db, { email: 'émile@example.org', hashKey: ADDRESS_KEY, admin: ADMIN, now: NOW + 300 }), 'allowed');
});

// ---- Criterion 4: hide all their photos ------------------------------------------

test('"Hide all their photos" hides every photo the account sent, waiting or public, and nothing else, logging how many (criteria 4 and 6)', async () => {
  const db = d1();
  const { id: albumId, address } = await album(db);
  const id = await approved(db);
  const other = await approved(db, { name: 'Sam Lee', email: 'sam@example.org' });
  const shown = photo(db, albumId, { account: id });
  const waiting = photo(db, albumId, { account: id, state: 'pending' });
  const taken = photo(db, albumId, { account: id, state: 'hidden' });
  const sams = photo(db, albumId, { account: other });
  const invite = photo(db, albumId, { account: null, state: 'pending' });
  assert.deepEqual(await hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW + 60 }), { hidden: 2, waiting: 1 });
  assert.deepEqual(photoState(db, shown), { state: 'hidden', approved_at: NOW - 100, hidden_at: NOW + 60, hidden_note: null, account_id: id });
  assert.deepEqual(photoState(db, waiting), { state: 'hidden', approved_at: WAITING_WHEN_HIDDEN, hidden_at: NOW + 60, hidden_note: null, account_id: id });
  // A photo already taken down keeps its own time and note.
  assert.deepEqual(photoState(db, taken), { state: 'hidden', approved_at: NOW - 100, hidden_at: NOW - 50, hidden_note: 'a takedown note', account_id: id });
  assert.equal(photoState(db, sams).state, 'approved');
  assert.equal(photoState(db, invite).state, 'pending');
  assert.deepEqual(logOf(db).at(-1), { at: NOW + 60, admin: ADMIN, action: 'hide', account_id: id, name: 'Jane Rivers', email: 'jane@example.org', detail: '2 photos' });
  // Off the site and out of the queue, and on /admin/removals naming the account.
  assert.equal(await approvedPhoto(db, shown), null);
  assert.deepEqual((await publicAlbum(db, address)).photos.map((p) => p.id), [sams]);
  assert.deepEqual((await waitingBatches(db)).flatMap((b) => b.photos.map((p) => p.id)), [invite]);
  const removals = await hiddenPhotos(db);
  assert.deepEqual(removals.map((p) => [p.id, p.accountName, p.waiting]), [[taken, 'Jane Rivers', false], [shown, 'Jane Rivers', false], [waiting, 'Jane Rivers', true]]);
  // No takedown was counted against anyone.
  assert.equal(count(db, 'removal_requests'), 0);
});

test('a hidden photo that was public goes back public, one that was waiting goes back to the queue, and either can be deleted for good (criterion 4)', async () => {
  const db = d1();
  const bucket = r2();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  const shown = photo(db, albumId, { account: id });
  const waiting = photo(db, albumId, { account: id, state: 'pending' });
  const third = photo(db, albumId, { account: id, state: 'pending' });
  await hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW + 60 });
  assert.equal(await restorePhoto(db, shown), 'approved');
  assert.deepEqual(photoState(db, shown), { state: 'approved', approved_at: NOW - 100, hidden_at: NOW + 60, hidden_note: null, account_id: id });
  assert.equal(await restorePhoto(db, waiting), 'pending');
  assert.deepEqual(photoState(db, waiting), { state: 'pending', approved_at: null, hidden_at: NOW + 60, hidden_note: null, account_id: id });
  assert.equal(await approvedPhoto(db, waiting), null, 'a photo nobody approved went public when it was put back');
  assert.deepEqual((await waitingBatches(db)).flatMap((b) => b.photos.map((p) => p.id)), [waiting]);
  assert.equal(await restorePhoto(db, waiting), null, 'a photo no longer hidden was put back again');
  assert.deepEqual(await deletePhoto(db, bucket, third), { deleted: true, kept: false });
  assert.equal(count(db, 'photos'), 2);
});

test('"Hide all" with nothing to hide, a gone account or a second press changes nothing and logs nothing', async () => {
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  const none = await approved(db, { name: 'Sam Lee', email: 'sam@example.org' });
  photo(db, albumId, { account: id });
  photo(db, albumId, { account: none, state: 'hidden' });
  assert.equal(await hidePhotos(db, { accountId: none, admin: ADMIN, now: NOW }), null);
  assert.equal(await hidePhotos(db, { accountId: id + 50, admin: ADMIN, now: NOW }), null);
  const logged = count(db, 'admin_log');
  assert.deepEqual(await hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW }), { hidden: 1, waiting: 0 });
  assert.equal(logOf(db).at(-1).detail, '1 photo');
  assert.equal(await hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW + 1 }), null);
  assert.equal(count(db, 'admin_log'), logged + 1);
});

test('"Hide all" is all or nothing: when the change fails, the log entry rolls back with it', async () => {
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  photo(db, albumId, { account: id });
  const logged = count(db, 'admin_log');
  db.sqlite.exec("CREATE TRIGGER fail_hide AFTER UPDATE ON photos BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  await assert.rejects(hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW }), /D1_ERROR/);
  assert.equal(count(db, 'admin_log'), logged);
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM photos WHERE state = 'approved'")[0].n, 1);
});

// ---- Criterion 7: deleting an account on request ---------------------------------

test('a delete takes the account and its teams, links and codes; every photo stays and stops naming it; the log keeps naming the person (criteria 6 and 7)', async () => {
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db, { teams: ['hoover-jrt'] });
  const stays = await approved(db, { name: 'Sam Lee', email: 'sam@example.org' });
  const shown = photo(db, albumId, { account: id });
  const waiting = photo(db, albumId, { account: id, state: 'pending' });
  const taken = photo(db, albumId, { account: id, state: 'hidden' });
  db.sqlite.prepare('INSERT INTO password_links (token_hash, account_id, made_at, expires_at) VALUES (?, ?, ?, ?)').run('L'.repeat(43), id, NOW, NOW + 10);
  const before = logOf(db).filter((e) => e.account_id === id);
  assert.ok(before.length > 0);
  assert.equal(await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 60 }), true);
  assert.deepEqual(rows(db, 'SELECT id FROM accounts').map((r) => r.id), [stays]);
  assert.equal(rows(db, 'SELECT * FROM account_teams WHERE account_id = ?', id).length, 0);
  assert.equal(count(db, 'password_links'), 0);
  for (const [photoId, state] of [[shown, 'approved'], [waiting, 'pending'], [taken, 'hidden']]) {
    assert.deepEqual([photoState(db, photoId).state, photoState(db, photoId).account_id], [state, null], `photo ${photoId}`);
  }
  const after = logOf(db).filter((e) => e.account_id === id);
  assert.deepEqual(after.slice(0, -1), before);
  assert.deepEqual(after.at(-1), { at: NOW + 60, admin: ADMIN, action: 'delete', account_id: id, name: 'Jane Rivers', email: 'jane@example.org', detail: null });
  // A second press finds nothing.
  assert.equal(await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 61 }), false);
  assert.equal(logOf(db).filter((e) => e.action === 'delete').length, 1);
});

test('after Hide all and a delete, no photo\'s takedown time matches the log entry naming the person (criterion 7; the owner\'s choice at #225\'s review)', async () => {
  // Test the join, not the row (cairn: a-timestamp-joins-to-the-log-that-
  // names-it). Another account's photos hidden in the same second keep their
  // second: the cut is the deleted account's alone.
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  const sam = await approved(db, { name: 'Sam Lee', email: 'sam@example.org' });
  const at = 1_790_012_345; // not the start of a day
  const hers = [photo(db, albumId, { account: id }), photo(db, albumId, { account: id, state: 'pending' })];
  const kept = photo(db, albumId, { account: id });
  const his = photo(db, albumId, { account: sam });
  await hidePhotos(db, { accountId: id, admin: ADMIN, now: at });
  await hidePhotos(db, { accountId: sam, admin: ADMIN, now: at + 1 });
  // One of hers put back before the delete: it keeps hidden_at as a record.
  assert.equal(await restorePhoto(db, kept), 'approved');
  const matched = () => rows(db, "SELECT p.id FROM photos AS p JOIN admin_log AS l ON l.action = 'hide' AND l.at = p.hidden_at WHERE l.account_id = ? ORDER BY p.id", id).map((r) => r.id);
  // The control: before the delete, the log's entry finds exactly her photos.
  assert.deepEqual(matched(), [...hers, kept]);
  assert.equal(await deleteAccount(db, { accountId: id, admin: ADMIN, now: at + 100 }), true);
  assert.deepEqual(matched(), [], 'a photo\'s takedown time still names the deleted person');
  const day = at - (at % HIDDEN_DAY_SECONDS);
  for (const photoId of [...hers, kept]) assert.equal(photoState(db, photoId).hidden_at, day, `photo ${photoId}`);
  assert.equal(photoState(db, his).hidden_at, at + 1, 'the cut reached an account the delete does not name');
  assert.equal(HIDDEN_DAY_SECONDS, 86400);
});

test('a delete keeps a revoked account\'s address as a keyed hash naming nothing, and an account never revoked leaves none (criterion 7)', async () => {
  const db = d1();
  const revokedId = await approved(db);
  const plain = await approved(db, { name: 'Sam Lee', email: 'sam@example.org' });
  await revoke(db, revokedId, ['cohssa']);
  await deleteAccount(db, { accountId: revokedId, admin: ADMIN, now: NOW + 100 });
  await deleteAccount(db, { accountId: plain, admin: ADMIN, now: NOW + 100 });
  assert.deepEqual(rows(db, 'SELECT email_hash, account_id FROM revoked_addresses'), [{ email_hash: await emailKeyOf('jane@example.org'), account_id: null }]);
});

test('a delete refuses an admin and the owner, and changes nothing (owner, at #225\'s pickup)', async () => {
  const db = d1();
  const owner = seedAdmin(db, { email: 'owner@example.org', role: 'owner' });
  const admin = seedAdmin(db, { email: 'admin@example.org', name: 'Ada Admin', role: 'admin' });
  const logged = count(db, 'admin_log');
  for (const accountId of [owner, admin]) assert.equal(await deleteAccount(db, { accountId, admin: ADMIN, now: NOW }), false);
  assert.equal(count(db, 'accounts'), 2);
  assert.equal(count(db, 'admin_log'), logged);
});

test('a delete is all or nothing: when it fails, its log entry rolls back with it', async () => {
  const db = d1();
  const id = await approved(db);
  const logged = count(db, 'admin_log');
  db.sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  await assert.rejects(deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW }), /D1_ERROR/);
  assert.equal(count(db, 'admin_log'), logged);
  assert.equal(count(db, 'accounts'), 1);
});

// ---- The presses -----------------------------------------------------------------

const post = (path, fields, { origin = SITE } = {}) => {
  const body = new URLSearchParams();
  for (const [name, value] of fields) body.append(name, value);
  return new Request(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: body.toString() });
};
const context = (request, db, extra = {}) => ({ request, env: { DB: db, RESEND_API_KEY: 'test-key', ADDRESS_HASH_KEY: ADDRESS_KEY, ...extra }, data: { admin: VIEWER } });
const location = (res) => res.headers.get('Location');

test('Revoke revokes the ticked teams and answers 303 back; it refuses a bad form, an admin, and an environment with no key', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await approved(db);
  const admin = seedAdmin(db, { email: 'admin@example.org', role: 'admin' });
  const press = (fields, extra) => revokeRoute.onRequestPost(context(post('/api/admin/people/revoke', fields), db, extra));
  assert.equal(location(await press([['account', String(id)]])), '/admin/people?error=form');
  assert.equal(location(await press([['account', String(id)], ['team', 'sailors']])), '/admin/people?error=form');
  assert.equal(location(await press([['account', String(id)], ['team', 'cohssa']], { ADDRESS_HASH_KEY: '' })), '/admin/people?error=unconfigured');
  assert.equal(version(db, id), 1);
  assert.equal(location(await press([['account', String(admin)], ['team', 'hoover-jrt']])), '/admin/people?error=not-revoked');
  const res = await press([['account', String(id)], ['team', 'cohssa']]);
  assert.equal(res.status, 303);
  assert.equal(location(res), `/admin/people?done=revoked&account=${id}`);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'approved', cohssa: 'revoked' });
  assert.deepEqual(logOf(db).at(-1).action, 'revoke');
  assert.equal(logOf(db).at(-1).admin, ADMIN);
  // The hold is keyed as /ask keys a request, from the route's own secret
  // (review-fanout: a route keyed with another secret read green).
  assert.deepEqual(rows(db, 'SELECT email_hash FROM revoked_addresses').map((r) => r.email_hash), [await emailKeyOf('jane@example.org')]);
  assert.equal(sends.length, 0, 'a revoke emailed someone');
});

test('Hide all needs its box ticked, then answers with the counts; with nothing to hide it says so', async () => {
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  photo(db, albumId, { account: id });
  photo(db, albumId, { account: id, state: 'pending' });
  const press = (fields) => hideRoute.onRequestPost(context(post('/api/admin/people/hide', fields), db));
  assert.equal(location(await press([['account', String(id)]])), `/admin/people?error=hide-unticked&account=${id}`);
  assert.equal(location(await press([['account', String(id)], ['confirm', 'yes']])), `/admin/people?error=hide-unticked&account=${id}`);
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM photos WHERE state = 'hidden'")[0].n, 0);
  assert.equal(location(await press([['confirm', 'hide']])), '/admin/people?error=form');
  assert.equal(location(await press([['account', String(id)], ['confirm', 'hide']])), `/admin/people?done=hidden&account=${id}&hidden=2&waiting=1`);
  assert.equal(location(await press([['account', String(id)], ['confirm', 'hide']])), `/admin/people?error=not-hidden&account=${id}`);
});

test('Delete needs the reply box ticked, refuses an admin, and answers deleted', async () => {
  const db = d1();
  const id = await approved(db);
  const admin = seedAdmin(db, { email: 'admin@example.org', role: 'admin' });
  const press = (fields) => deleteRoute.onRequestPost(context(post('/api/admin/people/delete', fields), db));
  assert.equal(location(await press([['account', String(id)]])), `/admin/people?error=delete-unticked&account=${id}`);
  assert.equal(location(await press([['account', String(id)], ['replied', 'on']])), `/admin/people?error=delete-unticked&account=${id}`);
  assert.equal(count(db, 'accounts'), 2);
  assert.equal(location(await press([['replied', 'yes']])), '/admin/people?error=form');
  assert.equal(location(await press([['account', String(admin)], ['replied', 'yes']])), `/admin/people?error=not-deleted&account=${admin}`);
  assert.equal(location(await press([['account', String(id)], ['replied', 'yes']])), '/admin/people?done=deleted');
  assert.deepEqual(rows(db, 'SELECT id FROM accounts').map((r) => r.id), [admin]);
});

test('Let it ask again takes one typed address and answers each outcome by its own notice', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await approved(db);
  await revoke(db, id, ['hoover-jrt', 'cohssa']);
  const press = (email, extra) => allowRoute.onRequestPost(context(post('/api/admin/people/allow', email === null ? [] : [['email', email]]), db, extra));
  for (const typed of [null, '', 'not an address', 'a@b.c, d@e.org']) assert.equal(location(await press(typed)), '/admin/people?error=address', String(typed));
  assert.equal(location(await press('jane@example.org')), '/admin/people?error=has-account');
  assert.equal(location(await press('nobody@example.org')), '/admin/people?error=not-held');
  await deleteAccount(db, { accountId: id, admin: ADMIN, now: NOW + 10 });
  assert.equal(location(await press('jane@example.org', { ADDRESS_HASH_KEY: '' })), '/admin/people?error=unconfigured');
  assert.equal(location(await press('  jane@example.org  ')), '/admin/people?done=allowed');
  assert.equal(count(db, 'revoked_addresses'), 0);
  // Held, but named in the log only in another case of a letter outside A to
  // Z (review-fanout, over its cap: never pressed until then).
  const emile = await approved(db, { name: 'Émile', email: 'émile@example.org' });
  await revoke(db, emile, ['hoover-jrt', 'cohssa']);
  await deleteAccount(db, { accountId: emile, admin: ADMIN, now: NOW + 20 });
  assert.equal(location(await press('Émile@example.org')), '/admin/people?error=unmatched');
});

test('Approve takes a revoked person back through the route, and emails the usual link', async () => {
  const db = d1();
  const id = await approved(db, { teams: ['cohssa'] });
  await revoke(db, id, ['cohssa']);
  const res = await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'cohssa'], ['role', 'parent']]), db));
  assert.equal(location(res), `/admin/people?done=approved&account=${id}&mail=sent`);
  assert.deepEqual(states(db, id), { cohssa: 'approved' });
  assert.equal(count(db, 'revoked_addresses'), 0);
  assert.equal(sends.length, 1);
});

test('each new press arriving as a GET changes nothing and says so', () => {
  for (const route of [revokeRoute, hideRoute, deleteRoute, allowRoute]) {
    assert.equal(location(route.onRequestGet({ request: new Request(`${SITE}/api/admin/people/x`) })), '/admin/people?error=unchanged');
  }
});

test('"Put it back" through its route says whether the photo went public or back to the queue', async () => {
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  const shown = photo(db, albumId, { account: id });
  const waiting = photo(db, albumId, { account: id, state: 'pending' });
  await hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW });
  const press = (photoId) => restoreRoute.onRequestPost({ request: post('/api/admin/removals/restore?team=hoover-jrt', [['photo', String(photoId)]]), env: { DB: db } });
  assert.equal(location(await press(shown)), `/admin/removals?done=restored&photo=${shown}&team=hoover-jrt`);
  assert.equal(location(await press(waiting)), `/admin/removals?done=queued&photo=${waiting}&team=hoover-jrt`);
  assert.equal(location(await press(waiting)), '/admin/removals?error=gone&team=hoover-jrt');
});

// ---- The pages -------------------------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html) => validator.validateString(html, join(ROOT, 'people.html'));
const problems = (report) => report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));
const item = (html, id) => html.match(new RegExp(`<li class="person" id="person-${id}">[\\s\\S]*?\\n    </li>`))?.[0];
const section = (html, id) => html.match(new RegExp(`<section class="wrap" aria-labelledby="${id}">[\\s\\S]*?</section>`))?.[0];
const more = (html) => html?.match(/<details class="person-more">[\s\S]*?<\/details>/)?.[0];

async function seeded() {
  const db = d1();
  const { id: albumId } = await album(db);
  const ids = {
    both: await approved(db, { name: 'Ann Both', email: 'ann@example.org' }),
    partly: await approved(db, { name: 'Pat Partly', email: 'pat@example.org' }),
    gone: await approved(db, { name: 'Rex Revoked', email: 'rex@example.org', teams: ['cohssa'] }),
    waiting: await ask(db, { name: 'Wes Waiting', email: 'wes@example.org', teams: ['hoover-jrt'] }),
    down: await ask(db, { name: 'Dee Down', email: 'dee@example.org', teams: ['hoover-jrt'] }),
  };
  ids.admin = seedAdmin(db, { email: 'ada@example.org', name: 'Ada Admin', role: 'admin' });
  await revoke(db, ids.partly, ['cohssa']);
  await revoke(db, ids.gone, ['cohssa']);
  await rejectTeams(db, { accountId: ids.down, teams: ['hoover-jrt'], admin: ADMIN, now: NOW });
  photo(db, albumId, { account: ids.both });
  photo(db, albumId, { account: ids.both });
  photo(db, albumId, { account: ids.both, state: 'pending' });
  photo(db, albumId, { account: ids.admin });
  return { db, ids };
}

const render = async (db, query = '', viewer = VIEWER) => {
  const lists = await peopleLists(db);
  return adminPeoplePage({ lists, log: await adminLog(db), notice: peopleNotice(new URLSearchParams(query), lists), viewer });
};

test('each approved person has "Revoke, hide their photos or delete": a box per approved team, none ticked, and two boxes that must be ticked', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const ann = more(item(html, ids.both));
  assert.match(ann, /<summary>Revoke, hide their photos or delete<\/summary>/);
  const revokeForm = ann.match(/<form method="post" action="\/api\/admin\/people\/revoke"[\s\S]*?<\/form>/)[0];
  assert.deepEqual([...revokeForm.matchAll(/<input type="checkbox" name="team" value="([^"]+)">/g)].map((m) => m[1]), ['hoover-jrt', 'cohssa']);
  assert.doesNotMatch(revokeForm, /checked/);
  assert.match(revokeForm, new RegExp(`<input type="hidden" name="account" value="${ids.both}">`));
  assert.match(ann, /<input type="checkbox" name="confirm" value="hide" required> Hide the 3 photos Ann Both sent \(2 public, 1 waiting\)<\/label>/);
  assert.match(ann, /action="\/api\/admin\/people\/hide"/);
  assert.match(ann, /<input type="checkbox" name="replied" value="yes" required> ann@example\.org replied to confirm they asked for this<\/label>/);
  assert.match(ann, /action="\/api\/admin\/people\/delete"/);
  // A person with no photo has no hide form, and the summary says so.
  assert.match(more(item(html, ids.partly)), /<summary>Revoke or delete<\/summary>/);
  assert.doesNotMatch(more(item(html, ids.partly)), /people\/hide/);
});

test('an admin can be neither revoked nor deleted from the page, only have their photos hidden (owner, at #225\'s pickup)', async () => {
  const { db, ids } = await seeded();
  const ada = more(item(await render(db), ids.admin));
  assert.match(ada, /<summary>Hide their photos<\/summary>/);
  assert.doesNotMatch(ada, /people\/revoke|people\/delete/);
  assert.match(section(await render(db), 'people-approved'), /An admin is revoked or deleted only\s+once the owner removes them as an admin\./);
});

test('a partly revoked person stays under Approved, showing the revoked team with an unticked box to approve it again', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const pat = item(html, ids.partly);
  assert.match(section(html, 'people-approved'), new RegExp(`id="person-${ids.partly}"`));
  assert.match(pat, /<p class="person-teams">Hoover JRT: approved · COHSSA: revoked<\/p>/);
  const approveForm = pat.match(/<form method="post" action="\/api\/admin\/people\/approve"[\s\S]*?<\/form>/)[0];
  assert.match(approveForm, /<legend>Teams revoked<\/legend>/);
  assert.deepEqual([...approveForm.matchAll(/name="team" value="([^"]+)"( checked)?/g)].map((m) => `${m[1]}${m[2] ? '*' : ''}`), ['cohssa']);
});

test('a person revoked from every team is listed under Revoked, with Approve to take them back and Delete, and no link or revoke', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const revoked = section(html, 'people-revoked');
  assert.match(revoked, new RegExp(`id="person-${ids.gone}"`));
  assert.doesNotMatch(section(html, 'people-approved'), new RegExp(`id="person-${ids.gone}"`));
  const rex = item(html, ids.gone);
  assert.match(rex, /<p class="person-teams">COHSSA: revoked<\/p>/);
  assert.match(rex, /aria-label="Approve Rex Revoked">Approve<\/button>/);
  assert.doesNotMatch(rex, /Send a new link|Make admin|people\/revoke/);
  assert.match(more(rex), /<summary>Delete<\/summary>/);
  // Until #226 a revoke did not stop the invite link or a coach's sign-in,
  // and the section said so, with the way to end it (review-fanout: it said
  // revoked people "cannot sign in or send"). #226 retired both, so the
  // account is every way in, and the section says only that.
  assert.match(revoked, /Their account cannot sign in or send,/);
  assert.doesNotMatch(revoked, /invite|coaches' sign-in|\/admin\/code|Rotate/i);
  // README's operating record names the four lists the page has.
  const readme = readFileSync(join(ROOT, '..', 'README.md'), 'utf8').split('### Approving accounts\n')[1] ?? '';
  assert.match(readme, /in four lists: \*\*Waiting\*\*,\s+\*\*Approved\*\*, \*\*Revoked\*\* \(since #225\) and \*\*Turned down\*\*/);
  // The form for a deleted account's address sits under the list.
  assert.match(revoked, /<form method="post" action="\/api\/admin\/people\/allow" class="album-form">[\s\S]*<input type="email" id="ask-again-email" name="email" autocomplete="off" required>/);
});

test('waiting and turned-down people can be deleted, and nothing else new shows for them', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  for (const id of [ids.waiting, ids.down]) {
    assert.match(more(item(html, id)), /<summary>Delete<\/summary>/);
    assert.doesNotMatch(item(html, id), /people\/revoke|people\/hide/);
  }
});

test('the notices for each new press say what happened, naming the person from the lists only', async () => {
  const { db, ids } = await seeded();
  const lists = await peopleLists(db);
  const notice = (query) => peopleNotice(new URLSearchParams(query), lists);
  assert.match(notice(`done=revoked&account=${ids.gone}`), /Revoked Rex Revoked\. They are signed out on every phone and computer/);
  assert.match(notice(`done=hidden&account=${ids.both}&hidden=3&waiting=1`), /Hid 3 photos Ann Both sent, 1 of them still waiting for approval\. Each waits on <a href="\/admin\/removals">Removal requests<\/a>, to be put back or deleted for good\. A photo that was waiting goes back to the queue/);
  assert.match(notice(`done=hidden&account=${ids.both}&hidden=1`), /Hid 1 photo Ann Both sent\. Each waits/);
  assert.doesNotMatch(notice(`done=hidden&account=${ids.both}&hidden=1`), /goes back to the queue/);
  assert.match(notice('done=deleted'), /Deleted the account\. The photos it sent stay and no longer name it/);
  assert.match(notice('done=allowed'), /That address can ask for an account again\./);
  // A crafted count shows no text from the query.
  assert.doesNotMatch(notice(`done=hidden&account=${ids.both}&hidden=<b>x</b>`), /<b>x/);
  // Each error by words of its own, not the "Nothing was" they share
  // (review-fanout, over its cap: two swapped texts read 0 red).
  const errors = {
    'not-revoked': 'no ticked team is approved now',
    'not-hidden': 'that account has no photo waiting or public now',
    'hide-unticked': 'tick the box naming their photos',
    'delete-unticked': 'once a reply from the account\'s own address has confirmed',
    'not-deleted': 'Nothing was deleted: the person is an admin',
    address: 'type one email address',
    'not-held': 'that address is not held back',
    'has-account': 'find them in the lists above and approve their revoked team there',
    unmatched: 'no entry in the log names it as typed',
    unconfigured: 'this environment has no ADDRESS_HASH_KEY secret',
  };
  for (const [error, words] of Object.entries(errors)) {
    assert.ok(notice(`error=${error}`).includes(words), `${error}: ${notice(`error=${error}`)}`);
  }
  assert.equal(new Set(Object.keys(errors).map((error) => notice(`error=${error}`))).size, Object.keys(errors).length);
  assert.equal(peopleLocation({ done: 'hidden', account: 3, hidden: 2, waiting: 1 }), '/admin/people?done=hidden&account=3&hidden=2&waiting=1');
});

test('each #225 action has its own sentence in the log (criterion 6)', () => {
  assert.deepEqual(ACTIONS.slice(-4), ['revoke', 'hide', 'delete', 'allow']);
  const entry = (action, detail) => ({ id: 1, at: NOW, admin: ADMIN, action, accountId: 1, name: 'Jane Rivers', email: 'jane@example.org', detail });
  const sentence = (action, detail) => adminPeoplePage({ lists: { waiting: [], approved: [], revoked: [], turnedDown: [] }, log: { entries: [entry(action, detail)], total: 1 }, viewer: VIEWER })
    .match(/<li><time [^>]+>[^<]+<\/time>: ([^<]*)<\/li>/)[1];
  assert.equal(sentence('revoke', 'COHSSA'), 'owner@example.com revoked Jane Rivers (jane@example.org) for COHSSA.');
  assert.equal(sentence('hide', '3 photos'), 'owner@example.com hid every photo Jane Rivers (jane@example.org) sent, 3 photos.');
  assert.equal(sentence('delete', null), 'owner@example.com deleted the account of Jane Rivers (jane@example.org), once a reply from its address confirmed the request.');
  assert.equal(sentence('allow', null), 'owner@example.com let the address of Jane Rivers (jane@example.org) ask for an account again.');
});

test('the page with every new state is valid under the photo site\'s html-validate config, its ids are unique, and a planted second h1 is not valid', async () => {
  const { db, ids } = await seeded();
  for (const query of ['', `done=hidden&account=${ids.both}&hidden=3&waiting=1`, 'error=unmatched']) {
    const html = await render(db, query);
    assert.deepEqual(problems(await validate(html)), [], query);
    assert.equal((await validate(html.replace('<h2 ', '<h1>again</h1><h2 '))).valid, false);
    const found = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(found).size, found.length, 'an id repeats');
  }
});

test('every named button on /admin/people has an accessible name starting with its visible text (WCAG 2.5.3; #225\'s ux-design audit)', async () => {
  // axe's label-content-name-mismatch flagged "Hide all their photos" while
  // its aria-label read "Hide all the photos <name> sent", and #224's "Make
  // admin" and "Remove admin" ("Make <name> an admin"), fixed here too (the
  // owner's choice at #225's review).
  const { db } = await seeded();
  const html = await render(db);
  const buttons = [...html.matchAll(/<button [^>]*aria-label="([^"]+)"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual([...new Set(buttons.map((m) => m[2]))].sort(), ['Approve', 'Delete the account', 'Hide all their photos', 'Make admin', 'Remove admin', 'Revoke', 'Send a new link', 'Turn down']);
  const starts = (label, text) => label.toLowerCase().startsWith(text.toLowerCase());
  for (const [, label, text] of buttons) assert.ok(starts(label, text), `"${label}" does not start with "${text}"`);
  // The control: the label the audit found fails the same check.
  assert.equal(starts('Hide all the photos Ann Both sent', 'Hide all their photos'), false);
});

// The rules in a stylesheet whose selector list names `selector`, as their
// bodies, as test/people.test.js reads them.
const rulesFor = (css, selector) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
  .map((block) => block.split('{'))
  .filter(([selectors, body]) => body !== undefined && selectors.split(',').map((s) => s.trim()).includes(selector))
  .map(([, body]) => body);

test('a box\'s label wraps an unbroken address rather than widening /admin/people past 320 px (WCAG 1.4.10; #225\'s ux-design audit)', () => {
  // The delete box reads "<address> replied to confirm …", and a 53-character
  // address made the page 485 px wide at 320 in Chrome until the label could
  // wrap (the audit's reflow probe, before and after).
  const css = readFileSync(join(ROOT, 'public', 'css', 'site.css'), 'utf8');
  const wraps = (text) => rulesFor(text, '.person-form .choices label').some((body) => /overflow-wrap:\s*anywhere/.test(body));
  assert.ok(wraps(css), 'no rule gives .person-form .choices label overflow-wrap: anywhere');
  assert.equal(wraps(css.replace(/(\.person-form \.choices label \{[^}]*?)\s*overflow-wrap: anywhere;/, '$1')), false);
});

test('/admin/removals marks a photo that was waiting, and its notice says it went back to the queue', async () => {
  const db = d1();
  const { id: albumId } = await album(db);
  const id = await approved(db);
  photo(db, albumId, { account: id });
  const waiting = photo(db, albumId, { account: id, state: 'pending' });
  await hidePhotos(db, { accountId: id, admin: ADMIN, now: NOW });
  const html = adminRemovalsPage({ photos: await hiddenPhotos(db) });
  const marked = [...html.matchAll(/<li class="removal" id="photo-(\d+)">[\s\S]*?<\/li>/g)].filter((m) => m[0].includes('was waiting for approval')).map((m) => Number(m[1]));
  assert.deepEqual(marked, [waiting]);
  assert.deepEqual(problems(await validate(html)), []);
  assert.match(removalsNotice(new URLSearchParams(`done=queued&photo=${waiting}`)), new RegExp(`Put photo ${waiting} back in the queue\\. It was waiting for approval when it was hidden, so it is not public until an admin approves it\\.`));
});
