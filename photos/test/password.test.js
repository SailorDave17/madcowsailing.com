// The password hash (#218, criterion 5), and the route that measures its CPU
// on the develop preview. These tests hold the route's behaviour in Node only.
// What Cloudflare's runtime refuses and what the hash costs there (criteria 1
// and 3) are read on the preview, and CLAUDE.md's photo-site items 8 and 23
// hold the readings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import {
  HASH_BYTES, MAX_COST, MAX_MEMORY, SALT_BYTES, SCRYPT, derive, hashPassword, verifyPassword,
} from '../lib/password.js';
import { OVER_CAP, PROBE_PASSWORD, onRequestGet, overCap } from '../functions/api/admin/password-probe.js';

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, '');
const phc = (ln, r, p, salt, hash) => `$scrypt$ln=${ln},r=${r},p=${p}$${b64(salt)}$${b64(hash)}`;

// RFC 7914, section 12, read from https://www.rfc-editor.org/rfc/rfc7914.txt
// on 2026-10-02: the password and salt as ASCII octets, dkLen 64. The fourth
// vector, N=1048576 with r=8, is left out: its N·r·p is 2^23, past the 2^20
// the Workers runtime allows (MAX_COST), and it needs 1 GiB.
const RFC_7914 = [
  {
    P: '', S: '', N: 16, r: 1, p: 1,
    out: `77 d6 57 62 38 65 7b 20 3b 19 ca 42 c1 8a 04 97
          f1 6b 48 44 e3 07 4a e8 df df fa 3f ed e2 14 42
          fc d0 06 9d ed 09 48 f8 32 6a 75 3a 0f c8 1f 17
          e8 d3 e0 fb 2e 0d 36 28 cf 35 e2 0c 38 d1 89 06`,
  },
  {
    P: 'password', S: 'NaCl', N: 1024, r: 8, p: 16,
    out: `fd ba be 1c 9d 34 72 00 78 56 e7 19 0d 01 e9 fe
          7c 6a d7 cb c8 23 78 30 e7 73 76 63 4b 37 31 62
          2e af 30 d9 2e 22 a3 88 6f f1 09 27 9d 98 30 da
          c7 27 af b9 4a 83 ee 6d 83 60 cb df a2 cc 06 40`,
  },
  {
    P: 'pleaseletmein', S: 'SodiumChloride', N: 16384, r: 8, p: 1,
    out: `70 23 bd cb 3a fd 73 48 46 1c 06 cd 81 fd 38 eb
          fd a8 fb ba 90 4f 8e 3e a9 b5 43 f6 54 5d a1 f2
          d5 43 29 55 61 3f 0f cf 62 d4 97 05 24 2a 9a f9
          e6 1e 85 dc 0d 65 1e 40 df cf 01 7b 45 57 58 87`,
  },
];

for (const { P, S, N, r, p, out } of RFC_7914) {
  test(`derive() matches RFC 7914's vector for P="${P}", S="${S}", N=${N}, r=${r}, p=${p}`, async () => {
    const key = await derive(P, new TextEncoder().encode(S), { N, r, p }, 64);
    assert.equal(toHex(key), out.replace(/\s+/g, ''));
  });
}

// OWASP Password Storage Cheat Sheet, scrypt, read 2026-10-02 (the sheet's
// last change to its numbers was 2026-06-24): "N=2^14 (16 MiB), r=8 (1024
// bytes), p=5". Written out here rather than read from SCRYPT, so a change to
// SCRYPT fails this file.
const OWASP_ROW = { N: 16384, r: 8, p: 5 };

test('SCRYPT is OWASP\'s N=2^14, r=8, p=5 row, inside the runtime\'s limits', () => {
  assert.deepEqual({ ...SCRYPT }, OWASP_ROW);
  assert.ok(SCRYPT.N * SCRYPT.r * SCRYPT.p <= MAX_COST);
  assert.equal(128 * SCRYPT.N * SCRYPT.r, 16 * 1024 * 1024);
  assert.ok(128 * SCRYPT.N * SCRYPT.r <= MAX_MEMORY);
});

