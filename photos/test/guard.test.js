// Every upload route calls the one upload guard (#150, criterion 5), every
// admin route the one admin guard (#151), and every coach route the coach
// guard (#192).
//
// This finds every Function route under functions/, runs each exported
// handler through the chain of _middleware.js files Pages would run in front
// of it, and requires a refusal from the guard that route belongs to:
//   - an admin route, anything under functions/admin/ or functions/api/admin/,
//     answers 403 with no Access token, with only an upload session, and with
//     a valid token for another email or another Access application, a
//     coach's included; and a write (any method but GET and HEAD) answers 403
//     to the owner's valid token without the site's own Origin (#152);
//   - a coach route, anything under functions/coach/, answers 403 with no
//     Access token, with only an upload session, with the owner's admin
//     token, and with a token for an address not on the coach list or for
//     another Access application (#192);
//   - every other route answers 401 for a missing, tampered,
//     earlier-generation and expired upload cookie, for a coach's cookie that
//     is tampered, expired or names an address off the coach list, and for an
//     owner's or a coach's valid Access token with no cookie; and a write
//     under api/upload/ answers 403 to a current session without the site's
//     own Origin (#154).
// A route that skips its guard, whether it sits outside its directory or the
// directory loses its _middleware.js, fails here. The only routes excused are
// PUBLIC, each with its reason; adding one there is a decision, and belongs
// in review.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  COOKIE_NAME, SESSION_SECONDS, coachTag, nowSeconds, requireUploadSession, signCoachSession, signSession,
} from '../lib/session.js';
import { TOKEN_HEADER, keyCache, requireCoach, requireOwner } from '../lib/access.js';
import { requireSameOrigin } from '../lib/origin.js';
import { COACH, COACH_AUD, accessEnv, certs, claims, coachClaims, keyPair, mint } from './access.js';
import { d1, seedCodes } from './d1.js';

const FUNCTIONS = fileURLToPath(new URL('../functions/', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';

const PUBLIC = {
  'api/health.js': 'reports whether the bindings answer, and nothing stored (#149)',
  'api/join.js': 'is how an upload session is opened (#150)',
  // Public viewing is epic #147's D1: the code gates uploading only. Each of
  // these shows approved photos and nothing else, which test/public.test.js
  // holds (#157).
  'index.js': 'lists the albums holding an approved photo (#157)',
  'albums/[address]/index.js': 'shows an album\'s approved photos (#157)',
  'photos/[id]/[size].js': 'serves an approved photo, and 404s every other state (#157)',
  // "Remove this photo" is for anyone (epic #147, D7): a parent needs no code
  // to take a photo of their child down. The takedown checks the Origin
  // itself and is rate-limited per address; test/removals.test.js holds both.
  'remove.js': 'shows the no-JavaScript confirmation for an approved photo, and changes nothing (#158)',
  'api/remove.js': 'takes an approved photo down, from the site\'s own Origin, 10 an hour per address (#158)',
  // Anyone can ask for an account (#220, epic #216): it is the door to one,
  // so nothing can be required in front of it but the checks it makes
  // itself, the Origin, Turnstile and the limits, which test/ask.test.js
  // holds.
  'ask.js': 'takes a request for an account, from the site\'s own Origin, past Turnstile, 10 an hour per address (#220)',
  // Where an approval email's link lands (#221). The person it is for has no
  // sign-in yet, so the link is the only thing it can ask for. It reads one
  // row and writes nothing, so opening it spends nothing, which
  // test/people.test.js holds.
  'set-password.js': 'says whether a link to set a password can be used, and changes nothing (#221)',
  // The share target's address (#193). The installed app's worker answers it
  // on the phone; this route answers only when no worker is there, sending
  // the browser to the share page. It reads no body and changes nothing,
  // which test/app.test.js holds.
  'share/receive.js': 'sends a share that arrived with no worker to the share page, reading and changing nothing (#193)',
};

// Admin routes answer to the admin guard, not the upload guard (#151), and
// coach routes to the coach guard (#192).
const isAdmin = (file) => /^(api\/)?admin\//.test(file);
const isCoach = (file) => /^coach\//.test(file);

const team = await keyPair();
beforeEach(() => keyCache.clear());

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const handlerName = (method) => `onRequest${method[0]}${method.slice(1).toLowerCase()}`;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full).map((p) => `${name}/${p}`));
    else out.push(name);
  }
  return out;
}

