/**
 * /admin/people (#221): the requests for an account and the people approved,
 * rendered by functions/admin/people.js. lib/people.js holds the rules.
 *
 * Each person shows their name, email address, role, every team with where it
 * stands, the note and when they asked (criterion 1). A request still waiting
 * carries one form: a box per team to decide, ticked, the role the requester
 * chose, and two buttons. Approve takes the ticked teams and the role; Turn
 * down takes the ticked teams (D16: each team on its own). A turned-down team
 * keeps its box, unticked, under Approve only, so a mistake can be undone. An
 * approved person has "Send a new link", one press (criterion 4).
 *
 * Every press is a plain form post answered 303 back here with ?done= or
 * ?error=, so a reload cannot post again and the page needs no script. Under
 * all of it, the admins' log, newest first (criterion 5).
 *
 * Since #224 each person shows whether they are the owner or an admin. Any
 * admin can make an approved person an admin ("Make admin"), and only the
 * owner can take the role away again ("Remove admin"), never from the owner
 * (the owner's choice at #224's pickup). The page draws a button only for
 * the admin who may press it; the routes check again, and lib/people.js and
 * migration 0013 under them.
 *
 * Since #225 each person has "Revoke, hide or delete", a native <details>
 * holding what applies to them: Revoke, a box per approved team, none
 * ticked; "Hide all their photos", whose box names the count and must be
 * ticked (the owner's choice at pickup, 2026-10-07); and Delete, whose box
 * says a reply from the account's own address confirmed the request and must
 * be ticked (the same pickup). Revoke and Delete are drawn for nobody holding
 * the admin role: the owner removes it first. People revoked from every team
 * have a list of their own, where approving a team takes them back, and under
 * it a form lets a deleted revoked account's address ask again.
 *
 * Everything a requester typed, their name, address and note, is escaped, and
 * the notice after a press looks its person up in the lists by id, so a
 * crafted link can put on the page only a known sentence and a name the
 * database holds.
 */
import { ROLES } from './accounts.js';
import { adminPage, escapeHtml, timeElement } from './admin-page.js';
import { ADMIN_SESSION_HOURS } from './admin-session.js';
import { LINK_DAYS, LOG_SHOWN } from './people.js';

const ROLE_NAMES = { parent: 'Parent', coach: 'Coach', other: 'Other' };
const STATE_NAMES = { requested: 'waiting', approved: 'approved', rejected: 'turned down', revoked: 'revoked' };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Where a press answers to: the page, with what happened. `hidden` and
 * `waiting` are hidePhotos' counts (#225).
 */
export function peopleLocation({ done, error, account, mail, hidden, waiting } = {}) {
  const params = new URLSearchParams();
  if (done) params.set('done', done);
  if (error) params.set('error', error);
  if (account) params.set('account', String(account));
  if (mail) params.set('mail', mail);
  if (hidden) params.set('hidden', String(hidden));
  if (waiting) params.set('waiting', String(waiting));
  const query = params.toString();
  return query ? `/admin/people?${query}` : '/admin/people';
}

// What happened to a link's email, after the person's name. lib/mail.js's
// reasons, lib/people.js's `unsaved`, and approve.js's `not-approved`. A
// refused send deletes the new link and leaves any earlier one working
// (lib/people.js, sendLink), and the refusals say so.
const KEPT = 'Any link they had before still works.';
const MAIL_OUTCOMES = {
  sent: () => `The email with a link to set a password was sent. The link works for ${LINK_DAYS} days, and any earlier link no longer does.`,
  unreachable: () => 'Resend did not confirm the email with the link: it did not answer in time, or answered with a server error. It may still arrive, so ask before sending a new link. Until a send is confirmed, any earlier link still works too.',
  quota: () => `The email with the link was not sent: Resend's free limit of 100 emails a day is used up. ${KEPT} The limit resets at midnight UTC; press "Send a new link" then.`,
  rate: () => `The email with the link was not sent: Resend had too many requests in the same second. ${KEPT} Press "Send a new link" to try again.`,
  'not-configured': () => `The email with the link was not sent: this environment has no RESEND_API_KEY secret. ${KEPT}`,
  unsaved: () => `No email was sent: the site could not read the account or store the link. ${KEPT} Press "Send a new link" to try again.`,
  'not-approved': () => 'No email was sent: by the time the link was made, the account held no approved team. It may have been deleted by hand.',
};
const mailOutcome = (mail) => (Object.hasOwn(MAIL_OUTCOMES, mail)
  ? MAIL_OUTCOMES[mail]()
  : `The email with the link was not sent: Resend refused it, and the log names why. ${KEPT} Press "Send a new link" to try again.`);

