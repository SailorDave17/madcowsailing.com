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
 * The CSP allows no inline script, so this is a file of its own. */
(() => {
  'use strict';

  const dialog = document.getElementById('reject-dialog');
  const title = document.getElementById('reject-title');
  const confirm = document.getElementById('reject-confirm');

  for (const button of document.querySelectorAll('button[data-reject]')) {
    button.addEventListener('click', () => {
      const all = button.dataset.reject === 'all';
      const count = button.dataset.count;
      title.textContent = all ? `Reject all ${count} photos in this batch?` : `Reject photo ${button.dataset.reject}?`;
      confirm.textContent = all ? `Reject ${count}` : 'Reject';
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
