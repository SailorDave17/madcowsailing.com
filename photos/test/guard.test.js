// Every upload route calls the one upload guard (#150, criterion 5), and
// every admin route the one admin guard (#151).
//
// This finds every Function route under functions/, runs each exported
// handler through the chain of _middleware.js files Pages would run in front
// of it, and requires a refusal from the guard that route belongs to:
//   - an admin route, anything under functions/admin/ or functions/api/admin/,
//     answers 403 with no Access token, with only an upload session, and with
//     a valid token for another email or another Access application; and a
//     write (any method but GET and HEAD) answers 403 to the owner's valid
//     token without the site's own Origin (#152);
//   - every other route answers 401 for a missing, tampered,
//     earlier-generation and expired upload cookie, and for an owner's valid
//     Access token with no cookie; and a write under api/upload/ answers 403
//     to a current session without the site's own Origin (#154).
// A route that skips its guard, whether it sits outside its directory or the
// directory loses its _middleware.js, fails here. The only routes excused are
// PUBLIC, each with its reason; adding one there is a decision, and belongs
// in review.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { COOKIE_NAME, SESSION_SECONDS, nowSeconds, requireUploadSession, signSession } from '../lib/session.js';
import { TOKEN_HEADER, keyCache, requireOwner } from '../lib/access.js';
import { requireSameOrigin } from '../lib/origin.js';
import { accessEnv, certs, claims, keyPair, mint } from './access.js';
import { d1, seedCodes } from './d1.js';

const FUNCTIONS = fileURLToPath(new URL('../functions/', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';

const PUBLIC = {
  'api/health.js': 'reports whether the bindings answer, and nothing stored (#149)',
  'api/join.js': 'is how an upload session is opened (#150)',
};

// Admin routes answer to the admin guard, not the upload guard (#151).
const isAdmin = (file) => /^(api\/)?admin\//.test(file);

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
const current = await signSession(KEY, 2, now);
const CASES = {
  'no cookie': undefined,
  'a tampered signature': current.replace(signature(current), (signature(current)[0] === 'A' ? 'B' : 'A') + signature(current).slice(1)),
  'an earlier generation': await signSession(KEY, 1, now),
  'an expired cookie': await signSession(KEY, 2, now - SESSION_SECONDS),
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

const guarded = routes.filter((file) => !(file in PUBLIC) && !isAdmin(file));
const admin = routes.filter((file) => !(file in PUBLIC) && isAdmin(file));

test('at least one upload route exists, so the checks below check something', () => {
  assert.ok(guarded.length > 0);
});

test('at least one admin page and one admin API exist, so the checks below check something', () => {
  assert.ok(admin.some((file) => file.startsWith('admin/')));
  assert.ok(admin.some((file) => file.startsWith('api/admin/')));
});

test('no route is both public and admin', () => {
  for (const file of Object.keys(PUBLIC)) assert.ok(!isAdmin(file), file);
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
    test(`${method} ${routePath(file)} with a current session: past the guard`, async () => {
      // The control: the route is reachable in this harness, so the 401s
      // above come from the guard and not from a route that refuses anyone.
      const res = await call(file, method, current);
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
