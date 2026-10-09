/**
 * The upload guard every upload route runs, and the clock every route reads.
 *
 * Since #226 the guard takes one session, an account's: the __Host-account
 * cookie lib/account-session.js signs (#222), first read here at #223. A
 * phone holding a live one sends as that account, to its approved teams only.
 *
 * Until #226 it also took the upload session, a cookie of its own:
 *
 *   __Host-upload=v1.<generation>.<issued>.<signature>
 *   __Host-upload=c1.<coach>.<issued>.<signature>
 *
 * the first a parent's, set by POST /api/join for the invite code (#150), the
 * second a coach's, set by GET /coach after a Cloudflare Access sign-in
 * (#192). #226 retired the invite link and the coaches' sign-in, and accounts
 * took their place (epic #216): a coach is an account with the coach role.
 * Nothing reads that cookie now. A request that still carries one, valid or
 * not, is answered as if it did not, and the answer deletes it, so the phone
 * stops sending it, as requireAccount deletes a dead account cookie
 * (lib/account-session.js). It opens nothing either way.
 *
 * Nothing here logs a cookie, a signature, an address or the key.
 */
import { readAccountSession, sessionAccount } from './account-session.js';

// The retired upload cookie's name, kept only to find it and delete it.
export const COOKIE_NAME = '__Host-upload';

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The value of the retired upload cookie in a Cookie header, or null. */
export function cookieValue(header) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The Set-Cookie header value that deletes the retired upload cookie (#226).
 * The __Host- prefix makes the browser refuse it unless it is Secure, Path=/
 * and set with no Domain, which this line is.
 */
export const clearUploadCookie = () => `${COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

/**
 * The response with the retired upload cookie deleted when the request
 * carried one, and as it is otherwise. A response from downstream is copied
 * first, since its headers may be immutable.
 */
function deletingUploadCookie(request, response) {
  if (cookieValue(request.headers.get('Cookie')) === null) return response;
  const copy = new Response(response.body, response);
  copy.headers.append('Set-Cookie', clearUploadCookie());
  return copy;
}

const refuse = (status, error) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * The one guard. functions/api/upload/_middleware.js and
 * functions/api/albums/_middleware.js run it in front of every route under
 * them, and test/guard.test.js fails for any route that answers without it.
 * On success the session is on context.data.session, for a route that records
 * who sent something (#154, #223):
 *   { sender: 'account', accountId, role, teams, issued }
 * `sender` is always 'account' since #226; it stays so the session keeps the
 * shape every route reads. `teams` are the ones the account is approved for
 * now, read on this request, and `role` the one an admin approved (#221).
 *
 * The answers of its own:
 *   401  {"error":"not-joined"}   no live account session: none, a forged or
 *                                 expired one, or one whose account is gone,
 *                                 approved for no team, or on another version
 *   503  {"error":"unavailable"}  the database did not answer: closed, never
 *                                 open
 * Each, and the route's own answer on success, also deletes a __Host-upload
 * cookie the request carried (#226).
 */
export async function requireUploadSession(context) {
  const { request, env } = context;
  const held = await readAccountSession(request, env.SESSION_SIGNING_KEY);
  if (held) {
    let account;
    try {
      account = await sessionAccount(env.DB, held);
    } catch (err) {
      // Fail closed: a session that cannot be checked sends nothing.
      console.error('upload guard: database did not answer:', err instanceof Error ? err.message : String(err));
      return deletingUploadCookie(request, refuse(503, 'unavailable'));
    }
    if (account) {
      context.data.session = { sender: 'account', accountId: account.id, role: account.role, teams: account.teams, issued: held.issued };
      return deletingUploadCookie(request, await context.next());
    }
  }
  return deletingUploadCookie(request, refuse(401, 'not-joined'));
}
