/**
 * Every route under /api/upload/ passes this guard first (#150): no valid
 * upload session, no upload. lib/session.js says what valid means.
 *
 * Then any write needs the site's own Origin (#154), as every admin write
 * does (#152), so a page elsewhere cannot post into a parent's session with
 * the cookie the browser would attach. Reads, such as GET /api/upload/session,
 * need none. lib/origin.js says why.
 *
 * A route that uploads anything belongs under functions/api/upload/, where
 * it cannot miss this file. test/guard.test.js calls every Function route
 * that is not declared public with a missing, tampered, earlier-generation
 * and expired cookie, and fails for any that answers other than 401. It holds
 * every upload write to 403 without the site's Origin.
 */
import { requireSameOrigin } from '../../../lib/origin.js';
import { requireUploadSession } from '../../../lib/session.js';

export const onRequest = [requireUploadSession, requireSameOrigin];
