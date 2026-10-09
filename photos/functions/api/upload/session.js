/**
 * GET /api/upload/session: 204 when this browser holds a live account
 * session, and the guard's 401 when it does not.
 *
 * The share page asks this each time it opens, to say whether this phone can
 * send. The answer comes from the guard in _middleware.js; by the time this
 * runs, the session has passed: its signature holds, its version is the
 * account's, and the account is approved for at least one team. Since #226 a
 * __Host-upload cookie from the invite link or a coach's sign-in passes
 * nothing, and the guard's answer deletes it, so a phone that held one loses
 * it here the next time it opens the share page. A read only: it writes
 * nothing to the database.
 */
export function onRequestGet() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
