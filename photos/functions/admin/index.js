/**
 * GET /admin and /admin/: the admin home (#151). The guard in _middleware.js
 * has already checked the Access token; this says who is signed in, how many
 * photos wait for approval and how much of the free storage is used (#156),
 * and links to each section.
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
 * Since #222 each load also deletes the failed sign-ins (lib/sign-in.js) and
 * the reset requests (lib/reset.js) more than an hour old, for the same
 * reason: each keeps a scrambled address, and the next failure or request
 * alone could leave one kept for months.
 */
import { clearExpiredRequests, waitingRequests } from '../../lib/accounts.js';
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
  const summary = { ...(await queueSummary(env.DB)), requests: await waitingRequests(env.DB) };
  return new Response(adminHome(data.owner.email, summary), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Names who is signed in, so no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
