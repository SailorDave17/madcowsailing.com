/**
 * POST /api/join: what an old invite link is told (#226).
 *
 * Until #226 this traded the invite code for an upload session (#150): the
 * share page sent {"code": "<code>"} from the link's fragment, and the
 * current code was answered with a __Host-upload cookie. Accounts replaced
 * the invite link (epic #216), so nothing opens a session here now, and
 * every request gets one fixed answer:
 *
 *   410  {"error":"replaced","ask":"/ask"}   the invite link has been
 *                                            replaced by accounts; /ask is
 *                                            where to ask for one
 *   403  {"error":"origin"}                  no Origin, or another site's
 *
 * Since #226 the share page says so itself and never sends an old link's
 * code here, so this answers anything that still posts. A tab left open
 * across the release, running the share page from before #226, is not
 * helped by it: that script reads any status it does not know as "Couldn't
 * reach the photo site", with Try again, and a reload gives it the page that
 * explains (owner, at #226's review: keep the honest status rather than a
 * 403 the old script would word better). The body is never read: no code is compared, nothing
 * is counted, and no database, secret or binding is needed, so it has no 503.
 * When the request carries a __Host-upload cookie, the 410 also deletes it,
 * as the upload guard does (lib/session.js). Nothing here logs.
 *
 * Not behind a directory guard, so it checks the Origin itself, as it always
 * has: lib/origin.js, functions/api/remove.js, functions/ask.js and
 * functions/sign-in.js cite it as the public route that does.
 * test/guard.test.js lists it public.
 */
import { sameOrigin } from '../../lib/origin.js';
import { clearUploadCookie, cookieValue } from '../../lib/session.js';

export function onRequestPost({ request }) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (cookieValue(request.headers.get('Cookie')) !== null) headers.append('Set-Cookie', clearUploadCookie());
  return Response.json({ error: 'replaced', ask: '/ask' }, { status: 410, headers });
}
