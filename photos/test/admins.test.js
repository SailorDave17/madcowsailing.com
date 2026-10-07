// The admins (#224, criteria 3, 4 and 6): the one owner and the last admin
// as migration 0013's triggers hold them in the database itself, making and
// removing admins (lib/people.js, promoteAdmin and demoteAdmin), their two
// presses (functions/api/admin/people/promote.js and demote.js) through the
// admin guards, the buttons /admin/people draws for each viewer, and the
// admins' log. Against a real SQLite holding the real migrations
// (test/d1.js). The sign-in and the session are test/admin-sign-in.test.js's;
// every admin route's refusals, test/guard.test.js's.
//
// Who may do what, as the owner chose at #224's pickup: any admin adds an
// admin, only the owner removes one, and nothing removes the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { onRequest as root } from '../functions/_middleware.js';
import { onRequest as adminApi } from '../functions/api/admin/_middleware.js';
import * as promoteRoute from '../functions/api/admin/people/promote.js';
import * as demoteRoute from '../functions/api/admin/people/demote.js';
import { requestAccount } from '../lib/accounts.js';
import { sessionAccount } from '../lib/account-session.js';
import { ADMIN_SIGN_IN } from '../lib/admin-session.js';
import { adminLog, demoteAdmin, peopleLists, promoteAdmin } from '../lib/people.js';
import { adminPeoplePage, peopleNotice } from '../lib/people-page.js';
import { ADMIN_KEY, adminCookieHeader } from './admin.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const NOW = 1_790_000_000;

const one = (db, sql, ...args) => ({ ...db.sqlite.prepare(sql).get(...args) });
const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map((row) => ({ ...row }));
const roleOf = (db, id) => db.sqlite.prepare('SELECT admin_role FROM accounts WHERE id = ?').get(id)?.admin_role;
const tables = (db) => db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
const snapshot = (db) => Object.fromEntries(tables(db).map((t) => [t, rows(db, `SELECT * FROM "${t}"`)]));

/** An account through #220's own request, approved for `teams` unless told otherwise, holding `adminRole`. Answers its id. */
let asked = 0;
async function account(db, { email, name = email.split('@')[0], teams = ['hoover-jrt'], approved = true, adminRole = null } = {}) {
  asked += 1;
  await requestAccount(db, { request: { name, email, role: 'parent', teams, note: null }, address: `address-${asked}`, now: NOW + asked });
  const { id } = db.sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (approved) db.sqlite.prepare("UPDATE account_teams SET state = 'approved' WHERE account_id = ?").run(id);
  if (adminRole) db.sqlite.prepare('UPDATE accounts SET admin_role = ? WHERE id = ?').run(adminRole, id);
  return id;
}

/** A site with its owner and one admin, and two parents, one approved and one waiting. */
async function site() {
  const db = d1();
  const owner = await account(db, { email: 'owner@example.org', name: 'Olive Owner', adminRole: 'owner' });
  const admin = await account(db, { email: 'admin@example.org', name: 'Abe Admin', adminRole: 'admin' });
  const parent = await account(db, { email: 'parent@example.org', name: 'Pat Parent' });
  const waiting = await account(db, { email: 'waiting@example.org', name: 'Will Waiting', approved: false });
  return { db, owner, admin, parent, waiting };
}

// ---- Criterion 3: exactly one owner, whom nothing revokes, demotes or deletes --

