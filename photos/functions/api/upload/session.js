/**
 * GET /api/upload/session: 204 when this browser holds a live upload session,
 * and the guard's 401 when it does not.
 *
 * The share page asks this when it is opened without an invite code in its
 * address (a bookmark, or a return visit), to say whether this phone can
 * send. The answer comes from the guard in _middleware.js; by the time this
 * runs, the session has passed. A read only: it writes nothing.
 */
export function onRequestGet() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