test('a hash is a PHC string naming OWASP\'s parameters, a 16-byte salt and a 32-byte hash', async () => {
  const stored = await hashPassword('correct horse battery staple');
  const m = /^\$scrypt\$ln=14,r=8,p=5\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  assert.ok(m, stored.replace(/\$[^$]*\$[^$]*$/, '$…'));
  assert.equal(fromB64(m[1]).length, SALT_BYTES);
  assert.equal(SALT_BYTES, 16);
  assert.equal(fromB64(m[2]).length, HASH_BYTES);
  assert.equal(HASH_BYTES, 32);
});

test('the stored hash is scrypt at OWASP\'s parameters over the stored salt, recomputed outside the module', async () => {
  // node:crypto directly, with OWASP_ROW's numbers: a hash made with any other
  // N, r, p or salt than the string names fails here.
  const password = 'correct horse battery staple';
  const [, , , salt, hash] = (await hashPassword(password)).split('$');
  const expected = scryptSync(password, fromB64(salt), 32, OWASP_ROW);
  assert.equal(toHex(fromB64(hash)), expected.toString('hex'));
});

test('each hash gets its own random salt, so one password hashes differently twice', async () => {
  const a = (await hashPassword('same password')).split('$');
  const b = (await hashPassword('same password')).split('$');
  // A PHC string splits on $ into '', 'scrypt', params, salt, hash.
  assert.notEqual(a[3], b[3], 'two hashes of one password share a salt');
  assert.notEqual(a[4], b[4]);
  // Not the all-zero salt a stand-in for getRandomValues would leave.
  assert.notEqual(toHex(fromB64(a[3])), '00'.repeat(16));
});

test('verifyPassword() accepts the password and refuses any other', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  for (const wrong of ['correct horse battery stapl', 'Correct horse battery staple', 'correct horse battery staple ', '']) {
    assert.equal(await verifyPassword(wrong, stored), false, JSON.stringify(wrong));
  }
});

test('verifyPassword() reads the parameters from the stored string, so an older hash still verifies', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = scryptSync('an older password', salt, 32, { N: 1024, r: 8, p: 1 });
  assert.equal(await verifyPassword('an older password', phc(10, 8, 1, salt, hash)), true);
  assert.equal(await verifyPassword('an older password', phc(11, 8, 1, salt, hash)), false);
  // r too, at a value other than SCRYPT's 8, so an r taken from SCRYPT or
  // written in fails here.
  const r4 = scryptSync('an older password', salt, 32, { N: 1024, r: 4, p: 1 });
  assert.equal(await verifyPassword('an older password', phc(10, 4, 1, salt, r4)), true);
  assert.equal(await verifyPassword('an older password', phc(10, 8, 1, salt, r4)), false);
});

test('a password goes into scrypt as the UTF-8 it arrives as, not normalised', async () => {
  // The same "é" two ways: U+00E9, and "e" then U+0301. Normalising would make
  // them one password. That is #222's to decide (CLAUDE.md item 23), so here
  // they stay two.
  const composed = 'café ⛵ \u{1f404}';
  const decomposed = 'café ⛵ \u{1f404}';
  const stored = await hashPassword(composed);
  const [, , , salt, hash] = stored.split('$');
  const utf8 = Buffer.from(composed, 'utf8');
  assert.equal(utf8.length, 14, 'UTF-8 gives U+00E9 2 bytes, U+26F5 3 and U+1F404 4');
  assert.equal(toHex(fromB64(hash)), scryptSync(utf8, fromB64(salt), 32, OWASP_ROW).toString('hex'));
  assert.equal(await verifyPassword(composed, stored), true);
  assert.equal(await verifyPassword(decomposed, stored), false);
});

test('verifyPassword() refuses a hash whose salt or hash was changed', async () => {
  const password = 'correct horse battery staple';
  const [, , params, salt, hash] = (await hashPassword(password)).split('$');
  const flip = (text) => b64(fromB64(text).map((b, i) => (i === 0 ? b ^ 1 : b)));
  assert.equal(await verifyPassword(password, `$scrypt$${params}$${flip(salt)}$${hash}`), false);
  assert.equal(await verifyPassword(password, `$scrypt$${params}$${salt}$${flip(hash)}`), false);
});

