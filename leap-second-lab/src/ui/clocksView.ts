import { CLOCKS, type ClockKind, clockDrift, clockInfo, readClock, smearRate } from '../core/clocks';
import { type LogConfig, simulateLog } from '../core/eventlog';
import { HISTORICAL_TABLE, type LeapEntry, findLeap, formatPosix, formatTai, offsetAt, withExtraLeap } from '../core/leaps';
import { lineChart, type Series } from './chart';
import { clear, field, h, numberInput, select } from './dom';

interface Scenario {
  id: 'insert' | 'remove';
  label: string;
  table: readonly LeapEntry[];
  leap: LeapEntry;
}

const NEG = withExtraLeap({ date: '2029-12-31', sign: -1 });
const SCENARIOS: Scenario[] = [
  { id: 'insert', label: '2016-12-31: inserted second (23:59:60)', table: HISTORICAL_TABLE, leap: findLeap(HISTORICAL_TABLE, '2016-12-31') as LeapEntry },
  { id: 'remove', label: 'Hypothetical 2029-12-31: removed second (no 23:59:59)', table: NEG, leap: findLeap(NEG, '2029-12-31') as LeapEntry },
];

const COLORS: Record<ClockKind, string> = {
  step: 'var(--c-step)',
  smear24: 'var(--c-smear)',
  utcsls: 'var(--c-sls)',
  monotonic: 'var(--c-mono)',
  tai: 'var(--c-tai)',
};

/** tai at which the leap "happens": start of 23:59:60, or the instant 23:59:59 is skipped. */
function leapInstant(sc: Scenario): number {
  return sc.leap.sign === 1 ? sc.leap.nextMidnight + sc.leap.before : sc.leap.taiAt;
}

