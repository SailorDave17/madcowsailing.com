// Approving requests for an account (#221): the link to set a password
// (lib/password-link.js), the admins' decisions and their log
// (lib/people.js), the page at /admin/people (lib/people-page.js), its three
// presses under functions/api/admin/people/, and the page a link opens,
// /set-password. Against a real SQLite holding the real migrations
// (test/d1.js). The guards in front of every admin route are
// test/guard.test.js's; /policy's account rows are test/policy.test.js's.
//
// fetch is stood in for: Resend's URL answers whatever `resend` returns, and
// any other URL throws.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { requestAccount } from '../lib/accounts.js';
import { utcText } from '../lib/admin-page.js';
import { RESEND_URL } from '../lib/mail.js';
import {
  LINK_SECONDS, TOKEN_BYTES, clearExpiredLinks, dropLink, isToken, linkAccount, makeLink, passwordLink, replaceOthers, tokenHash,
} from '../lib/password-link.js';
import { STAND_IN_HASH, setPassword as storePassword } from '../lib/sign-in.js';
import {
  ACTIONS, LINK_DAYS, LOG_SHOWN, adminLog, approveTeams, linkEmail, peopleLists, readAccountId, readTeams, rejectTeams, sendLink,
} from '../lib/people.js';
import { readFileSync } from 'node:fs';
import { adminPeoplePage, peopleLocation, peopleNotice } from '../lib/people-page.js';
import { linkGonePage, setPasswordPage } from '../lib/password-page.js';
import { PRODUCTION_SITE } from '../lib/invite.js';
import { nowSeconds } from '../lib/session.js';
import { onRequestGet as peoplePage } from '../functions/admin/people.js';
import * as approveRoute from '../functions/api/admin/people/approve.js';
import * as rejectRoute from '../functions/api/admin/people/reject.js';
import * as linkRoute from '../functions/api/admin/people/link.js';
import * as setPassword from '../functions/set-password.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const ADMIN = 'owner@example.com';
const NOW = 1_790_000_000;

const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map((row) => ({ ...row }));
const count = (db, table) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

let resend; // (body) => the Response Resend answers
let sends; // every message that reached Resend's URL

beforeEach(() => {
  sends = [];
  resend = () => Response.json({ id: 'msg-221' });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url !== RESEND_URL) throw new Error(`fetched ${url}, not Resend's`);
    const body = JSON.parse(init.body);
    sends.push(body);
    return resend(body);
  });
});
afterEach(() => mock.restoreAll());

// One request for an account, through #220's own function, so the rows are
// the ones a real request writes. Answers the account's id.
let asked = 0;
async function ask(db, { name = 'Jane Rivers', email = 'jane@example.org', role = 'parent', teams = ['hoover-jrt', 'cohssa'], note = null, now = NOW } = {}) {
  asked += 1;
  const result = await requestAccount(db, { request: { name, email, role, teams, note }, address: `address-${asked}`, now });
  assert.deepEqual(result, { outcome: 'taken', created: true });
  return db.sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email).id;
}

const states = (db, id) => Object.fromEntries(rows(db, 'SELECT team, state FROM account_teams WHERE account_id = ?', id).map((r) => [r.team, r.state]));
const logOf = (db) => rows(db, 'SELECT at, admin, action, account_id, name, email, detail FROM admin_log ORDER BY id');
const env = (db, extra = {}) => ({ DB: db, RESEND_API_KEY: 'test-key', ...extra });

// A fixed byte source, so a token is known before it is made.
const bytes = (fill) => (array) => array.fill(fill);

// Use a link the one way #222 uses one: set a password with it
// (lib/sign-in.js's setPassword), which holds only for an account approved for
// a team, so the account's waiting teams are approved first. Answers the new
// session version, or null when the link could not be used. test/sign-in.test.js
// holds setPassword itself, its race included.
async function useLink(db, accountId, token, now) {
  db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = ? AND state = 'requested'").run(accountId);
  return storePassword(db, { accountId, token, passwordHash: STAND_IN_HASH, emailKey: 'email-key', now });
}

// ---- The link: lib/password-link.js ----------------------------------------

test('a link\'s token is 32 random bytes as 43 characters of base64url, and the row keeps only its SHA-256', async () => {
  const db = d1();
  const id = await ask(db);
  const { token, expiresAt } = await makeLink(db, id, NOW);
  assert.equal(TOKEN_BYTES, 32);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(expiresAt, NOW + LINK_SECONDS);
  assert.equal(LINK_SECONDS, 7 * 24 * 60 * 60); // the owner's 7 days, at #221's pickup
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64url');
  assert.deepEqual(rows(db, 'SELECT * FROM password_links'), [{ token_hash: expected, account_id: id, made_at: NOW, expires_at: NOW + LINK_SECONDS }]);
  assert.equal(await tokenHash(token), expected);
  // Two links never share a token.
  assert.notEqual((await makeLink(db, id, NOW)).token, token);
});

test('storing a new link deletes every expired one and leaves the account\'s earlier link alone: replacing it waits for the send', async () => {
  const db = d1();
  const jane = await ask(db);
  const sam = await ask(db, { name: 'Sam Lee', email: 'sam@example.org' });
  const old = await ask(db, { name: 'Old Link', email: 'old@example.org' });
  await makeLink(db, old, NOW - LINK_SECONDS - 10); // ran out 10 s ago
  const first = await makeLink(db, jane, NOW - 100);
  const sams = await makeLink(db, sam, NOW - 50);
  const second = await makeLink(db, jane, NOW);
  assert.deepEqual(await linkAccount(db, first.token, NOW), { accountId: jane, expiresAt: NOW - 100 + LINK_SECONDS });
  assert.deepEqual(await linkAccount(db, second.token, NOW), { accountId: jane, expiresAt: NOW + LINK_SECONDS });
  assert.deepEqual(await linkAccount(db, sams.token, NOW), { accountId: sam, expiresAt: NOW - 50 + LINK_SECONDS });
  // The expired row is gone from the table, not only refused.
  assert.deepEqual(rows(db, 'SELECT account_id FROM password_links ORDER BY account_id').map((r) => r.account_id), [jane, jane, sam]);
  // replaceOthers keeps one link of one account, and dropLink deletes one link.
  const [, keep] = await Promise.all([tokenHash(first.token), tokenHash(second.token)]);
  await db.batch([replaceOthers(db, jane, keep)]);
  assert.equal(await linkAccount(db, first.token, NOW), null);
  assert.equal((await linkAccount(db, second.token, NOW)).accountId, jane);
  assert.equal((await linkAccount(db, sams.token, NOW)).accountId, sam);
  await db.batch([dropLink(db, keep)]);
  assert.equal(await linkAccount(db, second.token, NOW), null);
  assert.equal((await linkAccount(db, sams.token, NOW)).accountId, sam);
});

test('a link opens until its 7 days are up, and not a second after', async () => {
  const db = d1();
  const id = await ask(db);
  const { token } = await makeLink(db, id, NOW);
  assert.deepEqual(await linkAccount(db, token, NOW + LINK_SECONDS - 1), { accountId: id, expiresAt: NOW + LINK_SECONDS });
  assert.equal(await linkAccount(db, token, NOW + LINK_SECONDS), null);
  assert.equal(await useLink(db, id, token, NOW + LINK_SECONDS), null);
  assert.equal(await useLink(db, id, token, NOW + LINK_SECONDS - 1), 2);
});

