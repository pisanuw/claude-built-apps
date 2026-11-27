import { createHost, type AudioHost } from '../audio/host';
import { analyzeFilter, AUDIBLE_CENTS, decayTable, tuningTable, type FilterReport } from '../core/analysis';
import { effectiveDecay, type EngineParams, type PluckEvent } from '../core/engine';
import { harmonicsDb } from '../core/fft';
import { compileFilter, DEFAULT_FILTER_SOURCE, FILTER_PRESETS, type LoopFilter } from '../core/filters';
import {
  CHORDS,
  keyAction,
  MUTE_KEY,
  noteName,
  OPEN_STRINGS,
  pluckEvent,
  STRING_NAMES,
  stringMidi,
  STRUM_KEYS,
  strumEvents,
  TUNING_NOTES,
  midiToFrequency,
} from '../core/guitar';
import { KSString } from '../core/ks';
import { DEFAULT_SETTINGS, SCENES, type LabSettings, type Panel, type Scene, type SceneStep } from '../core/scenes';
import { el } from './dom';

const STORAGE_KEY = 'pluck-lab:v1';
const HISTORY = 4096;
const SPEEDS: [number, string][] = [
  [0, 'Real time'],
  [256, '256 samples / frame'],
  [64, '64 samples / frame'],
  [16, '16 samples / frame'],
  [6, '6 samples / frame'],
  [1, '1 sample / frame'],
];
const RATES: [number, string][] = [
  [0, 'Device default'],
  [48000, '48 kHz'],
  [44100, '44.1 kHz'],
  [22050, '22.05 kHz'],
  [16000, '16 kHz'],
  [8000, '8 kHz'],
];

interface Saved {
  settings: LabSettings;
  source: string;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      return { settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) }, source: s.source ?? DEFAULT_FILTER_SOURCE };
    }
  } catch {
    // Private mode or corrupt storage: start fresh.
  }
  return { settings: { ...DEFAULT_SETTINGS }, source: DEFAULT_FILTER_SOURCE };
}

function save(saved: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Not fatal; the lab works without persistence.
  }
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** Size a canvas for the device pixel ratio and return a context in CSS pixels. */
function prepare(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 150;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  fmt: (v: number) => string,
): { root: HTMLElement; refresh: () => void } {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
  const out = el('output', {});
  const refresh = () => {
    input.value = String(get());
    out.textContent = fmt(get());
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = fmt(Number(input.value));
  });
  refresh();
  return { root: el('label', { class: 'slider' }, el('span', {}, label), input, out), refresh };
}

function select<T extends string | number>(
  options: [T, string][],
  get: () => T,
  set: (v: T) => void,
): { root: HTMLSelectElement; refresh: () => void } {
  const s = el('select', {});
  for (const [v, text] of options) s.append(el('option', { value: String(v) }, text));
  const refresh = () => {
    s.value = String(get());
  };
  s.addEventListener('change', () => {
    const match = options.find(([v]) => String(v) === s.value);
    if (match) set(match[0]);
  });
  refresh();
  return { root: s, refresh };
}

