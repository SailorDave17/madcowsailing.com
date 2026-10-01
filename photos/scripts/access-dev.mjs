#!/usr/bin/env node
/**
 * A local stand-in for Cloudflare Access, so the admin pages run under
 * wrangler pages dev with the real token check (#151, criterion 5).
 *
 *   node scripts/access-dev.mjs          then open http://127.0.0.1:8789/admin/
 *
 * 127.0.0.1, not localhost: it is the one origin passed on as the site's
 * (below), so from localhost:8789 every admin form is refused, 403 origin.
 *
 * Run from photos/, beside `npx --no-install wrangler pages dev` on its
 * default port, 8788. It does what Access does in front of the site, with a
 * key pair generated when it starts:
 *   - it publishes the public key at /cdn-cgi/access/certs, where the admin
 *     guard fetches a team's keys;
 *   - it forwards every other request to localhost:8788, adding a
 *     Cf-Access-Jwt-Assertion token signed RS256 with that key, for the first
 *     address in ADMIN_EMAILS, issued by this server, for ACCESS_AUD;
 *   - a request for /coach or under it (#192) gets a token for the first
 *     address in COACH_EMAILS, for ACCESS_COACH_AUD, as the coach
 *     application on photos.madcowsailing.com would send. Without those two
 *     lines it is forwarded with no token, and the coach guard answers 403.
 * So the guard in lib/access.js runs unchanged: it fetches these keys, checks
 * the signature, iss, aud, exp, nbf and the list, and refuses as it would on
 * production. There is no flag that turns the check off, here or anywhere.
 * It also passes this stand-in's own Origin on as the site's, as one host
 * would on production, so the admin pages' forms get past the Origin guard
 * (lib/origin.js). Any other Origin is left alone.
 *
 * It needs three lines in photos/.dev.vars (gitignored), which wrangler pages
 * dev reads in place of wrangler.jsonc's values for those names:
 *
 *   ACCESS_TEAM_DOMAIN=http://127.0.0.1:8789
 *   ACCESS_AUD=local
 *   ADMIN_EMAILS=<your address>
 *
 * and two more for /coach, which are optional:
 *
 *   ACCESS_COACH_AUD=local-coach
 *   COACH_EMAILS=<a coach's address>
 *
 * Requests straight to :8788 carry no token and get the guard's 403, which
 * is the other half worth seeing. The key lives only in this process, and
 * nothing is written to disk.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

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
const email = (vars.ADMIN_EMAILS ?? '').split(',')[0].trim();
const coachEmail = (vars.COACH_EMAILS ?? '').split(',')[0].trim();
const coaching = Boolean(vars.ACCESS_COACH_AUD && coachEmail);
if (vars.ACCESS_TEAM_DOMAIN !== ISSUER || !vars.ACCESS_AUD || !email) {
  console.error(`photos/.dev.vars needs these three lines, then restart wrangler pages dev:

  ACCESS_TEAM_DOMAIN=${ISSUER}
  ACCESS_AUD=local
  ADMIN_EMAILS=<your address>`);
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

// /coach and under it sit behind the coach application (#192); every other
// path gets the admin application's token, as before.
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
  if (!isCoachPath(req.url)) headers.set('Cf-Access-Jwt-Assertion', await token(vars.ACCESS_AUD, email));
  else if (coaching) headers.set('Cf-Access-Jwt-Assertion', await token(vars.ACCESS_COACH_AUD, coachEmail));
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
  console.log(`Access stand-in on ${ISSUER}: signing in ${email}, forwarding to ${SITE}.`);
  console.log(coaching
    ? `Signing in ${coachEmail} at /coach.`
    : '/coach is forwarded with no token: add ACCESS_COACH_AUD and COACH_EMAILS to .dev.vars to sign a coach in.');
  console.log(`Open ${ISSUER}/admin/ . Stop with Ctrl-C.`);
});
