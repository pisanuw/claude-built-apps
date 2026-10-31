import { colorOf, typeOf, type Ruleset } from '../core/game';
import { h } from './dom';

export interface BoardState {
  rs: Ruleset;
  board: ArrayLike<number>;
  flipped?: boolean;
  selected?: number;
  moves?: number[];
  captures?: number[];
  last?: [number, number];
  check?: number;
  /** Animation delay order per target square (lab overlay). */
  stagger?: Map<number, number>;
  onClick?: (sq: number) => void;
  label?: string;
  small?: boolean;
}

export function token(rs: Ruleset, code: number): HTMLElement {
  const p = rs.pieces[typeOf(code)].def;
  const color = colorOf(code) === 0 ? 'white' : 'black';
  const promo = p.promotesTo ? rs.pieces.find((q) => q.def.id === p.promotesTo)?.def.symbol : undefined;
  return h(
    'span',
    { class: `token ${color}${p.royal ? ' royal' : ''}${p.pawn ? ' pawn' : ''}`, 'aria-hidden': 'true' },
    h('span', { class: 'sym' }, p.symbol),
    promo && p.pawn ? h('span', { class: 'promo' }, promo) : null,
  );
}

export function pieceLabel(rs: Ruleset, code: number): string {
  return `${colorOf(code) === 0 ? 'White' : 'Black'} ${rs.pieces[typeOf(code)].def.name}`;
}

/** Draw the board as a grid of buttons (or plain cells when not clickable). */
export function renderBoard(state: BoardState): HTMLElement {
  const { rs, board } = state;
  const geo = rs.geo;
  const side = rs.variant.citadels ? 1 : 0;
  const cols = geo.width + 2 * side;
  const grid = h('div', {
    class: `board${state.small ? ' small' : ''}`,
    role: 'grid',
    'aria-label': state.label ?? 'Board',
    style: `--cols:${cols};--rows:${geo.height}`,
  });
  const moves = new Set(state.moves ?? []);
  const caps = new Set(state.captures ?? []);
  for (let row = 0; row < geo.height; row++) {
    for (let col = 0; col < cols; col++) {
      let x = col - side;
      let y = geo.height - 1 - row;
      if (state.flipped) {
        x = geo.width - 1 - x;
        y = geo.height - 1 - y;
      }
      const sq = geo.at(x, y);
      if (sq < 0) {
        grid.append(h('div', { class: 'cell void', 'aria-hidden': 'true' }));
        continue;
      }
      const code = board[sq];
      const classes = ['cell'];
      if (geo.isCitadel(sq)) classes.push('citadel', geo.citadelOwner[sq] === 0 ? 'cit-white' : 'cit-black');
      if (state.selected === sq) classes.push('selected');
      if (state.last && (state.last[0] === sq || state.last[1] === sq)) classes.push('last');
      if (state.check === sq) classes.push('check');
      if (moves.has(sq)) classes.push('target');
      if (caps.has(sq)) classes.push('capture');
      const name = geo.name(sq);
      const desc = [name, code ? pieceLabel(rs, code) : 'empty', moves.has(sq) ? 'can move here' : '', caps.has(sq) ? 'can capture here' : '']
        .filter(Boolean)
        .join(', ');
      const delay = state.stagger?.get(sq);
      const attrs: Record<string, string | ((ev: Event) => void)> = {
        class: classes.join(' '),
        role: 'gridcell',
        'aria-label': desc,
        title: desc,
      };
      if (delay !== undefined) attrs.style = `--delay:${delay * 45}ms`;
      const onClick = state.onClick;
      const cell = onClick ? h('button', { ...attrs, type: 'button', onclick: () => onClick(sq) }) : h('div', attrs);
      if (!state.small && !geo.isCitadel(sq)) {
        if (col === side) cell.append(h('span', { class: 'coord rank', 'aria-hidden': 'true' }, String(y + 1)));
        if (row === geo.height - 1) cell.append(h('span', { class: 'coord file', 'aria-hidden': 'true' }, String.fromCharCode(97 + x)));
      }
      if (geo.isCitadel(sq) && !code) cell.append(h('span', { class: 'cit-mark', 'aria-hidden': 'true' }, '⌂'));
      if (code) cell.append(token(rs, code));
      if (moves.has(sq) || caps.has(sq)) cell.append(h('span', { class: 'dot', 'aria-hidden': 'true' }));
      grid.append(cell);
    }
  }
  return grid;
}
