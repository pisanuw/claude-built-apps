/**
 * DOM layer: wires the drop zone, findings list, waterfall, and export
 * buttons to the pure core modules. Deliberately free of analysis logic so
 * everything interesting stays unit-testable in src/core.
 */

import { parseHar, HarParseError } from '../core/har';
import { analyze } from '../core/analyze';
import { toMarkdown } from '../core/report';
import { waterfallSvg, omittedRows, PHASE_COLORS, TYPE_COLORS } from '../core/waterfall';
import { sampleHarText } from '../core/sample';
import { formatBytes, formatMs } from '../core/format';
import type { Analysis, ParsedHar, ResourceType } from '../core/types';

interface State {
  parsed: ParsedHar | null;
  analysis: Analysis | null;
  sourceName: string;
  hiddenTypes: Set<ResourceType>;
  highlight: Set<number> | null;
}

const state: State = {
  parsed: null,
  analysis: null,
  sourceName: '',
  hiddenTypes: new Set(),
  highlight: null,
};

const ALL_TYPES: ResourceType[] = ['document', 'script', 'stylesheet', 'image', 'font', 'xhr', 'media', 'other'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function el<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

export function initApp(root: HTMLElement): void {
  root.innerHTML = `
    <header>
      <h1>🕵️ HAR Detective</h1>
      <p class="tagline">Drop a browser HAR file and get a waterfall plus a ranked, plain-English performance report.</p>
      <p class="privacy">Fully client-side: the HAR file is parsed in your browser and never uploaded anywhere.
      Every finding comes from deterministic rules, so the same file always yields the same report.</p>
    </header>
    <div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Load a HAR file">
      <p><strong>Drop a .har file here</strong> or click to choose one</p>
      <p class="hint">DevTools → Network → right-click → “Save all as HAR”</p>
    </div>
    <div class="actions">
      <button class="primary" id="sample-btn">Try the sample session</button>
      <span class="note">A synthetic e-commerce session that trips every detector.</span>
    </div>
    <input type="file" id="file-input" accept=".har,application/json" hidden />
    <div id="error"></div>
    <div id="results"></div>
    <footer>
      Built as a deterministic, offline take on “AI-powered HAR analysis”: the pattern detectors are
      hand-written rules, so no API keys and none of your HAR data leaves the page.
      <a href="https://github.com/pisanuw/Claude-capstone/tree/main/har-detective">Source on GitHub</a>.
    </footer>
  `;

  const dropzone = el<HTMLDivElement>('#dropzone');
  const fileInput = el<HTMLInputElement>('#file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile(file);
    fileInput.value = '';
  });
  el<HTMLButtonElement>('#sample-btn').addEventListener('click', () => {
    loadText(sampleHarText(), 'sample-session.har');
  });
}

async function loadFile(file: File): Promise<void> {
  loadText(await file.text(), file.name);
}

function loadText(text: string, name: string): void {
  const errorBox = el<HTMLDivElement>('#error');
  errorBox.innerHTML = '';
  try {
    state.parsed = parseHar(text);
    state.analysis = analyze(state.parsed.entries);
    state.sourceName = name;
    state.hiddenTypes = new Set();
    state.highlight = null;
    renderResults();
  } catch (err) {
    state.parsed = null;
    state.analysis = null;
    el<HTMLDivElement>('#results').innerHTML = '';
    const msg = err instanceof HarParseError ? err.message : 'Unexpected error while reading this file.';
    errorBox.innerHTML = `<div class="error">${esc(msg)}</div>`;
  }
}

