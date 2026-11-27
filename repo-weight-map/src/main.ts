// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
// The stylesheet as a file, so Vite links it in the head: the first paint is already styled. Added by the
// script (?inline into a <style>) it came after a first paint in the browser's own colours.
import './ui/styles.css';
import { analyze } from './core/analyze.js';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from './core/classify.js';
import { formatBytes, formatPct } from './core/format.js';
import { categoryRows, escapeHtml, findingsHtml, largestHtml, standaloneReport } from './core/report.js';
import { SAMPLE_GITIGNORE, sampleRepo } from './core/sample.js';
import { findNode } from './core/tree.js';
import type { Analysis, FileRecord, TreeNode } from './core/types.js';
import { breadcrumbHtml, drawTreemap } from './ui/treemapView.js';
import { fromDataTransfer, fromFileList, pickAndWalk, supportsDirectoryPicker, type WalkResult } from './ui/walk.js';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

app.innerHTML = `
  <div class="wrap">
    <header class="site">
      <div class="title-row"><h1>Repo Weight Map</h1><hw-theme-toggle></hw-theme-toggle></div>
      <span class="tagline">What is bloating this repo, and what should never have been committed?</span>
    </header>
    <p class="privacy">
      Pick a project folder. It is walked <strong>in this tab</strong> (file names and sizes only, nothing is read or uploaded),
      drawn as a treemap, and checked against ecosystem rules for venvs, <code>node_modules</code>, build output,
      caches, secrets, and stray datasets. Your root <code>.gitignore</code> is read too, so anything it already
      excludes is marked <em>already ignored</em> rather than counted against you.
    </p>
    <div class="drop" id="drop" role="group" aria-labelledby="drop-title">
      <strong id="drop-title">Drop a folder here</strong>
      <div class="controls">
        <button id="pick" type="button" class="primary">Choose folder</button>
        <label class="btn" for="files">Choose folder (fallback)<input type="file" id="files" webkitdirectory multiple hidden /></label>
        <button id="sample" type="button">Try a sample student repo</button>
      </div>
      <small id="status" aria-live="polite"></small>
    </div>
    <div id="result" hidden>
      <section class="tiles" id="tiles"></section>
      <section class="map">
        <div class="maphead">
          <nav id="crumbs" class="crumbs" aria-label="Treemap location"></nav>
          <button id="up" type="button" class="small" hidden>Up one level</button>
        </div>
        <svg id="treemap" class="treemap" role="group" aria-label="Treemap of folder sizes"></svg>
        <div id="detail" class="detail" hidden></div>
        <ul class="legend" id="legend"></ul>
      </section>
      <section class="two">
        <div>
          <h2>Findings <small id="findings-count"></small></h2>
          <p class="hint">Untick a finding to leave it out of the estimate and the .gitignore.</p>
          <div id="findings"></div>
        </div>
        <div>
          <h2>Proposed .gitignore additions</h2>
          <div class="controls">
            <button id="copy-lines" type="button" class="primary">Copy lines</button>
            <button id="copy-diff" type="button">Copy as diff</button>
            <button id="export" type="button">Download HTML report</button>
          </div>
          <pre id="gitignore" class="gitignore"></pre>
          <p id="present" class="hint"></p>
          <p class="hint">Patterns only stop <em>future</em> commits. Files already tracked also need
            <code>git rm -r --cached &lt;path&gt;</code>, and anything already pushed stays in history until it is rewritten
            (<code>git filter-repo --path &lt;path&gt; --invert-paths</code>).</p>
          <h2>By category</h2>
          <table class="cats"><thead><tr><th>Category</th><th class="num">Bytes</th><th class="num">Share</th><th class="num">Files</th></tr></thead><tbody id="cats"></tbody></table>
          <h2>Largest files</h2>
          <div id="largest"></div>
        </div>
      </section>
    </div>
    <footer class="site">
      Rules are deterministic pattern matches, so a folder named <code>build/</code> that you wrote by hand will be flagged
      too: that is what the tick boxes are for. Sizes are what the file system reports, so <code>.git</code> is counted
      but never suggested for ignoring. &ldquo;Already ignored&rdquo; comes from the <strong>root</strong> .gitignore only:
      a browser cannot read nested .gitignore files or your global excludes, and cannot run <code>git ls-files</code> to
      tell an ignored file from one that is ignored <em>and</em> still tracked. <code>git status --ignored</code> is the
      authoritative answer.
      <a href="https://github.com/pisanuw/Claude-capstone/tree/main/repo-weight-map">Source on GitHub</a>.
    </footer>
  </div>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const resultEl = $('result');
const statusEl = $('status');
const svg = document.getElementById('treemap') as unknown as SVGSVGElement;

let files: FileRecord[] = [];
let folderName = '';
let gitignoreText = '';
let analysis: Analysis | null = null;
let zoomPath = '';
const disabled = new Set<string>();

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function load(result: WalkResult): void {
  files = result.files;
  folderName = result.name;
  gitignoreText = result.gitignore;
  disabled.clear();
  zoomPath = '';
  if (!files.length) {
    setStatus('That folder is empty (or the browser could not list it).');
    return;
  }
  setStatus(`${folderName || 'folder'}: ${files.length.toLocaleString()} files`);
  resultEl.hidden = false; // must be visible before the treemap measures its width
  recompute();
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function recompute(): void {
  analysis = analyze(files, { existingGitignore: gitignoreText, disabledRules: disabled });
  renderTiles(analysis);
  renderMap();
  renderFindings(analysis);
  renderGitignore(analysis);
  $('cats').innerHTML = categoryRows(analysis);
  $('largest').innerHTML = largestHtml(analysis);
  $('legend').innerHTML = CATEGORY_ORDER.filter((c) => (analysis!.byCategory[c]?.bytes ?? 0) > 0)
    .map((c) => `<li><span class="swatch" style="background:${CATEGORY_COLOR[c]}"></span>${escapeHtml(CATEGORY_LABEL[c])}</li>`)
    .join('');
}

function renderTiles(a: Analysis): void {
  const vcs = a.byCategory.vcs?.bytes ?? 0;
  // The headline number is what still needs doing, not everything a rule matched: bytes your
  // .gitignore already excludes are not a problem, and calling them one is what makes the tool lie.
  const todo = a.actionableBytes > 0;
  $('tiles').innerHTML = `
    <div class="tile"><b>${formatBytes(a.totalBytes)}</b><span>${a.fileCount.toLocaleString()} files on disk</span></div>
    <div class="tile ${todo ? 'warn' : 'good'}"><b>${formatBytes(a.actionableBytes)}</b><span>${
      todo ? `not in .gitignore yet (${formatPct(a.actionableBytes, a.totalBytes)})` : 'left to ignore: your .gitignore covers it all'
    }</span></div>
    <div class="tile"><b>${formatBytes(a.ignoredBytes)}</b><span>flagged, but already ignored</span></div>
    <div class="tile"><b>${formatBytes(vcs)}</b><span>inside .git${vcs > a.afterBytes && vcs > 0 ? ' (bigger than the tree that belongs in git: history remembers)' : ''}</span></div>`;
}

function renderMap(): void {
  if (!analysis) return;
  const node = findNode(analysis.root, zoomPath) ?? analysis.root;
  const width = Math.max(320, svg.clientWidth || 800);
  const height = width < 600 ? 360 : 480;
  svg.style.height = `${height}px`;
  drawTreemap(svg, node, analysis.totalBytes, width, height, {
    onZoom: (n: TreeNode) => {
      zoomPath = n.path;
      $('detail').hidden = true;
      renderMap();
    },
    onSelect: (n: TreeNode) => {
      const d = $('detail');
      d.hidden = false;
      d.innerHTML = `<code>${escapeHtml(n.path)}</code> <b>${formatBytes(n.size)}</b> (${formatPct(n.size, analysis!.totalBytes)} of the folder), ${escapeHtml(CATEGORY_LABEL[n.category])}`;
    },
  });
  $('crumbs').innerHTML = breadcrumbHtml(folderName, zoomPath);
  $('up').hidden = zoomPath === '';
}

function renderFindings(a: Analysis): void {
  $('findings').innerHTML = findingsHtml(a, disabled, true);
  const active = a.findings.filter((f) => !disabled.has(f.ruleId)).length;
  const covered = a.findings.filter((f) => f.coverage === 'all').length;
  $('findings-count').textContent = a.findings.length
    ? `${active} of ${a.findings.length} selected${covered ? `, ${covered} already ignored` : ''}`
    : '';
  for (const box of document.querySelectorAll<HTMLInputElement>('.rule-toggle')) {
    box.addEventListener('change', () => {
      const id = box.dataset.rule ?? '';
      if (box.checked) disabled.delete(id);
      else disabled.add(id);
      recompute();
    });
  }
}

function renderGitignore(a: Analysis): void {
  $('gitignore').textContent = a.gitignore.added.length ? a.gitignore.added.join('\n') : '# Nothing to add.';
  $('present').textContent = a.gitignore.alreadyPresent.length
    ? `Already in your .gitignore: ${a.gitignore.alreadyPresent.join(', ')}`
    : gitignoreText
      ? 'Your existing .gitignore was read; none of the suggested lines are in it yet.'
      : 'No .gitignore was found at the folder root, so nothing here counts as already ignored.';
}

async function copy(text: string, btn: HTMLButtonElement): Promise<void> {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = label), 1200);
}

/* Wiring */
const pickBtn = $('pick') as HTMLButtonElement;
if (!supportsDirectoryPicker()) pickBtn.hidden = true;
else (document.querySelector('label[for="files"]') as HTMLElement).hidden = true;

pickBtn.addEventListener('click', async () => {
  setStatus('Walking folder…');
  const r = await pickAndWalk((n) => setStatus(`Walking folder… ${n.toLocaleString()} files`));
  if (r) load(r);
  else setStatus('');
});
($('files') as HTMLInputElement).addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  if (!input.files?.length) return;
  setStatus('Reading selection…');
  load(await fromFileList(input.files));
  input.value = '';
});
$('sample').addEventListener('click', () => load({ name: 'capstone-project', files: sampleRepo(), gitignore: SAMPLE_GITIGNORE }));

const dropEl = $('drop');
for (const evName of ['dragenter', 'dragover'] as const) {
  dropEl.addEventListener(evName, (ev) => {
    ev.preventDefault();
    dropEl.classList.add('over');
  });
}
dropEl.addEventListener('dragleave', () => dropEl.classList.remove('over'));
dropEl.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  dropEl.classList.remove('over');
  if (!ev.dataTransfer) return;
  setStatus('Walking dropped folder…');
  const r = await fromDataTransfer(ev.dataTransfer, (n) => setStatus(`Walking… ${n.toLocaleString()} files`));
  if (r) load(r);
  else setStatus('Nothing droppable found.');
});

$('crumbs').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button.crumb');
  if (!btn) return;
  zoomPath = btn.dataset.path ?? '';
  $('detail').hidden = true;
  renderMap();
});
$('up').addEventListener('click', () => {
  zoomPath = zoomPath.includes('/') ? zoomPath.slice(0, zoomPath.lastIndexOf('/')) : '';
  $('detail').hidden = true;
  renderMap();
});
$('copy-lines').addEventListener('click', (ev) => analysis && copy(analysis.gitignore.block.trimStart() || '', ev.currentTarget as HTMLButtonElement));
$('copy-diff').addEventListener('click', (ev) => analysis && copy(analysis.gitignore.unified, ev.currentTarget as HTMLButtonElement));
$('export').addEventListener('click', () => {
  if (!analysis) return;
  const blob = new Blob([standaloneReport(analysis, folderName, disabled)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `repo-weight-map-${(folderName || 'folder').replace(/[^\w.-]+/g, '_')}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(renderMap, 120);
});

// `?sample` loads the demo straight away (used by the README screenshot and the deploy check).
if (new URLSearchParams(location.search).has('sample')) $('sample').click();
