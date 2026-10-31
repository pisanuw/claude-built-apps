import { type BlockTiming, MACHINE, type RunResult, type TraceEvent, WARP } from '../core/gpu';
import { h, s } from './dom';

/** Gantt chart: one row per SM, one bar per block. */
export function smTimeline(run: RunResult): HTMLElement {
  const W = 640;
  const rowH = 22;
  const left = 44;
  const total = Math.max(1, ...run.stats.smCycles);
  const H = MACHINE.sms * rowH + 26;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline-svg', role: 'img', 'aria-label': `Blocks on ${MACHINE.sms} SMs over ${total} cycles` });
  const x = (c: number) => left + (c / total) * (W - left - 8);
  for (let sm = 0; sm < MACHINE.sms; sm++) {
    const y = sm * rowH + 4;
    svg.append(s('text', { x: 4, y: y + 15, class: 'tl-label' }, `SM ${sm}`));
    svg.append(s('rect', { x: left, y, width: W - left - 8, height: rowH - 4, class: 'tl-track' }));
  }
  const many = run.blocks.length > 120;
  run.blocks.forEach((b: BlockTiming) => {
    const y = b.sm * rowH + 4;
    const r = s('rect', { x: x(b.start), y, width: Math.max(1, x(b.start + b.cycles) - x(b.start) - (many ? 0 : 1)), height: rowH - 4, class: `tl-block ${b.block % 2 ? 'odd' : ''}` });
    r.append(s('title', {}, `block ${b.block} on SM ${b.sm}: cycles ${b.start}–${b.start + b.cycles}`));
    svg.append(r);
  });
  const axisY = MACHINE.sms * rowH + 18;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const c = Math.round(total * f);
    svg.append(s('text', { x: x(c), y: axisY, class: 'tl-axis', 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' }, c.toLocaleString()));
  }
  return h('figure', { class: 'viz' }, svg, h('figcaption', {}, `Each bar is a block on the SM that ran it, in cycles. The kernel ends when the busiest SM finishes (plus ${MACHINE.launchOverheadCycles} cycles of launch overhead).`));
}

const SEG_COLORS = ['#6366f1', '#0ea5b7', '#e8890c', '#d6409f', '#16a34a', '#e5484d', '#8b5cf6', '#ca8a04'];

/** 32 cells showing which lanes are on, coloured by memory segment or bank for memory events. */
export function laneStrip(e: TraceEvent): HTMLElement {
  const strip = h('span', { class: 'lanes', 'aria-hidden': 'true' });
  const mem = e.mem;
  for (let l = 0; l < WARP; l++) {
    const on = ((e.mask >>> l) & 1) === 1;
    const cell = h('i', { class: on ? 'on' : '' });
    if (on && mem && mem.addrs[l] >= 0) {
      const key = mem.space === 'global' ? Math.floor(mem.addrs[l] / MACHINE.segmentWords) : mem.addrs[l] % MACHINE.sharedBanks;
      cell.style.background = SEG_COLORS[((key % SEG_COLORS.length) + SEG_COLORS.length) % SEG_COLORS.length];
    }
    strip.append(cell);
  }
  return strip;
}

export function eventLabel(e: TraceEvent): string {
  const lanes = popcountLabel(e.mask);
  switch (e.kind) {
    case 'branch':
      return `branch, ${lanes}${e.diverged ? ', DIVERGES' : ''}`;
    case 'sync':
      return 'sync(): wait for the block';
    case 'return':
      return `return, ${lanes}`;
    case 'stmt':
      return `compute, ${lanes}`;
    case 'mem': {
      const m = e.mem as NonNullable<TraceEvent['mem']>;
      const what = `${m.kind} ${m.array}[ ]`;
      return m.space === 'global'
        ? `${what}, ${lanes}, ${m.transactions} segment${m.transactions === 1 ? '' : 's'}`
        : `${what} (shared), ${lanes}${m.conflict > 1 ? `, ${m.conflict}-way bank conflict` : ''}`;
    }
  }
}

function popcountLabel(mask: number): string {
  let c = 0;
  let m = mask >>> 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return `${c}/${WARP} lanes`;
}
