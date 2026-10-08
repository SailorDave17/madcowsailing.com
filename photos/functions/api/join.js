/**
 * POST /api/join: trade the current invite code for an upload session.
 *
 * The share page sends {"code": "<code>"} from the invite link's fragment,
 * which never reaches a server by itself (#150). The answers:
 *
 *   204  the current code: one Set-Cookie, the session (lib/session.js)
 *   204  no Set-Cookie: the request already carries the session of a coach
 *        still on COACH_EMAILS (#192), whatever code it presents
 *   403  {"error":"origin"}   no Origin, or another site's
 *   403  {"error":"wrong"}    not a code this site has had
 *   403  {"error":"rotated"}  an earlier code, so the page can say the invite
 *                             has changed rather than that it is wrong
 *   429  {"error":"too-many"} FAILURE_LIMIT failures from this address in the
 *                             last hour, whatever this request carries
 *   400  a body that is not {"code": "<string>"}
 *   503  the database or a secret is missing: closed, never open
 *
 * A coach signed in at /coach who opens the invite link keeps their coach's
 * session (owner, at #192's review). The cookie name is shared, so joining
 * would otherwise put a parent's session in its place: their photos would be
 * stored as a parent's, and the next rotation would end their sending. A
 * coach no longer on the list is joined like anyone else. This answer reads
 * no database and records nothing.
 *
 * Only a 403 for a wrong or earlier code counts as a failure. The address is
 * stored as a keyed hash (lib/address.js), and a failure is deleted by the
 * first join after it is an hour old.
 *
 * Recording a failure spends D1's daily writes, which the whole account
 * shares, so it first spends one unit of the hour's FAILURE_BUDGET_PER_HOUR
 * for the whole site (#177). Once that is spent, a failure is answered as
 * usual and not recorded: the current code still joins, and an address
 * already recorded 10 times is still refused. A new address can then try
 * past the per-address limit until the hour turns, which the owner accepted
 * on 2026-09-28: at 60 bits the guess stays hopeless, and the alternative,
 * closing joining for everyone, hands anyone a cheap way to stop every parent.
 *
 * The presented code is compared with every stored one through SHA-256
 * digests and timing.equal, so the time taken says nothing about how much of
 * a guess was right. Nothing here logs the code, the cookie or a key, and the
 * body is parsed where its error cannot escape: V8's JSON.parse error quotes
 * the text it choked on, and the root middleware logs an escaped error's
 * message.
 */
import { addressHash } from '../../lib/address.js';
import { sha256, timing } from '../../lib/crypto.js';
import { normalizeCode } from '../../lib/invite.js';
import { sameOrigin } from '../../lib/origin.js';
import { coachListed, nowSeconds, readSession, sessionCookie } from '../../lib/session.js';

// 10 an hour: the owner's choice at #150's pickup, 2026-09-27, over 5 and 20.
// At 60 bits a guesser gets nowhere at any of them. The limit is for the
// club's shared Wi-Fi as much as for an attacker, so it stays out of reach
// of a few parents pasting a broken link.
export const FAILURE_LIMIT = 10;
export const FAILURE_WINDOW_SECONDS = 60 * 60;

// 100 recorded failures a clock hour, for the whole site (owner, 2026-09-28,
// #177). A recorded failure costs 5 rows written with the budget's own write
// (measured on preview; CLAUDE.md item 11), so the join route can spend at
// most 5 × 100 × 24 = 12,000 of D1's 100,000 a day, whoever sends them.
export const FAILURE_BUDGET_PER_HOUR = 100;
const HOUR_SECONDS = 60 * 60;
const BUDGET_KEPT_HOURS = 24;

// A body this size holds any code with room to spare.
const MAX_BODY_BYTES = 1024;

// How many generations back a code is recognised as an earlier one. Older
// than this, it reads as wrong, which is only a less helpful message.
const GENERATIONS_CHECKED = 50;

