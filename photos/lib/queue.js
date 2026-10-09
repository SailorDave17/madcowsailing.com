/**
 * The approval queue (#156): what /admin/queue shows, and the presses its
 * forms send to functions/api/admin/queue/.
 *
 * A photo waits from the moment #154's upload route stores it, pending, until
 * an admin approves it, which makes it public (#157), or rejects it, which
 * deletes its row and its three objects for good. Only a pending photo is
 * either: an approved one leaves the public page through "Remove this photo"
 * (#158), never through here.
 *
 * The page shows each batch as one form (lib/admin-page.js, adminQueuePage):
 * the ids of the photos it showed, a caption field for each, and the buttons.
 * **Every press in a batch saves every caption typed in it first** (owner,
 * 2026-09-30, at #156's pickup), so the reload after a press loses none. A
 * waiting photo's caption can be saved while it keeps waiting; its state
 * changes only when a press names it. Not chosen: saving only the captions of
 * the photos a press approves, which drops the rest on the reload; posting
 * with a script and no reload. A caption typed for a photo approved since the
 * page loaded is not saved, since a public caption changes only through its
 * own approval, and the notice says how many (unsavedCaptions).
 *
 * "Approve all" and "Reject all" act on the photos the page showed, named in
 * the form, never on the batch as it stands when the press arrives. A photo
 * that joined the batch after the page loaded has not been seen, so it waits.
 *
 * A press is a handful of statements, whatever the batch holds. D1 allows 50
 * queries a request on the free plan and 100 bound parameters a query
 * (developers.cloudflare.com/d1/platform/limits, read 2026-09-30), so the ids
 * and the captions each travel as one JSON value, read with json_each().
 *
 * Since #270 a press lands on the next waiting photo (nextWaiting), not on
 * its batch, so an admin on a phone carries on down the queue. Approve and
 * Reject read the queue's order first (waitingOrder), one more statement,
 * which reads every waiting row as the page's own load does.
 *
 * The queue shows photos only. A clip (#198) is a pending row too, and every
 * statement here names kind = 'photo', so a clip's id posted to a press
 * changes nothing; #198 adds clips to the queue.
 *
 * Since #228 a press can also move waiting photos into one of their team's
 * events (movePhotos), and a photo in a team's "Not sure / other event" is
 * never approved here (approvePhotos), until it is moved.
 */
import { CONTROL } from './albums.js';
import { photoObjectKeys, readCaption } from './photos.js';

// The most photos one form shows, and so the most one press may name. A batch
// holding more is shown in parts of this many, each its own form (owner, at
// #156's review): a batch is whatever one press of Send carried, and nothing
// but the share page's own habit keeps that small. Then no form can pass the
// cap below, whatever the parents typed.
export const PART_PHOTOS = 200;

// A part of 200 photos, each caption 200 emoji outside the BMP (12 encoded
// characters apiece), comes to about 485,000 characters; test/queue.test.js
// sends exactly that. So the cap takes any part at all.
export const QUEUE_FORM_BYTES = 512 * 1024;

// A caption's control characters (a pasted tab, say) become spaces here
// rather than refusing the press, as the share page does before it sends
// (#156's review). Only a caption over 200 characters is still refused, and
// the page's script stops one before it is sent.
const CONTROL_ALL = new RegExp(CONTROL.source, 'gu');

// R2 deletes at most 1,000 keys a call (Workers R2 API reference, read
// 2026-09-30).
const DELETE_KEYS_MAX = 1000;

// The free R2 storage #148 recorded (CLAUDE.md, The photo site, item 8): 10
// GB-month. Cloudflare's pricing page does not say which GB it means, so this
// takes the smaller, 10^9 bytes, and the admin home runs out early rather
// than late.
export const FREE_STORAGE_BYTES = 10 * 1000 ** 3;

const ID = /^[1-9][0-9]{0,14}$/;

/** A photo's id from a form field or a path, or null. */
export const readPhotoId = (text) => (typeof text === 'string' && ID.test(text) ? Number(text) : null);