const ERRORS = {
  form: 'Nothing was changed: the press did not say whose request it was, or no team was ticked. Tick at least one team.',
  gone: 'Nothing was changed: no ticked team was still waiting for that, so another admin may have got to it first. The lists below are as they are now.',
  'not-approved': 'No link was sent: that account is not approved for any team, or no longer exists.',
  unchanged: 'Nothing was changed. The press reached the site as a page load, which never changes anything; this can happen when your sign-in has run out. Press it again.',
  // #224
  'not-promoted': 'Nothing was changed: that person is already an admin, is no longer approved for a team, or no longer exists. The lists below are as they are now.',
  'not-demoted': 'Nothing was changed: that person is not an admin now, or is the owner, whose role stays. The lists below are as they are now.',
  'not-owner': 'Nothing was changed: only the owner removes an admin.',
  // #225
  'not-revoked': 'Nothing was changed: no ticked team is approved now, the person is an admin, whom the owner removes as one first, or the account no longer exists. The lists below are as they are now.',
  'not-hidden': 'Nothing was changed: that account has no photo waiting or public now, or no longer exists.',
  'hide-unticked': 'Nothing was changed: tick the box naming their photos to hide them.',
  'delete-unticked': 'Nothing was deleted: tick the box once a reply from the account\'s own address has confirmed that they asked for it.',
  'not-deleted': 'Nothing was deleted: the person is an admin, whom the owner removes as one first, or the account no longer exists.',
  address: 'Nothing was changed: type one email address, like name@example.com.',
  'not-held': 'Nothing was changed: that address is not held back, so a request from it is taken as any other is.',
  'has-account': 'Nothing was changed: that address still has an account. To take the person back, find them in the lists above and approve their revoked team there.',
  unmatched: 'Nothing was changed: that address is held back, but no entry in the log names it as typed. Type it as the log shows it.',
  unconfigured: 'Nothing was changed: this environment has no ADDRESS_HASH_KEY secret, which a revoked address is kept with.',
};

const count = (value) => (/^[1-9][0-9]{0,5}$/.test(value ?? '') ? Number(value) : 0);

/**
 * The notice for the page's query string, as HTML, or '' for none. `lists`
 * is lib/people.js's peopleLists(), which the named account is looked up in.
 */
export function peopleNotice(params, lists) {
  const id = /^[1-9][0-9]{0,14}$/.test(params.get('account') ?? '') ? Number(params.get('account')) : null;
  const found = id === null ? undefined : [...lists.waiting, ...lists.approved, ...lists.revoked, ...lists.turnedDown].find((p) => p.id === id);
  const name = found ? escapeHtml(found.name) : 'The account';
  const done = params.get('done');
  const error = params.get('error');
  let text = null;
  if (done === 'approved') text = `Approved ${name}. ${mailOutcome(params.get('mail'))}`;
  else if (done === 'rejected') text = `Turned down ${name}. Nothing was emailed to them.`;
  else if (done === 'link') text = `${mailOutcome(params.get('mail'))}`;
  else if (done === 'promoted') text = `${name} is an admin, and is signed out on every phone and computer. The admin pages open to them the next time they sign in, which asks for a code the site emails them. Nothing was emailed now.`;
  else if (done === 'demoted') text = `${name} is no longer an admin. The admin pages are closed to them from their next request, and their account can still send photos.`;
  else if (done === 'revoked') text = `Revoked ${name}. They are signed out on every phone and computer, and can sign in again only for a team they are still approved for. Their approved photos stay up, and nothing was emailed to them.`;
  else if (done === 'hidden') {
    const hidden = count(params.get('hidden'));
    const waiting = count(params.get('waiting'));
    const which = waiting ? `, ${waiting} of them still waiting for approval` : '';
    text = `Hid ${plural(hidden, 'photo', 'photos')} ${name} sent${which}. Each waits on <a href="/admin/removals">Removal requests</a>, to be put back or deleted for good${waiting ? '. A photo that was waiting goes back to the queue if it is put back, not onto the site' : ''}.`;
  } else if (done === 'deleted') text = 'Deleted the account. The photos it sent stay and no longer name it, the log keeps its entries, and if it had been revoked, its address stays held back.';
  else if (done === 'allowed') text = 'That address can ask for an account again. Nothing was emailed to it.';
  else if (Object.hasOwn(ERRORS, error)) text = ERRORS[error];
  if (done === 'link' && found) text = `${name}: ${text}`;
  return text ? `\n    <p role="status">${text}</p>` : '';
}

