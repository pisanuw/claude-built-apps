import { DELTA, type Vec } from '../core/geom';
import { GHOST_IDS, GHOST_META, type GhostId } from '../core/ghosts';
import { type Maze, cellAt } from '../core/maze';
import { SHY_RADIUS } from '../core/rules';
import { astar, bfs } from '../core/search';
import { type GhostState, type Mover, type SimConfig, type SimState, ghost, previewDecision, targetInfo } from '../core/sim';

/** Tiles of margin drawn around the maze so off-maze targets (scatter corners, far Flanker targets) show. */
export const MARGIN = 3;

export interface Palette {
  bg: string;
  wall: string;
  wallEdge: string;
  path: string;
  grid: string;
  door: string;
  house: string;
  tunnel: string;
  ink: string;
  muted: string;
  runner: string;
  fright: string;
  hover: string;
}

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v('--maze-bg'),
    wall: v('--maze-wall'),
    wallEdge: v('--maze-wall-edge'),
    path: v('--maze-path'),
    grid: v('--maze-grid'),
    door: v('--maze-door'),
    house: v('--maze-house'),
    tunnel: v('--maze-tunnel'),
    ink: v('--ink'),
    muted: v('--muted'),
    runner: v('--runner'),
    fright: v('--fright'),
    hover: v('--accent'),
  };
}

export interface View {
  overlay: Record<GhostId, boolean>;
  showCandidates: boolean;
  hover: Vec | null;
  selected: GhostId;
}

export interface Layout {
  tile: number;
  width: number;
  height: number;
}

export function layoutFor(maze: Maze, availableWidth: number, availableHeight: number): Layout {
  const cols = maze.width + MARGIN * 2;
  const rows = maze.height + MARGIN * 2;
  const tile = Math.max(6, Math.floor(Math.min(availableWidth / cols, availableHeight / rows)));
  return { tile, width: cols * tile, height: rows * tile };
}

/** Convert a canvas pixel to a maze tile (may be outside the maze). */
export function pixelToTile(layout: Layout, px: number, py: number): Vec {
  return { x: Math.floor(px / layout.tile) - MARGIN, y: Math.floor(py / layout.tile) - MARGIN };
}

/** Smooth position of a mover in tile units, handling the wrap across a tunnel. */
function moverPos(maze: Maze, m: Mover): { x: number; y: number } {
  let dx = m.next.x - m.tile.x;
  const dy = m.next.y - m.tile.y;
  if (Math.abs(dx) > 1) dx = -Math.sign(dx);
  let x = m.tile.x + dx * m.progress;
  if (x < -0.5) x += maze.width;
  if (x > maze.width - 0.5) x -= maze.width;
  return { x, y: m.tile.y + dy * m.progress };
}

