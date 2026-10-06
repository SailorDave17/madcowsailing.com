-- Accounts, and the requests for them (#220), the first story of epic #216 to
-- keep anything about a person. Additive: six new tables, their indexes and
-- the two teams' rows, nothing else touched.
--
-- A request is an account in waiting. Anyone can ask at /ask (functions/ask.js,
-- lib/accounts.js), naming a role and one team or both; an admin approves each
-- team on its own (D16, #221), and only then can the person set a password
-- (#222). One row per email address: a second request from an address the
-- table already holds writes nothing, whatever that address's state, and the
-- page answers it exactly as it answers a new one (#220, criterion 4).
--
-- teams: the teams a request can name (D16). A table, not a CHECK, so a third
-- team is a row, and #227 can point each album at one. Its two rows are made
-- with it; lib/accounts.js's TEAMS holds the same two, and test/accounts.test.js
-- fails if they part.
CREATE TABLE teams (
  team TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) WITHOUT ROWID;

INSERT INTO teams (team, name) VALUES ('hoover-jrt', 'Hoover JRT'), ('cohssa', 'COHSSA');

-- accounts: one row per person who asked. email is stored as typed and is
-- unique without regard to letter case. name, role and the optional note are
-- what the request form takes (criterion 1); it asks no sailor's name (D18).
-- role is the requester's own choice, which #221 may change at approval. It is
-- not the admin role: D15's admin is #224's, and lives elsewhere.
-- requested_at is when the request arrived. admins_emailed is 0 until an email
-- to the admins has listed the request (criterion 5, lib/accounts.js's
-- mailAdmins). AUTOINCREMENT keeps a deleted account's id from naming a later
-- one, so a photo (#223) or a log entry (#221) never moves to another person.
-- A delete by hand is README's, Deleting an account by hand, and
-- account_teams goes with it.
CREATE TABLE accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
  name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  role           TEXT    NOT NULL CHECK (role IN ('parent', 'coach', 'other')),
  note           TEXT    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  requested_at   INTEGER NOT NULL,
  admins_emailed INTEGER NOT NULL DEFAULT 0 CHECK (admins_emailed IN (0, 1))
);

-- account_teams: one row per team an account asked for, and where it stands.
-- The states, and the story that moves a row into each:
--   requested  asked for, waiting for an admin (#220)
--   approved   approved for that team (#221)
--   rejected   turned down (#221)
--   revoked    taken away after approval (#225)
-- All four are in the CHECK now, so no later story has to rebuild the table
-- to add one: SQLite cannot change a CHECK in place, which #223 meets on
-- photos. Deleting an account deletes its rows here (ON DELETE CASCADE, which
-- D1 enforces, as it enforces every foreign key).
CREATE TABLE account_teams (
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  team       TEXT    NOT NULL REFERENCES teams (team),
  state      TEXT    NOT NULL CHECK (state IN ('requested', 'approved', 'rejected', 'revoked')),
  PRIMARY KEY (account_id, team)
) WITHOUT ROWID;

-- account_request_log: one row per request that passed Turnstile, kept for an
-- hour, which limits each network address to REQUEST_LIMIT an hour (criterion
-- 3). address_hash is the keyed hash from lib/address.js, never the address,
-- as join_failures (0002) and removal_requests (0006) hold it. It names no
-- account, but a request that made one leaves a row whose requested_at is the
-- account's own, to the second, so for the hour the row is kept the two can
-- be matched; /policy says so (the owner's choice at #220's review,
-- 2026-10-05, over a coarser time on the account). The first index answers
-- "how many from this address in the last hour"; the second lets the next
-- request, or the next load of the admin home, delete the rows more than an
-- hour old without scanning the table.
CREATE TABLE account_request_log (
  address_hash TEXT    NOT NULL,
  requested_at INTEGER NOT NULL
);
CREATE INDEX account_request_log_by_address ON account_request_log (address_hash, requested_at);
CREATE INDEX account_request_log_by_time ON account_request_log (requested_at);

-- account_request_budget: the site's hourly budget of requests, for every
-- address together, as join_budget (0003) budgets recorded failures (#177).
-- One row per clock hour, keyed by the hour itself (Unix seconds / 3600), so
-- spending a unit writes exactly one row. Rows more than a day old are deleted
-- when a new hour's row is made.
CREATE TABLE account_request_budget (
  hour      INTEGER PRIMARY KEY,
  requested INTEGER NOT NULL
);

-- account_request_mail: when the admins were last emailed about new requests,
-- the one row that holds that email to at most one an hour (criterion 5; the
-- owner's choice at #220's pickup, 2026-10-05). It names no account: which
-- requests an email listed is admins_emailed on each account.
CREATE TABLE account_request_mail (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  sent_at INTEGER NOT NULL
);
