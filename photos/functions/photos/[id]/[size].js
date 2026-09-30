/**
 * GET /photos/<id>/<size>: one size of an approved photo, grid, screen or
 * full, for anyone (#157). An album page shows the grid, its lightbox the
 * screen size, and its Download link the full.
 *
 * The photo's state is read on every request, so a takedown (#158) holds from
 * the next one (CLAUDE.md, The photo site, item 2). A photo that is pending,
 * hidden, deleted or unknown, or a size that is not one of the three, is 404,
 * and so is a database that does not answer: a public route never serves a
 * photo it could not check (item 4).
 *
 * Cache-Control is private, max-age=300, the most any photo response may
 * carry (item 3). That is how long a taken-down photo can outlive its
 * takedown in a browser that already loaded it; a shared cache keeps nothing.
 * No photo is ever served from under /assets/, which the site's _headers
 * cache for a year.
 *
 * The full size is served as an attachment named from its album's address and
 * its place in the album (2026-10-04-fall-regatta-007.jpg), so Download saves
 * it under that name whatever the browser does with the link's own download
 * attribute. The grid and screen sizes open in the page. The bytes are the
 * stored object's, rebuilt by the upload route with every metadata segment
 * removed (lib/jpeg.js).
 */
import { SIZES, photoObjectKeys } from '../../../lib/photos.js';
import { approvedPhoto, downloadPhoto } from '../../../lib/public.js';
import { readPhotoId } from '../../../lib/queue.js';

export const PHOTO_CACHE = 'private, max-age=300';

const notFound = () =>
  new Response('No such photo.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ env, params }) {
  const size = typeof params.size === 'string' && Object.hasOwn(SIZES, params.size) ? params.size : null;
  if (size === null) return notFound();
  // An id that is not one reads as null, and both queries answer null for a
  // null id before asking the database (lib/public.js), so it is 404 there.
  const id = readPhotoId(params.id);
  let found;
  try {
    found = size === 'full'
      ? await downloadPhoto(env.DB, id)
      : { mediaKey: await approvedPhoto(env.DB, id) };
  } catch (err) {
    console.error('photo: the database did not answer, so no photo was served:', err instanceof Error ? err.message : String(err));
    return notFound();
  }
  if (!found?.mediaKey) return notFound();
  const object = await env.MEDIA.get(photoObjectKeys(found.mediaKey)[size]);
  if (object === null) return notFound();
  const disposition = size === 'full'
    ? `attachment; filename="${found.name}"`
    : `inline; filename="photo-${id}-${size}.jpg"`;
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': disposition,
      'Cache-Control': PHOTO_CACHE,
    },
  });
}

// HEAD is answered as GET is, so a link preview or a monitor reads the same
// status and headers; Pages sends no body. It costs the same database read
// and bucket read as a GET.
export const onRequestHead = onRequestGet;