export function drawScene(ctx: CanvasRenderingContext2D, layout: Layout, config: SimConfig, state: SimState, view: View, pal: Palette): void {
  const { maze } = config;
  const T = layout.tile;
  const cx = (x: number) => (x + MARGIN + 0.5) * T;
  const cy = (y: number) => (y + MARGIN + 0.5) * T;
  /** Keep a point inside the drawable area (for far-off targets). */
  const clamp = (v: Vec): { x: number; y: number; clipped: boolean } => {
    const minX = -MARGIN + 0.5;
    const maxX = maze.width + MARGIN - 1.5;
    const minY = -MARGIN + 0.5;
    const maxY = maze.height + MARGIN - 1.5;
    const x = Math.min(maxX, Math.max(minX, v.x));
    const y = Math.min(maxY, Math.max(minY, v.y));
    return { x, y, clipped: x !== v.x || y !== v.y };
  };

  ctx.save();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // Maze cells
  for (let y = 0; y < maze.height; y++)
    for (let x = 0; x < maze.width; x++) {
      const c = cellAt(maze, { x, y });
      const px = (x + MARGIN) * T;
      const py = (y + MARGIN) * T;
      if (c === 'wall') {
        ctx.fillStyle = pal.wall;
        ctx.fillRect(px, py, T, T);
      } else if (c === 'house') {
        ctx.fillStyle = pal.house;
        ctx.fillRect(px, py, T, T);
      } else if (c === 'door') {
        ctx.fillStyle = pal.wall;
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = pal.door;
        ctx.fillRect(px, py + T * 0.4, T, T * 0.2);
      } else {
        ctx.fillStyle = c === 'tunnel' ? pal.tunnel : pal.path;
        ctx.fillRect(px, py, T, T);
      }
    }
  // Wall edges: outline wall cells that touch a walkable cell, for a crisper look.
  ctx.strokeStyle = pal.wallEdge;
  ctx.lineWidth = Math.max(1, T / 10);
  ctx.beginPath();
  for (let y = 0; y < maze.height; y++)
    for (let x = 0; x < maze.width; x++) {
      if (cellAt(maze, { x, y }) !== 'wall') continue;
      const px = (x + MARGIN) * T;
      const py = (y + MARGIN) * T;
      const open = (dx: number, dy: number) => {
        const n = cellAt(maze, { x: x + dx, y: y + dy });
        return n === 'path' || n === 'tunnel';
      };
      if (open(0, -1)) {
        ctx.moveTo(px, py + 0.5);
        ctx.lineTo(px + T, py + 0.5);
      }
      if (open(0, 1)) {
        ctx.moveTo(px, py + T - 0.5);
        ctx.lineTo(px + T, py + T - 0.5);
      }
      if (open(-1, 0)) {
        ctx.moveTo(px + 0.5, py);
        ctx.lineTo(px + 0.5, py + T);
      }
      if (open(1, 0)) {
        ctx.moveTo(px + T - 0.5, py);
        ctx.lineTo(px + T - 0.5, py + T);
      }
    }
  ctx.stroke();

  // Faint grid on walkable tiles helps when counting distances by hand.
  if (T >= 14) {
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y <= maze.height; y++) {
      ctx.moveTo(MARGIN * T, (y + MARGIN) * T + 0.5);
      ctx.lineTo((maze.width + MARGIN) * T, (y + MARGIN) * T + 0.5);
    }
    for (let x = 0; x <= maze.width; x++) {
      ctx.moveTo((x + MARGIN) * T + 0.5, MARGIN * T);
      ctx.lineTo((x + MARGIN) * T + 0.5, (maze.height + MARGIN) * T);
    }
    ctx.stroke();
  }

  // Hover
  if (view.hover) {
    ctx.strokeStyle = pal.hover;
    ctx.lineWidth = 2;
    ctx.strokeRect((view.hover.x + MARGIN) * T + 1, (view.hover.y + MARGIN) * T + 1, T - 2, T - 2);
  }

  // Drive-to goal
  if (state.runner.goal) {
    const g = state.runner.goal;
    ctx.strokeStyle = pal.runner;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect((g.x + MARGIN) * T + 2, (g.y + MARGIN) * T + 2, T - 4, T - 4);
    ctx.setLineDash([]);
  }

  // Overlays under the actors
  for (const id of GHOST_IDS) {
    if (!view.overlay[id]) continue;
    const g = ghost(state, id);
    drawGhostOverlay(ctx, config, state, g, view, pal, { T, cx, cy, clamp });
  }

  // Runner
  const rp = moverPos(maze, state.runner);
  const rx = cx(rp.x);
  const ry = cy(rp.y);
  ctx.fillStyle = pal.runner;
  ctx.beginPath();
  ctx.arc(rx, ry, T * 0.42, 0, Math.PI * 2);
  ctx.fill();
  const f = DELTA[state.runner.facing];
  ctx.fillStyle = pal.bg;
  ctx.beginPath();
  ctx.moveTo(rx + f.x * T * 0.34, ry + f.y * T * 0.34);
  ctx.lineTo(rx - f.y * T * 0.16, ry + f.x * T * 0.16);
  ctx.lineTo(rx + f.y * T * 0.16, ry - f.x * T * 0.16);
  ctx.closePath();
  ctx.fill();
  if (state.grace > 0 && Math.floor(state.tick / 6) % 2 === 0) {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, T * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ghosts
  for (const g of state.ghosts) {
    if (g.status === 'house' && g.releaseTick === Infinity) continue;
    if (g.status === 'house' && cellAt(maze, g.tile) !== 'house') continue;
    const p = moverPos(maze, g);
    drawGhost(ctx, cx(p.x), cy(p.y), T, g, state, pal, view.selected === g.id);
  }

  // Capture marker
  if (state.over && state.capture) {
    const c = state.capture.tile;
    ctx.strokeStyle = GHOST_META[state.capture.ghost].color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx(c.x), cy(c.y), T * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

interface Geo {
  T: number;
  cx: (x: number) => number;
  cy: (y: number) => number;
  clamp: (v: Vec) => { x: number; y: number; clipped: boolean };
}

function drawTargetMark(ctx: CanvasRenderingContext2D, geo: Geo, v: Vec, color: string, faded: boolean, label?: string): void {
  const { T, cx, cy, clamp } = geo;
  const c = clamp(v);
  const x = cx(c.x);
  const y = cy(c.y);
  ctx.save();
  ctx.globalAlpha = faded ? 0.45 : 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = faded ? 1.5 : 2.5;
  if (faded) ctx.setLineDash([3, 3]);
  ctx.strokeRect(x - T * 0.45, y - T * 0.45, T * 0.9, T * 0.9);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x - T * 0.3, y - T * 0.3);
  ctx.lineTo(x + T * 0.3, y + T * 0.3);
  ctx.moveTo(x + T * 0.3, y - T * 0.3);
  ctx.lineTo(x - T * 0.3, y + T * 0.3);
  ctx.stroke();
  if (c.clipped || label) {
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(9, Math.round(T * 0.55))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label ?? `(${v.x}, ${v.y})`, x, y - T * 0.5);
  }
  ctx.restore();
}

