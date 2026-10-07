/**
 * Every admin API under /api/admin/ passes the same guards as the admin pages
 * (#151, #152, and since #224 the admin session in place of the Access
 * token): an admin's session, or a 303 to /sign-in?admin, and then the site's
 * own Origin on anything but GET and HEAD, or 403. The admin pages' forms
 * post here from the site itself, carrying both.
 */
import { requireAdmin } from '../../../lib/admin-session.js';
import { requireSameOrigin } from '../../../lib/origin.js';

export const onRequest = [requireAdmin, requireSameOrigin];
