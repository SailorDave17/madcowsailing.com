// The upload guard (#150, criterion 5), which since #226 takes an account's
// session only (#223), and the upload cookie the invite link and the coaches'
// sign-in set until #226, which it deletes wherever it finds it.
// test/guard.test.js holds every route to the guard; this calls it directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as session from '../lib/session.js';
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_SECONDS, signAccountSession } from '../lib/account-session.js';
import { d1, seedCodes } from './d1.js';
import { UPLOAD_COOKIE, coachCookie, parentCookie } from './legacy-cookies.js';

const { COOKIE_NAME, clearUploadCookie, cookieValue, nowSeconds, requireUploadSession } = session;

const SITE = 'https://photos.madcowsailing.com';
const KEY = 'test-session-signing-key-0123456789abcdef';
const COACH = 'coach@example.com';
// The one deletion: the old cookie's name, empty, gone at once. The __Host-
// prefix makes a browser ignore a Set-Cookie for it that is not Secure with
// Path=/ and no Domain, and an ignored deletion leaves the cookie in place.
const DELETE_OLD = '__Host-upload=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';
// The old cookie lasted 90 days (#150).
const OLD_SESSION_SECONDS = 90 * 24 * 60 * 60;

test('lib/session.js keeps the old cookie\'s name, to find and delete it, and nothing that signs or reads one (#226)', () => {
  assert.equal(COOKIE_NAME, '__Host-upload');
  assert.deepEqual(Object.keys(session).sort(), ['COOKIE_NAME', 'clearUploadCookie', 'cookieValue', 'nowSeconds', 'requireUploadSession']);
});

