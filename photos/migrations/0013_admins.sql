-- Admins (#224, D15): the admin role on an account, the one owner, and the
-- code emailed at an admin's sign-in. Additive: one column on accounts, one
-- new table, three indexes and seven triggers, nothing else touched.
-- CLAUDE.md, The photo site, item 30 has the decisions.
--
-- accounts.admin_role: NULL for everyone but the admins. 'admin' opens the
-- admin pages, and 'owner' opens them too and is the one that can take the
-- role away again (the owner's choice at #224's pickup, 2026-10-06: any admin
-- adds an admin, only the owner removes one). It is not accounts.role, the
-- parent, coach or other an account asked as (0007), which decides what it
-- sends; an admin is still a parent, a coach or other. The admin guard
-- (lib/admin-session.js, requireAdmin) reads it on every request, so taking
-- it away ends the admin pages at the next one (criterion 2).
--
-- Nothing here makes an owner: no address may go into this public repo, so
-- the first owner is made by hand, once per database, by the statement in
-- README.md, The photo site, Making the owner (owner, at #224's pickup).
ALTER TABLE accounts ADD COLUMN admin_role TEXT CHECK (admin_role IS NULL OR admin_role IN ('admin', 'owner'));

-- At most one owner. The triggers below make it at least one once there is
-- one, so the database holds exactly one owner from then on (criterion 3).
CREATE UNIQUE INDEX accounts_one_owner ON accounts (admin_role) WHERE admin_role = 'owner';

-- The admins, for the admins' email (lib/accounts.js, mailAdmins) and the
-- count the last-admin rule reads. Partial, so an account that is not an
-- admin, nearly every one, costs it nothing.
CREATE INDEX accounts_admins ON accounts (admin_role) WHERE admin_role IS NOT NULL;

-- The owner keeps the role, there is never a second, and the last admin is
-- never left with none (criteria 3 and 4). lib/people.js refuses each of
-- these before it reaches the database; these hold for every statement,
-- a by-hand one included.
--
-- The second check is not the unique index again. An UPDATE OR REPLACE that
-- gives a second account the owner role resolves the index's clash by
-- deleting the owner's whole row, and fires no DELETE trigger for it while
-- recursive_triggers is off, as it is on node:sqlite and D1 (measured on
-- node:sqlite 3.53.3, 2026-10-06: the owner's row was gone). A trigger runs
-- before the clash is resolved, so it refuses the statement instead.
CREATE TRIGGER accounts_admin_role_kept BEFORE UPDATE OF admin_role ON accounts
WHEN NEW.admin_role IS NOT OLD.admin_role
BEGIN
  SELECT RAISE(ABORT, 'the owner keeps the owner role') WHERE OLD.admin_role = 'owner';
  SELECT RAISE(ABORT, 'there is an owner already')
    WHERE NEW.admin_role = 'owner' AND EXISTS (SELECT 1 FROM accounts WHERE admin_role = 'owner');
  SELECT RAISE(ABORT, 'the last admin keeps the role')
    WHERE NEW.admin_role IS NULL AND (SELECT COUNT(*) FROM accounts WHERE admin_role IS NOT NULL) <= 1;
END;

-- The owner's account is never deleted, nor the last admin's: README's
-- by-hand delete and #225's delete meet this too.
CREATE TRIGGER accounts_admin_kept BEFORE DELETE ON accounts
WHEN OLD.admin_role IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'the owner account is kept') WHERE OLD.admin_role = 'owner';
  SELECT RAISE(ABORT, 'the last admin account is kept')
    WHERE (SELECT COUNT(*) FROM accounts WHERE admin_role IS NOT NULL) <= 1;
END;

-- A row REPLACE would remove: an insert clashing with an admin's id or email
-- deletes the admin's row and fires no DELETE trigger (above, and cairn:
-- sqlite-append-only-needs-a-replace-trigger-2026-09-24). Every unique key is
-- named: the id, the email, and the one-owner index.
--
-- The email clash is skipped (IGNORE), never refused, because /ask's insert
-- is an INSERT ... ON CONFLICT (email) DO NOTHING (lib/accounts.js,
-- requestAccount), and a BEFORE INSERT trigger runs before the conflict
-- clause does. Refusing there would answer /ask for an admin's address with
-- an error, where every known address gets the same 303 (#220's criterion
-- 4), and so would name the address an admin's. Skipped, it writes nothing,
-- as DO NOTHING does. A second owner is refused outright: /ask never names a
-- role.
CREATE TRIGGER accounts_admin_not_displaced BEFORE INSERT ON accounts
BEGIN
  SELECT RAISE(ABORT, 'there is an owner already')
    WHERE NEW.admin_role = 'owner' AND EXISTS (SELECT 1 FROM accounts WHERE admin_role = 'owner');
  SELECT RAISE(IGNORE)
    WHERE EXISTS (SELECT 1 FROM accounts WHERE admin_role IS NOT NULL AND (id = NEW.id OR email = NEW.email));
END;

-- And an UPDATE OR REPLACE that moves another row onto an admin's id or
-- email, which removes the admin's row the same way.
CREATE TRIGGER accounts_admin_not_displaced_by_key BEFORE UPDATE OF id, email ON accounts
WHEN EXISTS (
  SELECT 1 FROM accounts
  WHERE admin_role IS NOT NULL AND id IS NOT OLD.id AND (id = NEW.id OR email = NEW.email)
)
BEGIN
  SELECT RAISE(ABORT, 'that row would displace an admin');
END;

-- The owner's approved teams stay approved: no revoke (#225), no turn-down,
-- no move to another team or account, and no other row moved onto one by
-- UPDATE OR REPLACE (criterion 3: no action can revoke the owner).
CREATE TRIGGER account_teams_owner_kept BEFORE UPDATE ON account_teams
BEGIN
  SELECT RAISE(ABORT, 'the owner stays approved')
    WHERE OLD.state = 'approved'
      AND EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id AND admin_role = 'owner')
      AND (NEW.state IS NOT 'approved' OR NEW.account_id IS NOT OLD.account_id OR NEW.team IS NOT OLD.team);
  SELECT RAISE(ABORT, 'the owner stays approved')
    WHERE EXISTS (
      SELECT 1 FROM account_teams AS x JOIN accounts AS a ON a.id = x.account_id
      WHERE a.admin_role = 'owner' AND x.state = 'approved'
        AND x.account_id = NEW.account_id AND x.team = NEW.team
        AND NOT (x.account_id = OLD.account_id AND x.team = OLD.team)
    );
