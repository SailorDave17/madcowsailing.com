/**
 * GET and HEAD /api/admin/clips/<id>: a clip, for the admins (#198). The
 * guards in ../_middleware.js have already required an admin's session;
 * without one this is never reached, and nothing is read.
 *
 * /admin/queue plays every waiting clip from here (lib/admin-page.js,
 * waitingClip), so the owner sees each clip before approving it, as #156
 * shows every photo at all three sizes. It serves a clip in any state but
 * uploading, so a clip opened from the queue still plays once it is
 * approved. An approved clip is shown nowhere public until #286.
 *
 * A player asks for a clip in ranges, and iOS plays media only from a server
 * that answers them (CLAUDE.md, The photo site, item 10), so:
 *   - one range, bytes=a-b, bytes=a- or bytes=-n, is 206 with Content-Range:
 *     bytes a-b/size, read from the bucket as that range alone;
 *   - a range that starts at or past the end, or a suffix of 0 bytes, is 416,
 *     whose Content-Range gives the size alone, as the RFC asks; the size is
 *     the row's, so nothing is read from the bucket;
 *   - no Range, several ranges, or one this cannot read is 200 with the whole
 *     clip: RFC 9110 lets a server ignore a Range header (section 14.2).
 * The 206 is decided from the request as parsed here, never from whether the
 * bucket's object carries a `range`: miniflare, R2's local runtime, sets one
 * on every get, ranged or not (read from its source for test/r2.js, which
 * does the same), and a plain GET would come back 206. Not chosen: several
 * ranges as multipart/byteranges, which no player needs and which would hold
 * the clip's parts in memory; R2's own parsing of the Range header, which
 * leaves the 416 to an exception and the Content-Range to the object's shape.
 *
 * Accept-Ranges says so on every clip it answers. Cache-Control is the
 * photos' private, max-age=300 (item 3): the most any photo response
 * carries, and no shared cache keeps it. The 416 is no-store, as a 404 is: it
 * answers the request, not the clip. The ETag is the bucket's.
 * Content-Length is never set here, since the runtime ignores one a Function
 * sets.
 *
 * The bytes are the stored object's, which the server checked when the clip
 * was complete (lib/clips.js): a clip still holding data outside the
 * walker's keep-list never reaches a state this serves.
 */
import { clipObjectKey } from '../../../../lib/photos.js';
import { readPhotoId, storedClip } from '../../../../lib/queue.js';
import { PHOTO_CACHE } from '../../../photos/[id]/[size].js';

const notFound = () =>
  new Response('No such clip.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

// One range of bytes, as RFC 9110 writes it (section 14.1.2): first-last,
// first- (to the end), or -suffix (the last that many bytes). The unit is
// matched in any case, as the RFC compares it.
const ONE_RANGE = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/i;

/**
 * The range a Range header asks for, in a clip of `size` bytes: { offset,
 * length } when it is one range that holds a byte; 'unsatisfiable' when it
 * starts at or past the end, or is a suffix of 0 bytes (RFC 9110, section
 * 14.1.2); null when there is no header, it names several ranges, or it
 * cannot be read, last before first included, and the whole clip is the
 * answer. A last past the end is cut to the end, and a suffix longer than the
 * clip is the whole clip, as the RFC says.
 */
function readRange(header, size) {
  if (header === null) return null;
  const one = ONE_RANGE.exec(header.trim());
  if (!one) return null;
  const [, first, last, suffix] = one;
  if (suffix !== undefined) {
    const length = Math.min(Number(suffix), size);
    return length === 0 ? 'unsatisfiable' : { offset: size - length, length };
  }
  const offset = Number(first);
  if (last !== '' && Number(last) < offset) return null;
  if (offset >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return { offset, length: end - offset + 1 };
}

export async function onRequestGet({ request, env, params }) {
  // An id that is not one reads as null, and storedClip() answers null for a
  // null id before asking the database, so it is 404 there.
  const id = readPhotoId(params.id);
  const clip = await storedClip(env.DB, id);
  if (clip === null) return notFound();
  const range = readRange(request.headers.get('Range'), clip.bytes);
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${clip.bytes}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
    });
  }
  const object = await env.MEDIA.get(clipObjectKey(clip.mediaKey), range === null ? undefined : { range });
  if (object === null) return notFound();
  const extension = clip.contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const headers = {
    'Content-Type': clip.contentType,
    'Content-Disposition': `inline; filename="clip-${id}.${extension}"`,
    'Cache-Control': PHOTO_CACHE,
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
  };
  if (range === null) return new Response(object.body, { headers });
  return new Response(object.body, {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${clip.bytes}` },
  });
}

// HEAD is answered as GET is, so a player or a monitor reads the same status
// and headers; Pages sends no body. It costs the same database read and
// bucket read as a GET, as the photo routes' HEAD does.
export const onRequestHead = onRequestGet;
