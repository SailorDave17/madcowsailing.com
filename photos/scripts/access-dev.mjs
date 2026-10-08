#!/usr/bin/env node
/**
 * A local stand-in for what stands in front of the site, so the admin pages
 * and the coach sign-in run under wrangler pages dev with the real checks
 * (#151, criterion 5; #192; #224).
 *
 *   node scripts/access-dev.mjs          then open http://127.0.0.1:8789/admin/
 *
 * 127.0.0.1, not localhost: it is the one origin passed on as the site's
 * (below), so from localhost:8789 every admin form is refused, 403 origin.
 *
 * Run from photos/, beside `npx --no-install wrangler pages dev` on its
 * default port, 8788. It forwards every request to 127.0.0.1:8788, and:
 *
 *   - the admin pages (#224): since #224 they answer to an account holding
 *     the admin role, through the __Host-admin cookie its sign-in sets once
 *     the emailed code passes (lib/admin-session.js). Locally the code
 *     cannot be emailed, since photos/.dev.vars holds no RESEND_API_KEY, so
 *     this adds that cookie to every request for the account ADMIN_DEV_ACCOUNT
 *     names, at session version ADMIN_DEV_VERSION (1 unless said), signed
 *     with SESSION_SIGNING_KEY from .dev.vars, fresh each time. The guard runs
 *     unchanged: it checks the signature and the age, and reads the account's
 *     role, version and teams from the local database on every request, so
 *     an account that is no admin is still refused. Make the account by
 *     README.md's "The admin pages run locally" statements.
 *   - /coach and under it (#192): a Cf-Access-Jwt-Assertion token signed RS256
 *     with a key pair generated when this starts, for the first address in
 *     COACH_EMAILS, for ACCESS_COACH_AUD, issued by this server, as the coach
 *     application on photos.madcowsailing.com would send. It publishes the
 *     public key at /cdn-cgi/access/certs, where the coach guard fetches a
 *     team's keys. So lib/access.js runs unchanged too. Without
 *     ACCESS_TEAM_DOMAIN, ACCESS_COACH_AUD and COACH_EMAILS in .dev.vars,
 *     /coach is forwarded with no token, and the coach guard answers 403.
 *     (Until #224 every other path got the admin application's token too,
 *     which nothing reads now.)
 *
 * There is no flag that turns either check off, here or anywhere. It also
 * passes this stand-in's own Origin on as the site's, as one host would on
 * production, so the admin pages' forms get past the Origin guard
 * (lib/origin.js). Any other Origin is left alone.
 *
 * Lines it reads from photos/.dev.vars (gitignored), which wrangler pages dev
 * reads in place of wrangler.jsonc's values for those names:
 *
 *   SESSION_SIGNING_KEY=<the throwaway local key, as README's Secrets makes it>
 *   ADMIN_DEV_ACCOUNT=<the local admin account's id>
 *
 * and, for /coach, which is optional:
 *
 *   ACCESS_TEAM_DOMAIN=http://127.0.0.1:8789
 *   ACCESS_COACH_AUD=local-coach
 *   COACH_EMAILS=<a coach's address>
 *
 * Requests straight to :8788 carry no cookie or token and get the guards'
 * refusals, which is the other half worth seeing. The key pair lives only in
 * this process, and nothing is written to disk.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { ADMIN_COOKIE, signAdminSession } from '../lib/admin-session.js';
import { base64url } from '../lib/crypto.js';

const PORT = 8789;
const SITE = 'http://127.0.0.1:8788';
const ISSUER = `http://127.0.0.1:${PORT}`;
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const encoder = new TextEncoder();

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
const coachEmail = (vars.COACH_EMAILS ?? '').split(',')[0].trim();
const coaching = vars.ACCESS_TEAM_DOMAIN === ISSUER && Boolean(vars.ACCESS_COACH_AUD && coachEmail);
if (!vars.SESSION_SIGNING_KEY || adminAccount === null) {
  console.error(`photos/.dev.vars needs these two lines, then restart wrangler pages dev:

  SESSION_SIGNING_KEY=<the throwaway local key>
  ADMIN_DEV_ACCOUNT=<the local admin account's id>

README.md, The photo site, Running it locally, says how to make the account.`);
  process.exit(2);
}

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'],
);
const kid = `local-${base64url(crypto.getRandomValues(new Uint8Array(12)))}`;
const { n, e } = await crypto.subtle.exportKey('jwk', publicKey);
const certs = JSON.stringify({ keys: [{ kid, kty: 'RSA', alg: 'RS256', use: 'sig', n, e }] });

const part = (value) => base64url(encoder.encode(JSON.stringify(value)));

// A token like the ones Access sends, good for ten minutes.
async function token(aud, address) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part({
    aud: [aud], email: address, exp: now + 600, iat: now, nbf: now, iss: ISSUER, type: 'app',
  })}`;
  return `${input}.${base64url(await crypto.subtle.sign(RSA, privateKey, encoder.encode(input)))}`;
}

// An admin session as the sign-in's code step opens one, issued now.
const adminSession = async () => signAdminSession(
  vars.SESSION_SIGNING_KEY, { accountId: adminAccount, version: adminVersion }, Math.floor(Date.now() / 1000),
);

// /coach and under it sit behind the coach application (#192).
const isCoachPath = (url) => url === '/coach' || url.startsWith('/coach/') || url.startsWith('/coach?');

const DROP = new Set(['connection', 'content-length', 'content-encoding', 'transfer-encoding', 'keep-alive']);

createServer(async (req, res) => {
  if (req.url === '/cdn-cgi/access/certs') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(certs);
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (!DROP.has(name) && name !== 'host') headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  if (isCoachPath(req.url)) {
    if (coaching) headers.set('Cf-Access-Jwt-Assertion', await token(vars.ACCESS_COACH_AUD, coachEmail));
  } else {
    // Beside whatever the browser holds, as a second cookie on the request.
    const held = headers.get('cookie');
    headers.set('cookie', `${held ? `${held}; ` : ''}${ADMIN_COOKIE}=${await adminSession()}`);
  }
  // The browser is on this stand-in's origin, and the site sees each request
  // arrive on its own. On production, Access sits on the site's own host, so
  // those are one origin. Say the same here, so a form the admin pages post
  // passes the site's Origin guard (#152). Any other Origin goes on as it
  // came, so the guard can still be seen refusing it.
  if (headers.get('origin') === ISSUER) headers.set('origin', new URL(SITE).origin);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const answer = await fetch(`${SITE}${req.url}`, {
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
  console.log(`Stand-in on ${ISSUER}, forwarding to ${SITE}: the admin pages as account ${adminAccount} (version ${adminVersion}).`);
  console.log(coaching
    ? `Signing in ${coachEmail} at /coach.`
    : '/coach is forwarded with no token: add ACCESS_TEAM_DOMAIN, ACCESS_COACH_AUD and COACH_EMAILS to .dev.vars to sign a coach in.');
  console.log(`Open ${ISSUER}/admin/ . Stop with Ctrl-C.`);
});