test('the admin role is one of two words or none, and the database holds at most one owner (criterion 3)', async () => {
  const { db, owner, admin, parent } = await site();
  assert.throws(() => db.sqlite.prepare("UPDATE accounts SET admin_role = 'boss' WHERE id = ?").run(parent), /CHECK constraint failed/);
  assert.throws(() => db.sqlite.prepare("UPDATE accounts SET admin_role = 'owner' WHERE id = ?").run(admin), /there is an owner already/);
  assert.throws(() => db.sqlite.prepare("UPDATE accounts SET admin_role = 'owner' WHERE id = ?").run(parent), /there is an owner already/);
  assert.throws(() => db.sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at, admin_role) VALUES ('new@example.org', 'New', 'parent', 1, 'owner')").run(), /there is an owner already/);
  assert.deepEqual(rows(db, "SELECT id FROM accounts WHERE admin_role = 'owner'"), [{ id: owner }]);
  // The control: with no owner yet, the first is made.
  const fresh = d1();
  const first = await account(fresh, { email: 'first@example.org' });
  assert.equal(fresh.sqlite.prepare("UPDATE accounts SET admin_role = 'owner' WHERE id = ?").run(first).changes, 1);
});

test('the one-owner index refuses a second owner on its own, with the trigger that refuses it first taken away (criterion 3)', async () => {
  // Two guards answer a plain second owner, and the trigger answers first,
  // so its test cannot show the index holds (prove-tests shape 16). Here the
  // trigger is dropped, so only the index can refuse.
  const { db, owner, admin } = await site();
  db.sqlite.exec('DROP TRIGGER accounts_admin_role_kept');
  assert.throws(() => db.sqlite.prepare("UPDATE accounts SET admin_role = 'owner' WHERE id = ?").run(admin), /UNIQUE constraint failed: accounts\.admin_role/);
  assert.deepEqual(rows(db, "SELECT id FROM accounts WHERE admin_role = 'owner'"), [{ id: owner }]);
  assert.deepEqual(rows(db, "SELECT sql FROM sqlite_master WHERE name = 'accounts_one_owner'"), [
    { sql: "CREATE UNIQUE INDEX accounts_one_owner ON accounts (admin_role) WHERE admin_role = 'owner'" },
  ]);
});

test('UPDATE OR REPLACE making a second owner is refused, where the unique index alone would delete the owner\'s whole row (criterion 3)', async () => {
  // Measured on node:sqlite 3.53.3 before the trigger was written: the
  // clash resolved by deleting the owner's account, teams and all.
  const { db, owner, admin } = await site();
  const before = snapshot(db);
  assert.throws(() => db.sqlite.prepare("UPDATE OR REPLACE accounts SET admin_role = 'owner' WHERE id = ?").run(admin), /there is an owner already/);
  assert.deepEqual(snapshot(db), before);
  assert.equal(roleOf(db, owner), 'owner');
});

test('the owner keeps the owner role, by any UPDATE, OR REPLACE included (criterion 3)', async () => {
  const { db, owner } = await site();
  const before = snapshot(db);
  for (const role of ['admin', null]) {
    for (const verb of ['UPDATE', 'UPDATE OR REPLACE']) {
      assert.throws(() => db.sqlite.prepare(`${verb} accounts SET admin_role = ? WHERE id = ?`).run(role, owner), /the owner keeps the owner role/, `${verb} to ${role}`);
    }
  }
  // Every account at once, the owner among them.
  assert.throws(() => db.sqlite.prepare('UPDATE accounts SET admin_role = NULL').run(), /the owner keeps the owner role/);
  assert.deepEqual(snapshot(db), before);
});

test('the owner\'s account is never deleted, alone or with others (criterion 3)', async () => {
  const { db, owner } = await site();
  const before = snapshot(db);
  assert.throws(() => db.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(owner), /the owner account is kept/);
  assert.throws(() => db.sqlite.prepare('DELETE FROM accounts').run(), /the owner account is kept/);
  assert.deepEqual(snapshot(db), before);
});

