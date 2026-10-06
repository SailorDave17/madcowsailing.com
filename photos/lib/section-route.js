/**
 * The route behind each team's section (#227): /hoover-jrt/ and /cohssa/,
 * each a two-line file under functions/ that calls sectionRoute() with its
 * own team. One file per team, not a top-level functions/[team]/ route, which
 * would sit beside /ask, /admin and every other top-level path the site
 * answers (owner's choice at #227's pickup, over /teams/<team>/).
 * test/public.test.js fails unless every team in lib/teams.js has its file,
 * its _routes.json lines, and lists only its own albums.
 *
 * A public GET, as / and an album page are: no session, no Access, never a
 * write to D1 (CLAUDE.md, The photo site, item 4), and a database that does
 * not answer is a 503 page rather than an empty list. The address without its
 * trailing slash is sent to the one with it, as an album's is, so a section
 * has one URL. HEAD is answered as GET is.
 *
 * ?removed shows the takedown notice: POST /api/remove sends the browser
 * here when the photo it hid was the last its album showed (#158).
 */
import { htmlResponse, sectionPage, unavailablePage } from './public-page.js';
import { publicAlbums } from './public.js';

export function sectionRoute(team) {
  async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/')) {
      return new Response(null, { status: 308, headers: { Location: `${url.pathname}/${url.search}` } });
    }
    let albums;
    try {
      albums = await publicAlbums(env.DB, team);
    } catch (err) {
      console.error(`${team}: the database did not answer:`, err instanceof Error ? err.message : String(err));
      return htmlResponse(unavailablePage(), 503);
    }
    return htmlResponse(sectionPage(team, albums, { removed: url.searchParams.has('removed') }));
  }
  return { onRequestGet, onRequestHead: onRequestGet };
}
