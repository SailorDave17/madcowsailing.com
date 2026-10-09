/**
 * The code emailed at an admin's sign-in (#224, criterion 1; D15). An
 * account holding the admin role signs in at /sign-in with its password like
 * anyone, and is then asked for a 6-digit code the site emails to the
 * account's address for that sign-in. functions/sign-in.js starts it
 * (startCode) once the password has passed, functions/sign-in/code.js takes
 * the code (checkCode, then useCode once it has read who the code signs in),
 * and the session it opens is lib/admin-session.js's, beside the account's
 * own (owner, at #224's pickup).
 *
 * The code
 *   - is CODE_DIGITS digits, drawn evenly from crypto.getRandomValues;
 *   - belongs to the sign-in it was emailed for: the browser that typed the
 *     password holds a cookie, __Host-sign-in-code, carrying 32 random
 *     bytes, and the code's row is found by their SHA-256, so the code typed
 *     into any other browser finds nothing to check;
 *   - works once: using it clears its hash in one guarded statement
 *     (useCode), so of two posts of the right code at once only the first
 *     signs in;
 *   - lasts CODE_SECONDS, 10 minutes, and allows CODE_TRIES tries, 5, each
 *     claimed in one guarded statement before the code is checked, so tries
 *     sent at once cannot pass 5 (cairn: a-count-then-record-limit-is-not-a-limit);
 *   - is kept only as an HMAC, keyed with the SESSION_SIGNING_KEY secret,
 *     over the code and its sign-in's token hash. A 6-digit code has a
 *     million values, which a plain hash would give up to anyone who read
 *     the table; without the key the HMAC gives up nothing.
 *
 * An admin is emailed at most CODES_PER_DAY codes in any 24 hours, counted
 * from the codes' own rows, which are kept a day for that and then deleted,
 * or sooner when a new password is set (lib/sign-in.js's setPassword): the
 * reset the email and the page advise then lifts the limit at once (#224's
 * review). So someone who has an admin's password cannot spend the site's
 * 100 emails a day (Resend's free limit, CLAUDE.md item 21) on codes, nor
 * keep the admin out for longer than it takes to set a new password, and the
 * admin sees codes they did not ask for, which the email says what to do
 * about. A code whose email Resend refused is deleted at once: nobody can
 * use it, and it does not count.
 *
 * Nothing here logs a code, a token, a hash or an address.
 */
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';
import { sendMail } from './mail.js';
import { TOKEN_BYTES, isToken, tokenHash } from './password-link.js';

export const CODE_DIGITS = 6;
// Criterion 1: "expires in 10 minutes, allows 5 tries".
export const CODE_SECONDS = 10 * 60;
export const CODE_TRIES = 5;
// A day's codes for one admin. Ten covers a bad morning of typos and lost
// emails; each costs one of Resend's 100 a day.
export const CODES_PER_DAY = 10;
const DAY_SECONDS = 24 * 60 * 60;

export const CODE_COOKIE = '__Host-sign-in-code';

// The code form holds six digits, and room for the spaces a copy may bring,
// and since #274 the "Remember this phone" tick (remember=yes).
export const CODE_FORM_BYTES = 1024;

