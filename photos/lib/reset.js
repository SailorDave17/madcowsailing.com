/**
 * Resetting a forgotten password (#222, criterion 5). Anyone asks at
 * /forgot-password (functions/forgot-password.js) with an email address. If
 * the address belongs to an account approved for a team, the site emails it
 * a link to /set-password, which works once and for RESET_SECONDS, and is
 * kept only as a hash in password_links, beside the links an approval sends
 * (lib/password-link.js, #221). The link sets a new password whether or not
 * the account had one, so it also serves someone whose first link ran out.
 *
 * The page answers the same whether or not the address has an account: the
 * same 303, after the same statements. Whether an email goes is decided
 * after the answer (functions/forgot-password.js, waitUntil), so how long
 * the answer took says nothing either.
 *
 * In front of every request, in this order (the owner's choice at #222's
 * pickup, 2026-10-06):
 *   1. the site's own Origin;
 *   2. Turnstile (lib/turnstile.js), as /ask has it, since a reset spends
 *      Resend's 100 emails a day, which every email the site sends shares;
 *   3. RESET_REQUEST_LIMIT requests an hour from one network address, by
 *      lib/address.js's keyed hash.
 * Then, after the answer (sendReset), the email goes only when:
 *   - the address has an account approved for a team;
 *   - no link the account still holds was made in the last
 *     RESET_GAP_SECONDS, checked by the link's own insert, so resets sent at
 *     once cannot all pass (#222's review). A link that has been used is
 *     gone, so a person who used one can ask again at once;
 *   - fewer than RESET_EMAILS_PER_DAY reset emails went today (UTC, Resend's
 *     day), so resets never spend more than a fifth of the day's 100. The
 *     unit is spent only once the link is stored, and given back when Resend
 *     refuses the email.
 *
 * A reset link does not replace the approval link the person may still hold:
 * both stay live, each single-use, and setting a password with either ends
 * both (lib/sign-in.js's setPassword). The other way round is not so: once an
 * admin's "Send a new link" email goes, lib/people.js's sendLink deletes every
 * other link the account holds (replaceOthers), a reset link included, and
 * the newer link sets a password just as well. Nothing here writes to the
 * admins' log, which records what admins do.
 *
 * Nothing here logs an email address, a token, a hash or a network address.
 */
import { sendMail } from './mail.js';
import { dropLink, newLink, passwordLink } from './password-link.js';
import { utcText } from './admin-page.js';

// The owner's choices at #222's pickup, 2026-10-06. Not chosen: 24 hours.
export const RESET_SECONDS = 60 * 60;
export const RESET_REQUEST_LIMIT = 10;
export const RESET_REQUEST_WINDOW_SECONDS = 60 * 60;
export const RESET_GAP_SECONDS = 15 * 60;
export const RESET_EMAILS_PER_DAY = 20;
const DAY_SECONDS = 24 * 60 * 60;
const BUDGET_KEPT_DAYS = 7;

// The form holds an address and Turnstile's token of at most 2,048.
export const RESET_FORM_BYTES = 4 * 1024;

/**
 * Claim one unit of this network's hour, by `address` (its keyed hash), at
 * `now`: one statement that counts and inserts together, as a request for an
 * account claims its unit (lib/accounts.js), so two requests at once cannot
 * both take the tenth. Answers null when it was claimed, or how many seconds
 * until the next one is allowed. A claim also deletes the log's rows more
 * than an hour old.
 */
export async function claimResetRequest(db, address, now) {
  const since = now - RESET_REQUEST_WINDOW_SECONDS;
  const claimed = await db
    .prepare(
      'INSERT INTO reset_request_log (address_hash, requested_at) SELECT ?, ? ' +
      'WHERE (SELECT COUNT(*) FROM reset_request_log WHERE address_hash = ? AND requested_at > ?) < ? RETURNING rowid',
    )
    .bind(address, now, address, since, RESET_REQUEST_LIMIT)
    .first('rowid');
  if (claimed === null || claimed === undefined) {
    const oldest = await db
      .prepare('SELECT MIN(requested_at) AS oldest FROM reset_request_log WHERE address_hash = ? AND requested_at > ?')
      .bind(address, since)
      .first('oldest');
    return Math.max(1, (oldest ?? now) + RESET_REQUEST_WINDOW_SECONDS - now);
  }
  await clearExpiredResetRequests(db, now);
  return null;
}

/**
 * Delete the reset requests' rows more than an hour old. A claim runs this,
 * and so does each load of the admin home. A failure is logged and left: the
 * rows count for nothing once they are an hour old.
 */
export async function clearExpiredResetRequests(db, now) {
  try {
    await db.prepare('DELETE FROM reset_request_log WHERE requested_at <= ?').bind(now - RESET_REQUEST_WINDOW_SECONDS).run();
  } catch (err) {
    console.error('reset: could not clear requests more than an hour old:', err instanceof Error ? err.message : String(err));
  }
}

