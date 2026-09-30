/**
 * The public pages (#157): the album list at / (functions/index.js) and each
 * album at /albums/<address>/ (functions/albums/[address]/index.js).
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
 */
import TEMPLATE from '../templates/page.html';
import { KINDS } from './albums.js';
import { dayElement, escapeHtml } from './admin-page.js';
import { downloadName } from './public.js';

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

/**
 * The album list at /. `albums` is lib/public.js's publicAlbums(), newest
 * first. Each row is its cover beside its title, as on the sailing site's
 * logs index: the cover link is out of the tab order and hidden from a
 * screen reader, because the title beside it goes to the same page.
 */
export function albumListPage(albums) {
  const rows = albums.map((album, i) => {
    const href = albumHref(album.address);
    const { id, width, height } = album.cover;
    const loading = i === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    return `      <li class="album-row">
        <a class="album-cover" href="${href}" tabindex="-1" aria-hidden="true"><img src="${photoUrl(id, 'grid')}" width="${width}" height="${height}" ${loading} decoding="async" alt=""></a>
        <div>
          <h2><a href="${href}">${escapeHtml(album.title)}</a></h2>
          <p class="meta">${facts(album, album.photos)}</p>
        </div>
      </li>`;
  });
  const list = rows.length
    ? `<ul class="album-rows">\n${rows.join('\n')}\n    </ul>`
    : '<p>Nothing is posted yet. Photos appear here once they are approved.</p>';
  return renderPage({
    title: 'Team photos',
    main: `  <section class="wrap page-head">
    <p class="eyebrow">Photos</p>
    <h1>Team photos</h1>
    <p class="lede">Photos from the team's regattas and practices, sent in by parents.</p>
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
        <figcaption>${captionText}<a class="download" href="${photoUrl(photo.id, 'full')}" download="${name}" aria-label="Download photo ${n}">Download</a></figcaption>
      </figure>`;
}

/**
 * An album's page. `album` is lib/public.js's publicAlbum(), its photos in
 * capture order. The eyebrow is the way back to the list (owner's choice at
 * #157's pickup, over a header nav).
 */
export function albumPage(album) {
  const total = album.photos.length;
  const figures = album.photos.map((photo, i) => photoFigure(album, photo, i, total));
  return renderPage({
    title: album.title,
    main: `  <section class="wrap page-head">
    <p class="eyebrow"><a href="/">All albums</a></p>
    <h1>${escapeHtml(album.title)}</h1>
    <p class="meta">${facts(album, total)}</p>
  </section>

  <section class="wrap album-photos" aria-label="Photos">
    <div class="gallery">
${figures.join('\n')}
    </div>
  </section>`,
  });
}

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
