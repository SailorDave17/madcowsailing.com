// MP4 and MOV fixtures for the clip walker's tests (#198), built here byte by
// byte so the tests need no video file and no recording of anyone. Not a
// test file: npm test runs only *.test.js.
//
// Each is shaped like what one kind of camera writes, read from real
// originals for #198 (iPhone MOVs, a Nokia's and another Android phone's
// MP4, four GoPros'): the same boxes in the same places, the same handler
// names and vendor codes. ExifTool 13.59 reads every planted tag back out of
// them (GPS, make, model, software, lens, firmware, serial, the GPMF device
// and its fixes), so they are the shapes it knows. Their media is not real: a
// "frame" is a run of one byte value, so a test can tell the media kept from
// the data blanked.
//
// Every position is FICTIONAL: +12.3456+065.4321/ is the open Arabian Sea,
// about 1,000 km from the nearest coast, where nobody's child was filmed.
// Every make, model, lens, serial number and firmware is invented too.

/**
 * Bytes from parts in order: a number is one byte, a string one byte a
 * character (Latin-1, so © is 0xA9 as in ©xyz), a byte array itself, and an
 * array its own parts.
 */
export function bytes(...parts) {
  const chunks = parts.map((part) => {
    if (typeof part === 'number') return Uint8Array.of(part);
    if (typeof part === 'string') return Uint8Array.from(part, (c) => c.charCodeAt(0));
    if (part instanceof Uint8Array) return part;
    return bytes(...part);
  });
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export const be16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
export const be24 = (n) => [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
export const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
export const be64 = (n) => [...be32(Math.floor(n / 2 ** 32)), ...be32(n % 2 ** 32)];
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const utf8 = (text) => new TextEncoder().encode(text);

/** A box: its 32-bit size, its type, its contents. */
export function box(type, ...contents) {
  const body = bytes(...contents);
  return bytes(be32(8 + body.length), type, body);
}

/** A box with a 64-bit size: 1 where the size goes, the size after the type. */
export function largeBox(type, ...contents) {
  const body = bytes(...contents);
  return bytes(be32(1), type, be64(16 + body.length), body);
}

/** A full box: its contents start with a version byte and 24 bits of flags. */
export const fullBox = (type, version, flags, ...contents) => box(type, version, be24(flags), ...contents);

export const ftyp = (major, ...compatible) => box('ftyp', major, be32(0), ...compatible);

// ---- Times, as QuickTime counts them (seconds since 1904) -------------------

export const SINCE_1904 = 2082844800;

/** When the fixtures were "recorded": 2026-07-04 10:11:12 UTC, in Unix seconds. */
export const RECORDED = Date.UTC(2026, 6, 4, 10, 11, 12) / 1000;

// Each header's creation and modification time is its own value, so a test
// can find each by its bytes: mvhd's is RECORDED itself, the rest a few
// seconds after.
const at1904 = (offset) => RECORDED + SINCE_1904 + offset;

/** The creation and modification times the fixtures plant, by header. */
export const TIMES = Object.freeze({
  mvhd: [at1904(0), at1904(1)],
  tkhd: [at1904(2), at1904(3)],
  mdhd: [at1904(4), at1904(5)],
});

// ---- Headers --------------------------------------------------------------

export const MATRIX = Object.freeze({
  upright: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
  // A quarter turn, as an iPhone held upright writes it: a = 0, b = 1,
  // c = -1, d = 0, then the move back into view.
  turned: [0, 0x10000, 0, -0x10000, 0, 0, 1080 * 0x10000, 0, 0x40000000],
  turned270: [0, -0x10000, 0, 0x10000, 0, 0, 0, 1920 * 0x10000, 0x40000000],
  upsideDown: [-0x10000, 0, 0, 0, -0x10000, 0, 1920 * 0x10000, 1080 * 0x10000, 0x40000000],
});

const times = (version, [created, modified]) => (version === 1 ? [be64(created), be64(modified)] : [be32(created), be32(modified)]);
const wide = (version, n) => (version === 1 ? be64(n) : be32(n));

export function mvhd({ version = 0, time = TIMES.mvhd, timescale = 600, duration = 2700, nextTrack = 5 } = {}) {
  return fullBox('mvhd', version, 0, times(version, time), be32(timescale), wide(version, duration),
    be32(0x10000), be16(0x100), new Uint8Array(10), MATRIX.upright.map(be32), new Uint8Array(24), be32(nextTrack));
}

export function tkhd({
  version = 0, time = TIMES.tkhd, id = 1, duration = 2700, matrix = MATRIX.upright, width = 0, height = 0, volume = 0,
} = {}) {
  return fullBox('tkhd', version, 3, times(version, time), be32(id), be32(0), wide(version, duration), new Uint8Array(8),
    be16(0), be16(0), be16(volume), be16(0), matrix.map(be32), be32(Math.round(width * 0x10000)),
    be32(Math.round(height * 0x10000)));
}

export function mdhd({ version = 0, time = TIMES.mdhd, timescale = 600, duration = 2700 } = {}) {
  return fullBox('mdhd', version, 0, times(version, time), be32(timescale), wide(version, duration), be16(0x55c4), be16(0));
}

/**
 * A handler: QuickTime's (a component type, a manufacturer, a counted name),
 * which Apple and GoPro write, or ISO's (zeros, then a name ending in 0),
 * which Android writes.
 */
export function hdlr(handler, { component = '\0\0\0\0', manufacturer = '\0\0\0\0', name = '', counted = false } = {}) {
  return fullBox('hdlr', 0, 0, component, handler, manufacturer, be32(0), be32(0),
    counted ? [name.length, name] : [name, 0]);
}

export const vmhd = () => fullBox('vmhd', 0, 1, new Uint8Array(8));
export const smhd = () => fullBox('smhd', 0, 0, new Uint8Array(4));
export const gmhd = () => box('gmhd', fullBox('gmin', 0, 0, be16(0x40), new Uint8Array(6), be16(0), be16(0)));

/** A data reference entry: flag 1 says the media is in this file. */
export const reference = (type = 'url ', flags = 1, ...data) => fullBox(type, 0, flags, ...data);
export const dinf = (...entries) => box('dinf', fullBox('dref', 0, 0, be32(entries.length), ...entries));

export const edts = (duration = 2700) => box('edts', fullBox('elst', 0, 0, be32(1), be32(duration), be32(0), be32(0x10000)));

// ---- Sample entries and tables ------------------------------------------------

/**
 * A video sample entry (86 bytes before its own boxes): the vendor at entry
 * bytes 20 to 24, the coded size at 32, the counted compressor name at 50 to
 * 82.
 */
export function videoEntry(format, { vendor = '\0\0\0\0', width = 1920, height = 1080, compressor = '', extra = [] } = {}) {
  return box(format, new Uint8Array(6), be16(1), be16(0), be16(0), vendor, be32(0), be32(0), be16(width), be16(height),
    be32(0x480000), be32(0x480000), be32(0), be16(1), compressor.length, compressor, new Uint8Array(31 - compressor.length),
    be16(24), be16(0xffff), ...extra);
}

/** A sound sample entry (36 bytes before its own boxes): version and revision at 16 to 20, the vendor at 20 to 24. */
export function audioEntry(format, { vendor = '\0\0\0\0', version = 0, channels = 2, bits = 16, rate = 48000, extra = [] } = {}) {
  return box(format, new Uint8Array(6), be16(1), be16(version), be16(0), vendor, be16(channels), be16(bits), be16(0), be16(0),
    be32(rate * 0x10000), ...extra);
}

/** Any other sample entry: the reserved bytes and data reference index, then its own contents. */
export const plainEntry = (format, ...contents) => box(format, new Uint8Array(6), be16(1), ...contents);

// Codec setup boxes, opaque to the walker; their bytes are not real setup.
export const hvcC = () => box('hvcC', 1, new Uint8Array(22));
export const avcC = () => box('avcC', 1, 0x64, 0, 0x28, 0xff, 0xe1, be16(4), 0x67, 0x64, 0, 0x28, 1, be16(4), 0x68, 0xee, 0x3c, 0x80);
export const esds = () => fullBox('esds', 0, 0, 0x03, 0x19, be16(0), 0, 0x04, 0x11, 0x40, 0x15, new Uint8Array(15));

/** Sample-to-chunk runs, each [first chunk, samples a chunk, description]. */
export const stsc = (...runs) => fullBox('stsc', 0, 0, be32(runs.length), runs.map(([first, per, entry = 1]) => [be32(first), be32(per), be32(entry)]));
/** Sample sizes, one each; or with `uniform`, one size for `count` samples. */
export const stsz = (sizes, { uniform = 0, count = sizes.length } = {}) => (uniform
  ? fullBox('stsz', 0, 0, be32(uniform), be32(count))
  : fullBox('stsz', 0, 0, be32(0), be32(count), sizes.map(be32)));
/** Compact sample sizes, `bits` (4, 8 or 16) each; at 4 the first of a pair is the high half. */
export function stz2(bits, sizes) {
  const packed = bits === 4
    ? Array.from({ length: Math.ceil(sizes.length / 2) }, (_, i) => (sizes[2 * i] << 4) | (sizes[2 * i + 1] || 0))
    : sizes.flatMap((s) => (bits === 16 ? be16(s) : [s]));
  return fullBox('stz2', 0, 0, 0, 0, 0, bits, be32(sizes.length), packed);
}
export const stco = (offsets, count = offsets.length) => fullBox('stco', 0, 0, be32(count), offsets.map(be32));
export const co64 = (offsets) => fullBox('co64', 0, 0, be32(offsets.length), offsets.map(be64));

// ---- Metadata --------------------------------------------------------------

/**
 * A QuickTime metadata box as an iPhone or Android writes it: no version and
 * flags, a handler of 'mdta', the keys, then one item a key, each a UTF-8
 * 'data' box.
 */
export function mdtaMeta(entries) {
  const pairs = Object.entries(entries);
  return box('meta',
    hdlr('mdta'),
    fullBox('keys', 0, 0, be32(pairs.length), pairs.map(([key]) => box('mdta', key))),
    box('ilst', pairs.map(([, value], i) => box(be32(i + 1), box('data', be32(1), be32(0), utf8(value))))));
}

/** User data with a position, as a phone writes ©xyz: a counted string and a language. */
export const xyz = (position) => box('©xyz', be16(position.length), be16(0x15c7), position);

/** One GPMF entry: a key, a type, a size and repeat, then the data padded to 4 bytes. */
export function klv(key, type, size, repeat, ...data) {
  const body = bytes(...data);
  return bytes(key, type, size, be16(repeat), body, new Uint8Array((4 - (body.length % 4)) % 4));
}

// The fixtures' one fictional fix, as GPMF's GPS5 holds it: latitude and
// longitude in 1e-7 degrees, height in mm, two speeds in mm/s.
export const GPS5_FIX = bytes(be32(123456000), be32(654321000), be32(12000), be32(1500), be32(1600));

/** A GPMF payload as a GoPro's metadata track holds it: the device, its name, a GPS stream with its scales. */
export function gpmf(fixes = 2) {
  const stream = bytes(
    klv('STNM', 'c', 1, 17, 'GPS (Lat., Long.)'),
    klv('SCAL', 'l', 4, 5, be32(10000000), be32(10000000), be32(1000), be32(1000), be32(1000)),
    klv('GPS5', 'l', 20, fixes, Array.from({ length: fixes }, () => GPS5_FIX)));
  const device = bytes(klv('DVID', 'L', 4, 1, be32(1)), klv('DVNM', 'c', 1, 15, 'FictionCam HERO'),
    klv('STRM', 0, 1, stream.length, stream));
  return klv('DEVC', 0, 1, device.length, device);
}

/** The XMP box's usertype, which ISO 16684 gives video. */
export const XMP_UUID = Uint8Array.of(0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac);

/** A top-level uuid box of XMP with the fictional position and camera. */
export const xmpBox = () => box('uuid', XMP_UUID, utf8(
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description exif:GPSLatitude="12,20.736N" exif:GPSLongitude="65,25.926E" tiff:Make="FictionCo" ' +
  'tiff:Model="Fiction 7a"/></rdf:RDF></x:xmpmeta>'));

/**
 * A raw trailer after the last box, as an Insta360 keeps its records: binary
 * that reads as no box type, a fictional fix as two little-endian doubles and
 * a serial, then the footer's length and the magic string ExifTool looks for.
 */
export function rawTrailer() {
  const fix = new Uint8Array(new Float64Array([12.3456, 65.4321]).buffer);
  const records = bytes(0x01, 0x02, 0x81, 0x00, 0x9a, 0x88, 0x01, 0x07, fix, 'IXS9F1CT10N0', 0x00, 0x02);
  return bytes(records, le32(records.length + 40), be32(3), '8db42d694ccc418790edff439fe026bf');
}

// ---- A whole clip -------------------------------------------------------

/** `count` samples of `size` bytes, each all `fill`: media a test checks is kept. */
export const frames = (count, size, fill) => Array.from({ length: count }, () => new Uint8Array(size).fill(fill));

/**
 * One trak. `samples` go `perChunk` to a chunk, and `chunks` says where each
 * chunk starts in the file. The tables say so: stsc in one run (two when the
 * last chunk is short), stsz (uniform when every sample is one size and
 * `uniform` is set; stz2 when `stz2` gives a field width), stco (co64 with
 * `co64`). `tables(chunks)` replaces those three, for a test that needs them
 * wrong.
 */
function trakBox(t, chunks) {
  const sizes = t.samples.map((s) => s.length);
  const runs = sizes.length ? [[1, t.perChunk]] : [];
  const short = sizes.length % t.perChunk;
  if (short && chunks.length > 1) runs.push([chunks.length, short]);
  else if (short) runs[0][1] = short;
  let sizeTable;
  if (t.stz2) sizeTable = stz2(t.stz2, sizes);
  else if (t.uniform && sizes.length && sizes.every((s) => s === sizes[0])) sizeTable = stsz([], { uniform: sizes[0], count: sizes.length });
  else sizeTable = stsz(sizes);
  const tables = t.tables ? t.tables(chunks) : [stsc(...runs), sizeTable, t.co64 ? co64(chunks) : stco(chunks)];
  const stbl = box('stbl',
    fullBox('stsd', 0, 0, be32(t.entries.length), ...t.entries),
    fullBox('stts', 0, 0, be32(1), be32(sizes.length), be32(t.delta)),
    ...tables, ...t.stbl);
  const minf = box('minf', t.mediaHeader, ...(t.dataHandler ? [t.dataHandler] : []), t.dinf, stbl, ...t.minf);
  const mdia = box('mdia', t.mdhdBox || mdhd(t.mdhd), t.hdlr, minf, ...t.mdia);
  return box('trak', t.tkhdBox || tkhd(t.tkhd), ...t.trak, ...(t.edts ? [edts()] : []), mdia, ...t.after, t.remainder);
}

const TRACK = {
  perChunk: 1, delta: 100, uniform: false, stz2: 0, co64: false, edts: false, before: 0, dataHandler: null,
  mediaHeader: vmhd(), dinf: dinf(reference('url ')), trak: [], after: [], mdia: [], minf: [], stbl: [],
  remainder: new Uint8Array(0),
};

/**
 * A whole clip. `top` lists the top-level boxes in order: 'ftyp', 'moov' and
 * 'mdat' stand for the clip's own, and a byte array is placed as it is. The
 * tracks' samples go into mdat one track after another, `before` zero bytes
 * ahead of each track's and `tail` zero bytes after the last, and every chunk
 * offset is written to match. `mdat` is 'small' (a 32-bit size), 'large' (64)
 * or 'toEnd' (size 0, so it runs to the end of the file). Answers the file and
 * where each track's samples sit: [{ handler, ranges: [[from, to], …] }].
 */
export function clip({
  brand = ftyp('mp42', 'isom', 'mp42'), movie = mvhd(), tracks, moov = [], moovRemainder = new Uint8Array(0),
  top = ['ftyp', 'moov', 'mdat'], mdat = 'small', tail = 0, trailer = new Uint8Array(0),
}) {
  const specs = tracks.map((t) => ({ ...TRACK, ...t }));
  // Where each sample sits in mdat's contents.
  let at = 0;
  const placed = specs.map((t) => {
    at += t.before;
    return t.samples.map((s) => {
      const range = [at, at + s.length];
      at += s.length;
      return range;
    });
  });
  const payload = new Uint8Array(at + tail);
  specs.forEach((t, i) => t.samples.forEach((s, j) => payload.set(s, placed[i][j][0])));
  const mdatHead = mdat === 'large' ? bytes(be32(1), 'mdat', be64(16 + payload.length))
    : bytes(be32(mdat === 'toEnd' ? 0 : 8 + payload.length), 'mdat');

  const build = (base) => box('moov', movie,
    ...specs.map((t, i) => trakBox(t, placed[i].filter((_, j) => j % t.perChunk === 0).map(([from]) => base + from))),
    ...moov, moovRemainder);
  // The moov's length does not depend on the offsets it holds, so build it
  // once to place mdat, then again with the offsets.
  const lengths = top.map((part) => (part === 'ftyp' ? brand.length : part === 'moov' ? build(0).length
    : part === 'mdat' ? mdatHead.length + payload.length : part.length));
  const base = lengths.slice(0, Math.max(0, top.indexOf('mdat'))).reduce((n, l) => n + l, 0) + mdatHead.length;
  const moovBox = build(base);
  const file = bytes(...top.map((part) => (part === 'ftyp' ? brand : part === 'moov' ? moovBox
    : part === 'mdat' ? bytes(mdatHead, payload) : part)), trailer);
  // The handler type sits at hdlr bytes 16 to 20.
  const media = specs.map((t, i) => ({
    handler: String.fromCharCode(...t.hdlr.subarray(16, 20)),
    ranges: placed[i].map(([from, end]) => [base + from, base + end]),
  }));
  return { file, media };
}

// ---- Three cameras --------------------------------------------------------

/**
 * Every planted header time, by header and field, as 32 bits: at version 1
 * the same time is written in 64, whose low half these are.
 */
function timedPlants() {
  const out = {};
  for (const [name, [created, modified]] of Object.entries(TIMES)) {
    out[`${name} creation time`] = be32(created);
    out[`${name} modification time`] = be32(modified);
  }
  return out;
}

/**
 * An iPhone-shaped MOV: ftyp qt, wide, mdat, moov last; a quarter-turned HEVC
 * track with its lens in its own meta, an AAC track, a timed-metadata (mebx)
 * track described by the video (tref cdsc) whose samples sit in mdat, and the
 * movie's meta of mdta keys: location, make, model, software, creation date.
 * QuickTime handlers named "Core Media …" by 'appl', and the vendor 'appl' in
 * each sample entry. `version` writes the headers at version 1.
 */
export function iphoneMov({ version = 0, clip: options = {} } = {}) {
  const apple = { component: 'mhlr', manufacturer: 'appl', counted: true };
  const dataHandler = hdlr('alis', { component: 'dhlr', manufacturer: 'appl', name: 'Core Media Data Handler', counted: true });
  const alias = dinf(reference('alis'));
  const tracks = [
    {
      tkhd: { version, id: 1, matrix: MATRIX.turned, width: 1920, height: 1080 },
      mdhd: { version },
      trak: [box('tapt', fullBox('clef', 0, 0, be32(1080 * 0x10000), be32(1920 * 0x10000)))],
      edts: true,
      hdlr: hdlr('vide', { ...apple, name: 'Core Media Video' }),
      mediaHeader: vmhd(), dataHandler, dinf: alias,
      entries: [videoEntry('hvc1', { vendor: 'appl', compressor: 'HEVC', extra: [hvcC()] })],
      samples: frames(6, 40, 0x56), perChunk: 2,
      after: [mdtaMeta({ 'com.apple.quicktime.camera.lens_model': 'FictionPhone 9 Pro back camera 6.86mm f/1.78' })],
    },
    {
      tkhd: { version, id: 2, volume: 0x100 },
      mdhd: { version },
      edts: true,
      hdlr: hdlr('soun', { ...apple, name: 'Core Media Audio' }),
      mediaHeader: smhd(), dataHandler, dinf: alias,
      entries: [audioEntry('mp4a', { vendor: 'appl', extra: [esds()] })],
      samples: frames(4, 24, 0x41), perChunk: 4, uniform: true,
    },
    {
      tkhd: { version, id: 3 },
      mdhd: { version },
      trak: [box('tref', box('cdsc', be32(1)))],
      hdlr: hdlr('meta', { ...apple, name: 'Core Media Metadata' }),
      mediaHeader: gmhd(), dataHandler, dinf: alias,
      entries: [plainEntry('mebx', box('keys', box(be32(1), box('keyd', 'mdta', 'com.apple.quicktime.location.ISO6709'))))],
      samples: [bytes(be32(26), be32(1), '+12.3457+065.4322/'), bytes(be32(30), be32(1), 'FictionPhone face 0x51')],
    },
  ];
  const { file, media } = clip({
    brand: ftyp('qt  ', 'qt  '),
    movie: mvhd({ version }),
    top: ['ftyp', box('wide'), 'mdat', 'moov'],
    tracks,
    moov: [mdtaMeta({
      'com.apple.quicktime.location.ISO6709': '+12.3456+065.4321/',
      'com.apple.quicktime.make': 'Fictional Phones Ltd',
      'com.apple.quicktime.model': 'FictionPhone 9 Pro',
      'com.apple.quicktime.software': 'FictionOS 19.4.1',
      'com.apple.quicktime.creationdate': '2026-07-04T14:11:12+0400',
    })],
    ...options,
  });
  return {
    file, media,
    planted: {
      location: '+12.3456+065.4321/', make: 'Fictional Phones Ltd', model: 'FictionPhone 9 Pro', software: 'FictionOS 19.4.1',
      'creation date': '2026-07-04T14:11:12+0400', 'lens model': 'back camera 6.86mm f/1.78', 'metadata keys': 'com.apple.quicktime',
      'timed location': '+12.3457+065.4322/', 'timed face': 'FictionPhone face', 'manufacturer and vendor': 'appl',
      'video handler name': 'Core Media Video', 'audio handler name': 'Core Media Audio',
      'metadata handler name': 'Core Media Metadata', 'data handler name': 'Core Media Data Handler', 'compressor name': 'HEVC',
      ...timedPlants(),
    },
  };
}

/**
 * An Android-shaped MP4: moov first, a ©xyz in udta, com.android keys in a
 * QuickTime meta, a free box after moov filled with ASCII '0' as Android's
 * writer leaves the room it kept for moov, a box of type 0 as the media
 * provider's redaction leaves, then mdat. ISO handlers named "VideoHandle"
 * and "SoundHandle".
 */
export function androidMp4({ version = 0, clip: options = {} } = {}) {
  const tracks = [
    {
      tkhd: { version, id: 1, width: 1920, height: 1080 },
      mdhd: { version },
      hdlr: hdlr('vide', { name: 'VideoHandle' }),
      mediaHeader: vmhd(),
      entries: [videoEntry('avc1', { extra: [avcC()] })],
      samples: frames(5, 32, 0x56), perChunk: 3,
    },
    {
      tkhd: { version, id: 2, volume: 0x100 },
      mdhd: { version },
      hdlr: hdlr('soun', { name: 'SoundHandle' }),
      mediaHeader: smhd(),
      entries: [audioEntry('mp4a', { extra: [esds()] })],
      samples: frames(3, 20, 0x41),
    },
  ];
  const { file, media } = clip({
    movie: mvhd({ version, timescale: 1000, duration: 4500 }),
    top: ['ftyp', 'moov', box('free', '0'.repeat(64)), box('\0\0\0\0', 'redacted record: Fiction 7a'), 'mdat'],
    tracks,
    moov: [
      box('udta', xyz('+12.3456+065.4321/')),
      mdtaMeta({
        'com.android.version': 'FictionOS 14.0.1',
        'com.android.capture.fps': '30.000000',
        'com.android.manufacturer': 'FictionCo',
        'com.android.model': 'Fiction 7a',
      }),
    ],
    ...options,
  });
  return {
    file, media,
    planted: {
      location: '+12.3456+065.4321/', 'android keys': 'com.android.', software: 'FictionOS 14.0.1', make: 'FictionCo',
      model: 'Fiction 7a', 'free filled with 0': '0'.repeat(16), 'redacted box': 'redacted record',
      'video handler name': 'VideoHandle', 'sound handler name': 'SoundHandle',
      ...timedPlants(),
    },
  };
}

// A fictional camera serial number, as CAME holds 16 bytes of one.
const CAMERA_SERIAL = Uint8Array.from({ length: 16 }, (_, i) => 0xc1 + i);

/**
 * A GoPro-shaped MP4: mdat before moov; udta with FIRM, LENS, CAME and GPMF; a
 * timecode track and a metadata track (stsd gpmd) whose samples in mdat hold
 * GPMF with a fictional GPS5 fix; QuickTime handlers named "GoPro …" and the
 * compressor "GoPro AVC encoder". `meta` changes the metadata track's spec.
 */
export function goproMp4({ version = 0, meta = {}, clip: options = {} } = {}) {
  const gopro = (handler, name) => hdlr(handler, { component: 'mhlr', name, counted: true });
  const alias = dinf(reference('alis'));
  const tracks = [
    {
      tkhd: { version, id: 1, width: 1920, height: 1080 },
      mdhd: { version },
      trak: [box('tref', box('tmcd', be32(3)))],
      edts: true,
      hdlr: gopro('vide', 'GoPro AVC'),
      mediaHeader: vmhd(), dinf: alias,
      entries: [videoEntry('avc1', { compressor: 'GoPro AVC encoder', extra: [avcC()] })],
      samples: frames(4, 48, 0x56),
    },
    {
      tkhd: { version, id: 2, volume: 0x100 },
      mdhd: { version },
      trak: [box('tref', box('tmcd', be32(3)))],
      hdlr: gopro('soun', 'GoPro AAC'),
      mediaHeader: smhd(), dinf: alias,
      entries: [audioEntry('mp4a', { extra: [esds()] })],
      samples: frames(4, 16, 0x41),
    },
    {
      tkhd: { version, id: 3 },
      mdhd: { version },
      hdlr: gopro('tmcd', 'GoPro TCD'),
      mediaHeader: gmhd(), dinf: alias,
      entries: [plainEntry('tmcd', be32(0), be32(2), be32(30000), be32(1001), 30, 0)],
      samples: [bytes(0x46, 0x43, 0x54, 0x43)], uniform: true,
    },
    {
      tkhd: { version, id: 4 },
      mdhd: { version },
      hdlr: gopro('meta', 'GoPro MET'),
      mediaHeader: gmhd(), dinf: alias,
      entries: [plainEntry('gpmd', be32(0))],
      samples: [gpmf(2), gpmf(3)],
      ...meta,
    },
  ];
  const { file, media } = clip({
    brand: ftyp('mp41', 'mp41'),
    movie: mvhd({ version, timescale: 1000, duration: 2002 }),
    top: ['ftyp', 'mdat', 'moov'],
    tracks,
    moov: [
      box('udta', box('FIRM', 'FX1.23.456'), box('LENS', 'FL98765'), box('CAME', CAMERA_SERIAL), box('GPMF', gpmf(1))),
      fullBox('iods', 0, 0, 0x10, 0x07, be16(0x004f), 0xff, 0xff, 0x29, 0xff, 0xff),
    ],
    ...options,
  });
  return {
    file, media,
    planted: {
      firmware: 'FX1.23.456', lens: 'FL98765', 'camera serial': CAMERA_SERIAL, 'device name': 'FictionCam HERO',
      'GPS5 fix': GPS5_FIX.subarray(0, 8), 'video handler name': 'GoPro AVC', 'sound handler name': 'GoPro AAC',
      'timecode handler name': 'GoPro TCD', 'metadata handler name': 'GoPro MET', 'compressor name': 'GoPro AVC encoder',
      ...timedPlants(),
    },
  };
}

/**
 * A minimal clip to vary one thing at a time: ftyp, moov with one video track
 * (one sample) and one sound track, then mdat. Nothing in it needs blanking:
 * its times are zero and its names empty. `video` and `sound` change a
 * track's spec, `only` keeps one ('video' or 'sound'), `tracks` adds more
 * after them, and `clip` changes the file's.
 */
export function plainClip({ video = {}, sound = {}, only = null, tracks: more = [], clip: options = {} } = {}) {
  const zero = [0, 0];
  const tracks = {
    video: {
      tkhd: { id: 1, time: zero, width: 640, height: 360 }, mdhd: { time: zero },
      hdlr: hdlr('vide'), mediaHeader: vmhd(),
      entries: [videoEntry('avc1', { width: 640, height: 360, extra: [avcC()] })],
      samples: frames(1, 16, 0x56),
      ...video,
    },
    sound: {
      tkhd: { id: 2, time: zero, volume: 0x100 }, mdhd: { time: zero },
      hdlr: hdlr('soun'), mediaHeader: smhd(),
      entries: [audioEntry('mp4a', { extra: [esds()] })],
      samples: frames(1, 8, 0x41),
      ...sound,
    },
  };
  return clip({
    movie: mvhd({ time: zero }),
    tracks: [...(only ? [tracks[only]] : [tracks.video, tracks.sound]), ...more],
    ...options,
  });
}

/** A timed-metadata track for plainClip's `tracks`: handler 'meta', its samples in mdat, blanked by the walker. */
export const metaTrack = (samples, spec = {}) => ({
  tkhd: { id: 9, time: [0, 0] }, mdhd: { time: [0, 0] }, hdlr: hdlr('meta'), mediaHeader: gmhd(),
  entries: [plainEntry('gpmd', be32(0))], samples, ...spec,
});
