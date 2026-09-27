// Deliberately failing, for #149's criterion 10: a failing photo-site test
// must redden githooks/checks and CI alike. The next commit reverts this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('deliberately failing (#149 criterion 10; reverted in the next commit)', () => {
  assert.equal(1, 2);
});
