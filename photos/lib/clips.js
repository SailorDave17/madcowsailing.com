/**
 * A clip sent in parts (#198): what the routes under functions/api/upload/clips/
 * share. CLAUDE.md, The photo site, item 33 has the decisions; item 10 the
 * design they build on.
 *
 * A clip is too large for one request (a Function takes 100 MB at most, and a
 * coach's clip may be 4 GiB), so it goes into the bucket as an R2 multipart
 * upload through the MEDIA binding, in parts of PART_BYTES sent one at a time:
 *
 *   POST   /api/upload/clips                  the upload starts: its row, its
 *                                             R2 upload, one of the day's 500
 *                                             and its size of the day's clip
 *                                             budget (spendDailyClip)
 *   PUT    /api/upload/clips/<id>/parts/<n>   one part
 *   POST   /api/upload/clips/<id>/complete    the parts joined, the clip
 *                                             checked, the row made pending
 *   DELETE /api/upload/clips/<id>             the upload abandoned
 *
 * The page has already blanked the clip's location and camera data in place
 * (public/js/clip.js, planClip). The server cannot strip a stored object, so
 * it checks instead: once the parts are joined, checkClip reads the clip's
 * boxes with ranged reads, and a clip still holding data outside the keep-list
 * is deleted before it can be approved (item 10). Samples a blanked track left
 * in the media data are the one thing the check cannot see; they rest on the
 * walker and its tests.
 *
 * Who may carry on an upload. The row cannot say: a coach's row keeps nothing
 * that names the coach (#192's review), and the size the page declared has no
 * column (0005's "Not chosen: writing page-declared values at uploading"). So
 * the start answers a token, clip1.<id>.<bytes>.<sig>, signed with the
 * session key over the upload's id, its size and sessionKey(session), and
 * every later request sends it back in the Clip-Upload header. Another phone,
 * another session or another size reads as an unknown upload. Not chosen:
 * matching the row's sender columns to the session, which lets any coach carry
 * on any coach's upload; a column holding a hash of the session, which keeps
 * coach-identifying data on the row while it uploads.
 *
 * A clip's row is `uploading` from its start until it is checked. Its
 * captured_at, width, height and bytes stay empty until then, as 0005 lets
 * only an uploading row, and are filled from the server's own reading in the
 * statement that makes it pending. An upload left unfinished is deleted a day
 * after it started (clearStaleClips), when the bucket's lifecycle rule has
 * aborted its parts too.
 */
import { checkClip, partCount, PART_BYTES } from '../public/js/clip.js';
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.js';
import { clipObjectKey, clipSeconds, readCapped, refundDailyUpload, senderColumns, sessionKey } from './photos.js';

// The two types a clip may be, as checkClip reads them from the file's ftyp:
// QuickTime's own brand, and everything else an MP4.
export const CLIP_TYPES = Object.freeze(['video/mp4', 'video/quicktime']);

// The request header carrying an upload's token.
export const UPLOAD_HEADER = 'Clip-Upload';

// An upload older than this is abandoned: the bucket's lifecycle rule aborts
// unfinished multipart uploads after one day (README, Hosting), so nothing an
// older row names can still be completed.
export const STALE_SECONDS = 24 * 60 * 60;

// At most this many abandoned uploads are cleared at a time, so a backlog
// costs one request a bounded number of bucket calls. Exported for the test
// that puts this many older rows ahead of a stale upload, which holds the
// sweep's own state filter and would prove nothing if it named 20 and this
// rose (test/clip-upload.test.js).
export const SWEEP_MAX = 20;

// The JSON bodies the start and the complete take. A complete lists every
// part's etag: a coach's 4 GiB is 164 parts, about 33 KB at the 171
// characters local dev gives a part's etag, and 256 KiB holds them at the
// 1,024 the complete allows (functions/api/upload/clips/[id]/complete.js).
export const START_MAX_BYTES = 4 * 1024;
export const COMPLETE_MAX_BYTES = 256 * 1024;