test('lib/account-session.js does not import lib/session.js, which imports it', () => {
  const source = readFileSync(new URL('../lib/account-session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/session\.js['"]/);
});

test('the deletion names the old cookie, empty, at once, with the attributes its prefix requires', () => {
  assert.equal(clearUploadCookie(), DELETE_OLD);
});

test('the old cookie is found among others by its exact name, an empty one included', () => {
  assert.equal(cookieValue(`a=1; ${UPLOAD_COOKIE}=v; b=2`), 'v');
  assert.equal(cookieValue(`${UPLOAD_COOKIE}=`), '');
  assert.equal(cookieValue(`x${UPLOAD_COOKIE}=v; b=2`), null);
  assert.equal(cookieValue(`${UPLOAD_COOKIE}-x=v`), null);
  assert.equal(cookieValue(`${ACCOUNT_COOKIE}=v`), null);
  assert.equal(cookieValue(''), null);
  assert.equal(cookieValue(null), null);
});

// The guard, called directly. Account 1 is a parent approved for COHSSA,
// account 2 a coach approved for both teams, account 3 still waiting, approved
// for none; all at session version 1. Generation 2 is the invite code that
// was current until #226, and COACH is on COACH_EMAILS as a coach was, so the
// live old cookies below are ones the guard took before #226.
function site() {
  const db = d1();
  seedCodes(db, 'AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB');
  db.sqlite.exec(
    "INSERT INTO accounts (email, name, role, requested_at) VALUES ('parent@example.org', 'Parent', 'parent', 1), ('coach@example.org', 'Coach', 'coach', 1), ('waiting@example.org', 'Waiting', 'parent', 1);" +
    "INSERT INTO account_teams (account_id, team, state) VALUES (1, 'cohssa', 'approved'), (2, 'cohssa', 'approved'), (2, 'hoover-jrt', 'approved'), (3, 'cohssa', 'requested');",
  );
  return db;
}

const withCookies = ({ account, old } = {}) => {
  const cookies = [
    ...(old === undefined ? [] : [`${UPLOAD_COOKIE}=${old}`]),
    ...(account === undefined ? [] : [`${ACCOUNT_COOKIE}=${account}`]),
  ];
  return new Request(`${SITE}/api/upload/session`, { headers: cookies.length ? { Cookie: cookies.join('; ') } : {} });
};

const routeRan = () => new Response('route ran', { status: 200 });

async function guard(request, db = site(), next = routeRan, env = {}) {
  let ran = 0;
  const context = {
    request,
    env: { DB: db, SESSION_SIGNING_KEY: KEY, COACH_EMAILS: COACH, ...env },
    data: {},
    next: async () => { ran++; return next(); },
  };
  const response = await requireUploadSession(context);
  return { response, session: context.data.session, ran };
}

async function refused(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

const now = nowSeconds();
const tamper = (value) => {
  const signature = value.split('.').pop();
  // The FIRST character: a 32-byte signature's last carries padding bits.
  return value.replace(signature, (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1));
};
const parentAccount = await signAccountSession(KEY, { accountId: 1, version: 1 }, now);
const coachAccount = await signAccountSession(KEY, { accountId: 2, version: 1 }, now);
const parentLive = await parentCookie(KEY, 2, now);
const coachLive = await coachCookie(KEY, COACH, now);

// Every old cookie a phone could still hold, valid then or not, and values
// that were never one: the guard deletes whatever it finds under the name.
const OLD_COOKIES = {
  'a parent\'s for the current code': parentLive,
  'a parent\'s for an earlier code': await parentCookie(KEY, 1, now),
  'an expired parent\'s': await parentCookie(KEY, 2, now - OLD_SESSION_SECONDS),
  'a parent\'s with a tampered signature': tamper(parentLive),
  'a listed coach\'s': coachLive,
  'an expired coach\'s': await coachCookie(KEY, COACH, now - OLD_SESSION_SECONDS),
  'a coach\'s for an address off the list': await coachCookie(KEY, 'former@example.com', now),
  'a malformed one': 'v1',
  'an empty one': '',
};

// Every way an account's session fails to hold.
const DEAD_ACCOUNTS = {
  'a tampered account session': tamper(parentAccount),
  'an expired account session': await signAccountSession(KEY, { accountId: 1, version: 1 }, now - ACCOUNT_SESSION_SECONDS),
  'an account session signed with another key': await signAccountSession(`${KEY}-other`, { accountId: 1, version: 1 }, now),
  'an account session on a version the account no longer holds': await signAccountSession(KEY, { accountId: 1, version: 2 }, now),
  'an account session for an account approved for no team': await signAccountSession(KEY, { accountId: 3, version: 1 }, now),
  'an account session for an account that does not exist': await signAccountSession(KEY, { accountId: 9, version: 1 }, now),
};

test('a live account session passes, with the account on context.data.session, and no cookie set', async () => {
  for (const [account, expected] of [
    [parentAccount, { sender: 'account', accountId: 1, role: 'parent', teams: ['cohssa'], issued: now }],
    // teams in TEAMS order, and the role an admin approved (#221).
    [coachAccount, { sender: 'account', accountId: 2, role: 'coach', teams: ['hoover-jrt', 'cohssa'], issued: now }],
  ]) {
    const { response, session: held, ran } = await guard(withCookies({ account }));
    assert.equal(ran, 1);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'route ran');
    assert.deepEqual(held, expected);
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
});

test('a live account session carrying an old cookie passes as the account, and the route\'s answer deletes the old cookie', async () => {
  for (const [name, old] of Object.entries(OLD_COOKIES)) {
    const { response, session: held, ran } = await guard(withCookies({ account: parentAccount, old }));
    assert.equal(ran, 1, name);
    assert.equal(response.status, 200, name);
    assert.equal(await response.text(), 'route ran', name);
    assert.deepEqual(held, { sender: 'account', accountId: 1, role: 'parent', teams: ['cohssa'], issued: now }, name);
    assert.deepEqual(response.headers.getSetCookie(), [DELETE_OLD], name);
  }
});

test('the route\'s own status, headers and cookies survive the deletion, its headers immutable or not', async () => {
  const own = () => new Response('made', { status: 201, headers: { 'Set-Cookie': 'x=1; Path=/', 'X-Route': 'yes' } });
  const { response } = await guard(withCookies({ account: parentAccount, old: parentLive }), site(), own);
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'made');
  assert.equal(response.headers.get('X-Route'), 'yes');
  assert.deepEqual(response.headers.getSetCookie(), ['x=1; Path=/', DELETE_OLD]);

  // A redirect's headers cannot be changed, as a fetched response's cannot on
  // Pages, so the guard has to copy the answer before it adds the deletion.
  const moved = () => Response.redirect(`${SITE}/share/`, 303);
  const { response: copied } = await guard(withCookies({ account: parentAccount, old: parentLive }), site(), moved);
  assert.equal(copied.status, 303);
  assert.equal(copied.headers.get('Location'), `${SITE}/share/`);
  assert.deepEqual(copied.headers.getSetCookie(), [DELETE_OLD]);
});

test('an old cookie alone opens nothing: 401, the route never runs, and the answer deletes it', async () => {
  for (const [name, old] of Object.entries(OLD_COOKIES)) {
    const { response, session: held, ran } = await guard(withCookies({ old }));
    assert.equal(ran, 0, name);
    assert.equal(held, undefined, name);
    await refused(response, 401, 'not-joined');
    assert.deepEqual(response.headers.getSetCookie(), [DELETE_OLD], name);
  }
});

test('with no account session that holds and no old cookie: 401, and no cookie set', async () => {
  for (const [name, account] of [['no cookie at all', undefined], ...Object.entries(DEAD_ACCOUNTS)]) {
    const { response, ran } = await guard(withCookies({ account }));
    assert.equal(ran, 0, name);
    await refused(response, 401, 'not-joined');
    assert.deepEqual(response.headers.getSetCookie(), [], name);
  }
  // A cookie whose name only ends in the old one's is not it.
  const { response } = await guard(new Request(`${SITE}/api/upload/session`, { headers: { Cookie: `x${UPLOAD_COOKIE}=v1` } }));
  await refused(response, 401, 'not-joined');
  assert.deepEqual(response.headers.getSetCookie(), []);
});

test('a dead account session carrying an old cookie: 401, and the old cookie deleted', async () => {
  for (const [name, account] of Object.entries(DEAD_ACCOUNTS)) {
    const { response, ran } = await guard(withCookies({ account, old: parentLive }));
    assert.equal(ran, 0, name);
    await refused(response, 401, 'not-joined');
    assert.deepEqual(response.headers.getSetCookie(), [DELETE_OLD], name);
  }
});

test('with no signing key nothing opens, and an old cookie is still deleted', async () => {
  for (const key of [undefined, '']) {
    const kept = await guard(withCookies({ account: parentAccount }), site(), routeRan, { SESSION_SIGNING_KEY: key });
    assert.equal(kept.ran, 0);
    await refused(kept.response, 401, 'not-joined');
    assert.deepEqual(kept.response.headers.getSetCookie(), []);
    const deleted = await guard(withCookies({ account: parentAccount, old: parentLive }), site(), routeRan, { SESSION_SIGNING_KEY: key });
    await refused(deleted.response, 401, 'not-joined');
    assert.deepEqual(deleted.response.headers.getSetCookie(), [DELETE_OLD]);
  }
});

test('a database that does not answer fails closed: 503, the route never runs, and an old cookie carried is deleted', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.map(String).join(' ')));
  const broken = { prepare() { throw new Error('D1_ERROR: daily limit'); } };
  for (const [old, set] of [[undefined, []], [parentLive, [DELETE_OLD]]]) {
    const { response, ran } = await guard(withCookies({ account: parentAccount, old }), broken);
    assert.equal(ran, 0);
    await refused(response, 503, 'unavailable');
    assert.deepEqual(response.headers.getSetCookie(), set);
  }
  // It says why, and carries neither cookie nor the key.
  assert.equal(logged.length, 2);
  for (const line of logged) {
    for (const secret of [KEY, parentAccount, parentAccount.split('.').pop(), parentLive, parentLive.split('.').pop()]) {
      assert.ok(!line.includes(secret), `a log line carries ${secret}: ${line}`);
    }
  }
});
