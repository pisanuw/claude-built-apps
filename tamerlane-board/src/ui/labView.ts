import { Ruleset, encode } from '../core/game';
import { CUSTOM_ID, baseVariant, buildVariant, encodeSpec, replaceable, validatePiece, type LabSpec } from '../core/lab';
import { tryParse } from '../core/notation';
import { WHITE, BLACK, buildRays, initialRanksOf, rayTargets, type Color } from '../core/rules';
import { DEFAULT_BALANCE, summarize, type GameRecord } from '../core/selfplay';
import { averageMobility, colorBound, estimateValue } from '../core/value';
import { renderBoard } from './board';
import { clear, field, h, select } from './dom';
import { EngineClient } from './engineClient';
import { notify, store } from './store';

export const EXAMPLES: { notation: string; label: string }[] = [
  { notation: 'F>R{3,}', label: 'Giraffe' },
  { notation: 'F>R', label: 'Gryphon' },
  { notation: 'B{2,}', label: 'Picket' },
  { notation: 'NN', label: 'Nightrider' },
  { notation: 'mR cpR', label: 'Cannon' },
  { notation: 'nN', label: 'Xiangqi horse' },
  { notation: 'WD', label: 'Woody rook' },
  { notation: 'FAD', label: 'Wide leaper' },
  { notation: 'R4 F', label: 'Short rook + ferz' },
  { notation: 'fR bW', label: 'Lance-ish' },
  { notation: '[4,1] K', label: 'Giraffe leaper + king' },
  { notation: 'jD', label: 'Must-jump engine' },
];

