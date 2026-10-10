/**
 * Every route under /api/albums/ passes the upload guard (#153): the albums a
 * sender is offered are for an account approved for a team, and nobody else.
 * Until #226 they were also for whoever held the invite code, or a coach who
 * signed in at /coach (#192). lib/session.js says what a valid session is.
 *
 * Since #273 a sender also makes an event here (POST /api/albums), so any
 * write needs the site's own Origin, as every upload does (lib/origin.js):
 * a page elsewhere cannot post into an account's session with the cookie the
 * browser would attach. Reads, such as GET /api/albums/open, need none.
 *
 * test/guard.test.js calls every route here with no session, a tampered or
 * expired one, and an upload cookie from before #226, and fails for any that
 * answers other than 401. It holds every write here to 403 without the
 * site's Origin, as it holds every write in a guarded directory.
 */
import { requireSameOrigin } from '../../../lib/origin.js';
import { requireUploadSession } from '../../../lib/session.js';

export const onRequest = [requireUploadSession, requireSameOrigin];
