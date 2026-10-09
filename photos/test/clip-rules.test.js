// Migration 0016 (#198, criterion 7): the ten triggers that hold a clip's row
// in photos to what the clip routes write (lib/clips.js). Each rule is
// refused on its insert side and its update side, and through REPLACE where
// 0016 guards an id; each refusal by its own words, a trigger's and never a
// CHECK's "constraint failed", and each beside a control that is taken. Run
// against a real SQLite holding the real migrations (test/d1.js), and, for the
// migration's additivity, against the schema before it with rows in every
// state. The insert-side shapes sit in test/upload.test.js's table test too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { d1 } from './d1.js';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const T0 = 1_790_000_000;
const BATCH = '0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b';

// Each rule's words, as 0016 raises them.
const SAYS = {
  type: 'a clip is video/mp4 or video/quicktime',
  checked: 'a clip outside uploading names its type and a length over 0',
  upload: 'a clip names an upload while uploading and at no other time',
  state: 'a clip never goes back to uploading, and leaves it only for pending',
  kind: 'a row keeps its kind',
};

// The ten, as 0016 names them, in sqlite_master's order.
const TRIGGERS = [
  'photos_clip_checked_on_insert', 'photos_clip_checked_on_update', 'photos_clip_state_on_update',
  'photos_clip_type_on_insert', 'photos_clip_type_on_update', 'photos_clip_upload_on_insert',
  'photos_clip_upload_on_update', 'photos_id_kept_on_replace', 'photos_id_kept_on_update', 'photos_kind_fixed',
];

// A parent's photo as the upload route leaves it (#154), waiting.
const PHOTO = {
  kind: 'photo', state: 'pending', batch: BATCH, sender: 'parent', code_generation: 2, session_issued: T0 - 60,
  captured_at: T0 - 3600, sent_at: T0, width: 2560, height: 1920, grid_width: 480, grid_height: 360,
  screen_width: 1600, screen_height: 1200, bytes: 875_000,
};

// A clip as insertClip leaves it: uploading, naming its upload, nothing about
// it checked yet.
const UPLOADING = {
  kind: 'clip', state: 'uploading', batch: BATCH, sender: 'parent', code_generation: 2, session_issued: T0 - 60,
  sent_at: T0, upload_id: 'upload-a',
};

// What the server's check read from a clip, and finishClip's write of it.
const READ = { content_type: 'video/mp4', duration_ms: 30_000, width: 1920, height: 1080, captured_at: T0 - 3600, bytes: 5_000_000 };
const FINISHED = { state: 'pending', ...READ, upload_id: null };

// The same clip once checked, waiting, and then approved and hidden as a photo is.
const PENDING = { ...UPLOADING, ...FINISHED };
const APPROVED = { ...PENDING, state: 'approved', approved_at: T0 + 1 };
const HIDDEN = { ...APPROVED, state: 'hidden', hidden_at: T0 + 2 };

const EVENT = "INSERT INTO albums (address, team, title, kind, held_on, created_at) VALUES ('2026-10-04-fall-regatta', 'hoover-jrt', 'Fall Regatta', 'regatta', '2026-10-04', 1790000000)";

/** Every migration, and an event to send to: never a Not sure album, which refuses an approved row (#228). */
function database() {
  const { sqlite } = d1();
  sqlite.exec(EVENT);
  return sqlite;
}

let keys = 0;

/**
 * Write `row` into the event with `verb` (INSERT, REPLACE, INSERT OR
 * IGNORE...), under a media key of its own, and `tail` after the values (an
 * ON CONFLICT clause). Returns the row's id.
 */
function write(sqlite, row, verb = 'INSERT', tail = '') {
  const full = {
    album_id: sqlite.prepare('SELECT id FROM albums WHERE holding = 0 ORDER BY id').get().id,
    media_key: (++keys).toString(16).padStart(32, '0'),
    ...row,
  };
  const names = Object.keys(full);
  const sql = `${verb} INTO photos (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})${tail}`;
  return Number(sqlite.prepare(sql).run(...Object.values(full)).lastInsertRowid);
}

