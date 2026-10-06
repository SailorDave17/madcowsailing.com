/**
 * Signing in, signing out and setting a password (#222), for the accounts
 * the admins approve on /admin/people (#221). functions/sign-in.js,
 * functions/sign-out.js and functions/set-password.js are the routes, and
 * lib/account-session.js the cookie. CLAUDE.md, The photo site, item 27 has
 * the decisions.
 *
 * Sign-in takes one path for every failure (criterion 2). An address with no
 * account, a wrong password, an account not yet approved, one with no
 * password yet, and one whose password has stopped working (FAILED_IN_A_ROW)
 * each run the same statements against D1, in the same order, and each
 * checks the typed password against a scrypt hash: the account's own, or
 * STAND_IN_HASH where there is none to check. So none answers sooner than
 * another, and all of them get the same page.
 *
 * Failed sign-ins are limited three ways (criterion 3; the owner's choice at
 * pickup, 2026-10-06):
 *   - EMAIL_FAILURE_LIMIT an hour for one email address, counted by a keyed
 *     hash of the address as typed, so an address with no account is counted
 *     exactly as one with an account is;
 *   - NETWORK_FAILURE_LIMIT an hour from one network, by lib/address.js's
 *     keyed hash, as every limit here counts a network;
 *   - FAILURE_BUDGET_PER_HOUR recorded failures an hour for the whole site,
 *     which bounds what failed sign-ins can spend of D1's writes and of the
 *     CPU a hash takes. Once it is spent, nobody can sign in until the hour
 *     turns, and nothing is written; a session already open keeps working.
 * Every limit is claimed, in a guarded statement of its own, before the
 * password is hashed, so a refused try costs no hash and tries sent at once
 * cannot all pass (signIn says how). Past them, NIST's cap: after
 * FAILED_IN_A_ROW failures in a row an account's password stops working until
 * a new one is set from an emailed link, and a sign-in that succeeds sets the
 * count back to 0 and forgets that address's failed tries (NIST SP 800-63B-4,
 * section 3.2.2).
 *
 * Nothing here logs a password, a hash, an email address, a token or a
 * network address.
 */
import { tokenHash } from './password-link.js';
import { verifyPassword } from './password.js';
import { base64url, hmac } from './crypto.js';

export const EMAIL_FAILURE_LIMIT = 10;
export const NETWORK_FAILURE_LIMIT = 20;
export const FAILURE_WINDOW_SECONDS = 60 * 60;
export const FAILURE_BUDGET_PER_HOUR = 100;
// NIST SP 800-63B-4, section 3.2.2: "SHALL limit consecutive failed
// authentication attempts ... to no more than 100 by disabling that
// authenticator".
export const FAILED_IN_A_ROW = 100;
const HOUR_SECONDS = 60 * 60;
const BUDGET_KEPT_HOURS = 24;

// The sign-in form holds an address (254 characters at most) and a password
// (lib/password-rules.js's PASSWORD_MAX of 256 characters, each at most 12
// encoded).
export const SIGN_IN_FORM_BYTES = 8 * 1024;

// The set-password form holds two passwords and a token, and is read with
// room for passwords well past PASSWORD_MAX, so a person who pastes one too
// long is told so, not shown the dead-link page, which an unread form gave
// (#222's review). The form has no maxlength: it would count UTF-16 units
// and refuse some passwords the rule allows.
export const SET_PASSWORD_FORM_BYTES = 64 * 1024;

// A scrypt hash at lib/password.js's SCRYPT, made once from 32 random bytes
// nobody kept. Sign-in checks the typed password against it whenever there
// is no real hash to check, so that path costs what a wrong password costs.
// test/sign-in.test.js holds its parameters to SCRYPT's.
export const STAND_IN_HASH = '$scrypt$ln=14,r=8,p=5$67BxZSEy3B4+7snz6T8g0g$oW+rSfXQ6FDiGIwnnzh3Xvy6VbVMAmK7pPRPvyMXIH8';

/**
 * Held on an object so a test can count the checks: every sign-in that gets
 * past the limits makes exactly one (test/sign-in.test.js).
 */
export const hashing = { verify: verifyPassword };

// What an email address is hashed with, ahead of the address, so its hash can
// never equal lib/address.js's hash of a network address.
const EMAIL_CONTEXT = 'sign-in-email:';

