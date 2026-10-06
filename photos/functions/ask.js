/**
 * /ask: anyone asks for an account (#220). GET shows the form (lib/ask-page.js)
 * and POST takes a request (lib/accounts.js holds the rules). Nothing on the
 * site links here yet (owner, at #220's pickup); #226 points the old invite
 * link at it.
 *
 * POST's answers, each a page a person sees, except the forged one:
 *
 *   303  to /ask?sent, for a request taken: a new address, or one the site
 *        already has, asking, approved or revoked. The two are answered
 *        alike, by the same statements (criterion 4)
 *   400  the form again, with each field's reason
 *   403  the form again: Turnstile did not pass, and nothing was written
 *   403  {"error":"origin"}: no Origin, or another site's
 *   429  the form again, with Retry-After: REQUEST_LIMIT requests from this
 *        network in the last hour, or the site's budget for the hour spent
 *   503  the form again (or GET's closed page): a binding or secret is
 *        missing, Turnstile could not be asked, or the database did not
 *        answer. Closed, never open
 *
 * Every refusal leaves the database as it was. Turnstile is asked before any
 * field is checked, so a request no person sent writes nothing, and the
 * limits count only requests that passed it (criterion 2).
 *
 * Not behind a directory guard, so it checks the Origin itself, as
 * POST /api/join and POST /api/remove do. test/guard.test.js lists it public.
 * lib/headers.js gives this path, and no other, a CSP that admits
 * Turnstile's origin (criterion 2).
 *
 * A request that made an account emails the admins after the page has
 * answered (context.waitUntil, lib/accounts.js's mailAdmins), so how long the
 * answer took says nothing about whether the address was new.
 */
import { addressHash } from '../lib/address.js';
import { ASK_FORM_BYTES, mailAdmins, readRequest, requestAccount } from '../lib/accounts.js';
import { askClosedPage, askPage, askSentPage } from '../lib/ask-page.js';
import { readFormParams, seeOther } from '../lib/form.js';
import { inviteSite } from '../lib/invite.js';
import { sameOrigin } from '../lib/origin.js';
import { htmlResponse } from '../lib/public-page.js';
import { nowSeconds } from '../lib/session.js';
import { TOKEN_FIELD, verifyTurnstile } from '../lib/turnstile.js';

// What a request needs, by name. GET checks them too, so a page that could
// never take a request says so before anyone fills it in.
const NEEDS = ['DB', 'ADDRESS_HASH_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'];
const missing = (env) => NEEDS.filter((name) => !env[name]);

const page = (body, status, headers = {}) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
};

export async function onRequestGet({ request, env }) {
  if (missing(env).length) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('ask: a binding or secret is not configured, so requests are closed:', missing(env).join(', '));
    return page(askClosedPage(), 503);
  }
  if (new URL(request.url).searchParams.has('sent')) return htmlResponse(askSentPage());
  return htmlResponse(askPage({ siteKey: env.TURNSTILE_SITE_KEY }));
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
    console.error('ask: a binding or secret is not configured, so requests are closed:', missing(env).join(', '));
    return page(askClosedPage(), 503);
  }

  const form = await readFormParams(request, ASK_FORM_BYTES);
  const values = {
    name: form.get('name') ?? '', email: form.get('email') ?? '', role: form.get('role') ?? '',
    team: form.getAll('team'), note: form.get('note') ?? '',
  };
  const again = (status, options, headers) =>
    page(askPage({ siteKey: env.TURNSTILE_SITE_KEY, values, ...options }), status, headers);

  const check = await verifyTurnstile(env, form.get(TOKEN_FIELD), request.headers.get('CF-Connecting-IP'));
  if (check === 'unavailable') return again(503, { problem: 'closed' });
  if (check !== 'passed') return again(403, { problem: 'turnstile' });

  const { request: asked, errors } = readRequest(form);
  if (errors) return again(400, { errors });

  const now = nowSeconds();
  let result;
  try {
    result = await requestAccount(env.DB, { request: asked, address: await addressHash(env.ADDRESS_HASH_KEY, request), now });
  } catch (err) {
    console.error('ask: the database did not answer, so the request was not taken:', err instanceof Error ? err.message : String(err));
    return again(503, { problem: 'closed' });
  }
  if (result.outcome === 'limited' || result.outcome === 'busy') {
    return again(429, { problem: result.outcome, retryAfter: result.retryAfter }, { 'Retry-After': String(result.retryAfter) });
  }

  // Called on the context, which the runtime's own method may need as its
  // `this`.
  if (result.created) context.waitUntil(mailAdmins(env, { now, site: inviteSite(request, env) }));
  return seeOther('/ask?sent');
}
