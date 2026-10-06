/**
 * The request page at /ask (#220): the form, the page that follows a request,
 * and the page when requests cannot be taken. functions/ask.js answers with
 * them, rendered into templates/page.html as the public pages are
 * (lib/public-page.js).
 *
 * The form is a plain post to /ask, so the answer to a request is a page,
 * and every refusal shows the form again with what was typed and the reasons
 * (criterion 7). The reasons sit in a summary above the form, which takes
 * the focus when the page loads (autofocus on an element with tabindex -1),
 * each a link to its field, and again beside each field, which says it is
 * invalid and names its message (aria-invalid, aria-describedby). The page's
 * title starts "Error:" while a reason shows. None of it needs JavaScript;
 * Turnstile does, and the page says so in a <noscript>.
 *
 * The Turnstile widget is the one thing on any page here from another
 * origin. Its script loads on this page only, added by the page's own
 * script (public/js/ask.js) the first time someone focuses or touches the
 * form, or at once on a page sent back with a reason (owner, at #220's
 * review: at load it put the page under the performance floor). lib/headers.js
 * widens the CSP for this path only, by the two values Turnstile's CSP page
 * lists. No address on the site links here yet (owner, at #220's pickup:
 * #226 points the old invite link at it).
 *
 * The send button is the page's one accent (base.css's budget), so the
 * reasons are drawn in --deep, never in --ensign.
 */
import { escapeHtml } from './admin-page.js';
import { NAME_MAX, NOTE_MAX, REQUEST_LIMIT, ROLES, TEAMS } from './accounts.js';
import { renderPage } from './public-page.js';

// Turnstile's script, from the exact URL its docs give: "Proxying or caching
// this file will cause Turnstile to fail when future updates are released".
// public/js/ask.js adds it, and test/ask.test.js holds the two equal.
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// The page's own script, which adds Turnstile's. Stamped by hand, as
// CODE_SCRIPT is in lib/admin-page.js, since tools/assetver.py stamps HTML
// files only: test/ask.test.js fails until the ?v= is the file's own hash.
export const ASK_SCRIPT = '<script src="/js/ask.js?v=1508a3f9de" defer></script>';

const TITLE = 'Ask for an account';

const ROLE_LABELS = { parent: 'A parent', coach: 'A coach', other: 'Someone else' };

// The element each field's reason links to: the field itself, or the first
// choice in a group.
const TARGETS = { name: 'ask-name', email: 'ask-email', role: `ask-role-${ROLES[0]}`, team: `ask-team-${TEAMS[0].team}` };

const minutesText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
};

// The reasons a request was refused that belong to no one field.
export const PROBLEMS = {
  turnstile: () => 'The check that you are a person did not pass. Wait for it to finish below the form, then send the request again.',
  limited: (retryAfter) => `This network has sent ${REQUEST_LIMIT} requests in the last hour, the most the site takes from one network. Try again in ${minutesText(retryAfter)}.`,
  busy: (retryAfter) => `The site has taken all the requests it takes in an hour. Try again in ${minutesText(retryAfter)}.`,
  closed: () => 'Requests can\'t be taken right now. Try again in a few minutes.',
};

const lede = 'Ask here for an account to send photos to the team\'s albums, as a parent, a coach or anyone else. One of the site\'s admins reads each request and approves it for each team on its own. If yours is approved, an email comes to the address you give, with a link to set a password.';

const head = (heading, text) => `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">Team photos</a></p>
    <h1>${heading}</h1>
    <p class="lede">${text}</p>
  </section>`;

// The summary above the form: every reason, each field's a link to it. A
// <section>, not a <div>: a named section is a region, which may carry a
// name, so the focus landing on it announces "The request was not sent".
// ARIA prohibits naming a <div> with no role (the ux-design audit's axe run
// flagged the first draft, aria-prohibited-attr).
function summary(problem, errors) {
  if (!problem && errors.length === 0) return '';
  const items = [
    ...(problem ? [problem] : []),
    ...errors.map(({ field, message }) => `<a href="#${TARGETS[field]}">${escapeHtml(message)}</a>`),
  ];
  return `
    <section class="error-summary" id="ask-problems" tabindex="-1" autofocus aria-labelledby="ask-problems-title">
      <h2 id="ask-problems-title">The request was not sent</h2>
      <ul>
${items.map((item) => `        <li>${item}</li>`).join('\n')}
      </ul>
    </section>`;
}

/**
 * The form, with `values` as typed (the form's own strings), each field's
 * reason from `errors` (lib/accounts.js's readRequest), and `problem`, a
 * reason that is no field's: 'turnstile', 'limited', 'busy' or 'closed',
 * the last three with `retryAfter` in seconds where it applies.
 */