test('a REPLACE onto the owner\'s id or email is skipped, the owner\'s row untouched; a REPLACE making a second owner is refused (criterion 3)', async () => {
  const { db, owner } = await site();
  const before = snapshot(db);
  db.sqlite.prepare("REPLACE INTO accounts (id, email, name, role, requested_at) VALUES (?, 'taken@example.org', 'Taken', 'parent', 1)").run(owner);
  db.sqlite.prepare("INSERT OR REPLACE INTO accounts (email, name, role, requested_at) VALUES ('OWNER@example.org', 'Usurper', 'parent', 1)").run();
  assert.deepEqual(snapshot(db), { ...before, sqlite_sequence: snapshot(db).sqlite_sequence });
  assert.throws(() => db.sqlite.prepare("REPLACE INTO accounts (email, name, role, requested_at, admin_role) VALUES ('x@example.org', 'X', 'parent', 1, 'owner')").run(), /there is an owner already/);
  // The same for an admin, the last-admin rule's half: a REPLACE cannot remove one either.
  const admin = one(db, "SELECT id FROM accounts WHERE admin_role = 'admin'").id;
  db.sqlite.prepare("REPLACE INTO accounts (id, email, name, role, requested_at) VALUES (?, 'y@example.org', 'Y', 'parent', 1)").run(admin);
  assert.equal(roleOf(db, admin), 'admin');
  // The control: a REPLACE onto an account that is no admin still replaces it.
  const parent = one(db, "SELECT id FROM accounts WHERE email = 'parent@example.org'").id;
  db.sqlite.prepare("REPLACE INTO accounts (id, email, name, role, requested_at) VALUES (?, 'replaced@example.org', 'Replaced', 'parent', 1)").run(parent);
  assert.equal(one(db, 'SELECT email FROM accounts WHERE id = ?', parent).email, 'replaced@example.org');
});

test('an UPDATE OR REPLACE moving another account onto the owner\'s id or email is refused (criterion 3)', async () => {
  const { db, owner, parent } = await site();
  const before = snapshot(db);
  assert.throws(() => db.sqlite.prepare("UPDATE OR REPLACE accounts SET email = 'Owner@Example.org' WHERE id = ?").run(parent), /that row would displace an admin/);
  assert.throws(() => db.sqlite.prepare('UPDATE OR REPLACE accounts SET id = ? WHERE id = ?').run(owner, parent), /that row would displace an admin/);
  assert.deepEqual(snapshot(db), before);
  // The control: an account changing its own address's letter case is let through.
  assert.equal(db.sqlite.prepare("UPDATE accounts SET email = 'OWNER@example.org' WHERE id = ?").run(owner).changes, 1);
});

test('/ask for the owner\'s address answers as for any known address: the same statements, nothing written, the row as it was (#220\'s criterion 4 kept)', async () => {
  // The trigger skips the insert rather than refusing it, since a BEFORE
  // INSERT runs before /ask's ON CONFLICT DO NOTHING: a refusal would answer
  // the owner's address with an error and so name it.
  const { db } = await site();
  const ask = async (email, address) => {
    const start = db.statements.length;
    const outcome = await requestAccount(db, { request: { name: 'Someone', email, role: 'coach', teams: ['cohssa'], note: null }, address, now: NOW + 500 });
    return { outcome, statements: db.statements.slice(start) };
  };
  const ownerRow = snapshot(db).accounts.find((a) => a.email === 'owner@example.org');
  const asOwner = await ask('Owner@Example.org', 'net-a');
  const asParent = await ask('parent@example.org', 'net-b');
  assert.deepEqual(asOwner.outcome, { outcome: 'taken', created: false });
  assert.deepEqual(asOwner, asParent);
  assert.deepEqual(snapshot(db).accounts.find((a) => a.email === 'owner@example.org'), ownerRow);
  assert.deepEqual(rows(db, 'SELECT team, state FROM account_teams WHERE account_id = ?', ownerRow.id), [{ team: 'hoover-jrt', state: 'approved' }]);
});

