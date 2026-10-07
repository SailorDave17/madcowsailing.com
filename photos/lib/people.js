/**
 * Requests for an account, as the admins decide them (#221), on
 * /admin/people. lib/accounts.js takes a request (#220); this holds what an
 * admin does with one, and the page is lib/people-page.js.
 *
 *   - An admin approves or turns down each team a request names on its own
 *     (D16), and may change the role the requester chose at approval
 *     (approveTeams, rejectTeams).
 *   - Approving emails the person a link to set a password, and so does
 *     "Send a new link" (sendLink, lib/password-link.js). Turning down sends
 *     nothing (the owner's choice at #221's pickup, 2026-10-05): anyone can
 *     type any address into /ask, so a note could reach a stranger whose
 *     address was used, and would confirm a live address to a spammer.
 *   - A turned-down team can still be approved later, so a mistake can be
 *     undone. A turned-down address that asks again still writes nothing
 *     (#220's criterion 4, unchanged: the owner's choice at #221's pickup).
 *   - Every action is in the admins' log (admin_log, migration 0008): who,
 *     what, whom and when (criterion 5). An entry copies the person's name
 *     and address, so it still names them after their account is deleted, as
 *     /policy says.
 *   - Since #225 an admin revokes an approved person for a team or every team
 *     (revokeTeams), hides every photo an account sent (hidePhotos), deletes
 *     an account once a reply from its own address confirms the request
 *     (deleteAccount), and lets a deleted revoked account's address ask again
 *     (allowAddress). Re-approving a revoked team is approveTeams'. Revoke and
 *     delete refuse an account holding the admin role: the owner removes the
 *     role first (the owner's choice at #225's pickup, 2026-10-07), which
 *     keeps #224's rule that only the owner removes an admin.
 *
 * Each decision is one D1 batch, which D1 runs as a transaction, and every
 * statement in it is guarded by the same condition, a team still waiting to
 * be decided. So the log entries and the change are made together or not at
 * all, and of two admins pressing at once only the first changes anything;
 * the second is told the request was already decided. A link's entry is
 * committed with the link in the same way (sendLink); only how its send went
 * is written afterwards, and if that write fails the entry says so
 * ("unrecorded") rather than going missing.
 *
 * Nothing here logs a name, an email address or a note to the console.
 */
import { ROLES, TEAMS } from './accounts.js';
import { utcText } from './admin-page.js';
import { sendMail } from './mail.js';
import { LINK_SECONDS, dropLink, newLink, passwordLink, replaceOthers } from './password-link.js';
import { WAITING_WHEN_HIDDEN } from './removals.js';
import { emailHash } from './sign-in.js';

const TEAM_KEYS = TEAMS.map(({ team }) => team);
const TEAM_NAMES = Object.fromEntries(TEAMS.map(({ team, name }) => [team, name]));

// What the log records, and what each word means on the page
// (lib/people-page.js). #224 added promote and demote, and #225 revoke, hide,
// delete and allow; 0008's CHECK holds only the shape, so adding one needs no
// migration.
export const ACTIONS = Object.freeze(['approve', 'reject', 'role', 'link', 'promote', 'demote', 'revoke', 'hide', 'delete', 'allow']);

// How many log entries the page shows, newest first. The table keeps every
// one; the page says how many more there are.
export const LOG_SHOWN = 100;

/** How long a link lasts, in days, as the page and the email say it. */
export const LINK_DAYS = LINK_SECONDS / (24 * 60 * 60);

/** An account id from a form field, or null. */
export function readAccountId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value) ? Number(value) : null;
}

/**
 * The teams a form ticked, in TEAMS order, or null when none is ticked or
 * one is not a team.
 */
export function readTeams(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some((team) => !TEAM_KEYS.includes(team))) return null;
  return TEAM_KEYS.filter((team) => values.includes(team));
}

/** "Hoover JRT", "Hoover JRT and COHSSA". */
export const teamsText = (teams) => teams.map((team) => TEAM_NAMES[team]).join(' and ');

