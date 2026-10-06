/**
 * /sign-in (#222): GET shows the form (lib/sign-in-page.js) and POST signs in
 * (lib/sign-in.js holds the rules, lib/account-session.js the cookie).
 *
 * POST's answers, each a page a person sees, except the forged one:
 *
 *   303  to /account, with the session cookie: signed in
 *   400  the form again: the address or the password was left empty, which
 *        is checked before anything is read or written
 *   403  the form again, with one message for every failure: an address with
 *        no account, a wrong password, an account not approved, one with no
 *        password yet, one whose password stopped working (criterion 2)
 *   403  {"error":"origin"}: no Origin, or another site's
 *   429  the form again, with Retry-After: 10 failures an hour for this
 *        address, 20 from this network, or the site's 100 for the hour spent
 *        (criterion 3)
 *   503  the form again: a binding or secret is missing, or the database did
 *        not answer. Closed, never open
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
import { readFormParams } from '../lib/form.js';
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
  const notice = new URL(request.url).searchParams.has('signed-out') ? 'signed-out' : null;
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

  if (result.outcome === 'signed-in') {
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/account',
        'Set-Cookie': await accountCookie(env.SESSION_SIGNING_KEY, result, now),
        'Cache-Control': 'no-store',
      },
    });
  }
  if (result.outcome === 'limited' || result.outcome === 'busy') {
    const problem = result.outcome === 'busy' ? 'busy' : result.scope;
    return page(signInPage({ email, problem, retryAfter: result.retryAfter }), 429, { 'Retry-After': String(result.retryAfter) });
  }
  return page(signInPage({ email, problem: 'refused' }), 403);
}
