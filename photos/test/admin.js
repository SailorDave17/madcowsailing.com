// Admin sessions for tests (#224). Not a test file: npm test runs only
// *.test.js.
//
// Since #224 an admin route answers only to an account holding the admin
// role, through the __Host-admin cookie its sign-in sets once the emailed code
// passes (lib/admin-session.js). A test reaching an admin route through the
// whole chain seeds such an account with seedAdmin() and sends the cookie
// adminCookieHeader() mints for it, signed with ADMIN_KEY, which the test's
// env must carry as SESSION_SIGNING_KEY. The guard then runs unchanged: it
// checks the signature and the age, and reads the account's version, teams
// and role from the database on every request.
import { ADMIN_COOKIE, signAdminSession } from '../lib/admin-session.js';

export const ADMIN_KEY = 'test-session-signing-key-0123456789abcdef';
export const ADMIN_EMAIL = 'owner@example.com';
export const ADMIN_NAME = 'Owner';

/**
 * Seed an account holding `role` ('owner' or 'admin'), approved for Hoover
 * JRT, at session version 1, and answer its id. The first account a test
 * seeds is id 1, so a test that also makes accounts of its own seeds this
 * after them, or reads the ids back.
 */
export function seedAdmin(db, { email = ADMIN_EMAIL, name = ADMIN_NAME, role = 'owner', team = 'hoover-jrt' } = {}) {
  const { lastInsertRowid } = db.sqlite
    .prepare("INSERT INTO accounts (email, name, role, requested_at, admin_role) VALUES (?, ?, 'parent', 1, ?)")
    .run(email, name, role);
  db.sqlite.prepare("INSERT INTO account_teams (account_id, team, state) VALUES (?, ?, 'approved')").run(lastInsertRowid, team);
  return Number(lastInsertRowid);
}

/** A Cookie header carrying a current admin session for `accountId`. */
export async function adminCookieHeader(accountId, { key = ADMIN_KEY, version = 1, issued = Math.floor(Date.now() / 1000) } = {}) {
  return `${ADMIN_COOKIE}=${await signAdminSession(key, { accountId, version }, issued)}`;
}

/** What a route behind the guard finds on context.data.admin, for a test calling a route directly. */
export const adminData = (id = 1, { email = ADMIN_EMAIL, name = ADMIN_NAME, role = 'owner', issued = 1 } = {}) =>
  ({ admin: { id, name, email, role, issued } });
