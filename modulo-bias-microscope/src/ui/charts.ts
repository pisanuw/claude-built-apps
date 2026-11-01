import type { HistogramBar, PositionMatrix } from '../core/report';
import { h, s } from './dom';

export const MAX_BARS = 72;

/** Bars for the measured probability, a tick for the target, scaled to the larger of the two. */
export function histogram(bars: HistogramBar[], caption: string): HTMLElement {
  const shown = bars.length > MAX_BARS ? [...bars].sort((a, b) => dev(b) - dev(a)).slice(0, MAX_BARS) : bars;
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 8, t: 10, b: 46 };
  const max = Math.max(1e-12, ...shown.map((b) => Math.max(b.actual, b.target))) * 1.08;
  const bw = (W - pad.l - pad.r) / Math.max(1, shown.length);
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'histogram', role: 'img', 'aria-label': caption });
  for (const f of [0, 0.5, 1]) {
    const v = max * f;
    svg.append(
      s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: pad.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, pctLabel(v)),
    );
  }
  const labelEvery = Math.ceil(shown.length / 16);
  shown.forEach((b, i) => {
    const x = pad.l + i * bw;
    const over = b.actual > b.target + 1e-15;
    const under = b.actual < b.target - 1e-15;
    const cls = b.target === 0 ? 'bar alien' : over ? 'bar over' : under ? 'bar under' : 'bar';
    const bar = s('rect', { x: x + bw * 0.12, width: Math.max(1, bw * 0.76), y: y(b.actual), height: Math.max(0, y(0) - y(b.actual)), class: cls });
    bar.append(s('title', {}, `${b.key}: ${pctLabel(b.actual)} (target ${pctLabel(b.target)})`));
    svg.append(bar);
    if (b.target > 0) svg.append(s('line', { x1: x + 1, x2: x + bw - 1, y1: y(b.target), y2: y(b.target), class: 'target-tick' }));
    if (i % labelEvery === 0) {
      const lx = x + bw / 2;
      svg.append(
        s('text', { x: lx, y: H - pad.b + 14, class: 'axis', 'text-anchor': shown.length > 8 ? 'end' : 'middle', transform: shown.length > 8 ? `rotate(-35 ${lx} ${H - pad.b + 14})` : '' }, short(b.key)),
      );
    }
  });
  return h(
    'figure',
    { class: 'chart' },
    svg,
    h(
      'figcaption',
      {},
      h('span', { class: 'key over' }, 'above target'),
      h('span', { class: 'key under' }, 'below target'),
      h('span', { class: 'key tick' }, 'target'),
      bars.length > shown.length ? ` Showing the ${MAX_BARS} outcomes furthest from target of ${bars.length}.` : '',
    ),
  );
}

function dev(b: HistogramBar): number {
  return Math.abs(b.actual - b.target);
}

export function pctLabel(v: number): string {
  if (v === 0) return '0%';
  const p = v * 100;
  return p >= 10 ? `${p.toFixed(1)}%` : p >= 0.01 ? `${p.toFixed(2)}%` : `${p.toExponential(1)}%`;
}

function short(k: string): string {
  return k.length > 14 ? `${k.slice(0, 13)}…` : k;
}

/** Item × position grid; colour shows how far each cell is from the target share. */
export function heatmap(m: PositionMatrix): HTMLElement {
  const table = h('table', { class: 'heatmap' });
  const head = h('tr', {}, h('th', { scope: 'col' }, 'position'));
  for (const it of m.items) head.append(h('th', { scope: 'col' }, `item ${it}`));
  table.append(h('thead', {}, head));
  const body = h('tbody');
  m.cells.forEach((row, pos) => {
    const tr = h('tr', {}, h('th', { scope: 'row' }, String(pos)));
    row.forEach((p, i) => {
      const e = m.expected[pos][i];
      const rel = e > 0 ? (p - e) / e : p > 0 ? 1 : 0;
      const a = Math.min(1, Math.abs(rel) * 4);
      const style = rel === 0 ? '' : `background: color-mix(in srgb, var(${rel > 0 ? '--over' : '--under'}) ${Math.round(a * 70)}%, transparent)`;
      tr.append(h('td', { style, title: `P(item ${m.items[i]} at position ${pos}) = ${pctLabel(p)}, target ${pctLabel(e)}` }, pctLabel(p)));
    });
    body.append(tr);
  });
  table.append(body);
  return h(
    'figure',
    { class: 'chart' },
    h('div', { class: 'table-scroll' }, table),
    h('figcaption', {}, 'Where each item ends up. A fair shuffle is flat; warm cells are too likely, cool cells too rare.'),
  );
}
