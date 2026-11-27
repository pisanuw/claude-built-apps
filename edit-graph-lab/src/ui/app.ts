import { ALGOS, compareAll, type AlgoResult } from '../core/compare';
import { EXAMPLES, exampleById, type Example } from '../core/examples';
import { generate, TEMPLATES, toMarkdown, toQti, type Exercise, type Template } from '../core/exercises';
import { lcs } from '../core/lcs';
import { myers, type MyersResult } from '../core/myers';
import { MAX_TOKENS, pathOf, tokenize, type Mode, type Point, type Script } from '../core/script';
import { decodeState, encodeState } from '../core/share';
import { hunks, segments, type Hunk } from '../core/unified';
import { cellSize, explainSnake, label, offGrid, segmentPoints, stepHue } from '../core/view';
import { el, svg } from './dom';

/** Above this many tokens per side the graph is skipped (the Compare tab still works). */
const GRAPH_MAX = 160;
/** The LCS table is only drawn when both sides are at most this long. */
const TABLE_MAX = 24;

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function diffView(script: Script, a: string[], b: string[], mode: Mode, hs: Hunk[], differs: boolean[] = [], onHover?: (h: Hunk | null) => void): HTMLElement {
  if (mode === 'char') {
    const out = el('pre', { class: 'diff inline' });
    for (const s of segments(script, a, b)) out.append(el('span', { class: `seg-${s.type}` }, s.text));
    if (!script.length) out.append(el('span', { class: 'muted' }, '(both empty)'));
    return out;
  }
  const out = el('div', { class: 'diff' });
  if (hs.length === 0) out.append(el('p', { class: 'muted small' }, 'No differences.'));
  hs.forEach((h, i) => {
    const box = el('pre', { class: `hunk${differs[i] ? ' differs' : ''}`, tabindex: '0' });
    box.append(el('span', { class: 'hh' }, h.header + '\n'));
    for (const line of h.lines) {
      const cls = line[0] === '+' ? 'ins' : line[0] === '-' ? 'del' : 'ctx';
      box.append(el('span', { class: `ln ${cls}` }, line + '\n'));
    }
    if (onHover) {
      box.addEventListener('mouseenter', () => onHover(h));
      box.addEventListener('focus', () => onHover(h));
      box.addEventListener('mouseleave', () => onHover(null));
      box.addEventListener('blur', () => onHover(null));
    }
    out.append(box);
  });
  return out;
}

