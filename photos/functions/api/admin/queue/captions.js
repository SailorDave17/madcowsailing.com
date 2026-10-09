/**
 * POST /api/admin/queue/captions: save the captions typed in one batch on
 * /admin/queue (#156), approving and rejecting nothing.
 *
 * It is the batch form's own action and its first button, "Save captions",
 * so Enter in a caption field lands here rather than on the first photo's
 * Approve. The guards in ../_middleware.js have already required an admin's
 * session and the site's own Origin. 303 back to the queue, saying how
 * many captions changed, on the card of the last caption that changed, in
 * the page's order (owner, at #270's review): Enter in a caption field
 * presses this, so on a phone the admin lands where they were typing rather
 * than at the batch's heading, maybe a hundred cards up. When none changed,
 * at the batch.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, photoAt, queueLocation, readPress, saveCaptions, unsavedCaptions,
} from '../../../../lib/queue.js';
import { teamOf } from '../../../../lib/teams.js';

// A press from a filtered page carries its ?team= (#227), as approve.js says.
export async function onRequestPost({ request, env }) {
  const team = teamOf(request);
  const press = readPress(await readForm(request, QUEUE_FORM_BYTES), null);
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo, team }));
  const unsaved = (await unsavedCaptions(env.DB, press.captions)) || null;
  const changed = await saveCaptions(env.DB, press.captions);
  const last = press.ids.findLast((id) => changed.includes(id));
  return seeOther(queueLocation({ done: 'saved', n: changed.length, unsaved, team }, photoAt(last) ?? press.anchor));
}

/** GET changes nothing, as approve.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
