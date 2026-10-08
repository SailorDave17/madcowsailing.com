/**
 * GET /api/admin/session: 200 with the signed-in admin's email when the
 * request carries an admin session (#224; an Access token until then), and
 * the guard's 303 to /sign-in?admin when it does not.
 *
 * The admin counterpart of /api/upload/session. The answer comes from the
 * guard in _middleware.js; by the time this runs, the session has passed. A
 * read only: it writes nothing, and the body is never cached.
 */
export function onRequestGet({ data }) {
  return Response.json({ email: data.admin.email }, { headers: { 'Cache-Control': 'no-store' } });
}
