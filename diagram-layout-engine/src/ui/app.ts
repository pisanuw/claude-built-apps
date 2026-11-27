// Application shell: tabs, editor, diff view, pipeline inspector, benchmark
// and guide. All state lives in this module; layout runs synchronously on
// each (debounced) edit.

import { diffCharts, type ChartDiff } from '../core/diff';
import { DIFF_EXAMPLES, EXAMPLES } from '../core/examples';
import { layoutChart } from '../core/layout';
import type { TextMeasurer } from '../core/measure';
import { tryParse, type ParseError } from '../core/parser';
import { decodeState, encodeState } from '../core/share';
import { renderSvg, type DiffView } from '../core/svg';
import { THEMES, themeById } from '../core/themes';
import { DEFAULT_OPTIONS, type Flowchart, type Layout, type LayoutOptions } from '../core/types';
import { BenchView } from './bench-view';
import { $, copyText, download, esc, fmt, options, storageGet, storageSet, toast } from './dom';
import { GUIDE_HTML } from './guide';
import { renderPipeline, type PipelineState } from './pipeline';
import { Viewport } from './viewport';

type Tab = 'editor' | 'diff' | 'pipeline' | 'bench' | 'guide';

interface Saved {
  source: string;
  example: string;
  options: LayoutOptions;
  theme: string;
  debug: boolean;
  before: string;
  after: string;
  diffExample: string;
}

const KEY = 'diagram-layout-engine:v1';

const state: Saved & { tab: Tab; diffView: DiffView | 'side' } = {
  source: EXAMPLES[0].source,
  example: EXAMPLES[0].id,
  options: { ...DEFAULT_OPTIONS },
  theme: 'auto',
  debug: false,
  before: DIFF_EXAMPLES[0].before,
  after: DIFF_EXAMPLES[0].after,
  diffExample: DIFF_EXAMPLES[0].id,
  tab: 'editor',
  diffView: 'side',
};

const pipelineUi: PipelineState = { stage: 'acyclic', snapshot: 0 };

// ------------------------------------------------------------ measurement

const measurers = new Map<string, TextMeasurer>();
function measurerFor(theme: string): TextMeasurer {
  const font = themeById(theme === 'auto' ? 'light' : theme).vars['--dle-font'];
  let m = measurers.get(font);
  if (!m) {
    const ctx = document.createElement('canvas').getContext('2d');
    const cache = new Map<string, number>();
    if (ctx) ctx.font = `14px ${font}`;
    m = {
      width(text: string): number {
        let w = cache.get(text);
        if (w === undefined) {
          w = ctx ? Math.ceil(ctx.measureText(text).width) : text.length * 8;
          cache.set(text, w);
        }
        return w;
      },
      lineHeight: 18,
    };
    measurers.set(font, m);
  }
  return m;
}

/** The diagram theme in effect: Auto follows the page's light or dark mode (the switch, else the device). */
const resolvedTheme = (): string => {
  if (state.theme !== 'auto') return state.theme;
  return window.hintwise?.theme?.get() ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
};

// ------------------------------------------------------------ shell

const ICON = {
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
};

