import { type Launch, type RunResult, type TraceEvent, MACHINE, runKernel } from './gpu';
import { type Level, checkLaunch } from './levels';

export interface Mismatch {
  array: string;
  index: number;
  got: number;
  want: number;
}

export interface Grade {
  run: RunResult;
  launchProblem: string | null;
  correct: boolean;
  mismatches: Mismatch[];
  mismatchCount: number;
  /** 0 to 3. Correct and race-free earns 1; within 1.6× par 2; within 5% of par (or better) 3. */
  stars: number;
  par: number;
  /** gpuCycles / par. */
  ratio: number;
}

export const STAR_THRESHOLDS = { three: 1.05, two: 1.6 } as const;

const parCache = new Map<string, number>();

function data(level: Level) {
  const inputs = level.inputs();
  const arrays: Record<string, number[]> = { ...inputs };
  for (const [k, len] of Object.entries(level.outputs)) arrays[k] = new Array(len).fill(0);
  return { inputs, arrays };
}

export function runLevel(level: Level, source: string, launch: Launch, traceBlocks = 2): RunResult {
  return runKernel(source, launch, { arrays: data(level).arrays, params: level.params }, { traceBlocks });
}

/** GPU cycles of the reference solution. */
export function parFor(level: Level): number {
  let p = parCache.get(level.id);
  if (p === undefined) {
    const r = runLevel(level, level.reference, level.referenceLaunch, 0);
    if (!r.ok) throw new Error(`reference for ${level.id} fails: ${r.error?.message}`);
    p = r.stats.gpuCycles;
    parCache.set(level.id, p);
  }
  return p;
}

export function compare(level: Level, run: RunResult): { mismatches: Mismatch[]; count: number } {
  const want = level.expected(level.inputs());
  const mismatches: Mismatch[] = [];
  let count = 0;
  for (const [name, values] of Object.entries(want)) {
    const got = run.arrays[name];
    for (let i = 0; i < values.length; i++) {
      const g = got ? got[i] : NaN;
      if (!(Math.abs(g - values[i]) <= 1e-9 * Math.max(1, Math.abs(values[i])))) {
        count++;
        if (mismatches.length < 8) mismatches.push({ array: name, index: i, got: g, want: values[i] });
      }
    }
  }
  return { mismatches, count };
}

export function grade(level: Level, source: string, launch: Launch): Grade {
  const par = parFor(level);
  const launchProblem = checkLaunch(level, launch);
  const run = launchProblem
    ? runKernel('', { grid: 1, block: 1 }, { arrays: {}, params: {} })
    : runLevel(level, source, launch);
  if (launchProblem) run.error = { message: launchProblem, line: 0, kind: 'launch' };
  run.ok = run.error === null;
  const cmp = run.ok ? compare(level, run) : { mismatches: [], count: -1 };
  const correct = run.ok && cmp.count === 0;
  const ratio = run.ok ? run.stats.gpuCycles / par : Infinity;
  let stars = 0;
  if (correct && run.races.length === 0) stars = ratio <= STAR_THRESHOLDS.three ? 3 : ratio <= STAR_THRESHOLDS.two ? 2 : 1;
  return { run, launchProblem, correct, mismatches: cmp.mismatches, mismatchCount: cmp.count, stars, par, ratio };
}

export type HintLevel = 'error' | 'warn' | 'perf' | 'good';

export interface Hint {
  level: HintLevel;
  title: string;
  text: string;
  line?: number;
}

