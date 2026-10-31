import { MATE } from '../core/engine';
import { Game, Ruleset, colorOf, typeOf, type Move } from '../core/game';
import { buildVariant } from '../core/lab';
import { moveKeys } from '../core/protocol';
import type { Color } from '../core/rules';
import type { VariantDef } from '../core/variants';
import { renderBoard } from './board';
import { clear, field, h, select } from './dom';
import { EngineClient } from './engineClient';
import { builtIn, store } from './store';

type Mode = 'white' | 'black' | 'both' | 'watch';

const MODES: { value: Mode; label: string }[] = [
  { value: 'white', label: 'White, against the engine' },
  { value: 'black', label: 'Black, against the engine' },
  { value: 'both', label: 'Both sides (two players)' },
  { value: 'watch', label: 'Neither (engine vs engine)' },
];

const TIMES = [
  { value: '300', label: '0.3 s (quick)' },
  { value: '1000', label: '1 s' },
  { value: '2500', label: '2.5 s' },
  { value: '6000', label: '6 s (strongest)' },
];

export function describeScore(score: number, side: Color): string {
  const white = side === 0 ? score : -score;
  if (Math.abs(white) >= MATE - 200) {
    const plies = MATE - Math.abs(white);
    return `${white > 0 ? 'White' : 'Black'} forces a win in about ${Math.max(1, Math.ceil(plies / 2))} move${plies > 2 ? 's' : ''}`;
  }
  const pawns = white / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)} for White`;
}

export function playView(): HTMLElement {
  const engine = new EngineClient();
  let variantId = 'timur';
  let variant: VariantDef = builtIn('timur');
  let rs = new Ruleset(variant);
  let game = Game.initial(rs);
  let mode: Mode = 'white';
  let timeMs = 1000;
  let flipped = false;
  let selected = -1;
  let thinking = false;
  let engineNote = '';
  let error = '';

  const boardWrap = h('div', { class: 'board-wrap' });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const moveList = h('ol', { class: 'moves' });
  const info = h('div', { class: 'piece-info' });
  const variantSel = h('select', {});
  const variantNote = h('p', { class: 'note' });

  function fillVariants(): void {
    clear(variantSel);
    const opts: [string, string][] = [
      ['timur', 'Timur chess (11×10, citadels)'],
      ['classic', 'Classic chess (simplified)'],
    ];
    const s = store.spec;
    opts.push(['lab', `Lab: ${s.piece.name} replaces ${builtIn(s.base).pieces.find((p) => p.id === s.replace)?.name ?? s.replace} (${builtIn(s.base).name})`]);
    for (const [v, l] of opts) variantSel.append(h('option', { value: v, selected: v === variantId }, l));
  }
  variantSel.addEventListener('change', () => {
    variantId = variantSel.value;
    newGame();
  });

  function loadVariant(): void {
    error = '';
    try {
      variant = variantId === 'lab' ? buildVariant({ ...store.spec, scope: 'both' }) : builtIn(variantId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      variantId = 'timur';
      variant = builtIn('timur');
    }
    rs = new Ruleset(variant);
    variantNote.textContent = variant.notes ?? '';
  }

  function engineSide(): boolean {
    if (mode === 'both') return false;
    if (mode === 'watch') return true;
    return (mode === 'white' ? 1 : 0) === game.side;
  }

  function newGame(): void {
    engine.stop();
    thinking = false;
    loadVariant();
    game = Game.initial(rs);
    selected = -1;
    engineNote = '';
    flipped = mode === 'black';
    update();
  }

  function legalFrom(sq: number): Move[] {
    return game.legalMoves().filter((m) => m.from === sq);
  }

  function play(m: Move): void {
    game.make(m);
    selected = -1;
    update();
  }

  function onClick(sq: number): void {
    if (thinking || game.result().over || engineSide()) return;
    if (selected >= 0) {
      const m = legalFrom(selected).find((x) => x.to === sq);
      if (m) {
        play(m);
        return;
      }
    }
    const code = game.board[sq];
    selected = code && colorOf(code) === game.side && selected !== sq ? sq : -1;
    update();
  }

  function askEngine(): void {
    thinking = true;
    const side = game.side;
    const ply = game.ply;
    engine.send({ kind: 'search', variant, moves: moveKeys(game), timeMs }, (r) => {
      if (r.kind === 'error') {
        thinking = false;
        error = `Engine error: ${r.message}`;
        update();
        return true;
      }
      if (r.kind !== 'search') return false;
      thinking = false;
      if (game.ply !== ply || !r.move) {
        update();
        return true;
      }
      const [from, to, promo] = r.move;
      const m = game.legalMoves().find((x) => x.from === from && x.to === to && x.promo === promo);
      engineNote = `Engine searched ${r.depth} plies deep (${r.nodes.toLocaleString()} positions): ${describeScore(r.score, side)}.`;
      if (m) play(m);
      else update();
      return true;
    });
  }

  function renderMoves(): void {
    clear(moveList);
    const replayGame = Game.initial(rs);
    const texts: string[] = [];
    for (const u of game.log) {
      texts.push(replayGame.describe(u.move));
      replayGame.make(u.move);
    }
    for (let i = 0; i < texts.length; i += 2) {
      moveList.append(h('li', {}, texts[i], texts[i + 1] ? h('span', { class: 'reply' }, texts[i + 1]) : null));
    }
    moveList.scrollTop = moveList.scrollHeight;
  }

  function renderInfo(): void {
    clear(info);
    const sq = selected;
    if (sq < 0) {
      info.append(h('p', { class: 'muted' }, 'Select a piece to see its moves, its notation and where it came from.'));
      return;
    }
    const t = typeOf(game.board[sq]);
    const p = rs.pieces[t].def;
    info.append(
      h('h3', {}, p.name),
      h('p', {}, h('code', {}, p.notation), ' · ', p.royal ? 'royal' : `about ${(rs.values[t] / 100).toFixed(1)} pawns`),
    );
    if (p.history) info.append(h('p', { class: 'note' }, p.history));
  }

  function update(): void {
    const res = game.result();
    let text: string;
    if (res.over) {
      const who = res.winner === null ? 'Draw' : `${res.winner === 0 ? 'White' : 'Black'} wins`;
      const why: Record<string, string> = {
        checkmate: 'by checkmate',
        stalemate: res.winner === null ? 'by stalemate' : 'by stalemate (a stalemated side loses in Timur chess)',
        citadel: 'because a king reached the opponent’s citadel',
        'move limit': 'by the move limit',
        'king captured': 'by capturing the king',
      };
      text = `${who} ${why[res.reason]}.`;
    } else {
      text = `${game.side === 0 ? 'White' : 'Black'} to move${game.inCheck() ? ', in check' : ''}.`;
      if (engineSide()) text += ' Engine is thinking…';
    }
    status.replaceChildren(h('strong', {}, text), engineNote ? h('span', { class: 'muted' }, ` ${engineNote}`) : '', error ? h('span', { class: 'error' }, ` ${error}`) : '');
    const sel = selected >= 0 ? legalFrom(selected) : [];
    const last = game.log[game.log.length - 1]?.move;
    const royal = game.royal[game.side];
    boardWrap.replaceChildren(
      renderBoard({
        rs,
        board: game.board,
        flipped,
        selected,
        moves: sel.filter((m) => !m.captured).map((m) => m.to),
        captures: sel.filter((m) => m.captured).map((m) => m.to),
        last: last ? [last.from, last.to] : undefined,
        check: !res.over && royal >= 0 && game.inCheck() ? royal : undefined,
        onClick,
        label: `${variant.name} board`,
      }),
    );
    renderMoves();
    renderInfo();
    if (!res.over && engineSide() && !thinking) {
      // Let the browser paint the human's move first.
      setTimeout(() => {
        if (!thinking && engineSide() && !game.result().over) askEngine();
      }, 30);
    }
  }

  function undo(): void {
    engine.stop();
    thinking = false;
    const steps = mode === 'white' || mode === 'black' ? (engineSide() ? 1 : 2) : 1;
    for (let i = 0; i < steps && game.log.length > 0; i++) game.unmake();
    if (mode === 'watch') mode = 'both';
    modeSel.value = mode;
    selected = -1;
    engineNote = '';
    update();
  }

  const modeSel = select(MODES, mode, (v) => {
    mode = v;
    engine.stop();
    thinking = false;
    flipped = mode === 'black';
    update();
  });
  const timeSel = select(TIMES, String(timeMs), (v) => {
    timeMs = Number(v);
  });

  store.listeners.add(() => {
    fillVariants();
    if (store.pendingVariant) {
      store.pendingVariant = null;
      variantId = 'lab';
      fillVariants();
      newGame();
    }
  });

  fillVariants();
  loadVariant();
  game = Game.initial(rs);
  const root = h(
    'section',
    { class: 'play' },
    h('h2', {}, 'Play'),
    h(
      'p',
      { class: 'lede' },
      'Timur chess on its 11×10 board, with the two citadels sticking out at the sides. Click a piece to see where it can go. A king that reaches the opponent’s citadel draws the game, so a losing king has somewhere to run.',
    ),
    h('div', { class: 'controls' }, field('Game', variantSel), field('You play', modeSel), field('Engine time per move', timeSel)),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', onclick: newGame }, 'New game'),
      h('button', { type: 'button', class: 'secondary', onclick: undo }, 'Undo'),
      h(
        'button',
        {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            flipped = !flipped;
            update();
          },
        },
        'Flip board',
      ),
    ),
    status,
    h('div', { class: 'play-grid' }, boardWrap, h('aside', { class: 'side' }, info, h('h3', {}, 'Moves'), moveList)),
    variantNote,
  );
  update();
  return root;
}
