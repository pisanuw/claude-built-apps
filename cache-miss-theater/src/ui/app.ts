import {
  DEFAULT_CONFIG,
  KIND_NAMES,
  Replay,
  addressBits,
  sets,
  simulate,
  validateConfig,
  type AccessResult,
  type CacheConfig,
  type Counts,
  type Kind,
  type Policy,
  type SimResult,
} from '../core/cache';
import { PRESETS, type Preset } from '../core/presets';
import { TEMPLATE_NAMES, describeCache, generate, toMarkdown, toQti, type Question } from '../core/quiz';
import { decodeState, encodeState } from '../core/share';
import { parseValues, sweep, type SweepPoint, type SweepTarget } from '../core/sweep';
import { buildTrace, elementLabel, type Trace } from '../core/trace';
import { elementsInLine, gridShape, hex, lineLabel, percent } from '../core/view';
import { el, svg } from './dom';

interface Run {
  trace: Trace;
  sim: SimResult;
}

const KIND_LABEL = ['hit', 'compulsory miss', 'capacity miss', 'conflict miss'];
const fmt = (n: number) => n.toLocaleString('en-US');

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const arrayColor = (id: number) => cssVar(`--arr-${id % 6}`);
const kindColor = (k: number) => cssVar(`--k-${KIND_NAMES[k]}`);

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function kindBar(c: Counts): HTMLElement {
  const bar = el('div', { class: 'kindbar', role: 'img', 'aria-label': `${c.hits} hits, ${c.compulsory} compulsory, ${c.capacity} capacity, ${c.conflict} conflict` });
  const parts: [string, number][] = [
    ['hit', c.hits],
    ['compulsory', c.compulsory],
    ['capacity', c.capacity],
    ['conflict', c.conflict],
  ];
  for (const [k, v] of parts) if (v) bar.append(el('span', { class: `k-${k}`, style: `flex-grow:${v}`, title: `${k}: ${fmt(v)}` }));
  return bar;
}

