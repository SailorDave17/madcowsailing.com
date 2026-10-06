/**
 * POST /api/admin/removals/delete: "Delete permanently" on /admin/removals
 * (#158). Deletes one hidden photo's row, then its three objects, for good.
 *
 * Posted only by the confirm button in the page's native <dialog>. The
 * page's "Delete permanently" button only opens it
 * (public/js/admin-removals.js) and gives the confirm button the photo's id,
 * so the press carries photo=<id>. The guards in ../_middleware.js have
 * already required an admin's Access token and the site's own Origin.
 *
 * Only a hidden photo is deleted here: an approved one is taken down first,
 * and a waiting one is rejected on the queue. 303 back to the page, saying
 * what happened, and whether the bucket kept the files (lib/removals.js).
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { readPhotoId } from '../../../../lib/queue.js';
import { deletePhoto, removalsLocation } from '../../../../lib/removals.js';
import { teamOf } from '../../../../lib/teams.js';

export async function onRequestPost({ request, env }) {
  // The team the page was filtered to, in the press's ?team= (#227), so the
  // press lands back on it.
  const team = teamOf(request);
  const id = readPhotoId((await readForm(request)).photo);
  if (id === null) return seeOther(removalsLocation({ error: 'form', team }));
  const { deleted, kept } = await deletePhoto(env.DB, env.MEDIA, id);
  if (!deleted) return seeOther(removalsLocation({ error: 'gone', team }));
  return seeOther(removalsLocation({ done: 'deleted', photo: id, kept: kept ? 1 : null, team }));
}

/** GET changes nothing, as restore.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(removalsLocation({ error: 'unchanged', team: teamOf(request) }));
