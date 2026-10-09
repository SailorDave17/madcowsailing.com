/**
 * The address the site's emails link to: the link to set a password and the
 * reset link (lib/people.js, lib/reset.js), the admin's sign-in code email,
 * and the admins' email about a request for an account (lib/accounts.js).
 *
 * Production's is the site's own domain. Any other environment's is wherever
 * the request arrived (a preview, or localhost), so a link sent from there
 * opens that environment.
 *
 * Both lived in lib/invite.js, beside the invite code, until #226 retired the
 * invite link and moved them here, siteOrigin renamed from inviteSite.
 */

export const PRODUCTION_SITE = 'https://photos.madcowsailing.com';

export function siteOrigin(request, env) {
  return env.SITE_ENV === 'production' ? PRODUCTION_SITE : new URL(request.url).origin;
}
