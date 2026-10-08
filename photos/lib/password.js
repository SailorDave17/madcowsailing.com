/**
 * Password hashing for accounts (epic #216, D14; #218): scrypt, from the
 * runtime's own node:crypto, at OWASP's N=2^14, r=8, p=5.
 *
 * CLAUDE.md, The photo site, item 23 says why scrypt and why these numbers,
 * with the sources. In short: Argon2id is OWASP's first choice, and Workers
 * does not have it. PBKDF2 is in Web Crypto, but the runtime refuses more than
 * 100,000 iterations, and OWASP asks 600,000 for PBKDF2-HMAC-SHA256. scrypt is
 * OWASP's choice when Argon2id is not available, and node:crypto carries it in
 * Workers as in Node 24. That is the runtime, not a library (item 7).
 *
 * A stored hash is a PHC string, `$scrypt$ln=14,r=8,p=5$<salt>$<hash>`, with
 * the salt and hash in unpadded base64. It names its own parameters, so
 * raising SCRYPT later leaves every older hash verifiable: verifyPassword()
 * reads them from the string, never from SCRYPT.
 *
 * Nothing here logs, and no password, salt or hash goes into an error.
 */
import { scrypt, timingSafeEqual } from 'node:crypto';

/** OWASP's fourth scrypt row: 16 MiB per hash. Item 23 says why this row. */
export const SCRYPT = Object.freeze({ N: 2 ** 14, r: 8, p: 5 });
export const SALT_BYTES = 16;
export const HASH_BYTES = 32;

// The Workers runtime refuses scrypt when N·r·p exceeds 2^20 (workerd's
// limit-enforcer.h, DEFAULT_MAX_SCRYPT_COST). scrypt's memory is its table of
// N blocks plus one block per lane, 128·r·(N + p + 2) bytes as OpenSSL counts
// it (BoringSSL counts one block fewer). A stored hash past either bound is
// refused unread, so a damaged row cannot make a sign-in allocate or spin.
export const MAX_COST = 2 ** 20;
export const MAX_MEMORY = 32 * 1024 * 1024;
// What scrypt is allowed to allocate: twice MAX_MEMORY, so its own accounting
// never refuses a set the bound above let through.
const MAXMEM = 2 * MAX_MEMORY;

const encoder = new TextEncoder();
const PHC = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;

/** scrypt of `password` (a string, read as UTF-8, or bytes) with `salt`. */
export function derive(password, salt, { N, r, p }, length = HASH_BYTES) {
  const bytes = typeof password === 'string' ? encoder.encode(password) : password;
  return new Promise((resolve, reject) => {
    scrypt(bytes, salt, length, { N, r, p, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(new Uint8Array(key));
    });
  });
}

/** The parameter segment of a PHC string, `ln=14,r=8,p=5` for SCRYPT. */
export function phcParams({ N, r, p }) {
  return `ln=${Math.log2(N)},r=${r},p=${p}`;
}

/** A new PHC string for `password`, with a fresh random salt. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, SCRYPT);
  return `$scrypt$${phcParams(SCRYPT)}$${b64(salt)}$${b64(hash)}`;
}

/**
 * True when `password` is the one `stored` was made from. False for a wrong
 * password, and for anything that is not a hash this module could have
 * written, so a damaged row reads as a failed sign-in. An error from the
 * runtime itself still throws: an outage must not pass for a wrong password.
 */
export async function verifyPassword(password, stored) {
  const m = typeof stored === 'string' ? PHC.exec(stored) : null;
  if (!m) return false;
  const [ln, r, p] = [m[1], m[2], m[3]].map(Number);
  if (ln < 1 || r < 1 || p < 1) return false;
  // scrypt itself refuses N of 2^(16r) or more (RFC 7914), with an error that
  // on workerd carries no code, so that rule is checked here too.
  if (ln >= 16 * r) return false;
  const N = 2 ** ln;
  if (N * r * p > MAX_COST || 128 * r * (N + p + 2) > MAX_MEMORY) return false;
  const expected = fromB64(m[5]);
  const actual = await derive(password, fromB64(m[4]), { N, r, p }, expected.length);
  // A byte loop can stop at the first difference once the engine optimises
  // it; timingSafeEqual cannot.
  return timingSafeEqual(actual, expected);
}

function b64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
}

function fromB64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
