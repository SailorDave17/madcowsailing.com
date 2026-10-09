/* The clip walker (#198, CLAUDE.md item 10): what an MP4 or MOV clip keeps,
 * and the edits that blank the rest in place before any of it is sent.
 *
 * A clip is a run of boxes, the named blocks the file is made of. This reads
 * them and keeps only the ones playing the clip needs: every other box is
 * overwritten where it stands. Its type becomes `free`, everything after its
 * header becomes zeros, and its size stays the same. Nothing is re-encoded
 * and nothing moves, so every offset into the media stays right wherever the
 * file keeps its index (moov). Apple's QuickTime documentation lets a free
 * box stand in for removed metadata, and Android's media provider redacts
 * video location in place the same way.
 *
 * One module, three runtimes, so the page and the server read one keep-list
 * (KEEP, below). The share page loads it as <script type="module"> and runs
 * planClip over file.slice reads; lib/clips.js imports checkClip through the
 * Functions bundler and runs it over ranged reads of the stored object; the
 * tests import both. So it imports nothing and uses no DOM, Node or Workers
 * API.
 *
 * planClip decides what is sent: the edits, and the length to send. Its
 * reads are 16-byte box headers, the ftyp's brands and the whole moov, never
 * the media data. checkClip decides what is stored. R2 cannot patch an
 * object, so the server refuses what still holds data rather than stripping
 * it: the same walk, over the stored object, must find nothing to edit. Its
 * one blind spot is stated in item 10: once a track is blanked, nothing says
 * where its samples were, so checkClip cannot see a location track's samples
 * left in the media data. That case rests on planClip and test/clip.test.js.
 *
 * Decisions taken at #198's pickup (2026-10-08), from its build spec:
 *
 * - The creation and modification times in mvhd, tkhd and mdhd are zeroed
 *   (owner), and checkClip refuses a clip that still carries them. The page
 *   reads the recording time first (recordedAt) for the row.
 * - Inside the boxes playback keeps, the fields that only name a maker are
 *   zeroed too: every hdlr's manufacturer, flags, mask and name, a video
 *   sample entry's vendor and compressor name ("GoPro AVC encoder"), and an
 *   audio sample entry's vendor, never its version and revision before it,
 *   which decide the QuickTime layout of the rest. Apple's documentation
 *   says of the manufacturer "Reserved. Set to 0" and of the name "may
 *   contain a zero-length string", and the Android clips read for #198 left
 *   the manufacturer, vendor and compressor name empty already. stsd is
 *   still never blanked (item 10): only these fields change.
 * - A fragmented file (moov/mvex, or a moof, mfra, sidx, styp, ssix, prft or
 *   emsg at the top) is refused. No phone camera writer was found that
 *   writes one; a browser's MediaRecorder does.
 * - Bytes after the last whole box at the top (a raw trailer, as Insta360
 *   keeps its GPS records) are not sent, so nothing moves. A box that runs
 *   past the end of the file is a broken file, refused.
 * - A kept track's tref is blanked: it only links to tracks blanked anyway.
 * - Every sample entry of a kept track must be a codec on VIDEO_FORMATS or
 *   AUDIO_FORMATS, so a Motion JPEG track, whose frames can each carry EXIF,
 *   cannot pass.
 * - A file with no ftyp whose first box is one QuickTime opens with (wide,
 *   mdat, moov, free or skip) is a MOV, as QuickTime files were before ftyp
 *   existed (owner, 2026-10-08, after the walker was built). A current
 *   iPhone's Live Photo video starts that way: wide, mdat, moov. Measured on
 *   one (iPhone 14 Pro, iOS 17.0), it then blanks clean, nothing of its 24
 *   identity tags found afterwards and every frame the same. Not chosen:
 *   refusing it as not a clip, which the build spec first said.
 *
 * Defaults taken while building it (#198, 2026-10-08), each stated where it
 * is used: what a top-level type may look like before the rest is taken for
 * a trailer (typeLike); at most TOP_BOXES top-level boxes; one moov only;
 * a HEIF or AVIF photo told apart by its major brand only; every chunk of a
 * kept track inside a top-level mdat; a blanked track's dref held to the
 * same self-contained rule as a kept one's; a sample table given twice
 * refused; bytes after the last entry of a dref or stsd zeroed like a
 * container's remainder.
 *
 * Checked at #198 (2026-10-08) on published camera originals, read from
 * disk: an iPhone 6's MOV (iOS 12.3), an Android 6 phone's and a Nokia
 * 6.1's (Android 9) MP4, an MP4 Adobe Bridge saved with a 64-bit mdat and an
 * XMP uuid, four GoPros' (HERO5, HERO6, HERO8, Karma), and a MOV and an MP4
 * ffmpeg made with fictional metadata. After the edits, exiftool -a -G1 -ee
 * -u (and -ee3) found no location, make, model, software, lens, serial,
 * firmware, handler name, vendor, compressor name or time in any of the
 * ten; ffmpeg decoded every copy without an error; every video and audio
 * frame hashed as the original's did; and checkClip passed each copy and
 * refused each original as 'kept'. An iPhone 14 Pro's Live Photo MOV (iOS
 * 17.0) starts with wide, not ftyp. It was refused 'not-clip' until the
 * owner's decision above. Read as a MOV, its copy reads as the ten's did:
 * none of its 24 identity tags, a clean decode, all 85 video and 124 audio
 * frames the same, and checkClip passing it. An old Pentax MOV with no ftyp,
 * Motion JPEG and 'raw ' sound, is refused 'codec'.
 * Measured in Node 24 on this machine, not on the edge, reading from memory:
 * the largest, an 11.6 MB HERO5 clip, planned in 3.4 ms cold (0.23 warm),
 * and its copy checked in 1.0 ms (0.07); a moov the size a 15-minute 60 fps
 * clip carries (778 KB, 97,088 samples) planned in 5.6 ms and checked in
 * 2.5 ms.
 */

