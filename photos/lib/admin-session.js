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
 *   __Host-admin=m2.<account>.<version>.<issued>.<seconds>.<signature>
 *
 * account    the account's id
 * version    accounts.session_version when the code passed
 * issued     when, in Unix seconds
 * seconds    how long it lasts: ADMIN_SESSION_SECONDS (12 hours), or
 *            REMEMBERED_SESSION_SECONDS (30 days) when "Remember this phone
 *            for 30 days" was ticked at the code step (#274)
 * signature  HMAC-SHA256 of "m2.<account>.<version>.<issued>.<seconds>",
 *            keyed with the SESSION_SIGNING_KEY secret every session cookie
 *            uses. The length is inside what is signed (#274, criterion 2),
 *            so a 12-hour cookie edited to say 30 days no longer matches its
 *            signature. The "m2." in front means no other message signed
 *            with that key can be one of these: an account cookie's starts
 *            a1. (lib/account-session.js), #224's admin cookie m1., an upload
 *            cookie's was v1. or c1. until #226 retired it, a clip's
 *            completion token is clip. (lib/clips.js) and an admin code's
 *            hash admin-code. (lib/admin-code.js). So none of their
 *            signatures can be carried over to this one. A later format
 *            takes a prefix none of those has.
 *
 * #224's cookie was "m1.<account>.<version>.<issued>", always 12 hours. It is
 * no longer read: an admin holding one at #274's release signs in once more
 * (the owner's choice at #274's pickup, 2026-10-08, over reading it as a
 * 12-hour cookie until the last one ran out).
 *
 * It is a cookie of its own beside __Host-account, which the same sign-in
 * sets (owner, at #224's pickup): the account's lasts 90 days and sends
 * photos, this one lasts 12 hours or 30 days and opens the admin pages, so an
 * admin's phone keeps sending after its admin pages close.
 *
 * The guard refuses it unless the signature holds, its length is one of the
 * two the site issues, it is younger than that length, and the account still
 * exists, is approved for a team, holds exactly the version the cookie names,
 * and holds the admin role (#224's criterion 2). It reads all four on every
 * request, so taking the role away (lib/people.js, demoteAdmin) ends the
 * admin pages at the next request, and signing out or a new password, which
 * each add 1 to the version, end them too, a remembered phone's as well
 * (#274, criterion 3). #225's revoke adds 1 to the version too, but refuses
 * an account holding the admin role, so it reaches an admin only once the
 * owner has taken the role away. It holds no password, no email address and
 * no name.
 *
 * "Forget this phone" (functions/api/admin/forget.js) deletes this cookie in
 * one browser and writes nothing, so a copy of it taken off that browser
 * keeps working until its length runs out or the version moves (the owner's
 * choice at #274's pickup). A phone that is lost cannot press it: Sign out
 * on any other phone or computer, or a new password through
 * /forgot-password, ends the lost one's sessions, its admin one included.
 *
 * Nothing here logs the cookie, the signature or the key.
 */
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const ADMIN_COOKIE = '__Host-admin';

// D15: "sessions of 12 hours at most", lengthened by #274 for a phone the
// admin asks the site to remember (owner, 2026-10-07, #267: remember this
// phone for 30 days; not chosen: passkeys, and keeping 12 hours). The
// server checks the age itself, against the length the cookie's signed
// payload names, rather than trusting Max-Age, which only asks the browser.
export const ADMIN_SESSION_HOURS = 12;
export const ADMIN_SESSION_SECONDS = ADMIN_SESSION_HOURS * 60 * 60;
export const REMEMBERED_SESSION_DAYS = 30;
export const REMEMBERED_SESSION_SECONDS = REMEMBERED_SESSION_DAYS * 24 * 60 * 60;

// The only lengths the site issues. A cookie naming any other is refused even
// when its signature holds: nothing here signs one, so it can only come from
// a key that has leaked or a test.
export const ADMIN_SESSION_LENGTHS = Object.freeze([ADMIN_SESSION_SECONDS, REMEMBERED_SESSION_SECONDS]);

/** The length an admin session opened at the code step lasts: 30 days when the admin ticked "Remember this phone", else 12 hours. */
export const sessionLength = (remember) => (remember ? REMEMBERED_SESSION_SECONDS : ADMIN_SESSION_SECONDS);

// A cookie issued this far ahead of the server's clock is still accepted, for
// clock drift between Cloudflare's machines, as the other session cookies
// allow.
const CLOCK_SKEW_SECONDS = 60;

// Where a refused request is sent: the sign-in, saying the admin pages need
// it (lib/sign-in-page.js's 'admin' notice).
export const ADMIN_SIGN_IN = '/sign-in?admin';

const VERSION = 'm2';
const VALUE = /^m2\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,11})\.([1-9][0-9]{0,8})\.([A-Za-z0-9_-]{43})$/;

const cookieLine = (value, maxAge) =>
  `${ADMIN_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;

/**
 * The cookie's value alone, lasting `seconds` (12 hours unless named).
 * Exported so tests can mint any cookie, a length the site never issues
 * included; adminCookie() is the one that issues.
 */
export async function signAdminSession(secret, { accountId, version, seconds = ADMIN_SESSION_SECONDS }, issued) {
  const payload = `${VERSION}.${accountId}.${version}.${issued}.${seconds}`;
  return `${payload}.${base64url(await hmac(secret, payload))}`;
}

/**
 * The Set-Cookie header value for an admin session on `accountId` at
 * `version`, opened `issued`, lasting `seconds`: ADMIN_SESSION_SECONDS or
 * REMEMBERED_SESSION_SECONDS, and Max-Age the same. Any other length throws,
 * so nothing can issue a cookie the guard would refuse.
 */
export async function adminCookie(secret, { accountId, version, seconds = ADMIN_SESSION_SECONDS }, issued = nowSeconds()) {
  if (!ADMIN_SESSION_LENGTHS.includes(seconds)) throw new Error('adminCookie: not a length the site issues');
  return cookieLine(await signAdminSession(secret, { accountId, version, seconds }, issued), seconds);
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
 * The session a request's admin cookie names, { accountId, version, issued,
 * seconds }, or null when it carries none that this key signed, of a length
 * the site issues, and still within that length (#274: the length its own
 * signed payload names, never a constant, so a remembered phone's cookie is
 * read for its 30 days, by the guard and by /sign-out alike). It does not
 * read the account; requireAdmin does.
 */
export async function readAdminSession(request, secret, now = nowSeconds()) {
  if (!secret) return null;
  const match = VALUE.exec(adminCookieValue(request.headers.get('Cookie')) ?? '');
  if (!match) return null;
  const [, accountId, version, issued, seconds, signature] = match;
  const valid = await hmacVerify(secret, `${VERSION}.${accountId}.${version}.${issued}.${seconds}`, fromBase64url(signature));
  if (!valid) return null;
  const session = { accountId: Number(accountId), version: Number(version), issued: Number(issued), seconds: Number(seconds) };
  if (!ADMIN_SESSION_LENGTHS.includes(session.seconds)) return null;
  if (session.issued > now + CLOCK_SKEW_SECONDS) return null;
  if (now - session.issued >= session.seconds) return null;
  return session;
}

/**
 * The admin a session belongs to, as { id, name, email, role, issued,
 * seconds }, role 'admin' or 'owner', or null when the account is gone,
 * approved for no team, on another version than the session names, or holds
 * no admin role. `seconds` is the session's length, which the admin home
 * says the end of (#274, criterion 4).
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
  return { id: row.id, name: row.name, email: row.email, role: row.admin_role, issued: session.issued, seconds: session.seconds };
}

/**
 * The guard. Both admin directories' _middleware.js run it in front of every
 * admin page and admin API, then requireSameOrigin (lib/origin.js), and
 * test/guard.test.js fails for any admin route that answers without them. On
 * success the admin is on context.data.admin.
 *
 * Every refusal, whatever the method, is a 303 to /sign-in?admin, deleting
 * the cookie when the request carried one, so a browser holding a dead
 * session stops sending it. A press made after the session ran out lands on
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
