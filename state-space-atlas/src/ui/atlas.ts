import type { StateGraph } from '../core/enumerate';
import { SpatialIndex, type Layout } from '../core/layout';
import { EXPANDED, FRONTIER, ON_PATH } from '../core/search';

export type ColorMode = 'toGoal' | 'fromStart' | 'heuristic' | 'hError';

export interface AtlasCallbacks {
  onHover(node: number, clientX: number, clientY: number): void;
  onClick(node: number): void;
}

interface View {
  zoom: number;
  /** Pan offset in CSS pixels. */
  ox: number;
  oy: number;
}

const EDGE_LIMIT = 150_000;
const PAD = 24;

/**
 * Canvas renderer for the state graph. Edges are drawn once per view into an
 * offscreen canvas (and skipped entirely above EDGE_LIMIT edges unless zoomed
 * in); nodes are redrawn every frame so the search animation stays cheap.
 */
export class AtlasView {
  private readonly ctx: CanvasRenderingContext2D;
  private graph: StateGraph | null = null;
  private layout: Layout | null = null;
  private index: SpatialIndex | null = null;
  private view: View = { zoom: 1, ox: 0, oy: 0 };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private edgeCache: HTMLCanvasElement | null = null;
  private edgeCacheView: View | null = null;
  private edgeDirty = true;
  private status: Uint8Array | null = null;
  private current = -1;
  private highlights: Set<number> | null = null;
  private selected = -1;
  private colorMode: ColorMode = 'toGoal';
  private hValues: Float64Array | null = null;
  private showEdges = true;
  private frame = 0;
  private dragging: { x: number; y: number; moved: boolean } | null = null;
  private colorCache: string[] = [];
  private colorCacheKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: AtlasCallbacks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.attach();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
  }

  setGraph(graph: StateGraph | null, layout: Layout | null): void {
    this.graph = graph;
    this.layout = layout;
    this.index = layout ? new SpatialIndex(layout) : null;
    this.status = null;
    this.current = -1;
    this.highlights = null;
    this.selected = -1;
    this.hValues = null;
    this.colorCacheKey = '';
    this.fit();
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
    this.index = new SpatialIndex(layout);
    this.edgeDirty = true;
    this.colorCacheKey = '';
    this.requestRender();
  }

  setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    this.requestRender();
  }

  setHeuristicValues(values: Float64Array | null): void {
    this.hValues = values;
    this.colorCacheKey = '';
    this.requestRender();
  }

  setSearch(status: Uint8Array | null, current: number): void {
    this.status = status;
    this.current = current;
    this.requestRender();
  }

  setHighlights(nodes: number[] | null): void {
    this.highlights = nodes ? new Set(nodes) : null;
    this.requestRender();
  }

  setSelected(node: number): void {
    this.selected = node;
    this.requestRender();
  }

  setShowEdges(show: boolean): void {
    this.showEdges = show;
    this.requestRender();
  }

  fit(): void {
    this.view = { zoom: 1, ox: 0, oy: 0 };
    this.edgeDirty = true;
    this.requestRender();
  }

  zoomBy(factor: number, cx = this.width / 2, cy = this.height / 2): void {
    const z = Math.min(400, Math.max(1, this.view.zoom * factor));
    const f = z / this.view.zoom;
    this.view = { zoom: z, ox: cx - (cx - this.view.ox) * f, oy: cy - (cy - this.view.oy) * f };
    this.edgeDirty = true;
    this.requestRender();
  }

  /** Centre the view on a node at the current zoom. */
  centerOn(node: number): void {
    if (!this.layout) return;
    const [sx, sy] = this.scale();
    const px = PAD + this.layout.x[node] * sx;
    const py = PAD + this.layout.y[node] * sy;
    this.view = { ...this.view, ox: this.width / 2 - px, oy: this.height / 2 - py };
    this.edgeDirty = true;
    this.requestRender();
  }

  get zoom(): number {
    return this.view.zoom;
  }

  /** Draws now, in the colours in place now (print cannot wait for the next frame). */
  renderNow(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.render();
  }

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Pixels per layout unit along each axis (before pan). */
  private scale(): [number, number] {
    const w = Math.max(1, this.width - 2 * PAD) * this.view.zoom;
    const h = Math.max(1, this.height - 2 * PAD) * this.view.zoom;
    return [w, h];
  }

  private toScreen(i: number): [number, number] {
    const [sx, sy] = this.scale();
    return [PAD + this.layout!.x[i] * sx + this.view.ox, PAD + this.layout!.y[i] * sy + this.view.oy];
  }

  private resize(): void {
    const parent = this.canvas.parentElement!;
    const rect = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(100, Math.floor(rect.width));
    this.height = Math.max(100, Math.floor(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.edgeDirty = true;
    this.requestRender();
  }

  private nodeSize(): number {
    if (!this.graph) return 2;
    const n = this.graph.keys.length;
    const base = n > 100_000 ? 1.6 : n > 20_000 ? 2.2 : n > 2000 ? 3 : n > 300 ? 4.5 : 7;
    return Math.min(14, base * Math.sqrt(this.view.zoom));
  }

  private palette(): { bg: string; edge: string; faint: string; frontier: string; expanded: string; path: string; text: string; dead: string } {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    return {
      bg: v('--atlas-bg', '#0f1623'),
      edge: v('--atlas-edge', 'rgba(140,160,190,0.22)'),
      faint: v('--atlas-faint', 'rgba(140,160,190,0.35)'),
      frontier: v('--c-frontier', '#f2a93b'),
      expanded: v('--c-expanded', '#4c8dff'),
      path: v('--c-path', '#ff4d6d'),
      text: v('--atlas-text', '#e5e7eb'),
      dead: v('--c-dead', '#6b7280'),
    };
  }

  /** Base colour per node for the current colour mode (cached per graph/mode). */
  private baseColors(): string[] {
    const g = this.graph!;
    const key = `${this.colorMode}:${g.keys.length}:${g.start}:${this.hValues ? 'h' : '-'}`;
    if (key === this.colorCacheKey) return this.colorCache;
    const n = g.keys.length;
    const out = new Array<string>(n);
    const dead = this.palette().dead;
    if (this.colorMode === 'toGoal' || this.colorMode === 'fromStart') {
      const arr = this.colorMode === 'toGoal' ? g.distToGoal : g.distFromStart;
      const max = Math.max(1, this.colorMode === 'toGoal' ? g.maxDistToGoal : g.depth);
      for (let i = 0; i < n; i++) out[i] = arr[i] < 0 ? dead : ramp(1 - arr[i] / max);
    } else if (this.colorMode === 'heuristic') {
      const max = Math.max(1, g.maxDistToGoal);
      for (let i = 0; i < n; i++) {
        const h = this.hValues ? this.hValues[i] : 0;
        out[i] = Number.isNaN(h) ? dead : ramp(1 - Math.min(1, h / max));
      }
    } else {
      for (let i = 0; i < n; i++) {
        const h = this.hValues ? this.hValues[i] : 0;
        const d = g.distToGoal[i];
        if (Number.isNaN(h) || d < 0) out[i] = dead;
        else if (h > d + 1e-9) out[i] = `hsl(${Math.max(0, 20 - (h - d) * 4)} 90% 55%)`; // red, deeper with the error
        else if (h >= d - 1e-9) out[i] = '#2bb673';
        else out[i] = `hsl(215 70% ${Math.round(70 - 40 * (h / Math.max(1, d)))}%)`; // blue: lighter when weaker
      }
    }
    this.colorCache = out;
    this.colorCacheKey = key;
    return out;
  }

  private render(): void {
    const ctx = this.ctx;
    const pal = this.palette();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.graph || !this.layout) {
      ctx.fillStyle = pal.text;
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a puzzle and press Build atlas', this.width / 2, this.height / 2);
      return;
    }
    const g = this.graph;
    const n = g.keys.length;

    if (this.showEdges && (g.edgeCount <= EDGE_LIMIT || this.view.zoom >= 4)) {
      this.drawEdges(pal.edge);
    }

    const size = this.nodeSize();
    const half = size / 2;
    const colors = this.baseColors();
    const searching = this.status !== null;
    const [sx, sy] = this.scale();
    const ox = PAD + this.view.ox;
    const oy = PAD + this.view.oy;
    const xs = this.layout.x;
    const ys = this.layout.y;

    // Pass 1: untouched nodes (faint while a search runs).
    ctx.globalAlpha = searching ? 0.28 : 1;
    for (let i = 0; i < n; i++) {
      if (searching && this.status![i] !== 0) continue;
      const px = ox + xs[i] * sx;
      const py = oy + ys[i] * sy;
      if (px < -size || py < -size || px > this.width + size || py > this.height + size) continue;
      ctx.fillStyle = colors[i];
      ctx.fillRect(px - half, py - half, size, size);
    }
    ctx.globalAlpha = 1;

    // Pass 2: search overlay.
    if (searching) {
      const st = this.status!;
      const draw = (code: number, color: string, grow: number) => {
        ctx.fillStyle = color;
        const s = size + grow;
        const h = s / 2;
        for (let i = 0; i < n; i++) {
          if (st[i] !== code) continue;
          const px = ox + xs[i] * sx;
          const py = oy + ys[i] * sy;
          if (px < -s || py < -s || px > this.width + s || py > this.height + s) continue;
          ctx.fillRect(px - h, py - h, s, s);
        }
      };
      draw(EXPANDED, pal.expanded, 0);
      draw(FRONTIER, pal.frontier, 0.5);
      draw(ON_PATH, pal.path, 1.5);
      if (this.current >= 0) {
        const [px, py] = this.toScreen(this.current);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(6, size), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Highlights (heuristic violations).
    if (this.highlights) {
      ctx.strokeStyle = pal.path;
      ctx.lineWidth = 1.5;
      for (const i of this.highlights) {
        const [px, py] = this.toScreen(i);
        if (px < -10 || py < -10 || px > this.width + 10 || py > this.height + 10) continue;
        ctx.strokeRect(px - half - 2, py - half - 2, size + 4, size + 4);
      }
    }

    // Goal markers and start marker.
    ctx.strokeStyle = '#2bb673';
    ctx.lineWidth = 1.5;
    const goalsToDraw = g.goals.length <= 600 ? g.goals : g.goals.subarray(0, 600);
    for (let k = 0; k < goalsToDraw.length; k++) {
      const [px, py] = this.toScreen(goalsToDraw[k]);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(4, half + 2), 0, Math.PI * 2);
      ctx.stroke();
    }
    {
      const [px, py] = this.toScreen(g.start);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(6, half + 4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pal.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('start', px + Math.max(8, half + 6), py + 4);
    }
    if (this.selected >= 0) {
      const [px, py] = this.toScreen(this.selected);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(px - half - 4, py - half - 4, size + 8, size + 8);
      ctx.setLineDash([]);
    }
  }

  private drawEdges(color: string): void {
    const cv = this.edgeCacheView;
    const same = cv !== null && !this.edgeDirty && cv.zoom === this.view.zoom && cv.ox === this.view.ox && cv.oy === this.view.oy;
    if (!same) {
      if (this.dragging && this.edgeCache && cv && !this.edgeDirty && cv.zoom === this.view.zoom) {
        // Mid-drag pan: shift the cached bitmap and rebuild once the drag ends.
        this.ctx.drawImage(this.edgeCache, this.view.ox - cv.ox, this.view.oy - cv.oy, this.width, this.height);
        return;
      }
      this.rebuildEdgeCache(color);
    }
    this.ctx.drawImage(this.edgeCache!, 0, 0, this.width, this.height);
  }

  private rebuildEdgeCache(color: string): void {
    const g = this.graph!;
    const cache = this.edgeCache ?? document.createElement('canvas');
    cache.width = this.canvas.width;
    cache.height = this.canvas.height;
    const c = cache.getContext('2d')!;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    c.strokeStyle = color;
    c.lineWidth = this.view.zoom >= 4 ? 1 : 0.6;
    const [sx, sy] = this.scale();
    const ox = PAD + this.view.ox;
    const oy = PAD + this.view.oy;
    const xs = this.layout!.x;
    const ys = this.layout!.y;
    const W = this.width;
    const H = this.height;
    c.beginPath();
    let drawn = 0;
    for (let u = 0; u < g.keys.length; u++) {
      const ux = ox + xs[u] * sx;
      const uy = oy + ys[u] * sy;
      const uIn = ux >= -2 && uy >= -2 && ux <= W + 2 && uy <= H + 2;
      for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
        const v = g.adj[k];
        if (v < u) continue;
        const vx = ox + xs[v] * sx;
        const vy = oy + ys[v] * sy;
        if (!uIn && (vx < -2 || vy < -2 || vx > W + 2 || vy > H + 2)) continue;
        c.moveTo(ux, uy);
        c.lineTo(vx, vy);
        if (++drawn % 20_000 === 0) {
          c.stroke();
          c.beginPath();
        }
      }
    }
    c.stroke();
    this.edgeCache = cache;
    this.edgeCacheView = { ...this.view };
    this.edgeDirty = false;
  }

  private nodeAt(clientX: number, clientY: number): number {
    if (!this.index || !this.layout) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const [sx, sy] = this.scale();
    const lx = (px - PAD - this.view.ox) / sx;
    const ly = (py - PAD - this.view.oy) / sy;
    return this.index.nearest(lx, ly, Math.max(8, this.nodeSize() * 1.5), sx, sy);
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.dragging.x;
        const dy = e.clientY - this.dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragging.moved = true;
        if (this.dragging.moved) {
          this.view = { ...this.view, ox: this.view.ox + dx, oy: this.view.oy + dy };
          this.dragging.x = e.clientX;
          this.dragging.y = e.clientY;
          this.requestRender();
        }
        return;
      }
      this.callbacks.onHover(this.nodeAt(e.clientX, e.clientY), e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      const moved = this.dragging.moved;
      this.dragging = null;
      if (!moved) this.callbacks.onClick(this.nodeAt(e.clientX, e.clientY));
      else this.requestRender(); // rebuild the edge cache at the final position
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => this.callbacks.onHover(-1, 0, 0));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false },
    );
  }
}

/** Blue-to-yellow ramp: t = 0 far (dark blue), t = 1 at the goal (bright yellow). */
export function ramp(t: number): string {
  const k = Math.min(1, Math.max(0, t));
  // Piecewise: navy -> teal -> green -> yellow.
  const stops: Array<[number, [number, number, number]]> = [
    [0, [40, 60, 150]],
    [0.4, [30, 150, 170]],
    [0.75, [90, 200, 110]],
    [1, [250, 225, 70]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (k <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const f = (k - t0) / (t1 - t0);
      const r = Math.round(a[0] + (b[0] - a[0]) * f);
      const g = Math.round(a[1] + (b[1] - a[1]) * f);
      const bl = Math.round(a[2] + (b[2] - a[2]) * f);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return 'rgb(250,225,70)';
}
