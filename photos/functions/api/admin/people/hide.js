/**
 * POST /api/admin/people/hide: "Hide all their photos" on /admin/people
 * (#225, criterion 4; D17). Hides every photo one account sent, waiting or
 * public, through #158's removal mechanism, so each waits on
 * /admin/removals to be put back or deleted. The guards in ../_middleware.js
 * have already required an admin's session and the site's own Origin.
 *
 * The press carries account=<id> and confirm=hide, the box naming the count,
 * which must be ticked (the owner's choice at #225's pickup): a press without
 * it changes nothing, so a mis-press cannot take a set of photos down. Any
 * admin may press it, for any account. 303 back to the page with the counts.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { hidePhotos, readAccountId } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const form = await readForm(request);
  const accountId = readAccountId(form.account);
  if (accountId === null) return seeOther(peopleLocation({ error: 'form' }));
  if (form.confirm !== 'hide') return seeOther(peopleLocation({ error: 'hide-unticked', account: accountId }));

  const hidden = await hidePhotos(env.DB, { accountId, admin: data.admin.email, now: nowSeconds() });
  if (!hidden) return seeOther(peopleLocation({ error: 'not-hidden', account: accountId }));
  return seeOther(peopleLocation({ done: 'hidden', account: accountId, hidden: hidden.hidden, waiting: hidden.waiting }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