// A batch's form and section id: its batch and album, since a photo retried
// into another album keeps its first batch (CLAUDE.md, item 15), and its part
// when the batch is shown in parts.
const BATCH_ID = /^batch-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[1-9][0-9]{0,14}(?:-part-[1-9][0-9]{0,3})?$/;
export const batchId = ({ batch, albumId }) => `batch-${batch}-${albumId}`;

/** A waiting photo's card on the page, and so a place a press can land (#270). */
export const photoAt = (id) => (id == null ? null : `photo-${id}`);

/**
 * Where a press that approved, rejected or tried to (#270) lands: the next
 * waiting photo after the ones it named, in the order the page shows them.
 *
 *   order    every waiting photo's id in the page's order (waitingOrder),
 *            read before the press changed anything
 *   ids      the photos the batch's page showed, in order (readPress)
 *   targets  the photos the press named
 *   acted    the ones it approved or rejected, which wait no more
 *
 * First the photo after them in their batch that still waits; else the
 * first one after the batch; else, when nothing comes after, the earliest
 * photo still waiting, which is one the admin skipped (owner, at #270's
 * pickup). Null when nothing waits, for the top of the queue. A photo's
 * card is found by its id wherever the batch is split into parts.
 */
export function nextWaiting(order, ids, targets, acted) {
  const last = Math.max(...targets.map((id) => ids.indexOf(id)));
  const later = ids.slice(last + 1).find((id) => order.includes(id));
  if (later !== undefined) return later;
  const done = new Set(acted);
  const end = Math.max(-1, ...ids.map((id) => order.indexOf(id)));
  return order.slice(end + 1).find((id) => !done.has(id)) ?? order.find((id) => !done.has(id)) ?? null;
}

/**
 * Every waiting photo's id, in the order the page shows them (#270): the
 * page's own query, so `team` keeps one team's, as on a filtered page.
 */
export async function waitingOrder(db, team = null) {
  return (await waitingBatches(db, team)).flatMap((batch) => batch.photos.map((photo) => photo.id));
}

/**
 * A press's fields: { ids, captions, targets, anchor }, or { error } with
 * `photo` naming the caption that was refused.
 *
 *   ids       the photos the page showed in the batch, in order
 *   captions  { id: caption or null } for each of them with a caption field;
 *             an emptied field is null, which publishes no caption, and a
 *             control character is a space
 *   targets   the photos the press acts on: `name`'s value is "all" (every
 *             id) or one of the ids; none when `name` is null
 *   anchor    the batch's section id, where a press that changes no photo's
 *             place lands (Save captions that changed none, a refused Move,
 *             an approve naming only Not sure photos), or null
 *
 * A caption over 200 characters refuses the press, so nothing is half done.
 * The reload then shows the stored captions, so what was typed in the batch
 * must be typed again: only a browser without the page's script can send
 * one (public/js/admin-queue.js stops a caption at 200).
 */
export function readPress(fields, name) {
  const listed = typeof fields.ids === 'string' ? fields.ids.split(' ') : [];
  const ids = listed.map(readPhotoId);
  if (!ids.length || ids.length > PART_PHOTOS || ids.includes(null) || new Set(ids).size !== ids.length) {
    return { error: 'form' };
  }
  const captions = {};
  for (const id of ids) {
    const field = fields[`caption-${id}`];
    if (field === undefined) continue;
    const { caption, error } = readCaption(field.replace(CONTROL_ALL, ' '));
    if (error) return { error: 'caption', photo: id };
    captions[id] = caption;
  }
  let targets = [];
  if (name !== null) {
    const value = fields[name];
    if (value === 'all') {
      targets = ids;
    } else {
      const id = readPhotoId(value);
      if (id === null || !ids.includes(id)) return { error: 'form' };
      targets = [id];
    }
  }
  const anchor = BATCH_ID.test(fields.anchor ?? '') ? fields.anchor : null;
  return { ids, captions, targets, anchor };
}

/**
 * Save each caption that differs from what is stored, on photos still
 * waiting, and return the ids whose caption changed, in no set order. One
 * statement: the captions travel as a JSON object keyed by id. A caption the
 * CHECK would refuse never gets here, since readPress() refused it first.
 * Save captions lands on the last of them in the page's order (#270).
 */
