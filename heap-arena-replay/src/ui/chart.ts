// Small SVG line chart for per-step metrics, with a step marker and click-to-seek.

const NS = 'http://www.w3.org/2000/svg';

export interface Series {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export interface ChartOptions {
  /** The chart's accessible name (it is an image to assistive technology). */
  label?: string;
  yMax?: number;
  /** Format for axis labels and the legend readout. */
  format?: (v: number) => string;
  marker?: number;
  onSeek?: (step: number) => void;
  height?: number;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderChart(series: Series[], opts: ChartOptions = {}): SVGSVGElement {
  const W = 600;
  const H = opts.height ?? 160;
  const L = 42;
  const R = 8;
  const T = 8;
  const B = 22;
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const yMax = opts.yMax ?? Math.max(1e-9, ...series.flatMap((s) => s.values));
  const fmt = opts.format ?? ((v: number) => v.toFixed(2));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opts.label ?? 'Chart' });
  const x = (i: number) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  for (let k = 0; k <= 4; k += 1) {
    const v = (yMax * k) / 4;
    svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gridline' }));
    svg.appendChild(el('text', { x: L - 4, y: y(v) + 3, class: 'tick', 'text-anchor': 'end' }, fmt(v)));
  }
  svg.appendChild(el('text', { x: L, y: H - 6, class: 'tick' }, 'op 1'));
  svg.appendChild(el('text', { x: W - R, y: H - 6, class: 'tick', 'text-anchor': 'end' }, `op ${n}`));
  for (const s of series) {
    if (s.values.length === 0) continue;
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const p = el('path', { d, class: 'series' });
    // A style, not the stroke attribute: the colour can be a var(--series-n) token.
    p.style.stroke = s.color;
    if (s.dashed) p.setAttribute('stroke-dasharray', '4 3');
    p.appendChild(el('title', {}, s.label));
    svg.appendChild(p);
  }
  if (opts.marker !== undefined && opts.marker >= 0 && opts.marker < n) {
    const mx = x(opts.marker);
    svg.appendChild(el('line', { x1: mx, x2: mx, y1: T, y2: H - B, class: 'marker' }));
  }
  if (opts.onSeek) {
    svg.classList.add('seekable');
    svg.addEventListener('click', (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
      opts.onSeek!(Math.max(0, Math.min(n - 1, i)));
    });
  }
  return svg;
}

export function legend(series: Series[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'legend';
  for (const s of series) {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.background = s.color;
    if (s.dashed) sw.classList.add('dashed');
    item.append(sw, s.label);
    div.appendChild(item);
  }
  return div;
}
