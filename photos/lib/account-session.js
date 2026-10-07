/**
 * The account session (#222, criterion 4): one signed cookie, set when an
 * approved person signs in at /sign-in or sets a password at /set-password,
 * and the guard every page behind a sign-in runs.
 *
 *   __Host-account=a1.<account>.<version>.<issued>.<signature>
 *
 * account    the account's id (accounts.id, AUTOINCREMENT, so it never comes
 *            to name a later account)
 * version    accounts.session_version when the session was opened
 * issued     when, in Unix seconds
 * signature  HMAC-SHA256 of "a1.<account>.<version>.<issued>", keyed with the
 *            SESSION_SIGNING_KEY Pages secret the upload session uses
 *            (README, The photo site, Secrets). The "a1." in front means no
 *            upload cookie's payload can ever be one of these.
 *
 * It is a cookie of its own, not a third shape of __Host-upload, so a phone
 * can hold both, and #226 retires the upload cookie without touching this
 * one. Since #223 the upload guard (lib/session.js, requireUploadSession)
 * reads it first: a phone holding both sends as the account (owner, at
 * #223's pickup). It holds no password, no email address and no name.
 *
 * The guard refuses it unless the signature holds, it is younger than
 * SESSION_SECONDS, and the account still exists, is approved for a team, and
 * holds exactly the version the cookie names. Setting a password and signing
 * out each add 1 to the version (migration 0009), so every session the
 * account holds ends at its next request, with nothing to look up but the
 * account's own row (criterion 4). A revoke ends them today because only an
 * account approved for a team is read; #225's revoke is to add 1 as well, so
 * that re-approving a team cannot bring an old cookie back (#222's review). Signing out ends every session
 * the account holds, on every device (the owner's choice at #222's pickup,
 * 2026-10-06), and so does a cookie someone copied. The __Host- prefix makes
 * the browser refuse the cookie unless it is Secure, Path=/ and set with no
 * Domain, so no other host under madcowsailing.com can set or read it.
 *
 * Nothing here logs the cookie, the signature or the key.
 */
import { TEAMS } from './accounts.js';
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';

// Nothing here imports lib/session.js: since #223 its upload guard reads this
// module, and an import back would make a cycle in which whichever module
// loads second meets the first's constants before they are set.
const nowSeconds = () => Math.floor(Date.now() / 1000);

export const ACCOUNT_COOKIE = '__Host-account';

// 90 days, as the upload session's SESSION_DAYS (criterion 4, epic #216): a
// parent signs in about twice a season. test/policy.test.js holds the two
// equal. The server checks the age itself rather than trusting Max-Age.
export const ACCOUNT_SESSION_DAYS = 90;
export const ACCOUNT_SESSION_SECONDS = ACCOUNT_SESSION_DAYS * 24 * 60 * 60;

// A cookie issued this far ahead of the server's clock is still accepted, for
// clock drift between Cloudflare's machines, as lib/session.js allows.
const CLOCK_SKEW_SECONDS = 60;

const VERSION = 'a1';
const VALUE = /^a1\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

const cookieLine = (value, maxAge) =>
  `${ACCOUNT_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;

/** The cookie's value alone. Exported so tests can mint any cookie. */
export async function signAccountSession(secret, { accountId, version }, issued) {
  const payload = `${VERSION}.${accountId}.${version}.${issued}`;
  return `${payload}.${base64url(await hmac(secret, payload))}`;
}

/** The Set-Cookie header value for a session on `accountId` at `version`, opened now. */
export async function accountCookie(secret, { accountId, version }, issued = nowSeconds()) {
  return cookieLine(await signAccountSession(secret, { accountId, version }, issued), ACCOUNT_SESSION_SECONDS);
}

/** The Set-Cookie header value that deletes the cookie on this browser. */
export const clearAccountCookie = () => cookieLine('', 0);

/** The value of the account cookie in a Cookie header, or null. */
export function accountCookieValue(header) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === ACCOUNT_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The session a request's cookie names, { accountId, version, issued }, or
 * null when it carries none that this key signed and that is still within its
 * age. It does not read the account; requireAccount does.
 */
export async function readAccountSession(request, secret, now = nowSeconds()) {
  if (!secret) return null;
  const match = VALUE.exec(accountCookieValue(request.headers.get('Cookie')) ?? '');
  if (!match) return null;
  const [, accountId, version, issued, signature] = match;
  const valid = await hmacVerify(secret, `${VERSION}.${accountId}.${version}.${issued}`, fromBase64url(signature));
  if (!valid) return null;
  const session = { accountId: Number(accountId), version: Number(version), issued: Number(issued) };
  if (session.issued > now + CLOCK_SKEW_SECONDS) return null;
  if (now - session.issued >= ACCOUNT_SESSION_SECONDS) return null;
  return session;
}

/**
 * The account a session belongs to, as { id, name, email, role, adminRole,
 * teams }, teams the ones it is approved for in TEAMS order, or null when the
 * account is gone, approved for no team, or holds another version than the
 * session names. The role is the one an admin approved (#221): since #223 it
 * decides whether an upload is a coach's (lib/photos.js, sendsAsCoach).
 * adminRole is 'owner', 'admin' or null (#224), only so /account can link
 * the admin pages: it opens nothing, which only lib/admin-session.js does.
 */
export async function sessionAccount(db, session) {
  const { results } = await db
    .prepare(
      'SELECT a.id, a.name, a.email, a.role, a.admin_role, t.team FROM accounts AS a JOIN account_teams AS t ON t.account_id = a.id ' +
      "WHERE a.id = ? AND a.session_version = ? AND t.state = 'approved'",
    )
    .bind(session.accountId, session.version)
    .all();
  if (results.length === 0) return null;
  const { id, name, email, role, admin_role: adminRole } = results[0];
  return { id, name, email, role, adminRole, teams: TEAMS.map(({ team }) => team).filter((team) => results.some((row) => row.team === team)) };
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * The guard. functions/account/_middleware.js runs it in front of every
 * route under /account, and test/guard.test.js fails for any route there
 * that answers without it. On success the account is on context.data.account.
 *
 * A page (GET or HEAD) with no session that holds is sent to /sign-in, 303,
 * deleting the cookie when the request carried one, so a browser holding a
 * dead session stops sending it. Any other method answers 401
 * {"error":"not-signed-in"}. A database that does not answer is 503: closed,
 * never open.
 */
export async function requireAccount(context) {
  const { request, env } = context;
  const session = await readAccountSession(request, env.SESSION_SIGNING_KEY);
  let account = null;
  if (session) {
    try {
      account = await sessionAccount(env.DB, session);
    } catch (err) {
      console.error('account guard: the database did not answer:', err instanceof Error ? err.message : String(err));
      return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  if (account) {
    context.data.account = account;
    return context.next();
  }
  const held = accountCookieValue(request.headers.get('Cookie')) !== null;
  if (SAFE_METHODS.has(request.method)) {
    const headers = new Headers({ Location: '/sign-in', 'Cache-Control': 'no-store' });
    if (held) headers.append('Set-Cookie', clearAccountCookie());
    return new Response(null, { status: 303, headers });
  }
  return Response.json({ error: 'not-signed-in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}
