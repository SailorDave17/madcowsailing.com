// The request form at /ask (#220): Turnstile's script, added the first time
// someone starts on the form rather than at load (owner, at #220's review,
// 2026-10-05). Loaded with the page, it put /ask at 86-87 for performance
// through tools/h2proxy.mjs, under the photo site's floor of 95; added on the
// form's first focus or touch, the page read 96-99 (CLAUDE.md, The photo
// site, item 25, has the runs). Its widget fills
// .cf-turnstile, whose room the stylesheet keeps, so nothing moves when it
// arrives.
//
// A page the server sent back with a reason (#ask-problems) is someone part
// way through, so there the script goes in at once.
//
// Without JavaScript none of this runs, and the page's <noscript> says the
// check needs it. The URL is the one Turnstile's docs allow, which
// lib/ask-page.js's TURNSTILE_SCRIPT holds; test/ask.test.js holds the two
// equal.
(() => {
  const form = document.querySelector('.ask-form');
  if (!form) return;
  let added = false;
  const add = () => {
    if (added) return;
    added = true;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    document.head.append(script);
  };
  if (document.getElementById('ask-problems')) {
    add();
    return;
  }
  form.addEventListener('focusin', add);
  form.addEventListener('pointerdown', add);
})();