const routes = walk(FUNCTIONS).filter((f) => f.endsWith('.js') && !/(^|\/)_middleware\.js$/.test(f));

// The URL a route file answers, as test/site.test.js derives it.
const routePath = (file) => `/${file
  .replace(/\.js$/, '')
  .replace(/\[\[[^\]]+\]\]/g, 'a/b')
  .replace(/\[[^\]]+\]/g, 'a')
  .replace(/(^|\/)index$/, '')}`;

// The handlers Pages would run for `method` on `file`, outermost first: each
// directory's _middleware.js from functions/ down, then the route itself.
async function stackFor(file, method) {
  const dirs = file.split('/').slice(0, -1);
  const stack = [];
  for (let depth = 0; depth <= dirs.length; depth++) {
    const path = join(FUNCTIONS, ...dirs.slice(0, depth), '_middleware.js');
    if (!existsSync(path)) continue;
    const mod = await import(pathToFileURL(path));
    stack.push(...[mod[handlerName(method)] ?? mod.onRequest ?? []].flat());
  }
  const route = await import(pathToFileURL(join(FUNCTIONS, file)));
  stack.push(route[handlerName(method)] ?? route.onRequest);
  return stack;
}

async function methodsOf(file) {
  const route = await import(pathToFileURL(join(FUNCTIONS, file)));
  if (route.onRequest) return ['GET', 'POST'];
  return METHODS.filter((m) => route[handlerName(m)]);
}

async function call(file, method, cookie, token, origin = SITE) {
  const env = { DB: d1(), SESSION_SIGNING_KEY: KEY, ...accessEnv() };
  seedCodes(env.DB, 'AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB'); // generation 2 is current
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
  if (token) headers[TOKEN_HEADER] = token;
  const request = new Request(`${SITE}${routePath(file)}`, {
    method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : '{}',
  });
  const stack = await stackFor(file, method);
  // One data object for the whole chain, as Pages passes it: a guard puts
  // what it learned there for the route (#151 found a fresh {} per handler).
  const data = {};
  const run = (i) => stack[i]({ request, env, data, params: {}, waitUntil() {}, next: () => run(i + 1) });
  return run(0);
}

const now = nowSeconds();
const signature = (value) => value.split('.').pop();
// Alter the signature's FIRST character: the last one of a 32-byte signature
// carries two padding bits, so A and B there can decode alike.
const tamper = (value) => value.replace(signature(value), (signature(value)[0] === 'A' ? 'B' : 'A') + signature(value).slice(1));
const current = await signSession(KEY, 2, now);
// A coach's session (#192), for the address accessEnv() lists as a coach.
const coachCurrent = await signCoachSession(KEY, await coachTag(KEY, COACH), now);
const CASES = {
  'no cookie': undefined,
  'a tampered signature': tamper(current),
  'an earlier generation': await signSession(KEY, 1, now),
  'an expired cookie': await signSession(KEY, 2, now - SESSION_SECONDS),
  'a coach\'s cookie with a tampered signature': tamper(coachCurrent),
  'an expired coach\'s cookie': await signCoachSession(KEY, await coachTag(KEY, COACH), now - SESSION_SECONDS),
  'a coach\'s cookie for an address off the list': await signCoachSession(KEY, await coachTag(KEY, 'former@example.com'), now),
};

test('every PUBLIC entry is a route that exists', () => {
  for (const file of Object.keys(PUBLIC)) assert.ok(routes.includes(file), `PUBLIC names ${file}, which is not a route`);
});

test('the upload directory runs the one guard, then the Origin guard (#154)', async () => {
  const mod = await import(pathToFileURL(join(FUNCTIONS, 'api', 'upload', '_middleware.js')));
  assert.deepEqual(mod.onRequest, [requireUploadSession, requireSameOrigin]);
});

test('the albums directory runs the same guard (#153)', async () => {
  const mod = await import(pathToFileURL(join(FUNCTIONS, 'api', 'albums', '_middleware.js')));
  assert.equal(mod.onRequest, requireUploadSession);
});

