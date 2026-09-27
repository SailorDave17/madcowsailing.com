// The site-wide headers, and the middleware that puts them on everything a
// Function answers. Run with `npm test` from the repo root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SITE_HEADERS } from '../lib/headers.js';
import { onRequest } from '../functions/_middleware.js';

// The rules of a Pages _headers file: a path at column 0, then its headers
// indented beneath it. Comments and blank lines are skipped.
function parseHeadersFile(text) {
  const rules = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      rules.set(current, {});
      continue;
    }
    assert.ok(current, `a header line comes before any path: ${line}`);
    const colon = line.indexOf(':');
    rules.get(current)[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return rules;
}

function directives(csp) {
  return Object.fromEntries(
    csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...sources] = d.split(/\s+/);
      return [name, sources];
    }),
  );
}

const headersFile = parseHeadersFile(
  readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'),
);

test('public/_headers and lib/headers.js carry the same site-wide headers', () => {
  // Pages applies _headers to static files and never to a Function's answer,
  // so the two copies must agree or one kind of response goes out without them.
  assert.deepEqual(headersFile.get('/*'), { ...SITE_HEADERS });
});

test('every response says noindex', () => {
  assert.equal(SITE_HEADERS['X-Robots-Tag'], 'noindex');
});

test('the CSP allows only this origin, blob: images, and no framing', () => {
  const csp = directives(SITE_HEADERS['Content-Security-Policy']);
  for (const name of ['default-src', 'script-src', 'style-src', 'font-src', 'connect-src']) {
    assert.deepEqual(csp[name], ["'self'"], name);
  }
  assert.deepEqual(csp['img-src'], ["'self'", 'blob:']);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  // Nothing wider anywhere: no inline code, no eval, no wildcard, no data:.
  const every = Object.values(csp).flat();
  for (const source of every) {
    assert.ok(["'self'", "'none'", 'blob:'].includes(source), `unexpected CSP source ${source}`);
  }
});

test("the middleware puts every site header on a route's answer and keeps the rest", async () => {
  const route = new Response('{"a":1}', {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  const res = await onRequest({ next: async () => route });
  assert.equal(res.status, 201);
  assert.equal(await res.text(), '{"a":1}');
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  for (const [name, value] of Object.entries(SITE_HEADERS)) {
    assert.equal(res.headers.get(name), value, name);
  }
});

test('the middleware can set headers on a response whose headers are immutable', async () => {
  // Response.redirect() makes a response with an immutable header list, the
  // same guard a static file's response from next() carries.
  const res = await onRequest({ next: async () => Response.redirect('https://example.test/x', 302) });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://example.test/x');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
});

test('a site header a route sets is overwritten, not kept', async () => {
  const res = await onRequest({
    next: async () => new Response('x', { headers: { 'X-Robots-Tag': 'all' } }),
  });
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
});

test('a route that throws is answered 500, with the site headers and no error text', async (t) => {
  t.mock.method(console, 'error', () => {});
  const res = await onRequest({
    next: async () => { throw new Error('secret-looking detail'); },
  });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await res.text(), /secret-looking detail/);
});
