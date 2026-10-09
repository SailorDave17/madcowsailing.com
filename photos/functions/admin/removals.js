/**
 * GET /admin/removals: the photos taken down with "Remove this photo" (#158),
 * the oldest takedown first, each with its album, when it was hidden and the
 * note. The guards in _middleware.js have already checked the admin session.
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
 *
 * ?team=<team> shows that team's hidden photos only (#227); anything else in
 * it shows every team's, as no ?team= does.
 */
import { adminRemovalsPage, removalsNotice } from '../../lib/admin-page.js';
import { clearExpiredTakedowns, hiddenPhotos } from '../../lib/removals.js';
import { nowSeconds } from '../../lib/session.js';
import { readTeam } from '../../lib/teams.js';

export async function onRequestGet({ request, env }) {
  await clearExpiredTakedowns(env.DB, nowSeconds());
  const params = new URL(request.url).searchParams;
  const team = readTeam(params.get('team'));
  const photos = await hiddenPhotos(env.DB, team);
  const notice = removalsNotice(params);
  return new Response(adminRemovalsPage({ photos, notice, team }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Behind the admin guard, and it shows notes a parent wrote: no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
