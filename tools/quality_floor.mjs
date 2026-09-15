#!/usr/bin/env node
// Measure the CLAUDE.md quality floor on both PRODUCTION domains and write the
// numbers into docs/quality-floor.md, between its generated-block markers.
//
//   node tools/quality_floor.mjs                 every page, 3 Lighthouse runs each
//   node tools/quality_floor.mjs --runs 1        quicker, noisier
//   node tools/quality_floor.mjs --only /logs/   pages whose URL contains the string
//   node tools/quality_floor.mjs --base-hq http://127.0.0.1:8765 --base-sailing http://127.0.0.1:8766
//                                                measure a local serve instead (the
//                                                negative controls in the doc use this)
//
// Not wired into CI, on purpose. CLAUDE.md says there is no build pipeline and
// this is a measurement of the DEPLOYED sites, taken after a promotion, not a
// gate on a pull request. The doc records that choice; this header repeats it
// so the next person does not add it to githooks/checks by reflex.
//
// Four measurements, one per acceptance criterion in story #13:
//
//   1. Lighthouse, mobile preset, performance and accessibility. The CLI is
//      invoked through npx at an EXACT pinned version (LH_VERSION below), so a
//      re-run a year from now measures with the same instrument. Performance
//      is the median of --runs runs; accessibility is deterministic and is
//      read from the last run.
//   2. Horizontal scroll at 360px: document.documentElement.scrollWidth in a
//      360-px emulated mobile viewport, after fonts are ready.
//   3. Keyboard pass: every focusable element in the page is enumerated, then
//      Tab is pressed until focus wraps, and each stop is checked for
//      :focus-visible with a non-zero outline. Elements never reached, or
//      reached with no visible focus, are listed. On a page carrying a
//      .gallery the pass then OPENS the lightbox and repeats the walk inside
//      the dialog, twice round, which is what proves focus is trapped; it
//      closes it again and re-walks the page. Story #50 — before it, a closed
//      <dialog> computed display:none and its controls were dropped by this
//      pass's own filter, so the one interactive component on either site was
//      silently unmeasured while the counts read clean. The progress line on
//      stderr names the outline colour the stops showed, by token and counted,
//      page and lightbox apart (#56): visible-or-not alone passed a --blue
//      ring on the lightbox's navy backdrop, at 2.2:1.
//   4. Contrast: every text-bearing element's computed colour against the
//      first opaque background-color up its ancestor chain, reduced to the
//      distinct (colour, background) pairs, named by the tokens in
//      shared/css/tokens.css, with the WCAG ratio and the smallest size the
//      pair is used at.
//
// 2-4 drive a headless Chrome over the DevTools protocol using nothing but
// Node's built-in WebSocket - no puppeteer, no playwright, no dependency. The
// Chrome is launched with its OWN user-data-dir: without that flag a headless
// launch on a machine where Chrome is already open attaches to the running
// browser and reports its window (measured 2026-09-04: a 360-wide request came
// back 764 wide).
//
// Pages are DERIVED from the tree, not listed here: every .html under hq/ and
// sailing/ except the copied assets/. A page added to the repo is measured on
// the next run without anyone editing this file.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const LH_VERSION = '13.4.1';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const DOC = join(REPO, 'docs', 'quality-floor.md');
const TOKENS = join(REPO, 'shared', 'css', 'tokens.css');
const START = '<!-- generated:start -->';
const END = '<!-- generated:end -->';
const FLOOR = 95;
const NARROW = 360;
const WIDE = 1280;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

// ---- arguments ------------------------------------------------------------

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
const RUNS = Number(opt('--runs', 3));
const ONLY = opt('--only', null);
const BASES = {
  hq: (opt('--base-hq', 'https://madcowhq.com')).replace(/\/$/, ''),
  sailing: (opt('--base-sailing', 'https://madcowsailing.com')).replace(/\/$/, ''),
};
const SKIP_LH = args.includes('--skip-lighthouse');
const WRITE = !args.includes('--no-write');

// ---- pages, derived from the tree ----------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'assets' && name !== 'node_modules') walk(p, out);
    } else if (name.endsWith('.html')) {
      out.push(p);
    }
  }
  return out;
}

