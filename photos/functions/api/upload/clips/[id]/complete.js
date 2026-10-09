/**
 * POST /api/upload/clips/<id>/complete: a clip's parts joined and the clip
 * checked (#198). lib/clips.js has the whole exchange; CLAUDE.md, The photo
 * site, items 10 and 33 the decisions.
 *
 * JSON, with the token from the start in the Clip-Upload header:
 *
 *   parts     [{ partNumber, etag }, …], one for every part, as each part's
 *             answer gave its etag (the binding has no way to list them)
 *   captured  when the clip was recorded, Unix seconds, as for a photo
 *
 * Once R2 has joined the parts, the server reads the clip's boxes with ranged
 * reads (checkClip). A clip that still holds data outside the walker's
 * keep-list, or is not one this site keeps, or runs longer than its sender
 * may send, is deleted before it can be approved, and the day's upload is
 * given back. Otherwise one statement makes it pending, with the type, length,
 * frame size and byte size the server read itself, if its album is still open.
 *
 * The answers, each JSON with Cache-Control: no-store:
 *
 *   201 {"id": n}                stored and waiting for approval; also the
 *                                answer to a complete sent again after the
 *                                first one's answer was lost
 *   400 {"error": "form" | "captured" | "parts"}   parts missing, repeated or
 *                                not the ones stored, or a clip whose size is
 *                                not the one started (the clip is deleted)
 *   404 {"error": "upload"}      no upload this session started with this id,
 *                                or one taken back while this complete checked
 *                                it: cleared by the day-old sweep, refused by
 *                                another complete of it sent at the same time,
 *                                or abandoned by the sender's Remove
 *   409 {"error": "album"}       the album closed, or the account's team was
 *                                revoked, while the parts arrived: deleted
 *   413 {"error": "too-long"}    longer than this sender may send: deleted
 *   415 {"error": "not-clip"}    not an MP4 or MOV the site can check, or not
 *                                the type it started as: deleted
 *   422 {"error": "kept"}        still holding data outside the keep-list:
 *                                deleted
 *   503 {"error": "unavailable"} the database or the bucket did not answer;
 *                                the upload stays, and the page may send this
 *                                again
 */
import {
  COMPLETE_MAX_BYTES, answer, badParts, checkStored, clipRow, dropClip, finishClip, noSuchUpload,
  readClipToken, readJson, readNumber, tooLong, unavailable,
} from '../../../../../lib/clips.js';
import { clipObjectKey, readCaptured } from '../../../../../lib/photos.js';
import { partCount } from '../../../../../public/js/clip.js';

// What checkClip refuses because data is still there to blank, as against a
// file the site cannot read at all.
const KEPT = new Set(['kept', 'trailing', 'unchecked']);

// A part's etag is opaque: local dev (miniflare) answers 171 characters,
// 128 random bytes in base64url, where R2's documentation shows a part's S3
// etag as 32 hex digits and does not say what the binding gives. So any
// printable run up to 1,024 characters, which R2's complete() then checks.
// Until #198's browser run this allowed 128, refused every real complete,
// and passed every test, whose stand-in gave 32 (test/r2.js).
const ETAG = /^[\x21-\x7e]{1,1024}$/;

/** The parts named, each 1 to `count` exactly once with an etag, or null. */
function readParts(value, count) {
  if (!Array.isArray(value) || value.length !== count) return null;
  const seen = new Set();
  const parts = [];
  for (const part of value) {
    if (part === null || typeof part !== 'object') return null;
    const { partNumber, etag } = part;
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > count || seen.has(partNumber)) return null;
    if (typeof etag !== 'string' || !ETAG.test(etag)) return null;
    seen.add(partNumber);
    parts.push({ partNumber, etag });
  }
  return parts;
}

const message = (err) => (err instanceof Error ? err.message : String(err));

