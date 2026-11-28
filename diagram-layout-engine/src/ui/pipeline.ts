// Pipeline inspector: the top-level scope of the current diagram, one stage
// at a time, drawn as schematics of the layer graph.

import type { Flowchart, Layout, LayoutOptions, StageRecord } from '../core/types';
import { esc, fmt } from './dom';

type SNode = StageRecord['nodes'][number];

const SLOT = 104;
const ROW = 66;
const BOX_W = 88;
const BOX_H = 28;

function short(label: string, n = 12): string {
  const one = label.replace(/\n/g, ' ');
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

interface Placed {
  x: number;
  y: number;
  node: SNode;
}

function nodeSvg(p: Placed, cls = ''): string {
  const n = p.node;
  if (n.dummy) {
    if (n.width > 0) return `<rect class="sch-label${cls}" x="${p.x - 14}" y="${p.y - 7}" width="28" height="14" rx="4"><title>edge label</title></rect>`;
    return `<circle class="sch-dummy${cls}" cx="${p.x}" cy="${p.y}" r="4"><title>dummy node</title></circle>`;
  }
  return (
    `<g class="sch-node${n.cluster ? ' sch-cluster' : ''}${cls}"><rect x="${p.x - BOX_W / 2}" y="${p.y - BOX_H / 2}" width="${BOX_W}" height="${BOX_H}" rx="5"/>` +
    `<text x="${p.x}" y="${p.y}" dominant-baseline="central" text-anchor="middle">${esc(short(n.label || n.id))}</text><title>${esc(n.id)}</title></g>`
  );
}

function edgeEnd(p: Placed, toward: Placed): { x: number; y: number } {
  if (p.node.dummy) return { x: p.x, y: p.y };
  const dy = toward.y > p.y ? BOX_H / 2 : toward.y < p.y ? -BOX_H / 2 : 0;
  const dx = dy === 0 ? (toward.x > p.x ? BOX_W / 2 : -BOX_W / 2) : 0;
  return { x: p.x + dx, y: p.y + dy };
}

function schematic(placed: Map<string, Placed>, edges: { v: string; w: string; cls?: string }[], width: number, height: number): string {
  const lines = edges
    .map((e) => {
      const a = placed.get(e.v);
      const b = placed.get(e.w);
      if (!a || !b) return '';
      const p = edgeEnd(a, b);
      const q = edgeEnd(b, a);
      return `<line class="sch-edge ${e.cls ?? ''}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" marker-end="url(#sch-arrow)"/>`;
    })
    .join('');
  const nodes = [...placed.values()].map((p) => nodeSvg(p)).join('');
  return (
    `<svg class="sch" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Layout schematic: the nodes by layer and order">` +
    '<defs><marker id="sch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z"/></marker></defs>' +
    `${lines}${nodes}</svg>`
  );
}

/** Rank rows, nodes in the given per-layer order. */
function grid(stage: StageRecord, layers: string[][], filter: (n: SNode) => boolean): { placed: Map<string, Placed>; w: number; h: number } {
  const byId = new Map(stage.nodes.map((n) => [n.id, n]));
  const placed = new Map<string, Placed>();
  let maxCols = 1;
  layers.forEach((layer, r) => {
    const kept = layer.filter((id) => filter(byId.get(id)!));
    maxCols = Math.max(maxCols, kept.length);
    kept.forEach((id, k) => placed.set(id, { x: 16 + SLOT / 2 + k * SLOT, y: 26 + r * ROW, node: byId.get(id)! }));
  });
  return { placed, w: 32 + maxCols * SLOT, h: 52 + Math.max(0, layers.length - 1) * ROW };
}

function realLayers(stage: StageRecord, ranks: Record<string, number>): string[][] {
  const best = stage.orders[Math.max(0, stage.bestOrder)]?.layers.flat() ?? [];
  const pos = new Map(best.map((id, k) => [id, k]));
  const rows: string[][] = [];
  for (const n of stage.nodes) {
    if (n.dummy) continue;
    const r = ranks[n.id];
    (rows[r] ??= []).push(n.id);
  }
  return Array.from(rows, (row) => (row ?? []).sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0)));
}

