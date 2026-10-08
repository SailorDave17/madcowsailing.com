/**
 * The invite code: how one is made, and how a code someone sends is read.
 *
 * The code is the only thing between the open web and the approval queue
 * (epic #147, D1 and D2), so it is long enough that guessing is hopeless:
 * 12 symbols from a 32-symbol alphabet, 60 bits, grouped in fours so it can
 * be read aloud (K7QM-3XRD-9FWB). The alphabet is Crockford's base 32, which
 * leaves out I, L and O, the letters that pass for 1 and 0, and U. Reading a
 * code back maps those look-alikes to the digit a person meant, so a code
 * copied by hand still works.
 *
 * No modulo bias: 256 is a multiple of 32, so the low five bits of a random
 * byte pick every symbol exactly as often as every other. The randomness is
 * crypto.getRandomValues, which the Workers runtime and Node both provide.
 *
 * The code lives in D1 (invite_codes, migration 0002), one row per
 * generation, newest current. The admin page shows it (#152), so it is stored
 * as it is, not hashed. Older generations stay, so a link to one can be told
 * apart from a wrong code: the share page says the invite has changed.
 *
 * Only the admin page makes a code (#152): "Create code" once, then "Rotate
 * code". Each is one statement, so two presses at once cannot make two codes
 * of one generation, and neither reads the table first.
 */

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SYMBOLS = 12;
export const GROUP = 4;
export const BITS = SYMBOLS * Math.log2(ALPHABET.length);

const LOOK_ALIKES = { O: '0', I: '1', L: '1' };

/**
 * A new code, grouped for reading. `random` fills a Uint8Array and returns
 * it, as crypto.getRandomValues does; tests pass their own.
 */
export function newCode(random = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = random(new Uint8Array(SYMBOLS));
  let code = '';
  for (let i = 0; i < SYMBOLS; i++) {
    if (i > 0 && i % GROUP === 0) code += '-';
    code += ALPHABET[bytes[i] & (ALPHABET.length - 1)];
  }
  return code;
}

/**
 * A code as someone sent it, reduced to its 12 symbols: case, spaces and
 * dashes ignored, look-alikes mapped. Null when what is left cannot be a code.
 * Never throws, and never echoes the input anywhere.
 */
export function normalizeCode(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  let out = '';
  for (const ch of input.toUpperCase()) {
    if (ch === '-' || ch === ' ') continue;
    const symbol = LOOK_ALIKES[ch] ?? ch;
    if (!ALPHABET.includes(symbol)) return null;
    out += symbol;
  }
  return out.length === SYMBOLS ? out : null;
}

// The address parents are sent to. Production's is the site's own domain.
// Any other environment's is wherever the admin page was opened (a preview,
// or localhost), so a link copied there opens that environment's code.
export const PRODUCTION_SITE = 'https://photos.madcowsailing.com';

export function inviteSite(request, env) {
  return env.SITE_ENV === 'production' ? PRODUCTION_SITE : new URL(request.url).origin;
}

/** The invite link for `code`: the code rides after #, which no server sees. */
export const inviteLink = (site, code) => `${site}/share/#code=${code}`;

/**
 * The current code as { generation, code, createdAt }, createdAt in Unix
 * seconds, or null when the database holds none yet.
 */
export async function currentCode(db) {
  const row = await db
    .prepare('SELECT generation, code, created_at FROM invite_codes ORDER BY generation DESC LIMIT 1')
    .first();
  return row ? { generation: row.generation, code: row.code, createdAt: row.created_at } : null;
}

/**
 * Replace the current code with a new one, as the next generation. Every
 * upload session names the generation it was opened with, so from the next
 * request each one opened before this is refused (lib/session.js), and the
 * old code's link reads as rotated (functions/api/join.js).
 */
export async function rotateCode(db, now, random) {
  await db
    .prepare(
      'INSERT INTO invite_codes (generation, code, created_at) ' +
      'SELECT COALESCE(MAX(generation), 0) + 1, ?, ? FROM invite_codes',
    )
    .bind(newCode(random), now)
    .run();
}

/**
 * Make the first code, as generation 1, only if the database holds none. A
 * second press, or a stale page, changes nothing: it never rotates.
 */
export async function createFirstCode(db, now, random) {
  await db
    .prepare(
      'INSERT INTO invite_codes (generation, code, created_at) ' +
      'SELECT 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM invite_codes)',
    )
    .bind(newCode(random), now)
    .run();
}