// Every team, with where it stands: "Hoover JRT: waiting · COHSSA: approved".
const teamStates = (person) => person.teams.map((t) => `${escapeHtml(t.name)}: ${STATE_NAMES[t.state] ?? escapeHtml(t.state)}`).join(' · ');

// What the decision form's box set is called, by the states its teams are in:
// waiting, turned down, or revoked (#225), which approving takes back.
function decisionLegend(open) {
  if (open.some((t) => t.state === 'requested')) return 'Teams to decide';
  const rejected = open.some((t) => t.state === 'rejected');
  const revoked = open.some((t) => t.state === 'revoked');
  if (rejected && revoked) return 'Teams turned down or revoked';
  return revoked ? 'Teams revoked' : 'Teams turned down';
}

// The decision form: a box per team still to decide, ticked when it waits,
// the role, Approve, and Turn down when anything waits. A turned-down or
// revoked team keeps an unticked box under Approve. Each id carries the
// account's, so every label names its own box.
function decisionForm(person) {
  const id = `person-${person.id}`;
  const open = person.teams.filter((t) => t.state === 'requested' || t.state === 'rejected' || t.state === 'revoked');
  if (open.length === 0) return '';
  const waits = open.some((t) => t.state === 'requested');
  // The key comes from the teams table, which a foreign key holds to its two
  // rows; it is escaped anyway, as everything put into markup here is
  // (#221's security audit).
  const boxes = open.map((t) => `<label><input type="checkbox" name="team" value="${escapeHtml(t.team)}"${t.state === 'requested' ? ' checked' : ''}> ${escapeHtml(t.name)}</label>`)
    .join('\n          ');
  const roles = ROLES.map((role) => `<option value="${role}"${role === person.role ? ' selected' : ''}>${ROLE_NAMES[role]}</option>`).join('');
  const name = escapeHtml(person.name);
  const reject = waits
    ? `\n          <button type="submit" class="button button-quiet" formaction="/api/admin/people/reject" aria-label="Turn down ${name}">Turn down</button>`
    : '';
  return `<form method="post" action="/api/admin/people/approve" class="album-form person-form">
        <input type="hidden" name="account" value="${person.id}">
        <fieldset class="field">
          <legend>${decisionLegend(open)}</legend>
          <p class="choices">
          ${boxes}
          </p>
        </fieldset>
        <p class="field">
          <label for="${id}-role">Role</label>
          <select id="${id}-role" name="role">${roles}</select>
        </p>
        <p class="actions">
          <button type="submit" class="button" aria-label="Approve ${name}">Approve</button>${reject}
        </p>
      </form>`;
}

// "Send a new link", for anyone approved for a team.
function linkForm(person) {
  if (!person.teams.some((t) => t.state === 'approved')) return '';
  return `<form method="post" action="/api/admin/people/link">
        <button type="submit" class="button button-quiet" name="account" value="${person.id}" aria-label="Send a new link to ${escapeHtml(person.name)}">Send a new link</button>
      </form>`;
}

const ADMIN_ROLE_NAMES = { owner: 'the owner', admin: 'an admin' };

