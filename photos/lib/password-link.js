/**
 * The link an approved person sets a password with (#221, criterion 2).
 *
 * Approving a request on /admin/people emails the person a link to
 * /set-password carrying a token: 32 random bytes, 43 characters of base64url.
 * The database keeps only the token's SHA-256 (password_links, migration
 * 0008), so neither a copy of the table nor anyone reading it can open the
 * link. A link lasts LINK_SECONDS and works once.
 *
 * A newer link replaces the account's earlier one only once its email has
 * gone; a send that is refused deletes the newer one instead, so the link a
 * person already holds never dies for an email that never reached them
 * (#221's review). lib/people.js's sendLink makes that call.
 *
 * Opening the link changes nothing: functions/set-password.js only checks it
 * (linkAccount), so a mail scanner that fetches every link in an email cannot
 * use it up. Using it is spendLink, which deletes the row as it reads it.
 * Setting the password is #222's, and that is what will call spendLink; until
 * then a valid link's page says the account is approved and that setting a
 * password is coming (the owner's choice at #221's pickup, 2026-10-05).
 *
 * The token rides in the query string, so the page can answer without
 * JavaScript. The site's Referrer-Policy, strict-origin-when-cross-origin,
 * sends another site the origin alone, never the query.
 *
 * Nothing here logs a token, a hash or an address.
 */
import { base64url, sha256 } from './crypto.js';

// 7 days: the owner's choice at #221's pickup (2026-10-05). A parent who reads
// email once a week still gets in, and a new link covers anyone slower. Not
// chosen: 24 hours, 72 hours, 14 days.
export const LINK_SECONDS = 7 * 24 * 60 * 60;

export const TOKEN_BYTES = 32;

// 32 bytes of base64url with no padding is exactly 43 characters.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Whether `text` has a token's shape. Never throws. */
export const isToken = (text) => typeof text === 'string' && TOKEN.test(text);

/** The hash a token is kept as: its SHA-256, in base64url. */
export const tokenHash = async (token) => base64url(await sha256(token));

/** The link to /set-password on `site` carrying `token`. */
export const passwordLink = (site, token) => `${site}/set-password?token=${token}`;

/**
 * A new link for account `accountId` at `now`, not yet stored: its token, the
 * hash it is kept as, when it expires, and the statements that store it, for
 * a caller to run in a D1 batch beside its own (lib/people.js's sendLink puts
 * the admins' log entry in the same one). The statements delete every expired
 * link in the table, then insert the new hash. They leave the account's
 * earlier links alone: whether the new one replaces them depends on whether
 * its email goes (replaceOthers, dropLink). `random` fills a Uint8Array and
 * returns it, as crypto.getRandomValues does; tests pass their own.
 */
export async function newLink(db, accountId, now, random = (bytes) => crypto.getRandomValues(bytes)) {
  const token = base64url(random(new Uint8Array(TOKEN_BYTES)));
  const hash = await tokenHash(token);
  const expiresAt = now + LINK_SECONDS;
  return {
    token,
    hash,
    expiresAt,
    statements: [
      db.prepare('DELETE FROM password_links WHERE expires_at <= ?').bind(now),
      db.prepare('INSERT INTO password_links (token_hash, account_id, made_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(hash, accountId, now, expiresAt),
    ],
  };
}

/**
 * Store a new link for account `accountId` at `now` on its own, and answer
 * its token and when it expires: newLink's statements as one D1 batch, which
 * D1 runs as a transaction. The account must exist (the foreign key), or the
 * batch throws and nothing changes.
 */
export async function makeLink(db, accountId, now, random) {
  const { token, expiresAt, statements } = await newLink(db, accountId, now, random);
  await db.batch(statements);
  return { token, expiresAt };
}

/**
 * The statement that makes the link `hash` the account's only one: every
 * other link it holds is deleted. Run once the new link's email has gone, so
 * the link a person already holds dies only when a newer one reached them.
 */
export const replaceOthers = (db, accountId, hash) =>
  db.prepare('DELETE FROM password_links WHERE account_id = ? AND token_hash <> ?').bind(accountId, hash);

/**
 * The statement that deletes the link `hash`. Run when its email was refused,
 * so a link nobody received opens nothing and the earlier one keeps working.
 */
export const dropLink = (db, hash) => db.prepare('DELETE FROM password_links WHERE token_hash = ?').bind(hash);

/**
 * The account a link opens, as { accountId, expiresAt }, or null when it
 * cannot be used: not a token's shape, never made, used, replaced or
 * expired, all answered alike. Reads only, so opening a link spends nothing.
 */
export async function linkAccount(db, token, now) {
  if (!isToken(token)) return null;
  const row = await db
    .prepare('SELECT account_id, expires_at FROM password_links WHERE token_hash = ? AND expires_at > ?')
    .bind(await tokenHash(token), now)
    .first();
  return row ? { accountId: row.account_id, expiresAt: row.expires_at } : null;
}

/**
 * Use a link: the account it opens, or null as linkAccount answers it. One
 * statement deletes the row and returns it, so of two uses at once only one
 * gets the account, and a link once used answers null. An expired link is not
 * deleted here; makeLink and clearExpiredLinks delete it. #222's form calls
 * this, and nothing does before it.
 */
export async function spendLink(db, token, now) {
  if (!isToken(token)) return null;
  const row = await db
    .prepare('DELETE FROM password_links WHERE token_hash = ? AND expires_at > ? RETURNING account_id')
    .bind(await tokenHash(token), now)
    .first();
  return row ? row.account_id : null;
}

/**
 * Delete the links whose time is up. Each load of /admin/people runs this, as
 * the admin home clears the takedowns and the request log, and every new link
 * does the same (newLink). A failure is logged and left: an expired link opens nothing, so
 * only how long its hash is kept is at stake.
 */
export async function clearExpiredLinks(db, now) {
  try {
    await db.prepare('DELETE FROM password_links WHERE expires_at <= ?').bind(now).run();
  } catch (err) {
    console.error('password-link: could not clear expired links:', err instanceof Error ? err.message : String(err));
  }
}
