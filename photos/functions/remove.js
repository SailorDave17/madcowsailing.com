/**
 * POST /remove: "Remove this photo" without JavaScript (#158). Each photo on
 * an album page has a form posting its id here; public/js/remove.js opens the
 * page's dialog instead, so a browser with JavaScript never comes here.
 *
 * It answers the confirmation page, which asks before anything changes: the
 * dialog's words, the photo, the optional note and a "Remove it" button that
 * posts to /api/remove (owner, at #158's pickup: a page that asks first, over
 * a post that hides at once, which would give a reader without JavaScript no
 * note and let a stray tap hide a photo). This route only reads, so it needs
 * no Origin check and writes nothing to D1.
 *
 * A photo that is not public (pending, hidden, deleted, unknown, or no id at
 * all) is the one "isn't showing" page with a 404, as /api/remove answers it.
 * A database that does not answer is a 503. A POST's answer is never kept by
 * a cache, and no-store says so to anything between.
 */
import { readForm } from '../lib/form.js';
import { htmlResponse, removeClosedPage, removeConfirmPage, removeGonePage } from '../lib/public-page.js';
import { readPhotoId } from '../lib/queue.js';
import { removablePhoto } from '../lib/removals.js';

const page = (body, status = 200) => {
  const response = htmlResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

export async function onRequestPost({ request, env }) {
  const fields = await readForm(request);
  const id = readPhotoId(fields.photo);
  let photo;
  try {
    photo = await removablePhoto(env.DB, id);
  } catch (err) {
    console.error('remove: the database did not answer:', err instanceof Error ? err.message : String(err));
    return page(removeClosedPage(), 503);
  }
  if (photo === null) return page(removeGonePage(), 404);
  return page(removeConfirmPage(photo));
}
