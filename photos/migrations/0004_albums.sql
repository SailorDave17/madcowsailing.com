-- The albums, one per regatta or practice day, which the owner keeps on
-- /admin/albums (#153). Additive: one new table, nothing else touched.
--
-- address is what a shared link names (/albums/<address>/, #157). It is
-- built once from the date and title when the album is made
-- (2026-10-04-fall-regatta; lib/albums.js) and never changes after, so a
-- link keeps working when the title is edited. held_on is the day of the
-- regatta or practice, as YYYY-MM-DD, which sorts as it reads.
--
-- closed_at is NULL while the album is open. A closed album leaves the share
-- page's choices (GET /api/albums/open) and takes no upload, while its
-- approved photos stay public; reopening sets it back to NULL.
--
-- Deleting an album that holds a photo is refused by the database itself:
-- #154's photos table references albums (id), with no ON DELETE action, and
-- D1 enforces foreign keys in every query, so the DELETE fails whatever the
-- page or a race says (owner's choice at #153's pickup, 2026-09-28).
-- test/albums.test.js fails if any table but photos names albums, or if
-- photos.album_id lacks that reference or takes an ON DELETE action.
--
-- No index beyond address's own: the table holds a row per regatta or
-- practice day, a few dozen a season, and the open list reads it whole.
CREATE TABLE albums (
  id         INTEGER PRIMARY KEY,
  address    TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('regatta', 'practice')),
  held_on    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at  INTEGER
);