export function mountApp(root: HTMLElement): void {
  const saved = load();
  const settings = saved.settings;
  let source = saved.source;
  let filterFn: LoopFilter = compileFilter(DEFAULT_FILTER_SOURCE).fn!;
  let report: FilterReport;
  let filterMessage = '';
  let filterOk = true;

  let host: AudioHost | null = null;
  let starting: Promise<void> | null = null;
  let audioStatus = 'Sound is off. Click anywhere or press a key to start it (browsers need a gesture first).';
  let sampleRate = settings.sampleRate || 48000;

  const mirror = new KSString(Math.ceil(96000 / 15));
  let mirrorDecay = settings.decay;
  const history = new Float32Array(HISTORY);
  let historyPos = 0;
  let paused = false;
  let seed = (Date.now() >>> 0) % 1000003;
  let lastStrum: { events: PluckEvent[]; label: string } | null = null;
  let sceneIndex = 0;

  const persist = () => save({ settings, source });

  const engineParams = (): Partial<EngineParams> => ({
    decay: settings.decay,
    weight: settings.weight,
    pickPosition: settings.pickPosition,
    fractional: settings.fractional,
    filterDelay: report.lowDelay,
    decayMode: settings.decayMode,
  });

  // ---------------------------------------------------------------- audio

  function startAudio(): Promise<void> {
    if (host) return Promise.resolve();
    if (starting) return starting;
    audioStatus = 'Starting audio...';
    renderStatus();
    starting = createHost(settings.sampleRate, (message) => {
      filterMessage = message;
      filterOk = false;
      renderFilterStatus();
    })
      .then((h) => {
        host = h;
        sampleRate = h.sampleRate;
        report = analyzeFilter(filterFn, settings, sampleRate);
        audioStatus = `Sound on: ${h.mode === 'worklet' ? 'AudioWorklet' : 'ScriptProcessor fallback'} at ${h.sampleRate} Hz.`;
        if (settings.sampleRate && settings.sampleRate !== h.sampleRate) {
          audioStatus += ` (This browser would not run at ${settings.sampleRate} Hz.)`;
        }
        h.send({ type: 'filter', source });
        h.send({ type: 'params', params: engineParams() });
      })
      .catch((err: Error) => {
        audioStatus = `Could not start audio: ${err.message}. The views still work.`;
      })
      .finally(() => {
        starting = null;
        renderStatus();
        renderPanel();
      });
    return starting;
  }

  async function restartAudio(): Promise<void> {
    if (starting) await starting;
    if (host) {
      const old = host;
      host = null;
      await old.close().catch(() => undefined);
      await startAudio();
    } else {
      sampleRate = settings.sampleRate || 48000;
      renderPanel();
    }
  }

  function sendParams(): void {
    host?.send({ type: 'params', params: engineParams() });
  }

  // ---------------------------------------------------------------- playing

  function nextSeed(): number {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  }

  function play(events: PluckEvent[], label: string): void {
    if (events.length === 0) return;
    if (!events.some((e) => e.string === settings.focus)) {
      settings.focus = events[0]!.string;
      renderStrings();
    }
    const focusEvent = events.find((e) => e.string === settings.focus)!;
    const plan = mirror.pluck({
      sampleRate,
      frequency: focusEvent.frequency,
      filterDelay: report.lowDelay,
      fractional: settings.fractional,
      pickPosition: settings.pickPosition,
      velocity: focusEvent.velocity,
      seed: focusEvent.seed,
    });
    mirrorDecay = effectiveDecay(settings, plan.actualFrequency);
    history.fill(0);
    historyPos = 0;
    if (events.length > 1) {
      lastStrum = { events, label };
      if (settings.panel === 'strum') renderPanel();
    }
    void startAudio().then(() => host?.send({ type: 'pluck', events }));
  }

  function strum(direction: 'down' | 'up'): void {
    const chord = CHORDS[settings.chord]!;
    play(strumEvents(chord, direction, settings.spreadMs, sampleRate, nextSeed()), `${chord.name} ${direction}stroke, ${settings.spreadMs} ms`);
    flash(direction === 'down' ? downBtn : upBtn);
  }

  function pluck(string: number): void {
    play([pluckEvent(CHORDS[settings.chord]!, string, nextSeed())], 'pluck');
  }

  function playNote(string: number, midi: number): void {
    play([{ string, frequency: midiToFrequency(midi), delay: 0, velocity: 0.9, seed: nextSeed() }], 'note');
  }

  function damp(): void {
    mirror.damp();
    void startAudio().then(() => host?.send({ type: 'damp' }));
  }

  function flash(node: HTMLElement): void {
    node.classList.add('hit');
    setTimeout(() => node.classList.remove('hit'), 120);
  }

  // ---------------------------------------------------------------- filter

  function applyFilter(newSource: string): boolean {
    const compiled = compileFilter(newSource);
    if (!compiled.ok) {
      filterOk = false;
      filterMessage = compiled.error!;
      renderFilterStatus();
      return false;
    }
    source = newSource;
    filterFn = compiled.fn!;
    report = analyzeFilter(filterFn, settings, sampleRate);
    filterOk = true;
    filterMessage = host ? 'Applied: the audio thread is using this filter now.' : 'Applied. Sound starts on your first pluck.';
    host?.send({ type: 'filter', source });
    sendParams();
    persist();
    renderPanel();
    return true;
  }

  // The saved filter, if it still compiles; rendering happens once the layout exists.
  const initial = compileFilter(source);
  if (initial.ok) filterFn = initial.fn!;
  else source = DEFAULT_FILTER_SOURCE;
  report = analyzeFilter(filterFn, settings, sampleRate);

  function loadPreset(id: string): void {
    const preset = FILTER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    applyFilter(preset.source);
    renderPanel();
  }

  // ---------------------------------------------------------------- settings

  /** Apply settings; returns the audio restart when the sample rate changed. */
  function update(patch: Partial<LabSettings>): Promise<void> | null {
    const rateChanged = patch.sampleRate !== undefined && patch.sampleRate !== settings.sampleRate;
    Object.assign(settings, patch);
    if (patch.decay !== undefined || patch.weight !== undefined) report = analyzeFilter(filterFn, settings, sampleRate);
    if (mirror.plan) mirrorDecay = effectiveDecay(settings, mirror.plan.actualFrequency);
    sendParams();
    persist();
    refreshControls();
    if (!rateChanged) return null;
    report = analyzeFilter(filterFn, settings, settings.sampleRate || sampleRate);
    return restartAudio();
  }

  // ---------------------------------------------------------------- layout

  const statusLine = el('p', { class: 'status' });
  const header = el(
    'header',
    {},
    el('div', { class: 'title-row' }, el('h1', {}, 'Pluck Lab'), el('hw-theme-toggle', {})),
    el(
      'p',
      { class: 'lede' },
      'A guitar you strum from the keyboard, where every note is the Karplus-Strong algorithm: a delay line of noise, a two-point average and feedback. Slow it down, watch the buffer and its harmonics, and rewrite the filter yourself.',
    ),
    statusLine,
  );

  function renderStatus(): void {
    statusLine.textContent = audioStatus;
    statusLine.classList.toggle('on', host !== null);
  }

  // Instrument
  const chordGrid = el('div', { class: 'chords' });
  const chordButtons = CHORDS.map((c, i) => {
    const b = el('button', { type: 'button', class: 'chord' }, el('kbd', {}, c.key.toUpperCase()), el('span', {}, c.name));
    b.addEventListener('click', () => {
      update({ chord: i });
      renderStrings();
    });
    chordGrid.append(b);
    return b;
  });
  const downBtn = el('button', { type: 'button', class: 'strum' }, el('kbd', {}, STRUM_KEYS.down.toUpperCase()), ' Strum down');
  const upBtn = el('button', { type: 'button', class: 'strum' }, el('kbd', {}, STRUM_KEYS.up.toUpperCase()), ' Strum up');
  const muteBtn = el('button', { type: 'button', class: 'strum quiet' }, el('kbd', {}, MUTE_KEY.toUpperCase()), ' Mute');
  downBtn.addEventListener('click', () => strum('down'));
  upBtn.addEventListener('click', () => strum('up'));
  muteBtn.addEventListener('click', damp);

  const stringList = el('div', { class: 'strings' });
  function renderStrings(): void {
    const chord = CHORDS[settings.chord]!;
    chordButtons.forEach((b, i) => b.classList.toggle('active', i === settings.chord));
    stringList.replaceChildren(
      ...[5, 4, 3, 2, 1, 0].map((s) => {
        const midi = stringMidi(chord, s);
        const row = el(
          'div',
          { class: `string${s === settings.focus ? ' focus' : ''}${midi === null ? ' muted' : ''}` },
          el('kbd', {}, String(s + 1)),
          el('span', { class: 'name' }, STRING_NAMES[s]!),
          el('span', { class: 'fret' }, midi === null ? 'x' : `fret ${chord.frets[s]}`),
          el('span', { class: 'note' }, midi === null ? '(open if plucked)' : `${noteName(midi)} · ${midiToFrequency(midi).toFixed(1)} Hz`),
        );
        const pick = el('button', { type: 'button', class: 'small' }, 'Pluck');
        pick.addEventListener('click', () => pluck(s));
        const watch = el('button', { type: 'button', class: 'small quiet', title: 'Show this string in the views' }, s === settings.focus ? 'Watching' : 'Watch');
        watch.addEventListener('click', () => {
          update({ focus: s });
          renderStrings();
        });
        row.append(pick, watch);
        return row;
      }),
    );
  }

  const spread = slider('Strum spread', 0, 100, 1, () => settings.spreadMs, (v) => update({ spreadMs: v }), (v) => `${v} ms`);
  const instrument = el(
    'section',
    { class: 'card instrument' },
    el('h2', {}, 'Instrument'),
    el('p', { class: 'hint' }, 'Home and bottom rows pick a chord, H and J strum down and up, 1 to 6 pluck one string, K or Space mutes.'),
    chordGrid,
    el('div', { class: 'strum-row' }, downBtn, upBtn, muteBtn),
    spread.root,
    stringList,
  );

  // Parameters
  const decaySlider = slider('Decay ρ', 0.95, 1, 0.0005, () => settings.decay, (v) => update({ decay: v }), (v) => v.toFixed(4));
  const weightSlider = slider('Averaging weight S', 0, 0.5, 0.01, () => settings.weight, (v) => update({ weight: v }), (v) => v.toFixed(2));
  const pickSlider = slider(
    'Pick position β',
    0,
    0.5,
    0.01,
    () => settings.pickPosition,
    (v) => update({ pickPosition: v }),
    (v) => (v === 0 ? 'off' : v.toFixed(2)),
  );
  const fractional = el('input', { type: 'checkbox' });
  fractional.addEventListener('change', () => update({ fractional: fractional.checked }));
  const decayMode = select<'natural' | 'equal'>(
    [
      ['natural', 'Natural (same ρ for every note)'],
      ['equal', 'Equal decay (ρ scaled per note)'],
    ],
    () => settings.decayMode,
    (v) => update({ decayMode: v }),
  );
  const rate = select<number>(RATES, () => settings.sampleRate, (v) => update({ sampleRate: v }));
  const params = el(
    'section',
    { class: 'card params' },
    el('h2', {}, 'Parameters'),
    decaySlider.root,
    weightSlider.root,
    pickSlider.root,
    el('label', { class: 'check' }, fractional, ' Fractional-delay tuning (allpass)'),
    el('label', { class: 'field' }, el('span', {}, 'Decay mode'), decayMode.root),
    el('label', { class: 'field' }, el('span', {}, 'Sample rate'), rate.root),
    el('p', { class: 'hint' }, 'Changes apply to the next pluck. The weight S only matters to filters that read p.weight.'),
  );

  // Views
  const bufferCanvas = el('canvas', { class: 'view tall', 'aria-label': 'Delay line contents' });
  const harmonicCanvas = el('canvas', { class: 'view', 'aria-label': 'Harmonics of the delay line' });
  const waveCanvas = el('canvas', { class: 'view short', 'aria-label': 'Output waveform' });
  const readout = el('p', { class: 'readout' });
  const speed = select<number>(SPEEDS, () => settings.speed, (v) => update({ speed: v }));
  speed.root.setAttribute('aria-label', 'Playback speed');
  const pauseBtn = el('button', { type: 'button', class: 'small' }, 'Pause');
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  });
  const step1 = el('button', { type: 'button', class: 'small quiet' }, 'Step 1');
  step1.addEventListener('click', () => advance(1));
  const stepTrip = el('button', { type: 'button', class: 'small quiet' }, 'Step one trip');
  stepTrip.addEventListener('click', () => advance(mirror.length || 1));
  const views = el(
    'section',
    { class: 'card views' },
    el('div', { class: 'view-head' }, el('h2', {}, 'Inside the string'), el('div', { class: 'view-controls' }, speed.root, pauseBtn, step1, stepTrip)),
    el('h3', {}, 'Delay line', el('small', {}, ' left: next sample out · right: just written back')),
    bufferCanvas,
    el('h3', {}, 'Harmonics of the delay line', el('small', {}, ' amplitude of each multiple of the pitch, dB')),
    harmonicCanvas,
    el('h3', {}, 'Output', el('small', {}, ' the samples leaving the line, most recent at the right')),
    waveCanvas,
    readout,
  );

  // Scenes
  const sceneTabs = el('div', { class: 'scene-tabs' });
  const sceneBody = el('div', { class: 'scene-body' });
  const scenes = el('section', { class: 'card scenes' }, el('h2', {}, 'Lecture scenes'), sceneTabs, sceneBody);

  function runStep(step: SceneStep): void {
    if (step.preset) loadPreset(step.preset);
    if (step.chord) {
      const idx = CHORDS.findIndex((c) => c.name === step.chord);
      if (idx >= 0) update({ chord: idx });
    }
    const restarting = step.set ? update(step.set) : null;
    renderStrings();
    const go = () => {
      if (!step.play) return;
      if (step.play.kind === 'strum') strum(step.play.direction);
      else if (step.play.kind === 'pluck') pluck(step.play.string);
      else playNote(step.play.string, step.play.midi);
    };
    // A sample-rate change restarts audio; wait for it so the pluck is heard at the new rate.
    if (restarting) void restarting.then(go);
    else go();
  }

  function openScene(i: number): void {
    sceneIndex = i;
    const scene: Scene = SCENES[i]!;
    if (scene.preset) loadPreset(scene.preset);
    update(scene.set);
    if (scene.set.sampleRate === undefined && settings.sampleRate !== 0 && scene.id !== 'pitch-quantized') update({ sampleRate: 0 });
    renderStrings();
    renderScene();
    renderPanel();
  }

  function renderScene(): void {
    sceneTabs.replaceChildren(
      ...SCENES.map((s, i) => {
        const b = el('button', { type: 'button', class: `tab${i === sceneIndex ? ' active' : ''}` }, String(i + 1));
        b.title = s.title;
        b.addEventListener('click', () => openScene(i));
        return b;
      }),
    );
    const scene = SCENES[sceneIndex]!;
    const steps = el('div', { class: 'steps' });
    for (const step of scene.steps) {
      const b = el('button', { type: 'button' }, step.label);
      b.addEventListener('click', () => runStep(step));
      steps.append(b);
    }
    const prev = el('button', { type: 'button', class: 'small quiet' }, '← Previous');
    const next = el('button', { type: 'button', class: 'small quiet' }, 'Next →');
    prev.disabled = sceneIndex === 0;
    next.disabled = sceneIndex === SCENES.length - 1;
    prev.addEventListener('click', () => openScene(sceneIndex - 1));
    next.addEventListener('click', () => openScene(sceneIndex + 1));
    sceneBody.replaceChildren(
      el('h3', {}, scene.title),
      ...scene.body.map((p) => el('p', {}, p)),
      steps,
      el('div', { class: 'scene-nav' }, prev, next),
    );
  }

  // Panels
  const panelTabs = el('div', { class: 'panel-tabs', role: 'tablist' });
  // It scrolls sideways (the tables), so it takes focus; renderPanel names it after the panel shown.
  const panelBody = el('div', { class: 'panel-body', tabindex: '0', role: 'region' });
  const panels = el('section', { class: 'card panels' }, panelTabs, panelBody);
  const PANELS: [Panel, string][] = [
    ['filter', 'Filter code'],
    ['tuning', 'Tuning'],
    ['decay', 'Decay'],
    ['strum', 'Strum timing'],
  ];

  const presetSelect = el('select', { 'aria-label': 'Load a filter preset' });
  presetSelect.append(el('option', { value: '' }, 'Load a preset...'));
  for (const p of FILTER_PRESETS) presetSelect.append(el('option', { value: p.id }, p.name));
  presetSelect.addEventListener('change', () => {
    if (presetSelect.value) loadPreset(presetSelect.value);
    presetSelect.value = '';
  });
  const editor = el('textarea', { class: 'code', spellcheck: 'false', rows: '7', 'aria-label': 'Loop filter source' });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      applyFilter(editor.value);
    }
  });
  const applyBtn = el('button', { type: 'button' }, 'Apply (Ctrl+Enter)');
  applyBtn.addEventListener('click', () => applyFilter(editor.value));
  const resetBtn = el('button', { type: 'button', class: 'quiet' }, 'Reset to default');
  resetBtn.addEventListener('click', () => loadPreset('weighted'));
  const filterStatus = el('p', { class: 'filter-status' });
  const reportList = el('ul', { class: 'report' });
  const responseCanvas = el('canvas', { class: 'view', 'aria-label': 'Filter frequency response' });

  function renderFilterStatus(): void {
    filterStatus.textContent = filterMessage;
    filterStatus.className = `filter-status${filterMessage ? (filterOk ? ' ok' : ' bad') : ''}`;
  }

  function renderPanel(): void {
    panelBody.setAttribute('aria-label', PANELS.find(([id]) => id === settings.panel)?.[1] ?? 'Panel');
    panelTabs.replaceChildren(
      ...PANELS.map(([id, name]) => {
        const b = el('button', { type: 'button', role: 'tab', class: `tab wide${settings.panel === id ? ' active' : ''}` }, name);
        b.setAttribute('aria-selected', String(settings.panel === id));
        b.addEventListener('click', () => {
          update({ panel: id });
          renderPanel();
        });
        return b;
      }),
    );
    if (settings.panel === 'filter') renderFilterPanel();
    else if (settings.panel === 'tuning') renderTuningPanel();
    else if (settings.panel === 'decay') renderDecayPanel();
    else renderStrumPanel();
  }

  function renderFilterPanel(): void {
    if (document.activeElement !== editor) editor.value = source;
    reportList.replaceChildren(...report.lines.map((l) => el('li', {}, l)));
    renderFilterStatus();
    panelBody.replaceChildren(
      el(
        'p',
        { class: 'hint' },
        'This is the body of ',
        el('code', {}, 'function (x, prev, state, p)'),
        ': x leaves the delay line now, prev left one step earlier, state is yours to keep values in, and p holds p.decay, p.weight and p.random(). Return the sample to feed back.',
      ),
      el('div', { class: 'editor-row' }, presetSelect, applyBtn, resetBtn),
      editor,
      filterStatus,
      el('h3', {}, 'What this filter does'),
      reportList,
      el('h3', {}, 'Gain per trip', el('small', {}, ' 1.0 = no loss; dashed lines are the harmonics of the watched string')),
      responseCanvas,
    );
    drawResponse();
  }

  function table(head: string[], rows: (string | HTMLElement)[][], classes: string[] = []): HTMLTableElement {
    return el(
      'table',
      {},
      el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((r, i) => el('tr', { class: classes[i] ?? '' }, ...r.map((c) => el('td', {}, c))))),
    );
  }

  function renderTuningPanel(): void {
    const rows = tuningTable(sampleRate, report.lowDelay, TUNING_NOTES);
    const at8k = tuningTable(8000, report.lowDelay, TUNING_NOTES);
    const fmtC = (c: number) => `${c > 0 ? '+' : ''}${c.toFixed(1)}`;
    panelBody.replaceChildren(
      el(
        'p',
        { class: 'hint' },
        `Integer-only delay lines at ${sampleRate} Hz (the current rate) and at 8 kHz, with the filter's ${report.lowDelay.toFixed(2)}-sample delay included. Errors above ${AUDIBLE_CENTS} cents are highlighted. Fractional tuning is ${settings.fractional ? 'on, so you hear 0 cents' : 'off, so you hear the error'}.`,
      ),
      table(
        ['Note', 'Target Hz', 'Line N', 'Plays Hz', 'Cents', 'At 8 kHz: N', 'Cents'],
        rows.map((r, i) => [
          r.note,
          r.target.toFixed(2),
          String(r.length),
          r.actual.toFixed(2),
          el('span', { class: Math.abs(r.cents) > AUDIBLE_CENTS ? 'bad' : '' }, fmtC(r.cents)),
          String(at8k[i]!.length),
          el('span', { class: Math.abs(at8k[i]!.cents) > AUDIBLE_CENTS ? 'bad' : '' }, fmtC(at8k[i]!.cents)),
        ]),
      ),
    );
  }

  function renderDecayPanel(): void {
    if (!report.linear || report.randomized) {
      panelBody.replaceChildren(el('p', { class: 'hint' }, 'This filter is not linear and time-invariant, so it has no single gain per trip to tabulate. Pluck and listen instead.'));
      return;
    }
    const rows = decayTable(filterFn, settings, sampleRate, OPEN_STRINGS);
    const finite = rows.map((r) => r.t60).filter(Number.isFinite);
    const longest = Math.max(1, ...finite);
    panelBody.replaceChildren(
      el(
        'p',
        { class: 'hint' },
        `Seconds for each open string to fall 60 dB, from the filter's gain at the fundamental times ρ (${settings.decayMode === 'equal' ? 'scaled per note' : 'the same for every note'}). Higher strings make more trips per second, so they lose more per second.`,
      ),
      table(
        ['String', 'Hz', 'ρ used', 'Kept per trip', 'T60', ''],
        rows.map((r) => {
          const bar = el('span', { class: 'bar' });
          bar.style.width = `${Number.isFinite(r.t60) ? Math.max(2, (100 * r.t60) / longest) : 100}%`;
          return [
            r.note,
            r.frequency.toFixed(1),
            r.decay.toFixed(5),
            `${(r.gainPerPeriod * 100).toFixed(3)}%`,
            Number.isFinite(r.t60) ? `${r.t60.toFixed(2)} s` : 'grows',
            el('span', { class: 'bar-track' }, bar),
          ];
        }),
      ),
    );
  }

  const strumCanvas = el('canvas', { class: 'view', 'aria-label': 'Strum timing' });
  function renderStrumPanel(): void {
    panelBody.replaceChildren(
      el(
        'p',
        { class: 'hint' },
        lastStrum
          ? `Last strum: ${lastStrum.label}. Each tick is one string starting; the chord is just these plucks, offset in time.`
          : 'Strum (H or J) to see when each string starts.',
      ),
      strumCanvas,
    );
    requestAnimationFrame(drawStrum);
  }

  function drawStrum(): void {
    const { g, w, h } = prepare(strumCanvas);
    const pad = 36;
    const rowH = (h - 24) / 6;
    const events = lastStrum?.events ?? [];
    const maxMs = Math.max(20, ...events.map((e) => (e.delay / sampleRate) * 1000)) * 1.15;
    g.font = '12px system-ui, sans-serif';
    g.fillStyle = css('--muted');
    g.strokeStyle = css('--border');
    for (let s = 0; s < 6; s++) {
      const y = 8 + (5 - s) * rowH + rowH / 2;
      g.fillText(STRING_NAMES[s]!, 8, y + 4);
      g.beginPath();
      g.moveTo(pad, y);
      g.lineTo(w - 8, y);
      g.stroke();
    }
    for (let t = 0; t <= maxMs; t += maxMs > 150 ? 50 : 10) {
      const x = pad + ((w - pad - 8) * t) / maxMs;
      g.fillText(`${t} ms`, x - 10, h - 4);
    }
    g.fillStyle = css('--accent');
    for (const e of events) {
      const x = pad + ((w - pad - 8) * ((e.delay / sampleRate) * 1000)) / maxMs;
      const y = 8 + (5 - e.string) * rowH + rowH / 2;
      g.beginPath();
      g.arc(x, y, 3 + 4 * e.velocity, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawResponse(): void {
    requestAnimationFrame(paintResponse);
  }

  function paintResponse(): void {
    const { g, w, h } = prepare(responseCanvas);
    if (!report.linear || report.randomized) {
      g.fillStyle = css('--muted');
      g.font = '13px system-ui, sans-serif';
      g.fillText('No fixed response: this filter is nonlinear or random.', 12, h / 2);
      return;
    }
    const top = Math.max(1.05, report.maxGain * 1.05);
    const nyq = sampleRate / 2;
    const pad = 34;
    const X = (hz: number) => pad + ((w - pad - 8) * hz) / nyq;
    const Y = (gain: number) => h - 18 - ((h - 26) * Math.min(gain, top)) / top;
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = css('--muted');
    g.strokeStyle = css('--border');
    g.beginPath();
    g.moveTo(pad, Y(1));
    g.lineTo(w - 8, Y(1));
    g.stroke();
    g.fillText('1.0', 4, Y(1) + 4);
    g.fillText('0', 4, Y(0) + 4);
    g.fillText(`${(nyq / 1000).toFixed(1)} kHz`, w - 52, h - 4);
    g.fillText('0 Hz', pad, h - 4);
    const f0 = mirror.plan?.actualFrequency ?? OPEN_STRINGS[settings.focus]!.freq;
    g.setLineDash([3, 4]);
    for (let k = 1; k * f0 < nyq && k <= 40; k++) {
      g.beginPath();
      g.moveTo(X(k * f0), Y(0));
      g.lineTo(X(k * f0), Y(top));
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = css('--accent');
    g.lineWidth = 2;
    g.beginPath();
    report.response.forEach((p, i) => {
      const x = X(p.f * sampleRate);
      const y = Y(p.gain);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    g.lineWidth = 1;
  }

  function refreshControls(): void {
    decaySlider.refresh();
    weightSlider.refresh();
    pickSlider.refresh();
    spread.refresh();
    fractional.checked = settings.fractional;
    decayMode.refresh();
    rate.refresh();
    speed.refresh();
    if (settings.panel === 'tuning' || settings.panel === 'decay') renderPanel();
    if (settings.panel === 'filter') {
      reportList.replaceChildren(...report.lines.map((l) => el('li', {}, l)));
      drawResponse();
    }
  }

  // ---------------------------------------------------------------- animation

  function advance(n: number): void {
    if (!mirror.active) return;
    try {
      const p = { decay: mirrorDecay, weight: settings.weight };
      for (let i = 0; i < n && mirror.active; i++) {
        history[historyPos] = mirror.tick(filterFn, p);
        historyPos = (historyPos + 1) % HISTORY;
      }
    } catch (err) {
      filterOk = false;
      filterMessage = `The filter threw: ${(err as Error).message}. Switched back to the default filter.`;
      applyFilter(DEFAULT_FILTER_SOURCE);
      filterOk = false;
      renderFilterStatus();
    }
  }

  function drawBuffer(): void {
    const { g, w, h } = prepare(bufferCanvas);
    const mid = h / 2;
    g.strokeStyle = css('--border');
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();
    const data = mirror.snapshot();
    if (data.length === 0) {
      g.fillStyle = css('--muted');
      g.font = '13px system-ui, sans-serif';
      g.fillText('Pluck a string (1 to 6) or strum (H) to fill the delay line with noise.', 12, mid - 8);
      return;
    }
    let peak = 0.05;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const scale = (h / 2 - 6) / Math.max(peak, 0.25);
    const step = w / data.length;
    g.fillStyle = css('--accent-soft');
    g.strokeStyle = css('--accent');
    g.beginPath();
    g.moveTo(0, mid);
    for (let i = 0; i < data.length; i++) g.lineTo(i * step + step / 2, mid - data[i]! * scale);
    g.lineTo(w, mid);
    g.closePath();
    g.fill();
    g.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * step + step / 2;
      const y = mid - data[i]! * scale;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    if (settings.speed > 0 && settings.speed <= 16 && step >= 1) {
      g.fillStyle = css('--warn');
      g.beginPath();
      g.arc(step / 2, mid - data[0]! * scale, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css('--good');
      g.beginPath();
      g.arc(w - step / 2, mid - data[data.length - 1]! * scale, 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawHarmonics(): void {
    const { g, w, h } = prepare(harmonicCanvas);
    const data = mirror.snapshot();
    const count = 40;
    const pad = 30;
    const floor = -60;
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = css('--muted');
    g.fillText('0 dB', 2, 12);
    g.fillText(`${floor}`, 2, h - 14);
    if (data.length === 0) return;
    const db = harmonicsDb(data, count);
    const bw = (w - pad) / count;
    g.fillStyle = css('--accent');
    for (let k = 0; k < count; k++) {
      const v = Math.max(floor, Math.min(0, db[k]!));
      const bh = ((v - floor) / -floor) * (h - 22);
      g.fillRect(pad + k * bw + 1, h - 14 - bh, Math.max(1, bw - 2), bh);
    }
    g.fillStyle = css('--muted');
    for (const k of [1, 5, 10, 20, 30, 40]) g.fillText(String(k), pad + (k - 0.5) * bw - 4, h - 2);
  }

  function drawWave(): void {
    const { g, w, h } = prepare(waveCanvas);
    const mid = h / 2;
    const n = Math.min(HISTORY, 2048);
    g.strokeStyle = css('--border');
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();
    g.strokeStyle = css('--fg');
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const v = history[(historyPos - n + i + HISTORY) % HISTORY]!;
      const x = (i / (n - 1)) * w;
      const y = mid - Math.max(-1, Math.min(1, v)) * (h / 2 - 3);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  function renderReadout(): void {
    const plan = mirror.plan;
    if (!plan) {
      readout.textContent = `Watching the ${STRING_NAMES[settings.focus]} string. Nothing plucked yet.`;
      return;
    }
    const trips = Math.floor(mirror.age / Math.max(1, mirror.length));
    const filterDelay = Math.abs(report.lowDelay) < 0.005 ? 0 : report.lowDelay;
    const parts = [
      `${STRING_NAMES[settings.focus]} string: N = ${mirror.length}`,
      plan.fraction ? ` + ${plan.fraction.toFixed(2)} allpass` : '',
      ` + ${filterDelay.toFixed(2)} filter = ${(mirror.length + plan.fraction + filterDelay).toFixed(2)} samples`,
      ` → ${plan.actualFrequency.toFixed(2)} Hz`,
      plan.centsError ? ` (${plan.centsError > 0 ? '+' : ''}${plan.centsError.toFixed(1)} cents)` : '',
      ` · ${trips} trip${trips === 1 ? '' : 's'} · ${(mirror.age / sampleRate).toFixed(3)} s`,
      mirror.clipped ? ' · clipped!' : '',
    ];
    readout.textContent = parts.join('');
  }

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) advance(settings.speed === 0 ? Math.round(sampleRate * dt) : settings.speed);
    drawBuffer();
    drawHarmonics();
    drawWave();
    renderReadout();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- keyboard

  document.addEventListener('keydown', (e) => {
    // The real target: a key in a shadow root (the theme switch's) arrives here retargeted to its host.
    const target = (e.composedPath()[0] ?? e.target) as HTMLElement;
    if (target.closest?.('textarea, input, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const action = keyAction(e.key);
    if (!action) return;
    // Space mutes, but on a focused button, link or scroll box it is that control's own key.
    if (e.key === ' ' && target.closest?.('button, a[href], summary, [role="button"], [role="tab"], [role="region"]')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (action.kind === 'chord') {
      update({ chord: action.chord });
      renderStrings();
      flash(chordButtons[action.chord]!);
    } else if (action.kind === 'strum') strum(action.direction);
    else if (action.kind === 'pluck') pluck(action.string);
    else damp();
  });
  document.addEventListener('pointerdown', () => void startAudio(), { once: true });

  root.replaceChildren(
    header,
    el('div', { class: 'grid' }, el('div', { class: 'col' }, instrument, scenes, params), el('div', { class: 'col' }, views, panels)),
    el(
      'footer',
      {},
      'Pluck Lab synthesizes every note live with Karplus-Strong (Karplus and Strong 1983, with the Jaffe and Smith 1983 extensions for tuning, decay and pick position). No samples, no backend. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/pluck-lab' }, 'Source'),
    ),
  );
  renderStatus();
  renderStrings();
  renderScene();
  refreshControls();
  renderPanel();
  window.addEventListener('resize', () => renderPanel());

  // The charts read the colour tokens as they draw. The delay line, harmonics and waveform are drawn every frame;
  // the panel's chart is drawn again when the theme changes. On the way into print and back all of them are drawn
  // at once: print takes the light set, but a canvas keeps the pixels it drew on screen, and the next frame would
  // come after the printout (matchMedia('print') changes with the print colours in place).
  document.addEventListener('hw-themechange', () => renderPanel());
  const redrawAll = (): void => {
    drawBuffer();
    drawHarmonics();
    drawWave();
    if (responseCanvas.isConnected) paintResponse();
    if (strumCanvas.isConnected) drawStrum();
  };
  if (typeof window.matchMedia === 'function') window.matchMedia('print').addEventListener?.('change', redrawAll);
  requestAnimationFrame(frame);
}