test('verifyPassword() answers false, never throws, for a string it could not have written', async () => {
  const [, , params, salt, hash] = (await hashPassword('pw')).split('$');
  const malformed = [
    undefined, null, 42, '', 'pw',
    `$scrypt$${params}$${salt}`,
    `$scrypt$${params}$${salt}$${hash}$`,
    `$scrypt$${params}$${salt}=$${hash}`,
    `$scrypt$${params}$${salt}$${hash}=`,
    `$scrypt$${params}$${salt.slice(1)}$${hash}`,
    // Cut at the end, so only the hash's length rule refuses it: 42 characters
    // decode to the first 31 bytes, and a 31-byte scrypt is the 32-byte one
    // cut short, so without that rule it would verify.
    `$scrypt$${params}$${salt}$${hash.slice(0, -1)}`,
    `$argon2id$${params}$${salt}$${hash}`,
    `$scrypt$ln=0,r=8,p=5$${salt}$${hash}`,
    `$scrypt$ln=14,r=0,p=5$${salt}$${hash}`,
    `$scrypt$ln=14,r=8,p=0$${salt}$${hash}`,
    `$scrypt$N=16384,r=8,p=5$${salt}$${hash}`,
    // Inside the cost bound, but scrypt itself refuses each, and on workerd its
    // error carries no code: N of 2^(16r) or more (RFC 7914), and a lane buffer
    // of 128·r·p bytes that takes the whole past 32 MiB.
    `$scrypt$ln=16,r=1,p=1$${salt}$${hash}`,
    `$scrypt$ln=1,r=999,p=524$${salt}$${hash}`,
  ];
  for (const stored of malformed) {
    assert.equal(await verifyPassword('pw', stored), false, String(stored).replace(/\$[^$]*\$[^$]*$/, '$…'));
  }
});

