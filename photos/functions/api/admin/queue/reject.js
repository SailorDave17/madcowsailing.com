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
 * to the queue, at the next waiting photo, as approve.js says (#270).
 *
 * Since #198 a waiting clip is rejected here too: its row, then its one
 * object. The notice names clips apart, as approve.js says, and the files the
 * bucket kept by kind (&kept=<photos>, &kept-clips=<clips>), from the kind
 * the DELETE returns.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, acted, nextWaiting, photoAt, queueLocation, readPress, rejectPhotos, saveCaptions, unsavedCaptions,
  unsavedFields, waitingOrder,
} from '../../../../lib/queue.js';
import { teamOf } from '../../../../lib/teams.js';

// A press from a filtered page carries its ?team= (#227), as approve.js says.
export async function onRequestPost({ request, env }) {
  const team = teamOf(request);
  const press = readPress(await readForm(request, QUEUE_FORM_BYTES), 'reject');
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo, team }));
  const unsaved = unsavedFields(await unsavedCaptions(env.DB, press.captions));
  await saveCaptions(env.DB, press.captions);
  const order = await waitingOrder(env.DB, team);
  const { rejected, clips, kept, keptClips } = await rejectPhotos(env.DB, env.MEDIA, press.targets);
  const next = photoAt(nextWaiting(order, press.ids, press.targets, rejected));
  if (!rejected.length) return seeOther(queueLocation({ error: 'gone', ...unsaved, team }, next));
  return seeOther(queueLocation({
    done: 'rejected', ...acted(rejected, clips), kept: kept || null, 'kept-clips': keptClips || null, ...unsaved, team,
  }, next));
}

/** GET changes nothing, as approve.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