test('both admin directories run the admin guard, then the Origin guard', async () => {
  for (const dir of [['admin'], ['api', 'admin']]) {
    const mod = await import(pathToFileURL(join(FUNCTIONS, ...dir, '_middleware.js')));
    assert.deepEqual(mod.onRequest, [requireOwner, requireSameOrigin], dir.join('/'));
  }
});

test('the coach directory runs the coach guard (#192)', async () => {
  const mod = await import(pathToFileURL(join(FUNCTIONS, 'coach', '_middleware.js')));
  assert.deepEqual(mod.onRequest, [requireCoach]);
});

const guarded = routes.filter((file) => !(file in PUBLIC) && !isAdmin(file) && !isCoach(file));
const admin = routes.filter((file) => !(file in PUBLIC) && isAdmin(file));
const coach = routes.filter((file) => !(file in PUBLIC) && isCoach(file));

test('at least one upload route exists, so the checks below check something', () => {
  assert.ok(guarded.length > 0);
});

test('at least one admin page and one admin API exist, so the checks below check something', () => {
  assert.ok(admin.some((file) => file.startsWith('admin/')));
  assert.ok(admin.some((file) => file.startsWith('api/admin/')));
});

test('no route is both public and admin, or public and coach', () => {
  for (const file of Object.keys(PUBLIC)) assert.ok(!isAdmin(file) && !isCoach(file), file);
});

test('the coach route exists, so the checks below check something (#192)', () => {
  assert.ok(coach.includes('coach/index.js'));
});

const ownerToken = () => mint(team);

const SAFE = ['GET', 'HEAD'];
const FOREIGN_ORIGINS = {
  'no Origin': null,
  'another site\'s Origin': 'https://evil.example',
  'the sibling site\'s Origin': 'https://madcowsailing.com',
};

