/**
 * GET /admin/albums: the albums (#153). The guards in _middleware.js have
 * already checked the Access token.
 *
 * It lists every album, open ones first, each with its kind, date and
 * address, and forms to add one, edit one, close or reopen it, and delete it
 * while it is empty. Each form posts to functions/api/admin/albums/, which
 * answers 303 back here with ?done= or ?error= saying what happened
 * (lib/admin-page.js, albumsNotice).
 *
 * Rendered here, never a static file (CLAUDE.md, The photo site, item 4).
 */
import { adminAlbumsPage, albumsNotice } from '../../lib/admin-page.js';
import { allAlbums } from '../../lib/albums.js';

export async function onRequestGet({ request, env }) {
  const albums = await allAlbums(env.DB);
  const notice = albumsNotice(new URL(request.url).searchParams, albums);
  return new Response(adminAlbumsPage({ albums, notice }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Behind Access: no cache between here and the owner may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
