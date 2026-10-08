/**
 * POST /api/upload: one photo, as its three JPEG sizes, into an open album,
 * stored with every metadata segment removed and waiting for the owner (#154).
 *
 * The directory's guard runs first (_middleware.js): no live upload session
 * is 401, and a post without the site's own Origin is 403 {"error":"origin"}.
 * By the time this runs, the session is on context.data.session.
 *
 * The share page (#155) sends multipart/form-data:
 *
 *   album     the album's address, from GET /api/albums/open
 *   batch     a UUID the page makes once per press of Send (#156 groups by it)
 *   captured  when the photo was taken, Unix seconds
 *   caption   optional: one line, at most 200 characters
 *   grid, screen, full
 *             the three JPEGs, each within its size's long edge and file size
 *             (lib/photos.js, SIZES)
 *
 * The answers, each JSON with Cache-Control: no-store:
 *
 *   201 {"id": n}                   stored: three objects and one pending row
 *   400 {"error": "form"}           not a form, or a field missing, repeated or
 *                                   of the wrong kind
 *   400 {"error": "caption" | "captured" | "batch"}
 *   400 {"error": "malformed", "size": s}   a JPEG that breaks off
 *   400 {"error": "sizes"}          three sizes that are not one picture's shape:
 *                                   a smaller size larger than the next, or a
 *                                   different aspect ratio (lib/photos.js,
 *                                   sizesAgree)
 *   403 {"error": "team"}           from an account (#223), an open album of a
 *                                   team the account is not approved for:
 *                                   nothing stored, none of the cap spent
 *   409 {"error": "album"}          not an open album: unknown, closed, or
 *                                   closed or deleted while this was sent; or,
 *                                   from an account, its team revoked while
 *                                   this was sent
 *   413 {"error": "too-large"}      a body past every cap together
 *   413 {"error": "too-large", "size": s}   one file past its size's bytes or
 *                                   long edge
 *   415 {"error": "not-jpeg", "size": s}    a file that is not a JPEG this
 *                                   site takes, a PNG renamed .jpg among them
 *   429 {"error": "daily-cap"}      this session, or for an account every
 *                                   phone signed in to it together (#223), has
 *                                   sent DAILY_UPLOADS today, with Retry-After
 *                                   to the next UTC day
 *   503 {"error": "unavailable"}    the database or the bucket did not answer:
 *                                   closed, never open, and nothing stored
 *
 * A refusal stores nothing and spends none of the session's daily cap. A
 * failure after the cap is spent deletes whatever objects were stored and
 * gives the unit back, so the cap counts photos stored. Nothing here logs the
 * caption, the files or the session; a failed cleanup logs the objects' R2
 * prefix, so what it left behind can be found.
 */
import { openAlbum } from '../../../lib/albums.js';
import { readJpeg } from '../../../lib/jpeg.js';
import {
  MAX_UPLOAD_BYTES, SIZES, insertPhoto, isBatch, newMediaKey, photoObjectKeys, readCaption,
  readCaptured, readCapped, refundDailyUpload, secondsToNextDay, sizesAgree, spendDailyUpload,
} from '../../../lib/photos.js';
import { nowSeconds } from '../../../lib/session.js';

const FIELDS = ['album', 'batch', 'captured', 'caption', ...Object.keys(SIZES)];

