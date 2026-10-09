// An R2 stand-in for the upload tests (#154): the part of the Workers R2 API
// the site uses, over a Map. put(), get(), head() and delete() with one key or
// a list since #154; a ranged get() and the multipart calls since the clip
// story (#198): createMultipartUpload(), resumeMultipartUpload(), and on an
// upload uploadPart(), complete() and abort(). Not a test file: npm test runs
// only *.test.js.
//
// `objects` is the bucket underneath, for a test to read what was stored
// ({ body: Uint8Array, httpMetadata }). `failPut(key)` makes a put of that key
// reject at once, as an unreachable bucket does. A put that succeeds lands a
// macrotask later, as a real upload takes time, so code that stops waiting at
// the first failure (Promise.all) and deletes straight away finds nothing yet
// to delete, and what lands after stays behind where a test can see it.
// `failDelete` makes delete() reject and delete nothing, and a delete of more
// than 1,000 keys rejects, as R2's does.
//
// `idle()` waits until every put, part and complete started so far has landed
// or failed. A test asserting that nothing is left must await it first: a
// route that answers before its puts settle has answered before the leftover
// exists, and an assertion made then reads an empty bucket whatever the route
// did (#154's second mutation round, where exactly that kept a Promise.all
// mutant green).
//
// What the stand-in holds to, read from the Workers R2 API reference, the
// multipart usage page, R2's limits and error codes, and workerd's and
// miniflare's source (2026-10-08, #198):
//
// - Every value is read as the bytes a real put or part would store: an
//   ArrayBuffer, a typed array or DataView, a Blob, a string, or a stream.
//   Until #198 a stream, a Blob or a DataView was stored as 0 bytes here, so
//   a route passing request.body would have stored nothing and passed.
// - get() returns the object's body as a ReadableStream, with arrayBuffer(),
//   size, etag, httpEtag, httpMetadata, writeHttpMetadata() and range. A ranged
//   get takes { offset, length }, { offset }, { length } or { suffix }, or a
//   Headers holding Range. `range` is set on EVERY get, ranged or not, as
//   miniflare sets it, so a route that decides 206 from its presence answers
//   206 to a plain GET here and a test can see it. An offset past the end, or
//   a length of 0, throws InvalidRange (10039).
// - resumeMultipartUpload() checks nothing, as R2 documents; an unknown,
//   completed or aborted upload id fails at the call that uses it, with
//   NoSuchUpload (10024). Part numbers run from 1 to 10,000, or TypeError.
//   Sending a part number again replaces the part, and a failed send loses
//   the part that was there (R2's S3 page).
// - complete() is where R2 checks sizes: every part named must exist with its
//   etag (InvalidPart, 10025), every part but the last must be at least
//   `minPartBytes` (EntityTooSmall, 10011; 5 MiB unless a test says
//   otherwise), and those parts must be one size with the last no larger
//   (InvalidPart, 10048). Parts are sorted by number first, as R2 does.
// - The binding has no call listing an upload's parts, so neither has this.
//
// `uploads` is every multipart upload by id, for a test to read: { key,
// httpMetadata, parts: Map(number -> { etag, body }), state: 'open' |
// 'completed' | 'aborted' }. `failPart(key, n)`, `failComplete(key)` and
// `failAbort(key)` make those calls reject, as an unreachable bucket does.

const MiB = 1024 * 1024;

const failure = (name, code) => Object.assign(new Error(`${name}: (${code})`), { name });

const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

// A part's etag as the binding gives it: an opaque token of 171 characters,
// 128 random bytes in base64url, as local dev (miniflare) answered on
// 2026-10-08 (#198). R2's documentation shows a part's S3 etag as an MD5,
// 32 hex digits, and does not say what the binding gives. Until #198's
// browser run this stand-in gave 32 hex digits, and a route allowing 128
// characters passed every test while refusing every real complete.
const partEtag = () => Buffer.from(crypto.getRandomValues(new Uint8Array(128))).toString('base64url');

async function bytesOf(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return new Uint8Array(await new Response(value).arrayBuffer());
}

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

