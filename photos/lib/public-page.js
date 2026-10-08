/**
 * The public pages (#157): the album list at / (functions/index.js) and each
 * album at /albums/<address>/ (functions/albums/[address]/index.js). Since
 * #227 / leads to each team's section, /hoover-jrt/ and /cohssa/
 * (functions/<team>/index.js, through lib/section-route.js), and each section
 * lists its own team's albums.
 *
 * Both are rendered into templates/page.html, which Pages bundles as a text
 * module (developers.cloudflare.com/pages/functions/module-support, read
 * 2026-09-30) and `npm test` loads through test/text-modules.js. The template
 * is a file so the gate reads it like a page: tools/assetver.py stamps it,
 * tools/linkcheck.py checks it, and html-validate reads it (owner's choice at
 * #157's pickup). It holds the head, header, footer and gallery.js; this
 * fills its title and its main.
 *
 * An album page is the markup tools/photos.py writes for a trip log, figure,
 * a.frame and img, so shared/js/gallery.js opens it in its lightbox unchanged.
 * What it cannot carry is the trip log's inline style, which the site's CSP
 * refuses (public/_headers), so the grid is square tiles in fixed columns
 * (public/css/site.css; owner's choice at pickup). Fixed columns are what let
 * the server know which photos are in the first row at every width: those
 * load at once, and every photo below them lazily, as photos.py does for a
 * trip's first row.
 *
 * Every stored text (album titles, captions) is escaped where it is shown:
 * both are kept as typed, markup included (#153, #154).
 *
 * #158 added "Remove this photo" under each photo: a form posting to the
 * no-JavaScript confirmation page, which public/js/remove.js turns into the
 * album page's native <dialog>. Both end in the same POST /api/remove.
 */
import TEMPLATE from '../templates/page.html';
import { KINDS } from './albums.js';
import { dayElement, escapeHtml } from './admin-page.js';
import { downloadName } from './public.js';
import { NOTE_MAX, REMOVAL_LIMIT } from './removals.js';
import { TEAMS, sectionHref, teamName } from './teams.js';

// The photos in the first row at every width: the grid's fewest columns,
// a phone's 2 (public/css/site.css). They load at once; every photo after
// them loads lazily, so on a phone nothing below the first row is eager, as
// tools/photos.py makes a trip photo eager only when it is in the first row
// of both its layouts. On a wide screen the rest of the first row is lazy
// but in view, so it loads as soon as the page is laid out.
// test/public.test.js fails if the CSS disagrees.
export const FIRST_ROW = 2;

// Every page here is HTML that must not be kept, so an approval or a takedown
// shows on the next load (#157, criterion 8), as public/_headers says for the
// static pages.
export const HTML_CACHE = 'public, max-age=0, must-revalidate';

const TITLE_SUFFIX = ' — Mad Cow Sailing photos';

/**
 * The whole page: `template` with its title and main filled, each placeholder
 * exactly once. The template is split before anything is put in, so a title
 * or a caption that happens to contain a placeholder's own spelling is shown
 * as text, and never filled again.
 */
export function renderPage({ title, main }, template = TEMPLATE) {
  const [head, rest] = splitOnce(template, '{{title}}');
  const [middle, tail] = splitOnce(rest, '{{main}}');
  return `${head}${escapeHtml(title)}${TITLE_SUFFIX}${middle}${main}${tail}`;
}

function splitOnce(text, mark) {
  const parts = text.split(mark);
  if (parts.length !== 2) {
    throw new Error(`templates/page.html must hold ${mark} exactly once, not ${parts.length - 1} times`);
  }
  return parts;
}

/** A rendered page as the response every public page answers with. */
export function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': HTML_CACHE },
  });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The line under a title: kind, day, and how many photos anyone can see.
const facts = (album, count) =>
  `${escapeHtml(KINDS[album.kind] ?? album.kind)} · ${dayElement(album.date)} · ${plural(count, 'photo', 'photos')}`;

const albumHref = (address) => `/albums/${address}/`;
export const photoUrl = (id, size) => `/photos/${id}/${size}`;

// The address /policy gives for a takedown by email (owner, at #159's
// pickup). test/removals.test.js holds it equal to the policy's.
export const TAKEDOWN_EMAIL = 'dave@madcowsailing.com';