/** Every part but the last is this long. R2 needs at least 5 MiB, and the same size for all but the last. */
export const PART_BYTES = 25 * 1024 * 1024;

/** The largest moov either side reads, whole. */
export const MOOV_MAX = 16 * 1024 * 1024;

/** The most top-level free or skip content checkClip reads to see that it is zero. */
export const FREE_CHECK_MAX = 64 * 1024 * 1024;

/** The sample entry formats a kept video track may hold (H.264, HEVC, Dolby Vision, AV1, VP8/9, MPEG-4 Part 2, ProRes). */
export const VIDEO_FORMATS = Object.freeze([
  'avc1', 'avc2', 'avc3', 'avc4', 'hvc1', 'hev1', 'dvh1', 'dvhe', 'dva1', 'dvav', 'av01', 'vp08', 'vp09', 'mp4v',
  'apcn', 'apch', 'apcs', 'apco', 'ap4h', 'ap4x',
]);

/** The sample entry formats a kept audio track may hold (AAC, AC-3, E-AC-3, AC-4, Opus, FLAC, ALAC, APAC, PCM, AMR, MP3). */
export const AUDIO_FORMATS = Object.freeze([
  'mp4a', 'ac-3', 'ec-3', 'ac-4', 'Opus', 'fLaC', 'alac', 'apac', 'lpcm', 'sowt', 'twos', 'in24', 'in32', 'fl32',
  'fl64', 'ipcm', 'fpcm', 'samr', 'sawb', '.mp3', 'mp3 ',
]);

/** How many parts a clip of `bytes` goes in. */
export const partCount = (bytes) => Math.ceil(bytes / PART_BYTES);

// What a clip keeps, box by box: the one table planClip and checkClip both
// read. A row is a box the walker keeps and goes into, and names what may sit
// inside it; any type a row does not name is blanked, and the walker never
// goes into a blanked box, so a box inside one goes with it. That is why
// meta is never read (a QuickTime meta has no version and flags where an ISO
// one does): it is blanked whole, keys and ilst with it, so no single item is
// ever left in an ilst, where Apple allows no free box (item 10).
//
//   walk         kept, and its own row is walked
//   keep         kept as it is, contents unread
//   zero         free or skip: kept, contents zeroed
//   mvhd, tkhd,  kept, creation and modification times zeroed; mvhd's
//   mdhd         timescale and duration and tkhd's size and matrix read
//   hdlr         kept, box bytes 20 to the end zeroed
//   dref         kept, every entry self-contained, its bytes after 12 zeroed
//   stsd         kept, every entry a listed codec, its maker's fields zeroed
//   table        kept, and read to find the track's samples
//   trak         by its mdia/hdlr handler: vide or soun walked; any other
//                blanked, after planClip zeroes its samples
//   fragmented   refused
//   ftyp, moov,  the top level's own (planClip and checkClip)
//   wide
const KEEP = freezeRows({
  file: {
    ftyp: 'ftyp', moov: 'moov', mdat: 'keep', free: 'zero', skip: 'zero', wide: 'wide',
    moof: 'fragmented', mfra: 'fragmented', sidx: 'fragmented', styp: 'fragmented', ssix: 'fragmented',
    prft: 'fragmented', emsg: 'fragmented',
  },
  moov: { mvhd: 'mvhd', trak: 'trak', iods: 'keep', free: 'zero', skip: 'zero', mvex: 'fragmented' },
  trak: { tkhd: 'tkhd', edts: 'walk', mdia: 'walk', tapt: 'keep', free: 'zero', skip: 'zero' },
  edts: { elst: 'keep' },
  mdia: { mdhd: 'mdhd', hdlr: 'hdlr', minf: 'walk', elng: 'keep', free: 'zero', skip: 'zero' },
  minf: { vmhd: 'keep', smhd: 'keep', hdlr: 'hdlr', dinf: 'walk', stbl: 'walk', free: 'zero', skip: 'zero' },
  dinf: { dref: 'dref' },
  stbl: {
    stsd: 'stsd', stts: 'keep', ctts: 'keep', cslg: 'keep', stss: 'keep', stps: 'keep', stsc: 'table', stsz: 'table',
    stz2: 'table', stco: 'table', co64: 'table', sdtp: 'keep', sgpd: 'keep', sbgp: 'keep', subs: 'keep', padb: 'keep',
    free: 'zero', skip: 'zero',
  },
});

