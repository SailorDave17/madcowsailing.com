/**
 * POST /api/admin/people/demote: "Remove admin" on /admin/people (#224).
 * Takes the admin role from one admin. Only the owner may (criterion 4), and
 * never from the owner (criterion 3). The guards in ../_middleware.js have
 * already required an admin's session and the site's own Origin; this then
 * requires the owner's, and lib/people.js's demoteAdmin requires it again in
 * the statement that makes the change, with migration 0013's triggers under
 * both.
 *
 * The press carries account=<id>. The change and its log entry are one
 * transaction. The admin pages close to the person at their next request,
 * since the guard reads the role on every one (criterion 2). 303 back to the
 * page, saying what happened.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { demoteAdmin, readAccountId } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  if (data.admin.role !== 'owner') return seeOther(peopleLocation({ error: 'not-owner' }));
  const accountId = readAccountId((await readForm(request)).account);
  if (accountId === null) return seeOther(peopleLocation({ error: 'form' }));
  const demoted = await demoteAdmin(env.DB, { accountId, actorId: data.admin.id, admin: data.admin.email, now: nowSeconds() });
  if (!demoted) return seeOther(peopleLocation({ error: 'not-demoted' }));
  return seeOther(peopleLocation({ done: 'demoted', account: accountId }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