function shell(): string {
  const tab = (id: Tab, label: string): string =>
    `<button role="tab" class="tab" id="tab-${id}" data-tab="${id}" aria-controls="panel-${id}" aria-selected="${state.tab === id}">${label}</button>`;
  const exampleOpts = [...EXAMPLES.map((e) => ({ value: e.id, label: e.title })), { value: 'custom', label: 'Custom' }];
  const o = state.options;
  const sel = (id: string, label: string, list: { value: string; label: string }[], value: string): string =>
    `<label class="opt"><span>${label}</span><select id="${id}">${options(list, value)}</select></label>`;
  return `
  <header class="top">
    <div class="brand title-row">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="11" y="3" width="10" height="7" rx="2"/><rect x="3" y="22" width="10" height="7" rx="2"/><rect x="19" y="22" width="10" height="7" rx="2"/><path d="M16 10v5M8 22v-3.5h16V22" fill="none"/></svg>
      <h1>Diagram Layout Engine</h1>
      <hw-theme-toggle></hw-theme-toggle>
    </div>
    <p class="tagline">Mermaid flowcharts, laid out from scratch with the Sugiyama pipeline</p>
    <nav class="tabs" role="tablist" aria-label="Views">
      ${tab('editor', 'Editor')}${tab('diff', 'Diff')}${tab('pipeline', 'Pipeline')}${tab('bench', 'Benchmark')}${tab('guide', 'Guide')}
    </nav>
  </header>

  <main>
    <section id="panel-editor" role="tabpanel" aria-labelledby="tab-editor" class="panel editor-panel">
      <aside class="side">
        <label class="opt wide"><span>Example</span><select id="example">${options(exampleOpts, state.example)}</select></label>
        <p class="blurb" id="blurb"></p>
        <div class="code">
          <pre class="gutter" id="gutter" aria-hidden="true"></pre>
          <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Mermaid flowchart source"></textarea>
        </div>
        <div id="error" class="error" role="alert" hidden></div>
        <ul id="warnings" class="warnings"></ul>
        <details class="options" id="options"${window.innerWidth >= 900 ? ' open' : ''}>
          <summary>Layout options</summary>
          <div class="opt-grid">
            ${sel('o-direction', 'Direction', [{ value: '', label: 'From source' }, ...['TB', 'BT', 'LR', 'RL'].map((d) => ({ value: d, label: d }))], o.direction ?? '')}
            ${sel('o-cycle', 'Cycle removal', [{ value: 'greedy', label: 'Greedy FAS' }, { value: 'dfs', label: 'DFS' }], o.cycle)}
            ${sel('o-rank', 'Layering', [{ value: 'network-simplex', label: 'Network simplex' }, { value: 'longest-path', label: 'Longest path' }], o.rank)}
            ${sel('o-order', 'Ordering', [{ value: 'median', label: 'Median' }, { value: 'barycenter', label: 'Barycenter' }], o.order)}
            ${sel('o-position', 'Coordinates', [{ value: 'brandes-kopf', label: 'Brandes-Koepf' }, { value: 'priority', label: 'Priority method' }], o.position)}
            ${sel('o-route', 'Edges', [{ value: 'spline', label: 'Spline' }, { value: 'orthogonal', label: 'Orthogonal' }, { value: 'polyline', label: 'Polyline' }], o.route)}
            ${sel('o-theme', 'Theme', [{ value: 'auto', label: 'Auto (light/dark)' }, ...THEMES.map((t) => ({ value: t.id, label: t.label }))], state.theme)}
            <label class="opt"><span>Sweeps <output id="o-sweeps-v">${o.sweeps}</output></span><input type="range" id="o-sweeps" min="0" max="24" value="${o.sweeps}"></label>
            <label class="opt"><span>Node gap <output id="o-nodesep-v">${o.nodeSep}</output></span><input type="range" id="o-nodesep" min="10" max="120" value="${o.nodeSep}"></label>
            <label class="opt"><span>Layer gap <output id="o-ranksep-v">${o.rankSep}</output></span><input type="range" id="o-ranksep" min="20" max="160" value="${o.rankSep}"></label>
            <label class="check"><input type="checkbox" id="o-transpose"${o.transpose ? ' checked' : ''}> Transposition</label>
            <label class="check"><input type="checkbox" id="o-debug"${state.debug ? ' checked' : ''}> Show rank/order</label>
          </div>
          <button class="link" id="o-reset">Reset options</button>
        </details>
      </aside>
      <div class="stage">
        <div class="toolbar">
          <div class="group">
            <button class="icon" id="z-fit" title="Fit (double-click the canvas)" aria-label="Fit to view">${ICON.fit}</button>
            <button class="icon" id="z-out" aria-label="Zoom out">${ICON.minus}</button>
            <button class="zoom" id="z-100" aria-label="Zoom 100%: reset to actual size">100%</button>
            <button class="icon" id="z-in" aria-label="Zoom in">${ICON.plus}</button>
          </div>
          <div class="group">
            <button id="x-svg">SVG</button>
            <button id="x-png">PNG</button>
            <button id="x-copy">Copy SVG</button>
            <button id="x-link" class="primary">Share link</button>
          </div>
        </div>
        <div id="canvas" class="canvas"></div>
        <div id="info" class="info" hidden></div>
        <div id="metrics" class="metrics mono" aria-live="polite"></div>
      </div>
    </section>

    <section id="panel-diff" role="tabpanel" aria-labelledby="tab-diff" class="panel diff-panel" hidden>
      <div class="diff-controls">
        <label class="opt"><span>Example pair</span><select id="diff-example">${options([...DIFF_EXAMPLES.map((d) => ({ value: d.id, label: d.title })), { value: 'custom', label: 'Custom' }], state.diffExample)}</select></label>
        <div class="seg" role="group" aria-label="Diff view">
          ${(['side', 'before', 'after', 'overlay'] as const).map((v) => `<button data-view="${v}" aria-pressed="${state.diffView === v}">${v === 'side' ? 'Side by side' : v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
        </div>
        <button id="diff-from-editor" class="link">Use the editor's diagram as "before"</button>
        <button id="diff-link" class="primary">Share link</button>
      </div>
      <div class="diff-sources">
        <label><span>Before</span><textarea id="diff-before" spellcheck="false" aria-label="Before version"></textarea></label>
        <label><span>After</span><textarea id="diff-after" spellcheck="false" aria-label="After version"></textarea></label>
      </div>
      <div id="diff-error" class="error" role="alert" hidden></div>
      <div class="diff-summary" id="diff-summary"></div>
      <div class="diff-out" id="diff-out"></div>
    </section>

    <section id="panel-pipeline" role="tabpanel" aria-labelledby="tab-pipeline" class="panel pipeline-panel" hidden>
      <p class="lead">The current editor diagram, stage by stage. Change the source or the options in the Editor and come back.</p>
      <div id="pipeline"></div>
    </section>

    <section id="panel-bench" role="tabpanel" aria-labelledby="tab-bench" class="panel" hidden><div id="bench"></div></section>
    <section id="panel-guide" role="tabpanel" aria-labelledby="tab-guide" class="panel" hidden>${GUIDE_HTML}</section>
  </main>
  <footer class="foot">Runs entirely in your browser. Part of <a href="https://github.com/pisanuw/Claude-capstone/tree/main/diagram-layout-engine">Claude-capstone</a>.</footer>`;
}

// ------------------------------------------------------------ editor

let vp: Viewport;
let lastLayout: Layout | null = null;
let lastChart: Flowchart | null = null;
let rendered = false;
/** Rendered while the editor was hidden, so the fit used a guessed size. */
let needsFit = false;

function save(): void {
  const saved: Saved = {
    source: state.source,
    example: state.example,
    options: state.options,
    theme: state.theme,
    debug: state.debug,
    before: state.before,
    after: state.after,
    diffExample: state.diffExample,
  };
  storageSet(KEY, saved);
}

function setTheme(): void {
  const t = state.theme === 'auto' ? null : themeById(state.theme);
  document.documentElement.dataset.diagram = t ? (t.dark ? 'dark' : 'light') : 'auto';
}

function showError(box: HTMLElement, err: ParseError, src: string, jump?: () => void): void {
  const lineText = src.split('\n')[err.line - 1] ?? '';
  const caret = ' '.repeat(Math.max(0, err.col - 1)) + '^'.repeat(Math.min(err.length, Math.max(1, lineText.length - err.col + 1)));
  box.hidden = false;
  box.innerHTML = `<div><strong>Line ${err.line}, column ${err.col}:</strong> ${esc(err.detail)}</div><pre>${esc(lineText)}\n${esc(caret)}</pre>${jump ? '<button class="link" id="err-jump">Go to error</button>' : ''}`;
  if (jump) box.querySelector('#err-jump')!.addEventListener('click', jump);
}

function updateGutter(): void {
  const ta = $('#source') as HTMLTextAreaElement;
  const n = ta.value.split('\n').length;
  $('#gutter').textContent = Array.from({ length: n }, (_, k) => k + 1).join('\n');
  $('#gutter').scrollTop = ta.scrollTop;
}

function renderEditor(keepView: boolean): void {
  const src = state.source;
  const res = tryParse(src);
  const box = $('#error');
  const warn = $('#warnings');
  if (!res.ok) {
    showError(box, res.error, src, () => {
      const ta = $('#source') as HTMLTextAreaElement;
      ta.focus();
      ta.setSelectionRange(res.error.offset, Math.min(src.length, res.error.offset + res.error.length));
    });
    $('#canvas').classList.add('stale');
    $('#info').hidden = true;
    warn.innerHTML = '';
    return;
  }
  box.hidden = true;
  $('#canvas').classList.remove('stale');
  warn.innerHTML = res.chart.warnings.map((w) => `<li>Line ${w.line}: ${esc(w.message)}</li>`).join('');
  const layout = layoutChart(res.chart, state.options, measurerFor(state.theme));
  lastLayout = layout;
  lastChart = res.chart;
  const ex = EXAMPLES.find((e) => e.id === state.example);
  const svg = renderSvg(layout, { theme: state.theme, idPrefix: 'ed', classDefs: res.chart.classDefs, debug: state.debug, title: ex?.title ?? 'Diagram' });
  vp.setSvg(svg, keepView && rendered);
  if (!keepView || !rendered) needsFit = $('#panel-editor').hidden;
  rendered = true;
  $('#info').hidden = true;
  const s = layout.stats;
  const m = (label: string, v: string, tip: string): string => `<span title="${esc(tip)}"><b>${v}</b> ${label}</span>`;
  $('#metrics').innerHTML = [
    m('nodes', fmt(s.nodes), 'Nodes in the diagram'),
    m('edges', fmt(s.edges), 'Edges in the diagram'),
    m('layers', fmt(s.layers), 'Layers in the deepest scope'),
    m('dummies', fmt(s.dummies), 'Dummy nodes inserted for long edges'),
    m('reversed', fmt(s.reversed), 'Edges reversed to break cycles'),
    m('crossings', fmt(s.crossings), 'Edge crossings counted on the layer graphs'),
    m('area', `${fmt(layout.width)}×${fmt(layout.height)}`, 'Drawing size in px'),
    m('px of edges', fmt(s.edgeLength), 'Total routed edge length'),
    m('bends', fmt(s.bends), 'Direction changes along edges'),
    m('ms', String(s.ms), 'Layout time'),
  ].join('');
}

let timer = 0;
function scheduleEditor(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    renderEditor(true);
    save();
  }, 140);
}

function loadExample(id: string): void {
  const ex = EXAMPLES.find((e) => e.id === id);
  state.example = id;
  if (ex) state.source = ex.source;
  ($('#source') as HTMLTextAreaElement).value = state.source;
  ($('#example') as HTMLSelectElement).value = id;
  $('#blurb').textContent = ex?.blurb ?? 'Your own diagram.';
  updateGutter();
  renderEditor(false);
  save();
}

function nodeInfo(id: string): void {
  if (!lastLayout || !lastChart) return;
  const n = lastLayout.nodes.find((x) => x.id === id);
  if (!n) return;
  const ins = lastLayout.edges.filter((e) => e.to === id).length;
  const outs = lastLayout.edges.filter((e) => e.from === id).length;
  const src = lastChart.nodes.get(id)!.pos;
  const info = $('#info');
  info.hidden = false;
  info.innerHTML = `<button class="close" aria-label="Close">×</button><strong>${esc(n.label.replace(/\n/g, ' '))}</strong>
    <dl><dt>id</dt><dd><code>${esc(n.id)}</code></dd><dt>shape</dt><dd>${n.shape}</dd><dt>layer · order</dt><dd>${n.rank} · ${n.order}${n.parent ? ` in ${esc(n.parent)}` : ''}</dd>
    <dt>in · out</dt><dd>${ins} · ${outs}</dd><dt>centre</dt><dd>${Math.round(n.x)}, ${Math.round(n.y)}</dd><dt>size</dt><dd>${Math.round(n.width)} × ${Math.round(n.height)}</dd></dl>
    <button class="link" id="info-src">Show in source (line ${src.line})</button>`;
  info.querySelector('.close')!.addEventListener('click', () => (info.hidden = true));
  info.querySelector('#info-src')!.addEventListener('click', () => {
    const ta = $('#source') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(src.offset, src.offset + id.length);
  });
}

function wireCanvas(): void {
  const canvas = $('#canvas');
  vp = new Viewport(canvas);
  // The name holds the zoom it shows (axe: label-content-name-mismatch) and says what a press does.
  vp.onZoom = (s) => {
    const pct = `${Math.round(s * 100)}%`;
    $('#z-100').textContent = pct;
    $('#z-100').setAttribute('aria-label', `Zoom ${pct}: reset to actual size`);
  };
  const clearHl = (): void => {
    canvas.classList.remove('hl-on');
    canvas.querySelectorAll('.dle-hl').forEach((el) => el.classList.remove('dle-hl'));
  };
  canvas.addEventListener('pointerover', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.dle-node');
    if (!g) return;
    const id = g.dataset.id!;
    clearHl();
    canvas.classList.add('hl-on');
    g.classList.add('dle-hl');
    canvas.querySelectorAll<SVGGElement>('.dle-edge').forEach((el) => {
      if (el.dataset.from === id || el.dataset.to === id) {
        el.classList.add('dle-hl');
        canvas.querySelector(`.dle-node[data-id="${CSS.escape(el.dataset.from === id ? el.dataset.to! : el.dataset.from!)}"]`)?.classList.add('dle-hl');
      }
    });
  });
  canvas.addEventListener('pointerout', (e) => {
    if ((e.target as Element).closest('.dle-node') && !(e.relatedTarget as Element | null)?.closest?.('.dle-node')) clearHl();
  });
  canvas.addEventListener('click', (e) => {
    if (vp.moved) return;
    const g = (e.target as Element).closest<SVGGElement>('.dle-node');
    if (g) nodeInfo(g.dataset.id!);
  });
  canvas.addEventListener('keydown', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.dle-node');
    if (g && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      nodeInfo(g.dataset.id!);
    }
  });
  $('#z-fit').addEventListener('click', () => vp.fit());
  $('#z-in').addEventListener('click', () => vp.zoomBy(1.25));
  $('#z-out').addEventListener('click', () => vp.zoomBy(0.8));
  $('#z-100').addEventListener('click', () => vp.actual());
}

function exportSvg(theme: string): string | null {
  if (!lastLayout || !lastChart) return null;
  return renderSvg(lastLayout, { theme, idPrefix: 'dle', classDefs: lastChart.classDefs, title: EXAMPLES.find((e) => e.id === state.example)?.title ?? 'Diagram' });
}

async function exportPng(): Promise<void> {
  const svg = exportSvg(resolvedTheme());
  if (!svg || !lastLayout) return;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    img.src = url;
    await img.decode();
    const scale = 2;
    const c = document.createElement('canvas');
    c.width = lastLayout.width * scale;
    c.height = lastLayout.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, lastLayout.width, lastLayout.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (blob) download('diagram.png', blob);
  } catch {
    toast('PNG export failed in this browser; try SVG');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wireEditor(): void {
  const ta = $('#source') as HTMLTextAreaElement;
  ta.value = state.source;
  updateGutter();
  ta.addEventListener('input', () => {
    state.source = ta.value;
    if (state.example !== 'custom') {
      state.example = 'custom';
      ($('#example') as HTMLSelectElement).value = 'custom';
      $('#blurb').textContent = 'Your own diagram.';
    }
    updateGutter();
    scheduleEditor();
  });
  ta.addEventListener('scroll', () => ($('#gutter').scrollTop = ta.scrollTop));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Two-space indent; Escape then Tab still leaves the field.
      if (ta.dataset.escaped === '1') return;
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    ta.dataset.escaped = e.key === 'Escape' ? '1' : '';
  });
  $('#example').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'custom') return;
    loadExample(v);
  });
  const bindSelect = (id: string, apply: (v: string) => void): void => {
    $(id).addEventListener('change', (e) => {
      apply((e.target as HTMLSelectElement).value);
      renderEditor(true);
      save();
    });
  };
  bindSelect('#o-direction', (v) => (state.options.direction = (v || null) as LayoutOptions['direction']));
  bindSelect('#o-cycle', (v) => (state.options.cycle = v as LayoutOptions['cycle']));
  bindSelect('#o-rank', (v) => (state.options.rank = v as LayoutOptions['rank']));
  bindSelect('#o-order', (v) => (state.options.order = v as LayoutOptions['order']));
  bindSelect('#o-position', (v) => (state.options.position = v as LayoutOptions['position']));
  bindSelect('#o-route', (v) => (state.options.route = v as LayoutOptions['route']));
  bindSelect('#o-theme', (v) => {
    state.theme = v;
    setTheme();
  });
  const bindRange = (id: string, apply: (v: number) => void): void => {
    $(id).addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      $(`${id}-v`).textContent = String(v);
      apply(v);
      renderEditor(true);
      save();
    });
  };
  bindRange('#o-sweeps', (v) => (state.options.sweeps = v));
  bindRange('#o-nodesep', (v) => (state.options.nodeSep = v));
  bindRange('#o-ranksep', (v) => (state.options.rankSep = v));
  $('#o-transpose').addEventListener('change', (e) => {
    state.options.transpose = (e.target as HTMLInputElement).checked;
    renderEditor(true);
    save();
  });
  $('#o-debug').addEventListener('change', (e) => {
    state.debug = (e.target as HTMLInputElement).checked;
    renderEditor(true);
    save();
  });
  $('#o-reset').addEventListener('click', () => {
    state.options = { ...DEFAULT_OPTIONS };
    state.theme = 'auto';
    state.debug = false;
    save();
    location.reload();
  });
  $('#x-svg').addEventListener('click', () => {
    const svg = exportSvg(state.theme);
    if (svg) download('diagram.svg', new Blob([svg], { type: 'image/svg+xml' }));
  });
  $('#x-png').addEventListener('click', () => void exportPng());
  $('#x-copy').addEventListener('click', async () => {
    const svg = exportSvg(state.theme);
    if (svg) toast((await copyText(svg)) ? 'SVG copied' : 'Copy failed: use the SVG button');
  });
  $('#x-link').addEventListener('click', async () => {
    const frag = await encodeState({ source: state.source });
    history.replaceState(null, '', `#${frag}`);
    toast((await copyText(location.href)) ? 'Link copied' : 'Link is in the address bar');
  });
}

