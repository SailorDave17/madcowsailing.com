/**
 * /sign-in (#222): GET shows the form (lib/sign-in-page.js) and POST signs in
 * (lib/sign-in.js holds the rules, lib/account-session.js the cookie).
 *
 * Since #224 an account holding the admin role is not signed in by its
 * password alone: once the password passes, the site emails a code
 * (lib/admin-code.js) and sends the browser to /sign-in/code, which opens
 * the account's session and the admin's (owner, at #224's pickup: one
 * sign-in, with the code for admins). Everyone else is signed in as before.
 *
 * POST's answers, each a page a person sees, except the forged one:
 *
 *   303  to /account, with the session cookie: signed in
 *   303  to /sign-in/code, with the code cookie: an admin's password passed
 *        and the code was emailed (?unconfirmed when Resend did not confirm
 *        it)
 *
 *        Both delete any admin cookie the browser held (#224's review): a
 *        sign-in makes the browser one person, so someone signing in after
 *        an admin left theirs open is not that admin on /admin, and their
 *        Sign out does not end the admin's sessions everywhere.
 *   400  the form again: the address or the password was left empty, which
 *        is checked before anything is read or written
 *   403  the form again, with one message for every failure: an address with
 *        no account, a wrong password, an account not approved, one with no
 *        password yet, one whose password stopped working (criterion 2)
 *   403  {"error":"origin"}: no Origin, or another site's
 *   429  the form again, with Retry-After: 10 failures an hour for this
 *        address, 20 from this network, or the site's 100 for the hour spent
 *        (criterion 3); or, after an admin's right password, the day's 10
 *        codes already sent (#224)
 *   503  the form again: a binding or secret is missing, or the database did
 *        not answer, or an admin's code could not be emailed. Closed, never
 *        open
 *
 * Not behind a directory guard, so it checks the Origin itself, as /ask and
 * POST /api/join do. test/guard.test.js lists it public: it is the door to a
 * session, so nothing can stand in front of it but what it checks itself.
 *
 * The password is normalised to NFC before it is checked, as it was when it
 * was set (lib/password-rules.js), and it is never put back into the page.
 */
import { addressHash } from '../lib/address.js';
import { accountCookie } from '../lib/account-session.js';
import { codeCookie, startCode } from '../lib/admin-code.js';
import { clearAdminCookie } from '../lib/admin-session.js';
import { readFormParams } from '../lib/form.js';
import { inviteSite } from '../lib/invite.js';
import { normalizePassword } from '../lib/password-rules.js';
import { sameOrigin } from '../lib/origin.js';
import { htmlResponse } from '../lib/public-page.js';
import { nowSeconds } from '../lib/session.js';
import { SIGN_IN_FORM_BYTES, emailHash, signIn } from '../lib/sign-in.js';
import { signInPage } from '../lib/sign-in-page.js';

const NEEDS = ['DB', 'SESSION_SIGNING_KEY', 'ADDRESS_HASH_KEY'];
const missing = (env) => NEEDS.filter((name) => !env[name]);

const page = (body, status = 200, headers = {}) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
};

export async function onRequestGet({ request, env }) {
  if (missing(env).length) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('sign-in: a binding or secret is not configured, so signing in is closed:', missing(env).join(', '));
    return page(signInPage({ problem: 'closed' }), 503);
  }
  const params = new URL(request.url).searchParams;
  const notice = params.has('signed-out') ? 'signed-out' : params.has('admin') ? 'admin' : null;
  return page(signInPage({ notice }));
}

// A Function that answers GET only never sees HEAD, which then falls through
// to the static files and 404s (cairn: pages-functions-head-needs-its-own-
// handler, #157).
export const onRequestHead = onRequestGet;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (missing(env).length) {
    console.error('sign-in: a binding or secret is not configured, so signing in is closed:', missing(env).join(', '));
    return page(signInPage({ problem: 'closed' }), 503);
  }

  const form = await readFormParams(request, SIGN_IN_FORM_BYTES);
  const email = (form.get('email') ?? '').trim();
  const password = normalizePassword(form.get('password') ?? '');
  const errors = [
    ...(email === '' ? [{ field: 'email', message: 'Enter your email address.' }] : []),
    ...(password === '' ? [{ field: 'password', message: 'Enter your password.' }] : []),
  ];
  if (errors.length) return page(signInPage({ email, errors }), 400);

  const now = nowSeconds();
  let result;
  try {
    result = await signIn(env.DB, {
      email,
      password,
      emailKey: await emailHash(env.ADDRESS_HASH_KEY, email),
      address: await addressHash(env.ADDRESS_HASH_KEY, request),
      now,
    });
  } catch (err) {
    console.error('sign-in: the database did not answer, so no one was signed in:', err instanceof Error ? err.message : String(err));
    return page(signInPage({ email, problem: 'closed' }), 503);
  }

  if (result.outcome === 'signed-in' && result.adminRole) return startAdminCode({ request, env, email, result, now });
  if (result.outcome === 'signed-in') {
    const headers = new Headers({ Location: '/account', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', await accountCookie(env.SESSION_SIGNING_KEY, result, now));
    headers.append('Set-Cookie', clearAdminCookie());
    return new Response(null, { status: 303, headers });
  }
  if (result.outcome === 'limited' || result.outcome === 'busy') {
    const problem = result.outcome === 'busy' ? 'busy' : result.scope;
    return page(signInPage({ email, problem, retryAfter: result.retryAfter }), 429, { 'Retry-After': String(result.retryAfter) });
  }
  return page(signInPage({ email, problem: 'refused' }), 403);
}

// An admin's password passed (#224): email the code and send the browser to
// type it, holding the cookie that ties the code to this sign-in. No session
// is opened yet, of either kind, and an admin cookie the browser held goes,
// whoever's it was. `email` is what was typed, put back into
// the form if the code could not be sent; the code goes to the address the
// account holds.
async function startAdminCode({ request, env, email, result, now }) {
  let started;
  try {
    started = await startCode(env, {
      accountId: result.accountId, version: result.version, email: result.email, now, site: inviteSite(request, env),
    });
  } catch (err) {
    console.error('sign-in: the database did not answer, so no admin code was made:', err instanceof Error ? err.message : String(err));
    return page(signInPage({ email, problem: 'closed' }), 503);
  }
  if (started.outcome === 'sent' || started.outcome === 'unconfirmed') {
    const headers = new Headers({
      Location: started.outcome === 'sent' ? '/sign-in/code' : '/sign-in/code?unconfirmed',
      'Cache-Control': 'no-store',
    });
    headers.append('Set-Cookie', codeCookie(started.token));
    headers.append('Set-Cookie', clearAdminCookie());
    return new Response(null, { status: 303, headers });
  }
  if (started.outcome === 'limited') {
    return page(signInPage({ email, problem: 'codes', retryAfter: started.retryAfter }), 429, { 'Retry-After': String(started.retryAfter) });
  }
  return page(signInPage({ email, problem: started.reason === 'quota' ? 'code-quota' : 'code-unsent' }), 503);
}
