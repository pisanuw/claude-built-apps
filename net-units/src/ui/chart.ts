import { type AuthorKind } from '../core/analyze';
import { svg } from './dom';

export interface Point {
  id: string;
  label: string;
  kind: AuthorKind | 'hidden';
  x: number;
  y: number;
  /** 0..1, scales the marker (complexity or duplication overlay). */
  size: number;
  title: string;
}

export const KIND_VAR: Record<Point['kind'], string> = {
  reference: 'var(--k-reference)',
  student: 'var(--k-student)',
  ai: 'var(--k-ai)',
  unknown: 'var(--k-unknown)',
  hidden: 'var(--k-unknown)',
};

function niceStep(range: number): number {
  const raw = range / 5;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/** Size-vs-tests scatter. Returns the SVG; clicking a point calls `onPick`. */
export function scatter(
  points: Point[],
  opts: { xLabel: string; yMax: number; onPick: (id: string) => void },
): SVGElement {
  const W = 900;
  const H = 420;
  const m = { l: 52, r: 24, t: 18, b: 44 };
  const xs = points.map((p) => p.x);
  let x0 = Math.min(0, ...xs);
  let x1 = Math.max(1, ...xs);
  const step = niceStep(x1 - x0);
  x0 = Math.floor(x0 / step) * step;
  x1 = Math.ceil(x1 / step) * step;
  const yMax = Math.max(1, opts.yMax);
  const sx = (x: number): number => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number): number => H - m.b - (y / yMax) * (H - m.t - m.b);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    // A group, not an image: its points are buttons, and an image's children are not read (axe nested-interactive).
    role: 'group',
    'aria-label': `Scatter of ${opts.xLabel} against tests passed`,
  });
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    root.append(svg('line', { x1: `${sx(x)}`, x2: `${sx(x)}`, y1: `${m.t}`, y2: `${H - m.b}`, class: 'gl' }));
    root.append(svg('text', { x: `${sx(x)}`, y: `${H - m.b + 16}`, 'text-anchor': 'middle' }, `${Math.round(x)}`));
  }
  const yStep = Math.max(1, Math.ceil(yMax / 7));
  for (let y = 0; y <= yMax; y += yStep) {
    root.append(svg('line', { x1: `${m.l}`, x2: `${W - m.r}`, y1: `${sy(y)}`, y2: `${sy(y)}`, class: 'gl' }));
    root.append(svg('text', { x: `${m.l - 8}`, y: `${sy(y) + 4}`, 'text-anchor': 'end' }, `${y}`));
  }
  root.append(svg('line', { x1: `${m.l}`, x2: `${W - m.r}`, y1: `${H - m.b}`, y2: `${H - m.b}`, class: 'axis' }));
  root.append(svg('line', { x1: `${m.l}`, x2: `${m.l}`, y1: `${m.t}`, y2: `${H - m.b}`, class: 'axis' }));
  root.append(svg('text', { x: `${(m.l + W - m.r) / 2}`, y: `${H - 8}`, 'text-anchor': 'middle' }, opts.xLabel));
  root.append(
    svg(
      'text',
      { x: '14', y: `${(m.t + H - m.b) / 2}`, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` },
      'tests passed',
    ),
  );

  // Draw small markers last so a big one cannot hide them.
  const sorted = [...points].sort((a, b) => b.size - a.size);
  const placed: Array<[number, number]> = [];
  for (const p of sorted) {
    const cx = sx(p.x);
    const cy = sy(p.y);
    const r = 6 + p.size * 14;
    const c = svg('circle', {
      cx: `${cx}`,
      cy: `${cy}`,
      r: `${r}`,
      class: 'pt',
      fill: KIND_VAR[p.kind],
      'fill-opacity': '0.8',
      tabindex: '0',
      role: 'button',
      'aria-label': p.title,
    });
    c.append(svg('title', {}, p.title));
    c.addEventListener('click', () => opts.onPick(p.id));
    c.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        opts.onPick(p.id);
      }
    });
    root.append(c);
    // Nudge labels down when two points share a spot.
    let ly = cy + 4;
    while (placed.some(([px, py]) => Math.abs(px - cx) < 60 && Math.abs(py - ly) < 14)) ly += 14;
    placed.push([cx, ly]);
    const right = cx < W - 160;
    root.append(
      svg(
        'text',
        { x: `${right ? cx + r + 4 : cx - r - 4}`, y: `${ly}`, class: 'lbl', 'text-anchor': right ? 'start' : 'end' },
        p.label,
      ),
    );
  }
  return root;
}