// ------------------------------------------------------------ diff

let diffTimer = 0;
function renderDiff(): void {
  const a = tryParse(state.before);
  const b = tryParse(state.after);
  const box = $('#diff-error');
  if (!a.ok || !b.ok) {
    const err = !a.ok ? a.error : (b as { ok: false; error: ParseError }).error;
    showError(box, err, !a.ok ? state.before : state.after);
    box.insertAdjacentHTML('afterbegin', `<div class="which">${!a.ok ? 'Before' : 'After'}</div>`);
    $('#diff-out').classList.add('stale');
    return;
  }
  box.hidden = true;
  $('#diff-out').classList.remove('stale');
  const d: ChartDiff = diffCharts(a.chart, b.chart);
  const layout = layoutChart(d.union, state.options, measurerFor(state.theme));
  const svg = (view: DiffView, prefix: string): string =>
    renderSvg(layout, {
      theme: state.theme,
      idPrefix: prefix,
      classDefs: d.union.classDefs,
      diff: { status: d.status, view, labels: view === 'before' ? d.before : d.after },
      title: `Diff, ${view}`,
    });
  const out = $('#diff-out');
  if (state.diffView === 'side') {
    out.className = 'diff-out side';
    out.innerHTML = `<figure><figcaption>Before</figcaption><div class="fig-scroll">${svg('before', 'db')}</div></figure><figure><figcaption>After</figcaption><div class="fig-scroll">${svg('after', 'da')}</div></figure>`;
  } else {
    out.className = 'diff-out';
    out.innerHTML = `<figure><figcaption>${state.diffView[0].toUpperCase() + state.diffView.slice(1)}</figcaption><div class="fig-scroll">${svg(state.diffView, 'do')}</div></figure>`;
  }
  const c = d.counts;
  const items = d.entries.map((e) => `<li class="d-${e.status}" data-id="${esc(e.id)}"><span class="tag">${e.status}</span> ${esc(e.kind)} ${esc(e.text)}</li>`).join('');
  $('#diff-summary').innerHTML = `<div class="chips"><span class="chip d-added">+${c.added} added</span><span class="chip d-removed">−${c.removed} removed</span><span class="chip d-changed">~${c.changed} changed</span><span class="chip">${c.same} unchanged</span></div>
    ${items ? `<ul class="changes">${items}</ul>` : '<p class="empty">The two versions are identical.</p>'}`;
  $('#diff-summary')
    .querySelectorAll<HTMLLIElement>('li[data-id]')
    .forEach((li) =>
      li.addEventListener('click', () => {
        out.querySelectorAll('.dle-pulse').forEach((el) => el.classList.remove('dle-pulse'));
        out.querySelectorAll(`[data-id="${CSS.escape(li.dataset.id!)}"]`).forEach((el) => el.classList.add('dle-pulse'));
      }),
    );
}

