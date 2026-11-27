// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { PolicyError, compilePolicy, policyHash } from './core/compile';
import {
  LEADERBOARD_KEY,
  addEntry,
  mergeBoards,
  parseBoard,
  rank,
  score,
  toCsv,
} from './core/leaderboard';
import { METRIC_COLUMNS, formatMetric } from './core/metrics';
import { POLICIES, PRELUDE, policyById } from './core/policies';
import { ScenarioError, expandScenario, parseScenario } from './core/scenario';
import { SCENARIOS, scenarioSpecById } from './core/scenarios';
import { decodeShare, encodeShare } from './core/share';
import type { Metrics, ScenarioSpec, SimResult } from './core/types';
import { renderBuilding } from './ui/building';
import { renderDiskView } from './ui/diskview';
import { runInWorker } from './ui/runner';

// ---------------------------------------------------------------------------
// Tiny DOM helpers

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((ev: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// State

interface RunSlot {
  label: string;
  code: string;
  result: SimResult | null;
}

const state = {
  spec: SCENARIOS[1] as ScenarioSpec,
  scenario: expandScenario(SCENARIOS[1]),
  customSpec: null as ScenarioSpec | null,
  presetId: 'look',
  view: 'building' as 'building' | 'disk',
  a: { label: 'LOOK', code: policyById('look')!.source, result: null } as RunSlot,
  b: { label: '', code: '', result: null } as RunSlot,
  compareId: 'none',
  t: 0,
  playing: false,
  speed: 3,
  board: parseBoard(localStorage.getItem(LEADERBOARD_KEY)),
};

const CUSTOM_ID = '__custom__';

// ---------------------------------------------------------------------------
// Scenario panel

const scenarioSelect = h('select', { 'aria-label': 'Scenario', onchange: () => selectScenario(scenarioSelect.value) });
const scenarioDesc = h('p', { class: 'scenario-desc' });
const scenarioFacts = h('div', { class: 'facts' });
const scenarioJson = h('textarea', { rows: '10', spellcheck: 'false', 'aria-label': 'Scenario JSON' });
const scenarioError = h('div', { class: 'error' });
const requestList = h('details', {}, h('summary', {}, 'Request list'), h('pre', { tabindex: '0', role: 'region', 'aria-label': 'Request list' }));
const hiddenNote = h('p', { class: 'warn hidden' }, 'Hidden grading scenario: the request list and generator are not shown. Scores still count.');

function fillScenarioSelect(): void {
  scenarioSelect.replaceChildren(
    ...SCENARIOS.map((s) => h('option', { value: s.id }, `${s.name}${s.kind === 'disk' ? ' (disk)' : ''}`)),
  );
  if (state.customSpec) {
    scenarioSelect.append(h('option', { value: CUSTOM_ID }, `Custom: ${state.customSpec.name || state.customSpec.id}`));
  }
  scenarioSelect.value = state.spec === state.customSpec ? CUSTOM_ID : state.spec.id;
}

function describeScenario(): void {
  const sc = state.scenario;
  scenarioDesc.textContent = sc.description;
  const isDisk = sc.kind === 'disk';
  const fact = (k: string, v: string | number): HTMLElement => h('span', {}, `${k} `, h('b', {}, String(v)));
  scenarioFacts.replaceChildren();
  scenarioFacts.append(
    ...[
    fact(isDisk ? 'cylinders' : 'floors', sc.floors),
    isDisk ? fact('head at', sc.initialFloor[0]) : fact('cars', sc.cars),
    isDisk ? null : fact('capacity', sc.capacity),
    isDisk ? null : fact('door time', `${sc.doorTime} ticks`),
    fact(isDisk ? 'requests' : 'passengers', sc.passengers.length),
    isDisk ? null : fact('max time', `${sc.maxTime} ticks`),
    fact('initial direction', sc.initialDirection > 0 ? 'up' : 'down'),
    sc.hidden ? h('span', { class: 'badge' }, 'hidden') : null,
    ].filter((x): x is HTMLElement => x !== null),
  );
  hiddenNote.classList.toggle('hidden', !sc.hidden);
  scenarioJson.value = sc.hidden ? '' : JSON.stringify(state.spec, null, 2);
  scenarioJson.disabled = sc.hidden;
  requestList.classList.toggle('hidden', sc.hidden);
  const pre = requestList.querySelector('pre')!;
  const lines = sc.passengers.slice(0, 200).map((p) => (isDisk ? `cylinder ${p.from}` : `t=${p.t}  floor ${p.from} → ${p.to}`));
  if (sc.passengers.length > 200) lines.push(`… and ${sc.passengers.length - 200} more`);
  pre.textContent = lines.join('\n');
  scenarioError.textContent = '';
}

function setScenario(spec: ScenarioSpec): void {
  state.spec = spec;
  state.scenario = expandScenario(spec);
  state.a.result = null;
  state.b.result = null;
  stopPlayback();
  fillScenarioSelect();
  describeScenario();
  renderViz();
  renderMetrics();
  renderBoard();
}

function selectScenario(id: string): void {
  if (id === CUSTOM_ID && state.customSpec) setScenario(state.customSpec);
  else setScenario(scenarioSpecById(id) ?? SCENARIOS[0]);
}

function applyScenarioJson(): void {
  try {
    const sc = parseScenario(scenarioJson.value);
    const spec = JSON.parse(scenarioJson.value) as ScenarioSpec;
    const builtin = scenarioSpecById(sc.id);
    if (builtin && JSON.stringify(builtin) === JSON.stringify(spec)) {
      setScenario(builtin);
      return;
    }
    state.customSpec = spec;
    setScenario(spec);
  } catch (e) {
    scenarioError.textContent = e instanceof ScenarioError ? `Scenario: ${e.message}` : String(e);
  }
}

const scenarioPanel = h(
  'section',
  { class: 'panel' },
  h('h2', {}, 'Scenario'),
  h('div', { class: 'row' }, scenarioSelect),
  scenarioDesc,
  scenarioFacts,
  hiddenNote,
  requestList,
  h(
    'details',
    {},
    h('summary', {}, 'Edit scenario JSON (instructors)'),
    h(
      'p',
      { class: 'muted' },
      'Buildings: floors, cars, capacity, doorTime, maxTime, initialFloor, initialDirection, passengers [{t, from, to}], generate {seed, count, start, end, pattern: up-peak | down-peak | lunch | interfloor, floorRange, lobby}. Disks: kind "disk", cylinders, head, initialDirection, requests [...] or generate {seed, count}. Add "hidden": true for a grading scenario whose requests students cannot see, then share the link.',
    ),
    scenarioJson,
    h(
      'div',
      { class: 'row' },
      h('button', { onclick: applyScenarioJson }, 'Apply'),
      h('button', { onclick: () => download(`${state.scenario.id}.json`, JSON.stringify(state.spec, null, 2), 'application/json') }, 'Download JSON'),
    ),
    scenarioError,
  ),
);

// ---------------------------------------------------------------------------
// Policy panel

const presetSelect = h('select', { 'aria-label': 'Policy preset', onchange: () => loadPreset(presetSelect.value) });
presetSelect.replaceChildren(
  ...POLICIES.map((p) => h('option', { value: p.id, title: p.summary }, p.name)),
  h('option', { value: 'custom' }, 'Custom (edited)'),
);
const codeArea = h('textarea', { rows: '20', spellcheck: 'false', 'aria-label': 'Policy source' });
codeArea.value = state.a.code;
codeArea.addEventListener('input', () => {
  state.a.code = codeArea.value;
  const match = POLICIES.find((p) => p.source === codeArea.value);
  state.presetId = match ? match.id : 'custom';
  state.a.label = match ? match.name : 'Custom';
  presetSelect.value = state.presetId;
});
const compareSelect = h('select', { 'aria-label': 'Compare with', onchange: () => (state.compareId = compareSelect.value) });
compareSelect.replaceChildren(
  h('option', { value: 'none' }, 'nothing'),
  ...POLICIES.map((p) => h('option', { value: p.id }, p.name)),
);
const runButton = h('button', { class: 'primary', onclick: () => void runAll() }, 'Run');
const runStatus = h('div', { class: 'muted' });
const nameInput = h('input', { type: 'text', placeholder: 'your name', 'aria-label': 'Your name for the leaderboard' });
nameInput.value = localStorage.getItem('elevator-lab-name') ?? '';
const saveButton = h('button', { onclick: saveToBoard, disabled: true }, 'Save to leaderboard');

function loadPreset(id: string): void {
  const p = policyById(id);
  if (!p) return;
  state.presetId = id;
  state.a.code = p.source;
  state.a.label = p.name;
  codeArea.value = p.source;
}

const policyPanel = h(
  'section',
  { class: 'panel' },
  h('h2', {}, 'Dispatch policy'),
  h('div', { class: 'row' }, h('label', {}, 'Start from'), presetSelect),
  codeArea,
  h(
    'div',
    { class: 'row' },
    runButton,
    h('label', {}, 'compare with'),
    compareSelect,
  ),
  runStatus,
  h('div', { class: 'row' }, nameInput, saveButton),
);

// ---------------------------------------------------------------------------
// Visualisation panel

const vizGrid = h('div', { class: 'viz' });
const slider = h('input', { type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Time' });
slider.addEventListener('input', () => {
  stopPlayback();
  state.t = Number(slider.value);
  renderFrame();
});
const timeLabel = h('span', { class: 'time' }, 't = 0');
const playButton = h('button', { onclick: () => (state.playing ? stopPlayback() : startPlayback()) }, 'Play');
const speedSelect = h('select', { 'aria-label': 'Speed', onchange: () => (state.speed = Number(speedSelect.value)) });
speedSelect.replaceChildren(
  ...[1, 3, 10, 30].map((s) => h('option', { value: String(s) }, `${s}×`)),
);
speedSelect.value = '3';
const buildingButton = h('button', { class: 'active', onclick: () => setView('building') }, 'Building');
const diskButton = h('button', { onclick: () => setView('disk') }, 'Disk view');
const vizTitle = h('div', { class: 'muted' }, 'Press Run to simulate.');
const metricsTable = h('table', {});

function setView(v: 'building' | 'disk'): void {
  state.view = v;
  buildingButton.classList.toggle('active', v === 'building');
  diskButton.classList.toggle('active', v === 'disk');
  renderViz();
}

let raf = 0;
let lastTick = 0;
function startPlayback(): void {
  if (maxT() === 0) return;
  if (state.t >= maxT()) state.t = 0;
  state.playing = true;
  playButton.textContent = 'Pause';
  lastTick = performance.now();
  const step = (now: number): void => {
    if (!state.playing) return;
    const ticksPerSecond = 10 * state.speed;
    const advance = Math.floor(((now - lastTick) / 1000) * ticksPerSecond);
    if (advance > 0) {
      lastTick += (advance / ticksPerSecond) * 1000;
      state.t = Math.min(maxT(), state.t + advance);
      renderFrame();
      if (state.t >= maxT()) {
        stopPlayback();
        return;
      }
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function stopPlayback(): void {
  state.playing = false;
  playButton.textContent = 'Play';
  cancelAnimationFrame(raf);
}

function slots(): RunSlot[] {
  return state.b.result ? [state.a, state.b] : [state.a];
}
function maxT(): number {
  return Math.max(0, ...slots().map((s) => (s.result ? s.result.frames.length - 1 : 0)));
}

const svgs: SVGSVGElement[] = [];
function renderViz(): void {
  svgs.length = 0;
  const list = slots();
  vizGrid.classList.toggle('compare', list.length > 1);
  vizGrid.replaceChildren(
    ...list.map((slot) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${slot.label} on ${state.scenario.name}`);
      svgs.push(svg);
      return h('div', { class: 'viz-card' }, h('div', { class: 'title' }, slot.label || 'Policy'), svg);
    }),
  );
  slider.max = String(maxT());
  if (state.t > maxT()) state.t = maxT();
  renderFrame();
}

function renderFrame(): void {
  slider.value = String(state.t);
  timeLabel.textContent = `t = ${state.t}`;
  const list = slots();
  const wide = list.length > 1 ? 440 : 760;
  list.forEach((slot, i) => {
    const svg = svgs[i];
    if (!svg) return;
    const sc = state.scenario;
    if (!slot.result) {
      renderBuilding(svg, sc, { t: 0, cars: sc.initialFloor.map((f) => ({ floor: f, direction: 0, target: null, doors: false, load: 0 })), waiting: new Array<number>(sc.floors).fill(0) }, 320);
      return;
    }
    const t = Math.min(state.t, slot.result.frames.length - 1);
    if (state.view === 'disk') renderDiskView(svg, slot.result, t, wide);
    else renderBuilding(svg, sc, slot.result.frames[t], Math.min(360, 120 + sc.cars * 50));
  });
}

function renderMetrics(): void {
  const list = slots().filter((s) => s.result);
  if (list.length === 0) {
    metricsTable.replaceChildren();
    return;
  }
  const isDisk = state.scenario.kind === 'disk';
  const head = h('tr', {}, h('th', {}, 'Metric'), ...list.map((s) => h('th', { class: 'num' }, s.label)));
  const rows = METRIC_COLUMNS.filter((c) => !(isDisk && (c.key === 'meanRide' || c.key === 'stops'))).map((c) => {
    const values = list.map((s) => (s.result as SimResult).metrics[c.key]);
    const best = c.lowerIsBetter ? Math.min(...values) : Math.max(...values);
    const worst = c.lowerIsBetter ? Math.max(...values) : Math.min(...values);
    return h(
      'tr',
      {},
      h('td', {}, (isDisk && c.diskLabel) || c.label),
      ...values.map((v) => {
        let cls = 'num';
        if (values.length > 1 && best !== worst) cls += v === best ? ' better' : v === worst ? ' worse' : '';
        return h('td', { class: cls }, formatMetric(c.key, v), c.unit ? h('span', { class: 'unit' }, isDisk && c.key === 'energy' ? 'cylinders' : c.unit) : null);
      }),
    );
  });
  metricsTable.replaceChildren(h('thead', {}, head), h('tbody', {}, ...rows));
}

const vizPanel = h(
  'section',
  { class: 'panel' },
  h('div', { class: 'row' }, h('h2', { style: 'margin:0' }, 'Run'), h('span', { class: 'spacer', style: 'flex:1' }), buildingButton, diskButton),
  vizTitle,
  h('div', { class: 'playbar' }, playButton, slider, speedSelect, timeLabel),
  vizGrid,
  h('h3', {}, 'Metrics'),
  // Focusable, so a keyboard can scroll a table that is wider than the screen.
  h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Metrics' }, metricsTable),
  h(
    'p',
    { class: 'muted' },
    'Wait = ticks from request to boarding (a passenger still waiting at the end counts until max time). Energy = floors travelled by all cars; on a disk that is total head movement, the textbook number. Disk stops cost no time, so finish time equals head movement there.',
  ),
);

// ---------------------------------------------------------------------------
// Running

async function runOne(slot: RunSlot): Promise<void> {
  slot.result = await runInWorker(state.scenario, slot.code);
}

async function runAll(): Promise<void> {
  stopPlayback();
  runButton.disabled = true;
  runStatus.className = 'muted';
  runStatus.textContent = 'Running…';
  saveButton.disabled = true;
  try {
    compilePolicy(state.a.code);
  } catch (e) {
    runStatus.className = 'error';
    runStatus.textContent = e instanceof PolicyError ? e.message : String(e);
    runButton.disabled = false;
    return;
  }
  const started = performance.now();
  try {
    state.b.result = null;
    await runOne(state.a);
    if (state.compareId !== 'none') {
      const p = policyById(state.compareId)!;
      state.b = { label: p.name, code: p.source, result: null };
      await runOne(state.b);
    }
  } catch (e) {
    state.a.result = state.a.result ?? null;
    runStatus.className = 'error';
    runStatus.textContent = e instanceof Error ? e.message : String(e);
    runButton.disabled = false;
    renderViz();
    renderMetrics();
    return;
  }
  const ms = Math.round(performance.now() - started);
  const r = state.a.result as SimResult;
  const parts = [`${r.decisions} decisions, ${r.frames.length - 1} ticks, ${ms} ms`];
  if (r.error) parts.push(`Policy error: ${r.error}`);
  if (r.warnings.length) parts.push(`${r.warnings.length} ignored return value(s): ${r.warnings[0]}`);
  runStatus.className = r.error ? 'error' : r.warnings.length ? 'warn' : 'muted';
  runStatus.textContent = parts.join(' · ');
  vizTitle.textContent = `${state.a.label} on ${state.scenario.name}${state.b.result ? ` vs ${state.b.label}` : ''}`;
  saveButton.disabled = Boolean(r.error);
  runButton.disabled = false;
  state.t = 0;
  renderViz();
  renderMetrics();
  startPlayback();
}

// ---------------------------------------------------------------------------
// Leaderboard

const boardTable = h('table', {});
const boardNote = h('p', { class: 'muted' });

function persistBoard(): void {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(state.board));
}

function saveToBoard(): void {
  const r = state.a.result;
  if (!r || r.error) return;
  const name = nameInput.value.trim() || 'anonymous';
  localStorage.setItem('elevator-lab-name', name);
  state.board = addEntry(state.board, {
    name,
    scenarioId: state.scenario.id,
    policyHash: policyHash(state.a.code),
    policyName: state.a.label,
    metrics: r.metrics,
    at: new Date().toISOString(),
  });
  persistBoard();
  renderBoard();
}

function renderBoard(): void {
  const rows = rank(state.board, state.scenario.id);
  boardNote.textContent = rows.length
    ? `${rows.length} run(s) on ${state.scenario.name}. Score = mean wait + ¼ max wait + 1000 per unserved passenger; lower is better.`
    : `No saved runs on ${state.scenario.name} yet. Run a policy, then "Save to leaderboard".`;
  const cell = (m: Metrics, k: keyof Metrics): HTMLElement => h('td', { class: 'num' }, formatMetric(k, m[k]));
  boardTable.replaceChildren(
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, '#'),
        h('th', {}, 'Name'),
        h('th', {}, 'Policy'),
        h('th', { class: 'num' }, 'Score'),
        h('th', { class: 'num' }, 'Mean wait'),
        h('th', { class: 'num' }, 'p95'),
        h('th', { class: 'num' }, 'Max'),
        h('th', { class: 'num' }, 'Energy'),
        h('th', { class: 'num' }, 'Unserved'),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((e, i) =>
        h(
          'tr',
          {},
          h('td', {}, String(i + 1)),
          h('td', {}, e.name),
          h('td', {}, e.policyName, h('span', { class: 'badge', title: 'policy hash' }, e.policyHash)),
          h('td', { class: 'num' }, score(e.metrics).toFixed(1)),
          cell(e.metrics, 'meanWait'),
          cell(e.metrics, 'p95Wait'),
          cell(e.metrics, 'maxWait'),
          cell(e.metrics, 'energy'),
          cell(e.metrics, 'unserved'),
        ),
      ),
    ),
  );
}

const importInput = h('input', { type: 'file', accept: 'application/json', class: 'hidden' });
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  state.board = mergeBoards(state.board, parseBoard(await file.text()));
  persistBoard();
  renderBoard();
  importInput.value = '';
});

const boardPanel = h(
  'section',
  { class: 'panel' },
  h('h2', {}, 'Class leaderboard'),
  boardNote,
  h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Class leaderboard' }, boardTable),
  h(
    'div',
    { class: 'row', style: 'margin-top:8px' },
    h('button', { onclick: () => download('elevator-lab-leaderboard.csv', toCsv(state.board), 'text/csv') }, 'Export CSV'),
    h('button', { onclick: () => download('elevator-lab-leaderboard.json', JSON.stringify(state.board, null, 2), 'application/json') }, 'Export JSON'),
    h('button', { onclick: () => importInput.click() }, 'Import JSON'),
    h(
      'button',
      {
        onclick: () => {
          if (confirm('Clear every saved run in this browser?')) {
            state.board = [];
            persistBoard();
            renderBoard();
          }
        },
      },
      'Clear',
    ),
    importInput,
  ),
  h(
    'p',
    { class: 'muted' },
    'The board stores only names, scores and an 8-character hash of the policy, never the code. It lives in this browser; export it and import classmates’ files to build the class table, or collect the CSVs.',
  ),
);

// ---------------------------------------------------------------------------
// API panel

const apiPanel = h(
  'section',
  { class: 'panel api hidden' },
  h('h2', {}, 'Policy API'),
  h('p', {}, 'Define ', h('code', {}, 'function dispatch(car, state)'), '. It is called whenever a car is idle or has just finished a stop, and must return the next floor to go to (an integer) or ', h('code', {}, 'null'), ' to stay. Travelling to a floor does not stop at floors in between: if you want to serve them, return them first. Top-level variables keep their values between calls, for policies that remember a sweep direction.'),
  h('h3', {}, 'car'),
  h('ul', {}, ...[
    ['id', 'index of this car (0-based)'],
    ['floor', 'current floor'],
    ['direction', '1 up, -1 down, 0 before the first move'],
    ['target', 'floor it was heading to, or null'],
    ['load, capacity', 'passengers aboard and the maximum'],
    ['stops', 'destinations of passengers aboard: [{ floor, count, since, seq }]'],
  ].map(([k, v]) => h('li', {}, h('code', {}, k), ` ${v}`))),
  h('h3', {}, 'state'),
  h('ul', {}, ...[
    ['time', 'current tick'],
    ['floors', 'number of floors (or cylinders); valid targets are 0 .. floors-1'],
    ['initialDirection', '1 or -1, the direction a car reports before it has moved'],
    ['cars', 'every car, in the same shape as car (use this to avoid two cars chasing one call)'],
    ['hallCalls', 'people waiting: [{ floor, direction, count, since, seq }], grouped by floor and direction. Calls on this car’s own floor that it could not take just now (going the other way) are left out.'],
  ].map(([k, v]) => h('li', {}, h('code', {}, k), ` ${v}`))),
  h('h3', {}, 'Helpers (prepended to your code)'),
  h('pre', { tabindex: '0', role: 'region', 'aria-label': 'Helpers prepended to your code' }, PRELUDE.trim()),
  h('h3', {}, 'Rules of the building'),
  h('ul', {},
    h('li', {}, 'One tick moves a car one floor. A stop where anyone boards or alights keeps the doors open for the scenario’s door time (0 on disks).'),
    h('li', {}, 'At a stop, passengers going the car’s way board first; an empty car takes anyone, up to capacity.'),
    h('li', {}, 'A run ends when everyone has been delivered or at max time; undelivered passengers count as unserved and their wait runs to max time.'),
    h('li', {}, 'The policy runs in a Web Worker and is killed after 8 seconds, so an infinite loop only costs you a Run.'),
  ),
);

// ---------------------------------------------------------------------------
// Header, sharing, boot

const shareStatus = h('span', { class: 'muted' });

async function share(): Promise<void> {
  const payload = state.spec === state.customSpec && state.customSpec
    ? { scenario: state.customSpec, code: state.a.code }
    : { scenarioId: state.scenario.id, code: state.a.code };
  const frag = await encodeShare(payload);
  const url = `${location.origin}${location.pathname}#${frag}`;
  history.replaceState(null, '', `#${frag}`);
  try {
    await navigator.clipboard.writeText(url);
    shareStatus.textContent = `Link copied (${url.length} characters).`;
  } catch {
    shareStatus.textContent = 'Link is in the address bar.';
  }
}

const apiButton = h('button', { onclick: () => {
  apiPanel.classList.toggle('hidden');
  apiButton.classList.toggle('active');
} }, 'Policy API');

document.getElementById('app')!.replaceChildren(
  h(
    'header',
    {},
    h('div', { class: 'title-row' }, h('h1', {}, 'Elevator Algorithm Lab'), h('hw-theme-toggle')),
    h('p', {}, 'Write a dispatch policy, run it against seeded traffic, and flip to the disk view: FCFS, SSTF, SCAN and LOOK were elevator algorithms all along.'),
    h('div', { class: 'toolbar' }, apiButton, h('button', { onclick: () => void share() }, 'Share link'), shareStatus),
  ),
  h(
    'main',
    {},
    h('div', { class: 'stack' }, scenarioPanel, policyPanel),
    h('div', { class: 'stack' }, apiPanel, vizPanel, boardPanel),
  ),
  h(
    'footer',
    {},
    'Everything runs in your browser; nothing is uploaded. Scenarios replay identically for a seed. ',
    h('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/elevator-algorithm-lab' }, 'Source and README'),
    '.',
  ),
);

async function boot(): Promise<void> {
  const payload = location.hash.length > 1 ? await decodeShare(location.hash) : null;
  if (payload?.scenario) {
    try {
      expandScenario(payload.scenario);
      state.customSpec = payload.scenario;
      state.spec = payload.scenario;
      state.scenario = expandScenario(payload.scenario);
    } catch (e) {
      scenarioError.textContent = `Shared scenario ignored: ${(e as Error).message}`;
    }
  } else if (payload?.scenarioId) {
    const s = scenarioSpecById(payload.scenarioId);
    if (s) {
      state.spec = s;
      state.scenario = expandScenario(s);
    }
  }
  if (payload?.code) {
    codeArea.value = payload.code;
    codeArea.dispatchEvent(new Event('input'));
  }
  presetSelect.value = state.presetId;
  fillScenarioSelect();
  describeScenario();
  renderViz();
  renderBoard();
}

void boot();
