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
//      reached with no visible focus, are listed.
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
async function measureKeyboard(cdp, url) {
  const { targetId, sessionId } = await openPage(cdp, url, WIDE);
  // Each candidate is tagged with its DOM-order index and identified by that,
  // never by its text: two links with the same text and href are two stops,
  // and the first version of this pass read the second one as focus having
  // wrapped, which reported "not reached" on every page carrying a footer
  // link that also appears in the body. A tabindex="-1" element is focusable
  // by script but deliberately not by Tab, so it is not expected.
  const expected = await evaluate(cdp, sessionId, `(() => {
    const describe = ${DESCRIBE};
    const sel = 'a[href], button, input, select, textarea, summary, [tabindex]';
    return [...document.querySelectorAll(sel)]
      .filter(el => !el.disabled && el.getAttribute('tabindex') !== '-1' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el, i) => { el.dataset.qfIndex = String(i); return describe(el); });
  })()`);
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < expected.length + 2; i++) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    const stop = await evaluate(cdp, sessionId, `(() => {
      const describe = ${DESCRIBE};
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        index: el.dataset && el.dataset.qfIndex !== undefined ? Number(el.dataset.qfIndex) : -1,
        label: describe(el),
        focusVisible: el.matches(':focus-visible'),
        outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor : 'none',
        onScreenBox: r.width > 0 && r.height > 0,
      };
    })()`);
    if (stop.index === -1 && stops.length) break; // wrapped to the top (body), or landed somewhere unexpected
    if (seen.has(stop.index)) break; // wrapped without passing body, or a focus trap
    seen.add(stop.index);
    stops.push(stop);
  }
  await closePage(cdp, targetId);
  return {
    expected: expected.length,
    reached: stops.length,
    unreached: expected.filter((_, i) => !seen.has(i)),
    invisible: stops.filter((s) => !(s.focusVisible && s.outline !== 'none' && s.onScreenBox)).map((s) => `${s.label} [focus-visible=${s.focusVisible}, outline=${s.outline}]`),
    stops,
  };
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
    const kb = r.kb.unreached.length || r.kb.invisible.length ? `**${r.kb.reached}/${r.kb.expected}, see below**` : `${r.kb.reached}/${r.kb.expected} ok`;
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
  for (const r of results) {
    const problems = [...r.kb.unreached.map((u) => `not reached: ${u}`), ...r.kb.invisible.map((u) => `no visible focus: ${u}`)];
    lines.push(`- [${problems.length ? ' ' : 'x'}] ${r.page.url.replace(/^https?:\/\//, '')} — ${r.kb.reached} of ${r.kb.expected}${problems.length ? '\n' + problems.map((p) => `  - ${p}`).join('\n') : ''}`);
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
  try {
    for (const page of list) {
      console.error(`→ ${page.url}`);
      const narrow = await measureNarrow(cdp, page.url);
      const kb = await measureKeyboard(cdp, page.url);
      const contrast = await measureContrast(cdp, page.url);
      const lh = SKIP_LH ? null : lighthouse(page, outDir, RUNS);
      if (lh) lhVersion = lh.version;
      results.push({ page, narrow, kb, contrast, lh });
      console.error(`   perf ${lh ? lh.perf + ' (' + lh.perfRuns.join('/') + ')' : '-'}  a11y ${lh ? lh.a11y : '-'}  cls ${lh ? fmtCls(lh.cls) : '-'}  scrollWidth@360 ${narrow.scrollWidth}  keyboard ${kb.reached}/${kb.expected}${kb.invisible.length ? ' INVISIBLE ' + kb.invisible.length : ''}${kb.unreached.length ? ' UNREACHED ' + kb.unreached.length : ''}  pairs ${contrast.length}`);
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
  const bad = results.filter((r) => (r.lh && (r.lh.perf < FLOOR || r.lh.a11y < FLOOR)) || r.narrow.scrollWidth > NARROW || r.kb.unreached.length || r.kb.invisible.length);
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 2; });
