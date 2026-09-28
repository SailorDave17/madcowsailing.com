/**
 * The keyed hash a rate limit stores instead of a visitor's network address.
 *
 * The address itself is never written anywhere. Only its HMAC-SHA256 is, keyed
 * with the ADDRESS_HASH_KEY Pages secret, and the rows holding it expire. A
 * plain hash would not do: there are only about four billion IPv4 addresses,
 * so an unkeyed hash of one is reversed by trying them all.
 *
 * An IPv6 address is counted by its /64, the block one household or phone is
 * normally given. Counting each full address would let one phone step past
 * any limit by changing its last 64 bits, which it may do freely.
 *
 * #150 (the join limit) and #158 (removal requests) use this.
 */
import { base64url, hmac } from './crypto.js';

/** The part of an address a limit counts: IPv4 whole, IPv6 by its /64. */
export function addressBlock(ip) {
  if (typeof ip !== 'string' || ip === '') return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(missing, 0)).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':');
}

/** The stored form of the address a request came from. */
export async function addressHash(secret, request) {
  const block = addressBlock(request.headers.get('CF-Connecting-IP'));
  return base64url(await hmac(secret, block));
}
