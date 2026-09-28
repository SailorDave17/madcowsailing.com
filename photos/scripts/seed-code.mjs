#!/usr/bin/env node
/**
 * Seed a database's first invite code, once (#150).
 *
 *   node scripts/seed-code.mjs --local               wrangler pages dev's stand-in
 *   node scripts/seed-code.mjs --env preview         madcowphotos-preview
 *   node scripts/seed-code.mjs --env production      madcowphotos
 *
 * Run from photos/, after migration 0002 is applied to that database. The
 * remote forms need the D1 token in photos/.env (README, The photo site).
 *
 * It makes a code with lib/invite.js, the generator the tests hold, and
 * inserts it as generation 1 only if the database holds no code yet, so a
 * second run changes nothing. Then it reads the current code back and prints
 * the invite link: the one place a code is shown until the admin page (#152)
 * shows it and replaces this script with "Create code".
 *
 * A code never goes in git, a file or a log. It reaches wrangler as an
 * argument, with no shell in between, and is printed once, here, for the
 * person who ran this.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newCode } from '../lib/invite.js';

const PHOTOS = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = {
  local: { database: 'madcowphotos-preview', flags: ['--local'], site: 'http://localhost:8788' },
  preview: { database: 'madcowphotos-preview', flags: ['--remote', '--env', 'preview'], site: 'https://develop.madcowphotos.pages.dev' },
  production: { database: 'madcowphotos', flags: ['--remote', '--env', 'production'], site: 'https://photos.madcowsailing.com' },
};

function target(argv) {
  if (argv.length === 1 && argv[0] === '--local') return TARGETS.local;
  if (argv.length === 2 && argv[0] === '--env' && ['preview', 'production'].includes(argv[1])) return TARGETS[argv[1]];
  console.error('Usage: node scripts/seed-code.mjs --local | --env preview | --env production');
  process.exit(2);
}

// wrangler's own entry point, run by this node: no npx, and no shell to
// re-quote the SQL on Windows.
const require = createRequire(import.meta.url);
const WRANGLER = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

function d1(where, sql) {
  const run = spawnSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', where.database, ...where.flags, '--json', '--command', sql],
    { cwd: PHOTOS, encoding: 'utf8' },
  );
  if (run.status !== 0) {
    // wrangler's error output names the database and the failure, not the SQL.
    process.stderr.write(run.stderr || run.stdout);
    process.exit(1);
  }
  return JSON.parse(run.stdout)[0].results;
}

const where = target(process.argv.slice(2));
const code = newCode();
const created = Math.floor(Date.now() / 1000);

d1(where,
  `INSERT INTO invite_codes (generation, code, created_at) ` +
  `SELECT 1, '${code}', ${created} WHERE NOT EXISTS (SELECT 1 FROM invite_codes)`);
const [current] = d1(where, 'SELECT generation, code FROM invite_codes ORDER BY generation DESC LIMIT 1');

if (!current) {
  console.error(`No code in ${where.database} after the insert. Is migration 0002 applied there?`);
  process.exit(1);
}
console.log(current.code === code
  ? `Seeded ${where.database} with generation 1.`
  : `${where.database} already had a code (generation ${current.generation}); left it as it was.`);
console.log(`Invite link: ${where.site}/share/#code=${current.code}`);
