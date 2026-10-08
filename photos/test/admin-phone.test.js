// /admin/people, /admin/albums and /admin/removals on a phone (#271).
//
// The 320 px reading itself is a browser's, and CI has none: it is in the
// PR, at 320, 360, 390, 412 and 430, with a planted 2000 px element as its
// control (the owner's choice at #271's pickup, as at #270). These tests hold
// what that reading rests on. Every button the three pages draw sits inside
// the rule that makes it 48 px square, and every disclosure's padding takes
// it past 44 px. Each thing an admin or a requester typed wraps rather than
// widening the page. On a phone every field runs the full width and each
// choice is a 48 px row. Revoke, hide, delete and "Delete permanently" keep
// their confirm steps, apart from the everyday buttons. And no field is under
// 16 px, the size below which a phone zooms the page on focus.
//
// The pages are rendered by their own functions, over the D1 stand-in where
// a query builds the list, and read as text, as the rest of the suite reads
// them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminAlbumsPage, adminRemovalsPage, albumsNotice } from '../lib/admin-page.js';
import { allAlbums, createAlbum, setAlbumOpen } from '../lib/albums.js';
import { adminPeoplePage, peopleNotice } from '../lib/people-page.js';
import { d1 } from './d1.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CSS = read('public', 'css', 'site.css');
const TOKENS = read('..', 'shared', 'css', 'tokens.css');
const BASE = read('..', 'shared', 'css', 'base.css');
const NOW = 1_790_000_000;

// ---- Reading the stylesheet --------------------------------------------

