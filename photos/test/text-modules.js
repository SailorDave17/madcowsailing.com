// Loads a .html import as its text, the way Pages bundles one (#157): Pages
// Functions import an HTML file "as a String" (developers.cloudflare.com/
// pages/functions/module-support, read 2026-09-30), and Node has no such
// module type. lib/public-page.js imports templates/page.html that way, so
// without this test/public.test.js, which imports it and the three public
// routes, fails to load. (test/guard.test.js imports only the routes it
// guards, never those in its PUBLIC list: measured by running the suite
// without this file, where public.test.js alone went red.)
//
// npm test registers it with --import before any test file runs. Not a test
// file: npm test runs only *.test.js. module.registerHooks is Node 23.5 and
// later; CI runs Node 24.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.html')) {
      const text = readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
