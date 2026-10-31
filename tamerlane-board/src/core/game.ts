/**
 * Game state: the board, make/unmake, pseudo-legal and legal moves, check,
 * and the game result. Nothing here knows any particular piece.
 */
import { compilePieces, Geometry, walkRay as walk, WHITE, BLACK, type Color, type CompiledPiece, type Ray } from './rules';
import { estimateValue } from './value';
import type { VariantDef } from './variants';

export interface Move {
  from: number;
  to: number;
  /** Encoded piece that moved (see encode). */
  piece: number;
  /** Encoded piece captured, or 0. */
  captured: number;
  /** Piece type index after promotion, or -1. */
  promo: number;
}

export type Result =
  | { over: false }
  | { over: true; winner: Color | null; reason: 'checkmate' | 'stalemate' | 'citadel' | 'move limit' | 'king captured' };

export const encode = (type: number, color: Color): number => ((type << 1) | color) + 1;
export const typeOf = (code: number): number => (code - 1) >> 1;
export const colorOf = (code: number): Color => ((code - 1) & 1) as Color;

/** The per-variant tables shared by every game and search on that variant. */
export class Ruleset {
  readonly geo: Geometry;
  readonly pieces: CompiledPiece[];
  readonly values: number[];
  readonly royalType: number;

  constructor(readonly variant: VariantDef) {
    this.geo = new Geometry(variant.width, variant.height, variant.citadels);
    this.pieces = compilePieces(variant, this.geo);
    this.values = this.pieces.map((p) => (p.def.royal ? 0 : (p.def.value ?? estimateValue(p, this.geo))));
    this.royalType = this.pieces.findIndex((p) => p.def.royal);
  }

  typeIndex(id: string): number {
    return this.pieces.findIndex((p) => p.def.id === id);
  }
}

interface Undo {
  move: Move;
  royal: [number, number];
}

export class Game {
  board: Int16Array;
  side: Color = WHITE;
  ply = 0;
  royal: [number, number] = [-1, -1];
  readonly log: Undo[] = [];
  private readonly occ = (sq: number): Color | null => (this.board[sq] ? colorOf(this.board[sq]) : null);

  constructor(readonly rs: Ruleset) {
    this.board = new Int16Array(rs.geo.size);
  }

  static initial(rs: Ruleset): Game {
    const g = new Game(rs);
    const { geo, variant } = rs;
    for (const p of variant.setup) {
      const sq = geo.parse(p.sq);
      const t = rs.typeIndex(p.piece);
      if (sq < 0 || geo.isCitadel(sq)) throw new Error(`bad square ${p.sq}`);
      if (t < 0) throw new Error(`unknown piece ${p.piece}`);
      const asym = variant.asymmetric;
      const swapped = asym && asym.replace === p.piece ? rs.typeIndex(asym.with) : t;
      const wt = asym?.color === WHITE ? swapped : t;
      const bt = asym?.color === BLACK ? swapped : t;
      const x = geo.xs[sq];
      const y = geo.ys[sq];
      const bx = variant.blackSetup === 'rotate' ? geo.width - 1 - x : x;
      const bsq = geo.at(bx, geo.height - 1 - y);
      g.put(sq, encode(wt, WHITE));
      g.put(bsq, encode(bt, BLACK));
    }
    return g;
  }

  clone(): Game {
    const g = new Game(this.rs);
    g.board = this.board.slice();
    g.side = this.side;
    g.ply = this.ply;
    g.royal = [this.royal[0], this.royal[1]];
    g.log.push(...this.log);
    return g;
  }

  put(sq: number, code: number): void {
    this.board[sq] = code;
    if (code && this.rs.pieces[typeOf(code)].def.royal) this.royal[colorOf(code)] = sq;
  }

  raysAt(sq: number): Ray[] {
    const code = this.board[sq];
    return this.rs.pieces[typeOf(code)].rays[colorOf(code)][sq];
  }

