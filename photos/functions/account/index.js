/**
 * GET /account (#222): the page a signed-in person lands on, after signing in
 * or setting a password. The guard in _middleware.js has already checked the
 * session; this says who is signed in and the teams they are approved for, and
 * holds Sign out (POST /sign-out). Sending from an account is #223's.
 *
 * Its notices: ?password-set after a new password, and since #274
 * ?forgotten, where "Forget this phone" lands (functions/api/admin/forget.js).
 *
 * no-store: it names who is signed in, so no cache may keep it.
 */
import { htmlResponse } from '../../lib/public-page.js';
import { accountPage } from '../../lib/sign-in-page.js';

const NOTICES = ['password-set', 'forgotten'];

export async function onRequestGet({ request, data }) {
  const params = new URL(request.url).searchParams;
  const notice = NOTICES.find((name) => params.has(name)) ?? null;
  const response = htmlResponse(accountPage(data.account, { notice }));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

// A Function that answers GET only never sees HEAD, which then falls through
// to the static files and 404s (cairn: pages-functions-head-needs-its-own-
// handler, #157).
export const onRequestHead = onRequestGet;