function freezeRows(rows) {
  for (const row of Object.values(rows)) Object.freeze(row);
  return Object.freeze(rows);
}

const has = (row, type) => Object.prototype.hasOwnProperty.call(row, type);

// QuickTime's clock starts on 1904-01-01; Unix time 70 years later.
const SINCE_1904 = 2082844800;

// Brands a HEIF or AVIF photo names as its major brand: HEVC, AVC and AV1
// stills and image sequences, and the structural mif1/msf1/miaf. Only the
// major brand is read (a default taken while building): a photo leads with
// one of these, and a camera's video was never seen listing one, but a
// compatible brand is a list any writer may extend. Not chosen: refusing a
// compatible brand too.
const PHOTO_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'avci', 'avcs', 'mif1', 'mif2', 'msf1', 'miaf', 'avif',
  'avis', 'avio',
]);

// The most of an ftyp read for its brands.
const BRANDS_MAX = 4096;

// The boxes a QuickTime file with no ftyp may open with (the header above):
// such a file is a MOV. Any other first box with no ftyp is not a clip.
const QUICKTIME_FIRST = new Set(['wide', 'mdat', 'moov', 'free', 'skip']);

// The most top-level boxes either side reads (a default taken while
// building, #198). Each is a ranged read on the server, so a file of 8-byte
// boxes could otherwise ask for millions. The real clips read for #198 held
// four or five (ftyp, wide, mdat, moov, free, uuid). Past it: 'malformed'.
const TOP_BOXES = 64;

// checkClip reads a top-level free box's contents this much at a time.
const FREE_READ = 1024 * 1024;

// The four sample tables that place a track's samples: stsz or stz2 sizes
// them, stsc groups them into chunks, stco or co64 says where each chunk is.
const TABLE_SLOT = Object.freeze({ stsc: 'stsc', stsz: 'stsz', stz2: 'stsz', stco: 'stco', co64: 'stco' });

class Refusal {
  constructor(error) {
    this.error = error;
  }
}

const refuse = (error) => {
  throw new Refusal(error);
};

const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u16 = (b, at) => (b[at] << 8) | b[at + 1];
const u32 = (b, at) => b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
const s32 = (b, at) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
const u64 = (b, at) => u32(b, at) * 0x100000000 + u32(b, at + 4);
const freeType = () => Uint8Array.of(0x66, 0x72, 0x65, 0x65);

/**
 * `read`, held to its contract: exactly the bytes asked for, or an error
 * (never a refusal). Not `instanceof Uint8Array`, which a byte array made in
 * another realm (the share page's tests run it in node:vm) fails.
 */
async function readExactly(read, offset, length) {
  const bytes = await read(offset, length);
  if (!bytes || bytes.length !== length) {
    throw new Error(`clip.js: asked for ${length} bytes at ${offset}, given ${bytes && bytes.length}`);
  }
  return bytes;
}

/**
 * The box at `at` in `b`, which must end by `end`: its type, its start, its
 * header's length (8, or 16 after a 64-bit size) and its end. Only a
 * top-level mdat may run to the end of the file (size 0), so a size of 0 here
 * is a box under 8 bytes: 'malformed', as is one that runs past `end`.
 */
function boxAt(b, at, end) {
  if (end - at < 8) refuse('malformed');
  let length = u32(b, at);
  let head = 8;
  if (length === 1) {
    if (end - at < 16) refuse('malformed');
    length = u64(b, at + 8);
    head = 16;
  }
  if (length < head || length > end - at) refuse('malformed');
  return { type: fourcc(b, at + 4), start: at, head, end: at + length };
}

/** The first box of `type` directly inside `parent`, or null. */
function child(b, parent, type) {
  let at = parent.start + parent.head;
  while (parent.end - at >= 8) {
    const box = boxAt(b, at, parent.end);
    if (box.type === type) return box;
    at = box.end;
  }
  return null;
}

// ---- The moov, read whole and walked by KEEP ---------------------------------

// Each step takes the moov being read, the box, and the kept track it sits in.
const STEPS = {
  walk: (m, box, track) => walk(m, box.type, box.start + box.head, box.end, track),
  keep: () => {},
  zero: (m, box) => zero(m, box.start + box.head, box.end),
  blank: (m, box) => blank(m, box),
  fragmented: () => refuse('fragmented'),
  trak, mvhd, tkhd, mdhd, hdlr, dref, stsd, table,
};

/** The edits a moov of `buf`, starting at `base` in the file, needs, with what it says of the clip. */
function readMoov(buf, base) {
  const m = { buf, base, edits: [], movie: null, tracks: [], blanked: [] };
  walk(m, 'moov', boxAt(buf, 0, buf.length).head, buf.length);
  if (!m.movie) refuse('malformed');
  return m;
}

