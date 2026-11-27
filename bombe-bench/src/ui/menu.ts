/**
 * SVG menu graph: letters on a circle, one edge per crib position, loops
 * coloured, the test register letter filled in. Clicking a letter makes it
 * the test letter.
 */
import { chr } from '../core/enigma';
import type { Menu, MenuEdge } from '../core/crib';

const SVG = 'http://www.w3.org/2000/svg';
export const LOOP_COLORS = ['#e4572e', '#2f9e44', '#1c7ed6', '#9c36b5', '#e67700', '#0b7285', '#c2255c', '#5c940d'];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface MenuViewOptions {
  testLetter: number;
  highlightLoops: boolean;
  onPickLetter?: (letter: number) => void;
}

/** Orders letters around the circle so each component's letters sit together, walked by DFS. */
function circleOrder(menu: Menu): number[] {
  const adj = new Map<number, number[]>();
  for (const e of menu.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  const seen = new Set<number>();
  const order: number[] = [];
  for (const comp of menu.components) {
    const stack = [comp[0]];
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      order.push(v);
      for (const w of adj.get(v) ?? []) if (!seen.has(w)) stack.push(w);
    }
  }
  return order;
}

export function renderMenu(container: HTMLElement, menu: Menu, opts: MenuViewOptions): void {
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 36;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'menu-graph', role: 'group', 'aria-label': 'Menu graph' });
  const order = circleOrder(menu);
  const pos = new Map<number, { x: number; y: number }>();
  order.forEach((l, i) => {
    const ang = (i / order.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(l, { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) });
  });
  if (order.length === 0) {
    svg.appendChild(el('text', { x: cx, y: cy, 'text-anchor': 'middle', class: 'muted' }, 'Enter a ciphertext and a crib to build a menu.'));
    container.replaceChildren(svg);
    return;
  }

  const loopOf = new Map<MenuEdge, number>();
  if (opts.highlightLoops) menu.loops.forEach((loop, li) => loop.forEach((e) => { if (!loopOf.has(e)) loopOf.set(e, li); }));

  // Parallel edges between the same pair get a growing bend.
  const pairCount = new Map<string, number>();
  for (const e of menu.edges) {
    const key = [e.a, e.b].sort((p, q) => p - q).join('-');
    const k = pairCount.get(key) ?? 0;
    pairCount.set(key, k + 1);
    const p = pos.get(e.a)!;
    const q = pos.get(e.b)!;
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 22;
    const bx = mx + (-dy / len) * bend;
    const by = my + (dx / len) * bend;
    const li = loopOf.get(e);
    const cls = 'edge' + (li !== undefined ? ' in-loop' : '');
    const stroke = li !== undefined ? LOOP_COLORS[li % LOOP_COLORS.length] : '';
    const d = `M ${p.x} ${p.y} Q ${bx} ${by} ${q.x} ${q.y}`;
    const path = el('path', { d, class: cls, fill: 'none' });
    if (stroke) path.setAttribute('stroke', stroke);
    path.appendChild(el('title', {}, `Position ${e.i + 1}: ${chr(e.a)} ↔ ${chr(e.b)}`));
    svg.appendChild(path);
    // Label at the curve's midpoint (t = 0.5 of the quadratic).
    const lx = 0.25 * p.x + 0.5 * bx + 0.25 * q.x;
    const ly = 0.25 * p.y + 0.5 * by + 0.25 * q.y;
    svg.appendChild(el('rect', { x: lx - 8, y: ly - 7, width: 16, height: 14, rx: 3, class: 'edge-label-bg' }));
    const t = el('text', { x: lx, y: ly + 3.5, 'text-anchor': 'middle', class: 'edge-label' }, String(e.i + 1));
    if (stroke) t.setAttribute('fill', stroke);
    svg.appendChild(t);
  }

  const inLoop = new Set<number>();
  for (const [e] of loopOf) {
    inLoop.add(e.a);
    inLoop.add(e.b);
  }
  for (const l of order) {
    const p = pos.get(l)!;
    const g = el('g', { class: 'node' + (l === opts.testLetter ? ' test' : '') + (inLoop.has(l) ? ' looped' : ''), tabindex: 0, role: 'button' });
    g.appendChild(el('circle', { cx: p.x, cy: p.y, r: 14 }));
    g.appendChild(el('text', { x: p.x, y: p.y + 4.5, 'text-anchor': 'middle' }, chr(l)));
    g.appendChild(el('title', {}, `${chr(l)}: ${menu.degree[l]} connection${menu.degree[l] === 1 ? '' : 's'}. Click to make it the test register.`));
    const pick = () => opts.onPickLetter?.(l);
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        pick();
      }
    });
    svg.appendChild(g);
  }
  container.replaceChildren(svg);
}