test('the owner\'s approved teams stay approved: no revoke, turn-down, move or delete, by any statement (criterion 3)', async () => {
  const { db, owner } = await site();
  const before = snapshot(db);
  const refused = [
    ["UPDATE account_teams SET state = 'revoked' WHERE account_id = ?", owner],
    ["UPDATE account_teams SET state = 'rejected' WHERE account_id = ?", owner],
    ["UPDATE account_teams SET state = 'requested' WHERE account_id = ?", owner],
    ["UPDATE account_teams SET team = 'cohssa' WHERE account_id = ?", owner],
    ['DELETE FROM account_teams WHERE account_id = ?', owner],
    ["REPLACE INTO account_teams (account_id, team, state) VALUES (?, 'hoover-jrt', 'revoked')", owner],
    ["INSERT OR REPLACE INTO account_teams (account_id, team, state) VALUES (?, 'hoover-jrt', 'approved')", owner],
  ];
  for (const [sql, id] of refused) assert.throws(() => db.sqlite.prepare(sql).run(id), /the owner stays approved/, sql);
  // Another account's row moved onto the owner's, by UPDATE OR REPLACE.
  const parent = one(db, "SELECT id FROM accounts WHERE email = 'parent@example.org'").id;
  assert.throws(() => db.sqlite.prepare('UPDATE OR REPLACE account_teams SET account_id = ? WHERE account_id = ?').run(owner, parent), /the owner stays approved/);
  assert.deepEqual(snapshot(db), before);
  // The control: any other account's team is revoked, turned down or deleted.
  assert.equal(db.sqlite.prepare("UPDATE account_teams SET state = 'revoked' WHERE account_id = ?").run(parent).changes, 1);
  const admin = one(db, "SELECT id FROM accounts WHERE email = 'admin@example.org'").id;
  assert.equal(db.sqlite.prepare('DELETE FROM account_teams WHERE account_id = ?').run(admin).changes, 1);
  // And the owner asking for a second team, which waits and can be turned down.
  db.sqlite.prepare("INSERT INTO account_teams (account_id, team, state) VALUES (?, 'cohssa', 'requested')").run(owner);
  assert.equal(db.sqlite.prepare("UPDATE account_teams SET state = 'rejected' WHERE account_id = ? AND team = 'cohssa'").run(owner).changes, 1);
});

// ---- Criterion 4: the last admin stays -----------------------------------------

test('the last admin is never left without the role or deleted, by any statement (criterion 4)', async () => {
  // A database with admins and no owner yet, the one place the rule can bite
  // on its own: once there is an owner, the owner is always an admin.
  const db = d1();
  const a = await account(db, { email: 'a@example.org', adminRole: 'admin' });
  const b = await account(db, { email: 'b@example.org', adminRole: 'admin' });
  assert.equal(db.sqlite.prepare('UPDATE accounts SET admin_role = NULL WHERE id = ?').run(a).changes, 1);
  const before = snapshot(db);
  assert.throws(() => db.sqlite.prepare('UPDATE accounts SET admin_role = NULL WHERE id = ?').run(b), /the last admin keeps the role/);
  assert.throws(() => db.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(b), /the last admin account is kept/);
  assert.throws(() => db.sqlite.prepare('UPDATE accounts SET admin_role = NULL').run(), /the last admin keeps the role/);
  assert.deepEqual(snapshot(db), before);
  // The control: with a second admin, either can go.
  db.sqlite.prepare("UPDATE accounts SET admin_role = 'admin' WHERE id = ?").run(a);
  assert.equal(db.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(b).changes, 1);
});

// ---- Criterion 4: any admin adds, only the owner removes ------------------------

test('any admin makes an approved person an admin, and it is in the log (criteria 4 and 6)', async () => {
  const { db, admin, parent } = await site();
  assert.equal(await promoteAdmin(db, { accountId: parent, actorId: admin, admin: 'admin@example.org', now: NOW }), true);
  assert.equal(roleOf(db, parent), 'admin');
  const [entry] = (await adminLog(db)).entries;
  assert.deepEqual(entry, { id: entry.id, at: NOW, admin: 'admin@example.org', action: 'promote', accountId: parent, name: 'Pat Parent', email: 'parent@example.org', detail: null });
});

