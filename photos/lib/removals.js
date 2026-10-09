/**
 * "Remove this photo" (#158): anyone hides an approved photo from everyone at
 * once, and an admin then puts it back or deletes it on /admin/removals.
 *
 * Epic #147's D7 chose this over leaving a photo up until the owner decides:
 * the kindest behaviour for a family is that the photo goes now. The cost is
 * that anyone can hide a photo, so each network address may hide at most
 * REMOVAL_LIMIT an hour, and an admin can put a photo back.
 *
 * The routes:
 *   POST /remove                 the no-JavaScript confirmation page
 *                                (functions/remove.js); changes nothing
 *   POST /api/remove             the takedown itself (functions/api/remove.js)
 *   GET  /admin/removals         the hidden photos, for an admin
 *   POST /api/admin/removals/restore   "Put it back"
 *   POST /api/admin/removals/delete    "Delete permanently"
 *
 * A hidden photo leaves every public statement, which names state =
 * 'approved' (lib/public.js), so its image routes answer 404 from the next
 * request and its album page no longer lists it. Its row and its three
 * objects stay, and the admin image route still serves it (lib/queue.js,
 * storedPhoto), so the removals page can show it.
 *
 * "Put it back" keeps hidden_at and the note on the row, as a record (owner,
 * at #158's pickup, 2026-09-30). Not chosen: clearing both. A later takedown
 * of the same photo writes its own time and note over them.
 *
 * Since #225 an admin's "Hide all their photos" (lib/people.js, hidePhotos)
 * hides an account's waiting photos here too, so a hidden photo may never
 * have been approved. 0005's CHECK requires approved_at on every hidden row,
 * so such a photo carries approved_at 0, which no approval is ever made at
 * (WAITING_WHEN_HIDDEN), and "Put it back" sends it back to the queue rather
 * than making it public: /policy says every photo is checked first.
 *
 * Clips wait for #286, as every public statement does: every statement here
 * names kind = 'photo'. #198 brought them into the approval queue only.
 */
import { photoObjectKeys } from './photos.js';

// 10 takedowns an hour from one address, counting only those that hid a
// photo: the owner's choice at #158's pickup (2026-09-30), confirming the
// story's figure. Not chosen: counting every request, 404s included, which
// costs a D1 write per bad request (the reason #177 budgets the join route's);
// 5 an hour; 20 an hour. The address counts IPv4 whole and IPv6 by its /64
// (lib/address.js), as the join limit does.
export const REMOVAL_LIMIT = 10;
export const REMOVAL_WINDOW_SECONDS = 60 * 60;

// The optional note, in characters (code points), as 0005's CHECK counts it.
export const NOTE_MAX = 500;

// A takedown's form holds a photo id and a note of at most NOTE_MAX
// characters. Encoded, the widest of those (a four-byte character, or a
// line break sent as %0D%0A) is 12 characters of form each, so this is room
// for any note with plenty to spare; readForm's own 4 KiB default is not
// (test/removals.test.js sends NOTE_MAX four-byte characters through the
// route). A body past it reads as an empty form, so the takedown is refused
// as naming nothing. Only an older Safari, counting a whole emoji as one
// against maxlength (see readNote), can fill a note that wide.
export const REMOVE_FORM_BYTES = 16 * 1024;

// Every control character but the line break, which a note may keep.
const NOTE_CONTROL = new RegExp(`(?!\\n)[\\p{Cc}${String.fromCharCode(0x2028, 0x2029)}]`, 'gu');

/**
 * The note field as stored: line breaks kept (a textarea sends each as
 * CR LF, counted here as one), every other control character a space, the
 * ends trimmed, and null when nothing is left.
 *
 * A note past `max` characters (NOTE_MAX unless told otherwise) is cut to its
 * first `max` rather than refused: the takedown matters more than the note,
 * and a parent in a hurry should not lose the one for the other. The field's
 * maxlength counts UTF-16 units in every current browser, which is never
 * looser than characters, so only an older Safari or no browser at all can
 * send one. WebKit counted a whole emoji as one until 260838@main (bug 252900,
 * fixed 2023-02-25), when it matched Chrome and Firefox. The note with a
 * request for an account (#220, lib/accounts.js) is read the same way, with
 * its own cap.
 */
export function readNote(value, max = NOTE_MAX) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').replace(NOTE_CONTROL, ' ').trim();
  const note = [...text].slice(0, max).join('').trimEnd();
  return note || null;
}

const APPROVED = "p.state = 'approved' AND p.kind = 'photo'";

/**
 * The approved_at a hidden photo carries when it was hidden while still
 * waiting for approval (#225): a placeholder, as 0012's code generation 0 is,
 * since no photo is ever approved at Unix time 0.
 */
export const WAITING_WHEN_HIDDEN = 0;

/**
 * An approved photo and its album, for the no-JavaScript confirmation page,
 * or null when the photo is not public: the same answer any public route
 * gives it.
 */