// What a takedown does, in the words the dialog and the confirmation page
// both use. "One of the site's admins", not "the site's owner", since any
// admin can act (CLAUDE.md, The photo site, item 18): any address in
// ADMIN_EMAILS until #224, any account holding the admin role since.
const REMOVE_WORDS = 'It will be hidden from everyone right away. One of the site\'s admins then reviews it, and either puts it back or deletes it for good.';

// What the album page, or the list when the album has nothing left to show,
// says after a takedown (functions/api/remove.js sends the browser there).
// The address bar carries only ?removed, so a crafted link can show this
// sentence and nothing else.
export const REMOVED_NOTICE = 'The photo is hidden from everyone. One of the site\'s admins will review it.';
const notice = (removed) => (removed ? `\n    <p role="status">${REMOVED_NOTICE}</p>` : '');

/**
 * One row of a list: a cover beside a heading and a facts line, as on the
 * sailing site's logs index. The cover link is out of the tab order and
 * hidden from a screen reader, because the heading's link beside it goes to
 * the same page. With no cover (a team on / with nothing posted), the cover's
 * place holds an empty tile, so the words line up with every other row's.
 * `eager` is true for the first cover in the list, the one that loads at once.
 */
function listRow({ href, heading, facts: line, cover }, eager) {
  const loading = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const picture = cover
    ? `<a class="album-cover" href="${href}" tabindex="-1" aria-hidden="true"><img src="${photoUrl(cover.id, 'grid')}" width="${cover.width}" height="${cover.height}" ${loading} decoding="async" alt=""></a>`
    : '<span class="album-cover album-cover-none" aria-hidden="true"></span>';
  return `      <li class="album-row">
        ${picture}
        <div>
          <h2><a href="${href}">${heading}</a></h2>
          <p class="meta">${line}</p>
        </div>
      </li>`;
}

// The first row WITH a cover loads its cover at once, not the first row: on /
// a first team with nothing posted would otherwise leave no picture eager
// (review-fanout at #227's review).
function rowList(rows) {
  const first = rows.findIndex((row) => row.cover);
  return `<ul class="album-rows">\n${rows.map((row, i) => listRow(row, i === first)).join('\n')}\n    </ul>`;
}

/**
 * / (#227): one row per team, in lib/teams.js's order, each leading to that
 * team's section, so a COHSSA parent never scrolls past Hoover JRT's albums
 * (owner's choice at #227's pickup, over every album grouped by team). A row
 * says how many albums and photos its section shows, under the cover of its
 * newest album. A team with nothing posted keeps its row, saying so, since
 * its section is a page all the same. `albums` is lib/public.js's
 * publicAlbums() for every team, newest first. `removed` shows the takedown
 * notice, which lands here only when the hidden photo's album could not be
 * read back (functions/api/remove.js).
 */
export function teamListPage(albums, { removed = false } = {}) {
  const rows = TEAMS.map(({ team, name }) => {
    const own = albums.filter((album) => album.team === team);
    const photos = own.reduce((sum, album) => sum + album.photos, 0);
    return {
      href: sectionHref(team),
      heading: escapeHtml(name),
      facts: own.length ? `${plural(own.length, 'album', 'albums')} · ${plural(photos, 'photo', 'photos')}` : 'Nothing posted yet',
      cover: own[0]?.cover ?? null,
    };
  });
  const names = TEAMS.map(({ name }) => escapeHtml(name)).join(' and ');
  return renderPage({
    title: 'Team photos',
    main: `  <section class="wrap page-head">
    <p class="eyebrow">Photos</p>
    <h1>Team photos</h1>
    <p class="lede">Photos from the regattas and practices of ${names}, sent in by parents and coaches. Choose a team to see its albums.</p>${notice(removed)}
  </section>

  <section class="wrap album-list" aria-label="Teams">
    ${rowList(rows)}
  </section>`,
  });
}

/**
 * A team's section, /<team>/ (#227): its albums holding an approved photo,
 * newest first, each a row with its cover, as / listed every album before
 * #227. `albums` is lib/public.js's publicAlbums(db, team). The eyebrow is
 * the way back to /. `removed` shows the takedown notice, for a takedown that
 * left its album with nothing public (#158).
 */
