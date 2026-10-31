/**
 * A rough material value from mobility: the average number of squares a
 * piece reaches from every square of an empty board, mapped onto a scale
 * where the chess knight (5.25 squares on 8x8) is about 3 pawns and the
 * queen (22.75) about 9. Move-only and capture-only rays count half, and a
 * piece confined to one square colour loses 15%. It is a heuristic, not a
 * measurement: it ignores how pieces work together and the board's shape.
 */
import { RayMode, WHITE, type CompiledPiece, type Geometry, type Ray } from './rules';

export const SLOPE = 0.34;
export const INTERCEPT = 1.2;

export function rayMobility(ray: Ray): number {
  const weight = ray.move && ray.capture ? 1 : 0.5;
  if (ray.mode === RayMode.Slide) return weight * Math.max(0, ray.path.length - ray.landFrom);
  if (ray.mode === RayMode.Jump) return weight * 0.5;
  return weight * 0.25 * Math.max(0, ray.path.length - 1);
}

/** Average empty-board mobility over the ordinary squares of the board. */
export function averageMobility(piece: CompiledPiece, geo: Geometry): number {
  let total = 0;
  let squares = 0;
  for (let sq = 0; sq < geo.size; sq++) {
    if (geo.isCitadel(sq)) continue;
    squares++;
    for (const ray of piece.rays[WHITE][sq]) total += rayMobility(ray);
  }
  return squares ? total / squares : 0;
}

/** True when every target keeps the same square colour as the start. */
export function colorBound(piece: CompiledPiece, geo: Geometry): boolean {
  let any = false;
  for (let sq = 0; sq < geo.size; sq++) {
    if (geo.isCitadel(sq)) continue;
    const parity = (geo.xs[sq] + geo.ys[sq]) & 1;
    for (const ray of piece.rays[WHITE][sq]) {
      const targets = ray.mode === RayMode.Slide ? ray.path.slice(ray.landFrom) : ray.mode === RayMode.Jump ? ray.path.slice(-1) : ray.path.slice(1);
      for (const t of targets) {
        if (geo.isCitadel(t)) continue;
        any = true;
        if (((geo.xs[t] + geo.ys[t]) & 1) !== parity) return false;
      }
    }
  }
  return any;
}

export function estimateValue(piece: CompiledPiece, geo: Geometry): number {
  if (piece.def.pawn) return 100;
  const mob = averageMobility(piece, geo);
  if (mob === 0) return 0;
  const pawns = (INTERCEPT + SLOPE * mob) * (colorBound(piece, geo) ? 0.85 : 1);
  return Math.round(pawns * 100);
}