test('checking a link writes nothing, so opening it any number of times spends nothing', async () => {
  const db = d1();
  const id = await ask(db);
  const { token } = await makeLink(db, id, NOW);
  const before = db.statements.length;
  for (let i = 0; i < 3; i += 1) assert.equal((await linkAccount(db, token, NOW)).accountId, id);
  const asked = db.statements.slice(before);
  assert.equal(asked.length, 3);
  assert.ok(asked.every((sql) => /^SELECT /.test(sql)), asked.join('\n'));
  assert.equal(count(db, 'password_links'), 1);
});

// A link works once, and two uses at once change the account once: that is
// lib/sign-in.js's setPassword, the one way a link is used since #222, held in
// test/sign-in.test.js. #221 built spendLink for it, a delete of its own, and
// #222 retired it: it would have spent the link before the password was
// stored.

test('a token of the wrong shape is refused before the database is asked', async () => {
  const db = d1();
  const before = db.statements.length;
  for (const token of [null, undefined, 42, '', 'short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`, `${'A'.repeat(42)}/`]) {
    assert.equal(isToken(token), false, String(token));
    assert.equal(await linkAccount(db, token, NOW), null);
  }
  assert.equal(db.statements.length, before);
  assert.equal(isToken('A'.repeat(43)), true);
  assert.equal(isToken(`${'a'.repeat(41)}-_`), true);
});

test('clearing deletes the expired links and no other, and a failure is logged and left', async (t) => {
  const db = d1();
  const a = await ask(db);
  const b = await ask(db, { name: 'Sam Lee', email: 'sam@example.org' });
  await makeLink(db, a, NOW - LINK_SECONDS); // expires at NOW
  const live = await makeLink(db, b, NOW - LINK_SECONDS + 1); // expires at NOW + 1
  await clearExpiredLinks(db, NOW);
  assert.deepEqual(rows(db, 'SELECT account_id FROM password_links').map((r) => r.account_id), [b]);
  assert.equal((await linkAccount(db, live.token, NOW)).accountId, b);

  const errors = t.mock.method(console, 'error', () => {});
  const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1_ERROR'); } }) }) };
  await clearExpiredLinks(broken, NOW);
  assert.equal(errors.mock.callCount(), 1);
});

test('deleting an account deletes its links', async () => {
  const db = d1();
  const id = await ask(db);
  await makeLink(db, id, NOW);
  db.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  assert.equal(count(db, 'password_links'), 0);
});

// ---- Deciding: lib/people.js -----------------------------------------------

test('a form\'s account and teams are read strictly', () => {
  assert.equal(readAccountId('12'), 12);
  for (const value of [undefined, null, '', '0', '012', '-1', '1.5', '1e3', ' 1', '1 ', '1'.repeat(16)]) {
    assert.equal(readAccountId(value), null, String(value));
  }
  assert.deepEqual(readTeams(['cohssa', 'hoover-jrt']), ['hoover-jrt', 'cohssa']);
  assert.deepEqual(readTeams(['cohssa']), ['cohssa']);
  for (const value of [[], undefined, ['coach'], ['cohssa', 'x'], 'cohssa']) assert.equal(readTeams(value), null, String(value));
});

test('approving one team leaves the other waiting, and logs who, what, whom and when (D16; criteria 1 and 5)', async () => {
  const db = d1();
  const id = await ask(db);
  assert.deepEqual(await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW }), ['cohssa']);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'requested', cohssa: 'approved' });
  assert.deepEqual(logOf(db), [
    { at: NOW, admin: ADMIN, action: 'approve', account_id: id, name: 'Jane Rivers', email: 'jane@example.org', detail: 'COHSSA' },
  ]);
  // The role was unchanged, so nothing about it was logged.
  assert.equal(db.sqlite.prepare('SELECT role FROM accounts WHERE id = ?').get(id).role, 'parent');
});

test('approving both teams at once logs each, in the form\'s order, and a role change once', async () => {
  const db = d1();
  const id = await ask(db, { role: 'other' });
  assert.deepEqual(await approveTeams(db, { accountId: id, teams: ['hoover-jrt', 'cohssa'], role: 'coach', admin: ADMIN, now: NOW }), ['hoover-jrt', 'cohssa']);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'approved', cohssa: 'approved' });
  assert.equal(db.sqlite.prepare('SELECT role FROM accounts WHERE id = ?').get(id).role, 'coach');
  assert.deepEqual(logOf(db).map(({ action, detail }) => [action, detail]), [
    ['role', 'other to coach'],
    ['approve', 'Hoover JRT'],
    ['approve', 'COHSSA'],
  ]);
});

test('a second press, or a team that is not waiting, changes nothing and logs nothing', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['hoover-jrt'] });
  await approveTeams(db, { accountId: id, teams: ['hoover-jrt'], role: 'parent', admin: ADMIN, now: NOW });
  const logged = logOf(db).length;
  // Approved already; asked for COHSSA never; an account that is not there.
  assert.equal(await approveTeams(db, { accountId: id, teams: ['hoover-jrt'], role: 'coach', admin: ADMIN, now: NOW + 1 }), null);
  assert.equal(await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'coach', admin: ADMIN, now: NOW + 1 }), null);
  assert.equal(await approveTeams(db, { accountId: id + 50, teams: ['hoover-jrt'], role: 'coach', admin: ADMIN, now: NOW + 1 }), null);
  assert.equal(await rejectTeams(db, { accountId: id, teams: ['hoover-jrt'], admin: ADMIN, now: NOW + 1 }), null);
  assert.equal(logOf(db).length, logged);
  // The role a refused press named was not taken either.
  assert.equal(db.sqlite.prepare('SELECT role FROM accounts WHERE id = ?').get(id).role, 'parent');
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'approved' });
});

test('turning down takes waiting teams only, logs each, and sends nothing (criterion 3)', async () => {
  const db = d1();
  const id = await ask(db);
  assert.deepEqual(await rejectTeams(db, { accountId: id, teams: ['hoover-jrt'], admin: ADMIN, now: NOW }), ['hoover-jrt']);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'rejected', cohssa: 'requested' });
  assert.deepEqual(logOf(db), [
    { at: NOW, admin: ADMIN, action: 'reject', account_id: id, name: 'Jane Rivers', email: 'jane@example.org', detail: 'Hoover JRT' },
  ]);
  assert.equal(sends.length, 0);
});

test('a turned-down team can still be approved, so a mistake can be undone (owner, at #221\'s pickup)', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await rejectTeams(db, { accountId: id, teams: ['cohssa'], admin: ADMIN, now: NOW });
  assert.deepEqual(await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW + 60 }), ['cohssa']);
  assert.deepEqual(states(db, id), { cohssa: 'approved' });
  assert.deepEqual(logOf(db).map((e) => e.action), ['reject', 'approve']);
});

