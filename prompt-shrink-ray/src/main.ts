// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { compressPrompt } from './core/compress.js';
import { toTemplateJson } from './core/exportTemplate.js';
import { MODEL_PRICING, findPricing } from './core/pricing.js';
import { summarize } from './core/summary.js';
import type { Aggressiveness } from './core/types.js';
import { renderResult } from './ui/render.js';
import { SAMPLE_PROMPT } from './ui/samples.js';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

const modelOptions = MODEL_PRICING.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');

app.innerHTML = `
  <div class="wrap">
    <header class="site">
      <div class="title-row"><h1>Prompt Shrink Ray</h1><hw-theme-toggle></hw-theme-toggle></div>
      <span class="tagline">Paste a prompt, get it compressed with a live token and cost estimate.</span>
    </header>
    <p class="privacy">
      Rule-based and fully client-side: nothing you paste leaves this page.
      No LLM call runs the compression or the equivalence check.
    </p>
    <div class="controls">
      <label for="level">Aggressiveness</label>
      <select id="level">
        <option value="light">Light</option>
        <option value="medium" selected>Medium</option>
        <option value="aggressive">Aggressive</option>
      </select>
      <label for="model">Price model</label>
      <select id="model">${modelOptions}</select>
      <button id="sample" type="button">Load example</button>
      <button id="clear" type="button">Clear</button>
      <button id="copy" type="button" class="primary">Copy compressed</button>
      <button id="export" type="button">Download JSON template</button>
    </div>
    <div class="editor">
      <label class="label" for="input">Prompt</label>
      <textarea id="input" spellcheck="false" placeholder="Paste your prompt here&hellip;"></textarea>
    </div>
    <div id="result"></div>
    <footer class="site">
      Compression is a static rule set, not a model call: the same prompt always compresses the same way.
      <a href="https://github.com/pisanuw/Claude-capstone/tree/main/prompt-shrink-ray">Source on GitHub</a>.
    </footer>
    <div id="toast" class="toast"></div>
  </div>
`;

const inputEl = document.getElementById('input') as HTMLTextAreaElement;
const levelEl = document.getElementById('level') as HTMLSelectElement;
const modelEl = document.getElementById('model') as HTMLSelectElement;
const resultEl = document.getElementById('result') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;

let timer: number | undefined;

function refresh(): void {
  const level = levelEl.value as Aggressiveness;
  const result = compressPrompt(inputEl.value, level);
  const summary = summarize(result);
  const pricing = findPricing(modelEl.value);
  renderResult(result, summary, pricing, resultEl);
}

function scheduleRefresh(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(refresh, 200);
}

inputEl.addEventListener('input', scheduleRefresh);
levelEl.addEventListener('change', refresh);
modelEl.addEventListener('change', refresh);

document.getElementById('sample')?.addEventListener('click', () => {
  inputEl.value = SAMPLE_PROMPT;
  refresh();
});

document.getElementById('clear')?.addEventListener('click', () => {
  inputEl.value = '';
  refresh();
});

document.getElementById('copy')?.addEventListener('click', () => {
  const level = levelEl.value as Aggressiveness;
  const result = compressPrompt(inputEl.value, level);
  copyOrDownload(result.compressedText, 'compressed-prompt.txt', 'text/plain', 'Compressed prompt copied');
});

document.getElementById('export')?.addEventListener('click', () => {
  const level = levelEl.value as Aggressiveness;
  const result = compressPrompt(inputEl.value, level);
  const json = toTemplateJson(result.sections);
  downloadFile(json, 'prompt-template.json', 'application/json');
  showToast('Downloaded prompt-template.json');
});

function copyOrDownload(text: string, filename: string, mime: string, message: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast(message))
    .catch(() => {
      downloadFile(text, filename, mime);
      showToast(`Clipboard blocked — downloaded ${filename} instead`);
    });
}

function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

let toastTimer: number | undefined;
function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// First paint: load the sample so the page demonstrates itself.
inputEl.value = SAMPLE_PROMPT;
refresh();
