import { useEffect, useRef, useState, useCallback } from 'react';
import { EMPTY, WALL, MUD, idx } from '../engine/grid.js';
import { readPalette } from './palette.js';

// Renders the map plus the current search state on a <canvas>, and handles
// map editing: paint walls or mud, erase, and drag the start and goal pins.

export default function GridCanvas({
  grid, view, tool, showCosts, editable = true,
  onSetCell, onSetStart, onSetGoal, label,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [cell, setCell] = useState(20);
  const [hover, setHover] = useState(null);
  const dragRef = useRef(null);
  const drawRef = useRef(null);

  // Fit the cell size to the wrapper width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const size = Math.max(10, Math.min(34, Math.floor(w / grid.cols)));
      setCell(size);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid.cols]);

  const cellFromEvent = useCallback((ev) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const c = Math.floor((ev.clientX - rect.left) / cell);
    const r = Math.floor((ev.clientY - rect.top) / cell);
    if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return null;
    return { r, c };
  }, [cell, grid.rows, grid.cols]);

  const applyPaint = useCallback((r, c) => {
    const d = dragRef.current;
    if (!d) return;
    if ((r === grid.start.r && c === grid.start.c) || (r === grid.goal.r && c === grid.goal.c)) return;
    if (grid.cells[idx(grid, r, c)] !== d.value) onSetCell(r, c, d.value);
  }, [grid, onSetCell]);

  // Walk the line between two cells so fast drags leave no gaps.
  const paintLine = useCallback((from, to) => {
    const steps = Math.max(Math.abs(to.r - from.r), Math.abs(to.c - from.c));
    for (let i = 1; i <= steps; i++) {
      const r = Math.round(from.r + ((to.r - from.r) * i) / steps);
      const c = Math.round(from.c + ((to.c - from.c) * i) / steps);
      applyPaint(r, c);
    }
  }, [applyPaint]);

  const onPointerDown = (ev) => {
    if (!editable) return;
    const at = cellFromEvent(ev);
    if (!at) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    if (at.r === grid.start.r && at.c === grid.start.c) {
      dragRef.current = { mode: 'start' };
      return;
    }
    if (at.r === grid.goal.r && at.c === grid.goal.c) {
      dragRef.current = { mode: 'goal' };
      return;
    }
    const here = grid.cells[idx(grid, at.r, at.c)];
    let value;
    if (tool === 'erase') value = EMPTY;
    else if (tool === 'wall') value = here === WALL ? EMPTY : WALL;
    else value = here === MUD ? EMPTY : MUD;
    dragRef.current = { mode: 'paint', value, last: at };
    applyPaint(at.r, at.c);
  };

  const onPointerMove = (ev) => {
    const at = cellFromEvent(ev);
    setHover(at);
    const d = dragRef.current;
    if (!d || !at) return;
    if (d.mode === 'start') {
      if (!(at.r === grid.goal.r && at.c === grid.goal.c)) onSetStart(at.r, at.c);
    } else if (d.mode === 'goal') {
      if (!(at.r === grid.start.r && at.c === grid.start.c)) onSetGoal(at.r, at.c);
    } else {
      paintLine(d.last, at);
      d.last = at;
    }
  };

  const endDrag = () => { dragRef.current = null; };

  // Draw everything, in the colours in place now.
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const P = readPalette();
      const dpr = window.devicePixelRatio || 1;
      const W = grid.cols * cell;
      const H = grid.rows * cell;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = P.paper;
      ctx.fillRect(0, 0, W, H);

      const key = (r, c) => r * grid.cols + c;

      // Terrain: mud with a diagonal hatch.
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (grid.cells[key(r, c)] === MUD) {
            const x = c * cell;
            const y = r * cell;
            ctx.fillStyle = P.sand;
            ctx.fillRect(x, y, cell, cell);
            ctx.strokeStyle = P.sandLine;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let o = -cell; o < cell; o += 5) {
              ctx.moveTo(x + o, y + cell);
              ctx.lineTo(x + o + cell, y);
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, cell, cell);
            ctx.clip();
            ctx.beginPath();
            for (let o = -cell; o < cell; o += 5) {
              ctx.moveTo(x + o, y + cell);
              ctx.lineTo(x + o + cell, y);
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Search washes.
      if (view) {
        ctx.fillStyle = P.visited;
        for (const k of view.visited.keys()) {
          const r = Math.floor(k / grid.cols);
          const c = k % grid.cols;
          ctx.fillRect(c * cell, r * cell, cell, cell);
        }
        // Visited cells also take a fine hatch falling left to right (mud's
        // rises), so they do not rely on the wash's colour alone: it is
        // 1.37:1 (light) and 1.97:1 (dark) on the sheet, the hatch 4.78:1 and
        // 4.17:1 on the wash.
        if (view.visited.size) {
          ctx.save();
          ctx.beginPath();
          for (const k of view.visited.keys()) {
            if (view.frontier.has(k)) continue;
            ctx.rect((k % grid.cols) * cell, Math.floor(k / grid.cols) * cell, cell, cell);
          }
          ctx.clip();
          ctx.strokeStyle = P.inkSoft;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let o = -H; o < W; o += 6) {
            ctx.moveTo(o, 0);
            ctx.lineTo(o + H, H);
          }
          ctx.stroke();
          ctx.restore();
        }
        for (const k of view.frontier.keys()) {
          const r = Math.floor(k / grid.cols);
          const c = k % grid.cols;
          ctx.fillStyle = P.frontier;
          ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
        }
      }

      // Walls.
      ctx.fillStyle = P.ink;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (grid.cells[key(r, c)] === WALL) {
            ctx.fillRect(c * cell + 0.5, r * cell + 0.5, cell - 1, cell - 1);
          }
        }
      }

      // Grid lines.
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= grid.cols; c++) {
        ctx.moveTo(c * cell + 0.5, 0);
        ctx.lineTo(c * cell + 0.5, H);
      }
      for (let r = 0; r <= grid.rows; r++) {
        ctx.moveTo(0, r * cell + 0.5);
        ctx.lineTo(W, r * cell + 0.5);
      }
      ctx.stroke();

      // Final path, drawn like a route inked on a survey map.
      if (view?.done?.found) {
        const p = view.done.path;
        ctx.strokeStyle = P.route;
        ctx.lineWidth = Math.max(2.5, cell * 0.22);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        p.forEach((n, i) => {
          const x = n.c * cell + cell / 2;
          const y = n.r * cell + cell / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      // Current expansion marker.
      if (view?.current && !view.done) {
        const n = view.current.node;
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(n.c * cell + 1.5, n.r * cell + 1.5, cell - 3, cell - 3);
      }

      // Cost overlays.
      if (showCosts && view && cell >= 18) {
        const size = Math.max(8, Math.floor(cell * 0.36));
        ctx.font = `${size}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // On a visited cell the figure sits on the wash alone: a box of the
        // wash, laid the same way, covers the hatch behind it.
        const figures = (map, color, backed) => {
          for (const [k, info] of map) {
            const r = Math.floor(k / grid.cols);
            const c = k % grid.cols;
            const v = info.f ?? info.g;
            if (v == null) continue;
            const x = c * cell + cell / 2;
            const y = r * cell + cell / 2 + 0.5;
            if (backed && !view.frontier.has(k)) {
              const w = ctx.measureText(String(v)).width + 2;
              for (const fill of [P.paper, P.visited]) {
                ctx.fillStyle = fill;
                ctx.fillRect(x - w / 2, y - size / 2 - 1, w, size + 2);
              }
            }
            ctx.fillStyle = color;
            ctx.fillText(String(v), x, y);
          }
        };
        figures(view.visited, P.costVisited, true);
        figures(view.frontier, P.costFrontier, false);
      }

      // Start pin: a filled survey point. Goal pin: a bullseye.
      const pin = (n, kind) => {
        const x = n.c * cell + cell / 2;
        const y = n.r * cell + cell / 2;
        const R = cell * 0.32;
        if (kind === 'start') {
          ctx.fillStyle = P.green;
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = P.paper;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.strokeStyle = P.route;
          ctx.lineWidth = Math.max(2, cell * 0.12);
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = P.route;
          ctx.beginPath();
          ctx.arc(x, y, R * 0.38, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      pin(grid.start, 'start');
      pin(grid.goal, 'goal');

      // Hover outline.
      if (hover && editable) {
        ctx.strokeStyle = P.inkSoft;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hover.c * cell + 1, hover.r * cell + 1, cell - 2, cell - 2);
      }
    };
    drawRef.current = draw;
    draw();
  }, [grid, view, cell, hover, showCosts, editable]);

  // Draw again when the theme changes, and at once on the way into print and
  // back: print takes the light set, but a canvas keeps the pixels it drew on
  // screen. matchMedia('print') changes with the print colours in place (the
  // next frame would come after the printout; beforeprint still sees the
  // screen's colours).
  useEffect(() => {
    const redraw = () => drawRef.current?.();
    document.addEventListener('hw-themechange', redraw);
    const print = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    print?.addEventListener?.('change', redraw);
    return () => {
      document.removeEventListener('hw-themechange', redraw);
      print?.removeEventListener?.('change', redraw);
    };
  }, []);

  return (
    <div className="sheet" ref={wrapRef}>
      {label ? <div className="sheet__label">{label}</div> : null}
      <canvas
        ref={canvasRef}
        className="sheet__canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { setHover(null); endDrag(); }}
        aria-label={`${grid.cols} by ${grid.rows} map. Drag to draw with the selected tool; drag the green start pin or the red goal ring to move them.`}
      />
    </div>
  );
}
