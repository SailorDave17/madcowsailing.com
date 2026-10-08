/**
 * GET /albums/<address>/: one album's approved photos, in the order they were
 * taken, in the trip-log lightbox's markup (#157). The address is the one the
 * album was made with, which never changes (#153), so a shared link keeps
 * working after the title is edited.
 *
 * Anything that is not an address at all goes on to Pages' static files
 * before anything else is done, and so do an address no album has and an
 * album holding no approved photo, once the database has been asked. Pages'
 * static files hold nothing under /albums/, so the answer is public/404.html
 * with a 404, the same page as any other missing path. An address without its
 * trailing slash is sent to the one with it before the database is asked, as
 * Pages does for a directory, so a page has one URL; an address that turns
 * out to hold nothing public then 404s at its slashed form.
 *
 * A public GET: no session, no Access, never a write to D1. HEAD is answered
 * the same way, as for /.
 *
 * ?removed shows the takedown notice: POST /api/remove sends the browser back
 * here after hiding one of the album's photos (#158).
 */
import { isAddress } from '../../../lib/albums.js';
import { albumPage, htmlResponse, unavailablePage } from '../../../lib/public-page.js';
import { publicAlbum } from '../../../lib/public.js';

export async function onRequestGet({ request, env, params, next }) {
  if (!isAddress(params.address)) return next();
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/')) {
    return new Response(null, { status: 308, headers: { Location: `${url.pathname}/${url.search}` } });
  }
  let album;
  try {
    album = await publicAlbum(env.DB, params.address);
  } catch (err) {
    console.error('album: the database did not answer:', err instanceof Error ? err.message : String(err));
    return htmlResponse(unavailablePage(), 503);
  }
  if (album === null) return next();
  return htmlResponse(albumPage(album, { removed: url.searchParams.has('removed') }));
}

export const onRequestHead = onRequestGet;