function pages() {
  const list = [];
  for (const site of ['hq', 'sailing']) {
    for (const file of walk(join(REPO, site)).sort()) {
      let path = '/' + relative(join(REPO, site), file).split(sep).join('/');
      if (path.endsWith('/index.html')) path = path.slice(0, -'index.html'.length);
      list.push({ site, file: relative(REPO, file).split(sep).join('/'), url: BASES[site] + path });
    }
  }
  return ONLY ? list.filter((p) => p.url.includes(ONLY)) : list;
}

// ---- 1. Lighthouse --------------------------------------------------------

function lighthouseOnce(url, outPath) {
  // Quoted so it survives `shell: true`, which npx needs on Windows.
  const cmd = [
    'npx', '--yes', `lighthouse@${LH_VERSION}`, `"${url}"`,
    '--only-categories=performance,accessibility',
    '--form-factor=mobile', '--screenEmulation.mobile',
    '--chrome-flags="--headless=new"',
    '--output=json', `--output-path="${outPath}"`, '--quiet',
  ].join(' ');
  // The report is the artefact, the exit code is not: on Windows chrome-launcher
  // can fail to delete its own temp profile (EPERM, a file-lock race) AFTER the
  // report has been written, and exits non-zero for it. A report that exists
  // from this attempt is accepted and the noise is printed; no report is retried
  // once, since the same race can also kill the launch itself. Every attempt
  // writes to a fresh path, so a stale file from an earlier attempt cannot be
  // mistaken for this one.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const path = attempt === 1 ? outPath : outPath.replace(/\.json$/, `-retry.json`);
    const r = spawnSync(cmd.replace(`"${outPath}"`, `"${path}"`), { shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: chromeEnv() });
    if (existsSync(path)) {
      if (r.status !== 0) console.error(`   (lighthouse exited ${r.status} after writing its report; kept the report)`);
      return JSON.parse(readFileSync(path, 'utf8'));
    }
    console.error(`   lighthouse attempt ${attempt} produced no report for ${url}\n${(r.stderr || '').trim().split('\n').slice(0, 3).join('\n')}`);
  }
  throw new Error(`lighthouse produced no report for ${url} in two attempts`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function lighthouse(page, outDir, runs) {
  const perfs = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const out = join(outDir, page.file.replace(/[\/.]/g, '_') + `-${i + 1}.json`);
    last = lighthouseOnce(page.url, out);
    perfs.push(Math.round(last.categories.performance.score * 100));
  }
  const failing = (cat) => Object.values(last.audits)
    .filter((a) => last.categories[cat].auditRefs.some((r) => r.id === a.id && r.weight > 0))
    .filter((a) => a.score !== null && a.score < 1)
    .map((a) => `${a.id} (${a.score})`);
  const lcpNode = (last.audits['lcp-breakdown-insight']?.details?.items || []).find((i) => i.type === 'node');
  const blocking = (last.audits['render-blocking-insight']?.details?.items || [])
    .filter((i) => i.wastedMs).map((i) => `${i.url.replace(/\?.*$/, '?…')} (${Math.round(i.wastedMs)} ms)`);
  const metrics = last.audits.metrics.details.items[0];
  return {
    version: last.lighthouseVersion,
    finalUrl: last.finalDisplayedUrl,
    perf: median(perfs),
    perfRuns: perfs,
    a11y: Math.round(last.categories.accessibility.score * 100),
    cls: last.audits['cumulative-layout-shift'].numericValue,
    lcpMs: Math.round(last.audits['largest-contentful-paint'].numericValue),
    fcpMs: Math.round(last.audits['first-contentful-paint'].numericValue),
    observedFcpMs: Math.round(metrics.observedFirstContentfulPaint),
    lcpElement: lcpNode ? `${lcpNode.selector} "${(lcpNode.nodeLabel || '').slice(0, 40)}"` : 'unknown',
    blocking,
    failingPerf: failing('performance'),
    failingA11y: failing('accessibility'),
  };
}

// ---- 2-4. Chrome over the DevTools protocol --------------------------------

