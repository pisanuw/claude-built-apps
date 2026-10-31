import { MACHINE, WARP } from '../core/gpu';
import { h } from './dom';

export function machineView(): HTMLElement {
  const row = (k: string, v: string) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v));
  return h(
    'section',
    { class: 'prose' },
    h('h2', {}, 'The machine and the language'),
    h(
      'p',
      { class: 'lede' },
      'The puzzles run on a simulated GPU, not on your graphics card. The simulator executes your kernel warp by warp, exactly as written, and charges cycles with a small cost model. The model is a teaching device: it keeps the effects that matter (idle lanes, divergence, uncoalesced loads, bank conflicts, barriers, atomic queues) and leaves out caches, latency hiding and clock details.',
    ),
    h('h3', {}, 'Kernel language'),
    h(
      'pre',
      { class: 'code' },
      `let i = blockIdx.x * blockDim.x + threadIdx.x;   // per-thread variable
if (i < n) { out[i] = a[i] + b[i]; }              // global arrays, by name
shared s[256];                                    // per-block shared array
sync();                                           // block-wide barrier
atomicAdd(out, 0, x);                             // atomic add, returns old value
for (let k = 0; k < 8; k++) { ... }               // for, while, if/else, return
let y = c ? x : 0;                                // select: no branch, no divergence`,
    ),
    h(
      'ul',
      {},
      h('li', {}, 'Built-ins: threadIdx.x, blockIdx.x, blockDim.x, gridDim.x, plus each level’s parameters such as n (read-only).'),
      h('li', {}, 'Operators: + - * / % == != < <= > >= && || ! and c ? x : y. Assignment: = += -= *= /= ++ --.'),
      h('li', {}, 'Functions: min, max, abs, floor, sqrt, atomicAdd(array, index, value).'),
      h('li', {}, 'Values are untyped numbers: / truncates whenever both values are whole numbers (even if written 9.0), as integer division does in C. Array indexes must be whole numbers inside the array.'),
      h('li', {}, 'Comments: // and /* */. No break or continue; use the loop condition or return.'),
    ),
    h('h3', {}, 'How a warp runs'),
    h(
      'p',
      {},
      `Threads are grouped into warps of ${WARP} lanes. A warp issues one instruction at a time for all its active lanes. At an if whose condition differs across lanes, the warp runs the then-side with the other lanes off, then the else-side: that is divergence, and it costs both paths. A loop keeps going while any lane still wants another iteration. A select (c ? x : y) evaluates both sides under a predicate without branching.`,
    ),
    h('h3', {}, 'Cost model'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        {},
        h(
          'tbody',
          {},
          row('Arithmetic, compare, assignment, branch', '1 cycle per warp instruction'),
          row('Global load or store', `1 + ${MACHINE.globalTxCycles} per 128-byte segment the warp touches (${MACHINE.segmentWords} consecutive words). A perfectly coalesced warp touches 1.`),
          row('Shared load or store', `1 + ${MACHINE.bankConflictCycles} per extra address queued in the busiest of ${MACHINE.sharedBanks} banks (word k is in bank k % ${MACHINE.sharedBanks}; the same address is a free broadcast)`),
          row('Atomic', `as a load, plus ${MACHINE.atomicSerialCycles} per extra lane on the same address; and one address can absorb only one global atomic every ${MACHINE.atomicUnitCycles} cycles across the whole GPU`),
          row('Block', `between barriers, max(slowest warp, total warp cycles ÷ ${MACHINE.schedulersPerSm} schedulers), plus ${MACHINE.blockOverheadCycles} cycles to start`),
          row('Grid', `blocks go to the least busy of ${MACHINE.sms} SMs in order; the kernel takes as long as the busiest SM, plus ${MACHINE.launchOverheadCycles} cycles of launch overhead`),
          row('Limits', `${MACHINE.maxThreadsPerBlock} threads per block, ${MACHINE.maxSharedWords} shared words per block`),
          row('CPU estimate', `one core at ${MACHINE.cpuGHz} GHz doing one thread-operation per cycle, against a ${MACHINE.gpuGHz} GHz GPU`),
        ),
      ),
    ),
    h('h3', {}, 'Race detection'),
    h(
      'p',
      {},
      'Every load and store is checked. In shared memory, two threads of a block touching the same word between two sync() calls, with at least one writing, is a race. In global memory, the same goes within a block, and any write by two different blocks, or a read of a word another block wrote, is a race too, because blocks cannot wait for each other inside a kernel. atomicAdd is never a race. Warp-synchronous tricks count as races here, as they do on current hardware.',
    ),
    h('h3', {}, 'What is different from a real GPU'),
    h(
      'ul',
      {},
      h('li', {}, 'Blocks run one after another in a fixed order, so a racy kernel gives the same wrong answer every time. On hardware it changes from run to run; the race detector stands in for that.'),
      h('li', {}, 'No caches, no memory latency to hide, no occupancy limits other than the two above, one-dimensional grids only, and numbers are 64-bit floats.'),
      h('li', {}, 'Cycle counts are relative. Use them to compare your own versions, not to predict a real card.'),
    ),
  );
}
