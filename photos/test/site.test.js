// The shape of the photo site's tree: what Pages publishes, what invokes a
// Function, the Wrangler config, the migrations and the pages' shared chrome.
// Each test names the rule in CLAUDE.md (The photo site) or #149 it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

// Every file under dir, as a forward-slash path relative to dir. The build's
// copy of shared/ (public/assets/shared/) is skipped: it is generated, and
// gitignored.
function walk(dir, skip = []) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (skip.includes(full)) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, skip).map((p) => `${name}/${p}`));
    else out.push(name);
  }
  return out;
}
const publicFiles = () => walk(PUBLIC, [join(PUBLIC, 'assets', 'shared')]);

// Wrangler reads JSONC. This strips // and /* */ comments outside strings and
// nothing else, so a trailing comma fails the parse loudly rather than passing.
function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

// _routes.json patterns: a trailing /* matches that prefix at any depth,
// anything else matches exactly (Cloudflare's "Routing" page).
const matches = (pattern, path) =>
  pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;

// The URL path a functions/ file answers, with one sample value per
// [param] and two segments per [[catchall]].
function routePath(file) {
  const path = file
    .replace(/\.(js|ts)$/, '')
    .replace(/\[\[[^\]]+\]\]/g, 'a/b')
    .replace(/\[[^\]]+\]/g, 'a')
    .replace(/(^|\/)index$/, '');
  return `/${path}`;
}

const routes = JSON.parse(read('public', '_routes.json'));
const invokes = (path) =>
  routes.include.some((p) => matches(p, path)) && !routes.exclude.some((p) => matches(p, path));

test('_routes.json is valid version 1 and within the 100-rule limit', () => {
  assert.equal(routes.version, 1);
  assert.ok(Array.isArray(routes.include) && routes.include.length > 0);
  assert.ok(Array.isArray(routes.exclude));
  assert.ok(routes.include.length + routes.exclude.length <= 100);
});

test('every Function route is one _routes.json invokes', () => {
  // A route file whose path _routes.json leaves out never runs: Pages serves
  // the static 404 instead, and nothing says why.
  const files = walk(join(ROOT, 'functions')).filter((f) => !/(^|\/)_middleware\.js$/.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(invokes(routePath(file)), `functions/${file} answers ${routePath(file)}, which _routes.json does not invoke`);
  }
});

