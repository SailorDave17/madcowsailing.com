// The admin guard: the Cloudflare Access token check every /admin page and
// admin API passes first (#151, criteria 2, 3 and 5).
//
// Every case runs requireOwner as the admin middleware runs it, with tokens
// minted here from generated key pairs and the team's certs endpoint stood in
// for by a mocked fetch. A refused request must answer 403 (503 where the
// keys cannot be read), never reach the route, and carry nothing of it. The
// refusal each case predicts, and the check that makes it, were written down
// before lib/access.js existed; the PR shows that table.
//
// Timing tests advance the clock by literal seconds, never by the constants
// they test, so a changed constant turns them red (prove-tests shape 15).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOCK_SKEW_SECONDS, KEYS_MAX_AGE_SECONDS, REFETCH_GAP_SECONDS, TOKEN_HEADER, keyCache, requireOwner,
} from '../lib/access.js';
import { COOKIE_NAME, signSession } from '../lib/session.js';
import { AUD, OWNER, TEAM, accessEnv, certs, claims, keyPair, mint, publicPem, segment } from './access.js';
import { base64url, hmac } from '../lib/crypto.js';

const SITE = 'https://photos.madcowsailing.com';
const ROUTE_BODY = 'ADMIN-ROUTE-CONTENT';

const team = await keyPair();
const stranger = await keyPair();

beforeEach(() => keyCache.clear());

// Runs the guard once. `reached` says whether the route behind it ran.
async function guard({ token, env = accessEnv(), headers = {}, url = `${SITE}/admin/` } = {}) {
  const all = { ...headers };
  if (token !== undefined) all[TOKEN_HEADER] = token;
  const context = {
    request: new Request(url, { headers: all }),
    env,
    data: {},
    reached: false,
  };
  context.next = async () => {
    context.reached = true;
    return new Response(ROUTE_BODY, { status: 200 });
  };
  const response = await requireOwner(context);
  return { response, reached: context.reached, data: context.data, body: await response.text() };
}

const publishes = (t, keys = () => [team.jwk]) => t.mock.method(globalThis, 'fetch', certs(keys));

async function assertRefused(result, status = 403) {
  assert.equal(result.response.status, status);
  assert.equal(result.reached, false, 'the route ran behind a refused token');
  assert.doesNotMatch(result.body, new RegExp(ROUTE_BODY));
  assert.doesNotMatch(result.body, new RegExp(OWNER.replace('.', '\\.')));
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
}

const now = () => Math.floor(Date.now() / 1000);

// ---- Tokens that pass --------------------------------------------------

test('V1: a valid token for an email on the list reaches the route, which learns the email', async (t) => {
  publishes(t);
  const result = await guard({ token: await mint(team) });
  assert.equal(result.response.status, 200);
  assert.equal(result.reached, true);
  assert.deepEqual(result.data.owner, { email: OWNER });
});

test('V2: the list is compared without regard to letter case', async (t) => {
  publishes(t);
  const upper = await guard({ token: await mint(team, claims({ email: OWNER.toUpperCase() })) });
  assert.equal(upper.reached, true);
  const listed = await guard({ token: await mint(team), env: accessEnv({ ADMIN_EMAILS: ` ${OWNER.toUpperCase()} , other@example.com` }) });
  assert.equal(listed.reached, true);
});

test('V3: a token whose nbf is up to 60 s ahead of the clock passes (clock drift)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  publishes(t);
  assert.equal((await guard({ token: await mint(team, claims({ nbf: now() + 30 })) })).reached, true);
  assert.equal((await guard({ token: await mint(team, claims({ nbf: now() + 60 })) })).reached, true);
});

test('R4b: a token whose nbf is 61 s ahead of the clock is refused (the drift allowance ends at 60)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ nbf: now() + 61 })) }));
});

