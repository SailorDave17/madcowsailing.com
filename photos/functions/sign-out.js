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
 *
 * Since #224 an admin's sign-in holds two cookies, the account's and the
 * admin's (lib/admin-session.js), and the admin home's Sign out posts here.
 * The session is ended from whichever of the two the request carries, and
 * both cookies are deleted. Each account the cookies name is signed out in
 * one statement holding every version they carry, so a change already made
 * is never followed by one that can fail and answer 503 for a session that
 * ended (#224's review). Since a sign-in deletes any admin cookie it finds
 * (functions/sign-in.js, functions/set-password.js), the two name one
 * account; a browser holding two from before that is signed out of each.
 */
import { clearAccountCookie, readAccountSession } from '../lib/account-session.js';
import { clearAdminCookie, readAdminSession } from '../lib/admin-session.js';
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
  const sessions = [
    await readAccountSession(request, env.SESSION_SIGNING_KEY),
    await readAdminSession(request, env.SESSION_SIGNING_KEY),
  ].filter(Boolean);
  // Every version each account's cookies carry: set together they name one,
  // and a cookie from before a new password names an older one.
  const accounts = new Map();
  for (const { accountId, version } of sessions) accounts.set(accountId, [...(accounts.get(accountId) ?? []), version]);
  try {
    for (const [accountId, versions] of accounts) await signOut(env.DB, { accountId, versions });
  } catch (err) {
    console.error('sign-out: the database did not answer, so the session was not ended:', err instanceof Error ? err.message : String(err));
    return closed();
  }
  const headers = new Headers({ Location: '/sign-in?signed-out', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearAccountCookie());
  headers.append('Set-Cookie', clearAdminCookie());
  return new Response(null, { status: 303, headers });
}