/** The keyed hash failed sign-ins count an email address by: lowercased, trimmed. */
export async function emailHash(secret, email) {
  return base64url(await hmac(secret, `${EMAIL_CONTEXT}${email.trim().toLowerCase()}`));
}

const retryFrom = (oldest, now) => Math.max(1, (oldest ?? now) + FAILURE_WINDOW_SECONDS - now);

// Whether this clock hour's budget is spent, read before anything is written,
// so a spent hour writes nothing, as lib/accounts.js's is read.
async function budgetSpent(db, hour) {
  const row = await db.prepare('SELECT failed FROM sign_in_budget WHERE hour = ?').bind(hour).first();
  return row !== null && row.failed >= FAILURE_BUDGET_PER_HOUR;
}

// Spend one unit of this clock hour's budget in one statement, as
// lib/accounts.js's spendBudget does, and say whether there was one. Rows over
// a day old go when a new hour's row is made; that delete's failure is logged
// and left.
async function spendBudget(db, now) {
  const hour = Math.floor(now / HOUR_SECONDS);
  const spent = await db
    .prepare(
      'INSERT INTO sign_in_budget (hour, failed) VALUES (?, 1) ' +
      'ON CONFLICT (hour) DO UPDATE SET failed = failed + 1 WHERE failed < ? RETURNING failed',
    )
    .bind(hour, FAILURE_BUDGET_PER_HOUR)
    .first();
  if (spent === null) return false;
  if (spent.failed === 1) {
    try {
      await db.prepare('DELETE FROM sign_in_budget WHERE hour < ?').bind(hour - BUDGET_KEPT_HOURS).run();
    } catch (err) {
      console.error('sign-in: could not delete budget rows over a day old:', err instanceof Error ? err.message : String(err));
    }
  }
  return true;
}

const message = (err) => (err instanceof Error ? err.message : String(err));

// Run each give-back, logging and leaving its own failure: at worst a unit
// stays spent until its hour is up.
async function giveBack(steps) {
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      console.error('sign-in: could not give back a unit:', message(err));
    }
  }
}

/**
 * Sign in with `email` and `password` (NFC already, lib/password-rules.js's
 * normalizePassword), from the network whose keyed hash is `address`, at
 * `now`. `emailKey` is emailHash(ADDRESS_HASH_KEY, email). Returns one of:
 *
 *   { outcome: 'signed-in', accountId, version }  the session to open
 *   { outcome: 'refused' }                         any failure, one answer
 *   { outcome: 'limited', scope, retryAfter }      EMAIL_FAILURE_LIMIT for
 *                                                  this address ('email'), or
 *                                                  NETWORK_FAILURE_LIMIT from
 *                                                  this network ('network'),
 *                                                  in the last hour; no hash,
 *                                                  nothing written
 *   { outcome: 'busy', retryAfter }                the site's hour is spent;
 *                                                  no hash
 *
 * Every unit a try needs is claimed before the password is checked, each in
 * one guarded statement, so tries sent at once cannot all read a limit as
 * free (the owner's choice at #222's review, after a burst of 150 checked
 * 150 guesses against the read-then-write first build):
 *
 *   1. the site's hour is read, and a spent one answers busy having written
 *      nothing;
 *   2. the try claims its address's and its network's units together: one
 *      INSERT ... SELECT that counts both and inserts only under both limits,
 *      as lib/reset.js's claimResetRequest and lib/accounts.js claim theirs.
 *      Its row is the failure's record if the password turns out wrong;
 *   3. the try spends one unit of the site's hour (spendBudget); losing it to
 *      another try gives the claim back and answers busy;
 *   4. the account's failures in a row go up by 1, before the check, so the
 *      100th try in a row is the last one checked (NIST's cap), whatever
 *      arrives at once. For an address with no account it matches no row
 *      and runs all the same.
 *
 * Only then is the password checked, against the account's hash or
 * STAND_IN_HASH. A sign-in that succeeds gives everything back: its
 * address's failed tries are forgotten (NIST's "SHOULD disregard any
 * previous failed attempts"), the count in a row goes to 0, and the hour's
 * unit is returned, since the budget counts failures. A failure keeps all
 * three. Throws when D1 fails, having given back what the try had claimed.
 */
