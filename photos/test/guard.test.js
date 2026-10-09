// Every upload route calls the one upload guard (#150, criterion 5), every
// admin route the one admin guard (#151), and every account route the
// account guard (#222). The coach guard (#192) went with /coach at #226.
//
// This finds every Function route under functions/, runs each exported
// handler through the chain of _middleware.js files Pages would run in front
// of it, and requires a refusal from the guard that route belongs to:
//   - an admin route, anything under functions/admin/ or functions/api/admin/,
//     sends the request to /sign-in?admin, 303, without running, for every
//     way an admin session can fail to hold: none, tampered, expired, signed
//     with another key, on a version the account no longer holds, for an
//     account that is gone, is no admin, holds no approved team, or had its
//     role taken away, an account's own cookie, an upload cookie from before
//     #226, and an Access token, which opened the admin pages until #224
//     (criterion 5); and a write (any method but GET and HEAD) answers 403
//     to the owner's admin session without the site's own Origin (#152);
//   - an account route, anything under functions/account/, sends a page to
//     /sign-in, 303, and answers anything else 401, for every way an account
//     session can fail to hold, an upload cookie from before #226, an admin
//     session and an Access token (#222, #224);
//   - every other route answers 401 for no session, for an account's cookie
//     that is tampered, expired, signed with another key, on a version the
//     account no longer holds, or names an account that is gone or approved
//     for no team (#223), for an admin session alone (#224), and for an
//     Access token with no cookie; and for the upload cookie the invite link
//     and the coaches' sign-in set until #226, a parent's or a coach's, live
//     or not, deleting it in the same answer (#226). An account's session
//     that carries one gets past the guard, and the old cookie is deleted
//     there too. A write under api/upload/ answers 403 to an account's
//     session without the site's own Origin (#154).
// A route that skips its guard, whether it sits outside its directory or the
// directory loses its _middleware.js, fails here. The only routes excused are
// PUBLIC, each with its reason; adding one there is a decision, and belongs
// in review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { nowSeconds, requireUploadSession } from '../lib/session.js';
import { requireSameOrigin } from '../lib/origin.js';
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_SECONDS, requireAccount, signAccountSession } from '../lib/account-session.js';
import {
  ADMIN_COOKIE, ADMIN_SESSION_SECONDS, ADMIN_SIGN_IN, requireAdmin, signAdminSession,
} from '../lib/admin-session.js';
import { d1, seedCodes } from './d1.js';
import { UPLOAD_COOKIE, coachCookie, parentCookie } from './legacy-cookies.js';

const FUNCTIONS = fileURLToPath(new URL('../functions/', import.meta.url));
const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';

