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
 * Since #228 a press can also move waiting photos into one of their team's
 * events (movePhotos), and a photo in a team's "Not sure / other event" is
 * never approved here (approvePhotos), until it is moved.
 *
 * Since #198 a clip waits here beside the photos (owner, at #198's pickup):
 * it is shown, captioned, approved, moved and rejected as a photo is, in its
 * batch, and every statement here takes both kinds but storedPhoto() and
 * storedClip(), which serve one each. Its state keeps a clip still arriving
 * in parts out: it is `uploading` until the server has checked it
 * (lib/clips.js), and only `pending` waits. An approved clip is kept and
 * shown nowhere public until #286, since every public and removals statement
 * still names kind = 'photo' (lib/public.js, lib/removals.js). The presses
 * name clips apart in their notices, from the kind each statement already
 * returns, so no press makes a statement more for them (CLAUDE.md, item 16,
 * counts them). Not chosen: a page of their own for clips, which would split
 * a batch's photos from its clips.
 */
import { CONTROL } from './albums.js';
import { clipObjectKey, photoObjectKeys, readCaption } from './photos.js';

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
 * Save each caption that differs from what is stored, on photos and clips
 * still waiting, and return the ids whose caption changed, in no set order.
 * One statement: the captions travel as a JSON object keyed by id. A caption
 * the CHECK would refuse never gets here, since readPress() refused it first.
 * Save captions lands on the last of them in the page's order (#270).
 */
export async function saveCaptions(db, captions) {
  if (!Object.keys(captions).length) return [];
  const { results } = await db
    .prepare(
      'UPDATE photos SET caption = c.caption ' +
      'FROM (SELECT CAST(key AS INTEGER) AS id, value AS caption FROM json_each(?)) AS c ' +
      "WHERE photos.id = c.id AND photos.state = 'pending' " +
      'AND photos.caption IS NOT c.caption ' +
      'RETURNING photos.id',
    )
    .bind(JSON.stringify(captions))
    .all();
  return results.map((row) => row.id);
}

/**
 * How many of `captions` were typed for photos and clips no longer waiting,
 * approved or hidden since the page loaded, and differ from what they carry,
 * so will not be saved: { photos, clips }, each kind counted apart for the
 * notice (#198), in the one statement. Run before the press saves or changes
 * anything: after the save every waiting row's caption matches, so the state
 * test would decide nothing, and after an approval the press's own photos
 * would count. A photo rejected meanwhile has no row, and its caption no
 * longer matters. A clip still uploading was never on the page, so only the
 * two states a waiting row leaves for count.
 */
export async function unsavedCaptions(db, captions) {
  if (!Object.keys(captions).length) return { photos: 0, clips: 0 };
  return db
    .prepare(
      "SELECT COUNT(CASE WHEN p.kind = 'photo' THEN 1 END) AS photos, " +
      "COUNT(CASE WHEN p.kind = 'clip' THEN 1 END) AS clips FROM photos AS p " +
      'JOIN (SELECT CAST(key AS INTEGER) AS id, value AS caption FROM json_each(?)) AS c ON p.id = c.id ' +
      "WHERE p.state IN ('approved', 'hidden') AND p.caption IS NOT c.caption",
    )
    .bind(JSON.stringify(captions))
    .first();
}

/** unsavedCaptions()'s counts as the notice's fields, each left out at 0. */
export const unsavedFields = ({ photos, clips }) => ({ unsaved: photos || null, 'unsaved-clips': clips || null });

// The ids among a statement's RETURNING rows that are clips (#198), which a
// notice names apart (acted).
const clipIds = (rows) => rows.filter((row) => row.kind === 'clip').map((row) => row.id);

/**
 * Approve the photos and clips among `ids` that are still waiting, recording
 * `now`, and return { approved, clips }: the ids approved, and which of them
 * are clips (#198), from the same statement. Nothing else about any row
 * changes. An approved clip is kept and shown nowhere public until #286.
 *
 * A photo or clip still in a team's "Not sure / other event" (#228) is left
 * waiting: it has no event to be public in until an admin moves it into one
 * (movePhotos). Migration 0015 refuses the change too, whatever the kind, but
 * it would refuse the whole statement, so the rows beside it in a press would
 * not be approved either; here they are, and notSureWaiting() says why the
 * rest were not.
 */
export async function approvePhotos(db, ids, now) {
  const { results } = await db
    .prepare(
      "UPDATE photos SET state = 'approved', approved_at = ? " +
      "WHERE state = 'pending' AND id IN (SELECT value FROM json_each(?)) " +
      'AND album_id NOT IN (SELECT id FROM albums WHERE holding = 1) ' +
      'RETURNING id, kind',
    )
    .bind(now, JSON.stringify(ids))
    .all();
  return { approved: results.map((row) => row.id), clips: clipIds(results) };
}

/**
 * How many of `ids` wait in a team's Not sure album (#228), as { photos,
 * clips } (#198): what an approval left alone, so the queue can say why.
 */
