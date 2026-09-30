-- The log that rate-limits "Remove this photo" (#158). Additive: one new
-- table and its indexes, nothing else touched.
--
-- One row per takedown that hid a photo, kept for an hour. A request that
-- hid nothing (a pending, hidden or unknown photo, a foreign Origin, or one
-- past the limit) writes no row: only an accepted takedown counts (owner, at
-- #158's pickup, 2026-09-30). So a request naming nothing public spends no
-- D1 write, and one address can hide at most REMOVAL_LIMIT photos an hour
-- (lib/removals.js).
--
-- address_hash is the keyed hash from lib/address.js, never the address, as
-- join_failures holds it (0002). The first index answers "how many from this
-- address in the last hour"; the second lets the next takedown delete the
-- rows more than an hour old without scanning the table. Pages runs no
-- scheduled job, so a row lives until the first takedown after its hour,
-- which /policy says.
--
-- The table names no photo. What a takedown keeps about the photo itself,
-- when it was hidden and the note, is on its own row in photos (0005's
-- hidden_at and hidden_note), which this migration does not touch.
CREATE TABLE removal_requests (
  address_hash TEXT    NOT NULL,
  requested_at INTEGER NOT NULL
);
CREATE INDEX removal_requests_by_address ON removal_requests (address_hash, requested_at);
CREATE INDEX removal_requests_by_time ON removal_requests (requested_at);