const answer = (status, error, headers = {}) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return answer(403, 'origin');

  const { DB, SESSION_SIGNING_KEY, ADDRESS_HASH_KEY } = env;
  if (!DB || !SESSION_SIGNING_KEY || !ADDRESS_HASH_KEY) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('join: the database or a secret is not configured, so joining is closed');
    return answer(503, 'closed');
  }

  const held = await readSession(request, SESSION_SIGNING_KEY);
  if (held?.sender === 'coach' && (await coachListed(SESSION_SIGNING_KEY, held.coach, env.COACH_EMAILS))) {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const now = nowSeconds();
  const since = now - FAILURE_WINDOW_SECONDS;
  const address = await addressHash(ADDRESS_HASH_KEY, request);
  await DB.prepare('DELETE FROM join_failures WHERE failed_at <= ?').bind(since).run();
  const recent = await DB
    .prepare('SELECT COUNT(*) AS failures, MIN(failed_at) AS oldest FROM join_failures WHERE address_hash = ? AND failed_at > ?')
    .bind(address, since)
    .first();
  if (recent.failures >= FAILURE_LIMIT) {
    return answer(429, 'too-many', { 'Retry-After': String(recent.oldest + FAILURE_WINDOW_SECONDS - now) });
  }

  const presented = await readCode(request);
  if (presented === undefined) return answer(400, 'bad-request');

  const { results: codes } = await DB
    .prepare('SELECT generation, code FROM invite_codes ORDER BY generation DESC LIMIT ?')
    .bind(GENERATIONS_CHECKED)
    .all();
  const matched = await matchGeneration(presented, codes);

  if (matched !== null && matched === codes[0].generation) {
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': await sessionCookie(SESSION_SIGNING_KEY, matched, now),
        'Cache-Control': 'no-store',
      },
    });
  }

  if (await spendBudget(DB, now)) {
    await DB.prepare('INSERT INTO join_failures (address_hash, failed_at) VALUES (?, ?)').bind(address, now).run();
  }
  return answer(403, matched === null ? 'wrong' : 'rotated');
}

/**
 * Spend one unit of this clock hour's recording budget, and say whether there
 * was one. One statement: it creates the hour's row at 1, or adds 1 while the
 * row is under the budget, and RETURNING gives a row only when it did either.
 * A spent hour writes nothing. D1 counts 2 rows read and at most 1 written,
 * whatever else is in the table (measured on preview, 2026-09-28). Rows over
 * a day old are deleted here, at most once an hour, when a new hour's row is made.
 */
async function spendBudget(DB, now) {
  const hour = Math.floor(now / HOUR_SECONDS);
  const spent = await DB
    .prepare(
      'INSERT INTO join_budget (hour, recorded) VALUES (?, 1) ' +
      'ON CONFLICT (hour) DO UPDATE SET recorded = recorded + 1 WHERE recorded < ? ' +
      'RETURNING recorded',
    )
    .bind(hour, FAILURE_BUDGET_PER_HOUR)
    .first();
  if (spent === null) return false;
  if (spent.recorded === 1) {
    await DB.prepare('DELETE FROM join_budget WHERE hour < ?').bind(hour - BUDGET_KEPT_HOURS).run();
  }
  return true;
}

/**
 * The code in the body, normalised: a string of 12 symbols, null when the
 * body names something that cannot be a code (a wrong code), or undefined
 * when the body is not {"code": "<string>"} at all.
 */
async function readCode(request) {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return undefined;
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return undefined;
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (body === null || typeof body !== 'object' || typeof body.code !== 'string') return undefined;
  return normalizeCode(body.code);
}

/**
 * The generation whose code was presented, or null. Every stored code is
 * digested and compared, whichever matched and whether or not the presented
 * one could be a code at all.
 */
async function matchGeneration(presented, codes) {
  const digest = await sha256(presented ?? '');
  let matched = null;
  for (const row of codes) {
    const stored = normalizeCode(row.code);
    const same = timing.equal(digest, await sha256(stored ?? ''));
    if (same && presented !== null && stored !== null && matched === null) matched = row.generation;
  }
  return matched;
}
