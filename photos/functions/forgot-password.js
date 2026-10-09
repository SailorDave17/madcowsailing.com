/**
 * /forgot-password (#222, criterion 5): GET shows the reset form
 * (lib/sign-in-page.js) and POST takes a request (lib/reset.js holds the
 * rules).
 *
 * POST's answers, each a page a person sees, except the forged one:
 *
 *   303  to /forgot-password?sent, for every request that got past the
 *        checks below, whether or not the address has an account: the same
 *        answer, after the same statements (criterion 5). Whether an email
 *        goes is decided after the answer (context.waitUntil, sendReset), so
 *        the answer's timing does not carry it either
 *   400  the form again: no address, or not one address
 *   403  the form again: Turnstile did not pass, and nothing was written
 *   403  {"error":"origin"}: no Origin, or another site's
 *   429  the form again, with Retry-After: RESET_REQUEST_LIMIT requests from
 *        this network in the last hour
 *   503  the form again (or GET's closed page): a binding or secret is
 *        missing, Turnstile could not be asked, or the database did not
 *        answer. Closed, never open
 *
 * Turnstile is asked before any field is read, so a request no person sent
 * writes nothing, and the network's count is only of requests that passed it
 * (the owner's choice at pickup, 2026-10-06: a reset spends Resend's 100
 * emails a day). lib/headers.js gives this path, as it gives /ask, a CSP that
 * admits Turnstile's origin. Not behind a directory guard, so it checks the
 * Origin itself; test/guard.test.js lists it public.
 */
import { addressHash } from '../lib/address.js';
import { readFormParams, seeOther } from '../lib/form.js';
import { isEmailAddress } from '../lib/mail.js';
import { sameOrigin } from '../lib/origin.js';
import { htmlResponse } from '../lib/public-page.js';
import { RESET_FORM_BYTES, claimResetRequest, sendReset } from '../lib/reset.js';
import { nowSeconds } from '../lib/session.js';
import { closedPage, forgotPage, forgotSentPage } from '../lib/sign-in-page.js';
import { siteOrigin } from '../lib/site.js';
import { TOKEN_FIELD, verifyTurnstile } from '../lib/turnstile.js';

const NEEDS = ['DB', 'ADDRESS_HASH_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'];
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
    console.error('forgot-password: a binding or secret is not configured, so resets are closed:', missing(env).join(', '));
    return page(closedPage('Resets closed'), 503);
  }
  if (new URL(request.url).searchParams.has('sent')) return page(forgotSentPage());
  return page(forgotPage({ siteKey: env.TURNSTILE_SITE_KEY }));
}

// A Function that answers GET only never sees HEAD, which then falls through
// to the static files and 404s (cairn: pages-functions-head-needs-its-own-
// handler, #157).
export const onRequestHead = onRequestGet;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (missing(env).length) {
    console.error('forgot-password: a binding or secret is not configured, so resets are closed:', missing(env).join(', '));
    return page(closedPage('Resets closed'), 503);
  }

  const form = await readFormParams(request, RESET_FORM_BYTES);
  const email = (form.get('email') ?? '').trim();
  const again = (status, options, headers) => page(forgotPage({ siteKey: env.TURNSTILE_SITE_KEY, email, ...options }), status, headers);

  const check = await verifyTurnstile(env, form.get(TOKEN_FIELD), request.headers.get('CF-Connecting-IP'));
  if (check === 'unavailable') return again(503, { problem: 'closed' });
  if (check !== 'passed') return again(403, { problem: 'turnstile' });

  if (email === '') return again(400, { errors: [{ field: 'email', message: 'Enter your email address.' }] });
  if (!isEmailAddress(email)) return again(400, { errors: [{ field: 'email', message: 'Enter one email address, like name@example.com.' }] });

  const now = nowSeconds();
  let retryAfter;
  try {
    retryAfter = await claimResetRequest(env.DB, await addressHash(env.ADDRESS_HASH_KEY, request), now);
  } catch (err) {
    console.error('forgot-password: the database did not answer, so the request was not taken:', err instanceof Error ? err.message : String(err));
    return again(503, { problem: 'closed' });
  }
  if (retryAfter !== null) return again(429, { problem: 'limited', retryAfter }, { 'Retry-After': String(retryAfter) });

  // Called on the context, which the runtime's own method may need as its
  // `this`.
  context.waitUntil(sendReset(env, { email, now, site: siteOrigin(request, env) }));
  return seeOther('/forgot-password?sent');
}
