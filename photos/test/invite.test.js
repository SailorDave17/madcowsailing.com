// The invite code generator and the reading of a code someone sends (#150,
// criterion 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALPHABET, BITS, GROUP, SYMBOLS, newCode, normalizeCode } from '../lib/invite.js';

test('the alphabet is Crockford base 32: 32 symbols, no look-alikes, no lower case', () => {
  assert.equal(ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  assert.equal(new Set(ALPHABET).size, 32);
  for (const lookAlike of 'ILOU') assert.ok(!ALPHABET.includes(lookAlike), lookAlike);
  assert.equal(ALPHABET, ALPHABET.toUpperCase());
});

test('a code is 12 symbols in groups of 4, at least 60 bits', () => {
  assert.equal(SYMBOLS, 12);
  assert.equal(GROUP, 4);
  assert.ok(BITS >= 60, `${BITS} bits`);
  const shape = new RegExp(`^[${ALPHABET}]{4}-[${ALPHABET}]{4}-[${ALPHABET}]{4}$`);
  for (let i = 0; i < 200; i++) assert.match(newCode(), shape);
});

test('the default source is crypto.getRandomValues, asked for one byte per symbol', (t) => {
  const calls = [];
  t.mock.method(crypto, 'getRandomValues', (bytes) => {
    calls.push(bytes);
    return bytes.fill(0);
  });
  assert.equal(newCode(), '0000-0000-0000');
  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Uint8Array);
  assert.equal(calls[0].length, SYMBOLS);
});

test('no modulo bias: every byte value maps to a symbol, and every symbol is hit equally often', () => {
  // Feed every byte value 0..255 three times over (64 codes of 12 bytes).
  // An unbiased mapping hits each of the 32 symbols exactly 24 times.
  let next = 0;
  const counting = (bytes) => bytes.map(() => next++ % 256);
  const counts = new Map();
  for (let i = 0; i < 64; i++) {
    for (const symbol of newCode(counting).replaceAll('-', '')) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  assert.equal(next, 768);
  assert.deepEqual([...counts.keys()].sort().join(''), [...ALPHABET].sort().join(''));
  for (const [symbol, n] of counts) assert.equal(n, 24, `${symbol} came up ${n} times`);
});

test('a code is read back whatever its case, spacing and dashes', () => {
  assert.equal(normalizeCode('K7QM-3XRD-9FWB'), 'K7QM3XRD9FWB');
  assert.equal(normalizeCode('k7qm-3xrd-9fwb'), 'K7QM3XRD9FWB');
  assert.equal(normalizeCode('K7QM3XRD9FWB'), 'K7QM3XRD9FWB');
  assert.equal(normalizeCode(' K7QM 3XRD 9FWB '), 'K7QM3XRD9FWB');
});

test('a look-alike letter is read as the digit meant', () => {
  assert.equal(normalizeCode('O1AB-CDEF-GHJK'), '01ABCDEFGHJK');
  assert.equal(normalizeCode('0IAB-CDEF-GHJK'), '01ABCDEFGHJK');
  assert.equal(normalizeCode('0lAB-CDEF-GHJK'), '01ABCDEFGHJK');
});

test('anything that cannot be a code reads as null, never as an error', () => {
  for (const input of [
    '', 'K7QM-3XRD-9FW', 'K7QM-3XRD-9FWBX', 'K7QM-3XRD-9FWU', 'K7QM_3XRD_9FWB', 'K7QM-3XRD-9FW!',
    'K7QM-3XRD-9FWB'.repeat(5), null, undefined, 12, {}, ['K7QM-3XRD-9FWB'],
  ]) {
    assert.equal(normalizeCode(input), null, JSON.stringify(input));
  }
});