export function sectionPage(team, albums, { removed = false } = {}) {
  const name = escapeHtml(teamName(team));
  const list = albums.length
    ? rowList(albums.map((album) => ({
      href: albumHref(album.address),
      heading: escapeHtml(album.title),
      facts: facts(album, album.photos),
      cover: album.cover,
    })))
    : '<p>Nothing is posted yet. Photos appear here once they are approved.</p>';
  return renderPage({
    title: teamName(team),
    main: `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">Team photos</a></p>
    <h1>${name} photos</h1>
    <p class="lede">Photos from ${name}'s regattas and practices, sent in by parents and coaches.</p>${notice(removed)}
  </section>

  <section class="wrap album-list" aria-label="Albums">
    ${list}
  </section>`,
  });
}

/**
 * One photo as a trip log's figure: the grid size in an a.frame linking to
 * the screen size, which the lightbox shows, then a figcaption holding the
 * caption and the Download link to the full size. A caption is the image's
 * alt as well, and the lightbox's caption through data-caption; a photo with
 * none gets an alt naming its album and its place in it.
 *
 * Under them, "Remove this photo" (#158): a form of its own, posting the
 * photo's id to the confirmation page at /remove, which is what a browser
 * without JavaScript shows. public/js/remove.js opens the page's dialog
 * instead. It sits under the photo in the grid, not in the lightbox, so the
 * shared gallery.js stays as the sailing site's trip logs have it (owner, at
 * #158's pickup).
 */
function photoFigure(album, photo, i, total) {
  const n = i + 1;
  const caption = photo.caption ? escapeHtml(photo.caption) : null;
  const alt = caption ?? `${escapeHtml(album.title)}, photo ${n} of ${total}`;
  const { width, height } = photo.sizes.grid;
  const loading = i < FIRST_ROW ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const captionAttr = caption ? ` data-caption="${caption}"` : '';
  const captionText = caption ? `<span class="caption-text">${caption}</span> ` : '';
  const name = downloadName(album.address, n);
  return `      <figure>
        <a class="frame" href="${photoUrl(photo.id, 'screen')}"${captionAttr}><img src="${photoUrl(photo.id, 'grid')}" width="${width}" height="${height}" ${loading} decoding="async" alt="${alt}"></a>
        <figcaption>${captionText}<a class="download" href="${photoUrl(photo.id, 'full')}" download="${name}" aria-label="Download photo ${n}">Download</a>
          <form class="remove" method="post" action="/remove"><button type="submit" class="remove-open" name="photo" value="${photo.id}" aria-label="Remove this photo: photo ${n} of ${total}">Remove this photo</button></form></figcaption>
      </figure>`;
}

/**
 * The note field, on the dialog and on the confirmation page alike. maxlength
 * counts UTF-16 units in every current browser, where an emoji is two, so it
 * is never looser than the server's NOTE_MAX characters. An older Safari
 * counted a whole emoji as one (lib/removals.js, readNote, says until when),
 * and the server cuts anything longer.
 */
const noteField = `<p class="field">
        <label for="remove-note">A note for the admins, if you want to leave one</label>
        <textarea id="remove-note" name="note" rows="4" maxlength="${NOTE_MAX}" aria-describedby="remove-note-hint"></textarea>
        <span class="hint" id="remove-note-hint">Up to ${NOTE_MAX} characters. Only the site's admins read it.</span>
      </p>`;

/**
 * The takedown dialog, once per album page, after the photos. Its confirm
 * button carries the photo's id, which public/js/remove.js sets from the
 * "Remove this photo" pressed, and it posts the note with it to
 * /api/remove. Cancel comes first and takes the focus, as on every dialog
 * here, and closes it through method="dialog". Without JavaScript the dialog
 * never opens, and the confirmation page asks instead.
 */
const removeDialog = `  <dialog id="remove-dialog" class="confirm" aria-labelledby="remove-title">
    <form method="post" action="/api/remove" class="remove-form">
      <h2 id="remove-title">Remove this photo?</h2>
      <p>${REMOVE_WORDS}</p>
      ${noteField}
      <p class="actions">
        <button type="submit" class="button" formmethod="dialog" autofocus>Cancel</button>
        <button type="submit" class="button button-accent" id="remove-confirm" name="photo" value="">Remove it</button>
      </p>
    </form>
  </dialog>`;

