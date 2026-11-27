import './lib/hw-theme.js';
import './ui/styles.css';
import { type Board, boardProblem, cloneBoard, coords, mineCount, numbers, resizeBoard } from './core/board';
import { FLAG, type Game, OPEN, flagsPlaced, newGame, openCell, toggleFlag } from './core/game';
import { PRESETS, boardFromRows, randomBoard } from './core/presets';
import { hashFor, parseHash } from './core/share';
import { FLAGGED, REVEALED, type SolveResult, TIER_NAMES, type Tier, difficulty, solve } from './core/solver';
import { type Suggestion, bestStart } from './core/suggest';
import { type CellView, cellAt, cellSizeFor, drawBoard, palette } from './ui/render';
import type { WorkerRequest, WorkerResponse } from './worker/solver.worker';

type Mode = 'edit' | 'play';
type Tool = 'mine' | 'erase' | 'start';

const SIZES: [number, number][] = [
  [8, 8],
  [12, 12],
  [16, 14],
  [16, 16],
  [24, 16],
  [30, 16],
  [40, 30],
];

const app = document.getElementById('app')!;
app.innerHTML = `
<header>
  <div class="title-row"><h1>Reverse Minesweeper Studio</h1><hw-theme-toggle></hw-theme-toggle></div>
  <p>Paint a picture with mines. A logic solver plays it from your opening cell and tells you whether anyone could clear it <strong>without a single guess</strong>.</p>
  <nav class="tabs" role="tablist">
    <button role="tab" data-mode="edit">Paint</button>
    <button role="tab" data-mode="play">Play</button>
  </nav>
</header>
<main>
  <section class="board-wrap">
    <div class="toolbar" id="edit-tools">
      <div class="seg" role="group" aria-label="Brush">
        <button data-tool="mine" title="Paint mines (click a mine to erase)">Mine</button>
        <button data-tool="erase" title="Erase mines">Erase</button>
        <button data-tool="start" title="Choose the safe opening cell">Start</button>
      </div>
      <select id="size" aria-label="Board size"></select>
      <select id="preset" aria-label="Load a drawing"></select>
      <button id="clear">Clear</button>
      <button id="invert">Invert</button>
      <button id="autostart" title="Try many openings and keep the one that gets the solver furthest">Best start</button>
    </div>
    <div class="toolbar" id="play-tools" hidden>
      <span id="play-status" class="status"></span>
      <span class="spacer"></span>
      <button id="flagmode" aria-pressed="false">Flag mode</button>
      <button id="restart">Restart</button>
    </div>
    <div class="canvas-scroll" tabindex="0" role="region" aria-label="Board"><canvas id="board" aria-label="Minesweeper board"></canvas></div>
    <p class="hint" id="hint"></p>
  </section>
  <aside id="panel" aria-live="polite"></aside>
</main>
<footer>
  Everything runs in your browser; boards live only in the link.
  <a href="https://github.com/pisanuw/Claude-capstone/tree/main/reverse-minesweeper-studio">Source</a>
</footer>`;

const canvas = document.getElementById('board') as HTMLCanvasElement;
const panel = document.getElementById('panel')!;
const hint = document.getElementById('hint')!;
const sizeSelect = document.getElementById('size') as HTMLSelectElement;
const presetSelect = document.getElementById('preset') as HTMLSelectElement;

let board: Board = boardFromRows(PRESETS[0]!.rows);
board.start = bestStart(board);
let mode: Mode = 'edit';
let tool: Tool = 'mine';
let result: SolveResult | null = null;
let problem: string | null = null;
let nums: number[] = [];
let shownSteps = 0;
let layoutView: 0 | 1 | null = null;
let suggestions: Suggestion[] | null = null;
let suggesting = false;
let preview: number | null = null;
let game: Game | null = null;
let flagMode = false;
let cellSize = 24;
let loadError: string | null = null;

// ---------- worker ----------

const worker = new Worker(new URL('./worker/solver.worker.ts', import.meta.url), { type: 'module' });
let requestId = 0;
const pending = new Map<number, (r: WorkerResponse) => void>();
worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  pending.get(e.data.id)?.(e.data);
  pending.delete(e.data.id);
};
function ask(kind: WorkerRequest['kind']): Promise<WorkerResponse> {
  const id = ++requestId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, kind, board: cloneBoard(board) } satisfies WorkerRequest);
  });
}

// ---------- analysis ----------

