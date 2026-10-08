/**
 * POST /api/admin/queue/reject: reject one waiting photo, or every photo a
 * batch showed (#156), deleting each row and its three objects for good.
 *
 * Posted only by the confirm button in /admin/queue's native <dialog>. The
 * page's "Reject" and "Reject all" buttons only open the dialog
 * (public/js/admin-queue.js), which points the confirm button at their
 * batch's form, so the press carries reject=<id> or reject=all with that
 * batch's captions. The guards in ../_middleware.js have already required an
 * admin's session and the site's own Origin.
 *
 * The batch's captions are saved first, as every press saves them
 * (lib/queue.js). A rejected photo's own caption goes with its row. 303 back
 * to the queue, at the batch.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, acted, queueLocation, readPress, rejectPhotos, saveCaptions, unsavedCaptions,
} from '../../../../lib/queue.js';
import { teamOf } from '../../../../lib/teams.js';

// A press from a filtered page carries its ?team= (#227), as approve.js says.
export async function onRequestPost({ request, env }) {
  const team = teamOf(request);
  const press = readPress(await readForm(request, QUEUE_FORM_BYTES), 'reject');
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo, team }));
  const unsaved = (await unsavedCaptions(env.DB, press.captions)) || null;
  await saveCaptions(env.DB, press.captions);
  const { rejected, kept } = await rejectPhotos(env.DB, env.MEDIA, press.targets);
  if (!rejected.length) return seeOther(queueLocation({ error: 'gone', unsaved, team }, press.anchor));
  return seeOther(queueLocation({ done: 'rejected', ...acted(rejected), kept: kept || null, unsaved, team }, press.anchor));
}

/** GET changes nothing, as approve.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