test('a turned-down address that asks again still writes nothing (#220\'s criterion 4, kept at #221\'s pickup)', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await rejectTeams(db, { accountId: id, teams: ['cohssa'], admin: ADMIN, now: NOW });
  const result = await requestAccount(db, {
    request: { name: 'Jane Again', email: 'JANE@example.org', role: 'coach', teams: ['hoover-jrt', 'cohssa'], note: 'please' }, address: 'address-x', now: NOW + 7200,
  });
  assert.deepEqual(result, { outcome: 'taken', created: false });
  assert.deepEqual(states(db, id), { cohssa: 'rejected' });
  assert.deepEqual(rows(db, 'SELECT name, role, note FROM accounts'), [{ name: 'Jane Rivers', role: 'parent', note: null }]);
});

test('a decision is all or nothing: when its last statement fails, the log entries and the role roll back with it', async () => {
  const db = d1();
  const id = await ask(db, { role: 'parent' });
  db.sqlite.exec("CREATE TRIGGER fail_team AFTER UPDATE ON account_teams BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  await assert.rejects(approveTeams(db, { accountId: id, teams: ['hoover-jrt'], role: 'coach', admin: ADMIN, now: NOW }), /D1_ERROR/);
  await assert.rejects(rejectTeams(db, { accountId: id, teams: ['hoover-jrt'], admin: ADMIN, now: NOW }), /D1_ERROR/);
  assert.equal(count(db, 'admin_log'), 0);
  assert.equal(db.sqlite.prepare('SELECT role FROM accounts WHERE id = ?').get(id).role, 'parent');
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'requested', cohssa: 'requested' });
});

test('approving refuses a role that is not one', async () => {
  const db = d1();
  const id = await ask(db);
  await assert.rejects(approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'admin', admin: ADMIN, now: NOW }), /not a role/);
  assert.equal(count(db, 'admin_log'), 0);
});

test('the lists sort each account by where its teams stand, oldest request first, teams in the form\'s order', async () => {
  const db = d1();
  const waiting = await ask(db, { name: 'A Waiting', email: 'a@example.org', now: NOW });
  const mixed = await ask(db, { name: 'B Mixed', email: 'b@example.org', now: NOW + 1 });
  const approved = await ask(db, { name: 'C Approved', email: 'c@example.org', now: NOW + 2 });
  const down = await ask(db, { name: 'D Down', email: 'd@example.org', teams: ['cohssa'], now: NOW + 3 });
  const early = await ask(db, { name: 'E Early', email: 'e@example.org', now: NOW - 10 });
  await approveTeams(db, { accountId: mixed, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  await approveTeams(db, { accountId: approved, teams: ['hoover-jrt'], role: 'parent', admin: ADMIN, now: NOW });
  await rejectTeams(db, { accountId: approved, teams: ['cohssa'], admin: ADMIN, now: NOW });
  await rejectTeams(db, { accountId: down, teams: ['cohssa'], admin: ADMIN, now: NOW });
  const lists = await peopleLists(db);
  assert.deepEqual(lists.waiting.map((p) => p.id), [early, waiting, mixed]);
  assert.deepEqual(lists.approved.map((p) => p.id), [approved]);
  assert.deepEqual(lists.turnedDown.map((p) => p.id), [down]);
  assert.deepEqual(lists.waiting[2], {
    id: mixed, name: 'B Mixed', email: 'b@example.org', role: 'parent', note: null, requestedAt: NOW + 1,
    teams: [{ team: 'hoover-jrt', name: 'Hoover JRT', state: 'requested' }, { team: 'cohssa', name: 'COHSSA', state: 'approved' }],
  });
});

// ---- The link's email: sendLink --------------------------------------------

test('a link goes to the account\'s own address, names its approved teams and when it runs out, and opens the account (criterion 2)', async () => {
  const db = d1();
  const id = await ask(db, { email: 'Jane.Rivers@Example.org' });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'sent');
  assert.equal(sends.length, 1);
  const [mail] = sends;
  assert.deepEqual(mail.to, ['Jane.Rivers@Example.org']);
  assert.equal(mail.subject, 'Your account on the Mad Cow Sailing photo site is approved');
  assert.match(mail.text, /is approved, for COHSSA\./);
  // Written out, not computed: NOW is 21 September 2026, 14:13:20 UTC.
  assert.ok(mail.text.includes('It can be used once, until 28 September 2026, 14:13 UTC:'), mail.text);
  const link = mail.text.match(/https:\/\/\S+/)[0];
  assert.match(link, /^https:\/\/photos\.madcowsailing\.com\/set-password\?token=[A-Za-z0-9_-]{43}$/);
  const token = new URL(link).searchParams.get('token');
  assert.deepEqual(await linkAccount(db, token, NOW), { accountId: id, expiresAt: NOW + LINK_SECONDS });
  assert.deepEqual(logOf(db).at(-1), { at: NOW, admin: ADMIN, action: 'link', account_id: id, name: 'Jane Rivers', email: 'Jane.Rivers@Example.org', detail: 'sent' });
});

test('the email names nobody: a planted name and note reach no part of what is sent (#221\'s review)', async () => {
  // Through sendLink, which holds the account's name, so a change that put it
  // (or the note) into the email would show here. linkEmail alone is never
  // handed either.
  const db = d1();
  const planted = { name: 'Planted Name 4d2a', note: 'planted note 4d2a' };
  const id = await ask(db, { ...planted, teams: ['hoover-jrt', 'cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['hoover-jrt', 'cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'sent');
  const sent = JSON.stringify(sends[0]);
  const found = (text) => Object.values(planted).filter((value) => text.includes(value));
  assert.deepEqual(found(sent), []);
  // The control: an email that did carry one is caught.
  assert.deepEqual(found(`${sent} ${planted.note}`), [planted.note]);
  assert.match(sends[0].text, /for Hoover JRT and COHSSA\./);
  assert.match(sends[0].text, /reply to this email/);
  const { text } = linkEmail({ link: `${SITE}/set-password?token=${'A'.repeat(43)}`, teams: ['cohssa'], expiresAt: NOW });
  assert.match(text, /for COHSSA\./);
});

test('a new link replaces the last once its email is sent, so only the newest email\'s link opens', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE });
  await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW + 60, site: SITE });
  const [first, second] = sends.map((m) => new URL(m.text.match(/https:\/\/\S+/)[0]).searchParams.get('token'));
  assert.equal(await linkAccount(db, first, NOW + 60), null);
  assert.equal((await linkAccount(db, second, NOW + 60)).accountId, id);
});

test('only an account approved for a team gets a link: waiting or turned down, nothing is made, sent or logged', async () => {
  const db = d1();
  const waiting = await ask(db);
  const down = await ask(db, { name: 'Sam Lee', email: 'sam@example.org', teams: ['cohssa'] });
  await rejectTeams(db, { accountId: down, teams: ['cohssa'], admin: ADMIN, now: NOW });
  const logged = count(db, 'admin_log');
  for (const accountId of [waiting, down, down + 50]) {
    assert.equal(await sendLink(env(db), { accountId, admin: ADMIN, now: NOW, site: SITE }), null);
  }
  assert.equal(sends.length, 0);
  assert.equal(count(db, 'password_links'), 0);
  assert.equal(count(db, 'admin_log'), logged);
});

test('an email that does not go is answered by its reason and logged as not sent; one Resend did not confirm, as unconfirmed', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  resend = () => Response.json({ name: 'daily_quota_exceeded' }, { status: 429 });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'quota');
  resend = () => new Response('', { status: 503 });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'unreachable');
  assert.equal(await sendLink({ DB: db }, { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'not-configured');
  assert.deepEqual(logOf(db).filter((e) => e.action === 'link').map((e) => e.detail), ['not sent: quota', 'unconfirmed', 'not sent: not-configured']);
});

