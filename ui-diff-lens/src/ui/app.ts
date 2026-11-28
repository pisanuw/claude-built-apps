import type { Bitmap, ChangeType, DiffResult } from '../core/types';
import { CHANGE_TYPES } from '../core/types';
import { analyze } from '../core/analyze';
import { buildOverlaySvg, TYPE_COLORS, TYPE_LABELS } from '../core/svg';
import { buildHtmlReport, summaryLine } from '../core/report';
import { drawSampleAfter, drawSampleBefore, SAMPLE_SIZE } from './samples';

const MAX_DIMENSION = 1600;


interface Slot {
  bitmap: Bitmap | null;
  dataUrl: string | null;
  name: string;
}

interface State {
  before: Slot;
  after: Slot;
  result: DiffResult | null;
  hiddenTypes: Set<ChangeType>;
  selected: number | null;
}

const state: State = {
  before: { bitmap: null, dataUrl: null, name: '' },
  after: { bitmap: null, dataUrl: null, name: '' },
  result: null,
  hiddenTypes: new Set(),
  selected: null,
};

let root: HTMLElement;

export function initApp(container: HTMLElement): void {
  root = container;
  render();
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const target = !state.before.bitmap ? 'before' : 'after';
          void loadFile(target, file);
        }
        e.preventDefault();
        return;
      }
    }
  });
}

async function loadFile(which: 'before' | 'after', file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      img.src = url;
    });
    setImage(which, img, file.name);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setImage(which: 'before' | 'after', img: CanvasImageSource & { width: number; height: number }, name: string): void {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  state[which] = {
    bitmap: { width: w, height: h, data: data.data },
    dataUrl: canvas.toDataURL('image/png'),
    name,
  };
  state.result = null;
  state.selected = null;
  runIfReady();
  render();
}

function runIfReady(): void {
  if (!state.before.bitmap || !state.after.bitmap) return;
  state.result = analyze(state.before.bitmap, state.after.bitmap);
  state.selected = null;
}

function loadSample(): void {
  for (const [which, draw] of [
    ['before', drawSampleBefore],
    ['after', drawSampleAfter],
  ] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE.width;
    canvas.height = SAMPLE_SIZE.height;
    draw(canvas.getContext('2d') as CanvasRenderingContext2D);
    setImage(which, canvas, `sample-${which}.png`);
  }
}

function visibleTypes(): ChangeType[] {
  return CHANGE_TYPES.filter((t) => !state.hiddenTypes.has(t));
}

