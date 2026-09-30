/**
 * Plain HTML form posts, as the admin pages send them (#153), and the 303
 * each one is answered with.
 *
 * A form with no enctype posts application/x-www-form-urlencoded. Anything
 * else reads as an empty form, which every route refuses as a missing field
 * rather than throwing: request.formData() throws on a body of another type,
 * and a thrown error would be a 500.
 */

// A form here holds an address, a title of at most 80 characters, a kind and
// a date. This is room for all of them, encoded, many times over. A queue
// batch's form, which carries a caption for every photo, passes its own
// larger cap (lib/queue.js).
const MAX_FORM_BYTES = 4096;

/**
 * The fields of a urlencoded form, first value of each name, in an object
 * with no prototype, so a field named __proto__ is only a field. Empty when
 * the body is anything else or longer than `maxBytes`.
 */
export async function readForm(request, maxBytes = MAX_FORM_BYTES) {
  const fields = Object.create(null);
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/x-www-form-urlencoded\s*(;|$)/i.test(type)) return fields;
  const text = await request.text();
  if (text.length > maxBytes) return fields;
  for (const [name, value] of new URLSearchParams(text)) {
    if (!(name in fields)) fields[name] = value;
  }
  return fields;
}

/**
 * 303 See Other to `location`: after a post, the browser loads the page with
 * a GET, so a reload shows it again rather than posting a second time.
 */
export const seeOther = (location) =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