for (const file of guarded) {
  for (const method of await methodsOf(file)) {
    for (const [name, cookie] of Object.entries(CASES)) {
      test(`${method} ${routePath(file)} with ${name}: 401`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const res = await call(file, method, cookie);
        assert.equal(res.status, 401, `functions/${file} answered ${res.status}: does it skip the upload guard?`);
      });
    }
    test(`${method} ${routePath(file)} with the owner's Access token and no cookie: 401`, async (t) => {
      // An admin sign-in is not an upload session.
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      const res = await call(file, method, undefined, await ownerToken());
      assert.equal(res.status, 401, `functions/${file} answered ${res.status}`);
    });
    test(`${method} ${routePath(file)} with a coach's Access token and no cookie: 401`, async (t) => {
      // Nor is a coach's: only /coach turns one into a session (#192).
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      const res = await call(file, method, undefined, await mint(team, coachClaims()));
      assert.equal(res.status, 401, `functions/${file} answered ${res.status}`);
    });
    test(`${method} ${routePath(file)} with a current session: past the guard`, async () => {
      // The control: the route is reachable in this harness, so the 401s
      // above come from the guard and not from a route that refuses anyone.
      const res = await call(file, method, current);
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });
    test(`${method} ${routePath(file)} with a coach's current session: past the guard`, async () => {
      // The control for the coach's cookies above (#192).
      const res = await call(file, method, coachCurrent);
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });
    // An upload write needs the site's own Origin as well as a session (#154),
    // so a page elsewhere cannot post into a parent's session. The albums
    // directory holds reads only, and runs no Origin guard.
    if (SAFE.includes(method) || !file.startsWith('api/upload/')) continue;
    for (const [name, origin] of Object.entries(FOREIGN_ORIGINS)) {
      test(`${method} ${routePath(file)} with a current session and ${name}: 403`, async () => {
        const res = await call(file, method, current, undefined, origin);
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the Origin guard?`);
        assert.deepEqual(await res.json(), { error: 'origin' });
      });
    }
  }
}

test('at least one upload route takes a write, so the Origin checks above check something', async () => {
  const writes = [];
  for (const file of guarded.filter((f) => f.startsWith('api/upload/'))) {
    writes.push(...(await methodsOf(file)).filter((m) => !SAFE.includes(m)));
  }
  assert.ok(writes.length > 0);
});

const ADMIN_CASES = {
  'no Access token': async () => undefined,
  'a token for another email': () => mint(team, claims({ email: 'someone@example.com' })),
  'a token for another Access application': () => mint(team, claims({ aud: ['b'.repeat(64)] })),
  // #192: a coach signs in through Access too, for the coaches' application.
  'a coach\'s token': () => mint(team, coachClaims()),
  // The owner's own address in a token signed for the coaches' application:
  // only the aud check refuses it, since the address is on the admin list
  // (#192's review: the case above is refused by the list as well).
  'the owner\'s address in a token for the coaches\' application': () => mint(team, claims({ aud: [COACH_AUD] })),
};

for (const file of admin) {
  for (const method of await methodsOf(file)) {
    for (const [name, token] of Object.entries(ADMIN_CASES)) {
      test(`${method} ${routePath(file)} with ${name}: 403`, async (t) => {
        t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
        const res = await call(file, method, undefined, await token());
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the admin guard?`);
      });
    }
    test(`${method} ${routePath(file)} with a current upload session and no Access token: 403`, async (t) => {
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      const res = await call(file, method, current);
      assert.equal(res.status, 403, `functions/${file} answered ${res.status}: an upload session opened it`);
    });
    test(`${method} ${routePath(file)} with a coach's upload session and no Access token: 403`, async (t) => {
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      const res = await call(file, method, coachCurrent);
      assert.equal(res.status, 403, `functions/${file} answered ${res.status}: a coach's session opened it`);
    });
    test(`${method} ${routePath(file)} with the owner's Access token: past the guard`, async (t) => {
      // The control, as above: the 403s come from the guard. A route with a
      // [param] in its path names a thing this harness never made (#156's
      // photo sizes), so its own 404 is the route answering, past the guard.
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      const res = await call(file, method, undefined, await ownerToken());
      const reached = res.status < 400 || (file.includes('[') && res.status === 404);
      assert.ok(reached, `functions/${file} answered ${res.status} to the owner`);
    });
    if (SAFE.includes(method)) continue;
    // A write needs the site's own Origin as well as the owner (#152), so a
    // page elsewhere cannot post a form into the admin area.
    for (const [name, origin] of Object.entries(FOREIGN_ORIGINS)) {
      test(`${method} ${routePath(file)} with the owner's Access token and ${name}: 403`, async (t) => {
        t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
        const res = await call(file, method, undefined, await ownerToken(), origin);
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the Origin guard?`);
        assert.deepEqual(await res.json(), { error: 'origin' });
      });
    }
  }
}

test('at least one admin route takes a write, so the Origin checks above check something', async () => {
  const writes = [];
  for (const file of admin) writes.push(...(await methodsOf(file)).filter((m) => !SAFE.includes(m)));
  assert.ok(writes.length > 0);
});

// The coach routes (#192, criterion 2): the coach guard, and no session set
// by any refusal. The admin application's tag differs from the coaches' in
// accessEnv(), as on photos.madcowsailing.com.
const COACH_CASES = {
  'no Access token': async () => undefined,
  'the owner\'s admin token': () => ownerToken(),
  'a token for an address not on the coach list': () => mint(team, coachClaims({ email: 'someone@example.com' })),
  'a token for another Access application': () => mint(team, coachClaims({ aud: ['b'.repeat(64)] })),
  'a coach\'s address in a token for the admin application': () => mint(team, coachClaims({ aud: claims().aud })),
};

for (const file of coach) {
  for (const method of await methodsOf(file)) {
    for (const [name, token] of Object.entries(COACH_CASES)) {
      test(`${method} ${routePath(file)} with ${name}: 403, and no session set`, async (t) => {
        t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
        const res = await call(file, method, undefined, await token());
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the coach guard?`);
        assert.equal(res.headers.get('Set-Cookie'), null);
      });
    }
    test(`${method} ${routePath(file)} with a current upload session and no Access token: 403`, async (t) => {
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      for (const cookie of [current, coachCurrent]) {
        const res = await call(file, method, cookie);
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: an upload session opened it`);
      }
    });
    test(`${method} ${routePath(file)} with a coach's Access token: past the guard`, async (t) => {
      // The control: the 403s above come from the guard.
      t.mock.method(globalThis, 'fetch', certs(() => [team.jwk]));
      const res = await call(file, method, undefined, await mint(team, coachClaims()));
      assert.ok(res.status < 400, `functions/${file} answered ${res.status} to a coach`);
    });
  }
}