export function clocksView(): HTMLElement {
  let sc = SCENARIOS[0];
  const cfg: LogConfig = { clockA: 'step', clockB: 'smear24', spanSeconds: 3, meanGapMs: 40, latencyMs: 3, serviceMs: 8, resolutionMs: 1, seed: 2016 };

  const driftSeries = (): Series[] =>
    (['step', 'smear24', 'utcsls', 'monotonic'] as ClockKind[]).map((k) => ({
      name: clockInfo(k).name,
      color: COLORS[k],
      step: k === 'step',
      dash: k === 'monotonic' ? '6 4' : undefined,
      fn: (x: number) => clockDrift(k, leapInstant(sc) + x, sc.leap, sc.table),
    }));

  const chart = lineChart(driftSeries(), {
    xMin: -5,
    xMax: 5,
    xLimit: [-60000, 60000],
    minSpan: 0.5,
    yLabel: 'clock − UTC(old offset), s',
    yRange: [-1.25, 1.25],
    height: 260,
    xFormat: (x) => {
      const a = Math.abs(x);
      if (a >= 3600) return `${(x / 3600).toFixed(1)} h`;
      if (a >= 60) return `${(x / 60).toFixed(0)} min`;
      return `${Number(x.toFixed(2))} s`;
    },
    markers: () => [{ x: 0, label: 'The leap second' }],
  });

  const presets = h(
    'div',
    { class: 'button-row' },
    h('button', { type: 'button', class: 'small', onclick: () => chart.setRange(-5, 5) }, '±5 s'),
    h('button', { type: 'button', class: 'small', onclick: () => chart.setRange(-1500, 300) }, 'Last 25 min'),
    h('button', { type: 'button', class: 'small', onclick: () => chart.setRange(-50000, 50000) }, '±14 h'),
  );

  // Clock readings at an instant chosen with a slider.
  const slider = h('input', { type: 'range', min: '-3', max: '3', step: '0.05', value: '0.25', 'aria-label': 'Seconds from the leap second' });
  const readings = h('table', { class: 'readings' });
  const drawReadings = () => {
    clear(readings);
    const t = leapInstant(sc) + Number(slider.value);
    readings.append(h('caption', {}, `True instant: ${formatTai(t, sc.table)}Z (${Number(slider.value) >= 0 ? '+' : ''}${Number(slider.value).toFixed(2)} s of real time)`));
    readings.append(h('tr', {}, h('th', {}, 'Clock'), h('th', {}, 'Reads'), h('th', {}, 'Off UTC')));
    for (const c of CLOCKS) {
      const v = readClock(c.kind, t, sc.leap, sc.table);
      const reads = c.kind === 'monotonic' ? `${v.toFixed(3)} s since boot` : c.kind === 'tai' ? `${formatPosix(v)} TAI` : formatPosix(v);
      // Distance from the true UTC reading (23:59:60.x counted as one second past :59).
      const off = v - (t - offsetAt(t, sc.table));
      readings.append(h('tr', {}, h('td', {}, h('span', { class: 'swatch', style: `background:${COLORS[c.kind]}` }), c.name), h('td', {}, h('code', {}, reads)), h('td', {}, c.kind === 'monotonic' || c.kind === 'tai' ? '—' : `${off >= 0 ? '+' : ''}${off.toFixed(3)} s`)));
    }
  };
  slider.addEventListener('input', drawReadings);

  const rates = h('p', { class: 'muted' });
  const drawRates = () => {
    const r24 = smearRate(sc.leap, 'smear24');
    const rs = smearRate(sc.leap, 'utcsls');
    rates.textContent = `During the smear one clock second lasts ${(1 / r24).toFixed(8)} SI s (24 h window, ${((1 / r24 - 1) * 1e6).toFixed(2)} ppm) or ${(1 / rs).toFixed(6)} SI s (UTC-SLS, ${((1 / rs - 1) * 1e3).toFixed(2)} ‰).`;
  };

  // Event log.
  const stats = h('div', { class: 'readouts' });
  const anomalies = h('ul', { class: 'anomalies' });
  const logTable = h('table', { class: 'log' });
  const clockOptions = CLOCKS.map((c) => ({ value: c.kind, label: c.name }));
  const runLog = () => {
    const r = simulateLog(cfg, sc.leap, sc.table);
    clear(stats);
    const count = (k: string) => r.anomalies.filter((a) => a.kind === k).length;
    const stat = (label: string, value: string | number, bad: boolean) => h('div', { class: `stat ${bad ? 'bad' : 'good'}` }, h('span', { class: 'stat-label' }, label), h('strong', {}, String(value)));
    stats.append(
      stat('Requests', r.requests, false),
      stat('Out-of-order pairs in the merged log', r.inversions.toLocaleString('en-US'), r.inversions > 0),
      stat('Received before sent', count('causality'), count('causality') > 0),
      stat('A clock ran backwards', count('backwards'), count('backwards') > 0),
      stat('Round trips mismeasured by A', r.badRtt, r.badRtt > 0),
      stat('Same stamp, different second', count('duplicate'), count('duplicate') > 0),
    );
    clear(anomalies);
    const shown = r.anomalies.slice(0, 8);
    for (const a of shown) anomalies.append(h('li', {}, a.text));
    if (r.anomalies.length > shown.length) anomalies.append(h('li', { class: 'muted' }, `… and ${r.anomalies.length - shown.length} more`));
    if (!r.anomalies.length) anomalies.append(h('li', { class: 'muted' }, 'No anomalies: every line is where it should be.'));

    clear(logTable);
    logTable.append(h('tr', {}, h('th', {}, 'Logged stamp'), h('th', {}, 'Host'), h('th', {}, 'Event'), h('th', {}, 'Really happened at'), h('th', {}, 'True #')));
    const centre = leapInstant(sc);
    const near = r.merged.filter((e) => Math.abs(e.tai - centre) < 1.2);
    const rows = near.length > 30 ? near.slice(Math.floor(near.length / 2) - 15, Math.floor(near.length / 2) + 15) : near;
    let maxSeen = -1;
    for (const e of rows) {
      const late = e.trueIndex < maxSeen;
      maxSeen = Math.max(maxSeen, e.trueIndex);
      const digits = cfg.resolutionMs >= 1000 ? 0 : 3;
      logTable.append(
        h(
          'tr',
          { class: late ? 'late' : '' },
          h('td', {}, h('code', {}, formatPosix(e.stamp, digits).slice(11))),
          h('td', {}, e.host),
          h('td', {}, `#${e.request} ${e.kind}`),
          h('td', {}, h('code', {}, formatTai(e.tai, sc.table).slice(11))),
          h('td', {}, String(e.trueIndex)),
        ),
      );
    }
  };

  const logControls = h(
    'div',
    { class: 'controls' },
    field('Host A (client) clock', select(clockOptions, cfg.clockA, (v) => { cfg.clockA = v; runLog(); })),
    field('Host B (server) clock', select(clockOptions, cfg.clockB, (v) => { cfg.clockB = v; runLog(); })),
    field('Mean gap between requests (ms)', numberInput(cfg.meanGapMs, 5, (v) => { cfg.meanGapMs = Math.max(1, v); runLog(); }, { min: 1 })),
    field('One-way latency (ms)', numberInput(cfg.latencyMs, 1, (v) => { cfg.latencyMs = Math.max(0, v); runLog(); }, { min: 0 })),
    field('Server time per request (ms)', numberInput(cfg.serviceMs, 1, (v) => { cfg.serviceMs = Math.max(0, v); runLog(); }, { min: 0 })),
    field('Stamp resolution', select([{ value: '1', label: 'milliseconds' }, { value: '1000', label: 'whole seconds' }], '1', (v) => { cfg.resolutionMs = Number(v); runLog(); })),
    field('Random seed', numberInput(cfg.seed, 1, (v) => { cfg.seed = Math.trunc(v); runLog(); })),
  );

  const scenarioSel = select(SCENARIOS.map((x) => ({ value: x.id, label: x.label })), sc.id, (v) => {
    sc = SCENARIOS.find((x) => x.id === v) as Scenario;
    chart.setSeries(driftSeries());
    drawReadings();
    drawRates();
    runLog();
  });

  drawReadings();
  drawRates();
  runLog();

  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Step vs smear vs monotonic'),
    h('p', { class: 'lede' }, 'Four ways a computer can live through one leap second. All of them agree a few hours away from it. Near it, they disagree by up to a second, and a log written by two machines with different clocks stops telling the truth about what happened first.'),
    field('Leap second', scenarioSel),
    h('h3', {}, 'How far each clock is from UTC'),
    presets,
    chart.root,
    rates,
    h('details', { class: 'clock-notes' }, h('summary', {}, 'What each clock does'), h('dl', {}, ...CLOCKS.flatMap((c) => [h('dt', {}, c.name), h('dd', {}, c.description)]))),
    h('h3', {}, 'Every clock at one instant'),
    slider,
    readings,
    h('h3', {}, 'Replay a two-host log'),
    h('p', {}, 'Host A sends requests to host B and logs send and done; B logs recv and reply. Both logs are merged by timestamp, as a log aggregator would. Rows shaded red appear after an event that really happened later.'),
    logControls,
    stats,
    anomalies,
    // Focusable, so a keyboard can scroll the log when it is wider than the screen.
    h('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Event log' }, logTable),
  );
}

