/**
 * Requests for an account (#220), the front door of epic #216: anyone asks
 * at /ask (functions/ask.js) with a name, an email address, a role, one team
 * or both, and an optional note. The request waits for an admin, who
 * approves each team on its own (D16, #221). This holds the rules; the page
 * is lib/ask-page.js, and the tables are migration 0007.
 *
 * In front of every request, in this order (functions/ask.js):
 *   1. the site's own Origin, as every public write here checks it;
 *   2. Turnstile, verified on the server (lib/turnstile.js), so nothing below
 *      runs, and nothing is written, for a request no person sent;
 *   3. the form (readRequest), refused with the reasons when a field is wrong;
 *   4. the limits (requestAccount): REQUEST_LIMIT an hour from one network
 *      address, and REQUEST_BUDGET_PER_HOUR an hour from everyone together
 *      (owner, at #220's pickup, 2026-10-05: the join limit's and #177's
 *      figures). A request counts only once it has passed Turnstile, so a
 *      program cannot spend either for the people it is not.
 *
 * One row per email address, compared without regard to letter case. A
 * request from an address the table already holds, asking, approved,
 * rejected or revoked, writes nothing about the account, and the page
 * answers it exactly as it answers a new one, with the same statements run
 * against D1 on the way (criterion 4). The email to the admins is the one
 * thing only a new request does, and it goes out after the page has
 * answered (functions/ask.js, waitUntil), so the answer's timing does not
 * carry it either. A turned-down address that asks again writes nothing
 * too, and an admin who changes their mind approves it on /admin/people
 * instead (the owner's choice at #221's pickup, 2026-10-05). A revoked
 * address's is #225's to decide (its criterion 4).
 *
 * Nothing here logs a name, an email address, a note or a network address.
 */
import { isEmailAddress, sendMail } from './mail.js';
import { readNote } from './removals.js';
import { TEAMS } from './teams.js';

// The teams a request can name (D16), in the order the form lists them. They
// live in lib/teams.js since #227, which gave albums a team too; exported
// from here as well, where every account module has always read them.
export { TEAMS };

// The role a requester picks (criterion 1), which 0007's CHECK holds to these
// three. Not the admin role, which is accounts.admin_role (#224, migration
// 0013): an admin is still a parent, a coach or other.
export const ROLES = Object.freeze(['parent', 'coach', 'other']);

// In characters (code points), as 0007's CHECKs count them. A name of 100
// holds anyone's; the note's 500 is a takedown note's (lib/removals.js).
export const NAME_MAX = 100;
export const NOTE_MAX = 500;

// 10 requests an hour from one network address, and 100 an hour from
// everyone together: the owner's choice at #220's pickup (2026-10-05), the
// join limit's figure (#150) and #177's budget. Ten families on the club's
// Wi-Fi fit under the first. Not chosen: 5 and 30, which an email to every
// COHSSA family could hit, turning real parents away for the rest of the
// hour; 20 and 200. The address counts IPv4 whole and IPv6 by its /64
// (lib/address.js), as the join and takedown limits do.
export const REQUEST_LIMIT = 10;
export const REQUEST_WINDOW_SECONDS = 60 * 60;
export const REQUEST_BUDGET_PER_HOUR = 100;
const HOUR_SECONDS = 60 * 60;
const BUDGET_KEPT_HOURS = 24;

// The admins hear of new requests at most once an hour (criterion 5; the
// owner's choice at pickup, "the lazy hour, as written").
export const MAIL_WINDOW_SECONDS = 60 * 60;

// At most this many requests are named in one email. A name is at most 100
// characters, so 50 of the widest lines stay well under lib/mail.js's
// TEXT_MAX, which test/accounts.test.js holds; the rest wait for the next
// email, which the email says. Only a backlog meets it: the budget lets 100
// in, and the first of any hour is emailed at once.
export const LIST_MAX = 50;

// The form holds a name, an address, a role, two teams, a note of at most
// NOTE_MAX characters (each at most 12 encoded, a four-byte character or a
// line break sent as %0D%0A) and Turnstile's token of at most 2,048: room
// for all of them, with plenty to spare.
export const ASK_FORM_BYTES = 16 * 1024;