// The token in the one email sent so far, the n-th.
const tokenOf = (n) => new URL(sends[n].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');

test('a refused send deletes the new link and leaves the person\'s earlier one working; an unconfirmed one keeps both (#221\'s review)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['hoover-jrt', 'cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['hoover-jrt'], role: 'parent', admin: ADMIN, now: NOW });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'sent');
  const delivered = tokenOf(0);
  // A second team approved after the day's quota ran out: the email is
  // refused, so the link it carried must open nothing and the delivered one
  // must still open.
  resend = (body) => (sends.length === 2 ? Response.json({ name: 'daily_quota_exceeded' }, { status: 429 }) : Response.json({ id: 'x' }));
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW + 60 });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW + 60, site: SITE }), 'quota');
  assert.equal((await linkAccount(db, delivered, NOW + 60)).accountId, id, 'a refused send revoked the link the person holds');
  assert.equal(await linkAccount(db, tokenOf(1), NOW + 60), null, 'the refused email\'s link opens');
  for (const reason of ['rate', 'refused']) {
    resend = () => (reason === 'rate' ? Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }) : Response.json({ name: 'validation_error' }, { status: 422 }));
    assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW + 60, site: SITE }), reason);
    assert.equal((await linkAccount(db, delivered, NOW + 60)).accountId, id, `${reason} revoked the delivered link`);
  }
  // No key: nothing can be sent, and the delivered link stays.
  assert.equal(await sendLink({ DB: db }, { accountId: id, admin: ADMIN, now: NOW + 60, site: SITE }), 'not-configured');
  assert.equal((await linkAccount(db, delivered, NOW + 60)).accountId, id);
  // Unconfirmed: the new email may have gone, so both open.
  const before = sends.length;
  resend = () => new Response('', { status: 503 });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW + 60, site: SITE }), 'unreachable');
  assert.equal((await linkAccount(db, delivered, NOW + 60)).accountId, id);
  assert.equal((await linkAccount(db, tokenOf(before), NOW + 60)).accountId, id);
  // Only the one delivered link and the unconfirmed one remain stored.
  assert.equal(count(db, 'password_links'), 2);
});

test('a link that cannot be stored answers unsaved, sends nothing, logs nothing, and leaves the earlier link working', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE });
  const logged = count(db, 'admin_log');
  db.sqlite.exec("CREATE TRIGGER fail_link BEFORE INSERT ON password_links BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW + 60, site: SITE }), 'unsaved');
  assert.equal(sends.length, 1);
  assert.equal(count(db, 'admin_log'), logged, 'an entry outlived the link it was committed with');
  assert.equal((await linkAccount(db, tokenOf(0), NOW + 60)).accountId, id);
});

test('a link\'s log entry commits with it: when the entry cannot be written, no link is stored and nothing is sent (#221\'s review, the owner\'s choice)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  db.sqlite.exec("CREATE TRIGGER fail_log BEFORE INSERT ON admin_log BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'unsaved');
  assert.equal(sends.length, 0);
  assert.equal(count(db, 'password_links'), 0, 'a link was stored with no log entry naming who issued it');
});

test('an outcome that cannot be written after the send answers sent, and the entry stays, saying it was not recorded', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  db.sqlite.exec("CREATE TRIGGER fail_settle BEFORE UPDATE ON admin_log BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'sent');
  assert.equal(sends.length, 1);
  assert.equal(errors.mock.callCount(), 1);
  assert.deepEqual(logOf(db).at(-1), { at: NOW, admin: ADMIN, action: 'link', account_id: id, name: 'Jane Rivers', email: 'jane@example.org', detail: 'unrecorded' });
  assert.equal((await linkAccount(db, tokenOf(0), NOW)).accountId, id);
});

test('a lookup that fails answers unsaved and never throws (#221\'s review)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  assert.equal(await sendLink(env(failOn(db, /^SELECT a\.id, a\.name, a\.email, t\.team FROM accounts/)), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'unsaved');
  assert.equal(sends.length, 0);
  assert.equal(count(db, 'password_links'), 0);
});

// A D1 whose statements matching `pattern` throw, and every other one runs as
// usual: test/removals.test.js's way to fail one step of several.
function failOn(db, pattern) {
  const broken = (statement) => ({
    bind: (...values) => broken(statement.bind(...values)),
    first: async () => { throw new Error('D1_ERROR'); },
    all: async () => { throw new Error('D1_ERROR'); },
    run: async () => { throw new Error('D1_ERROR'); },
  });
  return { ...db, prepare: (sql) => (pattern.test(sql) ? broken(db.prepare(sql)) : db.prepare(sql)) };
}

