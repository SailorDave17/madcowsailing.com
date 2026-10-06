/**
 * POST /api/admin/albums/close: close an album (#153). The guards in
 * ../_middleware.js have already required an admin's session and the
 * site's own Origin.
 *
 * A closed album leaves GET /api/albums/open, so the share page stops
 * offering it, and an upload naming it is refused (lib/albums.js, openAlbum).
 * Its approved photos stay public. Closing one already closed changes
 * nothing, so a stale page cannot move the time it was closed.
 */
import { setAlbumOpen } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env }) {
  const { address } = await readForm(request);
  if (!(await setAlbumOpen(env.DB, address, false, nowSeconds()))) return seeOther('/admin/albums?error=missing');
  return seeOther(`/admin/albums?done=closed&album=${encodeURIComponent(address)}`);
}

/** GET changes nothing, as create.js's GET says. */
export const onRequestGet = () => seeOther('/admin/albums?error=unchanged');
