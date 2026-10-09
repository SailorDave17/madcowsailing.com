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
//
// Since #274 the same holds for two more places an admin's thumb lands. The
// admin home's "Forget this phone" and Sign out are 48 px square, on a
// 12-hour home and a remembered one alike. The code step's "Remember this
// phone for 30 days" is a 48 px row on a phone, and the rule doing it wins
// the cascade over the padded label every sign-in form's choices share,
// while no other sign-in form's labels change.
//
// Since #310 /admin/removals lists a clip Hide all took down, and its row is
// a photo row's on a phone (criterion 7). Its two buttons sit in the rule
// that makes them 48 px, its words wrap by the rules a photo row's do, and
// its player is no wider than the row. That last rests on two things: the
// page gives the player a photo row's size, its frame scaled to a grid
// image's 480 px long edge (clipBox), and base.css's max-width: 100% holds
// that within a narrower row, with nothing in site.css widening it. base.css
// alone already held every video before #310, so the size is what a revert
// would undo, and the test reads it. Each holds with a control showing it can
// fail. The 320 to 430 px reading of a clip's row is a browser's, in #310's
// PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminAlbumsPage, adminHome, adminRemovalsPage, albumsNotice } from '../lib/admin-page.js';
import { allAlbums, createAlbum, setAlbumOpen } from '../lib/albums.js';
import { adminPeoplePage, peopleNotice } from '../lib/people-page.js';
import { SIZES } from '../lib/photos.js';
import { codePage } from '../lib/sign-in-page.js';
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
// A person as lib/people.js's peopleLists() gives one, with its clips
// counted beside its photos since #310: Hide all hides both, and the page
// reads both to draw it.
const person = (id, over) => ({
  id, name: `Person ${id}`, email: `p${id}@example.org`, role: 'parent', adminRole: null, note: null,
  requestedAt: NOW, teams: [], photos: { waiting: 0, approved: 0 }, clips: { waiting: 0, approved: 0 }, ...over,
});
// Everyone the page draws a button for: a request with a team turned down
// beside it, an approved parent with photos (Revoke, Hide and Delete), an
// admin (Remove admin, for the owner), the owner, one revoked, one turned down.
// The parent sent no clip, so Hide all reads as it did before clips; its
// words for one who did are held by test/people.test.js (#310, criterion 3).
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

// Rows as lib/removals.js's hiddenPhotos() gives them since #310: a photo
// with its grid size, and a clip with its frame size and how long it runs.
const hidden = (id, over) => ({
  id, kind: 'photo', sender: 'parent', caption: null, hiddenAt: NOW, note: null, waiting: false, accountName: null,
  album: { title: 'Fall Regatta', address: '2026-10-04-fall-regatta', team: 'hoover-jrt' },
  grid: { width: 480, height: 360 }, ...over,
});
const hiddenClip = (id, over) => ({
  id, kind: 'clip', sender: 'parent', caption: null, hiddenAt: NOW, note: null, waiting: false, accountName: null,
  album: { title: 'Fall Regatta', address: '2026-10-04-fall-regatta', team: 'hoover-jrt' },
  width: 1080, height: 1920, durationMs: 30_500, ...over,
});
// Clip 9 (#310, criterion 7): a coach's, hidden by Hide all while it still
// waited, so with no note, from an account deleted since, so it names its
// sender by role. Upright and full size, so its frame alone is 1080 px wide,
// past any phone; the page draws it at 270 x 480 (clipBox).
const removalsPage = () => adminRemovalsPage({
  photos: [
    hidden(7, { accountName: 'Pat', caption: 'At the mark', note: 'Please take this down.' }),
    hidden(8, { waiting: true }),
    hiddenClip(9, { sender: 'coach', caption: 'Rounding the leeward mark', waiting: true }),
  ],
});

const main = (html) => html.match(/<main[\s>][\s\S]*?<\/main>/)?.[0] ?? '';

