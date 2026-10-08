/**
 * POST /api/admin/queue/approve: approve one waiting photo, or every photo a
 * batch showed (#156). Posted by a batch's form on /admin/queue: an
 * "Approve" button sends approve=<id>, "Approve all" approve=all. The guards
 * in ../_middleware.js have already required an admin's session and the
 * site's own Origin.
 *
 * Every caption typed in the batch is saved first (lib/queue.js), so the
 * caption a photo goes public with is the one on the page, and clearing the
 * field publishes none. Then only the photos the press named change state,
 * and only those still waiting. 303 back to the queue, at the batch.
 *
 * A press from a page filtered to one team posts here with that ?team=
 * (#227), and lands back on the same team's list, as a GET does.
 *
 * A photo still in a team's "Not sure / other event" is not approved
 * (#228, criterion 4): it waits until an admin moves it into an event. The
 * page offers no Approve for one, so a press naming one is a page from
 * elsewhere or one replayed; the queue then says why it was left
 * (?error=not-sure, or &not-sure=n beside photos that were approved).
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, acted, approvePhotos, notSureWaiting, queueLocation, readPress, saveCaptions, unsavedCaptions,
} from '../../../../lib/queue.js';
import { nowSeconds } from '../../../../lib/session.js';
import { teamOf } from '../../../../lib/teams.js';

export async function onRequestPost({ request, env }) {
  const team = teamOf(request);
  const press = readPress(await readForm(request, QUEUE_FORM_BYTES), 'approve');
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo, team }));
  // Counted first: after the approval its own photos would count too.
  const unsaved = (await unsavedCaptions(env.DB, press.captions)) || null;
  await saveCaptions(env.DB, press.captions);
  const approved = await approvePhotos(env.DB, press.targets, nowSeconds());
  const notSure = approved.length === press.targets.length ? null : (await notSureWaiting(env.DB, press.targets)) || null;
  if (!approved.length) {
    return seeOther(queueLocation({ error: notSure ? 'not-sure' : 'gone', n: notSure, unsaved, team }, press.anchor));
  }
  return seeOther(queueLocation({ done: 'approved', ...acted(approved), 'not-sure': notSure, unsaved, team }, press.anchor));
}

/**
 * GET changes nothing and goes back to the queue, which says so. A press can
 * arrive as a GET when the Access sign-in ran out while the page was open
 * (functions/api/admin/code/rotate.js says how), and GET needs no Origin. The
 * press's ?team= comes with it, so it lands on the list it was made from.
 */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
