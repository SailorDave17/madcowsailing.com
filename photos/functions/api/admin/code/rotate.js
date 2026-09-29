/**
 * POST /api/admin/code/rotate: replace the invite code (#152).
 *
 * Posted by the confirm button in /admin/code's dialog, and by nothing else
 * on the page. The guards in ../_middleware.js have already required the
 * owner's Access token and the site's own Origin; anything else was answered
 * 403 there, with the code unchanged.
 *
 * The new code is the next generation (lib/invite.js), so every upload session
 * opened with the old one is refused from its next request, and the old link
 * reads as rotated. Then 303 back to the page, which shows the new code: a
 * reload of that page is a GET, and cannot rotate a second time.
 */
import { rotateCode } from '../../../../lib/invite.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ env }) {
  await rotateCode(env.DB, nowSeconds());
  return new Response(null, { status: 303, headers: { Location: '/admin/code', 'Cache-Control': 'no-store' } });
}

/**
 * GET: a press that reached this address as a page load. The likely way is an
 * Access sign-in that ran out while the page was open: Access sends the
 * browser to sign in again and back here, and the post's body does not survive
 * that (reasoned, not measured). A GET never rotates, because GET needs no
 * Origin, so a page elsewhere could send one. It goes back to the page, which
 * says the code was not rotated, rather than to the site's 404.
 */
export function onRequestGet() {
  return new Response(null, { status: 303, headers: { Location: '/admin/code?unchanged=rotate', 'Cache-Control': 'no-store' } });
}
