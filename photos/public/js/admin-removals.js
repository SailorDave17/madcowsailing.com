/* The removal requests (#158): the delete dialog, and each time in the
 * reader's own time zone.
 *
 * Nothing here sends anything. A "Delete permanently" button only opens the
 * dialog, after giving its confirm button that photo's id, so the confirm
 * posts photo=<id> to /api/admin/removals/delete, and Cancel closes the
 * dialog through method="dialog". The page is rendered by
 * functions/admin/removals.js, behind the admin guard; this file is public,
 * and holds no photo, note or address.
 *
 * Since #310 the dialog names a clip, as the queue's does (admin-queue.js): a
 * hidden clip's button carries data-kind="clip", and the words say a clip's
 * one file goes. The page's own words are a photo's, and come back for the
 * next photo.
 *
 * The CSP allows no inline script, so this is a file of its own. */
(() => {
  'use strict';

  const dialog = document.getElementById('delete-dialog');
  const title = document.getElementById('delete-title');
  const text = document.getElementById('delete-text');
  const confirm = document.getElementById('delete-confirm');

  // What a delete removes: a photo's three sizes, a clip's one file.
  const PHOTO_WORDS = text.textContent;
  const CLIP_WORDS = 'The clip is deleted for good. This cannot be undone.';

  for (const button of document.querySelectorAll('button[data-delete]')) {
    button.addEventListener('click', () => {
      const clip = button.dataset.kind === 'clip';
      title.textContent = `Delete ${clip ? 'clip' : 'photo'} ${button.dataset.delete} permanently?`;
      text.textContent = clip ? CLIP_WORDS : PHOTO_WORDS;
      confirm.value = button.dataset.delete;
      dialog.showModal();
    });
  }

  for (const time of document.querySelectorAll('time[datetime]')) {
    time.textContent = new Date(time.dateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
})();