/**
 * Walk the boxes from `from` to `to` in the moov's bytes, inside a kept box
 * read by `row`. A remainder of 1 to 7 bytes after the last is allowed, since
 * a QuickTime list may end with a 32-bit zero, and is zeroed; 8 or more must
 * be a box.
 */
function walk(m, row, from, to, track) {
  const rules = KEEP[row];
  let at = from;
  while (to - at >= 8) {
    const box = boxAt(m.buf, at, to);
    STEPS[has(rules, box.type) ? rules[box.type] : 'blank'](m, box, track);
    at = box.end;
  }
  zero(m, at, to);
}

/** Zero [from, to) of the moov's bytes, unless it is zero already. */
function zero(m, from, to) {
  for (let i = from; i < to; i++) {
    if (m.buf[i] !== 0) {
      m.edits.push({ offset: m.base + from, zeros: to - from });
      return;
    }
  }
}

/** Blank a box: its type becomes free, and everything after its header zero. */
function blank(m, box) {
  if (fourcc(m.buf, box.start + 4) !== 'free') m.edits.push({ offset: m.base + box.start + 4, bytes: freeType() });
  zero(m, box.start + box.head, box.end);
}

/** A track's media handler (vide, soun, meta, tmcd, …) from its mdia/hdlr, or null. */
function handlerOf(b, trakBox) {
  const mdia = child(b, trakBox, 'mdia');
  const handler = mdia && child(b, mdia, 'hdlr');
  if (!handler) return null;
  if (handler.end - handler.start - handler.head < 12) refuse('malformed');
  return fourcc(b, handler.start + handler.head + 8);
}

function trak(m, box) {
  const kind = handlerOf(m.buf, box);
  if (kind !== 'vide' && kind !== 'soun') {
    // Timed metadata (a GoPro's GPMF, an iPhone's mebx), timecode, text:
    // planClip zeroes its samples from the tables read here, then the track
    // goes. checkClip refuses it as kept, since its type must change.
    m.blanked.push(box);
    blank(m, box);
    return;
  }
  const track = { kind, shown: null, coded: null, header: false, entries: false, tables: {} };
  walk(m, 'trak', box.start + box.head, box.end, track);
  // A kept track playback can use: a header, a media header, a sample entry,
  // and the tables that place its samples.
  const { stsc, stsz, stco } = track.tables;
  if (!track.shown || !track.header || !track.entries || !stsc || !stsz || !stco) refuse('malformed');
  m.tracks.push(track);
}

// mvhd, tkhd and mdhd hold their times and duration in 32 bits at version 0
// and 64 at version 1, so each field's place depends on the version. The
// width of a time (4 or 8), once the box is long enough for the fields read.
function timeWidth(m, box, need0, need1) {
  const c = box.start + box.head;
  const v = m.buf[c];
  if (v > 1 || box.end - c < (v === 1 ? need1 : need0)) refuse('malformed');
  return v === 1 ? 8 : 4;
}

const timeAt = (b, at, width) => (width === 8 ? u64(b, at) : u32(b, at));

function mvhd(m, box) {
  const c = box.start + box.head;
  const width = timeWidth(m, box, 20, 32);
  const created = timeAt(m.buf, c + 4, width);
  zero(m, c + 4, c + 4 + 2 * width);
  if (m.movie) return;
  m.movie = {
    created,
    timescale: u32(m.buf, c + 4 + 2 * width),
    duration: timeAt(m.buf, c + 8 + 2 * width, width),
  };
}

function tkhd(m, box, track) {
  const c = box.start + box.head;
  const width = timeWidth(m, box, 84, 96);
  zero(m, c + 4, c + 4 + 2 * width);
  if (track.shown) return;
  // The matrix's first row is a, b (16.16): a 90 or 270 degree turn puts its
  // weight on b. Width and height (16.16) follow the matrix.
  const matrix = c + (width === 8 ? 52 : 40);
  track.shown = {
    width: Math.round(u32(m.buf, matrix + 36) / 65536),
    height: Math.round(u32(m.buf, matrix + 40) / 65536),
    turned: Math.abs(s32(m.buf, matrix + 4)) > Math.abs(s32(m.buf, matrix)),
  };
}

function mdhd(m, box, track) {
  const c = box.start + box.head;
  const width = timeWidth(m, box, 12, 20);
  zero(m, c + 4, c + 4 + 2 * width);
  track.header = true;
}

// hdlr: version and flags, a pre_defined word (QuickTime's component type),
// the handler type, then the manufacturer, flags and mask (QuickTime) or
// three reserved words (ISO), and the name: box bytes 20 to the end.
function hdlr(m, box) {
  const c = box.start + box.head;
  if (box.end - c < 12) refuse('malformed');
  zero(m, c + 12, box.end);
}

/**
 * Each entry of a dref, held to being self-contained (flag 1: the media is in
 * this file): an alias or URL to another file is 'external'. `zeroEntry`
 * gets each entry's bytes after its header and flags, and the bytes after
 * the last entry.
 */
