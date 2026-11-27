// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { analyze } from './core/analyze.js';
import { toMarkdown } from './core/markdown.js';
import { renderResult } from './ui/render.js';
import { SQL_BEFORE, SQL_AFTER, TS_BEFORE, TS_AFTER } from './ui/samples.js';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

app.innerHTML = `
  <div class="wrap">
    <header class="site">
      <div class="title-row"><h1>Migration Diff Narrator</h1><hw-theme-toggle></hw-theme-toggle></div>
      <span class="tagline">Paste two schema versions, get every change classified and narrated.</span>
    </header>
    <p class="privacy">
      Rule-based and fully client-side: nothing you paste leaves this page.
      Reads SQL DDL (CREATE TABLE / INDEX / ALTER) and TypeScript interfaces.
    </p>
    <div class="controls">
      <label for="kind">Format</label>
      <select id="kind">
        <option value="auto" selected>Auto-detect</option>
        <option value="sql">SQL DDL</option>
        <option value="typescript">TypeScript</option>
      </select>
      <button id="sample-sql" type="button">SQL example</button>
      <button id="sample-ts" type="button">TypeScript example</button>
      <button id="clear" type="button">Clear</button>
      <button id="export" type="button" class="primary">Copy Markdown checklist</button>
    </div>
    <div class="editors">
      <div class="editor">
        <label class="label" for="before">Before</label>
        <textarea id="before" spellcheck="false" placeholder="Old schema version…"></textarea>
      </div>
      <div class="editor">
        <label class="label" for="after">After</label>
        <textarea id="after" spellcheck="false" placeholder="New schema version…"></textarea>
      </div>
    </div>
    <div id="result"></div>
    <footer class="site">
      Severity is a static rule set, not a model call — the same diff always gets the same verdict.
      <a href="https://github.com/pisanuw/Claude-capstone/tree/main/migration-diff-narrator">Source on GitHub</a>.
    </footer>
    <div id="toast" class="toast"></div>
  </div>
`;

const beforeEl = document.getElementById('before') as HTMLTextAreaElement;
const afterEl = document.getElementById('after') as HTMLTextAreaElement;
const kindEl = document.getElementById('kind') as HTMLSelectElement;
const resultEl = document.getElementById('result') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;

let timer: number | undefined;

function refresh(): void {
  const kind = kindEl.value as 'auto' | 'sql' | 'typescript';
  const analysis = analyze(beforeEl.value, afterEl.value, kind);
  renderResult(analysis, resultEl);
}

function scheduleRefresh(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(refresh, 250);
}

beforeEl.addEventListener('input', scheduleRefresh);
afterEl.addEventListener('input', scheduleRefresh);
kindEl.addEventListener('change', refresh);

document.getElementById('sample-sql')?.addEventListener('click', () => {
  beforeEl.value = SQL_BEFORE;
  afterEl.value = SQL_AFTER;
  kindEl.value = 'auto';
  refresh();
});

document.getElementById('sample-ts')?.addEventListener('click', () => {
  beforeEl.value = TS_BEFORE;
  afterEl.value = TS_AFTER;
  kindEl.value = 'auto';
  refresh();
});

document.getElementById('clear')?.addEventListener('click', () => {
  beforeEl.value = '';
  afterEl.value = '';
  refresh();
});

document.getElementById('export')?.addEventListener('click', () => {
  const kind = kindEl.value as 'auto' | 'sql' | 'typescript';
  const analysis = analyze(beforeEl.value, afterEl.value, kind);
  const markdown = toMarkdown(analysis.result);
  navigator.clipboard
    .writeText(markdown)
    .then(() => showToast('Markdown copied to clipboard'))
    .catch(() => {
      // Clipboard can be blocked (permissions, http); fall back to a download.
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'migration-diff.md';
      link.click();
      URL.revokeObjectURL(link.href);
      showToast('Clipboard blocked — downloaded migration-diff.md instead');
    });
});

let toastTimer: number | undefined;
function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// First paint: load the SQL example so the page demonstrates itself.
beforeEl.value = SQL_BEFORE;
afterEl.value = SQL_AFTER;
refresh();
