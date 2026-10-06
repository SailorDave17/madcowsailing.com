/**
 * Cloudflare Turnstile, checked on the server (#220, criterion 2): the one
 * thing between the open web and a stored request for an account.
 *
 * The widget on /ask puts its token in the form as `cf-turnstile-response`.
 * The token proves nothing until the server sends it to siteverify with the
 * widget's secret: Turnstile's "Validate the token" page says tokens "can be
 * forged", expire after 300 seconds and are single-use, and that "the
 * client-side widget alone does not protect your forms" (read 2026-10-05).
 * One POST with fetch and no library, as lib/mail.js sends to Resend.
 *
 * verifyTurnstile() answers one of three words and never throws:
 *
 *   passed       siteverify said success
 *   refused      no token, one too long to be a token, or siteverify said
 *                it is not a valid one: forged, expired, already used
 *   unavailable  the check could not be made: no secret here, siteverify
 *                did not answer within TIMEOUT_MS or answered with an error,
 *                its own internal error, or a secret it does not accept
 *
 * Only `success` decides. Hostname and action are not checked: the secret
 * belongs to one widget, whose hostnames are this site's, and Cloudflare's
 * always-pass test secret answers "example.com" and no action (measured
 * 2026-10-05), so either check would refuse every local run. One check rides
 * on top in production: a response marked `result_with_testing_key` is
 * unavailable, not passed, because a test secret there by mistake would pass
 * every request, token or none.
 *
 * What it logs is the reason and siteverify's error codes, and nothing else:
 * never the token, the secret or the network address.
 */
import { USER_AGENT } from './mail.js';

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// The form field the widget fills: Turnstile's own default name.
export const TOKEN_FIELD = 'cf-turnstile-response';

// "Maximum length: 2048 characters" (the same page).
export const TOKEN_MAX = 2048;

// A request waits this long at most for siteverify, as a send waits for
// Resend (lib/mail.js).
export const TIMEOUT_MS = 10_000;

// siteverify's error codes, and which are the token's fault. The rest
// (internal-error, and the secret's missing-input-secret and
// invalid-input-secret) are the check's fault, and fail closed as
// unavailable. An unlisted code is unavailable too, so a code Cloudflare adds
// later can never pass a request.
const TOKEN_ERRORS = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate', 'bad-request']);

// Only error codes shaped like Cloudflare's are logged as they came.
const loggable = (list) =>
  (Array.isArray(list) ? list : []).map((item) => (typeof item === 'string' && /^[a-z-]{1,64}$/.test(item) ? item : 'unknown'));

/**
 * Ask siteverify whether `token` is a valid one, from the network address
 * `remoteip` (CF-Connecting-IP; sent along, as Turnstile's examples send it).
 */
export async function verifyTurnstile(env, token, remoteip) {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error('turnstile: TURNSTILE_SECRET_KEY is not configured, so no request can be checked');
    return 'unavailable';
  }
  if (typeof token !== 'string' || token === '' || token.length > TOKEN_MAX) return 'refused';

  const body = { secret: env.TURNSTILE_SECRET_KEY, response: token };
  if (typeof remoteip === 'string' && remoteip !== '') body.remoteip = remoteip;
  let res;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The name only (TimeoutError, TypeError): a network error's message can
    // carry the request it failed on.
    console.error('turnstile: siteverify did not answer:', err instanceof Error ? err.name : 'unknown');
    return 'unavailable';
  }
  if (!res.ok) {
    console.error('turnstile: siteverify answered', res.status);
    return 'unavailable';
  }
  let result;
  try {
    result = await res.json();
  } catch {
    console.error('turnstile: siteverify answered with something that is not JSON');
    return 'unavailable';
  }
  if (result === null || typeof result !== 'object') {
    console.error('turnstile: siteverify answered with something that is not a result');
    return 'unavailable';
  }

  if (result.success === true) {
    if (env.SITE_ENV === 'production' && result.metadata?.result_with_testing_key === true) {
      // Double-quoted: test/logging.test.js's scanner ends a string at its
      // next quote mark, escaped or not.
      console.error("turnstile: production's secret is one of Cloudflare's test keys, so no request is taken");
      return 'unavailable';
    }
    return 'passed';
  }
  // Named reasons, not codes: test/logging.test.js keeps "codes" for the
  // invite code's, which no log line may hold.
  const reasons = loggable(result['error-codes']);
  if (reasons.length > 0 && reasons.every((reason) => TOKEN_ERRORS.has(reason))) return 'refused';
  console.error('turnstile: siteverify could not check a token:', reasons.join(', ') || 'no error code');
  return 'unavailable';
}