// The clip's row on the removals page, as it draws it, or '' for none.
const clipRow = (html) => main(html).match(/<li class="removal" id="photo-9">[\s\S]*?<\/li>/)?.[0] ?? '';

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
  // Each photo's and the clip's Put it back and Delete permanently (the
  // clip's since #310); the dialog's Cancel and Delete.
  assert.equal(count(drawn.removals), 8);
  // #310, criterion 7: the clip's row is a row `.removal .button` takes, and
  // holds its own two, each wearing the class that rule names.
  assert.deepEqual([...clipRow(drawn.removals).matchAll(/<button\b[^>]*\sclass="button\b[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]),
    ['Put it back', 'Delete permanently']);
  for (const [name, html] of Object.entries(drawn)) {
    assert.doesNotMatch(uncovered(html), /<button\b|class="button\b/, `${name} draws a button outside every block the 48 px rule covers`);
  }
  // The control: a button outside those blocks is found.
  assert.match(uncovered(drawn.removals.replace('</main>', '<p><button type="button" class="button">Stray</button></p></main>')), /<button\b/);
  // And so is the clip's row, were it drawn as anything but a removal row.
  assert.match(uncovered(drawn.removals.replace('<li class="removal" id="photo-9">', '<li class="clip" id="photo-9">')), /<button\b/);
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
  // #310, criterion 7: a hidden clip's row puts its length, frame size and
  // sender in the same facts line, and its caption in the same caption, so
  // the rules above wrap them as they wrap a photo's.
  const clip = clipRow(removalsPage());
  assert.match(clip, /<p class="removal-facts">In Fall Regatta · Hoover JRT · hidden <time[^>]*>[^<]*<\/time> · 0:31 long · 1080 × 1920 · sent by a coach · was waiting for approval, so putting it back returns it to the queue<\/p>/);
  assert.match(clip, /<p class="removal-caption">Caption: Rounding the leeward mark<\/p>/);
  // And no line of it is outside those rules: its paragraphs are the facts,
  // the caption and the note, which wraps by #158's rule, all in `typed`.
  const paragraphs = [...clip.matchAll(/<p\b([^>]*)>/g)].map((m) => m[1].match(/\sclass="([^"\s]+)/)?.[1] ?? '(no class)');
  assert.deepEqual(paragraphs, ['removal-facts', 'removal-caption', 'removal-note']);
  for (const name of paragraphs) assert.ok(typed.includes(`.${name}`), `.${name} is not in the list held to wrap`);
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
  // Removals has no field, a clip's row (#310) included: its player is none.
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
  // A photo's row, and since #310 a clip's (criterion 7), which the phone
  // rules below take by the same shape.
  for (const id of [7, 9]) {
    const actions = html.match(new RegExp(`<li class="removal" id="photo-${id}">[\\s\\S]*?<div class="actions">([\\s\\S]*?)<\\/div>`))?.[1];
    assert.ok(actions !== undefined, `no actions in row ${id}`);
    // Put it back is a form; Delete permanently, after it, is a button that posts nothing itself.
    assert.match(actions, new RegExp(`^\\s*<form method="post" action="\\/api\\/admin\\/removals\\/restore">[\\s\\S]*?Put it back<\\/button>\\s*<\\/form>\\s*<button type="button" class="button button-quiet" data-delete="${id}"[^>]*>Delete permanently<\\/button>\\s*$`), `row ${id}`);
  }
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

// ---- #274: the admin home's buttons, and the code step's remember row ----

test('#274 criterion 4: Forget this phone and Sign out, the admin home\'s only buttons, are in the rule that makes them 48 px square, on a 12-hour home and a remembered one', () => {
  const body = top('.admin-sign-in .button');
  assert.ok(body, 'no top-level rule names .admin-sign-in .button');
  for (const side of ['min-height', 'min-width']) {
    assert.equal(declared(body, side), '--space-6', `.admin-sign-in .button ${side} is not --space-6`);
  }
  assert.equal(tokenPx('--space-6'), 48);
  // <main> with the section that rule names taken out.
  const outside = (html) => main(html).replace(/<section class="wrap admin-sign-in"[\s\S]*?<\/section>/, '');
  // Something waiting on each to-do item, so each is drawn in its everyday class.
  const summary = { waiting: 1, requests: 1, removals: 1, bytes: 0 };
  for (const seconds of [43_200, 2_592_000]) {
    const html = adminHome({ ...VIEWER, seconds }, summary);
    assert.deepEqual([...main(html).matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]), ['Forget this phone', 'Sign out'], `at ${seconds} seconds`);
    assert.doesNotMatch(outside(html), /<button\b/, `at ${seconds} seconds a button is drawn outside .admin-sign-in`);
    // The rest wearing the button class are the to-do list's links, which
    // .todo-item makes full width and at least 44 px tall (test/admin-page.test.js).
    assert.deepEqual([...outside(html).matchAll(/<([a-z]+)\b[^>]*\sclass="(button\b[^"]*)"/g)].map(([, tag, classes]) => `${tag} ${classes}`),
      ['a button todo-item', 'a button todo-item', 'a button todo-item'], `at ${seconds} seconds`);
  }
  // The control: a button planted outside that section is found.
  const stray = adminHome(VIEWER, summary).replace('</main>', '<p><button type="button" class="button">Stray</button></p></main>');
  assert.match(outside(stray), /<button\b/);
});

