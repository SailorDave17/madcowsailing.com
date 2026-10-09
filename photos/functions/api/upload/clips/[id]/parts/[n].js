/**
 * PUT /api/upload/clips/<id>/parts/<n>: one part of a clip (#198), passed into
 * its R2 multipart upload as it arrives. lib/clips.js has the whole exchange.
 *
 * The body is the part's bytes, exactly PART_BYTES long, or what is left for
 * the last part, with the token from the start in the Clip-Upload header. R2
 * checks the parts' sizes only when they are joined, after every part has been
 * stored and billed, so the size is checked here first, from Content-Length,
 * before a byte is read. The body is never buffered: it streams into
 * uploadPart, which needs its length known, as a request with Content-Length
 * has it.
 *
 * Sending a part number again replaces that part, so the page retries a failed
 * part alone. The answers, each JSON with Cache-Control: no-store:
 *
 *   200 {"etag": e}              stored; the page sends every etag at the end
 *   400 {"error": "part"}        a part number outside the upload, or a length
 *                                that is not this part's
 *   404 {"error": "upload"}      no upload this session started with this id
 *                                and size: unknown, finished, abandoned, or a
 *                                token for another session or none
 *   503 {"error": "unavailable"} the database or the bucket did not answer
 */
import {
  answer, clipRow, noSuchUpload, partBytes, readClipToken, readNumber, unavailable,
} from '../../../../../../lib/clips.js';
import { clipObjectKey } from '../../../../../../lib/photos.js';
import { partCount } from '../../../../../../public/js/clip.js';

const LENGTH = /^[0-9]{1,16}$/;

export async function onRequestPut({ request, env, data, params }) {
  const { DB, MEDIA, SESSION_SIGNING_KEY } = env;
  if (!DB || !MEDIA) return unavailable();
  const id = readNumber(params.id);
  if (id === null) return answer(404, { error: 'upload' });
  const token = await readClipToken(request, SESSION_SIGNING_KEY, data.session, id);
  if (!token) return answer(404, { error: 'upload' });

  const n = readNumber(params.n);
  if (n === null || n > partCount(token.bytes)) return answer(400, { error: 'part' });
  const declared = request.headers.get('Content-Length') ?? '';
  if (!LENGTH.test(declared) || Number(declared) !== partBytes(token.bytes, n)) return answer(400, { error: 'part' });

  let row;
  try {
    row = await clipRow(DB, id);
  } catch (err) {
    console.error('clips: database did not answer:', err instanceof Error ? err.message : String(err));
    return unavailable();
  }
  if (!row || row.state !== 'uploading') return answer(404, { error: 'upload' });

  try {
    const part = await MEDIA.resumeMultipartUpload(clipObjectKey(row.mediaKey), row.uploadId).uploadPart(n, request.body);
    return answer(200, { etag: part.etag });
  } catch (err) {
    if (noSuchUpload(err)) return answer(404, { error: 'upload' });
    console.error(`clips: bucket did not store a part of photos/${row.mediaKey}/:`, err instanceof Error ? err.message : String(err));
    return unavailable();
  }
}
