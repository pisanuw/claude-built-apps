import type { BNode, BTreeSnapshot } from '../core/btree';
import type { HashSnapshot } from '../core/hashmap';
import type { LruSnapshot } from '../core/lru';
import type { SkipSnapshot } from '../core/skiplist';
import { h, s } from './dom';

const MAX_LABEL = 6;

export function label(key: string): string {
  return key.length > MAX_LABEL ? key.slice(0, MAX_LABEL - 1) + '…' : key;
}

function chip(key: string, value: string, touched: Set<string>, extra = ''): HTMLElement {
  return h('span', { class: `chip${touched.has(key) ? ' touched' : ''}${extra ? ' ' + extra : ''}`, title: `${key} = ${value}` }, label(key));
}

export function renderHash(snap: HashSnapshot, touched: Set<string>): HTMLElement {
  const over = snap.loadFactor / snap.maxLoad;
  return h(
    'div',
    { class: 'hash-view' },
    h(
      'div',
      { class: 'load' },
      h('span', {}, `load ${snap.loadFactor.toFixed(2)} / ${snap.maxLoad}`),
      h('span', { class: 'load-bar', 'aria-hidden': 'true' }, h('span', { class: 'load-fill', style: `width:${Math.min(100, over * 100).toFixed(0)}%` })),
    ),
    h(
      'ol',
      { class: 'buckets', start: 0, 'aria-label': `${snap.buckets.length} buckets` },
      ...snap.buckets.map((b, i) =>
        h(
          'li',
          { class: `bucket${b.length > 1 ? ' collide' : ''}` },
          h('span', { class: 'bucket-index' }, String(i)),
          ...b.map((e) => chip(e.key, e.value, touched)),
        ),
      ),
    ),
  );
}

export function renderSkip(snap: SkipSnapshot, touched: Set<string>): HTMLElement {
  if (!snap.towers.length) return h('p', { class: 'empty' }, 'Empty lot. SET a key to build the first tower.');
  const levels = Math.max(snap.levels, 1);
  const grid = h('div', { class: 'skip-grid', style: `grid-template-columns: 2.4em repeat(${snap.towers.length}, minmax(2.6em, 1fr)); grid-template-rows: repeat(${levels + 1}, auto)` });
  for (let lvl = levels; lvl >= 1; lvl--) {
    grid.append(h('span', { class: 'lvl' }, `L${lvl}`));
    for (const t of snap.towers) {
      grid.append(t.height >= lvl ? h('span', { class: `floor${touched.has(t.key) ? ' touched' : ''}`, title: `${t.key}: tower height ${t.height}` }) : h('span', { class: 'sky' }));
    }
  }
  grid.append(h('span', { class: 'lvl' }));
  for (const t of snap.towers) grid.append(h('span', { class: `skip-key${touched.has(t.key) ? ' touched' : ''}`, title: `${t.key} = ${t.value}` }, label(t.key)));
  return h('div', { class: 'scroll-x' }, grid);
}

export function renderLru(snap: LruSnapshot, touched: Set<string>, evicted: string[]): HTMLElement {
  const slots: HTMLElement[] = snap.order.map((e, i) => chip(e.key, e.value, touched, i === 0 ? 'front' : i === snap.order.length - 1 && snap.order.length === snap.capacity ? 'tail' : ''));
  for (let i = snap.order.length; i < snap.capacity; i++) slots.push(h('span', { class: 'chip vacant' }, ' '));
  return h(
    'div',
    { class: 'lru-view' },
    h('div', { class: 'lru-ends', 'aria-hidden': 'true' }, h('span', {}, 'most recent'), h('span', {}, 'evicted next')),
    h('div', { class: 'lru-row' }, ...slots),
    evicted.length ? h('p', { class: 'evicted' }, 'Evicted: ', ...evicted.map((k) => h('s', {}, k + ' '))) : null,
  );
}

interface Placed {
  node: BNode;
  x: number;
  y: number;
  w: number;
  children: Placed[];
}

const KW = 34;
const NODE_PAD = 6;
const GAP = 12;
const LEVEL_H = 58;
const NODE_H = 26;

function layout(n: BNode, depth: number, cursor: { x: number }): Placed {
  const w = Math.max(1, n.keys.length) * KW + NODE_PAD * 2;
  if (!n.children.length) {
    const p = { node: n, x: cursor.x, y: depth * LEVEL_H, w, children: [] };
    cursor.x += w + GAP;
    return p;
  }
  const children = n.children.map((c) => layout(c, depth + 1, cursor));
  const first = children[0];
  const last = children[children.length - 1];
  const center = (first.x + last.x + last.w) / 2;
  return { node: n, x: center - w / 2, y: depth * LEVEL_H, w, children };
}

export function renderBTree(snap: BTreeSnapshot, touched: Set<string>): HTMLElement {
  if (!snap.root.keys.length) return h('p', { class: 'empty' }, `Empty lot. Nodes hold ${snap.minDegree - 1} to ${2 * snap.minDegree - 1} keys.`);
  const cursor = { x: 0 };
  const root = layout(snap.root, 0, cursor);
  let minX = Infinity;
  let maxX = -Infinity;
  const all: Placed[] = [];
  const collect = (p: Placed): void => {
    all.push(p);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
    p.children.forEach(collect);
  };
  collect(root);
  const pad = 6;
  const width = maxX - minX + pad * 2;
  const height = (snap.height - 1) * LEVEL_H + NODE_H + pad * 2;
  const g = s('g', { transform: `translate(${pad - minX},${pad})` });
  for (const p of all) {
    p.children.forEach((c, i) => {
      const fromX = p.x + NODE_PAD + i * KW;
      g.append(s('line', { class: 'edge', x1: fromX, y1: p.y + NODE_H, x2: c.x + c.w / 2, y2: c.y }));
    });
  }
  for (const p of all) {
    const node = s('g', { class: 'bnode' });
    node.append(s('rect', { x: p.x, y: p.y, width: p.w, height: NODE_H, rx: 4 }));
    p.node.keys.forEach((k, i) => {
      const cx = p.x + NODE_PAD + i * KW + KW / 2;
      if (i > 0) node.append(s('line', { class: 'divider', x1: p.x + NODE_PAD + i * KW, y1: p.y + 4, x2: p.x + NODE_PAD + i * KW, y2: p.y + NODE_H - 4 }));
      const text = s('text', { x: cx, y: p.y + NODE_H / 2 + 4, 'text-anchor': 'middle', class: touched.has(k) ? 'touched' : '' }, label(k));
      text.append(s('title', {}, `${k} = ${p.node.vals[i]}`));
      node.append(text);
    });
    g.append(node);
  }
  const svg = s('svg', { class: 'btree-svg', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': `B-tree of height ${snap.height}` }, g);
  return h('div', { class: 'scroll-x' }, svg as unknown as HTMLElement);
}
