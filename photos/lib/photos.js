/**
 * A photo sent to an album: what POST /api/upload accepts, and how it is
 * stored (#154). The route is functions/api/upload/index.js.
 *
 * A photo arrives as three JPEGs the share page makes in the browser (#155),
 * each held to its long edge and file size (CLAUDE.md, The photo site, item
 * 9). Each is rebuilt by lib/jpeg.js from the segments that draw it, so no
 * metadata segment is stored whatever was sent. The three objects go into
 * the bucket under a random media key, and only then is the row written,
 * pending, so no row ever names objects that are not there. A failure after
 * the objects are stored deletes them again.
 *
 * The same table holds clips (item 10). Their caps and their object's key
 * are here beside a photo's; lib/clips.js writes them (#198).
 */
import { CONTROL } from './albums.js';
import { concat } from './jpeg.js';

// Long edge in pixels and largest file in bytes, per size: CLAUDE.md item 9's
// table, whose KB and MB are read as 1,024 and 1,048,576 bytes.
export const SIZES = Object.freeze({
  grid: Object.freeze({ longEdge: 480, maxBytes: 150 * 1024 }),
  screen: Object.freeze({ longEdge: 1600, maxBytes: 1024 * 1024 }),
  full: Object.freeze({ longEdge: 2560, maxBytes: 3 * 1024 * 1024 }),
});

// The three files at their caps, plus room for the form's own framing and
// fields. A body past this is refused before any of it is parsed.
export const MAX_UPLOAD_BYTES =
  Object.values(SIZES).reduce((sum, size) => sum + size.maxBytes, 0) + 16 * 1024;

// One line on the public page, under the photo (#157).
export const CAPTION_MAX = 200;

// Uploads one account may send in a UTC day: the owner's figure at #154's
// pickup (2026-09-29), confirming the 500 the story proposed. It stops a
// runaway phone. The 500 are the account's, shared by every phone signed in
// to it (#223, criterion 5), so signing in again opens no new 500; an
// account that should not send at all is revoked (#225). Until #226 an
// invite-link session had 500 of its own, and a leaked code was stopped by
// rotating it (#152).
export const DAILY_UPLOADS = 500;
const DAY_SECONDS = 24 * 60 * 60;

// How long a clip may run, by who sends it (epic #147, D11): a coach's 15
// minutes, everyone else's 3. #198's clip routes read clipSeconds(session),
// so the role an admin approved decides it for an account (#223, criterion 4).
export const CLIP_SECONDS = Object.freeze({ coach: 15 * 60, everyone: 3 * 60 });

/**
 * Whether a session sends as a coach: its account was approved with the coach
 * role (#221, #223). The role is read on every request (lib/session.js), so a
 * role changed at approval applies from the next upload. Until #226 a coach's
 * Access sign-in (#192) sent as a coach too.
 */
export const sendsAsCoach = (session) => session.role === 'coach';

/** The longest clip, in seconds, a session may send (D11). */
export const clipSeconds = (session) => (sendsAsCoach(session) ? CLIP_SECONDS.coach : CLIP_SECONDS.everyone);

// How large a clip may be, by who sends it: the owner's figures at #198's
// pickup (2026-10-08), a coach's 4 GiB and everyone else's 1 GiB, beside
// D11's minutes. Three minutes at almost any phone setting fit in 1 GiB, and
// 4 GiB holds fifteen minutes of a phone's 1080p or about five of an action
// camera's 4K60 (typical bitrates, not measured here). Not chosen: 512 MiB
// and 2 GiB; one 4 GiB cap for everyone. A clip over its cap is refused
// before any part of it is stored.
export const CLIP_BYTES = Object.freeze({ coach: 4 * 1024 ** 3, everyone: 1024 ** 3 });

/** The largest clip, in bytes, a session may send. */
export const clipBytes = (session) => (sendsAsCoach(session) ? CLIP_BYTES.coach : CLIP_BYTES.everyone);

// How many bytes of clips a session may send in a UTC day, beside the day's
// 500 (owner, at #198's review, after the security audit's SA-1): a coach's
// 40 GiB and everyone else's 10 GiB. The 500 alone bounded a day of photos at
// about 2.2 GB, and let a day of clips reach 500 GiB, or 2 TB from a coach,
// billed until an admin rejected them. Ten parents' 1 GiB clips, or ten of a
// coach's 4 GiB, fit a day. Not chosen: leaving the count as the only bound,
// which a misused invite link turns into storage billing; a story after #198.
export const CLIP_DAY_BYTES = Object.freeze({ coach: 40 * 1024 ** 3, everyone: 10 * 1024 ** 3 });

/** How many bytes of clips a session may send in a UTC day. */
export const clipDayBytes = (session) => (sendsAsCoach(session) ? CLIP_DAY_BYTES.coach : CLIP_DAY_BYTES.everyone);

// A batch is what one press of Send carries, so the approval queue (#156)
// can show it together. The page names it with crypto.randomUUID().
const BATCH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// When the photo was taken, in Unix seconds, from its EXIF or the file's date
// (#155). It orders an album (#157) and nothing else, so any real time is
// taken, a camera clock set wrong included, up to the last second of 9999.
const CAPTURED = /^(0|[1-9][0-9]{0,11})$/;
const CAPTURED_MAX = 253_402_300_799;

