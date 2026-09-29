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
 * alike. POST /api/join (#150) checks it itself, since it is not behind a
 * directory guard; every admin route gets it from its directory's
 * _middleware.js (#152), so a later admin write cannot miss it.
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
 * test/guard.test.js holds every admin route to it.
 */
export function requireSameOrigin(context) {
  const { request } = context;
  if (!SAFE_METHODS.has(request.method) && !sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return context.next();
}
