/**
 * The admin session (#224, D15): the cookie an admin's sign-in sets once its
 * emailed code has passed (lib/admin-code.js), and the guard every admin page
 * and admin API runs (functions/admin/_middleware.js and
 * functions/api/admin/_middleware.js). It replaced requireOwner's Cloudflare
 * Access check (#151) in both directories (owner, at #224's pickup: replace
 * outright). The Access application that stood in front of /admin on
 * photos.madcowsailing.com was deleted by #268, so this is the only sign-in
 * on every hostname.
 *
 *   __Host-admin=m1.<account>.<version>.<issued>.<signature>
 *
 * account    the account's id
 * version    accounts.session_version when the code passed
 * issued     when, in Unix seconds
 * signature  HMAC-SHA256 of "m1.<account>.<version>.<issued>", keyed with the
 *            SESSION_SIGNING_KEY secret every session cookie uses. The "m1."
 *            in front means no other cookie's payload can be one of these:
 *            an upload cookie's is v1. or c1., an account cookie's a1.
 *            (lib/session.js, lib/account-session.js), so none of their
 *            signatures can be carried over to this one.
 *
 * It is a cookie of its own beside __Host-account, which the same sign-in
 * sets (owner, at #224's pickup): the account's lasts 90 days and sends
 * photos, this one lasts ADMIN_SESSION_HOURS and opens the admin pages, so an
 * admin's phone keeps sending after its admin pages close.
 *
 * The guard refuses it unless the signature holds, it is younger than
 * ADMIN_SESSION_SECONDS, and the account still exists, is approved for a
 * team, holds exactly the version the cookie names, and holds the admin role
 * (criterion 2). It reads all four on every request, so taking the role away
 * (lib/people.js, demoteAdmin) ends the admin pages at the next request, and
 * signing out, a new password or #225's revoke, which each add 1 to the
 * version, end them too. It holds no password, no email address and no name.
 *
 * Nothing here logs the cookie, the signature or the key.
 */
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const ADMIN_COOKIE = '__Host-admin';

// D15: "sessions of 12 hours at most". The server checks the age itself
// rather than trusting Max-Age, which only asks the browser.
export const ADMIN_SESSION_HOURS = 12;
export const ADMIN_SESSION_SECONDS = ADMIN_SESSION_HOURS * 60 * 60;

// A cookie issued this far ahead of the server's clock is still accepted, for
// clock drift between Cloudflare's machines, as the other session cookies
// allow.
const CLOCK_SKEW_SECONDS = 60;

// Where a refused request is sent: the sign-in, saying the admin pages need
// it (lib/sign-in-page.js's 'admin' notice).
export const ADMIN_SIGN_IN = '/sign-in?admin';

const VERSION = 'm1';
const VALUE = /^m1\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

const cookieLine = (value, maxAge) =>
  `${ADMIN_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;

/** The cookie's value alone. Exported so tests can mint any cookie. */
export async function signAdminSession(secret, { accountId, version }, issued) {
  const payload = `${VERSION}.${accountId}.${version}.${issued}`;
  return `${payload}.${base64url(await hmac(secret, payload))}`;
}

/** The Set-Cookie header value for an admin session on `accountId` at `version`, opened `issued`. */
export async function adminCookie(secret, { accountId, version }, issued = nowSeconds()) {
  return cookieLine(await signAdminSession(secret, { accountId, version }, issued), ADMIN_SESSION_SECONDS);
}

/** The Set-Cookie header value that deletes the cookie on this browser. */
export const clearAdminCookie = () => cookieLine('', 0);

/** The value of the admin cookie in a Cookie header, or null. */
export function adminCookieValue(header) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === ADMIN_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The session a request's admin cookie names, { accountId, version, issued },
 * or null when it carries none that this key signed and that is still within
 * its 12 hours. It does not read the account; requireAdmin does.
 */
export async function readAdminSession(request, secret, now = nowSeconds()) {
  if (!secret) return null;
  const match = VALUE.exec(adminCookieValue(request.headers.get('Cookie')) ?? '');
  if (!match) return null;
  const [, accountId, version, issued, signature] = match;
  const valid = await hmacVerify(secret, `${VERSION}.${accountId}.${version}.${issued}`, fromBase64url(signature));
  if (!valid) return null;
  const session = { accountId: Number(accountId), version: Number(version), issued: Number(issued) };
  if (session.issued > now + CLOCK_SKEW_SECONDS) return null;
  if (now - session.issued >= ADMIN_SESSION_SECONDS) return null;
  return session;
}

/**
 * The admin a session belongs to, as { id, name, email, role, issued }, role
 * 'admin' or 'owner', or null when the account is gone, approved for no team,
 * on another version than the session names, or holds no admin role.
 */
export async function sessionAdmin(db, session) {
  const row = await db
    .prepare(
      'SELECT a.id, a.name, a.email, a.admin_role FROM accounts AS a ' +
      'WHERE a.id = ? AND a.session_version = ? AND a.admin_role IS NOT NULL ' +
      "AND EXISTS (SELECT 1 FROM account_teams AS t WHERE t.account_id = a.id AND t.state = 'approved')",
    )
    .bind(session.accountId, session.version)
    .first();
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.admin_role, issued: session.issued };
}

/**
 * The guard. Both admin directories' _middleware.js run it in front of every
 * admin page and admin API, then requireSameOrigin (lib/origin.js), and
 * test/guard.test.js fails for any admin route that answers without them. On
 * success the admin is on context.data.admin.
 *
 * Every refusal, whatever the method, is a 303 to /sign-in?admin, deleting
 * the cookie when the request carried one, so a browser holding a dead
 * session stops sending it. A press made after the 12 hours ran out lands on
 * the sign-in, which says nothing was changed, rather than on a page of JSON:
 * the admin pages are plain forms. Nothing behind the guard ever answers a
 * 303 to that address, so a test can tell the guard's refusal from a route's
 * own 303. A database that does not answer is 503: closed, never open.
 */
export async function requireAdmin(context) {
  const { request, env } = context;
  const session = await readAdminSession(request, env.SESSION_SIGNING_KEY);
  let admin = null;
  if (session) {
    try {
      admin = await sessionAdmin(env.DB, session);
    } catch (err) {
      console.error('admin guard: the database did not answer:', err instanceof Error ? err.message : String(err));
      return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  if (admin) {
    context.data.admin = admin;
    return context.next();
  }
  const headers = new Headers({ Location: ADMIN_SIGN_IN, 'Cache-Control': 'no-store' });
  if (adminCookieValue(request.headers.get('Cookie')) !== null) headers.append('Set-Cookie', clearAdminCookie());
  return new Response(null, { status: 303, headers });
}
