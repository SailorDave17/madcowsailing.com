/* The admin invite-code page (#152): the two copy buttons, the rotate
 * dialog, and the change time in the reader's own time zone.
 *
 * Nothing here sends anything. Rotating is the dialog's own form POST: the
 * page's "Rotate code" button only opens the dialog, its Cancel closes it
 * through method="dialog", and only "Rotate now" posts. The page is rendered
 * by functions/admin/code.js, behind the admin guard; this file is public, and
 * holds no code and no address.
 *
 * The CSP allows no inline script, so this is a file of its own. */
(() => {
  'use strict';

  const status = document.getElementById('copy-status');
  const COPIED = {
    'invite-code': 'Code copied.',
    'invite-link': 'Invite link copied.',
  };

  for (const button of document.querySelectorAll('button[data-copy]')) {
    button.addEventListener('click', async () => {
      const source = button.dataset.copy;
      // Emptied first, so copying the same thing twice is announced twice.
      status.textContent = '';
      try {
        // Throws where the clipboard is unavailable, as on plain http.
        await navigator.clipboard.writeText(document.getElementById(source).textContent);
        status.textContent = COPIED[source];
      } catch {
        status.textContent = "Couldn't copy. Select it above and copy it by hand.";
      }
    });
  }

  const dialog = document.getElementById('rotate-dialog');
  const open = document.getElementById('rotate-open');
  if (dialog && open) open.addEventListener('click', () => dialog.showModal());

  for (const time of document.querySelectorAll('time[datetime]')) {
    time.textContent = new Date(time.dateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
})();