function analyze(): void {
  nums = numbers(board);
  problem = boardProblem(board);
  result = problem ? null : solve(board);
  shownSteps = result ? result.steps.length : 0;
  layoutView = null;
  suggestions = null;
  preview = null;
}

let pendingAnalysis = 0;
function scheduleAnalyze(): void {
  window.clearTimeout(pendingAnalysis);
  pendingAnalysis = window.setTimeout(() => {
    analyze();
    syncHash();
    render();
  }, 60);
}

function syncHash(): void {
  history.replaceState(null, '', hashFor(mode, board));
}

/** Cell state after the first `k` solver steps. */
function stateAfter(k: number): { state: Uint8Array; fresh: Set<number> } {
  const state = new Uint8Array(board.mines.length);
  const fresh = new Set<number>();
  if (!result) return { state, fresh };
  result.steps.slice(0, k).forEach((s, idx) => {
    for (const i of s.revealed) state[i] = REVEALED;
    for (const i of s.flagged) state[i] = FLAGGED;
    if (idx === k - 1) [...s.revealed, ...s.flagged].forEach((i) => fresh.add(i));
  });
  return { state, fresh };
}

// ---------- rendering ----------

function editView(): (i: number) => CellView {
  const final = !result || shownSteps === result.steps.length;
  const { state, fresh } = stateAfter(shownSteps);
  const stuck = new Set(final && result ? result.stuck : []);
  const sealed = new Set(final && result ? result.sealed : []);
  const layout = layoutView !== null && result?.ambiguity ? new Set(result.ambiguity.layouts[layoutView]) : null;
  const suggestCells = new Set((suggestions ?? []).map((s) => s.cell));
  return (i) => {
    const open = state[i] === REVEALED;
    return {
      face: open ? 'open' : 'hidden',
      mine: board.mines[i] && !layout?.has(i) && !(layout && result?.ambiguity?.cells.includes(i)),
      number: open ? nums[i] : 0,
      start: i === board.start,
      tint: stuck.has(i) ? 'stuck' : sealed.has(i) ? 'sealed' : !final && fresh.has(i) ? 'fresh' : null,
      layoutMine: layout?.has(i) ?? false,
      suggest: preview === i || (preview === null && suggestCells.has(i)),
      dim: !!result && !open && !board.mines[i] && !stuck.has(i) && !sealed.has(i) && final,
    };
  };
}

function playView(g: Game): (i: number) => CellView {
  const over = g.status !== 'playing';
  return (i) => {
    const c = g.cells[i];
    if (c === OPEN) {
      return g.board.mines[i]
        ? { face: 'open', mine: true, exploded: i === g.exploded }
        : { face: 'open', number: g.nums[i] };
    }
    if (over && g.board.mines[i]) return { face: g.status === 'won' ? 'blank' : 'hidden', mine: true, flag: c === FLAG && g.status === 'lost' };
    return { face: 'hidden', flag: c === FLAG, start: g.opened === 0 && i === g.board.start };
  };
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  (document.getElementById('edit-tools') as HTMLElement).hidden = mode !== 'edit';
  (document.getElementById('play-tools') as HTMLElement).hidden = mode !== 'play';
  sizeSelect.value = `${board.width}x${board.height}`;
  if (sizeSelect.value !== `${board.width}x${board.height}`) {
    sizeSelect.add(new Option(`${board.width} × ${board.height}`, `${board.width}x${board.height}`));
    sizeSelect.value = `${board.width}x${board.height}`;
  }

  const wrap = canvas.parentElement!;
  cellSize = cellSizeFor(board, Math.min(wrap.clientWidth || 360, 900));
  drawCurrent();
  if (mode === 'play' && game) renderPlay(game);
  else renderEditPanel();
}

