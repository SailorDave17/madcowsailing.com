/**
 * GET /: the way into each team's section (#227), one row per team with its
 * album and photo counts and its newest album's cover. Until #227 it listed
 * every album holding an approved photo (#157), which each team's section,
 * /hoover-jrt/ and /cohssa/, now does for its own. It replaced the holding
 * page #149 served from public/index.html, so public/_routes.json sends / to
 * the Functions.
 *
 * A public GET: no session, no Access, and it never writes to D1 (CLAUDE.md,
 * The photo site, item 4). When the database does not answer it says so with
 * a 503, rather than rows that would say nothing is posted.
 *
 * HEAD is answered the same way, as the static holding page answered it: a
 * monitor or a link preview asking HEAD / gets what GET gets, and Pages sends
 * no body. It costs the same query as a GET.
 *
 * ?removed shows the takedown notice. POST /api/remove sends the browser to
 * the album's team's section instead (#158, #227), and here only when the
 * hidden photo's album could not be read back.
 */
import { htmlResponse, teamListPage, unavailablePage } from '../lib/public-page.js';
import { publicAlbums } from '../lib/public.js';

export async function onRequestGet({ request, env }) {
  let albums;
  try {
    albums = await publicAlbums(env.DB);
  } catch (err) {
    console.error('albums: the database did not answer:', err instanceof Error ? err.message : String(err));
    return htmlResponse(unavailablePage(), 503);
  }
  const removed = new URL(request.url).searchParams.has('removed');
  return htmlResponse(teamListPage(albums, { removed }));
}

export const onRequestHead = onRequestGet;
