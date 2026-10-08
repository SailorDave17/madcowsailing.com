/**
 * The page a link to set a password opens, /set-password (#221; the form
 * since #222), rendered into templates/page.html as the public pages are
 * (lib/public-page.js).
 *
 * Three answers, and nothing else to choose between them but the link:
 *
 *   - the link can be used: the form to choose a password, which says when
 *     the link stops working. The same page serves an approval's first
 *     password and a reset's new one, only its heading differs;
 *   - it cannot: used, replaced, expired, never made, or no link at all, all
 *     with one page, so the answer says nothing about which. It offers no way
 *     in (#221's criterion 2): no form and no sign-in, only how to get a new
 *     link;
 *   - the database did not answer.
 *
 * The form is a plain post with the token in a hidden field, so it works
 * without JavaScript. It asks for the password twice, since there is no
 * script to show it while it is typed, and it carries the account's address
 * in a read-only field marked as the username, so a password manager saves
 * the pair (NIST SP 800-63B-4 asks that password managers and paste work).
 * The rules in the hint are lib/password-rules.js's.
 */
import { escapeHtml, utcText } from './admin-page.js';
import { PASSWORD_MAX, PASSWORD_MIN } from './password-rules.js';
import { TAKEDOWN_EMAIL, renderPage } from './public-page.js';
import { fieldParts, head, summary } from './sign-in-page.js';

const TARGETS = { password: 'set-password', confirm: 'set-confirm' };

/**
 * The form for the link `token`, which works until `expiresAt`, for the
 * account at `email`: `hasPassword` picks the heading. `errors` are
 * lib/password-rules.js's, each { field, message }.
 */
export function setPasswordPage({ token, email, hasPassword, expiresAt, errors = [] }) {
  const heading = hasPassword ? 'Choose a new password' : 'Choose a password';
  const { invalid, described, message } = fieldParts(errors);
  return renderPage({
    title: errors.length ? `Error: ${heading}` : heading,
    main: `${head(heading, `This link works once, until ${escapeHtml(utcText(expiresAt))}. Choosing a password signs you in here, and signs out any other phone or computer signed in to your account.`)}

  <section class="wrap ask" aria-label="${heading}">${summary({ id: 'set-problems', problem: null, errors, targets: TARGETS })}
    <form method="post" action="/set-password" class="ask-form">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <p class="field">
        <label for="set-email">Email address</label>
        <input id="set-email" type="email" autocomplete="username" readonly value="${escapeHtml(email)}">
      </p>
      <p class="field">
        <label for="set-password">Password</label>
        <span class="hint" id="set-password-hint">At least ${PASSWORD_MIN} characters, up to ${PASSWORD_MAX}. Any characters, spaces included, with no rules about mixing them. A few unrelated words in a row make a long password that is easy to remember. A password seen in a data breach elsewhere is turned down.</span>${message('set-password', 'password')}
        <input id="set-password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required${invalid('password')}${described('set-password', 'password', true)}>
      </p>
      <p class="field">
        <label for="set-confirm">The same password again</label>${message('set-confirm', 'confirm')}
        <input id="set-confirm" name="confirm" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required${invalid('confirm')}${described('set-confirm', 'confirm')}>
      </p>
      <p class="actions"><button type="submit" class="button button-accent">Set the password</button></p>
    </form>
  </section>`,
  });
}

/** Any link that cannot be used, whatever the reason. */
export function linkGonePage() {
  return renderPage({
    title: 'Link not valid',
    main: head(
      'This link can\'t be used',
      `It has been used already, it has run out, a newer link replaced it, or it was not copied whole. To get a new one, <a href="/forgot-password">reset your password</a>, reply to the email it came in, or write to <a href="mailto:${TAKEDOWN_EMAIL}">${TAKEDOWN_EMAIL}</a>.`,
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
