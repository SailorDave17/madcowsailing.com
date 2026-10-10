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
 * Since #273 an account approved for a team also makes an event for it from
 * the share page (createEvent), at most EVENTS_A_DAY a UTC day. Its address
 * is made the same way, but it is provisional until an admin first approves a
 * photo or clip in it: that approval makes it again from the event's date and
 * title as they are then (fixAddress, in the approval's own batch; owner,
 * 2026-10-08 and 2026-10-09), so a rename before then is in the address it
 * goes public under, and after it the address never changes, as above. When
 * the approval makes a new address, the old one is kept as the event's
 * earlier address for the event's life (owner, at #273's pickup): a share
 * page loaded before the approval still sends to it (openAlbum), and no
 * other album can take it. Migration 0018 has the columns and the triggers.
 *
 * Every statement that picks an address (createAlbum, createEvent and
 * fixAddress) picks the first of base, base-2 … base-50 that no album holds
 * as its address or its earlier address, in one statement, so a lookup by
 * either finds one album. Until #273 an admin's create tried each in turn
 * and caught the UNIQUE refusal.
 *
 * A closed album leaves the share page's choices and takes no upload, while
 * its approved photos stay public. openAlbum() is the check #154's upload
 * route makes, answering 409 when it finds nothing.
 *
 * Deleting an album that holds a photo, in any state, is refused by the
 * database: #154's photos table references albums (id), and D1 enforces
 * foreign keys in every query (developers.cloudflare.com/d1/sql-api/
 * foreign-keys, read 2026-09-28). So no count taken first can be overtaken by
 * an upload landing between it and the DELETE. The counts, photos and clips
 * apart since #198, are read only to say why the DELETE failed.
 *
 * Every album belongs to a team since #227 (lib/teams.js), chosen when it is
 * added and changed by an edit. Its team's section of the site lists it, and
 * the address does not name the team, so moving an album to the other team
 * keeps every link to it working. Migration 0010's triggers refuse a team the
 * `teams` table does not hold.
 *
 * Each team also has one "Not sure / other event" album since #228
 * (migration 0015), marked `holding`: a sender chooses it for photos from an
 * event the owner has not set up. It is no event. The share page lists it
 * after its team's events, /admin/albums only closes and reopens it, and its
 * photos wait in the queue until an admin moves them into an event
 * (lib/queue.js, movePhotos). 0015's triggers refuse approving a photo in it
 * (hiding one is allowed only while it waits, as "Hide all their photos"
 * does), deleting it, replacing it, and changing whether an album is one, so
 * none of its photos is ever public, and no public page lists or links it
 * (lib/public.js reads approved photos only, and an album page with none is
 * a 404).
 */
import { isTeam } from './teams.js';

// What a sender and an admin read for a team's Not sure album: its title in
// migration 0015, which the share page writes itself (public/js/share.js).
// test/not-sure.test.js holds the three equal.
export const NOT_SURE_TITLE = 'Not sure / other event';

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

