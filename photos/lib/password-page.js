/**
 * The page a link to set a password opens, /set-password (#221), rendered
 * into templates/page.html as the public pages are (lib/public-page.js).
 *
 * Two answers, and nothing else to choose between them but the link:
 *
 *   - the link can be used: the account is approved, and the page says when
 *     the link stops working. Setting the password itself is #222's (the
 *     owner's choice at #221's pickup), so the page says it is coming and
 *     shows no form;
 *   - it cannot: used, replaced, expired, never made, or no link at all, all
 *     with one page, so the answer says nothing about which. It offers no way
 *     in (criterion 2): no form and no sign-in, only who to ask for a new link.
 */
import { escapeHtml, utcText } from './admin-page.js';
import { TAKEDOWN_EMAIL, renderPage } from './public-page.js';

const head = (heading, lede) => `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">All albums</a></p>
    <h1>${heading}</h1>
    <p class="lede">${lede}</p>
  </section>`;

/** A link that can be used, until `expiresAt`. */
export function linkReadyPage(expiresAt) {
  return renderPage({
    title: 'Account approved',
    main: head(
      'Your account is approved',
      `Setting a password here is not open yet. Keep the email: this link works until ${escapeHtml(utcText(expiresAt))}, and it can be used once. If it runs out first, reply to the email and one of the site's admins will send a new one.`,
    ),
  });
}

/** Any link that cannot be used, whatever the reason. */
export function linkGonePage() {
  return renderPage({
    title: 'Link not valid',
    main: head(
      'This link can\'t be used',
      `It has been used already, it has run out, a newer link replaced it, or it was not copied whole. To get a new one, reply to the email it came in, or write to <a href="mailto:${TAKEDOWN_EMAIL}">${TAKEDOWN_EMAIL}</a>.`,
    ),
  });
}

/** The database did not answer, or is not bound. */
export function linkClosedPage() {
  return renderPage({
    title: 'Link not checked',
    main: head(
      'This link can\'t be checked right now',
      'Nothing was changed. Try again in a few minutes.',
    ),
  });
}
