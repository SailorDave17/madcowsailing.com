-- The hourly budget for recording failed joins, for the whole site (#177).
-- Additive: one new table, nothing else touched.
--
-- A recorded failure costs D1 4 rows written over its life (measured on
-- preview, 2026-09-28): 3 on insert, the table plus join_failures' two
-- indexes, and 1 when the join route deletes it an hour later. D1 allows
-- 100,000 a day for the whole account, and past that every query errors
-- until midnight UTC. So the join route spends one unit of this budget before
-- it records a failure, and records none once the hour's budget is spent
-- (functions/api/join.js says what it answers then).
--
-- One row per clock hour, keyed by the hour itself (Unix seconds / 3600).
-- INTEGER PRIMARY KEY is the rowid, so the row needs no index of its own and
-- spending a unit writes exactly one row. The join route deletes rows more
-- than a day old.
CREATE TABLE join_budget (
  hour     INTEGER PRIMARY KEY,
  recorded INTEGER NOT NULL
);
