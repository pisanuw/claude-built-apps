/**
 * Board geometry and the compiled move tables. Each piece's notation is
 * turned, once per variant, into rays: for every colour and square, a list
 * of square paths with a small amount of semantics (slide, jump, hop). The
 * move generator, the attack test, the lab overlay and the engine all walk
 * the same rays.
 */
import { filterVectors, leapPath, outward, parseNotation, type Rule, type Vec } from './notation';
import type { PieceDef, VariantDef } from './variants';

export type Color = 0 | 1;
export const WHITE: Color = 0;
export const BLACK: Color = 1;

export const enum RayMode {
  /** Walk the path; squares before landFrom must be empty; stop at the first piece. */
  Slide = 0,
  /** Only the last square is a target; at least one earlier square must be occupied. */
  Jump = 1,
  /** Skip empties, jump exactly one piece, then move to empties or capture the next piece. */
  Hop = 2,
}

export interface Ray {
  path: number[];
  landFrom: number;
  mode: RayMode;
  move: boolean;
  capture: boolean;
}

export class Geometry {
  readonly size: number;
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  /** -1 for ordinary squares, else the colour that owns the citadel. */
  readonly citadelOwner: number[] = [];
  private readonly extra = new Map<string, number>();

  constructor(
    readonly width: number,
    readonly height: number,
    citadels: boolean,
  ) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.xs.push(x);
        this.ys.push(y);
        this.citadelOwner.push(-1);
      }
    }
    if (citadels) {
      this.addExtra(width, 1, WHITE);
      this.addExtra(-1, height - 2, BLACK);
    }
    this.size = this.xs.length;
  }

  private addExtra(x: number, y: number, owner: Color): void {
    this.extra.set(`${x},${y}`, this.xs.length);
    this.xs.push(x);
    this.ys.push(y);
    this.citadelOwner.push(owner);
  }

  at(x: number, y: number): number {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) return y * this.width + x;
    return this.extra.get(`${x},${y}`) ?? -1;
  }

  citadelOf(color: Color): number {
    return this.citadelOwner.indexOf(color);
  }

  isCitadel(sq: number): boolean {
    return this.citadelOwner[sq] !== -1;
  }

  name(sq: number): string {
    if (this.isCitadel(sq)) return this.citadelOwner[sq] === WHITE ? 'White citadel' : 'Black citadel';
    return `${String.fromCharCode(97 + this.xs[sq])}${this.ys[sq] + 1}`;
  }

  parse(name: string): number {
    const m = /^([a-z])(\d{1,2})$/.exec(name.trim().toLowerCase());
    if (!m) return -1;
    return this.at(m[1].charCodeAt(0) - 97, Number(m[2]) - 1);
  }

  /** Rank counted from the given side's own edge (0 = home rank). */
  relRank(sq: number, color: Color): number {
    return color === WHITE ? this.ys[sq] : this.height - 1 - this.ys[sq];
  }
}

export interface CompiledPiece {
  def: PieceDef;
  index: number;
  rules: Rule[];
  /** rays[color][square] */
  rays: Ray[][][];
  promoteTo: number;
}

/**
 * Build the rays one piece has from one square. `initialRanks` are the
 * relative ranks the piece starts on, used by the 'i' modifier.
 */