/**
 * Every account, as the page lists it: { id, name, email, role, adminRole,
 * note, requestedAt, teams: [{ team, name, state }] in TEAMS order, photos:
 * { waiting, approved } }, sorted into the four lists the page shows, each in
 * the order the requests arrived. adminRole is 'admin', 'owner' or null
 * (#224). photos counts the photos the account sent that are waiting or
 * public, the ones "Hide all their photos" would hide (#225).
 *
 *   waiting     a team still waits for an admin
 *   approved    nothing waits, and a team is approved
 *   revoked     nothing waits or is approved, and a team was revoked (#225)
 *   turnedDown  nothing waits or is approved, none is revoked, and a team
 *               was turned down
 */
export async function peopleLists(db) {
  const [{ results }, { results: sent }] = await Promise.all([
    db.prepare(
      'SELECT a.id, a.name, a.email, a.role, a.admin_role, a.note, a.requested_at, t.team, t.state ' +
      'FROM accounts AS a JOIN account_teams AS t ON t.account_id = a.id ORDER BY a.requested_at, a.id',
    ).all(),
    db.prepare(
      "SELECT account_id, SUM(state = 'pending') AS waiting, SUM(state = 'approved') AS approved FROM photos " +
      "WHERE account_id IS NOT NULL AND kind = 'photo' AND state IN ('pending', 'approved') GROUP BY account_id",
    ).all(),
  ]);
  const photos = new Map(sent.map((row) => [row.account_id, { waiting: row.waiting, approved: row.approved }]));
  const byId = new Map();
  for (const row of results) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        adminRole: row.admin_role,
        note: row.note,
        requestedAt: row.requested_at,
        teams: [],
        photos: photos.get(row.id) ?? { waiting: 0, approved: 0 },
      });
    }
    byId.get(row.id).teams.push({ team: row.team, name: TEAM_NAMES[row.team] ?? row.team, state: row.state });
  }
  const lists = { waiting: [], approved: [], revoked: [], turnedDown: [] };
  for (const person of byId.values()) {
    person.teams.sort((a, b) => TEAM_KEYS.indexOf(a.team) - TEAM_KEYS.indexOf(b.team));
    const has = (state) => person.teams.some((t) => t.state === state);
    if (has('requested')) lists.waiting.push(person);
    else if (has('approved')) lists.approved.push(person);
    else if (has('revoked')) lists.revoked.push(person);
    else if (has('rejected')) lists.turnedDown.push(person);
  }
  return lists;
}

// The states a decision may change a team from: approving takes a waiting
// team, a turned-down one or a revoked one (#225: re-approving is how an
// admin takes a revoked person back), turning down a waiting team only.
const DECIDABLE = {
  approve: "state IN ('requested', 'rejected', 'revoked')",
  reject: "state = 'requested'",
};

// A team of account `a` that this decision may change, among the ticked ones.
const pending = (decision) => 'EXISTS (SELECT 1 FROM account_teams AS x WHERE x.account_id = a.id ' +
  `AND x.team IN (SELECT value FROM json_each(?)) AND x.${DECIDABLE[decision]})`;

// The log entries for the teams a decision changes, one per team in the order
// the form ticked them, made before the change while the condition still
// picks them out. Same transaction, so nothing can move in between.
function teamLog(db, decision, { accountId, teams, admin, now }) {
  return db.prepare(
    'INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) ' +
    'SELECT ?, ?, ?, a.id, a.name, a.email, t.name ' +
    'FROM accounts AS a JOIN account_teams AS x ON x.account_id = a.id JOIN teams AS t ON t.team = x.team ' +
    'JOIN json_each(?) AS j ON j.value = x.team ' +
    `WHERE a.id = ? AND x.${DECIDABLE[decision]} ORDER BY j.key`,
  ).bind(now, admin, decision, JSON.stringify(teams), accountId);
}

function teamChange(db, decision, { accountId, teams }) {
  return db.prepare(
    'UPDATE account_teams SET state = ? WHERE account_id = ? AND team IN (SELECT value FROM json_each(?)) ' +
    `AND ${DECIDABLE[decision]} RETURNING team`,
  ).bind(decision === 'approve' ? 'approved' : 'rejected', accountId, JSON.stringify(teams));
}