const uncommented = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The body of each `@media (max-width: 30rem)` block. Each ends with a brace
// at the start of a line, and the rules inside end indented.
const phoneBlocks = (css) => [...uncommented(css).matchAll(/@media \(max-width: 30rem\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);

// The rules outside every @media block.
const topLevel = (css) => uncommented(css).replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');

// The bodies of the rules in `css` whose selector list names `selector`
// exactly. site.css nests nothing but its @media blocks, which the two
// functions above take apart first, so a plain split is enough.
const rulesFor = (css, selector) => css.split('}')
  .map((chunk) => chunk.split('{'))
  .filter(([selectors, body]) => body !== undefined && selectors.split(',').map((s) => s.trim()).includes(selector))
  .map(([, body]) => body);

const top = (selector) => rulesFor(topLevel(CSS), selector).join('\n');
const phone = (selector) => phoneBlocks(CSS).flatMap((block) => rulesFor(block, selector)).join('\n');

// A token's value in px, at the browser's 16 px rem, and a unitless one as is.
const tokenPx = (token) => {
  const value = TOKENS.match(new RegExp(`${token}:\\s*([0-9.]+)(rem)?;`));
  assert.ok(value, `no ${token} in tokens.css`);
  return Number(value[1]) * (value[2] ? 16 : 1);
};
const declared = (body, property) => body.match(new RegExp(`(?:^|[\\s;])${property}: var\\((--[a-z0-9-]+)\\);`))?.[1];

// ---- The pages, every button state drawn -------------------------------

async function albumsPage(query = '') {
  const db = d1();
  await createAlbum(db, { team: 'hoover-jrt', title: 'Fall Regatta', kind: 'regatta', date: '2026-10-04' }, NOW);
  const spring = await createAlbum(db, { team: 'cohssa', title: 'Spring Series', kind: 'regatta', date: '2026-04-11' }, NOW);
  await setAlbumOpen(db, spring, false, NOW);
  // One team's Not sure album closed, so its Reopen is drawn as well as Close.
  await setAlbumOpen(db, db.sqlite.prepare("SELECT address FROM albums WHERE holding = 1 AND team = 'cohssa'").get().address, false, NOW);
  const albums = await allAlbums(db);
  return adminAlbumsPage({ albums, notice: albumsNotice(new URLSearchParams(query), albums) });
}

const team = (key, state) => ({ team: key, name: key === 'cohssa' ? 'COHSSA' : 'Hoover JRT', state });
const person = (id, over) => ({
  id, name: `Person ${id}`, email: `p${id}@example.org`, role: 'parent', adminRole: null, note: null,
  requestedAt: NOW, teams: [], photos: { waiting: 0, approved: 0 }, ...over,
});
// Everyone the page draws a button for: a request with a team turned down
// beside it, an approved parent with photos (Revoke, Hide and Delete), an
// admin (Remove admin, for the owner), the owner, one revoked, one turned down.
const LISTS = {
  waiting: [person(2, { teams: [team('hoover-jrt', 'requested'), team('cohssa', 'rejected')] })],
  approved: [
    person(3, { teams: [team('hoover-jrt', 'approved'), team('cohssa', 'approved')], photos: { waiting: 1, approved: 2 } }),
    person(4, { adminRole: 'admin', teams: [team('hoover-jrt', 'approved')] }),
    person(1, { adminRole: 'owner', teams: [team('hoover-jrt', 'approved')] }),
  ],
  revoked: [person(5, { teams: [team('hoover-jrt', 'revoked')] })],
  turnedDown: [person(6, { teams: [team('cohssa', 'rejected')] })],
};
const VIEWER = { id: 1, name: 'Owner', email: 'p1@example.org', role: 'owner', issued: NOW };
const peoplePage = (query = '') => adminPeoplePage({
  lists: LISTS, log: { entries: [], total: 0 }, notice: peopleNotice(new URLSearchParams(query), LISTS), viewer: VIEWER,
});

const hidden = (id, over) => ({
  id, caption: null, hiddenAt: NOW, note: null, waiting: false, accountName: null, grid: { width: 480, height: 360 },
  album: { title: 'Fall Regatta', address: '2026-10-04-fall-regatta', team: 'hoover-jrt' }, ...over,
});
const removalsPage = () => adminRemovalsPage({
  photos: [hidden(7, { accountName: 'Pat', caption: 'At the mark', note: 'Please take this down.' }), hidden(8, { waiting: true })],
});

const main = (html) => html.match(/<main[\s>][\s\S]*?<\/main>/)?.[0] ?? '';

// What is left of a page's <main> once every block the 48 px rule covers is
// taken out: the delete dialog, an album, a person, a takedown, and an
// .album-form (each a whole <li>, <dialog> or <form>, none nested in its own
// kind). Order matters only for speed; a person's forms go with the person.
const COVERED = [
  /<dialog id="delete-dialog"[\s\S]*?<\/dialog>/g,
  /<li class="removal"[\s\S]*?<\/li>/g,
  /<li class="album"[\s\S]*?<\/li>/g,
  /<li class="person"[\s\S]*?<\/li>/g,
  /<form [^>]*class="album-form[^"]*"[\s\S]*?<\/form>/g,
];
const uncovered = (html) => COVERED.reduce((text, block) => text.replace(block, ''), main(html));

// ---- Criterion 1: buttons, disclosures, sideways scroll, fields ----------

test('#271 criterion 1: every button on people, albums and removals is in the rule that makes it at least 44 px square', async () => {
  const selectors = ['.album .button', '.album-form .button', '.person .button', '.removal .button', '#delete-dialog .button'];
  for (const selector of selectors) {
    const body = top(selector);
    assert.ok(body, `no top-level rule names ${selector}`);
    for (const side of ['min-height', 'min-width']) {
      const token = declared(body, side);
      assert.ok(token, `no ${side} token on ${selector}`);
      assert.ok(tokenPx(token) >= 44, `${selector} ${side} ${token} is ${tokenPx(token)} px, under 44`);
    }
  }
  // Every button each page draws sits in one of those blocks. Each page is
  // drawn with every state its buttons have.
  const drawn = { people: peoplePage('done=approved&account=2&mail=sent'), albums: await albumsPage(), removals: removalsPage() };
  const count = (html) => (main(html).match(/<button\b/g) ?? []).length;
  // Person 2: Approve, Turn down, Delete. Person 3: Send a new link, Make
  // admin, Revoke, Hide, Delete. The admin: Send a new link, Remove admin.
  // The owner: Send a new link. Each of the revoked and turned down: Approve,
  // Delete. Then Let it ask again.
  assert.equal(count(drawn.people), 16);
  // Add album; each event's Save, Close or Reopen, and Delete; each team's
  // Not sure album's Close or Reopen.
  assert.equal(count(drawn.albums), 9);
  // Each photo's Put it back and Delete permanently; the dialog's Cancel and Delete.
  assert.equal(count(drawn.removals), 6);
  for (const [name, html] of Object.entries(drawn)) {
    assert.doesNotMatch(uncovered(html), /<button\b|class="button\b/, `${name} draws a button outside every block the 48 px rule covers`);
  }
  // The control: a button outside those blocks is found.
  assert.match(uncovered(drawn.removals.replace('</main>', '<p><button type="button" class="button">Stray</button></p></main>')), /<button\b/);
});

test('#271 criterion 1: each team filter link, on removals and the queue, is a target at least 44 px square', () => {
  // A link that changes what the list shows is a button to a thumb (the
  // owner's reading of the criterion, before #271's commit gate); it was
  // 18 px tall.
  const body = top('.team-filter a');
  // An inline link takes no min-height, so it is a box of its own.
  assert.match(body, /display: inline-flex;/);
  for (const side of ['min-height', 'min-width']) {
    const token = declared(body, side);
    assert.ok(token, `no ${side} token on .team-filter a`);
    assert.ok(tokenPx(token) >= 44, `.team-filter a ${side} ${token} is ${tokenPx(token)} px, under 44`);
  }
  // The links it covers: every team and each team, in the filter's <nav>,
  // on /admin/removals, and the queue draws the same filter.
  const nav = main(removalsPage()).match(/<nav class="team-filter"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]),
    ['/admin/removals', '/admin/removals?team=hoover-jrt', '/admin/removals?team=cohssa']);
  assert.match(read('lib', 'admin-page.js'), /teamFilter\('\/admin\/queue', team\)/);
});