test('nothing here logs a name, an address, a note or a token', async (t) => {
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, level, (...args) => lines.push(args.map(String).join(' ')));
  }
  const planted = { name: 'Planted Name 8c1f', email: 'planted-8c1f@example.org', note: 'planted note 8c1f' };
  const db = d1();
  const id = await ask(db, { ...planted, teams: ['hoover-jrt', 'cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['hoover-jrt'], role: 'coach', admin: ADMIN, now: NOW });
  await rejectTeams(db, { accountId: id, teams: ['cohssa'], admin: ADMIN, now: NOW });
  resend = () => Response.json({ name: 'validation_error', message: `cannot send to ${planted.email}` }, { status: 422 });
  assert.equal(await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE }), 'refused');
  const token = new URL(sends[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  db.sqlite.exec("CREATE TRIGGER fail_log BEFORE INSERT ON admin_log BEGIN SELECT RAISE(ABORT, 'D1_ERROR'); END");
  await sendLink(env(db), { accountId: id, admin: ADMIN, now: NOW, site: SITE });
  assert.ok(lines.length >= 3, 'the failures above logged nothing, so this reading proves nothing');
  const secrets = [...Object.values(planted), token, ADMIN];
  const leaks = (text) => secrets.filter((value) => text.includes(value));
  assert.deepEqual(lines.flatMap(leaks), []);
  // The control: a line that does carry one is caught.
  assert.deepEqual(leaks(`mail: refused ${planted.email}`), [planted.email]);
});

// ---- The log ---------------------------------------------------------------

test('the page shows the newest LOG_SHOWN entries, newest first, and how many there are in all', async () => {
  const db = d1();
  const insert = db.sqlite.prepare("INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) VALUES (?, ?, 'approve', 1, 'Jane', 'j@example.org', 'COHSSA')");
  for (let i = 0; i < LOG_SHOWN + 5; i += 1) insert.run(NOW + i, ADMIN);
  const { entries, total } = await adminLog(db);
  assert.equal(total, LOG_SHOWN + 5);
  assert.equal(entries.length, LOG_SHOWN);
  assert.equal(entries[0].at, NOW + LOG_SHOWN + 4);
  assert.equal(entries.at(-1).at, NOW + 5);
  assert.equal(entries[0].accountId, 1);
  const html = adminPeoplePage({ lists: { waiting: [], approved: [], turnedDown: [] }, log: { entries, total } });
  assert.match(html, new RegExp(`The newest ${LOG_SHOWN} of ${LOG_SHOWN + 5} are shown\\.`));
  assert.equal([...html.matchAll(/<li><time /g)].length, LOG_SHOWN);
});

test('every action this story logs has its own sentence on the page', () => {
  assert.deepEqual(ACTIONS, ['approve', 'reject', 'role', 'link']);
  const entry = (action, detail) => ({ id: 1, at: NOW, admin: ADMIN, action, accountId: 1, name: 'Jane Rivers', email: 'jane@example.org', detail });
  const page = (entries) => adminPeoplePage({ lists: { waiting: [], approved: [], turnedDown: [] }, log: { entries, total: entries.length } });
  const sentence = (action, detail) => page([entry(action, detail)]).match(/<li><time [^>]+>[^<]+<\/time>: ([^<]*)<\/li>/)[1];
  assert.equal(sentence('approve', 'COHSSA'), 'owner@example.com approved Jane Rivers (jane@example.org) for COHSSA.');
  assert.equal(sentence('reject', 'Hoover JRT'), 'owner@example.com turned down Jane Rivers (jane@example.org) for Hoover JRT.');
  assert.equal(sentence('role', 'parent to coach'), 'owner@example.com changed the role of Jane Rivers (jane@example.org) from parent to coach.');
  assert.equal(sentence('link', 'sent'), 'owner@example.com emailed Jane Rivers (jane@example.org) a link to set a password.');
  assert.equal(sentence('link', 'unconfirmed'), 'owner@example.com emailed Jane Rivers (jane@example.org) a link to set a password, which Resend did not confirm.');
  assert.equal(sentence('link', 'not sent: quota'), 'owner@example.com pressed to email Jane Rivers (jane@example.org) a link to set a password, which was not sent (quota).');
  assert.equal(sentence('link', 'unrecorded'), 'owner@example.com made Jane Rivers (jane@example.org) a link to set a password; how its email went was not recorded.');
  // A later story's action is still shown, by its word.
  assert.equal(sentence('promote', null), 'owner@example.com: promote Jane Rivers (jane@example.org).');
});

test('the log\'s table takes a later story\'s action without a migration, and refuses one of the wrong shape', () => {
  const db = d1();
  const insert = (action) => db.sqlite.prepare("INSERT INTO admin_log (at, admin, action, account_id, name, email) VALUES (1, 'a@b.co', ?, 1, 'J', 'j@b.co')").run(action);
  for (const action of [...ACTIONS, 'promote', 'demote', 'revoke', 'hide', 'delete', 'hide-all']) insert(action);
  for (const action of ['', 'Approve', 'approve ', 'a'.repeat(21), 'drop;']) assert.throws(() => insert(action), /CHECK/, action);
});

// ---- The page, /admin/people -------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());
const validate = (html) => validator.validateString(html, join(ROOT, 'people.html'));
const problems = (report) => report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));

async function seeded() {
  const db = d1();
  const waiting = await ask(db, { name: 'Ava <b>Waits</b>', email: 'ava@example.org', note: 'Line one\nLine <two> & "three"' });
  const mixed = await ask(db, { name: 'Ben Mixed', email: 'ben@example.org', role: 'coach' });
  const approved = await ask(db, { name: 'Cal Approved', email: 'cal@example.org', teams: ['cohssa'] });
  const down = await ask(db, { name: 'Dee Down', email: 'dee@example.org', teams: ['hoover-jrt'] });
  await approveTeams(db, { accountId: mixed, teams: ['hoover-jrt'], role: 'coach', admin: ADMIN, now: NOW });
  await approveTeams(db, { accountId: approved, teams: ['cohssa'], role: 'other', admin: ADMIN, now: NOW });
  await sendLink(env(db), { accountId: approved, admin: ADMIN, now: NOW, site: SITE });
  await rejectTeams(db, { accountId: down, teams: ['hoover-jrt'], admin: ADMIN, now: NOW });
  return { db, ids: { waiting, mixed, approved, down } };
}

const render = async (db, query = '') => {
  const lists = await peopleLists(db);
  return adminPeoplePage({ lists, log: await adminLog(db), notice: peopleNotice(new URLSearchParams(query), lists) });
};
const item = (html, id) => html.match(new RegExp(`<li class="person" id="person-${id}">[\\s\\S]*?\\n    </li>`))?.[0];
const section = (html, id) => html.match(new RegExp(`<section class="wrap" aria-labelledby="${id}">[\\s\\S]*?</section>`))?.[0];

test('each request shows name, email, role, every team and where it stands, the note and when it arrived (criterion 1)', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const ava = item(html, ids.waiting);
  assert.ok(ava, 'no item for the waiting request');
  assert.match(ava, /<h3>Ava &lt;b&gt;Waits&lt;\/b&gt;<\/h3>/);
  assert.match(ava, /<p class="person-facts">ava@example\.org · Parent · asked <time datetime="[^"]+">[^<]+ UTC<\/time><\/p>/);
  assert.match(ava, /<p class="person-teams">Hoover JRT: waiting · COHSSA: waiting<\/p>/);
  assert.match(ava, /<p class="person-note">Line one\nLine &lt;two&gt; &amp; &quot;three&quot;<\/p>/);
  assert.doesNotMatch(html, /<b>Waits/);
  assert.match(item(html, ids.down), /No note was left\./);
});

