/**
 * POST /api/admin/people/link: "Send a new link" on /admin/people (#221,
 * criterion 4). Emails an approved person a new link to set a password, which
 * replaces their last one. One press, no confirmation: it changes nothing but
 * which link works. The guards in ../_middleware.js have already required an
 * admin's session and the site's own Origin.
 *
 * The press carries account=<id>. 303 back to the page, saying how the email
 * went, or that the account holds no approved team.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { inviteSite } from '../../../../lib/invite.js';
import { readAccountId, sendLink } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const accountId = readAccountId((await readForm(request)).account);
  if (accountId === null) return seeOther(peopleLocation({ error: 'form' }));
  const mail = await sendLink(env, { accountId, admin: data.admin.email, now: nowSeconds(), site: inviteSite(request, env) });
  if (mail === null) return seeOther(peopleLocation({ error: 'not-approved' }));
  return seeOther(peopleLocation({ done: 'link', account: accountId, mail }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