/**
 * Approve account `accountId` for `teams` (readTeams'), with `role`, as the
 * admin whose address is `admin`, at `now`. Answers the teams it approved, in
 * TEAMS order, or null when none of them was waiting or turned down (the
 * account is gone, or another admin decided first), in which case nothing
 * changed. Throws for a role that is not one of ROLES, or when D1 fails.
 *
 * The role changes, and is logged, only when a team is approved by the same
 * press: a role is chosen at approval (criterion 1).
 *
 * A revoked team can be approved again (#225). When that leaves the account
 * with no revoked team, its address's hold is lifted in the same batch: the
 * row revoked_addresses kept for it is deleted, so the re-approval is the
 * owner allowing it (#225's criterion 5). A revoke ended every session the
 * account held, so no cookie from before it comes back with the approval.
 */
export async function approveTeams(db, { accountId, teams, role, admin, now }) {
  if (!ROLES.includes(role)) throw new Error('approveTeams: not a role');
  const results = await db.batch([
    db.prepare(
      'INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) ' +
      "SELECT ?, ?, 'role', a.id, a.name, a.email, a.role || ' to ' || ? FROM accounts AS a " +
      `WHERE a.id = ? AND a.role <> ? AND ${pending('approve')}`,
    ).bind(now, admin, role, accountId, role, JSON.stringify(teams)),
    db.prepare(
      'UPDATE accounts SET role = ? WHERE id = ? AND role <> ? AND EXISTS (SELECT 1 FROM account_teams AS x ' +
      `WHERE x.account_id = accounts.id AND x.team IN (SELECT value FROM json_each(?)) AND x.${DECIDABLE.approve})`,
    ).bind(role, accountId, role, JSON.stringify(teams)),
    teamLog(db, 'approve', { accountId, teams, admin, now }),
    teamChange(db, 'approve', { accountId, teams }),
    // After the change, so it reads the teams as the approval left them.
    db.prepare(
      'DELETE FROM revoked_addresses WHERE account_id = ? ' +
      "AND NOT EXISTS (SELECT 1 FROM account_teams WHERE account_id = ? AND state = 'revoked')",
    ).bind(accountId, accountId),
  ]);
  const approved = results[3].results.map(({ team }) => team);
  return approved.length ? TEAM_KEYS.filter((team) => approved.includes(team)) : null;
}

/**
 * Turn down account `accountId` for `teams`, as approveTeams approves, for
 * teams still waiting only. Answers the teams it turned down, or null when
 * none was waiting. Sends nothing.
 */
export async function rejectTeams(db, { accountId, teams, admin, now }) {
  const results = await db.batch([
    teamLog(db, 'reject', { accountId, teams, admin, now }),
    teamChange(db, 'reject', { accountId, teams }),
  ]);
  const rejected = results[1].results.map(({ team }) => team);
  return rejected.length ? TEAM_KEYS.filter((team) => rejected.includes(team)) : null;
}

// The account the press is about still holds an approved team: only such an
// account can sign in, so only such an account is made an admin.
const APPROVED_TEAM = (column) =>
  `EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = ${column} AND t.state = 'approved')`;

// The admin pressing still holds the role the press needs, read in the same
// statement as the change: the guard read it when the request began, and a
// demotion can land in between.
const ACTOR_IS = (role) => (role === 'owner'
  ? "EXISTS (SELECT 1 FROM accounts AS actor WHERE actor.id = ? AND actor.admin_role = 'owner')"
  : 'EXISTS (SELECT 1 FROM accounts AS actor WHERE actor.id = ? AND actor.admin_role IS NOT NULL)');

