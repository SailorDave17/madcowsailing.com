/**
 * GET /api/albums/open: the albums a parent can send photos to (#153),
 * newest first, as {"albums": [{address, title, kind, date}, …]}. Newest is
 * the latest date, so an album made ahead of time for a future day comes
 * first. The share page (#155) offers them all and preselects one held today,
 * else the most recent past one, never a future one (CLAUDE.md, The photo
 * site, item 13). The guard in _middleware.js has already required a live
 * upload session; without one this answers 401.
 *
 * A title is the text the owner typed, markup and all. It is data here, and
 * the page that shows it sets it as text.
 *
 * A read only: it writes nothing, and no cache keeps it, so an album closed
 * on the admin page leaves the list at the next request.
 */
import { openAlbums } from '../../../lib/albums.js';

export async function onRequestGet({ env }) {
  const albums = (await openAlbums(env.DB)).map(({ address, title, kind, date }) => ({ address, title, kind, date }));
  return Response.json({ albums }, { headers: { 'Cache-Control': 'no-store' } });
}