export function askPage({ siteKey, values = {}, errors = [], problem = null, retryAfter = 0 }) {
  const reason = (field) => errors.find((error) => error.field === field);
  const text = (field) => (typeof values[field] === 'string' ? values[field] : '');
  const message = (id, field) => (reason(field) ? `\n        <span class="field-error" id="${id}-error">${escapeHtml(reason(field).message)}</span>` : '');
  // aria-describedby, holding the hint and the reason where each exists.
  const described = (id, field, hint = false) => {
    const ids = [...(hint ? [`${id}-hint`] : []), ...(reason(field) ? [`${id}-error`] : [])];
    return ids.length ? ` aria-describedby="${ids.join(' ')}"` : '';
  };
  const invalid = (field) => (reason(field) ? ' aria-invalid="true"' : '');
  const asked = Array.isArray(values.team) ? values.team : [];

  const roles = ROLES.map((role) =>
    `<label><input type="radio" id="ask-role-${role}" name="role" value="${role}" required${values.role === role ? ' checked' : ''}${invalid('role')}> ${ROLE_LABELS[role]}</label>`)
    .join('\n          ');
  const teams = TEAMS.map(({ team, name }) =>
    `<label><input type="checkbox" id="ask-team-${team}" name="team" value="${team}"${asked.includes(team) ? ' checked' : ''}${invalid('team')}> ${escapeHtml(name)}</label>`)
    .join('\n          ');
  const problemText = problem ? PROBLEMS[problem](retryAfter) : null;
  const flagged = Boolean(problemText) || errors.length > 0;

  return renderPage({
    title: flagged ? `Error: ${TITLE}` : TITLE,
    main: `${head(TITLE, lede)}

  <section class="wrap ask" aria-label="Your request">${summary(problemText, errors)}
    <form method="post" action="/ask" class="ask-form">
      <p class="field">
        <label for="ask-name">Your name</label>${message('ask-name', 'name')}
        <input id="ask-name" name="name" type="text" autocomplete="name" maxlength="${NAME_MAX}" required${invalid('name')}${described('ask-name', 'name')} value="${escapeHtml(text('name'))}">
      </p>
      <p class="field">
        <label for="ask-email">Your email address</label>
        <span class="hint" id="ask-email-hint">If the request is approved, the email to set a password comes here.</span>${message('ask-email', 'email')}
        <input id="ask-email" name="email" type="email" autocomplete="email" maxlength="254" spellcheck="false" required${invalid('email')}${described('ask-email', 'email', true)} value="${escapeHtml(text('email'))}">
      </p>
      <fieldset class="field"${described('ask-role', 'role')}>
        <legend>You are</legend>${message('ask-role', 'role')}
        <p class="choices">
          ${roles}
        </p>
      </fieldset>
      <fieldset class="field"${described('ask-team', 'team', true)}>
        <legend>Which team</legend>
        <span class="hint" id="ask-team-hint">One, or both.</span>${message('ask-team', 'team')}
        <p class="choices">
          ${teams}
        </p>
      </fieldset>
      <p class="field">
        <label for="ask-note">A note for the admins, if you want to leave one</label>
        <span class="hint" id="ask-note-hint">Up to ${NOTE_MAX} characters. Leave out any sailor's name: the site keeps none.</span>
        <textarea id="ask-note" name="note" rows="4" maxlength="${NOTE_MAX}" aria-describedby="ask-note-hint">${escapeHtml(text('note'))}</textarea>
      </p>
      <div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-theme="light" data-size="flexible"></div>
      <noscript><p>The check that you are a person needs JavaScript, so the request can't be sent without it.</p></noscript>
      <p class="actions"><button type="submit" class="button button-accent">Send the request</button></p>
    </form>
    <p class="ask-policy">What the site keeps about a request, and who sees it, is on <a href="/policy">Who sees these photos</a>.</p>
  </section>
  ${ASK_SCRIPT}`,
  });
}

/**
 * The page /ask?sent shows after a request was taken. It is the same page
 * whether the address was new or the site already had it (criterion 4), so
 * it says only what happens next for a new request.
 */
export function askSentPage() {
  return renderPage({
    title: 'Your request is in',
    main: head('Your request is in', 'One of the site\'s admins reads each request. If yours is approved, an email comes to the address you gave, with a link to set a password.'),
  });
}

/** /ask when the site cannot take requests: a binding or a secret is missing. */
export function askClosedPage() {
  return renderPage({
    title: 'Requests closed',
    main: head('Requests can\'t be taken right now', 'Try again in a few minutes.'),
  });
}
