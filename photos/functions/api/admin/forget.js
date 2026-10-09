/**
 * POST /api/admin/forget (#274, criterion 4): "Forget this phone" on the
 * admin home. It deletes this browser's admin cookie (__Host-admin) and
 * nothing else, then lands on /account, which says so (`?forgotten`).
 *
 * "This browser's admin session only": it writes nothing to the database.
 * The account's own cookie (__Host-account, 90 days, for sending photos)
 * stays, and so does every other phone and computer, since the session
 * version is not touched. That was the owner's choice at #274's pickup
 * (2026-10-08). Not chosen: a server-side record of each admin session, so
 * that Forget could end a copy too, which would take a migration and one
 * more read on every admin request; and adding 1 to the session version,
 * which is Sign out (functions/sign-out.js) and ends every device. The cost,
 * written down in CLAUDE.md item 30, README and /policy: the cookie is
 * signed and the server keeps no list of them, so a copy taken off this
 * browser keeps working until its length runs out, until Sign out or a new
 * password ends every session the account holds, or until losing the admin
 * role closes the admin pages to every admin cookie it has (its sending
 * session stays). A phone that is lost cannot press this: Sign out on any
 * other phone or computer, or a new password through /forgot-password.
 *
 * Behind both admin guards (_middleware.js), so a press without a live
 * admin session is the guard's 303 to /sign-in?admin, which deletes a dead
 * cookie itself, and a press from another site is a 403. That page's notice
 * says a Forget press refused there needs nothing more (lib/sign-in-page.js,
 * SIGN_IN_NOTICES.admin): this browser already opens no admin pages. It needs no field,
 * so the form posts nothing. GET changes nothing, as every admin write's GET
 * changes nothing: GET needs no Origin, so a page elsewhere could send one.
 */
import { clearAdminCookie } from '../../../lib/admin-session.js';
import { seeOther } from '../../../lib/form.js';

export function onRequestPost() {
  const response = seeOther('/account?forgotten');
  response.headers.append('Set-Cookie', clearAdminCookie());
  return response;
}

export const onRequestGet = () => seeOther('/admin/');