  /** Pseudo-legal moves: may leave the mover's own royal piece attacked. */
  pseudoMoves(capturesOnly = false): Move[] {
    const out: Move[] = [];
    const { board, side, rs } = this;
    const lastRank = rs.geo.height - 1;
    for (let sq = 0; sq < board.length; sq++) {
      const code = board[sq];
      if (!code || colorOf(code) !== side) continue;
      const piece = rs.pieces[typeOf(code)];
      const moves: number[] = [];
      const caps: number[] = [];
      for (const ray of piece.rays[side][sq]) {
        if (capturesOnly && !ray.capture) continue;
        walk(ray, this.occ, side, moves, caps);
      }
      const promoteOn = (to: number) => piece.promoteTo >= 0 && !rs.geo.isCitadel(to) && rs.geo.relRank(to, side) === lastRank;
      for (const to of caps) out.push({ from: sq, to, piece: code, captured: board[to], promo: promoteOn(to) ? piece.promoteTo : -1 });
      if (!capturesOnly) {
        for (const to of moves) out.push({ from: sq, to, piece: code, captured: 0, promo: promoteOn(to) ? piece.promoteTo : -1 });
      }
    }
    return out;
  }

  make(m: Move): void {
    this.log.push({ move: m, royal: [this.royal[0], this.royal[1]] });
    const mover = m.promo >= 0 ? encode(m.promo, this.side) : m.piece;
    if (m.captured && typeOf(m.captured) === this.rs.royalType) this.royal[colorOf(m.captured)] = -1;
    this.board[m.from] = 0;
    this.board[m.to] = mover;
    if (typeOf(m.piece) === this.rs.royalType) this.royal[this.side] = m.to;
    this.side = (this.side ^ 1) as Color;
    this.ply++;
  }

  unmake(): void {
    const u = this.log.pop();
    if (!u) throw new Error('nothing to undo');
    const m = u.move;
    this.board[m.to] = m.captured;
    this.board[m.from] = m.piece;
    this.royal = u.royal;
    this.side = (this.side ^ 1) as Color;
    this.ply--;
  }

  /** Is `sq` attacked by a piece of colour `by`? */
  attacked(sq: number, by: Color): boolean {
    const { board, rs } = this;
    const caps: number[] = [];
    const none: number[] = [];
    for (let from = 0; from < board.length; from++) {
      const code = board[from];
      if (!code || colorOf(code) !== by) continue;
      for (const ray of rs.pieces[typeOf(code)].rays[by][from]) {
        if (!ray.capture || !ray.path.includes(sq)) continue;
        caps.length = 0;
        walk(ray, this.occ, by, none, caps);
        if (caps.includes(sq)) return true;
      }
    }
    return false;
  }

  inCheck(color: Color = this.side): boolean {
    const r = this.royal[color];
    return r >= 0 && this.attacked(r, (color ^ 1) as Color);
  }

  legalMoves(): Move[] {
    const side = this.side;
    const out: Move[] = [];
    for (const m of this.pseudoMoves()) {
      this.make(m);
      if (this.royal[side] >= 0 && !this.inCheck(side)) out.push(m);
      this.unmake();
    }
    return out;
  }

  /** Did the last move put a royal piece into the opponent's citadel? */
  citadelEntered(): boolean {
    const last = this.log[this.log.length - 1];
    return !!last && this.rs.geo.isCitadel(last.move.to);
  }

  result(): Result {
    if (this.royal[WHITE] < 0) return { over: true, winner: BLACK, reason: 'king captured' };
    if (this.royal[BLACK] < 0) return { over: true, winner: WHITE, reason: 'king captured' };
    if (this.citadelEntered()) return { over: true, winner: null, reason: 'citadel' };
    if (this.legalMoves().length === 0) {
      const other = (this.side ^ 1) as Color;
      if (this.inCheck()) return { over: true, winner: other, reason: 'checkmate' };
      return { over: true, winner: this.rs.variant.stalemate === 'loss' ? other : null, reason: 'stalemate' };
    }
    if (this.rs.variant.maxPlies > 0 && this.ply >= this.rs.variant.maxPlies) return { over: true, winner: null, reason: 'move limit' };
    return { over: false };
  }

  /** Short move text such as 'Gi d2-e3', 'p b3xc4=Ca' or 'K a9-Black citadel'. */
  describe(m: Move): string {
    const p = this.rs.pieces[typeOf(m.piece)].def;
    const sep = m.captured ? 'x' : '-';
    const promo = m.promo >= 0 ? `=${this.rs.pieces[m.promo].def.symbol}` : '';
    return `${p.symbol} ${this.rs.geo.name(m.from)}${sep}${this.rs.geo.name(m.to)}${promo}`;
  }

  /** Total material per colour (royal pieces excluded). */
  material(): [number, number] {
    const out: [number, number] = [0, 0];
    for (const code of this.board) if (code) out[colorOf(code)] += this.rs.values[typeOf(code)];
    return out;
  }
}