test('verifyPassword() refuses, unread, a hash past the runtime\'s cost or the memory bound', async () => {
  // Each is a real hash of the right password, so only the bound refuses it.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pastCost = scryptSync('pw', salt, 32, { N: 1024, r: 8, p: 129 });
  assert.ok(1024 * 8 * 129 > MAX_COST);
  assert.equal(await verifyPassword('pw', phc(10, 8, 129, salt, pastCost)), false, 'N·r·p past 2^20 was computed');
  const pastMemory = scryptSync('pw', salt, 32, { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  assert.ok(128 * 65536 * 8 > MAX_MEMORY);
  assert.equal(await verifyPassword('pw', phc(16, 8, 1, salt, pastMemory)), false, '64 MiB was allocated');
  // The control: at the bound itself, a real hash verifies.
  const atCost = scryptSync('pw', salt, 32, { N: 1024, r: 8, p: 128 });
  assert.equal(await verifyPassword('pw', phc(10, 8, 128, salt, atCost)), true);
});

test('verifyPassword() counts scrypt\'s memory with its lane buffer, and refuses past 32 MiB to within a few blocks', async () => {
  // 128·r·(N + p + 2) bytes, written out: at r=255 and N=2^10, p=2 needs
  // 33,553,920 bytes, 512 under 32 MiB, and p=3 needs 33,586,560, 32,128
  // over. The table alone (128·N·r) is 33,423,360 for both, so a bound that
  // leaves the lanes out lets p=3 through, and a bound moved more than those
  // margins either way changes one answer.
  assert.equal(128 * 255 * (1024 + 2 + 2), 32 * 1024 * 1024 - 512);
  assert.equal(128 * 255 * (1024 + 3 + 2), 32 * 1024 * 1024 + 32_128);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const maxmem = 64 * 1024 * 1024;
  const under = scryptSync('pw', salt, 32, { N: 1024, r: 255, p: 2, maxmem });
  assert.equal(await verifyPassword('pw', phc(10, 255, 2, salt, under)), true, 'a set just under 32 MiB was refused');
  const over = scryptSync('pw', salt, 32, { N: 1024, r: 255, p: 3, maxmem });
  assert.equal(await verifyPassword('pw', phc(10, 255, 3, salt, over)), false, 'a set just past 32 MiB was computed');
});

test('verifyPassword() keeps RFC 7914\'s rule that N is under 2^(16r), and no stricter', async () => {
  // At r=1 the largest N scrypt takes is 2^15. A real hash there verifies;
  // 2^16 is refused unread (the never-throws test above), because scrypt
  // itself would throw.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const largest = scryptSync('pw', salt, 32, { N: 2 ** 15, r: 1, p: 1 });
  assert.equal(await verifyPassword('pw', phc(15, 1, 1, salt, largest)), true);
  assert.throws(() => scryptSync('pw', salt, 32, { N: 2 ** 16, r: 1, p: 1 }), /Invalid scrypt param/);
});

// The probe route. Its guards are test/guard.test.js's: it is an admin API.
const probe = (query = '', env = { SITE_ENV: 'preview' }) =>
  onRequestGet({ request: new Request(`https://develop.madcowphotos.pages.dev/api/admin/password-probe${query}`), env });

test('the probe answers 404 on production, whatever it is asked', async () => {
  for (const query of ['', '?run=hash', '?run=none', '?run=over-cap', '?run=x']) {
    const res = await probe(query, { SITE_ENV: 'production' });
    assert.equal(res.status, 404, query);
  }
});

test('the probe hashes at SCRYPT by default, and ?run=none does everything but the hash', async () => {
  // Whether ?run=hash hashes once or twice shows in nothing here, only in its
  // CPU. A reading on the preview near twice Node's 170 ms would show it.
  for (const query of ['', '?run=hash']) {
    const res = await probe(query);
    assert.equal(res.status, 200, query);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const { run, params, stored, ...rest } = await res.json();
    assert.deepEqual({ run, params, rest }, { run: 'hash', params: 'ln=14,r=8,p=5', rest: {} }, query);
    assert.match(stored, /^\$scrypt\$ln=14,r=8,p=5\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/, query);
  }
  const res = await probe('?run=none');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { run: 'none', params: 'ln=14,r=8,p=5' });
});

test('the probe\'s ?run=none spends a small part of what ?run=hash does', async () => {
  // The control's whole point is that it skips the scrypt. Node takes about
  // 170 ms for one hash here; the margin is wide on purpose.
  const time = async (query) => {
    const start = performance.now();
    await (await probe(query)).json();
    return performance.now() - start;
  };
  await time('');
  const [hash, none] = [await time(''), await time('?run=none')];
  assert.ok(none * 10 < hash, `none ${none.toFixed(1)} ms against hash ${hash.toFixed(1)} ms`);
});

test('?run=over-cap asks each function for one step past its limit, and reports a refusal in the function\'s own words', async () => {
  // Stand-ins that record what they were asked and refuse with a message of
  // their own, since Node refuses none of these.
  const asked = [];
  const refusal = (name) => new Error(`${name} planted refusal`);
  const kdf = {
    subtle: {
      importKey: async () => ({}),
      deriveBits: async ({ iterations }) => {
        asked.push(['subtle', iterations]);
        throw refusal('subtle');
      },
    },
    pbkdf2: (password, salt, iterations, length, digest, done) => {
      asked.push(['pbkdf2', iterations]);
      done(refusal('pbkdf2'));
    },
    scrypt: (password, salt, length, { N, r, p }, done) => {
      asked.push(['scrypt', { N, r, p }]);
      done(refusal('scrypt'));
    },
  };
  assert.deepEqual(await overCap(kdf), {
    pbkdf2WebCrypto: 'refused: subtle planted refusal',
    pbkdf2Node: 'refused: pbkdf2 planted refusal',
    scryptNode: 'refused: scrypt planted refusal',
  });
  // workerd's limits are 100,000 iterations and an N·r·p of 2^20, so one
  // iteration past the first, and one lane (N·r = 2^13) past the second.
  assert.deepEqual(asked, [
    ['subtle', 100_001],
    ['pbkdf2', 100_001],
    ['scrypt', { N: 1024, r: 8, p: 129 }],
  ]);
  assert.equal(1024 * 8 * 129, 2 ** 20 + 2 ** 13);
});

test('?run=over-cap reads accepted from all three in Node, which sets none of the limits', async () => {
  const res = await probe('?run=over-cap');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), {
    run: 'over-cap', pbkdf2WebCrypto: 'accepted', pbkdf2Node: 'accepted', scryptNode: 'accepted',
  });
  assert.equal(OVER_CAP.pbkdf2Iterations, 100_001);
});

test('the probe refuses a mode it does not know', async () => {
  const res = await probe('?run=everything');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'run' });
});

test('the probe hashes its own fixed string, never a password the request carries', async () => {
  assert.match(PROBE_PASSWORD, /^password-probe: /);
  const res = await probe('?run=hash&password=hunter2');
  assert.equal(res.status, 200);
  const { stored } = await res.json();
  assert.equal(await verifyPassword(PROBE_PASSWORD, stored), true);
  assert.equal(await verifyPassword('hunter2', stored), false);
});
