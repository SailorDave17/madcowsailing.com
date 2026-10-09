// The clip walker (#198, CLAUDE.md item 10): public/js/clip.js plans the
// edits that blank a clip's location and camera data in place (planClip, run
// by the share page before any part is sent) and checks a stored clip for
// anything left (checkClip, run by the server once the parts are joined).
// Every clip here is built byte by byte (test/mp4.js) in the shape a camera
// writes, with fictional positions and devices.
//
// Every clip that plans is held to the same promise (blanked(), below): each
// planted identity string is in the original, the control, and nowhere in the
// bytes sent; checkClip passes the bytes sent and refuses the original as
// 'kept' whenever it held anything to blank; the edits are sorted, apart,
// merged where they touch and inside what is sent; the kept media is byte for
// byte what it was and a blanked track's samples are zeros; and the parts
// reassemble to exactly the bytes sent. No read goes past the end of the file.
// Each refusal has a control that passes once the one thing is fixed. It
// holds criterion 4 (blanked in the browser), criterion 5 (checked on the
// server) and the widened criterion on creation and modification times. The
// real-device half of criterion 4 is not here: no camera's file is in the
// repo. It was read at #198 and is recorded in public/js/clip.js's header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AUDIO_FORMATS, FREE_CHECK_MAX, MOOV_MAX, PART_BYTES, VIDEO_FORMATS, checkClip, partCount, partPieces, planClip,
} from '../public/js/clip.js';
import { exif, find, jpeg, withSegments } from './jpeg.js';
import {
  GPS5_FIX, MATRIX, RECORDED, SINCE_1904, XMP_UUID, androidMp4, audioEntry, be32, be64, box, bytes, dinf, esds, frames,
  ftyp, fullBox, goproMp4, gpmf, hdlr, iphoneMov, metaTrack, mvhd, plainClip, rawTrailer, reference, stco, stsc, stsz,
  stz2, videoEntry, xmpBox,
} from './mp4.js';

// ---- How the page and the server use it ------------------------------------

/** read() over bytes in memory, as file.slice or a ranged R2 get answers, logging each [offset, length]. */
function reader(file, log = null) {
  return async (offset, length) => {
    assert.ok(offset >= 0 && length >= 0 && offset + length <= file.length, `a read past the end: ${offset} + ${length}`);
    if (log) log.push([offset, length]);
    return file.slice(offset, offset + length);
  };
}

const plan = (file) => planClip(reader(file), file.length);
const check = (file) => checkClip(reader(file), file.length);

/** The bytes sent: the file up to plan.bytes with every edit made. */
function applied(file, p) {
  const out = file.slice(0, p.bytes);
  for (const edit of p.edits) {
    if ('zeros' in edit) out.fill(0, edit.offset, edit.offset + edit.zeros);
    else out.set(edit.bytes, edit.offset);
  }
  return out;
}

const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));

/** Edits are { offset, zeros } or { offset, bytes }, sorted, apart, merged where two of a kind touch, inside [0, bytes). */
function assertEdits(p) {
  let end = 0;
  let kind = null;
  for (const edit of p.edits) {
    const keys = Object.keys(edit).sort().join();
    assert.ok(keys === 'offset,zeros' || keys === 'bytes,offset', `an edit is { offset, zeros } or { offset, bytes }, not { ${keys} }`);
    const length = 'zeros' in edit ? edit.zeros : edit.bytes.length;
    assert.ok(Number.isInteger(edit.offset) && Number.isInteger(length) && length > 0, 'an edit has a place and a length');
    assert.ok(edit.offset >= end, `edits overlap or are out of order at ${edit.offset}`);
    const k = 'zeros' in edit ? 'zeros' : 'bytes';
    assert.ok(!(edit.offset === end && k === kind), `two ${k} edits touch at ${edit.offset} and were not merged`);
    end = edit.offset + length;
    kind = k;
  }
  assert.ok(end <= p.bytes, 'an edit lies past the bytes sent');
}

