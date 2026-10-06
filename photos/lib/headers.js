/**
 * The headers every response from photos.madcowsailing.com carries.
 *
 * There are two copies, on purpose. public/_headers applies them to the static
 * files, and Pages never applies that file to a Function's response
 * (Cloudflare's "Headers" page, read 2026-09-26). So functions/_middleware.js
 * sets this object on everything a Function answers, including the 404 a
 * Function route falls through to. test/headers.test.mjs holds the two equal:
 * change one and it fails until the other matches.
 *
 * public/_headers says what each header is for.
 */
export const SITE_HEADERS = Object.freeze({
  'X-Robots-Tag': 'noindex',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; " +
    "connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
});

// Turnstile's origin (#220): its script, and the frame the challenge runs in.
// Turnstile's Content Security Policy page lists exactly two values to add,
// "script-src: https://challenges.cloudflare.com" and "frame-src:
// https://challenges.cloudflare.com" (read 2026-10-05).
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

// The paths whose pages load Turnstile: the request form (#220) and, since
// #222, the reset form (the owner's choice at #222's pickup, 2026-10-06: a
// reset spends Resend's emails). Each is a Function, so _headers never
// reaches it, and every other path keeps the site's CSP: no other page gets a
// third party's script. The sign-in form has no Turnstile.
export const TURNSTILE_PATHS = Object.freeze(['/ask', '/forgot-password']);

// The site's CSP with Turnstile's origin added to script-src, and frame-src
// naming it alone. test/headers.test.js holds every other directive equal to
// the site's.
export const TURNSTILE_CSP =
  `default-src 'self'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; ` +
  "style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** The headers for a Function's answer at `pathname`. */
export function headersFor(pathname) {
  return TURNSTILE_PATHS.includes(pathname)
    ? { ...SITE_HEADERS, 'Content-Security-Policy': TURNSTILE_CSP }
    : SITE_HEADERS;
}
