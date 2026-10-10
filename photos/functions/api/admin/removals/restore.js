/**
 * POST /api/admin/removals/restore: "Put it back" on /admin/removals (#158).
 * Makes one hidden photo approved again, so it is public from the next
 * request, or, for one an admin hid while it was still waiting (#225, "Hide
 * all their photos"), puts it back in the queue, never public. Since #310 a
 * hidden clip goes back the same way: approved again, shown nowhere public
 * until #286, or back in the queue. The guards in ../_middleware.js have
 * already required an admin's session and the site's own Origin.
 *
 * The press carries photo=<id>, for a clip as for a photo. When the takedown
 * was made and its note stay on the row, as a record (owner, at #158's
 * pickup; lib/removals.js). 303 back to the page, saying what happened: the
 * id comes back as clip=<id> for a clip, as the queue's notices do
 * (lib/queue.js, acted), so the page names it.
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
  const restored = await restorePhoto(env.DB, id);
  if (restored === null) return seeOther(removalsLocation({ error: 'gone', team }));
  const which = restored.kind === 'clip' ? { clip: id } : { photo: id };
  return seeOther(removalsLocation({ done: restored.state === 'pending' ? 'queued' : 'restored', ...which, team }));
}

/**
 * GET changes nothing and goes back to the page, which says so. A press can
 * arrive as a GET (lib/admin-page.js says how, beside pressPath), and GET
 * needs no Origin. The press's ?team= comes with it, so it lands on the list
 * it was made from.
 */
export const onRequestGet = ({ request }) => seeOther(removalsLocation({ error: 'unchanged', team: teamOf(request) }));