/**
 * An album's page. `album` is lib/public.js's publicAlbum(), its photos in
 * capture order. The eyebrow is the way back to the list (owner's choice at
 * #157's pickup, over a header nav), which since #227 is the album's own
 * team's section, named for it ("COHSSA photos"), rather than /, so a parent
 * goes back to their team's albums in one step. `removed` shows the takedown
 * notice.
 */
export function albumPage(album, { removed = false } = {}) {
  const total = album.photos.length;
  const figures = album.photos.map((photo, i) => photoFigure(album, photo, i, total));
  return renderPage({
    title: album.title,
    main: `  <section class="wrap page-head">
    <p class="eyebrow"><a href="${sectionHref(album.team)}">${escapeHtml(teamName(album.team))} photos</a></p>
    <h1>${escapeHtml(album.title)}</h1>
    <p class="meta">${facts(album, total)}</p>${notice(removed)}
  </section>

  <section class="wrap album-photos" aria-label="Photos">
    <div class="gallery">
${figures.join('\n')}
    </div>
  </section>

${removeDialog}`,
  });
}

// ---- "Remove this photo" without JavaScript, and its refusals (#158) ------

/**
 * The confirmation page POST /remove answers for an approved photo: the
 * dialog's words, the photo itself so the reader sees which one, the note,
 * and the button that takes it down. Nothing changes until that button is
 * pressed (owner, at #158's pickup: a page that asks first, over a post that
 * hides at once). `photo` is lib/removals.js's removablePhoto().
 */
export function removeConfirmPage(photo) {
  const back = albumHref(photo.album.address);
  const alt = photo.caption ? escapeHtml(photo.caption) : `The photo from ${escapeHtml(photo.album.title)}`;
  return renderPage({
    title: 'Remove this photo?',
    main: `  <section class="wrap page-head">
    <p class="eyebrow"><a href="${back}">${escapeHtml(photo.album.title)}</a></p>
    <h1>Remove this photo?</h1>
    <p class="lede">${REMOVE_WORDS}</p>
  </section>

  <section class="wrap remove-confirm" aria-label="The photo">
    <p class="remove-picture"><img src="${photoUrl(photo.id, 'grid')}" width="${photo.grid.width}" height="${photo.grid.height}" alt="${alt}"></p>
    <form method="post" action="/api/remove" class="remove-form">
      ${noteField}
      <p class="actions">
        <button type="submit" class="button button-accent" name="photo" value="${photo.id}">Remove it</button>
        <a class="button button-quiet" href="${back}">Keep it</a>
      </p>
    </form>
  </section>`,
  });
}

const refusal = (title, heading, lede) => renderPage({
  title,
  main: `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">Team photos</a></p>
    <h1>${heading}</h1>
    <p class="lede">${lede}</p>
  </section>`,
});

const email = `<a href="mailto:${TAKEDOWN_EMAIL}">${TAKEDOWN_EMAIL}</a>`;

/**
 * A takedown, or its confirmation page, naming a photo nobody can see:
 * pending, hidden already, deleted or unknown. One page for all of them, so
 * the answer says nothing about which.
 */
export const removeGonePage = () => refusal(
  'Photo not showing',
  'That photo isn\'t showing',
  'It may already have been taken down, or it was never public. Nothing was changed.',
);

/**
 * The 11th takedown in an hour from one network. `retryAfter` is in seconds,
 * shown in whole minutes, rounded up.
 */
export function removeLimitedPage(retryAfter) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return refusal(
    'Too many takedowns',
    'Too many photos taken down from here',
    `The site takes down at most ${REMOVAL_LIMIT} photos an hour from one network, and this one has reached that. Nothing was changed. Try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}, or email ${email} and the photo comes down.`,
  );
}

/** The database or the address key is missing, or the database did not answer. */
export const removeClosedPage = () => refusal(
  'Takedowns unavailable',
  'Photos can\'t be taken down right now',
  `Nothing was changed. Try again in a few minutes, or email ${email} and the photo comes down.`,
);

/**
 * What a page answers when the database does not: 503, and a sentence. A
 * public route never guesses at what is approved (CLAUDE.md, The photo site,
 * item 4), and an empty list would say nothing is posted when it is.
 */
export function unavailablePage() {
  return renderPage({
    title: 'Photos unavailable',
    main: `  <section class="wrap page-head">
    <p class="eyebrow">Photos</p>
    <h1>The photos can't be shown right now</h1>
    <p class="lede">Try again in a few minutes.</p>
  </section>`,
  });
}
