/**
 * POST /api/admin/mail/test: send a test email to the address typed on
 * /admin/mail (#217). The guards in ../_middleware.js have already required
 * an admin's session and the site's own Origin.
 *
 * The message is fixed: it says which environment sent it and when, so a
 * test from the develop preview can be told from one from production. Only
 * the address comes from the form. lib/mail.js sends it and logs no part of
 * it; the 303 back carries the outcome and never the address.
 */
import { readForm, seeOther } from '../../../../lib/form.js';
import { MAIL_REPLY_TO, sendMail } from '../../../../lib/mail.js';

export const TEST_SUBJECT = 'Test email from photos.madcowsailing.com';

/** The test message's text, for `environment` (SITE_ENV) at `now`. */
export function testText(environment, now) {
  return [
    "This is a test message from the Mad Cow Sailing photo site's admin page.",
    '',
    `It was sent by the ${environment} site at ${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}, to check that`,
    'email from the site reaches an inbox. Nothing needs doing.',
    '',
    `A reply to it goes to ${MAIL_REPLY_TO}.`,
  ].join('\n');
}

export async function onRequestPost({ request, env }) {
  const { to } = await readForm(request);
  const sent = await sendMail(env, {
    to: typeof to === 'string' ? to.trim() : to,
    subject: TEST_SUBJECT,
    text: testText(env.SITE_ENV ?? 'unnamed', new Date()),
  });
  if (sent.ok) return seeOther('/admin/mail?done=sent');
  const status = sent.reason === 'refused' ? `&status=${sent.status}` : '';
  return seeOther(`/admin/mail?error=${sent.reason}${status}`);
}

/** GET sends nothing, as the other admin writes' GETs change nothing. */
export const onRequestGet = () => seeOther('/admin/mail?error=unchanged');