export async function notSureWaiting(db, ids) {
  return db
    .prepare(
      "SELECT COUNT(CASE WHEN kind = 'photo' THEN 1 END) AS photos, " +
      "COUNT(CASE WHEN kind = 'clip' THEN 1 END) AS clips FROM photos " +
      "WHERE state = 'pending' AND id IN (SELECT value FROM json_each(?)) " +
      'AND album_id IN (SELECT id FROM albums WHERE holding = 1)',
    )
    .bind(JSON.stringify(ids))
    .first();
}

/**
 * The teams of the albums the waiting photos and clips among `ids` are in:
 * one team for any press the page made, since a batch is one album. A press
 * naming none still waiting gets [], and one naming two teams was not made by
 * the page.
 */
export async function waitingTeams(db, ids) {
  const { results } = await db
    .prepare(
      'SELECT DISTINCT a.team FROM photos AS p JOIN albums AS a ON a.id = p.album_id ' +
      "WHERE p.state = 'pending' AND p.id IN (SELECT value FROM json_each(?))",
    )
    .bind(JSON.stringify(ids))
    .all();
  return results.map((row) => row.team);
}

/**
 * Move the photos and clips among `ids` that are still waiting into the event
 * at `address` (#228), and return { moved, clips }: the ids moved, and which
 * of them are clips (#198). Any waiting photo moves, from an event or from a
 * Not sure album (owner, at #228's pickup), but only within its team, and
 * only into an event, open or closed, never into a Not sure album. One
 * statement, so the album's team is read as the photos move: an album moved
 * to the other team meanwhile takes nothing. A photo already in that event is
 * left as it is. Its batch stays, so the queue shows the moved photos as a
 * batch of the event they are in now (waitingBatches).
 */
export async function movePhotos(db, ids, address) {
  const { results } = await db
    .prepare(
      'UPDATE photos SET album_id = t.id ' +
      'FROM (SELECT id, team FROM albums WHERE address = ? AND holding = 0) AS t ' +
      "WHERE photos.state = 'pending' " +
      'AND photos.id IN (SELECT value FROM json_each(?)) ' +
      'AND photos.album_id <> t.id ' +
      'AND photos.album_id IN (SELECT id FROM albums WHERE team = t.team) ' +
      'RETURNING photos.id, photos.kind',
    )
    .bind(address, JSON.stringify(ids))
    .all();
  return { moved: results.map((row) => row.id), clips: clipIds(results) };
}

// The R2 keys a waiting row's media lies under: a photo's three sizes, or a
// clip's one object (#198), all under its photos/<key>/ prefix.
const objectKeys = (row) => (row.kind === 'clip'
  ? [clipObjectKey(row.media_key)]
  : Object.values(photoObjectKeys(row.media_key)));

/**
 * Reject the photos and clips among `ids` that are still waiting: delete
 * their rows, then their objects, a photo's three and a clip's one. Returns
 * { rejected, clips, kept, keptClips }: the ids whose rows were deleted,
 * which of them were clips (#198), and how many photos and how many clips
 * kept objects the bucket did not delete. The kind comes back from the
 * DELETE itself, so a press makes no statement more for clips (CLAUDE.md,
 * item 16, counts them).
 *
 * Rows first, the mirror of the upload's objects-first: either way no row
 * ever names objects that are gone. A delete the bucket refuses leaves
 * objects no row names, invisible and costing storage, so the log names each
 * row's photos/<key>/ prefix, in the words the upload route uses, and
 * README.md says how to delete them by it. A clip's object sits under the
 * same prefix (lib/photos.js, clipObjectKey), so the same recipe covers it.
 */
export async function rejectPhotos(db, bucket, ids) {
  const { results } = await db
    .prepare(
      "DELETE FROM photos WHERE state = 'pending' " +
      'AND id IN (SELECT value FROM json_each(?)) RETURNING id, media_key, kind',
    )
    .bind(JSON.stringify(ids))
    .all();
  // Whole rows per call, as many as R2's 1,000 keys take, so a refused call
  // names exactly its rows: 333 photos, or 1,000 clips, or a mix. Until #198,
  // when every row was a photo's three keys, that was a fixed 333.
  const calls = [];
  for (const row of results) {
    const keys = objectKeys(row);
    const last = calls.at(-1);
    if (last && last.keys.length + keys.length <= DELETE_KEYS_MAX) {
      last.rows.push(row);
      last.keys.push(...keys);
    } else {
      calls.push({ rows: [row], keys });
    }
  }
  let kept = 0;
  let keptClips = 0;
  for (const call of calls) {
    try {
      await bucket.delete(call.keys);
    } catch (err) {
      for (const { kind, media_key: mediaKey } of call.rows) {
        if (kind === 'clip') keptClips += 1;
        else kept += 1;
        console.error(`queue: bucket did not delete photos/${mediaKey}/ after a reject:`, err instanceof Error ? err.message : String(err));
      }
    }
  }
  return { rejected: results.map((row) => row.id), clips: clipIds(results), kept, keptClips };
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

/**
 * The notice's count for what a press acted on: one by its id, more by how
 * many. `clips` are the ids among them that are clips (#198): one clip is
 * `clip`, not `photo`, and more are counted apart, `n` photos and `clips`
 * clips, each left out at 0, so a press that acted on photos alone reads as
 * it did before clips.
 */
export const acted = (ids, clips = []) => {
  if (ids.length === 1) return clips.length ? { clip: ids[0] } : { photo: ids[0] };
  return { n: ids.length - clips.length || null, clips: clips.length || null };
};

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
 * criterion 3, D17), for the admins alone: `accountName`, null for the
 * invite link, a coach's Access sign-in, or an account since deleted.
 *
 * A batch sent to a team's "Not sure / other event" says so (`album.holding`,
 * #228), so the page offers no approval for it.
 *
 * Since #198 a batch's `photos` holds its waiting clips too, in the same sent
 * order, each with `kind` saying which it is. A photo carries its three
 * sizes; a clip its frame size and how long it runs, in milliseconds. The
 * list keeps its name, since every caller and the page's own order
 * (waitingOrder) read it. A clip still `uploading` is not waiting.
 */
