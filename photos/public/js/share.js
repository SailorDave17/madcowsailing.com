/* The share page: where this phone stands (#150, #223, #226), then sending
 * photos (#155).
 *
 * Where this phone stands. A phone sends from an account (#223): signed in at
 * /sign-in, it holds a session, and GET /api/upload/session answers it 204.
 * On load the page asks that route, and says plainly where this phone stands,
 * in the page's live region. With a session, the album list holds only the
 * account's approved teams' albums. Without one, the page's own links to
 * /sign-in and /ask are the way in.
 *
 * The old invite link (#150 until #226). Until accounts replaced it, a parent
 * joined with /share/#code=<code>, and the page traded the code for a session
 * at POST /api/join. Those links live on in group chats and bookmarks, so the
 * page still knows one, for good (#226): on load, and whenever the part after
 * # changes, it takes the code out of the address bar at once (so it is not
 * left there, in the history entry or in a screenshot) and sends it nowhere.
 * A browser never sends the part after # to a server either, so the code
 * stays on the phone. The page then asks the same session question, and says
 * the link has been replaced: to a phone already signed in, that it is set to
 * send; to any other, how to sign in or ask for an account.
 *
 * Sending. Once the phone holds a session, the page lists the open albums and
 * preselects one, so a parent sends with four taps and nothing typed: the
 * link, "Add photos", the photos, "Send". Each photo is made ready as soon as
 * it is chosen, one at a time to spare a phone's memory: its capture time is
 * read from its EXIF (the file's date when there is none), it is decoded and
 * drawn upright, and <canvas> makes the three JPEGs POST /api/upload takes
 * (the route's header comment is the contract). "Send" then sends them, no
 * more than three at once, each showing where it stands, and a running
 * summary goes to a live region. The re-encode is also what leaves the
 * photo's GPS and camera data behind on the phone; the server strips again.
 * Each team's list ends with "Not sure / other event" (#228), for photos
 * from an event nobody has added yet, which the page never preselects.
 *
 * Shared photos (#193). The installed site is in an Android phone's Share
 * menu. share/sw.js keeps the photos a gallery shares to it in this phone's
 * browser storage and opens this page with ?shared. With a session they go
 * straight into the list, ready to send, with nothing chosen again. Without
 * one they wait, and the page says so, until the sender signs in (owner,
 * #193's pickup). Each stays in storage until it is sent or removed, so a
 * reload or a second share offers it again (owner, #193's review). */