function renderResults(): void {
  const { parsed, analysis } = state;
  if (!parsed || !analysis) return;
  const { stats, findings } = analysis;

  const warnings =
    parsed.warnings.length > 0
      ? `<p class="note">⚠ ${parsed.warnings.length} malformed entr${parsed.warnings.length === 1 ? 'y was' : 'ies were'} skipped.</p>`
      : '';

  const statCards = [
    [String(stats.requestCount), 'requests'],
    [String(stats.originCount), 'origins'],
    [formatBytes(stats.totalTransfer), 'transferred'],
    [formatMs(stats.duration), 'duration'],
    [String(stats.errorCount), 'failed'],
    [String(findings.length), 'findings'],
  ]
    .map(([v, l]) => `<div class="stat"><div class="value">${esc(v)}</div><div class="label">${l}</div></div>`)
    .join('');

  const findingCards =
    findings.length === 0
      ? '<p>No issues detected — this is a clean session. 🎉</p>'
      : findings
          .map((f, i) => {
            const impact: string[] = [];
            if (f.wastedBytes) impact.push(`~${formatBytes(f.wastedBytes)}`);
            if (f.wastedMs) impact.push(`~${formatMs(f.wastedMs)}`);
            const requests = f.entries
              .slice(0, 6)
              .map((idx) => {
                const e = parsed.entries[idx];
                return `<li>${esc(`${e.method} ${e.url}`)} — ${e.status || 'no response'}, ${formatBytes(e.transferSize)}, ${formatMs(e.time)}</li>`;
              })
              .join('');
            const more = f.entries.length > 6 ? `<li>…and ${f.entries.length - 6} more</li>` : '';
            return `
              <details class="finding" ${i === 0 ? 'open' : ''}>
                <summary>
                  <span class="badge ${f.severity}">${f.severity}</span>
                  <span>${esc(f.title)}</span>
                  <span class="impact">${impact.join(' · ')}</span>
                </summary>
                <div class="body">
                  <p>${esc(f.explanation)}</p>
                  <div class="fix"><strong>Fix:</strong> ${esc(f.remediation)}</div>
                  <button data-highlight="${i}">Show in waterfall</button>
                  <ul class="requests">${requests}${more}</ul>
                </div>
              </details>`;
          })
          .join('');

  const typeFilters = ALL_TYPES.filter((t) => parsed.entries.some((e) => e.type === t))
    .map(
      (t) => `
        <label><input type="checkbox" data-type="${t}" ${state.hiddenTypes.has(t) ? '' : 'checked'} />
        <span class="swatch" style="background:${TYPE_COLORS[t]}"></span>${t}</label>`,
    )
    .join('');

  const legend = Object.entries(PHASE_COLORS)
    .filter(([k]) => k !== 'ssl')
    .map(([k, c]) => `<span><span class="swatch" style="background:${c}"></span>${k}</span>`)
    .join('');

  el<HTMLDivElement>('#results').innerHTML = `
    <div class="panel narrative">${esc(analysis.narrative)}</div>
    ${warnings}
    <div class="stat-grid">${statCards}</div>
    <div class="actions">
      <button class="primary" id="copy-md">Copy Markdown report</button>
      <button id="download-md">Download report.md</button>
      <span class="note" id="copy-status"></span>
    </div>
    <h2>Findings</h2>
    <div id="findings">${findingCards}</div>
    <h2>Waterfall</h2>
    <div class="filters" id="type-filters">${typeFilters}
      <button id="clear-highlight" hidden>Clear highlight</button>
    </div>
    <div class="legend">${legend}</div>
    <div class="waterfall-scroll" id="waterfall"></div>
    <p class="note" id="omitted"></p>
  `;

  el<HTMLDivElement>('#type-filters').addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    const t = cb.dataset.type as ResourceType | undefined;
    if (!t) return;
    if (cb.checked) state.hiddenTypes.delete(t);
    else state.hiddenTypes.add(t);
    renderWaterfall();
  });
  el<HTMLDivElement>('#findings').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-highlight]') as HTMLButtonElement | null;
    if (!btn) return;
    const f = findings[Number(btn.dataset.highlight)];
    state.highlight = new Set(f.entries);
    renderWaterfall();
    el<HTMLDivElement>('#waterfall').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  el<HTMLButtonElement>('#clear-highlight').addEventListener('click', () => {
    state.highlight = null;
    renderWaterfall();
  });
  el<HTMLButtonElement>('#copy-md').addEventListener('click', () => {
    void navigator.clipboard.writeText(markdown()).then(() => {
      el<HTMLSpanElement>('#copy-status').textContent = 'Copied ✓';
    });
  });
  el<HTMLButtonElement>('#download-md').addEventListener('click', () => {
    const blob = new Blob([markdown()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'har-detective-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  renderWaterfall();
}

function markdown(): string {
  return toMarkdown(state.analysis!, state.parsed!.entries, state.sourceName);
}

function renderWaterfall(): void {
  const { parsed } = state;
  if (!parsed) return;
  const types = new Set(ALL_TYPES.filter((t) => !state.hiddenTypes.has(t)));
  const opts = { types, highlight: state.highlight ?? undefined };
  el<HTMLDivElement>('#waterfall').innerHTML = waterfallSvg(parsed.entries, opts);
  const omitted = omittedRows(parsed.entries, opts);
  el<HTMLParagraphElement>('#omitted').textContent =
    omitted > 0 ? `${omitted} additional rows are not drawn (400-row cap); the report still covers them.` : '';
  el<HTMLButtonElement>('#clear-highlight').hidden = state.highlight === null;
}