export function buildRays(
  geo: Geometry,
  rules: Rule[],
  sq: number,
  color: Color,
  royal: boolean,
  initialRanks: ReadonlySet<number>,
): Ray[] {
  const out: Ray[] = [];
  const fs = color === WHITE ? 1 : -1;
  const x0 = geo.xs[sq];
  const y0 = geo.ys[sq];
  const enter = (x: number, y: number): number => {
    const t = geo.at(x, y);
    if (t < 0) return -1;
    const owner = geo.citadelOwner[t];
    if (owner === -1) return t;
    return royal && owner !== color ? t : -1;
  };
  const passable = (x: number, y: number): number => {
    const t = geo.at(x, y);
    return t >= 0 && !geo.isCitadel(t) ? t : -1;
  };
  for (const rule of rules) {
    if (rule.initial && !initialRanks.has(geo.relRank(sq, color))) continue;
    const first = rule.legs[0];
    const firstVecs = filterVectors(rule, first.vectors, fs);
    if (rule.legs.length === 2) {
      const second = rule.legs[1];
      for (const v1 of firstVecs) {
        const gx = x0 + v1[0];
        const gy = y0 + v1[1];
        const gate = passable(gx, gy);
        if (gate < 0) continue;
        for (const v2 of outward(v1, second.vectors)) {
          const path = [gate];
          for (let k = 1; k <= second.max; k++) {
            const t = enter(gx + v2[0] * k, gy + v2[1] * k);
            if (t < 0) break;
            path.push(t);
            if (geo.isCitadel(t)) break;
          }
          if (path.length - 1 >= second.min) {
            out.push({ path, landFrom: second.min, mode: RayMode.Slide, move: rule.move, capture: rule.capture });
          }
        }
      }
      continue;
    }
    for (const v of firstVecs) {
      if (first.max === 1 && first.min === 1) {
        const t = enter(x0 + v[0], y0 + v[1]);
        if (t < 0) continue;
        if (rule.lame || rule.jump) {
          const mids = leapPath(v as Vec).map(([dx, dy]) => passable(x0 + dx, y0 + dy));
          if (rule.lame && mids.some((m) => m < 0)) continue;
          const valid = mids.filter((m) => m >= 0);
          if (rule.jump && valid.length === 0) continue;
          out.push({
            path: [...valid, t],
            landFrom: valid.length,
            mode: rule.jump ? RayMode.Jump : RayMode.Slide,
            move: rule.move,
            capture: rule.capture,
          });
        } else {
          out.push({ path: [t], landFrom: 0, mode: RayMode.Slide, move: rule.move, capture: rule.capture });
        }
        continue;
      }
      const path: number[] = [];
      for (let k = 1; k <= first.max; k++) {
        const t = enter(x0 + v[0] * k, y0 + v[1] * k);
        if (t < 0) break;
        path.push(t);
        if (geo.isCitadel(t)) break;
      }
      if (rule.hop) {
        if (path.length >= 2) out.push({ path, landFrom: 0, mode: RayMode.Hop, move: rule.move, capture: rule.capture });
      } else if (path.length >= first.min) {
        out.push({ path, landFrom: first.min - 1, mode: RayMode.Slide, move: rule.move, capture: rule.capture });
      }
    }
  }
  return out;
}

export function initialRanksOf(v: VariantDef, geo: Geometry, pieceId: string): Set<number> {
  const s = new Set<number>();
  for (const p of v.setup) {
    if (p.piece !== pieceId) continue;
    const sq = geo.parse(p.sq);
    if (sq >= 0) s.add(geo.relRank(sq, WHITE));
  }
  return s;
}

export function compilePieces(v: VariantDef, geo: Geometry): CompiledPiece[] {
  const pieces = v.pieces.map((def, index) => ({ def, index, rules: parseNotation(def.notation), rays: [[], []] as Ray[][][], promoteTo: -1 }));
  for (const p of pieces) {
    const ranks = initialRanksOf(v, geo, p.def.id);
    for (const color of [WHITE, BLACK]) {
      for (let sq = 0; sq < geo.size; sq++) {
        p.rays[color][sq] = geo.isCitadel(sq) ? [] : buildRays(geo, p.rules, sq, color, !!p.def.royal, ranks);
      }
    }
    if (p.def.promotesTo) {
      p.promoteTo = pieces.findIndex((q) => q.def.id === p.def.promotesTo);
    }
  }
  return pieces;
}

/**
 * Targets of every ray from one square on a board given by `occupant`
 * (returns null for empty, else the colour of the piece there).
 */
export function rayTargets(
  rays: Ray[],
  occupant: (sq: number) => Color | null,
  color: Color,
): { moves: number[]; captures: number[] } {
  const moves: number[] = [];
  const captures: number[] = [];
  for (const ray of rays) walkRay(ray, occupant, color, moves, captures);
  return { moves, captures };
}

export function walkRay(ray: Ray, occupant: (sq: number) => Color | null, color: Color, moves: number[], captures: number[]): void {
  const path = ray.path;
  if (ray.mode === RayMode.Slide) {
    for (let i = 0; i < path.length; i++) {
      const occ = occupant(path[i]);
      if (i < ray.landFrom) {
        if (occ !== null) return;
        continue;
      }
      if (occ === null) {
        if (ray.move) moves.push(path[i]);
        continue;
      }
      if (occ !== color && ray.capture) captures.push(path[i]);
      return;
    }
    return;
  }
  if (ray.mode === RayMode.Jump) {
    let blocked = false;
    for (let i = 0; i < path.length - 1; i++) if (occupant(path[i]) !== null) blocked = true;
    if (!blocked) return;
    const t = path[path.length - 1];
    const occ = occupant(t);
    if (occ === null) {
      if (ray.move) moves.push(t);
    } else if (occ !== color && ray.capture) captures.push(t);
    return;
  }
  let screened = false;
  for (const t of path) {
    const occ = occupant(t);
    if (!screened) {
      if (occ !== null) screened = true;
      continue;
    }
    if (occ === null) {
      if (ray.move) moves.push(t);
      continue;
    }
    if (occ !== color && ray.capture) captures.push(t);
    return;
  }
}
