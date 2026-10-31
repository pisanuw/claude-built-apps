import { COLS, ROWS, type Board } from '../core/connect4';
import { s } from './dom';

const CELL = 48;

/** SVG board. `last` highlights a cell; `probs` draws the network's column probabilities above the board. */
export function boardSvg(b: Board, opts: { last?: number; probs?: number[] | null; marks?: number[]; label?: string } = {}): SVGSVGElement {
  const top = opts.probs ? 40 : 0;
  const svg = s('svg', { viewBox: `0 0 ${COLS * CELL} ${ROWS * CELL + top}`, class: 'board', role: 'img', 'aria-label': opts.label ?? describe(b) });
  if (opts.probs) {
    opts.probs.forEach((p, c) => {
      const hgt = Math.max(1, p * 30);
      svg.append(s('rect', { x: c * CELL + 8, y: 34 - hgt, width: CELL - 16, height: hgt, class: 'prob-bar' }));
      if (p >= 0.05) svg.append(s('text', { x: c * CELL + CELL / 2, y: 34 - hgt - 3, class: 'prob-label', 'text-anchor': 'middle' }, `${Math.round(p * 100)}`));
    });
  }
  svg.append(s('rect', { x: 0, y: top, width: COLS * CELL, height: ROWS * CELL, rx: 10, class: 'board-bg' }));
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const v = b.cells[idx];
      const cls = v === 1 ? 'disc p1' : v === 2 ? 'disc p2' : 'disc empty';
      const circle = s('circle', { cx: c * CELL + CELL / 2, cy: top + (ROWS - 1 - r) * CELL + CELL / 2, r: CELL / 2 - 5, class: cls + (opts.last === idx ? ' last' : '') });
      svg.append(circle);
    }
  for (const c of opts.marks ?? []) {
    const r = b.heights[c];
    if (r < ROWS) svg.append(s('circle', { cx: c * CELL + CELL / 2, cy: top + (ROWS - 1 - r) * CELL + CELL / 2, r: 8, class: 'mark' }));
  }
  return svg;
}

export function describe(b: Board): string {
  const cols: string[] = [];
  for (let c = 0; c < COLS; c++) {
    let col = '';
    for (let r = 0; r < b.heights[c]; r++) col += b.cells[r * COLS + c] === 1 ? 'X' : 'O';
    cols.push(`column ${c + 1}: ${col || 'empty'}`);
  }
  return `Connect Four board, bottom up. ${cols.join('; ')}.`;
}