export function mountApp(root: HTMLElement): void {
  const shared = decodeState(location.hash);
  const first = EXAMPLES[0] as Example;
  let mode: Mode = shared?.mode ?? first.mode;
  let tokA: string[] = [];
  let tokB: string[] = [];
  let res: MyersResult | null = null;
  let step = 0;
  let timer: number | undefined;
  let hover: Hunk | null = null;
  type Tab = 'graph' | 'compare' | 'exercises';
  let tab: Tab = 'graph';
  let exercises: Exercise[] = [];

  // ---------- inputs ----------
  const exampleSelect = el('select', { id: 'example', 'aria-label': 'Example' }, el('option', { value: '' }, 'Custom input'));
  for (const e of EXAMPLES) exampleSelect.append(el('option', { value: e.id }, e.title));
  const modeLine = el('input', { type: 'radio', name: 'mode', value: 'line', id: 'mode-line' });
  const modeChar = el('input', { type: 'radio', name: 'mode', value: 'char', id: 'mode-char' });
  const taA = el('textarea', { id: 'text-a', rows: '10', spellcheck: 'false', 'aria-label': 'Old text A' });
  const taB = el('textarea', { id: 'text-b', rows: '10', spellcheck: 'false', 'aria-label': 'New text B' });
  const swapBtn = el('button', { class: 'secondary', type: 'button' }, 'Swap A and B');
  const shareBtn = el('button', { class: 'secondary', type: 'button' }, 'Copy share link');
  const note = el('p', { class: 'note' });
  const error = el('p', { class: 'error', role: 'alert' });

  const inputCard = el(
    'section',
    { class: 'card' },
    el(
      'div',
      { class: 'row' },
      el('label', { for: 'example' }, 'Example'),
      exampleSelect,
      el('span', { class: 'seg' }, modeLine, el('label', { for: 'mode-line' }, 'Lines'), modeChar, el('label', { for: 'mode-char' }, 'Characters')),
      swapBtn,
      shareBtn,
    ),
    el(
      'div',
      { class: 'pair' },
      el('div', {}, el('label', { for: 'text-a' }, 'A (old text, x axis)'), taA),
      el('div', {}, el('label', { for: 'text-b' }, 'B (new text, y axis)'), taB),
    ),
    note,
    error,
  );

  // ---------- tabs ----------
  const tabBar = el('nav', { class: 'tabs', role: 'tablist' });
  const panels: Record<string, HTMLElement> = {
    graph: el('section', { id: 'panel-graph', role: 'tabpanel' }),
    compare: el('section', { id: 'panel-compare', role: 'tabpanel' }),
    exercises: el('section', { id: 'panel-exercises', role: 'tabpanel' }),
  };
  const tabNames: [Tab, string][] = [
    ['graph', 'Edit graph'],
    ['compare', 'Compare algorithms'],
    ['exercises', 'Exercises'],
  ];
  const tabBtns = tabNames.map(([id, text]) => {
    const btn = el('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}` }, text);
    btn.addEventListener('click', () => {
      tab = id;
      showTab();
    });
    tabBar.append(btn);
    return btn;
  });

  // ---------- graph panel ----------
  const graphBox = el('div', { class: 'graphbox' });
  const slider = el('input', { type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Myers step d' });
  const prevBtn = el('button', { class: 'secondary', type: 'button', 'aria-label': 'Previous step' }, '◀');
  const playBtn = el('button', { type: 'button' }, 'Play');
  const nextBtn = el('button', { class: 'secondary', type: 'button', 'aria-label': 'Next step' }, '▶');
  const endBtn = el('button', { class: 'secondary', type: 'button' }, 'Jump to end');
  const stepLabel = el('span', { class: 'steplabel' });
  // A named region in the tab order: on a phone the V array scrolls sideways inside it.
  const vTable = el('div', { class: 'vtable', tabindex: '0', role: 'region', 'aria-label': 'V array' });
  const stepText = el('ol', { class: 'steptext small' });
  const finalBox = el('div', {});
  const graphStats = el('div', { class: 'stats' });
  const hoverHint = el('p', { class: 'muted small' }, 'Hover a hunk to light up its stretch of the path.');

  panels.graph?.append(
    el(
      'div',
      { class: 'grid' },
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Edit graph'),
        el(
          'p',
          { class: 'muted small' },
          'Right = delete a token of A, down = insert a token of B, diagonal = keep a token both share (free). Diff is the shortest path from the top-left to the bottom-right corner. Coloured paths are the furthest-reaching d-paths found so far.',
        ),
        el('div', { class: 'row' }, prevBtn, playBtn, nextBtn, slider, endBtn),
        stepLabel,
        graphBox,
      ),
      el(
        'div',
        {},
        el('div', { class: 'card' }, el('h2', {}, 'Myers, step by step'), graphStats, el('h3', {}, 'V array (furthest x on diagonal k = x − y)'), vTable, el('h3', {}, 'This step'), stepText),
        el('div', { class: 'card' }, el('h2', {}, 'Resulting diff'), hoverHint, finalBox),
      ),
    ),
  );

  function stop(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    playBtn.textContent = 'Play';
  }

  function setStep(d: number): void {
    if (!res) return;
    step = Math.max(0, Math.min(res.d, d));
    slider.max = String(res.d);
    slider.value = String(step);
    renderGraph();
  }

  prevBtn.addEventListener('click', () => {
    stop();
    setStep(step - 1);
  });
  nextBtn.addEventListener('click', () => {
    stop();
    setStep(step + 1);
  });
  endBtn.addEventListener('click', () => {
    stop();
    if (res) setStep(res.d);
  });
  slider.addEventListener('input', () => {
    stop();
    setStep(Number(slider.value));
  });
  playBtn.addEventListener('click', () => {
    if (timer !== undefined) return stop();
    if (!res) return;
    if (step >= res.d) setStep(0);
    playBtn.textContent = 'Pause';
    timer = window.setInterval(() => {
      if (!res || step >= res.d) return stop();
      setStep(step + 1);
    }, 800);
  });

  function drawGraph(r: MyersResult): SVGElement | HTMLElement {
    const n = tokA.length;
    const m = tokB.length;
    if (n > GRAPH_MAX || m > GRAPH_MAX) {
      return el('p', { class: 'muted' }, `The graph view is limited to ${GRAPH_MAX} tokens per side (this input has ${n} × ${m}). The Compare tab still works.`);
    }
    const room = Math.max(240, Math.min(graphBox.clientWidth || 640, 760) - 20);
    const labels = cellSize(n, m, room * 0.8) >= 14;
    const padL = labels ? (mode === 'char' ? 26 : 110) : 12;
    const padT = labels ? (mode === 'char' ? 26 : 90) : 12;
    const c = cellSize(n, m, room - padL);
    const W = padL + n * c + 12;
    const H = padT + m * c + 12;
    const X = (x: number) => padL + x * c;
    const Y = (y: number) => padT + y * c;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: String(W), height: String(H), class: 'graph', role: 'img', 'aria-label': `Edit graph of ${n} by ${m} tokens, edit distance ${r.d}` });
    // Myers may record points just outside the grid (x > N or y > M); clip them away.
    root.append(svg('defs', {}, svg('clipPath', { id: 'grid-clip' }, svg('rect', { x: String(X(0) - 6), y: String(Y(0) - 6), width: String(n * c + 12), height: String(m * c + 12) }))));

    // Lattice and match diagonals.
    const grid = svg('g', { class: 'lattice' });
    for (let x = 0; x <= n; x++) grid.append(svg('line', { x1: String(X(x)), y1: String(Y(0)), x2: String(X(x)), y2: String(Y(m)) }));
    for (let y = 0; y <= m; y++) grid.append(svg('line', { x1: String(X(0)), y1: String(Y(y)), x2: String(X(n)), y2: String(Y(y)) }));
    root.append(grid);
    const diag = svg('g', { class: 'match' });
    for (let x = 0; x < n; x++) for (let y = 0; y < m; y++) if (tokA[x] === tokB[y]) diag.append(svg('line', { x1: String(X(x)), y1: String(Y(y)), x2: String(X(x + 1)), y2: String(Y(y + 1)) }));
    root.append(diag);

    if (labels) {
      const lab = svg('g', { class: 'axis' });
      tokA.forEach((t, x) => {
        const cx = X(x) + c / 2;
        const attrs: Record<string, string> =
          mode === 'char'
            ? { x: String(cx), y: String(padT - 8), 'text-anchor': 'middle' }
            : { x: String(cx), y: String(padT - 6), transform: `rotate(-55 ${cx} ${padT - 6})` };
        lab.append(svg('text', attrs, svg('title', {}, `A[${x}] ${t}`), label(t, mode === 'char' ? 2 : 13)));
      });
      tokB.forEach((t, y) => {
        lab.append(svg('text', { x: String(padL - 6), y: String(Y(y) + c / 2 + 4), 'text-anchor': 'end' }, svg('title', {}, `B[${y}] ${t}`), label(t, mode === 'char' ? 2 : 14)));
      });
      root.append(lab);
    }

    // Furthest-reaching d-paths up to the current step.
    const paths = svg('g', { class: 'snakes', 'clip-path': 'url(#grid-clip)' });
    for (const s of r.steps.slice(0, step + 1).flatMap((st) => st.snakes)) {
      const colour = `hsl(${stepHue(s.d, r.d)} 70% 48%)`;
      const width = s.d === step ? 3 : 1.6;
      const g = svg('g', { stroke: colour, 'stroke-width': String(width), opacity: s.d === step ? '1' : '0.65' });
      if (s.d > 0) g.append(svg('line', { x1: String(X(s.from.x)), y1: String(Y(s.from.y)), x2: String(X(s.mid.x)), y2: String(Y(s.mid.y)) }));
      if (s.to.x > s.mid.x) g.append(svg('line', { x1: String(X(s.mid.x)), y1: String(Y(s.mid.y)), x2: String(X(s.to.x)), y2: String(Y(s.to.y)) }));
      g.append(svg('circle', { cx: String(X(s.to.x)), cy: String(Y(s.to.y)), r: String(Math.max(2, Math.min(5, c / 6))), fill: colour, stroke: 'none' }, svg('title', {}, `d = ${s.d}, k = ${s.k}: (${s.to.x}, ${s.to.y})`)));
      paths.append(g);
    }
    root.append(paths);

    const poly = (pts: Point[], cls: string) => svg('polyline', { class: cls, points: pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ') });
    if (step === r.d) root.append(poly(pathOf(r.script), 'solution'));
    if (hover && step === r.d) root.append(poly(segmentPoints(r.script, hover.opStart, hover.opEnd), 'hovered'));
    root.append(svg('circle', { cx: String(X(0)), cy: String(Y(0)), r: '4', class: 'corner' }), svg('circle', { cx: String(X(n)), cy: String(Y(m)), r: '4', class: 'corner' }));
    return root;
  }

  function renderGraph(): void {
    graphBox.replaceChildren();
    vTable.replaceChildren();
    stepText.replaceChildren();
    finalBox.replaceChildren();
    graphStats.replaceChildren();
    hoverHint.hidden = mode === 'char';
    if (!res) return;
    const r = res;
    slider.max = String(r.d);
    slider.value = String(step);
    stepLabel.textContent = `Step d = ${step} of ${r.d}${step === r.d ? ': reached the corner, so the edit distance is ' + r.d : ''}`;
    graphBox.append(drawGraph(r));

    const stat = (v: string, k: string) => el('div', { class: 'stat' }, el('span', { class: 'v' }, v), el('span', { class: 'k' }, k));
    graphStats.append(stat(`${tokA.length} × ${tokB.length}`, `${mode === 'char' ? 'characters' : 'lines'} (N × M)`), stat(String(r.d), 'edit distance D'));

    const ks: number[] = [];
    for (let k = -r.d; k <= r.d; k++) ks.push(k);
    const table = el('table', {});
    const head = el('tr', {}, el('th', {}, 'd \\ k'));
    for (const k of ks) head.append(el('th', {}, String(k)));
    table.append(el('thead', {}, head));
    const body = el('tbody', {});
    for (const st of r.steps.slice(0, step + 1)) {
      const row = el('tr', st.d === step ? { class: 'current' } : {}, el('th', {}, String(st.d)));
      const byK = new Map(st.v.map((e) => [e.k, e.x]));
      for (const k of ks) row.append(el('td', {}, byK.has(k) ? String(byK.get(k)) : ''));
      body.append(row);
    }
    table.append(body);
    vTable.append(table);

    const snakes = (r.steps[step] as MyersResult['steps'][number]).snakes;
    const inside = snakes.filter((s) => !offGrid(s, tokA.length, tokB.length));
    for (const s of inside) stepText.append(el('li', {}, explainSnake(s, tokA, tokB)));
    const outside = snakes.length - inside.length;
    if (outside) stepText.append(el('li', { class: 'muted' }, `${outside} diagonal${outside === 1 ? '' : 's'} stepped outside the grid (x > N or y > M). Their V entries are recorded, as in the paper, but cannot reach the corner.`));

    if (step === r.d) {
      finalBox.append(diffView(r.script, tokA, tokB, mode, hunks(r.script, tokA, tokB), [], (h) => {
        hover = h;
        const svgEl = graphBox.querySelector('svg');
        if (svgEl) graphBox.replaceChildren(drawGraph(r));
      }));
    } else {
      finalBox.append(el('p', { class: 'muted small' }, 'Step to the end (or press Jump to end) to see the diff this path spells out.'));
    }
  }

  // ---------- compare panel ----------
  const compareBox = el('div', { class: 'algos' });
  const lcsBox = el('div', {});
  panels.compare?.append(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Four algorithms, one input'),
      el(
        'p',
        { class: 'muted small' },
        'LCS and Myers always find a minimal diff (smallest D) but may choose different minimal paths. Patience and histogram anchor on rare lines first, so they can spend extra edits to produce a diff that reads better. Hunks outlined in orange differ from Myers.',
      ),
      compareBox,
    ),
    el('div', { class: 'card' }, el('h2', {}, 'LCS dynamic-programming table'), lcsBox),
  );

  function renderCompare(): void {
    compareBox.replaceChildren();
    lcsBox.replaceChildren();
    if (!res) return;
    const results = compareAll(tokA, tokB);
    for (const r of results) compareBox.append(algoCard(r));
    renderLcsTable();
  }

  function algoCard(r: AlgoResult): HTMLElement {
    const meta = ALGOS.find((x) => x.id === r.algo) as (typeof ALGOS)[number];
    const badge = r.algo === 'myers' ? el('span', { class: 'badge' }, 'reference') : r.differsFromMyers ? el('span', { class: 'badge warn' }, 'different alignment') : el('span', { class: 'badge ok' }, 'same as Myers');
    return el(
      'article',
      { class: 'algo' },
      el('h3', {}, meta.label, ' ', badge),
      el('p', { class: 'muted small' }, meta.blurb),
      el('p', { class: 'small' }, `D = ${r.d}${r.excess ? ` (+${r.excess} over minimal)` : ' (minimal)'}`, mode === 'line' ? ` · ${r.hunks.length} hunk${r.hunks.length === 1 ? '' : 's'}` : ''),
      diffView(r.script, tokA, tokB, mode, r.hunks, r.hunkDiffers),
    );
  }

  function renderLcsTable(): void {
    const n = tokA.length;
    const m = tokB.length;
    if (n > TABLE_MAX || m > TABLE_MAX) {
      lcsBox.append(el('p', { class: 'muted small' }, `Shown for inputs of up to ${TABLE_MAX} tokens per side (this one is ${n} × ${m}).`));
      return;
    }
    const r = lcs(tokA, tokB);
    lcsBox.append(el('p', { class: 'muted small' }, `Cell (row B[j], column A[i]) holds the LCS length of the suffixes A[i..] and B[j..]. LCS = ${r.length}, so D = ${n} + ${m} − 2 × ${r.length} = ${n + m - 2 * r.length}. Highlighted cells are the traceback; filled ones are kept tokens.`));
    const onPath = new Set<string>();
    const kept = new Set<string>();
    pathOf(r.script).forEach((p) => onPath.add(`${p.x}:${p.y}`));
    for (const op of r.script) if (op.type === 'eq') kept.add(`${op.a}:${op.b}`);
    const table = el('table', { class: 'lcs' });
    const head = el('tr', {}, el('th', {}, ''));
    tokA.forEach((t) => head.append(el('th', { title: t }, label(t, mode === 'char' ? 2 : 6))));
    head.append(el('th', {}, '∅'));
    table.append(el('thead', {}, head));
    const body = el('tbody', {});
    for (let j = 0; j <= m; j++) {
      const row = el('tr', {}, el('th', { title: tokB[j] ?? '' }, j < m ? label(tokB[j] as string, mode === 'char' ? 2 : 10) : '∅'));
      for (let i = 0; i <= n; i++) {
        const cls = [onPath.has(`${i}:${j}`) ? 'path' : '', kept.has(`${i}:${j}`) ? 'kept' : ''].join(' ').trim();
        row.append(el('td', cls ? { class: cls } : {}, String((r.table[i] as number[])[j])));
      }
      body.append(row);
    }
    table.append(body);
    lcsBox.append(el('div', { class: 'scrollx', tabindex: '0', role: 'region', 'aria-label': 'LCS table' }, table));
  }

  // ---------- exercises panel ----------
  const tplBoxes = TEMPLATES.map((t) => {
    const cb = el('input', { type: 'checkbox', id: `tpl-${t.id}`, value: t.id });
    cb.checked = true;
    return { t, cb };
  });
  const countIn = el('input', { type: 'number', id: 'ex-count', min: '1', max: '40', value: '8' });
  const seedIn = el('input', { type: 'number', id: 'ex-seed', min: '1', value: '1' });
  const genBtn = el('button', { type: 'button' }, 'Generate');
  const mdBtn = el('button', { class: 'secondary', type: 'button', disabled: '' }, 'Download Markdown');
  const qtiBtn = el('button', { class: 'secondary', type: 'button', disabled: '' }, 'Download QTI 1.2');
  const exList = el('ol', { class: 'exercises' });
  panels.exercises?.append(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Exercise generator'),
      el('p', { class: 'muted small' }, 'Each answer is computed by the reference implementations on this page. The same seed always gives the same set. QTI 1.2 is the format Canvas and most LMSs import.'),
      el('div', { class: 'row' }, ...tplBoxes.flatMap(({ t, cb }) => [el('span', { class: 'check' }, cb, el('label', { for: cb.id }, t.label))])),
      el('div', { class: 'row' }, el('label', { for: 'ex-count' }, 'Questions'), countIn, el('label', { for: 'ex-seed' }, 'Seed'), seedIn, genBtn, mdBtn, qtiBtn),
      exList,
    ),
  );

  function renderExercises(): void {
    exList.replaceChildren();
    for (const q of exercises) {
      const item = el('li', { class: 'exercise' });
      if (q.mode === 'line') item.append(el('div', { class: 'pair' }, el('div', {}, el('span', { class: 'small muted' }, 'A'), el('pre', { class: 'code' }, q.a)), el('div', {}, el('span', { class: 'small muted' }, 'B'), el('pre', { class: 'code' }, q.b))));
      item.append(el('p', {}, q.prompt));
      if (q.options) q.options.forEach((o, k) => item.append(el('div', { class: 'option' }, el('span', { class: 'small muted' }, `(${String.fromCharCode(97 + k)})`), el('pre', { class: 'code' }, o))));
      const answer = q.options ? `(${String.fromCharCode(97 + q.answer)})` : String(q.answer);
      const open = el('button', { class: 'secondary', type: 'button' }, 'Open in the edit graph');
      open.addEventListener('click', () => {
        load(q.a, q.b, q.mode);
        tab = 'graph';
        showTab();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      item.append(el('details', {}, el('summary', {}, 'Answer'), el('p', {}, el('strong', {}, answer), '. ', q.explanation)), open);
      exList.append(item);
    }
    mdBtn.disabled = qtiBtn.disabled = exercises.length === 0;
  }

  genBtn.addEventListener('click', () => {
    const chosen = tplBoxes.filter((x) => x.cb.checked).map((x) => x.t.id as Template);
    const count = Math.max(1, Math.min(40, Number(countIn.value) || 8));
    exercises = generate(chosen, count, Math.max(1, Math.floor(Number(seedIn.value) || 1)));
    renderExercises();
  });
  mdBtn.addEventListener('click', () => download('diff-exercises.md', toMarkdown(exercises), 'text/markdown'));
  qtiBtn.addEventListener('click', () => download('diff-exercises-qti.xml', toQti(exercises), 'application/xml'));

  // ---------- wiring ----------
  function showTab(): void {
    tabNames.forEach(([id], i) => {
      const on = id === tab;
      (tabBtns[i] as HTMLButtonElement).setAttribute('aria-selected', String(on));
      (panels[id] as HTMLElement).hidden = !on;
    });
    inputCard.hidden = tab === 'exercises';
    if (tab === 'graph') renderGraph();
    if (tab === 'compare') renderCompare();
  }

  function recompute(): void {
    stop();
    hover = null;
    tokA = tokenize(taA.value, mode);
    tokB = tokenize(taB.value, mode);
    if (tokA.length > MAX_TOKENS || tokB.length > MAX_TOKENS) {
      error.textContent = `Too long: the lab handles up to ${MAX_TOKENS} ${mode === 'char' ? 'characters' : 'lines'} per side (A has ${tokA.length}, B has ${tokB.length}).`;
      res = null;
    } else {
      error.textContent = '';
      res = myers(tokA, tokB);
      step = res.d;
    }
    showTab();
  }

  function load(a: string, b: string, m: Mode, ex?: Example): void {
    taA.value = a;
    taB.value = b;
    mode = m;
    modeLine.checked = m === 'line';
    modeChar.checked = m === 'char';
    exampleSelect.value = ex?.id ?? '';
    note.textContent = ex?.note ?? '';
    recompute();
    // Start small examples at step 0 so the animation is the first thing seen.
    if (res && res.d <= 12) setStep(0);
  }

  let typing: number | undefined;
  const onType = () => {
    exampleSelect.value = '';
    note.textContent = '';
    window.clearTimeout(typing);
    typing = window.setTimeout(recompute, 250);
  };
  taA.addEventListener('input', onType);
  taB.addEventListener('input', onType);
  for (const r of [modeLine, modeChar])
    r.addEventListener('change', () => {
      mode = modeChar.checked ? 'char' : 'line';
      recompute();
    });
  exampleSelect.addEventListener('change', () => {
    const ex = exampleById(exampleSelect.value);
    if (ex) load(ex.a, ex.b, ex.mode, ex);
  });
  swapBtn.addEventListener('click', () => load(taB.value, taA.value, mode));
  shareBtn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}${encodeState({ a: taA.value, b: taB.value, mode })}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Link copied';
    } catch {
      shareBtn.textContent = 'Link is in the address bar';
    }
    setTimeout(() => (shareBtn.textContent = 'Copy share link'), 1800);
  });
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => tab === 'graph' && renderGraph(), 150);
  });

  root.replaceChildren(
    // The light and dark mode switch at the end of the title's row (platform/src/theme).
    el('header', {}, el('div', { class: 'title-row' }, el('h1', {}, 'Edit Graph Lab'), el('hw-theme-toggle')), el('p', { class: 'lede' }, 'Diff is a shortest-path search. Type two texts, watch Myers’ O(ND) algorithm push its furthest-reaching paths across the edit graph, then see where LCS, patience and histogram diff disagree. Everything runs in your browser.')),
    inputCard,
    tabBar,
    panels.graph as HTMLElement,
    panels.compare as HTMLElement,
    panels.exercises as HTMLElement,
    el(
      'footer',
      { class: 'small muted' },
      'Algorithms: Myers 1986 (forward greedy), textbook LCS, patience after Bram Cohen and git, histogram after JGit. Raw algorithm output: git’s post-processing (indent heuristic) is not applied. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/edit-graph-lab' }, 'Source'),
    ),
  );

  if (shared) load(shared.a, shared.b, shared.mode);
  else load(first.a, first.b, first.mode, first);
}
