import { ARROW, type Dir, type Vec, fmt } from '../core/geom';
import { GHOST_IDS, GHOST_META, type GhostId, STRATEGIES, type Strategy } from '../core/ghosts';
import { MAZES, mazeById, walkable } from '../core/maze';
import { LEVEL1_SCHEDULE, TICKS_PER_SECOND, modeAt } from '../core/modes';
import { type Decision, REASON_TEXT } from '../core/rules';
import { FREE_PLAY_ID, SCENARIOS, type Scenario, scenarioById } from '../core/scenarios';
import { astar, bfs } from '../core/search';
import {
  type Control,
  type SimConfig,
  type SimState,
  cloneState,
  createSim,
  driveTo,
  frighten,
  ghost,
  globalMode,
  placeRunner,
  previewDecision,
  setControl,
  steer,
  step,
  stepToDecision,
  targetInfo,
} from '../core/sim';
import { h, select } from './dom';
import { type Layout, type View, drawScene, layoutFor, pixelToTile, readPalette } from './render';

const HISTORY_LIMIT = 30 * TICKS_PER_SECOND;
const SPEEDS = [
  { value: '0.1', label: '0.1×' },
  { value: '0.25', label: '0.25×' },
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
] as const;
const CONTROLS: { value: Control; label: string; hint: string }[] = [
  { value: 'auto', label: 'Autopilot', hint: 'keeps away from ghosts' },
  { value: 'keys', label: 'Keys', hint: 'arrows / WASD' },
  { value: 'goto', label: 'Drive to tile', hint: 'click a tile' },
  { value: 'hold', label: 'Stand still', hint: '' },
];
const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

