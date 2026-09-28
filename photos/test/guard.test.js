// Every upload route calls the one guard (#150, criterion 5).
//
// This finds every Function route under functions/, runs each exported
// handler through the chain of _middleware.js files Pages would run in front
// of it, and requires a 401 for a missing, tampered, earlier-generation and
// expired cookie. A route that skips the guard, whether it sits outside
// functions/api/upload/ or that directory loses its _middleware.js, fails
// here. The only routes excused are PUBLIC, each with its reason; adding one
// there is a decision, and belongs in review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { COOKIE_NAME, SESSION_SECONDS, nowSeconds, requireUploadSession, signSession } from '../lib/session.js';
import { d1, seedCodes } from './d1.js';

const FUNCTIONS = fileURLToPath(new URL('../functions/', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';

const PUBLIC = {
  'api/health.js': 'reports whether the bindings answer, and nothing stored (#149)',
  'api/join.js': 'is how an upload session is opened (#150)',
};

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

async function call(file, method, cookie) {
  const env = { DB: d1(), SESSION_SIGNING_KEY: KEY };
  seedCodes(env.DB, 'AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB'); // generation 2 is current
  const headers = { Origin: SITE };
  if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
  const request = new Request(`${SITE}${routePath(file)}`, {
    method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : '{}',
  });
  const stack = await stackFor(file, method);
  const run = (i) => stack[i]({ request, env, data: {}, params: {}, waitUntil() {}, next: () => run(i + 1) });
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

test('the upload directory runs the one guard', async () => {
  const mod = await import(pathToFileURL(join(FUNCTIONS, 'api', 'upload', '_middleware.js')));
  assert.equal(mod.onRequest, requireUploadSession);
});

const guarded = routes.filter((file) => !(file in PUBLIC));

test('at least one upload route exists, so the checks below check something', () => {
  assert.ok(guarded.length > 0);
});

for (const file of guarded) {
  for (const method of await methodsOf(file)) {
    for (const [name, cookie] of Object.entries(CASES)) {
      test(`${method} ${routePath(file)} with ${name}: 401`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const res = await call(file, method, cookie);
        assert.equal(res.status, 401, `functions/${file} answered ${res.status}: does it skip the upload guard?`);
      });
    }
    test(`${method} ${routePath(file)} with a current session: past the guard`, async () => {
      // The control: the route is reachable in this harness, so the 401s
      // above come from the guard and not from a route that refuses anyone.
      const res = await call(file, method, current);
      assert.notEqual(res.status, 401);
    });
  }
}
