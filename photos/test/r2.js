// An R2 stand-in for the upload tests (#154): the part of the Workers R2 API
// the site uses, put(), get(), head() and delete() with one key or a list,
// over a Map. Not a test file: npm test runs only *.test.js.
//
// `objects` is the bucket underneath, for a test to read what was stored.
// `failPut(key)` makes a put of that key reject at once, as an unreachable
// bucket does. A put that succeeds lands a macrotask later, as a real upload
// takes time, so code that stops waiting at the first failure (Promise.all)
// and deletes straight away finds nothing yet to delete, and what lands
// after stays behind where a test can see it. `failDelete` makes delete()
// reject and delete nothing.
//
// `idle()` waits until every put started so far has landed or failed. A test
// asserting that nothing is left must await it first: a route that answers
// before its puts settle has answered before the leftover exists, and an
// assertion made then reads an empty bucket whatever the route did (#154's
// second mutation round, where exactly that kept a Promise.all mutant green).

export function r2({ failPut = () => false, failDelete = false } = {}) {
  const objects = new Map();
  const puts = [];
  const pending = [];
  const land = async (key, value, options) => {
    if (failPut(key)) throw new Error('bucket unreachable');
    const body = value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
    await new Promise((resolve) => setTimeout(resolve, 0));
    objects.set(key, { body, httpMetadata: options.httpMetadata ?? {} });
    return { key, size: body.length };
  };
  return {
    objects,
    puts,
    idle: () => Promise.allSettled(pending),
    put(key, value, options = {}) {
      puts.push(key);
      const landing = land(key, value, options);
      pending.push(landing);
      return landing;
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { key, body: object.body, httpMetadata: object.httpMetadata } : null;
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { key, size: object.body.length, httpMetadata: object.httpMetadata } : null;
    },
    async delete(keys) {
      if (failDelete) throw new Error('bucket unreachable');
      for (const key of [keys].flat()) objects.delete(key);
    },
  };
}
