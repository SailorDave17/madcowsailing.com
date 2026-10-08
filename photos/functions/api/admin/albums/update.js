/**
 * POST /api/admin/albums/update: change an album's title, kind or date
 * (#153), from the Edit form under it on /admin/albums. The guards in
 * ../_middleware.js have already required an admin's session and the
 * site's own Origin.
 *
 * The address never changes, so every link to the album keeps working.
 *
 * A team's Not sure album (#228) has no Edit form, and a post naming one
 * changes nothing and says so: it is only closed and reopened.
 */
import { notSureAlbum, readAlbumFields, updateAlbum } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';

export async function onRequestPost({ request, env }) {
  const fields = await readForm(request);
  const { album, error } = readAlbumFields(fields);
  if (error) return seeOther(`/admin/albums?error=${error}`);
  if (!(await updateAlbum(env.DB, fields.address, album))) {
    return seeOther(`/admin/albums?error=${(await notSureAlbum(env.DB, fields.address)) ? 'not-sure' : 'missing'}`);
  }
  return seeOther(`/admin/albums?done=saved&album=${encodeURIComponent(fields.address)}`);
}

/** GET changes nothing, as create.js's GET says. */
export const onRequestGet = () => seeOther('/admin/albums?error=unchanged');