export async function signIn(db, { email, password, emailKey, address, now }) {
  const hour = Math.floor(now / HOUR_SECONDS);
  const busy = { outcome: 'busy', retryAfter: Math.max(1, (hour + 1) * HOUR_SECONDS - now) };
  if (await budgetSpent(db, hour)) return busy;

  const since = now - FAILURE_WINDOW_SECONDS;
  const claimed = await db
    .prepare(
      'INSERT INTO sign_in_failures (email_hash, address_hash, failed_at) SELECT ?, ?, ? ' +
      'WHERE (SELECT COUNT(*) FROM sign_in_failures WHERE email_hash = ? AND failed_at > ?) < ? ' +
      'AND (SELECT COUNT(*) FROM sign_in_failures WHERE address_hash = ? AND failed_at > ?) < ? RETURNING rowid',
    )
    .bind(emailKey, address, now, emailKey, since, EMAIL_FAILURE_LIMIT, address, since, NETWORK_FAILURE_LIMIT)
    .first('rowid');
  if (claimed === null || claimed === undefined) {
    const counts = await db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM sign_in_failures WHERE email_hash = ? AND failed_at > ?) AS by_email, ' +
        '(SELECT MIN(failed_at) FROM sign_in_failures WHERE email_hash = ? AND failed_at > ?) AS email_oldest, ' +
        '(SELECT MIN(failed_at) FROM sign_in_failures WHERE address_hash = ? AND failed_at > ?) AS network_oldest',
      )
      .bind(emailKey, since, emailKey, since, address, since)
      .first();
    return counts.by_email >= EMAIL_FAILURE_LIMIT
      ? { outcome: 'limited', scope: 'email', retryAfter: retryFrom(counts.email_oldest, now) }
      : { outcome: 'limited', scope: 'network', retryAfter: retryFrom(counts.network_oldest, now) };
  }

  const unclaim = () => db.prepare('DELETE FROM sign_in_failures WHERE rowid = ?').bind(claimed).run();
  let spent;
  try {
    spent = await spendBudget(db, now);
  } catch (err) {
    await giveBack([unclaim]);
    throw err;
  }
  if (!spent) {
    await giveBack([unclaim]);
    return busy;
  }
  const unspend = () => db.prepare('UPDATE sign_in_budget SET failed = failed - 1 WHERE hour = ? AND failed > 0').bind(hour).run();

  let inARow;
  let account;
  let matched;
  try {
    inARow = await db
      .prepare('UPDATE accounts SET failed_sign_ins = failed_sign_ins + 1 WHERE email = ? RETURNING failed_sign_ins')
      .bind(email)
      .first('failed_sign_ins');
    account = await db
      .prepare(
        'SELECT a.id, a.password_hash, a.session_version, ' +
        "EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = a.id AND t.state = 'approved') AS approved " +
        'FROM accounts AS a WHERE a.email = ?',
      )
      .bind(email)
      .first();
    const usable = account !== null && account.approved === 1 && account.password_hash !== null
      && typeof inARow === 'number' && inARow <= FAILED_IN_A_ROW;
    matched = usable && (await hashing.verify(password, account.password_hash));
    if (!usable) await hashing.verify(password, STAND_IN_HASH);
  } catch (err) {
    await giveBack([
      unclaim,
      unspend,
      () => db.prepare('UPDATE accounts SET failed_sign_ins = failed_sign_ins - 1 WHERE email = ? AND failed_sign_ins > 0').bind(email).run(),
    ]);
    throw err;
  }

  if (matched) {
    // A failure here is logged and left: the person is who they said, and
    // the rows go within the hour anyway.
    try {
      await db.batch([
        db.prepare('DELETE FROM sign_in_failures WHERE email_hash = ?').bind(emailKey),
        db.prepare('UPDATE accounts SET failed_sign_ins = 0 WHERE id = ?').bind(account.id),
        db.prepare('UPDATE sign_in_budget SET failed = failed - 1 WHERE hour = ? AND failed > 0').bind(hour),
      ]);
    } catch (err) {
      console.error('sign-in: could not give back the units after a sign-in:', message(err));
    }
    return { outcome: 'signed-in', accountId: account.id, version: account.session_version };
  }

  // The tries more than an hour old count for nothing now.
  try {
    await db.prepare('DELETE FROM sign_in_failures WHERE failed_at <= ?').bind(since).run();
  } catch (err) {
    console.error('sign-in: could not clear failed sign-ins more than an hour old:', message(err));
  }
  return { outcome: 'refused' };
}

