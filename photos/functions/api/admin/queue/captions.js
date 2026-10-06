/**
 * POST /api/admin/queue/captions: save the captions typed in one batch on
 * /admin/queue (#156), approving and rejecting nothing.
 *
 * It is the batch form's own action and its first button, "Save captions",
 * so Enter in a caption field lands here rather than on the first photo's
 * Approve. The guards in ../_middleware.js have already required an admin's
 * Access token and the site's own Origin. 303 back to the queue, at the
 * batch, saying how many captions changed.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, queueLocation, readPress, saveCaptions, unsavedCaptions,
} from '../../../../lib/queue.js';
import { teamOf } from '../../../../lib/teams.js';

// A press from a filtered page carries its ?team= (#227), as approve.js says.
export async function onRequestPost({ request, env }) {
  const team = teamOf(request);
  const press = readPress(await readForm(request, QUEUE_FORM_BYTES), null);
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo, team }));
  const unsaved = (await unsavedCaptions(env.DB, press.captions)) || null;
  const saved = await saveCaptions(env.DB, press.captions);
  return seeOther(queueLocation({ done: 'saved', n: saved, unsaved, team }, press.anchor));
}

/** GET changes nothing, as approve.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