test('making an admin changes nothing, and logs nothing, for one already an admin, one approved for no team, one that is gone, or by one no longer an admin', async () => {
  const { db, owner, admin, parent, waiting } = await site();
  const before = snapshot(db);
  const press = (accountId, actorId) => promoteAdmin(db, { accountId, actorId, admin: 'someone@example.org', now: NOW });
  assert.equal(await press(admin, owner), false, 'already an admin');
  assert.equal(await press(owner, admin), false, 'the owner');
  assert.equal(await press(waiting, owner), false, 'approved for no team');
  assert.equal(await press(999, owner), false, 'gone');
  assert.equal(await press(parent, parent), false, 'pressed by someone who is no admin');
  assert.equal(await press(parent, 999), false, 'pressed by an account that is gone');
  assert.deepEqual(snapshot(db), before);
  // The control: the same press by an admin goes through.
  assert.equal(await press(parent, owner), true);
});

test('of two presses of Make admin at once, one makes the admin and logs it', async () => {
  const { db, owner, admin, parent } = await site();
  const both = await Promise.all([owner, admin].map((actorId) => promoteAdmin(db, { accountId: parent, actorId, admin: `${actorId}@x.org`, now: NOW })));
  assert.deepEqual(both.sort(), [false, true]);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM admin_log WHERE action = 'promote'").n, 1);
});

test('only the owner removes an admin, and it is in the log; an admin removing one changes nothing (criteria 4 and 6)', async () => {
  const { db, owner, admin, parent } = await site();
  await promoteAdmin(db, { accountId: parent, actorId: admin, admin: 'admin@example.org', now: NOW });
  const before = snapshot(db);
  assert.equal(await demoteAdmin(db, { accountId: parent, actorId: admin, admin: 'admin@example.org', now: NOW + 1 }), false);
  assert.deepEqual(snapshot(db), before);
  assert.equal(await demoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW + 2 }), true);
  assert.equal(roleOf(db, parent), null);
  const [entry] = (await adminLog(db)).entries;
  assert.deepEqual(entry, { id: entry.id, at: NOW + 2, admin: 'owner@example.org', action: 'demote', accountId: parent, name: 'Pat Parent', email: 'parent@example.org', detail: null });
});

test('removing an admin never takes the owner\'s role, nor a role from one that is no admin (criterion 3)', async () => {
  const { db, owner, parent } = await site();
  const before = snapshot(db);
  assert.equal(await demoteAdmin(db, { accountId: owner, actorId: owner, admin: 'owner@example.org', now: NOW }), false);
  assert.equal(await demoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW }), false);
  assert.deepEqual(snapshot(db), before);
});

// ---- The presses, through the admin guards ---------------------------------------

/**
 * A press on /admin/people, through the root middleware and the admin API's
 * guards, as `actorId`'s admin session at `version` (1 unless named).
 */