export async function waitingBatches(db, team = null) {
  // The columns from p.kind on are new since #198; the statement still opens
  // on p.id, p.batch, p.sender, which test/not-sure.test.js reads it by.
  const statement = db.prepare(
    'SELECT p.id, p.batch, p.sender, p.kind, p.caption, p.captured_at, p.sent_at, p.width, p.height, ' +
    'p.grid_width, p.grid_height, p.screen_width, p.screen_height, p.duration_ms, ' +
    'a.id AS album_id, a.title AS album_title, a.address AS album_address, a.team AS album_team, ' +
    'a.holding AS album_holding, acc.name AS account_name ' +
    'FROM photos AS p JOIN albums AS a ON a.id = p.album_id ' +
    'LEFT JOIN accounts AS acc ON acc.id = p.account_id ' +
    "WHERE p.state = 'pending' " +
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
    const common = {
      id: row.id,
      kind: row.kind,
      sender: row.sender,
      accountName: row.account_name,
      caption: row.caption,
      capturedAt: row.captured_at,
      sentAt: row.sent_at,
    };
    batches.get(key).photos.push(row.kind === 'clip'
      ? { ...common, width: row.width, height: row.height, durationMs: row.duration_ms }
      : {
        ...common,
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
 * What the admin home shows: how many photos wait, how many clips wait
 * (`clips`, #198), how many removal requests wait (#158: a photo taken down
 * with "Remove this photo" is hidden until an admin puts it back or deletes
 * it), and the bytes every stored row's objects take, whatever its state. One
 * query. The sum reads every row, about 11,000 at the storage allowance
 * (CLAUDE.md item 8) against D1's 5 million a day, and only an admin loads
 * the home. A clip still uploading has no bytes yet, and a removal request is
 * a photo's until #286 brings clips into removals.
 */
export async function queueSummary(db) {
  const row = await db
    .prepare(
      "SELECT COUNT(CASE WHEN state = 'pending' AND kind = 'photo' THEN 1 END) AS waiting, " +
      "COUNT(CASE WHEN state = 'pending' AND kind = 'clip' THEN 1 END) AS clips, " +
      "COUNT(CASE WHEN state = 'hidden' AND kind = 'photo' THEN 1 END) AS removals, " +
      'COALESCE(SUM(bytes), 0) AS bytes FROM photos',
    )
    .first();
  return { waiting: row.waiting, clips: row.clips, removals: row.removals, bytes: row.bytes };
}

/**
 * The media key of a stored photo, in any state, or null. What the admin's
 * image route serves from: a waiting photo in the queue, and an approved or
 * hidden one too, so a size opened from the queue still opens after the
 * approval. A photo is never `uploading` (the table's CHECK keeps that for
 * clips), so the kind is the whole test. A clip is never a photo here: it
 * has storedClip().
 */
export async function storedPhoto(db, id) {
  if (id === null) return null;
  const row = await db
    .prepare("SELECT media_key FROM photos WHERE id = ? AND kind = 'photo'")
    .bind(id)
    .first();
  return row?.media_key ?? null;
}

/**
 * A stored clip (#198): { mediaKey, contentType, bytes }, or null for an id
 * that is none, a photo, or a clip still `uploading`, whose object is not
 * whole and has not been checked (lib/clips.js). What the admin clip route
 * serves from (functions/api/admin/clips/[id].js): a waiting clip in the
 * queue, and an approved or hidden one too, as storedPhoto() serves a photo.
 * `bytes` is the object's size as the server read it, which answers a range
 * past the end without reading the bucket.
 */
export async function storedClip(db, id) {
  if (id === null) return null;
  const row = await db
    .prepare("SELECT media_key, content_type, bytes FROM photos WHERE id = ? AND kind = 'clip' AND state <> 'uploading'")
    .bind(id)
    .first();
  return row ? { mediaKey: row.media_key, contentType: row.content_type, bytes: row.bytes } : null;
}
