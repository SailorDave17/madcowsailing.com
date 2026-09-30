/**
 * The albums: one per regatta or practice day, kept by the owner on
 * /admin/albums (#153), chosen by parents when they send photos (#155), and
 * listed publicly once they hold an approved photo (#157).
 *
 * An album's address is what a shared link names. It is built once, from the
 * date and the title (2026-10-04-fall-regatta), and never changes after, so
 * editing the title keeps every link working. A second album with the same
 * date and title gets -2, then -3.
 *
 * A closed album leaves the share page's choices and takes no upload, while
 * its approved photos stay public. openAlbum() is the check #154's upload
 * route makes, answering 409 when it finds nothing.
 *
 * Deleting an album that holds a photo, in any state, is refused by the
 * database: #154's photos table references albums (id), and D1 enforces
 * foreign keys in every query (developers.cloudflare.com/d1/sql-api/
 * foreign-keys, read 2026-09-28). So no count taken first can be overtaken by
 * an upload landing between it and the DELETE. The count is read only to say
 * why the DELETE failed.
 */

export const KINDS = { regatta: 'Regatta', practice: 'Practice' };

// A title fits on one line of the admin list and of a phone's album picker.
export const TITLE_MAX = 80;

// The title's part of an address, cut at a word where it can be.
const SLUG_MAX = 60;

// The most addresses one date and title can take (base, base-2 … base-50)
// before creating stops trying. An address keeps its slot after a rename.
export const MAX_SUFFIX = 50;

// What an address can look like: the date, then lowercase words and digits
// joined by single hyphens. Anything else is refused before any query.
export const ADDRESS = /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)+$/;
const ADDRESS_MAX = 10 + 1 + SLUG_MAX + 3;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Every control character (Unicode's Cc: C0, DEL and C1, NEL among them) and
// the line and paragraph separators: a title is one line, and so is a
// photo's caption (lib/photos.js). The separators are built from their code
// points, since an editor can turn their escapes into the characters
// themselves, which end a regex literal.
export const CONTROL = new RegExp(`[\\p{Cc}${String.fromCharCode(0x2028, 0x2029)}]`, 'u');

/**
 * The title's part of an address: accents dropped, lowercase, every run of
 * anything but a-z and 0-9 made one hyphen, none at either end. Cut to
 * SLUG_MAX, back to the last whole word when there is one. Empty when the
 * title has no letter or digit in it.
 */
export function slugify(title) {
  let slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) {
    const cut = slug.slice(0, SLUG_MAX + 1);
    const lastHyphen = cut.lastIndexOf('-');
    slug = (lastHyphen > 0 ? cut.slice(0, lastHyphen) : slug.slice(0, SLUG_MAX)).replace(/-+$/, '');
  }
  return slug;
}

/**
 * The address a new album starts from. A title with no letter or digit
 * (a lone "&") takes its kind's name instead, so every address has a word.
 */
export const baseAddress = ({ title, kind, date }) => `${date}-${slugify(title) || kind}`;

