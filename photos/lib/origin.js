/**
 * Whether a request that changes something came from the site itself.
 *
 * A browser sends Origin on every POST, same-origin included, and a page on
 * another site cannot forge it. So a write whose Origin is missing or names
 * another site is refused: that is how a page elsewhere is stopped from
 * posting a form into this one, whatever cookies the browser would attach.
 *
 * The site's own Origin is the origin the request arrived on, so this holds on
 * photos.madcowsailing.com, madcowphotos.pages.dev, a preview and localhost
 * alike. A route outside every guarded directory checks it itself, as
 * POST /api/join (#150), the sign-in and the takedown do. Every route in a
 * guarded directory gets it from that directory's _middleware.js, behind the
 * session guard, so a later write there cannot miss it: the admin pages and
 * API (#152), the uploads (#154), the account page (#222), and since #273 the
 * albums directory, where a sender makes an event (POST /api/albums). Until
 * #273 that directory held reads only and ran no Origin guard.
 * test/guard.test.js holds every write in each of them to it.
 */

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin !== null && origin === new URL(request.url).origin;
}

// Reads change nothing, so they need no Origin; a browser often sends none.
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Middleware: any method but GET and HEAD needs the site's own Origin, or it
 * answers 403 {"error":"origin"} and the route never runs.
 * test/guard.test.js holds every write in every guarded directory to it:
 * admin, account, upload and, since #273, albums.
 */
export function requireSameOrigin(context) {
  const { request } = context;
  if (!SAFE_METHODS.has(request.method) && !sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return context.next();
}