export function mountApp(root: HTMLElement): void {
  const shared = decodeState(location.hash);
  const first = PRESETS[0] as Preset;
  let cfg: CacheConfig = shared?.cfg ?? { ...DEFAULT_CONFIG, ...first.cache };
  let runs: (Run | null)[] = [null, null];
  let errors: string[] = ['', ''];
  let preset: Preset | null = shared ? null : first;
  let questions: Question[] = [];

  // ---------- kernels ----------
  const presetSelect = el(
    'select',
    { id: 'preset', 'aria-label': 'Example kernels' },
    el('option', { value: '' }, 'Examples…'),
    ...PRESETS.map((p) => el('option', { value: p.id }, p.name)),
  );
  const codeA = el('textarea', { id: 'code-a', spellcheck: 'false', rows: '14', 'aria-label': 'Kernel A' });
  const codeB = el('textarea', { id: 'code-b', spellcheck: 'false', rows: '14', 'aria-label': 'Kernel B' });
  const compare = el('input', { type: 'checkbox', id: 'compare' });
  codeA.value = shared?.a ?? first.a;
  codeB.value = shared ? shared.b : (first.b ?? '');
  compare.checked = !!codeB.value.trim();
  const errA = el('p', { class: 'error', role: 'alert' });
  const errB = el('p', { class: 'error', role: 'alert' });
  const presetNote = el('p', { class: 'note' }, shared ? '' : first.note);
  const shareBtn = el('button', { type: 'button', class: 'secondary' }, 'Copy share link');
  const paneB = el('div', { class: 'pane' }, el('h3', {}, 'Kernel B'), codeB, errB);

  const kernelsCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Kernels'),
    el('div', { class: 'row' }, presetSelect, el('label', {}, compare, ' Compare with a second kernel'), shareBtn),
    el('div', { class: 'panes' }, el('div', { class: 'pane' }, el('h3', {}, 'Kernel A'), codeA, errA), paneB),
    presetNote,
    el(
      'details',
      { class: 'help' },
      el('summary', {}, 'What code is accepted?'),
      el(
        'ul',
        { class: 'notes' },
        el('li', {}, 'Arrays of char, short, int, float, long, double (and the intN_t types), with up to any number of dimensions, laid out row-major. Each array starts at the next 64-byte boundary after the previous one, from 0x10000; write ', el('code', {}, 'double A[64] @ 0x8000;'), ' to place one yourself.'),
        el('li', {}, 'Scalars (', el('code', {}, 'int i'), ', ', el('code', {}, 'double sum'), ') live in registers and cause no memory traffic. ', el('code', {}, '#define'), ' and top-level scalar constants can be swept.'),
        el('li', {}, el('code', {}, 'for'), ', ', el('code', {}, 'while'), ', ', el('code', {}, 'if'), ', blocks, C operators, ', el('code', {}, 'min'), '/', el('code', {}, 'max'), '/', el('code', {}, 'abs'), ' and casts. A ', el('code', {}, 'void kernel(void) { … }'), ' wrapper is fine.'),
        el('li', {}, 'For ', el('code', {}, 'x = e'), ' the reads in e happen left to right, then the write. For ', el('code', {}, 'x += e'), ' and ', el('code', {}, 'x++'), ' x is read first. Array contents are not simulated, so indices may not depend on them.'),
      ),
    ),
  );

  // ---------- cache config ----------
  const sizeSel = el('select', { id: 'size', 'aria-label': 'Cache size' });
  for (const s of [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 262144])
    sizeSel.append(el('option', { value: String(s) }, s >= 1024 ? `${s / 1024} KB` : `${s} B`));
  const lineSel = el('select', { id: 'line', 'aria-label': 'Line size' });
  for (const s of [8, 16, 32, 64, 128]) lineSel.append(el('option', { value: String(s) }, `${s} B`));
  const waysSel = el('select', { id: 'ways', 'aria-label': 'Associativity' });
  const policySel = el(
    'select',
    { id: 'policy', 'aria-label': 'Replacement policy' },
    el('option', { value: 'lru' }, 'LRU'),
    el('option', { value: 'fifo' }, 'FIFO'),
    el('option', { value: 'random' }, 'Random'),
  );
  const allocSel = el(
    'select',
    { id: 'alloc', 'aria-label': 'Write miss policy' },
    el('option', { value: 'wa' }, 'write-allocate'),
    el('option', { value: 'nwa' }, 'no-write-allocate'),
  );
  const wbSel = el('select', { id: 'wb', 'aria-label': 'Write hit policy' }, el('option', { value: 'wb' }, 'write-back'), el('option', { value: 'wt' }, 'write-through'));
  const seedIn = el('input', { type: 'number', id: 'seed', value: String(cfg.seed), min: '1', 'aria-label': 'Random replacement seed' });
  const geometry = el('p', { class: 'muted small' });
  const cfgErr = el('p', { class: 'error', role: 'alert' });

  function fillWays(): void {
    const lines = Number(sizeSel.value) / Number(lineSel.value);
    const keep = waysSel.value;
    waysSel.replaceChildren();
    for (let w = 1; w <= lines; w *= 2) {
      const label = w === lines ? `fully associative (${w})` : w === 1 ? 'direct-mapped' : `${w}-way`;
      waysSel.append(el('option', { value: String(w) }, label));
      if (w >= 64 && w * 2 < lines) w = lines / 2; // jump to fully associative
    }
    waysSel.value = keep;
    if (!waysSel.value) waysSel.value = String(Math.min(2, lines));
  }

  function showConfig(c: CacheConfig): void {
    sizeSel.value = String(c.size);
    lineSel.value = String(c.lineSize);
    fillWays();
    waysSel.value = String(c.ways);
    policySel.value = c.policy;
    allocSel.value = c.writeAllocate ? 'wa' : 'nwa';
    wbSel.value = c.writeBack ? 'wb' : 'wt';
    seedIn.value = String(c.seed);
  }

  function readConfig(): CacheConfig {
    return {
      size: Number(sizeSel.value),
      lineSize: Number(lineSel.value),
      ways: Number(waysSel.value),
      policy: policySel.value as Policy,
      writeAllocate: allocSel.value === 'wa',
      writeBack: wbSel.value === 'wb',
      seed: Math.max(1, Math.floor(Number(seedIn.value) || 1)),
    };
  }

  const field = (label: string, input: HTMLElement) => el('label', { class: 'field' }, el('span', {}, label), input);
  const cacheCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Cache'),
    el(
      'div',
      { class: 'fields' },
      field('Size', sizeSel),
      field('Line', lineSel),
      field('Associativity', waysSel),
      field('Replacement', policySel),
      field('Write miss', allocSel),
      field('Write hit', wbSel),
      field('Seed', seedIn),
    ),
    geometry,
    cfgErr,
  );

  // ---------- results ----------
  const resultsBody = el('div', { class: 'results' });
  const resultsCard = el('section', { class: 'card' }, el('h2', {}, 'Results'), resultsBody);

  function statTable(run: Run, title: string): HTMLElement {
    const s = run.sim.stats;
    const rows: [string, string][] = [
      ['Accesses', `${fmt(s.accesses)} (${fmt(s.reads)} reads, ${fmt(s.writes)} writes)`],
      ['Hits', fmt(s.hits)],
      ['Misses', `${fmt(s.misses)} (${percent(s.missRate)})`],
      ['Compulsory', fmt(s.compulsory)],
      ['Capacity', fmt(s.capacity)],
      ['Conflict', fmt(s.conflict)],
      ['Bytes from memory', fmt(s.bytesIn)],
      ['Bytes to memory', cfg.writeBack ? `${fmt(s.bytesOut)} (${fmt(s.writebacks)} write-backs, ${fmt(s.dirtyAtEnd)} dirty lines left)` : `${fmt(s.bytesOut)} (write-through)`],
    ];
    const perArray = el(
      'table',
      { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Array'), el('th', {}, 'Accesses'), el('th', {}, 'Misses'), el('th', {}, 'Miss rate'), el('th', {}, 'Mix'))),
      el(
        'tbody',
        {},
        ...run.trace.arrays.map((a) => {
          const c = s.perArray[a.id] as Counts;
          return el(
            'tr',
            {},
            el('td', {}, el('span', { class: 'swatch', style: `background:var(--arr-${a.id % 6})` }), `${a.type} ${a.name}${a.dims.map((d) => `[${d}]`).join('')} @ ${hex(a.base)}`),
            el('td', { class: 'num' }, fmt(c.accesses)),
            el('td', { class: 'num' }, fmt(c.misses)),
            el('td', { class: 'num' }, c.accesses ? percent(c.misses / c.accesses) : '–'),
            el('td', {}, kindBar(c)),
          );
        }),
      ),
    );
    return el(
      'div',
      { class: 'result' },
      el('h3', {}, title),
      el('div', { class: 'big' }, el('span', { class: 'v' }, percent(s.missRate)), el('span', { class: 'k' }, 'miss rate')),
      kindBar(s),
      el('table', { class: 'tbl kv' }, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v))))),
      el('h3', {}, 'By array'),
      // Wide tables and code scroll sideways on a phone: each box is a focusable, named region, so a keyboard can scroll it.
      el('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': `${title}: by array` }, perArray),
      el('h3', {}, 'By source line'),
      annotated(run, title === 'Kernel B' ? codeB.value : codeA.value, `${title}: by source line`),
    );
  }

  function annotated(run: Run, src: string, label: string): HTMLElement {
    const lines = src.replace(/\s+$/, '').split('\n');
    const max = Math.max(1, ...[...run.sim.stats.perLine.values()].map((c) => c.misses));
    const pre = el('div', { class: 'annot' });
    lines.forEach((text, i) => {
      const c = run.sim.stats.perLine.get(i + 1);
      pre.append(
        el(
          'div',
          { class: 'aline' },
          el('span', { class: 'ln' }, String(i + 1)),
          el('span', { class: 'heat' }, c ? el('span', { style: `width:${(c.misses / max) * 100}%` }) : ''),
          el('span', { class: 'cnt', title: c ? `${fmt(c.accesses)} accesses` : '' }, c ? `${fmt(c.misses)} miss${c.misses === 1 ? '' : 'es'}` : ''),
          el('code', { class: 'src' }, text || ' '),
        ),
      );
    });
    return el('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': label }, pre);
  }

  function renderResults(): void {
    resultsBody.replaceChildren();
    const shown = compare.checked ? [0, 1] : [0];
    const ok = shown.filter((i) => runs[i]);
    if (!ok.length) {
      resultsBody.append(el('p', { class: 'muted' }, 'Fix the errors above to see results.'));
      return;
    }
    if (ok.length === 2) {
      const a = (runs[0] as Run).sim.stats;
      const b = (runs[1] as Run).sim.stats;
      const ratio = a.misses && b.misses ? (a.misses > b.misses ? `A misses ${(a.misses / b.misses).toFixed(1)}× as often as B` : a.misses < b.misses ? `B misses ${(b.misses / a.misses).toFixed(1)}× as often as A` : 'A and B miss equally often') : '';
      if (ratio) resultsBody.append(el('p', { class: 'note' }, `${ratio}: ${fmt(a.misses)} vs ${fmt(b.misses)} misses on ${fmt(a.accesses)} vs ${fmt(b.accesses)} accesses.`));
    }
    const cols = el('div', { class: ok.length === 2 ? 'two' : 'one' });
    for (const i of ok) cols.append(statTable(runs[i] as Run, i === 0 ? 'Kernel A' : 'Kernel B'));
    resultsBody.append(cols);
  }

  // ---------- theater ----------
  const which = el('select', { 'aria-label': 'Kernel to replay' }, el('option', { value: '0' }, 'Kernel A'), el('option', { value: '1' }, 'Kernel B'));
  const playBtn = el('button', { type: 'button' }, 'Play');
  const stepBtn = el('button', { type: 'button', class: 'secondary' }, 'Step');
  const backBtn = el('button', { type: 'button', class: 'secondary' }, 'Back');
  const nextMissBtn = el('button', { type: 'button', class: 'secondary' }, 'Next miss');
  const resetBtn = el('button', { type: 'button', class: 'secondary' }, 'Reset');
  const speedSel = el('select', { 'aria-label': 'Playback speed' });
  for (const s of [2, 10, 50, 250, 2000, 20000]) speedSel.append(el('option', { value: String(s) }, `${fmt(s)} / s`));
  speedSel.value = '10';
  const scrub = el('input', { type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Position in trace' });
  const posLabel = el('span', { class: 'muted small mono' });
  const current = el('div', { class: 'current', 'aria-live': 'polite' });
  const cacheCanvas = el('canvas', { class: 'cachegrid', role: 'img', 'aria-label': 'Cache contents by set and way' });
  const cacheTip = el('p', { class: 'muted small mono tip' }, ' ');
  const memBox = el('div', { class: 'mem' });
  const log = el('ol', { class: 'log', reversed: '' });
  const counters = el('div', { class: 'counters' });

  const theaterCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Theater'),
    el('div', { class: 'row' }, which, backBtn, playBtn, stepBtn, nextMissBtn, resetBtn, el('label', {}, 'Speed ', speedSel)),
    el('div', { class: 'row' }, scrub, posLabel),
    current,
    counters,
    el(
      'div',
      { class: 'stage' },
      el('div', { class: 'stage-cache' }, el('h3', {}, 'Cache (sets × ways)'), el('div', { class: 'cachewrap' }, cacheCanvas), cacheTip),
      el('div', { class: 'stage-mem' }, el('h3', {}, 'Memory'), memBox, el('h3', {}, 'Recent accesses'), log),
    ),
    el(
      'div',
      { class: 'legend' },
      el('span', { class: 'chip k-hit' }, 'hit'),
      el('span', { class: 'chip k-compulsory' }, 'compulsory: first touch of the line'),
      el('span', { class: 'chip k-capacity' }, 'capacity: a fully associative cache of this size misses too'),
      el('span', { class: 'chip k-conflict' }, 'conflict: only the set mapping caused it'),
    ),
  );

  let replay: Replay | null = null;
  let last: { index: number; kind: Kind; result: AccessResult } | null = null;
  let touched: Uint8Array[] = [];
  let running: number[] = [0, 0, 0, 0];
  let playing = false;
  let raf = 0;
  let recent: { index: number; kind: Kind; result: AccessResult }[] = [];

  function theaterRun(): Run | null {
    return runs[Number(which.value)] ?? null;
  }

  function resetTheater(): void {
    stop();
    const run = theaterRun();
    replay = run ? new Replay(run.trace, cfg) : null;
    touched = run ? run.trace.arrays.map((a) => new Uint8Array(a.bytes / a.elemSize)) : [];
    running = [0, 0, 0, 0];
    last = null;
    recent = [];
    scrub.max = String(run ? run.trace.length : 0);
    renderTheater();
  }

  function stepOne(): void {
    if (!replay || replay.done) return;
    const r = replay.step();
    const t = replay.trace;
    (touched[t.array[r.index] as number] as Uint8Array)[t.elem[r.index] as number] = 1;
    running[r.kind] = (running[r.kind] as number) + 1;
    last = r;
    recent.push(r);
    if (recent.length > 12) recent.shift();
  }

  function seek(target: number): void {
    if (!replay) return;
    target = Math.max(0, Math.min(target, replay.trace.length));
    if (target < replay.pos) {
      const keep = playing;
      resetTheater();
      playing = keep;
    }
    while (replay && replay.pos < target) stepOne();
    renderTheater();
  }

  function stop(): void {
    playing = false;
    cancelAnimationFrame(raf);
    playBtn.textContent = 'Play';
  }

  function play(): void {
    if (!replay || replay.done) return;
    playing = true;
    playBtn.textContent = 'Pause';
    let prev = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      if (!playing || !replay) return;
      acc += ((now - prev) / 1000) * Number(speedSel.value);
      prev = now;
      const n = Math.floor(acc);
      acc -= n;
      for (let i = 0; i < n && !replay.done; i++) stepOne();
      if (n) renderTheater();
      if (replay.done) stop();
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function describeAccess(t: Trace, r: { index: number; kind: Kind; result: AccessResult }): string {
    const label = elementLabel(t.arrays[t.array[r.index] as number] as Trace['arrays'][number], t.elem[r.index] as number);
    return `${t.write[r.index] ? 'write' : 'read'} ${label}`;
  }

  function renderTheater(): void {
    const run = theaterRun();
    if (!run || !replay) {
      current.replaceChildren(el('p', { class: 'muted' }, 'Nothing to replay yet.'));
      counters.replaceChildren();
      memBox.replaceChildren();
      log.replaceChildren();
      sizeCanvas(cacheCanvas, 10, 10);
      posLabel.textContent = '';
      return;
    }
    const t = run.trace;
    scrub.value = String(replay.pos);
    posLabel.textContent = `${fmt(replay.pos)} / ${fmt(t.length)}`;
    const bits = addressBits(cfg);
    if (last) {
      const i = last.index;
      const addr = t.addr[i] as number;
      const lineNo = Math.floor(addr / cfg.lineSize);
      const tag = Math.floor(lineNo / sets(cfg));
      const parts: (string | Node)[] = [
        el('span', { class: 'mono' }, `#${fmt(i + 1)}  line ${t.line[i]}: ${describeAccess(t, last)} @ ${hex(addr)}`),
        el('span', { class: 'mono muted' }, `  tag ${hex(tag)} · set ${last.result.set} · offset ${addr % cfg.lineSize}`),
        el('span', { class: `chip k-${KIND_NAMES[last.kind]}` }, KIND_LABEL[last.kind] as string),
      ];
      if (last.result.way < 0) parts.push(el('span', { class: 'muted' }, ' not allocated (no-write-allocate)'));
      else if (!last.result.hit) parts.push(el('span', { class: 'muted' }, ` → way ${last.result.way}`));
      if (last.result.evicted >= 0)
        parts.push(el('span', { class: 'muted' }, `, evicted ${lineLabel(t, last.result.evicted, cfg.lineSize)}${last.result.writeback ? ' (dirty, written back)' : ''}`));
      current.replaceChildren(...parts);
    } else {
      current.replaceChildren(
        el('span', { class: 'muted' }, `Press Play or Step. Address bits: ${bits.offset} offset, ${bits.index} index, the rest tag. The cache starts empty.`),
      );
    }
    const done = running.reduce((x, y) => x + y, 0);
    const misses = done - (running[0] as number);
    counters.replaceChildren(
      el('span', {}, `${fmt(done)} accesses`),
      el('span', { class: 'k-hit-t' }, `${fmt(running[0] as number)} hits`),
      el('span', {}, `${fmt(misses)} misses${done ? ` (${percent(misses / done)})` : ''}`),
      el('span', { class: 'k-compulsory-t' }, `${fmt(running[1] as number)} compulsory`),
      el('span', { class: 'k-capacity-t' }, `${fmt(running[2] as number)} capacity`),
      el('span', { class: 'k-conflict-t' }, `${fmt(running[3] as number)} conflict`),
    );
    drawCache(t);
    drawMemory(t);
    log.replaceChildren(
      ...[...recent].reverse().map((r) =>
        el('li', { value: String(r.index + 1) }, el('span', { class: `dot k-${KIND_NAMES[r.kind]}` }), `${describeAccess(t, r)}`, el('span', { class: 'muted' }, ` · set ${r.result.set} · ${KIND_LABEL[r.kind]}`)),
      ),
    );
  }

  function cacheLayout(): { cellW: number; cellH: number; labelW: number } {
    const avail = Math.max(240, (cacheCanvas.parentElement?.clientWidth ?? 400) - 4);
    const labelW = 34;
    // Canvases taller than about 16k px fail in some browsers, so big caches get thinner rows.
    const cellH = sets(cfg) <= 800 ? 20 : Math.max(2, Math.floor(16000 / sets(cfg)));
    return { cellW: Math.max(2, Math.min(170, Math.floor((avail - labelW) / cfg.ways))), cellH, labelW };
  }

  function drawCache(t: Trace): void {
    if (!replay) return;
    const c = replay.cache;
    const { cellW, cellH: CELL_H, labelW } = cacheLayout();
    const w = labelW + cellW * c.ways;
    const h = CELL_H * c.sets;
    const ctx = sizeCanvas(cacheCanvas, w, h);
    const fg = cssVar('--fg');
    const muted = cssVar('--muted');
    const border = cssVar('--border');
    ctx.font = `11px ${cssVar('--mono')}`;
    ctx.textBaseline = 'middle';
    for (let s = 0; s < c.sets; s++) {
      ctx.fillStyle = muted;
      if (CELL_H >= 12) ctx.fillText(String(s), 4, s * CELL_H + CELL_H / 2);
      for (let wy = 0; wy < c.ways; wy++) {
        const slot = s * c.ways + wy;
        const x = labelW + wy * cellW;
        const y = s * CELL_H;
        const line = c.lines[slot] as number;
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        if (line >= 0) {
          const a = t.arrays.find((ar) => elementsInLine(ar, line, cfg.lineSize));
          ctx.fillStyle = a ? arrayColor(a.id) : border;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x + 1, y + 1, cellW - 2, CELL_H - 2);
          ctx.globalAlpha = 1;
          if (cellW >= 60 && CELL_H >= 12) {
            ctx.fillStyle = fg;
            const label = lineLabel(t, line, cfg.lineSize) + (c.dirty[slot] ? ' *' : '');
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 2, y, cellW - 4, CELL_H);
            ctx.clip();
            ctx.fillText(label, x + 4, y + CELL_H / 2 + 1);
            ctx.restore();
          } else if (c.dirty[slot] && cellW >= 8 && CELL_H >= 12) {
            ctx.fillStyle = fg;
            ctx.fillText('*', x + 3, y + CELL_H / 2 + 1);
          }
        }
        if (cellW >= 6 && CELL_H >= 6) ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, CELL_H - 1);
      }
    }
    if (last) {
      const { set, way } = last.result;
      ctx.strokeStyle = kindColor(last.kind);
      ctx.lineWidth = 3;
      if (way >= 0) ctx.strokeRect(labelW + way * cellW + 1.5, set * CELL_H + 1.5, cellW - 3, CELL_H - 3);
      else ctx.strokeRect(labelW + 1.5, set * CELL_H + 1.5, cellW * c.ways - 3, CELL_H - 3);
      // Keep the active set visible in the scroll box.
      const wrap = cacheCanvas.parentElement as HTMLElement;
      const top = set * CELL_H;
      if (top < wrap.scrollTop || top + CELL_H > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = top - wrap.clientHeight / 2;
    }
  }

  cacheCanvas.addEventListener('mousemove', (ev) => {
    const run = theaterRun();
    if (!replay || !run) return;
    const { cellW, cellH: CELL_H, labelW } = cacheLayout();
    const rect = cacheCanvas.getBoundingClientRect();
    const s = Math.floor((ev.clientY - rect.top) / CELL_H);
    const wy = Math.floor((ev.clientX - rect.left - labelW) / cellW);
    if (s < 0 || s >= replay.cache.sets || wy < 0 || wy >= replay.cache.ways) {
      cacheTip.textContent = ' ';
      return;
    }
    const slot = s * replay.cache.ways + wy;
    const line = replay.cache.lines[slot] as number;
    if (line < 0) {
      cacheTip.textContent = `set ${s}, way ${wy}: empty`;
      return;
    }
    const by = replay.cache.filledBy[slot] as number;
    cacheTip.textContent = `set ${s}, way ${wy}: ${lineLabel(run.trace, line, cfg.lineSize)} (${hex(line * cfg.lineSize)}), brought in by access #${fmt(by + 1)}${replay.cache.dirty[slot] ? ', dirty' : ''}`;
  });

  function drawMemory(t: Trace): void {
    if (!replay) return;
    const c = replay.cache;
    const cached = t.arrays.map((a) => new Uint8Array(a.bytes / a.elemSize));
    for (let slot = 0; slot < c.lines.length; slot++) {
      const line = c.lines[slot] as number;
      if (line < 0) continue;
      for (const a of t.arrays) {
        const r = elementsInLine(a, line, cfg.lineSize);
        if (r) for (let e = r[0]; e <= r[1]; e++) (cached[a.id] as Uint8Array)[e] = 1;
      }
    }
    const avail = Math.max(200, memBox.clientWidth || 360);
    const blank = cssVar('--mem-empty');
    const seen = cssVar('--mem-seen');
    const strong = cssVar('--fg');
    const kids: HTMLElement[] = [];
    for (const a of t.arrays) {
      const { rows, cols } = gridShape(a, cfg.lineSize);
      const cell = Math.max(2, Math.min(14, Math.floor(avail / cols)));
      const canvas = el('canvas', { role: 'img', 'aria-label': `Memory of array ${a.name}` });
      const ctx = sizeCanvas(canvas, cols * cell, Math.min(rows, 4096) * cell);
      const tch = touched[a.id] as Uint8Array;
      const cch = cached[a.id] as Uint8Array;
      const count = a.bytes / a.elemSize;
      const col = arrayColor(a.id);
      for (let e = 0; e < count && e < 4096 * cols; e++) {
        const x = (e % cols) * cell;
        const y = Math.floor(e / cols) * cell;
        if (cch[e]) {
          ctx.fillStyle = col;
        } else ctx.fillStyle = tch[e] ? seen : blank;
        ctx.fillRect(x, y, cell - (cell > 4 ? 1 : 0), cell - (cell > 4 ? 1 : 0));
      }
      if (last && t.array[last.index] === a.id) {
        const e = t.elem[last.index] as number;
        // Outline the elements the current line holds, then the element itself.
        const r = elementsInLine(a, Math.floor((t.addr[last.index] as number) / cfg.lineSize), cfg.lineSize);
        ctx.strokeStyle = kindColor(last.kind);
        ctx.lineWidth = 2;
        if (r)
          for (let x = r[0]; x <= r[1]; x++) ctx.strokeRect((x % cols) * cell + 1, Math.floor(x / cols) * cell + 1, cell - 2, cell - 2);
        ctx.fillStyle = strong;
        ctx.fillRect((e % cols) * cell + cell / 4, Math.floor(e / cols) * cell + cell / 4, Math.max(1, cell / 2), Math.max(1, cell / 2));
      }
      const caption = `${a.type} ${a.name}${a.dims.map((d) => `[${d}]`).join('')} @ ${hex(a.base)}–${hex(a.base + a.bytes - 1)}${a.dims.length === 1 ? `, shown ${cols} per row` : ''}`;
      kids.push(el('div', { class: 'memarr' }, el('div', { class: 'small mono' }, el('span', { class: 'swatch', style: `background:var(--arr-${a.id % 6})` }), caption), canvas));
    }
    memBox.replaceChildren(...kids);
  }

  which.addEventListener('change', resetTheater);
  playBtn.addEventListener('click', () => (playing ? stop() : play()));
  stepBtn.addEventListener('click', () => {
    stop();
    stepOne();
    renderTheater();
  });
  backBtn.addEventListener('click', () => {
    stop();
    if (replay) seek(replay.pos - 1);
  });
  nextMissBtn.addEventListener('click', () => {
    stop();
    const run = theaterRun();
    if (!replay || !run) return;
    let i = replay.pos;
    while (i < run.trace.length && run.sim.kinds[i] === 0) i++;
    seek(i + 1);
  });
  resetBtn.addEventListener('click', resetTheater);
  scrub.addEventListener('input', () => {
    stop();
    seek(Number(scrub.value));
  });

  // ---------- sweep ----------
  const sweepTarget = el('select', { 'aria-label': 'What to vary' });
  const sweepValues = el('input', { type: 'text', 'aria-label': 'Values', class: 'wide' });
  const sweepBtn = el('button', { type: 'button' }, 'Run sweep');
  const sweepOut = el('div', { class: 'sweep' });
  const sweepErr = el('p', { class: 'error', role: 'alert' });
  const sweepCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Sweep'),
    el('p', { class: 'muted small' }, 'Re-run both kernels while one knob changes: a #define or constant in the code, or a cache parameter.'),
    el('div', { class: 'row' }, el('label', {}, 'Vary ', sweepTarget), el('label', { class: 'grow' }, 'Values ', sweepValues), sweepBtn),
    sweepErr,
    sweepOut,
  );

  function fillSweepTargets(): void {
    const keep = sweepTarget.value;
    const names = new Set<string>();
    for (const r of runs) if (r) for (const c of r.trace.constants) names.add(c.name);
    sweepTarget.replaceChildren(
      ...[...names].map((n) => el('option', { value: `const:${n}` }, n)),
      el('option', { value: 'size' }, 'cache size (bytes)'),
      el('option', { value: 'lineSize' }, 'line size (bytes)'),
      el('option', { value: 'ways' }, 'associativity (ways)'),
    );
    sweepTarget.value = keep;
    if (!sweepTarget.value && preset?.sweep && names.has(preset.sweep.name)) sweepTarget.value = `const:${preset.sweep.name}`;
    if (!sweepTarget.value) sweepTarget.selectedIndex = 0;
  }

  function defaultSweepValues(): void {
    const v = sweepTarget.value;
    if (preset?.sweep && v === `const:${preset.sweep.name}`) sweepValues.value = preset.sweep.values.join(', ');
    else if (v === 'size') sweepValues.value = '256, 512, 1024, 2048, 4096, 8192';
    else if (v === 'lineSize') sweepValues.value = '8, 16, 32, 64, 128';
    else if (v === 'ways') sweepValues.value = '1, 2, 4, 8, 16';
    else {
      const name = v.slice(6);
      const cur = runs.flatMap((r) => r?.trace.constants ?? []).find((c) => c.name === name)?.value ?? 8;
      sweepValues.value = [cur / 4, cur / 2, cur, cur * 2, cur * 4].filter((x) => Number.isInteger(x) && x > 0).join(', ');
    }
  }
  sweepTarget.addEventListener('change', defaultSweepValues);

  function runSweep(): void {
    sweepErr.textContent = '';
    sweepOut.replaceChildren();
    let values: number[];
    try {
      values = parseValues(sweepValues.value);
    } catch (e) {
      sweepErr.textContent = (e as Error).message;
      return;
    }
    const v = sweepTarget.value;
    const target: SweepTarget = v.startsWith('const:') ? { kind: 'const', name: v.slice(6) } : { kind: v as 'size' | 'lineSize' | 'ways' };
    const series: { name: string; pts: SweepPoint[] }[] = [];
    const srcs = compare.checked ? [codeA.value, codeB.value] : [codeA.value];
    srcs.forEach((src, i) => {
      if (runs[i]) series.push({ name: i ? 'B' : 'A', pts: sweep(src, cfg, target, values) });
    });
    sweepOut.append(chart(series, target.kind === 'const' ? target.name : (sweepTarget.selectedOptions[0]?.textContent ?? '')), sweepTable(series));
  }
  sweepBtn.addEventListener('click', runSweep);

  function chart(series: { name: string; pts: SweepPoint[] }[], xLabel: string): SVGElement {
    const W = 640;
    const H = 260;
    const m = { l: 48, r: 16, t: 14, b: 40 };
    const n = series[0]?.pts.length ?? 0;
    const maxY = Math.max(0.05, ...series.flatMap((s) => s.pts.map((p) => p.missRate ?? 0)));
    const top = Math.min(1, Math.ceil(maxY * 10) / 10);
    const x = (i: number) => m.l + (n <= 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (n - 1));
    const y = (v: number) => m.t + (1 - v / top) * (H - m.t - m.b);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Miss rate as ${xLabel} varies` });
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4;
      g.append(svg('line', { x1: String(m.l), x2: String(W - m.r), y1: String(y(v)), y2: String(y(v)), class: 'gridline' }));
      g.append(svg('text', { x: String(m.l - 6), y: String(y(v) + 4), class: 'axis', 'text-anchor': 'end' }, percent(v)));
    }
    (series[0]?.pts ?? []).forEach((p, i) => g.append(svg('text', { x: String(x(i)), y: String(H - m.b + 16), class: 'axis', 'text-anchor': 'middle' }, String(p.x))));
    g.append(svg('text', { x: String((W + m.l) / 2), y: String(H - 6), class: 'axis', 'text-anchor': 'middle' }, xLabel));
    series.forEach((s, si) => {
      let d = '';
      let pen = false;
      s.pts.forEach((p, i) => {
        if (p.missRate === null) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.missRate).toFixed(1)}`;
        pen = true;
      });
      g.append(svg('path', { d, class: `series s${si}` }));
      s.pts.forEach((p, i) => {
        if (p.missRate !== null) g.append(svg('circle', { cx: String(x(i)), cy: String(y(p.missRate)), r: '4', class: `pt s${si}` }, svg('title', {}, `${s.name}, ${p.x}: ${percent(p.missRate)} (${fmt(p.misses as number)} misses)`)));
      });
      g.append(svg('text', { x: String(W - m.r - 4), y: String(m.t + 12 + si * 16), class: `axis lg s${si}`, 'text-anchor': 'end' }, `● kernel ${s.name}`));
    });
    return g;
  }

  function sweepTable(series: { name: string; pts: SweepPoint[] }[]): HTMLElement {
    const head = el('tr', {}, el('th', {}, 'Value'), ...series.flatMap((s) => [el('th', {}, `${s.name} misses`), el('th', {}, `${s.name} miss rate`)]));
    const body = (series[0]?.pts ?? []).map((p, i) =>
      el(
        'tr',
        {},
        el('td', { class: 'num' }, String(p.x)),
        ...series.flatMap((s) => {
          const q = s.pts[i] as SweepPoint;
          if (q.missRate === null) return [el('td', { colspan: '2', class: 'muted small' }, q.error ?? 'error')];
          return [el('td', { class: 'num' }, `${fmt(q.misses as number)} / ${fmt(q.accesses as number)}`), el('td', { class: 'num' }, percent(q.missRate))];
        }),
      ),
    );
    return el('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Sweep results' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, ...body)));
  }

  // ---------- quiz ----------
  const quizSeed = el('input', { type: 'number', value: '1', min: '1', 'aria-label': 'Question seed' });
  const quizCount = el('input', { type: 'number', value: '6', min: '1', max: '30', 'aria-label': 'Number of questions' });
  const tplBoxes = TEMPLATE_NAMES.map((n) => {
    const box = el('input', { type: 'checkbox', value: n });
    box.checked = true;
    return { n, box };
  });
  const genBtn = el('button', { type: 'button' }, 'Generate');
  const mdBtn = el('button', { type: 'button', class: 'secondary', disabled: '' }, 'Download Markdown');
  const qtiBtn = el('button', { type: 'button', class: 'secondary', disabled: '' }, 'Download QTI 1.2');
  const quizList = el('div', { class: 'quiz' });
  const quizCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Exam questions'),
    el('p', { class: 'muted small' }, 'Templates perturbed by a seeded generator. Every answer comes from running the simulator on the exact code in the question.'),
    el('div', { class: 'row' }, el('label', {}, 'Seed ', quizSeed), el('label', {}, 'Count ', quizCount), genBtn, mdBtn, qtiBtn),
    el('div', { class: 'row small' }, ...tplBoxes.map(({ n, box }) => el('label', {}, box, ` ${n}`))),
    quizList,
  );

  genBtn.addEventListener('click', () => {
    const count = Math.max(1, Math.min(30, Math.floor(Number(quizCount.value) || 6)));
    questions = generate(Math.max(1, Math.floor(Number(quizSeed.value) || 1)), count, tplBoxes.filter((t) => t.box.checked).map((t) => t.n));
    quizList.replaceChildren(
      ...questions.map((q, i) =>
        el(
          'div',
          { class: 'question' },
          el('p', {}, el('strong', {}, `${i + 1}. `), q.prompt),
          el('pre', { class: 'code' }, q.code),
          ...(q.options ? [el('ol', { class: 'options', type: 'a' }, ...q.options.map((o) => el('li', {}, o.text)))] : []),
          el('details', {}, el('summary', {}, 'Answer'), el('p', {}, el('strong', {}, q.options ? (q.options[q.answer] as { text: string }).text : String(q.answer))), el('p', { class: 'muted small' }, q.explanation)),
          el('button', { type: 'button', class: 'secondary small-btn', 'data-i': String(i) }, 'Open in editor'),
        ),
      ),
    );
    mdBtn.disabled = qtiBtn.disabled = !questions.length;
  });
  quizList.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button[data-i]');
    if (!b) return;
    const q = questions[Number(b.getAttribute('data-i'))];
    if (!q) return;
    preset = null;
    codeA.value = q.code;
    compare.checked = false;
    cfg = { ...q.cache };
    showConfig(cfg);
    presetNote.textContent = `Question ${Number(b.getAttribute('data-i')) + 1}: ${describeCache(q.cache)}.`;
    recompute();
    kernelsCard.scrollIntoView({ behavior: 'smooth' });
  });
  mdBtn.addEventListener('click', () => download('cache-questions.md', toMarkdown(questions), 'text/markdown'));
  qtiBtn.addEventListener('click', () => download('cache-questions.qti.xml', toQti(questions), 'application/xml'));

  // ---------- wiring ----------
  function recompute(): void {
    const errs = validateConfig(cfg);
    cfgErr.textContent = errs.join(' ');
    geometry.textContent = errs.length
      ? ''
      : `${sets(cfg)} set${sets(cfg) > 1 ? 's' : ''} × ${cfg.ways} way${cfg.ways > 1 ? 's' : ''} × ${cfg.lineSize} B. Address bits: ${addressBits(cfg).offset} offset, ${addressBits(cfg).index} index, rest tag.`;
    const srcs = [codeA.value, compare.checked ? codeB.value : ''];
    runs = [null, null];
    errors = ['', ''];
    srcs.forEach((src, i) => {
      if (i === 1 && !compare.checked) return;
      if (errs.length) return;
      try {
        const trace = buildTrace(src);
        runs[i] = { trace, sim: simulate(trace, cfg) };
      } catch (e) {
        errors[i] = (e as Error).message;
      }
    });
    errA.textContent = errors[0] as string;
    errB.textContent = errors[1] as string;
    paneB.hidden = !compare.checked;
    (which.options[1] as HTMLOptionElement).disabled = !compare.checked;
    if (!compare.checked) which.value = '0';
    renderResults();
    resetTheater();
    const before = sweepTarget.value;
    fillSweepTargets();
    if (sweepTarget.value !== before || !sweepValues.value) defaultSweepValues();
    sweepOut.replaceChildren();
    history.replaceState(null, '', encodeState({ a: codeA.value, b: compare.checked ? codeB.value : '', cfg }));
  }

  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(recompute, 350);
  };
  codeA.addEventListener('input', later);
  codeB.addEventListener('input', later);
  compare.addEventListener('change', recompute);
  for (const s of [sizeSel, lineSel, waysSel, policySel, allocSel, wbSel, seedIn])
    s.addEventListener('change', () => {
      if (s === sizeSel || s === lineSel) fillWays();
      cfg = readConfig();
      recompute();
    });
  presetSelect.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === presetSelect.value);
    presetSelect.value = '';
    if (!p) return;
    preset = p;
    codeA.value = p.a;
    codeB.value = p.b ?? '';
    compare.checked = !!p.b;
    cfg = { ...DEFAULT_CONFIG, ...p.cache };
    showConfig(cfg);
    presetNote.textContent = p.note;
    sweepTarget.value = '';
    recompute();
    if (p.sweep) runSweep();
  });
  shareBtn.addEventListener('click', async () => {
    const url = location.href.split('#')[0] + encodeState({ a: codeA.value, b: compare.checked ? codeB.value : '', cfg });
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Link copied';
    } catch {
      prompt('Copy this link:', url);
    }
    setTimeout(() => (shareBtn.textContent = 'Copy share link'), 1500);
  });
  // The canvases draw with the colour tokens: draw them again when the page's theme changes.
  document.addEventListener('hw-themechange', () => renderTheater());
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(renderTheater, 150);
  });

  root.append(
    el('header', {}, el('div', { class: 'title-row' }, el('h1', {}, 'Cache Miss Theater'), el('hw-theme-toggle')), el('p', { class: 'lede' }, 'Write a small C loop nest. Its exact address trace runs through the cache you configure, every miss is classified as compulsory, capacity or conflict, and you can watch each line arrive and get evicted.')),
    el('div', { class: 'grid' }, kernelsCard, cacheCard),
    resultsCard,
    theaterCard,
    sweepCard,
    quizCard,
    el(
      'footer',
      {},
      'Runs entirely in your browser. Built from idea 2026-10-10 n2 in ',
      el('a', { href: 'https://github.com/pisanuw/daily-project-ideas' }, 'daily-project-ideas'),
      '. Source: ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/cache-miss-theater' }, 'Claude-capstone/cache-miss-theater'),
      '.',
    ),
  );
  showConfig(cfg);
  recompute();
  if (preset?.sweep) runSweep();
}