(() => {
  'use strict';

  // ---- Where this phone stands (#150, #226) --------------------------

  // The ids are the join step's (#150), kept when #226 retired it.
  const status = document.getElementById('join-status');
  const retry = document.getElementById('join-retry');

  // One message per answer. Since #226 a phone sends from an account only,
  // so a phone with no session is told to sign in, or to ask for an account,
  // and the page's own links go to both. An old invite link has two of its
  // own: 'replaced' with no session, and 'readyReplaced' with one, which
  // opens the sender as 'ready' does. The join step's own answers (the code
  // rotated, wrong, tried too often, or sending closed) went with it.
  // 'unavailable' is the guard's 503: the phone holds an account's session
  // and the database did not answer, so it is told to try again, never to
  // sign in (review-fanout at #226's review).
  const MESSAGES = {
    ready: "You're set to send photos from this phone.",
    readyReplaced: "That invite link has been replaced by accounts. This phone is signed in, so you're set to send photos.",
    replaced: "The team's invite link has been replaced by accounts. Sign in, or ask for an account below, to send photos.",
    offline: "Couldn't reach the photo site. Check your signal, then try again.",
    unavailable: "The photo site isn't answering right now. Try again in a few minutes.",
    none: 'Sign in to start sending photos to the team, or ask for an account if you have none.',
    ended: 'Your sign-in has ended. Sign in again, then send again.',
  };

  let again = null;

  function say(message, retryWith = null) {
    status.textContent = MESSAGES[message];
    again = retryWith;
    retry.hidden = retryWith === null;
    if (message === 'ready' || message === 'readyReplaced') openSender();
    else waitShared();
  }

  // Whether the address carries an old invite link's code (#226). The code
  // is taken out of the address bar at once, and the page keeps nothing of
  // it, so no request carries it.
  function takeOldLink() {
    if (new URLSearchParams(location.hash.slice(1)).get('code') === null) return false;
    history.replaceState(history.state, '', location.pathname + location.search);
    return true;
  }

  async function errorOf(response) {
    try {
      return (await response.json()).error;
    } catch {
      return null;
    }
  }

  // Asks whether this browser holds a session, and says so. `replaced` is
  // true when an old invite link opened the page, so the answer says the
  // link has been replaced, whichever it is; Try again keeps it.
  async function check(replaced = false) {
    let response;
    try {
      response = await fetch('/api/upload/session', { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      say('offline', () => check(replaced));
      return;
    }
    if (response.status === 204) say(replaced ? 'readyReplaced' : 'ready');
    else if (response.status === 503) say('unavailable', () => check(replaced));
    else say(replaced ? 'replaced' : 'none');
  }

  retry.addEventListener('click', () => {
    if (again) again();
  });

  // ---- Sending (#155) ------------------------------------------------

  const sender = document.getElementById('sender');
  const albumField = document.getElementById('album');
  const albumNote = document.getElementById('album-note');
  const albumAgain = document.getElementById('album-again');
  const picker = document.getElementById('photo-input');
  const sendButton = document.getElementById('send');
  const summary = document.getElementById('send-status');
  const keepOpen = document.getElementById('keep-open');
  const list = document.getElementById('photo-list');

  // POST /api/upload's three sizes, each with its long edge and largest file
  // (lib/photos.js, SIZES; CLAUDE.md, The photo site, item 9). Made largest
  // first, each drawn from the one above it.
  const SIZES = [
    { name: 'full', longEdge: 2560, maxBytes: 3 * 1024 * 1024 },
    { name: 'screen', longEdge: 1600, maxBytes: 1024 * 1024 },
    { name: 'grid', longEdge: 480, maxBytes: 150 * 1024 },
  ];
  // JPEG qualities tried in turn until a size fits under its cap. The first
  // is where nearly every photo stops: the trip logs' 78 photos, saved at 85,
  // came to at most half of each cap (CLAUDE.md item 9).
  const QUALITIES = [0.85, 0.75, 0.6, 0.45];
  const AT_ONCE = 3;
  // Counted in characters, as the server counts it, so an emoji is one. No
  // maxlength: browsers count that in UTF-16 units, where an emoji is two,
  // and WebKit has counted it in whole symbols, which would let a caption
  // through that the server refuses.
  const CAPTION_MAX = 200;
  // Line breaks, tabs and the other control characters the server refuses in
  // a caption (lib/albums.js, CONTROL), made spaces before it is sent. The
  // two separators are built from their code points: typed as escapes, an
  // editor can turn them into the characters themselves, which end a regex
  // literal.
  const CONTROL = new RegExp(`[\\p{Cc}${String.fromCharCode(0x2028, 0x2029)}]`, 'gu');
  // Where a phone puts EXIF: an APP1 segment near the start of the file, at
  // most 64 KiB, after at most a few small segments.
  const EXIF_WINDOW = 128 * 1024;
  // The latest capture time the server takes: the last second of 9999.
  const LATEST = 253_402_300_799;

  // A 2 x 1 JPEG whose EXIF says "turn 90° clockwise to view" (orientation
  // 6), 187 bytes, in base64. A browser that turns photos upright as it
  // decodes them decodes this one 1 x 2. Built by test/jpeg.js (jpeg() and
  // exifWith()), and test/share.test.js holds this copy equal to that build.
  // Not a data: URL to fetch: the site's CSP allows connections to itself only.
  const PROBE =
    '/9j/4QAiRXhpZgAASUkqAAgAAAABABIBAwABAAAABgAAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAIDAREAAhEAAxEA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAgADAAA/AAP/2Q==';

  // What each photo shows, by state. "Queued" is a photo waiting its turn
  // after Send, which may still be being made ready.
  const STATES = {
    preparing: () => 'Getting ready…',
    ready: () => 'Ready to send',
    queued: () => 'Queued',
    sending: () => 'Sending…',
    sent: () => 'Sent',
    failed: (photo) => `Failed. ${FAILURES[photo.reason]}`,
    unreadable: (photo) => UNREADABLE[photo.reason],
  };

  // Why a photo did not send, by the answer POST /api/upload gave.
  const FAILURES = {
    offline: "Couldn't reach the photo site. Check your signal, then try again.",
    ended: 'Your sign-in has ended. Sign in again, then try again.',
    album: 'That album has closed. Choose another album above, then try again.',
    // #223: an account sends to its approved teams' albums only, so this is
    // an album the list offered before a team was taken off the account.
    team: "Your account can't send to that team's albums. Choose another album above, then try again.",
    // An account's 500 are shared by every phone signed in to it (#223).
    cap: "Your account has sent today's limit of 500 photos. Try again tomorrow.",
    unavailable: "The photo site isn't taking photos right now. Try again in a few minutes.",
    refused: "The photo site couldn't take this photo. Try again, and if it fails again, leave it out.",
  };

  // Why a photo cannot be sent from this browser at all. Chrome cannot open
  // HEIC, on a computer or on Android. An iPhone's photo picker hands the
  // page a JPEG, so HEIC reaches it mainly from the Files app, or from an
  // Android phone set to save high-efficiency pictures, whose picker hands
  // it over as it is. A file that cannot be read at all is not a format
  // problem: on #155's phone run, stale picker entries for files just
  // replaced were refused with the format wording, whose advice was wrong
  // for them.
  const UNREADABLE = {
    heic: "This browser can't open HEIC photos, so this one won't be sent. Add a JPEG copy of it instead. On an iPhone, choosing it from Photos rather than Files gives one.",
    decode: "This browser can't open this file as a photo, so it won't be sent. Add a JPEG copy of it instead.",
    read: "Couldn't read this photo from the phone, so it won't be sent. Remove it, then add it again.",
    encode: "This browser couldn't get this photo ready to send, so it won't be sent. Try adding it from another browser.",
  };

  const photos = [];
  let serial = 0;
  let making = Promise.resolve();
  let active = 0;
  let notice = '';
  let upright = null;

  const plural = (n) => `${n} photo${n === 1 ? '' : 's'}`;
  const count = (state) => photos.filter((photo) => photo.state === state).length;
  const inFlight = () => count('queued') + count('sending');

  function element(tag, className = '') {
    const made = document.createElement(tag);
    if (className) made.className = className;
    return made;
  }

  // ---- Albums

  function openSender() {
    sender.hidden = false;
    loadAlbums();
    takeShared();
  }

  // The phone's own date, YYYY-MM-DD. Albums are dated by the day they are
  // held, and "today" is where the parent is standing.
  function today() {
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  }

  // Which open album to preselect (CLAUDE.md, The photo site, item 13): one
  // held today, else the most recent past one, never a future one. The list
  // comes latest date first, so the first match is the newest. Null when
  // every open album is still to come.
  function preselect(albums, day) {
    return (albums.find((album) => album.date === day) ?? albums.find((album) => album.date < day))?.address ?? null;
  }

  // "Sat 4 Oct" in the phone's own language, from an album's YYYY-MM-DD. A
  // date with no time of day is a calendar day, not an instant, so it is
  // made and shown in UTC and reads the same day in every zone. Read as local
  // midnight or as UTC midnight shown locally, it slips a day on one side of
  // UTC or the other (a finding of #155's review).
  function heldOn(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day))
      .toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  }

  // `pick` is false after an album closed mid-send (409): the list then
  // preselects nothing, so the photos that failed go only to an album the
  // parent chooses, never quietly to the next one (owner, #155's review).
  async function loadAlbums({ pick = true } = {}) {
    let response;
    try {
      response = await fetch('/api/albums/open', { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      showAlbums(null);
      return;
    }
    if (response.status === 401) {
      showAlbums(null, 'ended');
      say('ended');
      return;
    }
    let albums = null;
    let other = [];
    if (response.ok) {
      try {
        ({ albums, other = [] } = await response.json());
      } catch {
        albums = null;
      }
    }
    showAlbums(Array.isArray(albums) ? albums : null, 'listed', pick, Array.isArray(other) ? other : []);
  }

  // A team's "Not sure / other event" (#228): its words, as migration 0015
  // titles the album and lib/albums.js's NOT_SURE_TITLE says them.
  const NOT_SURE = 'Not sure / other event';

  let listed = false;

  // The album list, or a note saying why there is none: no album open
  // (an empty list), or the list could not be read (null). A choice the
  // parent made stays chosen while its album is still open. A list that
  // could not be read keeps the one already shown; with none shown yet, the
  // select stops saying it is loading.
  //
  // `other` is each team's Not sure album (#228), listed last in its team's
  // group, after the events, and never preselected: a parent who can see
  // their event should pick it. A team with no event open still gets a group
  // holding only that choice, after the teams with events.
  function showAlbums(albums, why = 'listed', pick = true, other = []) {
    // Read before anything is hidden, as set() does: Chrome blurs a focused
    // element the moment it is hidden.
    const focused = document.activeElement;
    const any = albums !== null && albums.length + other.length > 0;
    albumNote.hidden = why === 'ended' || any;
    albumAgain.hidden = albumNote.hidden;
    albumNote.textContent = albums === null
      ? "Couldn't load the albums. Check your signal, then press Check again."
      : 'No album is taking photos right now. Check again later.';
    // Check again hidden under the keyboard's focus hands it to the list.
    if (focused === albumAgain && albumAgain.hidden) albumField.focus();
    if (albums === null) {
      if (!listed) {
        const none = element('option');
        none.value = '';
        none.textContent = 'No albums loaded';
        albumField.replaceChildren(none);
      }
      update();
      return;
    }
    listed = true;
    const kept = albumField.value;
    const listedNow = [...albums, ...other];
    const chosen = listedNow.some((album) => album.address === kept) ? kept : pick ? preselect(albums, today()) : null;
    // Grouped under each team's name (#227), so a sender sees whose event
    // each album is. The groups come in the order their teams first appear
    // in the list, newest first, and each keeps that order inside it. The
    // label is an attribute, never markup.
    const groups = new Map();
    const add = (team, option) => {
      if (!groups.has(team)) {
        const group = element('optgroup');
        group.setAttribute('label', team);
        groups.set(team, group);
      }
      groups.get(team).append(option);
    };
    for (const album of albums) {
      const option = element('option');
      option.value = album.address;
      // The title is exactly what the owner typed, markup and all: text only.
      option.textContent = `${album.title} (${heldOn(album.date)})`;
      add(String(album.teamName ?? ''), option);
    }
    for (const album of other) {
      const option = element('option');
      option.value = album.address;
      option.textContent = NOT_SURE;
      add(String(album.teamName ?? ''), option);
    }
    const options = [...groups.values()];
    if (chosen === null) {
      const blank = element('option');
      blank.value = '';
      blank.textContent = any ? 'Choose an album' : 'No album open';
      options.unshift(blank);
    }
    albumField.replaceChildren(...options);
    albumField.value = chosen ?? '';
    update();
  }

  albumAgain.addEventListener('click', () => loadAlbums());

  // ---- Making a photo ready

  // The capture time and orientation a JPEG's EXIF records, as
  // { taken, orientation }, either left out when the file does not say. It
  // reads the segments before the image data, and gives up quietly on
  // anything it cannot follow: a photo without them still sends, dated by
  // its file and drawn as the browser decoded it.
  function readExif(bytes) {
    const found = {};
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint16(0) !== 0xffd8) return found;
      let at = 2;
      while (at + 4 <= view.byteLength && view.getUint8(at) === 0xff) {
        const marker = view.getUint8(at + 1);
        if (marker === 0xff) {
          at += 1; // a fill byte before the marker
          continue;
        }
        if (marker === 0xda || marker === 0xd9) break; // the image data: no EXIF past here
        const length = view.getUint16(at + 2);
        // "Exif" and two NULs, then the TIFF structure that holds the tags.
        if (marker === 0xe1 && view.getUint32(at + 4) === 0x45786966 && view.getUint16(at + 8) === 0) {
          readTiff(new DataView(bytes.buffer, bytes.byteOffset + at + 10, Math.min(length - 8, view.byteLength - at - 10)), found);
          break;
        }
        at += 2 + length;
      }
    } catch {
      // Past the end of what was read, or not EXIF after all: keep what was found.
    }
    return found;
  }

  function readTiff(tiff, found) {
    const order = tiff.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) return; // "II" little-endian, "MM" big-endian
    const le = order === 0x4949;
    const u16 = (at) => tiff.getUint16(at, le);
    const u32 = (at) => tiff.getUint32(at, le);
    if (u16(2) !== 42) return;
    // An IFD's entries by tag: each one's type, count, and where its four
    // value bytes sit (the value itself, or where it is when it is longer).
    const entries = (offset) => {
      const tags = new Map();
      const n = u16(offset);
      for (let i = 0; i < n; i++) {
        const at = offset + 2 + i * 12;
        tags.set(u16(at), { type: u16(at + 2), count: u32(at + 4), at: at + 8 });
      }
      return tags;
    };
    const text = (entry) => {
      if (!entry || entry.type !== 2) return null; // ASCII
      const start = entry.count > 4 ? u32(entry.at) : entry.at;
      let out = '';
      for (let i = 0; i < entry.count; i++) {
        const c = tiff.getUint8(start + i);
        if (c === 0) break;
        out += String.fromCharCode(c);
      }
      return out;
    };
    const ifd0 = entries(u32(4));
    const orientation = ifd0.get(0x0112);
    if (orientation?.type === 3) { // SHORT
      const value = u16(orientation.at);
      if (value >= 1 && value <= 8) found.orientation = value;
    }
    const pointer = ifd0.get(0x8769); // the Exif IFD, a LONG or an IFD offset
    if (pointer?.type === 4 || pointer?.type === 13) {
      const exif = entries(u32(pointer.at));
      // DateTimeOriginal is when the shutter fired; DateTimeDigitized is the
      // same on a phone and differs only for a scan. DateTime (IFD0) is when
      // the file last changed, which an edit moves, so it is not read.
      const taken = when(text(exif.get(0x9003)), text(exif.get(0x9011))) ??
        when(text(exif.get(0x9004)), text(exif.get(0x9012)));
      if (taken !== null) found.taken = taken;
    }
  }

  // Unix seconds from an EXIF time, "YYYY:MM:DD HH:MM:SS", and its offset
  // ("+HH:MM", EXIF 2.31) when the camera wrote one. With no offset the time
  // is read in the phone's own zone, which is where a photo sent from it was
  // almost always taken. Null for anything that is not a real time since
  // 1970, such as the "0000:00:00 00:00:00" some cameras write.
  function when(stamp, offset) {
    const time = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(stamp ?? '');
    if (!time) return null;
    const [year, month, day, hour, minute, second] = time.slice(1).map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (year < 1970 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return null;
    const zone = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? '');
    const ms = zone
      ? Date.UTC(year, month - 1, day, hour, minute, second) -
        (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) * 60_000
      : new Date(year, month - 1, day, hour, minute, second).getTime();
    const seconds = Math.floor(ms / 1000);
    return seconds >= 0 && seconds <= LATEST ? seconds : null;
  }

  // Whether this browser turns a photo upright by its EXIF orientation as it
  // decodes it. The standard asks it of every browser, and Chrome 154 does
  // for all eight orientations (measured on #155), so a photo turned again
  // here would come out on its side. Where a browser does not, the page turns
  // it itself (TURNS). Asked once, of PROBE.
  function decodesUpright() {
    upright ??= Promise.resolve()
      .then(() => createImageBitmap(new Blob([Uint8Array.from(atob(PROBE), (c) => c.charCodeAt(0))], { type: 'image/jpeg' })))
      .then((bitmap) => {
        const turned = bitmap.width === 1 && bitmap.height === 2;
        bitmap.close();
        return turned;
      }, () => false);
    return upright;
  }

  // The transform that draws a photo stored at EXIF orientation n upright on
  // a canvas w x h (already the photo's upright shape), for a browser that
  // decodes the stored pixels as they lie. Orientation 1 needs none.
  const TURNS = {
    2: (w) => [-1, 0, 0, 1, w, 0],
    3: (w, h) => [-1, 0, 0, -1, w, h],
    4: (w, h) => [1, 0, 0, -1, 0, h],
    5: () => [0, 1, 1, 0, 0, 0],
    6: (w) => [0, 1, -1, 0, w, 0],
    7: (w, h) => [0, -1, -1, 0, w, h],
    8: (w, h) => [0, -1, 1, 0, 0, h],
  };

  // A width x height picture's size under a long edge: scaled down to fit,
  // never up, each side rounded. Every size is worked out from the picture's
  // own shape, not from the size above it, so the three agree to within the
  // rounding the server allows (lib/photos.js, sizesAgree).
  function fit(width, height, longEdge) {
    const scale = Math.min(1, longEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  // A canvas as a JPEG under `maxBytes`, trying each quality in turn. A
  // browser that cannot make a JPEG hands back another type (Safari gives
  // PNG for WebP it cannot encode), which is refused here, not sent.
  async function encode(canvas, maxBytes) {
    for (const quality of QUALITIES) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.type !== 'image/jpeg') throw new Error('encode');
      if (blob.size <= maxBytes) return blob;
    }
    throw new Error('encode');
  }

  // A chosen file as { captured, blobs, sizes }: its capture time in Unix
  // seconds and its three JPEGs with their dimensions. Throws 'decode' when
  // the browser cannot open it and 'encode' when it cannot make the JPEGs.
  // The decoded photo is closed, and each canvas emptied, as soon as the next
  // size is drawn from it, so a phone holds one photo's pixels at a time.
  async function prepare(file) {
    // The file's first bytes are read before anything decodes it, so a file
    // the phone cannot hand over says 'read', not that it is no photo.
    let head;
    try {
      head = new Uint8Array(await file.slice(0, EXIF_WINDOW).arrayBuffer());
    } catch {
      throw new Error('read');
    }
    const exif = readExif(head);
    const captured = exif.taken ?? Math.max(0, Math.floor(file.lastModified / 1000));
    let picture;
    try {
      picture = await createImageBitmap(file);
    } catch {
      throw new Error('decode');
    }
    let source = picture;
    try {
      const turn = (await decodesUpright()) ? 1 : exif.orientation ?? 1;
      const across = turn >= 5;
      const width = across ? picture.height : picture.width;
      const height = across ? picture.width : picture.height;
      const blobs = {};
      const sizes = {};
      for (const size of SIZES) {
        const { width: w, height: h } = fit(width, height, size.longEdge);
        const canvas = element('canvas');
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('encode');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        if (source === picture && turn !== 1) {
          context.setTransform(...TURNS[turn](w, h));
          context.drawImage(source, 0, 0, across ? h : w, across ? w : h);
          context.setTransform(1, 0, 0, 1, 0, 0);
        } else {
          context.drawImage(source, 0, 0, w, h);
        }
        release(source);
        source = canvas;
        blobs[size.name] = await encode(canvas, size.maxBytes);
        sizes[size.name] = { width: w, height: h };
      }
      return { captured, blobs, sizes };
    } finally {
      release(source);
      picture.close();
    }
  }

  // Lets go of a decoded photo (an ImageBitmap closes; closing twice is
  // harmless) or of a canvas's pixels (it is made 0 x 0).
  function release(drawn) {
    if (typeof drawn.close === 'function') drawn.close();
    else {
      drawn.width = 0;
      drawn.height = 0;
    }
  }

  const isHeic = (file) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

  async function makeReady(photo) {
    if (photo.removed) return;
    try {
      photo.ready = await prepare(photo.file);
    } catch (err) {
      // A removed photo is marked too; it is off the list, so nobody sees it.
      photo.reason = ['encode', 'read'].includes(err.message) ? err.message : isHeic(photo.file) ? 'heic' : 'decode';
      set(photo, 'unreadable');
      return;
    }
    if (photo.removed) return;
    const { preview } = photo.view;
    preview.src = URL.createObjectURL(photo.ready.blobs.grid);
    preview.width = photo.ready.sizes.grid.width;
    preview.height = photo.ready.sizes.grid.height;
    preview.hidden = false;
    // Only a photo nobody has acted on becomes ready. One Send queued while
    // it was being made ready stays queued, and one that has failed since
    // (a session that ended fails every queued photo) keeps its failure and
    // its Try again.
    if (photo.state === 'preparing') set(photo, 'ready');
    pump();
  }

  // ---- The list

  // `stored` gives, for a photo shared from another app (#193), the id of its
  // record in this phone's storage, deleted once the photo is stored or
  // removed; a photo chosen with Add photos has none.
  function add(files, stored = []) {
    for (const [i, file] of files.entries()) {
      serial += 1;
      const photo = { id: `photo-${serial}`, file, state: 'preparing', ready: null, album: null, batch: null, reason: null, removed: false, stored: stored[i] ?? null };
      photo.view = render(photo);
      photos.push(photo);
      list.append(photo.view.item);
      set(photo, 'preparing');
      making = making.then(() => makeReady(photo));
    }
    notice = '';
    renumber();
    update();
  }

  function render(photo) {
    const item = element('li', 'photo');
    const frame = element('div', 'photo-frame');
    const preview = element('img');
    preview.alt = '';
    preview.hidden = true;
    frame.append(preview);
    const state = element('p', 'photo-state');
    const label = element('label');
    label.setAttribute('for', `${photo.id}-caption`);
    const caption = element('input', 'photo-caption');
    caption.type = 'text';
    caption.id = `${photo.id}-caption`;
    caption.autocomplete = 'off';
    caption.setAttribute('enterkeyhint', 'done');
    caption.setAttribute('aria-describedby', `${photo.id}-count`);
    const counter = element('p', 'photo-count');
    counter.id = `${photo.id}-count`;
    counter.textContent = `0 of ${CAPTION_MAX}`;
    const actions = element('p', 'photo-actions');
    const tryAgain = element('button', 'button');
    tryAgain.type = 'button';
    tryAgain.textContent = 'Try again';
    const remove = element('button', 'button button-quiet');
    remove.type = 'button';
    remove.textContent = 'Remove';
    actions.append(tryAgain, remove);
    item.append(frame, state, label, caption, counter, actions);

    caption.addEventListener('input', () => {
      const chars = [...caption.value];
      if (chars.length > CAPTION_MAX) caption.value = chars.slice(0, CAPTION_MAX).join('');
      counter.textContent = `${Math.min(chars.length, CAPTION_MAX)} of ${CAPTION_MAX}`;
    });
    tryAgain.addEventListener('click', () => resend(photo));
    remove.addEventListener('click', () => removePhoto(photo));
    return { item, preview, state, label, caption, counter, tryAgain, remove };
  }

  // Each photo is named by its place in the list, so a screen reader says
  // which photo a caption or a button belongs to. A removal renumbers.
  function renumber() {
    photos.forEach((photo, i) => {
      const n = i + 1;
      photo.view.label.textContent = `Caption for photo ${n} (optional)`;
      photo.view.preview.alt = `Photo ${n}`;
      photo.view.tryAgain.setAttribute('aria-label', `Try again: photo ${n}`);
      photo.view.remove.setAttribute('aria-label', `Remove photo ${n}`);
    });
  }

  const REMOVABLE = new Set(['preparing', 'ready', 'queued', 'failed', 'unreadable']);

  function set(photo, state) {
    // Read before anything is hidden: Chrome blurs a focused element the
    // moment it is hidden, so asking afterwards finds the page's body
    // (measured in Chrome 154 on #155; the focus move below never ran).
    const focused = document.activeElement;
    photo.state = state;
    const view = photo.view;
    view.item.setAttribute('data-state', state);
    view.state.textContent = STATES[state](photo);
    view.tryAgain.hidden = state !== 'failed';
    view.remove.hidden = !REMOVABLE.has(state);
    view.caption.readOnly = state === 'sending' || state === 'sent';
    const noCaption = state === 'unreadable';
    view.label.hidden = noCaption;
    view.caption.hidden = noCaption;
    view.counter.hidden = noCaption;
    // A control hidden under the keyboard's focus would drop focus to the
    // top of the page, so it moves to the photo's caption, or its Remove:
    // Try again and Remove as a photo moves on, and the caption itself when
    // its photo turns out unreadable while someone is typing in it.
    if ((focused === view.tryAgain || focused === view.remove || focused === view.caption) && focused.hidden) {
      (view.caption.hidden ? view.remove : view.caption).focus();
    }
    update();
  }

  function removePhoto(photo) {
    const at = photos.indexOf(photo);
    if (at === -1 || !REMOVABLE.has(photo.state)) return;
    photos.splice(at, 1);
    photo.removed = true;
    forget(photo.stored);
    if (photo.view.preview.src) URL.revokeObjectURL(photo.view.preview.src);
    photo.view.item.remove();
    renumber();
    update();
    const next = photos[at] ?? photos[at - 1];
    if (!next) picker.focus();
    else (next.view.remove.hidden ? next.view.caption : next.view.remove).focus();
  }

  // ---- Sending

  picker.addEventListener('change', () => {
    const files = [...picker.files];
    // Cleared, so choosing the same photos again is still a change.
    picker.value = '';
    if (files.length) add(files);
  });

  sendButton.addEventListener('click', () => {
    const waiting = photos.filter((photo) => photo.state === 'ready' || photo.state === 'preparing');
    if (waiting.length === 0) {
      notice = 'Nothing new to send. Add photos first.';
      update();
      return;
    }
    if (!albumField.value) {
      notice = 'Choose an album first.';
      update();
      albumField.focus();
      return;
    }
    notice = '';
    // One batch per press of Send, so the approval queue (#156) can show
    // them together. crypto.randomUUID() is lowercase, as the route requires.
    const batch = crypto.randomUUID();
    for (const photo of waiting) {
      photo.album = albumField.value;
      photo.batch = batch;
      set(photo, 'queued');
    }
    pump();
  });

  // A failed photo goes again into the album chosen now, in its first batch.
  function resend(photo) {
    if (photo.state !== 'failed') return;
    if (!albumField.value) {
      notice = 'Choose an album first.';
      update();
      albumField.focus();
      return;
    }
    notice = '';
    photo.album = albumField.value;
    photo.reason = null;
    set(photo, 'queued');
    pump();
  }

  // Starts queued photos that are ready, no more than AT_ONCE at a time.
  function pump() {
    while (active < AT_ONCE) {
      const photo = photos.find((one) => one.state === 'queued' && one.ready);
      if (!photo) return;
      active += 1;
      upload(photo).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  // A caption as the server takes it: control characters made spaces, the
  // ends trimmed, and no more than CAPTION_MAX characters.
  const clean = (value) => [...value.replace(CONTROL, ' ').trim()].slice(0, CAPTION_MAX).join('').trim();

  async function upload(photo) {
    set(photo, 'sending');
    const caption = clean(photo.view.caption.value);
    const form = new FormData();
    form.append('album', photo.album);
    form.append('batch', photo.batch);
    form.append('captured', String(photo.ready.captured));
    if (caption) form.append('caption', caption);
    for (const { name } of SIZES) form.append(name, photo.ready.blobs[name], `${name}.jpg`);
    let response;
    try {
      response = await fetch('/api/upload', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      fail(photo, 'offline');
      return;
    }
    if (response.status === 201) {
      // The two larger JPEGs are let go; the preview keeps the grid's. A
      // shared photo's record goes too, now the server has it.
      photo.ready.blobs = null;
      forget(photo.stored);
      set(photo, 'sent');
      return;
    }
    if (response.status === 401) {
      // The session has ended: every queued photo would get the same answer,
      // so none of them is sent until the sender signs in again.
      fail(photo, 'ended');
      for (const waiting of photos.filter((one) => one.state === 'queued')) fail(waiting, 'ended');
      say('ended');
    } else if (response.status === 409) {
      // The album closed: every queued photo bound for it would be sent in
      // full only to be refused, so they stop here too. Only those: a later
      // Send or a Try again may have queued photos for another album.
      fail(photo, 'album');
      for (const waiting of photos.filter((one) => one.state === 'queued' && one.album === photo.album)) fail(waiting, 'album');
      loadAlbums({ pick: false });
    } else if (response.status === 403 && (await errorOf(response)) === 'team') {
      // #223: the account is no longer approved for that album's team. Every
      // queued photo bound for it would be refused too, and only those; the
      // list reloads without the team's albums and preselects nothing, as
      // after a 409.
      fail(photo, 'team');
      for (const waiting of photos.filter((one) => one.state === 'queued' && one.album === photo.album)) fail(waiting, 'team');
      loadAlbums({ pick: false });
    } else if (response.status === 429) {
      fail(photo, 'cap');
      for (const waiting of photos.filter((one) => one.state === 'queued')) fail(waiting, 'cap');
    } else if (response.status === 503) {
      fail(photo, 'unavailable');
    } else {
      fail(photo, 'refused');
    }
  }

  function fail(photo, reason) {
    photo.reason = reason;
    set(photo, 'failed');
  }

  // ---- The summary

  function summaryText() {
    const sent = count('sent');
    const failed = count('failed');
    const sending = inFlight();
    const waiting = count('ready') + count('preparing');
    const unreadable = count('unreadable');
    const parts = notice ? [notice] : [];
    if (sending > 0) {
      parts.push(`Sending ${plural(sent + failed + sending)}: ${sent} sent${failed ? `, ${failed} failed` : ''}.`);
    } else if (failed > 0) {
      parts.push(`Sent ${sent} of ${sent + failed}. ${failed} failed: press Try again on ${failed === 1 ? 'it' : 'each one'}.`);
    } else if (sent > 0) {
      parts.push(`Sent ${plural(sent)}. They'll appear in the album once they're reviewed.`);
    }
    if (waiting > 0) parts.push(`${plural(waiting)} ${sent + failed + sending ? 'more ' : ''}ready to send.`);
    if (unreadable > 0) parts.push(`${plural(unreadable)} can't be sent from this browser.`);
    return parts.join(' ');
  }

  // The live region is written once for everything that changed together
  // (a press of Send queues every photo at once), and only when its words
  // change, so a screen reader hears each change once: a photo sent or
  // failed, not every step.
  let updating = false;
  function update() {
    if (updating) return;
    updating = true;
    Promise.resolve().then(() => {
      updating = false;
      const text = summaryText();
      if (summary.textContent !== text) summary.textContent = text;
      keepOpen.hidden = inFlight() === 0;
      sendButton.hidden = photos.length === 0;
    });
  }

  // Leaving while photos are queued or sending asks first.
  window.addEventListener('beforeunload', (event) => {
    if (inFlight() > 0) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // ---- Shared photos (#193) ------------------------------------------

  // The store share/sw.js keeps shared photos in, one record per file: the
  // same three names as there, and the same day.
  const INBOX = 'madcow-shared';
  const INBOX_VERSION = 1;
  const FILES = 'files';
  const KEEP_MS = 24 * 60 * 60 * 1000;

  const sharedNote = document.getElementById('shared-note');
  // What a share that went wrong says. 'empty' is a share that carried no
  // photo the worker could read: Chrome's own shares arrive that way
  // (measured on Android at #193's review), and sharing again from Chrome
  // would do the same, so it names another way.
  const SHARED_NOTES = {
    failed: "The photos you shared couldn't be kept on this phone. Share them again.",
    empty: "No photos arrived with that share. Share them from your phone's gallery or Files app instead.",
  };

  // How the share that opened this page went, from share/sw.js's ?shared:
  // 'kept', 'failed', 'empty', or null when no share opened it. Taken out of
  // the address bar at once, so a reload or a bookmark does not say it again.
  function takeSharedFlag() {
    const params = new URLSearchParams(location.search);
    if (!params.has('shared')) return null;
    const value = params.get('shared');
    const flag = value === 'failed' || value === 'empty' ? value : 'kept';
    params.delete('shared');
    const search = params.toString();
    history.replaceState(history.state, '', location.pathname + (search ? `?${search}` : '') + location.hash);
    return flag;
  }

  const sharedFlag = takeSharedFlag();

  // Runs `work` on the store in one transaction, as share/sw.js does, and
  // settles with whatever `work` put in `out` once the transaction commits.
  function inbox(work) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(INBOX, INBOX_VERSION);
      open.onupgradeneeded = () => open.result.createObjectStore(FILES, { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const out = {};
        const done = (err) => {
          db.close();
          if (err) reject(err);
          else resolve(out);
        };
        let tx;
        try {
          tx = db.transaction(FILES, 'readwrite');
        } catch (err) {
          done(err);
          return;
        }
        tx.oncomplete = () => done(null);
        tx.onabort = () => done(tx.error ?? new Error('aborted'));
        try {
          work(tx.objectStore(FILES), out);
        } catch {
          tx.abort();
        }
      };
    });
  }

  // The shared files waiting on this phone, as { id, file }, in the order
  // they were shared. A record over a day old is deleted as it is read and
  // never offered. The rest stay until forget() deletes them, once each photo
  // is stored or removed (owner, at #193's review), so a reload or a second
  // share before Send offers them again. A browser with no storage has
  // nothing waiting; storage that fails is null.
  async function shared() {
    if (typeof indexedDB === 'undefined') return [];
    try {
      const out = await inbox((store, found) => {
        const now = Date.now();
        const all = store.getAll();
        all.onsuccess = () => {
          found.files = [];
          // Oldest share first, and each share's files in the order shared.
          // Two shares never carry one timestamp: each is its own navigation.
          for (const record of [...all.result].sort((a, b) => a.at - b.at || a.index - b.index)) {
            if (now - record.at > KEEP_MS) store.delete(record.id);
            else found.files.push({ id: record.id, file: record.file });
          }
        };
      });
      return out.files ?? [];
    } catch {
      return null;
    }
  }

  // Deletes a shared file's record: its photo is stored on the server, or the
  // sender removed it. A record that cannot be deleted is offered again until
  // it is a day old.
  function forget(id) {
    if (id === null || typeof indexedDB === 'undefined') return;
    inbox((store) => store.delete(id)).catch(() => {});
  }

  // The note a share's outcome calls for, or null. Storage that cannot be
  // read after a share is a share not kept.
  const trouble = (waiting) => (sharedFlag === 'failed' || sharedFlag === 'empty' ? sharedFlag : waiting === null && sharedFlag ? 'failed' : null);

  // With a session: every waiting photo not already in the list joins it,
  // ready to send. Two calls close together (a second session check, which
  // an old invite link opened in this tab starts; a rejoin until #226)
  // cannot both add one photo: each read is a readwrite transaction on one
  // store, which IndexedDB runs strictly in order, so the second read
  // answers only after the first has committed and listed its photos.
  // (#193's mutation round found a promise chain doing the same job here
  // could be deleted with nothing going red; the platform was the guard.)
  async function takeShared() {
    const waiting = await shared();
    const fresh = (waiting ?? []).filter(({ id }) => !photos.some((photo) => photo.stored === id));
    if (fresh.length) add(fresh.map(({ file }) => file), fresh.map(({ id }) => id));
    showShared(trouble(waiting));
  }

  // Without one: they stay, and the page says how many are waiting.
  async function waitShared() {
    const waiting = await shared();
    const problem = trouble(waiting);
    if (problem) showShared(problem);
    else showShared(waiting?.length ? 'waiting' : null, waiting?.length ?? 0);
  }

  function showShared(state, n = 0) {
    sharedNote.hidden = state === null;
    if (state === 'waiting') {
      sharedNote.textContent = `${plural(n)} you shared ${n === 1 ? 'is' : 'are'} waiting on this phone. ` +
        `Sign in, and ${n === 1 ? 'it' : 'they'} will be ready to send. ` +
        'Shared photos are kept here for a day.';
    } else sharedNote.textContent = SHARED_NOTES[state] ?? '';
  }

  // ---- Start

  // share/sw.js takes photos shared from another app. It controls /share/
  // only and keeps no copy of anything, so it changes nothing about how this
  // page or any other loads. A browser with no workers, or one that refuses
  // this one, still sends: Add photos needs none.
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.register('/share/sw.js', { scope: '/share/', updateViaCache: 'none' }).catch(() => {});
  }

  check(takeOldLink());

  // A link that differs from the open page only after # does not reload it:
  // opening an old invite link in a tab already on /share/ changes the hash
  // and nothing else. Without this, the code would sit in the address bar
  // and the page would go on showing the last answer. Measured on #150, when
  // it was also how a parent whose invite ended mid-send carried on, by
  // opening the new link in this tab; since #226 that tab is told the link
  // has been replaced, as a fresh load is.
  window.addEventListener('hashchange', () => {
    if (takeOldLink()) check(true);
  });
})();