export async function removablePhoto(db, id) {
  if (id === null) return null;
  const row = await db
    .prepare(
      'SELECT p.id, p.caption, p.grid_width, p.grid_height, a.title, a.address ' +
      `FROM photos AS p JOIN albums AS a ON a.id = p.album_id WHERE p.id = ? AND ${APPROVED}`,
    )
    .bind(id)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    caption: row.caption,
    grid: { width: row.grid_width, height: row.grid_height },
    album: { title: row.title, address: row.address },
  };
}

// How many takedowns this address made in the last hour, and when the oldest
// of them was, which says when the next one is allowed.
async function recentTakedowns(db, address, since) {
  return db
    .prepare('SELECT COUNT(*) AS n, MIN(requested_at) AS oldest FROM removal_requests WHERE address_hash = ? AND requested_at > ?')
    .bind(address, since)
    .first();
}

/**
 * Hide the approved photo `id` for the visitor whose keyed address hash is
 * `address`, with `note` (readNote's), at `now`. Returns one of:
 *
 *   { outcome: 'limited', retryAfter }   REMOVAL_LIMIT takedowns from this
 *                                        address in the last hour: nothing
 *                                        changes
 *   { outcome: 'gone' }                  the photo is not public (pending,
 *                                        hidden, deleted, a clip or unknown):
 *                                        nothing changes, and nothing is
 *                                        written
 *   { outcome: 'hidden', address, team, shown }
 *                                        hidden; `address` and `team` are its
 *                                        album's (#227), and `shown` whether
 *                                        the album still has an approved
 *                                        photo to show
 *
 * The limit is read first, so an address past it learns nothing about any
 * photo. The photo is read before anything is written, so the common refusal
 * spends no D1 write. Then one unit of the address's hour is claimed by one
 * statement that counts and inserts together, so two takedowns arriving at
 * once from one address cannot both take its tenth. Only then is the photo
 * hidden, by a statement that finds it still approved; if another takedown
 * got there first, or the statement throws, the unit is given back, so a
 * unit is spent only by a photo hidden (the review of #158 found the throw
 * case keeping it). Last, rows more than an hour old are deleted, so the log
 * is tidied by a takedown, never by a refusal; the admin pages tidy it too
 * (clearExpiredTakedowns).
 *
 * Once the photo is hidden the answer is 'hidden', whatever follows. The
 * tidy-up and the album lookup after it may fail on their own, and a failure
 * there is logged, never turned into "nothing was changed" (the review's
 * other finding): the album lookup failing answers { address: null, team:
 * null, shown: false }, which sends the browser to /.
 */
export async function requestRemoval(db, { id, note, address, now }) {
  const since = now - REMOVAL_WINDOW_SECONDS;
  const limited = async () => {
    const recent = await recentTakedowns(db, address, since);
    return { outcome: 'limited', retryAfter: Math.max(1, (recent.oldest ?? now) + REMOVAL_WINDOW_SECONDS - now) };
  };

  const recent = await recentTakedowns(db, address, since);
  if (recent.n >= REMOVAL_LIMIT) return limited();
  if (id === null) return { outcome: 'gone' };
  const shown = await db
    .prepare(`SELECT p.id FROM photos AS p WHERE p.id = ? AND ${APPROVED}`)
    .bind(id)
    .first();
  if (shown === null) return { outcome: 'gone' };

  const claimed = await db
    .prepare(
      'INSERT INTO removal_requests (address_hash, requested_at) SELECT ?, ? ' +
      'WHERE (SELECT COUNT(*) FROM removal_requests WHERE address_hash = ? AND requested_at > ?) < ? ' +
      'RETURNING rowid',
    )
    .bind(address, now, address, since, REMOVAL_LIMIT)
    .first('rowid');
  if (claimed === null || claimed === undefined) return limited();

  // The unit goes back when nothing was hidden. Its own failure is logged and
  // left, as refundDailyUpload's is (lib/photos.js): at worst the address has
  // one fewer takedown for the hour, and the answer stays the true one.
  const giveBack = async () => {
    try {
      await db.prepare('DELETE FROM removal_requests WHERE rowid = ?').bind(claimed).run();
    } catch (err) {
      console.error('remove: could not give back a takedown that hid nothing:', err instanceof Error ? err.message : String(err));
    }
  };
  let albumId;
  try {
    albumId = await db
      .prepare(
        "UPDATE photos SET state = 'hidden', hidden_at = ?, hidden_note = ? " +
        "WHERE id = ? AND kind = 'photo' AND state = 'approved' RETURNING album_id",
      )
      .bind(now, note, id)
      .first('album_id');
  } catch (err) {
    await giveBack();
    throw err;
  }
  if (albumId === null || albumId === undefined) {
    await giveBack();
    return { outcome: 'gone' };
  }

  await clearExpiredTakedowns(db, now);
  try {
    const album = await db
      .prepare(
        'SELECT a.address, a.team, EXISTS (SELECT 1 FROM photos AS p WHERE p.album_id = a.id AND ' +
        `${APPROVED}) AS shown FROM albums AS a WHERE a.id = ?`,
      )
      .bind(albumId)
      .first();
    return { outcome: 'hidden', address: album.address, team: album.team, shown: album.shown === 1 };
  } catch (err) {
    console.error(`remove: photo ${id} is hidden, but its album could not be read:`, err instanceof Error ? err.message : String(err));
    return { outcome: 'hidden', address: null, team: null, shown: false };
  }
}