function drefEntries(b, box, zeroEntry) {
  const c = box.start + box.head;
  if (box.end - c < 8) refuse('malformed');
  let at = c + 8;
  for (let n = u32(b, c + 4); n > 0; n--) {
    const entry = boxAt(b, at, box.end);
    const data = entry.start + entry.head + 4;
    if (data > entry.end) refuse('malformed');
    if ((b[data - 1] & 1) === 0) refuse('external');
    zeroEntry(data, entry.end);
    at = entry.end;
  }
  zeroEntry(at, box.end);
}

function dref(m, box) {
  drefEntries(m.buf, box, (from, to) => zero(m, from, to));
}

// stsd: version and flags, a count, then the entries. Every entry's format
// must be on the track's list. The fixed fields are read from where an
// 8-byte header leaves them: a video entry's vendor at 20 and compressor name
// at 50 to 82, its coded width and height at 32 and 34; an audio entry's
// vendor at 20. An entry's own child boxes (avcC, hvcC, esds, …) are codec
// setup, kept unread.
function stsd(m, box, track) {
  const b = m.buf;
  const c = box.start + box.head;
  if (box.end - c < 8) refuse('malformed');
  const count = u32(b, c + 4);
  if (count === 0) refuse('malformed');
  const video = track.kind === 'vide';
  const formats = video ? VIDEO_FORMATS : AUDIO_FORMATS;
  let at = c + 8;
  for (let n = count; n > 0; n--) {
    const entry = boxAt(b, at, box.end);
    if (formats.indexOf(entry.type) === -1) refuse('codec');
    const e = entry.start + entry.head - 8;
    if (entry.end - e < (video ? 86 : 36)) refuse('malformed');
    zero(m, e + 20, e + 24);
    if (video) {
      zero(m, e + 50, e + 82);
      if (!track.coded) track.coded = { width: u16(b, e + 32), height: u16(b, e + 34) };
    }
    at = entry.end;
  }
  zero(m, at, box.end);
  track.entries = true;
}

function table(m, box, track) {
  addTable(track.tables, box);
}

function addTable(tables, box) {
  const slot = TABLE_SLOT[box.type];
  // Two of one table leave which one a player reads open: 'malformed'.
  if (tables[slot]) refuse('malformed');
  tables[slot] = box;
}

/** A blanked track's sample tables, after holding its dref to the self-contained rule. */
function blankedTables(b, trakBox) {
  const mdia = child(b, trakBox, 'mdia');
  const minf = mdia && child(b, mdia, 'minf');
  if (!minf) return {};
  const dinf = child(b, minf, 'dinf');
  const references = dinf && child(b, dinf, 'dref');
  // Its chunk offsets would point into another file, and zeroing them here
  // would zero this one's media.
  if (references) drefEntries(b, references, () => {});
  const stbl = child(b, minf, 'stbl');
  const tables = {};
  if (!stbl) return tables;
  let at = stbl.start + stbl.head;
  while (stbl.end - at >= 8) {
    const box = boxAt(b, at, stbl.end);
    if (has(TABLE_SLOT, box.type)) addTable(tables, box);
    at = box.end;
  }
  return tables;
}

/**
 * Call `each(from, to)` with each chunk of a track's samples as a range of
 * the file. A track with no chunk offsets has no samples here; one with
 * offsets needs the other two tables, and tables that do not agree are
 * 'malformed'.
 */
function eachChunk(b, tables, each) {
  const { stsc, stsz, stco } = tables;
  if (!stco) return;
  if (!stsc || !stsz) refuse('malformed');

  const co = stco.start + stco.head;
  const long = stco.type === 'co64';
  if (stco.end - co < 8) refuse('malformed');
  const chunks = u32(b, co + 4);
  if ((stco.end - co - 8) / (long ? 8 : 4) < chunks) refuse('malformed');

  const sz = stsz.start + stsz.head;
  if (stsz.end - sz < 12) refuse('malformed');
  const count = u32(b, sz + 8);
  let uniform = 0;
  let sizeOf;
  if (stsz.type === 'stsz') {
    uniform = u32(b, sz + 4);
    if (uniform === 0) {
      if ((stsz.end - sz - 12) / 4 < count) refuse('malformed');
      sizeOf = (i) => u32(b, sz + 12 + 4 * i);
    }
  } else {
    // stz2: sizes packed 4, 8 or 16 bits each; at 4 the first is the high half.
    const bits = b[sz + 7];
    if ((bits !== 4 && bits !== 8 && bits !== 16) || ((stsz.end - sz - 12) * 8) / bits < count) refuse('malformed');
    if (bits === 16) sizeOf = (i) => u16(b, sz + 12 + 2 * i);
    else if (bits === 8) sizeOf = (i) => b[sz + 12 + i];
    else sizeOf = (i) => (b[sz + 12 + (i >> 1)] >> (i & 1 ? 0 : 4)) & 0x0f;
  }

  const sc = stsc.start + stsc.head;
  if (stsc.end - sc < 8) refuse('malformed');
  const runs = u32(b, sc + 4);
  if ((stsc.end - sc - 8) / 12 < runs || (chunks > 0 && runs === 0)) refuse('malformed');
  // Each run gives the samples a chunk holds from its first chunk until the
  // next run's; the first starts at chunk 1, and a last run may start past
  // the last chunk, describing none.
  let sample = 0;
  for (let r = 0; r < runs; r++) {
    const first = u32(b, sc + 8 + 12 * r);
    const perChunk = u32(b, sc + 12 + 12 * r);
    const next = r + 1 < runs ? u32(b, sc + 20 + 12 * r) : Infinity;
    if ((r === 0 && first !== 1) || next <= first) refuse('malformed');
    for (let chunk = first; chunk < next && chunk <= chunks; chunk++) {
      if (sample + perChunk > count) refuse('malformed');
      let length = uniform * perChunk;
      if (!uniform) for (let k = 0; k < perChunk; k++) length += sizeOf(sample + k);
      sample += perChunk;
      const at = long ? u64(b, co + 8 + 8 * (chunk - 1)) : u32(b, co + 8 + 4 * (chunk - 1));
      each(at, at + length);
    }
  }
}

