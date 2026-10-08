/* "Remove this photo" (#158): the dialog on an album page.
 *
 * Each photo's "Remove this photo" is a submit button in a form posting its
 * id to /remove, the confirmation page a browser without JavaScript shows.
 * Here a press opens the page's native <dialog> instead: its words, the
 * optional note and "Remove it", which carries the photo's id and posts to
 * /api/remove. Cancel closes it through method="dialog". Nothing here sends
 * anything itself.
 *
 * templates/page.html loads this on every public page. Only an album page
 * has the dialog, so on any other it stops at once.
 *
 * The CSP allows no inline script, so this is a file of its own. */
(() => {
  'use strict';

  const dialog = document.getElementById('remove-dialog');
  if (!dialog) return;
  const confirm = document.getElementById('remove-confirm');
  const note = document.getElementById('remove-note');

  for (const button of document.querySelectorAll('button.remove-open')) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      confirm.value = button.value;
      // A note typed for another photo and then cancelled is not carried over.
      note.value = '';
      dialog.showModal();
    });
  }
})();