function span(stage: StageRecord, ranks: Record<string, number>): number {
  return stage.edges.reduce((s, e) => s + (ranks[e.w] - ranks[e.v]), 0);
}

const STAGES = [
  { id: 'parse', title: '1. Parse' },
  { id: 'acyclic', title: '2. Cycle removal' },
  { id: 'rank', title: '3. Layering' },
  { id: 'normalize', title: '4. Dummy nodes' },
  { id: 'order', title: '5. Crossing minimisation' },
  { id: 'position', title: '6. Coordinates' },
  { id: 'route', title: '7. Routing' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];

export interface PipelineState {
  stage: StageId;
  snapshot: number;
}

export function renderPipeline(
  root: HTMLElement,
  chart: Flowchart,
  layout: Layout,
  opts: LayoutOptions,
  finalSvg: string,
  ui: PipelineState,
  rerender: () => void,
): void {
  const stage = layout.stages!;
  const tabs = STAGES.map(
    (s) => `<button class="stage-tab${s.id === ui.stage ? ' active' : ''}" data-stage="${s.id}" aria-pressed="${s.id === ui.stage}">${s.title}</button>`,
  ).join('');
  const clusterNote = chart.subgraphs.size
    ? `<p class="note">Subgraphs are laid out first, each by its own run of this pipeline, and appear here as one box (dashed).</p>`
    : '';
  let body = '';
  const reversed = stage.edges.filter((e) => e.reversed);
  const realCount = stage.nodes.filter((n) => !n.dummy).length;
  const dummyCount = stage.nodes.length - realCount;

  switch (ui.stage) {
    case 'parse': {
      const rows = [...chart.nodes.values()]
        .map((n) => `<tr><td><code>${esc(n.id)}</code></td><td>${esc(n.label.replace(/\n/g, ' / '))}</td><td>${n.shape}</td><td>${esc(n.parent ?? '')}</td><td>${n.pos.line}:${n.pos.col}</td></tr>`)
        .join('');
      const erows = chart.edges
        .map(
          (e, k) =>
            `<tr><td>${k}</td><td><code>${esc(e.from)}</code> → <code>${esc(e.to)}</code></td><td>${esc(e.label)}</td><td>${e.line}${e.minlen > 1 ? `, length ${e.minlen}` : ''}</td><td>${e.tail}/${e.head}</td></tr>`,
        )
        .join('');
      body = `<p>The recursive-descent parser turns the text into a graph model: ${fmt(chart.nodes.size)} nodes, ${fmt(chart.edges.length)} edges and ${fmt(chart.subgraphs.size)} subgraphs, each with its source position for error messages.</p>
        <div class="tables"><div class="table-scroll" tabindex="0" role="region" aria-label="Nodes"><table><thead><tr><th>id</th><th>label</th><th>shape</th><th>subgraph</th><th>at</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Edges"><table><thead><tr><th>#</th><th>edge</th><th>label</th><th>line</th><th>ends</th></tr></thead><tbody>${erows}</tbody></table></div></div>`;
      break;
    }
    case 'acyclic': {
      const layers = realLayers(stage, stage.ranks);
      const g = grid(stage, layers, (n) => !n.dummy);
      const edges = stage.edges.map((e) => ({ v: e.v, w: e.w, cls: e.reversed ? 'sch-reversed' : '' }));
      body = `<p>Layering needs a DAG, so a feedback arc set is reversed: <strong>${reversed.length}</strong> of ${stage.edges.length} edges ${reversed.length === 1 ? 'is' : 'are'} flipped (red, dashed) and drawn the right way round again at the end. Finding the smallest such set is NP-hard; the greedy heuristic of Eades, Lin and Smyth peels off sinks and sources and then the node with the largest out-minus-in weight.</p>
        ${reversed.length ? `<p class="mono">${reversed.map((e) => `${esc(e.w)} → ${esc(e.v)}`).join(', ')}</p>` : '<p class="mono">No cycles at this level.</p>'}
        <div class="sch-wrap" tabindex="0" role="region" aria-label="Schematic">${schematic(g.placed, edges, g.w, g.h)}</div>`;
      break;
    }
    case 'rank': {
      const lp = grid(stage, realLayers(stage, stage.longestPathRanks), (n) => !n.dummy);
      const ns = grid(stage, realLayers(stage, stage.ranks), (n) => !n.dummy);
      const edges = stage.edges.map((e) => ({ v: e.v, w: e.w }));
      const a = span(stage, stage.longestPathRanks);
      const b = span(stage, stage.ranks);
      body = `<p>Each node gets a layer so every edge points down by at least its minimum length (labelled edges count double, leaving a layer for the label). Longest-path is fast but piles sources on top; network simplex moves nodes to minimise the total edge span, which means fewer dummy nodes, shorter edges and usually fewer crossings.</p>
        <div class="compare"><figure><figcaption>Longest path: total span <strong>${a}</strong></figcaption><div class="sch-wrap" tabindex="0" role="region" aria-label="Schematic: longest path">${schematic(lp.placed, edges, lp.w, lp.h)}</div></figure>
        <figure><figcaption>Used (${esc(layout.stats.layers + ' layers')}): total span <strong>${b}</strong></figcaption><div class="sch-wrap" tabindex="0" role="region" aria-label="Schematic: the layering used">${schematic(ns.placed, edges, ns.w, ns.h)}</div></figure></div>`;
      break;
    }
    case 'normalize': {
      const snap = stage.orders[Math.max(0, stage.bestOrder)];
      const g = grid(stage, snap.layers, () => true);
      body = `<p>Edges spanning several layers are split by <strong>${dummyCount}</strong> dummy nodes (dots), so every edge joins adjacent layers. Labelled edges carry their label on the middle dummy (small boxes). The ordering and coordinate steps then treat dummies like tiny nodes, which is what lets long edges bend around real ones.</p>
        <div class="sch-wrap" tabindex="0" role="region" aria-label="Schematic">${schematic(g.placed, stage.properEdges, g.w, g.h)}</div>`;
      break;
    }
    case 'order': {
      const snaps = stage.orders;
      const k = Math.min(Math.max(0, ui.snapshot), snaps.length - 1);
      const snap = snaps[k];
      const g = grid(stage, snap.layers, () => true);
      const max = Math.max(1, ...snaps.map((s) => s.crossings));
      const bars = snaps
        .map((s, i) => {
          const h = Math.max(2, (s.crossings / max) * 60);
          return `<button class="bar${i === k ? ' active' : ''}${i === stage.bestOrder ? ' best' : ''}" data-snap="${i}" style="height:${h}px" title="${esc(s.label)}: ${s.crossings} crossings" aria-label="${esc(s.label)}: ${s.crossings} crossings"></button>`;
        })
        .join('');
      body = `<p>Sweeps go down and up the layers, sorting each layer by the ${opts.order} position of its neighbours in the layer just fixed${opts.transpose ? '; transposition then swaps neighbours while that lowers the count' : ' (transposition is off)'}. Crossings are counted with the Barth-Juenger-Mutzel accumulator tree and the best order seen is kept.</p>
        <div class="bars" role="group" aria-label="Crossings per step">${bars}</div>
        <div class="snap-ctl"><input type="range" min="0" max="${snaps.length - 1}" value="${k}" id="snap-range" aria-label="Step"><span><strong>${esc(snap.label)}</strong>: ${snap.crossings} crossing${snap.crossings === 1 ? '' : 's'}${k === stage.bestOrder ? ' (kept)' : ''}</span></div>
        <div class="sch-wrap" tabindex="0" role="region" aria-label="Schematic">${schematic(g.placed, stage.properEdges, g.w, g.h)}</div>`;
      break;
    }
    case 'position': {
      const hz = stage.direction === 'LR' || stage.direction === 'RL';
      const byId = new Map(stage.nodes.map((n) => [n.id, n]));
      let maxX = 0;
      let maxY = 0;
      const parts: string[] = [];
      for (const [id, p] of Object.entries(stage.positions)) {
        const n = byId.get(id)!;
        const w = hz ? n.height : n.width;
        const h = hz ? n.width : n.height;
        maxX = Math.max(maxX, p.x + w / 2);
        maxY = Math.max(maxY, p.y + h / 2);
        if (n.dummy) parts.push(n.width ? `<rect class="sch-label" x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="3"/>` : `<circle class="sch-dummy" cx="${p.x}" cy="${p.y}" r="3.5"/>`);
        else parts.push(`<g class="sch-node${n.cluster ? ' sch-cluster' : ''}"><rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="4"/><text x="${p.x}" y="${p.y}" dominant-baseline="central" text-anchor="middle">${esc(short(n.label || n.id, 18))}</text></g>`);
      }
      const lines = stage.properEdges
        .map((e) => {
          const a = stage.positions[e.v];
          const b = stage.positions[e.w];
          return `<line class="sch-edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
        })
        .join('');
      body = `<p>With the order fixed, coordinates are assigned inside each layer. Brandes-Koepf builds four alignments (up/down, left/right) where each node lines up with a median neighbour and inner dummy-to-dummy segments win conflicts, compacts each into blocks, and takes the average median, so long edges come out straight. The priority method instead nudges nodes towards their neighbours, dummies first. Using <strong>${opts.position === 'priority' ? 'the priority method' : 'Brandes-Koepf'}</strong>. Real nodes are shown at true size; lines join centres.</p>
        <div class="sch-wrap" tabindex="0" role="region" aria-label="Schematic"><svg class="sch" viewBox="0 0 ${maxX + 12} ${maxY + 12}" width="${maxX + 12}" height="${maxY + 12}">${lines}${parts.join('')}</svg></div>`;
      break;
    }
    case 'route':
      body = `<p>Finally edges are routed through their dummy positions: splines use cubic segments with tangents along the flow, orthogonal routes bend in spread-out tracks between layers, and edges into a subgraph get a leg from the border port to the real node, bending around siblings when the straight line is blocked. Shapes clip the ends; arrowheads, labels and theme colours are added in the SVG.</p>
        <p class="mono">${fmt(layout.stats.edgeLength)} px of edges, ${layout.stats.bends} bends, ${fmt(layout.width)} x ${fmt(layout.height)} px, ${layout.stats.ms} ms</p>
        <div class="sch-wrap final">${finalSvg}</div>`;
      break;
  }
  root.innerHTML = `<div class="stage-tabs" role="toolbar" aria-label="Pipeline stages">${tabs}</div>${clusterNote}
    <div class="stage-stats mono">${realCount} nodes · ${stage.edges.length} edges · ${layout.stats.layers} layers · ${dummyCount} dummies · ${reversed.length} reversed · ${layout.stats.crossings} crossings</div>
    <div class="stage-body">${body}</div>`;
  root.querySelectorAll<HTMLButtonElement>('.stage-tab').forEach((b) =>
    b.addEventListener('click', () => {
      ui.stage = b.dataset.stage as StageId;
      rerender();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('.bar').forEach((b) =>
    b.addEventListener('click', () => {
      ui.snapshot = Number(b.dataset.snap);
      rerender();
    }),
  );
  const range = root.querySelector<HTMLInputElement>('#snap-range');
  range?.addEventListener('input', () => {
    ui.snapshot = Number(range.value);
    rerender();
    root.querySelector<HTMLInputElement>('#snap-range')?.focus();
  });
}