test('the timing values are the documented ones: keys for an hour, refetch once a minute, 60 s drift', () => {
  // Literal values, so a change here is a decision someone sees in review
  // (CLAUDE.md, The photo site, item 12, states all three).
  assert.equal(KEYS_MAX_AGE_SECONDS, 3600);
  assert.equal(REFETCH_GAP_SECONDS, 60);
  assert.equal(CLOCK_SKEW_SECONDS, 60);
});

// ---- Tokens that are refused, 403 --------------------------------------

test('R1: no Cf-Access-Jwt-Assertion header', async (t) => {
  const fetch = publishes(t);
  await assertRefused(await guard());
  assert.equal(fetch.mock.callCount(), 0, 'a request with no token fetched the keys');
});

test('R2: an expired token', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ exp: now() - 1 })) }));
});

test('R2b: a token at exactly its exp (a token is refused on or after exp)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ exp: now() })) }));
});

test('R3: a token with no exp', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ exp: undefined })) }));
});

test('R4: a token whose nbf is an hour ahead', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ nbf: now() + 3600 })) }));
});

test('R5: a token with no nbf', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ nbf: undefined })) }));
});

test('R6: a token for another Access application (wrong aud)', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ aud: ['b'.repeat(64)] })) }));
});

test('R7: a token with no aud', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ aud: undefined })) }));
});

test('R8: a token issued by another team (wrong iss)', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ iss: 'https://otherteam.cloudflareaccess.com' })) }));
});

test('R9: a token signed by a key the team does not publish', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(stranger) }));
});

test("R10: a token naming the team's kid, signed by another key", async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(stranger, claims(), { header: { kid: team.kid } }) }));
});

test('R11: a token whose payload was altered after signing', async (t) => {
  publishes(t);
  const [head, , signature] = (await mint(team, claims({ email: 'intruder@example.com' }))).split('.');
  await assertRefused(await guard({ token: `${head}.${segment(claims())}.${signature}` }));
});

test('R12: alg none with no signature', async (t) => {
  publishes(t);
  const token = `${segment({ alg: 'none', typ: 'JWT', kid: team.kid })}.${segment(claims())}.`;
  await assertRefused(await guard({ token }));
});

test('R13: alg none over a real RS256 signature', async (t) => {
  // Correctly signed by the team's key, so only the alg check refuses it.
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims(), { header: { alg: 'none' } }) }));
});

test('R14: HS256 with the public key as the HMAC secret', async (t) => {
  publishes(t);
  const pem = await publicPem(team);
  const token = await mint(team, claims(), { header: { alg: 'HS256' }, sign: (input) => hmac(pem, input) });
  await assertRefused(await guard({ token }));
});

test('R15: a header naming RS512 over a real RS256 signature', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims(), { header: { alg: 'RS512' } }) }));
});

test('R16: a valid token for an email not on the list', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ email: 'someone@example.com' })) }));
});

test('R17: a valid token with no email (a service token)', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team, claims({ email: undefined, common_name: 'x.access' })) }));
});

test('R18: a malformed token, not-a-jwt: 403, never a throw', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: 'not-a-jwt' }));
});

test('R19: three parts whose header is not JSON: 403, never a throw', async (t) => {
  publishes(t);
  const [, payload, signature] = (await mint(team)).split('.');
  await assertRefused(await guard({ token: `${base64url(new TextEncoder().encode('{not json'))}.${payload}.${signature}` }));
});

test('R20: a header that is JSON null, and a payload that is an array: 403, never a throw', async (t) => {
  publishes(t);
  const [head, payload, signature] = (await mint(team)).split('.');
  await assertRefused(await guard({ token: `${segment(null)}.${payload}.${signature}` }));
  await assertRefused(await guard({ token: `${head}.${segment([claims()])}.${signature}` }));
});

test('R21: characters outside base64url in the signature: 403, never a throw', async (t) => {
  publishes(t);
  const [head, payload] = (await mint(team)).split('.');
  await assertRefused(await guard({ token: `${head}.${payload}.!!!` }));
  // And a signature that decodes, but is 3 bytes rather than 256.
  await assertRefused(await guard({ token: `${head}.${payload}.AAAA` }));
});

