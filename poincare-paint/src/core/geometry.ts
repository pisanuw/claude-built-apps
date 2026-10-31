/**
 * Hyperbolic measurement and geodesic drawing in the Poincaré disk.
 */
import { apply, translation, type Pt } from './iso';

/** Hyperbolic distance: d(z, w) = 2 artanh |z − w| / |1 − z̄ w|. */
export function distance(a: Pt, b: Pt): number {
  const nx = a[0] - b[0];
  const ny = a[1] - b[1];
  // 1 − ā b
  const dx = 1 - (a[0] * b[0] + a[1] * b[1]);
  const dy = -(a[0] * b[1] - a[1] * b[0]);
  const r = Math.hypot(nx, ny) / Math.hypot(dx, dy);
  return 2 * Math.atanh(Math.min(r, 1 - 1e-16));
}

/** Distance from the origin, which grows without bound as |z| → 1. */
export function distanceFromOrigin(z: Pt): number {
  return distance([0, 0], z);
}

/** Euclidean radius for a given hyperbolic distance from the origin. */
export function radiusForDistance(d: number): number {
  return Math.tanh(d / 2);
}

/**
 * The interior angle at a of the geodesic triangle a, b, c. Moving a to the
 * origin turns the two sides through it into straight diameters, so the
 * angle is just the Euclidean angle between the moved b and c.
 */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const m = translation(-a[0], -a[1]);
  const [bx, by] = apply(m, b[0], b[1]);
  const [cx, cy] = apply(m, c[0], c[1]);
  const t = Math.abs(Math.atan2(bx * cy - by * cx, bx * cx + by * cy));
  return t;
}

export interface TriangleMeasure {
  sides: [number, number, number];
  angles: [number, number, number];
  angleSum: number;
  /** Area = π − angle sum (Gauss–Bonnet, curvature −1). */
  area: number;
}

export function measureTriangle(a: Pt, b: Pt, c: Pt): TriangleMeasure {
  const angles: [number, number, number] = [angleAt(a, b, c), angleAt(b, c, a), angleAt(c, a, b)];
  const angleSum = angles[0] + angles[1] + angles[2];
  return {
    sides: [distance(b, c), distance(c, a), distance(a, b)],
    angles,
    angleSum,
    area: Math.max(0, Math.PI - angleSum),
  };
}

/** The point at fraction t along the geodesic from a to b. */
export function geodesicLerp(a: Pt, b: Pt, t: number): [number, number] {
  const toO = translation(-a[0], -a[1]);
  const [wx, wy] = apply(toO, b[0], b[1]);
  const r = Math.hypot(wx, wy);
  if (r < 1e-15) return [a[0], a[1]];
  const d = 2 * Math.atanh(Math.min(r, 1 - 1e-16));
  const rr = Math.tanh((t * d) / 2);
  const back = translation(a[0], a[1]);
  return apply(back, (wx / r) * rr, (wy / r) * rr);
}

/** Pixel width for a stroke of hyperbolic width h drawn at z on a disk of radius R px. */
export function pixelWidth(h: number, z: Pt, R: number): number {
  return (h * R * (1 - (z[0] * z[0] + z[1] * z[1]))) / 2;
}

/** Hyperbolic width for a stroke drawn px pixels wide at z. */
export function hyperbolicWidth(px: number, z: Pt, R: number): number {
  return (2 * px) / (R * Math.max(1e-12, 1 - (z[0] * z[0] + z[1] * z[1])));
}

export type GeodesicPath =
  | { kind: 'line' }
  | { kind: 'arc'; cx: number; cy: number; r: number; start: number; end: number; ccw: boolean };

/**
 * The geodesic from a to b in any coordinates where the boundary circle is
 * centred at (ox, oy) with radius R (screen pixels, or the unit disk with
 * R = 1). Geodesics are diameters or arcs of circles orthogonal to the
 * boundary; we return the arc as canvas-style start/end angles plus a
 * direction (ccw = true means decreasing angle, as in CanvasRenderingContext2D.arc).
 */
export function geodesicPath(ax: number, ay: number, bx: number, by: number, ox = 0, oy = 0, R = 1): GeodesicPath {
  // Work in unit-disk coordinates (orientation is preserved by the affine map
  // only if R > 0; a y-flip is handled by computing angles in caller space).
  const ux = (ax - ox) / R;
  const uy = (ay - oy) / R;
  const vx = (bx - ox) / R;
  const vy = (by - oy) / R;
  const det = ux * vy - uy * vx;
  const chord = Math.hypot(ux - vx, uy - vy);
  if (Math.abs(det) < 1e-9 * Math.max(chord, 1e-12) || chord < 1e-12) return { kind: 'line' };
  // Centre o satisfies o·u = (|u|² + 1)/2 and o·v = (|v|² + 1)/2.
  const ku = (ux * ux + uy * uy + 1) / 2;
  const kv = (vx * vx + vy * vy + 1) / 2;
  const cx = (ku * vy - uy * kv) / det;
  const cy = (ux * kv - ku * vx) / det;
  const r = Math.hypot(ux - cx, uy - cy);
  if (r > 1e5) return { kind: 'line' };
  const start = Math.atan2(uy - cy, ux - cx);
  const end = Math.atan2(vy - cy, vx - cx);
  let sweep = end - start;
  while (sweep < 0) sweep += 2 * Math.PI;
  while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
  // The part of an orthogonal circle inside the disk is its minor arc.
  return { kind: 'arc', cx: ox + cx * R, cy: oy + cy * R, r: r * R, start, end, ccw: sweep > Math.PI };
}
