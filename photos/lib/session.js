/**
 * The upload session: one signed cookie, set by POST /api/join when the
 * current invite code is presented, and the guard every upload route runs.
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
 * The guard refuses the cookie with 401 unless the signature holds, the
 * generation is the current code's, and it is younger than SESSION_SECONDS.
 * So rotating the code (#152) ends every session at the next request, with
 * nothing to revoke. The __Host- prefix makes the browser refuse the cookie
 * unless it is Secure, Path=/ and set with no Domain, so no other host under
 * madcowsailing.com can set or read it.
 *
 * Nothing here logs the cookie, the signature or the key.
 */
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';

export const COOKIE_NAME = '__Host-upload';

// 90 days: the owner's choice at #150's pickup, 2026-09-27, over the 180
// proposed and 365. A parent reopens the invite link about twice a season,
// and a lost phone stops being able to send on its own within one.
export const SESSION_DAYS = 90;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

// A cookie issued this far ahead of the server's clock is still accepted,
// for clock drift between Cloudflare's machines. Anything later is forged.
const CLOCK_SKEW_SECONDS = 60;

const VERSION = 'v1';
const VALUE = /^v1\.([1-9][0-9]{0,8})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The Set-Cookie header value for a session opened now on `generation`. */
export async function sessionCookie(secret, generation, issued = nowSeconds()) {
  const value = await signSession(secret, generation, issued);
  return `${COOKIE_NAME}=${value}; Max-Age=${SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

/** The cookie's value alone. Exported so tests can mint any cookie. */
export async function signSession(secret, generation, issued) {
  const payload = `${VERSION}.${generation}.${issued}`;
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
 * The session a request carries, as { generation, issued }, or null when it
 * carries none that this key signed and that is still within its age. It
 * does not know the current generation; requireUploadSession checks that.
 */
export async function readSession(request, secret, now = nowSeconds()) {
  if (!secret) return null;
  const match = VALUE.exec(cookieValue(request.headers.get('Cookie')) ?? '');
  if (!match) return null;
  const [, generation, issued, signature] = match;
  const valid = await hmacVerify(secret, `${VERSION}.${generation}.${issued}`, fromBase64url(signature));
  if (!valid) return null;
  const session = { generation: Number(generation), issued: Number(issued) };
  if (session.issued > now + CLOCK_SKEW_SECONDS) return null;
  if (now - session.issued >= SESSION_SECONDS) return null;
  return session;
}

/** The current code's generation, or null when no code exists yet. */
export async function currentGeneration(db) {
  const row = await db.prepare('SELECT MAX(generation) AS generation FROM invite_codes').first();
  return row?.generation ?? null;
}

const refuse = (status, error) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * The one guard. functions/api/upload/_middleware.js runs it in front of
 * every upload route, and test/guard.test.js fails for any route that
 * answers without it. On success the session is on context.data.session,
 * for a route that records which generation sent something (#154).
 */
export async function requireUploadSession(context) {
  const { request, env } = context;
  const session = await readSession(request, env.SESSION_SIGNING_KEY);
  if (!session) return refuse(401, 'not-joined');
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