test('R22: a valid token while ADMIN_EMAILS is not set', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team), env: accessEnv({ ADMIN_EMAILS: undefined }) }));
  await assertRefused(await guard({ token: await mint(team), env: accessEnv({ ADMIN_EMAILS: ' , ' }) }));
});

test('R23: a valid token while ACCESS_AUD or ACCESS_TEAM_DOMAIN is not set', async (t) => {
  publishes(t);
  await assertRefused(await guard({ token: await mint(team), env: accessEnv({ ACCESS_AUD: undefined }) }));
  await assertRefused(await guard({ token: await mint(team), env: accessEnv({ ACCESS_TEAM_DOMAIN: undefined }) }));
  // The case only the config check stops: with ACCESS_AUD unset and a token
  // that carries no aud, the aud check would compare undefined with undefined.
  await assertRefused(await guard({ token: await mint(team, claims({ aud: undefined })), env: accessEnv({ ACCESS_AUD: undefined }) }));
});

test('R24: a valid upload session and no Access token', async (t) => {
  publishes(t);
  const key = 'test-session-signing-key-0123456789abcdef';
  const cookie = `${COOKIE_NAME}=${await signSession(key, 1, now())}`;
  await assertRefused(await guard({ headers: { Cookie: cookie }, env: accessEnv({ SESSION_SIGNING_KEY: key }) }));
});

// ---- The team's keys ---------------------------------------------------

test('K1: the keys are fetched once and cached', async (t) => {
  const fetch = publishes(t);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test('K2: the keys come from the team domain in config', async (t) => {
  const url = 'https://renamed.cloudflareaccess.com/cdn-cgi/access/certs';
  const fetch = t.mock.method(globalThis, 'fetch', certs(() => [team.jwk], url));
  const token = await mint(team, claims({ iss: 'https://renamed.cloudflareaccess.com' }));
  const result = await guard({ token, env: accessEnv({ ACCESS_TEAM_DOMAIN: 'https://renamed.cloudflareaccess.com' }) });
  assert.equal(result.reached, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test('K3: a key published after the cache filled is fetched once a minute has passed, then passes (rotation)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const rotated = await keyPair();
  let published = [team.jwk];
  const fetch = publishes(t, () => published);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  published = [rotated.jwk, team.jwk];
  t.mock.timers.tick(59 * 1000);
  await assertRefused(await guard({ token: await mint(rotated) }));
  assert.equal(fetch.mock.callCount(), 1, 'fetched again inside the minute');
  t.mock.timers.tick(2 * 1000);
  assert.equal((await guard({ token: await mint(rotated) })).reached, true);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal((await guard({ token: await mint(rotated) })).reached, true);
  assert.equal(fetch.mock.callCount(), 2, 'the rotated key was not cached');
});

test('K4: an unknown kid within the refetch gap does not fetch again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const fetch = publishes(t);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  t.mock.timers.tick(1000);
  for (let i = 0; i < 5; i++) await assertRefused(await guard({ token: await mint(stranger) }));
  assert.equal(fetch.mock.callCount(), 1, 'unknown kids made the guard fetch the keys again');
});

test('K5: keys that cannot be fetched answer 503, never the route and never a throw', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network down'); });
  await assertRefused(await guard({ token: await mint(team) }), 503);
  keyCache.clear();
  t.mock.method(globalThis, 'fetch', async () => new Response('no', { status: 500 }));
  await assertRefused(await guard({ token: await mint(team) }), 503);
  keyCache.clear();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: 'not a list' }));
  await assertRefused(await guard({ token: await mint(team) }), 503);
});