export function labView(): HTMLElement {
  const engine = new EngineClient();
  const spec = store.spec;
  let from = -1;
  let blockers = new Map<number, Color>();
  let blockerColor: Color = BLACK;
  let tool: 'move' | 'blocker' = 'move';
  let records: GameRecord[] = [];
  let running = false;

  const nameIn = h('input', { type: 'text', value: spec.piece.name, maxlength: 30, 'aria-label': 'Piece name' });
  const symIn = h('input', { type: 'text', value: spec.piece.symbol, maxlength: 2, size: 3, 'aria-label': 'Symbol' });
  const notIn = h('input', { type: 'text', value: spec.piece.notation, class: 'mono', spellcheck: false, autocomplete: 'off', 'aria-label': 'Notation' });
  const parseMsg = h('p', { class: 'parse-msg', 'aria-live': 'polite' });
  const boardWrap = h('div', { class: 'board-wrap' });
  const stats = h('div', { class: 'readouts' });
  const ruleList = h('ul', { class: 'rule-list' });
  const dropWrap = h('div', {});
  const balanceOut = h('div', { class: 'balance', 'aria-live': 'polite' });
  const shareOut = h('p', { class: 'note' });

  const geoVariant = () => baseVariant(spec.base);

  function currentRules() {
    const r = tryParse(spec.piece.notation);
    return 'rules' in r ? r.rules : null;
  }

  function overlay(rs: Ruleset): HTMLElement {
    const rules = currentRules();
    const board = new Int16Array(rs.geo.size);
    for (const [sq, c] of blockers) board[sq] = encode(rs.typeIndex('pawn') >= 0 ? rs.typeIndex('pawn') : rs.typeIndex('p-rook'), c);
    if (from < 0) from = rs.geo.at(Math.floor(rs.geo.width / 2), Math.floor(rs.geo.height / 2) - 1);
    let moves: number[] = [];
    let captures: number[] = [];
    const stagger = new Map<number, number>();
    if (rules) {
      const rays = buildRays(rs.geo, rules, from, WHITE, false, initialRanksOf(geoVariant(), rs.geo, spec.replace));
      const occ = (sq: number): Color | null => (board[sq] ? (((board[sq] - 1) & 1) as Color) : null);
      ({ moves, captures } = rayTargets(rays, occ, WHITE));
      const fx = rs.geo.xs[from];
      const fy = rs.geo.ys[from];
      for (const t of [...moves, ...captures]) stagger.set(t, Math.max(Math.abs(rs.geo.xs[t] - fx), Math.abs(rs.geo.ys[t] - fy)));
    }
    const display = Int16Array.from(board);
    display[from] = encode(rs.pieces.length - 1, WHITE);
    return renderBoard({
      rs,
      board: display,
      selected: from,
      moves,
      captures,
      stagger,
      label: `Reach of ${spec.piece.name} from ${rs.geo.name(from)}`,
      onClick: (sq) => {
        if (rs.geo.isCitadel(sq)) return;
        if (tool === 'move') {
          if (sq !== from) {
            from = sq;
            blockers.delete(sq);
          }
        } else if (sq !== from) {
          if (blockers.get(sq) === blockerColor) blockers.delete(sq);
          else blockers.set(sq, blockerColor);
        }
        refresh();
      },
    });
  }

  /** A ruleset on the base board with the custom piece appended (for display and stats). */
  function labRuleset(): Ruleset | null {
    if (validatePiece(spec.piece)) return null;
    const base = geoVariant();
    return new Ruleset({
      ...base,
      pieces: [...base.pieces, { id: CUSTOM_ID, name: spec.piece.name, symbol: spec.piece.symbol, notation: spec.piece.notation }],
    });
  }

  function renderStats(rs: Ruleset): void {
    clear(stats);
    clear(ruleList);
    const custom = rs.pieces[rs.pieces.length - 1];
    const mob = averageMobility(custom, rs.geo);
    const value = estimateValue(custom, rs.geo);
    const replaced = rs.pieces[rs.typeIndex(spec.replace)];
    const repValue = replaced ? rs.values[replaced.index] : 0;
    const stat = (label: string, value: string, note?: string) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('strong', {}, value), note ? h('small', { class: 'muted' }, note) : null);
    stats.append(
      stat('Average reach on an empty board', `${mob.toFixed(1)} squares`, `${rs.geo.width}×${rs.geo.height} board`),
      stat('Rough value', `${(value / 100).toFixed(1)} pawns`, colorBound(custom, rs.geo) ? 'colour-bound: −15%' : 'reaches both square colours'),
      stat(`vs ${replaced?.def.name ?? spec.replace}`, `${(repValue / 100).toFixed(1)} pawns`, value > repValue * 1.25 ? 'yours looks stronger' : value < repValue * 0.8 ? 'yours looks weaker' : 'about the same'),
    );
    for (const rule of custom.rules) {
      const legs = rule.legs.map((l) => {
        const steps = l.min === l.max ? `exactly ${l.min} step${l.min === 1 ? '' : 's'}` : l.max === Infinity ? `${l.min} or more steps` : `${l.min} to ${l.max} steps`;
        return `${l.vectors.length} directions, ${steps}`;
      });
      const how = [rule.move && !rule.capture ? 'move only' : '', rule.capture && !rule.move ? 'capture only' : '', rule.lame ? 'blockable' : '', rule.jump ? 'must jump' : '', rule.hop ? 'hops one piece' : '', rule.initial ? 'from its starting rank only' : '']
        .filter(Boolean)
        .join(', ');
      ruleList.append(h('li', {}, h('code', {}, rule.text), ` — ${legs.join(', then outward ')}${how ? `; ${how}` : ''}`));
    }
  }

  function renderDrop(): void {
    clear(dropWrap);
    const base = baseVariant(spec.base);
    const opts = replaceable(base).map((p) => ({ value: p.id, label: p.name }));
    if (!opts.some((o) => o.value === spec.replace)) spec.replace = opts[0].value;
    dropWrap.append(
      h(
        'div',
        { class: 'controls' },
        field(
          'Setup',
          select(
            [
              { value: 'timur', label: 'Timur chess' },
              { value: 'classic', label: 'Classic chess' },
            ],
            spec.base,
            (v) => {
              spec.base = v;
              from = -1;
              blockers = new Map();
              changed();
            },
          ),
        ),
        field(
          'Replaces',
          select(opts, spec.replace, (v) => {
            spec.replace = v;
            changed();
          }),
        ),
      ),
    );
  }

  function share(): string {
    const url = new URL(location.href);
    url.hash = `lab=${encodeSpec(spec)}`;
    return url.toString();
  }

  function renderBalance(): void {
    clear(balanceOut);
    if (records.length === 0 && !running) return;
    const s = summarize(records);
    balanceOut.append(
      h('p', {}, h('strong', {}, `${spec.piece.name}: ${s.score} / ${s.games} points`), ` (${s.wins} won, ${s.draws} drawn, ${s.losses} lost). `, running ? 'Running…' : s.verdict),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Game'), h('th', {}, `${spec.piece.name} plays`), h('th', {}, 'Result'), h('th', {}, 'How'), h('th', {}, 'Plies'), h('th', {}, 'Material lead'))),
          h(
            'tbody',
            {},
            ...records.map((r, i) =>
              h(
                'tr',
                {},
                h('td', {}, String(i + 1)),
                h('td', {}, r.customColor === 'white' ? 'White' : 'Black'),
                h('td', {}, r.customScore === 1 ? 'won' : r.customScore === 0 ? 'lost' : 'draw'),
                h('td', {}, r.reason),
                h('td', {}, String(r.plies)),
                h('td', {}, `${r.materialLead >= 0 ? '+' : ''}${(r.materialLead / 100).toFixed(1)}`),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function runBalance(): void {
    if (validatePiece(spec.piece)) return;
    records = [];
    running = true;
    renderBalance();
    const options = { ...DEFAULT_BALANCE, seed: Math.floor(Math.random() * 1e6) };
    engine.send({ kind: 'balance', spec: JSON.parse(JSON.stringify(spec)) as LabSpec, options }, (r) => {
      if (r.kind === 'game') {
        records.push(r.record);
        renderBalance();
        return false;
      }
      running = false;
      if (r.kind === 'error') balanceOut.append(h('p', { class: 'error' }, r.message));
      else renderBalance();
      return true;
    });
  }

  function refresh(): void {
    const err = validatePiece(spec.piece);
    const parsed = tryParse(spec.piece.notation);
    parseMsg.className = `parse-msg ${err ? 'error' : 'ok'}`;
    parseMsg.textContent = err ?? `Parsed ${'rules' in parsed ? parsed.rules.length : 0} part${'rules' in parsed && parsed.rules.length === 1 ? '' : 's'}. Click a square to move the piece${tool === 'blocker' ? ', or place blockers' : ''}.`;
    const rs = labRuleset();
    if (rs) {
      boardWrap.replaceChildren(overlay(rs));
      renderStats(rs);
    }
    shareOut.textContent = err ? '' : share();
  }

  function changed(): void {
    records = [];
    renderBalance();
    renderDrop();
    refresh();
    notify();
  }

  const onPiece = () => {
    spec.piece = { name: nameIn.value, symbol: symIn.value, notation: notIn.value };
    changed();
  };
  nameIn.addEventListener('input', onPiece);
  symIn.addEventListener('input', onPiece);
  notIn.addEventListener('input', onPiece);

  const examples = h(
    'div',
    { class: 'chips' },
    ...EXAMPLES.map((e) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          onclick: () => {
            notIn.value = e.notation;
            nameIn.value = e.label;
            symIn.value = e.label.slice(0, 2);
            onPiece();
          },
        },
        h('code', {}, e.notation),
        ` ${e.label}`,
      ),
    ),
  );

  const toolSel = select(
    [
      { value: 'move', label: 'Clicking moves your piece' },
      { value: 'blocker-b', label: 'Clicking places enemy blockers' },
      { value: 'blocker-w', label: 'Clicking places friendly blockers' },
    ],
    'move',
    (v) => {
      tool = v === 'move' ? 'move' : 'blocker';
      blockerColor = v === 'blocker-w' ? WHITE : BLACK;
      refresh();
    },
  );

  const root = h(
    'section',
    { class: 'lab' },
    h('h2', {}, 'Piece lab'),
    h(
      'p',
      { class: 'lede' },
      'Describe a piece in one line of notation and see where it reaches. Every piece in this app, the historical ones included, is defined this way; the move generator, this overlay and the engine all read the same definition.',
    ),
    h('div', { class: 'lab-inputs' }, field('Name', nameIn), field('Symbol', symIn), field('Notation', notIn, 'See the Notation tab for the full syntax.')),
    parseMsg,
    examples,
    h('div', { class: 'button-row' }, field('Board tool', toolSel), h('button', { type: 'button', class: 'secondary', onclick: () => ((blockers = new Map()), refresh()) }, 'Clear blockers')),
    h('div', { class: 'play-grid' }, boardWrap, h('aside', { class: 'side' }, h('h3', {}, 'What the notation says'), ruleList, h('p', { class: 'legend' }, h('span', { class: 'key move' }), ' move ', h('span', { class: 'key cap' }), ' capture'))),
    stats,
    h('div', { class: 'card' }, h('h3', {}, 'Drop it into a game'), dropWrap, h('div', { class: 'button-row' },
      h('button', { type: 'button', onclick: () => {
        if (validatePiece(spec.piece)) return;
        store.pendingVariant = buildVariant({ ...spec, scope: 'both' });
        notify();
        location.hash = 'play';
      } }, 'Play it against the engine'),
      h('button', { type: 'button', class: 'secondary', onclick: runBalance }, `Balance test (${DEFAULT_BALANCE.games} engine games)`),
      h('button', { type: 'button', class: 'secondary', onclick: () => void navigator.clipboard?.writeText(share()).then(() => (shareOut.textContent = `Copied: ${share()}`)) }, 'Copy share link'),
    ),
    h('p', { class: 'note' }, `The balance test gives your piece to one side only, in place of the piece it replaces, and lets the engine play itself (${DEFAULT_BALANCE.timeMs} ms and at most ${DEFAULT_BALANCE.maxDepth} plies per move, ${DEFAULT_BALANCE.randomPlies} random opening plies, adjudicated on material after ${DEFAULT_BALANCE.plyCap} plies). The sides alternate so the first move does not decide it. Six fast games are a hint, not a verdict.`),
    balanceOut, shareOut),
  );
  renderDrop();
  refresh();
  return root;
}
