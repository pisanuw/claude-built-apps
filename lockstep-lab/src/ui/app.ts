import { describeCommand } from '../core/bot';
import { EXERCISES, MACHINES, type Exercise, type GradeResult } from '../core/exercises';
import { PRESETS, type Preset } from '../core/presets';
import { hex32 } from '../core/rng';
import { type Client, type SessionConfig, Session, summarize } from '../core/session';
import { type SweepPoint, sweepDelays } from '../core/sweep';
import { type Command, FIELD } from '../core/world';
import { color, drawChart, prepare } from './chart';
import { el } from './dom';

const NAMES = ['A', 'B', 'C', 'D'];
const PLAYER_COLORS = ['--p0', '--p1', '--p2', '--p3'];
const CHECK_TICKS = 10_000;
const DELAYS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function copy(c: SessionConfig): SessionConfig {
  return { ...c, nondet: { ...c.nondet }, net: { ...c.net } };
}

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the app works without it.
  }
  return null;
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '0';
}

export function mountApp(root: HTMLElement): void {
  let config = copy((PRESETS[0] as Preset).config);
  let activePreset: string | null = (PRESETS[0] as Preset).id;
  let session = new Session(copy(config));
  let playing = true;
  let speed = 1;
  let ghost = true;
  let checking = false;
  let lastChart = 0;
  const syncers: Array<() => void> = [];

  // ---------- header and presets ----------
  const blurb = el('p', { class: 'preset-blurb' });
  const presetButtons = PRESETS.map((p) => {
    // A toggle in a group: aria-selected is for tabs and options, not plain buttons (axe: aria-allowed-attr).
    const b = el('button', { class: 'tab', type: 'button', 'aria-pressed': 'false' }, p.title);
    b.addEventListener('click', () => {
      config = copy(p.config);
      activePreset = p.id;
      syncers.forEach((s) => s());
      restart();
    });
    return { p, b };
  });

  // ---------- controls ----------
  function edited(): void {
    activePreset = null;
    restart();
  }

  function range(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    show: (v: number) => string = String,
  ): HTMLElement {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = el('output');
    const sync = () => {
      input.value = String(get());
      out.textContent = show(get());
    };
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = show(get());
      edited();
    });
    syncers.push(sync);
    sync();
    return el('label', { class: 'field' }, el('span', {}, label), out, input);
  }

  function select<T extends string | number>(
    label: string,
    options: Array<[T, string]>,
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement {
    const s = el('select');
    for (const [v, text] of options) s.append(el('option', { value: String(v) }, text));
    const sync = () => {
      s.value = String(get());
    };
    s.addEventListener('change', () => {
      const hit = options.find(([v]) => String(v) === s.value);
      if (hit) set(hit[0]);
      edited();
    });
    syncers.push(sync);
    sync();
    return el('label', { class: 'field' }, el('span', {}, label), el('span'), s);
  }

  function toggle(label: string, help: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const box = el('input', { type: 'checkbox' });
    const sync = () => {
      box.checked = get();
    };
    box.addEventListener('change', () => {
      set(box.checked);
      edited();
    });
    syncers.push(sync);
    sync();
    return el('label', { class: 'toggle' }, box, el('span', {}, el('strong', {}, label), el('br'), el('span', { class: 'small muted' }, help)));
  }

  const netcode = el(
    'fieldset',
    {},
    el('legend', {}, 'Netcode'),
    select<'lockstep' | 'rollback'>(
      'Model',
      [
        ['lockstep', 'Lockstep with input delay'],
        ['rollback', 'Rollback with prediction (GGPO-style)'],
      ],
      () => config.mode,
      (v) => (config.mode = v),
    ),
    range('Input delay', 0, 8, 1, () => config.inputDelay, (v) => (config.inputDelay = v), (v) => `${v} ticks (${v * config.tickMs} ms)`),
    select<number>(
      'Tick rate',
      [
        [100, '10 Hz (100 ms)'],
        [50, '20 Hz (50 ms)'],
        [33, '30 Hz (33 ms)'],
      ],
      () => config.tickMs,
      (v) => (config.tickMs = v),
    ),
    range('Max prediction (rollback)', 1, 16, 1, () => config.maxPrediction, (v) => (config.maxPrediction = v), (v) => `${v} ticks`),
  );

  const network = el(
    'fieldset',
    {},
    el('legend', {}, 'Network (one way)'),
    range('Latency', 0, 400, 5, () => config.net.latencyMs, (v) => (config.net.latencyMs = v), (v) => `${v} ms`),
    range('Jitter', 0, 200, 5, () => config.net.jitterMs, (v) => (config.net.jitterMs = v), (v) => `0 to ${v} ms`),
    range('Packet loss', 0, 40, 1, () => config.net.lossPct, (v) => (config.net.lossPct = v), (v) => `${v}%`),
    toggle('Allow reordering', 'Jitter may deliver a later packet first.', () => config.net.reorder, (v) => (config.net.reorder = v)),
  );

  const nondet = el(
    'fieldset',
    {},
    el('legend', {}, 'Nondeterminism'),
    select<'fixed' | 'float-same' | 'float-mixed'>(
      'Arithmetic',
      [
        ['fixed', 'Q16.16 fixed point'],
        ['float-same', 'float32, identical platforms'],
        ['float-mixed', 'float32, different platforms'],
      ],
      () => config.nondet.arithmetic,
      (v) => (config.nondet.arithmetic = v),
    ),
    toggle('Unseeded RNG', 'Each client seeds from its own clock.', () => config.nondet.unseededRng, (v) => (config.nondet.unseededRng = v)),
    toggle(
      'Map iteration order',
      'Iterate units as inserted (local player first) instead of by id.',
      () => config.nondet.insertionOrder,
      (v) => (config.nondet.insertionOrder = v),
    ),
    toggle('Frame-rate timestep', 'Advance by measured frame time, not the fixed tick.', () => config.nondet.frameDt, (v) => (config.nondet.frameDt = v)),
  );

  const match = el(
    'fieldset',
    {},
    el('legend', {}, 'Match'),
    select<number>(
      'Players',
      [
        [2, '2 clients'],
        [3, '3 clients'],
        [4, '4 clients'],
      ],
      () => config.players,
      (v) => (config.players = v),
    ),
    range('Units per player', 2, 16, 1, () => config.unitsPerPlayer, (v) => (config.unitsPerPlayer = v)),
    range('Seed', 1, 9999, 1, () => config.seed, (v) => (config.seed = v)),
    toggle('Scripted players', 'Bots issue move and stop commands; you can click too.', () => config.bots, (v) => (config.bots = v)),
  );

  // ---------- transport ----------
  const playBtn = el('button', { type: 'button' }, 'Pause');
  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  });
  const resetBtn = el('button', { type: 'button', class: 'secondary' }, 'Restart');
  resetBtn.addEventListener('click', () => restart());
  const speedSel = el('select', { 'aria-label': 'Speed' });
  for (const s of [0.25, 1, 4, 16]) speedSel.append(el('option', { value: String(s) }, `${s}x`));
  speedSel.value = '1';
  speedSel.addEventListener('change', () => (speed = Number(speedSel.value)));
  const ghostBox = el('input', { type: 'checkbox' });
  ghostBox.checked = true;
  ghostBox.addEventListener('change', () => (ghost = ghostBox.checked));
  const checkBtn = el('button', { type: 'button', class: 'secondary' }, `Check ${CHECK_TICKS.toLocaleString('en-US')} ticks`);
  checkBtn.addEventListener('click', () => void runCheck());
  const clock = el('span', { class: 'small muted' });

  // ---------- panes ----------
  const panes = el('div', { class: 'panes' });
  let paneViews: Array<{ canvas: HTMLCanvasElement; stats: HTMLElement; badge: HTMLElement; queued: HTMLElement; profile: HTMLElement }> = [];

  function buildPanes(): void {
    panes.replaceChildren();
    paneViews = session.clients.map((_, i) => {
      const canvas = el('canvas', { 'aria-label': `Client ${NAMES[i]} world view; click to move your units` });
      const stats = el('dl', { class: 'kv' });
      const badge = el('span', { class: 'badge' });
      const queued = el('p', { class: 'small muted' }, 'Click: move all your units. Shift: even ones. Alt: odd ones. Right-click: stop.');
      const profile = el('p', { class: 'profile' });
      const swatch = el('span', { style: `color: var(${PLAYER_COLORS[i]})` }, '●');
      canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        const x = Math.round(((e.clientX - r.left) / r.width) * FIELD);
        const y = Math.round(((e.clientY - r.top) / r.height) * FIELD);
        const group = e.shiftKey ? 0 : e.altKey ? 1 : 2;
        issue(i, { kind: 'move', group, x, y }, queued);
      });
      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        issue(i, { kind: 'stop', group: 2 }, queued);
      });
      panes.append(el('div', { class: 'pane' }, el('h3', {}, swatch, ` Client ${NAMES[i]} (player ${i + 1})`, badge), profile, canvas, stats, queued));
      return { canvas, stats, badge, queued, profile };
    });
  }

  function issue(i: number, cmd: Command, out: HTMLElement): void {
    session.command(i, cmd);
    out.textContent = `Queued for client ${NAMES[i]}'s next input tick: ${describeCommand(cmd)}.`;
  }

  function drawPane(i: number): void {
    const view = paneViews[i];
    const c = session.clients[i];
    if (!view || !c) return;
    const { ctx, w } = prepare(view.canvas);
    const s = w / FIELD;
    ctx.strokeStyle = color('--gridline');
    ctx.lineWidth = 1;
    for (let g = 32; g < FIELD; g += 32) {
      ctx.beginPath();
      ctx.moveTo(g * s, 0);
      ctx.lineTo(g * s, w);
      ctx.moveTo(0, g * s);
      ctx.lineTo(w, g * s);
      ctx.stroke();
    }
    const A = c.profile.arith;
    const ref = session.clients[0] as Client;
    if (ghost && i > 0) {
      ctx.strokeStyle = color('--muted');
      ctx.setLineDash([2, 2]);
      for (const u of ref.world.units.values()) {
        ctx.beginPath();
        ctx.arc(ref.profile.arith.toNumber(u.x) * s, ref.profile.arith.toNumber(u.y) * s, 5 * s, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    for (const u of c.world.units.values()) {
      const x = A.toNumber(u.x) * s;
      const y = A.toNumber(u.y) * s;
      const col = color(PLAYER_COLORS[u.owner] as string);
      if (u.moving) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(A.toNumber(u.tx) * s, A.toNumber(u.ty) * s);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 4.2 * s, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function paneStats(i: number): void {
    const view = paneViews[i];
    const c = session.clients[i];
    if (!view || !c) return;
    const sum = summarize(c, session.now);
    const p = c.profile;
    view.profile.textContent = `${Math.round(1000 / p.frameMs)} Hz display · ${p.arith.name} · iterate ${p.order === 'sorted' ? 'by id' : 'Map insertion order'} · dt: ${p.dtLabel} · RNG seed ${hex32(p.rngSeed)}`;
    view.badge.textContent = c.stalled ? 'stalled' : '';
    view.badge.className = c.stalled ? 'badge stall' : 'badge';
    const last = c.hashes.get(c.lastHashed);
    const rows: Array<[string, string]> = [
      ['tick', `${c.curTick} (confirmed ${Math.max(-1, c.lastHashed)})`],
      ['state hash', last === undefined ? '-' : hex32(last)],
      ['input lag', `${fmt(sum.avgLagMs, 0)} ms avg`],
      ['stalled', `${fmt(sum.stallPct)}% of the time`],
    ];
    if (config.mode === 'rollback')
      rows.push(
        ['rollbacks', `${c.stats.rollbacks} (max depth ${c.stats.maxRollback})`],
        ['resimulated', `${c.stats.resimTicks} ticks (${fmt(sum.resimPerTick, 2)} per tick)`],
      );
    view.stats.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  }

  // ---------- sync card ----------
  const status = el('div', { class: 'status wait' });
  const strip = el('canvas', { class: 'strip', 'aria-label': 'Per-tick hash comparison, newest on the right' });
  const diffBox = el('div');

  function renderSync(): void {
    const d = session.desync;
    if (d) {
      status.className = 'status bad';
      status.textContent = `Desync: client ${NAMES[d.client]} disagreed with client A after tick ${d.tick} (${hex32(d.hashes[0] as number)} vs ${hex32(d.hashes[d.client] as number)}). ${session.compared} ticks compared.`;
    } else if (session.compared > 0) {
      status.className = 'status ok';
      status.textContent = `In sync: ${session.compared.toLocaleString('en-US')} confirmed ticks, identical hashes on every client.`;
    } else {
      status.className = 'status wait';
      status.textContent = 'Waiting for the first confirmed tick...';
    }
    const { ctx, w, h } = prepare(strip);
    const n = 240;
    const bw = w / n;
    const rec = session.recent;
    const ok = color('--good');
    const bad = color('--bad');
    rec.forEach((c, k) => {
      ctx.fillStyle = c.match ? ok : bad;
      ctx.globalAlpha = c.match ? 0.55 : 1;
      ctx.fillRect((n - rec.length + k) * bw, 0, Math.max(1, bw - 0.5), h);
    });
    ctx.globalAlpha = 1;
  }

  function renderDiff(): void {
    const d = session.desync;
    if (!d) {
      diffBox.replaceChildren(
        el('p', { class: 'small muted' }, 'When two clients disagree, the first differing unit and field at the first divergent tick appear here.'),
      );
      return;
    }
    if (!d.diff) {
      diffBox.replaceChildren(el('p', { class: 'small muted' }, 'The divergent states were no longer buffered, so no field diff is available.'));
      return;
    }
    const x = d.diff;
    diffBox.replaceChildren(
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'tick'), el('th', {}, 'unit'), el('th', {}, 'field'), el('th', {}, `client A`), el('th', {}, `client ${NAMES[d.client]}`))),
        el('tbody', {}, el('tr', {}, el('td', {}, String(d.tick)), el('td', {}, x.unit === null ? 'world' : `#${x.unit}`), el('td', {}, x.field), el('td', { class: 'mono' }, x.a), el('td', { class: 'mono' }, x.b))),
      ),
      el('p', { class: 'small muted' }, `${x.count} unit field${x.count === 1 ? '' : 's'} differed at that tick. Once one value differs, every later tick that touches it differs too: desyncs only grow.`),
    );
  }

  // ---------- timeline ----------
  const timeline = el('canvas', { class: 'chart', 'aria-label': 'Per-second cost for each client' });
  const timelineLegend = el('div', { class: 'legend' });
  const timelineTitle = el('h3');

  function renderTimeline(): void {
    const rollback = config.mode === 'rollback';
    timelineTitle.textContent = rollback ? 'Re-simulated ticks per second' : 'Milliseconds stalled per second';
    const series = session.clients.map((c, i) => ({
      label: `Client ${NAMES[i]}`,
      color: color(PLAYER_COLORS[i] as string),
      points: c.timeline.slice(-60).map((b) => [b.second, rollback ? b.resimTicks : b.stallMs] as [number, number]),
    }));
    drawChart(timeline, series, { xLabel: 'simulated second', yLabel: rollback ? 'ticks' : 'ms' });
    timelineLegend.replaceChildren(...series.map((s) => el('span', {}, el('i', { style: `background:${s.color}` }), s.label)));
  }

  // ---------- compare card ----------
  const sweepBtn = el('button', { type: 'button' }, 'Run sweep on the current network');
  const lagChart = el('canvas', { class: 'chart', 'aria-label': 'Input lag against input delay' });
  const costChart = el('canvas', { class: 'chart', 'aria-label': 'Cost against input delay' });
  const sweepTable = el('div', { class: 'scrollx', tabindex: '0', role: 'region', 'aria-label': 'Sweep results' });
  const sweepNote = el('p', { class: 'small muted' });
  let sweep: SweepPoint[] | null = null;

  function renderSweep(): void {
    if (!sweep) return;
    const lock = sweep.filter((p) => p.mode === 'lockstep');
    const roll = sweep.filter((p) => p.mode === 'rollback');
    const c0 = color('--p0');
    const c1 = color('--p1');
    drawChart(
      lagChart,
      [
        { label: 'Lockstep', color: c0, points: lock.map((p) => [p.inputDelay, p.avgLagMs]) },
        { label: 'Rollback', color: c1, points: roll.map((p) => [p.inputDelay, p.avgLagMs]), dashed: true },
      ],
      { xLabel: 'input delay (ticks)', yLabel: 'input lag (ms)' },
    );
    drawChart(
      costChart,
      [
        { label: 'Lockstep: % of time stalled', color: c0, points: lock.map((p) => [p.inputDelay, p.stallPct]) },
        { label: 'Rollback: ticks re-simulated per 100', color: c1, points: roll.map((p) => [p.inputDelay, p.resimPerTick * 100]), dashed: true },
      ],
      { xLabel: 'input delay (ticks)', yLabel: 'per 100' },
    );
    sweepTable.replaceChildren(
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, ...['delay', 'lockstep lag', 'lockstep stalled', 'rollback lag', 'rollback resim / tick', 'max rollback'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...lock.map((l, k) => {
          const r = roll[k] as SweepPoint;
          return el('tr', {}, el('td', {}, String(l.inputDelay)), el('td', {}, `${fmt(l.avgLagMs, 0)} ms`), el('td', {}, `${fmt(l.stallPct)}%`), el('td', {}, `${fmt(r.avgLagMs, 0)} ms`), el('td', {}, fmt(r.resimPerTick, 3)), el('td', {}, String(r.maxRollback)));
        })),
      ),
    );
  }

  sweepBtn.addEventListener('click', () => {
    sweepBtn.disabled = true;
    sweepNote.textContent = 'Running 18 matches of 20 simulated seconds each...';
    setTimeout(() => {
      const t0 = performance.now();
      sweep = sweepDelays(copy(config), DELAYS, 20_000);
      sweepNote.textContent = `Latency ${config.net.latencyMs} ms + up to ${config.net.jitterMs} ms jitter, ${config.net.lossPct}% loss, ${config.tickMs} ms ticks, all nondeterminism off, averaged over ${config.players} clients (${Math.round(performance.now() - t0)} ms to compute). Input lag is the time from sampling a local input to the tick that executes it.`;
      sweepBtn.disabled = false;
      renderSweep();
    }, 30);
  });

  // ---------- exercises ----------
  const exSel = el('select', { 'aria-label': 'Exercise' });
  for (const ex of EXERCISES) exSel.append(el('option', { value: ex.id }, ex.title));
  const exBrief = el('p');
  const exCode = el('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Body of step(world, api, Math)' });
  const exResult = el('div', { class: 'result', hidden: '' });
  const exHint = el('p', { class: 'small muted' });
  const runBtn = el('button', { type: 'button' }, `Run ${CHECK_TICKS.toLocaleString('en-US')}-tick check`);
  const hintBtn = el('button', { type: 'button', class: 'secondary' }, 'Hint');
  const starterBtn = el('button', { type: 'button', class: 'secondary' }, 'Reset to starter');
  const solutionBtn = el('button', { type: 'button', class: 'secondary' }, 'Show a solution');

  const currentEx = (): Exercise => EXERCISES.find((e) => e.id === exSel.value) as Exercise;
  function loadExercise(): void {
    const ex = currentEx();
    exBrief.textContent = ex.brief;
    exCode.value = store(`lockstep-lab:ex:${ex.id}`) ?? ex.starter;
    exHint.textContent = '';
    exResult.hidden = true;
  }
  exSel.addEventListener('change', loadExercise);
  exCode.addEventListener('input', () => store(`lockstep-lab:ex:${currentEx().id}`, exCode.value));
  exCode.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = exCode.selectionStart;
    exCode.setRangeText('  ', s, exCode.selectionEnd, 'end');
  });
  hintBtn.addEventListener('click', () => (exHint.textContent = currentEx().hint));
  starterBtn.addEventListener('click', () => {
    exCode.value = currentEx().starter;
    store(`lockstep-lab:ex:${currentEx().id}`, exCode.value);
  });
  solutionBtn.addEventListener('click', () => {
    exCode.value = currentEx().solution;
    store(`lockstep-lab:ex:${currentEx().id}`, exCode.value);
  });

  function showResult(r: GradeResult): void {
    exResult.hidden = false;
    exResult.className = `result ${r.passed ? 'pass' : 'fail'}`;
    if (r.passed) exResult.textContent = `Passed: identical hashes on both machines for all ${r.ticks.toLocaleString('en-US')} ticks (final ${hex32(r.hashes[0])}).`;
    else if (r.error) exResult.textContent = `Error: ${r.error}`;
    else if (r.divergedAt !== null)
      exResult.textContent = `Desync after tick ${r.divergedAt}: ${r.diff}. Hashes ${hex32(r.hashes[0])} vs ${hex32(r.hashes[1])}.`;
    else exResult.textContent = `Deterministic for ${r.ticks.toLocaleString('en-US')} ticks, but: ${r.checkFailure}`;
  }

  runBtn.addEventListener('click', () => {
    runBtn.disabled = true;
    exResult.hidden = false;
    exResult.className = 'result';
    exResult.textContent = 'Running on two simulated machines...';
    const worker = new Worker(new URL('./grader.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      runBtn.disabled = false;
      exResult.className = 'result fail';
      exResult.textContent = 'Timed out after 20 seconds (an infinite loop?).';
    }, 20_000);
    worker.onmessage = (e: MessageEvent<GradeResult>) => {
      clearTimeout(timer);
      worker.terminate();
      runBtn.disabled = false;
      showResult(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      runBtn.disabled = false;
      exResult.className = 'result fail';
      exResult.textContent = `Worker error: ${e.message}`;
    };
    worker.postMessage({ id: currentEx().id, code: exCode.value, ticks: CHECK_TICKS });
  });

  // ---------- layout ----------
  root.replaceChildren(
    el(
      'header',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, 'Lockstep Lab'), el('hw-theme-toggle', {})),
      el(
        'p',
        { class: 'lede' },
        'RTS games keep thousands of units in sync by sending only player inputs and running the same simulation on every machine. That only works if the simulation is perfectly deterministic. Run simulated clients side by side over a fake network, switch on a source of nondeterminism, and watch the per-tick state hashes split. Then compare input-delay lockstep with rollback, and fix broken step functions until they survive 10,000 ticks.',
      ),
    ),
    el('section', { class: 'card' }, el('h2', {}, 'Scenarios'), el('div', { class: 'presets' }, ...presetButtons.map((x) => x.b)), blurb),
    el('section', { class: 'card' }, el('div', { class: 'controls' }, netcode, network, nondet, match)),
    el(
      'section',
      { class: 'card' },
      el('div', { class: 'transport row' }, playBtn, resetBtn, el('label', {}, 'Speed ', speedSel), el('label', { class: 'check' }, ghostBox, ' Ghost of client A'), checkBtn, clock),
      panes,
    ),
    el(
      'div',
      { class: 'grid' },
      el('section', { class: 'card' }, el('h2', {}, 'State hashes'), status, strip, el('p', { class: 'small muted' }, 'One bar per confirmed tick, newest on the right: green when every client produced the same hash.'), diffBox),
      el('section', { class: 'card' }, el('h2', {}, 'Cost over time'), timelineTitle, timeline, timelineLegend),
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, 'Lockstep vs rollback'),
      el(
        'p',
        { class: 'small muted' },
        'Sweeps the input delay from 0 to 8 ticks for both models on the network configured above. Lockstep hides latency behind input delay and stalls when that is not enough; rollback runs ahead on predicted input and re-simulates when a prediction was wrong.',
      ),
      el('div', { class: 'row' }, sweepBtn),
      sweepNote,
      el('div', { class: 'pair' }, el('div', {}, el('h3', {}, 'Input lag'), lagChart), el('div', {}, el('h3', {}, 'Cost'), costChart)),
      el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'background:var(--p0)' }), 'Lockstep'), el('span', {}, el('i', { style: 'background:var(--p1)' }), 'Rollback (dashed)')),
      sweepTable,
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, 'Make it deterministic'),
      el(
        'p',
        { class: 'small muted' },
        `Edit the body of step(world, api, Math). The grader runs it on ${MACHINES.map((m) => m.name).join(' and ')} for 10,000 ticks and hashes the world after every tick. Portable tools: api.rng(), api.dt, api.fsin / api.fcos, api.sortedUnits(). Your code runs in a Web Worker in your browser.`,
      ),
      el('div', { class: 'row' }, exSel),
      exBrief,
      exCode,
      el('div', { class: 'row', style: 'margin-top:10px' }, runBtn, hintBtn, starterBtn, solutionBtn),
      exHint,
      exResult,
    ),
    el(
      'section',
      { class: 'card prose' },
      el('h2', {}, 'How the lab works'),
      el('p', {}, 'Each client is a full copy of a tiny RTS: idle units wander using the game RNG, commanded units walk to a target, and overlapping units push each other apart one pair at a time. Every millisecond of simulated time the fake network delivers due packets and each client whose display frame is due runs: it samples its local input for tick t + delay, sends every input the peer has not acknowledged (so lost packets are covered by the next one), and advances.'),
      el('ul', {},
        el('li', {}, el('strong', {}, 'Lockstep'), ' runs tick t only when it holds every player\'s input for t. When an input is late the client stalls and the game clock waits with it.'),
        el('li', {}, el('strong', {}, 'Rollback'), ' predicts that a missing remote player issued no new command, runs ahead (up to the prediction limit), and when the real input arrives and differs, restores the snapshot from that tick and re-simulates to the present.'),
        el('li', {}, 'A tick is ', el('em', {}, 'confirmed'), ' once all inputs up to it are real. Its state hash (FNV-1a over every unit field, the RNG state and the tick, in id order) is what the clients would exchange to detect a desync; the lab compares them directly and keeps 256 confirmed states per client for the diff.'),
        el('li', {}, 'Platforms differ only where you switch it on. Client B on "different platforms" keeps float intermediates in double precision and uses a polynomial libm; JavaScript\'s own arithmetic is the same on every engine, so this models what bites C and C++ games.'),
      ),
    ),
    el('footer', { class: 'small muted' },
      'Source: ', el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/lockstep-lab' }, 'Claude-capstone/lockstep-lab'),
      '. Idea: ', el('a', { href: 'https://github.com/pisanuw/daily-project-ideas' }, 'daily-project-ideas'), ' (2026-10-12). Everything runs in your browser.'),
  );

  function restart(): void {
    session = new Session(copy(config));
    for (const { p, b } of presetButtons) b.setAttribute('aria-pressed', String(p.id === activePreset));
    const preset = PRESETS.find((p) => p.id === activePreset);
    blurb.textContent = preset ? preset.blurb : 'Custom settings.';
    buildPanes();
    renderDiff();
    renderAll(true);
  }

  function renderAll(force = false): void {
    session.clients.forEach((_, i) => {
      drawPane(i);
      paneStats(i);
    });
    renderSync();
    clock.textContent = `${fmt(session.now / 1000)} s simulated`;
    const now = performance.now();
    if (force || now - lastChart > 500) {
      lastChart = now;
      renderTimeline();
    }
  }

  let shownDesync = false;
  let prevFrame = performance.now();
  function frame(t: number): void {
    const dt = Math.min(50, t - prevFrame);
    prevFrame = t;
    if (playing && !checking) session.advance(Math.max(1, Math.round(dt * speed)));
    if (!!session.desync !== shownDesync) {
      shownDesync = !!session.desync;
      renderDiff();
    }
    renderAll();
    requestAnimationFrame(frame);
  }

  async function runCheck(): Promise<void> {
    if (checking) return;
    checking = true;
    checkBtn.disabled = true;
    const target = session.compared + CHECK_TICKS;
    const stopAt = session.now + CHECK_TICKS * config.tickMs * 20;
    while (session.compared < target && !session.desync && session.now < stopAt) {
      const t0 = performance.now();
      while (performance.now() - t0 < 30 && session.compared < target && !session.desync) session.advance(config.tickMs * 4);
      clock.textContent = `Checking: ${session.compared.toLocaleString('en-US')} / ${target.toLocaleString('en-US')} ticks`;
      await new Promise((r) => setTimeout(r, 0));
    }
    checking = false;
    checkBtn.disabled = false;
    renderDiff();
  }

  window.addEventListener('resize', () => {
    renderAll(true);
    renderSweep();
  });

  // The canvases read the colour tokens as they draw: draw them all again when the theme changes, and at once on
  // the way into print and back. Print takes the light set, but a canvas keeps the pixels it drew on screen, and
  // the next frame would come after the printout (matchMedia('print') changes with the print colours in place).
  const redraw = (): void => {
    renderAll(true);
    renderSweep();
  };
  document.addEventListener('hw-themechange', redraw);
  if (typeof window.matchMedia === 'function') window.matchMedia('print').addEventListener?.('change', redraw);

  loadExercise();
  restart();
  requestAnimationFrame(frame);
}
