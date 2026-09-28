/**
 * GET /admin and /admin/: the admin home (#151). The guard in _middleware.js
 * has already checked the Access token; this says who is signed in and links
 * to the sections later stories build. It is a shell until they do.
 *
 * Rendered here, never a static file: nothing under /admin may exist in
 * public/, so that a project switched to fail open could not serve it
 * (CLAUDE.md, The photo site, item 4).
 */
import { adminHome } from '../../lib/admin-page.js';

export function onRequestGet({ data }) {
  return new Response(adminHome(data.owner.email), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Names who is signed in, so no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