/** The R2 keys of a photo's three objects. */
export const photoObjectKeys = (mediaKey) => ({
  grid: `photos/${mediaKey}/grid.jpg`,
  screen: `photos/${mediaKey}/screen.jpg`,
  full: `photos/${mediaKey}/full.jpg`,
});

/**
 * The R2 key of a clip's one object (#198), under the same photos/<key>/
 * prefix as a photo's three, so README's delete-by-prefix recipe and every
 * log line naming a prefix cover clips too. It carries no extension: the
 * object's type is set when its upload is created, and the row records the
 * type the server read from the file.
 */
export const clipObjectKey = (mediaKey) => `photos/${mediaKey}/clip`;

/** 128 random bits as 32 hex digits, naming a row's objects. */
export function newMediaKey() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The caption field: { caption }, null when there is none, or { error }. A
 * line break or any other control character anywhere refuses it, a
 * surrounding one included, before the ends are trimmed. Its length is
 * counted in characters (code points), as the table's CHECK counts it with
 * SQLite's length(), so an emoji is one, not two. Markup is kept as typed:
 * every page that shows a caption escapes it (#156, #157).
 */
export function readCaption(value) {
  if (value === null) return { caption: null };
  if (typeof value !== 'string' || CONTROL.test(value)) return { error: 'caption' };
  const caption = value.trim();
  if ([...caption].length > CAPTION_MAX) return { error: 'caption' };
  return { caption: caption || null };
}

/** The capture time in Unix seconds, or null when it is not one. */
export function readCaptured(value) {
  if (typeof value !== 'string' || !CAPTURED.test(value)) return null;
  const seconds = Number(value);
  return seconds <= CAPTURED_MAX ? seconds : null;
}

export const isBatch = (value) => typeof value === 'string' && BATCH.test(value);

/**
 * The request's body, or null when it is larger than `max`: by its
 * Content-Length when it gives one, and by counting as it arrives when it does
 * not, so a body is never read whole past the cap.
 */
export async function readCapped(request, max) {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && !(Number(declared) <= max)) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concat(chunks);
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

/**
 * The key upload_counts holds a session under: its account (#223) alone, so
 * the account's phones share one count. Until #226 a parent's invite-link
 * session was keyed by its code's generation and a coach's (#192) by its
 * coach tag, each with when it was issued; the "account." in front kept the
 * three apart, and keeps today's rows matching.
 */
export function sessionKey(session) {
  return `account.${session.accountId}`;
}

/**
 * Spend one of the session's uploads for this UTC day, and say whether there
 * was one. One statement: it makes the day's row at 1, or adds 1 while the
 * row is under the cap, and RETURNING gives a row only when it did either.
 * So two uploads arriving together cannot both take the last one. A
 * session's first upload of a day deletes every earlier day's rows, which the
 * cap no longer reads; that tidying failing never fails the upload.
 */
export async function spendDailyUpload(db, session, now) {
  const day = Math.floor(now / DAY_SECONDS);
  const spent = await db
    .prepare(
      'INSERT INTO upload_counts (session, day, sent) VALUES (?, ?, 1) ' +
      'ON CONFLICT (session, day) DO UPDATE SET sent = sent + 1 WHERE sent < ? ' +
      'RETURNING sent',
    )
    .bind(sessionKey(session), day, DAILY_UPLOADS)
    .first();
  if (spent === null) return false;
  if (spent.sent === 1) await clearEarlierDays(db, day);
  return true;
}

/** Delete every day's counts before `day`, which no cap reads any more; best effort. */
async function clearEarlierDays(db, day) {
  try {
    await db.prepare('DELETE FROM upload_counts WHERE day < ?').bind(day).run();
  } catch (err) {
    console.error('upload: could not clear the counts of earlier days:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Spend one of the session's uploads for this UTC day for a clip of `bytes`
 * (#198), and `bytes` of the day's clip budget with it (clipDayBytes). One
 * statement, as spendDailyUpload's: it makes the day's row at 1 and `bytes`,
 * or adds to both while the count is under its cap and the bytes stay within
 * the budget, so two clips starting together cannot both take the last of
 * either. Answers null when it spent, or which limit refused: 'daily-cap',
 * the 500, or 'clip-bytes', the budget. Reading which is one statement more,
 * made only on a refusal. A clip is never larger than the day's budget
 * (CLIP_BYTES), so a day's first row always fits.
 */
export async function spendDailyClip(db, session, now, bytes) {
  const day = Math.floor(now / DAY_SECONDS);
  const key = sessionKey(session);
  const spent = await db
    .prepare(
      'INSERT INTO upload_counts (session, day, sent, clip_bytes) VALUES (?, ?, 1, ?) ' +
      'ON CONFLICT (session, day) DO UPDATE SET sent = sent + 1, clip_bytes = clip_bytes + excluded.clip_bytes ' +
      'WHERE sent < ? AND clip_bytes + excluded.clip_bytes <= ? ' +
      'RETURNING sent',
    )
    .bind(key, day, bytes, DAILY_UPLOADS, clipDayBytes(session))
    .first();
  if (spent !== null) {
    if (spent.sent === 1) await clearEarlierDays(db, day);
    return null;
  }
  const row = await db.prepare('SELECT sent FROM upload_counts WHERE session = ? AND day = ?').bind(key, day).first();
  return row && row.sent >= DAILY_UPLOADS ? 'daily-cap' : 'clip-bytes';
}

/**
 * Give back the upload spendDailyUpload or spendDailyClip took, when what it
 * was spent on was then not stored: the bucket failed, the database failed,
 * the album closed while it was sent, or a clip was abandoned or refused. So
 * the cap counts what was stored, not attempts. A clip's `bytes` go back to
 * the day's clip budget with it. Guarded so neither goes below 0, and a
 * failure here is logged and left: at worst the session has one fewer upload,
 * and that much less of its budget, that day.
 */
export async function refundDailyUpload(db, session, now, bytes = 0) {
  try {
    await db
      .prepare(
        'UPDATE upload_counts SET sent = sent - 1, clip_bytes = MAX(clip_bytes - ?, 0) ' +
        'WHERE session = ? AND day = ? AND sent > 0',
      )
      .bind(bytes, sessionKey(session), Math.floor(now / DAY_SECONDS))
      .run();
  } catch (err) {
    console.error('upload: could not give the count back:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Whether the three sizes are one picture's shape: each no larger than the
 * next on either side, and each the same shape as the next to within the
 * rounding the browser does when it scales (a pixel on each side). Grid is
 * not compared with full as well: the two comparisons already bound it to
 * about two pixels, which no test could tell from one. It cannot tell two
 * different pictures of the same shape apart, which is why the approval
 * queue shows all three (#156).
 */
export function sizesAgree({ grid, screen, full }) {
  const within = (small, large) =>
    small.width <= large.width && small.height <= large.height &&
    Math.abs(small.width * large.height - small.height * large.width) <= large.width + large.height;
  return within(grid, screen) && within(screen, full);
}

/** Seconds until the next UTC day, when a capped session may send again. */
export const secondsToNextDay = (now) => DAY_SECONDS - (now % DAY_SECONDS);

/**
 * The columns 0005 and 0012 record about who sent a photo, for `session`:
 * { sender, code_generation, session_issued, account_id }.
 *
 * Every row since #226 names the account (#223). 0005's CHECKs allow no
 * third sender and require a parent's row to name a generation, so the row
 * carries placeholders: the sender is the account's role, `coach` or else
 * `parent`, and the generation and session time are 0, which no invite code
 * is, as 0012's CHECK requires of every row naming an account (owner, at
 * #223's pickup). The sign-in time is not kept: the account is named already.
 *
 * Rows written before #226 can say otherwise, and stay as they are. A
 * parent's from the invite link names the code's generation and when the
 * phone opened it, and no account. A coach's from the Access sign-in (#192)
 * says `coach` and names no code generation, account or session time: the
 * second a coach signed in sat beside their address in Cloudflare's sign-in
 * log, and would have named which coach sent the photo (owner, at #192's
 * review).
 */
export function senderColumns(session) {
  return { sender: sendsAsCoach(session) ? 'coach' : 'parent', code_generation: 0, session_issued: 0, account_id: session.accountId };
}

/**
 * Write a photo, pending, into the album at `address` if it is still open,
 * and return the row's id. Null when it is not: the album check and the
 * insert are one statement, so an album closed or deleted after the route
 * looked at it takes nothing. Every photo waits for approval (epic #147,
 * D10), whoever sent it. senderColumns says what the row records about the
 * sender.
 *
 * The same statement also requires the album's team to be one the account
 * is approved for now (#223), so a team revoked after the route checked it
 * takes nothing either.
 *
 * Since #273 an event's earlier address finds it as its address does (#273's
 * criterion 10; lib/albums.js, openAlbum): a share page loaded before the
 * event's first approval sends the address it had then, and the approval may
 * land between the route's check and this insert, while the sizes are stored.
 */
export async function insertPhoto(db, address, photo) {
  const from = senderColumns(photo.session);
  const row = await db
    .prepare(
      'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, ' +
      'session_issued, account_id, caption, captured_at, sent_at, width, height, grid_width, grid_height, ' +
      'screen_width, screen_height, bytes) ' +
      "SELECT id, 'photo', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? " +
      'FROM albums WHERE (address = ? OR earlier_address = ?) AND closed_at IS NULL ' +
      "AND team IN (SELECT team FROM account_teams WHERE account_id = ? AND state = 'approved') " +
      'RETURNING id',
    )
    .bind(
      photo.mediaKey, photo.batch, from.sender, from.code_generation, from.session_issued, from.account_id,
      photo.caption, photo.captured, photo.sentAt, photo.full.width, photo.full.height, photo.grid.width,
      photo.grid.height, photo.screen.width, photo.screen.height, photo.bytes, address, address, from.account_id,
    )
    .first();
  return row?.id ?? null;
}