/** Part n as the page makes it: each range from the file, each edit as given. */
function part(file, p, n) {
  const pieces = partPieces(p, n);
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + (piece instanceof Uint8Array ? piece.length : piece.to - piece.from), 0));
  let at = 0;
  for (const piece of pieces) {
    const chunk = piece instanceof Uint8Array ? piece : file.subarray(piece.from, piece.to);
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function assertParts(file, p, sent) {
  for (let n = 1; n <= partCount(p.bytes); n++) {
    const from = (n - 1) * PART_BYTES;
    assert.ok(same(part(file, p, n), sent.subarray(from, Math.min(from + PART_BYTES, p.bytes))), `part ${n} is not the bytes sent`);
  }
}

/**
 * Hold a planned clip to the walker's promise (the header above). `original`
 * is what checkClip says of the file as it came: 'kept' when it holds
 * anything to blank, null when it passes as it is.
 */
async function blanked({ file, media = [], planted = {} }, { original = 'kept' } = {}) {
  const p = await plan(file);
  assert.ok(!p.error, `planClip refused it: ${p.error}`);
  assertEdits(p);
  const sent = applied(file, p);
  for (const [name, needle] of Object.entries(planted)) {
    assert.notEqual(find(file, needle), -1, `the original holds no ${name}, so its absence would prove nothing`);
    assert.equal(find(sent, needle), -1, `the ${name} survives in what is sent`);
  }
  assert.deepEqual(await check(sent), { contentType: p.contentType, durationMs: p.durationMs, width: p.width, height: p.height },
    'checkClip refused the bytes planClip planned');
  const before = await check(file);
  if (original === null) assert.equal(before.error, undefined, `checkClip refused a clip with nothing to blank: ${before.error}`);
  else assert.deepEqual(before, { error: original }, 'checkClip on the original');
  for (const { handler, ranges } of media) {
    const kept = handler === 'vide' || handler === 'soun';
    for (const [from, to] of ranges) {
      if (kept) assert.ok(same(sent.subarray(from, to), file.subarray(from, to)), `a ${handler} sample at ${from} changed`);
      else assert.ok(sent.subarray(from, to).every((b) => b === 0), `a ${handler} sample at ${from} was not zeroed`);
    }
  }
  assertParts(file, p, sent);
  return { p, sent };
}

/** planClip refuses `file` with `error`, and so does checkClip (with `checked`, where its answer differs). */
async function refused(file, error, checked = error) {
  assert.deepEqual(await plan(file), { error }, 'planClip');
  assert.deepEqual(await check(file), { error: checked }, 'checkClip');
}

/** A control: `file` plans, and checkClip passes what it sends. */
async function passes(file) {
  const p = await plan(file);
  assert.ok(!p.error, `planClip refused the control: ${p.error}`);
  assertEdits(p);
  const checked = await check(applied(file, p));
  assert.equal(checked.error, undefined, `checkClip refused the control's bytes: ${checked.error}`);
  return p;
}

/** `file` with the first box type `from` at or after `start` retyped `to`. */
function retyped(file, from, to, start = 0) {
  const at = find(file.subarray(start), from) + start;
  assert.ok(at >= start, `no ${from} to retype`);
  const out = file.slice();
  out.set(bytes(to), at);
  return out;
}

const ZERO = [0, 0];

// ---- The module ------------------------------------------------------------

test('the sizes and lists are the spec\'s, and the lists cannot be changed (#198)', () => {
  assert.equal(PART_BYTES, 25 * 1024 * 1024);
  assert.equal(MOOV_MAX, 16 * 1024 * 1024);
  assert.equal(FREE_CHECK_MAX, 64 * 1024 * 1024);
  assert.deepEqual([partCount(1), partCount(PART_BYTES), partCount(PART_BYTES + 1), partCount(4 * 1024 ** 3)], [1, 1, 2, 164]);
  assert.deepEqual(VIDEO_FORMATS, ['avc1', 'avc2', 'avc3', 'avc4', 'hvc1', 'hev1', 'dvh1', 'dvhe', 'dva1', 'dvav', 'av01', 'vp08',
    'vp09', 'mp4v', 'apcn', 'apch', 'apcs', 'apco', 'ap4h', 'ap4x']);
  assert.deepEqual(AUDIO_FORMATS, ['mp4a', 'ac-3', 'ec-3', 'ac-4', 'Opus', 'fLaC', 'alac', 'apac', 'lpcm', 'sowt', 'twos', 'in24',
    'in32', 'fl32', 'fl64', 'ipcm', 'fpcm', 'samr', 'sawb', '.mp3', 'mp3 ']);
  assert.ok(Object.isFrozen(VIDEO_FORMATS) && Object.isFrozen(AUDIO_FORMATS));
});

test('in a browser the module also sets window.MadcowClip, frozen, with what the share page calls (#198)', async () => {
  globalThis.window = {};
  try {
    // A query string makes a second copy of the module, loaded with a window.
    await import('../public/js/clip.js?with-window');
    const api = globalThis.window.MadcowClip;
    assert.deepEqual(Object.keys(api).sort(), ['PART_BYTES', 'partCount', 'partPieces', 'planClip']);
    assert.ok(Object.isFrozen(api));
    assert.equal(api.PART_BYTES, PART_BYTES);
  } finally {
    delete globalThis.window;
  }
  // Without one (Workers, Node) it sets nothing.
  assert.equal(globalThis.MadcowClip, undefined);
});

test('the module imports nothing and names no DOM, Node or Workers API, so all three runtimes load it (#198)', () => {
  const source = readFileSync(new URL('../public/js/clip.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const name of [/^\s*import\b/m, /\brequire\(/, /\bimport\(/, /\bBuffer\b/, /\bprocess\b/, /\bdocument\b/, /\bfetch\(/,
    /\bnavigator\b/, /\bTextDecoder\b/, /\bTextEncoder\b/]) {
    assert.doesNotMatch(source, name);
  }
});

// ---- Clips shaped like three cameras' -------------------------------------

test('an iPhone-shaped MOV loses its location, make, model, software, lens, timed metadata, names and times, and keeps its media (#198)', async () => {
  const { p, sent } = await blanked(iphoneMov());
  assert.equal(p.contentType, 'video/quicktime');
  assert.equal(p.durationMs, 4500);
  // A quarter turn: the frame is coded 1920 x 1080 and shown upright.
  assert.deepEqual([p.width, p.height], [1080, 1920]);
  assert.equal(p.recordedAt, RECORDED);
  // ftyp, wide (8 bytes) and the sample descriptions playback needs are kept.
  for (const kept of ['ftyp', 'wide', 'stsd', 'hvcC', 'esds', 'tapt', 'elst', 'stco']) assert.notEqual(find(sent, kept), -1, kept);
});

test('the same MOV with version 1 (64-bit) headers loses its times too (#198)', async () => {
  const { p } = await blanked(iphoneMov({ version: 1 }));
  assert.deepEqual([p.durationMs, p.width, p.height, p.recordedAt], [4500, 1080, 1920, RECORDED]);
});

test('an Android-shaped MP4 loses its ©xyz, com.android keys, its free box\'s fill and a redacted box of type 0 (#198)', async () => {
  const { p, sent } = await blanked(androidMp4());
  assert.deepEqual([p.contentType, p.durationMs, p.width, p.height], ['video/mp4', 4500, 1920, 1080]);
  // The type-0 box became free, its size kept: the bytes after moov still
  // run free, free, mdat.
  assert.equal(find(sent, bytes(be32(8 + 27), '\0\0\0\0')), -1);
  assert.notEqual(find(sent, bytes(be32(8 + 27), 'free')), -1);
});

test('the same MP4 with version 1 headers (#198)', async () => {
  await blanked(androidMp4({ version: 1 }));
});

test('a GoPro-shaped MP4 loses its udta (firmware, lens, serial, GPMF), its timecode and GPMF tracks and their samples, and its names (#198)', async () => {
  const { p } = await blanked(goproMp4());
  assert.deepEqual([p.contentType, p.durationMs, p.width, p.height], ['video/mp4', 2002, 1920, 1080]);
  // The GPMF track's samples, and the timecode track's next to them, are one
  // zero run: adjacent runs merge (assertEdits holds that none touch).
  const fix = find(goproMp4().file, GPS5_FIX);
  assert.ok(p.edits.some((edit) => 'zeros' in edit && edit.offset < fix && fix < edit.offset + edit.zeros));
});

test('a GoPro MP4 with a 64-bit (size 1) mdat, and with version 1 headers (#198)', async () => {
  const { sent } = await blanked(goproMp4({ clip: { mdat: 'large' } }));
  assert.notEqual(find(sent, bytes(be32(1), 'mdat')), -1, 'the 64-bit mdat header is kept');
  await blanked(goproMp4({ version: 1 }));
});

test('an Android MP4 whose last mdat runs to the end of the file (size 0) is sent whole (#198)', async () => {
  const fixture = androidMp4({ clip: { mdat: 'toEnd' } });
  const { p } = await blanked(fixture);
  assert.equal(p.bytes, fixture.file.length);
});

test('a top-level uuid of XMP is blanked, its usertype with it (#198)', async () => {
  await blanked({
    ...plainClip({ clip: { top: ['ftyp', 'moov', xmpBox(), 'mdat'] } }),
    planted: { 'XMP usertype': XMP_UUID, 'XMP position': 'GPSLatitude="12,20.736N"', 'XMP model': 'Fiction 7a', uuid: 'uuid' },
  });
});

test('a top-level free holding a JPEG thumbnail with EXIF is zeroed (#198)', async () => {
  const thumbnail = withSegments(jpeg({ width: 16, height: 16 }), exif());
  await blanked({
    ...plainClip({ clip: { top: ['ftyp', box('free', thumbnail), 'moov', 'mdat'] } }),
    planted: { 'JPEG start': [0xff, 0xd8, 0xff, 0xe1], EXIF: 'Exif', 'EXIF make': 'FictionCam' },
  });
});

test('a raw trailer after the last box is not sent, and nothing moves (#198)', async () => {
  const trailer = rawTrailer();
  const planted = { 'trailer serial': 'IXS9F1CT10N0', 'trailer magic': '8db42d694ccc418790edff439fe026bf',
    'trailer fix': new Uint8Array(new Float64Array([12.3456]).buffer) };
  const plain = plainClip({ clip: { trailer } });
  // Nothing else in it to blank: checkClip says what is wrong with it as it came.
  const { p } = await blanked({ ...plain, planted }, { original: 'trailing' });
  assert.equal(p.bytes, plain.file.length - trailer.length);
  assert.deepEqual(p.edits, []);
  // With things to blank as well, 'kept' is what checkClip says first.
  const iphone = iphoneMov({ clip: { trailer } });
  const { p: q } = await blanked({ ...iphone, planted: { ...iphone.planted, ...planted } });
  assert.equal(q.bytes, iphone.file.length - trailer.length);
});

test('zeros after the last box are padding: not sent (#198)', async () => {
  const plain = plainClip({ clip: { trailer: new Uint8Array(24) } });
  const { p } = await blanked(plain, { original: 'trailing' });
  assert.equal(p.bytes, plain.file.length - 24);
});

test('a kept box may end with 1 to 7 bytes over, as a QuickTime list ends with a 32-bit zero; any not zero are zeroed (#198)', async () => {
  // Zero already: nothing to edit, and the clip passes as it is.
  const zeros = plainClip({ clip: { moovRemainder: bytes(be32(0)) }, video: { remainder: bytes(be32(0)) } });
  const { p } = await blanked(zeros, { original: null });
  assert.deepEqual(p.edits, []);
  // Not zero: zeroed, and checkClip refuses the original.
  await blanked({
    ...plainClip({ clip: { moovRemainder: bytes('Fiction') }, video: { remainder: bytes('Zq7') } }),
    planted: { 'moov remainder': 'Fiction', 'trak remainder': 'Zq7' },
  });
});

test('a blanked track\'s samples are found through co64 and stz2 (4, 8 and 16 bits) as through stco and stsz (#198)', async () => {
  for (const spec of [{ co64: true }, { stz2: 8 }, { stz2: 16, co64: true }, { perChunk: 2, uniform: true }]) {
    const fixture = goproMp4({ meta: spec });
    await blanked(fixture);
  }
  // Four-bit sizes need samples under 16 bytes.
  const tiny = [bytes('FictionCam 1'), bytes('FictionCam 2'), bytes('GPS 12.3456')];
  await blanked({ ...plainClip({ tracks: [metaTrack(tiny, { stz2: 4, perChunk: 2 })] }), planted: { 'sample text': 'FictionCam', fix: '12.3456' } });
});

test('two blanked tracks naming the same bytes make one zero run (#198)', async () => {
  let first = [];
  const shared = [bytes('+12.3456+065.4321/ shared')];
  const a = metaTrack(shared, { tables: (chunks) => { first = chunks; return [stsc([1, 1]), stsz([shared[0].length]), stco(chunks)]; } });
  // b holds no sample of its own: its one chunk is a's.
  const b = metaTrack([], { tkhd: { id: 10, time: ZERO }, tables: () => [stsc([1, 1]), stsz([shared[0].length]), stco(first)] });
  const { p } = await blanked({ ...plainClip({ tracks: [a, b] }), planted: { position: '+12.3456+065.4321/' } });
  const runs = p.edits.filter((edit) => 'zeros' in edit && edit.offset >= first[0] - 1 && edit.offset <= first[0] + 30);
  assert.equal(runs.length, 1);
});

test('each field planClip zeroes inside a kept box makes checkClip refuse when it is not zero (#198)', async () => {
  const { sent } = await blanked(iphoneMov());
  assert.equal((await check(sent)).error, undefined, 'the control: the bytes sent pass');
  // Where each field sits, from its box's type (box start + 4).
  const field = {
    'mvhd creation time': ['mvhd', 8], 'mvhd modification time': ['mvhd', 12],
    'tkhd creation time': ['tkhd', 8], 'tkhd modification time': ['tkhd', 12],
    'mdhd creation time': ['mdhd', 8], 'mdhd modification time': ['mdhd', 12],
    'hdlr manufacturer': ['hdlr', 16], 'hdlr flags': ['hdlr', 20], 'hdlr name': ['hdlr', 28],
    'video vendor': ['hvc1', 16], 'compressor name': ['hvc1', 46], 'audio vendor': ['mp4a', 16],
  };
  for (const [name, [type, offset]] of Object.entries(field)) {
    const at = find(sent, type) + offset;
    const poked = sent.slice();
    poked[at] ^= 0x5a;
    assert.deepEqual(await check(poked), { error: 'kept' }, name);
  }
});

test('an audio entry\'s version and revision are never zeroed, only its vendor; stsd and codec setup stay whole (#198)', async () => {
  const entry = audioEntry('lpcm', { vendor: 'appl', version: 1, extra: [be32(1), be32(4), be32(8), be32(2), esds()] });
  const fixture = plainClip({ sound: { entries: [entry] } });
  const { sent } = await blanked({ ...fixture, planted: { vendor: 'appl' } });
  const at = find(sent, 'lpcm') - 4;
  assert.deepEqual([...sent.subarray(at + 16, at + 20)], [0, 1, 0, 0], 'version 1, revision 0');
  assert.ok(same(sent.subarray(at + 24, at + entry.length), entry.subarray(24)), 'everything after the vendor');
});

test('a data reference\'s bytes after its flags are zeroed, the entry kept (#198)', async () => {
  const fixture = plainClip({ video: { dinf: dinf(reference('url ', 1, 'file:///Fiction/clip.mov', 0)) } });
  const { sent } = await blanked({ ...fixture, planted: { location: 'file:///Fiction' } });
  assert.notEqual(find(sent, bytes(be32(37), 'url ', 0, 0, 0, 1)), -1);
});

test('a kept track\'s tref and udta are blanked; tapt, edts and the media header are kept (#198)', async () => {
  const fixture = plainClip({
    video: { trak: [box('tref', box('chap', be32(5))), box('tapt', fullBox('clef', 0, 0, be32(1), be32(2)))], edts: true,
      after: [box('udta', box('©mak', 'FictionCo'))] },
  });
  const { sent } = await blanked({ ...fixture, planted: { tref: 'tref', chapter: 'chap', udta: 'udta', make: 'FictionCo' } });
  for (const kept of ['tapt', 'clef', 'edts', 'elst', 'vmhd', 'smhd']) assert.notEqual(find(sent, kept), -1, kept);
});

// ---- What a plan reads -------------------------------------------------------

test('durationMs is mvhd\'s duration over its timescale, rounded; contentType follows the major brand (#198)', async () => {
  const at = (movie, brand) => plan(plainClip({ clip: { movie, ...(brand ? { brand } : {}) } }).file);
  assert.equal((await at(mvhd({ time: ZERO, timescale: 600, duration: 2701 }))).durationMs, 4502);
  assert.equal((await at(mvhd({ time: ZERO, timescale: 90000, duration: 45 }))).durationMs, 1);
  // Version 1's 64-bit duration, past what 32 bits hold.
  assert.equal((await at(mvhd({ time: ZERO, version: 1, timescale: 1000, duration: 2 ** 32 + 5 }))).durationMs, 2 ** 32 + 5);
  assert.equal((await at(mvhd({ time: ZERO }), ftyp('qt  ', 'qt  '))).contentType, 'video/quicktime');
  for (const brand of ['mp42', 'isom', 'mp41', 'M4V ', 'nvr1']) {
    assert.equal((await at(mvhd({ time: ZERO }), ftyp(brand, 'isom'))).contentType, 'video/mp4', brand);
  }
});

test('width and height are the first video track\'s as shown: turned 90 or 270 degrees, swapped (#198)', async () => {
  const size = async (video, more = {}) => {
    const p = await plan(plainClip({ video: { ...video, tkhd: { id: 1, time: ZERO, ...video.tkhd } }, ...more }).file);
    return [p.width, p.height];
  };
  assert.deepEqual(await size({ tkhd: { width: 1920, height: 1080 } }), [1920, 1080]);
  assert.deepEqual(await size({ tkhd: { width: 1920, height: 1080, matrix: MATRIX.turned } }), [1080, 1920]);
  assert.deepEqual(await size({ tkhd: { width: 1920, height: 1080, matrix: MATRIX.turned270 } }), [1080, 1920]);
  assert.deepEqual(await size({ tkhd: { width: 1920, height: 1080, matrix: MATRIX.upsideDown } }), [1920, 1080]);
  // 16.16, rounded.
  assert.deepEqual(await size({ tkhd: { width: 1919.6, height: 1079.4 } }), [1920, 1079]);
  // A header of 0 x 0 gives way to the sample entry's coded size, turned too.
  const coded = { entries: [videoEntry('avc1', { width: 1280, height: 720 })] };
  assert.deepEqual(await size({ ...coded, tkhd: { width: 0, height: 0 } }), [1280, 720]);
  assert.deepEqual(await size({ ...coded, tkhd: { width: 0, height: 0, matrix: MATRIX.turned } }), [720, 1280]);
  // The first video track, not the largest.
  const second = { tkhd: { id: 3, time: ZERO, width: 3840, height: 2160 }, mdhd: { time: ZERO }, hdlr: hdlr('vide'),
    entries: [videoEntry('hvc1', { width: 3840, height: 2160 })], samples: frames(1, 8, 0x56) };
  assert.deepEqual(await size({ tkhd: { width: 640, height: 360 } }, { tracks: [second] }), [640, 360]);
});

test('malformed: a frame that reads 0 wide or 0 high once the coded size has been tried, which 0005 refuses in the row (#198\'s review)', async () => {
  // Before this, each passed the walker and the check, uploaded in full, and
  // failed as a 503 inside finishClip on every complete and every Try again.
  const sized = (tkhd, entry) => plainClip({
    video: { tkhd: { id: 1, time: ZERO, ...tkhd }, entries: [videoEntry('avc1', entry)] },
  }).file;
  for (const [name, tkhd, entry] of [
    ['0 x 0 both ways', { width: 0, height: 0 }, { width: 0, height: 0 }],
    ['a header 0 x 0, coded 1280 x 0', { width: 0, height: 0 }, { width: 1280, height: 0 }],
    ['a header 1920 x 0, coded 0 x 720', { width: 1920, height: 0 }, { width: 0, height: 720 }],
    ['a header that rounds to 0 x 0, coded 0 x 0', { width: 0.3, height: 0.3 }, { width: 0, height: 0 }],
  ]) {
    assert.deepEqual(await plan(sized(tkhd, entry)), { error: 'malformed' }, `planClip: ${name}`);
    assert.deepEqual(await check(sized(tkhd, entry)), { error: 'malformed' }, `checkClip: ${name}`);
  }
  // The control: a header of 0 x 0 the coded size makes whole still plans.
  const whole = await plan(sized({ width: 0, height: 0 }, { width: 1280, height: 720 }));
  assert.deepEqual([whole.error, whole.width, whole.height], [undefined, 1280, 720]);
});

test('recordedAt is mvhd\'s creation time in Unix seconds, or null when it holds none (#198)', async () => {
  const at = async (movie) => (await plan(plainClip({ clip: { movie } }).file)).recordedAt;
  assert.equal(await at(mvhd({ time: [RECORDED + SINCE_1904, 0] })), RECORDED);
  assert.equal(await at(mvhd({ time: ZERO })), null);
  // Version 1's 64 bits, past 2040.
  assert.equal(await at(mvhd({ version: 1, time: [2 ** 32 + 7, 0] })), 2 ** 32 + 7 - SINCE_1904);
  // Before 1970 (a clock never set): given as it is, for the page to judge.
  assert.equal(await at(mvhd({ time: [1000, 0] })), 1000 - SINCE_1904);
});

test('planClip reads box headers 16 bytes at a time, the brands and the moov, and checkClip the same: never the media (#198)', async () => {
  const { file } = iphoneMov();
  const log = [];
  const p = await planClip(reader(file, log), file.length);
  const sent = applied(file, p);
  const mdatAt = find(file, 'mdat') - 4;
  const mdatEnd = mdatAt + ((file[mdatAt] << 24) | (file[mdatAt + 1] << 16) | (file[mdatAt + 2] << 8) | file[mdatAt + 3]);
  const moovAt = find(file, 'moov') - 4;
  const ok = ([offset, length]) => length <= 16 || offset === moovAt || offset < 32;
  assert.ok(log.every(ok), `planClip read ${JSON.stringify(log.filter((r) => !ok(r)))}`);
  assert.ok(log.every(([offset, length]) => offset + length <= mdatAt + 16 || offset >= mdatEnd), 'planClip read the media');
  const checked = [];
  await checkClip(reader(sent, checked), sent.length);
  assert.ok(checked.every(ok), `checkClip read ${JSON.stringify(checked.filter((r) => !ok(r)))}`);
  assert.ok(checked.every(([offset, length]) => offset + length <= mdatAt + 16 || offset >= mdatEnd), 'checkClip read the media');
});

// ---- Refused, each beside a control that passes -------------------------------

test('a QuickTime file with no ftyp is a MOV, as a current iPhone\'s Live Photo video starts wide, mdat, moov (#198, owner)', async () => {
  // The iPhone shape with its ftyp left out, as the Live Photo read for #198
  // has it: everything planted goes, as with the ftyp.
  const live = iphoneMov({ clip: { top: [box('wide'), 'mdat', 'moov'] } });
  assert.equal(String.fromCharCode(...live.file.subarray(4, 8)), 'wide');
  const { p } = await blanked(live);
  assert.equal(p.contentType, 'video/quicktime');
  // Each box QuickTime opens with may come first.
  for (const top of [['moov', 'mdat'], ['mdat', 'moov'], [box('free', new Uint8Array(8)), 'moov', 'mdat'], [box('skip'), 'mdat', 'moov']]) {
    assert.equal((await passes(plainClip({ clip: { top } }).file)).contentType, 'video/quicktime');
  }
  // And the ftyp still decides when there is one.
  assert.equal((await passes(plainClip().file)).contentType, 'video/mp4');
});

test('not-clip: neither an ftyp nor a box QuickTime opens with first, or nothing like a box at all (#198)', async () => {
  await refused(plainClip({ clip: { top: [xmpBox(), 'moov', 'mdat'] } }).file, 'not-clip');
  await refused(plainClip({ clip: { top: [box('abcd'), 'moov', 'mdat'] } }).file, 'not-clip');
  await refused(plainClip({ clip: { top: [box('meta'), 'moov', 'mdat'] } }).file, 'not-clip');
  // The control: the same boxes after an ftyp pass.
  await passes(plainClip({ clip: { top: ['ftyp', box('abcd'), 'moov', 'mdat'] } }).file);
  // Nothing like a box at all: a JPEG, a few bytes, nothing.
  await refused(jpeg({ width: 8, height: 8 }), 'not-clip');
  await refused(bytes('Hello, this is not a clip at all.'), 'not-clip');
  await refused(new Uint8Array(7), 'not-clip');
  await refused(new Uint8Array(0), 'not-clip');
});

test('not-clip: a HEIF or AVIF photo\'s major brand; a video naming one only as compatible passes (#198)', async () => {
  for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'avif', 'avis']) {
    await refused(plainClip({ clip: { brand: ftyp(brand, 'mif1', brand) } }).file, 'not-clip');
  }
  await passes(plainClip({ clip: { brand: ftyp('mp42', 'isom', 'mif1') } }).file);
});

