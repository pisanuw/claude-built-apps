import { Game, Ruleset, encode } from '../src/core/game';
import type { Color } from '../src/core/rules';
import type { VariantDef } from '../src/core/variants';

/** An empty game with the given pieces placed: [square, pieceId, colour]. */
export function position(v: VariantDef, pieces: [string, string, Color][], side: Color = 0): Game {
  const rs = new Ruleset(v);
  const g = new Game(rs);
  for (const [sq, id, c] of pieces) {
    const s = rs.geo.parse(sq);
    const t = rs.typeIndex(id);
    if (s < 0 || t < 0) throw new Error(`bad ${sq} ${id}`);
    g.put(s, encode(t, c));
  }
  g.side = side;
  return g;
}

export function targetsOf(g: Game, sq: string): string[] {
  const s = g.rs.geo.parse(sq);
  return g
    .legalMoves()
    .filter((m) => m.from === s)
    .map((m) => g.rs.geo.name(m.to))
    .sort();
}
