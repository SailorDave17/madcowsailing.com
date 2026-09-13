/* Gallery lightbox — story #12. Vanilla, no library, no build step.
 *
 * Built on the native <dialog>, which is the point of the story: the platform
 * gives the focus trap, the ::backdrop, Escape-to-close, and inert-ing the rest
 * of the page. Everything below is the part <dialog> does NOT give — the photo,
 * the counter, the arrows, the swipe, and returning focus to the thumbnail that
 * opened it.
 *
 * The photos are read from the DOM rather than from a manifest. tools/photos.py
 * already writes every fact this needs into each figure — the -full href on the
 * <a class="frame">, the alt on the <img>, the real width and height — so a
 * second copy of the list in a data island would be a second thing to keep in
 * step. The generator and this file agree on the markup, and on nothing else.
 *
 * No JavaScript at all is a supported way to read the page (#12 AC 6): the grid
 * is already there and every thumbnail is already a plain link to the -full
 * image. This only intercepts a click that would have gone to that link. Fail
 * anywhere and the link still works, which is why nothing here is defensive.
 */
(function () {
  'use strict';

  var gallery = document.querySelector('.gallery');
  if (!gallery) return;                      // every non-trip page

  var frames = Array.prototype.slice.call(gallery.querySelectorAll('a.frame'));
  if (frames.length === 0) return;

  /* Ends WRAP rather than stop (owner decision, 2026-09-04, recorded on #12).
     So there is no disabled state on either button, and the counter rolling
     24 / 24 -> 1 / 24 is what tells you the gallery ended. Every index that
     enters this function is taken modulo the count, which is what lets the
     arrow handlers below be arithmetic and nothing else. */
  function at(i) {
    var n = frames.length;
    return ((i % n) + n) % n;
  }

  var photos = frames.map(function (frame) {
    var img = frame.querySelector('img');
    return {
      frame: frame,
      full: frame.getAttribute('href'),
      alt: img ? img.getAttribute('alt') : '',
      caption: frame.getAttribute('data-caption') || '',
      width: img ? img.getAttribute('width') : null,
      height: img ? img.getAttribute('height') : null,
      /* A video frame's href is the .mp4 itself, so the no-JS baseline is a
         plain link the browser plays on its own - same shape as a photo's link
         to its -full derivative. The poster comes off data-poster rather than
         off the <img> src, because the <img> may be showing a 400w thumb. */
      video: frame.classList.contains('is-video'),
      poster: frame.getAttribute('data-poster') || '',
      /* The clip's own dimensions, which are NOT the poster's: the poster went
         through the photo derivative ladder and can be 2000px wide while the
         clip is 720. width/height above describe the <img> in the grid and stay
         right for it; these describe the <video>. */
      vw: frame.getAttribute('data-vw') || null,
      vh: frame.getAttribute('data-vh') || null
    };
  });

  /* ---- The dialog ----------------------------------------------------
     Built once, here, rather than written into every generated trip page: it
     is identical on all of them and it is useless without this script, so a
     page read with JS off should not carry it. */

  var dialog = document.createElement('dialog');
  dialog.className = 'lightbox';

  dialog.innerHTML =
    '<div class="lightbox-stage">' +
      '<img class="lightbox-img" alt="">' +
      /* Native controls, deliberately. A custom transport would be a second
         focus-trap problem inside a dialog that already solved its first, and
         the platform's controls are keyboard-reachable and localised for free.
         playsinline keeps iOS from taking the video fullscreen and throwing
         away the dialog around it. */
      '<video class="lightbox-video" controls playsinline preload="none" hidden></video>' +
    '</div>' +
    '<div class="lightbox-bar">' +
      '<p class="lightbox-caption"></p>' +
      '<p class="lightbox-counter" aria-live="polite"></p>' +
    '</div>' +
    '<button type="button" class="lightbox-close" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M5 5 19 19M19 5 5 19" />' +
      '</svg>' +
    '</button>' +
    '<button type="button" class="lightbox-nav lightbox-prev" aria-label="Previous photo">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M15 4 7 12l8 8" />' +
      '</svg>' +
    '</button>' +
    '<button type="button" class="lightbox-nav lightbox-next" aria-label="Next photo">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M9 4l8 8-8 8" />' +
      '</svg>' +
    '</button>';

  document.body.appendChild(dialog);

  var img = dialog.querySelector('.lightbox-img');
  var video = dialog.querySelector('.lightbox-video');
  var caption = dialog.querySelector('.lightbox-caption');
  var counter = dialog.querySelector('.lightbox-counter');

  /* Stopping playback is its own function because it has to happen on EVERY
     route away from a clip, and there are three: stepping to the next photo,
     stepping to the previous one, and closing the dialog. Miss one and the
     audio keeps running under whatever is on screen next - a failure with no
     visible symptom, which is the kind this repo keeps a register of.
     Clearing src as well as pausing is what stops the download continuing. */
  function stopVideo() {
    if (!video.hidden) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
    }
  }

  /* A one-photo trip has nowhere to navigate, so the arrows are REMOVED rather
     than disabled — which is the same call the wrap decision made at the ends,
     for the same reason: this lightbox has no disabled state anywhere, and
     adding one here for a case that is only ever all-or-nothing would be the
     one place it appears.

     Not a hypothetical input. tools/photos.py's own end-to-end run was against
     a single photo (docs/sailing-site.md), so a one-photo trip is a
     configuration this pipeline has already produced. Left alone, `at()`
     returns 0 for every index and both buttons stay in the focus trap
     announcing themselves to a screen reader while doing nothing — and the
     counter, which is what tells you the gallery wrapped, reads "1 / 1"
     identically before and after, so the aria-live region never announces
     either. Two controls that cannot act is worse than no controls. */
  if (photos.length === 1) {
    dialog.querySelector('.lightbox-prev').remove();
    dialog.querySelector('.lightbox-next').remove();
  }

  var current = 0;
  var opener = null;      // the thumbnail that opened it; focus goes back here

  /* Preload is exactly the two neighbours and nothing else (#12 AC 3). A plain
     Image() is enough: the request lands in the cache under the same URL the
     <img> will ask for, so stepping to it is instant and the network panel
     shows three -full requests for one open, never twenty-four. Under wrap the
     neighbours of the last photo are the second-to-last and the FIRST, which
     is the one case a naive i-1 / i+1 gets wrong. */
  var preloaded = {};
  function preload(i) {
    var photo = photos[at(i)];
    /* Videos are never preloaded. `full` is an .mp4 for them, and handing that
       to new Image() starts a download of several megabytes into an element
       that can never render a frame of it - the request succeeds, nothing
       appears, and the only symptom is the bandwidth. The <video> element
       carries preload="none" for the same reason: a clip costs its bytes when
       someone presses play, not when they arrow past it. */
    if (photo.video) return;
    var url = photo.full;
    if (preloaded[url]) return;
    preloaded[url] = new Image();
    preloaded[url].src = url;
  }

  function show(i) {
    stopVideo();
    current = at(i);
    var photo = photos[current];

    if (photo.video) {
      /* The poster carries the still while the clip loads, so the stage never
         flashes empty between photo and video. No autoplay: a gallery that
         starts making noise because you pressed Right is a worse default than
         one extra tap, and autoplay with sound is blocked by every browser
         anyway - so it would half-work, which is worse than not at all. */
      img.hidden = true;
      img.removeAttribute('src');
      video.hidden = false;
      if (photo.poster) video.poster = photo.poster;
      video.src = photo.full;
      if (photo.vw) video.width = photo.vw;
      if (photo.vh) video.height = photo.vh;
    } else {
      video.hidden = true;
      img.hidden = false;
      img.src = photo.full;
      img.alt = photo.alt;
      if (photo.width) img.width = photo.width;
      if (photo.height) img.height = photo.height;
    }

    /* The caption is optional and today no photo has one (owner decision,
       2026-09-04): tools/photos.py writes data-caption only when the manifest
       entry carries a caption, so this is empty on all 24 current photos and
       the element is hidden rather than left as an empty gap. Write a caption
       into trip.json and it appears here with no change to this file. */
    caption.textContent = photo.caption;
    caption.hidden = !photo.caption;

    counter.textContent = (current + 1) + ' / ' + photos.length;

    preload(current + 1);
    preload(current - 1);
  }

  function open(i, from) {
    opener = from;
    show(i);
    dialog.showModal();
  }

  /* Focus returns to the thumbnail that opened the dialog (#12 AC 4). The
     `close` event fires for every route out — Escape, the backdrop, the close
     button, and a programmatic close() — so this is the one place it belongs;
     hanging it off each of those individually is how one route gets missed. */
  dialog.addEventListener('close', function () {
    stopVideo();
    if (opener) {
      opener.focus();
      opener = null;
    }
  });

  frames.forEach(function (frame, i) {
    /* click, not keydown: a focused <a href> fires a click on Enter by itself,
       so Enter-from-a-thumbnail (#12 AC 1) is the platform's job, not ours.
       Only a plain left click is taken — a modifier or a middle click means
       the reader asked for the -full image in a tab, and that must still
       work. */
    frame.addEventListener('click', function (event) {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(i, frame);
    });
  });

  dialog.querySelector('.lightbox-close').addEventListener('click', function () {
    dialog.close();
  });
  /* Delegated off the dialog rather than bound to each button, because on a
     one-photo gallery the buttons are removed above and a direct
     querySelector('.lightbox-prev').addEventListener would throw on null -
     taking the whole script with it and leaving a page whose thumbnails still
     work but whose lightbox never opens. Delegation has no such edge: a
     selector that matches nothing simply never fires. */
  dialog.addEventListener('click', function (event) {
    var nav = event.target.closest('.lightbox-nav');
    if (!nav) return;
    show(current + (nav.classList.contains('lightbox-next') ? 1 : -1));
  });

  /* Backdrop click — close when the click was not on the photo and not on a
     control. Stated that way round on purpose, because the two obvious ways to
     write this are both wrong here, and both were measured wrong rather than
     reasoned wrong:

     - `event.target === dialog` never fires. .lightbox-stage is 100% x 100% of
       a dialog whose own box is the viewport, so the stage is under every
       reachable point and the dialog is under none: 0 of 736 probed viewport
       points hit-test to it. A handler guarded on that is dead code.
     - Comparing the point against the DIALOG's box never fires either, for the
       same reason - that box IS the viewport, so every click is "inside" it.
       A <dialog>'s ::backdrop is not an element and gets no events of its own,
       which is what makes the usual recipe inapplicable once the dialog is
       deliberately viewport-sized.

     Testing the target against the stage alone is also not enough: a click in
     the side gutter can land on the <svg> inside a nav button, and at 390px
     wide the photo leaves only about 8px of stage either side, so a
     stage-only test would leave a phone with almost nothing to tap.

     So the question asked is the one the reader is actually asking - "did I
     click the picture, or a button?" - and everything else closes. */
  dialog.addEventListener('click', function (event) {
    if (event.target.closest('.lightbox-close, .lightbox-nav')) return;
    /* Measure whichever element is actually on stage. A hidden <img> reports a
       rect of all zeros, so testing it while a video is showing puts every
       point "outside the photo" and closes the dialog the instant someone
       reaches for the play button - the controls are dead centre, which is
       exactly where the zero-rect test says to close. The stage holds one of
       the two at a time, so ask the visible one. */
    var stage = video.hidden ? img : video;
    var box = stage.getBoundingClientRect();
    var onPhoto = box.left <= event.clientX && event.clientX <= box.right &&
                  box.top <= event.clientY && event.clientY <= box.bottom;
    if (!onPhoto) dialog.close();
  });

  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(current - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(current + 1);
    }
    /* Escape is deliberately absent: <dialog> already closes on it, and
       handling it here would either close it twice or fight the platform. */
  });

  /* Swipe. Pointer events rather than touch events, so a finger and a pen are
     one code path. The threshold is in pixels and horizontal-dominant, so a
     vertical drag to scroll is never read as a photo change. */
  var SWIPE_MIN = 40;
  var start = null;

  dialog.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse') return;
    /* A drag that STARTS on a control is that control's, not a swipe. Without
       this, a horizontal drag inside a nav button advances twice: once when
       pointerup runs the swipe, and again when the browser then dispatches
       click on the button. The two handlers cannot detect each other - `start`
       is already cleared by the time the click arrives - so the only place to
       settle it is here, before a gesture is claimed. The buttons are about
       42px square and the swipe threshold is 40px, so the window is narrow;
       it is also exactly where a thumb rests at phone width. */
    if (event.target.closest('.lightbox-close, .lightbox-nav')) return;
    start = { x: event.clientX, y: event.clientY };
  });

  dialog.addEventListener('pointerup', function (event) {
    if (!start) return;
    var dx = event.clientX - start.x;
    var dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
    show(current + (dx < 0 ? 1 : -1));
  });

  dialog.addEventListener('pointercancel', function () {
    start = null;
  });
})();
