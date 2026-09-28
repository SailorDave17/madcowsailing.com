/* The share page's join step (#150).
 *
 * An invite link is /share/#code=<code>. A browser never sends the part after
 * # to a server, in the request or in a Referer, so the code travels once,
 * in the body of POST /api/join, and never in a URL a log could hold.
 *
 * On load, and whenever the part after # changes: if the address carries a
 * code, take it out of the address bar at once (so it is not left there, in
 * the history entry or in a screenshot), then trade it for an upload session. With no code, ask the server whether
 * this browser already holds a session. Either way, say plainly where this
 * phone stands, in the page's live region.
 *
 * #155 adds the sending below this; this file only joins. */
(() => {
  'use strict';

  const status = document.getElementById('join-status');
  const retry = document.getElementById('join-retry');

  // One message per answer. A code that was once right says the invite has
  // changed, never that it is wrong: the parent did nothing wrong, the owner
  // rotated it (#152).
  const MESSAGES = {
    joining: 'Opening your invite…',
    ready: "You're set to send photos from this phone.",
    rotated: 'This invite has changed. Ask whoever sent it to you for the new link.',
    wrong: "This invite link doesn't work. Check you opened the whole link, or ask whoever sent it for a new one.",
    tooMany: 'Too many tries from this network. Wait an hour, then open the link again.',
    closed: "Sending photos isn't open right now. Try again later.",
    offline: "Couldn't reach the photo site. Check your signal, then try again.",
    none: 'Open the invite link you were sent to start sending photos to the team.',
  };

  let again = null;

  function say(message, retryWith = null) {
    status.textContent = MESSAGES[message];
    again = retryWith;
    retry.hidden = retryWith === null;
  }

  function takeCode() {
    const code = new URLSearchParams(location.hash.slice(1)).get('code');
    if (code !== null) history.replaceState(history.state, '', location.pathname + location.search);
    return code;
  }

  async function errorOf(response) {
    try {
      return (await response.json()).error;
    } catch {
      return null;
    }
  }

  async function join(code) {
    say('joining');
    let response;
    try {
      response = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      say('offline', () => join(code));
      return;
    }
    if (response.status === 204) say('ready');
    else if (response.status === 429) say('tooMany');
    else if (response.status === 403 || response.status === 400) {
      say((await errorOf(response)) === 'rotated' ? 'rotated' : 'wrong');
    } else if (response.status === 503) say('closed', () => join(code));
    else say('offline', () => join(code));
  }

  async function check() {
    let response;
    try {
      response = await fetch('/api/upload/session', { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      say('offline', check);
      return;
    }
    say(response.status === 204 ? 'ready' : 'none');
  }

  retry.addEventListener('click', () => {
    if (again) again();
  });

  const code = takeCode();
  if (code !== null) join(code);
  else check();

  // A link that differs from the open page only after # does not reload it:
  // pasting a new invite into a tab already on /share/ changes the hash and
  // nothing else. Without this, the code would sit in the address bar and
  // the page would go on showing the last answer. Measured on #150.
  window.addEventListener('hashchange', () => {
    const next = takeCode();
    if (next !== null) join(next);
  });
})();