export async function saveCaptions(db, captions) {
  if (!Object.keys(captions).length) return [];
  const { results } = await db
    .prepare(
      'UPDATE photos SET caption = c.caption ' +
      'FROM (SELECT CAST(key AS INTEGER) AS id, value AS caption FROM json_each(?)) AS c ' +
      "WHERE photos.id = c.id AND photos.kind = 'photo' AND photos.state = 'pending' " +
      'AND photos.caption IS NOT c.caption ' +
      'RETURNING photos.id',
    )
    .bind(JSON.stringify(captions))
    .all();
  return results.map((row) => row.id);
}

/**
 * How many of `captions` were typed for photos no longer waiting, approved or
 * hidden since the page loaded, and differ from what they carry, so will not
 * be saved. Run before the press saves or changes anything: after the save
 * every waiting photo's caption matches, so the state test would decide
 * nothing, and after an approval the press's own photos would count. A
 * photo rejected meanwhile has no row, and its caption no longer matters.
 */
export async function unsavedCaptions(db, captions) {
  if (!Object.keys(captions).length) return 0;
  return db
    .prepare(
      'SELECT COUNT(*) AS n FROM photos AS p ' +
      'JOIN (SELECT CAST(key AS INTEGER) AS id, value AS caption FROM json_each(?)) AS c ON p.id = c.id ' +
      "WHERE p.kind = 'photo' AND p.state <> 'pending' AND p.caption IS NOT c.caption",
    )
    .bind(JSON.stringify(captions))
    .first('n');
}

/**
 * Approve the photos among `ids` that are still waiting, recording `now`, and
 * return the ids approved. Nothing else about any row changes.
 *
 * A photo still in a team's "Not sure / other event" (#228) is left waiting:
 * it has no event to be public in until an admin moves it into one
 * (movePhotos). Migration 0015 refuses the change too, but it would refuse
 * the whole statement, so the photos beside it in a press would not be
 * approved either; here they are, and notSureWaiting() says why the rest
 * were not.
 */
export async function approvePhotos(db, ids, now) {
  const { results } = await db
    .prepare(
      "UPDATE photos SET state = 'approved', approved_at = ? " +
      "WHERE kind = 'photo' AND state = 'pending' AND id IN (SELECT value FROM json_each(?)) " +
      'AND album_id NOT IN (SELECT id FROM albums WHERE holding = 1) ' +
      'RETURNING id',
    )
    .bind(now, JSON.stringify(ids))
    .all();
  return results.map((row) => row.id);
}

/**
 * How many of `ids` are photos waiting in a team's Not sure album (#228):
 * what an approval left alone, so the queue can say why.
 */
export async function notSureWaiting(db, ids) {
  return db
    .prepare(
      'SELECT COUNT(*) AS n FROM photos ' +
      "WHERE kind = 'photo' AND state = 'pending' AND id IN (SELECT value FROM json_each(?)) " +
      'AND album_id IN (SELECT id FROM albums WHERE holding = 1)',
    )
    .bind(JSON.stringify(ids))
    .first('n');
}

/**
 * The teams of the albums the waiting photos among `ids` are in: one team
 * for any press the page made, since a batch is one album. A press naming
 * none still waiting gets [], and one naming two teams was not made by the
 * page.
 */
export async function waitingTeams(db, ids) {
  const { results } = await db
    .prepare(
      'SELECT DISTINCT a.team FROM photos AS p JOIN albums AS a ON a.id = p.album_id ' +
      "WHERE p.kind = 'photo' AND p.state = 'pending' AND p.id IN (SELECT value FROM json_each(?))",
    )
    .bind(JSON.stringify(ids))
    .all();
  return results.map((row) => row.team);
}

/**
 * Move the photos among `ids` that are still waiting into the event at
 * `address` (#228), and return the ids moved. Any waiting photo moves, from
 * an event or from a Not sure album (owner, at #228's pickup), but only
 * within its team, and only into an event, open or closed, never into a Not
 * sure album. One statement, so the album's team is read as the photos move:
 * an album moved to the other team meanwhile takes nothing. A photo already
 * in that event is left as it is. Its batch stays, so the queue shows the
 * moved photos as a batch of the event they are in now (waitingBatches).
 */