const cookieLine = (value, maxAge) =>
  `${CODE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;

/** The Set-Cookie header value tying this browser to the code made with `token`. */
export const codeCookie = (token) => cookieLine(token, CODE_SECONDS);

/** The Set-Cookie header value that deletes it. */
export const clearCodeCookie = () => cookieLine('', 0);

/** The token a request's code cookie carries, or null when it carries none of a token's shape. */
export function codeCookieToken(request) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === CODE_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return isToken(value) ? value : null;
    }
  }
  return null;
}

// The largest multiple of 10^6 a 32-bit draw can hold: a draw at or above it
// is drawn again, so every code is equally likely.
const DRAW_LIMIT = Math.floor(2 ** 32 / 10 ** CODE_DIGITS) * 10 ** CODE_DIGITS;

/**
 * A new code, CODE_DIGITS digits with leading zeros kept. `random` fills a
 * Uint32Array and returns it, as crypto.getRandomValues does; tests pass
 * their own.
 */
export function newCode(random = (values) => crypto.getRandomValues(values)) {
  for (;;) {
    const [draw] = random(new Uint32Array(1));
    if (draw < DRAW_LIMIT) return String(draw % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
  }
}

/**
 * A code as the form sends it: CODE_DIGITS ASCII digits, after taking out the
 * spaces and hyphens a phone or a copy can add. Null for anything else.
 */
export function readCode(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const code = text.replace(/[\s-]/g, '');
  return new RegExp(`^[0-9]{${CODE_DIGITS}}$`).test(code) ? code : null;
}

// What the HMAC covers: the sign-in's token hash and the code, so the same
// code under another sign-in hashes to something else.
const codeMessage = (hash, code) => `admin-code.${hash}.${code}`;

/**
 * Held on an object so a test can watch the check being made: every try that
 * claims one of the code's 5 makes exactly one.
 */
export const codeHashing = {
  verify: (secret, hash, code, stored) => hmacVerify(secret, codeMessage(hash, code), fromBase64url(stored)),
};

/**
 * The email carrying `code`, linking `site`'s reset. It names nobody, and
 * says what to do when the code was not asked for: someone else has the
 * password, and setting a new one ends every session the account holds.
 */
export function codeEmail({ code, site }) {
  return {
    subject: 'Your sign-in code for the Mad Cow Sailing photo site',
    text: `Your code to finish signing in to the Mad Cow Sailing photo site is:\n\n${code}\n\n` +
      `Type it on the page that asked for it. It works once, for the next ${CODE_SECONDS / 60} minutes, and only in the browser where you just typed your password.\n\n` +
      `If you did not just sign in, someone else knows your password. Set a new one at ${site}/forgot-password, which also signs everyone out of your account.\n`,
  };
}

const message = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Start the code step for account `accountId` at session `version`, whose
 * password has just passed: make a code, store it, and email it to `email`
 * (the account's own address), linking `site`. `random` is newCode's, and
 * fills the token's bytes too. Answers one of:
 *
 *   { outcome: 'sent', token }          the email went; the code cookie
 *                                       carries `token`
 *   { outcome: 'unconfirmed', token }   Resend did not confirm the email, so
 *                                       the code may have gone: it is kept,
 *                                       and the page says so
 *   { outcome: 'limited', retryAfter }  CODES_PER_DAY codes in the last 24
 *                                       hours: nothing made or sent
 *   { outcome: 'unsent', reason }       Resend refused the email (lib/mail.js's
 *                                       reason): the code is deleted, and does
 *                                       not count
 *
 * The code is stored before it is sent, by one statement that counts the
 * day's codes and inserts only under the limit, so sign-ins at once cannot
 * all pass it. Throws when D1 fails before anything was sent.
 */
export async function startCode(env, { accountId, version, email, now, site, random }) {
  const db = env.DB;
  const draw = random ?? ((values) => crypto.getRandomValues(values));
  const token = base64url(draw(new Uint8Array(TOKEN_BYTES)));
  const hash = await tokenHash(token);
  const code = newCode(draw);
  const codeHash = base64url(await hmac(env.SESSION_SIGNING_KEY, codeMessage(hash, code)));
  const since = now - DAY_SECONDS;

  const made = await db
    .prepare(
      'INSERT INTO admin_codes (token_hash, account_id, version, code_hash, made_at, expires_at) SELECT ?, ?, ?, ?, ?, ? ' +
      'WHERE (SELECT COUNT(*) FROM admin_codes WHERE account_id = ? AND made_at > ?) < ? RETURNING token_hash',
    )
    .bind(hash, accountId, version, codeHash, now, now + CODE_SECONDS, accountId, since, CODES_PER_DAY)
    .first('token_hash');
  if (made === null || made === undefined) {
    const oldest = await db
      .prepare('SELECT MIN(made_at) AS oldest FROM admin_codes WHERE account_id = ? AND made_at > ?')
      .bind(accountId, since)
      .first('oldest');
    return { outcome: 'limited', retryAfter: Math.max(1, (oldest ?? now) + DAY_SECONDS - now) };
  }

  const sent = await sendMail(env, { to: email, ...codeEmail({ code, site }) });
  if (!sent.ok && sent.reason !== 'unreachable') {
    // Refused: no code reached anyone, so none is kept to be guessed at, and
    // the day's count is as it was. A failure here is logged and left: the
    // code then simply runs out in its 10 minutes, unknown to anyone.
    try {
      await db.prepare('DELETE FROM admin_codes WHERE token_hash = ?').bind(hash).run();
    } catch (err) {
      console.error('admin code: could not delete a code whose email was refused:', message(err));
    }
    return { outcome: 'unsent', reason: sent.reason };
  }
  await clearExpiredCodes(db, now);
  return { outcome: sent.ok ? 'sent' : 'unconfirmed', token };
}

/**
 * Check `code` (readCode's) for the sign-in whose cookie carries `token`, at
 * `now`. Answers one of:
 *
 *   { outcome: 'right', accountId, version }  the code passed. It is not spent
 *                                             yet: useCode spends it
 *   { outcome: 'wrong', triesLeft }           not the code: one try spent, and
 *                                             at 0 the code is done with
 *   { outcome: 'ended' }                      no code left to check: used,
 *                                             expired, out of tries, refused,
 *                                             or never made, answered alike
 *
 * The try is claimed first, in one statement that adds 1 only under the
 * limit, then the code is checked. A right code is left for useCode, so the
 * route reads who it signs in before spending it: a read that fails leaves
 * the code to be tried again, where spending it first answered "try again"
 * for a code no longer there (#224's review; cairn:
 * a-route-of-separate-writes-answers-from-its-last-commit). Throws when D1
 * fails.
 */
export async function checkCode(env, { token, code, now }) {
  const db = env.DB;
  if (!isToken(token)) return { outcome: 'ended' };
  const hash = await tokenHash(token);
  const claimed = await db
    .prepare(
      'UPDATE admin_codes SET tries = tries + 1 ' +
      'WHERE token_hash = ? AND code_hash IS NOT NULL AND expires_at > ? AND tries < ? ' +
      'RETURNING account_id, version, code_hash, tries',
    )
    .bind(hash, now, CODE_TRIES)
    .first();
  if (!claimed) return { outcome: 'ended' };

  if (!(await codeHashing.verify(env.SESSION_SIGNING_KEY, hash, code, claimed.code_hash))) {
    return { outcome: 'wrong', triesLeft: CODE_TRIES - claimed.tries };
  }
  return { outcome: 'right', accountId: claimed.account_id, version: claimed.version };
}

/**
 * Spend the code of the sign-in whose cookie carries `token`, once checkCode
 * has passed it: one guarded statement clears its hash, so of two right posts
 * at once only one spends it, and the other finds it ended. Answers whether
 * this call spent it. Throws when D1 fails.
 */
export async function useCode(db, token) {
  const used = await db
    .prepare('UPDATE admin_codes SET code_hash = NULL WHERE token_hash = ? AND code_hash IS NOT NULL RETURNING account_id')
    .bind(await tokenHash(token))
    .first('account_id');
  return used !== null && used !== undefined;
}

/**
 * Delete the codes made more than a day ago, which no longer count. Each new
 * code runs this, and so does each load of the admin home, as it clears the
 * failed sign-ins (lib/sign-in.js), so a code's row is kept no longer than
 * the next admin sign-in or visit after its day. A failure is logged and
 * left: an old row counts for nothing, so only how long it is kept is at
 * stake.
 */
export async function clearExpiredCodes(db, now) {
  try {
    await db.prepare('DELETE FROM admin_codes WHERE made_at <= ?').bind(now - DAY_SECONDS).run();
  } catch (err) {
    console.error('admin code: could not clear codes more than a day old:', message(err));
  }
}
