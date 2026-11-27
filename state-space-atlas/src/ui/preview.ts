import type { BlocksState } from '../core/blocks';
import type { HanoiState } from '../core/hanoi';
import type { TilesState } from '../core/tiles';

export const PIECE_COLORS = ['#4c8dff', '#2bb673', '#f2a93b', '#b06cf5', '#1fb6c9', '#ff7eb6', '#9aa5b1', '#c8a24a'];
export const GOAL_PIECE_COLOR = '#e5484d';

/** Draw a puzzle state into a canvas, filling it. */
export function drawState(canvas: HTMLCanvasElement, kind: 'hanoi' | 'tiles' | 'blocks', state: unknown, size: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const styles = getComputedStyle(document.documentElement);
  const colors = {
    bg: styles.getPropertyValue('--preview-bg').trim() || '#f3f4f6',
    line: styles.getPropertyValue('--preview-line').trim() || '#9aa5b1',
    text: styles.getPropertyValue('--text').trim() || '#111',
    tile: styles.getPropertyValue('--preview-tile').trim() || '#ffffff',
    home: styles.getPropertyValue('--preview-home').trim() || '#2bb673',
    homeText: styles.getPropertyValue('--preview-home-text').trim() || '#0b1017',
  };
  switch (kind) {
    case 'tiles':
      drawTiles(ctx, state as TilesState, size, colors);
      break;
    case 'hanoi':
      drawHanoi(ctx, state as HanoiState, size, colors);
      break;
    case 'blocks':
      drawBlocks(ctx, state as BlocksState, size, colors);
      break;
  }
}

type Colors = { bg: string; line: string; text: string; tile: string; home: string; homeText: string };

function drawTiles(ctx: CanvasRenderingContext2D, s: TilesState, size: number, colors: Colors): void {
  const cell = Math.floor((size - 4) / Math.max(s.rows, s.cols));
  const w = cell * s.cols;
  const h = cell * s.rows;
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(ox - 2, oy - 2, w + 4, h + 4);
  ctx.font = `${Math.max(9, cell * 0.5)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const t = s.tiles[r][c];
      const x = ox + c * cell;
      const y = oy + r * cell;
      if (t === 0) continue;
      const home = s.goalRow[t] === r && s.goalCol[t] === c;
      ctx.fillStyle = home ? colors.home : colors.tile;
      roundRect(ctx, x + 1.5, y + 1.5, cell - 3, cell - 3, 3);
      ctx.fill();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = home ? colors.homeText : colors.text;
      ctx.fillText(String(t), x + cell / 2, y + cell / 2 + 0.5);
    }
  }
}

function drawHanoi(ctx: CanvasRenderingContext2D, s: HanoiState, size: number, colors: Colors): void {
  const pegW = size / s.pegs;
  const baseY = size - 6;
  const diskH = Math.min(10, Math.floor((size - 16) / (s.disks + 1)));
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colors.line;
  ctx.fillRect(2, baseY, size - 4, 3);
  for (let p = 0; p < s.pegs; p++) {
    const cx = pegW * p + pegW / 2;
    ctx.fillStyle = p === s.pegs - 1 ? colors.home : colors.line;
    ctx.fillRect(cx - 1.5, 8, 3, baseY - 8);
    const stack = s.stacks[p];
    for (let k = 0; k < stack.length; k++) {
      const d = stack[k];
      const w = (pegW - 6) * ((d + 1.5) / (s.disks + 0.5));
      ctx.fillStyle = PIECE_COLORS[d % PIECE_COLORS.length];
      roundRect(ctx, cx - w / 2, baseY - (k + 1) * diskH, w, diskH - 1.5, 2);
      ctx.fill();
    }
  }
}

function drawBlocks(ctx: CanvasRenderingContext2D, s: BlocksState, size: number, colors: Colors): void {
  const cell = Math.floor((size - 4) / Math.max(s.rows, s.cols));
  const w = cell * s.cols;
  const h = cell * s.rows;
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(ox - 2, oy - 2, w + 4, h + 4);
  // Walls and the goal footprint.
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      if (s.cells[r][c] === '#') {
        ctx.fillStyle = colors.line;
        ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
  }
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = GOAL_PIECE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + s.goal.col * cell + 2, oy + s.goal.row * cell + 2, s.goalPiece.w * cell - 4, s.goalPiece.h * cell - 4);
  ctx.setLineDash([]);
  // Pieces, coloured by shape letter so identical pieces look identical.
  const shapeIndex = new Map<string, number>();
  for (const pc of s.pieces) {
    if (!pc.goal && !shapeIndex.has(pc.shape)) shapeIndex.set(pc.shape, shapeIndex.size);
  }
  for (const pc of s.pieces) {
    ctx.fillStyle = pc.goal ? GOAL_PIECE_COLOR : PIECE_COLORS[shapeIndex.get(pc.shape)! % PIECE_COLORS.length];
    roundRect(ctx, ox + pc.col * cell + 1.5, oy + pc.row * cell + 1.5, pc.w * cell - 3, pc.h * cell - 3, 3);
    ctx.fill();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
