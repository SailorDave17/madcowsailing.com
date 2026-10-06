/**
 * What a new password must be (#222, criterion 1), under NIST SP 800-63B-4,
 * section 3.1.1.2 (pages.nist.gov/800-63-4/sp800-63b.html, last modified
 * 2025-08-26, read 2026-10-06). CLAUDE.md, The photo site, item 27 quotes
 * each rule. In short:
 *
 *   - at least PASSWORD_MIN characters, since the password is the only
 *     factor a parent or coach signs in with: "SHALL require passwords that
 *     are used as a single-factor authentication mechanism to be a minimum
 *     of 15 characters in length";
 *   - at most PASSWORD_MAX: "SHOULD permit a maximum password length of at
 *     least 64 characters";
 *   - normalised to NFC before it is counted or hashed, each code point one
 *     character ("Each Unicode code point SHALL be counted as a single
 *     character"; "SHOULD apply ... (NFC) ... before hashing"). #218's
 *     lib/password.js hashes the UTF-8 it is given, so the normalising is
 *     here, and sign-in normalises the same way;
 *   - no composition rules ("SHALL NOT impose other composition rules");
 *   - a blocklist, the whole password compared: the person's own email
 *     address and name and the site's names, here, and every password seen
 *     in a breach, by Have I Been Pwned's Pwned Passwords (pwned below; the
 *     owner's choice at #222's pickup, 2026-10-06).
 *
 * Nothing here logs a password, any part of one, or any part of its hash.
 */
import { USER_AGENT } from './mail.js';

export const PASSWORD_MIN = 15;
// Long enough for any passphrase or password manager. scrypt's cost does not
// grow with it (lib/password.js), and the form's own cap holds the bytes.
export const PASSWORD_MAX = 256;

// The site's own names and the teams', which NIST lists as "context-specific
// words, such as the name of the service", compared folded (fold below).
export const SITE_WORDS = Object.freeze([
  'madcow', 'madcowsailing', 'madcowsailingcom', 'madcowsailingphotos', 'madcowphotos',
  'photosmadcowsailing', 'photosmadcowsailingcom', 'hooverjrt', 'hooversailing', 'hooversailingclub', 'cohssa',
]);

/** A password as the site counts, hashes and compares it: NFC. */
export const normalizePassword = (text) => text.normalize('NFC');

/** Its length in characters: code points, after NFC. */
export const passwordLength = (text) => [...normalizePassword(text)].length;

// Lowercased, with every character that is not a letter or a digit left out,
// so "Mad Cow Sailing photos!" and "madcowsailingphotos" compare equal.
const fold = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export const MESSAGES = Object.freeze({
  missing: 'Enter a password.',
  short: `Use at least ${PASSWORD_MIN} characters. A few unrelated words in a row make a long password that is easy to remember.`,
  long: `Use at most ${PASSWORD_MAX} characters.`,
  confirm: 'The two passwords are not the same. Type it again in both.',
  context: 'Choose a password that is not your email address, your name or the site\'s name.',
  breached: 'This password has appeared in a data breach elsewhere, so it is among the first anyone would try. Choose another: a few unrelated words in a row is a good start.',
});

/**
 * The new password in a submitted form (URLSearchParams with `password` and
 * `confirm`), for the account whose address is `email` and name `name`, or
 * the reasons it cannot be one: { password } in NFC, or { errors }, each
 * { field, message }. The breach check is separate (pwned), since it is a
 * call to another service, made only once everything here passes.
 */
export function readNewPassword(form, { email, name }) {
  const raw = (field) => {
    const value = form.get(field);
    return typeof value === 'string' ? value : '';
  };
  const password = normalizePassword(raw('password'));
  const length = [...password].length;
  if (length === 0) return { errors: [{ field: 'password', message: MESSAGES.missing }] };
  if (length < PASSWORD_MIN) return { errors: [{ field: 'password', message: MESSAGES.short }] };
  if (length > PASSWORD_MAX) return { errors: [{ field: 'password', message: MESSAGES.long }] };
  if (normalizePassword(raw('confirm')) !== password) return { errors: [{ field: 'confirm', message: MESSAGES.confirm }] };
  const folded = fold(password);
  const own = [email, email.split('@')[0], name].map(fold).filter(Boolean);
  if (own.includes(folded) || SITE_WORDS.includes(folded)) return { errors: [{ field: 'password', message: MESSAGES.context }] };
  return { password };
}

// Have I Been Pwned's Pwned Passwords range API: "GET
// https://api.pwnedpasswords.com/range/{first 5 SHA-1 chars}", with "no
// authorisation required for the free Pwned Passwords API", and padding "by a
// request header" (Add-Padding: true), so the answer's size says nothing about
// the prefix asked (haveibeenpwned.com/API/v3, read 2026-10-06).
export const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
// The owner's 3 s at pickup: a longer wait holds the person's form, and a
// miss lets the password through, so it is not worth more.
export const PWNED_TIMEOUT_MS = 3000;

async function sha1Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Whether `password` (NFC already) has been seen in a breach, by Pwned
 * Passwords: 'breached', 'clear', or 'unavailable' when the API did not
 * answer within PWNED_TIMEOUT_MS or answered with anything but 200. Only the
 * first 5 characters of the password's SHA-1 leave the site, and the suffix
 * is compared here. A padded line counts 0, and so is not a breach. Never
 * throws: an unavailable check lets the password through, which the owner
 * chose at pickup over refusing every password while the API is down.
 */
export async function pwned(password) {
  const hash = await sha1Hex(password);
  const [prefix, suffix] = [hash.slice(0, 5), hash.slice(5)];
  let answer;
  try {
    const response = await fetch(`${PWNED_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(PWNED_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      console.error('password-rules: the breach check answered', response.status, 'so the password was let through');
      return 'unavailable';
    }
    answer = await response.text();
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'error';
    console.error('password-rules: the breach check did not answer, so the password was let through:', reason);
    return 'unavailable';
  }
  for (const line of answer.split('\n')) {
    const [seen, count] = line.trim().split(':');
    if (seen === suffix && Number(count) > 0) return 'breached';
  }
  return 'clear';
}