/** Whether [from, to) lies inside one top-level mdat's contents. */
function inMdat(mdats, from, to) {
  let lo = 0;
  let hi = mdats.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (mdats[mid].from <= from) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found !== -1 && to <= mdats[found].to;
}

// ---- The top level, read a header at a time ----------------------------------

/**
 * Whether 4 bytes can be a box's type: printable ASCII or ©, as every
 * registered type and QuickTime's ©xyz-style user data are, or four zero
 * bytes, the type #198's spec found Android's media provider leaving where
 * it redacted a box in place. Anything else at the top, after a whole box, is
 * taken for a raw trailer, not a box (a default taken while building), and
 * so are zeros to the end. A raw trailer (Insta360's GPS records, a
 * Samsung-style SEF block) is a camera's own binary, not a box, so its first
 * bytes are not expected to read as a type; test/mp4.js's Insta360-shaped
 * trailer does not. Not read from a real Insta360 or Samsung file. Not
 * chosen: refusing every file whose last bytes are not a box, which would
 * refuse those cameras' clips outright.
 */
function typeLike(b, at) {
  let zeros = 0;
  for (let i = at; i < at + 4; i++) {
    if (b[i] === 0) zeros++;
    else if ((b[i] < 0x20 || b[i] > 0x7e) && b[i] !== 0xa9) return false;
  }
  return zeros === 0 || zeros === 4;
}

/**
 * The top-level boxes, read with a 16-byte read each, up to the first bytes
 * that are not a box (a trailer, never sent): [{ type, start, head, end }],
 * and `end`, where the last whole box ends.
 */
async function topBoxes(read, size) {
  const boxes = [];
  let at = 0;
  while (size - at >= 8) {
    const head = await readExactly(read, at, Math.min(16, size - at));
    if (!typeLike(head, 4)) break;
    const type = fourcc(head, 4);
    if (boxes.length === 0 && type !== 'ftyp' && !QUICKTIME_FIRST.has(type)) refuse('not-clip');
    let length = u32(head, 0);
    let headLength = 8;
    if (length === 1) {
      if (head.length < 16) refuse('malformed');
      length = u64(head, 8);
      headLength = 16;
    } else if (length === 0) {
      // Zeros to the end are padding, a trailer. Otherwise only an mdat may
      // run to the end of the file.
      if (type === '\0\0\0\0') break;
      if (type !== 'mdat') refuse('malformed');
      length = size - at;
    }
    if (length < headLength || length > size - at) refuse('malformed');
    if (has(KEEP.file, type) && KEEP.file[type] === 'fragmented') refuse('fragmented');
    if (boxes.length === TOP_BOXES) refuse('malformed');
    boxes.push({ type, start: at, head: headLength, end: at + length });
    at += length;
  }
  if (boxes.length === 0) refuse('not-clip');
  return { boxes, end: at };
}

/** What becomes of a top-level box: 'keep', 'zero' (free or skip) or 'blank'. */
function topRule(box, index) {
  const rule = has(KEEP.file, box.type) ? KEEP.file[box.type] : 'blank';
  if (rule === 'ftyp') return index === 0 ? 'keep' : 'blank';
  if (rule === 'wide') return box.end - box.start === 8 ? 'keep' : 'blank';
  if (rule === 'moov') return 'keep';
  return rule;
}

/**
 * Read a clip's structure, as both sides do: its top-level boxes, its brand,
 * its one moov walked by KEEP, its mdats, and what it says of itself. Any
 * reason to refuse it is thrown as a Refusal.
 */