test('no static file sits where a Function answers, and static files cost no Function request', () => {
  // Item 4: nothing under /api (or later /admin) exists as a static file, so
  // failing closed cannot fall back to one. And item 2: static files stay
  // outside _routes.json, so they never spend the daily request quota.
  for (const file of publicFiles()) {
    if (file.startsWith('_')) continue; // _headers, _routes.json: config, not served files
    const path = `/${file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;
    assert.ok(!invokes(path), `public/${file} is served at ${path}, which _routes.json sends to a Function`);
  }
});

test('the site has a top-level 404.html', () => {
  // Without one, Pages answers every unmatched path with the home page and a 200.
  assert.ok(existsSync(join(PUBLIC, '404.html')));
});

test('public/ holds nothing that is not meant to be served', () => {
  const forbidden = /(^|\/)(wrangler\.(json|jsonc|toml)|package(-lock)?\.json|\.dev\.vars|\.env[^/]*)$|\.sql$/;
  for (const file of publicFiles()) assert.doesNotMatch(file, forbidden, `public/${file}`);
});

test('robots.txt allows crawling', () => {
  const lines = read('public', 'robots.txt').split(/\r?\n/).filter((l) => !l.startsWith('#'));
  assert.ok(lines.includes('User-agent: *'));
  for (const line of lines) {
    const m = line.match(/^Disallow:\s*(.*)$/i);
    if (m) assert.equal(m[1], '', `robots.txt disallows ${m[1]}, and a disallowed URL never has its noindex read`);
  }
});

const config = parseJsonc(read('wrangler.jsonc'));
const bindings = (c) => ({ vars: c.vars, d1_databases: c.d1_databases, r2_buckets: c.r2_buckets });

test('wrangler.jsonc is a Pages config publishing public/ only', () => {
  assert.equal(config.name, 'madcowphotos');
  assert.equal(config.pages_build_output_dir, './public');
  assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(config.env).sort(), ['preview', 'production']);
});

test('wrangler.jsonc names nodejs_compat, which lib/password.js\'s node:crypto import needs (#218)', () => {
  // The dated default would cover the runtime; the flag covers a Pages build
  // whose wrangler does not know that default.
  assert.ok(read('lib/password.js').includes("from 'node:crypto'"));
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
});

test('preview and production name different databases and buckets', () => {
  const { preview, production } = config.env;
  for (const env of [preview, production]) {
    assert.deepEqual(env.d1_databases.map((d) => d.binding), ['DB']);
    assert.deepEqual(env.r2_buckets.map((b) => b.binding), ['MEDIA']);
  }
  assert.equal(preview.vars.SITE_ENV, 'preview');
  assert.equal(production.vars.SITE_ENV, 'production');
  const [pDb, xDb] = [preview.d1_databases[0], production.d1_databases[0]];
  assert.notEqual(pDb.database_name, xDb.database_name);
  assert.notEqual(pDb.database_id, xDb.database_id);
  assert.notEqual(preview.r2_buckets[0].bucket_name, production.r2_buckets[0].bucket_name);
});

test('the top level names the preview resources, never production', () => {
  assert.deepEqual(bindings(config), bindings(config.env.preview));
});

test('every database_id is a real one, written out', () => {
  // The placeholders the branch was built with are all zeros; the IDs come
  // from the databases created in the dashboard.
  for (const env of [config, config.env.preview, config.env.production]) {
    for (const db of env.d1_databases) {
      assert.match(db.database_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.doesNotMatch(db.database_id, /^00000000-/, `${db.database_name} still has a placeholder ID`);
    }
  }
});

test('the config carries no secret: vars hold SITE_ENV and the three Access settings, nothing else', () => {
  // Secrets are Pages secrets, set in the dashboard and named in README.md.
  // The admin and coach allow-lists are two of them (#151, owner's choice
  // 2026-09-28; #192), so no address is in this public repo.
  for (const env of [config, config.env.preview, config.env.production]) {
    assert.deepEqual(Object.keys(env.vars), ['SITE_ENV', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_COACH_AUD']);
    assert.ok(!('ADMIN_EMAILS' in env.vars));
    assert.ok(!('COACH_EMAILS' in env.vars));
  }
});

test('the admin guard trusts the madcowsailing team, with one Access application per environment', () => {
  // #151. The issuer and the key URL both come from ACCESS_TEAM_DOMAIN, which
  // renaming the Zero Trust team would change. A preview deployment is signed
  // for the Pages preview application, production for the admin application,
  // so their AUD tags differ; a tag Access issues is 64 hex characters.
  const { preview, production } = config.env;
  for (const env of [preview, production]) {
    assert.equal(env.vars.ACCESS_TEAM_DOMAIN, 'https://madcowsailing.cloudflareaccess.com');
    assert.match(env.vars.ACCESS_AUD, /^[0-9a-f]{64}$/);
  }
  assert.notEqual(preview.vars.ACCESS_AUD, production.vars.ACCESS_AUD);
});

test('the coach guard has its own application in production, and the preview application on a preview', () => {
  // #192. In production /coach sits behind the coach application, whose tag
  // must differ from the admin one's, or a token for either would pass the
  // other's check. A preview deployment signs every path for the Pages
  // preview application, so there the coach tag is the same as the admin tag.
  const { preview, production } = config.env;
  for (const env of [preview, production]) assert.match(env.vars.ACCESS_COACH_AUD, /^[0-9a-f]{64}$/);
  assert.notEqual(production.vars.ACCESS_COACH_AUD, production.vars.ACCESS_AUD);
  assert.equal(preview.vars.ACCESS_COACH_AUD, preview.vars.ACCESS_AUD);
  assert.equal(config.vars.ACCESS_COACH_AUD, preview.vars.ACCESS_COACH_AUD);
});

test('migrations are numbered NNNN_name.sql, in order, once each', () => {
  const dir = config.d1_databases[0].migrations_dir;
  const files = readdirSync(join(ROOT, dir)).sort();
  assert.ok(files.length > 0);
  files.forEach((file, i) => {
    assert.match(file, /^\d{4}_[a-z0-9_]+\.sql$/, file);
    assert.equal(Number(file.slice(0, 4)), i + 1, `${file} is out of sequence`);
  });
});

test('every migration is additive: nothing is dropped, renamed, rewritten or deleted', () => {
  // Item 6: running code must never meet a schema it does not know, so a
  // migration creates a table, adds a column or adds an index. A reference's
  // ON DELETE / ON UPDATE clause is part of a new table, not a change to rows.
  const dir = join(ROOT, config.d1_databases[0].migrations_dir);
  const changes = /\b(DROP|RENAME|DELETE|UPDATE|REPLACE|TRUNCATE)\b/i;
  for (const file of readdirSync(dir)) {
    const sql = readFileSync(join(dir, file), 'utf8')
      .replace(/--[^\n]*/g, '')
      .replace(/\bON\s+(DELETE|UPDATE)\b/gi, '');
    assert.doesNotMatch(sql, changes, `${file} changes what is already there`);
  }
  // The control: the check reads a DROP when there is one.
  assert.match('DROP TABLE albums;', changes);
});

test('the README lists every migration, and nothing that is not one', () => {
  // README.md, The photo site, Changing the schema: its table names each file.
  const dir = config.d1_databases[0].migrations_dir;
  const files = readdirSync(join(ROOT, dir)).sort();
  const readme = readFileSync(join(ROOT, '..', 'README.md'), 'utf8');
  const section = readme.split('### Changing the schema')[1]?.split(/\n## |\n### /)[0] ?? '';
  const listed = [...section.matchAll(/^\| `(\d{4}_[a-z0-9_]+\.sql)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(listed, files);
});

// The pages: every URL root-relative, and one header and one footer copied
// verbatim into all of them.
const pages = publicFiles().filter((f) => f.endsWith('.html'));
const block = (html, tag) => html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`))?.[0];

test('every href and src on a page is absolute, root-relative or a fragment', () => {
  // Pages are served at any depth (404.html above all), so a relative URL
  // breaks: the depth trap #7 and #10 hit on the sailing site.
  for (const page of pages) {
    const html = read('public', ...page.split('/'));
    for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      assert.match(url, /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i, `public/${page}: ${url}`);
    }
  }
});

test('the lockup links back to madcowsailing.com', () => {
  for (const page of pages) {
    const header = block(read('public', ...page.split('/')), 'header');
    assert.match(header, /<a class="lockup" href="https:\/\/madcowsailing\.com\/"/, page);
  }
});

test('every page carries the same header and the same footer', () => {
  const [first, ...rest] = pages.map((p) => ({ page: p, html: read('public', ...p.split('/')) }));
  assert.ok(block(first.html, 'header') && block(first.html, 'footer'), first.page);
  for (const { page, html } of rest) {
    assert.equal(block(html, 'header'), block(first.html, 'header'), `${page}'s header differs from ${first.page}'s`);
    assert.equal(block(html, 'footer'), block(first.html, 'footer'), `${page}'s footer differs from ${first.page}'s`);
  }
});