/** The reset email: the link, and until when it works. It names no one. */
export function resetEmail({ link, expiresAt }) {
  return {
    subject: 'Reset your password on the Mad Cow Sailing photo site',
    text: 'Someone asked to reset the password for this email address on the Mad Cow Sailing photo site.\n\n' +
      `Set a new password with this link. It can be used once, until ${utcText(expiresAt)}:\n\n` +
      `${link}\n\n` +
      'If you did not ask, you can ignore this email. Your password stays as it is unless the link is used.\n',
  };
}

const message = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Email a reset link to `email`, at `now`, linking to `site`, when every
 * condition above holds. Never throws: functions/forgot-password.js runs it
 * after the page has answered, where nobody would see an error. Answers what
 * happened, for the tests: 'no-account', 'recent', 'budget', 'unsaved',
 * 'sent', or lib/mail.js's reason when the email did not go ('unreachable'
 * when Resend did not confirm it).
 *
 * The link is stored first, by one statement that inserts it only when the
 * account holds no link made in the last RESET_GAP_SECONDS, so of several
 * resets at once only one gets a link. Then the day's unit is spent, in one
 * statement, so two resets at once cannot both take the twentieth; a spent
 * day deletes the new link. Nothing is spent for a link that could not be
 * stored. A send Resend refused gives its unit back and deletes its link
 * (dropLink), so a link nobody received opens nothing; an unconfirmed one
 * keeps both, since Resend may have delivered it.
 */
export async function sendReset(env, { email, now, site }) {
  const db = env.DB;
  const day = Math.floor(now / DAY_SECONDS);
  let account;
  try {
    account = await db
      .prepare(
        'SELECT a.id FROM accounts AS a ' +
        "WHERE a.email = ? AND EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = a.id AND t.state = 'approved')",
      )
      .bind(email)
      .first();
  } catch (err) {
    console.error('reset: could not read the account, so no link was sent:', message(err));
    return 'unsaved';
  }
  if (!account) return 'no-account';

  // newLink makes the token and its hash; its own statements are not used,
  // since this insert carries the gap.
  let link;
  try {
    link = await newLink(db, account.id, now, { seconds: RESET_SECONDS });
    const [, stored] = await db.batch([
      db.prepare('DELETE FROM password_links WHERE expires_at <= ?').bind(now),
      db.prepare(
        'INSERT INTO password_links (token_hash, account_id, made_at, expires_at) SELECT ?, ?, ?, ? ' +
        'WHERE NOT EXISTS (SELECT 1 FROM password_links WHERE account_id = ? AND made_at > ?) RETURNING token_hash',
      ).bind(link.hash, account.id, now, link.expiresAt, account.id, now - RESET_GAP_SECONDS),
    ]);
    if (stored.results.length === 0) return 'recent';
  } catch (err) {
    console.error('reset: a reset link could not be stored, so none was sent:', message(err));
    return 'unsaved';
  }

  const drop = async (why) => {
    try {
      await db.batch([dropLink(db, link.hash)]);
    } catch (err) {
      console.error(`reset: could not delete a reset link that was not sent (${why}):`, message(err));
    }
  };
  let spent;
  try {
    spent = await db
      .prepare(
        'INSERT INTO reset_mail_budget (day, sent) VALUES (?, 1) ' +
        'ON CONFLICT (day) DO UPDATE SET sent = sent + 1 WHERE sent < ? RETURNING sent',
      )
      .bind(day, RESET_EMAILS_PER_DAY)
      .first();
  } catch (err) {
    console.error('reset: the count for the day could not be read, so no link was sent:', message(err));
    await drop('unsaved');
    return 'unsaved';
  }
  if (spent === null) {
    console.error('reset: every reset email for the day is spent, so no link was sent');
    await drop('budget');
    return 'budget';
  }
  if (spent.sent === 1) {
    try {
      await db.prepare('DELETE FROM reset_mail_budget WHERE day < ?').bind(day - BUDGET_KEPT_DAYS).run();
    } catch (err) {
      console.error('reset: could not delete budget rows over a week old:', message(err));
    }
  }

  const sent = await sendMail(env, { to: email, ...resetEmail({ link: passwordLink(site, link.token), expiresAt: link.expiresAt }) });
  if (sent.ok) return 'sent';
  console.error('reset: a reset link was not sent:', sent.reason);
  if (sent.reason !== 'unreachable') {
    try {
      await db.batch([
        dropLink(db, link.hash),
        db.prepare('UPDATE reset_mail_budget SET sent = sent - 1 WHERE day = ? AND sent > 0').bind(day),
      ]);
    } catch (err) {
      console.error('reset: could not drop an unsent reset link:', message(err));
    }
  }
  return sent.reason;
}
