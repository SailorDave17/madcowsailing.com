/**
 * POST /api/albums: an approved sender makes an event for their team, from
 * the share page's "Create a new event" (#273). CLAUDE.md, The photo site,
 * item 34 has the decisions; lib/albums.js, createEvent, the rules.
 *
 * The directory's guard runs first (_middleware.js): no live account session
 * is 401, and a post without the site's own Origin is 403 {"error":"origin"}.
 * The page sends JSON:
 *
 *   title  the event's name: 1 to 80 characters on one line (TITLE_MAX), as
 *          an admin's album takes
 *   kind   regatta or practice
 *   date   the day it is held, YYYY-MM-DD, from EVENT_DAYS_BACK days before
 *          the phone's today through EVENT_DAYS_AHEAD after (the server takes
 *          one day more each way, for the phone's zone)
 *   team   one of the teams the account is approved for; left out when it is
 *          approved for only one, which is then the team
 *
 * The answers, each JSON with Cache-Control: no-store:
 *
 *   201 {"address": a}           made, at that address, open, and offered at
 *                                once to every account approved for its team
 *                                (GET /api/albums/open)
 *   400 {"error": "form"}        not a JSON object
 *   400 {"error": "team" | "title" | "kind" | "date"}   that field is wrong,
 *                                the first in the order the form shows them
 *   403 {"error": "team"}        a team the account is not approved for, now
 *                                or by the time the event is written
 *   409 {"error": "full"}        every address the date and title can take is
 *                                held: a different title makes one
 *   413 {"error": "too-large"}   a body over 4 KiB
 *   429 {"error": "events"}      the account has made EVENTS_A_DAY events this
 *                                UTC day that still exist, with Retry-After to
 *                                the next UTC day
 *   503 {"error": "unavailable"} the database did not answer: nothing made
 *
 * The event's address is made from its date and title as an admin's is, and
 * stays provisional until an admin first approves a photo or clip in it,
 * which makes it again from the date and title then (lib/albums.js). It is
 * public only from then on, once a photo is approved, as every album is
 * (#227). Nothing here logs the title. The JSON helpers are the clip start's
 * (lib/clips.js), the one other route the share page posts JSON to.
 */
import { createEvent, readEventFields } from '../../../lib/albums.js';
import { answer, readJson, unavailable } from '../../../lib/clips.js';
import { secondsToNextDay } from '../../../lib/photos.js';
import { nowSeconds } from '../../../lib/session.js';

// A title of 80 characters, each up to 4 bytes, and three short fields fit
// many times over.
const EVENT_MAX_BYTES = 4 * 1024;

export async function onRequestPost({ request, env, data }) {
  const { DB } = env;
  if (!DB) {
    console.error('albums: the database is not bound, so making an event is closed');
    return unavailable();
  }
  const { session } = data;
  const read = await readJson(request, EVENT_MAX_BYTES);
  if (read.refusal) return read.refusal;

  const now = nowSeconds();
  const { event, error } = readEventFields(read.fields, session.teams, now);
  if (error) return answer(400, { error });
  // The guard read the account's teams on this request. createEvent checks
  // the team again in the statement that writes the event.
  if (!session.teams.includes(event.team)) return answer(403, { error: 'team' });

  let made;
  try {
    made = await createEvent(DB, event, session.accountId, now);
  } catch (err) {
    console.error('albums: database did not answer:', err instanceof Error ? err.message : String(err));
    return unavailable();
  }
  if (made.address) return answer(201, { address: made.address });
  if (made.refused === 'team') return answer(403, { error: 'team' });
  if (made.refused === 'cap') {
    return answer(429, { error: 'events' }, { 'Retry-After': String(secondsToNextDay(now)) });
  }
  return answer(409, { error: 'full' });
}
