/** Messages between the UI and the engine worker, and the replay they rely on. */
import { Game, Ruleset } from './game';
import type { LabSpec } from './lab';
import type { BalanceOptions, GameRecord } from './selfplay';
import type { VariantDef } from './variants';

export type MoveKey = [from: number, to: number, promo: number];

export type Request =
  | { kind: 'search'; id: number; variant: VariantDef; moves: MoveKey[]; timeMs: number }
  | { kind: 'balance'; id: number; spec: LabSpec; options: BalanceOptions };

export type Response =
  | { kind: 'search'; id: number; move: MoveKey | null; score: number; depth: number; nodes: number }
  | { kind: 'game'; id: number; index: number; record: GameRecord }
  | { kind: 'done'; id: number }
  | { kind: 'error'; id: number; message: string };

/** Rebuild a game from its starting position and a list of moves. */
export function replay(rs: Ruleset, moves: MoveKey[]): Game {
  const g = Game.initial(rs);
  for (const [from, to, promo] of moves) {
    const m = g.pseudoMoves().find((x) => x.from === from && x.to === to && x.promo === promo);
    if (!m) throw new Error(`move ${from}-${to} is not possible here`);
    g.make(m);
  }
  return g;
}

export function moveKeys(g: Game): MoveKey[] {
  return g.log.map((u) => [u.move.from, u.move.to, u.move.promo]);
}
