/**
 * The {p,q} tiling as a reflection group.
 *
 * A regular hyperbolic p-gon with interior angle 2π/q, centred at the origin,
 * splits into 2p copies of a right triangle with angles π/p (at the origin),
 * π/q (at a polygon vertex) and π/2 (at an edge midpoint). The three mirrors
 * of that triangle generate the whole tiling:
 *   mirror 0: the real axis
 *   mirror 1: the line through the origin at angle π/p
 *   mirror 2: the circle (orthogonal to the unit circle) carrying the polygon edge
 * Every tile is g(F) for some word g in the three reflections.
 */
import { IDENTITY, apply, compose, inverse, normalize, type Iso, type Pt } from './iso';

export interface Tiling {
  p: number;
  q: number;
  /** Euclidean distance from the origin to an edge midpoint. */
  mid: number;
  /** The polygon vertex of the fundamental triangle. */
  vertex: Pt;
  /** Edge circle: centre (c, 0), radius r, with c² = 1 + r². */
  circle: { c: number; r: number };
  mirrors: [Iso, Iso, Iso];
  /** Triangle corners: origin, edge midpoint, polygon vertex. */
  corners: [Pt, Pt, Pt];
  /** A point safely inside the fundamental triangle, used to tell tiles apart. */
  probe: Pt;
}

export interface Tile {
  /** The group element in world coordinates. */
  g: Iso;
  /** view ∘ g: where this tile lands on screen (in disk coordinates). */
  t: Iso;
  /** Word length mod 2: 0 for rotations, 1 for reflections. */
  parity: 0 | 1;
  depth: number;
  /** Rough Euclidean size of the tile on screen, in disk units. */
  size: number;
}

export function isHyperbolic(p: number, q: number): boolean {
  return Number.isInteger(p) && Number.isInteger(q) && p >= 3 && q >= 3 && (p - 2) * (q - 2) > 4;
}

export function makeTiling(p: number, q: number): Tiling {
  if (!isHyperbolic(p, q)) throw new Error(`{${p},${q}} is not a hyperbolic tiling: need (p−2)(q−2) > 4`);
  const theta = Math.PI / p;
  // Hyperbolic distance from centre to edge midpoint: cosh d = cos(π/q) / sin(π/p).
  const dMid = Math.acosh(Math.cos(Math.PI / q) / Math.sin(theta));
  const mid = Math.tanh(dMid / 2);
  const c = (1 + mid * mid) / (2 * mid);
  const r = c - mid;
  // Vertex: the ray at angle θ meets the edge circle at t² − 2tc cos θ + 1 = 0.
  const t = c * Math.cos(theta) - Math.sqrt(c * c * Math.cos(theta) ** 2 - 1);
  const vertex: Pt = [t * Math.cos(theta), t * Math.sin(theta)];
  const s = Math.sqrt(c * c - 1);
  const mirrors: [Iso, Iso, Iso] = [
    { ar: 1, ai: 0, br: 0, bi: 0, conj: true },
    { ar: Math.cos(theta), ai: Math.sin(theta), br: 0, bi: 0, conj: true },
    // z ↦ (c z̄ − 1)/(z̄ − c), scaled by i/s into SU(1,1) form.
    normalize({ ar: 0, ai: c / s, br: 0, bi: -1 / s, conj: true }),
  ];
  const probe: Pt = [0.45 * mid * Math.cos(theta / 3), 0.45 * mid * Math.sin(theta / 3)];
  return { p, q, mid, vertex, circle: { c, r }, mirrors, corners: [[0, 0], [mid, 0], vertex], probe };
}

/** Which mirror (if any) separates (x, y) from the fundamental triangle. */
function violated(T: Tiling, x: number, y: number): -1 | 0 | 1 | 2 {
  const eps = 1e-12;
  if (y < -eps) return 0;
  const theta = Math.PI / T.p;
  if (Math.sin(theta) * x - Math.cos(theta) * y < -eps) return 1;
  const dx = x - T.circle.c;
  if (dx * dx + y * y < T.circle.r * T.circle.r - eps) return 2;
  return -1;
}

export function inFundamental(T: Tiling, x: number, y: number): boolean {
  return violated(T, x, y) === -1;
}

export interface Fold {
  /** The folded point, inside the fundamental triangle. */
  point: Pt;
  /** The isometry F with F(original) = point. */
  fold: Iso;
  /** Mirrors applied, in order. */
  word: number[];
  parity: 0 | 1;
}

/**
 * Reflect (x, y) into the fundamental triangle, recording the mirrors used.
 * Each reflection either moves the point into the wedge or strictly towards
 * the origin, so this terminates; the cap guards against points pinned to
 * the boundary circle by rounding.
 */
