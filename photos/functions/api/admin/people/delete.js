/**
 * POST /api/admin/people/delete: "Delete the account" on /admin/people (#225,
 * criterion 7). Deletes one account a person asked by email to have deleted.
 * The guards in ../_middleware.js have already required an admin's session
 * and the site's own Origin.
 *
 * The press carries account=<id> and replied=yes, the box saying a reply from
 * the account's own address confirmed the request, which must be ticked (the
 * owner's choice at #225's pickup, 2026-10-07): the site cannot read that
 * reply itself, so the admin's word stands for it, as README's delete by hand
 * asks the same of whoever runs it (owner, at #219's review, 2026-10-05).
 * An account holding the admin role is refused: the owner removes the role
 * first. The delete and its log entry are one transaction (lib/people.js,
 * deleteAccount). 303 back to the page, saying what happened.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { deleteAccount, readAccountId } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const form = await readForm(request);
  const accountId = readAccountId(form.account);
  if (accountId === null) return seeOther(peopleLocation({ error: 'form' }));
  if (form.replied !== 'yes') return seeOther(peopleLocation({ error: 'delete-unticked', account: accountId }));

  if (!(await deleteAccount(env.DB, { accountId, admin: data.admin.email, now: nowSeconds() }))) {
    return seeOther(peopleLocation({ error: 'not-deleted', account: accountId }));
  }
  return seeOther(peopleLocation({ done: 'deleted' }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
