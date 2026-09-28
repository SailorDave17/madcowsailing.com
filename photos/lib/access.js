/**
 * The admin guard (#151): every /admin page and admin API answers only to a
 * request carrying a valid Cloudflare Access token for an email on the
 * admins' list, whichever hostname it arrived on.
 *
 * Access sits in front of /admin on photos.madcowsailing.com, and it signs
 * every request it lets through with a token in the Cf-Access-Jwt-Assertion
 * header. But Access applies per hostname: the project's *.pages.dev address
 * cannot be switched off and is not behind it (CLAUDE.md, The photo site,
 * item 1). So this check, not the Access sign-in, is the lock. Access's own
 * docs recommend the header over the CF_Authorization cookie, which is not
 * always passed, so the cookie is never read.
 *
 * A token passes only if all of these hold:
 *   - it parses as a JWT whose header says alg RS256 and names a kid;
 *   - that kid is one of the team's published keys, and its RS256 signature
 *     verifies. The algorithm is pinned here, never taken from the header;
 *   - iss is the team domain, and aud holds the application's tag;
 *   - exp is a number and has not passed; nbf is a number and has, allowing
 *     CLOCK_SKEW_SECONDS for drift between Cloudflare's machines;
 *   - email is on ADMIN_EMAILS, compared without regard to letter case.
 * Anything else answers 403. Keys that cannot be fetched answer 503. Nothing
 * here throws on a bad token: a malformed one is a 403, never a 500.
 *
 * Config, never code (renaming the Zero Trust team changes both the issuer
 * and the key URL):
 *   ACCESS_TEAM_DOMAIN  https://<team>.cloudflareaccess.com, in wrangler.jsonc
 *   ACCESS_AUD          the Access application's AUD tag, in wrangler.jsonc
 *   ADMIN_EMAILS        comma-separated; a Pages secret, so the addresses are
 *                       not in this public repo (owner's choice, 2026-09-28)
 * With any of them unset, every request is refused. There is no flag, header,
 * cookie or hostname that turns the check off (test/access.test.js tries each);
 * local development runs it against generated keys (scripts/access-dev.mjs).
 *
 * Nothing here logs a token, a claim or an address.
 */
import { fromBase64url } from './crypto.js';

export const TOKEN_HEADER = 'Cf-Access-Jwt-Assertion';

// Access rotates its signing key every 6 weeks, and the previous key stays
// valid for 7 days, so keys are fetched by kid and cached, never written down.
// A cached set is used for an hour, then fetched again.
export const KEYS_MAX_AGE_SECONDS = 60 * 60;

// The keys are fetched at most once a minute, whether the last attempt worked
// or failed, and requests arriving while a fetch is in flight wait for that
// one. Without the gap, a stream of made-up kids, or a certs outage, would
// make every request fetch the keys. The cost: a token signed by a key
// published less than a minute after the last fetch is refused until the
// minute is up, and a failed fetch answers 503 for the rest of its minute.
export const REFETCH_GAP_SECONDS = 60;

// How far ahead of this machine's clock a token's nbf may be. exp gets none.
export const CLOCK_SKEW_SECONDS = 60;

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * The team's keys by certs URL: { keys: Map<kid, CryptoKey>, fetchedAt,
 * attemptedAt, failed, pending }. fetchedAt is the last fetch that worked,
 * attemptedAt the last one started, and pending the one in flight. Held per
 * isolate, so each fresh isolate fetches once, however many requests arrive
 * together. Exported so a test can empty it.
 */
export const keyCache = new Map();

class KeysUnavailable extends Error {}

async function fetchKeys(url) {
  let listed;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new KeysUnavailable(`certs answered ${response.status}`);
    listed = (await response.json()).keys;
  } catch (err) {
    if (err instanceof KeysUnavailable) throw err;
    throw new KeysUnavailable(err instanceof Error ? err.message : String(err));
  }
  if (!Array.isArray(listed)) throw new KeysUnavailable('certs listed no keys');
  const keys = new Map();
  for (const jwk of listed) {
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
    try {
      // Only the modulus and exponent: a published field such as key_ops
      // cannot then widen or narrow what the imported key is for.
      keys.set(jwk.kid, await crypto.subtle.importKey(
        'jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, RSA, false, ['verify'],
      ));
    } catch {
      // A key that does not import verifies nothing; the others still serve.
    }
  }
  return keys;
}

