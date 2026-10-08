/**
 * /set-password?token=…: where the link in an approval email (#221) or a
 * reset email (#222) lands. lib/password-link.js holds the link's rules,
 * lib/password-rules.js the password's, lib/sign-in.js the write, and
 * lib/password-page.js the pages.
 *
 * GET only checks the link, and spends nothing: a mail scanner that fetches
 * every link in an email cannot use it up.
 *
 *   200  the link can be used: the form to choose a password, which says
 *        until when the link works
 *   404  it cannot (used, replaced, expired, never made, or no token), one
 *        page for all of them, with no way in
 *   503  the database did not answer; nothing is said about the link
 *
 * POST sets the password, from the form's hidden token:
 *
 *   303  to /account?password-set, with a new session cookie: the password
 *        is stored as lib/password.js's hash, every link the account held is
 *        gone, and every other session it held has ended (lib/sign-in.js's
 *        setPassword). It deletes any admin cookie the browser held, as a
 *        sign-in does (#224's review): it opens no admin session itself
 *   400  the form again, with the reason: too short or too long, the two
 *        not the same, the person's own address or name or the site's, or a
 *        password Pwned Passwords has seen in a breach (criterion 1)
 *   403  {"error":"origin"}: no Origin, or another site's
 *   404  the link cannot be used, as GET answers it. Two posts of one link
 *        at once: the second gets this, and changes nothing
 *   503  a binding or secret is missing, or the database did not answer
 *
 * Every answer is no-store: the form names one person's address and when
 * their link expires. Public, since the person has no sign-in yet:
 * test/guard.test.js lists it, and it checks the Origin itself.
 */
import { accountCookie } from '../lib/account-session.js';
import { clearAdminCookie } from '../lib/admin-session.js';
import { readFormParams } from '../lib/form.js';
import { hashPassword } from '../lib/password.js';
import { isToken, linkAccount } from '../lib/password-link.js';
import { MESSAGES, pwned, readNewPassword } from '../lib/password-rules.js';
import { linkClosedPage, linkGonePage, setPasswordPage } from '../lib/password-page.js';
import { sameOrigin } from '../lib/origin.js';
import { htmlResponse } from '../lib/public-page.js';
import { nowSeconds } from '../lib/session.js';
import { SET_PASSWORD_FORM_BYTES, emailHash, linkedAccount, setPassword } from '../lib/sign-in.js';

const page = (body, status) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

// The link's account, ready for the form, or null when the link cannot be
// used. Throws when D1 fails.
async function openLink(db, token, now) {
  const link = await linkAccount(db, token, now);
  if (!link) return null;
  const account = await linkedAccount(db, link.accountId);
  return account ? { ...account, expiresAt: link.expiresAt } : null;
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');
  let opened;
  try {
    opened = await openLink(env.DB, token, nowSeconds());
  } catch (err) {
    console.error('set-password: the database did not answer, so the link was not checked:', err instanceof Error ? err.message : String(err));
    return page(linkClosedPage(), 503);
  }
  if (!opened) return page(linkGonePage(), 404);
  return page(setPasswordPage({ token, email: opened.email, hasPassword: opened.hasPassword, expiresAt: opened.expiresAt }), 200);
}

// A Function that answers GET only never sees HEAD, which then falls through
// to the static files and 404s (cairn: pages-functions-head-needs-its-own-
// handler, #157).
export const onRequestHead = onRequestGet;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!env.DB || !env.SESSION_SIGNING_KEY || !env.ADDRESS_HASH_KEY) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('set-password: the database or a secret is not configured, so no password was set');
    return page(linkClosedPage(), 503);
  }
  const form = await readFormParams(request, SET_PASSWORD_FORM_BYTES);
  const token = form.get('token');
  if (!isToken(token)) return page(linkGonePage(), 404);

  const now = nowSeconds();
  let opened;
  try {
    opened = await openLink(env.DB, token, now);
  } catch (err) {
    console.error('set-password: the database did not answer, so no password was set:', err instanceof Error ? err.message : String(err));
    return page(linkClosedPage(), 503);
  }
  if (!opened) return page(linkGonePage(), 404);

  const again = (errors) => page(setPasswordPage({ token, email: opened.email, hasPassword: opened.hasPassword, expiresAt: opened.expiresAt, errors }), 400);
  const { password, errors } = readNewPassword(form, opened);
  if (errors) return again(errors);
  if ((await pwned(password)) === 'breached') return again([{ field: 'password', message: MESSAGES.breached }]);

  let version;
  try {
    version = await setPassword(env.DB, {
      accountId: opened.id,
      token,
      passwordHash: await hashPassword(password),
      emailKey: await emailHash(env.ADDRESS_HASH_KEY, opened.email),
      now,
    });
  } catch (err) {
    console.error('set-password: the database did not answer, so no password was set:', err instanceof Error ? err.message : String(err));
    return page(linkClosedPage(), 503);
  }
  if (version === null) return page(linkGonePage(), 404);
  const headers = new Headers({ Location: '/account?password-set', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', await accountCookie(env.SESSION_SIGNING_KEY, { accountId: opened.id, version }, now));
  headers.append('Set-Cookie', clearAdminCookie());
  return new Response(null, { status: 303, headers });
}
