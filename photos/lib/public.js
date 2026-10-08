/**
 * What anyone may see (#157): the albums holding an approved photo, the
 * approved photos in one album, and one approved photo's objects for the
 * image route.
 *
 * Only an approved photo is public (epic #147, D2). Every statement here
 * names state = 'approved' AND kind = 'photo', so a pending, hidden or
 * rejected photo is never listed, counted or served, and a clip waits for
 * its own story (#198). A closed album's approved photos stay public (#153),
 * so nothing here reads closed_at.
 *
 * An album is in the order its photos were taken: captured_at, then id, so
 * two photos taken in the same second keep the order they were sent in. The
 * page, the alt text and the download name all count positions that way.
 * The id tie-break in the page's and the cover's ORDER BY is a statement of
 * that rule more than a working part: SQLite already reads the index in id
 * order within a second, so deleting either one reddened no test (#157's
 * second mutation round). The download count has to spell the tie out,
 * since it compares rows rather than reading them in index order.
 *
 * What each costs D1, which counts every row a query reads (CLAUDE.md, The
 * photo site, item 2): / reads one index entry per approved photo on the
 * site and one row per album holding one; a team's section (#227), the same
 * for its own team's photos and albums, plus its team's album ids; an album
 * page, one row per approved photo in it; a grid or screen image, one row by
 * its id; a full size, one row plus one index entry per photo up to its
 * position.
 */
import { isAddress } from './albums.js';

const APPROVED = "state = 'approved' AND kind = 'photo'";

/**
 * Every album holding at least one approved photo, newest first (latest date,
 * then the later made, as the admin list sorts), each with its team, how many
 * approved photos it holds and its cover, the first of them in capture order.
 * One query: the window functions count and rank each album's photos in one
 * pass.
 *
 * `team` narrows it to one team's albums, for that team's section (#227). The
 * team is applied inside the window's own scan, so a section reads only its
 * own team's photos, through photos_by_album, never the other team's. With no
 * team, every album: what / sums per team.
 */
export async function publicAlbums(db, team = null) {
  const byTeam = team === null ? '' : ' AND album_id IN (SELECT id FROM albums WHERE team = ?)';
  const statement = db.prepare(
    'SELECT a.address, a.team, a.title, a.kind, a.held_on, p.total, p.id AS cover_id, ' +
    'p.grid_width, p.grid_height ' +
    'FROM (SELECT album_id, id, grid_width, grid_height, ' +
    'ROW_NUMBER() OVER (PARTITION BY album_id ORDER BY captured_at, id) AS n, ' +
    'COUNT(*) OVER (PARTITION BY album_id) AS total ' +
    `FROM photos WHERE ${APPROVED}${byTeam}) AS p ` +
    'JOIN albums AS a ON a.id = p.album_id ' +
    'WHERE p.n = 1 ' +
    'ORDER BY a.held_on DESC, a.id DESC',
  );
  const { results } = await (team === null ? statement : statement.bind(team)).all();
  return results.map((row) => ({
    address: row.address,
    team: row.team,
    title: row.title,
    kind: row.kind,
    date: row.held_on,
    photos: row.total,
    cover: { id: row.cover_id, width: row.grid_width, height: row.grid_height },
  }));
}

/**
 * The album at `address` with its approved photos in capture order, or null
 * when it is not an address, no album has it, or the album holds no approved
 * photo: an album nobody can see a photo in is not a page yet. One query.
 */
export async function publicAlbum(db, address) {
  if (!isAddress(address)) return null;
  const { results } = await db
    .prepare(
      'SELECT a.address, a.team, a.title, a.kind, a.held_on, p.id, p.caption, ' +
      'p.grid_width, p.grid_height, p.screen_width, p.screen_height, p.width, p.height ' +
      'FROM albums AS a JOIN photos AS p ON p.album_id = a.id ' +
      "WHERE a.address = ? AND p.state = 'approved' AND p.kind = 'photo' " +
      'ORDER BY p.captured_at, p.id',
    )
    .bind(address)
    .all();
  if (!results.length) return null;
  const [first] = results;
  return {
    address: first.address,
    team: first.team,
    title: first.title,
    kind: first.kind,
    date: first.held_on,
    photos: results.map((row) => ({
      id: row.id,
      caption: row.caption,
      sizes: {
        grid: { width: row.grid_width, height: row.grid_height },
        screen: { width: row.screen_width, height: row.screen_height },
        full: { width: row.width, height: row.height },
      },
    })),
  };
}

/** An approved photo's media key, or null when the photo is not public. */
export async function approvedPhoto(db, id) {
  if (id === null) return null;
  const row = await db.prepare(`SELECT media_key FROM photos WHERE id = ? AND ${APPROVED}`).bind(id).first();
  return row?.media_key ?? null;
}

/**
 * The name a downloaded photo is saved under: its album's address and its
 * place in the album, counted from 1 and written with at least three digits
 * so a folder of them sorts as the album reads (2026-10-04-fall-regatta-007.jpg).
 */
export const downloadName = (address, position) => `${address}-${String(position).padStart(3, '0')}.jpg`;

/**
 * An approved photo's media key and the name to save its full size under, or
 * null when the photo is not public. The position is counted the way the
 * album page orders its photos, so the name matches the photo's place there.
 */
export async function downloadPhoto(db, id) {
  if (id === null) return null;
  const row = await db
    .prepare(
      'SELECT p.media_key, a.address, ' +
      '(SELECT COUNT(*) FROM photos AS q WHERE q.album_id = p.album_id ' +
      "AND q.state = 'approved' AND q.kind = 'photo' " +
      'AND (q.captured_at < p.captured_at OR (q.captured_at = p.captured_at AND q.id <= p.id))) AS position ' +
      'FROM photos AS p JOIN albums AS a ON a.id = p.album_id ' +
      "WHERE p.id = ? AND p.state = 'approved' AND p.kind = 'photo'",
    )
    .bind(id)
    .first();
  return row ? { mediaKey: row.media_key, name: downloadName(row.address, row.position) } : null;
}