test('a waiting request has a box per team, ticked, the requester\'s role chosen, Approve and Turn down', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const ava = item(html, ids.waiting);
  assert.match(ava, /<form method="post" action="\/api\/admin\/people\/approve"/);
  assert.match(ava, /<input type="hidden" name="account" value="\d+">/);
  assert.deepEqual([...ava.matchAll(/<input type="checkbox" name="team" value="([^"]+)" checked>/g)].map((m) => m[1]), ['hoover-jrt', 'cohssa']);
  assert.match(ava, new RegExp(`<label for="person-${ids.waiting}-role">Role</label>\\s*<select id="person-${ids.waiting}-role" name="role">`));
  assert.deepEqual([...ava.matchAll(/<option value="([^"]+)"( selected)?>/g)].map((m) => `${m[1]}${m[2] ? '*' : ''}`), ['parent*', 'coach', 'other']);
  assert.match(ava, /formaction="\/api\/admin\/people\/reject" aria-label="Turn down Ava &lt;b&gt;Waits&lt;\/b&gt;">Turn down<\/button>/);
  // A request with one team approved still waits on the other, and offers
  // only that one, with its own role.
  const ben = item(html, ids.mixed);
  assert.match(section(html, 'people-waiting'), new RegExp(`id="person-${ids.mixed}"`));
  assert.match(ben, /Hoover JRT: approved · COHSSA: waiting/);
  assert.deepEqual([...ben.matchAll(/name="team" value="([^"]+)"/g)].map((m) => m[1]), ['cohssa']);
  assert.match(ben, /<option value="coach" selected>/);
  assert.match(ben, /Send a new link/);
});

test('an approved person shows with their teams and role, and "Send a new link" is one press (criterion 4)', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const approved = section(html, 'people-approved');
  const cal = item(html, ids.approved);
  assert.match(approved, new RegExp(`id="person-${ids.approved}"`));
  assert.match(cal, /cal@example\.org · Other ·/);
  assert.match(cal, /<p class="person-teams">COHSSA: approved<\/p>/);
  assert.match(cal, new RegExp(`<form method="post" action="/api/admin/people/link">\\s*<button type="submit" class="button button-quiet" name="account" value="${ids.approved}" aria-label="Send a new link to Cal Approved">Send a new link</button>\\s*</form>`));
  assert.doesNotMatch(cal, /people\/approve/);
});

test('a turned-down person offers Approve alone, its box unticked, and no link', async () => {
  const { db, ids } = await seeded();
  const html = await render(db);
  const dee = item(html, ids.down);
  assert.match(section(html, 'people-turned-down'), new RegExp(`id="person-${ids.down}"`));
  assert.match(dee, /<legend>Teams turned down<\/legend>/);
  assert.match(dee, /<input type="checkbox" name="team" value="hoover-jrt"> Hoover JRT/);
  assert.match(dee, /aria-label="Approve Dee Down">Approve<\/button>/);
  assert.doesNotMatch(dee, /Turn down|Send a new link/);
});

test('the page holds the admins\' log, newest first, naming who, what, whom and when (criterion 5)', async () => {
  const { db } = await seeded();
  const log = section(await render(db), 'admin-log');
  const entries = [...log.matchAll(/<li>(<time [^>]+>[^<]+<\/time>): ([^<]*)<\/li>/g)].map((m) => m[2]);
  assert.deepEqual(entries, [
    'owner@example.com turned down Dee Down (dee@example.org) for Hoover JRT.',
    'owner@example.com emailed Cal Approved (cal@example.org) a link to set a password.',
    'owner@example.com approved Cal Approved (cal@example.org) for COHSSA.',
    'owner@example.com changed the role of Cal Approved (cal@example.org) from parent to other.',
    'owner@example.com approved Ben Mixed (ben@example.org) for Hoover JRT.',
  ]);
});

test('the empty page says so in each list, and the log that nothing is logged yet', () => {
  const html = adminPeoplePage({ lists: { waiting: [], approved: [], turnedDown: [] }, log: { entries: [], total: 0 } });
  assert.match(html, /No request is waiting\./);
  assert.match(html, /Nobody is approved yet\./);
  assert.match(html, /Nobody is turned down\./);
  assert.match(html, /Nothing is logged yet\./);
  assert.doesNotMatch(html, /<ul class="admin-log">/);
});

test('the rendered page is valid under the photo site\'s html-validate config, and a planted second h1 is not', async () => {
  const { db } = await seeded();
  for (const query of ['', 'done=approved&account=1&mail=sent', 'error=gone']) {
    const html = await render(db, query);
    assert.deepEqual(problems(await validate(html)), [], query);
    assert.equal((await validate(html.replace('<h2 ', '<h1>again</h1><h2 '))).valid, false);
  }
  const empty = adminPeoplePage({ lists: { waiting: [], approved: [], turnedDown: [] }, log: { entries: [], total: 0 } });
  assert.deepEqual(problems(await validate(empty)), []);
});

test('each label, box and select carries its own account\'s id, so no two forms share one', async () => {
  const { db } = await seeded();
  const html = await render(db);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'an id repeats');
});

// The rules in a stylesheet whose selector list names `selector`, as their
// bodies. A plain split is enough for site.css, which holds no nested rules.
const rulesFor = (css, selector) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
  .map((block) => block.split('{'))
  .filter(([selectors, body]) => body !== undefined && selectors.split(',').map((s) => s.trim()).includes(selector))
  .map(([, body]) => body);

test('a name with no spaces wraps rather than widening the page past 320 px (#221\'s ux-design audit, 1.4.10)', () => {
  // A 40-character run in a request's name made /admin/people 590 px wide at
  // 320 until the heading was given overflow-wrap; measured in Chrome both
  // ways on #221.
  const css = readFileSync(join(ROOT, 'public', 'css', 'site.css'), 'utf8');
  const wraps = (text) => rulesFor(text, '.person h3').some((body) => /overflow-wrap:\s*anywhere/.test(body));
  assert.ok(wraps(css), 'no rule gives .person h3 overflow-wrap: anywhere');
  // The control: the same stylesheet with the heading taken out of the rule.
  assert.equal(wraps(css.replace('.person h3,\n', '')), false);
});

test('a team key is escaped in its box\'s value, like everything else on the page (#221\'s security audit)', () => {
  const person = {
    id: 7, name: 'Jane', email: 'j@example.org', role: 'parent', note: null, requestedAt: NOW,
    teams: [{ team: 'x"><b>y', name: 'X', state: 'requested' }],
  };
  const html = adminPeoplePage({ lists: { waiting: [person], approved: [], turnedDown: [] }, log: { entries: [], total: 0 } });
  assert.match(html, /value="x&quot;&gt;&lt;b&gt;y" checked>/);
  assert.doesNotMatch(html, /<b>y/);
});

