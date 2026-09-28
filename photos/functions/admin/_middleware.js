/**
 * Every /admin page passes this guard first (#151): no valid Cloudflare
 * Access token for the owner, no page. lib/access.js says what valid means.
 *
 * Pages runs a directory's _middleware.js for /admin itself as well as for
 * everything under it, including a path no route answers. So an admin page
 * belongs under functions/admin/, where it cannot miss this file, and the API
 * it calls under functions/api/admin/, which runs the same guard.
 * test/guard.test.js fails for any admin route that answers without it.
 */
import { requireOwner } from '../../lib/access.js';

export const onRequest = requireOwner;
