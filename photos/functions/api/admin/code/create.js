/**
 * POST /api/admin/code/create: make the first invite code (#152), which
 * replaces the seed script #150 used.
 *
 * Posted by "Create code" on /admin/code, which the page offers only while the
 * database holds no code. It makes generation 1 only if there is still none,
 * so a second press, or a page left open after a code was made, changes
 * nothing and never ends a session. The guards in ../_middleware.js have
 * already required an admin's session and the site's own Origin.
 */
import { createFirstCode } from '../../../../lib/invite.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ env }) {
  await createFirstCode(env.DB, nowSeconds());
  return new Response(null, { status: 303, headers: { Location: '/admin/code', 'Cache-Control': 'no-store' } });
}

/** GET makes nothing and goes back to the page, as rotate.js's GET says. */
export function onRequestGet() {
  return new Response(null, { status: 303, headers: { Location: '/admin/code?unchanged=create', 'Cache-Control': 'no-store' } });
}
