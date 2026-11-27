import { DEFAULT_CONFIG, MAX_HEAP, alignment, hex, validateConfig, type Block, type HeapConfig, type Metrics } from '../core/heap';
import {
  PRESETS,
  POLICY_CHOICES,
  describeOp,
  formatTrace,
  generateRandom,
  parseTrace,
  policyLabel,
  replayTo,
  runTrace,
  type ParsedTrace,
  type PolicySwitch,
  type Run,
  type Step,
} from '../core/trace';
import { narrate } from '../core/narrate';
import { QUESTION_TYPES, checkAnswer, generateQuiz, quizToMarkdown, type Question, type QuestionType } from '../core/quiz';
import { buildQtiPackage } from '../core/qti';
import { annotateTrace, diffTraces, type DiffResult } from '../core/diff';
import { decodeShare, encodeShare } from '../core/share';
import { renderRanges, renderStrip } from './strip';
import { legend, renderChart, type Series } from './chart';

type Tab = 'replay' | 'compare' | 'quiz' | 'diff' | 'about';

interface State {
  cfg: HeapConfig;
  traceText: string;
  parsed: ParsedTrace;
  switches: PolicySwitch[];
  run: Run | null;
  step: number;
  bytesPerRow: number;
  showLinks: boolean;
  showWords: boolean;
  tab: Tab;
  timer: number | null;
  quiz: Question[];
  quizCount: number;
  quizSeed: number;
  quizTypes: Set<QuestionType>;
  compareKeys: Set<string>;
  diffText: string;
  diffResult: DiffResult | null;
  diffStep: number;
  genSeed: number;
  genOps: number;
  genMin: number;
  genMax: number;
}

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | number | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') {
      if (v) e.setAttribute(k, '');
    } else e.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c);
  }
  return e;
}

