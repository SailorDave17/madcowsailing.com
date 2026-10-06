-- Each photo records the account that sent it (#223, epic #216, D17), and
-- admins alone see it. Additive: one column on photos, its CHECK and one
-- index, nothing else touched. CLAUDE.md, The photo site, item 29 has the
-- decisions.
--
-- Why a column, not a rebuild. 0005's CHECKs allow a sender of 'parent' or
-- 'coach' only, and require a parent's row to name the code generation and
-- the session it was sent under. SQLite cannot change a CHECK without
-- rebuilding the table, which the additive-only rule forbids (item 6). So an
-- account's row keeps 0005's columns true with placeholder values: sender is
-- the account's role, 'coach' for a coach and 'parent' for anyone else, and
-- code_generation and session_issued are 0, which no invite code is. The CHECK
-- below holds those two at 0 whenever account_id names an account, so a row
-- cannot claim an invite and an account at once. It says IS 0, not = 0: a
-- comparison with NULL is NULL, and a CHECK that is NULL passes (measured on
-- node:sqlite, #223), so = 0 let a coach-shaped row with no placeholders
-- through. Owner's choice at #223's
-- pickup, 2026-10-06. Not chosen: a side table naming each photo's account,
-- which is a second write per upload and a second table to join; rebuilding
-- photos under a two-release plan, which is the destructive class, needs D1's
-- defer_foreign_keys, and must carry AUTOINCREMENT's high-water mark over by
-- hand or a rejected photo's id could be given out again.
--
-- account_id is NULL on every row made before this file, and on every row
-- the invite link or a coach's Access sign-in sends until #226 retires both.
-- SQLite adds a REFERENCES column under enforced foreign keys only when its
-- default is NULL, which this one's is (measured on node:sqlite; cairn:
-- sqlite-a-references-column-cannot-be-added-with-a-default). ON DELETE SET
-- NULL is the promise /policy makes for a deleted account (#219): its photos
-- stay, approved or waiting, and no longer record it. README's by-hand
-- delete and #225's delete get that from the database, with no statement of
-- their own. The placeholders stay, so such a row still reads as sent from
-- an account, and no longer which.
--
-- The index serves README's by-hand "hide all their photos" and #225's, and
-- the lookup the delete's SET NULL makes. Partial, so a row with no account
-- (every row before this file) writes no index entry.
ALTER TABLE photos ADD COLUMN account_id INTEGER
  CHECK (account_id IS NULL OR (code_generation IS 0 AND session_issued IS 0))
  REFERENCES accounts (id) ON DELETE SET NULL;

CREATE INDEX photos_by_account ON photos (account_id) WHERE account_id IS NOT NULL;