function wireDiff(): void {
  const before = $('#diff-before') as HTMLTextAreaElement;
  const after = $('#diff-after') as HTMLTextAreaElement;
  before.value = state.before;
  after.value = state.after;
  const onInput = (): void => {
    state.before = before.value;
    state.after = after.value;
    state.diffExample = 'custom';
    ($('#diff-example') as HTMLSelectElement).value = 'custom';
    window.clearTimeout(diffTimer);
    diffTimer = window.setTimeout(() => {
      renderDiff();
      save();
    }, 160);
  };
  before.addEventListener('input', onInput);
  after.addEventListener('input', onInput);
  $('#diff-example').addEventListener('change', (e) => {
    const ex = DIFF_EXAMPLES.find((x) => x.id === (e.target as HTMLSelectElement).value);
    if (!ex) return;
    state.diffExample = ex.id;
    state.before = before.value = ex.before;
    state.after = after.value = ex.after;
    renderDiff();
    save();
  });
  $('#panel-diff')
    .querySelectorAll<HTMLButtonElement>('.seg button')
    .forEach((b) =>
      b.addEventListener('click', () => {
        state.diffView = b.dataset.view as typeof state.diffView;
        $('#panel-diff')
          .querySelectorAll<HTMLButtonElement>('.seg button')
          .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderDiff();
      }),
    );
  $('#diff-link').addEventListener('click', async () => {
    const frag = await encodeState({ source: state.before, after: state.after });
    history.replaceState(null, '', `#${frag}`);
    toast((await copyText(location.href)) ? 'Link copied' : 'Link is in the address bar');
  });
  $('#diff-from-editor').addEventListener('click', () => {
    state.before = before.value = state.source;
    if (!state.after.trim() || state.diffExample !== 'custom') state.after = after.value = state.source;
    state.diffExample = 'custom';
    ($('#diff-example') as HTMLSelectElement).value = 'custom';
    renderDiff();
    save();
    after.focus();
  });
}

