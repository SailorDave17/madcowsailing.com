-- Closes the one path 0010's triggers left open (#227, found by review-fanout
-- at #227's review, 2026-10-06). Additive: one trigger, nothing else touched.
--
-- 0010 says its four triggers do what a REFERENCES teams (team) column would.
-- They do not for REPLACE. `REPLACE INTO teams` (or INSERT OR REPLACE) whose
-- new row clashes with an existing row's unique `name` under a different
-- `team` key deletes that row to make room, and SQLite fires no DELETE
-- trigger for a row REPLACE removes unless recursive_triggers is on, which it
-- is not, on node:sqlite or on D1 (measured on both, 2026-10-06). So the old
-- key vanished while albums still named it. A real foreign key refuses the
-- same statement; 0007's account_teams reference already does, but only for a
-- team some account has asked for.
--
-- A BEFORE INSERT trigger runs before the conflict is resolved
-- (cairn memory: sqlite-append-only-needs-a-replace-trigger-2026-09-24), so it
-- sees the row REPLACE is about to remove. It refuses only the case that
-- orphans an album: a row with the same name and another key, named by an
-- album. A REPLACE that keeps its key (a new shown name for the same team)
-- removes and re-adds that key, which leaves every album's team a row, so it
-- is allowed. test/albums.test.js holds both.
CREATE TRIGGER teams_kept_while_named_on_replace BEFORE INSERT ON teams
WHEN EXISTS (
  SELECT 1 FROM teams AS t
  WHERE t.name = NEW.name AND t.team IS NOT NEW.team
    AND EXISTS (SELECT 1 FROM albums WHERE team = t.team)
)
BEGIN
  SELECT RAISE(ABORT, 'a team an album names cannot be replaced');
END;