function chromePath() {
  const p = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (!p) throw new Error('no Chrome found; set CHROME_PATH');
  return p;
}

function chromeEnv() {
  return process.env.CHROME_PATH ? process.env : { ...process.env, CHROME_PATH: chromePath() };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(`${m.error.message} (${m.error.data ?? ''})`)) : resolve(m.result);
      } else if (m.method) {
        for (const l of this.listeners) l(m);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  once(method, sessionId) {
    return new Promise((resolve) => {
      const l = (m) => {
        if (m.method === method && m.sessionId === sessionId) {
          this.listeners.splice(this.listeners.indexOf(l), 1);
          resolve(m.params);
        }
      };
      this.listeners.push(l);
    });
  }
}

async function launchChrome(profileDir) {
  const proc = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', (code) => reject(new Error(`chrome exited ${code} before listening:\n${buf}`)));
    setTimeout(() => reject(new Error('chrome did not start listening in 20s')), 20000);
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { proc, cdp: new Cdp(ws) };
}

async function openPage(cdp, url, width) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: 800, deviceScaleFactor: width < 600 ? 3 : 1, mobile: width < 600,
  }, sessionId);
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  await evaluate(cdp, sessionId, 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))');
  return { targetId, sessionId };
}

async function evaluate(cdp, sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}

async function closePage(cdp, targetId) {
  await cdp.send('Target.closeTarget', { targetId });
}

// 2. scrollWidth at 360
async function measureNarrow(cdp, url) {
  const { targetId, sessionId } = await openPage(cdp, url, NARROW);
  const v = await evaluate(cdp, sessionId, `({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    finalUrl: location.href,
  })`);
  await closePage(cdp, targetId);
  return v;
}

// Runs inside the page: a short, stable label for an element.
const DESCRIBE = `(el) => {
  if (!el || el === document.body) return 'body';
  const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  const href = el.getAttribute('href');
  return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '') + ' "' + text + '"' + (href ? ' -> ' + href : '');
}`;

// 3. keyboard pass at desktop width
//
// The tab-stop candidates. `root` is `document` for the page pass and the open
// <dialog> for the lightbox pass; the filter is one expression either way, so
// the two passes cannot drift into measuring different things. `tag` namespaces
// the data attribute so tagging the dialog's controls does not renumber the
// page's, which matters because the page is re-measured after the dialog closes.
const CANDIDATES = (root, tag) => `(() => {
  const describe = ${DESCRIBE};
  const sel = 'a[href], button, input, select, textarea, summary, [tabindex]';
  return [...${root}.querySelectorAll(sel)]
    .filter(el => !el.disabled && el.getAttribute('tabindex') !== '-1' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    .map((el, i) => { el.dataset.${tag} = String(i); return describe(el); });
})()`;

// What one Tab stop looks like. `inDialog` is carried for the lightbox pass's
// escape test and is simply false everywhere else.
const STOP = (tag) => `(() => {
  const describe = ${DESCRIBE};
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    index: el.dataset && el.dataset.${tag} !== undefined ? Number(el.dataset.${tag}) : -1,
    label: describe(el),
    focusVisible: el.matches(':focus-visible'),
    outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor : 'none',
    outlineColor: cs.outlineColor,
    onScreenBox: r.width > 0 && r.height > 0,
    // A stop that is a real control belonging to the PAGE rather than to an open
    // dialog. This is the escape test, and it is deliberately narrower than
    // "outside the dialog": Chrome's modal Tab cycle passes through
    // document.body and the <dialog> element itself, neither of which is an
    // escape and neither of which a reader can act on.
    pageStop: !!(el.closest && !el.closest('dialog[open]') &&
      el !== document.body && el !== document.documentElement &&
      el.matches('a[href], button, input, select, textarea, summary, [tabindex]')),
  };
})()`;

async function tab(cdp, sessionId) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
}

