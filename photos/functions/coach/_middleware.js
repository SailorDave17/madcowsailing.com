/**
 * /coach and everything under it pass the coach guard first (#192): no valid
 * Cloudflare Access token for an address on COACH_EMAILS, signed for the
 * coaches' application, and the answer is 403 with no session set.
 * lib/access.js says what valid means; it is the admin guard's check (#151)
 * run against the coaches' list.
 *
 * Pages runs a directory's _middleware.js for /coach itself as well as for
 * everything under it, so a later coach page belongs under functions/coach/,
 * where it cannot miss this file. test/guard.test.js fails for any coach route
 * that answers without it.
 */
import { requireCoach } from '../../lib/access.js';

export const onRequest = [requireCoach];
