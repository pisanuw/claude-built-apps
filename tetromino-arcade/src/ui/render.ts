// Canvas drawing for boards and piece previews, plus particle effects.

import { cellsOf, HEIGHT, TOP, VISIBLE, WIDTH, type Piece } from '../core/board';
import type { Game } from '../core/game';
import { pieceCells, PIECE_ID, type PieceType } from '../core/pieces';
import type { Theme } from '../core/storage';

/** Buffer rows drawn above the visible field so spawning pieces show. */
export const BUFFER_SHOWN = 2;

const PALETTES: Record<Theme, string[]> = {
  //         I          O          T          S          Z          J          L          garbage
  classic: ['#22c5d8', '#f2c42c', '#a24fd6', '#4cc04a', '#e5434b', '#3a6ee8', '#f08a24', '#7d8594'],
  neon: ['#00f0ff', '#fff200', '#ff3df5', '#39ff14', '#ff2e4d', '#3d7bff', '#ff9f1c', '#5c6272'],
  pastel: ['#8fd9e8', '#f7df8a', '#c9a3e6', '#a8dfa0', '#f2a0a6', '#9fb8f2', '#f6c18f', '#b5bac4'],
  mono: ['#e8e8e8', '#d0d0d0', '#b8b8b8', '#a0a0a0', '#888888', '#707070', '#5a5a5a', '#3f3f3f'],
};

export function colorFor(theme: Theme, id: number): string {
  return PALETTES[theme][id - 1] ?? '#888';
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface Popup {
  text: string;
  sub: string;
  life: number;
}

export interface BoardView {
  ghost: boolean;
  grid: boolean;
  hint: Piece | null;
  theme: Theme;
  /** Rows (board indices) flashing after a clear, with remaining frames. */
  flash: { rows: number[]; life: number } | null;
  particles: Particle[];
  popup: Popup | null;
  shake: number;
  dim: boolean;
}

export function newView(theme: Theme): BoardView {
  return { ghost: true, grid: true, hint: null, theme, flash: null, particles: [], popup: null, shake: 0, dim: false };
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, s, s);
  // Bevel: light top-left, dark bottom-right.
  const b = Math.max(1, Math.round(s / 8));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x, y, s, b);
  ctx.fillRect(x, y, b, s);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x, y + s - b, s, b);
  ctx.fillRect(x + s - b, y, b, s);
  ctx.globalAlpha = 1;
}

/** Fit a canvas to its CSS size at device pixel ratio; returns CSS width/height. */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

/** Cell size so the board (plus buffer rows) fits the canvas. */
export function cellSize(w: number, h: number): number {
  return Math.max(4, Math.floor(Math.min((w - 12) / WIDTH, (h - 3) / (VISIBLE + BUFFER_SHOWN))));
}