// Walk Tab until focus wraps, returning the distinct stops in the order reached.
// `limit` bounds the walk; without one a real focus trap would loop forever, and
// a trap is the thing the lightbox pass is specifically looking FOR.
async function walkTabs(cdp, sessionId, tag, limit) {
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < limit; i++) {
    await tab(cdp, sessionId);
    const stop = await evaluate(cdp, sessionId, STOP(tag));
    if (stop.index === -1 && stops.length) break; // wrapped to the top (body), or landed somewhere unexpected
    if (seen.has(stop.index)) break;              // wrapped without passing body, or a focus trap
    seen.add(stop.index);
    stops.push(stop);
  }
  return { stops, seen };
}

function invisibleStops(stops) {
  return stops
    .filter((s) => !(s.focusVisible && s.outline !== 'none' && s.onScreenBox))
    .map((s) => `${s.label} [focus-visible=${s.focusVisible}, outline=${s.outline}]`);
}

// The outline colours a set of stops showed, named by token and counted —
// "--blue x10, --chalk x2". A stop with no outline is invisibleStops' to
// report; this is what a PASSING stop looks like, which the verdict above
// cannot say (#56).
function outlineColours(stops, name) {
  const counts = new Map();
  for (const s of stops) {
    if (s.outline === 'none') continue;
    const k = name(s.outlineColor);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].map(([k, n]) => `${k} x${n}`).join(', ') || 'none';
}

// Enumerate and Tab-walk one page. Returns the raw shape both callers need.
async function keyboardOnPage(cdp, sessionId) {
  // Each candidate is tagged with its DOM-order index and identified by that,
  // never by its text: two links with the same text and href are two stops,
  // and the first version of this pass read the second one as focus having
  // wrapped, which reported "not reached" on every page carrying a footer
  // link that also appears in the body. A tabindex="-1" element is focusable
  // by script but deliberately not by Tab, so it is not expected.
  const expected = await evaluate(cdp, sessionId, CANDIDATES('document', 'qfIndex'));
  const { stops, seen } = await walkTabs(cdp, sessionId, 'qfIndex', expected.length + 2);
  return {
    expected: expected.length,
    reached: stops.length,
    unreached: expected.filter((_, i) => !seen.has(i)),
    invisible: invisibleStops(stops),
    stops,
  };
}