const TEAM_KEYS = TEAMS.map(({ team }) => team);
const TEAM_NAMES = Object.fromEntries(TEAMS.map(({ team, name }) => [team, name]));

// Every control character, and the two Unicode line and paragraph
// separators, which a one-line field turns into a space.
const NAME_SPACE = new RegExp(`[\\s\\p{Cc}${String.fromCharCode(0x2028, 0x2029)}]+`, 'gu');

// Unicode's bidirectional controls, which are dropped from a name: one would
// reorder how the rest of its line shows in the admins' email. The other
// format characters stay, since a zero-width non-joiner belongs in some
// names, but a name made of nothing else is no name.
const BIDI_CONTROL = /\p{Bidi_Control}/gu;
const FORMAT = /\p{Cf}/gu;

/**
 * The request in a submitted form, or the reasons it cannot be one. `form`
 * is URLSearchParams (lib/form.js's readFormParams). Returns
 * { request: { name, email, role, teams, note } } or { errors }, each error
 * { field, message } in the form's order, for the page to show beside its
 * field and in the summary above.
 *
 * A name is one line: runs of spaces, line breaks and control characters
 * become one space, the ends are trimmed, and bidirectional controls are
 * dropped; a name of only format characters is empty. An email address is
 * trimmed and must be one plain address, by lib/mail.js's rule, since the
 * site will send to it. The note is read as a takedown note is, and cut at
 * NOTE_MAX.
 */
export function readRequest(form) {
  const errors = [];
  const raw = (field) => {
    const value = form.get(field);
    return typeof value === 'string' ? value : '';
  };

  const name = raw('name').replace(BIDI_CONTROL, '').replace(NAME_SPACE, ' ').trim();
  if (name.replace(FORMAT, '').trim() === '') errors.push({ field: 'name', message: 'Enter your name.' });
  else if ([...name].length > NAME_MAX) errors.push({ field: 'name', message: `Your name can be at most ${NAME_MAX} characters.` });

  const email = raw('email').trim();
  if (email === '') errors.push({ field: 'email', message: 'Enter your email address.' });
  else if (!isEmailAddress(email)) errors.push({ field: 'email', message: 'Enter one email address, like name@example.com.' });

  const role = raw('role');
  if (!ROLES.includes(role)) errors.push({ field: 'role', message: 'Choose parent, coach or other.' });

  const asked = form.getAll('team');
  const teams = TEAM_KEYS.filter((team) => asked.includes(team));
  if (teams.length === 0 || asked.some((team) => !TEAM_KEYS.includes(team))) {
    errors.push({ field: 'team', message: 'Choose Hoover JRT, COHSSA or both.' });
  }

  if (errors.length) return { errors };
  return { request: { name, email, role, teams, note: readNote(form.get('note'), NOTE_MAX) } };
}

// How many requests this address made in the last hour, and when the oldest
// of them was, which says when the next is allowed.
async function recentRequests(db, address, since) {
  return db
    .prepare('SELECT COUNT(*) AS n, MIN(requested_at) AS oldest FROM account_request_log WHERE address_hash = ? AND requested_at > ?')
    .bind(address, since)
    .first();
}

// Whether this clock hour's budget is spent, read before anything is written,
// so a spent hour writes nothing, as #177's join budget does (the owner's
// choice at #220's review, 2026-10-05). spendBudget still decides: two
// requests can both read the last unit as free.
async function budgetSpent(db, hour) {
  const row = await db.prepare('SELECT requested FROM account_request_budget WHERE hour = ?').bind(hour).first();
  return row !== null && row.requested >= REQUEST_BUDGET_PER_HOUR;
}

/**
 * Spend one unit of this clock hour's budget, and say whether there was one.
 * One statement, as join.js's spendBudget is (#177): it makes the hour's row
 * at 1, or adds 1 while the row is under the budget, and RETURNING gives a
 * row only when it did either. Rows over a day old are deleted when a new
 * hour's row is made; that delete's failure is logged and left, since only
 * how long the old counts are kept is at stake, never this request.
 */