async function readClip(read, size) {
  const { boxes, end } = await topBoxes(read, size);

  // With no ftyp, a file topBoxes let through is QuickTime's (QUICKTIME_FIRST).
  let major = 'qt  ';
  if (boxes[0].type === 'ftyp') {
    const ftyp = boxes[0];
    const brandsLength = ftyp.end - ftyp.start - ftyp.head;
    if (brandsLength < 8) refuse('malformed');
    const brands = await readExactly(read, ftyp.start + ftyp.head, Math.min(brandsLength, BRANDS_MAX));
    major = fourcc(brands, 0);
    if (PHOTO_BRANDS.has(major)) refuse('not-clip');
  }

  const moovs = boxes.filter((box) => box.type === 'moov');
  if (moovs.length === 0) refuse('not-clip');
  // Players differ on which of two they read (a default taken while building).
  if (moovs.length > 1) refuse('malformed');
  const moov = moovs[0];
  if (moov.end - moov.start > MOOV_MAX) refuse('too-big');
  const m = readMoov(await readExactly(read, moov.start, moov.end - moov.start), moov.start);

  const mdats = boxes.filter((box) => box.type === 'mdat').map((box) => ({ from: box.start + box.head, to: box.end }));
  if (mdats.length === 0) refuse('not-clip');

  const { created, timescale, duration } = m.movie;
  if (timescale === 0) refuse('malformed');
  const durationMs = Math.round((duration * 1000) / timescale);
  if (durationMs === 0) refuse('malformed');

  const video = m.tracks.find((track) => track.kind === 'vide');
  if (!video) refuse('no-video');
  let { width, height } = video.shown;
  if (width === 0 || height === 0) ({ width, height } = video.coded);
  if (video.shown.turned) [width, height] = [height, width];
  // A frame with no width or no height, by both readings, is not one a
  // player can show, and 0005's CHECK refuses it in the row: refused here,
  // before any of it is sent, rather than as an outage after every part has
  // gone (#198's review).
  if (width === 0 || height === 0) refuse('malformed');

  // Every chunk a kept track plays must be media data in this file (a
  // default taken while building): an offset anywhere else would play junk,
  // or the bytes of a box this walk zeroes.
  for (const track of m.tracks) {
    eachChunk(m.buf, track.tables, (from, to) => {
      if (to > from && !inMdat(mdats, from, to)) refuse('malformed');
    });
  }

  return {
    boxes, end, m, mdats, durationMs, width, height, created,
    contentType: major === 'qt  ' ? 'video/quicktime' : 'video/mp4',
  };
}

/**
 * Sort the edits, merge zero runs that touch or overlap (two blanked tracks
 * may name the same bytes) and byte edits that touch. Nothing else can
 * overlap: each edit lies inside its own box, and a blanked track's samples
 * inside an mdat, which nothing else edits.
 */
function settle(edits) {
  edits.sort((a, b) => a.offset - b.offset);
  const out = [];
  for (const edit of edits) {
    const length = edit.zeros !== undefined ? edit.zeros : edit.bytes.length;
    if (length === 0) continue;
    const last = out[out.length - 1];
    const lastEnd = last ? last.offset + (last.zeros !== undefined ? last.zeros : last.bytes.length) : 0;
    if (last && edit.zeros !== undefined && last.zeros !== undefined && edit.offset <= lastEnd) {
      last.zeros = Math.max(lastEnd, edit.offset + length) - last.offset;
    } else if (last && edit.bytes && last.bytes && edit.offset === lastEnd) {
      const joined = new Uint8Array(last.bytes.length + length);
      joined.set(last.bytes);
      joined.set(edit.bytes, last.bytes.length);
      last.bytes = joined;
    } else {
      if (last && edit.offset < lastEnd) throw new Error('clip.js: two edits overlap');
      out.push(edit.zeros !== undefined ? { offset: edit.offset, zeros: edit.zeros } : { offset: edit.offset, bytes: edit.bytes });
    }
  }
  return out;
}

/**
 * Plan a clip for sending. `read(offset, length)` answers a Promise of a
 * Uint8Array of exactly `length` bytes, never asked past `size`. Answers
 * { error } for a clip the site does not take:
 *
 *   'not-clip'    neither an ftyp nor a box QuickTime opens with first, a
 *                 HEIF or AVIF brand (a photo), or no moov or mdat
 *   'fragmented'  moov/mvex, or a fragment's box at the top level
 *   'malformed'   a box past its parent or the file, a box under 8 bytes in
 *                 a kept box, sample tables that cannot be read, a sample
 *                 outside the media data, a duration or timescale of 0
 *   'too-big'     a moov over MOOV_MAX
 *   'no-video'    no kept video track
 *   'codec'       a kept track's sample entry off the lists
 *   'external'    a dref entry that names another file
 *
 * or what to send: { contentType, durationMs, width, height, recordedAt,
 * bytes, edits }. `bytes` is the length to send, where the last whole
 * top-level box ends. `edits` are sorted, never overlap, and lie inside
 * [0, bytes): { offset, bytes } puts those bytes there (a type becoming
 * free), and { offset, zeros } puts that many zeros. width and height are the
 * first video track's, turned as it is shown; recordedAt is mvhd's creation
 * time in Unix seconds, or null when it holds none, for the page to judge.
 */
