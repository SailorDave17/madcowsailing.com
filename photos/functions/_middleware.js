/**
 * Runs in front of every Function route, the paths public/_routes.json names
 * (read the list there). Since #157 they include the public pages and every
 * photo, so each album view is about 41 Function requests. Static files never
 * reach it, so they cost no request from the free plan's daily 100,000
 * (CLAUDE.md, The photo site, item 2).
 *
 * Its one job is the site-wide headers: X-Robots-Tag: noindex above all, and
 * the Content-Security-Policy. Pages applies public/_headers to static files
 * only, so without this a Function's answer would go out with neither. The
 * request form at /ask gets a CSP that admits Turnstile (#220), and every
 * other path the site's own (lib/headers.js, headersFor). That covers three
 * kinds of response:
 *   - whatever a route returns;
 *   - the 404 page, when no route matches and Pages falls through to the
 *     static files (/api/nope);
 *   - a route that throws, answered here with a plain 500 rather than
 *     Cloudflare's error page, which would carry none of these headers.
 */
import { headersFor } from '../lib/headers.js';

export async function onRequest(context) {
  let response;
  try {
    response = await context.next();
  } catch (err) {
    // The message only: a stack can carry request values, and later stories
    // handle codes and cookies that must never reach a log.
    console.error('Unhandled error in a Function:', err instanceof Error ? err.message : String(err));
    response = new Response('Something went wrong.\n', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // A response from next() can have immutable headers (a static file's does),
  // so copy it before setting anything.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(headersFor(new URL(context.request.url).pathname))) {
    out.headers.set(name, value);
  }
  return out;
}
