import { IDENTITY, apply, inverse, type Iso, type Pt } from '../core/iso';
import { distanceFromOrigin, geodesicLerp, hyperbolicWidth, measureTriangle, distance, pixelWidth } from '../core/geometry';
import { generateTiles, isHyperbolic, makeTiling, tilingFacts, fold, type Tile, type Tiling } from '../core/tiling';
import { drawStrokes, drawTiles, geodesicTo, makeStroke, tileMatches, toScreen, validColor, type Doc, type Frame, type Stroke, type StrokeKind, type Symmetry, type TileStyle } from '../core/scene';
import { exportSvg } from '../core/svg';
import { decodeShare, encodeShare } from '../core/share';
import { carry, dragView, easeInOut, rebase, recenterAt } from '../core/view';
import { CanvasSink } from './canvasSink';
import { clear, h } from './dom';

type Tool = 'free' | 'geodesic' | 'measure' | 'move';

const PRESETS: [number, number][] = [
  [7, 3],
  [5, 4],
  [4, 5],
  [3, 7],
  [8, 3],
  [6, 4],
  [4, 6],
  [5, 5],
  [3, 8],
  [7, 7],
];

const PALETTE = ['#1d4ed8', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#0f172a', '#ec4899', '#ffffff'];

const STORAGE_KEY = 'poincare-paint:v1';

interface State {
  doc: Doc;
  T: Tiling;
  view: Iso;
  tool: Tool;
  color: string;
  widthPx: number;
  shading: boolean;
  edges: boolean;
  mirrors: boolean;
  depth: number;
  finePx: number;
  /** World-space measure points. */
  measure: Pt[];
  redo: Stroke[];
}

function loadInitial(): { doc: Doc; view: Iso; note?: string } {
  const fallback: Doc = { p: 7, q: 3, symmetry: 'rotation', strokes: [] };
  const m = /[#&]d=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) {
    try {
      const s = decodeShare(m[1]);
      return { doc: s.doc, view: s.view ?? IDENTITY, note: `Loaded a shared {${s.doc.p},${s.doc.q}} drawing with ${s.doc.strokes.length} strokes.` };
    } catch (e) {
      return { doc: fallback, view: IDENTITY, note: `Could not read the share link: ${(e as Error).message}.` };
    }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { doc: decodeShare(saved).doc, view: IDENTITY };
  } catch {
    /* storage unavailable or stale: start fresh */
  }
  return { doc: fallback, view: IDENTITY };
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : '∞');
const deg = (r: number): string => `${((r * 180) / Math.PI).toFixed(2)}°`;

export function mountApp(root: HTMLElement): void {
  const init = loadInitial();
  const state: State = {
    doc: init.doc,
    T: makeTiling(init.doc.p, init.doc.q),
    view: init.view,
    tool: 'free',
    color: PALETTE[0],
    widthPx: 4,
    shading: true,
    edges: true,
    mirrors: false,
    depth: 40,
    finePx: 1.2,
    measure: [],
    redo: [],
  };

  clear(root);

  // ---------- layout ----------
  const base = h('canvas', { class: 'layer' });
  const overlay = h('canvas', { class: 'layer overlay', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'stage', role: 'img', tabindex: 0, 'aria-label': 'Poincaré disk drawing canvas. Arrow keys move the view, 0 resets it, Ctrl+Z undoes.' }, base, overlay);
  const status = h('p', { class: 'status', 'aria-live': 'polite' }, init.note ?? 'Draw inside the disk. Every stroke is copied into every tile.');
  const cursorOut = h('span', {}, '–');
  const countOut = h('span', {}, '–');

  const toolButtons = new Map<Tool, HTMLButtonElement>();
  const toolDefs: [Tool, string, string][] = [
    ['free', 'Freehand', 'Draw freely; copies follow every tile'],
    ['geodesic', 'Geodesic', 'Drag to draw a hyperbolic straight line'],
    ['measure', 'Measure', 'Click 2 points for a distance, 3 for a triangle'],
    ['move', 'Move', 'Drag to translate the plane; double-click to centre a point'],
  ];
  const toolRow = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tool' });
  for (const [tool, label, title] of toolDefs) {
    const b = h('button', { type: 'button', role: 'radio', title, onclick: () => setTool(tool) }, label);
    toolButtons.set(tool, b);
    toolRow.append(b);
  }

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  const colorInput = h('input', { type: 'color', value: state.color, 'aria-label': 'Custom colour' });
  colorInput.addEventListener('input', () => setColor(colorInput.value));
  const swatchButtons: HTMLButtonElement[] = PALETTE.map((c) => {
    const b = h('button', { type: 'button', class: 'swatch', role: 'radio', title: c, 'aria-label': `Colour ${c}`, style: `background:${c}`, onclick: () => setColor(c) });
    swatches.append(b);
    return b;
  });
  swatches.append(colorInput);

  const widthInput = h('input', { type: 'range', min: 1, max: 24, step: 1, value: String(state.widthPx) });
  const widthOut = h('output', {}, `${state.widthPx}px`);
  widthInput.addEventListener('input', () => {
    state.widthPx = Number(widthInput.value);
    widthOut.textContent = `${state.widthPx}px`;
  });

  const presetSel = h('select', { 'aria-label': 'Tiling preset' });
  for (const [p, q] of PRESETS) presetSel.append(h('option', { value: `${p},${q}` }, `{${p},${q}}`));
  presetSel.append(h('option', { value: 'custom' }, 'Custom…'));
  const pInput = h('input', { type: 'number', min: 3, max: 20, step: 1, value: String(state.doc.p), 'aria-label': 'p: sides per polygon' });
  const qInput = h('input', { type: 'number', min: 3, max: 20, step: 1, value: String(state.doc.q), 'aria-label': 'q: polygons per vertex' });
  const pqError = h('small', { class: 'error', 'aria-live': 'polite' });
  presetSel.addEventListener('change', () => {
    if (presetSel.value === 'custom') {
      pInput.focus();
      return;
    }
    const [p, q] = presetSel.value.split(',').map(Number);
    pInput.value = String(p);
    qInput.value = String(q);
    setTiling(p, q);
  });
  const onPQ = () => {
    const p = Number(pInput.value);
    const q = Number(qInput.value);
    if (!isHyperbolic(p, q) || p > 20 || q > 20) {
      pqError.textContent = `{${pInput.value},${qInput.value}} is not hyperbolic: need (p−2)(q−2) > 4, with 3 ≤ p, q ≤ 20.`;
      return;
    }
    pqError.textContent = '';
    setTiling(p, q);
  };
  pInput.addEventListener('change', onPQ);
  qInput.addEventListener('change', onPQ);

  const symSel = h('select', { 'aria-label': 'Symmetry' });
  symSel.append(h('option', { value: 'rotation' }, 'Rotations (Circle Limit style)'), h('option', { value: 'kaleidoscope' }, 'Kaleidoscope (with reflections)'));
  symSel.addEventListener('change', () => {
    state.doc.symmetry = symSel.value as Symmetry;
    commitDoc();
  });

  const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox', checked: get() });
    input.addEventListener('change', () => {
      set(input.checked);
      requestRender();
    });
    return h('label', { class: 'check' }, input, label);
  };

  const depthInput = h('input', { type: 'range', min: 3, max: 80, step: 1, value: String(state.depth) });
  const depthOut = h('output', {}, String(state.depth));
  depthInput.addEventListener('input', () => {
    state.depth = Number(depthInput.value);
    depthOut.textContent = String(state.depth);
    requestRender();
  });
  const fineInput = h('input', { type: 'range', min: 0.6, max: 6, step: 0.2, value: String(state.finePx) });
  const fineOut = h('output', {}, `${state.finePx}px`);
  fineInput.addEventListener('input', () => {
    state.finePx = Number(fineInput.value);
    fineOut.textContent = `${state.finePx.toFixed(1)}px`;
    requestRender();
  });

  const undoBtn = h('button', { type: 'button', class: 'secondary', onclick: () => undo() }, 'Undo');
  const redoBtn = h('button', { type: 'button', class: 'secondary', onclick: () => redo() }, 'Redo');
  const clearBtn = h('button', { type: 'button', class: 'secondary', onclick: () => clearAll() }, 'Clear');
  const resetBtn = h('button', { type: 'button', class: 'secondary', onclick: () => animateTo(apply(state.view, 0, 0), () => (state.view = IDENTITY)) }, 'Re-centre');
  const svgBtn = h('button', { type: 'button', onclick: () => downloadSvg() }, 'Export SVG');
  const linkBtn = h('button', { type: 'button', onclick: () => void copyLink() }, 'Copy share link');

  const measureOut = h('div', { class: 'measure-out', 'aria-live': 'polite' });
  const factsOut = h('dl', { class: 'facts' });

  const panel = h(
    'aside',
    { class: 'panel' },
    h('section', {}, h('h2', {}, 'Tiling'), h('div', { class: 'row' }, presetSel, h('span', { class: 'pq' }, '{', pInput, ',', qInput, '}')), pqError, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Symmetry'), symSel), h('div', { class: 'checks' }, check('Shade', () => state.shading, (v) => (state.shading = v)), check('Polygon edges', () => state.edges, (v) => (state.edges = v)), check('Mirror lines', () => state.mirrors, (v) => (state.mirrors = v)))),
    h('section', {}, h('h2', {}, 'Brush'), toolRow, swatches, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Width at the centre ', widthOut), widthInput)),
    h('section', {}, h('div', { class: 'button-row' }, undoBtn, redoBtn, clearBtn, resetBtn), h('div', { class: 'button-row' }, svgBtn, linkBtn)),
    h('section', {}, h('h2', {}, 'Measure'), measureOut),
    h('details', {}, h('summary', {}, 'Detail'), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Max mirror steps ', depthOut), depthInput), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Smallest tile drawn ', fineOut), fineInput, h('small', {}, 'Smaller values draw further towards the rim and cost more time.'))),
    h('details', {}, h('summary', {}, 'This tiling'), factsOut),
  );

  root.append(
    h('header', { class: 'site-header' }, h('h1', {}, 'Poincaré Paint'), h('p', { class: 'tagline' }, 'Draw once, and the hyperbolic plane repeats it forever. Drag to slide the plane: the disk has no centre and its rim is infinitely far away.')),
    h('main', { class: 'layout' }, h('div', { class: 'stage-col' }, stage, h('p', { class: 'readout' }, 'Cursor: ', cursorOut, ' · ', countOut), status), panel),
    h(
      'section',
      { class: 'explain' },
      h('h2', {}, 'How it works'),
      h('p', {}, 'A {p,q} tiling packs regular p-sided polygons, q around each corner. That is only possible on a flat page when (p−2)(q−2) = 4; when the product is larger the angles are too small and the polygons need the hyperbolic plane. The Poincaré disk squeezes that whole plane into a circle: all the polygons are the same size, they only look smaller near the rim.'),
      h('p', {}, 'Each polygon splits into 2p right triangles with angles π/p, π/q and π/2. Reflecting one triangle in its three sides, again and again, covers the plane. Your stroke is folded into that one triangle when you lift the pen and drawn again under every reflection word, using Möbius maps z ↦ (αz + β)/(β̄z + ᾱ). Those maps preserve angles and hyperbolic length, so straight lines (geodesics: arcs that meet the rim at right angles) stay straight and shapes shrink towards the rim at exactly the right rate.'),
      h('p', {}, 'Rotations mode keeps only even words (rotations and translations), giving Escher-style Circle Limit patterns. Kaleidoscope mode adds the mirror images. Moving the view applies a hyperbolic translation; every point is as central as any other. The measure tool shows distances and the angle sum of a triangle, always less than 180°: the shortfall is its area.'),
    ),
  );

  // ---------- rendering ----------
  let frame: Frame = { ox: 0, oy: 0, R: 1 };
  let tiles: Tile[] = [];
  let lowDetail = false;
  let dirty = false;
  let sizeCss = 0;

  function resize(): void {
    const w = Math.max(240, Math.floor(stage.clientWidth));
    sizeCss = w;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    for (const c of [base, overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(w * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${w}px`;
      const ctx = c.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    frame = { ox: w / 2, oy: w / 2, R: w / 2 - 3 };
    requestRender();
  }

  function tileStyle(): TileStyle {
    return { shading: state.shading, edges: state.edges, mirrors: state.mirrors, shade: cssVar('--shade'), edge: cssVar('--edge'), mirror: cssVar('--mirror') };
  }

  function render(): void {
    dirty = false;
    const ctx = base.getContext('2d');
    if (!ctx) return;
    const minPx = lowDetail ? Math.max(3, state.finePx) : state.finePx;
    const tA = performance.now();
    tiles = generateTiles(state.T, state.view, { maxDepth: state.depth, minSize: minPx / frame.R, maxTiles: lowDetail ? 12000 : 40000 });
    ctx.clearRect(0, 0, sizeCss, sizeCss);
    ctx.save();
    ctx.beginPath();
    ctx.arc(frame.ox, frame.oy, frame.R, 0, 2 * Math.PI);
    ctx.fillStyle = cssVar('--disk');
    ctx.fill();
    ctx.clip();
    const sink = new CanvasSink(ctx);
    const tB = performance.now();
    drawTiles(sink, state.T, tiles, frame, tileStyle());
    const tC = performance.now();
    const copies = drawStrokes(sink, state.doc.strokes, tiles, frame, state.doc.symmetry);
    ctx.restore();
    base.dataset.timing = `${(tB - tA).toFixed(0)}/${(tC - tB).toFixed(0)}/${(performance.now() - tC).toFixed(0)}`;
    ctx.beginPath();
    ctx.arc(frame.ox, frame.oy, frame.R, 0, 2 * Math.PI);
    ctx.strokeStyle = cssVar('--rim');
    ctx.lineWidth = 1.5;
    ctx.stroke();
    countOut.textContent = `${tiles.length.toLocaleString()} triangles, ${copies.toLocaleString()} stroke copies`;
    renderOverlay();
  }

  function requestRender(): void {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(render);
  }

  // ---------- overlay: live strokes and measurement ----------
  let live: { kind: StrokeKind; world: Pt[]; foldIso: Iso; parity: 0 | 1; color: string; width: number } | null = null;

  function overlayCtx(): CanvasRenderingContext2D | null {
    return overlay.getContext('2d');
  }

  function renderOverlay(): void {
    const ctx = overlayCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, sizeCss, sizeCss);
    ctx.save();
    ctx.beginPath();
    ctx.arc(frame.ox, frame.oy, frame.R, 0, 2 * Math.PI);
    ctx.clip();
    if (live) drawLive(ctx);
    drawMeasure(ctx);
    ctx.restore();
  }

  function liveStroke(): Stroke | null {
    if (!live || live.world.length === 0) return null;
    const pts = live.kind === 'geodesic' ? [live.world[0], live.world[live.world.length - 1]] : live.world;
    return { kind: live.kind, color: live.color, width: live.width, parity: live.parity, points: pts.map((p) => apply(live!.foldIso, p[0], p[1]) as Pt) };
  }

  /** Draw the whole in-progress stroke under every tile. */
  function drawLive(ctx: CanvasRenderingContext2D): void {
    const s = liveStroke();
    if (s) drawStrokes(new CanvasSink(ctx), [s], tiles, frame, state.doc.symmetry);
  }

  /** Append only the newest freehand segment, so long strokes stay cheap. */
  function drawLiveSegment(): void {
    const ctx = overlayCtx();
    if (!ctx || !live) return;
    const s = liveStroke();
    if (!s || s.points.length < 2) return;
    const a = s.points[s.points.length - 2];
    const b = s.points[s.points.length - 1];
    ctx.save();
    ctx.beginPath();
    ctx.arc(frame.ox, frame.oy, frame.R, 0, 2 * Math.PI);
    ctx.clip();
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    for (const t of tiles) {
      if (t.size * frame.R < 0.8 || !tileMatches(t, s, state.doc.symmetry)) continue;
      const pa = apply(t.t, a[0], a[1]);
      const pb = apply(t.t, b[0], b[1]);
      const w = pixelWidth(s.width, pa, frame.R);
      if (w < 0.15) continue;
      const sa = toScreen(frame, pa);
      const sb = toScreen(frame, pb);
      ctx.lineWidth = Math.max(0.35, w);
      ctx.beginPath();
      ctx.moveTo(sa[0], sa[1]);
      ctx.lineTo(sb[0], sb[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMeasure(ctx: CanvasRenderingContext2D): void {
    if (state.measure.length === 0) return;
    const pts = state.measure.map((w) => apply(state.view, w[0], w[1]) as Pt);
    const scr = pts.map((p) => toScreen(frame, p) as Pt);
    const sink = new CanvasSink(ctx);
    const accent = cssVar('--accent');
    const halo = cssVar('--disk');
    const path = () => {
      sink.begin();
      sink.moveTo(scr[0][0], scr[0][1]);
      for (let i = 1; i < scr.length; i++) geodesicTo(sink, frame, scr[i - 1], scr[i]);
      if (scr.length === 3) geodesicTo(sink, frame, scr[2], scr[0]);
    };
    if (scr.length > 1) {
      path();
      sink.stroke(halo, 6);
      path();
      ctx.setLineDash([7, 5]);
      sink.stroke(accent, 2.5);
      ctx.setLineDash([]);
    }
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = halo;
    const label = (text: string, x: number, y: number) => {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    scr.forEach((s, i) => {
      ctx.beginPath();
      ctx.arc(s[0], s[1], 6, 0, 2 * Math.PI);
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s[0], s[1], 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = accent;
      ctx.fill();
      label('ABC'[i], s[0] + 8, s[1] - 8);
    });
    if (pts.length === 2) {
      const m = toScreen(frame, geodesicLerp(pts[0], pts[1], 0.5));
      label(fmt(distance(pts[0], pts[1])), m[0] + 8, m[1] + 16);
    }
  }

  function updateMeasureText(): void {
    clear(measureOut);
    const n = state.measure.length;
    if (state.tool !== 'measure' && n === 0) {
      measureOut.append(h('p', { class: 'muted' }, 'Pick the Measure tool and click two points for a hyperbolic distance, or three for a triangle.'));
      return;
    }
    if (n === 0) measureOut.append(h('p', { class: 'muted' }, 'Click a first point.'));
    if (n === 1) measureOut.append(h('p', { class: 'muted' }, 'Click a second point.'));
    if (n === 2) {
      const [a, b] = state.measure;
      measureOut.append(h('p', {}, 'Distance AB = ', h('strong', {}, fmt(distance(a, b)))), h('p', { class: 'muted' }, 'Click a third point for a triangle. Drag the view: the number does not change.'));
    }
    if (n === 3) {
      const [a, b, c] = state.measure;
      const m = measureTriangle(a, b, c);
      measureOut.append(
        h('dl', { class: 'facts' }, h('dt', {}, 'Sides'), h('dd', {}, `a ${fmt(m.sides[0])}, b ${fmt(m.sides[1])}, c ${fmt(m.sides[2])}`), h('dt', {}, 'Angles'), h('dd', {}, `A ${deg(m.angles[0])}, B ${deg(m.angles[1])}, C ${deg(m.angles[2])}`), h('dt', {}, 'Angle sum'), h('dd', {}, h('strong', {}, deg(m.angleSum)), ' (less than 180°)'), h('dt', {}, 'Area'), h('dd', {}, `π − sum = ${fmt(m.area)}`)),
        h('p', { class: 'muted' }, 'Click again to start over.'),
      );
    }
    if (n > 0) measureOut.append(h('button', { type: 'button', class: 'small secondary', onclick: () => ((state.measure = []), updateMeasureText(), renderOverlay()) }, 'Clear marks'));
  }

  function updateFacts(): void {
    const f = tilingFacts(state.T);
    clear(factsOut);
    const rows: [string, string][] = [
      ['Polygon', `${state.doc.p} sides, ${state.doc.q} meet at each corner`],
      ['Corner angle', `2π/${state.doc.q} = ${deg(f.polygonAngle)} (a flat ${state.doc.p}-gon has ${deg(Math.PI - (2 * Math.PI) / state.doc.p)})`],
      ['Edge length', fmt(f.edgeLength)],
      ['Centre to corner', fmt(f.circumradius)],
      ['Centre to edge', fmt(f.inradius)],
      ['Polygon area', `${fmt(f.polygonArea)} (= (p−2)π − p·2π/q)`],
      ['Triangle angles', `π/${state.doc.p} + π/${state.doc.q} + π/2 = ${deg(f.triangleAngleSum)}`],
      ['Triangle area', fmt(f.triangleArea)],
    ];
    for (const [k, v] of rows) factsOut.append(h('dt', {}, k), h('dd', {}, v));
  }

  // ---------- state changes ----------
  function save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, encodeShare(state.doc));
    } catch {
      /* private mode or quota: drawing still works */
    }
  }

  function commitDoc(): void {
    save();
    syncControls();
    requestRender();
  }

  function setTool(t: Tool): void {
    state.tool = t;
    syncControls();
    updateMeasureText();
  }

  function setColor(c: string): void {
    if (!validColor(c)) return;
    state.color = c.toLowerCase();
    colorInput.value = state.color;
    syncControls();
  }

  function setTiling(p: number, q: number): void {
    if (p === state.doc.p && q === state.doc.q) return;
    state.doc.p = p;
    state.doc.q = q;
    state.T = makeTiling(p, q);
    state.view = IDENTITY;
    state.measure = [];
    status.textContent = state.doc.strokes.length ? `Now {${p},${q}}. Your strokes stay where they were in the fundamental triangle and are re-tiled by the new group.` : `Now {${p},${q}}.`;
    updateFacts();
    updateMeasureText();
    commitDoc();
  }

  function undo(): void {
    const s = state.doc.strokes.pop();
    if (s) state.redo.push(s);
    commitDoc();
  }

  function redo(): void {
    const s = state.redo.pop();
    if (s) state.doc.strokes.push(s);
    commitDoc();
  }

  function clearAll(): void {
    if (state.doc.strokes.length === 0) return;
    if (!confirm(`Clear all ${state.doc.strokes.length} strokes? (Undo cannot bring them back.)`)) return;
    state.doc.strokes = [];
    state.redo = [];
    commitDoc();
  }

  function syncControls(): void {
    for (const [t, b] of toolButtons) b.setAttribute('aria-checked', String(t === state.tool));
    swatchButtons.forEach((b, i) => b.setAttribute('aria-checked', String(PALETTE[i] === state.color)));
    symSel.value = state.doc.symmetry;
    const key = `${state.doc.p},${state.doc.q}`;
    presetSel.value = PRESETS.some(([p, q]) => `${p},${q}` === key) ? key : 'custom';
    pInput.value = String(state.doc.p);
    qInput.value = String(state.doc.q);
    undoBtn.disabled = state.doc.strokes.length === 0;
    redoBtn.disabled = state.redo.length === 0;
    clearBtn.disabled = state.doc.strokes.length === 0;
    stage.dataset.tool = state.tool;
  }

  /** Keep the view matrix small; carries measurement marks along. */
  function doRebase(): void {
    const r = rebase(state.T, state.view);
    state.view = r.view;
    state.measure = state.measure.map((w) => carry(r.g, w) as Pt);
  }

  let anim = 0;
  function animateTo(target: Pt, after?: () => void): void {
    cancelAnimationFrame(anim);
    const start = state.view;
    const t0 = performance.now();
    const dur = 650;
    lowDetail = true;
    const step = (now: number) => {
      const k = easeInOut((now - t0) / dur);
      state.view = recenterAt(start, target, k);
      render();
      if (k < 1) anim = requestAnimationFrame(step);
      else {
        lowDetail = false;
        if (after) {
          // after() may reset to the identity, which is not a group element; keep marks fixed in view.
          const before = state.view;
          after();
          const fix = inverse(state.view);
          state.measure = state.measure.map((w) => {
            const v = apply(before, w[0], w[1]);
            return apply(fix, v[0], v[1]) as Pt;
          });
        } else doRebase();
        render();
      }
    };
    anim = requestAnimationFrame(step);
  }

  // ---------- pointer input ----------
  function toDisk(ev: PointerEvent | MouseEvent): Pt {
    const r = overlay.getBoundingClientRect();
    return [(ev.clientX - r.left - frame.ox) / frame.R, -(ev.clientY - r.top - frame.oy) / frame.R];
  }
  const inside = (z: Pt) => z[0] * z[0] + z[1] * z[1] < 0.9995;
  const toWorld = (z: Pt): Pt => apply(inverse(state.view), z[0], z[1]);

  let panFrom: Pt | null = null;
  let lastScreen: Pt | null = null;

  overlay.addEventListener('pointerdown', (ev) => {
    const z = toDisk(ev);
    if (!inside(z)) return;
    overlay.setPointerCapture(ev.pointerId);
    stage.focus({ preventScroll: true });
    cancelAnimationFrame(anim);
    const pan = state.tool === 'move' || ev.button === 1 || ev.button === 2 || ev.shiftKey;
    if (pan) {
      panFrom = z;
      lowDetail = true;
      return;
    }
    if (ev.button !== 0) return;
    if (state.tool === 'measure') {
      if (state.measure.length >= 3) state.measure = [];
      state.measure.push(toWorld(z));
      updateMeasureText();
      renderOverlay();
      return;
    }
    const w = toWorld(z);
    const f = fold(state.T, w[0], w[1]);
    live = { kind: state.tool === 'geodesic' ? 'geodesic' : 'free', world: [w], foldIso: f.fold, parity: f.parity, color: state.color, width: hyperbolicWidth(state.widthPx, z, frame.R) };
    lastScreen = [ev.clientX, ev.clientY];
    renderOverlay();
  });

  overlay.addEventListener('pointermove', (ev) => {
    const z = toDisk(ev);
    cursorOut.textContent = inside(z) ? `${fmt(distanceFromOrigin(z), 2)} from the centre` : 'outside the disk (infinitely far)';
    if (panFrom) {
      if (!inside(z)) return;
      state.view = dragView(state.view, panFrom, z);
      panFrom = z;
      doRebase();
      requestRender();
      return;
    }
    if (!live) return;
    if (!inside(z)) return;
    if (live.kind === 'geodesic') {
      live.world[1] = toWorld(z);
      renderOverlay();
      return;
    }
    const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
    for (const e of events.length ? events : [ev]) {
      const ze = toDisk(e);
      if (!inside(ze) || !lastScreen) continue;
      if (Math.hypot(e.clientX - lastScreen[0], e.clientY - lastScreen[1]) < 1.5) continue;
      lastScreen = [e.clientX, e.clientY];
      live.world.push(toWorld(ze));
      drawLiveSegment();
    }
  });

  const finish = () => {
    if (panFrom) {
      panFrom = null;
      lowDetail = false;
      requestRender();
      return;
    }
    if (!live) return;
    const pts = live.kind === 'geodesic' ? [live.world[0], live.world[live.world.length - 1]] : live.world;
    const stroke = makeStroke(state.T, live.kind, pts, live.color, live.width);
    live = null;
    // A geodesic needs two distinct ends.
    if (stroke.kind === 'geodesic' && (pts.length < 2 || distance(pts[0], pts[1]) < 1e-4)) {
      renderOverlay();
      return;
    }
    state.doc.strokes.push(stroke);
    state.redo = [];
    commitDoc();
  };
  overlay.addEventListener('pointerup', finish);
  overlay.addEventListener('pointercancel', finish);
  overlay.addEventListener('pointerleave', () => (cursorOut.textContent = '–'));
  overlay.addEventListener('contextmenu', (ev) => ev.preventDefault());
  overlay.addEventListener('dblclick', (ev) => {
    const z = toDisk(ev);
    if (!inside(z) || state.tool === 'measure') return;
    // The double click also left a dot stroke from each click; drop them.
    if (state.tool === 'free') {
      for (let i = 0; i < 2 && state.doc.strokes.at(-1)?.points.length === 1; i++) state.doc.strokes.pop();
      commitDoc();
    }
    animateTo(z);
  });

  stage.addEventListener('keydown', (ev) => {
    const step = 0.08;
    const moves: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[ev.key]) {
      ev.preventDefault();
      state.view = dragView(state.view, [0, 0], moves[ev.key]);
      doRebase();
      requestRender();
    } else if (ev.key === '0') {
      state.view = IDENTITY;
      state.measure = [];
      updateMeasureText();
      requestRender();
    }
  });
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      const target = ev.target as HTMLElement;
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    }
  });

  // ---------- export ----------
  function downloadSvg(): void {
    const size = 1200;
    const R = size / 2 - 4;
    const t = generateTiles(state.T, state.view, { maxDepth: state.depth, minSize: 1.5 / R, maxTiles: 60000 });
    const svg = exportSvg(state.doc, state.T, t, { size, background: cssVar('--bg'), disk: cssVar('--disk'), rim: cssVar('--rim'), style: tileStyle() });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = h('a', { href: url, download: `poincare-paint-${state.doc.p}-${state.doc.q}.svg` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Exported an SVG with ${t.length.toLocaleString()} triangles.`;
  }

  async function copyLink(): Promise<void> {
    const code = encodeShare(state.doc, state.view);
    const url = `${location.origin}${location.pathname}#d=${code}`;
    history.replaceState(null, '', `#d=${code}`);
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = `Share link copied (${url.length.toLocaleString()} characters). It holds the whole drawing; nothing is uploaded.`;
    } catch {
      status.textContent = 'Clipboard unavailable: the link is now in the address bar.';
    }
  }

  // ---------- go ----------
  syncControls();
  updateFacts();
  updateMeasureText();
  new ResizeObserver(() => resize()).observe(stage);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestRender());
  resize();
}
