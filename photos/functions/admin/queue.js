/**
 * GET /admin/queue: the photos waiting for approval (#156). The guards in
 * _middleware.js have already checked the Access token.
 *
 * Each batch, one press of Send in one album, is a form: every photo in it at
 * all three sizes, its caption to edit, and buttons to approve or reject it,
 * or the whole batch. The presses post to functions/api/admin/queue/, which
 * answers 303 back here with ?done= or ?error= saying what happened
 * (lib/admin-page.js, queueNotice), and lib/queue.js holds the rules.
 *
 * Rendered here, never a static file (CLAUDE.md, The photo site, item 4).
 */
import { adminQueuePage, queueNotice } from '../../lib/admin-page.js';
import { waitingBatches } from '../../lib/queue.js';

export async function onRequestGet({ request, env }) {
  const batches = await waitingBatches(env.DB);
  const notice = queueNotice(new URL(request.url).searchParams);
  return new Response(adminQueuePage({ batches, notice }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Behind Access: no cache between here and the owner may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
