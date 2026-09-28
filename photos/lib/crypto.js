/**
 * The few cryptographic helpers the upload session needs, on Web Crypto
 * alone: the Workers runtime and Node 24 both have crypto.subtle, and the
 * site takes no library (CLAUDE.md, The photo site, item 7).
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

/**
 * Whether two byte arrays of the same length are equal, reading every byte of
 * both whatever the first difference: no early exit, so the time taken says
 * nothing about where they differ. Held on an object so a test can watch it
 * being called.
 */
export const timing = {
  equal(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  },
};