// 3b. The lightbox, which the page pass above cannot see.
//
// `shared/js/gallery.js` appends its <dialog> CLOSED — showModal() runs only on
// a thumbnail click — and a closed <dialog> computes display:none, so its
// controls return zero getClientRects() and the filter above drops all of them.
// Measured 2026-09-04 before this pass existed: 0 lightbox stops while closed,
// 3 while open. The counts were therefore clean on every run and said nothing
// whatever about the one interactive component on either site — an absent
// measurement and a passing one producing identical output (cairn:
// an-absent-result-reads-as-a-clean-one). Story #50.
//
// Opened with TRUSTED CDP input — focus the first thumbnail, press Enter —
// rather than frame.click(). Two reasons. The path being measured is the
// keyboard one (#12 AC 1 puts Enter-from-a-thumbnail on the platform, not on
// gallery.js, and a synthetic click would not exercise that at all), and a
// harness that supplies its own events can agree with a handler forever without
// either being right (cairn: a-synthetic-event-cannot-test-a-hit-test, measured
// on this very component).
async function measureLightbox(cdp, sessionId) {
  const hasGallery = await evaluate(cdp, sessionId, `!!document.querySelector('.gallery a.frame')`);
  if (!hasGallery) return null;

  // Focus the first thumbnail from the page rather than assuming a tab count,
  // then Enter. `.focus()` here only positions the caret; the OPEN itself is
  // the trusted key event below, which is the part being measured.
  await evaluate(cdp, sessionId, `(() => {
    const f = document.querySelector('.gallery a.frame');
    f.dataset.qfOpener = '1';
    f.focus();
    return true;
  })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' }, sessionId);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);

  const open = await evaluate(cdp, sessionId, `!!document.querySelector('dialog.lightbox[open]')`);
  if (!open) return { opened: false };

  // Expected is derived from the open dialog, never hard-coded: a one-photo
  // gallery has no arrows at all (gallery.js removes them rather than disabling
  // them), and tools/photos.py's own end-to-end run was against a single photo,
  // so that is a configuration this pipeline has already produced. Hard-coding
  // 3 would report a false miss on it.
  const expected = await evaluate(cdp, sessionId, CANDIDATES(`document.querySelector('dialog.lightbox')`, 'qfLb'));

  // showModal() autofocuses the first control itself, so that stop is reached
  // WITHOUT a Tab and a walk that only records what Tab produced would report
  // it as never reached. Measured 2026-09-04: focus lands on .lightbox-close
  // the moment the dialog opens. So the initial position is a stop like any
  // other and is recorded before the first Tab.
  const walk = [await evaluate(cdp, sessionId, STOP('qfLb'))];

  // Tab round twice over, then some. Chrome's modal cycle for this dialog is
  // close -> prev -> next -> body -> dialog -> close, so the wrap passes through
  // two stops that are not controls — `document.body` and the <dialog> element
  // itself — and BOTH are inside the modal scope rather than an escape. Measured
  // 2026-09-04. The trap therefore cannot be tested by "is every stop inside the
  // dialog"; it is tested by whether any stop is a control on the PAGE, which is
  // the property that actually matters and the one a broken trap would violate.
  let escaped = null;
  const rounds = (expected.length + 2) * 2 + 1;
  for (let i = 0; i < rounds && !escaped; i++) {
    await tab(cdp, sessionId);
    const stop = await evaluate(cdp, sessionId, STOP('qfLb'));
    walk.push(stop);
    if (stop.pageStop) escaped = stop.label;
  }
  const controlStops = walk.filter((s) => s.index !== -1);
  // The cycle closed if the first control comes round again, which — given the
  // loop above only stops early on an escape — it must have for the trap to hold.
  const wraps = expected.length > 0 &&
    controlStops.filter((s) => s.index === 0).length >= 2;
  // One entry per distinct control, in the order first reached, so a control is
  // not listed twice for being walked twice.
  const firstLap = controlStops.filter((s, i) => controlStops.findIndex((t) => t.index === s.index) === i);

  // Close it again and let the close handler run. Escape is the route <dialog>
  // owns, and gallery.js hangs focus-return on the `close` event, so this also
  // leaves focus where a reader would find it.
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  const closed = await evaluate(cdp, sessionId, `!document.querySelector('dialog.lightbox[open]')`);
  const focusReturned = await evaluate(cdp, sessionId, `!!(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.qfOpener)`);

  return {
    opened: true,
    closed,
    focusReturned,
    expected: expected.length,
    reached: new Set(firstLap.map((s) => s.index)).size,
    unreached: expected.filter((_, i) => !firstLap.some((s) => s.index === i)),
    invisible: invisibleStops(firstLap),
    trapped: !escaped && wraps,
    escapedTo: escaped,
    controls: expected,
    stops: firstLap,
  };
}

async function measureKeyboard(cdp, url) {
  const { targetId, sessionId } = await openPage(cdp, url, WIDE);
  const page = await keyboardOnPage(cdp, sessionId);
  const lightbox = await measureLightbox(cdp, sessionId);
  // Re-measure the page after the dialog has been opened and closed again, so
  // opening it cannot corrupt the number reported for the page that hosts it
  // (#50 AC 4). Focus is somewhere else now, so this is a real second walk and
  // not a cached read — a mismatch here is a finding about the lightbox, not
  // about the page.
  let after = null;
  if (lightbox) {
    await evaluate(cdp, sessionId, `(document.activeElement && document.activeElement.blur && document.activeElement.blur(), true)`);
    after = await keyboardOnPage(cdp, sessionId);
  }
  await closePage(cdp, targetId);
  return { ...page, lightbox, after: after ? { expected: after.expected, reached: after.reached } : null };
}

// 4. contrast pairs
function tokenMap() {
  const css = readFileSync(TOKENS, 'utf8');
  const map = {};
  for (const m of css.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, name, hex] = m;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    map[`rgb(${r}, ${g}, ${b})`] = name;
  }
  return map;
}

function luminance(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

async function measureContrast(cdp, url) {
  const { targetId, sessionId } = await openPage(cdp, url, WIDE);
  const pairs = await evaluate(cdp, sessionId, `(() => {
    const describe = ${DESCRIBE};
    const out = {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
      if (el.getClientRects().length === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      let bgEl = el, bg = null, viaImage = false;
      while (bgEl) {
        const s = getComputedStyle(bgEl);
        if (s.backgroundImage !== 'none') viaImage = true;
        if (s.backgroundColor && !/rgba\\(\\d+, \\d+, \\d+, 0\\)/.test(s.backgroundColor) && s.backgroundColor !== 'transparent') { bg = s.backgroundColor; break; }
        bgEl = bgEl.parentElement;
      }
      bg = bg || 'rgb(255, 255, 255)';
      const key = cs.color + ' on ' + bg;
      const px = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      if (!out[key]) out[key] = { fg: cs.color, bg, minPx: px, large, viaImage, sample: describe(el), count: 0 };
      const o = out[key];
      o.count++;
      if (px < o.minPx) { o.minPx = px; o.large = large; o.sample = describe(el); }
      if (viaImage) o.viaImage = true;
    }
    return Object.values(out);
  })()`);
  await closePage(cdp, targetId);
  return pairs;
}

// ---- report ---------------------------------------------------------------

function fmtCls(x) { return x.toFixed(3); }

// Everything wrong with one page's keyboard behaviour, page and lightbox alike,
// as lines. One function so the table, the checklist and the exit code cannot
// disagree about what counts as a problem — the failure being that a new kind of
// miss gets listed in the prose and silently leaves the exit code at 0.
function kbProblems(kb) {
  const out = [
    ...kb.unreached.map((u) => `not reached: ${u}`),
    ...kb.invisible.map((u) => `no visible focus: ${u}`),
  ];
  if (kb.after && kb.after.expected !== kb.expected) {
    out.push(`page stop count changed after the lightbox opened and closed: ${kb.expected} before, ${kb.after.expected} after`);
  }
  const lb = kb.lightbox;
  if (!lb) return out;
  if (!lb.opened) return [...out, 'lightbox: a .gallery is present but Enter on the first thumbnail did not open the dialog'];
  out.push(...lb.unreached.map((u) => `lightbox, not reached: ${u}`));
  out.push(...lb.invisible.map((u) => `lightbox, no visible focus: ${u}`));
  if (!lb.trapped) {
    out.push(lb.escapedTo
      ? `lightbox: focus escaped the open dialog to ${lb.escapedTo}`
      : 'lightbox: Tab did not cycle back to the first control');
  }
  if (!lb.closed) out.push('lightbox: Escape did not close the dialog');
  if (!lb.focusReturned) out.push('lightbox: focus did not return to the thumbnail that opened it');
  return out;
}

function render(results, meta) {
  const names = tokenMap();
  const name = (rgb) => names[rgb] || rgb;
  const lines = [];
  lines.push(START);
  lines.push(`_Generated by \`node tools/quality_floor.mjs\` on ${meta.date}. ${SKIP_LH ? 'Lighthouse SKIPPED (--skip-lighthouse)' : `Lighthouse ${meta.lhVersion}, mobile preset, ${meta.runs} run(s) per page, performance = median`}. Bases: ${meta.bases.hq} and ${meta.bases.sailing}. Per-page Lighthouse command:_`);
  lines.push('');
  lines.push('```');
  lines.push(`npx --yes lighthouse@${meta.lhVersion} <url> --only-categories=performance,accessibility --form-factor=mobile --screenEmulation.mobile --chrome-flags="--headless=new" --output=json`);
  lines.push('```');
  lines.push('');
  lines.push('### Scores');
  lines.push('');
  lines.push('| Page | Performance | Accessibility | CLS | 360px scrollWidth | Keyboard | Date | Lighthouse |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const perf = r.lh ? `${r.lh.perf}${r.lh.perf < FLOOR ? ' **under floor**' : ''} (${r.lh.perfRuns.join('/')})` : 'skipped';
    const a11y = r.lh ? `${r.lh.a11y}${r.lh.a11y < FLOOR ? ' **under floor**' : ''}` : 'skipped';
    const cls = r.lh ? fmtCls(r.lh.cls) : '—';
    const sw = `${r.narrow.scrollWidth}${r.narrow.scrollWidth > NARROW ? ' **scrolls**' : ''}`;
    const kb = kbProblems(r.kb).length ? `**${r.kb.reached}/${r.kb.expected}, see below**` : `${r.kb.reached}/${r.kb.expected} ok${r.kb.lightbox ? ` +${r.kb.lightbox.reached} lightbox` : ''}`;
    lines.push(`| ${r.page.url.replace(/^https?:\/\//, '')} | ${perf} | ${a11y} | ${cls} | ${sw} | ${kb} | ${meta.date} | ${r.lh ? r.lh.version : '—'} |`);
  }
  lines.push('');
  const under = results.filter((r) => r.lh && (r.lh.perf < FLOOR || r.lh.a11y < FLOOR));
  lines.push('### Under the floor');
  lines.push('');
  if (!under.length) lines.push('Nothing. Every page scored at or above 95 on both categories in this run.');
  for (const r of under) {
    lines.push(`- **${r.page.url}** — performance ${r.lh.perf}, accessibility ${r.lh.a11y}; simulated FCP ${r.lh.fcpMs} ms, LCP ${r.lh.lcpMs} ms (last run; observed first paint in the unthrottled trace ${r.lh.observedFcpMs} ms). LCP element: \`${r.lh.lcpElement.replace(/`/g, "'")}\`. Weighted audits under 1: ${[...r.lh.failingPerf, ...r.lh.failingA11y].join(', ') || 'none'}. Render-blocking per Lighthouse: ${r.lh.blocking.join('; ') || 'none'}.`);
  }
  lines.push('');
  lines.push('### Keyboard pass');
  lines.push('');
  lines.push(`Desktop width (${WIDE}px). "Expected" is every visible \`a[href]\`, button, form control, summary or positive-tabindex element in DOM order; "reached" is how many distinct stops Tab produced before focus wrapped. A stop counts as visible when \`:focus-visible\` matches and the computed outline is non-zero.`);
  lines.push('');
  lines.push(`On a page carrying a \`.gallery\` the pass then opens the lightbox — first thumbnail, trusted Enter — and repeats the walk inside the open \`<dialog>\`, Tabbing **twice** round so that the second lap proves focus is trapped rather than merely cyclic. The dialog's controls are enumerated from the open dialog and never assumed: a one-photo gallery has no arrows. It is closed with Escape afterwards and the page is re-walked, so the page's own count is measured before and after.`);
  lines.push('');
  for (const r of results) {
    const problems = kbProblems(r.kb);
    const lb = r.kb.lightbox;
    const lbNote = lb && lb.opened
      ? `, lightbox ${lb.reached} of ${lb.expected}${lb.trapped ? ', focus trapped' : ''}${lb.closed && lb.focusReturned ? ', closed and focus returned' : ''}`
      : lb ? ', lightbox NOT OPENED' : '';
    lines.push(`- [${problems.length ? ' ' : 'x'}] ${r.page.url.replace(/^https?:\/\//, '')} — ${r.kb.reached} of ${r.kb.expected}${lbNote}${problems.length ? '\n' + problems.map((p) => `  - ${p}`).join('\n') : ''}`);
  }
  lines.push('');
  lines.push('### Contrast pairs in production');
  lines.push('');
  lines.push('Every distinct (text colour, effective background) pair found on any page, named by token. Ratio is WCAG 2.x. The floor is 4.5:1 for body text; 3:1 is enough only for large text (≥ 24px, or ≥ 18.66px bold), and the smallest size each pair is used at is shown so that can be judged. A pair marked *over image* had a background-image somewhere in its ancestor chain, and the ratio against the colour underneath is a lower bound on nothing — read it by eye.');
  lines.push('');
  lines.push('| Text | Background | Ratio | Smallest use | Pages | Sample | Floor |');
  lines.push('|---|---|---|---|---|---|---|');
  const merged = {};
  for (const r of results) {
    for (const p of r.contrast) {
      const key = p.fg + '|' + p.bg;
      const m = merged[key] || (merged[key] = { ...p, pages: new Set() });
      m.pages.add(r.page.url.replace(/^https?:\/\/[^/]+/, '') || '/');
      if (p.minPx < m.minPx) { m.minPx = p.minPx; m.large = p.large; m.sample = p.sample; }
      if (p.viaImage) m.viaImage = true;
    }
  }
  for (const m of Object.values(merged).sort((a, b) => ratio(a.fg, a.bg) - ratio(b.fg, b.bg))) {
    const rt = ratio(m.fg, m.bg);
    const need = m.large ? 3 : 4.5;
    const verdict = rt >= need ? 'ok' : '**fails**';
    lines.push(`| ${name(m.fg)} | ${name(m.bg)}${m.viaImage ? ' *(over image)*' : ''} | ${rt.toFixed(1)}:1 | ${m.minPx.toFixed(1)}px${m.large ? ' (large)' : ''} | ${m.pages.size} | ${m.sample.replace(/\|/g, '\\|')} | ${verdict} |`);
  }
  lines.push(END);
  return lines.join('\n');
}