/**
 * Delete the takedowns more than an hour old, which no longer count. The next
 * takedown runs this, and so does every load of /admin and /admin/removals
 * (owner, at #158's review: a bound set by the next admin visit, where the
 * next takedown alone could leave a scrambled address for months). A load
 * with nothing expired writes no row. A failure is logged and left: the rows
 * count for nothing once they are an hour old, so only how long they are kept
 * is at stake, never the limit.
 */
export async function clearExpiredTakedowns(db, now) {
  try {
    await db.prepare('DELETE FROM removal_requests WHERE requested_at <= ?').bind(now - REMOVAL_WINDOW_SECONDS).run();
  } catch (err) {
    console.error('remove: could not clear takedowns more than an hour old:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Every hidden photo, the oldest takedown first, with its album, when it was
 * hidden and the note, for /admin/removals. One query, by the photos_by_state
 * index; the hidden rows are few, so the sort by hidden_at is cheap. `team`
 * keeps only the photos in that team's albums (#227), for the page's team
 * filter; null keeps every team's. `accountName` is the name of the account
 * that sent it (#223, criterion 3, D17), for the admins alone, or null.
 * `waiting` says it was hidden while still waiting for approval (#225), so
 * "Put it back" returns it to the queue.
 */
export async function hiddenPhotos(db, team = null) {
  const statement = db.prepare(
    'SELECT p.id, p.caption, p.hidden_at, p.hidden_note, p.grid_width, p.grid_height, p.approved_at, ' +
    'a.title AS album_title, a.address AS album_address, a.team AS album_team, acc.name AS account_name ' +
    'FROM photos AS p JOIN albums AS a ON a.id = p.album_id ' +
    'LEFT JOIN accounts AS acc ON acc.id = p.account_id ' +
    "WHERE p.state = 'hidden' AND p.kind = 'photo' " +
    (team === null ? '' : 'AND a.team = ? ') +
    'ORDER BY p.hidden_at, p.id',
  );
  const { results } = await (team === null ? statement : statement.bind(team)).all();
  return results.map((row) => ({
    id: row.id,
    caption: row.caption,
    hiddenAt: row.hidden_at,
    note: row.hidden_note,
    waiting: row.approved_at === WAITING_WHEN_HIDDEN,
    accountName: row.account_name,
    grid: { width: row.grid_width, height: row.grid_height },
    album: { title: row.album_title, address: row.album_address, team: row.album_team },
  }));
}

/**
 * "Put it back": make the hidden photo `id` approved again, or, for one hidden
 * while it was still waiting (#225), waiting again, back in the queue with no
 * approval time. Answers the state it went back to, 'approved' or 'pending',
 * or null when it was not hidden. hidden_at and the note stay on the row
 * (owner, at pickup). An approved photo's approved_at is its first approval
 * and is not moved.
 */
export async function restorePhoto(db, id) {
  if (id === null) return null;
  const row = await db
    .prepare(
      `UPDATE photos SET state = CASE WHEN approved_at = ${WAITING_WHEN_HIDDEN} THEN 'pending' ELSE 'approved' END, ` +
      `approved_at = CASE WHEN approved_at = ${WAITING_WHEN_HIDDEN} THEN NULL ELSE approved_at END ` +
      "WHERE id = ? AND kind = 'photo' AND state = 'hidden' RETURNING state",
    )
    .bind(id)
    .first();
  return row === null ? null : row.state;
}

/**
 * "Delete permanently": delete the hidden photo `id`'s row, then its three
 * objects. Returns { deleted, kept }: whether the row went, and whether the
 * bucket refused to delete the objects.
 *
 * Row first, as a reject does (lib/queue.js), so no row ever names objects
 * that are gone. A delete the bucket refuses leaves objects no row names, so
 * the log names the photo's photos/<key>/ prefix in the words the upload and
 * the queue use, and README.md says how to delete them by it.
 */
export async function deletePhoto(db, bucket, id) {
  if (id === null) return { deleted: false, kept: false };
  const row = await db
    .prepare("DELETE FROM photos WHERE id = ? AND kind = 'photo' AND state = 'hidden' RETURNING media_key")
    .bind(id)
    .first();
  if (row === null) return { deleted: false, kept: false };
  const mediaKey = row.media_key;
  try {
    await bucket.delete(Object.values(photoObjectKeys(mediaKey)));
    return { deleted: true, kept: false };
  } catch (err) {
    console.error(`removals: bucket did not delete photos/${mediaKey}/ after a delete:`, err instanceof Error ? err.message : String(err));
    return { deleted: true, kept: true };
  }
}

/**
 * Where a press on /admin/removals sends the browser back to, with its
 * notice's fields (undefined and null ones left out).
 */
export function removalsLocation(params) {
  const kept = Object.entries(params).filter(([, value]) => value !== undefined && value !== null);
  const query = new URLSearchParams(kept.map(([name, value]) => [name, String(value)])).toString();
  return `/admin/removals${query ? `?${query}` : ''}`;
}