/**
 * Make account `accountId` an admin (#224), pressed by the admin whose
 * account is `actorId` and whose address is `admin`, at `now`. Any admin may
 * (the owner's choice at #224's pickup, over criterion 4's default of the
 * owner alone). Answers whether it did: false when the account already holds
 * an admin role, holds no approved team, is gone, or the one pressing is no
 * longer an admin, and then nothing changed.
 *
 * One D1 batch, which D1 runs as a transaction: the log entry, then the
 * change, both held by the same condition, so they commit together or not at
 * all (criterion 6), and of two presses at once only the first changes
 * anything. The entry is written first, while the condition still picks the
 * account out.
 *
 * The change adds 1 to the account's session version, which ends every
 * session it holds, on every device (the owner's choice at #224's review: a
 * session is renewed when its rights grow). Without it, a demotion only
 * suspended: someone made an admin again within 12 hours of their last admin
 * sign-in found a cookie from before the demotion open again, with no new
 * password and no new code. So the admin pages open, and sending resumes, at
 * their next sign-in, with its code. Throws when D1 fails.
 */
export async function promoteAdmin(db, { accountId, actorId, admin, now }) {
  const results = await db.batch([
    db.prepare(
      "INSERT INTO admin_log (at, admin, action, account_id, name, email) SELECT ?, ?, 'promote', a.id, a.name, a.email " +
      `FROM accounts AS a WHERE a.id = ? AND a.admin_role IS NULL AND ${APPROVED_TEAM('a.id')} AND ${ACTOR_IS('admin')}`,
    ).bind(now, admin, accountId, actorId),
    db.prepare(
      "UPDATE accounts SET admin_role = 'admin', session_version = session_version + 1 " +
      `WHERE id = ? AND admin_role IS NULL AND ${APPROVED_TEAM('accounts.id')} AND ${ACTOR_IS('admin')} RETURNING id`,
    ).bind(accountId, actorId),
  ]);
  return results[1].results.length > 0;
}

/**
 * Take the admin role from account `accountId` (#224), pressed by the owner,
 * whose account is `actorId` and whose address is `admin`, at `now`. Only the
 * owner may (criterion 4, the owner's choice at pickup), and only an admin's
 * role is taken: the owner's never is (criterion 3). Answers whether it did:
 * false when the account holds no admin role or is the owner, or the one
 * pressing is not the owner, and then nothing changed.
 *
 * One D1 batch, as promoteAdmin's. The admin guard reads the role on every
 * request (lib/admin-session.js), so the admin pages close to them at their
 * next one (criterion 2); their account's own sessions stay, so they can
 * still send. Their admin cookie cannot come back if they are made an admin
 * again, since promoteAdmin ends every session. Migration 0013's triggers
 * refuse the owner's demotion and the last admin's in the database itself,
 * so this statement could not do either even with its own condition gone.
 * Throws when D1 fails.
 */
export async function demoteAdmin(db, { accountId, actorId, admin, now }) {
  const results = await db.batch([
    db.prepare(
      "INSERT INTO admin_log (at, admin, action, account_id, name, email) SELECT ?, ?, 'demote', a.id, a.name, a.email " +
      `FROM accounts AS a WHERE a.id = ? AND a.admin_role = 'admin' AND ${ACTOR_IS('owner')}`,
    ).bind(now, admin, accountId, actorId),
    db.prepare(
      `UPDATE accounts SET admin_role = NULL WHERE id = ? AND admin_role = 'admin' AND ${ACTOR_IS('owner')} RETURNING id`,
    ).bind(accountId, actorId),
  ]);
  return results[1].results.length > 0;
}

// An account an admin may revoke or delete: one that holds no admin role. The
// owner removes the role first (the owner's choice at #225's pickup,
// 2026-10-07), so only the owner can take an admin's access away, as #224
// made removing an admin the owner's alone. The owner's own role can never be
// removed, and migration 0013 refuses the owner's revoke and delete under
// this condition too.
const NOT_ADMIN = (column) => `EXISTS (SELECT 1 FROM accounts AS z WHERE z.id = ${column} AND z.admin_role IS NULL)`;

// A ticked team of account `column` that is approved now: what a revoke changes.
const REVOCABLE = (column) => `EXISTS (SELECT 1 FROM account_teams AS x WHERE x.account_id = ${column} ` +
  "AND x.team IN (SELECT value FROM json_each(?)) AND x.state = 'approved')";