function download(filename: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportHtml(): void {
  if (!state.result || !state.before.dataUrl || !state.after.dataUrl) return;
  const html = buildHtmlReport(
    state.result,
    state.before.dataUrl,
    state.after.dataUrl,
    new Date().toISOString().slice(0, 10),
  );
  download('ui-diff-report.html', new Blob([html], { type: 'text/html' }));
}

async function exportPng(): Promise<void> {
  const result = state.result;
  if (!result || !state.before.dataUrl || !state.after.dataUrl) return;
  const gap = 16;
  const canvas = document.createElement('canvas');
  canvas.width = result.width * 2 + gap;
  canvas.height = result.height + 40;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Before', 0, 24);
  ctx.fillText('After', result.width + gap, 24);

  const svgMarkup = buildOverlaySvg(result.width, result.height, result.regions, {
    visibleTypes: visibleTypes(),
  });
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
  const [imgA, imgB, overlay] = await Promise.all([
    loadImg(state.before.dataUrl),
    loadImg(state.after.dataUrl),
    loadImg(svgUrl),
  ]);
  ctx.drawImage(imgA, 0, 40);
  ctx.drawImage(overlay, 0, 40);
  ctx.drawImage(imgB, result.width + gap, 40);
  ctx.drawImage(overlay, result.width + gap, 40);
  canvas.toBlob((blob) => {
    if (blob) download('ui-diff.png', blob);
  }, 'image/png');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dropzone(which: 'before' | 'after'): string {
  const slot = state[which];
  const label = which === 'before' ? 'Before' : 'After';
  if (slot.dataUrl) {
    return `
      <div class="slot" data-slot="${which}">
        <div class="slot-head"><span>${label}</span><span class="slot-name">${esc(slot.name)}</span>
          <button class="link" data-clear="${which}">replace</button></div>
        <div class="thumb"><img src="${slot.dataUrl}" alt="${label} screenshot"></div>
      </div>`;
  }
  return `
    <div class="slot empty" data-slot="${which}">
      <div class="slot-head"><span>${label}</span></div>
      <label class="dz" data-dz="${which}">
        <input type="file" accept="image/*" data-file="${which}" hidden>
        <strong>Drop, paste, or click</strong>
        <span>PNG / JPEG screenshot</span>
      </label>
    </div>`;
}

function legend(result: DiffResult): string {
  const counts = new Map<ChangeType, number>();
  for (const r of result.regions) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return CHANGE_TYPES.filter((t) => (counts.get(t) ?? 0) > 0)
    .map((t) => {
      const off = state.hiddenTypes.has(t);
      return (
        `<button class="legend-item${off ? ' off' : ''}" data-toggle="${t}" aria-pressed="${!off}">` +
        `<span class="chip" style="background:${TYPE_COLORS[t]}"></span>` +
        `${TYPE_LABELS[t]} <span class="count">${counts.get(t)}</span></button>`
      );
    })
    .join('');
}

function resultView(): string {
  const result = state.result;
  if (!result) return '';
  if (result.identical) {
    return `<section class="results"><p class="all-clear">✅ The screenshots are visually identical (anti-aliasing differences ignored).</p></section>`;
  }
  const overlay = buildOverlaySvg(result.width, result.height, result.regions, {
    visibleTypes: visibleTypes(),
    interactive: true,
  });
  const regionList = result.regions
    .map((r, i) => {
      if (state.hiddenTypes.has(r.type)) return '';
      const sel = state.selected === i ? ' selected' : '';
      return (
        `<li class="region-item${sel}" data-region="${i}">` +
        `<span class="badge" style="border-color:${TYPE_COLORS[r.type]}">${i + 1}</span>` +
        `<div><strong>${TYPE_LABELS[r.type]}</strong> <span class="conf">${Math.round(r.confidence * 100)}% confidence</span>` +
        `<p class="reason">${esc(r.reason)}</p></div></li>`
      );
    })
    .join('');
  return `
    <section class="results">
      <div class="results-bar">
        <p class="summary">${esc(summaryLine(result))}${result.sizeMismatch ? ' · ⚠️ different dimensions, padded to match' : ''}</p>
        <div class="actions">
          <button id="export-png">Export PNG</button>
          <button id="export-html">Export HTML report</button>
        </div>
      </div>
      <div class="legend">${legend(result)}</div>
      <div class="pair">
        <figure><figcaption>Before</figcaption>
          <div class="frame"><img src="${state.before.dataUrl}" alt="Before">${overlay}</div></figure>
        <figure><figcaption>After</figcaption>
          <div class="frame"><img src="${state.after.dataUrl}" alt="After">${overlay}</div></figure>
      </div>
      <ol class="region-list">${regionList}</ol>
    </section>`;
}

function render(): void {
  root.innerHTML = `
    <header>
      <div class="title-row"><h1>🔍 UI Diff Lens</h1><hw-theme-toggle></hw-theme-toggle></div>
      <p class="tagline">Two screenshots in, a classified visual diff out: layout shifts, spacing nudges,
      color restyles, text edits, visibility fades, added and removed elements. Deterministic heuristics,
      100% in your browser: screenshots never leave this machine.</p>
    </header>
    <section class="inputs">
      ${dropzone('before')}
      ${dropzone('after')}
    </section>
    <div class="toolbar">
      <button id="sample" class="secondary">Try a sample pair</button>
      <button id="swap" class="secondary" ${state.before.bitmap && state.after.bitmap ? '' : 'disabled'}>Swap before/after</button>
    </div>
    ${resultView()}
    <footer>
      <p>Pixel comparison uses a perceptual YIQ metric with anti-aliasing detection (the pixelmatch
      algorithm), regions are clustered, then each region is classified by structural heuristics:
      displacement search, opacity fit, edge correlation. <a
      href="https://github.com/pisanuw/Claude-capstone/tree/main/ui-diff-lens">Source on GitHub</a>.</p>
    </footer>`;
  wire();
}

function wire(): void {
  root.querySelector('#sample')?.addEventListener('click', loadSample);
  root.querySelector('#swap')?.addEventListener('click', () => {
    [state.before, state.after] = [state.after, state.before];
    runIfReady();
    render();
  });
  root.querySelector('#export-html')?.addEventListener('click', exportHtml);
  root.querySelector('#export-png')?.addEventListener('click', () => void exportPng());

  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-file]')) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void loadFile(input.dataset.file as 'before' | 'after', file);
    });
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-clear]')) {
    btn.addEventListener('click', () => {
      state[btn.dataset.clear as 'before' | 'after'] = { bitmap: null, dataUrl: null, name: '' };
      state.result = null;
      render();
    });
  }
  for (const zone of root.querySelectorAll<HTMLElement>('[data-slot]')) {
    const which = zone.dataset.slot as 'before' | 'after';
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) void loadFile(which, file);
    });
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    btn.addEventListener('click', () => {
      const t = btn.dataset.toggle as ChangeType;
      if (state.hiddenTypes.has(t)) state.hiddenTypes.delete(t);
      else state.hiddenTypes.add(t);
      render();
    });
  }
  const selectRegion = (i: number): void => {
    state.selected = state.selected === i ? null : i;
    render();
    root.querySelector(`.region-item[data-region="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  for (const item of root.querySelectorAll<HTMLElement>('.region-item')) {
    item.addEventListener('click', () => selectRegion(Number(item.dataset.region)));
  }
  for (const g of root.querySelectorAll<SVGGElement>('svg g.region')) {
    g.addEventListener('click', () => selectRegion(Number(g.dataset.index)));
  }
}
