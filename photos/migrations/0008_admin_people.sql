-- Approving requests for an account (#221), on /admin/people. Additive: two
-- new tables and one index, nothing else touched.
--
-- An admin approves or turns down each team a request names on its own (D16),
-- and may change the role at approval; that is account_teams.state and
-- accounts.role, which 0007 already holds. Approving emails the person a link
-- to set a password (lib/password-link.js), and every action is written to
-- the admins' log (lib/people.js).
--
-- password_links: the links that let an approved person set a password, one
-- row per link not yet used, kept only as a hash. The token in the link is 32
-- random bytes, written as 43 characters of base64url; token_hash is the
-- SHA-256 of those 43 characters, in the same form, so a copy of this table
-- cannot be turned back into a working link. A link lasts LINK_SECONDS, 7
-- days (the owner's choice at #221's pickup, 2026-10-05), and works once:
-- spendLink deletes the row as it reads it, in one statement, so two uses at
-- once cannot both pass. Making a new link deletes the account's earlier ones,
-- so only the newest works, and every expired row in the table with them;
-- each load of /admin/people deletes the expired rows too. Nothing spends a
-- link yet: setting the password is #222's, which calls spendLink.
-- Deleting an account deletes its links (ON DELETE CASCADE), and the index
-- serves that and the replace.
CREATE TABLE password_links (
  token_hash TEXT    PRIMARY KEY CHECK (length(token_hash) = 43),
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  made_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > made_at)
) WITHOUT ROWID;
CREATE INDEX password_links_by_account ON password_links (account_id);

-- admin_log: what the admins do with each account (#221, criterion 5): who
-- (the admin's address), what (action, and detail such as the team or the
-- old and new role), whom and when. Shown on /admin/people, newest first.
--
-- It names the person by copying their name and address into each entry, and
-- account_id carries no foreign key, so deleting the account deletes none of
-- its entries and is never refused by them: the log keeps naming the person
-- after a delete, as /policy says (owner, at #219's review, 2026-10-05).
-- account_id still says which account an entry was about, and accounts' ids
-- are AUTOINCREMENT, so it never comes to name a later account.
--
-- The actions are lib/people.js's ACTIONS. The CHECK holds their shape only,
-- not the list, because #224 (promote, demote) and #225 (revoke, hide, delete)
-- add actions of their own, and SQLite cannot change a CHECK in place. The
-- text limits are accounts' own (0007), with room in detail for two team
-- names or a role change.
CREATE TABLE admin_log (
  id         INTEGER PRIMARY KEY,
  at         INTEGER NOT NULL,
  admin      TEXT    NOT NULL CHECK (length(admin) BETWEEN 3 AND 254),
  action     TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 20 AND action NOT GLOB '*[^a-z-]*'),
  account_id INTEGER NOT NULL,
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email      TEXT    NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  detail     TEXT    CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 200)
);