function option(value: string, text: string, selected = false): HTMLOptionElement {
  const o = h('option', { value }, text);
  if (selected) o.selected = true;
  return o;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function download(name: string, data: string | Uint8Array, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The series colours are the stylesheet's --series-0 to --series-7 tokens, so the charts follow the theme.
const COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i})`);

export function mountApp(root: HTMLElement): void {
  const shared = decodeShare(location.hash);
  const first = PRESETS[0];
  const state: State = {
    cfg: shared?.cfg ?? { ...DEFAULT_CONFIG, heapSize: first.heapSize },
    traceText: shared?.trace ?? first.text,
    parsed: { ops: [], addresses: new Map(), errors: [] },
    switches: shared?.switches ?? [],
    run: null,
    step: shared?.step ?? 0,
    bytesPerRow: 64,
    showLinks: true,
    showWords: false,
    tab: 'replay',
    timer: null,
    quiz: [],
    quizCount: 6,
    quizSeed: 7,
    quizTypes: new Set(QUESTION_TYPES.map((t) => t.key)),
    compareKeys: new Set(['implicit-first', 'implicit-next', 'implicit-best', 'segregated-first']),
    diffText: '',
    diffResult: null,
    diffStep: 0,
    genSeed: 1,
    genOps: 40,
    genMin: 4,
    genMax: 96,
  };

  // ---- skeleton --------------------------------------------------------------

  const tabs: { key: Tab; label: string }[] = [
    { key: 'replay', label: 'Replay' },
    { key: 'compare', label: 'Compare' },
    { key: 'quiz', label: 'Quiz' },
    { key: 'diff', label: 'Diff' },
    { key: 'about', label: 'About' },
  ];
  const nav = h('nav', { class: 'tabs', role: 'tablist' });
  const header = h(
    'header',
    { class: 'top' },
    // The light and dark mode switch at the end of the title's row (platform/src/theme).
    h('div', { class: 'title-row' }, h('h1', {}, 'Heap Arena Replay'), h('hw-theme-toggle', {})),
    h('span', { class: 'tag' }, 'malloc, free and realloc on a word-accurate heap, one op at a time'),
    nav,
    h('a', { class: 'ext', href: 'https://github.com/pisanuw/Claude-capstone/tree/main/heap-arena-replay', target: '_blank', rel: 'noopener' }, 'Source'),
  );
  const side = h('aside', { class: 'side' });
  const main = h('main', { class: 'main' });
  root.replaceChildren(header, h('div', { class: 'layout' }, side, main));

  // ---- sidebar: trace ----------------------------------------------------------

  const presetSel = h('select', { 'aria-label': 'Preset trace' });
  for (const p of PRESETS) presetSel.appendChild(option(p.key, p.title));
  const traceArea = h('textarea', { class: 'trace', spellcheck: 'false', 'aria-label': 'Trace' }) as HTMLTextAreaElement;
  traceArea.value = state.traceText;
  const traceStatus = h('div', { class: 'status' });
  const presetBlurb = h('p', { class: 'muted small' });
  const genSeedIn = h('input', { type: 'number', value: String(state.genSeed), min: '0', 'aria-label': 'Seed' }) as HTMLInputElement;
  const genOpsIn = h('input', { type: 'number', value: String(state.genOps), min: '1', max: '2000', 'aria-label': 'Ops' }) as HTMLInputElement;
  const genMinIn = h('input', { type: 'number', value: String(state.genMin), min: '1', 'aria-label': 'Min size' }) as HTMLInputElement;
  const genMaxIn = h('input', { type: 'number', value: String(state.genMax), min: '1', 'aria-label': 'Max size' }) as HTMLInputElement;

  function loadPreset(): void {
    const p = PRESETS.find((x) => x.key === presetSel.value) ?? PRESETS[0];
    state.traceText = p.text;
    traceArea.value = p.text;
    state.cfg.heapSize = p.heapSize;
    heapIn.value = String(p.heapSize);
    state.switches = [];
    state.step = 0;
    presetBlurb.textContent = p.blurb;
    recompute(true);
  }

  function generate(): void {
    const seed = Math.max(0, Math.floor(+genSeedIn.value || 0));
    const ops = Math.min(2000, Math.max(1, Math.floor(+genOpsIn.value || 1)));
    const minSize = Math.max(1, Math.floor(+genMinIn.value || 1));
    const maxSize = Math.max(minSize, Math.floor(+genMaxIn.value || minSize));
    state.traceText = `# random trace, seed ${seed}\n` + formatTrace(generateRandom(seed, { ops, minSize, maxSize }));
    traceArea.value = state.traceText;
    state.switches = [];
    state.step = 0;
    recompute(true);
  }

  side.append(
    h(
      'section',
      {},
      h('h2', {}, 'Trace'),
      h('div', { class: 'row' }, presetSel, h('button', { type: 'button', onclick: loadPreset }, 'Load')),
      presetBlurb,
      h(
        'details',
        {},
        h('summary', {}, 'Generate a random trace'),
        h('div', { class: 'grid2' }, h('label', {}, 'Seed', genSeedIn), h('label', {}, 'Ops', genOpsIn), h('label', {}, 'Min size', genMinIn), h('label', {}, 'Max size', genMaxIn)),
        h('button', { type: 'button', onclick: generate }, 'Generate'),
      ),
      traceArea,
      traceStatus,
      h('p', { class: 'muted small' }, 'Lines: ', h('code', {}, 'a id size'), ', ', h('code', {}, 'f id'), ', ', h('code', {}, 'r id size'), ' (malloc-lab format) or ', h('code', {}, 'p0 = malloc(24)'), '. Comments start with #.'),
    ),
  );

  // ---- sidebar: allocator ------------------------------------------------------

  const wordSel = h('select', { 'aria-label': 'Word size' }, option('4', '4-byte words, 8-byte alignment', state.cfg.word === 4), option('8', '8-byte words, 16-byte alignment', state.cfg.word === 8));
  const heapIn = h('input', { type: 'number', min: '64', max: String(MAX_HEAP), step: '8', value: String(state.cfg.heapSize), 'aria-label': 'Heap size' }) as HTMLInputElement;
  const listSel = h('select', { 'aria-label': 'Free list' }, option('implicit', 'Implicit list (walk every block)', state.cfg.list === 'implicit'), option('explicit', 'Explicit free list', state.cfg.list === 'explicit'), option('segregated', 'Segregated size classes', state.cfg.list === 'segregated'));
  const fitSel = h('select', { 'aria-label': 'Placement' }, option('first', 'First fit', state.cfg.fit === 'first'), option('next', 'Next fit', state.cfg.fit === 'next'), option('best', 'Best fit', state.cfg.fit === 'best'), option('worst', 'Worst fit', state.cfg.fit === 'worst'));
  const coalSel = h('select', { 'aria-label': 'Coalescing' }, option('immediate', 'Immediate coalescing', state.cfg.coalesce === 'immediate'), option('deferred', 'Deferred (sweep when malloc fails)', state.cfg.coalesce === 'deferred'), option('none', 'No coalescing', state.cfg.coalesce === 'none'));
  const insSel = h('select', { 'aria-label': 'Insertion' }, option('lifo', 'LIFO insertion', state.cfg.insert === 'lifo'), option('address', 'Address-ordered insertion', state.cfg.insert === 'address'));
  const cfgStatus = h('div', { class: 'status' });

  function readCfg(): void {
    state.cfg = {
      word: wordSel.value === '8' ? 8 : 4,
      heapSize: Math.floor(+heapIn.value || 0),
      list: listSel.value as HeapConfig['list'],
      fit: fitSel.value as HeapConfig['fit'],
      coalesce: coalSel.value as HeapConfig['coalesce'],
      insert: insSel.value as HeapConfig['insert'],
    };
    const nextOpt = fitSel.querySelector('option[value=next]') as HTMLOptionElement;
    nextOpt.disabled = state.cfg.list !== 'implicit';
    nextOpt.textContent = state.cfg.list === 'implicit' ? 'Next fit' : 'Next fit (implicit list only)';
    insSel.disabled = state.cfg.list === 'implicit';
    heapIn.step = String(alignment(state.cfg));
    recompute(false);
  }
  for (const el of [wordSel, listSel, fitSel, coalSel, insSel]) el.addEventListener('change', readCfg);
  heapIn.addEventListener('change', readCfg);

  // Policy switches.
  const swList = h('select', { 'aria-label': 'Switch list' }, option('implicit', 'implicit'), option('explicit', 'explicit'), option('segregated', 'segregated'));
  const swFit = h('select', { 'aria-label': 'Switch fit' }, option('first', 'first'), option('next', 'next'), option('best', 'best'), option('worst', 'worst'));
  const swCoal = h('select', { 'aria-label': 'Switch coalescing' }, option('immediate', 'immediate'), option('deferred', 'deferred'), option('none', 'none'));
  const swIns = h('select', { 'aria-label': 'Switch insertion' }, option('lifo', 'lifo'), option('address', 'address'));
  const swButton = h('button', { type: 'button' }, 'Switch here');
  const swItems = h('ul', { class: 'switches' });
  swButton.addEventListener('click', () => {
    const at = state.step;
    state.switches = state.switches.filter((s) => s.at !== at);
    state.switches.push({ at, patch: { list: swList.value as HeapConfig['list'], fit: swFit.value as HeapConfig['fit'], coalesce: swCoal.value as HeapConfig['coalesce'], insert: swIns.value as HeapConfig['insert'] } });
    recompute(false);
  });

  side.append(
    h(
      'section',
      {},
      h('h2', {}, 'Allocator'),
      h('label', {}, 'Words', wordSel),
      h('label', {}, 'Heap size (bytes)', heapIn),
      h('label', {}, 'Free list', listSel),
      h('label', {}, 'Placement', fitSel),
      h('label', {}, 'Coalescing', coalSel),
      h('label', {}, 'Insertion', insSel),
      cfgStatus,
    ),
    h(
      'section',
      {},
      h('h2', {}, 'Switch policy mid-replay'),
      h('p', { class: 'muted small' }, 'Keeps every block where it is from the current step on and rebuilds the free lists under the new policy.'),
      h('div', { class: 'grid2' }, h('label', {}, 'List', swList), h('label', {}, 'Fit', swFit), h('label', {}, 'Coalesce', swCoal), h('label', {}, 'Insert', swIns)),
      swButton,
      swItems,
    ),
    h(
      'section',
      {},
      h('h2', {}, 'Share'),
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: shareLink }, 'Copy link'), h('button', { type: 'button', onclick: downloadAnnotated }, 'Download trace with addresses')),
      h('div', { class: 'status', id: 'share-status' }),
    ),
  );

  function shareLink(): void {
    const hash = encodeShare({ cfg: state.cfg, trace: state.traceText, switches: state.switches, step: state.step });
    history.replaceState(null, '', '#' + hash);
    const status = side.querySelector('#share-status')!;
    navigator.clipboard
      ?.writeText(location.href)
      .then(() => (status.textContent = 'Link copied to the clipboard.'))
      .catch(() => (status.textContent = 'Link is in the address bar.'));
  }

  function downloadAnnotated(): void {
    if (!state.run) return;
    download('heap-trace.txt', annotateTrace(state.parsed.ops, state.run) + '\n', 'text/plain');
  }

  // ---- main panels -------------------------------------------------------------

  const panels: Record<Tab, HTMLElement> = {
    replay: h('section', { class: 'panel', role: 'tabpanel' }),
    compare: h('section', { class: 'panel', role: 'tabpanel' }),
    quiz: h('section', { class: 'panel', role: 'tabpanel' }),
    diff: h('section', { class: 'panel', role: 'tabpanel' }),
    about: h('section', { class: 'panel', role: 'tabpanel' }),
  };
  for (const t of tabs) {
    const b = h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': t.key, onclick: () => setTab(t.key) }, t.label);
    nav.appendChild(b);
  }
  main.append(...Object.values(panels));

  function setTab(t: Tab): void {
    state.tab = t;
    nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === t));
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== t;
    render();
  }

  // Replay panel skeleton.
  const slider = h('input', { type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Step' }) as HTMLInputElement;
  const stepLabel = h('span', { class: 'steplabel' });
  const bprSel = h('select', { 'aria-label': 'Bytes per row' }, option('32', '32 B/row'), option('64', '64 B/row', true), option('128', '128 B/row'), option('256', '256 B/row'));
  const linksChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
  linksChk.checked = true;
  const wordsChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const playBtn = h('button', { type: 'button', class: 'play' }, 'Play');
  const stripBox = h('div', { class: 'stripbox' });
  const narration = h('p', { class: 'narration' });
  const metricsBox = h('div', { class: 'metrics' });
  const chartBox = h('div', { class: 'chartbox' });
  const opsBox = h('div', { class: 'opsbox' });
  const wordsBox = h('div', { class: 'wordsbox' });
  const legendBox = h('div', { class: 'striplegend' });
  for (const [cls, text] of [
    ['hdr alloc', 'header / footer (allocated)'],
    ['hdr free', 'header / footer (free)'],
    ['payload', 'payload'],
    ['padding', 'padding'],
    ['freespace', 'free bytes'],
    ['ptr pred', 'pred / succ pointer'],
    ['sys pad', 'prologue / epilogue'],
  ]) {
    legendBox.append(h('span', {}, h('i', { class: cls }), text));
  }
  for (const [cls, text] of [
    ['examined', 'examined'],
    ['result', 'returned'],
    ['split', 'split remainder'],
    ['freed', 'freed / merged'],
  ]) {
    legendBox.append(h('span', {}, h('i', { class: `hl ${cls}` }), text));
  }

  panels.replay.append(
    h(
      'div',
      { class: 'controls' },
      h('button', { type: 'button', onclick: () => seek(0), 'aria-label': 'First' }, '⏮'),
      h('button', { type: 'button', onclick: () => seek(state.step - 1), 'aria-label': 'Previous' }, '◀'),
      playBtn,
      h('button', { type: 'button', onclick: () => seek(state.step + 1), 'aria-label': 'Next' }, '▶'),
      h('button', { type: 'button', onclick: () => seek(Infinity), 'aria-label': 'Last' }, '⏭'),
      slider,
      stepLabel,
      bprSel,
      h('label', { class: 'chk' }, linksChk, ' links'),
      h('label', { class: 'chk' }, wordsChk, ' words'),
    ),
    stripBox,
    legendBox,
    narration,
    metricsBox,
    chartBox,
    opsBox,
    wordsBox,
  );
  slider.addEventListener('input', () => seek(+slider.value));
  bprSel.addEventListener('change', () => {
    state.bytesPerRow = +bprSel.value;
    render();
  });
  linksChk.addEventListener('change', () => {
    state.showLinks = linksChk.checked;
    render();
  });
  wordsChk.addEventListener('change', () => {
    state.showWords = wordsChk.checked;
    render();
  });
  playBtn.addEventListener('click', () => {
    if (state.timer !== null) {
      stopPlay();
      return;
    }
    if (state.run && state.step >= state.run.steps.length) state.step = 0;
    playBtn.textContent = 'Pause';
    state.timer = window.setInterval(() => {
      if (!state.run || state.step >= state.run.steps.length) {
        stopPlay();
        return;
      }
      seek(state.step + 1);
    }, 700);
  });

  function stopPlay(): void {
    if (state.timer !== null) window.clearInterval(state.timer);
    state.timer = null;
    playBtn.textContent = 'Play';
  }

  function seek(step: number): void {
    const n = state.run ? state.run.steps.length : 0;
    state.step = Math.max(0, Math.min(n, step));
    render();
  }

  document.addEventListener('keydown', (e) => {
    // The element the key was pressed on: a key in a shadow root (the light and dark mode switch's button)
    // reaches the document retargeted to its host (platform/src/theme/README.md, "Key shortcuts").
    const t = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'ArrowRight') seek(state.step + 1);
    else if (e.key === 'ArrowLeft') seek(state.step - 1);
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(Infinity);
    else return;
    e.preventDefault();
  });

  // ---- recompute -----------------------------------------------------------------

  let debounce: number | null = null;
  traceArea.addEventListener('input', () => {
    state.traceText = traceArea.value;
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => recompute(false), 150);
  });

  function recompute(resetStep: boolean): void {
    stopPlay();
    state.parsed = parseTrace(state.traceText);
    const cfgErr = validateConfig(state.cfg);
    cfgStatus.textContent = cfgErr ?? `${policyLabel(state.cfg)}; minimum block ${state.cfg.word * 4} bytes, ${state.cfg.heapSize - 4 * state.cfg.word} usable.`;
    cfgStatus.classList.toggle('bad', cfgErr !== null);
    const n = state.parsed.ops.length;
    const errs = state.parsed.errors;
    traceStatus.textContent = errs.length ? errs.slice(0, 3).join('; ') : `${n} op${n === 1 ? '' : 's'}${state.parsed.addresses.size ? `, ${state.parsed.addresses.size} with addresses` : ''}`;
    traceStatus.classList.toggle('bad', errs.length > 0);
    state.switches = state.switches.filter((s) => s.at <= n);
    state.run = cfgErr || errs.length ? null : runTrace(state.parsed.ops, state.cfg, state.switches);
    if (resetStep) state.step = 0;
    state.step = Math.max(0, Math.min(n, state.step));
    state.quiz = [];
    state.diffResult = null;
    compareCache.clear();
    renderSwitches();
    render();
  }

  function renderSwitches(): void {
    swItems.replaceChildren(
      ...state.switches
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((s) =>
          h(
            'li',
            {},
            `before op ${s.at + 1}: ${policyLabel({ ...state.cfg, ...s.patch })} `,
            h(
              'button',
              {
                type: 'button',
                class: 'tiny',
                onclick: () => {
                  state.switches = state.switches.filter((x) => x !== s);
                  recompute(false);
                },
              },
              'remove',
            ),
          ),
        ),
    );
    swButton.textContent = `Switch before op ${state.step + 1}`;
    swButton.disabled = !state.run || state.step >= (state.run?.steps.length ?? 0);
  }

  // ---- render --------------------------------------------------------------------

  function currentView(): { blocks: Block[]; freeLists: number[][]; metrics: Metrics; rover: number; cfg: HeapConfig; step?: Step } | null {
    if (!state.run) return null;
    if (state.step === 0) return { ...state.run.initial, cfg: state.run.cfg };
    const s = state.run.steps[state.step - 1];
    return { blocks: s.blocks, freeLists: s.freeLists, metrics: s.metrics, rover: s.rover, cfg: s.cfg, step: s };
  }

  function render(): void {
    const n = state.run ? state.run.steps.length : 0;
    slider.max = String(n);
    slider.value = String(state.step);
    renderSwitches();
    if (state.tab === 'replay') renderReplay(n);
    else if (state.tab === 'compare') renderCompare();
    else if (state.tab === 'quiz') renderQuiz();
    else if (state.tab === 'diff') renderDiff();
    else renderAbout();
  }

  function renderReplay(n: number): void {
    const v = currentView();
    if (!v) {
      stepLabel.textContent = '';
      stripBox.replaceChildren(h('p', { class: 'muted' }, 'Fix the trace or allocator settings to replay.'));
      narration.textContent = '';
      metricsBox.replaceChildren();
      chartBox.replaceChildren();
      opsBox.replaceChildren();
      wordsBox.replaceChildren();
      return;
    }
    stepLabel.textContent = state.step === 0 ? `initial heap, ${n} ops` : `after op ${state.step} of ${n}: ${describeOp(v.step!.op)}`;
    stripBox.replaceChildren(renderStrip(v.blocks, v.cfg, { bytesPerRow: state.bytesPerRow, showLinks: state.showLinks, event: v.step?.event, rover: v.rover, freeLists: v.freeLists }));
    narration.textContent = v.step ? narrate(v.step) : `A fresh ${v.cfg.heapSize}-byte heap: a padding word, the prologue block, one free block of ${v.metrics.largestFree} bytes, and the epilogue header. ${policyLabel(v.cfg)}.`;
    narration.classList.toggle('bad', !!v.step?.event.error);
    const m = v.metrics;
    const run = state.run!;
    const examined = v.step && v.step.event.kind !== 'free' ? v.step.event.examined.length : null;
    metricsBox.replaceChildren(
      tile('utilization', pct(m.utilization), 'live payload bytes / heap size'),
      tile('external frag.', pct(m.externalFragmentation), '1 - largest free block / free bytes'),
      tile('internal frag.', pct(m.internalFragmentation), 'headers, footers and padding / allocated bytes'),
      tile('free blocks', String(m.freeBlocks), `largest ${m.largestFree} B of ${m.freeBytes} B free`),
      tile('allocated', `${m.allocatedBlocks} blocks`, `${m.allocatedBytes} B incl. overhead, ${m.payloadBytes} B payload`),
      tile('examined', examined === null ? '–' : String(examined), `this op; ${run.summary.totalExamined} total, ${run.summary.avgExamined.toFixed(1)} per search`),
      tile('failures', String(run.summary.failures), run.summary.firstFailure === null ? 'no malloc returned NULL' : `first NULL at op ${run.summary.firstFailure + 1}`),
    );
    const series: Series[] = [
      { label: 'utilization', color: COLORS[0], values: run.steps.map((s) => s.metrics.utilization) },
      { label: 'external fragmentation', color: COLORS[1], values: run.steps.map((s) => s.metrics.externalFragmentation) },
      { label: 'internal fragmentation', color: COLORS[2], values: run.steps.map((s) => s.metrics.internalFragmentation), dashed: true },
    ];
    chartBox.replaceChildren(h('h3', {}, 'Over the trace'), renderChart(series, { label: 'Utilization and fragmentation over the trace', yMax: 1, format: pct, marker: state.step - 1, onSeek: (i) => seek(i + 1) }), legend(series));
    const rows = run.steps.map((s) => {
      const e = s.event;
      const res = e.kind === 'free' ? (e.error ? 'error' : e.merged > 1 ? `merged ${e.merged}` : 'freed') : e.result === null ? 'NULL' : hex(e.result);
      const tr = h(
        'tr',
        { class: (s.index + 1 === state.step ? 'current ' : '') + (e.error ? 'bad' : ''), onclick: () => seek(s.index + 1) },
        h('td', {}, String(s.index + 1)),
        h('td', { class: 'mono' }, describeOp(s.op)),
        h('td', { class: 'mono' }, res),
        h('td', {}, e.kind === 'free' ? '' : e.asize ? `${e.asize} B` : ''),
        h('td', {}, e.kind === 'free' ? '' : String(e.examined.length)),
        h('td', {}, pct(s.metrics.utilization)),
        h('td', {}, s.switched ? 'switch' : ''),
      );
      return tr;
    });
    opsBox.replaceChildren(
      h('h3', {}, 'Operations'),
      h('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': 'Operations' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'op'), h('th', {}, 'result'), h('th', {}, 'block'), h('th', {}, 'examined'), h('th', {}, 'util'), h('th', {}, ''))), h('tbody', {}, ...rows))),
    );
    const cur = opsBox.querySelector('tr.current') as HTMLElement | null;
    const wrap = opsBox.querySelector('.tablewrap') as HTMLElement | null;
    if (cur && wrap) wrap.scrollTop = Math.max(0, cur.offsetTop - wrap.clientHeight / 2);
    wordsBox.replaceChildren();
    if (state.showWords) renderWords(v.cfg);
  }

  function tile(label: string, value: string, hint: string): HTMLElement {
    return h('div', { class: 'tile', title: hint }, h('b', {}, value), h('span', {}, label));
  }

  function renderWords(cfg: HeapConfig): void {
    if (cfg.heapSize > 8192) {
      wordsBox.replaceChildren(h('p', { class: 'muted' }, 'Word dump is limited to heaps of 8 KB or less.'));
      return;
    }
    const heap = replayTo(state.parsed.ops, state.cfg, state.step, state.switches);
    const w = cfg.word;
    const role = new Map<number, string>();
    role.set(0, 'alignment padding');
    role.set(w, 'prologue header');
    role.set(2 * w, 'prologue footer');
    role.set(cfg.heapSize - w, 'epilogue header');
    for (const b of heap.blocks()) {
      role.set(b.addr, `header of ${b.alloc ? `p${b.id}` : 'free block'} (${b.size}/${b.alloc ? 1 : 0})`);
      role.set(b.bp + b.size - 2 * w, `footer of ${b.alloc ? `p${b.id}` : 'free block'} (${b.size}/${b.alloc ? 1 : 0})`);
      if (!b.alloc && cfg.list !== 'implicit') {
        role.set(b.bp, 'pred pointer');
        role.set(b.bp + w, 'succ pointer');
      }
      if (b.alloc && b.req !== undefined) {
        for (let a = b.bp; a < b.bp + b.size - 2 * w; a += w) {
          role.set(a, a < b.bp + b.req ? `payload of p${b.id}` : `padding of p${b.id}`);
          if (a < b.bp + b.req && a + w > b.bp + b.req) role.set(a, `payload of p${b.id} (${b.bp + b.req - a} bytes) and padding`);
        }
      }
    }
    const rows: HTMLElement[] = [];
    for (let a = 0; a < cfg.heapSize; a += w) {
      const val = heap.get(a);
      const r = role.get(a) ?? 'free bytes';
      let shown = hex(val);
      if (r.includes('header') || r.includes('footer')) shown = `${val & ~1}/${val & 1}`;
      else if (r.includes('pointer')) shown = val === 0 ? 'NULL' : hex(val);
      else shown = '·';
      rows.push(h('tr', { class: r.includes('free') ? 'freeword' : '' }, h('td', { class: 'mono' }, hex(a)), h('td', { class: 'mono' }, shown), h('td', {}, r)));
    }
    wordsBox.replaceChildren(h('h3', {}, 'Words'), h('div', { class: 'tablewrap tall', tabindex: '0', role: 'region', 'aria-label': 'Words' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'address'), h('th', {}, 'value'), h('th', {}, 'meaning'))), h('tbody', {}, ...rows))));
  }

  // ---- compare ---------------------------------------------------------------------

  const compareCache = new Map<string, Run>();
  const compareBox = h('div');
  const compareChecks = h('div', { class: 'checks' });
  for (const pc of POLICY_CHOICES) {
    const chk = h('input', { type: 'checkbox' }) as HTMLInputElement;
    chk.checked = state.compareKeys.has(pc.key);
    chk.addEventListener('change', () => {
      if (chk.checked) state.compareKeys.add(pc.key);
      else state.compareKeys.delete(pc.key);
      render();
    });
    compareChecks.append(h('label', { class: 'chk' }, chk, ' ', pc.label));
  }
  panels.compare.append(h('p', { class: 'muted' }, 'Every policy replays the same trace from scratch with the coalescing and insertion settings chosen on the left. The strips follow the Replay step.'), compareChecks, compareBox);

  function renderCompare(): void {
    if (!state.run) {
      compareBox.replaceChildren(h('p', { class: 'muted' }, 'Fix the trace or allocator settings first.'));
      return;
    }
    const chosen = POLICY_CHOICES.filter((pc) => state.compareKeys.has(pc.key));
    const runs = chosen.map((pc) => {
      let r = compareCache.get(pc.key);
      if (!r) {
        r = runTrace(state.parsed.ops, { ...state.cfg, ...pc.patch });
        compareCache.set(pc.key, r);
      }
      return { pc, run: r };
    });
    const head = h('tr', {}, h('th', {}, 'policy'), h('th', {}, 'NULLs'), h('th', {}, 'first NULL'), h('th', {}, 'examined / search'), h('th', {}, 'avg util'), h('th', {}, 'peak util'), h('th', {}, 'peak ext. frag'), h('th', {}, 'avg int. frag'), h('th', {}, 'splits'), h('th', {}, 'coalesces'));
    const rows = runs.map(({ pc, run }, i) => {
      const s = run.summary;
      return h(
        'tr',
        {},
        h('td', {}, h('i', { class: 'sw', style: `background:${COLORS[i % COLORS.length]}` }), pc.label),
        h('td', {}, String(s.failures)),
        h('td', {}, s.firstFailure === null ? '–' : `op ${s.firstFailure + 1}`),
        h('td', {}, s.avgExamined.toFixed(2)),
        h('td', {}, pct(s.avgUtilization)),
        h('td', {}, pct(s.peakUtilization)),
        h('td', {}, pct(s.peakExternalFragmentation)),
        h('td', {}, pct(s.avgInternalFragmentation)),
        h('td', {}, String(s.splits)),
        h('td', {}, String(s.coalesces)),
      );
    });
    const util: Series[] = runs.map(({ pc, run }, i) => ({ label: pc.label, color: COLORS[i % COLORS.length], values: run.steps.map((s) => s.metrics.utilization) }));
    const frag: Series[] = runs.map(({ pc, run }, i) => ({ label: pc.label, color: COLORS[i % COLORS.length], values: run.steps.map((s) => s.metrics.externalFragmentation) }));
    const exam: Series[] = runs.map(({ pc, run }, i) => {
      let acc = 0;
      return { label: pc.label, color: COLORS[i % COLORS.length], values: run.steps.map((s) => (acc += s.event.kind === 'free' ? 0 : s.event.examined.length)) };
    });
    const strips = runs.map(({ pc, run }) => {
      const v = state.step === 0 ? { blocks: run.initial.blocks, freeLists: run.initial.freeLists, rover: run.initial.rover, step: undefined } : { blocks: run.steps[state.step - 1].blocks, freeLists: run.steps[state.step - 1].freeLists, rover: run.steps[state.step - 1].rover, step: run.steps[state.step - 1] };
      const e = v.step?.event;
      const res = !e ? '' : e.kind === 'free' ? (e.merged > 1 ? `merged ${e.merged} blocks` : 'freed') : e.result === null ? 'NULL' : `returns ${hex(e.result)}`;
      return h('div', { class: 'ministrip' }, h('h4', {}, pc.label, ' ', h('span', { class: 'muted' }, res)), renderStrip(v.blocks, run.cfg, { bytesPerRow: state.bytesPerRow, showLinks: false, event: e, rover: v.rover, freeLists: v.freeLists, compact: true }));
    });
    compareBox.replaceChildren(
      h('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': 'Placement policies compared' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...rows))),
      h('div', { class: 'charts3' }, h('div', {}, h('h4', {}, 'Utilization'), renderChart(util, { label: 'Utilization, by policy', yMax: 1, format: pct, marker: state.step - 1, onSeek: (i) => seek(i + 1) })), h('div', {}, h('h4', {}, 'External fragmentation'), renderChart(frag, { label: 'External fragmentation, by policy', yMax: 1, format: pct, marker: state.step - 1, onSeek: (i) => seek(i + 1) })), h('div', {}, h('h4', {}, 'Blocks examined (cumulative)'), renderChart(exam, { label: 'Blocks examined (cumulative), by policy', format: (v) => String(Math.round(v)), marker: state.step - 1, onSeek: (i) => seek(i + 1) }))),
      h('p', { class: 'muted small' }, state.step === 0 ? 'Initial heap.' : `After op ${state.step}: ${describeOp(state.run.steps[state.step - 1].op)}. Use the Replay slider or arrow keys to move.`),
      ...strips,
    );
  }

  // ---- quiz --------------------------------------------------------------------------

  const quizBox = h('div');
  const quizCountIn = h('input', { type: 'number', min: '1', max: '50', value: String(state.quizCount), 'aria-label': 'Questions' }) as HTMLInputElement;
  const quizSeedIn = h('input', { type: 'number', min: '0', value: String(state.quizSeed), 'aria-label': 'Quiz seed' }) as HTMLInputElement;
  const quizTypeChecks = h('div', { class: 'checks' });
  for (const t of QUESTION_TYPES) {
    const chk = h('input', { type: 'checkbox' }) as HTMLInputElement;
    chk.checked = true;
    chk.addEventListener('change', () => {
      if (chk.checked) state.quizTypes.add(t.key);
      else state.quizTypes.delete(t.key);
    });
    quizTypeChecks.append(h('label', { class: 'chk' }, chk, ' ', t.label));
  }
  const quizExport = h('div', { class: 'row' });
  panels.quiz.append(
    h('p', { class: 'muted' }, 'Each question picks a point in the trace and asks about the next op under the allocator chosen on the left. Answers are read off the simulator, so they are correct by construction.'),
    h('div', { class: 'row' }, h('label', {}, 'Questions ', quizCountIn), h('label', {}, 'Seed ', quizSeedIn), h('button', { type: 'button', onclick: makeQuiz }, 'Generate')),
    quizTypeChecks,
    quizExport,
    quizBox,
  );

  function makeQuiz(): void {
    if (!state.run) return;
    state.quizCount = Math.min(50, Math.max(1, Math.floor(+quizCountIn.value || 1)));
    state.quizSeed = Math.max(0, Math.floor(+quizSeedIn.value || 0));
    state.quiz = generateQuiz(state.parsed.ops, state.cfg, { count: state.quizCount, seed: state.quizSeed, types: [...state.quizTypes] });
    renderQuiz();
  }

  function renderQuiz(): void {
    if (!state.run) {
      quizBox.replaceChildren(h('p', { class: 'muted' }, 'Fix the trace or allocator settings first.'));
      quizExport.replaceChildren();
      return;
    }
    if (state.quiz.length === 0) {
      quizBox.replaceChildren(h('p', { class: 'muted' }, 'No questions yet.'));
      quizExport.replaceChildren();
      return;
    }
    quizExport.replaceChildren(
      h('button', { type: 'button', onclick: () => download('heap-quiz.md', quizToMarkdown(state.quiz, state.cfg, false), 'text/markdown') }, 'Markdown (questions)'),
      h('button', { type: 'button', onclick: () => download('heap-quiz-key.md', quizToMarkdown(state.quiz, state.cfg, true), 'text/markdown') }, 'Markdown (with key)'),
      h('button', { type: 'button', onclick: () => download('heap-quiz-qti.zip', buildQtiPackage(state.quiz, state.cfg), 'application/zip') }, 'Canvas QTI (.zip)'),
    );
    const cards = state.quiz.map((q) => {
      const input = h('input', { type: 'text', placeholder: 'your answer', 'aria-label': `Answer ${q.n}` }) as HTMLInputElement;
      const verdict = h('span', { class: 'verdict' });
      const reveal = h('div', { class: 'reveal', hidden: true }, h('p', {}, h('b', {}, 'Answer: '), q.answer), h('p', { class: 'small' }, q.explanation));
      const check = () => {
        const ok = checkAnswer(q, input.value);
        verdict.textContent = ok ? 'correct' : 'not quite';
        verdict.className = 'verdict ' + (ok ? 'ok' : 'bad');
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') check();
      });
      return h(
        'article',
        { class: 'card' },
        h('h4', {}, `Question ${q.n}`, ' ', h('span', { class: 'muted small' }, QUESTION_TYPES.find((t) => t.key === q.type)?.label ?? '')),
        h('pre', { class: 'ctx', tabindex: '0', role: 'region', 'aria-label': 'The trace so far' }, q.context),
        h('p', {}, q.prompt),
        h('div', { class: 'row' }, input, h('button', { type: 'button', onclick: check }, 'Check'), verdict, h('button', { type: 'button', class: 'tiny', onclick: () => (reveal.hidden = !reveal.hidden) }, 'Reveal'), h('button', { type: 'button', class: 'tiny', onclick: () => showStep(q.step) }, 'Show heap before this op')),
        reveal,
      );
    });
    quizBox.replaceChildren(...cards);
  }

  function showStep(opIndex: number): void {
    state.step = opIndex;
    setTab('replay');
  }

  // ---- diff ------------------------------------------------------------------------------

  const diffArea = h('textarea', { class: 'trace', spellcheck: 'false', 'aria-label': 'Student trace', placeholder: 'a 0 24 -> 0x10\na 1 40 -> 0x30\nf 0\n...' }) as HTMLTextAreaElement;
  const diffBox = h('div');
  diffArea.addEventListener('input', () => {
    state.diffText = diffArea.value;
  });
  panels.diff.append(
    h('p', { class: 'muted' }, 'Paste the trace as your allocator ran it, with the payload address each malloc or realloc returned (', h('code', {}, 'a 0 24 -> 0x10'), '). Addresses are offsets from the start of your heap. The reference replays the same ops under the allocator chosen on the left and reports the first op where the addresses differ, plus alignment, bounds and overlap bugs that are wrong under any policy.'),
    h('div', { class: 'row' }, h('button', { type: 'button', onclick: fillReference }, 'Fill with reference output'), h('button', { type: 'button', onclick: fillBuggy }, 'Load a buggy example'), h('button', { type: 'button', class: 'primary', onclick: runDiff }, 'Compare')),
    diffArea,
    diffBox,
  );

  function fillReference(): void {
    if (!state.run) return;
    state.diffText = annotateTrace(state.parsed.ops, state.run);
    diffArea.value = state.diffText;
  }

  function fillBuggy(): void {
    if (!state.run) return;
    // A best-fit allocator that also forgot alignment on one block.
    const other = runTrace(state.parsed.ops, { ...state.cfg, list: 'implicit', fit: state.cfg.fit === 'best' ? 'first' : 'best' });
    const lines = annotateTrace(state.parsed.ops, other).split('\n');
    const idx = lines.findIndex((l, i) => i > 1 && /-> 0x/.test(l));
    if (idx >= 0) lines[idx] = lines[idx].replace(/-> 0x([0-9a-f]+)$/, (_m, a: string) => `-> ${hex(parseInt(a, 16) + state.cfg.word)}`);
    state.diffText = lines.join('\n');
    diffArea.value = state.diffText;
  }

  function runDiff(): void {
    const parsed = parseTrace(state.diffText);
    if (parsed.errors.length) {
      diffBox.replaceChildren(h('p', { class: 'bad' }, parsed.errors.slice(0, 5).join('; ')));
      return;
    }
    if (parsed.addresses.size === 0) {
      diffBox.replaceChildren(h('p', { class: 'bad' }, 'No addresses found. Add "-> 0x.." after each malloc and realloc line.'));
      return;
    }
    const cfgErr = validateConfig(state.cfg);
    if (cfgErr) {
      diffBox.replaceChildren(h('p', { class: 'bad' }, cfgErr));
      return;
    }
    state.diffResult = diffTraces(parsed, state.cfg);
    state.diffStep = state.diffResult.firstError ?? state.diffResult.firstDivergence ?? state.diffResult.steps.length - 1;
    renderDiff();
  }

  function renderDiff(): void {
    const d = state.diffResult;
    if (!d) {
      diffBox.replaceChildren();
      return;
    }
    const verdict =
      d.firstError !== null
        ? h('p', { class: 'bad' }, `Bug: op ${d.firstError + 1} (${describeOp(d.steps[d.firstError].op)}): ${d.steps[d.firstError].errors.join('; ')}`)
        : d.firstDivergence !== null
          ? h('p', { class: 'warn' }, `Addresses first differ at op ${d.firstDivergence + 1} (${describeOp(d.steps[d.firstDivergence].op)}): reference ${fmtAddr(d.steps[d.firstDivergence].reference)}, yours ${fmtAddr(d.steps[d.firstDivergence].student)}. Not necessarily a bug: a different placement policy or split rule gives different addresses.`)
          : h('p', { class: 'ok' }, `All ${d.compared} addresses match the reference under ${policyLabel(state.cfg)}.`);
    const rows = d.steps.map((s) =>
      h(
        'tr',
        { class: (s.index === state.diffStep ? 'current ' : '') + (s.errors.length ? 'bad' : s.diverges ? 'warn' : ''), onclick: () => { state.diffStep = s.index; renderDiff(); } },
        h('td', {}, String(s.index + 1)),
        h('td', { class: 'mono' }, describeOp(s.op)),
        h('td', { class: 'mono' }, s.op.kind === 'free' ? '' : fmtAddr(s.reference)),
        h('td', { class: 'mono' }, s.op.kind === 'free' ? '' : fmtAddr(s.student)),
        h('td', {}, s.errors.length ? s.errors.join('; ') : s.diverges ? 'differs' : s.op.kind === 'free' ? '' : s.student === undefined ? 'no address given' : 'match'),
      ),
    );
    const cur = d.steps[state.diffStep];
    const refStep = d.run.steps[state.diffStep];
    const badIds = new Set(cur.errors.map((e) => e.match(/block p(\d+)/)?.[1]).filter((x) => x !== undefined).map(Number));
    const studentRanges = cur.live.map((b) => ({ bp: b.bp, req: b.req, id: b.id, bad: badIds.has(b.id) || (b.id === cur.op.id && cur.errors.length > 0) }));
    diffBox.replaceChildren(
      verdict,
      h('p', { class: 'muted small' }, `${d.matched} of ${d.compared} addresses match. Click a row to see both heaps after that op.`),
      h('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': 'Your trace against the reference' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'op'), h('th', {}, 'reference'), h('th', {}, 'yours'), h('th', {}, 'status'))), h('tbody', {}, ...rows))),
      h('h4', {}, `Reference heap after op ${state.diffStep + 1}`),
      renderStrip(refStep.blocks, refStep.cfg, { bytesPerRow: state.bytesPerRow, showLinks: false, event: refStep.event, rover: refStep.rover, freeLists: refStep.freeLists, compact: true }),
      h('h4', {}, `Your live blocks after op ${state.diffStep + 1} (payload ranges from your addresses)`),
      renderRanges(studentRanges, state.cfg, state.bytesPerRow),
    );
  }

  function fmtAddr(a: number | null | undefined): string {
    if (a === undefined) return '?';
    if (a === null || a === 0) return 'NULL';
    return hex(a);
  }

  // ---- about -------------------------------------------------------------------------------

  function renderAbout(): void {
    if (panels.about.childElementCount > 0) return;
    panels.about.append(
      h('h3', {}, 'What the strip shows'),
      h('p', {}, 'Each cell is one word. A block is a header word (size and allocated bit), the payload, any padding needed to reach the alignment, and a footer word that repeats the header so the previous block can be found when coalescing. The heap starts with an alignment word and a prologue block, and ends with a zero-size epilogue header, as in the CS:APP allocator. Free blocks on an explicit or segregated list keep their pred and succ pointers in the first two payload words; arcs above the strip follow succ pointers from the list head.'),
      h('h3', {}, 'Block sizes'),
      h('p', {}, 'A request of n bytes becomes a block of n plus two words, rounded up to the alignment (twice the word size), and never smaller than four words so a free block can hold both pointers. A free block is split when the remainder is at least the minimum block; otherwise the spare bytes stay in the allocated block as padding.'),
      h('h3', {}, 'Policies'),
      h('ul', {}, h('li', {}, h('b', {}, 'First fit'), ' takes the first free block that is big enough, scanning from the start of the heap (implicit list) or the head of the free list.'), h('li', {}, h('b', {}, 'Next fit'), ' is first fit that resumes where the previous search ended (the rover marker). Implicit list only.'), h('li', {}, h('b', {}, 'Best fit'), ' takes the smallest block that fits; ', h('b', {}, 'worst fit'), ' the largest.'), h('li', {}, h('b', {}, 'Segregated lists'), ' keep one list per power-of-two size class, starting at the minimum block; a search starts in the class of the request and moves to larger classes.'), h('li', {}, h('b', {}, 'Coalescing'), ' merges a freed block with free neighbours immediately, never, or only in a sweep when a malloc fails (deferred).')),
      h('h3', {}, 'Realloc'),
      h('p', {}, 'Shrinks in place when the new size fits (releasing the tail if it can form a block), absorbs the next block when it is free and big enough, and otherwise allocates, copies and frees.'),
      h('h3', {}, 'Trace format'),
      h('pre', { class: 'ctx', tabindex: '0', role: 'region', 'aria-label': 'Trace format' }, 'a 0 24        # p0 = malloc(24)\nf 0           # free(p0)\nr 1 48        # p1 = realloc(p1, 48)\na 2 16 -> 0x10  # with the address your allocator returned (diff mode)'),
      h('p', {}, 'Malloc-lab trace files (with their four header lines) paste straight in. Addresses are byte offsets from the start of the heap.'),
      h('h3', {}, 'Keys'),
      h('p', {}, 'Left and right arrows step, Home and End jump, and the charts seek on click.'),
    );
  }

  // ---- boot ----------------------------------------------------------------------------------

  presetBlurb.textContent = first.blurb;
  readCfg();
  setTab('replay');
  if (shared) history.replaceState(null, '', location.pathname);
}