/** The board as the state stands, in the colours in place now. */
function drawCurrent(): void {
  drawBoard(canvas, board, cellSize, mode === 'play' && game ? playView(game) : editView(), palette());
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function cellName(i: number): string {
  const [x, y] = coords(board, i);
  return `column ${x + 1}, row ${y + 1}`;
}

function shareBlock(): string {
  const base = `${location.origin}${location.pathname}`;
  const play = base + hashFor('play', board);
  const disabled = result?.solved ? '' : 'data-unsolved="1"';
  return `
  <div class="card">
    <h2>Share</h2>
    <p class="muted">The board travels in the link itself; nothing is uploaded.</p>
    <label class="field">Play link
      <span class="copyrow"><input readonly id="play-link" value="${esc(play)}" /><button data-copy="play-link" ${disabled}>Copy</button></span>
    </label>
    ${result?.solved ? '' : '<p class="warn small">This board still needs a guess; friends may have to gamble.</p>'}
  </div>`;
}

function meter(tier: Tier | null): string {
  const tiers: Tier[] = [1, 2, 3, 4];
  return `<div class="meter" aria-label="Difficulty">${tiers
    .map((t) => `<span class="${tier !== null && t <= tier ? 'on' : ''}" title="${TIER_NAMES[t]}"></span>`)
    .join('')}</div>`;
}

function renderEditPanel(): void {
  hint.textContent =
    tool === 'start'
      ? 'Tap a safe cell to make it the opening. The green box marks it.'
      : 'Drag to paint. Mines are the dark pixels; the drawing is the hidden picture players uncover.';
  const mines = mineCount(board);
  const head = loadError ? `<p class="bad small">Could not read that link: ${esc(loadError)}</p>` : '';
  if (problem || !result) {
    panel.innerHTML = `${head}<div class="card"><h2>Not ready yet</h2><p>${esc(problem ?? '')}</p>
      <p class="muted small">${mines} mines on a ${board.width} × ${board.height} board.</p></div>`;
    return;
  }
  const r = result;
  const d = difficulty(r);
  const total = r.steps.length;
  const step = r.steps[shownSteps - 1];
  const verdict = r.solved
    ? `<p class="verdict good">✓ Guess-free</p><p>Every safe cell can be uncovered by logic alone from the opening.</p>`
    : `<p class="verdict warn">⚠ Needs a guess</p><p>${stuckText(r)}</p>`;
  const tierRows = ([0, 1, 2, 3, 4] as Tier[])
    .filter((t) => r.decidedByTier[t] > 0)
    .map((t) => `<tr><td>${TIER_NAMES[t]}</td><td>${r.decidedByTier[t]}</td></tr>`)
    .join('');
  const ambiguity = r.ambiguity
    ? `<div class="layouts"><span>Two layouts that fit every visible number:</span>
        <span class="seg"><button data-layout="0" class="${layoutView === 0 ? 'active' : ''}">Layout A</button><button data-layout="1" class="${layoutView === 1 ? 'active' : ''}">Layout B</button><button data-layout="-1">Hide</button></span></div>`
    : '';
  const fix = r.solved ? '' : suggestionBlock();
  panel.innerHTML = `${head}
  <div class="card">
    ${verdict}
    <div class="diff"><strong>${esc(d.label)}</strong>${meter(r.solved ? d.tier : null)}</div>
    <p class="muted small">${r.solved ? esc(d.blurb) : 'Difficulty is rated once the board is guess-free.'}</p>
    <table class="tiers"><thead><tr><th>Deduction tier</th><th>Cells decided</th></tr></thead><tbody>${tierRows}</tbody></table>
    <p class="muted small">${mines} mines · ${board.width} × ${board.height} · ${total} solver steps${r.aborted ? ' · one region was too large to search exhaustively' : ''}</p>
    ${ambiguity}
  </div>
  <div class="card">
    <h2>Replay the solver</h2>
    <input type="range" id="step" min="1" max="${total}" value="${shownSteps}" aria-label="Solver step" />
    <p class="small">Step ${shownSteps} of ${total}: <strong>${step ? TIER_NAMES[step.tier] : ''}</strong>${
      step ? ` opened ${step.revealed.length}, flagged ${step.flagged.length}` : ''
    }</p>
  </div>
  ${fix}
  ${shareBlock()}`;
}

function stuckText(r: SolveResult): string {
  const parts: string[] = [];
  if (r.stuck.length) parts.push(`<span class="chip stuck"></span>${r.stuck.length} amber cell${r.stuck.length === 1 ? '' : 's'} touch a number but cannot be decided`);
  if (r.sealed.length) parts.push(`<span class="chip sealed"></span>${r.sealed.length} pale cell${r.sealed.length === 1 ? ' is' : 's are'} sealed off where no number reaches`);
  return parts.join('; ') + '. A player arriving here would have to guess.';
}

function suggestionBlock(): string {
  let body: string;
  if (suggesting) body = '<p class="muted">Trying every single-cell edit near the trouble…</p>';
  else if (!suggestions) body = '<button id="suggest" class="primary">Suggest a fix</button>';
  else if (!suggestions.length) body = '<p>No single-cell edit nearby makes progress. Try opening up the amber region by hand.</p>';
  else
    body = `<ul class="suggestions">${suggestions
      .map(
        (s, k) => `<li data-preview="${s.cell}">
          <span>${s.addMine ? 'Add a mine' : 'Remove the mine'} at ${cellName(s.cell)}: ${
            s.result.solved ? `<strong class="good">guess-free</strong> (${TIER_NAMES[s.result.maxTier]})` : `uncovers ${s.result.revealed} cells`
          }</span>
          <button data-apply="${k}">Apply</button></li>`,
      )
      .join('')}</ul>`;
  return `<div class="card"><h2>Smallest fix</h2>${body}</div>`;
}

function renderPlay(g: Game): void {
  const status = document.getElementById('play-status')!;
  const left = mineCount(board) - flagsPlaced(g);
  status.textContent = g.status === 'won' ? 'Cleared!' : g.status === 'lost' ? 'Boom.' : `Mines left: ${left}`;
  const flagBtn = document.getElementById('flagmode')!;
  flagBtn.setAttribute('aria-pressed', String(flagMode));
  flagBtn.classList.toggle('active', flagMode);
  hint.textContent = 'Tap to open, long-press or right-click (or use Flag mode) to flag. Start on the green box.';
  const verified = result?.solved
    ? `<p class="verdict good small">✓ Verified guess-free: ${esc(difficulty(result).label)}</p>`
    : '<p class="verdict warn small">⚠ This board needs at least one guess.</p>';
  const outcome =
    g.status === 'won'
      ? '<p class="verdict good">You uncovered the hidden picture.</p><p>The dark pixels are the drawing the author painted with mines.</p>'
      : g.status === 'lost'
        ? '<p class="verdict bad">That was a mine.</p><p>Every move here can be deduced; restart and look for a forced cell.</p>'
        : '<p>Clear every safe cell to reveal the drawing hidden in the mines.</p>';
  panel.innerHTML = `<div class="card">${verified}${outcome}
    <p class="muted small">${board.width} × ${board.height}, ${mineCount(board)} mines.</p>
    <button id="to-edit">Open in the editor</button></div>`;
}

// ---------- input ----------

let painting: boolean | null = null;
let lastPainted = -1;

function paintAt(i: number): void {
  if (i < 0 || i === lastPainted || painting === null) return;
  lastPainted = i;
  if (i === board.start) return;
  if (board.mines[i] === painting) return;
  board.mines[i] = painting;
  scheduleAnalyze();
  drawBoard(canvas, board, cellSize, editView(), palette());
}

let pressTimer = 0;
let longPressed = false;

canvas.addEventListener('pointerdown', (e) => {
  const i = cellAt(canvas, board, cellSize, e.clientX, e.clientY);
  if (i < 0) return;
  if (mode === 'play') {
    longPressed = false;
    if (e.pointerType !== 'mouse') {
      pressTimer = window.setTimeout(() => {
        longPressed = true;
        if (game) toggleFlag(game, i);
        render();
      }, 400);
    }
    return;
  }
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  if (tool === 'start') {
    board.start = i;
    board.mines[i] = false;
    scheduleAnalyze();
    return;
  }
  painting = tool === 'erase' ? false : !board.mines[i];
  lastPainted = -1;
  paintAt(i);
});
canvas.addEventListener('pointermove', (e) => {
  if (mode === 'edit' && painting !== null) paintAt(cellAt(canvas, board, cellSize, e.clientX, e.clientY));
});
const endPaint = (): void => {
  painting = null;
};
canvas.addEventListener('pointerup', (e) => {
  endPaint();
  if (mode !== 'play' || !game) return;
  window.clearTimeout(pressTimer);
  if (longPressed || e.button === 2) return;
  const i = cellAt(canvas, board, cellSize, e.clientX, e.clientY);
  if (i < 0) return;
  if (flagMode) toggleFlag(game, i);
  else openCell(game, i);
  render();
});
canvas.addEventListener('pointercancel', () => {
  endPaint();
  window.clearTimeout(pressTimer);
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (mode !== 'play' || !game) return;
  const i = cellAt(canvas, board, cellSize, e.clientX, e.clientY);
  if (i >= 0) toggleFlag(game, i);
  render();
});

function setMode(next: Mode): void {
  mode = next;
  if (mode === 'play') {
    game = newGame(cloneBoard(board));
    flagMode = false;
  }
  syncHash();
  render();
}

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!t) return;
  if (t.dataset.mode) setMode(t.dataset.mode as Mode);
  else if (t.dataset.tool) {
    tool = t.dataset.tool as Tool;
    render();
  } else if (t.dataset.layout !== undefined) {
    const v = Number(t.dataset.layout);
    layoutView = v < 0 ? null : (v as 0 | 1);
    render();
  } else if (t.dataset.apply !== undefined && suggestions) {
    const s = suggestions[Number(t.dataset.apply)]!;
    board.mines[s.cell] = s.addMine;
    analyze();
    syncHash();
    render();
  } else if (t.dataset.copy) {
    const input = document.getElementById(t.dataset.copy) as HTMLInputElement;
    input.select();
    navigator.clipboard?.writeText(input.value).then(
      () => (t.textContent = 'Copied'),
      () => (t.textContent = 'Select & copy'),
    );
  } else if (t.id === 'suggest') {
    suggesting = true;
    render();
    void ask('suggest').then((r) => {
      suggesting = false;
      suggestions = r.kind === 'suggest' ? r.suggestions : [];
      render();
    });
  } else if (t.id === 'autostart') {
    t.disabled = true;
    void ask('bestStart').then((r) => {
      t.disabled = false;
      if (r.kind === 'bestStart' && r.start >= 0) board.start = r.start;
      analyze();
      syncHash();
      render();
    });
  } else if (t.id === 'clear') {
    board.mines.fill(false);
    analyze();
    syncHash();
    render();
  } else if (t.id === 'invert') {
    board.mines = board.mines.map((m, i) => i !== board.start && !m);
    analyze();
    syncHash();
    render();
  } else if (t.id === 'flagmode') {
    flagMode = !flagMode;
    render();
  } else if (t.id === 'restart' || t.id === 'to-edit') {
    if (t.id === 'to-edit') setMode('edit');
    else {
      game = newGame(cloneBoard(board));
      render();
    }
  }
});

