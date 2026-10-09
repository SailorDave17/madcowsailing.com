// The upload cookies the invite link and the coaches' sign-in set until
// #226, minted in a test. Not a test file: npm test runs only *.test.js.
//
// #226 deleted the code that signed and read them (lib/session.js kept only
// the cookie's name, to delete it), so a test that proves a once-valid
// parent's or coach's session now opens nothing has to make one itself, in
// the format the site used to accept:
//
//   __Host-upload=v1.<generation>.<issued>.<signature>   a parent's (#150)
//   __Host-upload=c1.<coach>.<issued>.<signature>        a coach's (#192)
//
// signature is HMAC-SHA256 of everything before it, keyed with
// SESSION_SIGNING_KEY, and <coach> is HMAC-SHA256 of "coach-address:" and the
// address, lowercased and trimmed, with the same key. Both base64url.
import { base64url, hmac } from '../lib/crypto.js';

export const UPLOAD_COOKIE = '__Host-upload';

const sign = async (secret, payload) => `${payload}.${base64url(await hmac(secret, payload))}`;

/** A parent's cookie value, as POST /api/join set it for `generation`. */
export const parentCookie = (secret, generation, issued) => sign(secret, `v1.${generation}.${issued}`);

/** A coach's cookie value, as GET /coach set it for `email`. */
export async function coachCookie(secret, email, issued) {
  const coach = base64url(await hmac(secret, `coach-address:${email.trim().toLowerCase()}`));
  return sign(secret, `c1.${coach}.${issued}`);
}

/** The Cookie header carrying `value` as the upload cookie. */
export const uploadCookieHeader = (value) => `${UPLOAD_COOKIE}=${value}`;
