/**
 * GET /coach: where a coach signs in (#192; epic #147, D9). Access asks them
 * to sign in on photos.madcowsailing.com, the guard in _middleware.js checks
 * the token against COACH_EMAILS, and this sets an upload session and sends
 * the browser to the share page, which then finds the session the way it
 * finds a returning parent's (GET /api/upload/session). No code is typed or
 * followed.
 *
 *   303  Location: /share/, with one Set-Cookie: the coach's session
 *        (lib/session.js), naming the coach by a keyed hash, never the address
 *   403  the guard's refusal: no token, or one that does not pass
 *   503  the guard could not read Access's keys, or SESSION_SIGNING_KEY is
 *        not set: closed, never open
 *
 * A GET that sets a cookie, on purpose: it is what Access sends the browser
 * back to after the sign-in. Another site making a coach's browser load it
 * only gives that coach a fresh session of their own, since the token is
 * theirs. Nothing here logs the address, the token or the cookie.
 */
import { coachSessionCookie } from '../../lib/session.js';

export async function onRequestGet({ env, data }) {
  if (!env.SESSION_SIGNING_KEY) {
    console.error('coach: SESSION_SIGNING_KEY is not configured, so coach sign-in is closed');
    return Response.json({ error: 'closed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/share/',
      'Set-Cookie': await coachSessionCookie(env.SESSION_SIGNING_KEY, data.coach.email),
      'Cache-Control': 'no-store',
    },
  });
}
