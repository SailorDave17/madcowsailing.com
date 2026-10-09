/* The approval queue (#156): the reject dialog, the caption limit, and each
 * time in the reader's own time zone.
 *
 * Nothing here sends anything. A "Reject" or "Reject all" button only opens
 * the dialog, after pointing its confirm button at the button's batch form
 * (the form attribute) with reject=<id> or reject=all. So the confirm button
 * posts that batch's form, captions included, to /api/admin/queue/reject, and
 * Cancel closes the dialog through method="dialog". The page is rendered by
 * functions/admin/queue.js, behind the admin guard; this file is public, and
 * holds no photo and no address.
 *
 * Since #198 the dialog names a clip: a clip's Reject carries data-kind="clip",
 * and Reject all how many of its batch are clips (data-clips), so the title
 * counts each kind and the words say what goes. The page's own words are a
 * photo's, and come back for the next photo.
 *
 * The CSP allows no inline script, so this is a file of its own. */
(() => {
  'use strict';

  const dialog = document.getElementById('reject-dialog');
  const title = document.getElementById('reject-title');
  const text = document.getElementById('reject-text');
  const confirm = document.getElementById('reject-confirm');

  // What a reject deletes: a photo's three sizes, a clip's one file.
  const PHOTO_WORDS = text.textContent;
  const CLIP_WORDS = 'A rejected clip is deleted for good. This cannot be undone.';
  const BOTH_WORDS = 'Rejected photos and clips are deleted for good, each photo with all three of its sizes. This cannot be undone.';

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  for (const button of document.querySelectorAll('button[data-reject]')) {
    button.addEventListener('click', () => {
      const all = button.dataset.reject === 'all';
      if (all) {
        const count = Number(button.dataset.count);
        const clips = Number(button.dataset.clips ?? 0);
        const photos = count - clips;
        const both = [photos ? plural(photos, 'photo', 'photos') : '', clips ? plural(clips, 'clip', 'clips') : ''];
        title.textContent = `Reject all ${both.filter(Boolean).join(' and ')} in this batch?`;
        text.textContent = !clips ? PHOTO_WORDS : photos ? BOTH_WORDS : CLIP_WORDS;
      } else {
        const clip = button.dataset.kind === 'clip';
        title.textContent = `Reject ${clip ? 'clip' : 'photo'} ${button.dataset.reject}?`;
        text.textContent = clip ? CLIP_WORDS : PHOTO_WORDS;
      }
      confirm.textContent = all ? `Reject ${button.dataset.count}` : 'Reject';
      confirm.value = button.dataset.reject;
      confirm.setAttribute('form', button.dataset.form);
      dialog.showModal();
    });
  }

  // A caption stops at 200 characters, counted as the server counts them, so
  // an emoji is one, and so no press is refused for one caption, which would
  // lose every caption typed in the batch (#156's review). As on the share
  // page, not maxlength: browsers count that in UTF-16 units, and WebKit in
  // whole symbols, which would let through a caption the server refuses.
  const CAPTION_MAX = 200;
  for (const field of document.querySelectorAll('input[name^="caption-"]')) {
    field.addEventListener('input', () => {
      const chars = [...field.value];
      if (chars.length > CAPTION_MAX) field.value = chars.slice(0, CAPTION_MAX).join('');
    });
  }

  for (const time of document.querySelectorAll('time[datetime]')) {
    time.textContent = new Date(time.dateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
})();
