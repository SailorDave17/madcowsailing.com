/**
 * Every route under /api/albums/ passes the upload guard (#153): the albums a
 * sender is offered are for an account approved for a team, and nobody else.
 * Until #226 they were also for whoever held the invite code, or a coach who
 * signed in at /coach (#192). lib/session.js says what a valid session is.
 *
 * test/guard.test.js calls every route here with no session, a tampered or
 * expired one, and an upload cookie from before #226, and fails for any that
 * answers other than 401.
 */
import { requireUploadSession } from '../../../lib/session.js';

export const onRequest = requireUploadSession;
