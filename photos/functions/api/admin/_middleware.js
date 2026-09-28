/**
 * Every admin API under /api/admin/ passes the same guard as the admin pages
 * (#151): a valid Cloudflare Access token for the owner, or 403. The Access
 * application covers /api/admin/* as well as /admin, so the admin page's own
 * requests carry the token.
 */
import { requireOwner } from '../../../lib/access.js';

export const onRequest = requireOwner;