export async function movePhotos(db, ids, address) {
  const { results } = await db
    .prepare(
      'UPDATE photos SET album_id = t.id ' +
      'FROM (SELECT id, team FROM albums WHERE address = ? AND holding = 0) AS t ' +
      "WHERE photos.kind = 'photo' AND photos.state = 'pending' " +
      'AND photos.id IN (SELECT value FROM json_each(?)) ' +
      'AND photos.album_id <> t.id ' +
      'AND photos.album_id IN (SELECT id FROM albums WHERE team = t.team) ' +
      'RETURNING photos.id',
    )
    .bind(address, JSON.stringify(ids))
    .all();
  return results.map((row) => row.id);
}

/**
 * Reject the photos among `ids` that are still waiting: delete their rows,
 * then their three objects each. Returns { rejected, kept }: the ids whose
 * rows were deleted, and how many of those photos' objects the bucket did
 * not delete.
 *
 * Rows first, the mirror of the upload's objects-first: either way no row
 * ever names objects that are gone. A delete the bucket refuses leaves
 * objects no row names, invisible and costing storage, so the log names each
 * photo's photos/<key>/ prefix, in the words the upload route uses, and
 * README.md says how to delete them by it.
 */
export async function rejectPhotos(db, bucket, ids) {
  const { results } = await db
    .prepare(
      "DELETE FROM photos WHERE kind = 'photo' AND state = 'pending' " +
      'AND id IN (SELECT value FROM json_each(?)) RETURNING id, media_key',
    )
    .bind(JSON.stringify(ids))
    .all();
  const rejected = results.map((row) => row.id);
  const mediaKeys = results.map((row) => row.media_key);
  let kept = 0;
  // Whole photos per call, so a refused call names exactly its photos.
  const perCall = Math.floor(DELETE_KEYS_MAX / 3);
  for (let i = 0; i < mediaKeys.length; i += perCall) {
    const chunk = mediaKeys.slice(i, i + perCall);
    try {
      await bucket.delete(chunk.flatMap((key) => Object.values(photoObjectKeys(key))));
    } catch (err) {
      kept += chunk.length;
      for (const mediaKey of chunk) {
        console.error(`queue: bucket did not delete photos/${mediaKey}/ after a reject:`, err instanceof Error ? err.message : String(err));
      }
    }
  }
  return { rejected, kept };
}

/**
 * Where a press sends the browser back to: /admin/queue with its notice's
 * fields (undefined and null ones left out), scrolled to `at`, when there is
 * one: a waiting photo's card (photoAt) or a batch's section. `at` is in the
 * query too (#270), since the fragment never reaches the server, and the
 * page shows the notice there, where the browser lands, rather than at the
 * top, out of sight on a phone.
 */
export function queueLocation(params, at = null) {
  const kept = Object.entries({ ...params, at }).filter(([, value]) => value !== undefined && value !== null);
  const query = new URLSearchParams(kept.map(([name, value]) => [name, String(value)])).toString();
  return `/admin/queue${query ? `?${query}` : ''}${at ? `#${at}` : ''}`;
}

/** The notice's count for the photos a press acted on: one by its id, more by how many. */
export const acted = (ids) => (ids.length === 1 ? { photo: ids[0] } : { n: ids.length });

/**
 * Every waiting photo, grouped by batch and album, oldest batch first, each
 * batch's photos in the order they were sent. A batch is one press of Send
 * (#155); the album is part of the key because a photo retried into another
 * album keeps its first batch.
 *
 * Each entry is one form's worth: `number` is the batch's place among the
 * batches, and a batch of more than PART_PHOTOS comes as several entries,
 * `part` of `parts`, each with an id of its own.
 *
 * One query, by the photos_by_state index: it reads one row per waiting
 * photo, plus its album.
 *
 * `team` keeps only the batches sent to that team's albums (#227), for the
 * page's team filter; null keeps every team's. A batch's number is its place
 * among the batches shown.
 *
 * Each photo sent from an account carries the account's name (#223,
 * criterion 3, D17), for the admins alone: `accountName`, null for an
 * account since deleted, and for a photo sent with the invite link or a
 * coach's Access sign-in before #226 retired them.
 *
 * A batch sent to a team's "Not sure / other event" says so (`album.holding`,
 * #228), so the page offers no approval for it.
 */
