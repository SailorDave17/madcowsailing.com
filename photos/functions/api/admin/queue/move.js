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
 * chosen loses nothing typed. 303 back to the queue, at the first moved
 * photo, waiting in its event, ready to approve (owner, at #270's pickup).
 * A refused choice lands at the batch, where its Move choices are; photos no
 * longer waiting land at the next waiting photo, as approve.js's do.
 *
 * A press from a page filtered to one team posts here with that ?team=
 * (#227), and lands back on the same team's list, as a GET does.
 */
import { albumAt, createAlbum, readAlbumFields } from '../../../../lib/albums.js';
import { readForm, seeOther } from '../../../../lib/form.js';
import {
  QUEUE_FORM_BYTES, acted, movePhotos, nextWaiting, photoAt, queueLocation, readPress, saveCaptions, unsavedCaptions,
  waitingOrder, waitingTeams,
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
  // Nothing was moved, so the order read now is the order the page showed.
  // The read only places the landing: when it fails, the answer is still
  // the 303 saying what happened, an event made included, at the top
  // (review-fanout at #270's review: uncaught, it turned that notice into a
  // 500 after createAlbum had committed).
  const gone = async (params) => {
    let at = null;
    try {
      at = photoAt(nextWaiting(await waitingOrder(env.DB, team), press.ids, press.targets, []));
    } catch (err) {
      console.error('queue: could not read the queue to land a move on:', err instanceof Error ? err.message : String(err));
    }
    return seeOther(queueLocation({ error: 'gone', ...params, unsaved, team }, at));
  };

  // The photos' team: one, for a press made from a fresh page, since a batch
  // is one album. Two is a stale page, some of whose photos were moved and
  // their event then moved to the other team, or a press from elsewhere. Its
  // own word, since the captions above were saved (review-fanout at #228's
  // review: 'form' says nothing was changed).
  const teams = await waitingTeams(env.DB, press.targets);
  if (!teams.length) return gone({});
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
  if (!moved.length) return gone({ album: made && address, made });
  // The first moved photo in the page's order, which is the form's: its card
  // is in the event's batch now, in whichever part of it.
  return seeOther(queueLocation(
    { done: 'moved', ...acted(moved), album: address, made, unsaved, team },
    photoAt(press.targets.find((id) => moved.includes(id))),
  ));
}

/** GET changes nothing, as approve.js's GET says, and keeps the press's ?team=. */
export const onRequestGet = ({ request }) => seeOther(queueLocation({ error: 'unchanged', team: teamOf(request) }));
