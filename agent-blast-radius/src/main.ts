// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import css from './ui/styles.css?inline';
import { escapeHtml, renderResults, standaloneReport } from './core/report.js';
import { LOCATIONS, SAMPLES } from './core/samples.js';
import { scan } from './core/scan.js';
import type { FileInput } from './core/types.js';

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

app.innerHTML = `
  <div class="wrap">
    <header class="site">
      <h1>Agent Blast Radius</h1>
      <span class="tagline">What can your AI tools actually touch?</span>
      <hw-theme-toggle></hw-theme-toggle>
    </header>
    <p class="privacy">
      Drop in your MCP configs, Claude Code settings, browser-extension manifests, or VS Code extension
      <code>package.json</code> files. Everything is parsed in this tab: nothing is uploaded, and secrets are masked in the report.
    </p>
    <label class="drop" id="drop">
      <input type="file" id="files" multiple accept=".json,.jsonc,application/json" />
      <strong>Drop config files here</strong> or click to choose
    </label>
    <details class="paste">
      <summary>Or paste a config</summary>
      <input id="paste-name" type="text" placeholder="file name (optional), e.g. claude_desktop_config.json" />
      <textarea id="paste" spellcheck="false" placeholder='{ "mcpServers": { ... } }'></textarea>
      <button id="paste-add" type="button" class="primary">Scan pasted text</button>
    </details>
    <div class="controls">
      <button id="sample" type="button">Try a sample</button>
      <button id="clear" type="button">Clear</button>
      <button id="export" type="button" class="primary" disabled>Download HTML report</button>
    </div>
    <details class="where">
      <summary>Where do I find these files?</summary>
      <dl>${LOCATIONS.map((l) => `<dt>${escapeHtml(l.tool)}</dt>${l.paths.map((p) => `<dd><code>${escapeHtml(p)}</code></dd>`).join('')}`).join('')}</dl>
    </details>
    <div id="result"></div>
    <footer class="site">
      Scores come from what each config <em>declares</em>. A local program can do anything its code does, so an
      unrecognized server is scored as "runs as you", not as safe.
      <a href="https://github.com/pisanuw/Claude-capstone/tree/main/agent-blast-radius">Source on GitHub</a>.
    </footer>
  </div>
`;

const resultEl = document.getElementById('result') as HTMLElement;
const exportBtn = document.getElementById('export') as HTMLButtonElement;
const fileEl = document.getElementById('files') as HTMLInputElement;
const dropEl = document.getElementById('drop') as HTMLElement;
const pasteEl = document.getElementById('paste') as HTMLTextAreaElement;
const pasteNameEl = document.getElementById('paste-name') as HTMLInputElement;

let inputs: FileInput[] = [];

function refresh(): void {
  const result = scan(inputs);
  resultEl.innerHTML = renderResults(result);
  exportBtn.disabled = result.tools.length === 0;
}

/** Same file name replaces the earlier copy, so re-dropping an edited file re-scans it. */
function add(files: FileInput[]): void {
  const names = new Set(files.map((f) => f.name));
  inputs = [...inputs.filter((f) => !names.has(f.name)), ...files];
  refresh();
}

async function readFiles(list: FileList | null): Promise<void> {
  if (!list) return;
  const files = await Promise.all(
    [...list].map(async (f) => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, text: await f.text() })),
  );
  add(files);
}

fileEl.addEventListener('change', () => {
  void readFiles(fileEl.files);
  fileEl.value = '';
});
dropEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropEl.classList.add('over');
});
dropEl.addEventListener('dragleave', () => dropEl.classList.remove('over'));
dropEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dropEl.classList.remove('over');
  void readFiles(e.dataTransfer?.files ?? null);
});

document.getElementById('paste-add')?.addEventListener('click', () => {
  if (pasteEl.value.trim() === '') return;
  const name = pasteNameEl.value.trim() || `pasted-${inputs.filter((f) => f.name.startsWith('pasted-')).length + 1}.json`;
  add([{ name, text: pasteEl.value }]);
  pasteEl.value = '';
  pasteNameEl.value = '';
});
document.getElementById('sample')?.addEventListener('click', () => add(SAMPLES));
document.getElementById('clear')?.addEventListener('click', () => {
  inputs = [];
  refresh();
});
exportBtn.addEventListener('click', () => {
  const html = standaloneReport(scan(inputs), css, new Date());
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agent-blast-radius-report.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

refresh();
