import { boardFromMoves, COLS, outcomeAfter, play, newBoard } from '../core/connect4';
import { annotateGame, FLAG_TEXT, type PlyNote } from '../core/replay';
import { boardSvg } from './board';
import { clear, h } from './dom';
import { netFor, state } from './state';

export function replayView(): HTMLElement {
  const root = h('section', { class: 'view' });
  const panel = h('div', { class: 'panel' });
  root.append(panel);
  let shown: unknown = null;
  let ply = 0;
  let notes: PlyNote[] = [];

  function render(): void {
    const req = state.replay;
    clear(panel);
    if (!req) {
      panel.append(h('h2', {}, 'Replay viewer'), h('p', { class: 'muted' }, 'Run a ladder, open a head-to-head cell and press Replay on any game. Every ply is checked for missed wins, missed blocks and moves that hand the opponent a win, and for network players the move probabilities are drawn above the board.'), h('a', { class: 'button', href: '#ladder' }, 'Go to the ladder'));
      return;
    }
    const g = req.game;
    if (shown !== g) {
      shown = g;
      notes = annotateGame(g.moves, g.opening.length, { 1: netFor(g.first), 2: netFor(g.second) });
      ply = g.moves.length;
    }
    const b = boardFromMoves(g.moves.slice(0, ply));
    const lastIdx = ply > 0 ? lastCell(g.moves.slice(0, ply)) : undefined;
    const next = notes[ply] ?? null;
    const name = (p: 1 | 2) => req.names[p === 1 ? g.first : g.second] ?? (p === 1 ? g.first : g.second);
    const result = g.result === 'draw' ? 'Draw' : `${name(g.result as 1 | 2)} won${g.forfeit ? ' by forfeit' : ''}`;
    const go = (p: number) => () => {
      ply = Math.max(0, Math.min(g.moves.length, p));
      render();
    };
    const blunders = notes.filter((n) => n.flag);
    panel.append(
      h('h2', {}, `${name(1)} (X) vs ${name(2)} (O)`),
      h('p', {}, h('strong', {}, result), ` after ${g.moves.length} plies. Opening ${g.opening.map((c) => c + 1).join('-')} was fixed by the ladder.`),
      h(
        'div',
        { class: 'replay' },
        h(
          'div',
          { class: 'replay-board' },
          boardSvg(b, { last: lastIdx, probs: next?.probs ?? null, marks: next ? [...next.winning, ...next.mustBlock] : [] }),
          h('div', { class: 'col-labels', 'aria-hidden': 'true' }, ...Array.from({ length: COLS }, (_, c) => h('span', {}, String(c + 1)))),
          h(
            'div',
            { class: 'actions controls' },
            h('button', { type: 'button', onclick: go(0), 'aria-label': 'First ply' }, '⏮'),
            h('button', { type: 'button', onclick: go(ply - 1), 'aria-label': 'Previous ply' }, '◀'),
            h('span', { class: 'num' }, `ply ${ply} / ${g.moves.length}`),
            h('button', { type: 'button', onclick: go(ply + 1), 'aria-label': 'Next ply' }, '▶'),
            h('button', { type: 'button', onclick: go(g.moves.length), 'aria-label': 'Last ply' }, '⏭'),
          ),
          next
            ? h('p', { class: 'small' }, `${name(next.player)} to move${next.probs ? '; bars show its move probabilities (%)' : ''}${next.winning.length || next.mustBlock.length ? '; dots mark winning or must-block cells' : ''}. Played column ${next.move + 1}.`, next.flag ? h('strong', { class: 'bad' }, ` It ${FLAG_TEXT[next.flag]}.`) : null)
            : h('p', { class: 'small' }, 'Final position.'),
        ),
        h(
          'div',
          { class: 'replay-moves' },
          h('h3', {}, 'Moves'),
          h('p', { class: 'small muted' }, blunders.length ? `${blunders.length} flagged ${blunders.length === 1 ? 'move' : 'moves'}.` : 'No tactical slips flagged.'),
          h(
            'ol',
            { class: 'move-list', start: 1 },
            ...notes.map((n) =>
              h('li', { class: `${n.flag ? 'flagged' : ''}${n.ply === ply ? ' current' : ''}` }, h('button', { type: 'button', class: 'link', onclick: go(n.ply) }, `${n.player === 1 ? 'X' : 'O'} col ${n.move + 1}${n.opening ? ' (opening)' : ''}`), n.flag ? h('span', { class: 'bad small' }, ` ${FLAG_TEXT[n.flag]}`) : null),
            ),
          ),
        ),
      ),
    );
  }

  window.addEventListener('hashchange', () => {
    if (location.hash === '#replay') render();
  });
  render();
  return root;
}

function lastCell(moves: readonly number[]): number {
  const b = newBoard();
  let idx = -1;
  for (const m of moves) {
    idx = play(b, m);
    if (outcomeAfter(b, idx) !== null) break;
  }
  return idx;
}
