-- "Not sure / other event" (#228, epic #147): one album per team that a
-- sender can choose when the owner has not set up their event yet. Its
-- photos wait in the queue until an admin moves them into one of the team's
-- events, and none of them is approved, or public, while it is still there.
-- Additive: one column on albums, one index, a row per team, and six
-- triggers; no stored row changes. CLAUDE.md, The photo site, item 32 has
-- the decisions.
--
-- Applying it. The rows are what the code before #228 cannot read: to it
-- each is an ordinary open event, dated year 1, which the share page offers
-- (and preselects when every event is in the future), /admin/albums offers to
-- edit and delete (the delete is a 500), and the queue offers to approve (a
-- 500). So apply it to each database just before the code that reads it
-- reaches that database: to the preview just before the merge into develop,
-- and to production just before the promotion that carries #228, not at the
-- story's commit gate as earlier migrations were (review-fanout at #228's
-- review). The other order is worse: that code reads `holding` on every
-- album read, uploads included.
--
-- Why an album row and not a NULL album_id: photos.album_id is NOT NULL and
-- references albums (id) with no ON DELETE action (0005), which is what
-- refuses the delete of an album holding a photo (#153). Making it nullable
-- is a rebuild of photos, the destructive class (CLAUDE.md, item 6), and
-- #228's criterion 5 keeps the reference. So a Not sure photo names a real
-- album, marked by `holding` (owner, at #228's pickup, 2026-10-07).
--
-- holding is 1 on the one Not sure album of each team and 0 on every other
-- album, the default, so every album made before this file is an event, with
-- no UPDATE of a stored row. The unique index allows one Not sure album per
-- team.
--
-- The rows. One per team in `teams`, so a team added by a later migration
-- needs its own row there; test/not-sure.test.js fails until it has one. Each
-- is dated 0001-01-01, a date no admin form can give an album: lib/albums.js's
-- isDate reads a year under 100 as 19xx and refuses it. So no event's
-- address can ever be one of these, and the two sort after every event. The
-- kind is a placeholder that 0004's CHECK needs and no page shows.
--
-- The triggers hold criterion 4 (a Not sure photo is never approved) and so
-- criterion 2 (none of its photos is served publicly, since every public
-- query reads approved rows only; lib/public.js) in the database, whatever a
-- route or a statement typed by hand does (owner, at #228's pickup):
--
--   photos_not_sure_never_shown_on_insert / _on_update
--               a photo in a Not sure album is never approved, and is
--               hidden only while waiting, on insert, on a change of state,
--               and on a move into the album. A hidden photo is either an
--               approved one taken down (#158), which is refused, or a
--               waiting one hidden by "Hide all their photos" (#225), whose
--               approved_at is 0 (lib/removals.js, WAITING_WHEN_HIDDEN) and
--               which "Put it back" returns to the queue, never to the site.
--               That second kind is allowed (owner, at #228's review), so
--               Hide all takes down everything a person sent, Not sure
--               photos included.
--   albums_holding_fixed
--               holding is set when the row is made and never changes, so
--               an event holding approved photos cannot become a Not sure
--               album, and a Not sure album cannot become a public event.
--   albums_holding_kept_on_delete
--               a Not sure album is never deleted, empty or not; an admin
--               closes it instead (/admin/albums).
--   albums_holding_kept_on_replace / _on_update
--               REPLACE deletes a clashing row without firing a delete
--               trigger, since recursive_triggers is off on node:sqlite and
--               D1 (#227's 0011). REPLACE INTO fires the insert trigger,
--               which refuses an insert clashing by id or address with a
--               Not sure album, or making a Not sure album over an event or
--               beside the team's own. UPDATE OR REPLACE fires the update
--               trigger, which refuses moving an album's id or address onto
--               a Not sure album's, a Not sure album's onto another's, and
--               any change of a Not sure album's team (review-fanout at
--               #228's review: the insert trigger alone left an event's
--               approved photo inside a Not sure album).
--
-- Every path to a second Not sure album for a team meets a trigger first, so
-- the unique index is the invariant stated, and a spare.
ALTER TABLE albums ADD COLUMN holding INTEGER NOT NULL DEFAULT 0 CHECK (holding IN (0, 1));

CREATE UNIQUE INDEX albums_holding_one_per_team ON albums (team) WHERE holding = 1;

INSERT INTO albums (address, team, title, kind, held_on, created_at, holding)
SELECT '0001-01-01-not-sure-' || team, team, 'Not sure / other event', 'regatta', '0001-01-01',
       CAST(strftime('%s', 'now') AS INTEGER), 1
FROM teams;

CREATE TRIGGER photos_not_sure_never_shown_on_insert BEFORE INSERT ON photos
WHEN (NEW.state = 'approved' OR (NEW.state = 'hidden' AND NEW.approved_at IS NOT 0))
 AND NEW.album_id IN (SELECT id FROM albums WHERE holding = 1)
BEGIN
  SELECT RAISE(ABORT, 'a photo in a Not sure album is never approved');
END;

CREATE TRIGGER photos_not_sure_never_shown_on_update BEFORE UPDATE OF state, album_id, approved_at ON photos
WHEN (NEW.state = 'approved' OR (NEW.state = 'hidden' AND NEW.approved_at IS NOT 0))
 AND NEW.album_id IN (SELECT id FROM albums WHERE holding = 1)
BEGIN
  SELECT RAISE(ABORT, 'a photo in a Not sure album is never approved');
END;

CREATE TRIGGER albums_holding_fixed BEFORE UPDATE OF holding ON albums
WHEN NEW.holding IS NOT OLD.holding
BEGIN
  SELECT RAISE(ABORT, 'albums.holding never changes');
END;

CREATE TRIGGER albums_holding_kept_on_delete BEFORE DELETE ON albums
WHEN OLD.holding = 1
BEGIN
  SELECT RAISE(ABORT, 'a Not sure album cannot be deleted');
END;

CREATE TRIGGER albums_holding_kept_on_replace BEFORE INSERT ON albums
WHEN EXISTS (SELECT 1 FROM albums
             WHERE (id = NEW.id OR address = NEW.address) AND (holding = 1 OR NEW.holding = 1))
  OR (NEW.holding = 1 AND EXISTS (SELECT 1 FROM albums WHERE holding = 1 AND team = NEW.team))
BEGIN
  SELECT RAISE(ABORT, 'a Not sure album cannot be replaced');
END;

CREATE TRIGGER albums_holding_kept_on_update BEFORE UPDATE OF id, address, team ON albums
WHEN EXISTS (SELECT 1 FROM albums
             WHERE (id = NEW.id OR address = NEW.address) AND id <> OLD.id AND (holding = 1 OR OLD.holding = 1))
  OR (OLD.holding = 1 AND NEW.team IS NOT OLD.team)
BEGIN
  SELECT RAISE(ABORT, 'a Not sure album cannot be replaced');
END;