// ------------------------------------------------------------ pipeline

function renderPipelineTab(): void {
  const root = $('#pipeline');
  const res = tryParse(state.source);
  if (!res.ok) {
    root.innerHTML = `<div class="error">The editor diagram has a parse error on line ${res.error.line}: ${esc(res.error.detail)}</div>`;
    return;
  }
  const layout = layoutChart(res.chart, { ...state.options, record: true }, measurerFor(state.theme));
  const svg = renderSvg(layout, { theme: state.theme, idPrefix: 'pl', classDefs: res.chart.classDefs, title: 'The routed diagram' });
  renderPipeline(root, res.chart, layout, state.options, svg, pipelineUi, renderPipelineTab);
}

// ------------------------------------------------------------ tabs

let bench: BenchView | null = null;

function showTab(tab: Tab): void {
  state.tab = tab;
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => (p.hidden = p.id !== `panel-${tab}`));
  if (tab === 'editor' && !rendered) renderEditor(false);
  else if (tab === 'editor' && needsFit) {
    needsFit = false;
    vp.fit();
  }
  if (tab === 'diff') renderDiff();
  if (tab === 'pipeline') renderPipelineTab();
  if (tab === 'bench' && !bench) {
    bench = new BenchView($('#bench'), (source) => {
      state.example = 'custom';
      state.source = source;
      ($('#source') as HTMLTextAreaElement).value = source;
      ($('#example') as HTMLSelectElement).value = 'custom';
      $('#blurb').textContent = 'A benchmark graph.';
      updateGutter();
      showTab('editor');
      renderEditor(false);
      save();
    });
  }
}