panel.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'step') {
    shownSteps = Number(t.value);
    drawBoard(canvas, board, cellSize, editView(), palette());
    const step = result?.steps[shownSteps - 1];
    const label = t.nextElementSibling;
    if (label && step) {
      label.innerHTML = `Step ${shownSteps} of ${result!.steps.length}: <strong>${TIER_NAMES[step.tier]}</strong> opened ${step.revealed.length}, flagged ${step.flagged.length}`;
    }
  }
});
panel.addEventListener('pointerover', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('[data-preview]');
  const next = li ? Number(li.dataset.preview) : null;
  if (next !== preview && mode === 'edit') {
    preview = next;
    drawBoard(canvas, board, cellSize, editView(), palette());
  }
});

for (const [w, h] of SIZES) sizeSelect.add(new Option(`${w} × ${h}`, `${w}x${h}`));
sizeSelect.addEventListener('change', () => {
  const [w, h] = sizeSelect.value.split('x').map(Number) as [number, number];
  board = resizeBoard(board, w, h);
  if (board.start < 0) board.start = bestStart(board);
  analyze();
  syncHash();
  render();
});

presetSelect.add(new Option('Load a drawing…', ''));
for (const p of PRESETS) presetSelect.add(new Option(p.name, p.id));
presetSelect.add(new Option('Random scatter (18%)', 'random'));
presetSelect.addEventListener('change', () => {
  const id = presetSelect.value;
  presetSelect.value = '';
  if (!id) return;
  const p = PRESETS.find((x) => x.id === id);
  board = p ? boardFromRows(p.rows) : randomBoard(board.width, board.height, 0.18, Math.floor(Math.random() * 2 ** 31));
  board.start = bestStart(board);
  analyze();
  syncHash();
  render();
});

function loadFromHash(): void {
  loadError = null;
  try {
    const route = parseHash(location.hash);
    if (route) {
      board = route.board;
      mode = route.mode;
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }
  analyze();
  if (mode === 'play') game = newGame(cloneBoard(board));
  render();
}

window.addEventListener('hashchange', () => {
  if (location.hash !== hashFor(mode, board)) loadFromHash();
});
window.addEventListener('resize', () => render());
// The board reads the colour tokens as it draws: draw it again when the theme changes (the switch, or the device
// setting with nothing stored), and at once on the way into print and back. Print takes the light set, but a canvas
// keeps the pixels it drew on screen; matchMedia('print') changes with the print colours in place.
document.addEventListener('hw-themechange', drawCurrent);
if (typeof window.matchMedia === 'function') window.matchMedia('print').addEventListener?.('change', drawCurrent);

loadFromHash();
if (!location.hash) syncHash();
