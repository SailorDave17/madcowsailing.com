#!/usr/bin/env node
/**
 * A local stand-in for Cloudflare Access, so the admin pages run under
 * wrangler pages dev with the real token check (#151, criterion 5).
 *
 *   node scripts/access-dev.mjs          then open http://localhost:8789/admin/
 *
 * Run from photos/, beside `npx --no-install wrangler pages dev` on its
 * default port, 8788. It does what Access does in front of the site, with a
 * key pair generated when it starts:
 *   - it publishes the public key at /cdn-cgi/access/certs, where the admin
 *     guard fetches a team's keys;
 *   - it forwards every other request to localhost:8788, adding a
 *     Cf-Access-Jwt-Assertion token signed RS256 with that key, for the first
 *     address in ADMIN_EMAILS, issued by this server, for ACCESS_AUD.
 * So the guard in lib/access.js runs unchanged: it fetches these keys, checks
 * the signature, iss, aud, exp, nbf and the list, and refuses as it would on
 * production. There is no flag that turns the check off, here or anywhere.
 *
 * It needs three lines in photos/.dev.vars (gitignored), which wrangler pages
 * dev reads in place of wrangler.jsonc's values for those names:
 *
 *   ACCESS_TEAM_DOMAIN=http://127.0.0.1:8789
 *   ACCESS_AUD=local
 *   ADMIN_EMAILS=<your address>
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
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const input = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part({
    aud: [vars.ACCESS_AUD], email, exp: now + 600, iat: now, nbf: now, iss: ISSUER, type: 'app',
  })}`;
  return `${input}.${base64url(await crypto.subtle.sign(RSA, privateKey, encoder.encode(input)))}`;
}

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
  headers.set('Cf-Access-Jwt-Assertion', await token());
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
  console.log(`Open ${ISSUER}/admin/ . Stop with Ctrl-C.`);
});