// "Make admin" for anyone approved for a team who is not one, which any
// admin may press; "Remove admin" for an admin who is not the owner, drawn
// only for the owner, who alone may press it (#224). `viewer` is the admin
// the page is for (lib/admin-session.js's context.data.admin).
function adminForm(person, viewer) {
  if (!person.teams.some((t) => t.state === 'approved')) return '';
  const name = escapeHtml(person.name);
  if (person.adminRole === null) {
    // Each name starts with the button's own words (WCAG 2.5.3; #225's
    // ux-design audit, where "Make <name> an admin" did not contain "Make
    // admin"), so a speech-input user who says what they see reaches it.
    return `<form method="post" action="/api/admin/people/promote">
        <button type="submit" class="button button-quiet" name="account" value="${person.id}" aria-label="Make admin: ${name}">Make admin</button>
      </form>`;
  }
  if (person.adminRole === 'admin' && viewer.role === 'owner') {
    return `<form method="post" action="/api/admin/people/demote">
        <button type="submit" class="button button-quiet" name="account" value="${person.id}" aria-label="Remove admin: ${name}">Remove admin</button>
      </form>`;
  }
  return '';
}

// Revoke (#225), for a person approved for a team who holds no admin role: a
// box per approved team, none ticked, so a press with nothing ticked changes
// nothing. Ticking every one revokes the account.
function revokeForm(person) {
  const approved = person.teams.filter((t) => t.state === 'approved');
  if (approved.length === 0 || person.adminRole !== null) return '';
  const boxes = approved.map((t) => `<label><input type="checkbox" name="team" value="${escapeHtml(t.team)}"> ${escapeHtml(t.name)}</label>`)
    .join('\n            ');
  return `<form method="post" action="/api/admin/people/revoke" class="album-form person-form">
          <input type="hidden" name="account" value="${person.id}">
          <fieldset class="field">
            <legend>Teams to revoke</legend>
            <p class="choices">
            ${boxes}
            </p>
          </fieldset>
          <p class="actions">
            <button type="submit" class="button button-quiet" aria-label="Revoke ${escapeHtml(person.name)} for the ticked teams">Revoke</button>
          </p>
        </form>`;
}

// "Hide all their photos" (#225), for an account with a photo waiting or
// public. Its box names the count and must be ticked, here and by the route.
function hideForm(person) {
  const { waiting, approved } = person.photos;
  const total = waiting + approved;
  if (total === 0) return '';
  const name = escapeHtml(person.name);
  const which = [approved ? `${approved} public` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean).join(', ');
  return `<form method="post" action="/api/admin/people/hide" class="album-form person-form">
          <input type="hidden" name="account" value="${person.id}">
          <p class="choices"><label><input type="checkbox" name="confirm" value="hide" required> Hide the ${plural(total, 'photo', 'photos')} ${name} sent (${which})</label></p>
          <p class="actions">
            <button type="submit" class="button button-quiet" aria-label="Hide all their photos: ${name}">Hide all their photos</button>
          </p>
        </form>`;
}

// Delete (#225), for anyone who holds no admin role. Its box is the admin's
// word that a reply from the account's own address confirmed the request,
// which the site cannot read for itself, and must be ticked, here and by the
// route.
function deleteForm(person) {
  if (person.adminRole !== null) return '';
  return `<form method="post" action="/api/admin/people/delete" class="album-form person-form">
          <input type="hidden" name="account" value="${person.id}">
          <p class="choices"><label><input type="checkbox" name="replied" value="yes" required> ${escapeHtml(person.email)} replied to confirm they asked for this</label></p>
          <p class="actions">
            <button type="submit" class="button button-quiet" aria-label="Delete the account of ${escapeHtml(person.name)}">Delete the account</button>
          </p>
        </form>`;
}

// The three #225 forms that apply to a person, behind one native <details>,
// so the page stays a list of people and a stray press has a step in front of
// it. Its summary names only what is inside.
function moreForms(person) {
  const parts = [
    ['revoke', revokeForm(person)],
    ['hide their photos', hideForm(person)],
    ['delete', deleteForm(person)],
  ].filter(([, form]) => form);
  if (parts.length === 0) return '';
  const words = parts.map(([word]) => word);
  const summary = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
  return `<details class="person-more">
        <summary>${summary[0].toUpperCase()}${summary.slice(1)}</summary>
        ${parts.map(([, form]) => form).join('\n        ')}
      </details>`;
}

