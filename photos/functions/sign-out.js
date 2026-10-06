/**
 * POST /sign-out (#222, criterion 7): ends the session and deletes the cookie.
 *
 * Ending it adds 1 to the account's session version (lib/sign-in.js's
 * signOut), so every session the account holds ends at its next request, on
 * every device, a copied cookie included (the owner's choice at pickup,
 * 2026-10-06). The answers:
 *
 *   303  to /sign-in?signed-out, deleting the cookie: signed out, or there was
 *        no session that held, which leaves nothing to end
 *   403  {"error":"origin"}: no Origin, or another site's, so a page
 *        elsewhere cannot sign anyone out
 *   503  the database did not answer, or it or SESSION_SIGNING_KEY is not
 *        configured: the session was not ended, so the cookie is kept and
 *        the page says to try again. Deleting it here would leave a session
 *        that still works with no button to end it (#222's review: without
 *        the key, no cookie read as a session, and every sign-out answered
 *        "signed out" having ended nothing)
 *
 * Only POST: a link or a prefetch never signs anyone out. Public in
 * test/guard.test.js's sense, since it must answer a session that no longer
 * holds by deleting its cookie.
 */
import { clearAccountCookie, readAccountSession } from '../lib/account-session.js';
import { sameOrigin } from '../lib/origin.js';
import { htmlResponse } from '../lib/public-page.js';
import { closedPage } from '../lib/sign-in-page.js';
import { signOut } from '../lib/sign-in.js';

const closed = () => {
  const response = htmlResponse(closedPage('Not signed out'), 503);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!env.DB || !env.SESSION_SIGNING_KEY) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('sign-out: the database or a secret is not configured, so no session was ended');
    return closed();
  }
  const session = await readAccountSession(request, env.SESSION_SIGNING_KEY);
  if (session) {
    try {
      await signOut(env.DB, session);
    } catch (err) {
      console.error('sign-out: the database did not answer, so the session was not ended:', err instanceof Error ? err.message : String(err));
      return closed();
    }
  }
  return new Response(null, {
    status: 303,
    headers: { Location: '/sign-in?signed-out', 'Set-Cookie': clearAccountCookie(), 'Cache-Control': 'no-store' },
  });
}