const PUBLIC = {
  'api/health.js': 'reports whether the bindings answer, and nothing stored (#149)',
  'api/join.js': 'tells an old invite link that accounts replaced it, pointing to /ask, and opens nothing (#226)',
  // Public viewing is epic #147's D1: an account gates sending only, as the
  // invite code did until #226. Each of these shows approved photos and
  // nothing else, which test/public.test.js holds (#157).
  'index.js': 'leads to each team\'s section, counting what each shows (#157, #227)',
  'hoover-jrt/index.js': 'lists Hoover JRT\'s albums holding an approved photo (#227)',
  'cohssa/index.js': 'lists COHSSA\'s albums holding an approved photo (#227)',
  'albums/[address]/index.js': 'shows an album\'s approved photos (#157)',
  'photos/[id]/[size].js': 'serves an approved photo, and 404s every other state (#157)',
  // "Remove this photo" is for anyone (epic #147, D7): a parent needs no
  // account to take a photo of their child down. The takedown checks the
  // Origin itself and is rate-limited per address; test/removals.test.js
  // holds both.
  'remove.js': 'shows the no-JavaScript confirmation for an approved photo, and changes nothing (#158)',
  'api/remove.js': 'takes an approved photo down, from the site\'s own Origin, 10 an hour per address (#158)',
  // Anyone can ask for an account (#220, epic #216): it is the door to one,
  // so nothing can be required in front of it but the checks it makes
  // itself, the Origin, Turnstile and the limits, which test/ask.test.js
  // holds.
  'ask.js': 'takes a request for an account, from the site\'s own Origin, past Turnstile, 10 an hour per address (#220)',
  // Where an approval or reset email's link lands (#221, #222). The person it
  // is for has no sign-in yet, so the link is the only thing it can ask for.
  // Opening it reads and writes nothing (test/people.test.js); the form's
  // post checks the Origin and the link itself (test/sign-in.test.js).
  'set-password.js': 'shows the form a usable link opens, changing nothing, and sets the password from the site\'s own Origin with that link (#221, #222)',
  // The doors to an account session (#222): nothing can be required in front
  // of them but what each checks itself, the Origin, Turnstile on the reset
  // form, and the limits, which test/sign-in.test.js holds.
  'sign-in.js': 'signs in, from the site\'s own Origin, 10 failures an hour per address and 20 per network (#222)',
  // The second half of an admin's sign-in (#224): the code emailed once the
  // password passed, checked against the sign-in this browser's cookie names,
  // 5 tries, from the site's own Origin (test/admin-sign-in.test.js).
  'sign-in/code.js': 'checks an admin\'s emailed code for the sign-in its cookie names, 5 tries, from the site\'s own Origin (#224)',
  'sign-out.js': 'ends a session from the site\'s own Origin, and deletes a dead cookie (#222)',
  'forgot-password.js': 'takes a reset request, from the site\'s own Origin, past Turnstile, 10 an hour per network (#222)',
  // The share target's address (#193). The installed app's worker answers it
  // on the phone; this route answers only when no worker is there, sending
  // the browser to the share page. It reads no body and changes nothing,
  // which test/app.test.js holds.
  'share/receive.js': 'sends a share that arrived with no worker to the share page, reading and changing nothing (#193)',
};

// Admin routes answer to the admin guard, not the upload guard (#151), and
// account routes to the account guard (#222). Coach routes answered to the
// coach guard (#192) until #226 deleted them.
const isAdmin = (file) => /^(api\/)?admin\//.test(file);
const isAccount = (file) => /^account\//.test(file);

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

// A coach's address, on COACH_EMAILS below as production's was until #226.
const COACH = 'coach@example.com';

