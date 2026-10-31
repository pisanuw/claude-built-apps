import { LINEUPS, type Lineup, type LineupSummary, seedsFrom } from '../core/experiment';
import { GHOST_IDS, GHOST_META, type GhostId, STRATEGIES, type Strategy } from '../core/ghosts';
import { MAZES } from '../core/maze';
import { h, select } from './dom';
import type { CompareMessage, CompareRequest } from './worker';

export function compareView(): HTMLElement {
  let mazeId = 'lab';
  let runs = 12;
  let seconds = 120;
  let overflowBug = true;
  const custom: Record<GhostId, Strategy> = { chaser: 'arcade', ambusher: 'bfs', flanker: 'arcade', shy: 'arcade' };
  const enabled: Record<string, boolean> = { arcade: true, bfs: true, astar: true, custom: true };
  let worker: Worker | null = null;

  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const status = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'results-area' });
  const runBtn = h('button', { type: 'button', onclick: () => run() }, 'Run comparison');

  const lineupBoxes = [...LINEUPS.map((l) => ({ id: l.id, label: l.label })), { id: 'custom', label: 'Custom lineup (below)' }].map((l) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: enabled[l.id],
        onchange: (ev: Event) => {
          enabled[l.id] = (ev.target as HTMLInputElement).checked;
        },
      }),
      ` ${l.label}`,
    ),
  );
  const customSelects = GHOST_IDS.map((id) =>
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label', style: `color: ${GHOST_META[id].color}` }, GHOST_META[id].name),
      select(STRATEGIES, custom[id], (v) => {
        custom[id] = v;
      }),
    ),
  );

  function lineups(): Lineup[] {
    const out: Lineup[] = LINEUPS.filter((l) => enabled[l.id]).map((l) => ({ ...l, strategies: { ...l.strategies } }));
    if (enabled.custom) {
      const label = GHOST_IDS.map((id) => `${GHOST_META[id].letter}:${STRATEGIES.find((s) => s.value === custom[id])?.value}`).join(' ');
      out.push({ id: 'custom', label: `Custom (${label})`, strategies: { ...custom } });
    }
    return out;
  }

  function run(): void {
    const ls = lineups();
    if (ls.length === 0) {
      status.textContent = 'Pick at least one lineup.';
      return;
    }
    worker?.terminate();
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const req: CompareRequest = { mazeId, lineups: ls, overflowBug, seeds: seedsFrom(1, runs), seconds };
    progress.hidden = false;
    progress.value = 0;
    runBtn.disabled = true;
    status.textContent = `Running ${ls.length * runs} games of ${seconds} s…`;
    const started = performance.now();
    worker.onmessage = (ev: MessageEvent<CompareMessage>) => {
      const m = ev.data;
      if (m.kind === 'progress') {
        progress.value = m.done / m.total;
        return;
      }
      progress.hidden = true;
      runBtn.disabled = false;
      status.textContent = `${ls.length * runs} games simulated in ${((performance.now() - started) / 1000).toFixed(1)} s. Same seeds for every lineup, so the runner starts each game the same way.`;
      results.replaceChildren(renderResults(m.results));
      worker?.terminate();
      worker = null;
    };
    worker.onerror = (e) => {
      progress.hidden = true;
      runBtn.disabled = false;
      status.textContent = `The simulation worker failed: ${e.message}`;
    };
    worker.postMessage(req);
  }

  return h(
    'section',
    { class: 'compare' },
    h('h2', {}, 'Greedy vs search'),
    h(
      'p',
      { class: 'lede' },
      'Run many seeded games against the autopilot runner and compare lineups. Every game lasts the same time; after a capture the runner goes back to its start (with one second of safety) and play continues. Bunching is measured only in chase mode, as the share of ticks in which two ghosts are within three tiles of each other.',
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'controls' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Maze'), select(MAZES.map((m) => ({ value: m.id, label: m.name })), mazeId, (v) => (mazeId = v))),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Games per lineup'),
          select(['6', '12', '24', '48'].map((v) => ({ value: v, label: v })), String(runs), (v) => (runs = Number(v))),
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Seconds per game'),
          select(['60', '120', '240'].map((v) => ({ value: v, label: v })), String(seconds), (v) => (seconds = Number(v))),
        ),
        h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', checked: overflowBug, onchange: (ev: Event) => (overflowBug = (ev.target as HTMLInputElement).checked) }),
          ' Overflow bug on',
        ),
      ),
      h('fieldset', {}, h('legend', {}, 'Lineups'), ...lineupBoxes),
      h('fieldset', {}, h('legend', {}, 'Custom lineup'), h('div', { class: 'controls' }, ...customSelects)),
      h('div', { class: 'button-row' }, runBtn, progress),
      status,
    ),
    results,
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function bar(value: number, max: number, color: string): HTMLElement {
  const w = max > 0 ? Math.max(1, Math.round((value / max) * 70)) : 0;
  return h('span', { class: 'bar-track' }, h('span', { class: 'bar', style: `width: ${w}px; background: ${color}` }));
}