test('the notice names the person from the lists, never from the address bar', async () => {
  const { db, ids } = await seeded();
  const lists = await peopleLists(db);
  const notice = (query) => peopleNotice(new URLSearchParams(query), lists);
  assert.match(notice(`done=approved&account=${ids.approved}&mail=sent`), /Approved Cal Approved\. The email with a link to set a password was sent\. The link works for 7 days, and any earlier link no longer does\./);
  assert.match(notice(`done=approved&account=${ids.approved}&mail=quota`), /Approved Cal Approved\. The email with the link was not sent: Resend's free limit/);
  assert.match(notice(`done=approved&account=${ids.approved}&mail=unreachable`), /Resend did not confirm the email.*any earlier link still works too\./);
  assert.match(notice(`done=approved&account=${ids.approved}&mail=refused`), /Resend refused it/);
  // A refused send leaves the earlier link working (#221's review), and every
  // refusal says so.
  for (const mail of ['quota', 'rate', 'not-configured', 'refused', 'unsaved']) {
    assert.match(notice(`done=approved&account=${ids.approved}&mail=${mail}`), /Any link they had before still works\./, mail);
  }
  assert.match(notice(`done=rejected&account=${ids.down}`), /Turned down Dee Down\. Nothing was emailed to them\./);
  assert.match(notice(`done=link&account=${ids.approved}&mail=sent`), /^\n {4}<p role="status">Cal Approved: The email with a link/);
  assert.match(notice(`done=approved&account=${ids.waiting}&mail=sent`), /Approved Ava &lt;b&gt;Waits&lt;\/b&gt;\./);
  // A crafted name or an unknown account shows no text from the query.
  assert.match(notice('done=approved&account=9999&mail=sent'), /Approved The account\./);
  assert.doesNotMatch(notice('done=approved&account=<script>&mail=<b>x</b>'), /<script>|<b>x/);
  assert.equal(notice('done=nothing'), '');
  assert.equal(notice('error=nothing'), '');
  for (const error of ['form', 'gone', 'not-approved', 'unchanged']) assert.match(notice(`error=${error}`), /<p role="status">/);
  assert.equal(LINK_DAYS, 7);
});

test('a press answers to the page with what happened, and nothing else', () => {
  assert.equal(peopleLocation(), '/admin/people');
  assert.equal(peopleLocation({ done: 'approved', account: 12, mail: 'sent' }), '/admin/people?done=approved&account=12&mail=sent');
  assert.equal(peopleLocation({ error: 'form' }), '/admin/people?error=form');
});

// ---- The routes --------------------------------------------------------------

const post = (path, fields, { type = 'application/x-www-form-urlencoded', origin = SITE } = {}) => {
  const body = new URLSearchParams();
  for (const [name, value] of fields) body.append(name, value);
  return new Request(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': type, Origin: origin }, body: body.toString() });
};
const context = (request, db, extra = {}) => ({ request, env: env(db, extra), data: { owner: { email: ADMIN } } });
const location = (res) => res.headers.get('Location');

test('GET /admin/people renders the lists, keeps no copy, and deletes expired links on the way', async () => {
  const { db, ids } = await seeded();
  // The route reads the real clock, so Cal's link is made on it; seeded()'s,
  // made at NOW, has long run out.
  await makeLink(db, ids.approved, nowSeconds());
  const old = await ask(db, { name: 'Old Link', email: 'old@example.org', teams: ['cohssa'] });
  db.sqlite.prepare('INSERT INTO password_links (token_hash, account_id, made_at, expires_at) VALUES (?, ?, ?, ?)')
    .run('x'.repeat(43), old, 1, 2);
  const res = await peoplePage({ request: new Request(`${SITE}/admin/people?done=approved&account=${ids.approved}&mail=sent`), env: env(db) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const html = await res.text();
  assert.match(html, /<h1>People<\/h1>/);
  assert.match(html, /<p role="status">Approved Cal Approved\./);
  // The expired row went, and Cal's live link stayed.
  assert.deepEqual(rows(db, 'SELECT account_id FROM password_links').map((r) => r.account_id), [ids.approved]);
});

test('Approve approves the ticked teams with the chosen role, emails the link, and answers 303 back saying so (criteria 1 and 2)', async () => {
  const db = d1();
  const id = await ask(db, { email: 'jane@example.org' });
  const res = await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'cohssa'], ['role', 'coach']]), db));
  assert.equal(res.status, 303);
  assert.equal(location(res), `/admin/people?done=approved&account=${id}&mail=sent`);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'requested', cohssa: 'approved' });
  assert.equal(db.sqlite.prepare('SELECT role FROM accounts WHERE id = ?').get(id).role, 'coach');
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].to, ['jane@example.org']);
  assert.deepEqual(logOf(db).map((e) => [e.admin, e.action, e.detail]), [[ADMIN, 'role', 'parent to coach'], [ADMIN, 'approve', 'COHSSA'], [ADMIN, 'link', 'sent']]);
});

test('the link names production\'s domain on production, and the page\'s own origin anywhere else', async () => {
  const db = d1();
  const a = await ask(db, { email: 'a@example.org', teams: ['cohssa'] });
  const b = await ask(db, { email: 'b@example.org', teams: ['cohssa'] });
  const preview = 'https://develop.madcowphotos.pages.dev';
  await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(a)], ['team', 'cohssa'], ['role', 'parent']], { origin: preview }), db, { SITE_ENV: 'production' }));
  await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(b)], ['team', 'cohssa'], ['role', 'parent']], { origin: preview }), db, { SITE_ENV: 'preview' }));
  const links = sends.map((m) => m.text.match(/https:\/\/\S+/)[0]);
  assert.ok(links[0].startsWith(`${PRODUCTION_SITE}/set-password?token=`), links[0]);
  assert.ok(links[1].startsWith(`${preview}/set-password?token=`), links[1]);
});

test('an approval whose email does not go still answers the approval, with the reason beside it', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  resend = () => Response.json({ name: 'daily_quota_exceeded' }, { status: 429 });
  const res = await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'cohssa'], ['role', 'parent']]), db));
  assert.equal(location(res), `/admin/people?done=approved&account=${id}&mail=quota`);
  assert.deepEqual(states(db, id), { cohssa: 'approved' });
});

test('an approval whose link could not even be looked up still answers the approval, never a 500 (#221\'s review)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  const failing = failOn(db, /^SELECT a\.id, a\.name, a\.email, t\.team FROM accounts/);
  const res = await approveRoute.onRequestPost({ ...context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'cohssa'], ['role', 'parent']]), db), env: env(failing) });
  assert.equal(res.status, 303);
  assert.equal(location(res), `/admin/people?done=approved&account=${id}&mail=unsaved`);
  assert.deepEqual(states(db, id), { cohssa: 'approved' });
  assert.equal(sends.length, 0);
});

test('an approval whose account held no approved team by the time of the link says so, not that Resend refused it (#221\'s review)', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  // As if the account were deleted by hand between the approval and the link.
  const emptied = { ...db, prepare: (sql) => (/^SELECT a\.id, a\.name, a\.email, t\.team FROM accounts/.test(sql)
    ? { bind: () => ({ all: async () => ({ success: true, results: [] }) }) }
    : db.prepare(sql)) };
  const res = await approveRoute.onRequestPost({ ...context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'cohssa'], ['role', 'parent']]), db), env: env(emptied) });
  assert.equal(location(res), `/admin/people?done=approved&account=${id}&mail=not-approved`);
  assert.match(peopleNotice(new URLSearchParams(`done=approved&account=${id}&mail=not-approved`), await peopleLists(db)), /No email was sent: by the time the link was made, the account held no approved team\./);
  assert.equal(sends.length, 0);
});

test('Approve refuses a press with no account, no team, a team that is not one or no role, and changes nothing', async () => {
  const db = d1();
  const id = await ask(db);
  const forms = [
    [['team', 'cohssa'], ['role', 'parent']],
    [['account', String(id)], ['role', 'parent']],
    [['account', String(id)], ['team', 'sailors'], ['role', 'parent']],
    [['account', String(id)], ['team', 'cohssa']],
    [['account', String(id)], ['team', 'cohssa'], ['role', 'admin']],
  ];
  for (const fields of forms) {
    const res = await approveRoute.onRequestPost(context(post('/api/admin/people/approve', fields), db));
    assert.equal(location(res), '/admin/people?error=form', JSON.stringify(fields));
  }
  // A body of another type reads as an empty form.
  const json = await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(id)]], { type: 'text/plain' }), db));
  assert.equal(location(json), '/admin/people?error=form');
  assert.equal(count(db, 'admin_log'), 0);
  assert.equal(sends.length, 0);
});

test('Approve on a request already decided answers gone, and sends nothing', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  const res = await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'cohssa'], ['role', 'parent']]), db));
  assert.equal(location(res), '/admin/people?error=gone');
  assert.equal(sends.length, 0);
});

test('Turn down turns down the ticked waiting teams, ignores the role, sends nothing, and answers 303 back (criterion 3)', async () => {
  const db = d1();
  const id = await ask(db);
  const res = await rejectRoute.onRequestPost(context(post('/api/admin/people/reject', [['account', String(id)], ['team', 'hoover-jrt'], ['role', 'coach']]), db));
  assert.equal(res.status, 303);
  assert.equal(location(res), `/admin/people?done=rejected&account=${id}`);
  assert.deepEqual(states(db, id), { 'hoover-jrt': 'rejected', cohssa: 'requested' });
  assert.equal(db.sqlite.prepare('SELECT role FROM accounts WHERE id = ?').get(id).role, 'parent');
  assert.equal(sends.length, 0);
  assert.equal(location(await rejectRoute.onRequestPost(context(post('/api/admin/people/reject', [['account', String(id)], ['team', 'hoover-jrt']]), db))), '/admin/people?error=gone');
  assert.equal(location(await rejectRoute.onRequestPost(context(post('/api/admin/people/reject', [['account', String(id)]]), db))), '/admin/people?error=form');
});