END;

CREATE TRIGGER account_teams_owner_not_removed BEFORE DELETE ON account_teams
WHEN OLD.state = 'approved' AND EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id AND admin_role = 'owner')
BEGIN
  SELECT RAISE(ABORT, 'the owner stays approved');
END;

-- REPLACE INTO account_teams on one of the owner's approved teams removes it
-- the same way. /ask's team insert never meets this: it inserts teams only
-- for an account with none (requestAccount).
CREATE TRIGGER account_teams_owner_not_displaced BEFORE INSERT ON account_teams
WHEN EXISTS (
  SELECT 1 FROM account_teams AS x JOIN accounts AS a ON a.id = x.account_id
  WHERE a.admin_role = 'owner' AND x.state = 'approved' AND x.account_id = NEW.account_id AND x.team = NEW.team
)
BEGIN
  SELECT RAISE(ABORT, 'the owner stays approved');
END;

-- admin_codes: the 6-digit code emailed at an admin's sign-in (criterion 1),
-- one row per code, made once the password has passed (lib/admin-code.js).
--
-- token_hash  the SHA-256 of the 32 random bytes in the browser's
--             __Host-sign-in-code cookie, which ties the code to the sign-in
--             it was emailed for: a code typed into another browser finds no
--             row. As password_links (0008) keeps a link's token.
-- version     the account's session_version when the password passed, so a
--             sign-out or a new password in between ends the code too.
-- code_hash   HMAC-SHA256 of the code and token_hash, keyed with the
--             SESSION_SIGNING_KEY secret, so neither the code nor the hash is
--             any use without the key: a 6-digit code has a million values,
--             which a plain hash would give up at once. NULL once the code is
--             used (it works once), or the email carrying it was refused.
-- tries       the tries spent, each claimed before the code is checked, so
--             tries sent at once cannot pass 5 (cairn:
--             a-count-then-record-limit-is-not-a-limit).
-- made_at     when the code was made. A row is kept for a day after it, so
--             an admin can be sent at most CODES_PER_DAY codes in any 24
--             hours; then the next code made, or the next load of the admin
--             home, deletes it.
-- expires_at  made_at + 10 minutes.
--
-- Deleting an account deletes its codes (ON DELETE CASCADE), which the index
-- serves, as it serves the day's count.
CREATE TABLE admin_codes (
  token_hash TEXT    PRIMARY KEY CHECK (length(token_hash) = 43),
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  version    INTEGER NOT NULL CHECK (version >= 1),
  code_hash  TEXT    CHECK (code_hash IS NULL OR length(code_hash) = 43),
  tries      INTEGER NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),
  made_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > made_at)
) WITHOUT ROWID;
CREATE INDEX admin_codes_by_account ON admin_codes (account_id, made_at);
