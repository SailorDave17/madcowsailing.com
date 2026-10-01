// Cloudflare Access tokens minted in a test, with key pairs generated here
// (#151). Not a test file: npm test runs only *.test.js.
//
// An Access token is a JWT signed RS256 by the team's key, whose public half
// the team publishes at <team domain>/cdn-cgi/access/certs as a JWK with a
// kid. keyPair() makes one such pair; mint() signs any header and payload
// with any pair, so a test can build every token the admin guard must refuse.
import { base64url } from '../lib/crypto.js';

const encoder = new TextEncoder();
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

export const TEAM = 'https://testteam.cloudflareaccess.com';
export const AUD = 'a'.repeat(64);
export const OWNER = 'owner@example.com';
// The coaches' application and list (#192). Each differs from the admins',
// as on photos.madcowsailing.com, so a test can tell which one a guard read.
export const COACH_AUD = 'c'.repeat(64);
export const COACH = 'coach@example.com';

// The env both guards read, as the Pages config and secrets supply it.
export const accessEnv = (extra = {}) => ({
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ADMIN_EMAILS: OWNER,
  ACCESS_COACH_AUD: COACH_AUD,
  COACH_EMAILS: COACH,
  ...extra,
});

/** The claims of a coach's token that should pass at /coach. */
export const coachClaims = (overrides = {}) => claims({ aud: [COACH_AUD], email: COACH, ...overrides });

let kids = 0;

/** A signing pair, and its public half as the certs endpoint would list it. */
export async function keyPair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const { kty, n, e } = await crypto.subtle.exportKey('jwk', publicKey);
  const kid = `test-kid-${++kids}`;
  return { kid, privateKey, publicKey, jwk: { kid, kty, alg: 'RS256', use: 'sig', e, n } };
}

export const segment = (value) => base64url(encoder.encode(JSON.stringify(value)));

/** The claims of a token that should pass, issued now, for one hour. */
export function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: [AUD], email: OWNER, exp: now + 3600, iat: now, nbf: now, iss: TEAM,
    type: 'app', sub: 'test-sub', ...overrides,
  };
}

/**
 * A token over `payload`, signed RS256 by `pair` unless `sign` says otherwise.
 * `header` replaces the default header's fields; a field set to undefined is
 * left out.
 */
export async function mint(pair, payload = claims(), { header = {}, sign } = {}) {
  const head = JSON.parse(JSON.stringify({ alg: 'RS256', kid: pair.kid, typ: 'JWT', ...header }));
  const input = `${segment(head)}.${segment(payload)}`;
  const signature = sign
    ? await sign(input)
    : new Uint8Array(await crypto.subtle.sign(RSA, pair.privateKey, encoder.encode(input)));
  return `${input}.${base64url(signature)}`;
}

/** The public key as PEM text: what an HS256 key-confusion attack keys its HMAC with. */
export async function publicPem(pair) {
  const der = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  let binary = '';
  for (const byte of der) binary += String.fromCharCode(byte);
  return `-----BEGIN PUBLIC KEY-----\n${btoa(binary).match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Stands in for the team's certs endpoint: `t.mock.method(globalThis, 'fetch',
 * certs(() => [pair.jwk]))`. `keys` is a function so a test can publish a new
 * key mid-test, as a rotation does. Any other URL is an error, so a check that
 * fetched the wrong address fails loudly.
 */
export const certs = (keys, url = `${TEAM}/cdn-cgi/access/certs`) => async (input) => {
  const asked = typeof input === 'string' ? input : input.url;
  if (asked !== url) throw new Error(`fetched ${asked}, not the certs URL`);
  return Response.json({ keys: keys(), public_cert: {}, public_certs: [] });
};
