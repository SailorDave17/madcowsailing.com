-- Signing in (#222): an approved person sets a password from an emailed
-- link, signs in, signs out, and resets a forgotten password. Additive: three
-- columns on accounts and four new tables with their indexes, nothing else
-- touched. CLAUDE.md, The photo site, item 27 has the decisions.
--
-- accounts gains three columns, each with a default, so every row 0007 and
-- 0008 made reads as an account with no password yet:
--   password_hash    the PHC string lib/password.js's hashPassword wrote
--                    (#218), NULL until the person sets one from an emailed
--                    link (lib/sign-in.js's setPassword). Never the password.
--   session_version  the number every session cookie names
--                    (lib/account-session.js). Setting a password, signing
--                    out, and #225's revoke add 1, which ends every session
--                    at its next request: a cookie naming an older number is
--                    refused.
--   failed_sign_ins  failed sign-ins in a row (NIST SP 800-63B-4, section
--                    3.2.2: no more than 100). At FAILED_IN_A_ROW the password
--                    stops working until a new one is set from an emailed
--                    link; a sign-in that succeeds sets it back to 0.
ALTER TABLE accounts ADD COLUMN password_hash TEXT CHECK (password_hash IS NULL OR length(password_hash) BETWEEN 1 AND 200);
ALTER TABLE accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1);
ALTER TABLE accounts ADD COLUMN failed_sign_ins INTEGER NOT NULL DEFAULT 0 CHECK (failed_sign_ins >= 0);

-- sign_in_failures: one row per failed sign-in that was recorded, kept for an
-- hour, which limits each email address to 10 an hour and each network
-- address to 20 (criterion 3; the owner's choice at pickup, 2026-10-06).
-- email_hash is a keyed hash of the address as typed, lowercased, so an
-- address with no account is counted exactly as one with an account is, and
-- the limit says nothing about which it is (criterion 2). address_hash is
-- lib/address.js's, as join_failures (0002) and account_request_log (0007)
-- hold it. Neither is ever the address. A failure is deleted by the next
-- recorded failure or the next load of the admin home once it is an hour
-- old, and a sign-in that succeeds deletes its email address's at once.
-- No index on time: the table holds at most about two hours of the site's
-- budget, so the delete reads a few hundred rows at most, and every recorded
-- failure is one index write cheaper (cairn: d1-rows-written-by-statement).
CREATE TABLE sign_in_failures (
  email_hash   TEXT    NOT NULL,
  address_hash TEXT    NOT NULL,
  failed_at    INTEGER NOT NULL
);
CREATE INDEX sign_in_failures_by_email ON sign_in_failures (email_hash, failed_at);
CREATE INDEX sign_in_failures_by_address ON sign_in_failures (address_hash, failed_at);

-- sign_in_budget: the site's hourly budget of recorded failures, for every
-- address together, as join_budget (0003) and account_request_budget (0007)
-- are. One row per clock hour, keyed by the hour itself (Unix seconds /
-- 3600). Once the hour's 100 are spent, nobody can sign in until it turns,
-- and nothing is written (the owner's choice at pickup). Rows over a day old
-- are deleted when a new hour's row is made.
CREATE TABLE sign_in_budget (
  hour   INTEGER PRIMARY KEY,
  failed INTEGER NOT NULL
);

-- reset_request_log: one row per request on /forgot-password that passed
-- Turnstile, kept for an hour, which limits each network address to 10 an
-- hour (the owner's choice at pickup). The keyed hash again, never the
-- address. Deleted by the next request or the next load of the admin home
-- once it is an hour old.
CREATE TABLE reset_request_log (
  address_hash TEXT    NOT NULL,
  requested_at INTEGER NOT NULL
);
CREATE INDEX reset_request_log_by_address ON reset_request_log (address_hash, requested_at);

-- reset_mail_budget: how many reset emails the site has sent in a UTC day,
-- Resend's own day, at most 20 (the owner's choice at pickup): a fifth of
-- Resend's 100 a day, which every email the site sends shares. One row per
-- day, keyed by the day (Unix seconds / 86400). Rows over a week old are
-- deleted when a new day's row is made.
CREATE TABLE reset_mail_budget (
  day  INTEGER PRIMARY KEY,
  sent INTEGER NOT NULL
);
