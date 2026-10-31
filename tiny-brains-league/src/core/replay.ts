/** Annotates a recorded game ply by ply so students can see where their bot lost. */
import { type Board, type Player, boardFromMoves, cloneBoard, isWinningMove, legalMoves, other, play, undo } from './connect4';
import { type Net, legalSoftmax, logits } from './net';

export type Flag = 'missed-win' | 'missed-block' | 'gave-win' | null;

export interface PlyNote {
  ply: number;
  player: Player;
  move: number;
  /** Probabilities the network assigned (only when the mover is a network). */
  probs: number[] | null;
  winning: number[];
  mustBlock: number[];
  flag: Flag;
  opening: boolean;
}

/** Columns where the side to move would hand the opponent an immediate win on top. */
function givesWin(b: Board, col: number): boolean {
  const me = b.toMove;
  play(b, col);
  const bad = b.heights[col] < 6 && isWinningMove(b, col, other(me));
  undo(b, col);
  return bad;
}

export function annotateGame(moves: readonly number[], openingLength: number, nets: { 1?: Net | null; 2?: Net | null } = {}): PlyNote[] {
  const notes: PlyNote[] = [];
  const b = boardFromMoves([]);
  moves.forEach((move, ply) => {
    const player = b.toMove;
    const legal = legalMoves(b);
    const winning = legal.filter((c) => isWinningMove(b, c, player));
    const mustBlock = legal.filter((c) => isWinningMove(b, c, other(player)));
    const net = nets[player] ?? null;
    const probs = net ? legalSoftmax(logits(net, b), legal) : null;
    const opening = ply < openingLength;
    let flag: Flag = null;
    if (!opening) {
      if (winning.length && !winning.includes(move)) flag = 'missed-win';
      else if (!winning.length && mustBlock.length && !mustBlock.includes(move)) flag = 'missed-block';
      else if (!winning.length && givesWin(b, move) && legal.some((c) => !givesWin(b, c))) flag = 'gave-win';
    }
    notes.push({ ply, player, move, probs, winning, mustBlock, flag, opening });
    play(b, move);
  });
  return notes;
}

export function boardAt(moves: readonly number[], ply: number): Board {
  return cloneBoard(boardFromMoves(moves.slice(0, ply)));
}

export const FLAG_TEXT: Record<Exclude<Flag, null>, string> = {
  'missed-win': 'missed a winning move',
  'missed-block': 'did not block an immediate threat',
  'gave-win': 'played under an opponent win',
};