export function mazeView(): HTMLElement {
  let scenario: Scenario = scenarioById(FREE_PLAY_ID);
  let config: SimConfig = makeConfig(scenario.maze.id, { ...scenario.strategies }, scenario.overflowBug);
  let state: SimState = createSim(config, scenario.setup);
  let history: SimState[] = [];
  let playing = false;
  let speed = 1;
  let carry = 0;
  let lastFrame = 0;
  let lastPanel = 0;
  let dirty = true;
  const view: View = {
    overlay: { chaser: true, ambusher: true, flanker: true, shy: true },
    showCandidates: true,
    hover: null,
    selected: 'chaser',
  };
  let layout: Layout = layoutFor(config.maze, 600, 600);

  function makeConfig(mazeId: string, strategies: Record<GhostId, Strategy>, overflowBug: boolean): SimConfig {
    return { maze: mazeById(mazeId), strategies, overflowBug, seed: 20261009, endOnCapture: true };
  }

  // ---------- elements ----------
  const canvas = h('canvas', { class: 'maze-canvas', 'aria-label': 'Maze. Ghost targets and candidate exits are drawn over it; the panel lists the same information as text.' });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const canvasWrap = h('div', { class: 'canvas-wrap' }, canvas);
  const statusTime = h('span', { class: 'mono' });
  const statusMode = h('span', { class: 'mode-chip' });
  const statusHover = h('span', { class: 'muted mono hover-read' });
  const banner = h('div', { class: 'banner', role: 'status', 'aria-live': 'polite' });

  const playBtn = h('button', { type: 'button', onclick: () => togglePlay(), title: 'Play / pause (Space)' }, 'Play');
  const backBtn = h('button', { type: 'button', class: 'secondary', onclick: () => stepBack(), title: 'Back one tick (,)' }, '◀ Tick');
  const tickBtn = h('button', { type: 'button', class: 'secondary', onclick: () => stepTicks(1), title: 'Forward one tick (.)' }, 'Tick ▶');
  const nextBtn = h('button', { type: 'button', class: 'secondary', onclick: () => nextDecision(), title: 'Run to the next real choice (N)' }, 'Next decision ▶▶');
  const resetBtn = h('button', { type: 'button', class: 'secondary', onclick: () => reset(), title: 'Reset this scenario (R)' }, 'Reset');
  const speedSel = select(
    SPEEDS.map((s) => ({ value: s.value, label: s.label })),
    '1',
    (v) => {
      speed = Number(v);
    },
    { 'aria-label': 'Playback speed' },
  );
  const pad = h(
    'div',
    { class: 'dpad', role: 'group', 'aria-label': 'Steer the runner' },
    ...(['up', 'left', 'down', 'right'] as Dir[]).map((d) =>
      h('button', { type: 'button', class: `secondary dpad-${d}`, 'aria-label': `Steer ${d}`, onclick: () => doSteer(d) }, ARROW[d]),
    ),
  );

  const scenarioSel = select(
    SCENARIOS.map((s) => ({ value: s.id, label: s.title })),
    scenario.id,
    (id) => loadScenario(scenarioById(id)),
    { 'aria-label': 'Scenario' },
  );
  const stepsList = h('ol', { class: 'steps' });
  const mazeSel = select(
    MAZES.map((m) => ({ value: m.id, label: m.name })),
    config.maze.id,
    (id) => {
      const free = scenarioById(FREE_PLAY_ID);
      loadScenario({ ...free, maze: mazeById(id) }, true);
    },
    { 'aria-label': 'Maze' },
  );

  const bugBox = h('input', {
    type: 'checkbox',
    checked: config.overflowBug,
    onchange: () => {
      config = { ...config, overflowBug: bugBox.checked };
      dirty = true;
      updatePanel();
    },
  });
  const candBox = h('input', {
    type: 'checkbox',
    checked: view.showCandidates,
    onchange: () => {
      view.showCandidates = candBox.checked;
      dirty = true;
    },
  });
  const controlRadios = CONTROLS.map((c) =>
    h(
      'label',
      { class: 'radio' },
      h('input', { type: 'radio', name: 'runner-control', value: c.value, onchange: () => setRunnerControl(c.value) }),
      ` ${c.label}`,
      c.hint ? h('small', {}, ` ${c.hint}`) : null,
    ),
  );
  const frightBtn = h('button', { type: 'button', class: 'secondary', onclick: () => doFrighten(), title: 'Frighten the ghosts for 6 s (F)' }, 'Frighten (6 s)');

  const timeline = h('div', { class: 'timeline', 'aria-hidden': 'true' });
  const timelineCursor = h('div', { class: 'timeline-cursor' });
  const timelineText = h('p', { class: 'note timeline-text' });
  buildTimeline();

  const ghostCards = GHOST_IDS.map((id) => ghostCard(id));
  const inspector = h('div', { class: 'inspector' });
  const logList = h('ul', { class: 'log' });

  const root = h(
    'section',
    { class: 'maze-layout' },
    h(
      'div',
      { class: 'stage' },
      h('div', { class: 'status-bar' }, statusTime, statusMode, statusHover),
      canvasWrap,
      banner,
      h('div', { class: 'transport' }, playBtn, backBtn, tickBtn, nextBtn, resetBtn, h('label', { class: 'inline' }, 'Speed ', speedSel)),
      h('div', { class: 'stage-row' }, pad, h('p', { class: 'note keys-help' }, 'Keys: arrows/WASD steer, Space play/pause, . tick, , back, N next decision, F frighten, R reset. Click a tile to drive there; Shift-click to put the runner on it.')),
      timeline,
      timelineText,
    ),
    h(
      'div',
      { class: 'side' },
      h('div', { class: 'card' }, h('h3', {}, 'Scenario'), scenarioSel, stepsList, h('label', { class: 'inline' }, 'Maze ', mazeSel)),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Runner'),
        h('div', { class: 'radios' }, ...controlRadios),
        h('div', { class: 'button-row' }, frightBtn),
        h('label', { class: 'check' }, bugBox, ' Overflow bug (facing up shifts the Ambusher and Flanker targets left)'),
        h('label', { class: 'check' }, candBox, ' Show candidate exits and distances'),
      ),
      h('div', { class: 'ghost-cards' }, ...ghostCards.map((c) => c.el)),
      h('div', { class: 'card' }, inspector),
      h('details', { class: 'card' }, h('summary', {}, 'Event log'), logList),
    ),
  );

  // ---------- behaviour ----------
  function loadScenario(s: Scenario, keepSelect = false): void {
    scenario = s;
    config = makeConfig(s.maze.id, { ...s.strategies }, s.overflowBug);
    for (const id of GHOST_IDS) view.overlay[id] = s.focus.includes(id);
    view.selected = s.focus[0] ?? 'chaser';
    bugBox.checked = s.overflowBug;
    if (!keepSelect) scenarioSel.value = s.id;
    else scenarioSel.value = FREE_PLAY_ID;
    mazeSel.value = s.maze.id;
    stepsList.replaceChildren(...s.steps.map((t) => h('li', {}, t)));
    for (const c of ghostCards) c.sync();
    reset();
    resize();
  }

  function reset(): void {
    playing = false;
    state = createSim(config, scenario.setup);
    history = [];
    carry = 0;
    dirty = true;
    updatePanel();
  }

  function pushHistory(): void {
    history.push(cloneState(state));
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  }

  function stepTicks(n: number): void {
    playing = false;
    for (let i = 0; i < n && !state.over; i++) {
      pushHistory();
      step(config, state);
    }
    dirty = true;
    updatePanel();
  }

  function stepBack(): void {
    playing = false;
    const prev = history.pop();
    if (prev) state = prev;
    dirty = true;
    updatePanel();
  }

  function nextDecision(): void {
    playing = false;
    pushHistory();
    stepToDecision(config, state);
    dirty = true;
    updatePanel();
  }

  function togglePlay(): void {
    if (state.over) return;
    playing = !playing;
    carry = 0;
    lastFrame = performance.now();
    updatePanel();
  }

  function doSteer(d: Dir): void {
    steer(config, state, d);
    dirty = true;
    updatePanel();
  }

  function doFrighten(): void {
    frighten(config, state);
    dirty = true;
    updatePanel();
  }

  function setRunnerControl(c: Control): void {
    setControl(state, c);
    dirty = true;
    updatePanel();
  }

  function frame(now: number): void {
    if (!root.isConnected) {
      running = false;
      return;
    }
    if (playing) {
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      carry += dt * TICKS_PER_SECOND * speed;
      while (carry >= 1 && !state.over) {
        carry -= 1;
        pushHistory();
        step(config, state);
        dirty = true;
      }
      if (state.over) {
        playing = false;
        updatePanel();
      } else if (now - lastPanel > 120) updatePanel();
    }
    lastFrame = now;
    if (dirty) {
      draw();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  let running = false;
  function startLoop(): void {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(layout.width * dpr) || canvas.height !== Math.round(layout.height * dpr)) {
      canvas.width = Math.round(layout.width * dpr);
      canvas.height = Math.round(layout.height * dpr);
      canvas.style.width = `${layout.width}px`;
      canvas.style.height = `${layout.height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, layout, config, state, view, readPalette(root));
  }

  function resize(): void {
    const w = canvasWrap.clientWidth || 600;
    const hgt = Math.max(320, window.innerHeight * 0.82);
    layout = layoutFor(config.maze, w, hgt);
    dirty = true;
  }

  function eventTile(ev: MouseEvent): Vec {
    const rect = canvas.getBoundingClientRect();
    return pixelToTile(layout, ((ev.clientX - rect.left) * layout.width) / rect.width, ((ev.clientY - rect.top) * layout.height) / rect.height);
  }

  canvas.addEventListener('mousemove', (ev) => {
    const t = eventTile(ev);
    const inside = t.x >= 0 && t.y >= 0 && t.x < config.maze.width && t.y < config.maze.height;
    view.hover = inside ? t : null;
    statusHover.textContent = `tile ${fmt(t)}`;
    dirty = true;
  });
  canvas.addEventListener('mouseleave', () => {
    view.hover = null;
    statusHover.textContent = '';
    dirty = true;
  });
  canvas.addEventListener('click', (ev) => {
    const t = eventTile(ev);
    if (!walkable(config.maze, t)) {
      showBanner(`${fmt(t)} is not a corridor tile.`);
      return;
    }
    if (ev.shiftKey) {
      pushHistory();
      placeRunner(config, state, t);
    } else driveTo(config, state, t);
    dirty = true;
    updatePanel();
  });

  function onKey(ev: KeyboardEvent): void {
    if (!root.isConnected) return;
    const tag = (ev.target as HTMLElement | null)?.tagName ?? '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) && !(ev.target as HTMLInputElement).type?.match(/checkbox|radio/)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const dir = KEY_DIRS[key];
    if (dir) {
      ev.preventDefault();
      doSteer(dir);
      return;
    }
    const actions: Record<string, () => void> = {
      ' ': togglePlay,
      '.': () => stepTicks(1),
      ',': stepBack,
      n: nextDecision,
      f: doFrighten,
      r: reset,
    };
    const act = actions[key];
    // Space on a focused button should press that button, not toggle play.
    if (!act || (key === ' ' && tag === 'BUTTON')) return;
    ev.preventDefault();
    act();
  }
  document.addEventListener('keydown', onKey);

  let bannerTimer = 0;
  function showBanner(text: string): void {
    banner.textContent = text;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => updateBanner(), 2500);
  }
  function updateBanner(): void {
    if (state.over && state.capture) {
      banner.textContent = `${GHOST_META[state.capture.ghost].name} caught the runner at ${fmt(state.capture.tile)} after ${(state.capture.tick / TICKS_PER_SECOND).toFixed(2)} s. Step back to rewind, or Reset.`;
      banner.className = 'banner caught';
    } else {
      banner.textContent = '';
      banner.className = 'banner';
    }
  }

  // ---------- panel ----------
  function buildTimeline(): void {
    const finite = LEVEL1_SCHEDULE.filter((p) => Number.isFinite(p.seconds));
    const total = finite.reduce((a, p) => a + p.seconds, 0) + 16;
    timeline.replaceChildren(
      ...LEVEL1_SCHEDULE.map((p) =>
        h(
          'div',
          { class: `seg ${p.mode}`, style: `flex: ${Number.isFinite(p.seconds) ? p.seconds : 16} 0 0` },
          Number.isFinite(p.seconds) ? `${p.mode === 'scatter' ? 'S' : 'C'} ${p.seconds}s` : 'chase ∞',
        ),
      ),
      timelineCursor,
    );
    timeline.dataset.total = String(total);
  }

  function updateTimeline(): void {
    const total = Number(timeline.dataset.total);
    const secs = state.modeTicks / TICKS_PER_SECOND;
    timelineCursor.style.left = `${Math.min(100, (secs / total) * 100)}%`;
    const m = modeAt(state.modeTicks);
    const left = Number.isFinite(m.end) ? ((m.end - state.modeTicks) / TICKS_PER_SECOND).toFixed(1) : null;
    timelineText.textContent =
      state.frightRemaining > 0
        ? `Frightened for ${(state.frightRemaining / TICKS_PER_SECOND).toFixed(1)} s more; the schedule clock is paused at ${secs.toFixed(1)} s.`
        : `Schedule clock ${secs.toFixed(1)} s: ${m.mode}${left ? `, ${left} s until the next switch (every ghost reverses then)` : ', for the rest of the level'}.`;
  }

  function ghostCard(id: GhostId): { el: HTMLElement; sync: () => void; update: () => void } {
    const meta = GHOST_META[id];
    const strategySel = select(STRATEGIES, config.strategies[id], (v) => {
      config = { ...config, strategies: { ...config.strategies, [id]: v } };
      dirty = true;
      updatePanel();
    }, { 'aria-label': `${meta.name} strategy` });
    const overlayBox = h('input', {
      type: 'checkbox',
      'aria-label': `Draw ${meta.name}'s target`,
      onchange: () => {
        view.overlay[id] = overlayBox.checked;
        dirty = true;
      },
    });
    const statusEl = h('span', { class: 'ghost-status' });
    const targetEl = h('p', { class: 'ghost-target' });
    const el = h(
      'div',
      { class: 'ghost-card', style: `--g: ${meta.color}` },
      h(
        'div',
        { class: 'ghost-head' },
        h('button', { type: 'button', class: 'ghost-name', onclick: () => select_(), title: 'Inspect this ghost' }, h('span', { class: 'chip' }, meta.letter), meta.name),
        statusEl,
        h('label', { class: 'check small' }, overlayBox, ' draw'),
      ),
      h('p', { class: 'ghost-rule' }, meta.rule, h('span', { class: 'muted' }, ` Modelled on ${meta.analogue}.`)),
      targetEl,
      h('label', { class: 'inline small' }, 'Moves by ', strategySel),
    );
    function select_(): void {
      view.selected = id;
      dirty = true;
      updatePanel();
    }
    return {
      el,
      sync() {
        strategySel.value = config.strategies[id];
        overlayBox.checked = view.overlay[id];
      },
      update() {
        const g = ghost(state, id);
        el.classList.toggle('selected', view.selected === id);
        statusEl.textContent =
          g.status === 'house'
            ? g.releaseTick === Infinity
              ? 'off'
              : `in house until ${(g.releaseTick / TICKS_PER_SECOND).toFixed(0)} s`
            : g.status === 'eyes'
              ? 'eaten, heading home'
              : g.frightened
                ? 'frightened'
                : `at ${fmt(g.tile)} heading ${g.dir}`;
        const info = targetInfo(config, state, g);
        targetEl.textContent = info ? `Target ${fmt(info.target)}: ${info.note}.${info.intended ? ` Without the bug: ${fmt(info.intended)}.` : ''}` : g.status === 'active' ? 'No target: picks exits at random.' : '';
        if (strategySel.value !== config.strategies[id]) strategySel.value = config.strategies[id];
      },
    };
  }

  function decisionTable(d: Decision, preview: boolean): HTMLElement {
    const rows = d.candidates.map((c) => {
      let verdict: string;
      if (c.excluded === 'wall') verdict = 'wall';
      else if (c.excluded === 'reverse') verdict = 'straight back: not allowed';
      else if (d.chosen === null) verdict = 'possible';
      else if (c.dir === d.chosen) verdict = d.reason === 'nearest' && d.tieBroken ? 'chosen (won the tie on order)' : 'chosen';
      else if (d.reason === 'nearest' && c.dist2 !== null) {
        const best = d.candidates.find((x) => x.dir === d.chosen)?.dist2;
        verdict = c.dist2 === best ? 'tie, lost on up > left > down > right' : 'farther';
      } else verdict = '';
      return h(
        'tr',
        { class: c.dir === d.chosen ? 'chosen' : c.excluded ? 'excluded' : '' },
        h('td', {}, `${ARROW[c.dir]} ${c.dir}`),
        h('td', { class: 'mono' }, c.excluded === 'wall' ? '' : fmt(c.tile)),
        h('td', { class: 'mono num' }, c.dist2 === null ? '' : String(c.dist2)),
        h('td', {}, verdict),
      );
    });
    let pathNote: HTMLElement | null = null;
    if (d.path) {
      const other = d.path.kind === 'bfs' ? astar(config.maze, d.at, d.path.goal) : bfs(config.maze, d.at, d.path.goal);
      const [b, a] = d.path.kind === 'bfs' ? [d.path.expanded, other.expanded] : [other.expanded, d.path.expanded];
      pathNote = h('p', { class: 'note' }, `Shortest path to ${fmt(d.path.goal)}: ${d.path.length} steps. BFS expanded ${b} tiles to find it; A* expanded ${a}.`);
    }
    return h(
      'div',
      {},
      h(
        'p',
        { class: 'decision-head' },
        `${preview ? 'Will decide' : 'Decided'} at ${fmt(d.at)} while heading ${d.heading}${d.target ? `, target ${fmt(d.target)}` : ''}: `,
        h('strong', {}, d.chosen ? `${ARROW[d.chosen]} ${d.chosen}` : 'random'),
        ` (${REASON_TEXT[d.reason]}).`,
      ),
      h(
        'div',
        { class: 'table-scroll' },
        h('table', { class: 'decision' }, h('thead', {}, h('tr', {}, h('th', {}, 'Exit'), h('th', {}, 'Tile'), h('th', { class: 'num' }, 'dist²'), h('th', {}, ''))), h('tbody', {}, ...rows)),
      ),
      pathNote,
    );
  }

  function updateInspector(): void {
    const g = ghost(state, view.selected);
    const meta = GHOST_META[g.id];
    const preview = previewDecision(config, state, g);
    inspector.replaceChildren(
      h('h3', { style: `color: ${meta.color}` }, `Ghost cam: ${meta.name}`),
      g.status === 'house'
        ? h('p', { class: 'muted' }, g.releaseTick === Infinity ? 'Not in play in this scenario.' : 'Waiting in the house.')
        : h(
            'div',
            {},
            h('h4', {}, 'Next decision'),
            preview ? decisionTable(preview, true) : h('p', { class: 'muted' }, 'Stopped.'),
            h('h4', {}, 'Last decision'),
            g.lastDecision ? decisionTable(g.lastDecision, false) : h('p', { class: 'muted' }, 'None yet.'),
          ),
    );
  }

  function updatePanel(): void {
    lastPanel = performance.now();
    const secs = state.tick / TICKS_PER_SECOND;
    statusTime.textContent = `t = ${secs.toFixed(2)} s · tick ${state.tick}`;
    const mode = globalMode(state);
    statusMode.textContent = mode;
    statusMode.className = `mode-chip ${mode}`;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    playBtn.disabled = state.over;
    tickBtn.disabled = state.over;
    nextBtn.disabled = state.over;
    backBtn.disabled = history.length === 0;
    for (const r of controlRadios) {
      const input = r.querySelector('input') as HTMLInputElement;
      input.checked = input.value === state.runner.control;
    }
    updateTimeline();
    for (const c of ghostCards) c.update();
    updateInspector();
    logList.replaceChildren(
      ...state.log
        .slice(-12)
        .reverse()
        .map((e) => h('li', {}, h('span', { class: 'mono muted' }, `${(e.tick / TICKS_PER_SECOND).toFixed(2)} s `), e.text)),
    );
    updateBanner();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvasWrap);
  window.addEventListener('resize', resize);
  const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  scheme?.addEventListener?.('change', () => {
    dirty = true;
  });
  root.addEventListener('shown', () => {
    resize();
    startLoop();
  });

  loadScenario(scenario);
  startLoop();
  return root;
}
