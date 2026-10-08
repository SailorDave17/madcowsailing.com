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
import { CODES_PER_DAY, CODE_DIGITS, CODE_SECONDS, CODE_TRIES } from './admin-code.js';
import { escapeHtml } from './admin-page.js';
import { ADMIN_SESSION_HOURS } from './admin-session.js';
import { ASK_SCRIPT } from './ask-page.js';
import { renderPage } from './public-page.js';
import { RESET_GAP_SECONDS, RESET_REQUEST_LIMIT, RESET_SECONDS } from './reset.js';
import { EMAIL_FAILURE_LIMIT, NETWORK_FAILURE_LIMIT } from './sign-in.js';
import { teamsText } from './people.js';

const minutesText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
};

// "in 3 hours", "in 40 minutes": the wait for the day's codes (#224).
const waitText = (seconds) => (seconds < 60 * 60 ? minutesText(seconds) : (() => {
  const hours = Math.ceil(seconds / (60 * 60));
  return hours === 1 ? 'an hour' : `${hours} hours`;
})());

const CODE_MINUTES = CODE_SECONDS / 60;

const RESET_MINUTES = RESET_SECONDS / 60;
const GAP_MINUTES = RESET_GAP_SECONDS / 60;

export const head = (heading, lede) => `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">Team photos</a></p>
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
  // The admin's code (#224). Each is reached only with the right password,
  // so saying the account is an admin's tells nobody anything new.
  codes: (retryAfter) => `Your account has been sent ${CODES_PER_DAY} sign-in codes in the last 24 hours, the most the site sends one admin. Try again in ${waitText(retryAfter)}. If you did not ask for them, someone else knows your password: ${FORGOT}. A new password lets you sign in again at once.`,
  'code-unsent': () => 'The email with your sign-in code could not be sent just now. Try again in a few minutes.',
  'code-quota': () => 'The site has sent all the email it can for today, so your sign-in code could not be sent. Try again after midnight UTC, when the limit resets.',
};

const SIGN_IN_NOTICES = {
  'signed-out': 'You are signed out, on every phone and computer that was signed in to your account.',
  // Where the admin guard sends a request it refuses (lib/admin-session.js).
  admin: `Sign in to open the admin pages. An admin's sign-in lasts ${ADMIN_SESSION_HOURS} hours. If you pressed a button there, nothing was changed: press it again once you are signed in.`,
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

// ---- /sign-in/code (#224) ---------------------------------------------------

const CODE_LEDE = `Your account opens the admin pages, so signing in takes one more step. The site has emailed a ${CODE_DIGITS}-digit code to your account's address. It works once, for ${CODE_MINUTES} minutes, and only in this browser.`;

export const CODE_PROBLEMS = {
  wrong: (triesLeft) => `That is not the code. ${triesLeft === 1 ? '1 more try is' : `${triesLeft} more tries are`} allowed before it stops working. If you were sent more than one code, use the newest.`,
  closed: () => 'The code can\'t be checked right now. Try again in a few minutes.',
};

const CODE_NOTICES = {
  unconfirmed: 'The email service did not confirm that it sent your code. If it has not arrived in a few minutes, sign in again for a new one.',
};

/**
 * The form for the code, with its reason from `errors`, `problem` (a key of
 * CODE_PROBLEMS) with `triesLeft` where it applies, and `notice` (a key of
 * CODE_NOTICES), shown when nothing went wrong. The field asks for the
 * one-time code by its autocomplete name, so a phone can offer it from the
 * email; it is a text field, never a number, so a leading 0 stays.
 */
