/**
 * /sign-in/code (#224, criterion 1): the second step of an admin's sign-in.
 * /sign-in sends the browser here once an admin's password has passed and
 * the code has been emailed, holding the __Host-sign-in-code cookie that
 * ties the code to that sign-in (lib/admin-code.js). GET shows the form, and
 * POST checks the code.
 *
 * GET's answers: the form, or, with no code cookie, a 303 to /sign-in, since
 * there is no sign-in here to finish. It reads nothing and writes nothing.
 *
 * POST's answers:
 *
 *   303  to /account, with the account's session cookie and the admin's
 *        (lib/account-session.js, lib/admin-session.js), and the code cookie
 *        deleted: the code was right, and the account is still an admin.
 *        /account links the admin pages. With the account's cookie alone,
 *        and any admin cookie deleted, when its admin role was taken away
 *        between the two steps: the password and the code still proved who
 *        it is
 *   400  the form again: not 6 digits, which spends no try
 *   403  the form again: not the code, with how many tries are left
 *   403  the "sign in again" page, deleting the code cookie: no code left to
 *        check, used, expired, out of tries or never made, all alike; or the
 *        account was signed out, given a new password or turned away between
 *        the two steps
 *   403  {"error":"origin"}: no Origin, or another site's
 *   503  the form again: a binding or secret is missing, or the database did
 *        not answer. Closed, never open, and the code is not spent: who it
 *        signs in is read before useCode spends it, so the same code works
 *        when the form is sent again (#224's review)
 *
 * Why /account and not /admin/ (#224's review): until #226, Cloudflare
 * Access stands in front of /admin on photos.madcowsailing.com and answers a
 * browser without its cookie with a 302 to its login on another origin. This
 * page's CSP says form-action 'self', and Chromium and WebKit apply that to
 * every redirect of a form's post, so a 303 to /admin/ was stopped there with
 * no error page, after the code was spent. A link is not a form's post, so
 * /account's link to the admin pages goes through. #226 may answer /admin/
 * again once Access is gone.
 *
 * Not behind a directory guard, so it checks the Origin itself, as /sign-in
 * does. test/guard.test.js lists it public: it is the second half of the
 * door to a session.
 */
import { accountCookie, sessionAccount } from '../../lib/account-session.js';
import { CODE_FORM_BYTES, checkCode, clearCodeCookie, codeCookieToken, readCode, useCode } from '../../lib/admin-code.js';
import { adminCookie, clearAdminCookie, sessionAdmin } from '../../lib/admin-session.js';
import { readFormParams } from '../../lib/form.js';
import { sameOrigin } from '../../lib/origin.js';
import { htmlResponse } from '../../lib/public-page.js';
import { nowSeconds } from '../../lib/session.js';
import { codeEndedPage, codePage } from '../../lib/sign-in-page.js';

const NEEDS = ['DB', 'SESSION_SIGNING_KEY'];
const missing = (env) => NEEDS.filter((name) => !env[name]);

const page = (body, status = 200, cookies = []) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
  return response;
};

const ended = (options) => page(codeEndedPage(options), 403, [clearCodeCookie()]);

export function onRequestGet({ request }) {
  if (!codeCookieToken(request)) {
    return new Response(null, { status: 303, headers: { Location: '/sign-in', 'Cache-Control': 'no-store' } });
  }
  const notice = new URL(request.url).searchParams.has('unconfirmed') ? 'unconfirmed' : null;
  return page(codePage({ notice }));
}

// A Function that answers GET only never sees HEAD (cairn:
// pages-functions-head-needs-its-own-handler, #157).
export const onRequestHead = onRequestGet;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (missing(env).length) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('sign-in code: a binding or secret is not configured, so no code was checked:', missing(env).join(', '));
    return page(codePage({ problem: 'closed' }), 503);
  }
  const token = codeCookieToken(request);
  if (!token) return ended();

  const code = readCode((await readFormParams(request, CODE_FORM_BYTES)).get('code') ?? '');
  if (code === null) return page(codePage({ errors: [{ field: 'code', message: 'Enter the 6 digits from the email.' }] }), 400);

  const now = nowSeconds();
  let result;
  let admin = null;
  let account = null;
  let used = false;
  try {
    result = await checkCode(env, { token, code, now });
    if (result.outcome === 'right') {
      // Who the code signs in is read before it is spent, so a read that
      // fails leaves the code to be sent again.
      const session = { accountId: result.accountId, version: result.version, issued: now };
      admin = await sessionAdmin(env.DB, session);
      if (!admin) account = await sessionAccount(env.DB, session);
      if (admin || account) used = await useCode(env.DB, token);
    }
  } catch (err) {
    console.error('sign-in code: the database did not answer, so the code was not used:', err instanceof Error ? err.message : String(err));
    return page(codePage({ problem: 'closed' }), 503);
  }

  if (result.outcome === 'wrong' && result.triesLeft > 0) return page(codePage({ problem: 'wrong', triesLeft: result.triesLeft }), 403);
  if (result.outcome === 'wrong') return ended({ outOfTries: true });
  // Not right; right for an account signed out, given a new password or
  // turned away since the password step; or spent by another post at once.
  if (!used) return ended();

  // The browser becomes this one account: an admin cookie it held for anyone
  // else, or for this account before a demotion, goes (#224's review).
  const opened = { accountId: result.accountId, version: result.version };
  const headers = new Headers({ Location: '/account', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', await accountCookie(env.SESSION_SIGNING_KEY, opened, now));
  headers.append('Set-Cookie', admin ? await adminCookie(env.SESSION_SIGNING_KEY, opened, now) : clearAdminCookie());
  headers.append('Set-Cookie', clearCodeCookie());
  return new Response(null, { status: 303, headers });
}