// The resolved { offset, length } a ranged get asks for, or throws as R2 does.
function resolveRange(range, size) {
  if (range === undefined) return { offset: 0, length: size };
  if (range instanceof Headers) {
    const header = range.get('Range');
    if (header === null) return { offset: 0, length: size };
    const one = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    // R2 passes an unreadable or several-range header on and serves the whole
    // object (miniflare's validator), so does this.
    if (!one || (one[1] === '' && one[2] === '')) return { offset: 0, length: size };
    if (one[1] === '') return resolveRange({ suffix: Number(one[2]) }, size);
    const offset = Number(one[1]);
    const last = one[2] === '' ? size - 1 : Math.min(Number(one[2]), size - 1);
    return resolveRange({ offset, length: last - offset + 1 }, size);
  }
  const numbers = Object.values(range);
  if (numbers.some((n) => !Number.isInteger(n) || n < 0)) throw new RangeError('range values must be whole and not negative');
  if ('suffix' in range) {
    if ('offset' in range || 'length' in range) throw new TypeError('suffix cannot be given with offset or length');
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  const length = range.length ?? size - offset;
  if (offset > size || length <= 0) throw failure('InvalidRange', 10039);
  return { offset, length: Math.min(length, size - offset) };
}

export function r2({
  failPut = () => false,
  failDelete = false,
  failPart = () => false,
  failComplete = () => false,
  failAbort = () => false,
  minPartBytes = 5 * MiB,
} = {}) {
  const objects = new Map();
  const uploads = new Map();
  const puts = [];
  const pending = [];
  const track = (promise) => {
    pending.push(promise);
    return promise;
  };

  const describe = (key, object) => {
    const etag = object.etag ?? (object.etag = hex(16));
    return {
      key,
      size: object.body.length,
      etag,
      httpEtag: `"${etag}"`,
      httpMetadata: object.httpMetadata ?? {},
      writeHttpMetadata(headers) {
        const { contentType } = object.httpMetadata ?? {};
        if (contentType) headers.set('Content-Type', contentType);
      },
    };
  };

  const land = async (key, value, options) => {
    if (failPut(key)) throw new Error('bucket unreachable');
    const body = await bytesOf(value);
    await later();
    objects.set(key, { body, httpMetadata: options.httpMetadata ?? {} });
    return { key, size: body.length };
  };

  const openUpload = (key, uploadId) => {
    const upload = uploads.get(uploadId);
    if (!upload || upload.key !== key || upload.state !== 'open') throw failure('NoSuchUpload', 10024);
    return upload;
  };

  const handle = (key, uploadId) => ({
    key,
    uploadId,
    uploadPart(partNumber, value) {
      return track((async () => {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
          throw new TypeError('Part number must be between 1 and 10000 (inclusive)');
        }
        const upload = openUpload(key, uploadId);
        if (failPart(key, partNumber)) {
          // A failed send loses the part that was there (R2's S3 page).
          upload.parts.delete(partNumber);
          throw new Error('bucket unreachable');
        }
        const body = await bytesOf(value);
        await later();
        openUpload(key, uploadId);
        const etag = partEtag();
        upload.parts.set(partNumber, { etag, body });
        return { partNumber, etag };
      })());
    },
    complete(uploadedParts) {
      return track((async () => {
        const upload = openUpload(key, uploadId);
        if (failComplete(key)) throw new Error('bucket unreachable');
        const named = [...uploadedParts].sort((a, b) => a.partNumber - b.partNumber);
        const bodies = named.map(({ partNumber, etag }) => {
          if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
            throw new TypeError('Part number must be between 1 and 10000 (inclusive)');
          }
          const part = upload.parts.get(partNumber);
          if (!part || part.etag !== etag) throw failure('InvalidPart', 10025);
          return part.body;
        });
        if (bodies.length === 0) throw failure('InvalidPart', 10025);
        const leading = bodies.slice(0, -1);
        if (leading.some((body) => body.length < minPartBytes)) throw failure('EntityTooSmall', 10011);
        const size = leading.length ? leading[0].length : bodies[0].length;
        if (leading.some((body) => body.length !== size) || bodies.at(-1).length > size) {
          throw failure('InvalidPart', 10048);
        }
        const body = new Uint8Array(bodies.reduce((sum, b) => sum + b.length, 0));
        let at = 0;
        for (const part of bodies) {
          body.set(part, at);
          at += part.length;
        }
        await later();
        openUpload(key, uploadId);
        upload.state = 'completed';
        const object = { body, httpMetadata: upload.httpMetadata };
        objects.set(key, object);
        return describe(key, object);
      })());
    },
    async abort() {
      const upload = openUpload(key, uploadId);
      if (failAbort(key)) throw new Error('bucket unreachable');
      upload.state = 'aborted';
      upload.parts.clear();
    },
  });

  return {
    objects,
    uploads,
    puts,
    idle: () => Promise.allSettled(pending),
    put(key, value, options = {}) {
      puts.push(key);
      return track(land(key, value, options));
    },
    async get(key, options = {}) {
      const object = objects.get(key);
      if (!object) return null;
      const range = resolveRange(options.range, object.body.length);
      const bytes = object.body.slice(range.offset, range.offset + range.length);
      return {
        ...describe(key, object),
        range,
        body: new Blob([bytes]).stream(),
        bodyUsed: false,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
    async head(key) {
      const object = objects.get(key);
      return object ? describe(key, object) : null;
    },
    async delete(keys) {
      if (failDelete) throw new Error('bucket unreachable');
      const list = [keys].flat();
      // As R2 does: "Up to 1000 keys may be deleted per call" (Workers R2 API
      // reference, read 2026-09-30). A stand-in taking any number could not
      // disagree with code that forgot it (#156's review).
      if (list.length > 1000) throw new Error(`R2 deletes at most 1,000 keys a call, not ${list.length}`);
      for (const key of list) objects.delete(key);
    },
    async createMultipartUpload(key, options = {}) {
      const uploadId = hex(24);
      uploads.set(uploadId, { key, httpMetadata: options.httpMetadata ?? {}, parts: new Map(), state: 'open' });
      return handle(key, uploadId);
    },
    resumeMultipartUpload(key, uploadId) {
      // R2: "does not perform any checks to ensure the validity of the
      // uploadId". The call that uses it finds out.
      return handle(key, uploadId);
    },
  };
}
