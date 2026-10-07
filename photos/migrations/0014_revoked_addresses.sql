-- Revoking a person (#225, epic #216): the email address of an account an
-- admin revoked for a team, kept as a keyed hash, so that a new request from
-- it is held back while the account exists and after it is deleted. Additive:
-- one new table and one index, nothing else touched. CLAUDE.md, The photo
-- site, item 31 has the decisions.
--
-- revoked_addresses: one row per address revoked, written in the same batch
-- as the revoke itself (lib/people.js, revokeTeams).
--
--   email_hash  lib/sign-in.js's emailHash of the account's address, keyed
--               with the ADDRESS_HASH_KEY secret, as failed sign-ins count an
--               address (0009), so the table holds no address. /ask
--               (lib/accounts.js, requestAccount) writes nothing for an
--               address whose hash is here, by the same statements it runs
--               for every other address (#220's criterion 4), so a revoked
--               address never comes back as a fresh request (#225's
--               criterion 5).
--   account_id  the revoked account, while it exists, so re-approving its
--               last revoked team deletes the row in the approval's own batch
--               (approveTeams), with no key needed. ON DELETE SET NULL: once
--               the account is deleted, by an admin (deleteAccount) or by
--               README's statement by hand, only the hash stays, as /policy
--               says (owner, at #219's review, 2026-10-05). An admin lifts
--               that by typing the address into "Let an address ask again"
--               on /admin/people (allowAddress; the owner's choice at #225's
--               pickup, 2026-10-07).
--
-- The hash is written when the revoke happens, not when the account is
-- deleted, so README's by-hand delete keeps it too: no statement typed by
-- hand can make a keyed hash.
CREATE TABLE revoked_addresses (
  email_hash TEXT    PRIMARY KEY CHECK (length(email_hash) = 43),
  account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL
) WITHOUT ROWID;

-- Serves the approval's lift and the lookup the delete's SET NULL makes, as
-- 0012's photos_by_account does. Partial, so a deleted account's row, whose
-- account_id is NULL, costs it nothing.
CREATE INDEX revoked_addresses_by_account ON revoked_addresses (account_id) WHERE account_id IS NOT NULL;
