/**
 * The pages a person signs in with (#222): /sign-in, /forgot-password and the
 * page that follows it, and /account. The set-password form is
 * lib/password-page.js's. All are rendered into templates/page.html, as the
 * public pages are (lib/public-page.js), and every one is a plain form post
 * that works without JavaScript, except the reset form's Turnstile check.
 *
 * They take /ask's form (lib/ask-page.js, public/css/site.css's .ask-form):
 * the reasons in a summary above the form that takes the focus when the page
 * loads, each a link to its field, and again beside the field. The reset form
 * also takes /ask's script, public/js/ask.js, which adds Turnstile's on the
 * form's first focus or touch, or at once on a page sent back with a reason
 * (#ask-problems): the summary keeps that id there for it. The sign-in form
 * has no Turnstile (the owner's choice at pickup, 2026-10-06), so no script.
 *
 * Nothing links to /sign-in or /forgot-password yet, as nothing links to /ask
 * (owner, at #220's pickup): the emails do, and /set-password, /account and
 * each other. Which public page links them is #223's and #226's.
 *
 * Every refusal of a sign-in reads the same, whatever was wrong
 * (criterion 2): it never says whether the address has an account. The limit
 * on an email address is counted for addresses with no account too, so its
 * message reveals nothing either.
 */
import { escapeHtml } from './admin-page.js';
import { ASK_SCRIPT } from './ask-page.js';
import { renderPage } from './public-page.js';
import { RESET_GAP_SECONDS, RESET_REQUEST_LIMIT, RESET_SECONDS } from './reset.js';
import { EMAIL_FAILURE_LIMIT, NETWORK_FAILURE_LIMIT } from './sign-in.js';
import { teamsText } from './people.js';

const minutesText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
};

const RESET_MINUTES = RESET_SECONDS / 60;
const GAP_MINUTES = RESET_GAP_SECONDS / 60;

export const head = (heading, lede) => `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">All albums</a></p>
    <h1>${heading}</h1>
    <p class="lede">${lede}</p>
  </section>`;

/**
 * The summary above a form: every reason, each field's a link to it. Its id
 * is `id`; the reset form's is ask-problems, which public/js/ask.js reads.
 * `targets` maps a field to the element its reason links to.
 */
export function summary({ id, problem, errors, targets }) {
  if (!problem && errors.length === 0) return '';
  const items = [
    ...(problem ? [problem] : []),
    ...errors.map(({ field, message }) => `<a href="#${targets[field]}">${escapeHtml(message)}</a>`),
  ];
  return `
    <section class="error-summary" id="${id}" tabindex="-1" autofocus aria-labelledby="${id}-title">
      <h2 id="${id}-title">That did not work</h2>
      <ul>
${items.map((item) => `        <li>${item}</li>`).join('\n')}
      </ul>
    </section>`;
}

/** The pieces a field needs to carry its reason: invalid, described-by, and the message. */
export function fieldParts(errors) {
  const reason = (field) => errors.find((error) => error.field === field);
  return {
    invalid: (field) => (reason(field) ? ' aria-invalid="true"' : ''),
    described: (id, field, hint = false) => {
      const ids = [...(hint ? [`${id}-hint`] : []), ...(reason(field) ? [`${id}-error`] : [])];
      return ids.length ? ` aria-describedby="${ids.join(' ')}"` : '';
    },
    message: (id, field) => (reason(field) ? `\n        <span class="field-error" id="${id}-error">${escapeHtml(reason(field).message)}</span>` : ''),
  };
}

// ---- /sign-in -------------------------------------------------------------

const FORGOT = '<a href="/forgot-password">reset it</a>';

// The reasons a sign-in was refused that belong to no one field.
export const SIGN_IN_PROBLEMS = {
  refused: () => `The email address and password don't match an account that can sign in. Check both and try again. If you have forgotten the password, or it has stopped working after too many failed tries, ${FORGOT}.`,
  email: (retryAfter) => `There have been ${EMAIL_FAILURE_LIMIT} failed sign-ins for this email address in the last hour, the most the site allows. Try again in ${minutesText(retryAfter)}, or ${FORGOT}.`,
  network: (retryAfter) => `This network has had ${NETWORK_FAILURE_LIMIT} failed sign-ins in the last hour, the most the site takes from one network. Try again in ${minutesText(retryAfter)}.`,
  busy: (retryAfter) => `The site has had too many failed sign-ins this hour, so it is not taking any until the hour is up. Try again in ${minutesText(retryAfter)}. A phone or computer that is already signed in keeps working.`,
  closed: () => 'Signing in isn\'t possible right now. Try again in a few minutes.',
};

const SIGN_IN_NOTICES = {
  'signed-out': 'You are signed out, on every phone and computer that was signed in to your account.',
};

const SIGN_IN_TARGETS = { email: 'sign-in-email', password: 'sign-in-password' };

/**
 * The sign-in form, with the address as typed (never the password), each
 * field's reason from `errors`, `problem` (a key of SIGN_IN_PROBLEMS) with
 * `retryAfter` in seconds where it applies, and `notice` (a key of
 * SIGN_IN_NOTICES), shown when nothing went wrong.
 */