/**
 * Revoke account `accountId` for `teams` (readTeams'), the ones it is
 * approved for now, as the admin whose address is `admin`, at `now` (#225).
 * `hashKey` is the ADDRESS_HASH_KEY secret. Answers the teams it revoked, in
 * TEAMS order, or null when none of them was approved, the account holds the
 * admin role, or it is gone, in which case nothing changed. Throws when D1
 * fails. Revoking every team the account is approved for is revoking the
 * account (criterion 1).
 *
 * One D1 batch, which D1 runs as a transaction, every statement held by the
 * same condition, so they commit together or not at all and of two presses at
 * once only the first changes anything (criterion 6):
 *
 *   1. a log entry per team, made first while the condition still picks the
 *      teams out;
 *   2. the account's address as a keyed hash into revoked_addresses, so /ask
 *      holds a new request from it back, now and after a delete (criterion
 *      5; migration 0014);
 *   3. the account's session version up by 1, so every session it holds ends
 *      at its next request, and re-approving a team later cannot bring a
 *      cookie from before the revoke back (criterion 2). That holds for a
 *      single team too: the person signs in again to the teams they keep;
 *   4. the teams to `revoked`, which takes them out of the share page's
 *      albums at the next request (criterion 1).
 *
 * Nothing touches the photos the account sent: the approved ones stay public
 * (criterion 3, D17). Hiding them is hidePhotos, a separate press.
 */
export async function revokeTeams(db, { accountId, teams, hashKey, admin, now }) {
  if (typeof hashKey !== 'string' || hashKey === '') throw new Error('revokeTeams: no hashKey');
  const account = await db.prepare('SELECT email FROM accounts WHERE id = ?').bind(accountId).first();
  if (account === null) return null;
  const emailKey = await emailHash(hashKey, account.email);
  const json = JSON.stringify(teams);
  const results = await db.batch([
    db.prepare(
      'INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) ' +
      "SELECT ?, ?, 'revoke', a.id, a.name, a.email, t.name " +
      'FROM accounts AS a JOIN account_teams AS x ON x.account_id = a.id JOIN teams AS t ON t.team = x.team ' +
      'JOIN json_each(?) AS j ON j.value = x.team ' +
      "WHERE a.id = ? AND a.admin_role IS NULL AND x.state = 'approved' ORDER BY j.key",
    ).bind(now, admin, json, accountId),
    db.prepare(
      'INSERT INTO revoked_addresses (email_hash, account_id) SELECT ?, a.id FROM accounts AS a ' +
      `WHERE a.id = ? AND a.admin_role IS NULL AND ${REVOCABLE('a.id')} ` +
      'ON CONFLICT (email_hash) DO UPDATE SET account_id = excluded.account_id',
    ).bind(emailKey, accountId, json),
    db.prepare(
      'UPDATE accounts SET session_version = session_version + 1 ' +
      `WHERE id = ? AND admin_role IS NULL AND ${REVOCABLE('accounts.id')}`,
    ).bind(accountId, json),
    db.prepare(
      "UPDATE account_teams SET state = 'revoked' WHERE account_id = ? AND team IN (SELECT value FROM json_each(?)) " +
      `AND state = 'approved' AND ${NOT_ADMIN('account_teams.account_id')} RETURNING team`,
    ).bind(accountId, json),
  ]);
  const revoked = results[3].results.map(({ team }) => team);
  return revoked.length ? TEAM_KEYS.filter((team) => revoked.includes(team)) : null;
}

// The photos "Hide all their photos" takes down: every one the account sent
// that is waiting or public. A clip waits for #198, as everywhere else.
const HIDEABLE = "account_id = ? AND kind = 'photo' AND state IN ('pending', 'approved')";

