/**
 * POST /api/admin/queue/approve: approve one waiting photo, or every photo a
 * batch showed (#156). Posted by a batch's form on /admin/queue: an
 * "Approve" button sends approve=<id>, "Approve all" approve=all. The guards
 * in ../_middleware.js have already required an admin's Access token and the
 * site's own Origin.
 *
 * Every caption typed in the batch is saved first (lib/queue.js), so the
 * caption a photo goes public with is the one on the page, and clearing the
 * field publishes none. Then only the photos the press named change state,
 * and only those still waiting. 303 back to the queue, at the batch.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, acted, approvePhotos, queueLocation, readPress, saveCaptions, unsavedCaptions,
} from '../../../../lib/queue.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env }) {
  const press = readPress(await readForm(request, QUEUE_FORM_BYTES), 'approve');
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo }));
  // Counted first: after the approval its own photos would count too.
  const unsaved = (await unsavedCaptions(env.DB, press.captions)) || null;
  await saveCaptions(env.DB, press.captions);
  const approved = await approvePhotos(env.DB, press.targets, nowSeconds());
  if (!approved.length) return seeOther(queueLocation({ error: 'gone', unsaved }, press.anchor));
  return seeOther(queueLocation({ done: 'approved', ...acted(approved), unsaved }, press.anchor));
}

/**
 * GET changes nothing and goes back to the queue, which says so. A press can
 * arrive as a GET when the Access sign-in ran out while the page was open
 * (functions/api/admin/code/rotate.js says how), and GET needs no Origin.
 */
export const onRequestGet = () => seeOther(queueLocation({ error: 'unchanged' }));