/** Every address one date and title can take, in the order they are tried: base, base-2 … base-50. */
export const addressCandidates = (base) =>
  Array.from({ length: MAX_SUFFIX }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`));

// The candidates no album holds, as its address or as its earlier address
// (#273), in order: `j` is json_each over a JSON list of candidates. Every
// statement that picks an address reads them through this, so an address
// that a share page loaded before an event's first approval still sends to
// is never given to another album.
const FREE = 'NOT EXISTS (SELECT 1 FROM albums AS o WHERE o.address = j.value OR o.earlier_address = j.value)';

// The events one account may make in a UTC day from the share page (owner,
// 2026-10-08, #273's criterion 6). The ones it made that still exist are
// counted, so an event an admin deletes the same day frees its place (owner,
// at #273's pickup).
export const EVENTS_A_DAY = 10;

// The dates a sender may give an event: from EVENT_DAYS_BACK days before the
// phone's today through EVENT_DAYS_AHEAD after (owner, at #273's pickup). The
// share page offers that window on the phone's own date. The server's day is
// UTC's, and a phone's date is at most a day either side of it, so the server
// takes one day more each way, which every phone's window fits inside.
export const EVENT_DAYS_BACK = 30;
export const EVENT_DAYS_AHEAD = 1;

const DAY_SECONDS = 24 * 60 * 60;

/** Whether `text` is a real day written YYYY-MM-DD. */
export function isDate(text) {
  const m = typeof text === 'string' ? DATE.exec(text) : null;
  if (!m) return false;
  const [year, month, day] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * An album's fields from a submitted form: { album: { team, title, kind,
 * date } }, or { error } naming the first field that is wrong, in the order
 * the form shows them. The title is trimmed; nothing else about it is
 * changed, markup included, since every page escapes it where it is shown.
 */
export function readAlbumFields(fields) {
  if (!isTeam(fields.team)) return { error: 'team' };
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  if (!title || title.length > TITLE_MAX || CONTROL.test(title)) return { error: 'title' };
  if (!Object.hasOwn(KINDS, fields.kind)) return { error: 'kind' };
  if (!isDate(fields.date)) return { error: 'date' };
  return { album: { team: fields.team, title, kind: fields.kind, date: fields.date } };
}

/**
 * An event's fields from the share page (#273): { event: { team, title,
 * kind, date } }, or { error } naming the first field that is wrong, as
 * readAlbumFields does. `teams` are the teams the account is approved for
 * now: with one, the page asks no team, so a missing one is that team. The
 * date must also fall in the window a sender may give (EVENT_DAYS_BACK and
 * EVENT_DAYS_AHEAD around `now`, with a day each way for the phone's zone).
 * Whether the account may make an event in the team it names is the route's
 * to say, and createEvent's again in the statement that makes it.
 */
export function readEventFields(fields, teams, now) {
  const team = fields.team === undefined && teams.length === 1 ? teams[0] : fields.team;
  const { album, error } = readAlbumFields({ team, title: fields.title, kind: fields.kind, date: fields.date });
  if (error) return { error };
  const [year, month, day] = album.date.split('-').map(Number);
  const offset = Date.UTC(year, month - 1, day) / 1000 / DAY_SECONDS - Math.floor(now / DAY_SECONDS);
  if (offset < -(EVENT_DAYS_BACK + 1) || offset > EVENT_DAYS_AHEAD + 1) return { error: 'date' };
  return { event: album };
}

/** Whether `text` could be an album's address, before asking the database. */
export const isAddress = (text) => typeof text === 'string' && text.length <= ADDRESS_MAX && ADDRESS.test(text);

const COLUMNS = 'id, address, team, title, kind, held_on, created_at, closed_at, holding, provisional, earlier_address';

const fromRow = (row) => row && {
  id: row.id,
  address: row.address,
  team: row.team,
  title: row.title,
  kind: row.kind,
  date: row.held_on,
  createdAt: row.created_at,
  closedAt: row.closed_at,
  open: row.closed_at === null,
  // A team's Not sure album (#228), never an event.
  holding: row.holding === 1,
  // An event a sender made whose address waits for its first approval (#273).
  provisional: row.provisional === 1,
  // The address it had before that approval made it a new one, or null: what
  // a page loaded before then still posts (#273). Never sent to a sender's
  // page or a public one (GET /api/albums/open names its fields).
  earlierAddress: row.earlier_address ?? null,
};

/**
 * Make an album, and return its address: the first of base, base-2 … base-50
 * that no album holds as its address or its earlier address (#273), picked in
 * the statement that inserts it, so two albums made at once cannot share one.
 * Null, with nothing made, when all MAX_SUFFIX are taken. An admin's album
 * names no account, and its address is fixed from the start.
 */
export async function createAlbum(db, { team, title, kind, date }, now) {
  const row = await db
    .prepare(
      'INSERT INTO albums (address, team, title, kind, held_on, created_at) ' +
      `SELECT j.value, ?, ?, ?, ?, ? FROM json_each(?) AS j WHERE ${FREE} ORDER BY j.key LIMIT 1 RETURNING address`,
    )
    .bind(team, title, kind, date, now, JSON.stringify(addressCandidates(baseAddress({ title, kind, date }))))
    .first();
  return row?.address ?? null;
}

/**
 * Make an event a sender asked for on the share page (#273), as the account
 * `accountId`, and answer { address }, or { refused } saying why nothing was
 * made:
 *
 *   team  the account is not approved for the event's team now
 *   cap   the account has made EVENTS_A_DAY events this UTC day that still
 *         exist
 *   full  every address the date and title can take is held
 *
 * One statement checks all three and makes the event, so a team revoked
 * meanwhile, or a burst of presses at the cap, makes nothing more than it
 * should (cairn: a-count-then-record-limit-is-not-a-limit). Which one refused
 * is read with one statement more, made only then. The event names the
 * account and starts provisional (migration 0018).
 */
export async function createEvent(db, { team, title, kind, date }, accountId, now) {
  const dayStart = now - (now % DAY_SECONDS);
  const row = await db
    .prepare(
      'INSERT INTO albums (address, team, title, kind, held_on, created_at, created_by, provisional) ' +
      `SELECT j.value, ?, ?, ?, ?, ?, ?, 1 FROM json_each(?) AS j WHERE ${FREE} ` +
      "AND EXISTS (SELECT 1 FROM account_teams WHERE account_id = ? AND team = ? AND state = 'approved') " +
      'AND (SELECT COUNT(*) FROM albums WHERE created_by = ? AND created_at >= ?) < ? ' +
      'ORDER BY j.key LIMIT 1 RETURNING address',
    )
    .bind(
      team, title, kind, date, now, accountId, JSON.stringify(addressCandidates(baseAddress({ title, kind, date }))),
      accountId, team, accountId, dayStart, EVENTS_A_DAY,
    )
    .first();
  if (row) return { address: row.address };
  const why = await db
    .prepare(
      "SELECT EXISTS (SELECT 1 FROM account_teams WHERE account_id = ? AND team = ? AND state = 'approved') AS approved, " +
      '(SELECT COUNT(*) FROM albums WHERE created_by = ? AND created_at >= ?) AS made',
    )
    .bind(accountId, team, accountId, dayStart)
    .first();
  if (!why.approved) return { refused: 'team' };
  if (why.made >= EVENTS_A_DAY) return { refused: 'cap' };
  return { refused: 'full' };
}

/**
 * The statement that fixes a provisional event's address at its first
 * approval (#273), for the approval's batch (lib/queue.js, approvePhotos). It
 * makes the address again from the event's date and title as the approval
 * read them, and keeps the old one as its earlier address when the new one
 * differs.
 *
 * An address that is already one of its date and title's candidates stays,
 * so an event made as base-2 does not move to base because base came free.
 * When every candidate is held by other albums, the address it was made
 * with stays (owner, at #273's pickup). Either way the address is fixed.
 *
 * It changes nothing when the event is no longer provisional (another
 * admin's approval fixed it first) or when its title, kind or date changed
 * since the approval read them; the approval then leaves that event's photos
 * waiting, since it never approves into a provisional album.
 *
 * Nor does it change anything unless the press still approves something in
 * the event: one of `ids` is in it and still waiting, as the batch's next
 * statement reads it. A reject or a Hide all landing between the press's
 * read of the queue and its batch would otherwise fix the address with
 * nothing approved, and a rename before the event's real first approval
 * would then miss the address it goes public under (found by #273's address
 * tests, in a scratch run).
 */
export function fixAddress(db, { id, address, title, kind, date }, ids) {
  const candidates = addressCandidates(baseAddress({ title, kind, date }));
  const choices = candidates.includes(address) ? [address] : [...candidates, address];
  return db
    .prepare(
      'UPDATE albums SET earlier_address = CASE WHEN c.address = albums.address THEN NULL ELSE albums.address END, ' +
      'address = c.address, provisional = 0 ' +
      'FROM (SELECT j.value AS address FROM json_each(?) AS j WHERE NOT EXISTS (SELECT 1 FROM albums AS o ' +
      'WHERE o.id <> ? AND (o.address = j.value OR o.earlier_address = j.value)) ORDER BY j.key LIMIT 1) AS c ' +
      'WHERE albums.id = ? AND albums.provisional = 1 AND albums.title = ? AND albums.kind = ? AND albums.held_on = ? ' +
      "AND EXISTS (SELECT 1 FROM photos WHERE album_id = albums.id AND state = 'pending' " +
      'AND id IN (SELECT value FROM json_each(?)))',
    )
    .bind(JSON.stringify(choices), id, id, title, kind, date, JSON.stringify(ids));
}

/**
 * Every album, newest first: by its date, then the later made. The teams'
 * Not sure albums (#228) come last, since they are dated 0001-01-01, and each
 * says it is one (`holding`), for the page to set apart. For the admin pages
 * alone: each event a sender made names the account (`madeBy`, #273's
 * criterion 5), null for an admin's album and for one whose account is
 * deleted. No reader a sender or the public reaches selects it.
 */
export async function allAlbums(db) {
  const columns = COLUMNS.split(', ').map((column) => `a.${column}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT ${columns}, acc.name AS made_by FROM albums AS a LEFT JOIN accounts AS acc ON acc.id = a.created_by ` +
      'ORDER BY a.held_on DESC, a.id DESC',
    )
    .all();
  return results.map((row) => ({ ...fromRow(row), madeBy: row.made_by ?? null }));
}

/**
 * The open albums, newest first, as the share page lists them. A team's Not
 * sure album is among them while it is open (#228), last, saying it is one.
 */
export async function openAlbums(db) {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM albums WHERE closed_at IS NULL ORDER BY held_on DESC, id DESC`)
    .all();
  return results.map(fromRow);
}

