-- A clip's row holds what the clip routes write (#198, epic #147): a type the
-- server's check gives, a length once the clip is checked, its upload while
-- its parts arrive and none after, a state that leaves uploading only for
-- pending and never returns to it, and a kind that never changes. Additive:
-- ten triggers on photos; no column, no index, and no stored row changes.
-- CLAUDE.md, The photo site, item 10 has the clip design and item 14 the
-- table these hold.
--
-- #198's criterion 7 asks that each of #154's clip columns be confirmed or
-- amended in a new migration. This one confirms them all as 0005 made them:
-- content_type, duration_ms and upload_id are a clip's, and captured_at,
-- width, height and bytes stay empty while it uploads and are filled once the
-- server has checked it (lib/clips.js, finishClip), where 0005's CHECK
-- already requires them. No column and no index (a default taken at #198's
-- pickup, 2026-10-08). Not chosen: a column for the size the page declares,
-- which travels in the upload's signed token instead, as 0005 chose not to
-- write page-declared values at uploading; and nothing on the row names the
-- coach who sent it (#192).
--
-- Why triggers: SQLite changes a CHECK only by rebuilding the table, the
-- destructive class item 6 rules out, so these hold the rules as 0010's and
-- 0015's triggers hold theirs, for every statement, a by-hand one included.
-- Each refuses with its own words, never a CHECK's "constraint failed". Rules
-- 1 to 4 read a clip's row only, and 5 and 6 meet a photo's row only where a
-- clip is on the other side.
--
-- Not chosen: the caps (CLIP_SECONDS and CLIP_BYTES in lib/photos.js) in
-- these triggers too, which would be two places to change them. The route is
-- the one place, and refuses a clip over either before any part is stored.
--
-- Applying it: either order is safe. Nothing before #198 writes a clip, so
-- no write the older code makes meets these, and #198's routes read nothing
-- this file makes. So it goes in as item 6 orders, before the merge into
-- develop and before the promotion. A trigger reads a write, never a stored
-- row: a clip row written by hand before this file that breaks a rule stays
-- as it is until its next write, which meets them.

-- 1. A clip's type, once it has one, is one of the two the server's check
-- gives (public/js/clip.js): video/quicktime for QuickTime's brand, else
-- video/mp4. The admin route serves the clip under it.
CREATE TRIGGER photos_clip_type_on_insert BEFORE INSERT ON photos
WHEN NEW.kind = 'clip' AND NEW.content_type IS NOT NULL AND NEW.content_type NOT IN ('video/mp4', 'video/quicktime')
BEGIN
  SELECT RAISE(ABORT, 'a clip is video/mp4 or video/quicktime');
END;

CREATE TRIGGER photos_clip_type_on_update BEFORE UPDATE OF kind, content_type ON photos
WHEN NEW.kind = 'clip' AND NEW.content_type IS NOT NULL AND NEW.content_type NOT IN ('video/mp4', 'video/quicktime')
BEGIN
  SELECT RAISE(ABORT, 'a clip is video/mp4 or video/quicktime');
END;

-- 2. A clip outside uploading (pending, approved or hidden) has been checked,
-- so it names the type and the length the check read. A length of 0 is a
-- file the check calls malformed.
CREATE TRIGGER photos_clip_checked_on_insert BEFORE INSERT ON photos
WHEN NEW.kind = 'clip' AND NEW.state <> 'uploading'
 AND (NEW.content_type IS NULL OR NEW.duration_ms IS NULL OR NEW.duration_ms <= 0)
BEGIN
  SELECT RAISE(ABORT, 'a clip outside uploading names its type and a length over 0');
END;

CREATE TRIGGER photos_clip_checked_on_update BEFORE UPDATE OF kind, state, content_type, duration_ms ON photos
WHEN NEW.kind = 'clip' AND NEW.state <> 'uploading'
 AND (NEW.content_type IS NULL OR NEW.duration_ms IS NULL OR NEW.duration_ms <= 0)
BEGIN
  SELECT RAISE(ABORT, 'a clip outside uploading names its type and a length over 0');
END;

-- 3. A clip names its upload while its parts arrive, since each part, the
-- complete and an abort resume the upload by it, and names none outside
-- uploading: by then the upload is completed or aborted, and its id would
-- name nothing.
CREATE TRIGGER photos_clip_upload_on_insert BEFORE INSERT ON photos
WHEN NEW.kind = 'clip'
 AND ((NEW.state = 'uploading' AND NEW.upload_id IS NULL) OR (NEW.state <> 'uploading' AND NEW.upload_id IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'a clip names an upload while uploading and at no other time');
END;

CREATE TRIGGER photos_clip_upload_on_update BEFORE UPDATE OF kind, state, upload_id ON photos
WHEN NEW.kind = 'clip'
 AND ((NEW.state = 'uploading' AND NEW.upload_id IS NULL) OR (NEW.state <> 'uploading' AND NEW.upload_id IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'a clip names an upload while uploading and at no other time');
END;

-- 4. A clip leaves uploading only for pending, where only the server's check
-- puts it (finishClip), so no clip is approved or hidden unchecked. And it
-- never goes back: its upload token carries no expiry, and the part, complete
-- and abort routes act only on an uploading row, so the token ends for good
-- once the clip is checked. A plain insert is no move between states, and a
-- row may be written in any state, as the tests' fixtures are; the insert
-- that is one, REPLACE naming a stored row's id, meets rule 6.
CREATE TRIGGER photos_clip_state_on_update BEFORE UPDATE OF kind, state ON photos
WHEN NEW.kind = 'clip'
 AND ((NEW.state = 'uploading' AND OLD.state <> 'uploading')
   OR (OLD.state = 'uploading' AND NEW.state NOT IN ('uploading', 'pending')))
BEGIN
  SELECT RAISE(ABORT, 'a clip never goes back to uploading, and leaves it only for pending');
END;

-- 5. A row keeps its kind, either way: a photo's objects are three JPEGs and a
-- clip's is one video (lib/photos.js), so a row that changed kind would name
-- objects that are not there.
CREATE TRIGGER photos_kind_fixed BEFORE UPDATE OF kind ON photos
WHEN NEW.kind IS NOT OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'a row keeps its kind');
END;

-- 6. REPLACE: 0011's and 0015's lesson (cairn:
-- sqlite-append-only-needs-a-replace-trigger). REPLACE INTO naming a stored
-- row's id removes that row and writes the new one under the same id, firing
-- no update trigger above and no delete trigger (recursive_triggers is off on
-- node:sqlite and D1). Every route and every upload token names a row by its
-- id, so to them that is the row changing. These two hold an id to rules 4
-- and 5 through it: photos_id_kept_on_replace for REPLACE INTO, and
-- photos_id_kept_on_update for UPDATE OR REPLACE moving a row onto another's
-- id. An upsert or an INSERT OR IGNORE naming such an id meets the insert
-- side too, before its conflict clause runs, and is refused, not skipped:
-- nothing inserts into photos either way.
--
-- The update side names no column: SET rowid, oid or _rowid_ moves the id
-- without firing an UPDATE OF id trigger (measured on node:sqlite 3.53 and
-- local D1, #198). So it fires on every update, and its WHEN looks past its
-- first test only when the id moves. The insert side reads only an id over 0. NEW.id is
-- -1 in a BEFORE INSERT that names no id (measured; SQLite calls it
-- undefined), and every id AUTOINCREMENT gives is over 0, so a row someone
-- gave the id -1 by hand is never read as the row every upload names.
--
-- Not chosen: media_key, photos' other unique key. A REPLACE clashing on it
-- alone removes that row and adds one under a new id, as a delete followed by
-- an insert reusing the key would, and every id keeps its kind and state.
-- What these do not refuse: a delete, then an insert naming the deleted row's
-- id, two deliberate statements, as dropping a trigger is.
CREATE TRIGGER photos_id_kept_on_replace BEFORE INSERT ON photos
WHEN NEW.id > 0 AND EXISTS (
  SELECT 1 FROM photos AS existing WHERE existing.id = NEW.id AND (existing.kind = 'clip' OR NEW.kind = 'clip')
)
BEGIN
  SELECT RAISE(ABORT, 'a row keeps its kind')
    WHERE EXISTS (SELECT 1 FROM photos AS existing WHERE existing.id = NEW.id AND existing.kind IS NOT NEW.kind);
  SELECT RAISE(ABORT, 'a clip never goes back to uploading, and leaves it only for pending')
    WHERE EXISTS (
      SELECT 1 FROM photos AS existing
      WHERE existing.id = NEW.id AND existing.kind = 'clip'
        AND ((NEW.state = 'uploading' AND existing.state <> 'uploading')
          OR (existing.state = 'uploading' AND NEW.state NOT IN ('uploading', 'pending')))
    );
END;

CREATE TRIGGER photos_id_kept_on_update BEFORE UPDATE ON photos
WHEN NEW.id IS NOT OLD.id AND EXISTS (
  SELECT 1 FROM photos AS existing WHERE existing.id = NEW.id AND (existing.kind = 'clip' OR NEW.kind = 'clip')
)
BEGIN
  SELECT RAISE(ABORT, 'a row keeps its kind')
    WHERE EXISTS (SELECT 1 FROM photos AS existing WHERE existing.id = NEW.id AND existing.kind IS NOT NEW.kind);
  SELECT RAISE(ABORT, 'a clip never goes back to uploading, and leaves it only for pending')
    WHERE EXISTS (
      SELECT 1 FROM photos AS existing
      WHERE existing.id = NEW.id AND existing.kind = 'clip'
        AND ((NEW.state = 'uploading' AND existing.state <> 'uploading')
          OR (existing.state = 'uploading' AND NEW.state NOT IN ('uploading', 'pending')))
    );
END;
