/** Tile coordinates: x grows to the right, y grows downward (screen order). */
export interface Vec {
  x: number;
  y: number;
}

export type Dir = 'up' | 'left' | 'down' | 'right';

/** The arcade tie-break order: when two exits are equally close, up wins, then left, then down. */
export const DIR_ORDER: readonly Dir[] = ['up', 'left', 'down', 'right'];

export const DELTA: Readonly<Record<Dir, Vec>> = {
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
};

export const REVERSE: Readonly<Record<Dir, Dir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export const ARROW: Readonly<Record<Dir, string>> = { up: '↑', left: '←', down: '↓', right: '→' };

export function vec(x: number, y: number): Vec {
  return { x, y };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k };
}

export function eq(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Squared straight-line distance: the arcade compares these, never square roots. */
export function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function fmt(v: Vec): string {
  return `(${v.x}, ${v.y})`;
}
