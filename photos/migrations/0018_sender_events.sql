-- An approved sender makes an event for their team from the share page
-- (#273, epic #267). Additive: three columns on albums, two indexes and five
-- triggers, nothing else touched. CLAUDE.md, The photo site, item 34 has the
-- decisions.
--
-- created_by names the account that made the event. It is NULL on every album
-- made before this file and on every album an admin makes, and it becomes
-- NULL when the account is deleted, so the event stays and no longer records
-- who made it. That is the promise /policy makes for a deleted account
-- (#219), and README's by-hand delete and #225's delete get it from the
-- database with no statement of their own, as 0012's photos.account_id does.
-- SQLite adds a REFERENCES column under enforced foreign keys only when its
-- default is NULL, which this one's is (cairn:
-- sqlite-a-references-column-cannot-be-added-with-a-default).
--
-- provisional is 1 on an event a sender made until an admin first approves a
-- photo or clip in it, and 0 on every other album, the default, so every
-- album made before this file reads as fixed, with no UPDATE of a stored row.
-- While it is 1 the address can still change: the first approval makes it
-- again from the event's date and title as they are then (owner, 2026-10-08
-- and 2026-10-09; lib/queue.js, approvePhotos, in the approval's own batch),
-- so a rename before then is in the address it goes public under. Once 0,
-- the address never changes, as 0004 has it for every album an admin makes.
-- Not chosen: reading "not yet fixed" from created_by, which a deletion sets
-- to NULL, so a deleted sender's event would read as fixed; or from the
-- album's photos, which can be hidden or deleted after they were public.
--
-- earlier_address is the address an event had before its first approval made
-- it a new one, and NULL otherwise. A share page loaded before that approval
-- still sends to it, and the upload routes find the event by either
-- (lib/albums.js, openAlbum; lib/photos.js, insertPhoto; lib/clips.js,
-- insertClip; #273's criterion 10). It is kept for the event's life (owner,
-- at #273's pickup): it is then never an address another album can take, so
-- a stale page can never land photos in another event. Not chosen: clearing
-- it some days after the approval or when the event closes, either of which
-- frees the address for another event.
--
-- The indexes. A unique one on earlier_address, partial, since ADD COLUMN
-- cannot carry UNIQUE: no two albums keep one earlier address, and the upload
-- lookup reads it by index rather than scanning albums. One on created_by and
-- created_at, partial, for the daily cap (10 events an account makes a UTC
-- day, counted from the albums it made that still exist, inside the create's
-- own statement; lib/albums.js, createEvent) and for the lookup the delete's
-- SET NULL makes.
--
-- The triggers hold criterion 3 and criterion 10 for an INSERT and an UPDATE,
-- a by-hand one included. Each refuses with its own words:
--
--   albums_provisional_one_way
--               an address once fixed stays fixed: provisional goes from 1
--               to 0, never back.
--   albums_earlier_address_kept_on_insert / _on_update
--               no album's address is another album's earlier address, nor
--               its earlier address another's address, so a lookup by either
--               finds one album. Every route that picks an address (an admin's
--               create, Move's new event, a sender's create, the first
--               approval's remake) already passes over them in its own
--               statement (lib/albums.js); these refuse a statement typed by
--               hand. Their WHEN reads earlier addresses only, so a REPLACE of
--               an event by its address goes through as before, which 0015's
--               tests hold.
--   photos_provisional_never_shown_on_insert / _on_update
--               a photo or clip in an event whose address is provisional is
--               never approved, and is hidden only while waiting (Hide all's
--               waiting kind, approved_at 0), as 0015 holds a Not sure album's.
--               So the approval has to fix the address first, in its batch,
--               and no public page ever shows an address that changes after.
--
-- Not chosen: a trigger refusing any change of a fixed album's address. No
-- route changes one but the first approval's remake, which names
-- provisional = 1 in its WHERE, and a BEFORE UPDATE OF address trigger fires
-- before 0015's, which would replace that trigger's words in its tests.
--
-- Not guarded here, unlike 0015's holding: a REPLACE INTO or INSERT OR
-- REPLACE naming a fixed album's id with provisional = 1, an UPDATE OR
-- REPLACE moving a provisional album onto another's id, and a REPLACE that
-- clashes on earlier_address's unique index, which deletes the album holding
-- it when no photo names that album. No route writes any of them; each takes
-- a statement typed by hand. review-fanout measured six such statements at
-- #273's review, and the owner chose to fold their guards into #288, the
-- story for the hand-typed holes in these guards (owner, 2026-10-09).
--
-- Applying it: before the code that reads it. #273's routes name these
-- columns in their reads and writes, so on a database without them every
-- album read fails; the older code names columns explicitly (lib/albums.js),
-- never these, and every row it writes reads as fixed and made by an admin.
-- So it goes in as item 6 orders, before the merge into develop and before
-- the promotion.

ALTER TABLE albums ADD COLUMN created_by INTEGER REFERENCES accounts (id) ON DELETE SET NULL;

ALTER TABLE albums ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0 CHECK (provisional IN (0, 1));

ALTER TABLE albums ADD COLUMN earlier_address TEXT;

CREATE UNIQUE INDEX albums_by_earlier_address ON albums (earlier_address) WHERE earlier_address IS NOT NULL;

CREATE INDEX albums_by_creator ON albums (created_by, created_at) WHERE created_by IS NOT NULL;

CREATE TRIGGER albums_provisional_one_way BEFORE UPDATE OF provisional ON albums
WHEN OLD.provisional = 0 AND NEW.provisional IS NOT 0
BEGIN
  SELECT RAISE(ABORT, 'an album address once fixed stays fixed');
END;

CREATE TRIGGER albums_earlier_address_kept_on_insert BEFORE INSERT ON albums
WHEN EXISTS (SELECT 1 FROM albums WHERE earlier_address = NEW.address)
  OR (NEW.earlier_address IS NOT NULL AND EXISTS (SELECT 1 FROM albums WHERE address = NEW.earlier_address))
BEGIN
  SELECT RAISE(ABORT, 'an earlier album address stays with its album');
END;

CREATE TRIGGER albums_earlier_address_kept_on_update BEFORE UPDATE OF address, earlier_address ON albums
WHEN (NEW.address IS NOT OLD.address
      AND EXISTS (SELECT 1 FROM albums WHERE earlier_address = NEW.address AND id <> OLD.id))
  OR (NEW.earlier_address IS NOT NULL AND NEW.earlier_address IS NOT OLD.earlier_address
      AND EXISTS (SELECT 1 FROM albums WHERE address = NEW.earlier_address AND id <> OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'an earlier album address stays with its album');
END;

CREATE TRIGGER photos_provisional_never_shown_on_insert BEFORE INSERT ON photos
WHEN (NEW.state = 'approved' OR (NEW.state = 'hidden' AND NEW.approved_at IS NOT 0))
 AND NEW.album_id IN (SELECT id FROM albums WHERE provisional = 1)
BEGIN
  SELECT RAISE(ABORT, 'a photo is approved only once its album address is fixed');
END;

CREATE TRIGGER photos_provisional_never_shown_on_update BEFORE UPDATE OF state, album_id, approved_at ON photos
WHEN (NEW.state = 'approved' OR (NEW.state = 'hidden' AND NEW.approved_at IS NOT 0))
 AND NEW.album_id IN (SELECT id FROM albums WHERE provisional = 1)
BEGIN
  SELECT RAISE(ABORT, 'a photo is approved only once its album address is fixed');
END;