/**
 * Hide every photo account `accountId` sent, waiting or public, as the admin
 * whose address is `admin`, at `now` (#225, criterion 4; D17). Answers {
 * hidden, waiting }, how many it hid and how many of those were waiting, or
 * null when there was none to hide or the account is gone, and then nothing
 * changed. Throws when D1 fails.
 *
 * Through #158's removal mechanism: each photo becomes `hidden`, as "Remove
 * this photo" makes one, with no note, so it waits on /admin/removals to be
 * put back or deleted for good, naming the account. No takedown is counted
 * against anyone's limit. A waiting photo keeps its place in that mechanism
 * by a placeholder: 0005's CHECK requires approved_at on a hidden row, so it
 * gets WAITING_WHEN_HIDDEN, 0, which no approval is ever made at, and "Put it
 * back" sends such a photo back to the queue rather than making it public
 * (lib/removals.js, restorePhoto). A photo already hidden keeps its own time
 * and note.
 *
 * One batch: the log entry, naming how many, then the change, both held by
 * the same set of photos, so of two presses at once the second finds none.
 * Any admin may press it, for any account: it takes no one's access away.
 */
export async function hidePhotos(db, { accountId, admin, now }) {
  const results = await db.batch([
    db.prepare(
      'INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) ' +
      "SELECT ?, ?, 'hide', a.id, a.name, a.email, CASE c.n WHEN 1 THEN '1 photo' ELSE c.n || ' photos' END " +
      `FROM accounts AS a, (SELECT COUNT(*) AS n FROM photos WHERE ${HIDEABLE}) AS c WHERE a.id = ? AND c.n > 0`,
    ).bind(now, admin, accountId, accountId),
    db.prepare(
      "UPDATE photos SET state = 'hidden', hidden_at = ?, hidden_note = NULL, " +
      `approved_at = CASE WHEN state = 'pending' THEN ${WAITING_WHEN_HIDDEN} ELSE approved_at END ` +
      `WHERE ${HIDEABLE} AND EXISTS (SELECT 1 FROM accounts WHERE id = ?) RETURNING approved_at`,
    ).bind(now, accountId, accountId),
  ]);
  const hidden = results[1].results;
  if (hidden.length === 0) return null;
  return { hidden: hidden.length, waiting: hidden.filter((row) => row.approved_at === WAITING_WHEN_HIDDEN).length };
}

/**
 * Delete account `accountId`, as the admin whose address is `admin`, at `now`
 * (#225, criterion 7). The route has already required the admin's word that a
 * reply from the account's own address confirms the request (the owner's
 * choice at #225's pickup, 2026-10-07): the site cannot read that reply
 * itself. Answers whether it deleted it: false when the account holds the
 * admin role or is gone, and then nothing changed. Throws when D1 fails.
 *
 * One batch: the log entry, then the photos' takedown times cut to their day,
 * then the delete, all held by the same condition. What the delete takes and
 * leaves is the schema's, as README's statement by hand is: its teams, links
 * and sign-in codes go with it (ON DELETE CASCADE); every photo it sent stays,
 * in whatever state it is in, and stops naming it (0012's ON DELETE SET NULL);
 * a revoked address's keyed hash stays, and stops naming it too (0014's), so a
 * new request from the address is still held back. The admins' log keeps
 * every entry naming the person, this one included, as /policy says.
 *
 * The takedown times are cut because "Hide all their photos" stamps one second
 * on every photo it hides and on the log's 'hide' entry, which names the
 * person. Left whole, matching hidden_at to that entry would still say which
 * photos the deleted person sent, against /policy's "they no longer record
 * which account sent them" (the owner's choice at #225's review, 2026-10-07;
 * cairn: a-timestamp-joins-to-the-log-that-names-it). Cut to the start of its
 * UTC day, a photo's hidden_at matches no entry's second. Not chosen: saying
 * so on /policy; a README step alone.
 */
export async function deleteAccount(db, { accountId, admin, now }) {
  const results = await db.batch([
    db.prepare(
      'INSERT INTO admin_log (at, admin, action, account_id, name, email) ' +
      "SELECT ?, ?, 'delete', a.id, a.name, a.email FROM accounts AS a WHERE a.id = ? AND a.admin_role IS NULL",
    ).bind(now, admin, accountId),
    db.prepare(
      `UPDATE photos SET hidden_at = hidden_at - hidden_at % ${HIDDEN_DAY_SECONDS} WHERE account_id = ? AND hidden_at IS NOT NULL ` +
      'AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND admin_role IS NULL)',
    ).bind(accountId, accountId),
    db.prepare('DELETE FROM accounts WHERE id = ? AND admin_role IS NULL RETURNING id').bind(accountId),
  ]);
  return results[2].results.length > 0;
}

