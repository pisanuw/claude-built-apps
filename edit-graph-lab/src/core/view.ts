// Pure helpers for the UI, kept here so they are unit tested.

import type { Snake } from './myers';
import { pathOf, type Point, type Script } from './script';

/** Short label for a token on a graph axis. */
export function label(tok: string, max = 14): string {
  const shown = tok.replace(/\t/g, '→').replace(/ /g, '·');
  if (shown === '') return '⏎';
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}

/** One sentence per snake explaining how step d reached its furthest point. */
export function explainSnake(s: Snake, a: readonly string[], b: readonly string[]): string {
  const slide = s.to.x - s.mid.x;
  const tail = slide === 0 ? 'no free diagonals' : `${slide} free diagonal${slide === 1 ? '' : 's'}`;
  if (s.d === 0) return `k = 0: start at (0,0), slide ${tail}, so V[0] = ${s.to.x}.`;
  const prevK = s.from.x - s.from.y;
  if (offGrid(s, a.length, b.length)) {
    return `k = ${s.k}: the chosen move from V[${prevK}] = ${s.from.x} leaves the grid, so V[${s.k}] = ${s.to.x} is recorded but can never reach the corner.`;
  }
  const move =
    s.mid.x > s.from.x
      ? `step right from V[${prevK}] = ${s.from.x}, deleting A[${s.from.x}] "${label(a[s.from.x] as string, 20)}"`
      : `step down from V[${prevK}] = ${s.from.x}, inserting B[${s.from.y}] "${label(b[s.from.y] as string, 20)}"`;
  return `k = ${s.k}: ${move}, then ${tail}, so V[${s.k}] = ${s.to.x}.`;
}

/** Lattice points covered by script ops [opStart, opEnd), for highlighting a hunk on the graph. */
export function segmentPoints(script: Script, opStart: number, opEnd: number): Point[] {
  return pathOf(script).slice(opStart, opEnd + 1);
}

/** How many step tones the stylesheet defines (--step-0 to --step-5, blue to orange, in each theme). */
export const STEP_TONES = 6;

/** The tone for edit count d out of total: 0 for d = 0, the last one for d = total. */
export function stepTone(d: number, total: number): number {
  return Math.round((Math.min(d, total) / Math.max(1, total)) * (STEP_TONES - 1));
}

/** Cell size for an N x M graph inside a box `room` pixels wide. */
export function cellSize(n: number, m: number, room: number): number {
  const side = Math.max(n, m, 1);
  return Math.max(4, Math.min(44, Math.floor(room / side)));
}

/** True when a snake's edit step left the N x M grid (possible in Myers; such paths are dead ends). */
export function offGrid(s: Snake, n: number, m: number): boolean {
  return s.mid.x > n || s.mid.y > m;
}
