import { type Launch, MACHINE, type RunResult, type TraceEvent } from '../core/gpu';
import { type Grade, type Hint, STAR_THRESHOLDS, grade, hints } from '../core/grade';
import { LEVELS, type Level } from '../core/levels';
import { h } from './dom';
import { type Progress, loadProgress, saveProgress } from './store';
import { eventLabel, laneStrip, smTimeline } from './viz';

const BLOCK_SIZES = [16, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];
const CURRENT_KEY = 'gpu-parallel-puzzler:current';

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function fmtMicros(us: number): string {
  return us < 10 ? `${us.toFixed(2)} µs` : `${us.toFixed(1)} µs`;
}

export function puzzleView(progress: Progress = loadProgress()): HTMLElement {
  let current: Level = LEVELS[0];
  try {
    const id = localStorage.getItem(CURRENT_KEY);
    current = LEVELS.find((l) => l.id === id) ?? LEVELS[0];
  } catch {
    /* default to the first level */
  }
  let lastGrade: Grade | null = null;
  let lastLaunch: Launch | null = null;
  let playTimer = 0;

  // ---------- level list ----------
  const levelButtons = LEVELS.map((l, i) =>
    h(
      'button',
      { type: 'button', class: 'level-btn', onclick: () => openLevel(l) },
      h('span', { class: 'lvl-num' }, String(i + 1)),
      h('span', { class: 'lvl-text' }, h('strong', {}, l.title), h('small', {}, l.concept)),
      h('span', { class: 'lvl-stars', 'aria-label': '' }),
    ),
  );
  const levelList = h('nav', { class: 'level-list', 'aria-label': 'Levels' }, ...levelButtons);
  const totalStars = h('p', { class: 'total-stars' });

  // ---------- editor ----------
  const title = h('h2', {});
  const concept = h('span', { class: 'concept' });
  const brief = h('div', { class: 'brief' });
  const gutter = h('pre', { class: 'gutter', 'aria-hidden': 'true' });
  const editor = h('textarea', { class: 'editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Kernel code' });
  const editorWrap = h('div', { class: 'editor-wrap' }, gutter, editor);
  let markedLine = 0;
  function renderGutter(): void {
    const lines = editor.value.split('\n').length;
    gutter.replaceChildren(...Array.from({ length: lines }, (_, i) => h('span', { class: i + 1 === markedLine ? 'mark' : '' }, `${i + 1}\n`)));
    gutter.scrollTop = editor.scrollTop;
  }
  function markLine(line: number): void {
    markedLine = line;
    renderGutter();
    if (line > 0) {
      const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
      const top = (line - 1) * lh;
      if (top < editor.scrollTop || top > editor.scrollTop + editor.clientHeight - lh) editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
      gutter.scrollTop = editor.scrollTop;
    }
  }
  editor.addEventListener('input', () => {
    markedLine = 0;
    renderGutter();
    persist();
  });
  editor.addEventListener('scroll', () => (gutter.scrollTop = editor.scrollTop));
  editor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab' && !ev.shiftKey) {
      ev.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = editor;
      editor.value = value.slice(0, a) + '  ' + value.slice(b);
      editor.selectionStart = editor.selectionEnd = a + 2;
      renderGutter();
      persist();
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      run();
    }
  });

  // ---------- launch ----------
  const gridInput = h('input', { type: 'number', min: 1, max: 4096, step: 1, class: 'num-input', 'aria-label': 'Blocks in the grid', oninput: () => persist() });
  const blockSel = h('select', { 'aria-label': 'Threads per block', onchange: () => persist() }, ...BLOCK_SIZES.map((b) => h('option', { value: String(b) }, String(b))));
  const launchRule = h('small', { class: 'muted' });
  const coverBtn = h('button', { type: 'button', class: 'secondary small', onclick: () => cover() }, 'Cover n');
  const threadsNote = h('span', { class: 'muted small threads-note' });
  const runBtn = h('button', { type: 'button', onclick: () => run(), title: 'Ctrl+Enter' }, 'Run kernel');
  const resetBtn = h('button', { type: 'button', class: 'secondary', onclick: () => resetCode() }, 'Reset code');
  const solutionBtn = h('button', { type: 'button', class: 'secondary', onclick: () => showSolution() }, 'Show a 3-star solution');
  const solutionBox = h('div', { class: 'solution', hidden: true });

  function readLaunch(): Launch {
    return { grid: Math.round(Number(gridInput.value)), block: Number(blockSel.value) };
  }
  function cover(): void {
    const n = current.params.n ?? 0;
    const b = Number(blockSel.value);
    let gsz = Math.ceil(n / b);
    if (current.rules.maxGrid) gsz = Math.min(gsz, current.rules.maxGrid);
    gridInput.value = String(Math.max(1, gsz));
    persist();
  }
  function updateThreads(): void {
    const l = readLaunch();
    const n = current.params.n;
    threadsNote.textContent = `${(l.grid * l.block).toLocaleString()} threads in ${Math.ceil(l.block / 32) * l.grid} warps${n ? ` for n = ${n.toLocaleString()}` : ''}`;
  }

  // ---------- results ----------
  const verdict = h('div', { class: 'verdict', role: 'status', 'aria-live': 'polite' });
  const tiles = h('div', { class: 'tiles' });
  const compareBars = h('div', { class: 'compare-bars' });
  const hintList = h('ul', { class: 'hints' });
  const timelineBox = h('div', {});
  const warpBox = h('div', { class: 'warp-box' });
  const results = h(
    'section',
    { class: 'results', hidden: true },
    verdict,
    compareBars,
    tiles,
    h('h3', {}, 'Diagnosis'),
    hintList,
    h('details', { class: 'card', open: true }, h('summary', {}, 'Blocks on the SMs'), timelineBox),
    h('details', { class: 'card', open: true }, h('summary', {}, 'Warp inspector'), warpBox),
  );

  function persist(): void {
    updateThreads();
    const p = progress[current.id] ?? { code: current.starter, launch: current.starterLaunch, stars: 0, bestCycles: null, attempts: 0 };
    p.code = editor.value;
    p.launch = readLaunch();
    progress[current.id] = p;
    saveProgress(progress);
  }

  function refreshList(): void {
    let total = 0;
    LEVELS.forEach((l, i) => {
      const st = progress[l.id]?.stars ?? 0;
      total += st;
      const btn = levelButtons[i];
      (btn.querySelector('.lvl-stars') as HTMLElement).textContent = stars(st);
      btn.classList.toggle('current', l.id === current.id);
      btn.setAttribute('aria-current', l.id === current.id ? 'true' : 'false');
      btn.setAttribute('aria-label', `Level ${i + 1}: ${l.title}, ${st} of 3 stars`);
    });
    totalStars.textContent = `${total} / ${LEVELS.length * 3} stars`;
  }

  function openLevel(l: Level): void {
    window.clearInterval(playTimer);
    current = l;
    try {
      localStorage.setItem(CURRENT_KEY, l.id);
    } catch {
      /* ignore */
    }
    const p = progress[l.id];
    title.textContent = `${LEVELS.indexOf(l) + 1}. ${l.title}`;
    concept.textContent = l.concept;
    brief.replaceChildren(...l.brief.map((t) => h('p', {}, t)));
    editor.value = p?.code ?? l.starter;
    const launch = p?.launch ?? l.starterLaunch;
    gridInput.value = String(launch.grid);
    blockSel.value = String(launch.block);
    if (!BLOCK_SIZES.includes(launch.block)) blockSel.value = '256';
    blockSel.disabled = l.rules.fixedBlock !== undefined;
    const rules: string[] = [];
    if (l.rules.fixedBlock) rules.push(`blocks fixed at ${l.rules.fixedBlock} threads`);
    if (l.rules.maxGrid) rules.push(`at most ${l.rules.maxGrid} blocks`);
    launchRule.textContent = rules.length ? `This level: ${rules.join(', ')}.` : '';
    coverBtn.hidden = l.params.n === undefined;
    solutionBox.hidden = true;
    results.hidden = true;
    markedLine = 0;
    renderGutter();
    updateThreads();
    refreshList();
  }

  function resetCode(): void {
    editor.value = current.starter;
    gridInput.value = String(current.starterLaunch.grid);
    blockSel.value = String(current.starterLaunch.block);
    markedLine = 0;
    renderGutter();
    persist();
  }

  function showSolution(): void {
    const solved = (progress[current.id]?.stars ?? 0) > 0;
    if (!solved && !window.confirm('Show a three-star solution before you have solved this level?')) return;
    solutionBox.hidden = false;
    solutionBox.replaceChildren(
      h('p', { class: 'muted small' }, `Launch: ${current.referenceLaunch.grid} blocks × ${current.referenceLaunch.block} threads. Other solutions can tie or beat it.`),
      h('pre', {}, current.reference),
      h('button', { type: 'button', class: 'secondary small', onclick: () => { editor.value = current.reference; gridInput.value = String(current.referenceLaunch.grid); blockSel.value = String(current.referenceLaunch.block); renderGutter(); persist(); } }, 'Load into editor'),
    );
  }

  function run(): void {
    window.clearInterval(playTimer);
    const launch = readLaunch();
    const g = grade(current, editor.value, launch);
    lastGrade = g;
    lastLaunch = launch;
    const p = progress[current.id] ?? { code: editor.value, launch, stars: 0, bestCycles: null, attempts: 0 };
    p.attempts++;
    if (g.stars > p.stars) p.stars = g.stars;
    if (g.correct && g.run.races.length === 0 && (p.bestCycles === null || g.run.stats.gpuCycles < p.bestCycles)) p.bestCycles = g.run.stats.gpuCycles;
    progress[current.id] = p;
    persist();
    refreshList();
    renderResults(g, launch);
  }

  function renderResults(g: Grade, launch: Launch): void {
    results.hidden = false;
    const r = g.run;
    const st = r.stats;
    const hs = hints(current, g, launch);
    if (r.error) {
      verdict.className = 'verdict bad';
      verdict.replaceChildren(h('strong', {}, r.error.kind === 'syntax' ? 'Does not compile' : r.error.kind === 'launch' ? 'Launch rejected' : 'Crashed'), ` ${r.error.line ? `line ${r.error.line}: ` : ''}${r.error.message}`);
      markLine(r.error.line);
    } else if (!g.correct || r.races.length) {
      verdict.className = 'verdict bad';
      verdict.replaceChildren(h('strong', {}, g.correct ? 'Correct output, but with a data race' : 'Wrong answer'), g.correct ? ' (on another run, or another GPU, it may not be). No stars until the race is gone.' : '');
      markLine(r.races[0]?.line ?? 0);
    } else {
      verdict.className = `verdict good stars-${g.stars}`;
      verdict.replaceChildren(
        h('span', { class: 'big-stars', 'aria-label': `${g.stars} of 3 stars` }, stars(g.stars)),
        h('strong', {}, ' Correct.'),
        ` ${st.gpuCycles.toLocaleString()} GPU cycles; par is ${g.par.toLocaleString()} (${g.ratio.toFixed(2)}×). Three stars at ≤ ${STAR_THRESHOLDS.three}× par, two at ≤ ${STAR_THRESHOLDS.two}×.`,
      );
      markLine(0);
    }
    if (r.error && r.error.kind !== 'runtime') {
      compareBars.replaceChildren();
      tiles.replaceChildren();
      timelineBox.replaceChildren();
      warpBox.replaceChildren();
    } else {
      const max = Math.max(st.gpuMicros, st.cpuMicros, 1e-9);
      const bar = (label: string, us: number, cls: string) =>
        h('div', { class: 'cmp-row' }, h('span', { class: 'cmp-label' }, label), h('span', { class: 'cmp-track' }, h('span', { class: `cmp-bar ${cls}`, style: `width: ${Math.max(0.5, (us / max) * 100)}%` })), h('span', { class: 'cmp-val' }, fmtMicros(us)));
      compareBars.replaceChildren(
        bar(`GPU (${MACHINE.sms} SMs, ${MACHINE.gpuGHz} GHz)`, st.gpuMicros, 'gpu'),
        bar(`CPU (1 core, ${MACHINE.cpuGHz} GHz)`, st.cpuMicros, 'cpu'),
        h('p', { class: 'muted small' }, `Estimated by the toy cost model. The CPU does one thread-operation per cycle: ${st.cpuCycles.toLocaleString()} of them. ${st.cpuMicros > st.gpuMicros ? `GPU speed-up: ${(st.cpuMicros / st.gpuMicros).toFixed(1)}×.` : 'The CPU wins: this launch is too small or too wasteful to pay for the GPU.'}`),
      );
      const tile = (label: string, value: string, warn = false, help = '') => h('div', { class: `tile ${warn ? 'warn' : ''}`, title: help }, h('span', { class: 'tile-label' }, label), h('strong', {}, value));
      tiles.replaceChildren(
        tile('Warp instructions', st.issues.toLocaleString(), false, 'Instructions issued, counting a whole warp as one'),
        tile('Lanes busy', `${Math.round(st.laneUtilization * 100)}%`, st.laneUtilization < 0.85, 'Active lanes per issued warp instruction'),
        tile('Divergent branches', st.divergentBranches.toLocaleString(), st.divergentBranches > st.warps / 2),
        tile('Coalescing', st.globalTransactions ? `${Math.round(st.coalescing * 100)}%` : '–', st.coalescing < 0.75, 'Ideal over actual 128-byte segments fetched'),
        tile('Bank-conflict cycles', st.bankConflictCycles.toLocaleString(), st.worstBankConflict >= 4),
        tile('Atomics (hottest address)', st.atomics ? `${st.atomics.toLocaleString()} (${st.atomicHotspot.toLocaleString()})` : '0', st.atomicHotspot > 1000),
        tile('sync() calls', st.syncs.toLocaleString()),
        tile('Races found', String(r.races.length), r.races.length > 0),
      );
      timelineBox.replaceChildren(r.blocks.length ? smTimeline(r) : h('p', { class: 'muted' }, 'No block finished.'));
      renderWarps(r);
    }
    hintList.replaceChildren(...hs.map((x) => hintItem(x)));
  }

  function hintItem(x: Hint): HTMLElement {
    return h(
      'li',
      { class: `hint ${x.level}` },
      h('strong', {}, x.title),
      ' ',
      x.text,
      x.line ? h('button', { type: 'button', class: 'link', onclick: () => markLine(x.line as number) }, ` (show line ${x.line})`) : null,
    );
  }

  function renderWarps(r: RunResult): void {
    const keys = Object.keys(r.traces).filter((k) => r.traces[k].length > 0);
    if (keys.length === 0) {
      warpBox.replaceChildren(h('p', { class: 'muted' }, 'No traced warps.'));
      return;
    }
    const sel = h('select', { 'aria-label': 'Warp to inspect' }, ...keys.map((k) => {
      const [b, w] = k.split(':');
      return h('option', { value: k }, `block ${b}, warp ${w} (threads ${Number(w) * 32}–${Number(w) * 32 + 31})`);
    }));
    const list = h('ol', { class: 'events' });
    const playBtn = h('button', { type: 'button', class: 'secondary small' }, 'Play');
    let rows: HTMLElement[] = [];
    let at = -1;
    const select = (i: number) => {
      rows.forEach((row, j) => row.classList.toggle('current', j === i));
      at = i;
      const ev = r.traces[sel.value][i];
      if (ev) {
        markLine(ev.line);
        rows[i].scrollIntoView({ block: 'nearest' });
      }
    };
    const fill = () => {
      window.clearInterval(playTimer);
      playBtn.textContent = 'Play';
      const evs: TraceEvent[] = r.traces[sel.value];
      rows = evs.map((e, i) =>
        h('li', { class: `ev ${e.kind} ${e.diverged ? 'diverged' : ''}`, onclick: () => select(i) }, h('span', { class: 'ev-line' }, `L${e.line}`), laneStrip(e), h('span', { class: 'ev-text' }, eventLabel(e)), h('span', { class: 'ev-cost' }, `${e.cost}c`)),
      );
      list.replaceChildren(...rows);
      at = -1;
    };
    sel.addEventListener('change', fill);
    playBtn.addEventListener('click', () => {
      if (playBtn.textContent === 'Pause') {
        window.clearInterval(playTimer);
        playBtn.textContent = 'Play';
        return;
      }
      playBtn.textContent = 'Pause';
      playTimer = window.setInterval(() => {
        if (at + 1 >= rows.length || !list.isConnected) {
          window.clearInterval(playTimer);
          playBtn.textContent = 'Play';
          return;
        }
        select(at + 1);
      }, 350);
    });
    fill();
    warpBox.replaceChildren(
      h('div', { class: 'warp-tools' }, sel, playBtn),
      h('p', { class: 'muted small' }, 'Each row is one warp instruction. Filled cells are active lanes. For memory, the colour is the 128-byte segment (global) or the bank (shared): one colour across the warp means one transaction or no conflict. Click a row to see its line.'),
      list,
    );
  }

  // ---------- layout ----------
  const root = h(
    'div',
    { class: 'puzzle-layout' },
    h('aside', { class: 'sidebar' }, totalStars, levelList),
    h(
      'section',
      { class: 'workspace' },
      h('header', { class: 'level-head' }, title, concept),
      brief,
      editorWrap,
      h(
        'div',
        { class: 'launch' },
        h('span', { class: 'launch-code mono' }, 'kernel<<<'),
        gridInput,
        h('span', { class: 'mono' }, ','),
        blockSel,
        h('span', { class: 'launch-code mono' }, '>>>'),
        coverBtn,
        threadsNote,
      ),
      launchRule,
      h('div', { class: 'button-row' }, runBtn, resetBtn, solutionBtn),
      solutionBox,
      results,
    ),
  );
  openLevel(current);
  // Expose for the instructor view refresh.
  root.addEventListener('shown', () => {
    progress = loadProgress();
    refreshList();
    if (lastGrade && lastLaunch && results.hidden === false) renderResults(lastGrade, lastLaunch);
  });
  return root;
}