export async function waitingBatches(db, team = null) {
  const statement = db.prepare(
    'SELECT p.id, p.batch, p.sender, p.caption, p.captured_at, p.sent_at, p.width, p.height, ' +
    'p.grid_width, p.grid_height, p.screen_width, p.screen_height, ' +
    'a.id AS album_id, a.title AS album_title, a.address AS album_address, a.team AS album_team, ' +
    'a.holding AS album_holding, acc.name AS account_name ' +
    'FROM photos AS p JOIN albums AS a ON a.id = p.album_id ' +
    'LEFT JOIN accounts AS acc ON acc.id = p.account_id ' +
    "WHERE p.state = 'pending' AND p.kind = 'photo' " +
    (team === null ? '' : 'AND a.team = ? ') +
    'ORDER BY p.sent_at, p.id',
  );
  const { results } = await (team === null ? statement : statement.bind(team)).all();
  const batches = new Map();
  for (const row of results) {
    const key = batchId({ batch: row.batch, albumId: row.album_id });
    if (!batches.has(key)) {
      batches.set(key, {
        id: key,
        album: {
          id: row.album_id,
          title: row.album_title,
          address: row.album_address,
          team: row.album_team,
          holding: row.album_holding === 1,
        },
        sentAt: row.sent_at,
        photos: [],
      });
    }
    batches.get(key).photos.push({
      id: row.id,
      sender: row.sender,
      accountName: row.account_name,
      caption: row.caption,
      capturedAt: row.captured_at,
      sentAt: row.sent_at,
      sizes: {
        grid: { width: row.grid_width, height: row.grid_height },
        screen: { width: row.screen_width, height: row.screen_height },
        full: { width: row.width, height: row.height },
      },
    });
  }
  return [...batches.values()].flatMap((batch, i) => {
    const parts = Math.ceil(batch.photos.length / PART_PHOTOS);
    if (parts === 1) return [{ ...batch, number: i + 1, part: 1, parts }];
    return Array.from({ length: parts }, (_, p) => ({
      ...batch,
      id: `${batch.id}-part-${p + 1}`,
      number: i + 1,
      part: p + 1,
      parts,
      photos: batch.photos.slice(p * PART_PHOTOS, (p + 1) * PART_PHOTOS),
    }));
  });
}

/**
 * What the admin home shows: how many photos wait, how many removal requests
 * wait (#158: a photo taken down with "Remove this photo" is hidden until an
 * admin puts it back or deletes it), and the bytes every stored row's objects
 * take, whatever its state. One query. The sum reads every row, about 11,000
 * at the storage allowance (CLAUDE.md item 8) against D1's 5 million a day,
 * and only an admin loads the home.
 */
export async function queueSummary(db) {
  const row = await db
    .prepare(
      "SELECT COUNT(CASE WHEN state = 'pending' AND kind = 'photo' THEN 1 END) AS waiting, " +
      "COUNT(CASE WHEN state = 'hidden' AND kind = 'photo' THEN 1 END) AS removals, " +
      'COALESCE(SUM(bytes), 0) AS bytes FROM photos',
    )
    .first();
  return { waiting: row.waiting, removals: row.removals, bytes: row.bytes };
}

/**
 * The media key of a stored photo, in any state, or null. What the admin's
 * image route serves from: a waiting photo in the queue, and an approved or
 * hidden one too, so a size opened from the queue still opens after the
 * approval. A photo is never `uploading` (the table's CHECK keeps that for
 * clips), so the kind is the whole test.
 */
export async function storedPhoto(db, id) {
  if (id === null) return null;
  const row = await db
    .prepare("SELECT media_key FROM photos WHERE id = ? AND kind = 'photo'")
    .bind(id)
    .first();
  return row?.media_key ?? null;
}
