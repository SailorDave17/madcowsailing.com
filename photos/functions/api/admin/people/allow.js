/**
 * POST /api/admin/people/allow: "Let it ask again" on /admin/people (#225,
 * criterion 5's "unless the owner allows it"). Lifts the hold on the address
 * of a revoked account that was then deleted, so a new request from it is
 * taken as any other. The guards in ../_middleware.js have already required an
 * admin's session and the site's own Origin.
 *
 * The press carries email=<the address>, typed by the admin (the owner's
 * choice at #225's pickup: the site keeps only the address's keyed hash, so
 * there is no list to pick it from). A revoked account that still exists is
 * taken back by approving a team for it instead. The lift and its log entry
 * are one transaction (lib/people.js, allowAddress). Nothing is emailed. 303
 * back to the page, saying what happened.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { isEmailAddress } from '../../../../lib/mail.js';
import { allowAddress } from '../../../../lib/people.js';
import { peopleLocation } from '../../../../lib/people-page.js';
import { nowSeconds } from '../../../../lib/session.js';

const OUTCOMES = { 'not-held': 'not-held', account: 'has-account', unmatched: 'unmatched' };

export async function onRequestPost({ request, env, data }) {
  const typed = (await readForm(request)).email;
  const email = typeof typed === 'string' ? typed.trim() : '';
  if (!isEmailAddress(email)) return seeOther(peopleLocation({ error: 'address' }));
  if (!env.ADDRESS_HASH_KEY) {
    console.error('people: ADDRESS_HASH_KEY is not configured, so no address was let ask again');
    return seeOther(peopleLocation({ error: 'unconfigured' }));
  }
  const outcome = await allowAddress(env.DB, { email, hashKey: env.ADDRESS_HASH_KEY, admin: data.admin.email, now: nowSeconds() });
  if (outcome === 'allowed') return seeOther(peopleLocation({ done: 'allowed' }));
  return seeOther(peopleLocation({ error: OUTCOMES[outcome] }));
}

/** GET changes nothing, as approve.js's does. */
export const onRequestGet = () => seeOther(peopleLocation({ error: 'unchanged' }));
