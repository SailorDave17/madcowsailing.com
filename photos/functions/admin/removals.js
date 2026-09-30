/**
 * GET /admin/removals: the photos taken down with "Remove this photo" (#158),
 * the oldest takedown first, each with its album, when it was hidden and the
 * note. The guards in _middleware.js have already checked the Access token.
 *
 * Each has "Put it back", which posts to
 * functions/api/admin/removals/restore.js, and "Delete permanently",
 * confirmed in the page's native <dialog>, which posts to
 * functions/api/admin/removals/delete.js. Both answer 303 back here with
 * ?done= or ?error= (lib/admin-page.js, removalsNotice), and
 * lib/removals.js holds the rules.
 *
 * Rendered here, never a static file (CLAUDE.md, The photo site, item 4).
 *
 * Each load also deletes the takedowns more than an hour old, as the admin
 * home does (lib/removals.js, clearExpiredTakedowns).
 */
import { adminRemovalsPage, removalsNotice } from '../../lib/admin-page.js';
import { clearExpiredTakedowns, hiddenPhotos } from '../../lib/removals.js';
import { nowSeconds } from '../../lib/session.js';

export async function onRequestGet({ request, env }) {
  await clearExpiredTakedowns(env.DB, nowSeconds());
  const photos = await hiddenPhotos(env.DB);
  const notice = removalsNotice(new URL(request.url).searchParams);
  return new Response(adminRemovalsPage({ photos, notice }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Behind Access, and it shows notes a parent wrote: no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