test('"Send a new link" emails an approved person a new link, and refuses anyone else', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  const waiting = await ask(db, { name: 'Sam Lee', email: 'sam@example.org' });
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: NOW });
  const res = await linkRoute.onRequestPost(context(post('/api/admin/people/link', [['account', String(id)]]), db));
  assert.equal(res.status, 303);
  assert.equal(location(res), `/admin/people?done=link&account=${id}&mail=sent`);
  assert.equal(sends.length, 1);
  assert.equal(location(await linkRoute.onRequestPost(context(post('/api/admin/people/link', [['account', String(waiting)]]), db))), '/admin/people?error=not-approved');
  assert.equal(location(await linkRoute.onRequestPost(context(post('/api/admin/people/link', []), db))), '/admin/people?error=form');
  assert.equal(sends.length, 1);
});

test('each press that arrives as a GET changes nothing and says so', async () => {
  const db = d1();
  for (const route of [approveRoute, rejectRoute, linkRoute]) {
    const res = route.onRequestGet({ request: new Request(`${SITE}/api/admin/people/x`), env: env(db) });
    assert.equal(res.status, 303);
    assert.equal(location(res), '/admin/people?error=unchanged');
  }
});

// ---- The page a link opens, /set-password -------------------------------------

const open = (db, query, method = 'GET') => {
  const handler = method === 'HEAD' ? setPassword.onRequestHead : setPassword.onRequestGet;
  return handler({ request: new Request(`${SITE}/set-password${query}`, { method }), env: { DB: db } });
};

test('a link that can be used opens the form to choose a password, saying until when, and opening it spends nothing (criterion 2; #222)', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  // Approved, as an approval's link always is: the form opens only for an
  // account approved for a team (#222).
  await approveTeams(db, { accountId: id, teams: ['cohssa'], role: 'parent', admin: ADMIN, now: nowSeconds() });
  const { token, expiresAt } = await makeLink(db, id, nowSeconds());
  for (const method of ['GET', 'HEAD', 'GET']) {
    const res = await open(db, `?token=${token}`, method);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const html = await res.text();
    assert.match(html, /<h1>Choose a password<\/h1>/);
    assert.ok(html.includes(utcText(expiresAt)));
    assert.match(html, /<form method="post" action="\/set-password"/);
    assert.ok(html.includes(`<input type="hidden" name="token" value="${token}">`));
    assert.equal((html.match(/type="password"/g) ?? []).length, 2);
  }
  assert.equal(count(db, 'password_links'), 1);
  assert.equal((await linkAccount(db, token, nowSeconds())).accountId, id);
  // A link whose account is not approved for any team opens nothing.
  const waiting = await ask(db, { name: 'Sam Lee', email: 'sam@example.org' });
  const unapproved = await makeLink(db, waiting, nowSeconds());
  assert.equal((await open(db, `?token=${unapproved.token}`)).status, 404);
});

test('a used, expired, replaced, mistyped or missing link says so, the same way, and offers no way in (criterion 2)', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['cohssa'] });
  const now = nowSeconds();
  const used = await makeLink(db, id, now);
  assert.equal(await useLink(db, id, used.token, now), 2);
  // Replaced the way a person's link is: a second email went.
  const third = await ask(db, { name: 'Tia Moss', email: 'tia@example.org' });
  await approveTeams(db, { accountId: third, teams: ['cohssa'], role: 'parent', admin: ADMIN, now });
  await sendLink(env(db), { accountId: third, admin: ADMIN, now, site: SITE });
  await sendLink(env(db), { accountId: third, admin: ADMIN, now, site: SITE });
  const replaced = { token: tokenOf(0) };
  // Made last, so no later link's tidy deletes it: the route itself has to
  // refuse it by its time (#221's review: made first, it was swept away and a
  // stopped clock in the route read 0 red).
  const other = await ask(db, { name: 'Sam Lee', email: 'sam@example.org' });
  const expired = await makeLink(db, other, now - LINK_SECONDS - 1);
  assert.equal(rows(db, 'SELECT account_id FROM password_links WHERE account_id = ?', other).length, 1, 'the expired row is not there to refuse');
  const cases = {
    used: `?token=${used.token}`,
    expired: `?token=${expired.token}`,
    replaced: `?token=${replaced.token}`,
    'cut short': `?token=${replaced.token.slice(0, 40)}`,
    'never made': `?token=${'Q'.repeat(43)}`,
    missing: '',
    empty: '?token=',
  };
  let first = null;
  for (const [name, query] of Object.entries(cases)) {
    const res = await open(db, query);
    assert.equal(res.status, 404, name);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', name);
    const html = await res.text();
    assert.match(html, /<h1>This link can't be used<\/h1>/, name);
    assert.doesNotMatch(html, /<form|<input|sign in/i, name);
    first ??= html;
    assert.equal(html, first, `${name} answered differently from the others`);
  }
});

test('when the database does not answer, the link page says so with a 503, and nothing about the link', async (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1_ERROR'); } }) }) };
  const res = await open(broken, `?token=${'A'.repeat(43)}`);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /<h1>This link can't be checked right now<\/h1>/);
});

test('a usable link\'s page says, in UTC, when the link runs out', () => {
  // Written out, not computed: NOW + LINK_SECONDS is 28 September 2026,
  // 14:13:20 UTC.
  const page = setPasswordPage({ token: 'T'.repeat(43), email: 'jane@example.org', hasPassword: false, expiresAt: NOW + LINK_SECONDS });
  assert.match(page, /This link works once, until 28 September 2026, 14:13 UTC\./);
});

test('the link pages are valid under the photo site\'s html-validate config', async () => {
  const form = (options) => setPasswordPage({ token: 'T'.repeat(43), email: 'jane@example.org', hasPassword: false, expiresAt: NOW, ...options });
  for (const html of [
    form(), form({ hasPassword: true }),
    form({ errors: [{ field: 'password', message: 'Too short.' }, { field: 'confirm', message: 'Not the same.' }] }),
    linkGonePage(),
  ]) {
    assert.deepEqual(problems(await validate(html)), []);
    assert.equal((await validate(html.replace('<h1>', '<h1>again</h1><h1>'))).valid, false);
  }
});

test('the whole flow: Approve emails a link, the link opens, and once used it opens no more', async () => {
  const db = d1();
  const id = await ask(db, { teams: ['hoover-jrt'] });
  await approveRoute.onRequestPost(context(post('/api/admin/people/approve', [['account', String(id)], ['team', 'hoover-jrt'], ['role', 'parent']]), db));
  const link = new URL(sends[0].text.match(/https:\/\/\S+/)[0]);
  assert.equal((await open(db, link.search)).status, 200);
  assert.equal(await useLink(db, id, link.searchParams.get('token'), nowSeconds()), 2);
  assert.equal((await open(db, link.search)).status, 404);
  assert.equal(passwordLink(SITE, 'T'), `${SITE}/set-password?token=T`);
});