function personItem(person, viewer) {
  const note = person.note === null
    ? '<p class="person-note person-note-none">No note was left.</p>'
    : `<p class="person-note">${escapeHtml(person.note)}</p>`;
  const forms = [decisionForm(person), linkForm(person), adminForm(person, viewer), moreForms(person)].filter(Boolean).join('\n      ');
  const admin = Object.hasOwn(ADMIN_ROLE_NAMES, person.adminRole ?? '') ? ` · ${ADMIN_ROLE_NAMES[person.adminRole]}` : '';
  return `<li class="person" id="person-${person.id}">
      <h3>${escapeHtml(person.name)}</h3>
      <p class="person-facts">${escapeHtml(person.email)} · ${ROLE_NAMES[person.role] ?? escapeHtml(person.role)}${admin} · asked ${timeElement(person.requestedAt)}</p>
      <p class="person-teams">${teamStates(person)}</p>
      ${note}${forms ? `\n      ${forms}` : ''}
    </li>`;
}

const peopleList = (people, empty, viewer) => (people.length
  ? `<ul class="people">\n    ${people.map((person) => personItem(person, viewer)).join('\n    ')}\n    </ul>`
  : `<p class="people-empty">${empty}</p>`);

// One log entry as a sentence. The person is named as the entry recorded
// them, which outlives their account; an action this page does not know
// (a later story's) is shown by its word.
function logSentence({ admin, action, name, email, detail }) {
  const who = escapeHtml(admin);
  const whom = `${escapeHtml(name)} (${escapeHtml(email)})`;
  const what = detail === null ? '' : escapeHtml(detail);
  switch (action) {
    case 'approve': return `${who} approved ${whom} for ${what}.`;
    case 'reject': return `${who} turned down ${whom} for ${what}.`;
    case 'role': return `${who} changed the role of ${whom} from ${what}.`;
    case 'link':
      if (detail === 'sent') return `${who} emailed ${whom} a link to set a password.`;
      if (detail === 'unconfirmed') return `${who} emailed ${whom} a link to set a password, which Resend did not confirm.`;
      if (detail === 'unrecorded') return `${who} made ${whom} a link to set a password; how its email went was not recorded.`;
      return `${who} pressed to email ${whom} a link to set a password, which was not sent (${escapeHtml((detail ?? '').replace(/^not sent: /, ''))}).`;
    case 'promote': return `${who} made ${whom} an admin.`;
    case 'demote': return `${who} removed ${whom} as an admin.`;
    // #225
    case 'revoke': return `${who} revoked ${whom} for ${what}.`;
    case 'hide': return `${who} hid every photo ${whom} sent, ${what}.`;
    case 'delete': return `${who} deleted the account of ${whom}, once a reply from its address confirmed the request.`;
    case 'allow': return `${who} let the address of ${whom} ask for an account again.`;
    default: return `${who}: ${escapeHtml(action)} ${whom}${what ? `, ${what}` : ''}.`;
  }
}

function logSection({ entries, total }) {
  const intro = total === 0
    ? 'Nothing is logged yet. Every approval, turn-down, role change, link sent, admin made or removed, revoke, hidden set of photos, deleted account and address let ask again will be.'
    : `Newest first. The log keeps every entry, and each names the person as they were when it was made, even after their account is deleted.${total > LOG_SHOWN ? ` The newest ${LOG_SHOWN} of ${total} are shown.` : ''}`;
  const items = entries.map((entry) => `<li>${timeElement(entry.at)}: ${logSentence(entry)}</li>`).join('\n      ');
  return `<section class="wrap" aria-labelledby="admin-log">
    <h2 id="admin-log">The admins' log</h2>
    <p>${intro}</p>${entries.length ? `\n    <ul class="admin-log">\n      ${items}\n    </ul>` : ''}
  </section>`;
}

