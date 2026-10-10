/**
 * GET /api/albums/open: the albums a sender can send photos to (#153),
 * newest first, as {"albums": [{address, title, kind, date, team, teamName},
 * …], "other": [{address, team, teamName}, …]}. Newest is the latest date, so
 * an album made ahead of time for a future day comes first. The share page
 * (#155) offers them all and preselects one held today, else the most recent
 * past one, never a future one (CLAUDE.md, The photo site, item 13). The
 * guard in _middleware.js has already required a live account session;
 * without one this answers 401.
 *
 * Since #227 each album names its team, by key and by name, and the share
 * page groups its choices under each team's name. Since #223 an account is
 * offered only the albums of the teams it is approved for now (criterion 2,
 * D16), which the guard read on this request; POST /api/upload refuses the
 * rest with 403. The invite link and a coach's sign-in had no team, so they
 * were offered every open album until #226 retired them.
 *
 * `other` holds the teams' "Not sure / other event" albums (#228), each team
 * the sender is offered and whose Not sure album is open, in the order the
 * teams are listed (lib/teams.js). They are kept out of `albums`, so nothing
 * that preselects or counts events can take one for an event; the share page
 * puts each after its team's events and never preselects it. It writes their
 * words itself, so no title is sent.
 *
 * A title is the text the owner typed, markup and all. It is data here, and
 * the page that shows it sets it as text.
 *
 * A read only: it writes nothing, and no cache keeps it, so an album closed
 * on the admin page, or a team revoked, leaves the list at the next request.
 *
 * Since #198 it also answers `clip`, { seconds, bytes }: the longest and the
 * largest clip this session may send (lib/photos.js, CLIP_SECONDS and
 * CLIP_BYTES), so the share page can refuse one over its caps as soon as it is
 * chosen, before any of it is sent. The page cannot tell a coach from a parent
 * otherwise: the session routes answer 204 and nothing else. POST
 * /api/upload/clips refuses an over-cap clip as well, whatever the page does.
 * `clip.dayBytes` is the session's daily clip budget (CLIP_DAY_BYTES), which
 * the page names when the start refuses a clip past it: only the server knows
 * how much of it a day has spent, across every phone on an account.
 *
 * Since #273 it also answers `teams`, [{team, teamName}, …]: the teams the
 * account is approved for now, in the order the teams are listed, which the
 * share page's "Create a new event" offers (asking which only when there are
 * two). The albums alone cannot say it: a team with no open event and its Not
 * sure album closed names none. An event a sender made is listed as any album
 * is, from the moment it is made, to every account approved for its team, and
 * nothing here says who made it (criterion 5).
 */
import { openAlbums } from '../../../lib/albums.js';
import { clipBytes, clipDayBytes, clipSeconds } from '../../../lib/photos.js';
import { TEAMS, teamName } from '../../../lib/teams.js';

const ORDER = TEAMS.map(({ team }) => team);

export async function onRequestGet({ env, data }) {
  const { session } = data;
  const offered = (album) => session.teams.includes(album.team);
  const open = (await openAlbums(env.DB)).filter(offered);
  const albums = open.filter((album) => !album.holding).map(({ address, title, kind, date, team }) =>
    ({ address, title, kind, date, team, teamName: teamName(team) }));
  const other = open.filter((album) => album.holding)
    .sort((a, b) => ORDER.indexOf(a.team) - ORDER.indexOf(b.team))
    .map(({ address, team }) => ({ address, team, teamName: teamName(team) }));
  const clip = { seconds: clipSeconds(session), bytes: clipBytes(session), dayBytes: clipDayBytes(session) };
  const teams = ORDER.filter((team) => session.teams.includes(team)).map((team) => ({ team, teamName: teamName(team) }));
  return Response.json({ albums, other, clip, teams }, { headers: { 'Cache-Control': 'no-store' } });
}
