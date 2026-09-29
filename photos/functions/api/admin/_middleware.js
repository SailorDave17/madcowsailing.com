/**
 * Every admin API under /api/admin/ passes the same guards as the admin pages
 * (#151, #152): a valid Cloudflare Access token for the owner, or 403, and
 * then the site's own Origin on anything but GET and HEAD, or 403. The Access
 * application covers /api/admin/* as well as /admin, so the admin page's own
 * requests carry the token, and its forms carry the site's Origin.
 */
import { requireOwner } from '../../../lib/access.js';
import { requireSameOrigin } from '../../../lib/origin.js';

export const onRequest = [requireOwner, requireSameOrigin];
