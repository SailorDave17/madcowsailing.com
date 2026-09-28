// No logging call in the site's code is handed the invite code, the cookie,
// a key or a request's contents (#150, criterion 8).
//
// test/join.test.js runs the join route and scans what it logged. This reads
// every console call in functions/ and lib/ instead, so a route written later
// is held too, before any test drives it. It strips string literals (keeping
// a template's ${…} expressions) and looks for the names that carry secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The last group is the admin guard's (#151): the Access token, what it
// claims, and the owner's address, which is kept out of the public repo too.
const FORBIDDEN = /\b(code|codes|presented|stored|cookie|cookies|value|signature|secret|secrets|key|keys|[A-Z_]*_KEY|body|text|headers|request|session|token|tokens|jwt|claims|payload|email|emails|owner|ADMIN_EMAILS)\b/i;

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// The argument text of every console.<method>(…) call, with string literals
// blanked and a template's ${…} expressions kept.
function consoleCalls(source) {
  const calls = [];
  const opener = /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/g;
  let match;
  while ((match = opener.exec(source))) {
    let depth = 1;
    let i = opener.lastIndex;
    let args = '';
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "'" || c === '"') {
        const end = source.indexOf(c, i + 1);
        args += ' ';
        i = end + 1;
        continue;
      }
      if (c === '`') {
        i++;
        while (i < source.length && source[i] !== '`') {
          if (source[i] === '$' && source[i + 1] === '{') {
            const close = source.indexOf('}', i);
            args += ` ${source.slice(i + 2, close)} `;
            i = close + 1;
          } else i++;
        }
        i++;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth > 0) args += c;
      i++;
    }
    calls.push({ line: source.slice(0, match.index).split('\n').length, args });
  }
  return calls;
}

test('the scanner finds a secret handed to a logging call, and passes a clean one', () => {
  // The control: a planted call of each kind it must catch, and one it must not.
  const planted = [
    "console.log('joining with', code);",
    "console.error(`bad cookie ${cookie}`);",
    'console.warn("key:", env.SESSION_SIGNING_KEY);',
    "console.info('body', await request.text());",
    "console.debug(\n  'split',\n  session.generation,\n);",
    "console.error('refused', token);",
    'console.warn(`not listed: ${claims.email}`);',
    "console.log('allowed', env.ADMIN_EMAILS);",
  ];
  for (const source of planted) {
    const calls = consoleCalls(source);
    assert.equal(calls.length, 1, source);
    assert.match(calls[0].args, FORBIDDEN, source);
  }
  const clean = consoleCalls("console.error('the code and the cookie are not logged:', err.message);");
  assert.equal(clean.length, 1);
  assert.doesNotMatch(clean[0].args, FORBIDDEN);
});

test("no logging call in the site's code is handed a secret or a request's contents", () => {
  let seen = 0;
  for (const file of [...sources(join(ROOT, 'functions')), ...sources(join(ROOT, 'lib'))]) {
    for (const { line, args } of consoleCalls(readFileSync(file, 'utf8'))) {
      seen++;
      assert.doesNotMatch(args, FORBIDDEN, `${relative(ROOT, file)}:${line} logs ${args.trim()}`);
    }
  }
  assert.ok(seen >= 4, `only ${seen} logging calls found: is the scanner reading the files?`);
});