// A day, in seconds: what a deleted account's photos keep of when each was
// taken down (deleteAccount).
export const HIDDEN_DAY_SECONDS = 24 * 60 * 60;

/**
 * Let the address `email`, typed by the admin whose address is `admin`, ask
 * for an account again, at `now` (#225, criterion 5's "unless the owner allows
 * it"; the owner's choice at pickup). `hashKey` is the ADDRESS_HASH_KEY
 * secret. Answers one of:
 *
 *   'allowed'    its hold is lifted: the next request from it is taken as a
 *                new one
 *   'not-held'   no revoked address has that hash, so nothing was held back
 *   'account'    the address still has an account, revoked: re-approving it
 *                on the page is how that one is taken back
 *   'unmatched'  held, but no log entry names the address as typed, so the
 *                lift could not be logged and nothing changed (an address
 *                that differs only by the case of a letter outside A to Z)
 *
 * One batch: the log entry, copying the person's id, name and address from
 * the newest entry naming them, then the lift, both held by the hold and that
 * entry. Throws when D1 fails.
 */
export async function allowAddress(db, { email, hashKey, admin, now }) {
  if (typeof hashKey !== 'string' || hashKey === '') throw new Error('allowAddress: no hashKey');
  const emailKey = await emailHash(hashKey, email);
  const held = await db.prepare('SELECT account_id FROM revoked_addresses WHERE email_hash = ?').bind(emailKey).first();
  if (held === null) return 'not-held';
  if (held.account_id !== null) return 'account';
  const named = 'EXISTS (SELECT 1 FROM admin_log WHERE email = ? COLLATE NOCASE)';
  const holds = 'EXISTS (SELECT 1 FROM revoked_addresses WHERE email_hash = ? AND account_id IS NULL)';
  const results = await db.batch([
    db.prepare(
      'INSERT INTO admin_log (at, admin, action, account_id, name, email) ' +
      `SELECT ?, ?, 'allow', l.account_id, l.name, l.email FROM admin_log AS l WHERE l.email = ? COLLATE NOCASE AND ${holds} ` +
      'ORDER BY l.id DESC LIMIT 1',
    ).bind(now, admin, email, emailKey),
    db.prepare(`DELETE FROM revoked_addresses WHERE email_hash = ? AND account_id IS NULL AND ${named} RETURNING email_hash`)
      .bind(emailKey, email),
  ]);
  if (results[1].results.length > 0) return 'allowed';
  return (await db.prepare(`SELECT ${holds} AS held`).bind(emailKey).first('held')) ? 'unmatched' : 'not-held';
}

/**
 * The email that carries a link to set a password: `teams` are every team the
 * account is approved for, and `expiresAt` when the link stops working. It
 * names no one, so nothing the requester typed is sent back to the address
 * they gave.
 */
export function linkEmail({ link, teams, expiresAt }) {
  return {
    subject: 'Your account on the Mad Cow Sailing photo site is approved',
    text: `Your request for an account on the Mad Cow Sailing photo site is approved, for ${teamsText(teams)}.\n\n` +
      `Set your password with this link. It can be used once, until ${utcText(expiresAt)}:\n\n` +
      `${link}\n\n` +
      'If the link runs out before you use it, reply to this email and one of the site\'s admins will send a new one.\n\n' +
      'If you did not ask for an account, you can ignore this email. Nothing happens unless the link is used.\n',
  };
}

// The log's detail for a link: sent, unconfirmed (Resend did not answer, so
// it may have gone), or not sent and why (lib/mail.js's reasons). An entry
// starts as `unrecorded`, committed with the link, and keeps that word if the
// outcome could not be written afterwards.
export const linkDetail = (outcome) => (outcome === 'sent' ? 'sent' : outcome === 'unreachable' ? 'unconfirmed' : `not sent: ${outcome}`);
export const UNRECORDED = 'unrecorded';

