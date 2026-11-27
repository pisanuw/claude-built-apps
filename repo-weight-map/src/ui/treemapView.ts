import type { TreeNode } from '../core/types.js';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../core/classify.js';
import { formatBytes, formatPct } from '../core/format.js';
import { inset, squarify, type Rect } from '../core/treemap.js';
import { visibleChildren } from '../core/tree.js';
import { escapeHtml } from '../core/report.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TreemapHandlers {
  onZoom: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
}

/** Draw a two-level nested squarified treemap of `node` into `svg`. */
export function drawTreemap(svg: SVGSVGElement, node: TreeNode, total: number, width: number, height: number, h: TreemapHandlers): void {
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';
  const outer: Rect = { x: 0, y: 0, w: width, h: height };
  const kids = visibleChildren(node, 40);
  if (!kids.length) {
    const t = text(width / 2, height / 2, node.kind === 'file' ? 'A single file has no children to map.' : 'Empty folder.', 'empty');
    t.setAttribute('text-anchor', 'middle');
    svg.append(t);
    return;
  }
  // The drawn names sit in their own group above the cells, hidden from assistive technology: each cell is a
  // button named by its whole label, and a name drawn inside it (clipped, or a folder's contents) would not match.
  const labels = document.createElementNS(SVG_NS, 'g');
  labels.classList.add('labels');
  labels.setAttribute('aria-hidden', 'true');
  for (const { item, rect } of squarify(kids, (n) => n.size, outer)) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('cell', item.kind);
    const isRest = item.path.includes('\u0000');
    const color = CATEGORY_COLOR[item.category];
    g.append(rectEl(rect, color, item.kind === 'dir' ? 0.28 : 0.85));
    const label = `${item.name}  ${formatBytes(item.size)}`;
    if (rect.w > 46 && rect.h > 18) {
      labels.append(text(rect.x + 5, rect.y + 14, clip(label, rect.w / 7), 'label'));
    }
    const tip = document.createElementNS(SVG_NS, 'title');
    tip.textContent = `${item.path.replace('\u0000rest', '/…') || '/'}\n${formatBytes(item.size)} (${formatPct(item.size, total)}), ${item.fileCount.toLocaleString()} file${item.fileCount === 1 ? '' : 's'}\n${CATEGORY_LABEL[item.category]}`;
    g.append(tip);

    // One nested level so directories read as containers.
    if (item.kind === 'dir' && !isRest && item.children?.length && rect.w > 60 && rect.h > 40) {
      const innerRect = inset({ x: rect.x, y: rect.y + 16, w: rect.w, h: rect.h - 16 }, 3);
      for (const inner of squarify(visibleChildren(item, 12), (n) => n.size, innerRect)) {
        const ir = inset(inner.rect, 0.75);
        if (ir.w < 1.5 || ir.h < 1.5) continue;
        const r = rectEl(ir, CATEGORY_COLOR[inner.item.category], inner.item.kind === 'dir' ? 0.45 : 0.9);
        r.classList.add('inner');
        const it = document.createElementNS(SVG_NS, 'title');
        it.textContent = `${inner.item.path.replace('\u0000rest', '/…')}\n${formatBytes(inner.item.size)} (${formatPct(inner.item.size, total)})\n${CATEGORY_LABEL[inner.item.category]}`;
        r.append(it);
        if (ir.w > 60 && ir.h > 16) {
          labels.append(text(ir.x + 4, ir.y + 12, clip(inner.item.name, ir.w / 6.5), 'label inner'));
        }
        g.append(r);
      }
    }
    if (!isRest) {
      g.addEventListener('click', () => (item.kind === 'dir' ? h.onZoom(item) : h.onSelect(item)));
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', label);
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (item.kind === 'dir') h.onZoom(item);
          else h.onSelect(item);
        }
      });
    }
    svg.append(g);
  }
  svg.append(labels);
}

function rectEl(r: Rect, fill: string, opacity: number): SVGRectElement {
  const el = document.createElementNS(SVG_NS, 'rect');
  el.setAttribute('x', r.x.toFixed(2));
  el.setAttribute('y', r.y.toFixed(2));
  el.setAttribute('width', Math.max(0, r.w).toFixed(2));
  el.setAttribute('height', Math.max(0, r.h).toFixed(2));
  el.setAttribute('fill', fill);
  el.setAttribute('fill-opacity', String(opacity));
  el.setAttribute('rx', '3');
  return el;
}

function text(x: number, y: number, s: string, cls: string): SVGTextElement {
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('x', x.toFixed(2));
  t.setAttribute('y', y.toFixed(2));
  t.setAttribute('class', cls);
  t.textContent = s;
  return t;
}

function clip(s: string, maxChars: number): string {
  const n = Math.max(3, Math.floor(maxChars));
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Breadcrumb HTML for a zoom path ('' is the root). */
export function breadcrumbHtml(rootName: string, path: string): string {
  const parts = path ? path.split('/') : [];
  const crumbs = [`<button type="button" data-path="" class="crumb">${escapeHtml(rootName || 'root')}</button>`];
  parts.forEach((p, i) => {
    const full = parts.slice(0, i + 1).join('/');
    crumbs.push(`<span class="sep">/</span><button type="button" data-path="${escapeHtml(full)}" class="crumb">${escapeHtml(p)}</button>`);
  });
  return crumbs.join('');
}