/**
 * The album at `address` if it is open, or null: unknown, closed, or not an
 * address at all. An upload naming anything but an open album answers 409
 * (#154). A team's Not sure album takes uploads while it is open (#228).
 *
 * Since #273 an event's earlier address finds it too: the address it had
 * before its first approval made it a new one, which a share page loaded
 * before then still sends to (criterion 10). insertPhoto and insertClip read
 * it the same way, in the statement that writes the row, so an approval that
 * lands while a photo's sizes are being stored changes nothing for it. No
 * album's address is another's earlier address (FREE above, and migration
 * 0018's triggers), so either finds one album.
 */
export async function openAlbum(db, address) {
  if (!isAddress(address)) return null;
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM albums WHERE (address = ? OR earlier_address = ?) AND closed_at IS NULL`)
    .bind(address, address)
    .first();
  return fromRow(row);
}

// The album at an address or at its earlier address (#273), bound with the
// address twice. Every admin lookup below reads it, so a press from an admin
// page loaded before an event's first approval made its address again still
// acts on the event, where it answered that the album does not exist
// (#273's review, the owner's choice). No album's address is another's
// earlier address (FREE above, migration 0018's triggers), so it finds one.
const AT = '(address = ? OR earlier_address = ?)';

/**
 * The album at `address`, open or closed, or null: unknown, or not an address
 * at all. What the queue's "Move to event" checks its choice against (#228).
 */
export async function albumAt(db, address) {
  if (!isAddress(address)) return null;
  const row = await db.prepare(`SELECT ${COLUMNS} FROM albums WHERE ${AT}`).bind(address, address).first();
  return fromRow(row);
}

/**
 * Change an album's team, title, kind and date. Its address stays as it was
 * made, so a link to it keeps working when it moves to the other team's
 * section. True when an event was there to change. A team's Not sure album
 * (#228) is never changed here: it is only closed and reopened, so this
 * answers false for it, and notSureAlbum() says why.
 *
 * A sender's event whose address is still provisional (#273) keeps its
 * address here too: its first approval makes it again from the title, kind
 * and date this wrote (fixAddress), and after that a rename changes the
 * title only.
 */
export async function updateAlbum(db, address, { team, title, kind, date }) {
  if (!isAddress(address)) return false;
  const { meta } = await db
    .prepare(`UPDATE albums SET team = ?, title = ?, kind = ?, held_on = ? WHERE ${AT} AND holding = 0`)
    .bind(team, title, kind, date, address, address)
    .run();
  return meta.changes > 0;
}

/**
 * Whether `address` is a team's Not sure album (#228), for a route to say why
 * an edit or a delete of it changed nothing.
 */
export async function notSureAlbum(db, address) {
  if (!isAddress(address)) return false;
  const row = await db.prepare(`SELECT holding FROM albums WHERE ${AT}`).bind(address, address).first();
  return row?.holding === 1;
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
      ? `UPDATE albums SET closed_at = NULL WHERE ${AT}`
      : `UPDATE albums SET closed_at = COALESCE(closed_at, ?) WHERE ${AT}`)
    .bind(...(open ? [address, address] : [now, address, address]))
    .run();
  return meta.changes > 0;
}

/**
 * Delete an empty album. Answers { deleted: true }, { missing: true } when
 * there was no album there, { notSure: true } when it is a team's Not sure
 * album, which migration 0015 never lets go (#228), or, when the database
 * refused because rows still name it, how many: { photos, clips,
 * approvedClips, uploadingClips }. Photos and clips are counted apart since
 * #198 (owner, at #198's review), with the clips no admin page shows: an
 * approved one, which nothing lists until #286, and one still being sent.
 */
export async function deleteAlbum(db, address) {
  if (!isAddress(address)) return { missing: true };
  try {
    const { meta } = await db.prepare(`DELETE FROM albums WHERE ${AT}`).bind(address, address).run();
    return meta.changes > 0 ? { deleted: true } : { missing: true };
  } catch (err) {
    const message = String(err?.message);
    // 0015's trigger, raised before the reference is checked.
    if (/a Not sure album cannot be deleted/.test(message)) return { notSure: true };
    if (!/FOREIGN KEY constraint failed/.test(message)) throw err;
  }
  // Only reached when a photos table exists and a row in it names this album.
  // One statement, so every count is read from the same rows.
  const counts = await db
    .prepare(
      "SELECT COUNT(CASE WHEN kind = 'photo' THEN 1 END) AS photos, " +
      "COUNT(CASE WHEN kind = 'clip' THEN 1 END) AS clips, " +
      "COUNT(CASE WHEN kind = 'clip' AND state = 'approved' THEN 1 END) AS approved, " +
      "COUNT(CASE WHEN kind = 'clip' AND state = 'uploading' THEN 1 END) AS uploading " +
      `FROM photos WHERE album_id = (SELECT id FROM albums WHERE ${AT})`,
    )
    .bind(address, address)
    .first();
  return { photos: counts.photos, clips: counts.clips, approvedClips: counts.approved, uploadingClips: counts.uploading };
}
