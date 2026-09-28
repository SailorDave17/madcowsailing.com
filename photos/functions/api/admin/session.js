/**
 * GET /api/admin/session: 200 with the owner's email when the request carries
 * a valid Access token for them, and the guard's 403 when it does not.
 *
 * The admin counterpart of /api/upload/session. The answer comes from the
 * guard in _middleware.js; by the time this runs, the token has passed. A
 * read only: it writes nothing, and the body is never cached.
 */
export function onRequestGet({ data }) {
  return Response.json({ email: data.owner.email }, { headers: { 'Cache-Control': 'no-store' } });
}
