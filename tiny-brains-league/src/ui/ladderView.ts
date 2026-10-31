import { HOUSE_BOTS } from '../core/bots';
import { efficiencyBoard, type LadderResult, type Standing } from '../core/ladder';
import { scoreFor } from '../core/match';
import { clear, field, h, select } from './dom';
import { download, state, subscribe } from './state';

export function ladderView(): HTMLElement {
  const root = h('section', { class: 'view' });
  const setup = h('div', { class: 'panel' });
  const results = h('div', { class: 'panel', 'aria-live': 'polite' });
  const chosen = new Set<string>([...HOUSE_BOTS.map((b) => b.id), ...state.brains.map((b) => b.id)]);
  let openings = '8';
  let running: Worker | null = null;
  let pairSel: { a: string; b: string } | null = null;

  function drawSetup(): void {
    clear(setup);
    const box = (id: string, label: string) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: chosen.has(id), onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? chosen.add(id) : chosen.delete(id)) }), ` ${label}`);
    setup.append(
      h('h2', {}, 'Class ladder'),
      h('p', { class: 'muted' }, 'Round robin: every pair plays each opening twice, once with each colour. Ratings are a Bradley-Terry fit on the Elo scale with Random pinned at 1000, so the order of games does not matter. The efficiency board ranks brains by Elo above Random per 1,000 parameters.'),
      h('div', { class: 'two-col' }, h('div', {}, h('h3', {}, 'House bots'), ...HOUSE_BOTS.map((b) => box(b.id, b.name))), h('div', {}, h('h3', {}, 'Brains'), ...state.brains.map((b) => box(b.id, `${b.file.name} (${b.params.toLocaleString()})`)))),
      field('Openings per pair', select([{ value: '4', label: '4 (8 games)' }, { value: '8', label: '8 (16 games)' }, { value: '16', label: '16 (32 games)' }, { value: '24', label: '24 (48 games)' }], openings, (v) => (openings = v))),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', disabled: running !== null, onclick: run }, running ? 'Running…' : 'Run ladder')),
    );
  }

  function run(): void {
    const house = HOUSE_BOTS.filter((b) => chosen.has(b.id)).map((b) => b.id);
    const brains = state.brains.filter((b) => chosen.has(b.id)).map((b) => ({ id: b.id, file: b.file }));
    if (house.length + brains.length < 2) {
      results.replaceChildren(h('p', { class: 'bad' }, 'Pick at least two entrants.'));
      return;
    }
    running = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const prog = h('progress', { max: 1, value: 0 });
    results.replaceChildren(h('p', {}, 'Playing matches…'), prog);
    running.onmessage = (ev: MessageEvent<{ type: string; done?: number; total?: number; result?: LadderResult; message?: string }>) => {
      const d = ev.data;
      if (d.type === 'progress') {
        prog.max = d.total ?? 1;
        prog.value = d.done ?? 0;
        return;
      }
      running?.terminate();
      running = null;
      if (d.type === 'error') results.replaceChildren(h('p', { class: 'bad' }, d.message ?? 'error'));
      if (d.result) {
        state.ladder = d.result;
        pairSel = null;
      }
      drawSetup();
      drawResults();
    };
    running.postMessage({ type: 'ladder', house, brains, openings: Number(openings) });
    drawSetup();
  }

  function standingsTable(rows: Standing[], effCol: boolean): HTMLElement {
    const t = h('table', {}, h('thead', {}, h('tr', {}, ...['#', 'Bot', 'Params', 'Elo', 'W', 'D', 'L', effCol ? 'Elo/1k params' : ''].filter(Boolean).map((x) => h('th', { scope: 'col' }, x)))));
    const body = h('tbody', {});
    rows.forEach((s, i) =>
      body.append(
        h('tr', { class: s.kind === 'house' ? 'house' : '' }, h('td', { class: 'num' }, String(i + 1)), h('td', {}, s.name), h('td', { class: 'num' }, s.params === null ? '—' : s.params.toLocaleString()), h('td', { class: 'num' }, s.elo.toFixed(0)), h('td', { class: 'num' }, String(s.wins)), h('td', { class: 'num' }, String(s.draws)), h('td', { class: 'num' }, String(s.losses)), effCol ? h('td', { class: 'num' }, s.efficiency === null ? '—' : s.efficiency.toFixed(1)) : null),
      ),
    );
    t.append(body);
    return h('div', { class: 'table-wrap' }, t);
  }

  function drawResults(): void {
    const L = state.ladder;
    clear(results);
    if (!L) {
      results.append(h('p', { class: 'muted' }, 'No ladder run yet. Pick entrants and press Run ladder.'));
      return;
    }
    const names: Record<string, string> = Object.fromEntries(L.standings.map((s) => [s.id, s.name]));
    const eff = efficiencyBoard(L.standings);
    const ids = L.standings.map((s) => s.id);
    const matrix = h('table', { class: 'matrix' }, h('thead', {}, h('tr', {}, h('th', {}, 'row vs column'), ...ids.map((id) => h('th', { scope: 'col' }, names[id])))));
    const mb = h('tbody', {});
    for (const a of ids) {
      const tr = h('tr', {}, h('th', { scope: 'row' }, names[a]));
      for (const b of ids) {
        if (a === b) {
          tr.append(h('td', { class: 'diag' }, '·'));
          continue;
        }
        const p = L.pairs.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
        const sc = p ? (p.a === a ? p.scoreA : p.games.length - p.scoreA) : 0;
        const frac = p ? sc / p.games.length : 0;
        tr.append(h('td', { class: 'num cell', style: `--frac:${frac}` }, h('button', { type: 'button', class: 'link', onclick: () => { pairSel = { a, b }; drawResults(); } }, `${sc}/${p?.games.length ?? 0}`)));
      }
      mb.append(tr);
    }
    matrix.append(mb);
    results.append(
      h('h2', {}, 'Ratings'),
      standingsTable(L.standings, true),
      h('h2', {}, 'Efficiency board'),
      eff.length ? standingsTable(eff, true) : h('p', { class: 'muted' }, 'No brain is rated above Random yet.'),
      h('h2', {}, 'Head to head'),
      h('p', { class: 'muted small' }, 'Points for the row bot. Click a cell to list its games.'),
      h('div', { class: 'table-wrap' }, matrix),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => download('ladder.json', JSON.stringify({ standings: L.standings, openings: L.openings, games: L.pairs.flatMap((p) => p.games) }, null, 1)) }, 'Download results JSON')),
    );
    if (pairSel) {
      const { a, b } = pairSel;
      const p = L.pairs.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      if (p) {
        const list = h('ol', { class: 'games' });
        p.games.forEach((g) => {
          const s = scoreFor(g, a);
          list.append(
            h('li', {}, `${names[g.first]} (X) vs ${names[g.second]} (O), opening ${g.opening.map((c) => c + 1).join('-')}: `, h('strong', {}, s === 1 ? `${names[a]} won` : s === 0 ? `${names[a]} lost` : 'draw'), ` in ${g.moves.length} plies${g.forfeit ? ' (forfeit)' : ''} `, h('button', { type: 'button', class: 'link', onclick: () => { state.replay = { game: g, names }; location.hash = '#replay'; } }, 'Replay')),
          );
        });
        results.append(h('h3', { id: 'pair-games' }, `${names[a]} vs ${names[b]}`), list);
      }
    }
  }

  const known = new Set(state.brains.map((b) => b.id));
  subscribe(() => {
    for (const b of state.brains)
      if (!known.has(b.id)) {
        known.add(b.id);
        chosen.add(b.id);
      }
    if (!running) drawSetup();
  });
  drawSetup();
  drawResults();
  root.append(setup, results);
  return root;
}