test('#271 criterion 1: each disclosure, "Edit" and "Revoke, hide their photos or delete", is at least 44 px tall', async () => {
  // A summary is a list item, not a flex row, so its marker stays
  // (native-details: a flex summary has none), and its height is its line
  // plus its block padding: --text-sm at --leading-body, and twice the pad.
  const line = tokenPx('--text-sm') * tokenPx('--leading-body');
  for (const selector of ['.album summary', '.person-more summary']) {
    const body = top(selector);
    assert.match(body, /font-size: var\(--text-sm\);/, `${selector} is not --text-sm`);
    assert.doesNotMatch(body, /display:/, `${selector} sets its own display, which can drop the marker`);
    const pad = declared(body, 'padding-block');
    assert.ok(pad, `no padding-block token on ${selector}`);
    const height = line + 2 * tokenPx(pad);
    assert.ok(height >= 44, `${selector} is ${height} px tall, under 44`);
  }
  // body's line height is the one a summary inherits.
  assert.match(rulesFor(uncommented(BASE), 'body').join(''), /line-height: var\(--leading-body\);/);
  // Every summary the two pages draw is one of those two.
  const albums = main(await albumsPage());
  const people = main(peoplePage());
  assert.equal((albums.match(/<summary\b/g) ?? []).length, (albums.match(/<li class="album">[\s\S]*?<details>\s*<summary\b/g) ?? []).length);
  assert.equal((people.match(/<summary\b/g) ?? []).length, (people.match(/<details class="person-more">\s*<summary\b/g) ?? []).length);
  assert.ok((albums.match(/<summary\b/g) ?? []).length >= 2 && (people.match(/<summary\b/g) ?? []).length >= 4);
  // The control: the pad the summaries had before #271 falls short.
  assert.ok(line + 2 * tokenPx('--space-1') < 44);
});

