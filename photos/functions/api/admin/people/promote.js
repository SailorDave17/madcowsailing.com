/**
 * POST /api/admin/people/promote: "Make admin" on /admin/people (#224). Gives
 * one approved account the admin role. Any admin may press it (the owner's
 * choice at #224's pickup). The guards in ../_middleware.js have already
 * required an admin's session and the site's own Origin.
 *
 * The press carries account=<id>. The change and its log entry are one
 * transaction (lib/people.js, promoteAdmin), and nothing is emailed. The
 * change ends every session the account holds, so nothing from before it
 * opens the admin pages: the new admin opens them at their next sign-in,
 * which asks for the code (#224's review). 303 back to the page, saying what
 * happened.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { promoteAdmin, readAccountId } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const accountId = readAccountId((await readForm(request)).account);
  if (accountId === null) return seeOther(peopleLocation({ error: 'form' }));
  const promoted = await promoteAdmin(env.DB, { accountId, actorId: data.admin.id, admin: data.admin.email, now: nowSeconds() });
  if (!promoted) return seeOther(peopleLocation({ error: 'not-promoted' }));
  return seeOther(peopleLocation({ done: 'promoted', account: accountId }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
