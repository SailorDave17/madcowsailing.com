/**
 * The site's teams (D16): who an account is approved for (#220, #221), and,
 * since #227, which team each album belongs to and which section of the site
 * lists it (/hoover-jrt/ and /cohssa/, the owner's choice at #227's pickup).
 *
 * Migration 0007 makes the same two rows in `teams`, and test/accounts.test.js
 * fails if the two part. A section's address is its team's key, and
 * test/public.test.js fails unless each team here has its route file and its
 * _routes.json lines. Moved here from lib/accounts.js by #227, which still
 * exports it, so that lib/albums.js can read it: accounts.js reaches
 * lib/photos.js, which imports albums.js, and a cycle there would leave
 * TEAMS unset while albums.js loads.
 */

// In the order every page lists them.
export const TEAMS = Object.freeze([
  Object.freeze({ team: 'hoover-jrt', name: 'Hoover JRT' }),
  Object.freeze({ team: 'cohssa', name: 'COHSSA' }),
]);

const NAMES = new Map(TEAMS.map(({ team, name }) => [team, name]));

/** Whether `text` is one of the teams' keys. */
export const isTeam = (text) => typeof text === 'string' && NAMES.has(text);

/** A team's key from a form field or the address bar, or null for anything else. */
export const readTeam = (text) => (isTeam(text) ? text : null);

/**
 * The team a request's address names in ?team=, or null. The admin queue and
 * removals pages, and every press posted from them, carry their team filter
 * this way (#227), so a press that arrives as a GET keeps it too.
 */
export const teamOf = (request) => readTeam(new URL(request.url).searchParams.get('team'));

/** A team's name, as every page shows it: "Hoover JRT", "COHSSA". */
export const teamName = (team) => NAMES.get(team) ?? team;

/** A team's section of the site, which lists its albums (#227). */
export const sectionHref = (team) => `/${team}/`;