// Where each rule in `css` naming `selector` starts, as offsets into `css`.
function starts(css, selector) {
  const found = [];
  let at = 0;
  for (const chunk of css.split('}')) {
    const [selectors, body] = chunk.split('{');
    if (body !== undefined && selectors.split(',').map((s) => s.trim()).includes(selector)) found.push(at + selectors.search(/\S/));
    at += chunk.length + 1;
  }
  return found;
}
const PHONE_BLOCK = /@media \(max-width: 30rem\) \{([\s\S]*?)\n\}/g;
// Both as offsets into the uncommented sheet: the top level's with every
// @media block blanked to spaces of its own length, and each phone block's
// from where the block's body starts.
const topStarts = (css, selector) => starts(uncommented(css).replace(/@media[^{]*\{[\s\S]*?\n\}/g, (m) => ' '.repeat(m.length)), selector);
const phoneStarts = (css, selector) => [...uncommented(css).matchAll(PHONE_BLOCK)]
  .flatMap((m) => starts(m[1], selector).map((at) => m.index + m[0].indexOf('{') + 1 + at));
// Whether the remember row's phone rule comes after every top-level rule for
// `.ask-form .choices label`, which it ties, so that it wins the cascade.
const rememberWins = (css) => {
  const own = phoneStarts(css, '.ask-form .code-remember label');
  const shared = topStarts(css, '.ask-form .choices label');
  assert.equal(own.length, 1, 'not exactly one phone rule for the remember row');
  assert.ok(shared.length, 'no top-level .ask-form .choices label');
  return own[0] > Math.max(...shared);
};

test('#274 criterion 1: on a phone the code step\'s "Remember this phone" row is 48 px tall, by a rule that follows and so beats the padded label every sign-in choice shares', () => {
  const form = main(codePage()).match(/<form method="post" action="\/sign-in\/code" class="ask-form">[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'no code form with class ask-form');
  // The tick box, unticked, inside its label, inside the row the rule names.
  assert.match(form, /<p class="field choices code-remember">\s*<label><input type="checkbox" id="sign-in-remember" name="remember" value="yes" aria-describedby="sign-in-remember-hint"> Remember this phone for 30 days<\/label>/);
  assert.equal((form.match(/type="checkbox"/g) ?? []).length, 1);
  // The row: a flex row 48 px tall, the gap putting back the space a flex
  // row drops between the box and its words.
  const body = phone('.ask-form .code-remember label');
  assert.match(body, /display: flex;/);
  assert.match(body, /align-items: center;/);
  assert.match(body, /margin-inline-end: 0;/);
  assert.equal(declared(body, 'min-height'), '--space-6');
  assert.equal(tokenPx('--space-6'), 48);
  assert.ok(declared(body, 'gap'), 'no gap token on the remember row');
  // The label also matches the top-level `.ask-form .choices label`, an
  // inline-block with a right margin, at the same specificity (two classes
  // and an element). The later of two ties wins, so the phone rule must
  // come after it in the sheet.
  assert.match(top('.ask-form .choices label'), /display: inline-block;/);
  assert.equal(rememberWins(CSS), true);
  // The control: the same block moved to the top of the sheet loses.
  const flat = uncommented(CSS);
  const own = [...flat.matchAll(PHONE_BLOCK)].find((m) => m[1].includes('.ask-form .code-remember label'));
  assert.ok(own);
  assert.equal(rememberWins(`${own[0]}\n${flat.slice(0, own.index)}${flat.slice(own.index + own[0].length)}`), false);
});

// Every selector inside a block for narrow screens, at any max-width, since
// each of those applies on a phone.
const narrowSelectors = (css) => [...uncommented(css).matchAll(/@media \(max-width: [^)]+\) \{([\s\S]*?)\n\}/g)]
  .flatMap((m) => m[1].split('}').map((chunk) => chunk.split('{')).filter(([, body]) => body !== undefined))
  .flatMap(([selectors]) => selectors.split(',').map((s) => s.trim()));

test('#274 criterion 1: no other sign-in form\'s labels change on a phone, and only the code step draws the remember row', () => {
  const askLabels = (css) => narrowSelectors(css).filter((s) => /\.ask-form\b/.test(s) && /\blabel\b/.test(s));
  assert.deepEqual(askLabels(CSS), ['.ask-form .code-remember label']);
  // Nor does a label rule scoped to no form: the only labels a narrow screen
  // restyles are #271's album-form choices and this row.
  assert.deepEqual(narrowSelectors(CSS).filter((s) => /\blabel\b/.test(s)).sort(), ['.album-form:not(.move) .choices label', '.ask-form .code-remember label']);
  // The row's class is drawn once, by the code step, of every page lib/ renders.
  const drawn = readdirSync(join(ROOT, 'lib')).filter((file) => file.endsWith('.js'))
    .flatMap((file) => (read('lib', file).match(/class="[^"]*\bcode-remember\b/g) ?? []).map(() => file));
  assert.deepEqual(drawn, ['sign-in-page.js']);
  // The control: a phone rule restyling every sign-in choice is found.
  const planted = `${CSS}\n@media (max-width: 30rem) {\n  .ask-form .choices label {\n    display: block;\n  }\n}\n`;
  assert.deepEqual(askLabels(planted), ['.ask-form .code-remember label', '.ask-form .choices label']);
});