test('K6: cached keys are used for an hour, then fetched again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const fetch = publishes(t);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  t.mock.timers.tick(3599 * 1000);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  assert.equal(fetch.mock.callCount(), 1, 'fetched again inside the hour');
  t.mock.timers.tick(2 * 1000);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  assert.equal(fetch.mock.callCount(), 2);
});

test('K7: requests arriving together on a cold cache share one fetch', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return certs(() => [team.jwk])(input);
  });
  const results = await Promise.all(Array.from({ length: 5 }, async () => guard({ token: await mint(team) })));
  assert.deepEqual(results.map((r) => r.reached), [true, true, true, true, true]);
  assert.equal(calls, 1);
});

test('K8: a failed fetch is not retried for a minute: 503 meanwhile, then one fetch', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let up = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    calls++;
    if (!up) throw new TypeError('network down');
    return certs(() => [team.jwk])(input);
  });
  await assertRefused(await guard({ token: await mint(team) }), 503);
  t.mock.timers.tick(59 * 1000);
  for (let i = 0; i < 5; i++) await assertRefused(await guard({ token: await mint(team) }), 503);
  assert.equal(calls, 1, 'a failed fetch was retried inside the minute');
  up = true;
  t.mock.timers.tick(2 * 1000);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  assert.equal(calls, 2);
});

test('K9: a failed refetch for an unknown kid keeps the known keys working', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let up = true;
  t.mock.method(globalThis, 'fetch', async (input) => {
    if (!up) throw new TypeError('network down');
    return certs(() => [team.jwk])(input);
  });
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  up = false;
  t.mock.timers.tick(61 * 1000);
  await assertRefused(await guard({ token: await mint(stranger) }), 503);
  assert.equal((await guard({ token: await mint(team) })).reached, true, 'a made-up kid during an outage locked out the team key');
});

test('K10: a key the team stops publishing is refused once the hour is up', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const rotated = await keyPair();
  let published = [team.jwk];
  publishes(t, () => published);
  assert.equal((await guard({ token: await mint(team) })).reached, true);
  published = [rotated.jwk];
  t.mock.timers.tick(3601 * 1000);
  await assertRefused(await guard({ token: await mint(team) }));
});

test('criterion 5: no hostname, environment, header or cookie opens the admin without the token', async (t) => {
  // requireOwner reads the token header and three config values, nothing
  // else. These are the shapes a bypass would take: a local or pages.dev
  // host, a dev environment flag, a header claiming to be Access, and a
  // valid token in the CF_Authorization cookie, which is deliberately never
  // read. Each must still answer 403.
  publishes(t);
  const valid = await mint(team);
  const hosts = ['http://localhost:8788', 'http://127.0.0.1:8788', 'https://madcowphotos.pages.dev', 'https://develop.madcowphotos.pages.dev', SITE];
  const envs = [accessEnv(), accessEnv({ SITE_ENV: 'dev' }), accessEnv({ SITE_ENV: 'preview' }), accessEnv({ SITE_ENV: 'local', DEV: 'true' })];
  const headers = [{}, { 'X-Dev-Bypass': '1' }, { 'Cf-Access-Authenticated-User-Email': OWNER }, { Cookie: `CF_Authorization=${valid}` }];
  let refused = 0;
  for (const host of hosts) {
    for (const env of envs) {
      for (const extra of headers) {
        await assertRefused(await guard({ url: `${host}/admin/`, env, headers: extra }));
        refused++;
      }
      // The control: the same host and environment with the token pass.
      assert.equal((await guard({ url: `${host}/admin/`, env, token: valid })).reached, true, host);
    }
  }
  assert.equal(refused, hosts.length * envs.length * headers.length);
});

test('the config the guard reads is the team domain, the AUD tag and the list', () => {
  // Also documents the names the README and wrangler.jsonc use.
  assert.deepEqual(Object.keys(accessEnv()).sort(), ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ADMIN_EMAILS']);
  assert.equal(TEAM, 'https://testteam.cloudflareaccess.com');
  assert.equal(AUD.length, 64);
});
