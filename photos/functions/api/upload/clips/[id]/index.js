/**
 * DELETE /api/upload/clips/<id>: a clip's upload abandoned (#198), when the
 * sender presses Remove while it sends. lib/clips.js has the whole exchange.
 *
 * With the token from the start in the Clip-Upload header, an upload this
 * session started and that is still uploading is taken back: its row, then
 * its R2 upload aborted, then the day's upload given back (dropClip). An
 * upload abandoned without this, by a closed tab, is cleared a day later
 * (clearStaleClips), when the bucket's lifecycle rule has aborted its parts.
 *
 *   204                          taken back
 *   404 {"error": "upload"}      no upload this session started with this id
 *   409 {"error": "stored"}      this session's clip is stored already, by a
 *                                complete whose answer the page never got;
 *                                nothing is taken back
 *   503 {"error": "unavailable"} the database did not answer
 *
 * The 409 is how Remove learns that a clip whose complete got no answer
 * arrived after all (owner, at #198's review): the page then shows it sent.
 * Remove never sends the complete itself, which would store a clip whose
 * complete never arrived.
 */
import { answer, clipRow, dropClip, readClipToken, readNumber, unavailable } from '../../../../../lib/clips.js';

export async function onRequestDelete({ request, env, data, params }) {
  const { DB, MEDIA, SESSION_SIGNING_KEY } = env;
  if (!DB || !MEDIA) return unavailable();
  const id = readNumber(params.id);
  if (id === null) return answer(404, { error: 'upload' });
  const token = await readClipToken(request, SESSION_SIGNING_KEY, data.session, id);
  if (!token) return answer(404, { error: 'upload' });

  let row;
  try {
    row = await clipRow(DB, id);
  } catch (err) {
    console.error('clips: database did not answer:', err instanceof Error ? err.message : String(err));
    return unavailable();
  }
  if (!row) return answer(404, { error: 'upload' });
  if (row.state !== 'uploading') return answer(409, { error: 'stored' });
  const dropped = await dropClip(env, data.session, id, row, token.bytes);
  if (dropped === null) return unavailable();
  if (dropped) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  // Taken by something else between the read above and dropClip: a complete
  // still running stored it, or the sweep cleared it. The row says which, as
  // in the complete (#198's review): a 404 here would tell Remove that a
  // stored clip never arrived.
  let now;
  try {
    now = await clipRow(DB, id);
  } catch (err) {
    console.error('clips: database did not answer:', err instanceof Error ? err.message : String(err));
    return unavailable();
  }
  return now ? answer(409, { error: 'stored' }) : answer(404, { error: 'upload' });
}