export function codePage({ errors = [], problem = null, triesLeft = CODE_TRIES, notice = null } = {}) {
  const { invalid, described, message } = fieldParts(errors);
  const problemText = problem ? CODE_PROBLEMS[problem](triesLeft) : null;
  const flagged = Boolean(problemText) || errors.length > 0;
  const noticeText = !flagged && notice && CODE_NOTICES[notice]
    ? `\n    <p role="status">${CODE_NOTICES[notice]}</p>` : '';
  return renderPage({
    title: flagged ? 'Error: Enter your code' : 'Enter your code',
    main: `${head('Enter your code', CODE_LEDE)}

  <section class="wrap ask" aria-label="Enter your code">${noticeText}${summary({ id: 'code-problems', problem: problemText, errors, targets: { code: 'sign-in-code' } })}
    <form method="post" action="/sign-in/code" class="ask-form">
      <p class="field">
        <label for="sign-in-code">Code</label>
        <span class="hint" id="sign-in-code-hint">The ${CODE_DIGITS} digits from the email.</span>${message('sign-in-code', 'code')}
        <input id="sign-in-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="64" spellcheck="false" required${invalid('code')}${described('sign-in-code', 'code', true)}>
      </p>
      <p class="actions"><button type="submit" class="button button-accent">Sign in</button></p>
    </form>
    <p class="ask-policy">No code? <a href="/sign-in">Sign in again</a> for a new one.</p>
  </section>`,
  });
}

/**
 * The page for a code that can no longer be used, whatever ended it: used,
 * its time up, out of tries, or a browser holding no sign-in to check one
 * against. A new code needs the password again.
 */
export function codeEndedPage({ outOfTries = false } = {}) {
  const why = outOfTries
    ? `That is not the code, and it was the last of its ${CODE_TRIES} tries, so the code no longer works.`
    : `That code can no longer be used: it has been used, its ${CODE_MINUTES} minutes are up, or it was tried ${CODE_TRIES} times.`;
  return renderPage({
    title: 'Sign in again',
    main: `${head('Sign in again', `${why} Sign in again, and a new code is emailed.`)}

  <section class="wrap ask" aria-label="Sign in again">
    <p class="actions"><a class="button button-accent" href="/sign-in">Sign in</a></p>
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
 * approved for, the way to the share page, and Sign out. Since #223 an
 * account sends from /share/, to its approved teams' albums only (owner, at
 * #223's pickup: /account links the share page, which links /sign-in back).
 * `notice` is a key of ACCOUNT_NOTICES.
 *
 * Since #224 an admin lands here too, after the code, and the page links the
 * admin pages: a link gets through the Access sign-in that stands in front
 * of /admin until #226, where a form's redirect is stopped (the owner's
 * choice at #224's review; functions/sign-in/code.js says why). The link is
 * drawn for any account holding the role, whatever cookie the browser holds:
 * the admin pages ask for the code again once their 12 hours are up.
 */
export function accountPage({ name, email, teams, adminRole = null }, { notice = null } = {}) {
  const noticeText = notice && ACCOUNT_NOTICES[notice]
    ? `\n    <p role="status">${ACCOUNT_NOTICES[notice]}</p>` : '';
  const adminLink = adminRole ? '\n      <a class="button" href="/admin/">Open the admin pages</a>' : '';
  return renderPage({
    title: 'Your account',
    main: `${head('You are signed in', `As ${escapeHtml(name)}, ${escapeHtml(email)}, approved for ${escapeHtml(teamsText(teams))}.`)}

  <section class="wrap ask" aria-label="Your account">${noticeText}
    <p class="actions"><a class="button button-accent" href="/share/">Send photos</a>${adminLink}</p>
    <p>You can send photos to the albums of ${escapeHtml(teamsText(teams))}. Each waits for one of the site's admins to check it before anyone sees it, and the admins see that it came from your account.</p>
    <p>To change your password, <a href="/forgot-password">reset it</a>: the site emails you a link.</p>
    <form method="post" action="/sign-out" class="ask-form">
      <p class="hint" id="sign-out-hint">Signing out signs you out on every phone and computer signed in to your account.</p>
      <p class="actions"><button type="submit" class="button" aria-describedby="sign-out-hint">Sign out</button></p>
    </form>
  </section>`,
  });
}
