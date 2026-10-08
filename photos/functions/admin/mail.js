/**
 * GET /admin/mail: who the site's email comes from, and a test send (#217).
 * The guards in _middleware.js have already checked the admin session.
 *
 * The form posts to functions/api/admin/mail/test.js, which answers 303 back
 * here with ?done= or ?error= saying what happened (lib/admin-page.js,
 * mailNotice). The field starts with the signed-in admin's own address.
 *
 * Rendered here, never a static file (CLAUDE.md, The photo site, item 4).
 */
import { adminMailPage, mailNotice } from '../../lib/admin-page.js';

export function onRequestGet({ request, data }) {
  const notice = mailNotice(new URL(request.url).searchParams);
  return new Response(adminMailPage({ email: data.admin.email, notice }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Names who is signed in, so no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
