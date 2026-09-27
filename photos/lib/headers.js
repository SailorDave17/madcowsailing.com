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
