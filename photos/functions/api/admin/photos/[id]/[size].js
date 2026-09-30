/**
 * GET /api/admin/photos/<id>/<size>: one stored size of a photo, grid, screen
 * or full, for the admins (#156). The guards in ../../_middleware.js have
 * already required an admin's Access token; without one this answers 403 and
 * reads nothing.
 *
 * /admin/queue shows every size from here, so the owner sees all three
 * before approving: #154 refuses three sizes that are not one shape, but two
 * different pictures of the same shape still pass, and the public sees the
 * grid and the full. It serves a photo in any state but uploading, so a size
 * opened from the queue still opens once it is approved.
 *
 * The bytes are the stored object's, as the upload route rebuilt them with
 * every metadata segment removed (lib/jpeg.js). A photo that is not there, or
 * a size that is not one of the three, is 404.
 *
 * Cache-Control is private, max-age=300, the most any photo response may
 * carry (CLAUDE.md, The photo site, item 3). It keeps the queue's reload
 * after each press from fetching every picture again, and a shared cache
 * keeps nothing.
 */
import { SIZES, photoObjectKeys } from '../../../../../lib/photos.js';
import { readPhotoId, storedPhoto } from '../../../../../lib/queue.js';

const notFound = () =>
  new Response('No such photo.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ env, params }) {
  const size = typeof params.size === 'string' && Object.hasOwn(SIZES, params.size) ? params.size : null;
  if (size === null) return notFound();
  const id = readPhotoId(params.id);
  const mediaKey = await storedPhoto(env.DB, id);
  if (mediaKey === null) return notFound();
  const object = await env.MEDIA.get(photoObjectKeys(mediaKey)[size]);
  if (object === null) return notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `inline; filename="photo-${id}-${size}.jpg"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