export async function start(root: HTMLElement): Promise<void> {
  const saved = storageGet<Partial<Saved>>(KEY);
  if (saved) {
    Object.assign(state, {
      ...saved,
      options: { ...DEFAULT_OPTIONS, ...(saved.options ?? {}), record: false },
    });
  }
  let initialTab: Tab = 'editor';
  if (location.hash.length > 3) {
    const shared = await decodeState(location.hash);
    if (shared) {
      state.source = shared.source;
      state.example = EXAMPLES.find((e) => e.source === shared.source)?.id ?? 'custom';
      if (shared.after !== undefined) {
        state.before = shared.source;
        state.after = shared.after;
        state.diffExample = 'custom';
        initialTab = 'diff';
      }
    }
  }
  root.innerHTML = shell();
  setTheme();
  wireCanvas();
  wireEditor();
  wireDiff();
  $('#blurb').textContent = EXAMPLES.find((e) => e.id === state.example)?.blurb ?? 'Your own diagram.';
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as Tab)));
  $('.tabs').addEventListener('keydown', (e) => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
    const i = tabs.findIndex((t) => t.dataset.tab === state.tab);
    const k = e as KeyboardEvent;
    if (k.key !== 'ArrowRight' && k.key !== 'ArrowLeft') return;
    const next = tabs[(i + (k.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next.dataset.tab as Tab);
  });
  // A diagram on Auto follows the page's mode through its CSS (src/core/themes.ts); draw it again when the mode
  // changes, as it was on a change of the device setting.
  document.addEventListener('hw-themechange', () => {
    if (state.theme === 'auto' && state.tab === 'editor') renderEditor(true);
  });
  showTab(initialTab);
  if (initialTab !== 'editor') renderEditor(false);
}
