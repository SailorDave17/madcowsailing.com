/**
 * GET /api/health: proves the server code runs and that both bindings answer.
 *
 * 200 when the database and the bucket both answer, 503 when either does not.
 * The body names the environment (SITE_ENV, set per environment in
 * wrangler.jsonc) and the newest migration applied to the database this
 * deployment is bound to, so one call shows which storage a deployment reads
 * and whether its schema is current. It is a read: a public GET never writes
 * to D1 (CLAUDE.md, The photo site, item 4). It reads one R2 object header,
 * one R2 Class B operation, and never lists the bucket, which would be Class A.
 *
 * Nothing secret is in the body: binding names, database IDs and bucket names
 * are in the public repo already, and none of them is printed here anyway.
 */

// The object this looks up. Nothing is stored under it: head() answering null
// is the success case, since it shows the bucket was reached.
export const STORAGE_PROBE_KEY = '.health-probe';

export async function onRequestGet({ env }) {
  const database = await probeDatabase(env.DB);
  const storage = await probeStorage(env.MEDIA);
  const ok = database.reachable && storage.reachable;
  return Response.json(
    { ok, environment: env.SITE_ENV ?? null, database, storage },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function probeDatabase(db) {
  if (!db) return { reachable: false, migration: null };
  try {
    await db.prepare('SELECT 1').first();
  } catch (err) {
    console.error('health: database did not answer:', err instanceof Error ? err.message : String(err));
    return { reachable: false, migration: null };
  }
  // Wrangler records every migration it applies in d1_migrations. The table
  // exists only once one has been applied, so a failure here, after SELECT 1
  // has answered, means "none applied yet", not "unreachable".
  let migration = null;
  try {
    const row = await db.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first();
    migration = row ? row.name : null;
  } catch {
    migration = null;
  }
  return { reachable: true, migration };
}

async function probeStorage(bucket) {
  if (!bucket) return { reachable: false };
  try {
    await bucket.head(STORAGE_PROBE_KEY);
    return { reachable: true };
  } catch (err) {
    console.error('health: bucket did not answer:', err instanceof Error ? err.message : String(err));
    return { reachable: false };
  }
}
