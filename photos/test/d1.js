// A D1 stand-in on node:sqlite, with every file in migrations/ applied in
// order, so the tests run the site's own SQL against its own schema rather
// than against hand-written answers. Not a test file: npm test runs only
// *.test.js.
//
// It implements the part of D1's API the site uses: prepare(), bind(),
// first(), all() and run(). `sqlite` is the database underneath, for a test
// to seed rows or read them back directly. `statements` lists every SQL text
// the code prepared, in order, for a test asserting what the code asked D1.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  const statement = (sql, values = []) => ({
    bind: (...bound) => statement(sql, bound),
    async first(column) {
      const row = sqlite.prepare(sql).get(...values);
      if (row === undefined) return null;
      return column === undefined ? { ...row } : row[column];
    },
    async all() {
      return { success: true, results: sqlite.prepare(sql).all(...values).map((row) => ({ ...row })) };
    },
    async run() {
      const { changes } = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes } };
    },
  });
  const statements = [];
  return {
    sqlite,
    statements,
    prepare: (sql) => {
      statements.push(sql);
      return statement(sql);
    },
  };
}

export function seedCodes(db, ...codes) {
  const insert = db.sqlite.prepare('INSERT INTO invite_codes (generation, code, created_at) VALUES (?, ?, ?)');
  codes.forEach((code, i) => insert.run(i + 1, code, 1_790_000_000 + i));
}
