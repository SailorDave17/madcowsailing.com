/**
 * POST /api/upload/clips: a clip's upload starts (#198). lib/clips.js has the
 * whole exchange; CLAUDE.md, The photo site, item 33 the decisions.
 *
 * The upload directory's guard runs first (../_middleware.js): no live upload
 * session is 401, and a post without the site's own Origin is 403
 * {"error":"origin"}. The share page sends JSON:
 *
 *   album        the album's address, from GET /api/albums/open
 *   batch        the press of Send's UUID, as a photo's
 *   caption      optional: one line, at most 200 characters
 *   bytes        the clip's length as the page will send it, after the walker
 *   durationMs   how long it runs, as the walker read it
 *   contentType  video/mp4 or video/quicktime, as the walker read it
 *
 * The answers, each JSON with Cache-Control: no-store:
 *
 *   201 {"id": n, "token": t, "parts": p}   started: send parts 1 to p with
 *                                           the token in the Clip-Upload header
 *   400 {"error": "form" | "batch" | "caption"}
 *   403 {"error": "team"}         from an account, another team's album
 *   409 {"error": "album"}        not an open album, or closed meanwhile
 *   413 {"error": "too-large"}    over this sender's size cap (lib/photos.js,
 *                                 CLIP_BYTES), or a body over 4 KiB
 *   413 {"error": "too-long"}     over this sender's length cap (CLIP_SECONDS)
 *   415 {"error": "not-clip"}     a type that is not one of the two
 *   429 {"error": "daily-cap"}    the day's 500 are spent, with Retry-After
 *   429 {"error": "clip-bytes"}   this clip would pass the day's clip budget
 *                                 (CLIP_DAY_BYTES), with Retry-After
 *   503 {"error": "unavailable"}  the database or the bucket did not answer
 *
 * A clip over its caps is refused here, before any part is stored; the size
 * and length the page declares are checked again against the clip itself once
 * its parts are joined. One of the session's 500 uploads a day is spent here
 * (CLAUDE.md, item 14), with the clip's declared size of the day's clip
 * budget, and both are given back if the clip is never stored. The caption,
 * the address and the token are never logged.
 */
import { openAlbum } from '../../../../lib/albums.js';
import {
  CLIP_TYPES, START_MAX_BYTES, answer, clearStaleClips, clipToken, insertClip, readJson, unavailable,
} from '../../../../lib/clips.js';
import {
  clipBytes, clipObjectKey, clipSeconds, isBatch, newMediaKey, readCaption, refundDailyUpload,
  secondsToNextDay, spendDailyClip,
} from '../../../../lib/photos.js';
import { partCount } from '../../../../public/js/clip.js';
import { nowSeconds } from '../../../../lib/session.js';

const whole = (n) => Number.isSafeInteger(n) && n > 0;

export async function onRequestPost({ request, env, data }) {
  const { DB, MEDIA, SESSION_SIGNING_KEY } = env;
  if (!DB || !MEDIA) {
    console.error('clips: the database or the bucket is not bound, so sending clips is closed');
    return unavailable();
  }
  const { session } = data;

  const read = await readJson(request, START_MAX_BYTES);
  if (read.refusal) return read.refusal;
  const { fields } = read;
  if (typeof fields.album !== 'string') return answer(400, { error: 'form' });
  if (!isBatch(fields.batch)) return answer(400, { error: 'batch' });
  const { caption, error } = readCaption(fields.caption ?? null);
  if (error) return answer(400, { error });
  if (!whole(fields.bytes) || !whole(fields.durationMs)) return answer(400, { error: 'form' });
  if (fields.bytes > clipBytes(session)) return answer(413, { error: 'too-large' });
  if (fields.durationMs > clipSeconds(session) * 1000) return answer(413, { error: 'too-long' });
  if (!CLIP_TYPES.includes(fields.contentType)) return answer(415, { error: 'not-clip' });

  const now = nowSeconds();
  await clearStaleClips(env, now);
  try {
    const album = await openAlbum(DB, fields.album);
    if (!album) return answer(409, { error: 'album' });
    // As a photo's: an account sends to its approved teams' albums only (#223),
    // refused before the cap is spent; insertClip checks the team again.
    if (session.sender === 'account' && !session.teams.includes(album.team)) {
      return answer(403, { error: 'team' });
    }
    // One of the day's 500, and the clip's size of the day's clip budget.
    const refused = await spendDailyClip(DB, session, now, fields.bytes);
    if (refused) return answer(429, { error: refused }, { 'Retry-After': String(secondsToNextDay(now)) });
  } catch (err) {
    console.error('clips: database did not answer:', err instanceof Error ? err.message : String(err));
    return unavailable();
  }

  const mediaKey = newMediaKey();
  let upload;
  try {
    upload = await MEDIA.createMultipartUpload(clipObjectKey(mediaKey), {
      httpMetadata: { contentType: fields.contentType },
    });
  } catch (err) {
    console.error('clips: bucket did not start an upload:', err instanceof Error ? err.message : String(err));
    await refundDailyUpload(DB, session, now, fields.bytes);
    return unavailable();
  }

  let id;
  try {
    id = await insertClip(DB, fields.album, {
      session, mediaKey, batch: fields.batch, caption, sentAt: now, uploadId: upload.uploadId,
    });
  } catch (err) {
    console.error('clips: database did not write the upload:', err instanceof Error ? err.message : String(err));
    id = undefined;
  }
  if (!id) {
    try {
      await upload.abort();
    } catch (err) {
      console.error(`clips: bucket did not abort photos/${mediaKey}/:`, err instanceof Error ? err.message : String(err));
    }
    await refundDailyUpload(DB, session, now, fields.bytes);
    return id === null ? answer(409, { error: 'album' }) : unavailable();
  }

  const token = await clipToken(SESSION_SIGNING_KEY, id, fields.bytes, session);
  return answer(201, { id, token, parts: partCount(fields.bytes) });
}