/** Whether `text` is a real day written YYYY-MM-DD. */
export function isDate(text) {
  const m = typeof text === 'string' ? DATE.exec(text) : null;
  if (!m) return false;
  const [year, month, day] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * An album's fields from a submitted form: { album: { title, kind, date } },
 * or { error } naming the first field that is wrong. The title is trimmed;
 * nothing else about it is changed, markup included, since every page
 * escapes it where it is shown.
 */
export function readAlbumFields(fields) {
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  if (!title || title.length > TITLE_MAX || CONTROL.test(title)) return { error: 'title' };
  if (!Object.hasOwn(KINDS, fields.kind)) return { error: 'kind' };
  if (!isDate(fields.date)) return { error: 'date' };
  return { album: { title, kind: fields.kind, date: fields.date } };
}

/** Whether `text` could be an album's address, before asking the database. */
export const isAddress = (text) => typeof text === 'string' && text.length <= ADDRESS_MAX && ADDRESS.test(text);

const COLUMNS = 'id, address, title, kind, held_on, created_at, closed_at';

const fromRow = (row) => row && {
  id: row.id,
  address: row.address,
  title: row.title,
  kind: row.kind,
  date: row.held_on,
  createdAt: row.created_at,
  closedAt: row.closed_at,
  open: row.closed_at === null,
};

/**
 * Make an album, and return its address. The address is the first of
 * base, base-2, base-3 … that no album holds; the UNIQUE constraint decides,
 * so two albums made at once cannot share one. Null, with nothing made, when
 * all MAX_SUFFIX are taken.
 */
export async function createAlbum(db, { title, kind, date }, now) {
  const base = baseAddress({ title, kind, date });
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const address = n === 1 ? base : `${base}-${n}`;
    try {
      await db
        .prepare('INSERT INTO albums (address, title, kind, held_on, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(address, title, kind, date, now)
        .run();
      return address;
    } catch (err) {
      if (!/UNIQUE constraint failed: albums\.address/.test(String(err?.message))) throw err;
    }
  }
  return null;
}

/** Every album, newest first: by its date, then the later made. */
export async function allAlbums(db) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM albums ORDER BY held_on DESC, id DESC`).all();
  return results.map(fromRow);
}

/** The open albums, newest first, as the share page lists them. */
export async function openAlbums(db) {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM albums WHERE closed_at IS NULL ORDER BY held_on DESC, id DESC`)
    .all();
  return results.map(fromRow);
}

/**
 * The album at `address` if it is open, or null: unknown, closed, or not an
 * address at all. An upload naming anything but an open album answers 409
 * (#154).
 */
export async function openAlbum(db, address) {
  if (!isAddress(address)) return null;
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM albums WHERE address = ? AND closed_at IS NULL`)
    .bind(address)
    .first();
  return fromRow(row);
}

/**
 * Change an album's title, kind and date. Its address stays as it was made.
 * True when an album was there to change.
 */
export async function updateAlbum(db, address, { title, kind, date }) {
  if (!isAddress(address)) return false;
  const { meta } = await db
    .prepare('UPDATE albums SET title = ?, kind = ?, held_on = ? WHERE address = ?')
    .bind(title, kind, date, address)
    .run();
  return meta.changes > 0;
}

/**
 * Close an open album, or reopen a closed one. True when the album exists,
 * whether or not it was already in that state, so a press on a stale page
 * reads as done rather than as missing.
 */
export async function setAlbumOpen(db, address, open, now) {
  if (!isAddress(address)) return false;
  // SQLite counts every row the WHERE matched as changed, even one set to
  // the value it had, so changes says whether the album exists. Closing an
  // album already closed keeps the time it was first closed.
  const { meta } = await db
    .prepare(open
      ? 'UPDATE albums SET closed_at = NULL WHERE address = ?'
      : 'UPDATE albums SET closed_at = COALESCE(closed_at, ?) WHERE address = ?')
    .bind(...(open ? [address] : [now, address]))
    .run();
  return meta.changes > 0;
}

/**
 * Delete an empty album. Answers { deleted: true }, { missing: true } when
 * there was no album there, or { photos: n } when the database refused
 * because n photos still name it.
 */
export async function deleteAlbum(db, address) {
  if (!isAddress(address)) return { missing: true };
  try {
    const { meta } = await db.prepare('DELETE FROM albums WHERE address = ?').bind(address).run();
    return meta.changes > 0 ? { deleted: true } : { missing: true };
  } catch (err) {
    if (!/FOREIGN KEY constraint failed/.test(String(err?.message))) throw err;
  }
  // Only reached when a photos table exists and a row in it names this album.
  const photos = await db
    .prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = (SELECT id FROM albums WHERE address = ?)')
    .bind(address)
    .first('n');
  return { photos };
}
