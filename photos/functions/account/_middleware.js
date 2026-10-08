/**
 * The guard in front of every route under /account (#222): a signed-in
 * account, then, for any method but GET and HEAD, the site's own Origin, as
 * the admin directories run them (#152). lib/account-session.js's
 * requireAccount says what passes. test/guard.test.js holds every route here
 * to both, so a later account route gets them from its directory rather than
 * from memory.
 */
import { requireAccount } from '../../lib/account-session.js';
import { requireSameOrigin } from '../../lib/origin.js';

export const onRequest = [requireAccount, requireSameOrigin];
