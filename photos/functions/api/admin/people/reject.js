/**
 * POST /api/admin/people/reject: Turn down on /admin/people (#221), for the
 * ticked teams still waiting. Sends nothing (the owner's choice at #221's
 * pickup). The guards in ../_middleware.js have already required an admin's
 * Access token and the site's own Origin.
 *
 * The press carries account=<id> and one or more team=<key>; the role field
 * rides along in the same form and is ignored. 303 back to the page, saying
 * what happened.
 */
import { readFormParams, seeOther } from '../../../../lib/form.js';
import { readAccountId, readTeams, rejectTeams } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const form = await readFormParams(request);
  const accountId = readAccountId(form.get('account'));
  const teams = readTeams(form.getAll('team'));
  if (accountId === null || teams === null) return seeOther(peopleLocation({ error: 'form' }));

  const rejected = await rejectTeams(env.DB, { accountId, teams, admin: data.owner.email, now: nowSeconds() });
  if (!rejected) return seeOther(peopleLocation({ error: 'gone' }));
  return seeOther(peopleLocation({ done: 'rejected', account: accountId }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
