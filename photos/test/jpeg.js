// JPEG fixtures for the upload tests (#154), built here byte by byte so the
// tests need no image library and no photo of anyone. Not a test file: npm
// test runs only *.test.js.
//
// jpeg() makes a real baseline JPEG of any size: one flat grey, each 8x8
// block coded as "no change, end of block" with one-code Huffman tables. A
// decoder opens it (checked with Pillow at #154's pickup, 2026-09-29), and
// its size costs 2 bits a block per component: 57,750 bytes at 2560x1920,
// 2,175 at 480x360.
//
// exif() makes the APP1 block a phone writes, with a camera make and a GPS
// position. The position is FICTIONAL: 12°34'56.78" N, 123°45'6.7" W is open
// Pacific, about 1,300 km off Mexico, where nobody's child was photographed.

const bytes = (...parts) => {
  const flat = parts.flatMap((p) => (typeof p === 'number' ? [p] : [...p]));
  return Uint8Array.from(flat);
};
const be16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const ascii = (text) => [...new TextEncoder().encode(text)];

/** A segment: 0xFF, the marker, the length (payload + 2), the payload. */
export const segment = (marker, payload) => bytes(0xff, marker, be16(payload.length + 2), payload);

/** A flat grey baseline JPEG, width x height, 3 components (or any other count, for a refusal). */
export function jpeg({ width, height, components = 3 }) {
  const ids = Array.from({ length: components }, (_, i) => i + 1);
  const dqt = segment(0xdb, bytes(0x00, new Array(64).fill(1)));
  const sof = segment(0xc0, bytes(8, be16(height), be16(width), ids.length, ids.flatMap((id) => [id, 0x11, 0])));
  // One code of length 1 each: DC category 0, and AC end-of-block.
  const counts = [1, ...new Array(15).fill(0)];
  const dhtDc = segment(0xc4, bytes(0x00, counts, 0x00));
  const dhtAc = segment(0xc4, bytes(0x10, counts, 0x00));
  const sos = segment(0xda, bytes(ids.length, ids.flatMap((id) => [id, 0x00]), 0, 63, 0));
  // 2 zero bits a block, every component's block in each MCU, then the last
  // byte padded with 1s. The data holds no 0xFF, so nothing needs stuffing.
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8) * ids.length;
  const bits = blocks * 2;
  const data = new Uint8Array(Math.ceil(bits / 8));
  if (bits % 8) data[data.length - 1] = 0xff >> (bits % 8);
  return bytes([0xff, 0xd8], dqt, sof, dhtDc, dhtAc, sos, data, [0xff, 0xd9]);
}

/** `image` with `segments` placed straight after its start-of-image marker. */
export const withSegments = (image, ...segments) => bytes(image.subarray(0, 2), ...segments, image.subarray(2));

/** `image` with `tail` after its end-of-image marker, as a motion photo keeps its video. */
export const withTrailer = (image, tail) => bytes(image, tail);

// TIFF types.
const ASCII = 2;
const BYTE = 1;
const LONG = 4;
const RATIONAL = 5;
const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

// An IFD at `offset` from the TIFF header: entries whose values fit in four
// bytes sit inline, and the rest follow the IFD in order.
function ifd(offset, entries) {
  const head = 2 + entries.length * 12 + 4;
  let extra = [];
  const table = [...le16(entries.length)];
  for (const { tag, type, count, value } of entries) {
    table.push(...le16(tag), ...le16(type), ...le32(count));
    if (value.length <= 4) table.push(...value, ...new Array(4 - value.length).fill(0));
    else {
      table.push(...le32(offset + head + extra.length));
      extra = [...extra, ...value];
    }
  }
  table.push(...le32(0));
  return [...table, ...extra];
}

const rationals = (...pairs) => pairs.flatMap(([n, d]) => [...le32(n), ...le32(d)]);

/** The APP1 EXIF segment a phone writes: IFD0 with a camera make and a GPS pointer, then the GPS IFD. */
export function exif() {
  const make = [...ascii('FictionCam'), 0];
  // IFD0 at 8, two entries: 2 + 24 + 4 = 30 bytes, then the make's text,
  // then a pad byte so the GPS IFD starts on a word boundary, as TIFF asks.
  const pad = make.length % 2;
  const gpsOffset = 8 + 30 + make.length + pad;
  const ifd0 = [...ifd(8, [
    { tag: 0x010f, type: ASCII, count: make.length, value: make },
    { tag: 0x8825, type: LONG, count: 1, value: le32(gpsOffset) },
  ]), ...new Array(pad).fill(0)];
  const gps = ifd(gpsOffset, [
    { tag: 0x0000, type: BYTE, count: 4, value: [2, 3, 0, 0] },
    { tag: 0x0001, type: ASCII, count: 2, value: [...ascii('N'), 0] },
    { tag: 0x0002, type: RATIONAL, count: 3, value: rationals([12, 1], [34, 1], [5678, 100]) },
    { tag: 0x0003, type: ASCII, count: 2, value: [...ascii('W'), 0] },
    { tag: 0x0004, type: RATIONAL, count: 3, value: rationals([123, 1], [45, 1], [67, 10]) },
  ]);
  const tiff = [...ascii('II'), 0x2a, 0x00, ...le32(8), ...ifd0, ...gps];
  return segment(0xe1, bytes(ascii('Exif'), 0, 0, tiff));
}

/** An XMP packet carrying the same position as text, in its own APP1. */
export const xmp = () => segment(0xe1, bytes(
  ascii('http://ns.adobe.com/xap/1.0/'), 0,
  ascii('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="12,34.946N" ' +
    'exif:GPSLongitude="123,45.112W"/></rdf:RDF></x:xmpmeta>'),
));

/** The other segments a phone or an editor adds, one of each kind. */
export const otherMetadata = () => [
  segment(0xe0, bytes(ascii('JFIF'), 0, 1, 2, 0, be16(72), be16(72), 0, 0)),
  segment(0xe2, bytes(ascii('ICC_PROFILE'), 0, 1, 1, ascii('a colour profile stands in here'))),
  segment(0xed, bytes(ascii('Photoshop 3.0'), 0, ascii('8BIM IPTC caption: at the dock'))),
  segment(0xef, bytes(ascii('a vendor block nobody has heard of'))),
  segment(0xfe, bytes(ascii('Shot at the club dock by FictionCam'))),
];

/** Where each byte pattern first occurs in `haystack`, or -1. */
export function find(haystack, needle) {
  const pattern = typeof needle === 'string' ? new TextEncoder().encode(needle) : Uint8Array.from(needle);
  outer: for (let i = 0; i + pattern.length <= haystack.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (haystack[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Every APPn (APP0-APP15) or COM marker in `image`, found by looking at every
 * byte pair rather than by walking the segments, so it does not share the
 * code it checks. In compressed data a 0xFF is always followed by 0x00, a
 * restart or a real marker, so a pair here is a marker wherever it sits. A
 * table's payload could hold one by chance; these fixtures' tables do not.
 */
export function metadataMarkers(image) {
  const found = [];
  for (let i = 0; i + 1 < image.length; i++) {
    if (image[i] === 0xff && ((image[i + 1] >= 0xe0 && image[i + 1] <= 0xef) || image[i + 1] === 0xfe)) {
      found.push(image[i + 1].toString(16));
    }
  }
  return found;
}

/** The first 8 bytes of every PNG. */
export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
