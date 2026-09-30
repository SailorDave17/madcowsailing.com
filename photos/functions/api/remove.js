/**
 * POST /api/remove: take a photo down (#158). Anyone may: the dialog on an
 * album page and the no-JavaScript confirmation page at /remove both post
 * here, a photo's id and an optional note. lib/removals.js holds the rules.
 *
 * The answers:
 *
 *   303  hidden: back to its album page, or to the list when the album has
 *        nothing public left, each with ?removed for the notice
 *   403  {"error":"origin"}  no Origin, or another site's
 *   404  the photo is not public (pending, hidden already, deleted, unknown,
 *        or no id): one page for all of them, and nothing changes
 *   429  REMOVAL_LIMIT takedowns from this address in the last hour, with
 *        Retry-After; nothing changes
 *   503  the database or ADDRESS_HASH_KEY is missing, or the database did
 *        not answer: closed, never open
 *
 * The pages are HTML, since a browser shows them to whoever pressed the
 * button. The address is stored only as a keyed hash (lib/address.js), and
 * only for a takedown that hid a photo.
 *
 * Not behind a directory guard, so it checks the Origin itself, as
 * POST /api/join does: a page elsewhere cannot post a takedown into this
 * one. test/removals.test.js holds it; test/guard.test.js lists it public.
 */
import { addressHash } from '../../lib/address.js';
import { readForm, seeOther } from '../../lib/form.js';
import { sameOrigin } from '../../lib/origin.js';
import {
  htmlResponse, removeClosedPage, removeGonePage, removeLimitedPage,
} from '../../lib/public-page.js';
import { readPhotoId } from '../../lib/queue.js';
import { REMOVE_FORM_BYTES, readNote, requestRemoval } from '../../lib/removals.js';
import { nowSeconds } from '../../lib/session.js';

const page = (body, status, headers = {}) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
};

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const { DB, ADDRESS_HASH_KEY } = env;
  if (!DB || !ADDRESS_HASH_KEY) {
    // Names what is missing by kind only; no value is ever printed.
    console.error('remove: the database or the address key is not configured, so takedowns are closed');
    return page(removeClosedPage(), 503);
  }

  const fields = await readForm(request, REMOVE_FORM_BYTES);
  let result;
  try {
    result = await requestRemoval(DB, {
      id: readPhotoId(fields.photo),
      note: readNote(fields.note),
      address: await addressHash(ADDRESS_HASH_KEY, request),
      now: nowSeconds(),
    });
  } catch (err) {
    console.error('remove: the database did not answer, so nothing was taken down:', err instanceof Error ? err.message : String(err));
    return page(removeClosedPage(), 503);
  }

  if (result.outcome === 'limited') {
    return page(removeLimitedPage(result.retryAfter), 429, { 'Retry-After': String(result.retryAfter) });
  }
  if (result.outcome === 'gone') return page(removeGonePage(), 404);
  return seeOther(result.shown ? `/albums/${result.address}/?removed` : '/?removed');
}
