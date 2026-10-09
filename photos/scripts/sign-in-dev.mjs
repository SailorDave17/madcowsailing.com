#!/usr/bin/env node
/**
 * A local stand-in for the site's sign-in, so the admin pages and sending
 * from the share page run under wrangler pages dev with the real checks
 * (#151, criterion 5; #224; #226).
 *
 *   node scripts/sign-in-dev.mjs         then open http://127.0.0.1:8789/admin/
 *                                        or http://127.0.0.1:8789/share/
 *
 * 127.0.0.1, not localhost: it is the one origin passed on as the site's
 * (below), so from localhost:8789 every admin form and every upload is
 * refused, 403 origin.
 *
 * Run from photos/, beside `npx --no-install wrangler pages dev` on its
 * default port, 8788. It forwards every request to 127.0.0.1:8788, and adds
 * two cookies for the account ADMIN_DEV_ACCOUNT names, at session version
 * ADMIN_DEV_VERSION (1 unless said), each signed with SESSION_SIGNING_KEY
 * from .dev.vars and fresh each time:
 *
 *   - __Host-admin, on every request (#224): the admin pages answer to an
 *     account holding the admin role, through the cookie its sign-in sets
 *     once the emailed code passes (lib/admin-session.js). Locally the code
 *     cannot be emailed, since photos/.dev.vars holds no RESEND_API_KEY, so
 *     this stands in for it.
 *   - __Host-account, on every request outside /admin and /api/admin (#226):
 *     since #226 a phone sends only from an account (lib/session.js), so the
 *     share page sends as this account, to the teams it is approved for. It
 *     is the cookie /sign-in sets (lib/account-session.js). Until #226 a
 *     local send went through the invite link instead.
 *
 * The guards run unchanged: they check the signature and the age, and read
 * the account's version, teams and, for the admin pages, role from the local
 * database on every request, so an account that is no admin is still refused
 * there, and one approved for no team cannot send. Make the account by
 * README.md's "The admin pages run locally" statements. Signing out, or
 * setting a password, adds 1 to the account's version, after which both
 * cookies are refused until ADMIN_DEV_VERSION says the new one.
 *
 * Until #226 this was scripts/access-dev.mjs, and it also stood in for the
 * coaches' Cloudflare Access sign-in at /coach (#192), with a key pair of its
 * own; #226 deleted that sign-in, and the stand-in with it.
 *
 * There is no flag that turns a check off, here or anywhere. It also passes
 * this stand-in's own Origin on as the site's, as one host would on
 * production, so the admin pages' forms and the share page's uploads get past
 * the Origin guard (lib/origin.js). Any other Origin is left alone.
 *
 * Lines it reads from photos/.dev.vars (gitignored), which wrangler pages dev
 * reads in place of wrangler.jsonc's values for those names:
 *
 *   SESSION_SIGNING_KEY=<the throwaway local key, as README's Secrets makes it>
 *   ADMIN_DEV_ACCOUNT=<the local admin account's id>
 *   ADMIN_DEV_VERSION=<its session version, when it is not 1>
 *
 * Requests straight to :8788 carry neither cookie and get the guards'
 * refusals, which is the other half worth seeing. Nothing is written to disk.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { ACCOUNT_COOKIE, signAccountSession } from '../lib/account-session.js';
import { ADMIN_COOKIE, signAdminSession } from '../lib/admin-session.js';

const PORT = 8789;
const SITE = 'http://127.0.0.1:8788';
const STAND_IN = `http://127.0.0.1:${PORT}`;

function devVars() {
  let text;
  try {
    text = readFileSync('.dev.vars', 'utf8');
  } catch {
    return {};
  }
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
}

const vars = devVars();
const adminAccount = /^[1-9][0-9]{0,14}$/.test(vars.ADMIN_DEV_ACCOUNT ?? '') ? Number(vars.ADMIN_DEV_ACCOUNT) : null;
const adminVersion = /^[1-9][0-9]{0,14}$/.test(vars.ADMIN_DEV_VERSION ?? '') ? Number(vars.ADMIN_DEV_VERSION) : 1;
if (!vars.SESSION_SIGNING_KEY || adminAccount === null) {
  console.error(`photos/.dev.vars needs these two lines, then restart wrangler pages dev:

  SESSION_SIGNING_KEY=<the throwaway local key>
  ADMIN_DEV_ACCOUNT=<the local admin account's id>

README.md, The photo site, Running it locally, says how to make the account.`);
  process.exit(2);
}

const session = { accountId: adminAccount, version: adminVersion };

// An admin session as the sign-in's code step opens one, issued now.
const adminSession = async () => signAdminSession(vars.SESSION_SIGNING_KEY, session, Math.floor(Date.now() / 1000));

// An account session as /sign-in opens one, issued now (#226).
const accountSession = async () => signAccountSession(vars.SESSION_SIGNING_KEY, session, Math.floor(Date.now() / 1000));

// The admin pages and the admin API, which read the admin cookie alone.
const isAdminPath = (url) =>
  url === '/admin' || url.startsWith('/admin/') || url.startsWith('/admin?') || url.startsWith('/api/admin/');

const DROP = new Set(['connection', 'content-length', 'content-encoding', 'transfer-encoding', 'keep-alive']);

createServer(async (req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (!DROP.has(name) && name !== 'host') headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  // Beside whatever the browser holds, as more cookies on the request.
  const added = [`${ADMIN_COOKIE}=${await adminSession()}`];
  if (!isAdminPath(req.url)) added.push(`${ACCOUNT_COOKIE}=${await accountSession()}`);
  const held = headers.get('cookie');
  headers.set('cookie', [...(held ? [held] : []), ...added].join('; '));
  // The browser is on this stand-in's origin, and the site sees each request
  // arrive on its own. On production the browser and the site share one host,
  // so those are one origin. Say the same here, so a form the admin pages
  // post, or an upload the share page sends, passes the site's Origin guard
  // (#152, #154). Any other Origin goes on as it came, so the guard can still
  // be seen refusing it.
  if (headers.get('origin') === STAND_IN) headers.set('origin', new URL(SITE).origin);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  // Only a path is forwarded, onto SITE's own origin, so no request target can
  // name another host after SITE's port. Measured at #226's PR, the shapes
  // tried already failed (Node's parser refuses "@host/x", and an
  // absolute-form URL glued on does not parse as a URL), so this states the
  // rule rather than closing a known hole (CodeQL js/request-forgery).
  if (!req.url?.startsWith('/')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('only a path is forwarded\n');
    return;
  }
  try {
    const siteURL = new URL(SITE);
    const targetURL = new URL(req.url, siteURL);
    if (targetURL.origin !== siteURL.origin) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('only same-origin paths are forwarded\n');
      return;
    }
    const answer = await fetch(targetURL.href, {
      method: req.method, headers, redirect: 'manual', body: hasBody ? req : undefined, duplex: hasBody ? 'half' : undefined,
    });
    const out = {};
    answer.headers.forEach((value, name) => { if (!DROP.has(name) && name !== 'set-cookie') out[name] = value; });
    const cookies = answer.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(answer.status, out).end(Buffer.from(await answer.arrayBuffer()));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`wrangler pages dev did not answer on ${SITE}: ${err.message}\n`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Stand-in on ${STAND_IN}, forwarding to ${SITE}: signed in as account ${adminAccount} (version ${adminVersion}).`);
  console.log(`Open ${STAND_IN}/admin/ for the admin pages, or ${STAND_IN}/share/ to send. Stop with Ctrl-C.`);
});
