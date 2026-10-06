/**
 * GET /set-password?token=…: where the link in an approval email lands (#221,
 * criterion 2). lib/password-link.js holds the link's rules and
 * lib/password-page.js the pages.
 *
 * It only checks the link, and spends nothing: a mail scanner that fetches
 * every link in an email cannot use it up. Setting the password, which does
 * spend it, is #222's (the owner's choice at #221's pickup).
 *
 *   200  the link can be used: the account is approved, and the page says
 *        until when
 *   404  it cannot (used, replaced, expired, never made, or no token), one
 *        page for all of them, with no way in
 *   503  the database did not answer; nothing is said about the link
 *
 * Every answer is no-store: the first names when one person's link expires.
 * Public, since the person has no sign-in yet: test/guard.test.js lists it.
 */
import { linkAccount } from '../lib/password-link.js';
import { linkClosedPage, linkGonePage, linkReadyPage } from '../lib/password-page.js';
import { htmlResponse } from '../lib/public-page.js';
import { nowSeconds } from '../lib/session.js';

const page = (body, status) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

export async function onRequestGet({ request, env }) {
  let link;
  try {
    link = await linkAccount(env.DB, new URL(request.url).searchParams.get('token'), nowSeconds());
  } catch (err) {
    console.error('set-password: the database did not answer, so the link was not checked:', err instanceof Error ? err.message : String(err));
    return page(linkClosedPage(), 503);
  }
  return link ? page(linkReadyPage(link.expiresAt), 200) : page(linkGonePage(), 404);
}

// A Function that answers GET only never sees HEAD, which then falls through
// to the static files and 404s (cairn: pages-functions-head-needs-its-own-
// handler, #157).
export const onRequestHead = onRequestGet;
