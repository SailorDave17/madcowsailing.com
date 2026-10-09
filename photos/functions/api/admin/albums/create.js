/**
 * POST /api/admin/albums/create: add an album (#153), from the form at the
 * top of /admin/albums. The guards in ../_middleware.js have already required
 * an admin's session and the site's own Origin.
 *
 * The address is made from the date and the title (lib/albums.js) and never
 * changes after. Then 303 back to the page, which names the new album and
 * its address, or says which field was wrong, or that every address this
 * date and title can take is held, and saves nothing.
 */
import { createAlbum, readAlbumFields } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env }) {
  const { album, error } = readAlbumFields(await readForm(request));
  if (error) return seeOther(`/admin/albums?error=${error}`);
  const address = await createAlbum(env.DB, album, nowSeconds());
  if (!address) return seeOther('/admin/albums?error=full');
  return seeOther(`/admin/albums?done=created&album=${encodeURIComponent(address)}`);
}

/**
 * GET changes nothing and goes back to the page, which says so. A press can
 * arrive as a GET (lib/admin-page.js says how, beside pressPath), and GET
 * needs no Origin.
 */
export const onRequestGet = () => seeOther('/admin/albums?error=unchanged');
