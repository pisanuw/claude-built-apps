/**
 * Strokes and how they are drawn under every tile.
 *
 * A stroke is folded into the fundamental triangle once, when it is made:
 * the isometry that carries its first point into the triangle is applied to
 * every point, and its parity is remembered. Drawing it under tile g then
 * means mapping each stored point through view ∘ g. Lines stay geodesic and
 * shapes shrink towards the rim because every map is a disk isometry.
 */
import { apply, type Iso, type Pt } from './iso';
import { distance, geodesicPath, pixelWidth } from './geometry';
import { fold, type Tile, type Tiling } from './tiling';

export type StrokeKind = 'free' | 'geodesic';
export type Symmetry = 'kaleidoscope' | 'rotation';

export interface Stroke {
  kind: StrokeKind;
  /** #rrggbb */
  color: string;
  /** Hyperbolic width (curvature −1 units). */
  width: number;
  /** Parity of the fold used to store it; picks the coset drawn in rotation mode. */
  parity: 0 | 1;
  /** Points in folded world coordinates. */
  points: Pt[];
}

export interface Doc {
  p: number;
  q: number;
  symmetry: Symmetry;
  strokes: Stroke[];
}

export interface Frame {
  /** Screen position of the disk centre. */
  ox: number;
  oy: number;
  /** Disk radius in pixels. */
  R: number;
}

/** Fold a world-space stroke into the fundamental triangle. */
export function makeStroke(T: Tiling, kind: StrokeKind, world: readonly Pt[], color: string, width: number): Stroke {
  if (world.length === 0) throw new Error('empty stroke');
  const f = fold(T, world[0][0], world[0][1]);
  const points = world.map((p) => apply(f.fold, p[0], p[1]) as Pt);
  return { kind, color, width, parity: f.parity, points };
}

export interface StrokeInfo {
  anchor: Pt;
  /** Largest hyperbolic distance from the anchor to any point. */
  extent: number;
}

const infoCache = new WeakMap<Stroke, StrokeInfo>();

export function strokeInfo(s: Stroke): StrokeInfo {
  const hit = infoCache.get(s);
  if (hit) return hit;
  const anchor = s.points[Math.floor(s.points.length / 2)];
  let extent = 0;
  for (const p of s.points) extent = Math.max(extent, distance(anchor, p));
  const info = { anchor, extent };
  infoCache.set(s, info);
  return info;
}

