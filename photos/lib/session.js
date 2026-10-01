/**
 * The upload session: one signed cookie, set by POST /api/join when the
 * current invite code is presented, or by GET /coach when a coach signs in
 * through Cloudflare Access (#192), and the guard every upload route runs.
 *
 * A parent gives no name and no email (epic #147, A4). The session is the
 * cookie alone:
 *
 *   __Host-upload=v1.<generation>.<issued>.<signature>
 *
 * generation  which invite code opened it (invite_codes.generation)
 * issued      when, in Unix seconds
 * signature   HMAC-SHA256 of "v1.<generation>.<issued>", keyed with the
 *             SESSION_SIGNING_KEY Pages secret, which is held only in
 *             Cloudflare (README, The photo site, Secrets)
 *
 * A coach's session has no code behind it, so it names the coach instead:
 *
 *   __Host-upload=c1.<coach>.<issued>.<signature>
 *
 * coach       a keyed hash of the address Access signed in (coachTag), never
 *             the address itself, so the cookie carries no email
 * signature   HMAC-SHA256 of "c1.<coach>.<issued>", with the same key
 *
 * The guard refuses the cookie with 401 unless the signature holds and it is
 * younger than SESSION_SECONDS. A parent's must also name the current code's
 * generation, so rotating the code (#152) ends every parent session at the
 * next request, with nothing to revoke. A coach's must name an address that
 * is on COACH_EMAILS now, so taking a coach off the list ends their session
 * at its next request, and rotating the code leaves it alone (owner, #192's
 * pickup: rotation is for a leaked parent link). The __Host- prefix makes the
 * browser refuse the cookie unless it is Secure, Path=/ and set with no
 * Domain, so no other host under madcowsailing.com can set or read it.
 *
 * Nothing here logs the cookie, the signature, an address or the key.
 */
import { allowList } from './access.js';
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';

export const COOKIE_NAME = '__Host-upload';

// 90 days: the owner's choice at #150's pickup, 2026-09-27, over the 180
// proposed and 365. A parent reopens the invite link about twice a season,
// and a lost phone stops being able to send on its own within one. A coach's
// session lasts as long (#192), and ends sooner when they leave the list.
export const SESSION_DAYS = 90;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

// A cookie issued this far ahead of the server's clock is still accepted,
// for clock drift between Cloudflare's machines. Anything later is forged.
const CLOCK_SKEW_SECONDS = 60;

const VERSION = 'v1';
const COACH_VERSION = 'c1';
const VALUE = /^v1\.([1-9][0-9]{0,8})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
const COACH_VALUE = /^c1\.([A-Za-z0-9_-]{43})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

// What a coach's address is hashed with, ahead of the address, so the hash
// can never equal a signature over a cookie's own fields.
const COACH_TAG_CONTEXT = 'coach-address:';

export const nowSeconds = () => Math.floor(Date.now() / 1000);

const cookieHeader = (value) =>
  `${COOKIE_NAME}=${value}; Max-Age=${SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;

/** The Set-Cookie header value for a session opened now on `generation`. */
export async function sessionCookie(secret, generation, issued = nowSeconds()) {
  return cookieHeader(await signSession(secret, generation, issued));
}

/** The cookie's value alone. Exported so tests can mint any cookie. */
export async function signSession(secret, generation, issued) {
  const payload = `${VERSION}.${generation}.${issued}`;
  return `${payload}.${base64url(await hmac(secret, payload))}`;
}

/**
 * The keyed hash a coach's session names them by: HMAC-SHA256 of the
 * address, lowercased and trimmed as the list is, keyed with the session
 * key. Without the key it cannot be turned back into an address, or matched
 * against a guessed one.
 */
export async function coachTag(secret, email) {
  return base64url(await hmac(secret, `${COACH_TAG_CONTEXT}${email.trim().toLowerCase()}`));
}

/** The Set-Cookie header value for a coach's session opened now (#192). */
export async function coachSessionCookie(secret, email, issued = nowSeconds()) {
  return cookieHeader(await signCoachSession(secret, await coachTag(secret, email), issued));
}

/** A coach cookie's value alone, for a coach tag. Exported so tests can mint any cookie. */
export async function signCoachSession(secret, coach, issued) {
  const payload = `${COACH_VERSION}.${coach}.${issued}`;
  return `${payload}.${base64url(await hmac(secret, payload))}`;
}

/** The value of the session cookie in a Cookie header, or null. */
export function cookieValue(header) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The session a request carries, or null when it carries none that this key
 * signed and that is still within its age:
 *   { sender: 'parent', generation, issued }  opened with an invite code
 *   { sender: 'coach', coach, issued }        opened at /coach (#192)
 * It does not know the current generation or the coach list;
 * requireUploadSession checks those.
 */
export async function readSession(request, secret, now = nowSeconds()) {
  if (!secret) return null;
  const value = cookieValue(request.headers.get('Cookie')) ?? '';
  let session;
  let payload;
  let signature;
  let match = VALUE.exec(value);
  if (match) {
    session = { sender: 'parent', generation: Number(match[1]), issued: Number(match[2]) };
    payload = `${VERSION}.${match[1]}.${match[2]}`;
    signature = match[3];
  } else if ((match = COACH_VALUE.exec(value))) {
    session = { sender: 'coach', coach: match[1], issued: Number(match[2]) };
    payload = `${COACH_VERSION}.${match[1]}.${match[2]}`;
    signature = match[3];
  } else {
    return null;
  }
  const valid = await hmacVerify(secret, payload, fromBase64url(signature));
  if (!valid) return null;
  if (session.issued > now + CLOCK_SKEW_SECONDS) return null;
  if (now - session.issued >= SESSION_SECONDS) return null;
  return session;
}

/** The current code's generation, or null when no code exists yet. */
export async function currentGeneration(db) {
  const row = await db.prepare('SELECT MAX(generation) AS generation FROM invite_codes').first();
  return row?.generation ?? null;
}

/**
 * Whether a coach tag names an address on `list` (COACH_EMAILS) now. The list
 * is short (each coach is a Zero Trust seat, 50 at most on the free plan), so
 * each address is hashed again on every request rather than stored anywhere.
 */
export async function coachListed(secret, coach, list) {
  for (const address of allowList(list)) {
    if ((await coachTag(secret, address)) === coach) return true;
  }
  return false;
}

const refuse = (status, error) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * The one guard. functions/api/upload/_middleware.js runs it in front of
 * every upload route, and test/guard.test.js fails for any route that
 * answers without it. On success the session is on context.data.session,
 * for a route that records who sent something (#154, #192): its `sender` is
 * 'parent' or 'coach'.
 */
export async function requireUploadSession(context) {
  const { request, env } = context;
  const session = await readSession(request, env.SESSION_SIGNING_KEY);
  if (!session) return refuse(401, 'not-joined');
  if (session.sender === 'coach') {
    // No code opened it, so the code's generation is not asked: a rotation
    // leaves it alone. Off the list, it is refused from this request on.
    if (!(await coachListed(env.SESSION_SIGNING_KEY, session.coach, env.COACH_EMAILS))) {
      return refuse(401, 'not-joined');
    }
    context.data.session = session;
    return context.next();
  }
  let current;
  try {
    current = await currentGeneration(env.DB);
  } catch (err) {
    // Fail closed: a session that cannot be checked sends nothing.
    console.error('upload guard: database did not answer:', err instanceof Error ? err.message : String(err));
    return refuse(503, 'unavailable');
  }
  if (current === null || session.generation !== current) return refuse(401, 'not-joined');
  context.data.session = session;
  return context.next();
}