/**
 * /admin/people (#221). `lists` is lib/people.js's peopleLists(), `log` its
 * adminLog(), `notice` peopleNotice()'s HTML, and `viewer` the admin the page
 * is for, whose role decides which admin buttons it draws (#224).
 */
export function adminPeoplePage({ lists, log, notice = '', viewer }) {
  const { waiting, approved, revoked, turnedDown } = lists;
  const removes = viewer.role === 'owner'
    ? 'As the owner, you can also remove an admin.'
    : 'Only the owner can remove one.';
  return adminPage({
    title: 'People',
    main: `<main id="main">
  <section class="wrap page-head">
    <p class="eyebrow">Admin</p>
    <h1>People</h1>
    <p class="lede">Anyone can ask for an account at <code>/ask</code>. Approve
      each team they asked for on its own. Approving emails them a link to set
      a password, which can be used once, for ${LINK_DAYS} days; turning down
      sends nothing.</p>${notice}
  </section>

  <section class="wrap" aria-labelledby="people-waiting">
    <h2 id="people-waiting">Waiting</h2>
    <p>${waiting.length ? `${plural(waiting.length, 'request waits', 'requests wait')}, the oldest first.` : 'No request is waiting.'}</p>
    ${peopleList(waiting, 'A request someone sends at /ask appears here.', viewer)}
  </section>

  <section class="wrap" aria-labelledby="people-approved">
    <h2 id="people-approved">Approved</h2>
    <p>People approved for at least one team, with nothing left waiting.
      "Send a new link" emails a new link to set a password, and the last one
      stops working.</p>
    <p>Any admin can make an approved person an admin. ${removes} An admin
      signs in with their password and a code the site emails them, and the
      admin pages stay open for ${ADMIN_SESSION_HOURS} hours at a time.</p>
    <p>Under each person, "Revoke" takes away the ticked teams and signs them
      out on every phone and computer; their approved photos stay up.
      "Hide all their photos" takes down every photo they sent, waiting or
      public, to <a href="/admin/removals">Removal requests</a>. "Delete the
      account" is for a person who asked by email, once a reply from the
      account's own address confirms it. An admin is revoked or deleted only
      once the owner removes them as an admin.</p>
    ${peopleList(approved, 'Nobody is approved yet.', viewer)}
  </section>

  <section class="wrap" aria-labelledby="people-revoked">
    <h2 id="people-revoked">Revoked</h2>
    <p>People revoked from every team. Their account cannot sign in or send,
      their approved photos stay up, and a new request from their address
      changes nothing. To take someone back, tick a team and approve it, which
      emails them a link to set a password as any approval does.</p>
    <p>Until the invite link and the coaches' sign-in retire, someone revoked
      can still send through either: with the invite link they hold, or a new
      join from it, or a coach's sign-in if their address is on the coaches'
      list. What they send that way waits for approval and names no account.
      Rotate the invite code on <a href="/admin/code">Invite code</a>, or take
      them off the coaches' list, to end that.</p>
    ${peopleList(revoked, 'Nobody is revoked.', viewer)}
    <h3 id="ask-again">A deleted account's address</h3>
    <p>When a revoked account is deleted, its address stays held back, kept
      only in a scrambled form, so a new request from it still changes
      nothing. To let it ask for an account again, type the address. Nothing
      is emailed to it.</p>
    <form method="post" action="/api/admin/people/allow" class="album-form">
      <p class="field">
        <label for="ask-again-email">Email address</label>
        <input type="email" id="ask-again-email" name="email" autocomplete="off" required>
      </p>
      <p class="actions">
        <button type="submit" class="button button-quiet">Let it ask again</button>
      </p>
    </form>
  </section>

  <section class="wrap" aria-labelledby="people-turned-down">
    <h2 id="people-turned-down">Turned down</h2>
    <p>Nothing was emailed to them, and if they ask again nothing changes.
      To change your mind, tick a team and approve it here.</p>
    ${peopleList(turnedDown, 'Nobody is turned down.', viewer)}
  </section>

  ${logSection(log)}
</main>`,
  });
}