async function press(db, route, accountId, actorId, { version } = {}) {
  const env = { DB: db, SESSION_SIGNING_KEY: ADMIN_KEY };
  const request = new Request(`${SITE}/api/admin/people/${route}`, {
    method: 'POST',
    headers: { Origin: SITE, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: await adminCookieHeader(actorId, { version }) },
    body: new URLSearchParams({ account: String(accountId) }).toString(),
  });
  const handler = (route === 'promote' ? promoteRoute : demoteRoute).onRequestPost;
  const stack = [root, ...adminApi, handler];
  const data = {};
  const run = (i) => stack[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  const response = await run(0);
  return { status: response.status, location: response.headers.get('Location') };
}

test('Make admin and Remove admin through the guards: an admin adds, only the owner removes, and each lands back on the page saying so', async () => {
  const { db, owner, admin, parent } = await site();
  assert.deepEqual(await press(db, 'promote', parent, admin), { status: 303, location: `/admin/people?done=promoted&account=${parent}` });
  assert.deepEqual(await press(db, 'demote', parent, admin), { status: 303, location: '/admin/people?error=not-owner' });
  assert.equal(roleOf(db, parent), 'admin');
  assert.deepEqual(await press(db, 'demote', parent, owner), { status: 303, location: `/admin/people?done=demoted&account=${parent}` });
  assert.deepEqual(await press(db, 'demote', owner, owner), { status: 303, location: '/admin/people?error=not-demoted' });
  assert.deepEqual(await press(db, 'promote', admin, owner), { status: 303, location: '/admin/people?error=not-promoted' });
  // The admin who was removed is refused at once: their session no longer opens the API.
  assert.equal(await promoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW }), true);
  assert.equal(await demoteAdmin(db, { accountId: admin, actorId: owner, admin: 'owner@example.org', now: NOW }), true);
  assert.deepEqual(await press(db, 'promote', parent, admin), { status: 303, location: ADMIN_SIGN_IN });
  assert.deepEqual(rows(db, 'SELECT action, email FROM admin_log ORDER BY id'), [
    { action: 'promote', email: 'parent@example.org' },
    { action: 'demote', email: 'parent@example.org' },
    { action: 'promote', email: 'parent@example.org' },
    { action: 'demote', email: 'admin@example.org' },
  ]);
});

test('making an admin ends every session the account holds, so a demotion stays one: a cookie from before it does not come back (#224\'s review)', async () => {
  const { db, owner, admin, parent, waiting } = await site();
  const version = () => one(db, 'SELECT session_version AS v FROM accounts WHERE id = ?', parent).v;
  await promoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW });
  assert.equal(version(), 2, 'the promotion left the sessions from before it open');
  // The new admin signs in, at version 2, and their cookie passes the guard:
  // the press reaches the route, which finds nothing to change.
  const opens = { status: 303, location: '/admin/people?error=not-promoted' };
  assert.deepEqual(await press(db, 'promote', waiting, parent, { version: 2 }), opens);
  // The owner removes them; the same cookie is refused at the next request.
  assert.equal(await demoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW + 1 }), true);
  const refused = { status: 303, location: ADMIN_SIGN_IN };
  assert.deepEqual(await press(db, 'promote', waiting, parent, { version: 2 }), refused);
  // Another admin makes them one again within the 12 hours. The cookie from
  // before the removal stays refused (a demotion used to only suspend it),
  // and so does their account's session from then.
  assert.equal(await promoteAdmin(db, { accountId: parent, actorId: admin, admin: 'admin@example.org', now: NOW + 2 }), true);
  assert.equal(version(), 3);
  assert.deepEqual(await press(db, 'promote', waiting, parent, { version: 2 }), refused);
  assert.equal(await sessionAccount(db, { accountId: parent, version: 2 }), null);
  // The control: a sign-in after the promotion, at version 3, opens again.
  assert.deepEqual(await press(db, 'promote', waiting, parent, { version: 3 }), opens);
  // A removal alone ends nothing but the admin pages: the account still sends.
  assert.equal(await demoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW + 3 }), true);
  assert.equal(version(), 3);
  assert.ok(await sessionAccount(db, { accountId: parent, version: 3 }));
});

test('a press that names no account changes nothing, and a press as a page load changes nothing either', async () => {
  const { db, owner } = await site();
  const before = snapshot(db);
  for (const route of [promoteRoute, demoteRoute]) {
    const empty = await route.onRequestPost({
      request: new Request(`${SITE}/x`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'account=abc' }),
      env: { DB: db },
      data: { admin: { id: owner, email: 'owner@example.org', role: 'owner' } },
    });
    assert.equal(empty.headers.get('Location'), '/admin/people?error=form');
    assert.equal(route.onRequestGet().headers.get('Location'), '/admin/people?error=unchanged');
  }
  assert.deepEqual(snapshot(db), before);
});

// ---- The page ------------------------------------------------------------------------