export function signInPage({ email = '', errors = [], problem = null, retryAfter = 0, notice = null } = {}) {
  const { invalid, described, message } = fieldParts(errors);
  const problemText = problem ? SIGN_IN_PROBLEMS[problem](retryAfter) : null;
  const flagged = Boolean(problemText) || errors.length > 0;
  const noticeText = !flagged && notice && SIGN_IN_NOTICES[notice]
    ? `\n    <p role="status">${SIGN_IN_NOTICES[notice]}</p>` : '';
  return renderPage({
    title: flagged ? 'Error: Sign in' : 'Sign in',
    main: `${head('Sign in', 'Sign in with the email address and password of your account on the photo site.')}

  <section class="wrap ask" aria-label="Sign in">${noticeText}${summary({ id: 'sign-in-problems', problem: problemText, errors, targets: SIGN_IN_TARGETS })}
    <form method="post" action="/sign-in" class="ask-form">
      <p class="field">
        <label for="sign-in-email">Email address</label>${message('sign-in-email', 'email')}
        <input id="sign-in-email" name="email" type="email" autocomplete="username" maxlength="254" spellcheck="false" required${invalid('email')}${described('sign-in-email', 'email')} value="${escapeHtml(email)}">
      </p>
      <p class="field">
        <label for="sign-in-password">Password</label>${message('sign-in-password', 'password')}
        <input id="sign-in-password" name="password" type="password" autocomplete="current-password" required${invalid('password')}${described('sign-in-password', 'password')}>
      </p>
      <p class="actions"><button type="submit" class="button button-accent">Sign in</button></p>
    </form>
    <p class="ask-policy"><a href="/forgot-password">Forgot your password?</a></p>
  </section>`,
  });
}

// ---- /forgot-password ------------------------------------------------------

export const FORGOT_PROBLEMS = {
  turnstile: () => 'The check that you are a person did not pass. Wait for it to finish below the form, then send it again.',
  limited: (retryAfter) => `This network has asked for ${RESET_REQUEST_LIMIT} password resets in the last hour, the most the site takes from one network. Try again in ${minutesText(retryAfter)}.`,
  closed: () => 'A reset can\'t be sent right now. Try again in a few minutes.',
};

const FORGOT_LEDE = `Enter the email address of your account. If it is an account the site's admins approved, an email comes with a link to set a new password. The link works once, for ${RESET_MINUTES === 60 ? 'an hour' : `${RESET_MINUTES} minutes`}.`;

/**
 * The reset form, with the address as typed, its reason, and `problem` (a key
 * of FORGOT_PROBLEMS). The summary's id is ask-problems, so public/js/ask.js
 * adds Turnstile at once on a page sent back with a reason.
 */
export function forgotPage({ siteKey, email = '', errors = [], problem = null, retryAfter = 0 }) {
  const { invalid, described, message } = fieldParts(errors);
  const problemText = problem ? FORGOT_PROBLEMS[problem](retryAfter) : null;
  const flagged = Boolean(problemText) || errors.length > 0;
  return renderPage({
    title: flagged ? 'Error: Reset your password' : 'Reset your password',
    main: `${head('Reset your password', FORGOT_LEDE)}

  <section class="wrap ask" aria-label="Reset your password">${summary({ id: 'ask-problems', problem: problemText, errors, targets: { email: 'forgot-email' } })}
    <form method="post" action="/forgot-password" class="ask-form">
      <p class="field">
        <label for="forgot-email">Email address</label>${message('forgot-email', 'email')}
        <input id="forgot-email" name="email" type="email" autocomplete="username" maxlength="254" spellcheck="false" required${invalid('email')}${described('forgot-email', 'email')} value="${escapeHtml(email)}">
      </p>
      <div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-theme="light" data-size="flexible"></div>
      <noscript><p>The check that you are a person needs JavaScript, so a reset can't be sent without it.</p></noscript>
      <p class="actions"><button type="submit" class="button button-accent">Send the link</button></p>
    </form>
    <p class="ask-policy"><a href="/sign-in">Back to sign in</a></p>
  </section>
  ${ASK_SCRIPT}`,
  });
}

/**
 * /forgot-password?sent: the same page whether or not the address has an
 * account (criterion 5), so it says what happens in both cases.
 */
export function forgotSentPage() {
  return renderPage({
    title: 'Check your email',
    main: head(
      'Check your email',
      `If that address has an account the site's admins approved, an email is on its way with a link to set a new password. It works once, for ${RESET_MINUTES === 60 ? 'an hour' : `${RESET_MINUTES} minutes`}. No email comes for an address with no account, and the site sends one account at most one link every ${GAP_MINUTES} minutes, so if one came a moment ago, use that.`,
    ),
  });
}

/** /forgot-password or /sign-in when a binding or a secret is missing. */
export function closedPage(heading) {
  return renderPage({
    title: heading,
    main: head(escapeHtml(heading), 'This can\'t be done right now. Try again in a few minutes.'),
  });
}

// ---- /account ---------------------------------------------------------------

const ACCOUNT_NOTICES = {
  'password-set': 'Your password is set, and you are signed in. Any other phone or computer that was signed in to your account is signed out.',
};

/**
 * The page a signed-in person lands on: who they are, the teams they are
 * approved for, and Sign out. Sending photos from an account is #223's, so
 * the page says that isn't open yet. `notice` is a key of ACCOUNT_NOTICES.
 */
export function accountPage({ name, email, teams }, { notice = null } = {}) {
  const noticeText = notice && ACCOUNT_NOTICES[notice]
    ? `\n    <p role="status">${ACCOUNT_NOTICES[notice]}</p>` : '';
  return renderPage({
    title: 'Your account',
    main: `${head('You are signed in', `As ${escapeHtml(name)}, ${escapeHtml(email)}, approved for ${escapeHtml(teamsText(teams))}.`)}

  <section class="wrap ask" aria-label="Your account">${noticeText}
    <p>Sending photos from your account isn't open yet.</p>
    <p>To change your password, <a href="/forgot-password">reset it</a>: the site emails you a link.</p>
    <form method="post" action="/sign-out" class="ask-form">
      <p class="hint" id="sign-out-hint">Signing out signs you out on every phone and computer signed in to your account.</p>
      <p class="actions"><button type="submit" class="button" aria-describedby="sign-out-hint">Sign out</button></p>
    </form>
  </section>`,
  });
}
