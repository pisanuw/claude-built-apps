/**
 * A small alpha-beta engine that works for any piece set: negamax with
 * iterative deepening, capture-only quiescence, MVV-LVA and killer-move
 * ordering. Inside the tree it searches pseudo-legal moves and treats taking
 * the royal piece as a won game, which makes checkmate and stalemate fall
 * out of the search without a legality test at every node.
 */
import { colorOf, typeOf, type Game, type Move, type Ruleset } from './game';
import { WHITE, type Color } from './rules';

export const MATE = 100_000;
const INF = 1_000_000;
const QDEPTH = 6;

export interface SearchOptions {
  /** Wall-clock budget; depth 1 always completes. */
  timeMs: number;
  maxDepth?: number;
  now?: () => number;
}

export interface SearchResult {
  move: Move | null;
  /** From the side to move, in centipawns; near ±MATE means a forced result. */
  score: number;
  depth: number;
  nodes: number;
}

class Timeout extends Error {}

/** Piece-square bonus tables, [type][color][square]. */
export function positionTables(rs: Ruleset): number[][][] {
  const { geo } = rs;
  const cx = (geo.width - 1) / 2;
  const cy = (geo.height - 1) / 2;
  return rs.pieces.map((p) =>
    [WHITE, 1].map((color) => {
      const out: number[] = [];
      for (let sq = 0; sq < geo.size; sq++) {
        if (geo.isCitadel(sq)) {
          out.push(0);
        } else if (p.def.royal) {
          out.push(0);
        } else if (p.def.pawn) {
          out.push(6 * geo.relRank(sq, color as Color));
        } else {
          const d = Math.abs(geo.xs[sq] - cx) + Math.abs(geo.ys[sq] - cy);
          out.push(Math.round(3 * (cx + cy - d)));
        }
      }
      return out;
    }),
  );
}

const tableCache = new WeakMap<Ruleset, number[][][]>();

function tables(rs: Ruleset): number[][][] {
  let t = tableCache.get(rs);
  if (!t) {
    t = positionTables(rs);
    tableCache.set(rs, t);
  }
  return t;
}

/** Static evaluation from the point of view of the side to move. */
export function evaluate(g: Game): number {
  const pst = tables(g.rs);
  const values = g.rs.values;
  let score = 0;
  const b = g.board;
  for (let sq = 0; sq < b.length; sq++) {
    const code = b[sq];
    if (!code) continue;
    const t = typeOf(code);
    const c = colorOf(code);
    const v = values[t] + pst[t][c][sq];
    score += c === WHITE ? v : -v;
  }
  return g.side === WHITE ? score : -score;
}

const sameMove = (a: Move | undefined, b: Move): boolean => !!a && a.from === b.from && a.to === b.to && a.promo === b.promo;

export class Searcher {
  nodes = 0;
  private deadline = 0;
  private canStop = false;
  private killers: Move[][] = [];
  private readonly now: () => number;

  constructor(
    readonly g: Game,
    private readonly opts: SearchOptions,
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  private order(moves: Move[], ply: number): Move[] {
    const values = this.g.rs.values;
    const k = this.killers[ply] ?? [];
    const key = (m: Move): number => {
      if (m.captured) return 1_000_000 + values[typeOf(m.captured)] * 10 - values[typeOf(m.piece)] / 10;
      if (m.promo >= 0) return 900_000 + values[m.promo];
      if (sameMove(k[0], m)) return 800_000;
      if (sameMove(k[1], m)) return 799_000;
      return 0;
    };
    return moves.map((m) => [key(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  private tick(): void {
    this.nodes++;
    if (this.canStop && (this.nodes & 1023) === 0 && this.now() > this.deadline) throw new Timeout();
  }

  private terminalDraw(): boolean {
    const { g } = this;
    if (g.citadelEntered()) return true;
    const max = g.rs.variant.maxPlies;
    return max > 0 && g.ply >= max;
  }

  quiesce(alpha: number, beta: number, ply: number, qd: number): number {
    this.tick();
    if (this.terminalDraw()) return 0;
    const stand = evaluate(this.g);
    if (stand >= beta || qd >= QDEPTH) return stand;
    let best = stand;
    if (stand > alpha) alpha = stand;
    const royal = this.g.rs.royalType;
    for (const m of this.order(this.g.pseudoMoves(true), ply)) {
      if (typeOf(m.captured) === royal) return MATE - ply;
      this.g.make(m);
      const s = -this.quiesce(-beta, -alpha, ply + 1, qd + 1);
      this.g.unmake();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.terminalDraw()) return 0;
    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);
    this.tick();
    const { g } = this;
    const royal = g.rs.royalType;
    const moves = this.order(g.pseudoMoves(), ply);
    let best = -INF;
    for (const m of moves) {
      if (m.captured && typeOf(m.captured) === royal) return MATE - ply;
      g.make(m);
      const s = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      g.unmake();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!m.captured) {
          const k = (this.killers[ply] ??= []);
          if (!sameMove(k[0], m)) {
            k[1] = k[0];
            k[0] = m;
          }
        }
        break;
      }
    }
    if (best <= -(MATE - ply - 1)) {
      // Every move loses the royal piece: checkmate, or stalemate.
      if (!g.inCheck() && g.rs.variant.stalemate === 'draw') return 0;
      return -(MATE - ply);
    }
    return best;
  }

  search(): SearchResult {
    const { g, opts } = this;
    const start = this.now();
    this.deadline = start + opts.timeMs;
    const maxDepth = opts.maxDepth ?? 64;
    const base = g.ply;
    let root = g.legalMoves();
    if (root.length === 0) return { move: null, score: g.inCheck() || g.rs.variant.stalemate === 'loss' ? -MATE : 0, depth: 0, nodes: 0 };
    let result: SearchResult = { move: root[0], score: 0, depth: 0, nodes: 0 };
    root = this.order(root, 0);
    for (let depth = 1; depth <= maxDepth; depth++) {
      this.canStop = depth > 1;
      const scored: [number, Move][] = [];
      let alpha = -INF;
      try {
        for (const m of root) {
          g.make(m);
          const s = -this.negamax(depth - 1, -INF, -alpha, 1);
          g.unmake();
          scored.push([s, m]);
          if (s > alpha) alpha = s;
        }
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        // Unwind any moves made inside the aborted search.
        while (g.ply > base) g.unmake();
        break;
      }
      scored.sort((a, b) => b[0] - a[0]);
      root = scored.map((x) => x[1]);
      result = { move: scored[0][1], score: scored[0][0], depth, nodes: this.nodes };
      if (Math.abs(scored[0][0]) >= MATE - 100) break;
      if (this.now() - start > opts.timeMs / 2) break;
    }
    result.nodes = this.nodes;
    return result;
  }
}

export function search(g: Game, opts: SearchOptions): SearchResult {
  const work = g.clone();
  return new Searcher(work, opts).search();
}

/** Score from White's point of view, for display. */
export function whiteScore(score: number, side: Color): number {
  return side === WHITE ? score : -score;
}
