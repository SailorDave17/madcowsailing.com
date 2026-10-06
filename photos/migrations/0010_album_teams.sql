-- Every album belongs to a team (#227, epic #191): Hoover JRT or COHSSA, the
-- rows 0007 made in `teams`. Each team's section of the site lists its own
-- albums (/hoover-jrt/, /cohssa/), and the admin pages filter by team.
-- Additive: one column on albums and four triggers, nothing else touched.
--
-- team is NOT NULL with Hoover JRT as its default, so every album made before
-- this file reads as Hoover JRT, which is what they all are, with no UPDATE
-- of a stored row. lib/albums.js names the team on every insert, so the
-- default is only ever read by those rows.
--
-- Why triggers and not REFERENCES teams (team). SQLite refuses to add a
-- REFERENCES column with a non-NULL default while foreign keys are enforced
-- ("Cannot add a REFERENCES column with non-NULL default value"; measured on
-- node:sqlite 3.53.3, #227), and D1 enforces them in every query and
-- migration, with only PRAGMA defer_foreign_keys to relax them
-- (developers.cloudflare.com/d1/sql-api/foreign-keys, read 2026-10-06). So
-- the four triggers below do what the reference would have: an album's team
-- must be a row in `teams`, on insert and on update, and a team an album
-- names cannot be deleted or renamed. `teams` stays the one list, as 0007
-- made it a table for (a third team is a row). Owner's choice at #227's
-- pickup, 2026-10-06. Not chosen: a CHECK naming the two teams, which puts
-- the list in a third place and needs a table rebuild for a third team; a
-- nullable REFERENCES column set by an UPDATE, which leaves NULL allowed for
-- good. test/albums.test.js holds each trigger.
--
-- No index on team: the table holds a row per regatta or practice day, a few
-- dozen a season (0004), and a section's query reaches the photos through
-- photos_by_album.
ALTER TABLE albums ADD COLUMN team TEXT NOT NULL DEFAULT 'hoover-jrt';

CREATE TRIGGER albums_team_known_on_insert BEFORE INSERT ON albums
WHEN NEW.team NOT IN (SELECT team FROM teams)
BEGIN
  SELECT RAISE(ABORT, 'albums.team must name a row in teams');
END;

CREATE TRIGGER albums_team_known_on_update BEFORE UPDATE OF team ON albums
WHEN NEW.team NOT IN (SELECT team FROM teams)
BEGIN
  SELECT RAISE(ABORT, 'albums.team must name a row in teams');
END;

CREATE TRIGGER teams_kept_while_named_on_delete BEFORE DELETE ON teams
WHEN EXISTS (SELECT 1 FROM albums WHERE team = OLD.team)
BEGIN
  SELECT RAISE(ABORT, 'a team an album names cannot be deleted');
END;

CREATE TRIGGER teams_kept_while_named_on_update BEFORE UPDATE OF team ON teams
WHEN NEW.team IS NOT OLD.team AND EXISTS (SELECT 1 FROM albums WHERE team = OLD.team)
BEGIN
  SELECT RAISE(ABORT, 'a team an album names cannot be renamed');
END;
