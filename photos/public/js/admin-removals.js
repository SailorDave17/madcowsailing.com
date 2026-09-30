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
 * The CSP allows no inline script, so this is a file of its own. */
(() => {
  'use strict';

  const dialog = document.getElementById('delete-dialog');
  const title = document.getElementById('delete-title');
  const confirm = document.getElementById('delete-confirm');

  for (const button of document.querySelectorAll('button[data-delete]')) {
    button.addEventListener('click', () => {
      title.textContent = `Delete photo ${button.dataset.delete} permanently?`;
      confirm.value = button.dataset.delete;
      dialog.showModal();
    });
  }

  for (const time of document.querySelectorAll('time[datetime]')) {
    time.textContent = new Date(time.dateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
})();
