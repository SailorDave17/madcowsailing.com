/**
 * GET /api/admin/password-probe: runs the password hash once, so its CPU can
 * be measured on the develop preview (#218). On production it answers 404, so
 * nothing there can be made to spend CPU by it. The guards in _middleware.js
 * run first everywhere, as on every admin API.
 *
 *   ?run=hash      (the default) one hashPassword() at SCRYPT: the work a
 *                  sign-in or a new password costs, which is one scrypt. It
 *                  answers the string it made, so Node can check that the
 *                  deployed runtime hashed the probe's own password at
 *                  SCRYPT's parameters.
 *   ?run=none      everything but the hash: the control a reading is
 *                  compared with.
 *   ?run=over-cap  asks each key-derivation function the runtime offers for
 *                  one step past the limit workerd's source sets, and reports
 *                  which were refused, with the runtime's own message. Node
 *                  sets no such limit, and local wrangler lifts the PBKDF2
 *                  one, so only a deployed preview shows Cloudflare's.
 *
 * #161's method reads the CPU: one mode alone per UTC minute, then the GraphQL
 * Analytics API's pagesFunctionsInvocationsAdaptiveGroups by minute.
 * CLAUDE.md, The photo site, items 8 and 23 hold the readings.
 *
 * The password hashed is a fixed probe string, not anyone's, and nothing is
 * stored or logged.
 */
import { pbkdf2, scrypt } from 'node:crypto';

import { SCRYPT, hashPassword, phcParams } from '../../../lib/password.js';

export const PROBE_PASSWORD = 'password-probe: not a real password';

// One step past each limit read in workerd's limit-enforcer.h: 100,000 PBKDF2
// iterations, and an scrypt N·r·p of 2^20. The scrypt case keeps N small, so
// it needs about 1 MiB however it is answered.
export const OVER_CAP = Object.freeze({
  pbkdf2Iterations: 100_001,
  scrypt: Object.freeze({ N: 2 ** 10, r: 8, p: 129 }),
});

export async function onRequestGet({ request, env }) {
  if (env.SITE_ENV === 'production') return new Response('Not found', { status: 404 });
  const run = new URL(request.url).searchParams.get('run') ?? 'hash';
  const headers = { 'Cache-Control': 'no-store' };
  if (run === 'hash') {
    const stored = await hashPassword(PROBE_PASSWORD);
    return Response.json({ run, params: stored.split('$')[2], stored }, { headers });
  }
  if (run === 'none') return Response.json({ run, params: phcParams(SCRYPT) }, { headers });
  if (run === 'over-cap') return Response.json({ run, ...(await overCap()) }, { headers });
  return Response.json({ error: 'run' }, { status: 400, headers });
}

/**
 * Asks each function for OVER_CAP and reports what it answered. The route
 * passes the runtime's own functions. They are a parameter so a test can see
 * what each was asked and how a refusal is reported, since Node refuses none
 * of these.
 */
export async function overCap(kdf = { subtle: crypto.subtle, pbkdf2, scrypt }) {
  const password = new TextEncoder().encode(PROBE_PASSWORD);
  const salt = new Uint8Array(16);
  const { pbkdf2Iterations: iterations } = OVER_CAP;
  const webCrypto = async () => {
    const key = await kdf.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    await kdf.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  };
  const nodePbkdf2 = () => new Promise((resolve, reject) => {
    kdf.pbkdf2(password, salt, iterations, 32, 'sha256', (err) => (err ? reject(err) : resolve()));
  });
  const nodeScrypt = () => new Promise((resolve, reject) => {
    kdf.scrypt(password, salt, 32, { ...OVER_CAP.scrypt, maxmem: 8 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
  });
  return {
    pbkdf2WebCrypto: await outcome(webCrypto),
    pbkdf2Node: await outcome(nodePbkdf2),
    scryptNode: await outcome(nodeScrypt),
  };
}

async function outcome(attempt) {
  try {
    await attempt();
    return 'accepted';
  } catch (err) {
    return `refused: ${err instanceof Error ? err.message : String(err)}`;
  }
}
