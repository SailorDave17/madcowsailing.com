/**
 * POST /share/receive: the share target's address (public/manifest.webmanifest),
 * as the server sees it (#193).
 *
 * On a phone with the site installed, public/share/sw.js answers this POST,
 * and it never reaches the server. It arrives here only when no worker is
 * there to take it: the phone's site data was cleared while the app stayed on
 * its home screen, or the worker has not installed yet. Pages answers a POST
 * to a static path with an empty 405 (measured on madcowphotos.pages.dev,
 * 2026-10-01), so without this route the phone would show a blank error page.
 *
 * It sends the browser to the share page with ?shared=failed, which says the
 * photos could not be kept and to share them again. Loading that page
 * registers the worker again, so the next share works.
 *
 * It never reads the body: the photos are not the server's to keep until the
 * sender presses Send, and reading them would only spend CPU. It changes
 * nothing, so it needs no session and no Origin check: test/guard.test.js
 * lists it as public with that reason.
 */
export function onRequestPost() {
  return new Response(null, {
    status: 303,
    headers: { Location: '/share/?shared=failed', 'Cache-Control': 'no-store' },
  });
}
