/**
 * POST /api/admin/queue/move: move one waiting photo, or every photo a batch
 * showed, into one of its team's events (#228). Posted by a batch's form on
 * /admin/queue: the event chosen in its "Move to event" list is `to`, and a
 * "Move" button sends move=<id>, "Move all" move=all. The guards in
 * ../_middleware.js have already required an admin's session and the site's
 * own Origin.
 *
 * Any waiting photo moves, out of a team's "Not sure / other event" or out of
 * the event its sender chose (owner, at #228's pickup), into any of the same
 * team's events, open or closed, or a new one made here: `to` is then "new",
 * and new-title, new-kind and new-date are the album's fields, as on
 * /admin/albums, with the photos' team. Never into a Not sure album. A photo
 * keeps its state, waiting, and its batch; the queue then shows it as a batch
 * of the event it is in now, where it can be approved.
 *
 * Every caption typed in the batch is saved first, as every press saves them
 * (lib/queue.js), and before the choice is checked, so a press with no event
 * chosen loses nothing typed. 303 back to the queue, at the moved batch.
 *
 * A press from a page filtered to one team posts here with that ?team=
 * (#227), and lands back on the same team's list, as a GET does.
 */
import { albumAt, createAlbum, readAlbumFields } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, acted, anchorBatch, batchWaiting, movePhotos, movedAnchor, queueLocation, readPress, saveCaptions,
  unsavedCaptions, waitingTeams,
} from '../../../../lib/queue.js';
import { nowSeconds } from '../../../../lib/session.js';
import { teamOf } from '../../../../lib/teams.js';

export async function onRequestPost({ request, env }) {
  const team = teamOf(request);
  const fields = await readForm(request, QUEUE_FORM_BYTES);
  const press = readPress(fields, 'move');
  if (press.error) return seeOther(queueLocation({ error: press.error, photo: press.photo, team }));
  const unsaved = (await unsavedCaptions(env.DB, press.captions)) || null;
  await saveCaptions(env.DB, press.captions);
  const back = (params) => seeOther(queueLocation({ ...params, unsaved, team }, press.anchor));

  // The photos' team: one, for a press made from a fresh page, since a batch
  // is one album. Two is a stale page, some of whose photos were moved and
  // their event then moved to the other team, or a press from elsewhere. Its
  // own word, since the captions above were saved (review-fanout at #228's
  // review: 'form' says nothing was changed).
  const teams = await waitingTeams(env.DB, press.targets);
  if (!teams.length) return back({ error: 'gone' });
  if (teams.length > 1) return back({ error: 'teams' });
  const [from] = teams;

  let address;
  let made = null;
  if (fields.to === 'new') {
    const { album, error } = readAlbumFields({
      team: from, title: fields['new-title'], kind: fields['new-kind'], date: fields['new-date'],
    });
    if (error) return back({ error: `new-${error}` });
    address = await createAlbum(env.DB, album, nowSeconds());
    if (!address) return back({ error: 'new-full' });
    made = 1;
  } else {
    const album = await albumAt(env.DB, fields.to);
    if (!album || album.holding || album.team !== from) return back({ error: 'target' });
    address = album.address;
  }

  const moved = await movePhotos(env.DB, press.targets, address);
  if (!moved.length) return back({ error: 'gone', album: made && address, made });
  const album = await albumAt(env.DB, address);
  const batch = anchorBatch(press.anchor);
  const waiting = batch && album ? await batchWaiting(env.DB, batch, album.id) : 0;
  return seeOther(queueLocation(
    { done: 'moved', ...acted(moved), album: address, made, unsaved, team },
    movedAnchor(press.anchor, album?.id, waiting),
  ));
}

/** GET changes nothing, as approve.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
