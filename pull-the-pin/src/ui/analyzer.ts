// Logic analyzer: one timing-diagram row per probed signal, with a cursor
// that picks the cycle the board shows.

import { Z } from '../core/sim';
import { button, clear, el, svg } from './dom';

export interface TraceRow {
  readonly label: string;
  readonly sub?: string;
  /** One value per cycle: 0, 1 or Z. */
  readonly values: ArrayLike<number>;
  readonly differs?: boolean;
  readonly onRemove?: () => void;
}

const ROW_H = 28;
const AXIS_H = 22;

export class Analyzer {
  readonly root: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly scroller: HTMLElement;

  constructor(private readonly onCursor: (cycle: number) => void) {
    this.labels = el('div', { class: 'la-labels' });
    // It scrolls sideways and holds nothing focusable: a named region the keyboard can reach and scroll.
    this.scroller = el('div', { class: 'la-scroll', tabindex: '0', role: 'region', 'aria-label': 'Captured waveforms' });
    this.root = el('div', { class: 'analyzer' }, this.labels, this.scroller);
  }

  render(rows: readonly TraceRow[], cycles: number, cursor: number, stepLabels?: readonly string[]): void {
    clear(this.labels);
    clear(this.scroller);
    if (!rows.length || !cycles) {
      this.root.classList.add('empty');
      this.labels.append(el('p', { class: 'muted' }, 'No signals on the analyzer yet.'));
      return;
    }
    this.root.classList.remove('empty');
    const px = Math.max(5, Math.min(16, Math.floor(900 / cycles)));
    const width = cycles * px + 4;
    const height = AXIS_H + rows.length * ROW_H;
    const s = svg('svg', { width: `${width}`, height: `${height}`, class: 'la-svg' });

    this.labels.append(el('div', { class: 'la-axis-label' }, stepLabels ? 'cycle / step' : 'cycle'));
    for (let c = 0; c < cycles; c++) {
      const x = c * px;
      if (c % 5 === 0) {
        s.append(svg('line', { x1: `${x}`, y1: `${AXIS_H - 6}`, x2: `${x}`, y2: `${height}`, class: 'la-grid' }));
        s.append(svg('text', { x: `${x + 2}`, y: '10', class: 'la-tick' }, `${c}`));
      }
      if (stepLabels && px >= 9) s.append(svg('text', { x: `${x + px / 2}`, y: '20', 'text-anchor': 'middle', class: 'la-step' }, stepLabels[c] ?? ''));
    }

    rows.forEach((row, r) => {
      const top = AXIS_H + r * ROW_H;
      const hi = top + 5;
      const lo = top + ROW_H - 6;
      const mid = (hi + lo) / 2;
      let d = '';
      const zSegs: string[] = [];
      for (let c = 0; c < cycles; c++) {
        const v = row.values[c];
        const x0 = c * px;
        const x1 = x0 + px;
        if (v === Z || v === undefined) {
          zSegs.push(`M${x0} ${mid}H${x1}`);
          d += `M${x1} ${mid}`;
          continue;
        }
        const y = v ? hi : lo;
        d += d ? `L${x0} ${y}H${x1}` : `M${x0} ${y}H${x1}`;
      }
      s.append(svg('path', { d, class: row.differs ? 'la-wave differs' : 'la-wave' }));
      if (zSegs.length) s.append(svg('path', { d: zSegs.join(''), class: 'la-z' }));
      const label = el('div', { class: row.differs ? 'la-label differs' : 'la-label' }, el('span', { class: 'mono' }, row.label));
      if (row.sub) label.append(el('span', { class: 'muted small' }, ` ${row.sub}`));
      if (row.onRemove) label.append(button('×', row.onRemove, 'icon'));
      this.labels.append(label);
    });

    const cx = cursor * px + px / 2;
    s.append(svg('line', { x1: `${cx}`, y1: '0', x2: `${cx}`, y2: `${height}`, class: 'la-cursor' }));
    const hit = svg('rect', { x: '0', y: '0', width: `${width}`, height: `${height}`, class: 'la-hit' });
    const pick = (e: MouseEvent) => {
      const box = (s as SVGSVGElement).getBoundingClientRect();
      const c = Math.floor((e.clientX - box.left) / px);
      this.onCursor(Math.max(0, Math.min(cycles - 1, c)));
    };
    hit.addEventListener('click', pick as EventListener);
    s.append(hit);
    this.scroller.append(s);
  }
}