const validator = new HtmlValidate(new FileSystemConfigLoader());

async function pageFor(db, viewer, query = '') {
  const lists = await peopleLists(db);
  return adminPeoplePage({ lists, log: await adminLog(db), notice: peopleNotice(new URLSearchParams(query), lists), viewer });
}

const formsOf = (html, action) => [...html.matchAll(new RegExp(`<form method="post" action="/api/admin/people/${action}">[\\s\\S]*?</form>`, 'g'))].map((m) => m[0]);

test('the page marks the owner and each admin, offers Make admin to any admin, and Remove admin to the owner alone, never on the owner', async () => {
  const { db, owner, admin, parent, waiting } = await site();
  const asOwner = await pageFor(db, { id: owner, role: 'owner' });
  const asAdmin = await pageFor(db, { id: admin, role: 'admin' });
  for (const html of [asOwner, asAdmin]) {
    assert.match(html, /owner@example\.org · Parent · the owner · asked/);
    assert.match(html, /admin@example\.org · Parent · an admin · asked/);
    assert.match(html, /parent@example\.org · Parent · asked/);
    // Make admin: on the approved parent only, never the waiting one or an admin.
    const make = formsOf(html, 'promote');
    assert.deepEqual(make.map((f) => f.match(/value="(\d+)"/)[1]), [String(parent)]);
    assert.match(make[0], /aria-label="Make Pat Parent an admin">Make admin<\/button>/);
    assert.ok(!html.includes(`value="${waiting}" aria-label="Make`));
  }
  // Remove admin: drawn for the owner, on the admin and not the owner.
  assert.deepEqual(formsOf(asOwner, 'demote').map((f) => f.match(/value="(\d+)"/)[1]), [String(admin)]);
  assert.deepEqual(formsOf(asAdmin, 'demote'), []);
  assert.match(asOwner, /As the owner, you can also remove an admin\./);
  assert.match(asAdmin, /Only the owner can remove one\./);
  for (const html of [asOwner, asAdmin]) {
    const report = await validator.validateString(html, join(ROOT, 'people.html'));
    assert.equal(report.valid, true, report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)).join('\n'));
  }
});

test('the notices after each press, and the log\'s sentences, name the person as the database holds them, escaped (criterion 6)', async () => {
  const { db, owner, parent } = await site();
  db.sqlite.prepare("UPDATE accounts SET name = '<b>Pat</b>' WHERE id = ?").run(parent);
  await promoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW });
  const promoted = await pageFor(db, { id: owner, role: 'owner' }, `?done=promoted&account=${parent}`);
  assert.match(promoted, /<p role="status">&lt;b&gt;Pat&lt;\/b&gt; is an admin, and is signed out on every phone and computer\. The admin pages open to them the next time they sign in, which asks for a code the site emails them\. Nothing was emailed now\.<\/p>/);
  assert.match(promoted, /owner@example\.org made &lt;b&gt;Pat&lt;\/b&gt; \(parent@example\.org\) an admin\./);
  await demoteAdmin(db, { accountId: parent, actorId: owner, admin: 'owner@example.org', now: NOW + 1 });
  const demoted = await pageFor(db, { id: owner, role: 'owner' }, `?done=demoted&account=${parent}`);
  assert.match(demoted, /<p role="status">&lt;b&gt;Pat&lt;\/b&gt; is no longer an admin\./);
  assert.match(demoted, /owner@example\.org removed &lt;b&gt;Pat&lt;\/b&gt; \(parent@example\.org\) as an admin\./);
  assert.ok(!demoted.includes('<b>Pat</b>'));
  for (const [error, text] of [['not-owner', 'only the owner removes an admin'], ['not-promoted', 'already an admin'], ['not-demoted', 'is the owner, whose role stays']]) {
    assert.ok((await pageFor(db, { id: owner, role: 'owner' }, `?error=${error}`)).includes(text), error);
  }
});