export function fold(T: Tiling, x: number, y: number, maxSteps = 2000): Fold {
  let px = x;
  let py = y;
  let F: Iso = IDENTITY;
  const word: number[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const m = violated(T, px, py);
    if (m === -1) break;
    const mirror = T.mirrors[m];
    [px, py] = apply(mirror, px, py);
    F = compose(mirror, F);
    word.push(m);
  }
  return { point: [px, py], fold: F, word, parity: (word.length % 2) as 0 | 1 };
}

export interface GenerateOptions {
  /** Maximum number of mirror steps away from the centre tile. */
  maxDepth: number;
  /** Stop expanding tiles smaller than this on screen (disk units). */
  minSize: number;
  /** Hard cap on the number of tiles returned. */
  maxTiles: number;
}

export const DEFAULT_GENERATE: GenerateOptions = { maxDepth: 40, minSize: 0.004, maxTiles: 30000 };

function tileSize(t: Iso, T: Tiling): number {
  const a = apply(t, T.corners[0][0], T.corners[0][1]);
  const b = apply(t, T.corners[1][0], T.corners[1][1]);
  const c = apply(t, T.corners[2][0], T.corners[2][1]);
  return Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
}

/**
 * Breadth-first walk of the reflection group, starting from the tile under
 * the centre of the view and stepping across one mirror at a time. Tiles are
 * identified by where they send an interior probe point (in view space,
 * where on-screen tiles are well away from the boundary and so precise).
 */
export function generateTiles(T: Tiling, view: Iso, opts: Partial<GenerateOptions> = {}): Tile[] {
  const o = { ...DEFAULT_GENERATE, ...opts };
  const centre = apply(inverse(view), 0, 0);
  const f = fold(T, centre[0], centre[1]);
  const g0 = inverse(f.fold);
  const seen = new Set<string>();
  const out: Tile[] = [];
  const key = (t: Iso): string => {
    const [x, y] = apply(t, T.probe[0], T.probe[1]);
    return `${Math.round(x * 1e7)},${Math.round(y * 1e7)}`;
  };
  const t0 = compose(view, g0);
  const start: Tile = { g: g0, t: t0, parity: f.parity, depth: 0, size: tileSize(t0, T) };
  seen.add(key(t0));
  let frontier: Tile[] = [start];
  out.push(start);
  for (let depth = 1; depth <= o.maxDepth && frontier.length > 0 && out.length < o.maxTiles; depth++) {
    const next: Tile[] = [];
    for (const tile of frontier) {
      if (tile.size < o.minSize) continue;
      for (const m of T.mirrors) {
        const g = compose(tile.g, m);
        const t = compose(view, g);
        const k = key(t);
        if (seen.has(k)) continue;
        seen.add(k);
        const size = tileSize(t, T);
        const nt: Tile = { g, t, parity: (1 - tile.parity) as 0 | 1, depth, size };
        out.push(nt);
        next.push(nt);
        if (out.length >= o.maxTiles) break;
      }
      if (out.length >= o.maxTiles) break;
    }
    frontier = next;
  }
  return out;
}

/**
 * An orientation-preserving group element whose tile contains the view
 * centre. Composing the view with it changes nothing on screen (strokes are
 * replicated over the whole group) but keeps the view matrix small.
 */
export function rebaseElement(T: Tiling, view: Iso): Iso {
  const centre = apply(inverse(view), 0, 0);
  const f = fold(T, centre[0], centre[1]);
  let g = inverse(f.fold);
  if (f.parity === 1) g = compose(g, T.mirrors[0]);
  return g;
}

/** Facts about the tiling for the explainer panel. */
export function tilingFacts(T: Tiling): {
  triangleAngleSum: number;
  triangleArea: number;
  polygonAngle: number;
  polygonArea: number;
  edgeLength: number;
  circumradius: number;
  inradius: number;
} {
  const { p, q } = T;
  const triangleAngleSum = Math.PI / p + Math.PI / q + Math.PI / 2;
  const inradius = Math.acosh(Math.cos(Math.PI / q) / Math.sin(Math.PI / p));
  const circumradius = Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q)));
  // Half an edge: cosh(e/2) = cos(π/p) / sin(π/q).
  const edgeLength = 2 * Math.acosh(Math.cos(Math.PI / p) / Math.sin(Math.PI / q));
  return {
    triangleAngleSum,
    triangleArea: Math.PI - triangleAngleSum,
    polygonAngle: (2 * Math.PI) / q,
    polygonArea: (p - 2) * Math.PI - (p * 2 * Math.PI) / q,
    edgeLength,
    circumradius,
    inradius,
  };
}
