// The address key for tests (#225). Not a test file: npm test runs only
// *.test.js.
//
// Since #225 requestAccount takes emailKey, the keyed hash of the address that
// revoked_addresses holds for an account an admin revoked (lib/sign-in.js's
// emailHash, under the ADDRESS_HASH_KEY secret). A test making a request
// passes emailKeyOf(email), and a test revoking passes ADDRESS_KEY as hashKey
// or as env.ADDRESS_HASH_KEY, so the two agree, as /ask and the revoke route
// do under the one secret.
import { emailHash } from '../lib/sign-in.js';

export const ADDRESS_KEY = 'test-address-hash-key-0123456789abcdef';

/** The emailKey /ask makes for `email`. */
export const emailKeyOf = (email) => emailHash(ADDRESS_KEY, email);