export function drawBoard(canvas: HTMLCanvasElement, game: Game, view: BoardView, pending = 0): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const s = cellSize(w, h);
  const bw = s * WIDTH;
  const ox = Math.floor((w - bw) / 2) + (view.shake ? (Math.random() - 0.5) * view.shake : 0);
  const oy = Math.floor(h - 2 - s * (VISIBLE + BUFFER_SHOWN)) + (view.shake ? (Math.random() - 0.5) * view.shake : 0);
  const firstRow = TOP - BUFFER_SHOWN;
  const yOf = (row: number) => oy + (row - firstRow) * s;

  // Field background and grid.
  const css = getComputedStyle(canvas);
  ctx.fillStyle = css.getPropertyValue('--field').trim() || '#0d1117';
  ctx.fillRect(ox, yOf(TOP), bw, s * VISIBLE);
  if (view.grid) {
    ctx.strokeStyle = css.getPropertyValue('--gridline').trim() || 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < WIDTH; x++) {
      ctx.moveTo(ox + x * s + 0.5, yOf(TOP));
      ctx.lineTo(ox + x * s + 0.5, yOf(HEIGHT));
    }
    for (let y = TOP + 1; y < HEIGHT; y++) {
      ctx.moveTo(ox, yOf(y) + 0.5);
      ctx.lineTo(ox + bw, yOf(y) + 0.5);
    }
    ctx.stroke();
  }

  // Locked cells.
  for (let y = firstRow; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = game.grid[y][x];
      if (v) drawCell(ctx, ox + x * s, yOf(y), s, colorFor(view.theme, v), view.dim ? 0.45 : 1);
    }
  }

  // Line clear flash.
  if (view.flash) {
    ctx.fillStyle = `rgba(255,255,255,${(view.flash.life / 12) * 0.8})`;
    for (const r of view.flash.rows) ctx.fillRect(ox, yOf(r), bw, s);
  }

  const a = game.active;
  if (a && !game.over) {
    const color = colorFor(view.theme, PIECE_ID[a.type]);
    if (view.hint) {
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      for (const c of cellsOf(view.hint)) {
        if (c.y >= firstRow) ctx.strokeRect(ox + c.x * s + 2, yOf(c.y) + 2, s - 4, s - 4);
      }
      ctx.setLineDash([]);
    }
    if (view.ghost) {
      const g = game.ghost();
      if (g) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const c of cellsOf(g)) {
          if (c.y < firstRow) continue;
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = color;
          ctx.fillRect(ox + c.x * s, yOf(c.y), s, s);
          ctx.globalAlpha = 0.7;
          ctx.strokeRect(ox + c.x * s + 1, yOf(c.y) + 1, s - 2, s - 2);
          ctx.globalAlpha = 1;
        }
      }
    }
    for (const c of cellsOf(a)) {
      if (c.y >= firstRow) drawCell(ctx, ox + c.x * s, yOf(c.y), s, color);
    }
  }

  // Border and the line separating the buffer.
  ctx.strokeStyle = css.getPropertyValue('--board-frame').trim() || '#3b4766';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox - 1, yOf(TOP) - 1, bw + 2, s * VISIBLE + 2);

  // Incoming garbage meter on the left edge.
  if (pending > 0) {
    const mh = Math.min(VISIBLE, pending) * s;
    ctx.fillStyle = '#e5434b';
    ctx.fillRect(ox - 7, yOf(HEIGHT) - mh, 4, mh);
  }

  // Particles (board-relative cell coordinates).
  for (const p of view.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 40);
    ctx.fillStyle = p.color;
    ctx.fillRect(ox + p.x * s, yOf(p.y), Math.max(2, s / 5), Math.max(2, s / 5));
  }
  ctx.globalAlpha = 1;

  if (view.popup) {
    const alpha = Math.min(1, view.popup.life / 20);
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    const cy = yOf(TOP + 7) - (60 - view.popup.life) * 0.4;
    const fs = Math.max(12, Math.round(s * 0.75));
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    wrapText(ctx, view.popup.text, ox + bw / 2, cy, bw - 8, fs * 1.15);
    if (view.popup.sub) {
      ctx.font = `700 ${Math.round(fs * 0.7)}px system-ui, sans-serif`;
      ctx.strokeText(view.popup.sub, ox + bw / 2, cy + fs * 2.4);
      ctx.fillText(view.popup.sub, ox + bw / 2, cy + fs * 2.4);
    }
    ctx.globalAlpha = 1;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  const parts = text.split(' · ');
  let line = 0;
  for (const part of parts) {
    ctx.strokeText(part, x, y + line * lh, maxW);
    ctx.fillText(part, x, y + line * lh, maxW);
    line++;
  }
}

/** Draw a single piece centred in a small canvas (hold / next). */
export function drawPreview(canvas: HTMLCanvasElement, type: PieceType | null, theme: Theme, dim = false): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!type) return;
  const cells = pieceCells(type, 0);
  const minX = Math.min(...cells.map((c) => c.x));
  const maxX = Math.max(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const maxY = Math.max(...cells.map((c) => c.y));
  const s = Math.floor(Math.min(w / 4.5, h / 2.5));
  const pw = (maxX - minX + 1) * s;
  const ph = (maxY - minY + 1) * s;
  const ox = (w - pw) / 2;
  const oy = (h - ph) / 2;
  for (const c of cells) {
    drawCell(ctx, ox + (c.x - minX) * s, oy + (c.y - minY) * s, s, colorFor(theme, PIECE_ID[type]), dim ? 0.35 : 1);
  }
}

/** Spawn burst particles for cleared rows. */
export function burst(view: BoardView, rows: number[], intensity: number): void {
  const colors = PALETTES[view.theme];
  for (const r of rows) {
    for (let i = 0; i < 6 * intensity; i++) {
      view.particles.push({
        x: Math.random() * WIDTH,
        y: r + Math.random(),
        vx: (Math.random() - 0.5) * 0.5,
        vy: -Math.random() * 0.45,
        life: 30 + Math.random() * 20,
        color: colors[Math.floor(Math.random() * 7)],
      });
    }
  }
}

/** Advance effects by one frame. */
export function ageView(view: BoardView): void {
  for (const p of view.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.02;
    p.life--;
  }
  view.particles = view.particles.filter((p) => p.life > 0);
  if (view.flash && --view.flash.life <= 0) view.flash = null;
  if (view.popup && --view.popup.life <= 0) view.popup = null;
  if (view.shake > 0) view.shake = Math.max(0, view.shake - 0.6);
}