function writeDoc(block) {
  if (!existsSync(DOC)) {
    writeFileSync(DOC, `# Quality floor\n\n${block}\n`);
    return;
  }
  const doc = readFileSync(DOC, 'utf8');
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s === -1 || e === -1 || e < s) throw new Error(`${DOC} has no ${START} … ${END} block to replace`);
  writeFileSync(DOC, doc.slice(0, s) + block + doc.slice(e + END.length));
}

// ---- main -----------------------------------------------------------------

async function main() {
  const list = pages();
  if (!list.length) throw new Error(`no pages matched${ONLY ? ' --only ' + ONLY : ''} under ${REPO}`);
  const outDir = mkdtempSync(join(tmpdir(), 'quality-floor-'));
  console.error(`${list.length} page(s); Lighthouse JSON and the Chrome profile under ${outDir}`);

  const { proc, cdp } = await launchChrome(join(outDir, 'profile'));
  const results = [];
  let lhVersion = LH_VERSION; // what a run WOULD use; the report says when Lighthouse was skipped
  const names = tokenMap();
  const name = (rgb) => names[rgb] || rgb;
  try {
    for (const page of list) {
      console.error(`→ ${page.url}`);
      const narrow = await measureNarrow(cdp, page.url);
      const kb = await measureKeyboard(cdp, page.url);
      const contrast = await measureContrast(cdp, page.url);
      const lh = SKIP_LH ? null : lighthouse(page, outDir, RUNS);
      if (lh) lhVersion = lh.version;
      results.push({ page, narrow, kb, contrast, lh });
      const lbLine = kb.lightbox
        ? (kb.lightbox.opened
            ? `  lightbox ${kb.lightbox.reached}/${kb.lightbox.expected}${kb.lightbox.trapped ? ' trapped' : ' NOT TRAPPED'} outlines ${outlineColours(kb.lightbox.stops, name)}`
            : '  lightbox DID NOT OPEN')
        : '';
      console.error(`   perf ${lh ? lh.perf + ' (' + lh.perfRuns.join('/') + ')' : '-'}  a11y ${lh ? lh.a11y : '-'}  cls ${lh ? fmtCls(lh.cls) : '-'}  scrollWidth@360 ${narrow.scrollWidth}  keyboard ${kb.reached}/${kb.expected}${kb.invisible.length ? ' INVISIBLE ' + kb.invisible.length : ''}${kb.unreached.length ? ' UNREACHED ' + kb.unreached.length : ''} outlines ${outlineColours(kb.stops, name)}${lbLine}  pairs ${contrast.length}`);
    }
  } finally {
    proc.kill();
  }
  const block = render(results, { date: new Date().toISOString().slice(0, 10), lhVersion, runs: RUNS, bases: BASES });
  if (WRITE) {
    writeDoc(block);
    console.error(`wrote ${relative(REPO, DOC)}`);
  } else {
    console.log(block);
  }
  const bad = results.filter((r) => (r.lh && (r.lh.perf < FLOOR || r.lh.a11y < FLOOR)) || r.narrow.scrollWidth > NARROW || kbProblems(r.kb).length);
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 2; });
