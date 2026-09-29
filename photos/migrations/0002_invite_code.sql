-- The invite code, and the log of failed attempts that rate-limits it (#150).
-- Additive: two new tables and their indexes, nothing else touched.

-- One row per code the site has had. The newest generation is the current
-- code; older rows stay so a link to one can be answered "this invite has
-- changed" rather than "wrong code". An upload session names the generation
-- it was opened with (lib/session.js), so adding a row ends every session
-- opened before it. The code is stored as it is, because the admin page
-- shows it (#152). Nothing in git ever holds a code: the first is made per
-- database with "Create code" on /admin/code (#152; README, The photo site).
-- Until #152, photos/scripts/seed-code.mjs seeded it; the preview's and
-- production's codes were made that way.
CREATE TABLE invite_codes (
  generation INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- One row per failed POST /api/join, kept for an hour. address_hash is the
-- keyed hash from lib/address.js, never the address. The first index answers
-- "how many from this address in the last hour"; the second lets the join
-- route delete expired rows without scanning the table.
CREATE TABLE join_failures (
  address_hash TEXT    NOT NULL,
  failed_at    INTEGER NOT NULL
);
CREATE INDEX join_failures_by_address ON join_failures (address_hash, failed_at);
CREATE INDEX join_failures_by_time ON join_failures (failed_at);