/**
 * Delete the failed sign-ins more than an hour old, which no longer count.
 * The next recorded failure deletes them too; each load of the admin home
 * runs this, as it clears the request log (lib/accounts.js), so a scrambled
 * address is kept no longer than the next admin visit even when no one fails
 * to sign in again. A failure is logged and left.
 */
export async function clearExpiredSignIns(db, now) {
  try {
    await db.prepare('DELETE FROM sign_in_failures WHERE failed_at <= ?').bind(now - FAILURE_WINDOW_SECONDS).run();
  } catch (err) {
    console.error('sign-in: could not clear failed sign-ins more than an hour old:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * The account a link to set a password opens, with what the form needs:
 * { id, name, email, hasPassword }, or null when it is not approved for a
 * team. The link itself is lib/password-link.js's linkAccount.
 */
export async function linkedAccount(db, accountId) {
  const row = await db
    .prepare(
      'SELECT a.id, a.name, a.email, a.password_hash IS NOT NULL AS has_password FROM accounts AS a ' +
      "WHERE a.id = ? AND EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = a.id AND t.state = 'approved')",
    )
    .bind(accountId)
    .first();
  return row ? { id: row.id, name: row.name, email: row.email, hasPassword: row.has_password === 1 } : null;
}

/**
 * Set account `accountId`'s password to the hash `passwordHash`, using the
 * link `token`, at `now`. One D1 batch, which D1 runs as a transaction, and
 * every statement in it holds only while that link is still the account's,
 * unexpired, and the account is approved for a team:
 *
 *   1. the hash is stored, the session version goes up by 1, which ends
 *      every session the account holds (criterion 4), and its failures in a
 *      row go back to 0, which turns a stopped password back on (NIST's
 *      "rebind");
 *   2. its email address's failed sign-ins are forgotten (`emailKey`);
 *   3. every link the account holds is deleted, this one with it, so a link
 *      works once and setting a password ends the rest (criterion 5).
 *
 * Answers the new session version, or null when the link was not the
 * account's to use any more: used, replaced, expired, or the account no
 * longer approved. Then nothing changed. Of two uses of one link at once,
 * only the first changes anything (test/sign-in.test.js). Throws when D1
 * fails.
 *
 * Not lib/password-link.js's spendLink, which #221 built for this: a delete
 * of its own, it would spend the link before the password was stored, so a
 * failed store would lose the person's link.
 */
export async function setPassword(db, { accountId, token, passwordHash, emailKey, now }) {
  const hash = await tokenHash(token);
  const held = 'EXISTS (SELECT 1 FROM password_links AS l WHERE l.token_hash = ? AND l.account_id = ? AND l.expires_at > ?) ' +
    "AND EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = ? AND t.state = 'approved')";
  const holds = [hash, accountId, now, accountId];
  const [stored] = await db.batch([
    db.prepare(
      'UPDATE accounts SET password_hash = ?, session_version = session_version + 1, failed_sign_ins = 0 ' +
      `WHERE id = ? AND ${held} RETURNING session_version`,
    ).bind(passwordHash, accountId, ...holds),
    db.prepare(`DELETE FROM sign_in_failures WHERE email_hash = ? AND ${held}`).bind(emailKey, ...holds),
    db.prepare(`DELETE FROM password_links WHERE account_id = ? AND ${held}`).bind(accountId, ...holds),
  ]);
  return stored.results[0]?.session_version ?? null;
}

/**
 * Sign out: end every session the account holds, on every device (the
 * owner's choice at #222's pickup, 2026-10-06), by adding 1 to its session
 * version, only while it still holds the version the cookie names. Answers
 * whether it did; false when the session had already ended, which leaves
 * nothing to end. Throws when D1 fails.
 */
export async function signOut(db, { accountId, version }) {
  const { meta } = await db
    .prepare('UPDATE accounts SET session_version = session_version + 1 WHERE id = ? AND session_version = ?')
    .bind(accountId, version)
    .run();
  return meta.changes === 1;
}
