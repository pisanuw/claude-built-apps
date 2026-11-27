// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { analyze } from './core/analyze.js';
import { detectFormat } from './core/parse/index.js';
import { toMarkdown } from './core/markdown.js';
import { renderAnalysis } from './ui/render.js';
import { SAMPLES } from './ui/samples.js';
import type { SchemaFormat } from './core/types.js';

const FORMAT_OPTIONS: Array<{ value: SchemaFormat | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'sql', label: 'SQL DDL' },
  { value: 'prisma', label: 'Prisma' },
  { value: 'json-schema', label: 'JSON Schema' },
];

const app = document.getElementById('app');
if (!app) throw new Error('#app root not found');

app.innerHTML = `
  <header class="site-head">
    <div class="wrap">
      <div class="title-row"><h1>📖 Schema Storyteller</h1><hw-theme-toggle></hw-theme-toggle></div>
      <p class="tagline">
        Paste a SQL, Prisma, or JSON Schema and read what your data model actually
        means, then get a rule-based review of missing keys, indexes, and constraints.
        Everything runs in your browser: no server, no API key, nothing uploaded.
      </p>
    </div>
  </header>
  <main class="wrap">
    <section class="input-panel">
      <div class="toolbar">
        <label class="field">
          <span>Format</span>
          <select id="format">
            ${FORMAT_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </label>
        <div class="samples">
          <span>Load a sample:</span>
          ${SAMPLES.map(
            (s) => `<button type="button" class="sample-btn" data-sample="${s.id}">${s.label}</button>`,
          ).join('')}
        </div>
        <button type="button" id="clear" class="ghost">Clear</button>
      </div>
      <textarea
        id="source"
        aria-label="Schema"
        spellcheck="false"
        placeholder="Paste CREATE TABLE statements, a Prisma schema, or a JSON Schema here…"
      ></textarea>
      <div class="actions">
        <button type="button" id="analyze" class="primary">Tell the story</button>
        <button type="button" id="export" class="secondary" disabled>Copy Markdown</button>
        <button type="button" id="download" class="secondary" disabled>Download .md</button>
        <span id="status" class="status" role="status" aria-live="polite"></span>
      </div>
    </section>
    <section id="output" class="output" aria-live="polite"></section>
  </main>
  <footer class="site-foot">
    <div class="wrap">
      <p>
        Schema Storyteller derives its narrative and review from a deterministic parser
        and a fixed rule set, so the same input always gives the same output. It is a
        <a href="https://github.com/pisanuw/Claude-capstone/tree/main/schema-storyteller">Claude capstone project</a>.
      </p>
    </div>
  </footer>
`;

const source = document.getElementById('source') as HTMLTextAreaElement;
const formatSelect = document.getElementById('format') as HTMLSelectElement;
const output = document.getElementById('output') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const analyzeBtn = document.getElementById('analyze') as HTMLButtonElement;
const exportBtn = document.getElementById('export') as HTMLButtonElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;

let lastMarkdown = '';

function setStatus(message: string): void {
  status.textContent = message;
}

function currentFormat(): SchemaFormat | undefined {
  const value = formatSelect.value;
  return value === 'auto' ? undefined : (value as SchemaFormat);
}

function runAnalysis(): void {
  const text = source.value.trim();
  if (text.length === 0) {
    output.replaceChildren();
    setStatus('Paste a schema first.');
    exportBtn.disabled = true;
    downloadBtn.disabled = true;
    return;
  }

  try {
    const analysis = analyze(source.value, currentFormat());
    const title = analysis.schema.entities[0]?.name
      ? `${analysis.schema.entities[0].name} schema`
      : 'Schema Story';
    lastMarkdown = toMarkdown(analysis, title);

    output.replaceChildren(renderAnalysis(analysis));
    exportBtn.disabled = false;
    downloadBtn.disabled = false;

    const detected = currentFormat() ?? detectFormat(source.value);
    setStatus(
      `Parsed ${analysis.schema.entities.length} entities as ${detected}. ${analysis.findings.length} findings.`,
    );
  } catch (err) {
    setStatus(`Could not analyze: ${(err as Error).message}`);
  }
}

analyzeBtn.addEventListener('click', runAnalysis);

source.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runAnalysis();
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>('.sample-btn')) {
  button.addEventListener('click', () => {
    const sample = SAMPLES.find((s) => s.id === button.dataset.sample);
    if (!sample) return;
    source.value = sample.text;
    formatSelect.value = 'auto';
    runAnalysis();
  });
}

clearBtn.addEventListener('click', () => {
  source.value = '';
  output.replaceChildren();
  lastMarkdown = '';
  exportBtn.disabled = true;
  downloadBtn.disabled = true;
  setStatus('');
  source.focus();
});

exportBtn.addEventListener('click', async () => {
  if (!lastMarkdown) return;
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    setStatus('Markdown copied to clipboard.');
  } catch {
    setStatus('Clipboard blocked; use Download .md instead.');
  }
});

downloadBtn.addEventListener('click', () => {
  if (!lastMarkdown) return;
  const blob = new Blob([lastMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schema-story.md';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded schema-story.md.');
});