async function spendBudget(db, now) {
  const hour = Math.floor(now / HOUR_SECONDS);
  const spent = await db
    .prepare(
      'INSERT INTO account_request_budget (hour, requested) VALUES (?, 1) ' +
      'ON CONFLICT (hour) DO UPDATE SET requested = requested + 1 WHERE requested < ? ' +
      'RETURNING requested',
    )
    .bind(hour, REQUEST_BUDGET_PER_HOUR)
    .first();
  if (spent === null) return false;
  if (spent.requested === 1) {
    try {
      await db.prepare('DELETE FROM account_request_budget WHERE hour < ?').bind(hour - BUDGET_KEPT_HOURS).run();
    } catch (err) {
      console.error('accounts: could not delete budget rows over a day old:', err instanceof Error ? err.message : String(err));
    }
  }
  return true;
}

/**
 * Take the request `request` (readRequest's) from the network address whose
 * keyed hash is `address`, at `now`. Returns one of:
 *
 *   { outcome: 'limited', retryAfter }  REQUEST_LIMIT requests from this
 *                                       address in the last hour; nothing
 *                                       changes
 *   { outcome: 'busy', retryAfter }     the site's budget for this clock hour
 *                                       is spent; nothing changes
 *   { outcome: 'taken', created }       counted; `created` says whether the
 *                                       address was new, and an account was
 *                                       made for it
 *
 * First the site's hour is read, and a spent one answers busy having
 * written nothing. Then one unit of the address's hour is claimed by one
 * statement that counts and inserts together, as a takedown's is
 * (lib/removals.js), so two requests at once from one address cannot both
 * take its tenth. Then one unit of the site's hour is spent. If it was taken
 * between the read and the spend, or the spend fails, the address's unit
 * goes back, so a busy site costs nobody their own limit.
 *
 * The request itself is one D1 batch, which D1 runs as a transaction: the
 * account if its address is new, and its teams if the account was made just
 * now. A known address makes both statements match nothing, so a new
 * address and a known one run the same two statements. If the batch fails,
 * both units go back and the error is thrown, and nothing of the request is
 * kept. Last, the address log's rows more than an hour old are deleted, by a
 * request that counted, never by a refusal; the admin home deletes them too
 * (clearExpiredRequests).
 */
export async function requestAccount(db, { request, address, now }) {
  const hour = Math.floor(now / HOUR_SECONDS);
  const busy = { outcome: 'busy', retryAfter: Math.max(1, (hour + 1) * HOUR_SECONDS - now) };
  if (await budgetSpent(db, hour)) return busy;

  const since = now - REQUEST_WINDOW_SECONDS;
  const claimed = await db
    .prepare(
      'INSERT INTO account_request_log (address_hash, requested_at) SELECT ?, ? ' +
      'WHERE (SELECT COUNT(*) FROM account_request_log WHERE address_hash = ? AND requested_at > ?) < ? ' +
      'RETURNING rowid',
    )
    .bind(address, now, address, since, REQUEST_LIMIT)
    .first('rowid');
  if (claimed === null || claimed === undefined) {
    const recent = await recentRequests(db, address, since);
    return { outcome: 'limited', retryAfter: Math.max(1, (recent.oldest ?? now) + REQUEST_WINDOW_SECONDS - now) };
  }

  // Each give-back's own failure is logged and left, as a takedown's is: at
  // worst the address, or the site, has one fewer request for the hour.
  const giveBackClaim = async () => {
    try {
      await db.prepare('DELETE FROM account_request_log WHERE rowid = ?').bind(claimed).run();
    } catch (err) {
      console.error('accounts: could not give back a request unit:', err instanceof Error ? err.message : String(err));
    }
  };
  let spent;
  try {
    spent = await spendBudget(db, now);
  } catch (err) {
    await giveBackClaim();
    throw err;
  }
  if (!spent) {
    await giveBackClaim();
    return busy;
  }

  const { name, email, role, teams, note } = request;
  let created;
  try {
    const [account] = await db.batch([
      db.prepare(
        'INSERT INTO accounts (email, name, role, note, requested_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (email) DO NOTHING RETURNING id',
      ).bind(email, name, role, note, now),
      db.prepare(
        "INSERT INTO account_teams (account_id, team, state) SELECT a.id, t.team, 'requested' " +
        'FROM accounts AS a, teams AS t WHERE a.email = ? AND a.requested_at = ? ' +
        'AND t.team IN (SELECT value FROM json_each(?)) ' +
        'AND NOT EXISTS (SELECT 1 FROM account_teams AS x WHERE x.account_id = a.id)',
      ).bind(email, now, JSON.stringify(teams)),
    ]);
    created = account.results.length > 0;
  } catch (err) {
    await giveBackClaim();
    try {
      await db
        .prepare('UPDATE account_request_budget SET requested = requested - 1 WHERE hour = ? AND requested > 0')
        .bind(hour)
        .run();
    } catch (giveBackErr) {
      console.error('accounts: could not give back a budget unit:', giveBackErr instanceof Error ? giveBackErr.message : String(giveBackErr));
    }
    throw err;
  }

  await clearExpiredRequests(db, now);
  return { outcome: 'taken', created };
}