/** Lines with the most of something, from the warp traces. */
function worstLine(traces: Record<string, TraceEvent[]>, score: (e: TraceEvent) => number): { line: number; score: number } | null {
  const byLine = new Map<number, number>();
  for (const evs of Object.values(traces)) for (const e of evs) byLine.set(e.line, (byLine.get(e.line) ?? 0) + score(e));
  let best: { line: number; score: number } | null = null;
  for (const [line, s] of byLine) if (s > 0 && (!best || s > best.score)) best = { line, score: s };
  return best;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Deterministic diagnosis of a run: errors first, then correctness, races and
 * performance. Each hint names the concept and, where it can, the line.
 */
export function hints(level: Level, g: Grade, launch: Launch): Hint[] {
  const out: Hint[] = [];
  const { run } = g;
  const s = run.stats;
  if (run.error) {
    const e = run.error;
    let text = e.message;
    if (/out of bounds/.test(e.message))
      text += `. Thread ${e.thread ?? '?'} is past the end of the data. The grid has ${launch.grid * launch.block} threads; guard memory accesses with a check such as if (i < n).`;
    else if (/sync\(\)/.test(e.message)) text += '. Put sync() where every thread passes, for example just after the if, inside the loop.';
    else if (/not defined/.test(e.message)) text += '. Variables are per thread and must be declared before use.';
    else if (/never ends|stopped after/.test(e.message)) text += ' Check that the loop variable moves toward the exit condition.';
    out.push({ level: 'error', title: e.kind === 'syntax' ? 'Does not compile' : e.kind === 'launch' ? 'Launch not allowed' : 'Crashed while running', text, ...(e.line ? { line: e.line } : {}) });
    return out;
  }
  const threads = launch.grid * launch.block;
  if (!g.correct) {
    const first = g.mismatches[0];
    const n = level.params.n;
    const untouched = g.mismatches.every((m) => m.got === 0) && n !== undefined && threads < n && g.mismatches.every((m) => m.index >= threads);
    if (untouched)
      out.push({
        level: 'error',
        title: 'Part of the output was never written',
        text: `Elements from ${threads} on are still 0: the launch has ${threads} threads for ${n} elements. Launch more blocks, or loop with a stride of gridDim.x * blockDim.x.`,
      });
    else
      out.push({
        level: 'error',
        title: 'Wrong answer',
        text: `${g.mismatchCount} value${g.mismatchCount === 1 ? '' : 's'} differ. First: ${first.array}[${first.index}] is ${first.got}, expected ${first.want}.`,
      });
  }
  for (const r of run.races) {
    const what =
      r.kind === 'write-write'
        ? `threads ${r.threads[0]} and ${r.threads[1]} both write ${r.array}[${r.addr}]`
        : r.kind === 'read-after-write'
          ? `thread ${r.threads[1]} reads ${r.array}[${r.addr}], which thread ${r.threads[0]} wrote, with no sync() between`
          : `thread ${r.threads[1]} overwrites ${r.array}[${r.addr}], which thread ${r.threads[0]} read, with no sync() between`;
    const fix =
      r.space === 'global' && r.kind === 'write-write'
        ? 'Use atomicAdd for a shared total, or give each thread its own output slot.'
        : r.space === 'global'
          ? 'Threads in different blocks cannot wait for each other inside one kernel.'
          : 'Add sync() between the write and the read so the whole block sees the value.';
    out.push({ level: 'warn', title: `Data race (${r.kind}) on ${r.array}, ${r.space} memory`, text: `On line ${r.line}, ${what}. ${fix}`, line: r.line });
  }
  if (!g.correct) return out;

  // Performance diagnostics, biggest first.
  const perf: (Hint & { weight: number })[] = [];
  if (launch.block % 32 !== 0)
    perf.push({
      level: 'perf',
      weight: 1 - s.laneUtilization,
      title: 'Block size is not a multiple of 32',
      text: `A block of ${launch.block} threads fills ${Math.ceil(launch.block / 32)} warps, the last one only ${launch.block % 32} lanes. Lanes busy on average: ${pct(s.laneUtilization)}.`,
    });
  if (launch.grid < MACHINE.sms)
    perf.push({ level: 'perf', weight: 0.5, title: 'Idle SMs', text: `Only ${launch.grid} block${launch.grid === 1 ? '' : 's'}, but the GPU has ${MACHINE.sms} SMs: each block runs on one SM, so the others wait.` });
  if (launch.block <= 64 && launch.grid > 64)
    perf.push({ level: 'perf', weight: 0.4, title: 'Many small blocks', text: `${launch.grid} blocks each pay a start-up cost of ${MACHINE.blockOverheadCycles} cycles. Larger blocks (128 to 512 threads) amortize it.` });
  if (s.divergentBranches >= Math.max(2, s.warps / 2)) {
    const wl = worstLine(run.traces, (e) => (e.diverged ? 1 : 0));
    perf.push({
      level: 'perf',
      weight: Math.min(1, s.divergentBranches / s.warps / 2),
      title: 'Warps are diverging',
      text: `${s.divergentBranches.toLocaleString()} branches split a warp (${(s.divergentBranches / s.warps).toFixed(1)} per warp)${wl ? `, mostly on line ${wl.line}` : ''}. Both sides then run one after the other with some lanes switched off. Make the branch the same for all 32 lanes of a warp, or compute with a select (c ? x : y) instead of if/else.`,
      ...(wl ? { line: wl.line } : {}),
    });
  }
  if (s.globalTransactions > 0 && s.coalescing < 0.75) {
    const wl = worstLine(run.traces, (e) => (e.mem && e.mem.space === 'global' ? e.mem.transactions - 1 : 0));
    perf.push({
      level: 'perf',
      weight: 1 - s.coalescing,
      title: 'Uncoalesced memory access',
      text: `Warps fetched ${s.globalTransactions} segments where ${s.idealTransactions} would do (${pct(s.coalescing)} efficient)${wl ? `, worst on line ${wl.line}` : ''}. Have lane k of a warp touch element base + k, not base + k × stride. ${s.coalescing >= 0.4 ? 'At around 50%, accesses are often just misaligned (i + k straddles two segments); reading each element once into shared memory avoids paying for it again and again.' : ''}`,
      ...(wl ? { line: wl.line } : {}),
    });
  }
  if (s.worstBankConflict >= 4) {
    const wl = worstLine(run.traces, (e) => (e.mem && e.mem.space === 'shared' ? e.mem.conflict - 1 : 0));
    perf.push({
      level: 'perf',
      weight: Math.min(1, s.worstBankConflict / 16),
      title: 'Shared memory bank conflicts',
      text: `Up to ${s.worstBankConflict} lanes hit the same bank at once${wl ? ` (line ${wl.line})` : ''}, costing ${s.bankConflictCycles} extra cycles. Word k is in bank k % 32: index shared arrays with threadIdx.x, not 2 × stride × threadIdx.x.`,
      ...(wl ? { line: wl.line } : {}),
    });
  }
  if (s.atomics > 0 && s.atomicHotspot * MACHINE.atomicUnitCycles > Math.max(...s.smCycles) * 0.5)
    perf.push({
      level: 'perf',
      weight: 0.9,
      title: 'Atomic hotspot',
      text: `${s.atomicHotspot.toLocaleString()} atomics hit one address; they are applied one at a time (${(s.atomicHotspot * MACHINE.atomicUnitCycles).toLocaleString()} cycles). Combine within a block in shared memory first, and send one atomic per block.`,
    });
  else if (s.atomics > 0 && s.atomics > launch.grid * 32)
    perf.push({
      level: 'perf',
      weight: 0.3,
      title: 'Many atomics',
      text: `${s.atomics.toLocaleString()} atomic operations. Each warp queues its lanes that hit the same address. Accumulate in a register or a shared array first.`,
    });
  perf.sort((a, b) => b.weight - a.weight);
  for (const p of perf) out.push({ level: p.level, title: p.title, text: p.text, ...(p.line ? { line: p.line } : {}) });
  if (g.stars === 3) out.push({ level: 'good', title: 'Par or better', text: `${s.gpuCycles.toLocaleString()} cycles against par ${g.par.toLocaleString()}.` });
  else if (perf.length === 0)
    out.push({
      level: 'perf',
      title: `${g.ratio.toFixed(2)}× par`,
      text: 'Nothing obviously wasteful stands out. Look at how many instructions each thread runs, and whether fewer, busier threads would do less repeated work.',
    });
  return out;
}
