/**
 * POST /api/admin/people/approve: Approve on /admin/people (#221). Approves
 * one account for the ticked teams, with the role chosen, then emails the
 * person a link to set a password. The guards in ../_middleware.js have
 * already required an admin's session and the site's own Origin.
 *
 * The press carries account=<id>, one or more team=<key> and role=<role>.
 * The approval is one transaction (lib/people.js, approveTeams); the email
 * follows it, and how the email went is reported beside the approval, never
 * instead of it, since the approval has already committed. 303 back to the
 * page, saying what happened.
 */
import { ROLES } from '../../../../lib/accounts.js';
import { readFormParams, seeOther } from '../../../../lib/form.js';
import { approveTeams, readAccountId, readTeams, sendLink } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';
import { siteOrigin } from '../../../../lib/site.js';

export async function onRequestPost({ request, env, data }) {
  const form = await readFormParams(request);
  const accountId = readAccountId(form.get('account'));
  const teams = readTeams(form.getAll('team'));
  const role = form.get('role');
  if (accountId === null || teams === null || !ROLES.includes(role)) return seeOther(peopleLocation({ error: 'form' }));

  const now = nowSeconds();
  const admin = data.admin.email;
  if (!(await approveTeams(env.DB, { accountId, teams, role, admin, now }))) return seeOther(peopleLocation({ error: 'gone' }));
  // sendLink never throws. Its null means the account held no approved team
  // by the time it looked, which only a delete by hand in between can cause;
  // the page says so rather than blaming Resend (#221's review).
  const mail = (await sendLink(env, { accountId, admin, now, site: siteOrigin(request, env) })) ?? 'not-approved';
  return seeOther(peopleLocation({ done: 'approved', account: accountId, mail }));
}

/**
 * GET changes nothing and goes back to the page, which says so. A press can
 * arrive as a GET (lib/admin-page.js says how, beside pressPath), and GET
 * needs no Origin.
 */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
