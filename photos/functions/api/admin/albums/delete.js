/**
 * POST /api/admin/albums/delete: delete an empty album (#153). The guards in
 * ../_middleware.js have already required an admin's session and the
 * site's own Origin.
 *
 * An album holding any photo or clip, in any state, is not deleted: the
 * database refuses, because each row references its album (lib/albums.js),
 * and the page then says how many it holds. Close the album instead to stop
 * uploads to it.
 *
 * The counts ride in the landing's query: photos=<n> as before #198, then,
 * only when a clip is among the rows, clips=<n>, with approved-clips=<n> and
 * uploading-clips=<n> when there are any, for the page to say where a clip
 * goes that no admin page shows (owner, at #198's review). So an album
 * holding photos alone lands exactly as it did.
 *
 * A team's Not sure album (#228) is never deleted, empty or not: migration
 * 0015 refuses, and the page says it can only be closed.
 */
import { deleteAlbum } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';

/** A refused delete's clip counts for the landing's query, or '' when no clip is among the rows. */
function clipCounts({ clips, approvedClips, uploadingClips }) {
  if (!clips) return '';
  const approved = approvedClips ? `&approved-clips=${approvedClips}` : '';
  const uploading = uploadingClips ? `&uploading-clips=${uploadingClips}` : '';
  return `&clips=${clips}${approved}${uploading}`;
}

export async function onRequestPost({ request, env }) {
  const { address } = await readForm(request);
  const result = await deleteAlbum(env.DB, address);
  if (result.missing) return seeOther('/admin/albums?error=missing');
  if (result.notSure) return seeOther('/admin/albums?error=not-sure');
  const album = encodeURIComponent(address);
  if (!result.deleted) return seeOther(`/admin/albums?error=not-empty&album=${album}&photos=${result.photos}${clipCounts(result)}`);
  return seeOther(`/admin/albums?done=deleted&album=${album}`);
}

/** GET changes nothing, as create.js's GET says. */
export const onRequestGet = () => seeOther('/admin/albums?error=unchanged');
