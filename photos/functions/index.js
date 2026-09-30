/**
 * GET /: every album holding an approved photo, newest first (#157). It
 * replaced the holding page #149 served from public/index.html, so
 * public/_routes.json sends / to the Functions.
 *
 * A public GET: no session, no Access, and it never writes to D1 (CLAUDE.md,
 * The photo site, item 4). When the database does not answer it says so with
 * a 503, rather than an empty list that would say nothing is posted.
 *
 * HEAD is answered the same way, as the static holding page answered it: a
 * monitor or a link preview asking HEAD / gets what GET gets, and Pages sends
 * no body. It costs the same query as a GET.
 */
import { albumListPage, htmlResponse, unavailablePage } from '../lib/public-page.js';
import { publicAlbums } from '../lib/public.js';

export async function onRequestGet({ env }) {
  let albums;
  try {
    albums = await publicAlbums(env.DB);
  } catch (err) {
    console.error('albums: the database did not answer:', err instanceof Error ? err.message : String(err));
    return htmlResponse(unavailablePage(), 503);
  }
  return htmlResponse(albumListPage(albums));
}

export const onRequestHead = onRequestGet;
