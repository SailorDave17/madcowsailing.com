/**
 * GET /admin/people: the requests for an account, the people approved and
 * turned down, and the admins' log (#221). The guards in _middleware.js have
 * already checked the admin session.
 *
 * Each request has Approve and Turn down, which post to
 * functions/api/admin/people/approve.js and reject.js; each approved person
 * has "Send a new link", which posts to link.js. All three answer 303 back
 * here with ?done= or ?error= (lib/people-page.js, peopleNotice), and
 * lib/people.js holds the rules.
 *
 * Rendered here, never a static file (CLAUDE.md, The photo site, item 4).
 *
 * Each load also deletes the links to set a password whose 7 days are up
 * (lib/password-link.js), as the admin home deletes expired takedowns, so an
 * unused link's hash is kept no longer than the next visit here or the next
 * link made. A load with nothing expired writes nothing.
 */
import { adminLog, peopleLists } from '../../lib/people.js';
import { adminPeoplePage, peopleNotice } from '../../lib/people-page.js';
import { clearExpiredLinks } from '../../lib/password-link.js';
import { nowSeconds } from '../../lib/session.js';

export async function onRequestGet({ request, env, data }) {
  await clearExpiredLinks(env.DB, nowSeconds());
  const [lists, log] = await Promise.all([peopleLists(env.DB), adminLog(env.DB)]);
  const notice = peopleNotice(new URL(request.url).searchParams, lists);
  return new Response(adminPeoplePage({ lists, log, notice, viewer: data.admin }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Behind the admin guard, and it shows each person's address and note:
      // no cache may keep it.
      'Cache-Control': 'no-store',
    },
  });
}