// ---- #310: a hidden clip's player on /admin/removals --------------------

// Every width `css` sets, at any screen width, on the removals clip player or
// on a box it sits in, as [selector, property, value]: each width, min-width,
// max-width or inline-size form, the last declaration of a rule included
// where it has no `;`, in a rule whose selector ends at a video, at any child
// (*), at a div, li or ul by its tag, or at a row, the list or the clip's box
// by class, and either names the removals list or names no class, id or
// attribute at all, so reaches every video. The @media and @supports heads
// are dropped first, so a rule inside one is read as any other, as `sized`
// reads them above. Its limit: a selector reaching the player some other
// way, by a class the row does not name, is not read. (#310's review found
// the first form missed a declaration with no `;` and a box reached by its
// tag, `.removal > div`.)
const PLAYER_OR_BOX = /(?:^|[\s>+~])(?:video|div|li|ul|\*|\.removals?|\.removal-clip)(?![\w-])[^\s>+~]*$/;
const playerWidths = (css) => uncommented(css).replace(/@(?:media|supports)[^{]*\{/g, '').split('}')
  .map((chunk) => chunk.split('{'))
  .filter(([, body]) => body !== undefined)
  .flatMap(([selectors, body]) => selectors.split(',').map((s) => s.trim())
    .filter((s) => (s.includes('.removal') || !/[.#[]/.test(s)) && PLAYER_OR_BOX.test(s))
    .flatMap((s) => [...body.matchAll(/(?:^|[\s;])((?:min-|max-)?(?:width|inline-size))\s*:\s*([^;]+?)\s*(?=;|$)/g)].map((m) => [s, m[1], m[2].trim()])));

test('#310 criterion 7: a hidden clip\'s player on /admin/removals is no wider than its row: drawn at a photo row\'s size, held to the row by base.css, and widened by nothing in site.css, at every width', () => {
  // The player sits straight in its box, a block of the row's own after the
  // facts line. Its frame is 1080 x 1920, past any phone; the page draws it
  // at a photo row's size, the frame scaled to a grid image's long edge
  // (owner, at #310's review): 270 x 480, where the frame size is what a
  // revert of #310's sizing would put back.
  const row = clipRow(removalsPage());
  assert.match(row, /<\/p>\s*<div class="removal-clip">\s*<video controls preload="none" width="270" height="480" src="\/api\/admin\/clips\/9">[\s\S]*?<\/video>\s*<\/div>/);
  assert.equal(480, SIZES.grid.longEdge);
  assert.equal((row.match(/<video\b/g) ?? []).length, 1);
  // A row narrower than that, a phone's, holds it by base.css's rule for
  // every video: no wider than its box, its height following its width.
  assert.ok(rulesFor(topLevel(BASE), 'video').some((body) => /max-width: 100%;/.test(body) && /height: auto;/.test(body)), 'base.css no longer holds a video to its box');
  // site.css's own rule gives it night water until Play, and no width.
  const rule = top('.removal-clip video');
  assert.match(rule, /background: var\(--deep\);/);
  // And nothing in site.css sizes the player or a box around it: no
  // min-width and no fixed width, at any screen width, which would undo
  // both the size and base.css's hold.
  assert.deepEqual(playerWidths(CSS), []);
  // The controls: a fixed-width player planted in a phone block is found, as
  // is a width on its box, on every child of a row, on a div reached by its
  // tag, and a last declaration with no `;`.
  const planted = (rule) => playerWidths(`${CSS}\n@media (max-width: 30rem) {\n  ${rule}\n}\n`);
  assert.deepEqual(planted('.removal-clip video { width: 100%; max-width: min(100%, calc(5 * var(--space-8))); }'),
    [['.removal-clip video', 'width', '100%'], ['.removal-clip video', 'max-width', 'min(100%, calc(5 * var(--space-8)))']]);
  assert.deepEqual(planted('.removal-clip video{min-width:2000px}'), [['.removal-clip video', 'min-width', '2000px']]);
  assert.deepEqual(planted('.removal > div{min-width:2000px;}'), [['.removal > div', 'min-width', '2000px']]);
  assert.deepEqual(planted('.removal div{width:2000px;}'), [['.removal div', 'width', '2000px']]);
  assert.deepEqual(planted('.removal-clip video { min-width: calc(5 * var(--space-8)); }'),
    [['.removal-clip video', 'min-width', 'calc(5 * var(--space-8))']]);
  assert.deepEqual(planted('.removal-clip { width: calc(20 * var(--space-8)); }'),
    [['.removal-clip', 'width', 'calc(20 * var(--space-8))']]);
  assert.deepEqual(planted('.removal > * { min-width: calc(20 * var(--space-8)); }'),
    [['.removal > *', 'min-width', 'calc(20 * var(--space-8))']]);
  assert.deepEqual(planted('video { width: calc(20 * var(--space-8)); max-width: none; }'),
    [['video', 'width', 'calc(20 * var(--space-8))'], ['video', 'max-width', 'none']]);
  // And the queue's player, which is in no removal row, is not read as this one.
  assert.deepEqual(planted('.waiting video { min-width: calc(5 * var(--space-8)); }'), []);
});
