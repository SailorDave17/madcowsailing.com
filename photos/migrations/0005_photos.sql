-- The photos and clips parents and coaches send, and the daily count that
-- caps each upload session (#154). Additive: two new tables and their
-- indexes, nothing else touched.
--
-- One table for every state the epic needs, so later stories write to it and
-- add no second migration (#154, criterion 7; owner's choice at pickup,
-- 2026-09-29). It holds clips as well as photos: every row names its album,
-- and deleteAlbum() in lib/albums.js counts FROM photos WHERE album_id, so a
-- clip in another table would slip past the album-delete refusal.
--
-- album_id references albums (id), with no ON DELETE action, so the database
-- itself refuses to delete an album holding a row in any state (#153).
-- test/albums.test.js fails on any other table naming albums, or on a
-- cascading or missing reference.
--
-- The states, and the story that moves a row into each:
--   uploading  a clip whose parts are still arriving (the clip story, #198);
--              never a photo, which arrives whole in one request
--   pending    stored and waiting for the owner (#154 for photos)
--   approved   public (#156), with approved_at
--   hidden     taken down by "Remove this photo" (#158), with hidden_at and
--              the optional note; only an approved row can be hidden
-- A rejected row is deleted with its objects (#156), not kept in a state:
-- R2 bills a stored clip from the day it lands (CLAUDE.md item 8).
--
-- media_key names the row's objects in R2: photos/<media_key>/grid.jpg,
-- screen.jpg and full.jpg (lib/photos.js). It is random, made before the
-- objects are stored, so no row ever exists without its objects.
-- AUTOINCREMENT keeps a deleted row's id from being given to a later one, so
-- an id names one photo for good.
--
-- sender is 'coach' for an upload from a coach's Access session (#192), which
-- has no invite code behind it. A parent's row names the code generation and
-- the session's issued time it was sent under.
--
-- width and height are the largest stored size: a photo's full JPEG, or a
-- clip's frame. A photo also records its grid and screen sizes, since each is
-- made in the browser and rounded there. content_type, duration_ms and
-- upload_id are a clip's (item 10), left empty on a photo.
--
-- captured_at, width, height and bytes are required in every state but
-- uploading, by a CHECK rather than NOT NULL. A clip's row is made when its
-- first part arrives, before the server can check what the page says about
-- it, and SQLite can loosen a NOT NULL only by rebuilding the table, which
-- the additive-only rule forbids (owner's choice at #154's review,
-- 2026-09-29). The clip story (#198) fills them once the clip is verified.
--
-- bytes is what the row's objects take in R2, for the storage figure the
-- admin home shows (#156).
CREATE TABLE photos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id        INTEGER NOT NULL REFERENCES albums (id),
  kind            TEXT    NOT NULL CHECK (kind IN ('photo', 'clip')),
  state           TEXT    NOT NULL CHECK (state IN ('uploading', 'pending', 'approved', 'hidden')),
  media_key       TEXT    NOT NULL UNIQUE,
  batch           TEXT    NOT NULL,
  sender          TEXT    NOT NULL CHECK (sender IN ('parent', 'coach')),
  code_generation INTEGER,
  session_issued  INTEGER,
  caption         TEXT    CHECK (caption IS NULL OR length(caption) BETWEEN 1 AND 200),
  captured_at     INTEGER,
  sent_at         INTEGER NOT NULL,
  width           INTEGER CHECK (width > 0),
  height          INTEGER CHECK (height > 0),
  grid_width      INTEGER,
  grid_height     INTEGER,
  screen_width    INTEGER,
  screen_height   INTEGER,
  bytes           INTEGER CHECK (bytes >= 0),
  content_type    TEXT,
  duration_ms     INTEGER,
  upload_id       TEXT,
  approved_at     INTEGER,
  hidden_at       INTEGER,
  hidden_note     TEXT    CHECK (hidden_note IS NULL OR length(hidden_note) <= 500),
  CHECK (state <> 'uploading' OR kind = 'clip'),
  CHECK (state = 'uploading' OR (captured_at IS NOT NULL AND width IS NOT NULL
                                 AND height IS NOT NULL AND bytes IS NOT NULL)),
  CHECK (kind = 'clip' OR (grid_width IS NOT NULL AND grid_height IS NOT NULL
                           AND screen_width IS NOT NULL AND screen_height IS NOT NULL)),
  CHECK (kind = 'clip' OR (content_type IS NULL AND duration_ms IS NULL AND upload_id IS NULL)),
  CHECK (sender = 'coach' OR (code_generation IS NOT NULL AND session_issued IS NOT NULL)),
  CHECK (state NOT IN ('approved', 'hidden') OR approved_at IS NOT NULL),
  CHECK (state <> 'hidden' OR hidden_at IS NOT NULL)
);

-- An album's rows by state, in capture order: the public album page (#157),
-- the album-delete count, and the lookup the foreign key makes when an album
-- is deleted.
CREATE INDEX photos_by_album ON photos (album_id, state, captured_at);

-- Every row in one state, oldest sent first: the approval queue (#156), the
-- removals list (#158) and the counts on the admin home.
CREATE INDEX photos_by_state ON photos (state, sent_at);

-- How many uploads each session has sent in a UTC day, capped at 500 by
-- POST /api/upload (owner, 2026-09-29, #154). session is the session's
-- "<generation>.<issued>", so a coach's session (#192) can take a key of its
-- own here with no change to the table. day is Unix seconds / 86400. The
-- route spends one with a guarded upsert, as the join budget does (#177), so
-- two uploads arriving at once cannot both pass the last unit. A session's
-- first upload of a day deletes every earlier day's rows, which the cap no
-- longer reads. No index on day: the table holds a row per session that sent
-- anything today, and that delete reads it whole once per such session.
CREATE TABLE upload_counts (
  session TEXT    NOT NULL,
  day     INTEGER NOT NULL,
  sent    INTEGER NOT NULL,
  PRIMARY KEY (session, day)
) WITHOUT ROWID;
