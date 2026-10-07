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

const TEAM_KEYS = TEAMS.map(({ team }) => team);
const TEAM_NAMES = Object.fromEntries(TEAMS.map(({ team, name }) => [team, name]));

// What the log records, and what each word means on the page
// (lib/people-page.js). #224 added promote and demote, and #225 adds its own;
// 0008's CHECK holds only the shape, so adding one needs no migration.
export const ACTIONS = Object.freeze(['approve', 'reject', 'role', 'link', 'promote', 'demote']);

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
 * note, requestedAt, teams: [{ team, name, state }] in TEAMS order }, sorted
 * into the three lists the page shows, each in the order the requests
 * arrived. adminRole is 'admin', 'owner' or null (#224).
 *
 *   waiting     a team still waits for an admin
 *   approved    nothing waits, and a team is approved
 *   turnedDown  nothing waits or is approved, and a team was turned down
 *
 * An account whose every team is revoked is in none of them; #225 shows it.
 */
export async function peopleLists(db) {
  const { results } = await db
    .prepare(
      'SELECT a.id, a.name, a.email, a.role, a.admin_role, a.note, a.requested_at, t.team, t.state ' +
      'FROM accounts AS a JOIN account_teams AS t ON t.account_id = a.id ORDER BY a.requested_at, a.id',
    )
    .all();
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
      });
    }
    byId.get(row.id).teams.push({ team: row.team, name: TEAM_NAMES[row.team] ?? row.team, state: row.state });
  }
  const lists = { waiting: [], approved: [], turnedDown: [] };
  for (const person of byId.values()) {
    person.teams.sort((a, b) => TEAM_KEYS.indexOf(a.team) - TEAM_KEYS.indexOf(b.team));
    const has = (state) => person.teams.some((t) => t.state === state);
    if (has('requested')) lists.waiting.push(person);
    else if (has('approved')) lists.approved.push(person);
    else if (has('rejected')) lists.turnedDown.push(person);
  }
  return lists;
}

// The states a decision may change a team from: approving takes a waiting
// team or a turned-down one, turning down a waiting team only.
const DECIDABLE = {
  approve: "state IN ('requested', 'rejected')",
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
