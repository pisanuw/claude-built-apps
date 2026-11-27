import { challengeFromHash, challengeUrl, judgeChallenge, type Challenge } from '../core/challenge';
import { pathToGoal, restartGraph, unpackGraph, type StateGraph } from '../core/enumerate';
import { createPuzzle, parsePuzzleDef } from '../core/factory';
import {
  checkHeuristic,
  compileHeuristic,
  evaluateHeuristic,
  heuristicFromValues,
  presetsFor,
  type HeuristicReport,
  type HeuristicValues,
} from '../core/heuristic';
import { computeLayout, type Layout, type LayoutMode } from '../core/layout';
import { PRESETS, presetById } from '../core/presets';
import type { Puzzle, PuzzleDef } from '../core/puzzle';
import { ALGORITHMS, createSearch, type Algorithm, type Search } from '../core/search';
import type { WorkerRequest, WorkerResponse } from '../worker/enumerate.worker';
import EnumerateWorker from '../worker/enumerate.worker?worker';
import { AtlasView, type ColorMode } from './atlas';
import { drawState } from './preview';

interface RunRecord {
  algorithm: Algorithm;
  heuristic: string;
  expanded: number;
  pathLength: number | null;
  peakMemory: number;
  optimal: boolean;
}

const fmt = (n: number) => n.toLocaleString();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export class App {
  private root: HTMLElement;
  private worker: Worker | null = null;
  private puzzle: Puzzle | null = null;
  private def: PuzzleDef | null = null;
  private graph: StateGraph | null = null;
  private layout: Layout | null = null;
  private layoutMode: LayoutMode = 'layered';
  private atlas!: AtlasView;
  private search: Search | null = null;
  private playing = false;
  private stepsPerFrame = 20;
  private hValues: HeuristicValues | null = null;
  private hReport: HeuristicReport | null = null;
  private hSourceChecked = '';
  private hKind: 'hanoi' | 'tiles' | 'blocks' | null = null;
  private selected = -1;
  private runs: RunRecord[] = [];
  private challenge: Challenge | null = null;
  private enumerateMs = 0;

  // DOM references
  private presetSelect!: HTMLSelectElement;
  private defText!: HTMLTextAreaElement;
  private buildBtn!: HTMLButtonElement;
  private buildMsg!: HTMLDivElement;
  private progress!: HTMLProgressElement;
  private statsList!: HTMLDListElement;
  private layoutSelect!: HTMLSelectElement;
  private colorSelect!: HTMLSelectElement;
  private edgesCheck!: HTMLInputElement;
  private tooltip!: HTMLDivElement;
  private tooltipCanvas!: HTMLCanvasElement;
  private tooltipLines!: HTMLDivElement;
  private inspectorCanvas!: HTMLCanvasElement;
  private inspectorText!: HTMLDivElement;
  private setStartBtn!: HTMLButtonElement;
  private algoSelect!: HTMLSelectElement;
  private algoBlurb!: HTMLParagraphElement;
  private hPresetSelect!: HTMLSelectElement;
  private hText!: HTMLTextAreaElement;
  private hCheckBtn!: HTMLButtonElement;
  private hReportDiv!: HTMLDivElement;
  private hShowCheck!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private stepBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private speedRange!: HTMLInputElement;
  private speedLabel!: HTMLSpanElement;
  private counters!: HTMLDivElement;
  private searchMsg!: HTMLDivElement;
  private runsTable!: HTMLTableSectionElement;
  private challengeBox!: HTMLDivElement;
  private chTitle!: HTMLInputElement;
  private chTarget!: HTMLInputElement;
  private chLinkMsg!: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.atlas = new AtlasView(this.root.querySelector('canvas.atlas')!, {
      onHover: (i, x, y) => this.onHover(i, x, y),
      onClick: (i) => this.onClick(i),
    });
    this.loadFromHash();
    window.addEventListener('hashchange', () => this.loadFromHash());
    window.addEventListener('keydown', (e) => {
      // The real target: a key in a shadow root (the theme switch's) arrives here retargeted to its host.
      const target = (e.composedPath()[0] ?? e.target) as HTMLElement;
      if (target.closest?.('textarea, input, select')) return;
      // Space plays and pauses, but on a focused button, link or scroll box it is that control's own key.
      if (e.key === ' ' && target.closest?.('button, a[href], summary, [role="button"], [role="region"]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === 'n') this.stepOnce();
      else if (e.key === 'r') this.resetSearch();
      else if (e.key === 'f') this.atlas.fit();
    });
    // The atlas and the selected state's preview read the colour tokens as they draw: draw them again when the
    // theme changes, and at once on the way into print and back (print takes the light set, but a canvas keeps the
    // pixels it drew on screen, and the next frame would come after the printout).
    document.addEventListener('hw-themechange', () => {
      this.atlas.requestRender();
      this.renderInspector();
    });
    if (typeof window.matchMedia === 'function') {
      window.matchMedia('print').addEventListener?.('change', () => {
        this.atlas.renderNow();
        this.renderInspector();
      });
    }
    requestAnimationFrame(() => this.tick());
  }

  // ---------------------------------------------------------------- DOM

  private build(): void {
    const header = el(
      'header',
      { class: 'top' },
      el('div', { class: 'title-row' }, el('h1', { text: 'State Space Atlas' }), el('hw-theme-toggle')),
      el('span', { class: 'tagline', text: 'Every reachable state of a small puzzle, drawn as one graph. Watch BFS, DFS, IDDFS, greedy and A* explore it, and test your own heuristic against the true distances.' }),
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/state-space-atlas', target: '_blank', rel: 'noreferrer', text: 'Source & README' }),
    );

    // Left: puzzle
    this.presetSelect = el('select', { 'aria-label': 'Puzzle preset' });
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const p of PRESETS) {
      let g = groups.get(p.group);
      if (!g) {
        g = el('optgroup', { label: p.group });
        groups.set(p.group, g);
        this.presetSelect.append(g);
      }
      g.append(el('option', { value: p.id, text: `${p.name} (${p.states} states)` }));
    }
    this.presetSelect.append(el('option', { value: 'custom', text: 'Custom definition (edit the JSON below)' }));
    this.presetSelect.value = 'tiles-2x4';
    this.defText = el('textarea', { spellcheck: 'false', 'aria-label': 'Puzzle definition (JSON)' });
    this.defText.value = JSON.stringify(presetById('tiles-2x4')!.def, null, 2);
    this.presetSelect.addEventListener('change', () => {
      const p = presetById(this.presetSelect.value);
      if (p) this.defText.value = JSON.stringify(p.def, null, 2);
      this.syncHeuristicKind();
    });
    this.defText.addEventListener('input', () => {
      this.presetSelect.value = 'custom';
      this.syncHeuristicKind();
    });
    this.buildBtn = el('button', { class: 'primary', text: 'Build atlas' });
    this.buildBtn.addEventListener('click', () => this.buildAtlas());
    this.buildMsg = el('div', { class: 'msg' });
    this.progress = el('progress', { max: '1', value: '0', hidden: '' });
    this.statsList = el('dl', { class: 'stats' });
    const formatHelp = el(
      'details',
      {},
      el('summary', { text: 'Definition format' }),
      el('div', {
        class: 'hint',
        html:
          '<p><code>{"kind":"hanoi","disks":4,"pegs":3}</code></p>' +
          '<p><code>{"kind":"tiles","rows":3,"cols":3,"start":"farthest"}</code> or <code>"start":[8,6,7,2,5,4,3,0,1]</code> (0 is the blank).</p>' +
          '<p><code>{"kind":"blocks","grid":["ABBC","ABBC","DEEF","DGHF","I..J"],"goal":{"piece":"B","row":3,"col":1},"moves":"free"}</code>: ' +
          'letters are pieces (filled rectangles), <code>.</code> empty, <code>#</code> wall; <code>moves</code> is <code>free</code> (Klotski) or <code>rushhour</code> (long axis only). ' +
          'Same-size pieces are interchangeable; a centred goal with symmetric walls enables mirror reduction (<code>"symmetry":"none"</code> turns it off).</p>',
      }),
    );
    const puzzleCard = el(
      'section',
      { class: 'card' },
      el('h2', { text: '1. Puzzle' }),
      el('label', { text: 'Preset' }),
      this.presetSelect,
      el('label', { text: 'Definition (JSON)' }),
      this.defText,
      formatHelp,
      el('div', { class: 'row' }, this.buildBtn),
      this.progress,
      this.buildMsg,
      this.statsList,
    );

    // Left: inspector
    this.inspectorCanvas = el('canvas', { width: '120', height: '120' });
    this.inspectorText = el('div', { class: 'hint', text: 'Hover a dot to preview that state; click to select it.' });
    this.setStartBtn = el('button', { text: 'Set as start', disabled: '' });
    this.setStartBtn.addEventListener('click', () => this.setStart(this.selected));
    const inspectorCard = el(
      'section',
      { class: 'card' },
      el('h2', { text: 'Selected state' }),
      el('div', { class: 'inspector' }, this.inspectorCanvas, this.inspectorText),
      el('div', { class: 'row' }, this.setStartBtn),
      el('p', { class: 'hint', text: 'Setting a new start re-layers the atlas and the next search begins there. The space itself does not change.' }),
    );

    const left = el('aside', {}, puzzleCard, inspectorCard);

    // Centre: atlas
    this.layoutSelect = el('select', { 'aria-label': 'Layout' }, el('option', { value: 'layered', text: 'Layered by distance from start' }), el('option', { value: 'radial', text: 'Radial around start' }));
    this.layoutSelect.addEventListener('change', () => {
      this.layoutMode = this.layoutSelect.value as LayoutMode;
      this.relayout();
    });
    this.colorSelect = el(
      'select',
      { 'aria-label': 'Colour by' },
      el('option', { value: 'toGoal', text: 'Colour: distance to goal' }),
      el('option', { value: 'fromStart', text: 'Colour: distance from start' }),
      el('option', { value: 'heuristic', text: 'Colour: heuristic value' }),
      el('option', { value: 'hError', text: 'Colour: heuristic error (red = overestimate)' }),
    );
    this.colorSelect.addEventListener('change', () => this.atlas.setColorMode(this.colorSelect.value as ColorMode));
    this.edgesCheck = el('input', { type: 'checkbox', checked: '' });
    this.edgesCheck.addEventListener('change', () => this.atlas.setShowEdges(this.edgesCheck.checked));
    const fitBtn = el('button', { text: 'Fit' });
    fitBtn.addEventListener('click', () => this.atlas.fit());
    const zoomIn = el('button', { text: '+', 'aria-label': 'Zoom in' });
    zoomIn.addEventListener('click', () => this.atlas.zoomBy(1.6));
    const zoomOut = el('button', { text: '−', 'aria-label': 'Zoom out' });
    zoomOut.addEventListener('click', () => this.atlas.zoomBy(1 / 1.6));
    const toolbar = el(
      'div',
      { class: 'toolbar' },
      this.layoutSelect,
      this.colorSelect,
      el('label', {}, this.edgesCheck, 'Edges'),
      fitBtn,
      zoomIn,
      zoomOut,
      el('span', { class: 'hint', text: 'Drag to pan, wheel to zoom. Keys: space play/pause, n step, r reset, f fit.' }),
    );
    const canvas = el('canvas', { class: 'atlas' });
    const wrap = el('div', { class: 'atlas-wrap' }, canvas);
    const legend = el('div', {
      class: 'legend',
      html:
        '<span>far <span class="ramp"></span> goal</span>' +
        '<span><span class="sw" style="background:var(--c-dead)"></span>dead end (goal unreachable)</span>' +
        '<span><span class="sw" style="background:var(--c-frontier)"></span>frontier</span>' +
        '<span><span class="sw" style="background:var(--c-expanded)"></span>expanded</span>' +
        '<span><span class="sw" style="background:var(--c-path)"></span>solution path</span>' +
        '<span><span class="sw" style="border:1.5px solid #2bb673"></span>goal state</span>',
    });
    const center = el('section', { class: 'center' }, toolbar, wrap, legend);

    // Right: search
    this.algoSelect = el('select', { 'aria-label': 'Algorithm' });
    for (const a of ALGORITHMS) this.algoSelect.append(el('option', { value: a.id, text: a.name }));
    this.algoSelect.value = 'astar';
    this.algoBlurb = el('p', { class: 'hint' });
    this.algoSelect.addEventListener('change', () => {
      this.updateAlgoBlurb();
      this.resetSearch();
    });
    this.updateAlgoBlurb();

    this.hPresetSelect = el('select', { 'aria-label': 'Heuristic preset' });
    this.hText = el('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Heuristic source' });
    this.hPresetSelect.addEventListener('change', () => {
      const p = presetsFor(this.kind()).find((x) => x.id === this.hPresetSelect.value);
      if (p) {
        this.hText.value = p.source;
        this.invalidateHeuristic();
      }
    });
    this.hText.addEventListener('input', () => {
      this.hPresetSelect.value = 'custom';
      this.invalidateHeuristic();
    });
    this.hCheckBtn = el('button', { text: 'Check heuristic', disabled: '' });
    this.hCheckBtn.addEventListener('click', () => void this.checkHeuristicNow());
    this.hShowCheck = el('input', { type: 'checkbox' });
    this.hShowCheck.addEventListener('change', () => this.updateHighlights());
    this.hReportDiv = el('div', { class: 'report' });
    const hHelp = el(
      'details',
      {},
      el('summary', { text: 'What does state look like?' }),
      el('div', {
        class: 'hint',
        html:
          '<p>Your code is the body of <code>function (state, puzzle)</code> and must return a number.</p>' +
          '<p><b>tiles</b>: <code>state.rows</code>, <code>state.cols</code>, <code>state.tiles[r][c]</code> (0 = blank), <code>state.blank.row/col</code>, <code>state.goalRow[t]</code>, <code>state.goalCol[t]</code>.</p>' +
          '<p><b>hanoi</b>: <code>state.disks</code>, <code>state.on[d]</code> = peg of disk d (0 smallest), <code>state.stacks[p]</code> bottom to top, <code>puzzle.goalPeg</code>.</p>' +
          '<p><b>blocks</b>: <code>state.pieces[]</code> with <code>row, col, w, h, shape, goal</code>, <code>state.goalPiece</code>, <code>state.goal.row/col</code>, <code>state.cells[r][c]</code>.</p>',
      }),
    );

    this.playBtn = el('button', { class: 'primary', text: 'Play', disabled: '' });
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.stepBtn = el('button', { text: 'Step', disabled: '' });
    this.stepBtn.addEventListener('click', () => this.stepOnce());
    this.resetBtn = el('button', { text: 'Reset', disabled: '' });
    this.resetBtn.addEventListener('click', () => this.resetSearch());
    this.speedRange = el('input', { type: 'range', min: '0', max: '100', value: '45', 'aria-label': 'Speed' });
    this.speedLabel = el('span', { class: 'hint' });
    this.speedRange.addEventListener('input', () => this.updateSpeed());
    this.updateSpeed();
    this.counters = el('div', { class: 'counters' });
    this.searchMsg = el('div', { class: 'msg' });
    this.runsTable = el('tbody');
    const runsWrap = el(
      'table',
      { class: 'runs' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Run' }), el('th', { text: 'Expanded' }), el('th', { text: 'Peak mem' }), el('th', { text: 'Path' }))),
      this.runsTable,
    );
    const clearRuns = el('button', { text: 'Clear runs' });
    clearRuns.addEventListener('click', () => {
      this.runs = [];
      this.renderRuns();
    });

    const searchCard = el(
      'section',
      { class: 'card' },
      el('h2', { text: '2. Search' }),
      el('label', { text: 'Algorithm' }),
      this.algoSelect,
      this.algoBlurb,
      el('h3', { text: 'Heuristic (used by greedy and A*)' }),
      this.hPresetSelect,
      this.hText,
      hHelp,
      el('div', { class: 'row' }, this.hCheckBtn, el('label', { style: 'margin:0;display:inline-flex;gap:4px;align-items:center' }, this.hShowCheck, 'Outline overestimates on the atlas')),
      this.hReportDiv,
      el('h3', { text: 'Run' }),
      el('div', { class: 'row' }, this.playBtn, this.stepBtn, this.resetBtn),
      el('label', { text: 'Speed (expansions per frame)' }),
      this.speedRange,
      this.speedLabel,
      this.counters,
      this.searchMsg,
      el('h3', { text: 'Runs on this atlas' }),
      runsWrap,
      el('div', { class: 'row' }, clearRuns),
    );

    // Right: challenge
    this.challengeBox = el('div', { class: 'msg' });
    this.chTitle = el('input', { type: 'text', placeholder: 'Title, e.g. "Beat 500 expansions on the 7-puzzle"', maxlength: '120' });
    this.chTarget = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Expansions to beat' });
    const chBtn = el('button', { text: 'Copy challenge link' });
    chBtn.addEventListener('click', () => void this.exportChallenge());
    this.chLinkMsg = el('div', { class: 'msg' });
    const challengeCard = el(
      'section',
      { class: 'card' },
      el('h2', { text: '3. Challenge' }),
      this.challengeBox,
      el('p', { class: 'hint', text: 'Export the current puzzle and algorithm as a "write a heuristic that expands fewer than N nodes" link. The target defaults to your latest run.' }),
      el('label', { text: 'Title' }),
      this.chTitle,
      el('label', { text: 'Target (expand fewer than)' }),
      this.chTarget,
      el('div', { class: 'row' }, chBtn),
      this.chLinkMsg,
    );

    const right = el('aside', {}, searchCard, challengeCard);

    this.tooltipCanvas = el('canvas');
    this.tooltipLines = el('div', { class: 'lines' });
    this.tooltip = el('div', { class: 'tooltip', hidden: '' }, this.tooltipCanvas, this.tooltipLines);

    const footer = el('footer', {
      class: 'foot',
      html:
        'Everything runs in your browser: enumeration in a Web Worker, true distances by BFS from the goals, no server and no AI calls. ' +
        'Goal tests happen at expansion time for every algorithm so the counts compare fairly. ' +
        'Built from an idea in <a href="https://daily-project-ideas.netlify.app/" target="_blank" rel="noreferrer">daily-project-ideas</a>.',
    });

    this.root.replaceChildren(header, el('main', { class: 'layout' }, left, center, right), footer, this.tooltip);
  }

  // ---------------------------------------------------------------- puzzle

  /** Kind of the definition currently in the editor (falls back to the built puzzle). */
  private kind(): 'hanoi' | 'tiles' | 'blocks' {
    return parseKind(this.defText.value) ?? this.def?.kind ?? 'tiles';
  }

  /** Swap the heuristic presets when the editor switches to another puzzle family. */
  private syncHeuristicKind(): void {
    if (this.kind() !== this.hKind) this.refreshHeuristicPresets();
  }

  private refreshHeuristicPresets(): void {
    const kind = this.kind();
    this.hKind = kind;
    const presets = presetsFor(kind);
    this.hPresetSelect.replaceChildren(...presets.map((p) => el('option', { value: p.id, text: p.name })), el('option', { value: 'custom', text: 'Custom' }));
    const pick = presets[1] ?? presets[0];
    this.hPresetSelect.value = pick.id;
    this.hText.value = pick.source;
    this.invalidateHeuristic();
  }

  private buildAtlas(): void {
    let def: PuzzleDef;
    try {
      def = parsePuzzleDef(this.defText.value);
      createPuzzle(def); // validate on the main thread for a fast error
    } catch (e) {
      this.setMsg(this.buildMsg, (e as Error).message, 'error');
      return;
    }
    this.worker?.terminate();
    this.worker = new EnumerateWorker();
    this.buildBtn.disabled = true;
    this.progress.hidden = false;
    this.progress.removeAttribute('value');
    this.setMsg(this.buildMsg, 'Enumerating states in a Web Worker…', '');
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') {
        this.setMsg(this.buildMsg, `Enumerating… ${fmt(m.discovered)} states found, ${fmt(m.expanded)} expanded`, '');
      } else if (m.type === 'error') {
        this.buildBtn.disabled = false;
        this.progress.hidden = true;
        this.setMsg(this.buildMsg, m.message, 'error');
      } else {
        this.buildBtn.disabled = false;
        this.progress.hidden = true;
        this.enumerateMs = m.ms;
        this.onGraph(def, unpackGraph(m.graph));
      }
    };
    this.worker.postMessage({ type: 'enumerate', def } satisfies WorkerRequest);
  }

  private onGraph(def: PuzzleDef, graph: StateGraph): void {
    const kindChanged = this.def?.kind !== def.kind;
    this.def = def;
    this.puzzle = createPuzzle(def);
    this.graph = graph;
    this.search = null;
    this.playing = false;
    this.runs = [];
    this.selected = -1;
    this.layout = computeLayout(graph, this.layoutMode);
    this.atlas.setGraph(graph, this.layout);
    this.atlas.setColorMode(this.colorSelect.value as ColorMode);
    if (kindChanged && this.hKind !== def.kind) this.refreshHeuristicPresets();
    else this.invalidateHeuristic();
    this.renderStats();
    this.renderRuns();
    this.renderInspector();
    this.updateCounters();
    this.hCheckBtn.disabled = false;
    this.playBtn.disabled = false;
    this.stepBtn.disabled = false;
    this.resetBtn.disabled = false;
    this.setMsg(this.searchMsg, '', '');
    const warn = graph.optimalLength < 0 ? ' The start cannot reach any goal: every search will exhaust the space.' : '';
    this.setMsg(this.buildMsg, `${this.puzzle.label}: ${fmt(graph.keys.length)} states in ${(this.enumerateMs / 1000).toFixed(2)} s.${warn}`, warn ? 'warn' : 'ok');
    if (this.challenge) this.renderChallenge();
    this.chTarget.value = '';
  }

  private renderStats(): void {
    const g = this.graph;
    this.statsList.replaceChildren();
    if (!g) return;
    const rows: Array<[string, string]> = [
      ['States', fmt(g.keys.length)],
      ['Edges (moves)', fmt(g.edgeCount)],
      ['Layers from start', fmt(g.depth + 1)],
      ['Optimal solution', g.optimalLength < 0 ? 'none' : `${fmt(g.optimalLength)} moves`],
      ['Goal states', fmt(g.goals.length)],
      ['Dead ends', fmt(g.deadEnds)],
      ['Farthest from goal', fmt(g.maxDistToGoal)],
      ['Widest layer', fmt(this.layout ? Math.max(...Array.from(this.layout.layerSizes)) : 0)],
    ];
    for (const [k, v] of rows) this.statsList.append(el('dt', { text: k }), el('dd', { text: v }));
  }

  private relayout(): void {
    if (!this.graph) return;
    this.layout = computeLayout(this.graph, this.layoutMode);
    this.atlas.setLayout(this.layout);
    this.renderStats();
  }

  private setStart(node: number): void {
    if (!this.graph || node < 0) return;
    this.graph = restartGraph(this.graph, node);
    this.layout = computeLayout(this.graph, this.layoutMode);
    this.search = null;
    this.playing = false;
    this.atlas.setGraph(this.graph, this.layout);
    this.atlas.setSelected(node);
    if (this.hValues) this.atlas.setHeuristicValues(this.hValues.values);
    this.updateHighlights();
    this.renderStats();
    this.renderInspector();
    this.updateCounters();
    this.runs = [];
    this.renderRuns();
  }

  // ---------------------------------------------------------------- hover / select

  private onHover(i: number, x: number, y: number): void {
    if (i < 0 || !this.graph || !this.puzzle) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.hidden = false;
    drawState(this.tooltipCanvas, this.puzzle.def.kind, this.puzzle.decode(this.graph.keys[i]), 84);
    this.tooltipLines.textContent = this.describe(i);
    const pad = 14;
    const w = this.tooltip.offsetWidth || 200;
    const h = this.tooltip.offsetHeight || 100;
    const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
    const top = y + pad + h > window.innerHeight ? y - pad - h : y + pad;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private describe(i: number): string {
    const g = this.graph!;
    const lines = [`#${i}`, `from start: ${g.distFromStart[i]}`, `to goal: ${g.distToGoal[i] < 0 ? 'unreachable' : g.distToGoal[i]}`];
    if (this.hValues) {
      const h = this.hValues.values[i];
      lines.push(`h: ${Number.isNaN(h) ? 'error' : Number.isInteger(h) ? h : h.toFixed(2)}`);
    }
    if (this.search) {
      const s = this.search.status[i];
      lines.push(['unseen', 'frontier', 'expanded', 'on path'][s]);
    }
    return lines.join('\n');
  }

  private onClick(i: number): void {
    if (!this.graph) return;
    this.selected = i;
    this.atlas.setSelected(i);
    this.renderInspector();
  }

  private renderInspector(): void {
    const i = this.selected;
    if (i < 0 || !this.graph || !this.puzzle) {
      this.inspectorCanvas.getContext('2d')?.clearRect(0, 0, this.inspectorCanvas.width, this.inspectorCanvas.height);
      this.inspectorText.textContent = 'Hover a dot to preview that state; click to select it.';
      this.setStartBtn.disabled = true;
      return;
    }
    drawState(this.inspectorCanvas, this.puzzle.def.kind, this.puzzle.decode(this.graph.keys[i]), 120);
    const g = this.graph;
    const extra = g.distToGoal[i] >= 0 ? ` An optimal solution from here has ${g.distToGoal[i]} moves (${pathToGoal(g, i).length} states).` : ' No goal is reachable from this state.';
    this.inspectorText.textContent = `${this.describe(i).replace(/\n/g, ' · ')}.${extra}`;
    this.setStartBtn.disabled = i === g.start;
  }

  // ---------------------------------------------------------------- heuristic

  private invalidateHeuristic(): void {
    this.hValues = null;
    this.hReport = null;
    this.hSourceChecked = '';
    this.hReportDiv.replaceChildren();
    this.atlas.setHeuristicValues(null);
    this.atlas.setHighlights(null);
    this.search = null;
    this.atlas.setSearch(null, -1);
    if (this.challenge) this.renderChallenge();
  }

  private async ensureHeuristic(): Promise<HeuristicValues | null> {
    if (!this.graph || !this.puzzle) return null;
    if (this.hValues && this.hSourceChecked === this.hText.value) return this.hValues;
    const compiled = compileHeuristic(this.hText.value); // throws HeuristicError
    const fn = compiled.fn;
    const g = this.graph;
    const n = g.keys.length;
    const hv: HeuristicValues = { values: new Float64Array(n), errors: 0, firstError: null };
    const chunk = 20_000;
    for (let from = 0; from < n; from += chunk) {
      evaluateHeuristic(g, this.puzzle, fn, from, Math.min(n, from + chunk), hv);
      if (n > chunk) {
        this.hReportDiv.replaceChildren(el('div', { class: 'hint', text: `Evaluating heuristic… ${fmt(Math.min(n, from + chunk))} / ${fmt(n)}` }));
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    this.hValues = hv;
    this.hSourceChecked = this.hText.value;
    this.atlas.setHeuristicValues(hv.values);
    return hv;
  }

  private async checkHeuristicNow(): Promise<void> {
    if (!this.graph) return;
    this.hCheckBtn.disabled = true;
    try {
      const hv = await this.ensureHeuristic();
      if (!hv) return;
      this.hReport = checkHeuristic(this.graph, hv);
      this.renderHeuristicReport();
      this.updateHighlights();
      if (this.hReport.overestimateCount > 0 && this.colorSelect.value === 'toGoal') {
        this.colorSelect.value = 'hError';
        this.atlas.setColorMode('hError');
      }
      if (this.challenge) this.renderChallenge();
    } catch (e) {
      this.hReportDiv.replaceChildren(el('div', { class: 'msg error', text: (e as Error).message }));
    } finally {
      this.hCheckBtn.disabled = false;
    }
  }

  private renderHeuristicReport(): void {
    const r = this.hReport;
    if (!r) return;
    const badge = (ok: boolean, yes: string, no: string) => el('span', { class: `badge ${ok ? 'ok' : 'bad'}`, text: ok ? yes : no });
    const lines: HTMLElement[] = [];
    if (r.errors > 0) {
      lines.push(el('div', { class: 'msg error', text: `The function failed on ${fmt(r.errors)} states: ${r.firstError ?? 'unknown error'}` }));
    }
    lines.push(
      el('div', { class: 'line' }, badge(r.admissible, 'Admissible', 'Not admissible'), el('span', { text: r.admissible ? 'h never exceeds the true distance.' : `overestimates on ${fmt(r.overestimateCount)} states (worst by ${r.worstOverestimate}).` })),
      el(
        'div',
        { class: 'line' },
        badge(r.consistent, 'Consistent', 'Not consistent'),
        el('span', { text: r.consistent ? 'h(u) ≤ 1 + h(v) on every move.' : `${fmt(r.inconsistentCount)} moves where h drops by more than 1; A* may reopen nodes.` }),
      ),
      el('div', { class: 'line' }, badge(r.zeroAtGoal, 'h(goal) = 0', 'h(goal) ≠ 0'), el('span', { text: `max h = ${r.maxH}, informedness ${(r.informedness * 100).toFixed(1)}% of the true distance on average (100% = perfect).` })),
    );
    this.hReportDiv.replaceChildren(...lines);
  }

  private updateHighlights(): void {
    if (this.hShowCheck.checked && this.hReport && this.hReport.overestimates.length) this.atlas.setHighlights(this.hReport.overestimates);
    else this.atlas.setHighlights(null);
  }

  // ---------------------------------------------------------------- search

  private updateAlgoBlurb(): void {
    const a = ALGORITHMS.find((x) => x.id === this.algoSelect.value)!;
    this.algoBlurb.textContent = a.blurb;
  }

  private updateSpeed(): void {
    const v = Number(this.speedRange.value);
    this.stepsPerFrame = Math.max(1, Math.round(Math.exp((v / 100) * Math.log(5000))));
    this.speedLabel.textContent = `${fmt(this.stepsPerFrame)} per frame`;
  }

  private async ensureSearch(): Promise<Search | null> {
    if (this.search) return this.search;
    if (!this.graph) return null;
    const algorithm = this.algoSelect.value as Algorithm;
    let heuristic: ((i: number) => number) | undefined;
    if (ALGORITHMS.find((a) => a.id === algorithm)!.usesHeuristic) {
      try {
        const hv = await this.ensureHeuristic();
        if (hv) heuristic = heuristicFromValues(hv);
        if (hv && hv.errors > 0) {
          this.setMsg(this.searchMsg, `Heuristic failed on ${fmt(hv.errors)} states (treated as 0): ${hv.firstError}`, 'warn');
        }
      } catch (e) {
        this.setMsg(this.searchMsg, (e as Error).message, 'error');
        return null;
      }
    }
    this.search = createSearch(this.graph, algorithm, { heuristic });
    this.atlas.setSearch(this.search.status, this.search.current);
    return this.search;
  }

  private togglePlay(): void {
    if (!this.graph) return;
    if (this.playing) {
      this.playing = false;
      this.playBtn.textContent = 'Play';
      return;
    }
    void this.ensureSearch().then((s) => {
      if (!s || s.result) return;
      this.playing = true;
      this.playBtn.textContent = 'Pause';
    });
  }

  private stepOnce(): void {
    if (!this.graph) return;
    void this.ensureSearch().then((s) => {
      if (!s) return;
      this.playing = false;
      this.playBtn.textContent = 'Play';
      this.advance(s, 1);
    });
  }

  private resetSearch(): void {
    this.search = null;
    this.playing = false;
    this.playBtn.textContent = 'Play';
    this.atlas.setSearch(null, -1);
    this.setMsg(this.searchMsg, '', '');
    this.updateCounters();
  }

  private tick(): void {
    if (this.playing && this.search) this.advance(this.search, this.stepsPerFrame);
    requestAnimationFrame(() => this.tick());
  }

  private advance(s: Search, n: number): void {
    const done = s.run(n);
    this.atlas.setSearch(s.status, s.current);
    this.updateCounters();
    if (done) {
      this.playing = false;
      this.playBtn.textContent = 'Play';
      this.onSearchDone(s);
    }
  }

  private onSearchDone(s: Search): void {
    const r = s.result!;
    const g = this.graph!;
    const optimal = g.optimalLength;
    const hName = ALGORITHMS.find((a) => a.id === s.algorithm)!.usesHeuristic ? this.hPresetSelect.selectedOptions[0]?.textContent ?? 'custom' : '';
    const rec: RunRecord = {
      algorithm: s.algorithm,
      heuristic: hName,
      expanded: s.stats.expanded,
      pathLength: r.found ? r.path.length - 1 : null,
      peakMemory: s.stats.peakMemory,
      optimal: r.found && r.path.length - 1 === optimal,
    };
    this.runs.push(rec);
    this.renderRuns();
    if (r.found) {
      const extra = rec.optimal ? 'That is optimal.' : `The optimum is ${optimal}, so this path is ${r.path.length - 1 - optimal} moves longer.`;
      this.setMsg(this.searchMsg, `Goal reached after expanding ${fmt(s.stats.expanded)} of ${fmt(g.keys.length)} states. Path: ${r.path.length - 1} moves. ${extra}`, rec.optimal ? 'ok' : 'warn');
    } else if (r.reason === 'budget') {
      this.setMsg(this.searchMsg, `Stopped at the ${fmt(s.stats.expanded)} expansion budget without reaching the goal.`, 'warn');
    } else {
      this.setMsg(this.searchMsg, `Exhausted every reachable state (${fmt(s.stats.expanded)} expansions): no goal is reachable from the start.`, 'warn');
    }
    if (!this.chTarget.value) this.chTarget.value = String(s.stats.expanded);
    if (this.challenge) this.renderChallenge(rec);
  }

  private updateCounters(): void {
    const s = this.search;
    const st = s?.stats;
    const items: Array<[string, string]> = [
      ['Expanded', st ? fmt(st.expanded) : '–'],
      ['Frontier now', st ? fmt(st.frontier) : '–'],
      ['Peak memory', st ? fmt(st.peakMemory) : '–'],
      ['Generated', st ? fmt(st.generated) : '–'],
    ];
    if (s?.algorithm === 'iddfs') items.push(['Depth limit', st ? fmt(st.depthLimit) : '–'], ['Re-expanded', st ? fmt(st.reexpanded) : '–']);
    if (s?.algorithm === 'astar') items.push(['Reopened', st ? fmt(st.reexpanded) : '–']);
    if (this.graph) items.push(['Optimal length', this.graph.optimalLength < 0 ? 'none' : fmt(this.graph.optimalLength)]);
    this.counters.replaceChildren(...items.map(([k, v]) => el('div', { class: 'counter' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }))));
  }

  private renderRuns(): void {
    this.runsTable.replaceChildren();
    if (this.runs.length === 0) {
      this.runsTable.append(el('tr', {}, el('td', { colspan: '4', class: 'hint', text: 'No runs yet. Compare algorithms and heuristics on the same atlas here.' })));
      return;
    }
    const best = Math.min(...this.runs.filter((r) => r.pathLength !== null).map((r) => r.expanded));
    for (const r of this.runs) {
      const name = r.heuristic ? `${r.algorithm.toUpperCase()} · ${r.heuristic}` : r.algorithm.toUpperCase();
      const path = r.pathLength === null ? 'none' : `${r.pathLength}${r.optimal ? ' ✓' : ''}`;
      const tr = el('tr', { class: r.expanded === best && r.pathLength !== null ? 'best' : '' }, el('td', { text: name }), el('td', { text: fmt(r.expanded) }), el('td', { text: fmt(r.peakMemory) }), el('td', { text: path }));
      this.runsTable.append(tr);
    }
  }

  // ---------------------------------------------------------------- challenge

  private loadFromHash(): void {
    const hash = window.location.hash;
    try {
      const c = challengeFromHash(hash);
      if (c) {
        this.challenge = c;
        this.defText.value = JSON.stringify(c.def, null, 2);
        this.presetSelect.value = PRESETS.find((p) => JSON.stringify(p.def) === JSON.stringify(c.def))?.id ?? 'custom';
        this.algoSelect.value = c.algorithm;
        this.updateAlgoBlurb();
        this.renderChallenge();
        this.buildAtlas();
        return;
      }
    } catch (e) {
      this.setMsg(this.challengeBox, (e as Error).message, 'error');
    }
    const m = /^#p=([a-z0-9-]+)$/.exec(hash);
    if (m && presetById(m[1])) {
      this.presetSelect.value = m[1];
      this.defText.value = JSON.stringify(presetById(m[1])!.def, null, 2);
    }
    this.refreshHeuristicPresets();
    this.buildAtlas();
  }

  private renderChallenge(latest?: RunRecord): void {
    const c = this.challenge;
    if (!c) return;
    const run = latest ?? [...this.runs].reverse().find((r) => r.algorithm === c.algorithm);
    const lines: HTMLElement[] = [el('div', {}, el('b', { text: `Challenge: ${c.title}` })), el('div', { text: `Use ${c.algorithm.toUpperCase()} and expand fewer than ${fmt(c.targetExpanded)} states${c.requireAdmissible ? ' with an admissible heuristic' : ''}.` })];
    if (c.note) lines.push(el('div', { class: 'hint', text: c.note }));
    if (run) {
      const verdict = judgeChallenge(c, { expanded: run.expanded, found: run.pathLength !== null, algorithm: run.algorithm, admissible: this.hReport ? this.hReport.admissible : null });
      lines.push(verdict.beaten ? el('div', {}, el('span', { class: 'badge ok', text: 'Beaten!' }), el('span', { text: ` ${fmt(run.expanded)} expansions.` })) : el('div', {}, el('span', { class: 'badge warn', text: 'Not yet' }), el('span', { text: ` ${verdict.reasons.join('; ')}.` })));
    } else {
      lines.push(el('div', { class: 'hint', text: 'Write a heuristic, check it, then run the search.' }));
    }
    this.challengeBox.className = 'msg';
    this.challengeBox.replaceChildren(...lines);
  }

  private async exportChallenge(): Promise<void> {
    if (!this.def) {
      this.setMsg(this.chLinkMsg, 'Build an atlas first.', 'error');
      return;
    }
    const target = Number(this.chTarget.value);
    if (!Number.isInteger(target) || target < 1) {
      this.setMsg(this.chLinkMsg, 'Enter a positive whole number of expansions to beat.', 'error');
      return;
    }
    const c: Challenge = {
      v: 1,
      title: this.chTitle.value.trim() || `Beat ${fmt(target)} expansions`,
      def: this.def,
      algorithm: this.algoSelect.value as Algorithm,
      targetExpanded: target,
      requireAdmissible: true,
    };
    const url = challengeUrl(window.location.href, c);
    try {
      await navigator.clipboard.writeText(url);
      this.setMsg(this.chLinkMsg, `Copied (${url.length} characters). Anyone opening it gets this puzzle, ${c.algorithm.toUpperCase()} and the target.`, 'ok');
    } catch {
      this.chLinkMsg.className = 'msg';
      this.chLinkMsg.replaceChildren(el('span', { text: 'Copy this link: ' }), el('input', { type: 'text', value: url, readonly: '' }));
    }
  }

  // ---------------------------------------------------------------- misc

  private setMsg(target: HTMLDivElement, text: string, kind: '' | 'ok' | 'error' | 'warn'): void {
    target.className = `msg ${kind}`.trim();
    target.textContent = text;
  }
}

function parseKind(text: string): 'hanoi' | 'tiles' | 'blocks' | null {
  try {
    const k = (JSON.parse(text) as { kind?: string }).kind;
    return k === 'hanoi' || k === 'tiles' || k === 'blocks' ? k : null;
  } catch {
    return null;
  }
}