async function call(file, method, cookie, token, origin = SITE, account = undefined, admin = undefined) {
  // What made an upload cookie live until #226: the current invite code's
  // generation (2, seeded below) and a coach's address on COACH_EMAILS. Both
  // stay, so the live old cookies below are ones the guard took before #226,
  // and a guard that read them again would let them through rather than
  // refuse them for want of a code or a list.
  const env = { DB: d1(), SESSION_SIGNING_KEY: KEY, COACH_EMAILS: COACH };
  seedCodes(env.DB, 'AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB'); // generation 2 is current
  // #222: account 1 approved for a team at session version 1, and account 2
  // still waiting, approved for none. #224: the owner (10) and an admin (11),
  // each approved for a team; an admin approved for no team (12); and one
  // whose admin role was taken away (13). Account 3 is never made.
  env.DB.sqlite.exec(
    "INSERT INTO accounts (email, name, role, requested_at) VALUES ('approved@example.org', 'Approved', 'parent', 1), ('waiting@example.org', 'Waiting', 'parent', 1);" +
    "INSERT INTO account_teams (account_id, team, state) VALUES (1, 'cohssa', 'approved'), (2, 'cohssa', 'requested');" +
    "INSERT INTO accounts (id, email, name, role, requested_at, admin_role) VALUES (10, 'owner@example.org', 'Owner', 'coach', 1, 'owner'), (11, 'admin@example.org', 'Admin', 'parent', 1, 'admin'), (12, 'unteamed@example.org', 'Unteamed', 'parent', 1, 'admin'), (13, 'former@example.org', 'Former', 'parent', 1, 'admin');" +
    "INSERT INTO account_teams (account_id, team, state) VALUES (10, 'hoover-jrt', 'approved'), (11, 'cohssa', 'approved'), (12, 'cohssa', 'requested'), (13, 'cohssa', 'approved');" +
    'UPDATE accounts SET admin_role = NULL WHERE id = 13;',
  );
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  const cookies = [
    ...(cookie ? [`${UPLOAD_COOKIE}=${cookie}`] : []),
    ...(account ? [`${ACCOUNT_COOKIE}=${account}`] : []),
    ...(admin ? [`${ADMIN_COOKIE}=${admin}`] : []),
  ];
  if (cookies.length) headers.Cookie = cookies.join('; ');
  if (token) headers[ACCESS_HEADER] = token;
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

// The upload cookie the invite link (a parent's) and the coaches' sign-in (a
// coach's) set until #226, minted by test/legacy-cookies.js since
// lib/session.js no longer can. It lasted 90 days. Nothing reads one now:
// each is answered as if it were not there, and the answer deletes it, live
// or not. The two live ones sent under the guard before #226, so a guard that
// read the cookie again fails on them; the rest fail if the deletion goes.
const OLD_SESSION_SECONDS = 90 * 24 * 60 * 60;
const parentLive = await parentCookie(KEY, 2, now);
const coachLive = await coachCookie(KEY, COACH, now);
const OLD_COOKIES = {
  'a parent\'s cookie for the current code': parentLive,
  'a parent\'s cookie with a tampered signature': tamper(parentLive),
  'a parent\'s cookie for an earlier code': await parentCookie(KEY, 1, now),
  'an expired parent\'s cookie': await parentCookie(KEY, 2, now - OLD_SESSION_SECONDS),
  'a listed coach\'s cookie': coachLive,
  'a coach\'s cookie with a tampered signature': tamper(coachLive),
  'an expired coach\'s cookie': await coachCookie(KEY, COACH, now - OLD_SESSION_SECONDS),
  'a coach\'s cookie for an address off the list': await coachCookie(KEY, 'former@example.com', now),
};
// What the answer to a request carrying one sets, and the only cookie it sets.
const DELETE_OLD = '__Host-upload=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';

// What Cloudflare Access sends behind its sign-in, which the develop preview
// still has: Cf-Access-Jwt-Assertion, a token naming who signed in. Until
// #224 the owner's opened the admin pages, and until #226 a coach's opened
// /coach. Nothing reads the header now, so the token here is not signed: it
// is shaped as one and names an address the site knows, which is what a
// header trusted again would be.
const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
const OWNER_EMAIL = 'owner@example.org'; // account 10, which call() seeds as the owner
const accessToken = (email) => [
  { alg: 'RS256', kid: 'test-kid', typ: 'JWT' },
  { email, iss: 'https://testteam.cloudflareaccess.com', type: 'app', exp: now + 3600 },
].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).concat('c2lnbmF0dXJl').join('.');

// An account's session (#223), the one session the upload guard takes since
// #226, and every way one can fail to hold. call() seeds account 1 approved
// for a team at version 1, and account 2 approved for none.
const accountLive = await signAccountSession(KEY, { accountId: 1, version: 1 }, now);
const UPLOAD_ACCOUNT_CASES = {
  'an account\'s cookie with a tampered signature': tamper(accountLive),
  'an expired account\'s cookie': await signAccountSession(KEY, { accountId: 1, version: 1 }, now - ACCOUNT_SESSION_SECONDS),
  'an account\'s cookie signed with another key': await signAccountSession(`${KEY}-other`, { accountId: 1, version: 1 }, now),
  'an account\'s cookie on a version the account no longer holds': await signAccountSession(KEY, { accountId: 1, version: 2 }, now),
  'an account\'s cookie for an account approved for no team': await signAccountSession(KEY, { accountId: 2, version: 1 }, now),
  'an account\'s cookie for an account that does not exist': await signAccountSession(KEY, { accountId: 3, version: 1 }, now),
};

// #224: the owner's (10) and an admin's (11) current admin sessions, which
// call() seeds. An admin session opens the admin pages and nothing else.
const ownerSession = await signAdminSession(KEY, { accountId: 10, version: 1 }, now);
const adminSession = await signAdminSession(KEY, { accountId: 11, version: 1 }, now);

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

test('both admin directories run the admin session guard, then the Origin guard (#224)', async () => {
  for (const dir of [['admin'], ['api', 'admin']]) {
    const mod = await import(pathToFileURL(join(FUNCTIONS, ...dir, '_middleware.js')));
    assert.deepEqual(mod.onRequest, [requireAdmin, requireSameOrigin], dir.join('/'));
  }
});

