import { Ruleset, encode } from '../core/game';
import { WHITE, rayTargets, type Color } from '../core/rules';
import { TIMUR, type VariantDef } from '../core/variants';
import { renderBoard } from './board';
import { h } from './dom';

/** A 9x9 board with no citadels, used to draw each piece's reach from the centre. */
const MINI: VariantDef = { ...TIMUR, id: 'mini', width: 9, height: 9, citadels: false, setup: [] };

export function piecesView(): HTMLElement {
  const mini = new Ruleset(MINI);
  const full = new Ruleset(TIMUR);
  const centre = mini.geo.at(4, 4);
  const cards = TIMUR.pieces
    .filter((p) => !p.pawn || p.id === 'p-rook')
    .map((p) => {
      const t = mini.typeIndex(p.id);
      const board = new Int16Array(mini.geo.size);
      board[centre] = encode(t, WHITE);
      const empty = (): Color | null => null;
      const { moves } = rayTargets(mini.pieces[t].rays[WHITE][centre], empty, WHITE);
      const title = p.pawn ? 'Pawns (eleven kinds)' : p.name;
      const value = p.royal ? 'royal' : `about ${(full.values[t] / 100).toFixed(1)} pawns on the 11×10 board`;
      return h(
        'article',
        { class: 'card piece-card' },
        h('h3', {}, title),
        renderBoard({ rs: mini, board, moves, small: true, label: `${title}: reach from the centre of an empty 9 by 9 board` }),
        h('p', {}, h('code', {}, p.notation), ` · ${value}`),
        h('p', {}, p.pawn ? `${p.history} Each of the eleven pawns is named for the piece it becomes: the pawn of rooks starts in front of the rook’s file, and so on. Their tokens show that piece’s symbol in the corner.` : (p.history ?? '')),
      );
    });
  return h(
    'section',
    { class: 'pieces' },
    h('h2', {}, 'The pieces'),
    h(
      'p',
      { class: 'lede' },
      'Each card shows the piece’s reach from the centre of an empty board, its notation and a short note on where it came from. Values are the app’s mobility estimate, not historical figures, which are unknown.',
    ),
    h('div', { class: 'piece-grid' }, ...cards),
    h(
      'p',
      { class: 'note' },
      'Sources: the rules and setup follow the summary of Timur (Tamerlane) chess on Wikipedia, which draws on H. J. R. Murray’s A History of Chess (1913). Medieval accounts disagree on details; where they do, this app takes the simplest reading and says so on the Rules tab.',
    ),
  );
}