/**
 * Delete the address log's rows more than an hour old, which no longer count.
 * The next request that counts runs this, and so does every load of the admin
 * home, as #158's takedown log is cleared: a bound set by the next admin
 * visit, where the next request alone could keep a scrambled address for
 * months. A load with nothing expired writes no row. A failure is logged and
 * left: the rows count for nothing once they are an hour old, so only how
 * long they are kept is at stake, never the limit.
 */
export async function clearExpiredRequests(db, now) {
  try {
    await db.prepare('DELETE FROM account_request_log WHERE requested_at <= ?').bind(now - REQUEST_WINDOW_SECONDS).run();
  } catch (err) {
    console.error('accounts: could not clear requests more than an hour old:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * How many requests wait for an admin, for the admin home (criterion 5): the
 * accounts with a team still `requested`. The home is how a request that no
 * later request follows is seen, since only a request sends the email.
 */
export async function waitingRequests(db) {
  const row = await db
    .prepare("SELECT COUNT(DISTINCT account_id) AS n FROM account_teams WHERE state = 'requested'")
    .first();
  return row.n;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const listOf = (words) => (words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * The email to the admins naming `requests` ({ name, role, teams }, oldest
 * first) and how many more wait unnamed, linking `site`'s /admin/people.
 * Each request gives the name, role and teams (criterion 5) and nothing else:
 * no email address and no note, as /policy says. The subject names nobody.
 */
export function adminsEmail(requests, site, more = 0) {
  const total = requests.length + more;
  const subject = total === 1
    ? 'An account request is waiting on the photo site'
    : `${total} account requests are waiting on the photo site`;
  const lines = requests.map(({ name, role, teams }) => `- ${name}, ${role}: ${listOf(teams.map((team) => TEAM_NAMES[team]))}`);
  const rest = more ? `\n- and ${plural(more, 'more request', 'more requests')}, to be named in the next email` : '';
  const text = `${total === 1 ? 'Someone has' : `${total} people have`} asked for an account on the photo site since the last of these emails:\n\n` +
    `${lines.join('\n')}${rest}\n\n` +
    `Review ${total === 1 ? 'it' : 'them'} at ${site}/admin/people\n\n` +
    'The site sends this email at most once an hour, so a request that arrives within the hour after one waits for the next. ' +
    'The admin home always shows how many requests are waiting.\n';
  return { subject, text };
}

// The requests no email has named yet, still waiting for an admin, oldest
// first, with every team each asked for.
async function unlistedRequests(db) {
  const { results } = await db
    .prepare(
      'SELECT a.id, a.name, a.role, t.team FROM accounts AS a JOIN account_teams AS t ON t.account_id = a.id ' +
      "WHERE a.admins_emailed = 0 AND EXISTS (SELECT 1 FROM account_teams AS w WHERE w.account_id = a.id AND w.state = 'requested') " +
      'ORDER BY a.id',
    )
    .all();
  const byId = new Map();
  for (const { id, name, role, team } of results) {
    if (!byId.has(id)) byId.set(id, { id, name, role, teams: [] });
    byId.get(id).teams.push(team);
  }
  for (const request of byId.values()) request.teams.sort((a, b) => TEAM_KEYS.indexOf(a) - TEAM_KEYS.indexOf(b));
  return [...byId.values()];
}

/**
 * The address of every admin who can sign in (#224): each account holding
 * the admin role and an approved team, the owner's included, in id order.
 * The admins' email about new requests goes to these.
 */
export async function adminAddresses(db) {
  const { results } = await db
    .prepare(
      'SELECT a.email FROM accounts AS a WHERE a.admin_role IS NOT NULL ' +
      "AND EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = a.id AND t.state = 'approved') ORDER BY a.id",
    )
    .all();
  return results.map((row) => row.email);
}

/**
 * Tell the admins about new requests, at most once an hour (criterion 5; the
 * owner's choice at pickup). functions/ask.js runs this after the page has
 * answered a request that made an account. The first request emails at once
 * and opens an hour; requests inside the hour send nothing; the first request
 * after it sends one email naming every request no email has named yet. Pages
 * runs no scheduled job, so a request that no later one follows waits on the
 * admin home's count (waitingRequests).
 *
 * The hour is claimed by one statement on account_request_mail's one row,
 * so two requests at once cannot both send. Each admin gets the email, each
 * address a send of its own (lib/mail.js takes one address): since #224 the
 * accounts holding the admin role (adminAddresses), the owner's included,
 * where until then it was each address on the ADMIN_EMAILS secret, the
 * Access guard's list, which nothing reads now. Once at least one admin's
 * email is sent, the requests it names are marked as named. If none is sent,
 * the hour is given back and the requests stay unnamed, so the next request
 * tries again: an email that never went cannot be "the last one". With no
 * admin at all, no hour is claimed. An admin can be named a request twice
 * when Resend times out on a send it made, which is better than never.
 *
 * Never throws: it runs after the answer, where nobody would see an error.
 * Returns what happened, for the tests: 'waiting' (inside the hour),
 * 'nothing' (no unnamed request), 'no-admins', 'unsent', 'sent' or 'failed'.
 */
export async function mailAdmins(env, { now, site }) {
  const db = env.DB;
  let admins;
  try {
    admins = await adminAddresses(db);
  } catch (err) {
    console.error('accounts: could not read who the admins are, so none was emailed about new requests:', err instanceof Error ? err.message : String(err));
    return { outcome: 'failed' };
  }
  if (admins.length === 0) {
    console.error('accounts: no account holds the admin role, so no admin was emailed about new requests');
    return { outcome: 'no-admins' };
  }

  // Set once the hour is claimed, and once an email has gone: a failure after
  // that must not give the hour back, or a second email could follow at once.
  let claimed = false;
  let delivered = false;
  const release = async () => {
    // Back to a time an hour gone, which the next claim reads as open.
    await db
      .prepare('UPDATE account_request_mail SET sent_at = ? WHERE id = 1 AND sent_at = ?')
      .bind(now - MAIL_WINDOW_SECONDS, now)
      .run();
  };
  try {
    claimed = (await db
      .prepare(
        'INSERT INTO account_request_mail (id, sent_at) VALUES (1, ?) ' +
        'ON CONFLICT (id) DO UPDATE SET sent_at = excluded.sent_at WHERE sent_at <= ? ' +
        'RETURNING sent_at',
      )
      .bind(now, now - MAIL_WINDOW_SECONDS)
      .first()) !== null;
    if (!claimed) return { outcome: 'waiting' };

    const unlisted = await unlistedRequests(db);
    if (unlisted.length === 0) {
      await release();
      return { outcome: 'nothing' };
    }

    const named = unlisted.slice(0, LIST_MAX);
    const message = adminsEmail(named, site, unlisted.length - named.length);
    let sent = 0;
    for (const to of admins) {
      const result = await sendMail(env, { to, ...message });
      if (result.ok) sent += 1;
      else console.error('accounts: an email to an admin about new requests was not sent:', result.reason);
    }
    if (sent === 0) {
      await release();
      return { outcome: 'unsent' };
    }
    delivered = true;
    await db
      .prepare('UPDATE accounts SET admins_emailed = 1 WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(named.map(({ id }) => id)))
      .run();
    return { outcome: 'sent', named: named.length, sent };
  } catch (err) {
    console.error('accounts: emailing the admins about new requests failed:', err instanceof Error ? err.message : String(err));
    if (claimed && !delivered) {
      try {
        await release();
      } catch {
        // The database that just failed may fail again; the hour then closes
        // on its own, and the requests stay unnamed for the next email.
      }
    }
    return { outcome: 'failed' };
  }
}
