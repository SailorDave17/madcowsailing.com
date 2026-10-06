/**
 * POST /api/admin/removals/restore: "Put it back" on /admin/removals (#158).
 * Makes one hidden photo approved again, so it is public from the next
 * request. The guards in ../_middleware.js have already required an admin's
 * Access token and the site's own Origin.
 *
 * The press carries photo=<id>. When the takedown was made and its note stay
 * on the row, as a record (owner, at #158's pickup; lib/removals.js). 303
 * back to the page, saying what happened.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { readPhotoId } from '../../../../lib/queue.js';
import { removalsLocation, restorePhoto } from '../../../../lib/removals.js';
import { teamOf } from '../../../../lib/teams.js';

export async function onRequestPost({ request, env }) {
  // The team the page was filtered to, in the press's ?team= (#227), so the
  // press lands back on it.
  const team = teamOf(request);
  const id = readPhotoId((await readForm(request)).photo);
  if (id === null) return seeOther(removalsLocation({ error: 'form', team }));
  if (!(await restorePhoto(env.DB, id))) return seeOther(removalsLocation({ error: 'gone', team }));
  return seeOther(removalsLocation({ done: 'restored', photo: id, team }));
}

/**
 * GET changes nothing and goes back to the page, which says so. A press can
 * arrive as a GET when the Access sign-in ran out while the page was open
 * (functions/api/admin/code/rotate.js says how), and GET needs no Origin. The
 * press's ?team= comes with it, so it lands on the list it was made from.
 */
export const onRequestGet = ({ request }) => seeOther(removalsLocation({ error: 'unchanged', team: teamOf(request) }));
