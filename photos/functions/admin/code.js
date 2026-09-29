/**
 * GET /admin/code: the invite code (#152). The guards in _middleware.js have
 * already checked the Access token.
 *
 * It shows the current code, when it last changed, and the invite link a
 * parent opens, with a button to copy each and one to rotate the code. With
 * no code yet, it offers "Create code" instead, and uploads stay closed until
 * one exists, because the upload guard refuses every session while the
 * database holds no code (lib/session.js).
 *
 * ?unchanged=rotate or ?unchanged=create is where a press that arrived as a
 * GET lands (functions/api/admin/code/rotate.js says how). The page then says
 * nothing was changed. Any other value is ignored.
 *
 * The page carries the code itself, so no cache may keep it. Rendered here,
 * never a static file (CLAUDE.md, The photo site, item 4).
 */
import { adminCodePage } from '../../lib/admin-page.js';
import { currentCode, inviteSite } from '../../lib/invite.js';

export async function onRequestGet({ request, env }) {
  const current = await currentCode(env.DB);
  const unchanged = new URL(request.url).searchParams.get('unchanged');
  return new Response(adminCodePage({ current, site: inviteSite(request, env), unchanged }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