const answer = (status, body, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

const unavailable = () => answer(503, { error: 'unavailable' });

export async function onRequestPost({ request, env, data }) {
  const { DB, MEDIA } = env;
  if (!DB || !MEDIA) {
    console.error('upload: the database or the bucket is not bound, so uploading is closed');
    return unavailable();
  }

  const form = await readUploadForm(request);
  if (form.refusal) return form.refusal;
  const { fields } = form;

  if (typeof fields.album !== 'string') return answer(400, { error: 'form' });
  if (!isBatch(fields.batch)) return answer(400, { error: 'batch' });
  const captured = readCaptured(fields.captured);
  if (captured === null) return answer(400, { error: 'captured' });
  const { caption, error } = readCaption(fields.caption);
  if (error) return answer(400, { error });

  const photo = await readPhoto(fields);
  if (photo.refusal) return photo.refusal;
  if (!sizesAgree(photo.dimensions)) return answer(400, { error: 'sizes' });

  const now = nowSeconds();
  try {
    const album = await openAlbum(DB, fields.album);
    if (!album) return answer(409, { error: 'album' });
    // An account sends to its approved teams' albums only (#223, criterion 2,
    // D16). The guard read its teams on this request. Refused before the cap
    // is spent, so a refusal costs the account nothing; insertPhoto checks
    // the team again in the statement that writes the row.
    if (data.session.sender === 'account' && !data.session.teams.includes(album.team)) {
      return answer(403, { error: 'team' });
    }
    if (!(await spendDailyUpload(DB, data.session, now))) {
      return answer(429, { error: 'daily-cap' }, { 'Retry-After': String(secondsToNextDay(now)) });
    }
  } catch (err) {
    console.error('upload: database did not answer:', err instanceof Error ? err.message : String(err));
    return unavailable();
  }

  const mediaKey = newMediaKey();
  const objects = photoObjectKeys(mediaKey);
  const stored = await Promise.allSettled(Object.keys(SIZES).map((size) =>
    MEDIA.put(objects[size], photo.clean[size], { httpMetadata: { contentType: 'image/jpeg' } })));
  const failed = stored.find((result) => result.status === 'rejected');
  // Every put settles before anything is deleted, so no put still in flight
  // lands after the cleanup.
  if (failed) {
    console.error('upload: bucket did not store a size:', failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
    await removeObjects(MEDIA, mediaKey);
    await refundDailyUpload(DB, data.session, now);
    return unavailable();
  }

  let id;
  try {
    id = await insertPhoto(DB, fields.album, {
      mediaKey,
      batch: fields.batch,
      session: data.session,
      caption,
      captured,
      sentAt: now,
      ...photo.dimensions,
      bytes: Object.values(photo.clean).reduce((sum, bytes) => sum + bytes.length, 0),
    });
  } catch (err) {
    console.error('upload: database did not answer:', err instanceof Error ? err.message : String(err));
    await removeObjects(MEDIA, mediaKey);
    await refundDailyUpload(DB, data.session, now);
    return unavailable();
  }
  if (id === null) {
    await removeObjects(MEDIA, mediaKey);
    await refundDailyUpload(DB, data.session, now);
    return answer(409, { error: 'album' });
  }
  return answer(201, { id });
}

/**
 * The form's fields, first value of each name the route reads, or a refusal.
 * Past MAX_UPLOAD_BYTES the body is never parsed. A body that is not a form
 * makes formData() throw, which is a 400 here rather than a 500.
 */
async function readUploadForm(request) {
  const bytes = await readCapped(request, MAX_UPLOAD_BYTES);
  if (bytes === null) return { refusal: answer(413, { error: 'too-large' }) };
  let form;
  try {
    form = await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' },
    }).formData();
  } catch {
    return { refusal: answer(400, { error: 'form' }) };
  }
  const fields = Object.create(null);
  for (const name of FIELDS) {
    const all = form.getAll(name);
    if (all.length > 1) return { refusal: answer(400, { error: 'form' }) };
    fields[name] = all[0] ?? null;
  }
  return { fields };
}

/**
 * The three sizes read and rebuilt: { clean, dimensions }, or a refusal for
 * the first size that fails. Every file's byte size is checked before any is
 * read.
 */
async function readPhoto(fields) {
  for (const [size, cap] of Object.entries(SIZES)) {
    const file = fields[size];
    if (!(file instanceof Blob)) return { refusal: answer(400, { error: 'form' }) };
    if (file.size > cap.maxBytes) return { refusal: answer(413, { error: 'too-large', size }) };
  }
  const clean = {};
  const dimensions = {};
  for (const [size, cap] of Object.entries(SIZES)) {
    const read = readJpeg(new Uint8Array(await fields[size].arrayBuffer()));
    if (read.error === 'not-jpeg') return { refusal: answer(415, { error: 'not-jpeg', size }) };
    if (read.error) return { refusal: answer(400, { error: 'malformed', size }) };
    if (Math.max(read.width, read.height) > cap.longEdge) return { refusal: answer(413, { error: 'too-large', size }) };
    clean[size] = read.clean;
    dimensions[size] = { width: read.width, height: read.height };
  }
  return { clean, dimensions };
}

/**
 * Delete a photo's objects after a failure, so a failed upload leaves nothing
 * in the bucket. Deleting a key that was never stored is not an error to R2,
 * so all three go whichever were stored. If the delete itself fails, the
 * objects' prefix is logged: it names no one, and it is the only way to find
 * what was left without listing the bucket against the table.
 */
async function removeObjects(bucket, mediaKey) {
  try {
    await bucket.delete(Object.values(photoObjectKeys(mediaKey)));
  } catch (err) {
    console.error(`upload: bucket did not delete photos/${mediaKey}/ after a failure:`, err instanceof Error ? err.message : String(err));
  }
}