const ID = /^[1-9][0-9]{0,14}$/;
const TOKEN = /^clip1\.([1-9][0-9]{0,14})\.([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/;

/** An id or part number from the path, or null. */
export const readNumber = (text) => (typeof text === 'string' && ID.test(text) ? Number(text) : null);

/** A JSON answer that no cache keeps. */
export const answer = (status, body, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export const unavailable = () => answer(503, { error: 'unavailable' });

/**
 * The request's JSON object, or { refusal }: past `max` bytes it is 413 and
 * never parsed, and anything but a JSON object is 400.
 */
export async function readJson(request, max) {
  const bytes = await readCapped(request, max);
  if (bytes === null) return { refusal: answer(413, { error: 'too-large' }) };
  try {
    const fields = JSON.parse(new TextDecoder().decode(bytes));
    if (fields !== null && typeof fields === 'object' && !Array.isArray(fields)) return { fields };
  } catch {
    // Not JSON: refused below.
  }
  return { refusal: answer(400, { error: 'form' }) };
}

const tokenMessage = (id, bytes, session) => `clip.${id}.${bytes}.${sessionKey(session)}`;

/** The token the start answers, binding the upload to this session and size. */
export async function clipToken(secret, id, bytes, session) {
  return `clip1.${id}.${bytes}.${base64url(await hmac(secret, tokenMessage(id, bytes, session)))}`;
}

/**
 * The upload's declared size, { bytes }, when the request's Clip-Upload token
 * was signed for this id and this session; null for anything else, a missing
 * or malformed token included. Checked in constant time (hmacVerify).
 */
export async function readClipToken(request, secret, session, id) {
  const match = TOKEN.exec(request.headers.get(UPLOAD_HEADER) ?? '');
  if (!match || Number(match[1]) !== id) return null;
  const bytes = Number(match[2]);
  if (!Number.isSafeInteger(bytes)) return null;
  let signature;
  try {
    signature = fromBase64url(match[3]);
  } catch {
    return null;
  }
  return (await hmacVerify(secret, tokenMessage(id, bytes, session), signature)) ? { bytes } : null;
}

/** The exact size of part `n` of a clip of `bytes`: PART_BYTES, or what is left for the last. */
export function partBytes(bytes, n) {
  const parts = partCount(bytes);
  return n < parts ? PART_BYTES : bytes - (parts - 1) * PART_BYTES;
}

/** R2's error codes ride at the end of an error's message, as "(10024)". */
const r2Code = (err) => Number(/\((\d{5})\)\s*$/.exec(err instanceof Error ? err.message : '')?.[1]);

/** The upload was aborted, completed, or never existed (NoSuchUpload). */
export const noSuchUpload = (err) => r2Code(err) === 10024;

/** The parts named do not make an object R2 will join (InvalidPart, EntityTooSmall). */
export const badParts = (err) => [10011, 10025, 10048].includes(r2Code(err));

const message = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Write a clip's row, uploading, into the album at `address` if it is still
 * open, and return its id; null when it is not. As insertPhoto does, the album
 * check and the insert are one statement, and from an account the album's team
 * must be one it is approved for now. The type, length, size and capture time
 * stay empty until the clip is checked.
 */
export async function insertClip(db, address, clip) {
  const from = senderColumns(clip.session);
  const account = from.account_id !== null;
  const row = await db
    .prepare(
      'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, ' +
      'session_issued, account_id, caption, sent_at, upload_id) ' +
      "SELECT id, 'clip', 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ? " +
      'FROM albums WHERE address = ? AND closed_at IS NULL ' +
      (account
        ? "AND team IN (SELECT team FROM account_teams WHERE account_id = ? AND state = 'approved') "
        : '') +
      'RETURNING id',
    )
    .bind(
      clip.mediaKey, clip.batch, from.sender, from.code_generation, from.session_issued, from.account_id,
      clip.caption, clip.sentAt, clip.uploadId, address, ...(account ? [from.account_id] : []),
    )
    .first();
  return row?.id ?? null;
}

/** A clip's row: { mediaKey, uploadId, state, sentAt }, or null. */
export async function clipRow(db, id) {
  const row = await db
    .prepare("SELECT media_key, upload_id, state, sent_at FROM photos WHERE id = ? AND kind = 'clip'")
    .bind(id)
    .first();
  return row ? { mediaKey: row.media_key, uploadId: row.upload_id, state: row.state, sentAt: row.sent_at } : null;
}

/**
 * Make a checked clip pending, with what the server read from it, if its album
 * is still open (and, from an account, its team still approved), and return its
 * id; null when it is not, or when the row is no longer uploading. One
 * statement, so a clip whose album closed while its parts arrived takes
 * nothing, as a photo's insert does.
 */
export async function finishClip(db, id, session, clip) {
  const from = senderColumns(session);
  const account = from.account_id !== null;
  const row = await db
    .prepare(
      "UPDATE photos SET state = 'pending', content_type = ?, duration_ms = ?, width = ?, height = ?, " +
      'captured_at = ?, bytes = ?, upload_id = NULL ' +
      "WHERE id = ? AND kind = 'clip' AND state = 'uploading' " +
      'AND album_id IN (SELECT id FROM albums WHERE closed_at IS NULL' +
      (account
        ? " AND team IN (SELECT team FROM account_teams WHERE account_id = ? AND state = 'approved')"
        : '') +
      ') RETURNING id',
    )
    .bind(
      clip.contentType, clip.durationMs, clip.width, clip.height, clip.captured, clip.bytes, id,
      ...(account ? [from.account_id] : []),
    )
    .first();
  return row?.id ?? null;
}

/**
 * Let go of whatever the bucket holds for an upload: abort its R2 upload, then
 * delete any object a complete made. Deleting a key that is not there is not an
 * error to R2, nor is aborting an upload that is gone here. A failure is
 * logged with the object's prefix, which names no one and is the only way to
 * find what was left (README, The photo site); nothing here throws.
 */
async function releaseObjects(bucket, mediaKey, uploadId) {
  const key = clipObjectKey(mediaKey);
  if (uploadId) {
    try {
      await bucket.resumeMultipartUpload(key, uploadId).abort();
    } catch (err) {
      if (!noSuchUpload(err)) console.error(`clips: bucket did not abort photos/${mediaKey}/:`, message(err));
    }
  }
  try {
    await bucket.delete(key);
  } catch (err) {
    console.error(`clips: bucket did not delete photos/${mediaKey}/:`, message(err));
  }
}

/**
 * Take back an upload that will not become a clip: the row first, and only
 * while it is still uploading, then its parts or object, then the day's
 * upload, and its `bytes` of the day's clip budget, given back on the day
 * they were spent. `bytes` is the size the upload's token declared. The row
 * goes first for the reason a reject's does (CLAUDE.md, item 16): a complete
 * that finished this clip meanwhile has made it pending, and then nothing
 * here touches its object. True when this call took it back, false when the
 * row was no longer uploading, null when the database did not answer (the
 * sweep takes it back a day later). Nothing here throws.
 */
export async function dropClip(env, session, id, row, bytes) {
  let gone;
  try {
    gone = await env.DB
      .prepare("DELETE FROM photos WHERE id = ? AND kind = 'clip' AND state = 'uploading' RETURNING id")
      .bind(id)
      .first();
  } catch (err) {
    console.error(`clips: database did not take back clip ${id}; the sweep will:`, message(err));
    return null;
  }
  if (!gone) return false;
  await releaseObjects(env.MEDIA, row.mediaKey, row.uploadId);
  await refundDailyUpload(env.DB, session, row.sentAt, bytes);
  return true;
}

/**
 * Clear uploads abandoned more than a day ago, at most SWEEP_MAX at a time:
 * one statement deletes their rows, still uploading, and names them; then each
 * one's R2 upload is aborted and any object it made deleted. Run at the start of
 * every clip and on every admin home load, since Pages runs no scheduled job,
 * so an abandoned upload neither blocks its album's delete nor waits in the
 * bucket. No day's upload is given back: that day is over. Best effort: a
 * failure is logged and never fails the request.
 */
export async function clearStaleClips(env, now) {
  let rows;
  try {
    // The subquery's own state filter is what reaches an upload behind older
    // stored rows: without it the LIMIT takes the oldest SWEEP_MAX rows of any
    // state, the DELETE finds none of them uploading, and every sweep picks
    // the same ones (#198's review).
    rows = (await env.DB
      .prepare(
        "DELETE FROM photos WHERE state = 'uploading' AND id IN (SELECT id FROM photos " +
        "WHERE state = 'uploading' AND sent_at <= ? ORDER BY sent_at LIMIT ?) RETURNING media_key, upload_id",
      )
      .bind(now - STALE_SECONDS, SWEEP_MAX)
      .all()).results;
  } catch (err) {
    console.error('clips: could not clear abandoned uploads:', message(err));
    return 0;
  }
  for (const row of rows) await releaseObjects(env.MEDIA, row.media_key, row.upload_id);
  return rows.length;
}

/**
 * Check a completed clip in the bucket with ranged reads (item 10): the
 * result of checkClip, never reading the media data itself.
 */
export function checkStored(bucket, key, size) {
  const read = async (offset, length) => {
    const object = await bucket.get(key, { range: { offset, length } });
    if (object === null) throw new Error('the clip is gone from the bucket');
    return new Uint8Array(await object.arrayBuffer());
  };
  return checkClip(read, size);
}

/** Whether a checked clip runs longer than this session may send (D11). */
export const tooLong = (session, durationMs) => durationMs > clipSeconds(session) * 1000;