test('the account directory runs the account guard, then the Origin guard (#222)', async () => {
  const mod = await import(pathToFileURL(join(FUNCTIONS, 'account', '_middleware.js')));
  assert.deepEqual(mod.onRequest, [requireAccount, requireSameOrigin]);
});

const guarded = routes.filter((file) => !(file in PUBLIC) && !isAdmin(file) && !isAccount(file));
const admin = routes.filter((file) => !(file in PUBLIC) && isAdmin(file));
const account = routes.filter((file) => !(file in PUBLIC) && isAccount(file));

test('at least one upload route exists, so the checks below check something', () => {
  assert.ok(guarded.length > 0);
});

test('at least one admin page and one admin API exist, so the checks below check something', () => {
  assert.ok(admin.some((file) => file.startsWith('admin/')));
  assert.ok(admin.some((file) => file.startsWith('api/admin/')));
});

test('no route is both public and admin, or public and account', () => {
  for (const file of Object.keys(PUBLIC)) assert.ok(!isAdmin(file) && !isAccount(file), file);
});

test('the account page exists, so the checks below check something (#222)', () => {
  assert.ok(account.includes('account/index.js'));
});

test('the coaches\' sign-in and the invite code\'s pages are gone (#226)', () => {
  // /coach (#192), /admin/code and its two presses (#152) went with the
  // invite link and the coaches' sign-in. One back under functions/admin/
  // would pass the admin checks below, so it is named here.
  const retired = routes.filter((file) => /^coach\//.test(file) || /^(api\/)?admin\/code(\.js$|\/)/.test(file));
  assert.deepEqual(retired, []);
});

const SAFE = ['GET', 'HEAD'];
const FOREIGN_ORIGINS = {
  'no Origin': null,
  'another site\'s Origin': 'https://evil.example',
  'the sibling site\'s Origin': 'https://madcowsailing.com',
};

for (const file of guarded) {
  for (const method of await methodsOf(file)) {
    test(`${method} ${routePath(file)} with no cookie: 401, and no cookie set`, async () => {
      const res = await call(file, method);
      assert.equal(res.status, 401, `functions/${file} answered ${res.status}: does it skip the upload guard?`);
      assert.deepEqual(await res.json(), { error: 'not-joined' });
      // The control for the deletions below: a request that carries no old
      // cookie is sent no deletion.
      assert.deepEqual(res.headers.getSetCookie(), []);
    });
    for (const [name, cookie] of Object.entries(OLD_COOKIES)) {
      test(`${method} ${routePath(file)} with ${name} from before #226: 401, and the cookie deleted`, async () => {
        const res = await call(file, method, cookie);
        assert.equal(res.status, 401, `functions/${file} answered ${res.status}: does it skip the upload guard, or read the old cookie?`);
        assert.deepEqual(await res.json(), { error: 'not-joined' });
        assert.deepEqual(res.headers.getSetCookie(), [DELETE_OLD], `functions/${file} left the old cookie in place`);
      });
    }
    for (const [who, email] of [['the owner\'s', OWNER_EMAIL], ['a coach\'s', COACH]]) {
      test(`${method} ${routePath(file)} with ${who} Access token and no cookie: 401`, async () => {
        // An Access sign-in is not a session: an account's cookie is.
        const res = await call(file, method, undefined, accessToken(email));
        assert.equal(res.status, 401, `functions/${file} answered ${res.status}: an Access token opened it`);
      });
    }
    test(`${method} ${routePath(file)} with only the owner's admin session: 401 (#224)`, async (t) => {
      // An admin session opens the admin pages and does not send: the
      // account cookie the same sign-in sets is what sends.
      t.mock.method(console, 'error', () => {});
      const res = await call(file, method, undefined, undefined, SITE, undefined, ownerSession);
      assert.equal(res.status, 401, `functions/${file} answered ${res.status}: an admin session opened it`);
    });
    for (const [name, held] of Object.entries(UPLOAD_ACCOUNT_CASES)) {
      test(`${method} ${routePath(file)} with ${name}: 401`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const res = await call(file, method, undefined, undefined, SITE, held);
        assert.equal(res.status, 401, `functions/${file} answered ${res.status}: does it skip the upload guard?`);
      });
    }
    test(`${method} ${routePath(file)} with an account's current session: past the guard, and no cookie set (#223)`, async () => {
      // The control: the route is reachable in this harness, so the 401s
      // above come from the guard and not from a route that refuses anyone.
      const res = await call(file, method, undefined, undefined, SITE, accountLive);
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
      assert.deepEqual(res.headers.getSetCookie(), []);
    });
    for (const [name, cookie] of [['a parent\'s', parentLive], ['a coach\'s', coachLive]]) {
      test(`${method} ${routePath(file)} with an account's current session and ${name} cookie from before #226: the route's own answer, and the old cookie deleted`, async () => {
        // A phone signed in to an account that still holds the old cookie
        // sends as the account, and loses the cookie on its next request.
        const alone = await call(file, method, undefined, undefined, SITE, accountLive);
        const res = await call(file, method, cookie, undefined, SITE, accountLive);
        assert.notEqual(res.status, 401);
        assert.notEqual(res.status, 403);
        assert.equal(res.status, alone.status, `functions/${file} answered otherwise with the old cookie beside the account's`);
        assert.equal(await res.text(), await alone.text());
        assert.deepEqual(res.headers.getSetCookie(), [DELETE_OLD], `functions/${file} left the old cookie in place`);
      });
    }
    // An upload write needs the site's own Origin as well as a session (#154),
    // so a page elsewhere cannot post into an account's session. The albums
    // directory holds reads only, and runs no Origin guard.
    if (SAFE.includes(method) || !file.startsWith('api/upload/')) continue;
    for (const [name, origin] of Object.entries(FOREIGN_ORIGINS)) {
      test(`${method} ${routePath(file)} with an account's current session and ${name}: 403 (#223)`, async () => {
        const res = await call(file, method, undefined, undefined, origin, accountLive);
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the Origin guard?`);
        assert.deepEqual(await res.json(), { error: 'origin' });
      });
      test(`${method} ${routePath(file)} with an account's current session, a parent's cookie from before #226 and ${name}: 403, and the old cookie deleted`, async () => {
        // The Origin guard runs behind the upload guard, whose answer deletes
        // the old cookie whatever the rest of the chain says.
        const res = await call(file, method, parentLive, undefined, origin, accountLive);
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the Origin guard?`);
        assert.deepEqual(await res.json(), { error: 'origin' });
        assert.deepEqual(res.headers.getSetCookie(), [DELETE_OLD]);
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

// The admin routes (#224, criterion 5): every way an admin session can fail
// to hold, each sent to the sign-in by the guard before the route runs. call()
// seeds the owner (10) and an admin (11) approved for a team; an admin
// approved for none (12); a former admin (13); and account 1, approved and no
// admin. Account 3 does not exist. ownerSession and adminSession are above.
// An account cookie's value is a1.<payload>.<signature>; the same payload
// under m1. with the account cookie's signature is what a stolen account
// cookie would try as an admin one. Its signature is over "a1.…", so it fails.
const asAdminPayload = (value) => value.replace(/^a1\./, 'm1.');
const ownerAccount = await signAccountSession(KEY, { accountId: 10, version: 1 }, now);
const ADMIN_CASES = {
  'no cookie at all': {},
  'a tampered admin session': { admin: tamper(ownerSession) },
  'an admin session past its 12 hours': { admin: await signAdminSession(KEY, { accountId: 10, version: 1 }, now - ADMIN_SESSION_SECONDS) },
  'an admin session signed with another key': { admin: await signAdminSession(`${KEY}-other`, { accountId: 10, version: 1 }, now) },
  // Signing out, a new password or a revoke has moved the account on.
  'an admin session on a version the account no longer holds': { admin: await signAdminSession(KEY, { accountId: 10, version: 2 }, now) },
  'an admin session for an account that is no admin': { admin: await signAdminSession(KEY, { accountId: 1, version: 1 }, now) },
  'an admin session for an admin approved for no team': { admin: await signAdminSession(KEY, { accountId: 12, version: 1 }, now) },
  'an admin session for an account whose admin role was taken away': { admin: await signAdminSession(KEY, { accountId: 13, version: 1 }, now) },
  'an admin session for an account that does not exist': { admin: await signAdminSession(KEY, { accountId: 3, version: 1 }, now) },
  'the owner\'s own account session, with no admin session': { account: ownerAccount },
  'the owner\'s account session carried over as an admin one': { admin: asAdminPayload(ownerAccount) },
  'a parent\'s live upload cookie from before #226': { cookie: parentLive },
  'a coach\'s live upload cookie from before #226': { cookie: coachLive },
  // What opened the admin pages until #224: the owner's Access token. Nothing
  // has read one since (#226 deleted lib/access.js).
  'the owner\'s Access token': { token: accessToken(OWNER_EMAIL) },
};

for (const file of admin) {
  for (const method of await methodsOf(file)) {
    for (const [name, { cookie, account: held, admin: session, token }] of Object.entries(ADMIN_CASES)) {
      test(`${method} ${routePath(file)} with ${name}: sent to the sign-in, not run`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const res = await call(file, method, cookie, token, SITE, held, session);
        assert.equal(res.status, 303, `functions/${file} answered ${res.status}: does it skip the admin guard?`);
        assert.equal(res.headers.get('Location'), ADMIN_SIGN_IN, `functions/${file} sent ${res.headers.get('Location')}`);
        assert.equal(res.headers.get('Cache-Control'), 'no-store');
        // A dead admin cookie is deleted, so the browser stops sending it;
        // with none, nothing is set.
        const set = res.headers.get('Set-Cookie');
        if (session) assert.match(set, new RegExp(`^${ADMIN_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax$`));
        else assert.equal(set, null);
      });
    }
    for (const [who, session] of [['the owner\'s', ownerSession], ['an admin\'s', adminSession]]) {
      test(`${method} ${routePath(file)} with ${who} admin session: past the guard`, async () => {
        // The control: the refusals above come from the guard. A route with a
        // [param] in its path names a thing this harness never made (#156's
        // photo sizes), so its own 404 is the route answering, past the guard.
        const res = await call(file, method, undefined, undefined, SITE, undefined, session);
        const reached = res.status < 400 || (file.includes('[') && res.status === 404);
        assert.ok(reached, `functions/${file} answered ${res.status} to ${who} session`);
        assert.notEqual(res.headers.get('Location'), ADMIN_SIGN_IN);
      });
    }
    if (SAFE.includes(method)) continue;
    // A write needs the site's own Origin as well as an admin (#152), so a
    // page elsewhere cannot post a form into the admin area.
    for (const [name, origin] of Object.entries(FOREIGN_ORIGINS)) {
      test(`${method} ${routePath(file)} with the owner's admin session and ${name}: 403`, async () => {
        const res = await call(file, method, undefined, undefined, origin, undefined, ownerSession);
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

// A write under /account reaches the directory's middleware whether or not a
// route answers its method, so the guard's 401 and the Origin's 403 are
// served today though /account itself answers GET and HEAD only (#222's
// review). Run them through the directory's own chain, with a stand-in route
// behind it that answers 200.
test('the account directory refuses a write with no session that holds (401) and one from another site (403), before any route (#222)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const mod = await import(pathToFileURL(join(FUNCTIONS, 'account', '_middleware.js')));
  const run = async ({ cookie, origin = SITE, method = 'POST' }) => {
    const env = { DB: d1(), SESSION_SIGNING_KEY: KEY };
    env.DB.sqlite.exec(
      "INSERT INTO accounts (email, name, role, requested_at) VALUES ('approved@example.org', 'Approved', 'parent', 1);" +
      "INSERT INTO account_teams (account_id, team, state) VALUES (1, 'cohssa', 'approved');",
    );
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (origin) headers.Origin = origin;
    if (cookie) headers.Cookie = `${ACCOUNT_COOKIE}=${cookie}`;
    const request = new Request(`${SITE}/account/anything`, { method, headers, body: 'x=1' });
    const stack = [...mod.onRequest, () => new Response('reached', { status: 200 })];
    const data = {};
    const go = (i) => stack[i]({ request, env, data, params: {}, next: () => go(i + 1) });
    return go(0);
  };
  const current = await signAccountSession(KEY, { accountId: 1, version: 1 }, now);
  for (const cookie of [undefined, tamper(current), await signAccountSession(KEY, { accountId: 1, version: 2 }, now)]) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await run({ cookie, method });
      assert.equal(res.status, 401, `${method} with ${cookie ? 'a dead session' : 'no session'}`);
      assert.deepEqual(await res.json(), { error: 'not-signed-in' });
      assert.equal(res.headers.get('Set-Cookie'), null);
    }
  }
  for (const origin of [null, 'https://evil.example', 'https://madcowsailing.com']) {
    const res = await run({ cookie: current, origin });
    assert.equal(res.status, 403, `origin ${origin}`);
    assert.deepEqual(await res.json(), { error: 'origin' });
  }
  // The control: a current session from the site's own Origin reaches the route.
  const reached = await run({ cookie: current });
  assert.equal(reached.status, 200);
  assert.equal(await reached.text(), 'reached');
});

// The account routes (#222, criterion 4): the account guard, which sends a
// page to /sign-in and refuses anything else with 401. call() seeds account 1
// approved at version 1, and account 2 approved for no team.
const accountCurrent = await signAccountSession(KEY, { accountId: 1, version: 1 }, now);
const ACCOUNT_CASES = {
  'no account cookie': { account: undefined },
  'a tampered signature': { account: tamper(accountCurrent) },
  'an expired account cookie': { account: await signAccountSession(KEY, { accountId: 1, version: 1 }, now - ACCOUNT_SESSION_SECONDS) },
  'a cookie signed with another key': { account: await signAccountSession(`${KEY}-other`, { accountId: 1, version: 1 }, now) },
  // Signing out, a new password or a revoke has moved the account on.
  'a session version the account no longer holds': { account: await signAccountSession(KEY, { accountId: 1, version: 2 }, now) },
  'an account approved for no team': { account: await signAccountSession(KEY, { accountId: 2, version: 1 }, now) },
  'an account that does not exist': { account: await signAccountSession(KEY, { accountId: 3, version: 1 }, now) },
  'only a parent\'s live upload cookie from before #226': { cookie: parentLive },
  'only a coach\'s live upload cookie from before #226': { cookie: coachLive },
  // #224: an admin session is not an account session, and an admin
  // session's value under the account cookie's name fails its signature.
  'only the owner\'s admin session': { admin: ownerSession },
  'the owner\'s admin session carried over as an account one': { account: ownerSession.replace(/^m1\./, 'a1.') },
};

for (const file of account) {
  for (const method of await methodsOf(file)) {
    for (const [name, { cookie, account: held, admin: session }] of Object.entries(ACCOUNT_CASES)) {
      test(`${method} ${routePath(file)} with ${name}: refused by the account guard`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const res = await call(file, method, cookie, undefined, SITE, held, session);
        if (SAFE.includes(method)) {
          assert.equal(res.status, 303, `functions/${file} answered ${res.status}: does it skip the account guard?`);
          assert.equal(res.headers.get('Location'), '/sign-in');
          // A cookie that no longer holds is deleted, so the browser stops
          // sending it; with none, nothing is set.
          const set = res.headers.get('Set-Cookie');
          if (held) assert.match(set, new RegExp(`^${ACCOUNT_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax$`));
          else assert.equal(set, null);
        } else {
          assert.equal(res.status, 401, `functions/${file} answered ${res.status}: does it skip the account guard?`);
        }
      });
    }
    test(`${method} ${routePath(file)} with the owner's Access token and no account cookie: refused`, async () => {
      const res = await call(file, method, undefined, accessToken(OWNER_EMAIL));
      assert.equal(res.status, SAFE.includes(method) ? 303 : 401, `functions/${file} answered ${res.status}`);
    });
    test(`${method} ${routePath(file)} with a current account session: past the guard`, async () => {
      // The control: the refusals above come from the guard.
      const res = await call(file, method, undefined, undefined, SITE, accountCurrent);
      assert.ok(res.status < 300, `functions/${file} answered ${res.status} to a current session`);
    });
    if (SAFE.includes(method)) continue;
    for (const [name, origin] of Object.entries(FOREIGN_ORIGINS)) {
      test(`${method} ${routePath(file)} with a current account session and ${name}: 403`, async () => {
        const res = await call(file, method, undefined, undefined, origin, accountCurrent);
        assert.equal(res.status, 403, `functions/${file} answered ${res.status}: does it skip the Origin guard?`);
        assert.deepEqual(await res.json(), { error: 'origin' });
      });
    }
  }
}