const message = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Email account `accountId` a new link to set a password, as the admin
 * `admin`, at `now`, linking to `site`. Only an account approved for a team
 * gets one. Answers 'sent', lib/mail.js's reason when the email did not go
 * ('unreachable' when Resend did not confirm it), 'unsaved' when the account
 * could not be read or the link could not be stored, so nothing was sent, or
 * null when the account holds no approved team, and nothing was done.
 *
 * Never throws: approving calls this after the approval has committed, and
 * the answer to that press is the approval, with what happened to the email
 * beside it ([[a-route-of-separate-writes-answers-from-its-last-commit]];
 * #221's review found the first lookup outside every catch).
 *
 * The link and its log entry are one D1 batch (the owner's choice at #221's
 * review), so no link exists without an entry naming the admin who issued it.
 * The entry starts `unrecorded`, and after the send one more batch settles
 * both, best-effort:
 *
 *   sent         the new link becomes the account's only one (replaceOthers)
 *   unreachable  both stay: Resend may have delivered the new one or not
 *   any refusal  the new link is deleted (dropLink), and the one the person
 *                already holds keeps working
 *
 * so a person's link dies only when a newer one reached them (#221's
 * review: makeLink used to delete it before the send was known).
 */
export async function sendLink(env, { accountId, admin, now, site }) {
  const db = env.DB;
  let results;
  try {
    ({ results } = await db
      .prepare(
        'SELECT a.id, a.name, a.email, t.team FROM accounts AS a JOIN account_teams AS t ON t.account_id = a.id ' +
        "WHERE a.id = ? AND t.state = 'approved'",
      )
      .bind(accountId)
      .all());
  } catch (err) {
    console.error('people: could not read the account to send a link to, so none was sent:', message(err));
    return 'unsaved';
  }
  if (results.length === 0) return null;
  const { name, email } = results[0];
  const teams = TEAM_KEYS.filter((team) => results.some((row) => row.team === team));

  let link;
  let logId;
  try {
    link = await newLink(db, accountId, now);
    const stored = await db.batch([
      ...link.statements,
      db.prepare("INSERT INTO admin_log (at, admin, action, account_id, name, email, detail) VALUES (?, ?, 'link', ?, ?, ?, ?) RETURNING id")
        .bind(now, admin, accountId, name, email, UNRECORDED),
    ]);
    logId = stored[link.statements.length].results[0].id;
  } catch (err) {
    console.error('people: a link to set a password could not be stored, so none was sent:', message(err));
    return 'unsaved';
  }

  const sent = await sendMail(env, { to: email, ...linkEmail({ link: passwordLink(site, link.token), teams, expiresAt: link.expiresAt }) });
  const outcome = sent.ok ? 'sent' : sent.reason;
  if (!sent.ok) console.error('people: a link to set a password was not sent:', sent.reason);
  const settle = outcome === 'sent' ? [replaceOthers(db, accountId, link.hash)]
    : outcome === 'unreachable' ? []
      : [dropLink(db, link.hash)];
  try {
    await db.batch([...settle, db.prepare('UPDATE admin_log SET detail = ? WHERE id = ?').bind(linkDetail(outcome), logId)]);
  } catch (err) {
    console.error('people: could not settle a link to set a password after its send:', message(err));
  }
  return outcome;
}

/**
 * The newest LOG_SHOWN entries of the admins' log, newest first, and how many
 * the log holds in all: { entries: [{ id, at, admin, action, accountId, name,
 * email, detail }], total }.
 */
export async function adminLog(db) {
  const [{ results }, total] = await Promise.all([
    db.prepare('SELECT id, at, admin, action, account_id, name, email, detail FROM admin_log ORDER BY id DESC LIMIT ?')
      .bind(LOG_SHOWN)
      .all(),
    db.prepare('SELECT COUNT(*) AS n FROM admin_log').first('n'),
  ]);
  return {
    entries: results.map(({ account_id: accountId, ...entry }) => ({ ...entry, accountId })),
    total,
  };
}
