/**
 * Reading a JPEG a parent sent, and keeping only what draws the picture (#154).
 *
 * The share page re-encodes every photo in the browser, which drops GPS and
 * camera data (#147, A3). The server does not trust that, because anyone
 * holding the code can call the API with an original. So whatever passes the
 * size caps is rebuilt here from an allow-list of segments: the ones a
 * decoder needs, and nothing else. Every APPn segment goes (EXIF and its GPS
 * block in APP1, XMP, the ICC profile in APP2, IPTC in APP13, JFIF and its
 * thumbnail in APP0), and so does every comment, every marker this does not
 * know, and anything after the end-of-image marker, which is where a phone's
 * "motion photo" keeps its video. An allow-list rather than a list of known
 * metadata segments, so a vendor's new segment is dropped without anyone
 * having heard of it.
 *
 * Nothing is decoded or re-encoded: the compressed image data is copied as it
 * came, so the picture is exactly the one sent. Checked at #154 against real
 * encoders: ten Pillow variants (progressive, restart intervals, three
 * subsamplings, greyscale) and Chrome 154's canvas output decode to identical
 * pixels after the walk.
 *
 * The walk jumps from one 0xFF byte to the next with indexOf, since the free
 * plan gives a request 10 ms of CPU. Measured in Node 24 on 2026-09-29, not on
 * the edge: Chrome's canvas full size (0.55 MiB) in 0.3 ms warm and 1.1 ms
 * cold; Pillow at quality 100 (1.75 MiB, a 0xFF every 29 bytes) in 3.1 ms,
 * where a byte loop took 4.3. indexOf loses only on data that is nothing but
 * stuffed 0xFF00 (3 MiB in 45 ms, against 5 for the loop), which no encoder
 * writes, and a request over its CPU limit fails on its own.
 */

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

// The frame types a browser shows: baseline, extended and progressive
// Huffman, 8 bits a sample. Lossless, hierarchical and arithmetic-coded
// frames are JPEGs that a phone's gallery or a browser may not open, so they
// are refused as not a JPEG this site takes.
const FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

// Tables and settings a decoder reads: Huffman (DHT), arithmetic
// conditioning (DAC), quantisation (DQT) and the restart interval (DRI).
const TABLES = new Set([0xc4, 0xcc, 0xdb, 0xdd]);

const isRestart = (marker) => marker >= 0xd0 && marker <= 0xd7;

/**
 * Walk `bytes` as a JPEG. Answers one of:
 *
 *   { width, height, clean }   clean is the image rebuilt from the kept
 *                              segments, ending at the end-of-image marker
 *   { error: 'not-jpeg' }      it does not start as a JPEG, or its frame is
 *                              one this site does not take
 *   { error: 'malformed' }     it starts as one and breaks off: a segment
 *                              running past the end, no frame, no scan, or no
 *                              end-of-image marker
 */
export function readJpeg(bytes) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== SOI || bytes[2] !== 0xff) return { error: 'not-jpeg' };

  const kept = [bytes.subarray(0, 2)];
  let frame = null;
  let scans = 0;
  let pos = 2;

  for (;;) {
    // A marker is 0xFF, any number of 0xFF fill bytes, then its code.
    if (pos >= n || bytes[pos] !== 0xff) return { error: 'malformed' };
    while (pos < n && bytes[pos] === 0xff) pos++;
    if (pos >= n) return { error: 'malformed' };
    const marker = bytes[pos++];

    if (marker === EOI) {
      // The image ends here. Whatever follows it is never read or kept.
      if (!frame || scans === 0) return { error: 'malformed' };
      kept.push(Uint8Array.of(0xff, EOI));
      return { width: frame.width, height: frame.height, clean: concat(kept) };
    }
    // A second start of image, a restart outside a scan, or 0xFF00 where a
    // marker belongs: not a JPEG's structure.
    if (marker === SOI || marker === 0x00 || marker === 0x01 || isRestart(marker)) return { error: 'malformed' };

    if (pos + 2 > n) return { error: 'malformed' };
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > n) return { error: 'malformed' };
    // From the marker's own 0xFF: a fill byte is 0xFF too, so this is the
    // marker as it should be written, whatever fill came before it.
    const segment = bytes.subarray(pos - 2, pos + length);
    const body = bytes.subarray(pos + 2, pos + length);
    pos += length;

    if (FRAMES.has(marker)) {
      if (frame) return { error: 'malformed' };
      frame = readFrame(body);
      if (!frame) return { error: 'not-jpeg' };
      kept.push(segment);
    } else if (OTHER_FRAMES.has(marker)) {
      return { error: 'not-jpeg' };
    } else if (TABLES.has(marker)) {
      kept.push(segment);
    } else if (marker === SOS) {
      if (!frame) return { error: 'malformed' };
      const end = scanEnd(bytes, pos);
      if (end === -1) return { error: 'malformed' };
      kept.push(segment, bytes.subarray(pos, end));
      pos = end;
      scans++;
    }
    // Anything else is dropped: APP0-APP15, COM, and every marker not named
    // above.
  }
}

/**
 * The frame header's size, or null when it is not 8-bit greyscale or colour
 * with a real width and height. A height of 0 defers it to a DNL marker,
 * which only old scanners write.
 */
function readFrame(body) {
  if (body.length < 6) return null;
  const precision = body[0];
  const height = (body[1] << 8) | body[2];
  const width = (body[3] << 8) | body[4];
  const components = body[5];
  if (precision !== 8 || width === 0 || height === 0) return null;
  if (components !== 1 && components !== 3) return null;
  if (body.length < 6 + 3 * components) return null;
  return { width, height };
}

/**
 * Where a scan's compressed data ends: the offset of the next marker that is
 * not a stuffed 0xFF00 or a restart, or -1 when the data runs to the end of
 * the file.
 */
function scanEnd(bytes, from) {
  let i = from;
  for (;;) {
    i = bytes.indexOf(0xff, i);
    if (i === -1 || i + 1 >= bytes.length) return -1;
    const next = bytes[i + 1];
    if (next === 0x00 || isRestart(next)) i += 2;
    else if (next === 0xff) i += 1;
    else return i;
  }
}

export function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
