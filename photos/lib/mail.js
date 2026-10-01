/**
 * Email from the photo site, through Resend's HTTP API (#217).
 *
 * One POST with fetch and no library (CLAUDE.md, The photo site, item 21):
 * plain text, from no-reply@photos.madcowsailing.com, with replies going to
 * the owner's mailbox. The API key is the RESEND_API_KEY Pages secret, which
 * Resend scoped to Sending access for photos.madcowsailing.com only.
 *
 * sendMail() never throws for anything Resend or the network does. It answers
 * { ok: true, id } or { ok: false, reason }, and the caller says what the
 * person sees. The reasons:
 *
 *   not-configured  no RESEND_API_KEY in this environment; nothing was tried
 *   address         `to` is not one plain address; nothing was tried
 *   message         the subject or text is empty, too long or multi-line;
 *                   nothing was tried
 *   quota           Resend's daily (100) or monthly (3,000) limit is used up
 *   rate            more than 10 requests in one second, across the team
 *   refused         any other 4xx; `status` and `error` say which
 *   unreachable     no answer within TIMEOUT_MS, a dropped connection, or a
 *                   5xx. Resend did not confirm the send, which is not the
 *                   same as no send: the request may have landed, so a
 *                   caller that retries can send twice.
 *
 * What it logs is the reason, Resend's status and Resend's error name, and
 * nothing else: never the address, the subject, the text or Resend's own
 * message, which can quote an address ("You can only send testing emails to
 * your own email address (...)"). test/mail.test.js plants each and reads
 * every log line.
 */

export const RESEND_URL = 'https://api.resend.com/emails';
export const MAIL_FROM = 'Mad Cow Sailing photos <no-reply@photos.madcowsailing.com>';
export const MAIL_REPLY_TO = 'dave@madcowsailing.com';

// Resend refuses a request with no User-Agent, 403 ("All API requests must
// include a User-Agent header", its API introduction, read 2026-10-01). Node's
// fetch adds one of its own and workerd's adds none: on #217, under wrangler
// pages dev, a send without this line reached a local echo server with no
// User-Agent at all. So a test run under Node would pass without it while
// every send on Cloudflare was refused; test/mail.test.js requires it.
export const USER_AGENT = 'madcowphotos/1.0 (+https://photos.madcowsailing.com)';

// A request is still waiting on a send this long at most. Resend answers in
// well under a second when it answers at all.
export const TIMEOUT_MS = 10_000;

export const SUBJECT_MAX = 200;
export const TEXT_MAX = 20_000;

// One address and nothing else: no display name, no list, no whitespace or
// control character, a dotted domain. RFC 5321 caps a path at 256 octets, and
// so an address at 254. Stricter than the RFC on purpose: every address this
// site sends to is one a person typed into a form.
const ADDRESS = /^[^\s\x00-\x1f\x7f@<>(),;:"\\[\]]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export const isEmailAddress = (text) => typeof text === 'string' && text.length <= 254 && ADDRESS.test(text);

const singleLine = (text, max) =>
  typeof text === 'string' && text.trim().length > 0 && text.length <= max && !/[\x00-\x1f\x7f]/.test(text);

const plainText = (text) =>
  typeof text === 'string' && text.trim().length > 0 && text.length <= TEXT_MAX && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);

// Resend's error names are lowercase words joined by underscores
// (daily_quota_exceeded). Anything else is not logged as given.
const errorNameOf = async (res) => {
  try {
    const { name } = await res.json();
    return typeof name === 'string' && /^[a-z_]{1,64}$/.test(name) ? name : 'unknown';
  } catch {
    return 'unknown';
  }
};

const QUOTA_ERRORS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

/** Send `text` with `subject` to the one address `to`. Never throws. */
export async function sendMail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) {
    console.error('mail: RESEND_API_KEY is not configured, so nothing was sent');
    return { ok: false, reason: 'not-configured' };
  }
  if (!isEmailAddress(to)) return { ok: false, reason: 'address' };
  if (!singleLine(subject, SUBJECT_MAX) || !plainText(text)) {
    console.error('mail: the subject or the text is empty, too long or holds a control character, so nothing was sent');
    return { ok: false, reason: 'message' };
  }

  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], reply_to: MAIL_REPLY_TO, subject, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The name only (TimeoutError, TypeError): a network error's message can
    // carry the request it failed on.
    console.error('mail: Resend did not answer, so the send is unconfirmed:', err instanceof Error ? err.name : 'unknown');
    return { ok: false, reason: 'unreachable' };
  }

  if (res.ok) {
    let id = null;
    try {
      ({ id = null } = await res.json());
    } catch {
      // Sent all the same: a 2xx is Resend accepting the message.
    }
    return { ok: true, id: typeof id === 'string' ? id : null };
  }

  const error = await errorNameOf(res);
  const reason = res.status >= 500 ? 'unreachable'
    : res.status === 429 ? (QUOTA_ERRORS.has(error) ? 'quota' : 'rate')
      : 'refused';
  console.error('mail: Resend refused a message:', reason, res.status, error);
  return { ok: false, reason, status: res.status, error };
}
