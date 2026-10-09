/**
 * Every /admin page passes this guard first: no admin session, no page. Since
 * #224 that is an account holding the admin role, signed in with its
 * password and the code emailed for that sign-in, within the session's
 * length: 12 hours, or 30 days on a phone the admin asked the site to
 * remember (#274; lib/admin-session.js says what passes). It replaced #151's Cloudflare
 * Access token check. Then any method but GET and HEAD needs the site's own
 * Origin (#152, lib/origin.js), so a page elsewhere cannot post a form into
 * the admin area.
 *
 * Pages runs a directory's _middleware.js for /admin itself as well as for
 * everything under it, including a path no route answers. So an admin page
 * belongs under functions/admin/, where it cannot miss this file, and the API
 * it calls under functions/api/admin/, which runs the same guards.
 * test/guard.test.js fails for any admin route that answers without them.
 */
import { requireAdmin } from '../../lib/admin-session.js';
import { requireSameOrigin } from '../../lib/origin.js';

export const onRequest = [requireAdmin, requireSameOrigin];
