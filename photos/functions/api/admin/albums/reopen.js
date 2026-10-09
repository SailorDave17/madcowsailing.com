/**
 * POST /api/admin/albums/reopen: reopen a closed album (#153), reversing
 * close.js: the share page offers it again and uploads naming it are taken.
 * The guards in ../_middleware.js have already required an admin's session
 * (lib/admin-session.js, since #224; an Access token until then) and the
 * site's own Origin.
 */
import { setAlbumOpen } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';

export async function onRequestPost({ request, env }) {
  const { address } = await readForm(request);
  if (!(await setAlbumOpen(env.DB, address, true))) return seeOther('/admin/albums?error=missing');
  return seeOther(`/admin/albums?done=reopened&album=${encodeURIComponent(address)}`);
}

/** GET changes nothing, as create.js's GET says. */
export const onRequestGet = () => seeOther('/admin/albums?error=unchanged');
