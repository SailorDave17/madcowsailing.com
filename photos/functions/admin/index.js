/**
 * GET /admin and /admin/: the admin home (#151). The guard in _middleware.js
 * has already checked the Access token; this says who is signed in, how many
 * photos wait for approval and how much of the free storage is used (#156),
 * and links to each section.
 *
 * Rendered here, never a static file: nothing under /admin may exist in
 * public/, so that a project switched to fail open could not serve it
 * (CLAUDE.md, The photo site, item 4).
 */
import { adminHome } from '../../lib/admin-page.js';
import { queueSummary } from '../../lib/queue.js';

export async function onRequestGet({ data, env }) {
  return new Response(adminHome(data.owner.email, await queueSummary(env.DB)), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Names who is signed in, so no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
