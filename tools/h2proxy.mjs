#!/usr/bin/env node
/**
 * A local HTTP/2 proxy in front of `wrangler pages dev`, for reading the photo
 * site's quality floor (CLAUDE.md, Quality floor; owner decision, #155).
 *
 * Why it exists: `wrangler pages dev` serves HTTP/1.1, and Lighthouse's
 * simulated throttling charges a page for every connection that costs. On
 * #155 the share page as shipped read 93-94 under wrangler, 98-99 on
 * production (HTTP/2) and 96-97 through this proxy. A proxy that only added
 * compression moved nothing, because Lighthouse counts decoded bytes. So the
 * protocol, not the bytes, was the gap.
 *
 * Usage, from the repo root, with the site running under wrangler on 8788:
 *
 *   openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=127.0.0.1" \
 *     -addext "subjectAltName=IP:127.0.0.1" -keyout <dir>/key.pem -out <dir>/cert.pem
 *   node tools/h2proxy.mjs 8791 8788 <dir>/key.pem <dir>/cert.pem
 *   npx --yes lighthouse@13.4.1 https://127.0.0.1:8791/share/ \
 *     --only-categories=performance,accessibility --form-factor=mobile \
 *     --screenEmulation.mobile --chrome-flags="--headless=new --ignore-certificate-errors"
 *
 * Keep the certificate out of the repo (a scratch directory): it is
 * self-signed and throwaway. A page behind the upload session needs its
 * cookie: pass `--extra-headers=<file>` holding {"Cookie": "__Host-upload=..."},
 * taken from a POST to /api/join.
 *
 * The site checks a write's Origin against the host it is served on, which
 * wrangler sees as plain http, so the proxy rewrites Origin to match. Nothing
 * else is changed on the way through.
 */
import http from 'node:http';
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';

const [listen, target, keyPath, certPath] = process.argv.slice(2);
if (!listen || !target || !keyPath || !certPath) {
  console.error('usage: node tools/h2proxy.mjs <listen port> <wrangler port> <key.pem> <cert.pem>');
  process.exit(2);
}

// Connection-level headers HTTP/2 forbids in a response.
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);

const server = http2.createSecureServer({ key: readFileSync(keyPath), cert: readFileSync(certPath), allowHTTP1: true }, (req, res) => {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!name.startsWith(':')) headers[name] = value;
  headers.host = `127.0.0.1:${target}`;
  if (headers.origin) headers.origin = `http://127.0.0.1:${target}`;
  const upstream = http.request({ host: '127.0.0.1', port: Number(target), path: req.url, method: req.method, headers }, (answer) => {
    const out = {};
    for (const [name, value] of Object.entries(answer.headers)) if (!HOP.has(name)) out[name] = value;
    res.writeHead(answer.statusCode, out);
    answer.pipe(res);
  });
  upstream.on('error', () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.listen(Number(listen), '127.0.0.1', () => console.log(`h2proxy: https://127.0.0.1:${listen} -> http://127.0.0.1:${target}`));