function drawGhostOverlay(ctx: CanvasRenderingContext2D, config: SimConfig, state: SimState, g: GhostState, view: View, pal: Palette, geo: Geo): void {
  const { maze } = config;
  const { T, cx, cy, clamp } = geo;
  if (g.status === 'house') return;
  const meta = GHOST_META[g.id];
  const info = targetInfo(config, state, g);
  const p = moverPos(maze, g);

  if (info) {
    // Shy's eight-tile circle
    if (g.id === 'shy' && config.strategies.shy === 'arcade' && info.shyChasing !== undefined) {
      ctx.save();
      ctx.strokeStyle = meta.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(info.shyChasing ? [6, 4] : []);
      ctx.beginPath();
      ctx.arc(cx(p.x), cy(p.y), SHY_RADIUS * T, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Flanker's construction: Chaser → pivot → target
    if (info.pivot) {
      const ch = ghost(state, 'chaser');
      const cp = moverPos(maze, ch);
      const pv = clamp(info.pivot);
      const tg = clamp(info.target);
      ctx.save();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(cx(cp.x), cy(cp.y));
      ctx.lineTo(cx(pv.x), cy(pv.y));
      ctx.lineTo(cx(tg.x), cy(tg.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.arc(cx(pv.x), cy(pv.y), T * 0.2, 0, Math.PI * 2);
      ctx.fill();
      if (info.intendedPivot) {
        const ip = clamp(info.intendedPivot);
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(cx(ip.x), cy(ip.y), T * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // Line from ghost to its target
    const tg = clamp(info.target);
    ctx.save();
    ctx.strokeStyle = meta.color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cx(p.x), cy(p.y));
    ctx.lineTo(cx(tg.x), cy(tg.y));
    ctx.stroke();
    ctx.restore();
    if (info.intended) drawTargetMark(ctx, geo, info.intended, meta.color, true, 'intended');
    drawTargetMark(ctx, geo, info.target, meta.color, false);
  }

  if (!view.showCandidates) return;
  const d = previewDecision(config, state, g);
  if (!d) return;
  // Path ghosts: draw the path they intend to walk.
  if (d.path) {
    const full = d.reason === 'path' ? pathFrom(config, d.at, d.path.goal, d.path.kind) : [];
    ctx.save();
    ctx.strokeStyle = meta.color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, T * 0.18);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx(d.at.x), cy(d.at.y));
    let prev = d.at;
    for (const t of full) {
      if (Math.abs(t.x - prev.x) > 1) ctx.moveTo(cx(t.x), cy(t.y));
      else ctx.lineTo(cx(t.x), cy(t.y));
      prev = t;
    }
    ctx.stroke();
    ctx.restore();
  }
  const fs = Math.max(8, Math.round(T * 0.42));
  for (const c of d.candidates) {
    if (c.excluded === 'wall') continue;
    const x = cx(c.tile.x);
    const y = cy(c.tile.y);
    const chosen = c.dir === d.chosen;
    ctx.save();
    ctx.fillStyle = chosen ? meta.color : pal.bg;
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = chosen ? 2 : 1;
    ctx.globalAlpha = c.excluded ? 0.6 : 0.95;
    roundRect(ctx, x - T * 0.48, y - T * 0.3, T * 0.96, T * 0.6, T * 0.12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = chosen ? '#fff' : pal.ink;
    ctx.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = c.excluded === 'reverse' ? '×' : c.dist2 === null ? '?' : String(c.dist2);
    ctx.fillText(text, x, y + 0.5, T * 0.92);
    ctx.restore();
  }
  // Highlight the decision tile
  ctx.save();
  ctx.strokeStyle = meta.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(cx(d.at.x) - T / 2 + 1, cy(d.at.y) - T / 2 + 1, T - 2, T - 2);
  ctx.restore();
}

/** Recompute a full path for drawing (the decision only stores its length). */
function pathFrom(config: SimConfig, from: Vec, goal: Vec, kind: 'bfs' | 'astar'): Vec[] {
  return (kind === 'bfs' ? bfs(config.maze, from, goal) : astar(config.maze, from, goal)).path;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, T: number, g: GhostState, state: SimState, pal: Palette, selected: boolean): void {
  const meta = GHOST_META[g.id];
  const s = T * 0.86;
  ctx.save();
  if (g.status === 'eyes') {
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;
    roundRect(ctx, x - s / 2, y - s / 2, s, s, s * 0.3);
    ctx.stroke();
  } else {
    const flashing = g.frightened && state.frightRemaining < 120 && Math.floor(state.frightRemaining / 10) % 2 === 0;
    ctx.fillStyle = g.frightened ? (flashing ? pal.bg : pal.fright) : meta.color;
    ctx.globalAlpha = g.status === 'house' ? 0.55 : 1;
    roundRect(ctx, x - s / 2, y - s / 2, s, s, s * 0.3);
    ctx.fill();
    if (g.frightened) {
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 2;
    roundRect(ctx, x - s / 2 - 3, y - s / 2 - 3, s + 6, s + 6, s * 0.35);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = g.status === 'eyes' ? meta.color : g.frightened ? meta.color : '#fff';
  ctx.font = `700 ${Math.max(8, Math.round(T * 0.55))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.letter, x, y + 1);
  // heading tick
  const dlt = DELTA[g.dir];
  ctx.strokeStyle = g.status === 'eyes' ? meta.color : pal.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + dlt.x * s * 0.5, y + dlt.y * s * 0.5);
  ctx.lineTo(x + dlt.x * s * 0.72, y + dlt.y * s * 0.72);
  ctx.stroke();
  ctx.restore();
}