test('not-clip: no moov, or no mdat (#198)', async () => {
  await refused(plainClip({ clip: { top: ['ftyp', 'mdat'] } }).file, 'not-clip');
  await refused(plainClip({ clip: { top: ['ftyp', 'moov'] } }).file, 'not-clip');
  await passes(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat'] } }).file);
});

test('fragmented: a fragment\'s box at the top level, or moov/mvex; the same box as free passes (#198)', async () => {
  for (const type of ['moof', 'mfra', 'sidx', 'styp', 'ssix', 'prft', 'emsg']) {
    const file = plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', box(type, fullBox('mfhd', 0, 0, be32(1)))] } }).file;
    await refused(file, 'fragmented');
    await passes(retyped(file, type, 'free', file.length - 24));
  }
  const mvex = plainClip({ clip: { moov: [box('mvex', fullBox('trex', 0, 0, new Uint8Array(20)))] } }).file;
  await refused(mvex, 'fragmented');
  await passes(retyped(mvex, 'mvex', 'udta'));
});

test('malformed: a box running past its parent, or past the end of the file (#198)', async () => {
  await refused(plainClip({ video: { trak: [bytes(be32(4096), 'udta', 'Fiction')] } }).file, 'malformed');
  await passes(plainClip({ video: { trak: [bytes(be32(15), 'udta', 'Fiction')] } }).file);
  // A file cut short: its last box, mdat, now runs past the end.
  const { file } = plainClip();
  await refused(file.subarray(0, file.length - 1), 'malformed');
  await passes(file);
  // A moov running past the end, mdat first.
  const late = plainClip({ clip: { top: ['ftyp', 'mdat', 'moov'] } }).file;
  await refused(late.subarray(0, late.length - 3), 'malformed');
  await passes(late);
});

test('malformed: a box under 8 bytes inside a kept box, where 8 or more bytes are left (#198)', async () => {
  await refused(plainClip({ clip: { moovRemainder: bytes(be32(4), 'abcd', be32(0)) } }).file, 'malformed');
  await refused(plainClip({ clip: { moov: [bytes(be32(0), 'udta', 'Fiction!')] } }).file, 'malformed');
  await passes(plainClip({ clip: { moov: [bytes(be32(16), 'udta', 'Fiction!')] } }).file);
  await passes(plainClip({ clip: { moovRemainder: bytes(be32(0), 'abc') } }).file);
});

test('malformed: a size of 0 anywhere but a last mdat, or a 64-bit size under 16 (#198)', async () => {
  await refused(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', bytes(be32(0), 'uuid', new Uint8Array(16))] } }).file, 'malformed');
  await passes(plainClip({ clip: { mdat: 'toEnd' } }).file);
  await refused(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', bytes(be32(1), 'free', be64(8))] } }).file, 'malformed');
  await passes(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', bytes(be32(1), 'free', be64(16))] } }).file);
});

test('malformed: no mvhd, a version past 1, a timescale or duration of 0, or a length that rounds to 0 ms (#198)', async () => {
  const movie = (m) => plainClip({ clip: { movie: m } }).file;
  await refused(movie(new Uint8Array(0)), 'malformed');
  await refused(movie(fullBox('mvhd', 2, 0, new Uint8Array(96))), 'malformed');
  await refused(movie(mvhd({ time: ZERO, timescale: 0 })), 'malformed');
  await refused(movie(mvhd({ time: ZERO, duration: 0 })), 'malformed');
  await refused(movie(mvhd({ time: ZERO, timescale: 90000, duration: 44 })), 'malformed');
  // The controls: an mvhd at version 0 with a timescale and a duration, and
  // the shortest length that rounds to 1 ms.
  await passes(movie(mvhd({ time: ZERO, timescale: 600, duration: 2700 })));
  await passes(movie(mvhd({ time: ZERO, timescale: 90000, duration: 45 })));
});

test('malformed: a kept track with a short tkhd, or without mdhd, a sample entry or its sample tables (#198)', async () => {
  await refused(plainClip({ video: { tkhdBox: fullBox('tkhd', 0, 3, new Uint8Array(40)) } }).file, 'malformed');
  await refused(plainClip({ video: { mdhdBox: new Uint8Array(0) } }).file, 'malformed');
  await refused(plainClip({ video: { entries: [] } }).file, 'malformed');
  await refused(plainClip({ video: { tables: (chunks) => [stsz([16]), stco(chunks)] } }).file, 'malformed');
  await passes(plainClip({ video: { tables: (chunks) => [stsc([1, 1]), stsz([16]), stco(chunks)] } }).file);
  await passes(plainClip({ video: { tkhdBox: fullBox('tkhd', 0, 3, new Uint8Array(80)) } }).file);
});

test('malformed: a blanked track\'s sample tables that cannot be read; checkClip sees only that it is there (#198)', async () => {
  const sizes = [gpmf(2).length, gpmf(3).length];
  const broken = {
    'no stsc': (chunks) => [stsz(sizes), stco(chunks)],
    'no stsz': (chunks) => [stsc([1, 1]), stco(chunks)],
    'more samples than sizes': (chunks) => [stsc([1, 5]), stsz(sizes), stco(chunks)],
    'a first run past chunk 1': (chunks) => [stsc([2, 1]), stsz(sizes), stco(chunks)],
    'runs out of order': (chunks) => [stsc([1, 1], [1, 1]), stsz(sizes), stco(chunks)],
    'a 5-bit stz2': (chunks) => [stsc([1, 1]), stz2(5, sizes), stco(chunks)],
    'more chunks than the box holds': (chunks) => [stsc([1, 1]), stsz(sizes), stco(chunks, chunks.length + 5)],
    'two stco': (chunks) => [stsc([1, 1]), stsz(sizes), stco(chunks), stco(chunks)],
  };
  for (const [name, tables] of Object.entries(broken)) {
    const { file } = goproMp4({ meta: { tables } });
    assert.deepEqual(await plan(file), { error: 'malformed' }, name);
    assert.deepEqual(await check(file), { error: 'kept' }, name);
  }
  await blanked(goproMp4({ meta: { tables: (chunks) => [stsc([1, 1]), stsz(sizes), stco(chunks)] } }));
});

test('malformed: a sample outside the media data, a blanked track\'s or a kept one\'s (#198)', async () => {
  const sizes = [gpmf(2).length, gpmf(3).length];
  const past = goproMp4({ meta: { tables: (chunks) => [stsc([1, 1]), stsz(sizes), stco([chunks[0], 999999])] } }).file;
  assert.deepEqual(await plan(past), { error: 'malformed' });
  await blanked(goproMp4({ meta: { tables: (chunks) => [stsc([1, 1]), stsz(sizes), stco(chunks)] } }));
  // A kept track's chunk inside the moov, or running past the end of mdat.
  await refused(plainClip({ video: { tables: () => [stsc([1, 1]), stsz([16]), stco([40])] } }).file, 'malformed');
  await refused(plainClip({ clip: { top: ['ftyp', 'mdat', 'moov'] }, sound: { tables: (chunks) => [stsc([1, 1]), stsz([4096]), stco(chunks)] } }).file, 'malformed');
  await passes(plainClip({ clip: { top: ['ftyp', 'mdat', 'moov'] }, sound: { tables: (chunks) => [stsc([1, 1]), stsz([8]), stco(chunks)] } }).file);
});

test('malformed: two moovs, or more than 64 top-level boxes (#198)', async () => {
  await refused(plainClip({ clip: { top: ['ftyp', 'moov', 'moov', 'mdat'] } }).file, 'malformed');
  await passes(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat'] } }).file);
  const frees = (n) => Array.from({ length: n }, () => box('free'));
  await refused(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', ...frees(62)] } }).file, 'malformed');
  await passes(plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', ...frees(61)] } }).file);
});

/** A reader over a file that is `head` and then zeros up to `size`, never holding the zeros. */
function zerosAfter(head, size, log) {
  return async (offset, length) => {
    log.push(length);
    const out = new Uint8Array(length);
    if (offset < head.length) out.set(head.subarray(offset, Math.min(head.length, offset + length)));
    return out;
  };
}

test('too-big: a moov over MOOV_MAX, refused from its header without reading it (#198)', async () => {
  const brand = ftyp('mp42', 'isom');
  const sized = (moovSize) => {
    const head = bytes(brand, be32(moovSize), 'moov');
    const size = brand.length + moovSize + 16;
    // An mdat after the moov, so only the moov's size can be wrong.
    const tail = bytes(be32(16), 'mdat', new Uint8Array(8));
    return { head, size, read: (log) => async (offset, length) => {
      const out = await zerosAfter(head, size, log)(offset, length);
      const tailAt = size - 16;
      if (offset + length > tailAt) out.set(tail.subarray(Math.max(0, offset - tailAt), offset + length - tailAt), Math.max(0, tailAt - offset));
      return out;
    } };
  };
  const over = sized(MOOV_MAX + 1);
  const log = [];
  assert.deepEqual(await planClip(over.read(log), over.size), { error: 'too-big' });
  assert.ok(Math.max(...log) <= 16, 'it read the moov');
  assert.deepEqual(await checkClip(over.read([]), over.size), { error: 'too-big' });
  // The control: at MOOV_MAX the moov is read (and, being zeros, is not a moov).
  const at = sized(MOOV_MAX);
  const read = [];
  assert.deepEqual(await planClip(at.read(read), at.size), { error: 'malformed' });
  assert.ok(read.includes(MOOV_MAX));
});

test('no-video: a clip with no kept video track, or whose picture track is not video (#198)', async () => {
  await refused(plainClip({ only: 'sound' }).file, 'no-video');
  await refused(plainClip({ video: { hdlr: hdlr('pict') } }).file, 'no-video');
  await passes(plainClip({ only: 'video' }).file);
});

test('codec: a kept track\'s sample entry off the lists, Motion JPEG among them (#198)', async () => {
  await refused(plainClip({ video: { entries: [videoEntry('jpeg')] } }).file, 'codec');
  await refused(plainClip({ video: { entries: [videoEntry('avc1'), videoEntry('mjpa')] } }).file, 'codec');
  await refused(plainClip({ sound: { entries: [audioEntry('raw ')] } }).file, 'codec');
  // A sound track holding a picture codec, a video track a sound one.
  await refused(plainClip({ sound: { entries: [videoEntry('avc1')] } }).file, 'codec');
  await refused(plainClip({ video: { entries: [audioEntry('mp4a')] } }).file, 'codec');
  await passes(plainClip({ video: { entries: [videoEntry('avc1'), videoEntry('hvc1')] }, sound: { entries: [audioEntry('sowt', { extra: [esds()] })] } }).file);
});

test('external: a data reference to another file, in a kept track or a blanked one (#198)', async () => {
  const away = dinf(reference('url ', 0, 'file:///Fiction/clip.mov', 0));
  await refused(plainClip({ video: { dinf: away } }).file, 'external');
  await passes(plainClip({ video: { dinf: dinf(reference('url ', 1)) } }).file);
  // A blanked track's chunk offsets would point into the other file.
  assert.deepEqual(await plan(goproMp4({ meta: { dinf: away } }).file), { error: 'external' });
  await blanked(goproMp4({ meta: { dinf: dinf(reference('alis', 1)) } }));
});

// ---- What only checkClip refuses -------------------------------------------

test('kept: a box outside the keep-list at the top or in the moov, or content in a free box (#198)', async () => {
  const { file } = plainClip();
  await passes(file);
  const cases = {
    'a top-level uuid': plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', xmpBox()] } }).file,
    'a wide of 16 bytes': plainClip({ clip: { top: ['ftyp', box('wide', new Uint8Array(8)), 'moov', 'mdat'] } }).file,
    'a second ftyp': plainClip({ clip: { top: ['ftyp', 'moov', 'mdat', ftyp('mp42')] } }).file,
    'a moov udta': plainClip({ clip: { moov: [box('udta', box('©xyz', '+12.3456+065.4321/'))] } }).file,
    'a free box with content in the moov': plainClip({ clip: { moov: [box('free', 'FictionCo')] } }).file,
    'a free box with content at the top': plainClip({ clip: { top: ['ftyp', 'moov', box('skip', 'FictionCo'), 'mdat'] } }).file,
    'a metadata track': plainClip({ tracks: [metaTrack([bytes('fix')])] }).file,
  };
  for (const [name, original] of Object.entries(cases)) {
    assert.deepEqual(await check(original), { error: 'kept' }, name);
    await passes(original);
  }
  // A free box of zeros, at the top or in the moov, is not kept data.
  const zeros = plainClip({ clip: { top: ['ftyp', 'moov', box('free', new Uint8Array(4096)), 'mdat'], moov: [box('skip', new Uint8Array(32))] } }).file;
  assert.equal((await check(zeros)).error, undefined);
});

test('trailing: bytes after the last box of a stored clip, zeros included (#198)', async () => {
  const { file } = plainClip();
  for (const tail of [new Uint8Array(4), new Uint8Array(16), rawTrailer()]) {
    assert.deepEqual(await check(bytes(file, tail)), { error: 'trailing' });
  }
  assert.equal((await check(file)).error, undefined);
});

test('unchecked: more top-level free content than FREE_CHECK_MAX is refused unread; at the cap it is read and passes (#198)', async () => {
  const { file } = plainClip();
  const withFree = (content) => {
    const head = bytes(file, be32(8 + content), 'free');
    return { size: head.length + content, read: (log) => zerosAfter(head, head.length + content, log) };
  };
  const over = withFree(FREE_CHECK_MAX + 1);
  const log = [];
  assert.deepEqual(await checkClip(over.read(log), over.size), { error: 'unchecked' });
  assert.ok(Math.max(...log) < 64 * 1024, 'it read the free box');
  const at = withFree(FREE_CHECK_MAX);
  const read = [];
  assert.equal((await checkClip(at.read(read), at.size)).error, undefined);
  assert.ok(read.filter((length) => length === 1024 * 1024).length === 64, 'read a MiB at a time');
  // planClip has no such cap: it zeroes without reading.
  assert.equal((await planClip(over.read([]), over.size)).error, undefined);
});

// ---- Parts ---------------------------------------------------------------------

test('partPieces refuses a part the clip does not have (#198)', async () => {
  const p = await plan(plainClip().file);
  for (const n of [0, 2, 1.5, -1]) assert.throws(() => partPieces(p, n), RangeError, String(n));
  assert.deepEqual(partPieces(p, 1), [{ from: 0, to: p.bytes }]);
});

test('partPieces cuts an edit at a seam, and leaves no empty piece where an edit ends exactly on one (#198)', () => {
  const free = Uint8Array.of(0x66, 0x72, 0x65, 0x65);
  const plan = {
    bytes: 2 * PART_BYTES + 100,
    edits: [
      { offset: 10, bytes: free },
      { offset: PART_BYTES - 4, zeros: 4 },
      { offset: PART_BYTES + 8, zeros: PART_BYTES },
      { offset: 2 * PART_BYTES + 96, bytes: free },
    ],
  };
  // A piece as a test can compare it: a range as it is, an edit by its bytes,
  // a zero run by its length.
  const shown = (n) => partPieces(plan, n).map((piece) => {
    if (!(piece instanceof Uint8Array)) return piece;
    return piece.every((b) => b === 0) ? { zeros: piece.length } : String.fromCharCode(...piece);
  });
  assert.deepEqual(shown(1), [{ from: 0, to: 10 }, 'free', { from: 14, to: PART_BYTES - 4 }, { zeros: 4 }]);
  assert.deepEqual(shown(2), [{ from: PART_BYTES, to: PART_BYTES + 8 }, { zeros: PART_BYTES - 8 }]);
  assert.deepEqual(shown(3), [{ zeros: 8 }, { from: 2 * PART_BYTES + 8, to: 2 * PART_BYTES + 96 }, 'free']);
});

test('a clip over several parts: each part, made alone, is exactly its share of the bytes sent, edits split at the seams (#198)', async () => {
  // A GPMF sample across the first seam, a uuid of XMP across the second, a
  // free box of junk in the last part; the mdat between is zeros, made cheaply.
  const sample = gpmf(30);
  const xmp = xmpBox();
  const junk = box('free', new Uint8Array(1024 * 1024).fill(0x4a));
  const make = (before, tail) => plainClip({
    tracks: [metaTrack([sample], { before })],
    clip: { top: ['ftyp', 'moov', 'mdat', xmp, junk], tail },
  });
  const probe = make(0, 0);
  const sampleAt = probe.media[2].ranges[0][0];
  const mdatEnd = probe.file.length - xmp.length - junk.length;
  const before = PART_BYTES - 100 - sampleAt;
  const tail = 2 * PART_BYTES - 50 - (mdatEnd + before);
  const fixture = make(before, tail);
  const { file } = fixture;
  assert.equal(partCount(file.length), 3);

  const p = await plan(file);
  assert.ok(!p.error, p.error);
  assertEdits(p);
  // Edits straddle both seams, so the test splits them.
  for (const seam of [PART_BYTES, 2 * PART_BYTES]) {
    assert.ok(p.edits.some((e) => e.offset < seam && seam < e.offset + (e.zeros ?? e.bytes.length)), `no edit across ${seam}`);
  }
  // The plan holds no bytes but the 4 of a type made free.
  assert.ok(p.edits.every((e) => 'zeros' in e || e.bytes.length === 4));

  const sent = applied(file, p);
  for (let n = 1; n <= 3; n++) {
    const pieces = partPieces(p, n);
    const from = (n - 1) * PART_BYTES;
    const to = Math.min(n * PART_BYTES, p.bytes);
    const held = pieces.filter((piece) => piece instanceof Uint8Array);
    assert.ok(held.reduce((sum, piece) => sum + piece.length, 0) <= to - from, `part ${n} holds more than itself`);
    // Each zero run is made for this part alone, never a view of something larger.
    for (const piece of held) if (piece.length > 4) assert.equal(piece.buffer.byteLength, piece.length);
    assert.ok(same(part(file, p, n), sent.subarray(from, to)), `part ${n}`);
  }
  const holds = (haystack, needle) => Buffer.from(haystack.buffer, haystack.byteOffset, haystack.length).indexOf(Buffer.from(needle)) !== -1;
  for (const needle of [GPS5_FIX.subarray(0, 8), bytes('FictionCam HERO'), bytes('Fiction 7a'), XMP_UUID, new Uint8Array(64).fill(0x4a)]) {
    assert.ok(holds(file, needle) && !holds(sent, needle));
  }
  assert.deepEqual(await check(sent), { contentType: 'video/mp4', durationMs: 4500, width: 640, height: 360 });
});
