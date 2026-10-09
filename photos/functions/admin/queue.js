/**
 * GET /admin/queue: the photos waiting for approval (#156). The guards in
 * _middleware.js have already checked the admin session.
 *
 * Each batch, one press of Send in one album, is a form: every photo in it at
 * all three sizes, its caption to edit, and buttons to approve or reject it,
 * or the whole batch. The presses post to functions/api/admin/queue/, which
 * answers 303 back here with ?done= or ?error= saying what happened
 * (lib/admin-page.js, queueNotice), and lib/queue.js holds the rules.
 *
 * Since #228 each batch can also move into one of its team's events, so the
 * page reads every album for those choices, and for the title a move's
 * notice names.
 *
 * Rendered here, never a static file (CLAUDE.md, The photo site, item 4).
 *
 * ?team=<team> shows that team's batches only (#227); anything else in it
 * shows every team's, as no ?team= does.
 *
 * ?at= is where a press landed (#270, lib/queue.js, queueLocation): a waiting
 * photo's card or a batch's section, where the notice then shows. The page
 * only compares it with the ids it renders, so anything else shows the notice
 * at the top, as before.
 *
 * Since #198 the waiting clips are in their batches too, each played through
 * functions/api/admin/clips/[id].js, and loaded only when played.
 */
import { adminQueuePage, queueNotice } from '../../lib/admin-page.js';
import { allAlbums } from '../../lib/albums.js';
import { waitingBatches } from '../../lib/queue.js';
import { readTeam } from '../../lib/teams.js';

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const team = readTeam(params.get('team'));
  const batches = await waitingBatches(env.DB, team);
  const albums = await allAlbums(env.DB);
  const notice = queueNotice(params, albums);
  return new Response(adminQueuePage({ batches, notice, team, albums, at: params.get('at') }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Behind Access: no cache between here and the owner may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