export async function onRequestPost({ request, env, data, params }) {
  const { DB, MEDIA, SESSION_SIGNING_KEY } = env;
  if (!DB || !MEDIA) return unavailable();
  const { session } = data;
  const id = readNumber(params.id);
  if (id === null) return answer(404, { error: 'upload' });
  const token = await readClipToken(request, SESSION_SIGNING_KEY, session, id);
  if (!token) return answer(404, { error: 'upload' });

  const read = await readJson(request, COMPLETE_MAX_BYTES);
  if (read.refusal) return read.refusal;
  const { fields } = read;
  const captured = Number.isSafeInteger(fields.captured) ? readCaptured(String(fields.captured)) : null;
  if (captured === null) return answer(400, { error: 'captured' });
  const parts = readParts(fields.parts, partCount(token.bytes));
  if (!parts) return answer(400, { error: 'parts' });

  let row;
  try {
    row = await clipRow(DB, id);
  } catch (err) {
    console.error('clips: database did not answer:', message(err));
    return unavailable();
  }
  if (!row) return answer(404, { error: 'upload' });
  // A complete sent again after the first one's answer was lost: the first
  // one stored it.
  if (row.state !== 'uploading') return answer(201, { id });

  const key = clipObjectKey(row.mediaKey);
  try {
    await MEDIA.resumeMultipartUpload(key, row.uploadId).complete(parts);
  } catch (err) {
    if (badParts(err)) {
      await dropClip(env, session, id, row, token.bytes);
      return answer(400, { error: 'parts' });
    }
    if (!noSuchUpload(err)) {
      console.error(`clips: bucket did not join photos/${row.mediaKey}/:`, message(err));
      return unavailable();
    }
    // Joined already, by a complete whose answer was lost before the row
    // moved on, or aborted. The object says which, below.
  }

  // The stored object's own size and type. R2's documentation types
  // complete()'s answer as an object without saying it carries the type the
  // upload started with, and head() is read-after-write consistent, so one
  // read of the object stands for both paths.
  let object;
  try {
    object = await MEDIA.head(key);
  } catch (err) {
    console.error(`clips: bucket did not answer for photos/${row.mediaKey}/:`, message(err));
    return unavailable();
  }
  if (object === null) {
    await dropClip(env, session, id, row, token.bytes);
    return answer(404, { error: 'upload' });
  }

  if (object.size !== token.bytes) {
    await dropClip(env, session, id, row, token.bytes);
    return answer(400, { error: 'parts' });
  }

  let checked;
  try {
    checked = await checkStored(MEDIA, key, object.size);
  } catch (err) {
    console.error(`clips: could not read photos/${row.mediaKey}/ to check it:`, message(err));
    return unavailable();
  }
  if (checked.error) {
    await dropClip(env, session, id, row, token.bytes);
    return answer(KEPT.has(checked.error) ? 422 : 415, { error: KEPT.has(checked.error) ? 'kept' : 'not-clip' });
  }
  if (checked.contentType !== object.httpMetadata?.contentType) {
    await dropClip(env, session, id, row, token.bytes);
    return answer(415, { error: 'not-clip' });
  }
  if (tooLong(session, checked.durationMs)) {
    await dropClip(env, session, id, row, token.bytes);
    return answer(413, { error: 'too-long' });
  }

  let finished;
  try {
    finished = await finishClip(DB, id, session, { ...checked, captured, bytes: object.size });
  } catch (err) {
    console.error('clips: database did not store the checked clip:', message(err));
    return unavailable();
  }
  if (finished === null) {
    // Either the album closed (or the account's team went) while the parts
    // arrived, or something moved the row on first: another complete of this
    // upload finished it, whose object this must not touch, or took it back,
    // or the day-old sweep cleared it, or the sender's Remove abandoned it
    // (functions/api/upload/clips/[id]/index.js). dropClip takes back only a row still
    // uploading, so it says whether it was the album.
    const dropped = await dropClip(env, session, id, row, token.bytes);
    if (dropped === null) return unavailable();
    if (dropped) return answer(409, { error: 'album' });
    // The row says which of the others. A clip never goes back to uploading
    // (migration 0016), so a row still there was stored, and no row means the
    // clip went with it: a 201 then would show it Sent, with no Try again,
    // when nothing is left of it (#198's review).
    let stored;
    try {
      stored = await clipRow(DB, id);
    } catch (err) {
      console.error('clips: database did not answer:', message(err));
      return unavailable();
    }
    return stored ? answer(201, { id }) : answer(404, { error: 'upload' });
  }
  return answer(201, { id });
}