function renderResults(rs: LineupSummary[]): HTMLElement {
  const maxRate = Math.max(...rs.map((r) => r.capturesPerMinute));
  const rows = rs.map((r) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, r.lineup.label),
      h('td', { class: 'num' }, h('div', { class: 'bar-cell' }, bar(r.capturesPerMinute, maxRate, 'var(--accent)'), h('span', {}, r.capturesPerMinute.toFixed(2)))),
      h('td', { class: 'num' }, r.medianFirstCapture === null ? 'never' : `${r.medianFirstCapture.toFixed(1)} s`),
      h('td', { class: 'num' }, `${r.survived} / ${r.episodes.length}`),
      h('td', { class: 'num' }, h('div', { class: 'bar-cell' }, bar(r.meanBunching, 1, 'var(--muted)'), h('span', {}, pct(r.meanBunching)))),
      h('td', { class: 'num' }, r.meanSpread.toFixed(1)),
      h(
        'td',
        { class: 'by-ghost' },
        ...GHOST_IDS.map((id) => h('span', { style: `color: ${GHOST_META[id].color}`, title: GHOST_META[id].name }, `${GHOST_META[id].letter} ${r.capturesBy[id]}`)),
      ),
    ),
  );
  const arcade = rs.find((r) => r.lineup.id === 'arcade');
  const search = rs.find((r) => r.lineup.id === 'bfs') ?? rs.find((r) => r.lineup.id === 'astar');
  let reading: HTMLElement | null = null;
  if (arcade && search) {
    const more = search.capturesPerMinute > arcade.capturesPerMinute;
    reading = h(
      'p',
      { class: 'reading' },
      `In this run the shortest-path ghosts caught the runner ${more ? 'more' : 'less'} often (${search.capturesPerMinute.toFixed(2)} vs ${arcade.capturesPerMinute.toFixed(2)} per minute) and were bunched ${pct(search.meanBunching)} of chase time against ${pct(arcade.meanBunching)} for the target-tile ghosts.` +
        (search.meanBunching > arcade.meanBunching
          ? ' Ghosts that all chase the same tile by shortest paths fall into single file behind the runner. Four different targets keep them apart and come at the runner from different sides, so the chase has gaps a player can read and use.'
          : ''),
    );
  }
  return h(
    'div',
    { class: 'card' },
    h('h3', {}, 'Results'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'compare-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Lineup'),
            h('th', { class: 'num' }, 'Captures / min'),
            h('th', { class: 'num' }, 'Median first capture'),
            h('th', { class: 'num' }, 'Never caught'),
            h('th', { class: 'num' }, 'Bunched (chase)'),
            h('th', { class: 'num' }, 'Mean spread (tiles)'),
            h('th', {}, 'Captures by ghost'),
          ),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
    reading,
    h(
      'p',
      { class: 'note' },
      'BFS and A* find paths of the same length, so their games differ only where equal-length paths are broken differently. The Ghost cam in the Maze tab shows how many tiles each search expanded for the same decision.',
    ),
  );
}
