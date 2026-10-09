/**
 * The few cryptographic helpers the site's sessions, keyed hashes and links
 * need, on Web Crypto alone: the Workers runtime and Node 24 both have
 * crypto.subtle, and the site takes no library (CLAUDE.md, The photo site,
 * item 7). The account and admin sessions sign with hmac and check with
 * hmacVerify (lib/account-session.js, lib/admin-session.js), as the admin
 * sign-in's emailed code is kept and checked (lib/admin-code.js);
 * lib/address.js and lib/sign-in.js key their hashes with hmac; and
 * lib/password-link.js keeps a link's token as its sha256. Written for the
 * upload session (#150), which #226 retired, deleting timing.equal with
 * POST /api/join's code comparison, its only user.
 *
 * Nothing here logs, and nothing here puts a key or a value in an error.
 */

const encoder = new TextEncoder();

export function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function hmacKey(secret, usages) {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages,
  );
}

export async function hmac(secret, message) {
  const key = await hmacKey(secret, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export async function hmacVerify(secret, message, signature) {
  const key = await hmacKey(secret, ['verify']);
  // verify() compares in constant time, which a byte loop in JS cannot promise
  // once the engine optimises it.
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(message));
}

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}
