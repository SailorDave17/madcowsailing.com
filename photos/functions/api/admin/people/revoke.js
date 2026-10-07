/**
 * POST /api/admin/people/revoke: Revoke on /admin/people (#225). Revokes one
 * account for the ticked teams it is approved for; ticking every one revokes
 * the account. The guards in ../_middleware.js have already required an
 * admin's session and the site's own Origin.
 *
 * The press carries account=<id> and one or more team=<key>. The revoke is
 * one transaction (lib/people.js, revokeTeams): the log entries, the
 * address's keyed hash, the session version up by 1, which ends every session
 * the account holds at its next request, and the teams' change. An account
 * holding the admin role is refused: the owner removes the role first (the
 * owner's choice at #225's pickup). Nothing is emailed, and the photos the
 * account sent are left as they are. 303 back to the page, saying what
 * happened.
 */
import { readFormParams, seeOther } from '../../../../lib/form.js';
import { readAccountId, readTeams, revokeTeams } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const form = await readFormParams(request);
  const accountId = readAccountId(form.get('account'));
  const teams = readTeams(form.getAll('team'));
  if (accountId === null || teams === null) return seeOther(peopleLocation({ error: 'form' }));
  // The address's hash needs the key, so without it nothing is revoked: a
  // revoke that kept no hash would let the address ask again after a delete.
  if (!env.ADDRESS_HASH_KEY) {
    console.error('people: ADDRESS_HASH_KEY is not configured, so nothing was revoked');
    return seeOther(peopleLocation({ error: 'unconfigured' }));
  }

  const revoked = await revokeTeams(env.DB, { accountId, teams, hashKey: env.ADDRESS_HASH_KEY, admin: data.admin.email, now: nowSeconds() });
  if (!revoked) return seeOther(peopleLocation({ error: 'not-revoked' }));
  return seeOther(peopleLocation({ done: 'revoked', account: accountId }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
