/**
 * GET /admin and /admin/: the admin home (#151). The guard in _middleware.js
 * has already checked the admin session (#224). Since #269 it opens on what
 * is waiting: the photos for approval (#156), the requests for an account
 * and the removal requests, each a button to its page. Then the links to the
 * other sections and how much of the free storage is used, and last who is
 * signed in and until when, and Sign out (lib/admin-page.js, adminHome).
 *
 * Rendered here, never a static file: nothing under /admin may exist in
 * public/, so that a project switched to fail open could not serve it
 * (CLAUDE.md, The photo site, item 4).
 *
 * Each load also deletes the takedowns more than an hour old (#158,
 * lib/removals.js), and the account requests' address log the same (#220,
 * lib/accounts.js), so a scrambled address is kept no longer than the next
 * admin visit. A load with nothing expired writes nothing.
 *
 * Since #220 it also says how many requests for an account wait: the email
 * to the admins goes at most once an hour, and only when a request arrives,
 * so this count is how a request that no later one follows is seen.
 *
 * Since #198 the queue's button counts the waiting clips beside the photos:
 * queueSummary() reads them in its one statement, as `clips`, and adminHome
 * names both kinds (owner, at #198's pickup).
 *
 * Since #198 each load also clears clip uploads still unfinished a day after
 * they started (lib/clips.js, clearStaleClips): their rows, and their parts
 * or object in the bucket. Pages runs no scheduled job, and the start of the
 * next clip is the only other moment, so a site where nobody sends again
 * would keep them. Best effort, as there: a failure is logged and the page
 * still answers. Only with the bucket bound, as the start route requires it,
 * so no row goes whose parts could not be let go of.
 *
 * Since #222 each load also deletes the failed sign-ins (lib/sign-in.js) and
 * the reset requests (lib/reset.js) more than an hour old, for the same
 * reason: each keeps a scrambled address, and the next failure or request
 * alone could leave one kept for months. Since #224 it deletes the admins'
 * sign-in codes made more than a day ago too (lib/admin-code.js), which the
 * next code made would otherwise be the only thing to delete.
 */
import { clearExpiredRequests, waitingRequests } from '../../lib/accounts.js';
import { clearExpiredCodes } from '../../lib/admin-code.js';
import { clearStaleClips } from '../../lib/clips.js';
import { adminHome } from '../../lib/admin-page.js';
import { queueSummary } from '../../lib/queue.js';
import { clearExpiredTakedowns } from '../../lib/removals.js';
import { clearExpiredResetRequests } from '../../lib/reset.js';
import { nowSeconds } from '../../lib/session.js';
import { clearExpiredSignIns } from '../../lib/sign-in.js';

export async function onRequestGet({ data, env }) {
  const now = nowSeconds();
  await clearExpiredTakedowns(env.DB, now);
  await clearExpiredRequests(env.DB, now);
  await clearExpiredSignIns(env.DB, now);
  await clearExpiredResetRequests(env.DB, now);
  await clearExpiredCodes(env.DB, now);
  if (env.MEDIA) await clearStaleClips(env, now);
  const summary = { ...(await queueSummary(env.DB)), requests: await waitingRequests(env.DB) };
  return new Response(adminHome(data.admin, summary), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Names who is signed in, so no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