/** One UPDATE of row `id`, setting `changes`. */
function change(sqlite, id, changes) {
  const names = Object.keys(changes);
  sqlite.prepare(`UPDATE photos SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(changes), id);
}

const row = (sqlite, id) => {
  const found = sqlite.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  return found && { ...found };
};
const rows = (sqlite) => sqlite.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r }));
const pick = (found, names) => Object.fromEntries(names.map((name) => [name, found[name]]));

// ---- The migration itself ----------------------------------------------------

test('#198 criterion 7: 0016 adds its ten triggers and nothing else, and every object and row stored before it stays as it was', () => {
  // The schema before 0016, holding a photo and a clip in every state, as a
  // database does when 0016 reaches it.
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).sort().filter((f) => f < '0016')) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  sqlite.exec(EVENT);
  sqlite.prepare("INSERT INTO accounts (email, name, role, requested_at) VALUES ('sender@example.org', 'Sender', 'parent', ?)").run(T0);
  const seeded = {
    'a pending photo': PHOTO,
    'an approved photo': { ...PHOTO, state: 'approved', approved_at: T0 + 1 },
    'a hidden photo, with its note': { ...PHOTO, state: 'hidden', approved_at: T0 + 1, hidden_at: T0 + 2, hidden_note: 'please take this down' },
    'a photo hidden while it waited (#225)': { ...PHOTO, state: 'hidden', approved_at: 0, hidden_at: T0 + 2 },
    'an account\'s photo (#223)': { ...PHOTO, account_id: 1, code_generation: 0, session_issued: 0 },
    'an uploading clip': UPLOADING,
    'a pending clip': PENDING,
    'an approved clip': APPROVED,
    'a hidden clip': HIDDEN,
    // A row no route writes and 0005 allows, which 0016 would refuse: a
    // trigger reads writes, not stored rows, so 0016 applies over it.
    'a pending clip with no type or length, written by hand': { ...PENDING, content_type: null, duration_ms: null },
  };
  const ids = Object.fromEntries(Object.entries(seeded).map(([name, seed]) => [name, write(sqlite, seed)]));

  // Every row of every table (sqlite_sequence's AUTOINCREMENT counters
  // included), every sqlite_master entry, and the objects the read-back
  // counts, sqlite_% aside.
  const tables = () => sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
  const everyRow = () => Object.fromEntries(tables().map((table) => [
    table, sqlite.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify({ ...r })).sort(),
  ]));
  const schema = () => sqlite.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all().map((r) => ({ ...r }));
  const objects = () => sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n;
  const before = { rows: everyRow(), schema: schema(), objects: objects() };
  assert.equal(before.rows.photos.length, Object.keys(seeded).length);

  sqlite.exec(readFileSync(new URL('0016_clip_rules.sql', MIGRATIONS), 'utf8'));
  const after = { rows: everyRow(), schema: schema(), objects: objects() };

  assert.deepEqual(after.rows, before.rows);
  const added = after.schema.filter((entry) => !before.schema.some((old) => old.name === entry.name));
  assert.deepEqual(added.map((entry) => `${entry.type} ${entry.name} on ${entry.tbl_name}`), TRIGGERS.map((name) => `trigger ${name} on photos`));
  assert.deepEqual(after.schema.filter((entry) => before.schema.some((old) => old.name === entry.name)), before.schema);
  // 57 objects at 0015 and 67 after: the figures the read-back on preview
  // and production compares with, after applying it.
  assert.deepEqual([before.objects, after.objects], [57, 67]);

  // The row written by hand stays, and its next write meets the rules: it is
  // not approved until it names its type and length, and then it is.
  const byHand = ids['a pending clip with no type or length, written by hand'];
  assert.throws(() => change(sqlite, byHand, { state: 'approved', approved_at: T0 + 5 }), { message: SAYS.checked });
  change(sqlite, byHand, { content_type: 'video/mp4', duration_ms: 1000 });
  change(sqlite, byHand, { state: 'approved', approved_at: T0 + 5 });
  assert.equal(row(sqlite, byHand).state, 'approved');
});

// ---- Each rule, on insert and on update ---------------------------------------

test('#198 criterion 7: a clip\'s type is video/mp4 or video/quicktime, written in or changed to, uploading or not', () => {
  const sqlite = database();
  for (const [seed, type] of [[PENDING, 'video/webm'], [PENDING, 'VIDEO/MP4'], [PENDING, ''], [APPROVED, 'image/jpeg'], [UPLOADING, 'video/x-matroska']]) {
    assert.throws(() => write(sqlite, { ...seed, content_type: type }), { message: SAYS.type }, `${seed.state}, ${type}`);
  }
  // The controls: each of the two, and none yet while uploading.
  for (const [seed, type] of [[PENDING, 'video/mp4'], [PENDING, 'video/quicktime'], [UPLOADING, 'video/quicktime'], [UPLOADING, null]]) {
    write(sqlite, { ...seed, content_type: type });
  }
  const pending = write(sqlite, PENDING);
  const uploading = write(sqlite, UPLOADING);
  assert.throws(() => change(sqlite, pending, { content_type: 'video/webm' }), { message: SAYS.type });
  assert.throws(() => change(sqlite, uploading, { content_type: 'audio/mp4' }), { message: SAYS.type });
  assert.deepEqual([row(sqlite, pending).content_type, row(sqlite, uploading).content_type], ['video/mp4', null]);
  change(sqlite, pending, { content_type: 'video/quicktime' });
  change(sqlite, uploading, { content_type: 'video/mp4' });
  assert.deepEqual([row(sqlite, pending).content_type, row(sqlite, uploading).content_type], ['video/quicktime', 'video/mp4']);
});

test('#198 criterion 7: a clip outside uploading names its type and a length over 0, written so or changed so', () => {
  const sqlite = database();
  const missing = {
    'no type': { content_type: null }, 'no length': { duration_ms: null }, 'a length of 0': { duration_ms: 0 }, 'a length under 0': { duration_ms: -1 },
  };
  for (const seed of [PENDING, APPROVED, HIDDEN]) {
    for (const [what, gap] of Object.entries(missing)) {
      assert.throws(() => write(sqlite, { ...seed, ...gap }), { message: SAYS.checked }, `${seed.state}, ${what}`);
    }
    // The control: a length of 1 ms, the least the rule takes.
    write(sqlite, { ...seed, duration_ms: 1 });
  }
  // While uploading it names neither yet: insertClip's row.
  write(sqlite, UPLOADING);

  // A checked clip cannot lose either, and an uploading one cannot leave
  // uploading without both: finishClip's write missing one.
  const pending = write(sqlite, PENDING);
  for (const [what, gap] of Object.entries(missing)) {
    assert.throws(() => change(sqlite, pending, gap), { message: SAYS.checked }, what);
  }
  const uploading = write(sqlite, UPLOADING);
  for (const [what, gap] of Object.entries(missing)) {
    assert.throws(() => change(sqlite, uploading, { ...FINISHED, ...gap }), { message: SAYS.checked }, `finishing with ${what}`);
  }
  assert.equal(row(sqlite, uploading).state, 'uploading');
  // The controls. finishClip's whole write is taken, and fills what 0005
  // leaves empty while a clip uploads (criterion 7); a new length is taken.
  change(sqlite, uploading, FINISHED);
  assert.deepEqual(pick(row(sqlite, uploading), Object.keys(FINISHED)), FINISHED);
  change(sqlite, pending, { duration_ms: 1 });
  assert.equal(row(sqlite, pending).duration_ms, 1);
});

test('#198 criterion 7: a clip names its upload while uploading and none outside it, written so or changed so', () => {
  const sqlite = database();
  assert.throws(() => write(sqlite, { ...UPLOADING, upload_id: null }), { message: SAYS.upload });
  for (const seed of [PENDING, APPROVED, HIDDEN]) {
    assert.throws(() => write(sqlite, { ...seed, upload_id: 'upload-b' }), { message: SAYS.upload }, seed.state);
    write(sqlite, seed);
  }
  write(sqlite, UPLOADING);

  const uploading = write(sqlite, UPLOADING);
  assert.throws(() => change(sqlite, uploading, { upload_id: null }), { message: SAYS.upload });
  // finishClip's write without its upload_id = NULL.
  assert.throws(() => change(sqlite, uploading, { state: 'pending', ...READ }), { message: SAYS.upload });
  assert.equal(row(sqlite, uploading).state, 'uploading');
  const pending = write(sqlite, PENDING);
  assert.throws(() => change(sqlite, pending, { upload_id: 'upload-c' }), { message: SAYS.upload });
  // The controls: a new upload while uploading, then finishClip's whole write.
  change(sqlite, uploading, { upload_id: 'upload-d' });
  assert.equal(row(sqlite, uploading).upload_id, 'upload-d');
  change(sqlite, uploading, FINISHED);
  assert.deepEqual(pick(row(sqlite, uploading), ['state', 'upload_id']), { state: 'pending', upload_id: null });
});

test('#198 criterion 7: a clip leaves uploading only for pending, and never goes back to it', () => {
  const sqlite = database();
  // Out of uploading into approved or hidden, unchecked: finishClip's write
  // with another state. Each is otherwise a whole row of its state, so only
  // the move itself is refused.
  for (const to of [{ state: 'approved', approved_at: T0 + 1 }, { state: 'hidden', approved_at: T0 + 1, hidden_at: T0 + 2 }]) {
    const id = write(sqlite, UPLOADING);
    assert.throws(() => change(sqlite, id, { ...FINISHED, ...to }), { message: SAYS.state }, to.state);
    assert.equal(row(sqlite, id).state, 'uploading', to.state);
  }
  // Back into uploading, naming an upload again, from every state after it.
  for (const from of [PENDING, APPROVED, HIDDEN]) {
    const id = write(sqlite, from);
    assert.throws(() => change(sqlite, id, { state: 'uploading', upload_id: 'upload-again' }), { message: SAYS.state }, from.state);
    assert.equal(row(sqlite, id).state, from.state, from.state);
  }
  // The controls: a write keeping an uploading clip uploading, finishClip's
  // move to pending, then approval and a takedown, as a photo's.
  const id = write(sqlite, UPLOADING);
  change(sqlite, id, { state: 'uploading', upload_id: 'upload-b' });
  change(sqlite, id, FINISHED);
  change(sqlite, id, { state: 'approved', approved_at: T0 + 1 });
  change(sqlite, id, { state: 'hidden', hidden_at: T0 + 2 });
  assert.equal(row(sqlite, id).state, 'hidden');
});

test('#198 criterion 7: a row keeps its kind, a photo\'s and a clip\'s, whatever else the write makes true', () => {
  const sqlite = database();
  const photo = write(sqlite, PHOTO);
  const clip = write(sqlite, PENDING);
  // Each write is otherwise a whole row of the other kind, which 0005's CHECKs
  // take, so only the kind itself is refused.
  assert.throws(() => change(sqlite, photo, { kind: 'clip', content_type: 'video/mp4', duration_ms: 30_000 }), { message: SAYS.kind });
  assert.throws(() => change(sqlite, clip, {
    kind: 'photo', content_type: null, duration_ms: null, grid_width: 480, grid_height: 270, screen_width: 1600, screen_height: 900,
  }), { message: SAYS.kind });
  assert.deepEqual([row(sqlite, photo).kind, row(sqlite, clip).kind], ['photo', 'clip']);
  // The controls: a write naming each row's own kind, beside another change.
  change(sqlite, photo, { kind: 'photo', caption: 'Rounding the windward mark' });
  change(sqlite, clip, { kind: 'clip', caption: 'The start' });
  assert.deepEqual([row(sqlite, photo).caption, row(sqlite, clip).caption], ['Rounding the windward mark', 'The start']);
});

// ---- REPLACE, which fires no update trigger -----------------------------------

test('#198 criterion 7: REPLACE INTO naming a row\'s id keeps that id\'s kind, and a clip\'s state moving as an update may', () => {
  const sqlite = database();
  assert.equal(sqlite.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0, 'the case the REPLACE triggers exist for');
  const photo = write(sqlite, PHOTO);
  const uploading = write(sqlite, UPLOADING);
  const pending = write(sqlite, PENDING);
  const approved = write(sqlite, APPROVED);
  const before = rows(sqlite);
  const refused = {
    'a photo\'s id taken by a clip': ['REPLACE', { ...PENDING, id: photo }, SAYS.kind],
    'a clip\'s id taken by a photo': ['INSERT OR REPLACE', { ...PHOTO, id: approved }, SAYS.kind],
    'a clip\'s id taken by a photo, named as its rowid': ['REPLACE', { ...PHOTO, rowid: uploading }, SAYS.kind],
    'an approved clip back to uploading': ['REPLACE', { ...UPLOADING, id: approved }, SAYS.state],
    'a pending clip back to uploading': ['INSERT OR REPLACE', { ...UPLOADING, id: pending }, SAYS.state],
    'an uploading clip approved unchecked': ['REPLACE', { ...APPROVED, id: uploading }, SAYS.state],
    'an uploading clip hidden unchecked': ['REPLACE', { ...HIDDEN, id: uploading }, SAYS.state],
    // Refused, not skipped: a BEFORE INSERT trigger runs before the conflict clause.
    'a clip\'s id named by INSERT OR IGNORE': ['INSERT OR IGNORE', { ...PHOTO, id: approved }, SAYS.kind],
  };
  for (const [name, [verb, written, message]] of Object.entries(refused)) {
    assert.throws(() => write(sqlite, written, verb), { message }, name);
  }
  assert.throws(() => write(sqlite, { ...PHOTO, id: approved }, 'INSERT', ' ON CONFLICT (id) DO NOTHING'), { message: SAYS.kind }, 'an upsert');
  assert.deepEqual(rows(sqlite), before);

  // The controls: an uploading clip replaced by itself checked, a pending clip
  // by itself approved, and a photo by a photo, which is no clip's concern.
  write(sqlite, { ...PENDING, id: uploading }, 'REPLACE');
  write(sqlite, { ...APPROVED, id: pending }, 'REPLACE');
  write(sqlite, { ...PHOTO, caption: 'Sent again', id: photo }, 'REPLACE');
  assert.deepEqual([uploading, pending, photo].map((id) => pick(row(sqlite, id), ['kind', 'state'])), [
    { kind: 'clip', state: 'pending' }, { kind: 'clip', state: 'approved' }, { kind: 'photo', state: 'pending' },
  ]);
  assert.equal(row(sqlite, photo).caption, 'Sent again');

  // The limit 0016 states: a REPLACE clashing on media_key alone takes the
  // row it names away and writes a new row under a new id, so no id changes
  // kind or state, and nothing refuses it.
  const key = row(sqlite, approved).media_key;
  const newId = write(sqlite, { ...PHOTO, media_key: key }, 'REPLACE');
  assert.equal(row(sqlite, approved), undefined);
  assert.ok(newId > approved);
});

test('#198 criterion 7: UPDATE OR REPLACE moving a row onto another\'s id is held the same, by id, rowid, oid or _rowid_', () => {
  // UPDATE OF id does not fire on SET rowid (measured on node:sqlite 3.53),
  // which is why the trigger for this names no column.
  const sqlite = database();
  const photo = write(sqlite, PHOTO);
  const uploading = write(sqlite, UPLOADING);
  const pending = write(sqlite, PENDING);
  const approved = write(sqlite, APPROVED);
  const move = (column, from, onto) => sqlite.prepare(`UPDATE OR REPLACE photos SET ${column} = ? WHERE id = ?`).run(onto, from);
  const before = rows(sqlite);
  const refused = {
    'a photo onto a clip\'s id': ['id', photo, pending, SAYS.kind],
    'a clip onto a photo\'s id, by rowid': ['rowid', pending, photo, SAYS.kind],
    'an uploading clip onto an approved one\'s id, by oid': ['oid', uploading, approved, SAYS.state],
    'an approved clip onto an uploading one\'s id, by _rowid_': ['_rowid_', approved, uploading, SAYS.state],
  };
  for (const [name, [column, from, onto, message]] of Object.entries(refused)) {
    assert.throws(() => move(column, from, onto), { message }, name);
  }
  assert.deepEqual(rows(sqlite), before);

  // The controls: a pending clip onto another pending clip's id, which takes
  // the other away as REPLACE does, and a clip onto a free id by rowid.
  const other = write(sqlite, PENDING);
  const otherKey = row(sqlite, other).media_key;
  move('id', other, pending);
  assert.equal(row(sqlite, other), undefined);
  assert.equal(row(sqlite, pending).media_key, otherKey);
  move('rowid', approved, 999);
  assert.equal(row(sqlite, 999).state, 'approved');
});

test('a row someone gave the id -1 by hand is never read as the row an upload names', () => {
  // NEW.id is -1 in a BEFORE INSERT that names no id (measured), so 0016's
  // insert side reads only an id over 0. Without that, every clip sent after
  // this photo would be refused as a change of its kind.
  const sqlite = database();
  write(sqlite, { ...PHOTO, id: -1 });
  const clip = write(sqlite, UPLOADING);
  const photo = write(sqlite, PHOTO);
  assert.deepEqual([clip, photo].map((id) => row(sqlite, id).kind), ['clip', 'photo']);
});

// ---- The clips the other tests write ------------------------------------------

test('the clip rows the admin-page, public, queue and removals tests write directly are rows 0016 takes', () => {
  // Their seedRow and seedClip helpers write a checked clip (video/mp4, 30
  // seconds, no upload id) straight into pending, approved or hidden: a plain
  // insert, which 0016 takes in any state that names what the state needs.
  const sqlite = database();
  const album = sqlite.prepare('SELECT id FROM albums WHERE holding = 0').get().id;
  const insert = sqlite.prepare(
    'INSERT INTO photos (album_id, kind, state, media_key, batch, sender, code_generation, session_issued, ' +
    'captured_at, sent_at, width, height, bytes, content_type, duration_ms, approved_at, hidden_at) ' +
    "VALUES (?, 'clip', ?, ?, 'b', 'parent', 1, 1, ?, ?, 1920, 1080, 5000000, 'video/mp4', 30000, ?, ?)",
  );
  for (const [state, approvedAt, hiddenAt] of [['pending', null, null], ['approved', T0 + 1, null], ['hidden', T0 + 1, T0 + 2]]) {
    insert.run(album, state, `c${state}`.padEnd(32, '0'), T0, T0, approvedAt, hiddenAt);
  }
  assert.deepEqual(rows(sqlite).map((r) => [r.kind, r.state, r.upload_id]), [
    ['clip', 'pending', null], ['clip', 'approved', null], ['clip', 'hidden', null],
  ]);
});