async function keyFor(url, kid, now) {
  let entry = keyCache.get(url);
  if (!entry) {
    entry = { keys: new Map(), fetchedAt: -Infinity, attemptedAt: -Infinity, failed: false, pending: null };
    keyCache.set(url, entry);
  }
  if (now - entry.fetchedAt < KEYS_MAX_AGE_SECONDS && entry.keys.has(kid)) return entry.keys.get(kid);
  if (!entry.pending) {
    if (now - entry.attemptedAt < REFETCH_GAP_SECONDS) {
      // Fetched, or tried, moments ago: a set that lacks this kid will lack
      // it again, and a fetch that failed is not retried until the minute is up.
      if (entry.failed) throw new KeysUnavailable('the last fetch failed less than a minute ago');
      return null;
    }
    entry.attemptedAt = now;
    entry.pending = fetchKeys(url).then(
      (keys) => { entry.keys = keys; entry.fetchedAt = now; entry.failed = false; },
      // A failure keeps the keys it had: they stay good until their hour is up,
      // so a made-up kid during an outage cannot lock out a known one.
      (err) => { entry.failed = true; throw err; },
    ).finally(() => { entry.pending = null; });
  }
  await entry.pending;
  return entry.keys.get(kid) ?? null;
}

// A JWT's three parts, decoded, or null for anything that is not one.
function parse(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return null;
  try {
    const header = JSON.parse(decoder.decode(fromBase64url(parts[0])));
    const claims = JSON.parse(decoder.decode(fromBase64url(parts[1])));
    const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!isObject(header) || !isObject(claims)) return null;
    return {
      header,
      claims,
      signed: encoder.encode(`${parts[0]}.${parts[1]}`),
      signature: fromBase64url(parts[2]),
    };
  } catch {
    return null;
  }
}

const allowList = (value) =>
  (value ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/**
 * The owner a token names, as { email }, or null when the token does not
 * pass. Throws KeysUnavailable only when the team's keys cannot be read.
 */
export async function verifyAccessToken(token, env, now = nowSeconds()) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  const allowed = allowList(env.ADMIN_EMAILS);
  if (!team || !aud || allowed.length === 0 || !token) return null;

  const jwt = parse(token);
  if (!jwt) return null;
  const { header, claims } = jwt;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;

  const key = await keyFor(`${team}/cdn-cgi/access/certs`, header.kid, now);
  if (!key) return null;
  let verified;
  try {
    verified = await crypto.subtle.verify(RSA, key, jwt.signature, jwt.signed);
  } catch {
    // A signature of the wrong length is false in Node; a runtime may throw.
    verified = false;
  }
  if (!verified) return null;

  if (claims.iss !== team) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) return null;
  if (typeof claims.exp !== 'number' || now >= claims.exp) return null;
  if (typeof claims.nbf !== 'number' || claims.nbf > now + CLOCK_SKEW_SECONDS) return null;
  if (typeof claims.email !== 'string') return null;
  const email = claims.email.trim().toLowerCase();
  if (!allowed.includes(email)) return null;
  return { email };
}

const refuse = (status, error) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * The one admin guard. functions/admin/_middleware.js and
 * functions/api/admin/_middleware.js run it in front of every admin route,
 * and test/guard.test.js fails for any admin route that answers without it.
 * On success the owner is on context.data.owner.
 */
export async function requireOwner(context) {
  const { request, env } = context;
  let owner;
  try {
    owner = await verifyAccessToken(request.headers.get(TOKEN_HEADER), env);
  } catch (err) {
    if (!(err instanceof KeysUnavailable)) throw err;
    // Fail closed: a token that cannot be checked opens nothing.
    console.error('admin guard: the Access signing certs could not be read:', err.message);
    return refuse(503, 'unavailable');
  }
  if (!owner) return refuse(403, 'forbidden');
  context.data.owner = owner;
  return context.next();
}
