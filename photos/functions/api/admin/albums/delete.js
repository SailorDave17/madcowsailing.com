/**
 * POST /api/admin/albums/delete: delete an empty album (#153). The guards in
 * ../_middleware.js have already required an admin's session and the
 * site's own Origin.
 *
 * An album holding any photo, in any state, is not deleted: the database
 * refuses, because each photo references its album (lib/albums.js), and the
 * page then says how many photos it holds. Close the album instead to stop
 * uploads to it.
 */
import { deleteAlbum } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';

export async function onRequestPost({ request, env }) {
  const { address } = await readForm(request);
  const result = await deleteAlbum(env.DB, address);
  if (result.missing) return seeOther('/admin/albums?error=missing');
  const album = encodeURIComponent(address);
  if (!result.deleted) return seeOther(`/admin/albums?error=not-empty&album=${album}&photos=${result.photos}`);
  return seeOther(`/admin/albums?done=deleted&album=${album}`);
}

/** GET changes nothing, as create.js's GET says. */
export const onRequestGet = () => seeOther('/admin/albums?error=unchanged');