export async function planClip(read, size) {
  try {
    const clip = await readClip(read, size);
    const edits = clip.m.edits.slice();
    clip.boxes.forEach((box, index) => {
      const rule = topRule(box, index);
      if (rule === 'blank') edits.push({ offset: box.start + 4, bytes: freeType() });
      if (rule === 'blank' || rule === 'zero') edits.push({ offset: box.start + box.head, zeros: box.end - box.start - box.head });
    });
    for (const trakBox of clip.m.blanked) {
      eachChunk(clip.m.buf, blankedTables(clip.m.buf, trakBox), (from, to) => {
        if (to <= from) return;
        if (!inMdat(clip.mdats, from, to)) refuse('malformed');
        edits.push({ offset: from, zeros: to - from });
      });
    }
    return {
      contentType: clip.contentType,
      durationMs: clip.durationMs,
      width: clip.width,
      height: clip.height,
      recordedAt: clip.created === 0 ? null : clip.created - SINCE_1904,
      bytes: clip.end,
      edits: settle(edits),
    };
  } catch (error) {
    if (error instanceof Refusal) return { error: error.error };
    throw error;
  }
}

/** Whether every byte is zero, four at a time where the bytes are aligned for it. */
function allZero(bytes) {
  let i = 0;
  if (bytes.byteOffset % 4 === 0) {
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2);
    for (let w = 0; w < words.length; w++) if (words[w] !== 0) return false;
    i = words.length << 2;
  }
  for (; i < bytes.length; i++) if (bytes[i] !== 0) return false;
  return true;
}

/**
 * The server's check of a stored clip (`read` = ranged reads of the object):
 * planClip's walk again, which must find nothing left to edit. Answers
 * { contentType, durationMs, width, height }, or { error }: planClip's, or
 *
 *   'kept'        a box outside the keep-list still holds data, or a field
 *                 planClip zeroes is not zero
 *   'unchecked'   more top-level free or skip content than FREE_CHECK_MAX
 *   'trailing'    bytes after the last box
 *
 * It reads top-level headers 16 bytes at a time, the ftyp's brands, the moov
 * whole and the contents of top-level free and skip boxes, a MiB at a time;
 * never the media data.
 */
export async function checkClip(read, size) {
  try {
    const clip = await readClip(read, size);
    let kept = clip.m.edits.length > 0 || clip.m.blanked.length > 0;
    const frees = [];
    clip.boxes.forEach((box, index) => {
      const rule = topRule(box, index);
      if (rule === 'blank') kept = true;
      else if (rule === 'zero') frees.push(box);
    });
    if (kept) return { error: 'kept' };
    const freeBytes = frees.reduce((sum, box) => sum + (box.end - box.start - box.head), 0);
    if (freeBytes > FREE_CHECK_MAX) return { error: 'unchecked' };
    for (const box of frees) {
      for (let at = box.start + box.head; at < box.end; at += FREE_READ) {
        if (!allZero(await readExactly(read, at, Math.min(FREE_READ, box.end - at)))) return { error: 'kept' };
      }
    }
    if (clip.end !== size) return { error: 'trailing' };
    return { contentType: clip.contentType, durationMs: clip.durationMs, width: clip.width, height: clip.height };
  } catch (error) {
    if (error instanceof Refusal) return { error: error.error };
    throw error;
  }
}

/**
 * The pieces of part `n` (from 1) of a planned clip, in order: { from, to }
 * for a range of the file as it is, and a Uint8Array for an edit's bytes,
 * a zero run made new for this part alone. The page sends
 * new Blob(pieces.map((p) => (ArrayBuffer.isView(p) ? p : file.slice(p.from, p.to)))),
 * so a part never holds more than PART_BYTES in memory. ArrayBuffer.isView,
 * not instanceof Uint8Array: the byte arrays are made in this module's
 * realm, which a caller's need not be (the share page's tests run it in
 * node:vm, where instanceof is false and the whole file would go per edit). Part n covers
 * [(n - 1) * PART_BYTES, min(n * PART_BYTES, plan.bytes)).
 */
export function partPieces(plan, n) {
  const parts = partCount(plan.bytes);
  if (!Number.isInteger(n) || n < 1 || n > parts) throw new RangeError(`clip.js: a clip in ${parts} parts has no part ${n}`);
  const from = (n - 1) * PART_BYTES;
  const to = Math.min(n * PART_BYTES, plan.bytes);
  const { edits } = plan;
  const lengthOf = (edit) => (edit.zeros !== undefined ? edit.zeros : edit.bytes.length);
  // The first edit ending after the part starts.
  let lo = 0;
  let hi = edits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edits[mid].offset + lengthOf(edits[mid]) <= from) lo = mid + 1;
    else hi = mid;
  }
  const pieces = [];
  let at = from;
  for (let i = lo; i < edits.length && edits[i].offset < to; i++) {
    const edit = edits[i];
    const start = Math.max(edit.offset, from);
    const end = Math.min(edit.offset + lengthOf(edit), to);
    if (start > at) pieces.push({ from: at, to: start });
    pieces.push(edit.zeros !== undefined ? new Uint8Array(end - start) : edit.bytes.subarray(start - edit.offset, end - edit.offset));
    at = end;
  }
  if (at < to) pieces.push({ from: at, to });
  return pieces;
}

if (typeof window !== 'undefined') window.MadcowClip = Object.freeze({ PART_BYTES, partCount, partPieces, planClip });