/** Minimal drawing surface shared by the canvas and the SVG exporter. */
export interface Sink {
  begin(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  /** Arc of a circle from the current point to (x, y); canvas angle conventions. */
  arc(cx: number, cy: number, r: number, start: number, end: number, ccw: boolean, x: number, y: number): void;
  close(): void;
  fill(color: string): void;
  stroke(color: string, width: number): void;
}

export function toScreen(F: Frame, z: Pt): [number, number] {
  return [F.ox + F.R * z[0], F.oy - F.R * z[1]];
}

/** Append the geodesic from screen point a to screen point b. */
export function geodesicTo(sink: Sink, F: Frame, a: Pt, b: Pt): void {
  const g = geodesicPath(a[0], a[1], b[0], b[1], F.ox, F.oy, F.R);
  if (g.kind === 'line') sink.lineTo(b[0], b[1]);
  else sink.arc(g.cx, g.cy, g.r, g.start, g.end, g.ccw, b[0], b[1]);
}

export interface TileStyle {
  shading: boolean;
  /** Draw the two mirrors through the polygon centre (kaleidoscope lines). */
  mirrors: boolean;
  edges: boolean;
  shade: string;
  edge: string;
  mirror: string;
}

function tileCorners(T: Tiling, F: Frame, t: Iso): [Pt, Pt, Pt] {
  const [a, b, c] = T.corners.map((k) => toScreen(F, apply(t, k[0], k[1])));
  return [a, b, c];
}

/** Below this on-screen size a tile's sides are drawn as chords: the arcs would look identical. */
export const CHORD_PX = 8;
const FILL_BATCH = 64;

/** Shade alternate triangles and draw polygon edges and mirror lines. */
export function drawTiles(sink: Sink, T: Tiling, tiles: readonly Tile[], F: Frame, style: TileStyle): void {
  const minPx = 0.6;
  const visible = tiles.filter((t) => t.size * F.R >= minPx);
  const corners = visible.map((t) => tileCorners(T, F, t.t));
  const side = (i: number, a: Pt, b: Pt): void => {
    if (visible[i].size * F.R < CHORD_PX) sink.lineTo(b[0], b[1]);
    else geodesicTo(sink, F, a, b);
  };
  if (style.shading) {
    // Rasterisers slow down badly on one path with thousands of contours, so
    // fill in modest batches.
    let batch = 0;
    sink.begin();
    visible.forEach((t, i) => {
      if (t.parity !== 1) return;
      if (++batch % FILL_BATCH === 0) {
        sink.fill(style.shade);
        sink.begin();
      }
      const [o, m, v] = corners[i];
      sink.moveTo(o[0], o[1]);
      side(i, o, m);
      side(i, m, v);
      side(i, v, o);
      sink.close();
    });
    sink.fill(style.shade);
  }
  if (style.mirrors) {
    sink.begin();
    corners.forEach(([o, m, v], i) => {
      sink.moveTo(m[0], m[1]);
      side(i, m, o);
      side(i, o, v);
    });
    sink.stroke(style.mirror, 0.6);
  }
  if (style.edges) {
    sink.begin();
    corners.forEach(([, m, v], i) => {
      sink.moveTo(m[0], m[1]);
      side(i, m, v);
    });
    sink.stroke(style.edge, 1);
  }
}

/** Tiles a stroke should appear in under the chosen symmetry. */
export function tileMatches(tile: Tile, stroke: Stroke, symmetry: Symmetry): boolean {
  return symmetry === 'kaleidoscope' || tile.parity === stroke.parity;
}

export interface Copy {
  t: Iso;
  /** Line width in pixels. */
  width: number;
  /** Rough on-screen size of the copy in pixels. */
  extentPx: number;
}

/**
 * Where (and how wide) a stroke's copy under transform t lands, or null when
 * it would be smaller than a pixel. Width follows the disk metric at the
 * stroke's anchor, so copies thin out towards the rim.
 */
export function placeCopy(stroke: Stroke, t: Iso, F: Frame): Copy | null {
  const info = strokeInfo(stroke);
  const a = apply(t, info.anchor[0], info.anchor[1]);
  const raw = pixelWidth(stroke.width, a, F.R);
  const extentPx = (info.extent * F.R * (1 - (a[0] * a[0] + a[1] * a[1]))) / 2;
  // Long strokes reach well past their anchor's neighbourhood; never cull those on size.
  if (info.extent < 3 && extentPx + raw < 0.75) return null;
  return { t, width: Math.max(0.35, raw), extentPx };
}

/** Append one copy's path; small copies keep only every k-th point. */
function traceCopy(sink: Sink, stroke: Stroke, c: Copy, F: Frame): void {
  const pts = stroke.points;
  const first = toScreen(F, apply(c.t, pts[0][0], pts[0][1]));
  sink.moveTo(first[0], first[1]);
  if (pts.length === 1) {
    sink.lineTo(first[0] + 0.01, first[1]);
    return;
  }
  if (stroke.kind === 'geodesic') {
    let prev = first;
    for (let i = 1; i < pts.length; i++) {
      const next = toScreen(F, apply(c.t, pts[i][0], pts[i][1]));
      geodesicTo(sink, F, prev, next);
      prev = next;
    }
    return;
  }
  const keep = Math.max(4, Math.ceil(c.extentPx / 1.5));
  const step = Math.max(1, Math.floor(pts.length / keep));
  for (let i = step; i < pts.length; i += step) {
    const q = toScreen(F, apply(c.t, pts[i][0], pts[i][1]));
    sink.lineTo(q[0], q[1]);
  }
  if ((pts.length - 1) % step !== 0) {
    const q = toScreen(F, apply(c.t, pts[pts.length - 1][0], pts[pts.length - 1][1]));
    sink.lineTo(q[0], q[1]);
  }
}

/** Draw one stroke under one transform (live preview). Returns false when culled. */
export function drawStrokeInTile(sink: Sink, stroke: Stroke, tile: Tile, F: Frame): boolean {
  const c = placeCopy(stroke, tile.t, F);
  if (!c) return false;
  sink.begin();
  traceCopy(sink, stroke, c, F);
  sink.stroke(stroke.color, c.width);
  return true;
}

/** Widths are rounded to these steps so copies can share one stroke call. */
export function widthBucket(w: number): number {
  if (w < 2) return Math.round(w * 8) / 8;
  if (w < 8) return Math.round(w * 2) / 2;
  return Math.round(w);
}

const STROKE_BATCH = 64;

/** Smallest tile (px) whose stroke copies are worth drawing. */
const MIN_TILE_PX = 1;

/** Draw every stroke under every matching tile; returns the number of copies drawn. */
export function drawStrokes(sink: Sink, strokes: readonly Stroke[], tiles: readonly Tile[], F: Frame, symmetry: Symmetry): number {
  let drawn = 0;
  for (const s of strokes) {
    const buckets = new Map<number, Copy[]>();
    for (const tile of tiles) {
      if (tile.size * F.R < MIN_TILE_PX || !tileMatches(tile, s, symmetry)) continue;
      const c = placeCopy(s, tile.t, F);
      if (!c) continue;
      const w = widthBucket(c.width);
      const list = buckets.get(w);
      if (list) list.push(c);
      else buckets.set(w, [c]);
    }
    for (const [w, copies] of buckets) {
      for (let i = 0; i < copies.length; i += STROKE_BATCH) {
        sink.begin();
        for (const c of copies.slice(i, i + STROKE_BATCH)) traceCopy(sink, s, c, F);
        sink.stroke(s.color, w);
      }
      drawn += copies.length;
    }
  }
  return drawn;
}

export function validColor(c: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(c);
}