test('#271 criterion 1: what an admin or a requester typed wraps rather than widening the page at 320 px', async () => {
  // Measured on develop at 320 before #271: an album's 80-character title
  // made /admin/albums 383 px wide, a caption /admin/removals 657, and a
  // notice naming a long name or title 341 to 380.
  const wraps = (css, selector) => rulesFor(topLevel(css), selector).some((body) => /overflow-wrap: anywhere;/.test(body));
  const typed = [
    '.album h3', // an album's title (#271)
    '.album-facts code', // its address (#153)
    '.removal-facts', '.removal-caption', // the album, the sender's name, the caption (#271)
    '.removal-note', // a takedown's note (#158)
    '.page-head [role="status"]', // a notice naming a person, title or address (#271)
    '.person h3', '.person-facts', '.person-note', '.admin-log li', '.person-form .choices label', // people (#221, #225)
    // The queue, folded in at #271's gate: 545 px wide at 320 to 430 from an
    // album's title or a sender's name, and a Move's notice names the event.
    '.batch h2', '.waiting-album', '.waiting-facts', '.waiting > [role="status"]', '.batch > [role="status"]',
  ];
  for (const selector of typed) assert.ok(wraps(CSS, selector), `${selector} does not wrap`);
  // Each is where the page puts what was typed: the notice in the page's head.
  assert.match(main(await albumsPage('done=created&album=2026-10-04-fall-regatta')),
    /<section class="wrap page-head">[\s\S]*?<p role="status">Added Fall Regatta\./);
  assert.match(main(peoplePage('done=approved&account=2&mail=sent')),
    /<section class="wrap page-head">[\s\S]*?<p role="status">Approved Person 2\./);
  assert.match(main(removalsPage()), /<p class="removal-facts">In Fall Regatta · Hoover JRT · hidden <time[^>]*>[^<]*<\/time> · sent by Pat<\/p>/);
  assert.match(main(removalsPage()), /<p class="removal-caption">Caption: At the mark<\/p>/);
  // The queue prints the album's title as its batch heading and in each
  // card, and the sender in each card's facts (lib/admin-page.js).
  const queue = read('lib', 'admin-page.js');
  assert.match(queue, /<section class="wrap batch"[^`]*\n\s*<h2 id="\$\{id\}-title">\$\{title\}<\/h2>/);
  assert.match(queue, /<p class="waiting-album">\$\{escapeHtml\(album\.title\)\}/);
  assert.match(queue, /<p class="waiting-facts">Taken \$\{timeElement\(photo\.capturedAt\)\}\$\{from\}<\/p>/);
  // The control: each of #271's, taken out of the rule that wraps it, no
  // longer wraps. Only a wrapping rule is edited: .waiting-album and
  // .waiting-facts also head #156's type rule, and a first-match edit took
  // them out of that one instead (measured, on this test's first run).
  const unwrap = (css, selector) => topLevel(css).split('}').map((chunk) => {
    const [selectors, body] = chunk.split('{');
    if (body === undefined || !/overflow-wrap: anywhere;/.test(body)) return chunk;
    const list = selectors.split(',').map((s) => s.trim());
    if (!list.includes(selector)) return chunk;
    const kept = list.filter((s) => s !== selector);
    return `\n${kept.length ? kept.join(',\n') : '.not-it'} {${body}`;
  }).join('}');
  for (const selector of ['.album h3', '.removal-facts', '.removal-caption', '.page-head [role="status"]', '.batch h2', '.waiting-album', '.waiting-facts']) {
    const without = unwrap(CSS, selector);
    assert.notEqual(without, topLevel(CSS), `the control could not take ${selector} out`);
    assert.equal(wraps(without, selector), false, `${selector} still wraps with it taken out`);
    // Nothing else stopped wrapping.
    assert.ok(wraps(without, '.person h3'));
  }
});

test('#271 criterion 1: on a phone every field on the three pages runs the full width', async () => {
  // A block of its own, at #270's 30rem, which reaches 430 px, the widest
  // phone #270 measured (phoneBlocks reads only that condition).
  assert.ok(phoneBlocks(CSS).some((block) => block.includes('.removal .actions')), 'no phone block for #271');
  // The date and the role select: 100% on a phone.
  assert.match(phone('.album-form:not(.move) input[type="date"]'), /width: 100%;/);
  assert.match(phone('.person-form select'), /width: 100%;/);
  // The text and email fields reach it at every width: --measure, held to the
  // screen by max-width.
  const text = top('.album-form input[type="text"]');
  assert.match(text, /max-width: 100%;/);
  assert.match(top('.album-form input[type="email"]'), /width: var\(--measure\);/);
  // Every field the pages draw is one of those: a title, a date, an address, a role.
  const fields = [await albumsPage(), peoplePage()].flatMap((html) =>
    [...main(html).matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
      .filter(([, tag, attrs]) => tag !== 'input' || !/type="(hidden|checkbox|radio)"/.test(attrs))
      .map(([, tag, attrs]) => (tag === 'input' ? attrs.match(/type="([a-z]+)"/)[1] : tag)));
  assert.deepEqual([...new Set(fields)].sort(), ['date', 'email', 'select', 'text']);
  // Removals has no field.
  assert.doesNotMatch(main(removalsPage()), /<(input(?![^>]*type="hidden")|select|textarea)\b/);
});

test('#271: on a phone each team, kind or tick box is a 48 px row, and the queue\'s Move choices stay as #270 shipped them', () => {
  const body = phone('.album-form:not(.move) .choices label');
  assert.match(body, /display: flex;/);
  assert.match(body, /margin-inline-end: 0;/);
  const height = declared(body, 'min-height');
  assert.ok(height && tokenPx(height) >= 44, `a choice is ${height && tokenPx(height)} px tall`);
  // The flex row drops the space between the box and its words; the gap puts it back.
  assert.ok(declared(body, 'gap'));
  // The exclusion means something: the queue's Move block is an .album-form
  // with choices of its own (#228), and no phone rule names it.
  assert.match(read('lib', 'admin-page.js'), /<div class="move album-form">[\s\S]*?<p class="choices">/);
  assert.equal(phone('.album-form .choices label'), '');
});

// ---- Criterion 2: the confirm steps, set apart -------------------------

test('#271 criterion 2: Revoke, Hide all and Delete wait behind their disclosure, ticked boxes first, apart from the everyday buttons', () => {
  const li = main(peoplePage()).match(/<li class="person" id="person-3">[\s\S]*?<\/li>/)[0];
  const more = li.match(/<details class="person-more">[\s\S]*?<\/details>/)?.[0];
  assert.ok(more, 'no disclosure');
  // Closed until opened: no open attribute.
  assert.match(more, /^<details class="person-more">/);
  // The everyday buttons come first, outside it.
  const before = li.slice(0, li.indexOf('<details'));
  assert.match(before, />Send a new link</);
  assert.match(before, />Make admin</);
  for (const action of ['revoke', 'hide', 'delete']) {
    assert.doesNotMatch(before, new RegExp(`/api/admin/people/${action}"`), `${action} is outside the disclosure`);
    assert.match(more, new RegExp(`/api/admin/people/${action}"`), `${action} is not in the disclosure`);
  }
  // Each one's own step: Revoke's boxes start unticked; Hide's and Delete's
  // box must be ticked.
  const revoke = more.match(/<form [^>]*\/revoke"[\s\S]*?<\/form>/)[0];
  assert.equal((revoke.match(/type="checkbox"/g) ?? []).length, 2);
  assert.doesNotMatch(revoke, /checked/);
  assert.match(more, /<input type="checkbox" name="confirm" value="hide" required>/);
  assert.match(more, /<input type="checkbox" name="replied" value="yes" required>/);
  // On a phone the disclosure stands further from them, over a rule.
  const apart = phone('.person > .person-more');
  const gap = declared(apart, 'margin-block-start');
  assert.ok(gap && tokenPx(gap) > tokenPx('--space-2'), 'no wider step than the --space-2 between a person\'s parts');
  assert.match(apart, /border-top: var\(--border-hair\);/);
  // It outranks `.person > * + *`, which sets that step for every part.
  assert.match(top('.person > * + *'), /margin-block-start: var\(--space-2\);/);
});

test('#271 criterion 2: "Delete permanently" opens its confirm dialog, and on a phone sits alone below "Put it back", at its end', () => {
  const html = main(removalsPage());
  const actions = html.match(/<li class="removal" id="photo-7">[\s\S]*?<div class="actions">([\s\S]*?)<\/div>/)[1];
  // Put it back is a form; Delete permanently, after it, is a button that posts nothing itself.
  assert.match(actions, /^\s*<form method="post" action="\/api\/admin\/removals\/restore">[\s\S]*?Put it back<\/button>\s*<\/form>\s*<button type="button" class="button button-quiet" data-delete="7"[^>]*>Delete permanently<\/button>\s*$/);
  // The dialog posts, with Cancel first and focused.
  assert.match(html, /<dialog id="delete-dialog"[^>]*>\s*<form method="post" action="\/api\/admin\/removals\/delete">[\s\S]*?<button type="submit" class="button" formmethod="dialog" autofocus>Cancel<\/button>\s*<button type="submit" class="button button-accent" id="delete-confirm"/);
  // On a phone: Put it back's form fills its row, so Delete permanently
  // wraps to the next and is pushed to its end (owner, at #271's pickup).
  assert.match(phone('.removal .actions form'), /flex: 1 1 100%;/);
  assert.match(phone('.removal .actions form .button'), /width: 100%;/);
  assert.match(phone('.removal .actions [data-delete]'), /margin-inline-start: auto;/);
  // The row wraps, which the move relies on.
  assert.match(top('.actions'), /flex-wrap: wrap;/);
});

// ---- Criterion 3: the album forms on a phone ---------------------------

test('#271 criterion 3: the album create and rename forms have a native date picker, and no field under 16 px', async () => {
  const html = main(await albumsPage());
  const forms = [...html.matchAll(/<form method="post" action="\/api\/admin\/albums\/(create|update)" class="album-form">[\s\S]*?<\/form>/g)];
  assert.deepEqual(forms.map((m) => m[1]), ['create', 'update', 'update']);
  for (const [form] of forms) {
    // Team, title, kind and date, the date a native picker with its own label.
    assert.equal((form.match(/type="radio" name="team"/g) ?? []).length, 2);
    assert.equal((form.match(/type="radio" name="kind"/g) ?? []).length, 2);
    assert.match(form, /<label for="([a-z0-9-]+)-title">Title<\/label>\s*<input id="\1-title" name="title" type="text"/);
    assert.match(form, /<label for="([a-z0-9-]+)-date">Date<\/label>\s*<input id="\1-date" name="date" type="date" required/);
  }
  // A phone zooms the page when a focused field's text is under 16 px. Each
  // field takes the font of its paragraph, which is the body's, --text-base,
  // and sits beside its label, never inside one (.album-form label is --text-sm).
  assert.match(top('.album-form input[type="text"]'), /font: inherit;/);
  assert.match(top('.person-form select'), /font: inherit;/);
  assert.match(rulesFor(uncommented(BASE), 'body').join(''), /font-size: var\(--text-base\);/);
  assert.ok(tokenPx('--text-base') >= 16);
  assert.doesNotMatch(html, /<label[^>]*>[^<]*<input[^>]*type="(text|date)"/);
  // No rule sizes an admin field's text, at any width: the @media heads are
  // dropped first, so a rule inside one is read as any other.
  const sized = (css) => uncommented(css).replace(/@media[^{]*\{/g, '').split('}').map((chunk) => chunk.split('{'))
    .filter(([selectors, body]) => body !== undefined && /\b(input|select|textarea)\b/.test(selectors) && /(\.album-form|\.person-form)/.test(selectors) && /font-size:/.test(body));
  assert.deepEqual(sized(CSS), []);
  // The control: a rule shrinking the date field is found.
  assert.equal(sized(`${CSS}\n.album-form input[type="date"] { font-size: var(--text-sm); }`).length, 1);
});
