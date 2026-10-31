import { type Expr, KernelError, type Program, type Stmt, parse } from './lang';

/** Lanes per warp, as on NVIDIA hardware. */
export const WARP = 32;

/**
 * The toy machine. Numbers are chosen to make the lessons visible, not to
 * match any real GPU: four SMs, each issuing from four warps per cycle;
 * one global-memory transaction moves 32 consecutive words (128 bytes).
 */
export const MACHINE = {
  sms: 4,
  schedulersPerSm: 4,
  /** Words per global memory transaction (a 128-byte segment of 4-byte words). */
  segmentWords: 32,
  /** Cycles per global memory transaction. */
  globalTxCycles: 4,
  /** Extra cycles per lane queued on the same address in an atomic. */
  atomicSerialCycles: 4,
  /** Cycles a single global address can absorb per atomic (whole-GPU bottleneck). */
  atomicUnitCycles: 2,
  sharedBanks: 32,
  /** Extra cycles for each additional address queued on one shared-memory bank. */
  bankConflictCycles: 2,
  blockOverheadCycles: 24,
  launchOverheadCycles: 200,
  maxThreadsPerBlock: 1024,
  maxSharedWords: 4096,
  gpuGHz: 1.5,
  cpuGHz: 4,
  /** Safety valve for runaway loops: warp instructions issued per launch. */
  maxIssues: 4_000_000,
} as const;

export interface Launch {
  grid: number;
  block: number;
}

export interface KernelData {
  /** Global arrays (inputs and outputs), copied before the run. */
  arrays: Record<string, ArrayLike<number>>;
  /** Read-only scalars such as n. */
  params: Record<string, number>;
}

export type Space = 'global' | 'shared';

export interface MemEvent {
  array: string;
  space: Space;
  kind: 'load' | 'store' | 'atomic';
  /** Address per lane (-1 for inactive lanes). */
  addrs: number[];
  transactions: number;
  /** Shared memory: the worst number of distinct addresses in one bank. */
  conflict: number;
}

export interface TraceEvent {
  line: number;
  kind: 'stmt' | 'branch' | 'mem' | 'sync' | 'return';
  /** Active lanes as a bit mask (bit i = lane i). */
  mask: number;
  cost: number;
  diverged?: boolean;
  mem?: MemEvent;
}

export type RaceKind = 'write-write' | 'read-after-write' | 'write-after-read';

export interface Race {
  kind: RaceKind;
  space: Space;
  array: string;
  addr: number;
  line: number;
  threads: [number, number];
  /** True when the two threads are in the same warp. */
  sameWarp: boolean;
}

export interface BlockTiming {
  block: number;
  sm: number;
  start: number;
  cycles: number;
  warps: number;
}

export interface Stats {
  issues: number;
  /** Sum over issues of active lanes. */
  laneOps: number;
  /** laneOps / (issues × 32): how full the warps were. */
  laneUtilization: number;
  branches: number;
  divergentBranches: number;
  globalAccesses: number;
  globalTransactions: number;
  idealTransactions: number;
  /** idealTransactions / globalTransactions. */
  coalescing: number;
  sharedAccesses: number;
  bankConflictCycles: number;
  worstBankConflict: number;
  syncs: number;
  atomics: number;
  /** Most atomic operations aimed at one global address. */
  atomicHotspot: number;
  gpuCycles: number;
  cpuCycles: number;
  gpuMicros: number;
  cpuMicros: number;
  smCycles: number[];
  threads: number;
  warps: number;
}

export interface RunResult {
  ok: boolean;
  error: { message: string; line: number; kind: 'syntax' | 'runtime' | 'launch'; thread?: number } | null;
  arrays: Record<string, Float64Array>;
  stats: Stats;
  blocks: BlockTiming[];
  /** Per-warp event traces for the first few blocks, keyed "block:warp". */
  traces: Record<string, TraceEvent[]>;
  races: Race[];
}

export interface RunOptions {
  /** Blocks whose warps are traced (default 2). */
  traceBlocks?: number;
  /** Events kept per traced warp (default 400). */
  traceEvents?: number;
  /** Override the runaway-loop limit (default MACHINE.maxIssues). */
  maxIssues?: number;
}

const BUILTINS = new Set(['threadIdx', 'blockIdx', 'blockDim', 'gridDim']);

type Mask = Uint8Array;

function anyOn(m: Mask): boolean {
  for (let i = 0; i < m.length; i++) if (m[i]) return true;
  return false;
}
function count(m: Mask): number {
  let c = 0;
  for (let i = 0; i < m.length; i++) c += m[i];
  return c;
}
function bits(m: Mask): number {
  let b = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) b |= 1 << i;
  return b >>> 0;
}
function sameMask(a: Mask, b: Mask): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function popcount(mask: number): number {
  let c = 0;
  let m = mask >>> 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/** Transactions for one warp's global access: distinct 32-word segments touched. */
export function transactionsFor(addrs: number[]): { transactions: number; ideal: number } {
  const segs = new Set<number>();
  const uniq = new Set<number>();
  for (const a of addrs) {
    if (a < 0) continue;
    segs.add(Math.floor(a / MACHINE.segmentWords));
    uniq.add(a);
  }
  return { transactions: segs.size, ideal: Math.ceil(uniq.size / MACHINE.segmentWords) };
}

/** Worst bank conflict for one warp's shared access (distinct addresses in the busiest bank; same address broadcasts). */
export function bankConflict(addrs: number[]): number {
  const banks = new Map<number, Set<number>>();
  for (const a of addrs) {
    if (a < 0) continue;
    const b = a % MACHINE.sharedBanks;
    if (!banks.has(b)) banks.set(b, new Set());
    (banks.get(b) as Set<number>).add(a);
  }
  let worst = 0;
  for (const s of banks.values()) worst = Math.max(worst, s.size);
  return worst;
}

function emptyStats(): Stats {
  return {
    issues: 0,
    laneOps: 0,
    laneUtilization: 0,
    branches: 0,
    divergentBranches: 0,
    globalAccesses: 0,
    globalTransactions: 0,
    idealTransactions: 0,
    coalescing: 1,
    sharedAccesses: 0,
    bankConflictCycles: 0,
    worstBankConflict: 0,
    syncs: 0,
    atomics: 0,
    atomicHotspot: 0,
    gpuCycles: 0,
    cpuCycles: 0,
    gpuMicros: 0,
    cpuMicros: 0,
    smCycles: [],
    threads: 0,
    warps: 0,
  };
}

interface AccessRecord {
  epoch: number;
  block: number;
  writer: number;
  readers: number[];
}

/** Compile and run a kernel. Never throws: errors come back in `error`. */
export function runKernel(source: string | Program, launch: Launch, data: KernelData, opts: RunOptions = {}): RunResult {
  const arrays: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(data.arrays)) arrays[k] = Float64Array.from(v);
  const stats = emptyStats();
  const result: RunResult = { ok: false, error: null, arrays, stats, blocks: [], traces: {}, races: [] };

  let program: Program;
  try {
    program = typeof source === 'string' ? parse(source) : source;
  } catch (e) {
    const err = e as KernelError;
    result.error = { message: err.message, line: err.line ?? 0, kind: 'syntax' };
    return result;
  }
  const launchProblem =
    !Number.isInteger(launch.block) || launch.block < 1
      ? 'block size must be a positive whole number'
      : launch.block > MACHINE.maxThreadsPerBlock
        ? `a block can hold at most ${MACHINE.maxThreadsPerBlock} threads`
        : !Number.isInteger(launch.grid) || launch.grid < 1
          ? 'grid size must be a positive whole number'
          : program.shared.reduce((a, s) => a + s.size, 0) > MACHINE.maxSharedWords
            ? `shared arrays use more than ${MACHINE.maxSharedWords} words per block`
            : null;
  if (launchProblem) {
    result.error = { message: launchProblem, line: 0, kind: 'launch' };
    return result;
  }
  const sharedNames = new Set(program.shared.map((s) => s.name));
  for (const name of sharedNames) {
    if (name in arrays) {
      result.error = { message: `shared array '${name}' has the same name as a global array`, line: 0, kind: 'syntax' };
      return result;
    }
  }

  const traceBlocks = opts.traceBlocks ?? 2;
  const traceEvents = opts.traceEvents ?? 400;
  const maxIssues = opts.maxIssues ?? MACHINE.maxIssues;
  const raceKeys = new Set<string>();
  const globalRec = new Map<string, AccessRecord>();
  const atomicCounts = new Map<string, number>();
  const warpsPerBlock = Math.ceil(launch.block / WARP);
  stats.threads = launch.grid * launch.block;
  stats.warps = launch.grid * warpsPerBlock;
  const smLoad = new Array<number>(MACHINE.sms).fill(0);

  const addRace = (r: Race) => {
    const key = `${r.kind}:${r.space}:${r.array}:${r.line}`;
    if (raceKeys.has(key) || result.races.length >= 20) return;
    raceKeys.add(key);
    result.races.push(r);
  };

  try {
    for (let b = 0; b < launch.grid; b++) {
      const shared: Record<string, Float64Array> = {};
      for (const s of program.shared) shared[s.name] = new Float64Array(s.size);
      const sharedRec = new Map<string, AccessRecord>();
      let epoch = 0;
      const warpCost: number[] = new Array(warpsPerBlock).fill(0);
      const segments: number[][] = [];

      const makeWarp = (w: number) => {
        const env = new Map<string, Float64Array>();
        const exited = new Uint8Array(WARP);
        const lanes = new Uint8Array(WARP);
        for (let l = 0; l < WARP; l++) lanes[l] = w * WARP + l < launch.block ? 1 : 0;
        const key = `${b}:${w}`;
        const trace: TraceEvent[] | null = b < traceBlocks ? [] : null;
        if (trace) result.traces[key] = trace;
        const tid = (l: number) => w * WARP + l;
        const gid = (l: number) => b * launch.block + tid(l);
        const live = (m: Mask): Mask => {
          const out = new Uint8Array(WARP);
          for (let l = 0; l < WARP; l++) out[l] = m[l] && !exited[l] ? 1 : 0;
          return out;
        };
        const issue = (m: Mask, cost: number) => {
          stats.issues++;
          stats.laneOps += count(m);
          warpCost[w] += cost;
          if (stats.issues > maxIssues) throw new KernelError(`stopped after ${maxIssues.toLocaleString()} warp instructions: is there a loop that never ends?`, 0, 'runtime');
        };
        const record = (ev: TraceEvent) => {
          if (trace && trace.length < traceEvents) trace.push(ev);
        };
        const fail = (msg: string, line: number, l?: number): never => {
          const err = new KernelError(msg, line, 'runtime') as KernelError & { thread?: number };
          if (l !== undefined) err.thread = gid(l);
          throw err;
        };

        const memory = (array: string, idx: Float64Array, m: Mask, kind: 'load' | 'store' | 'atomic', line: number, values?: Float64Array): Float64Array => {
          const space: Space = sharedNames.has(array) ? 'shared' : 'global';
          const store = space === 'shared' ? shared[array] : arrays[array];
          if (!store) fail(`'${array}' is not an array here`, line);
          const addrs: number[] = new Array(WARP).fill(-1);
          for (let l = 0; l < WARP; l++) {
            if (!m[l]) continue;
            const a = idx[l];
            if (!Number.isInteger(a)) fail(`${array}[${a}]: index is not a whole number`, line, l);
            if (a < 0 || a >= store.length) fail(`${array}[${a}] is out of bounds (${array} has ${store.length} elements)`, line, l);
            addrs[l] = a;
          }
          const out = new Float64Array(WARP);
          let cost = 1;
          let transactions = 0;
          let conflict = 0;
          if (space === 'global') {
            const t = transactionsFor(addrs);
            transactions = t.transactions;
            stats.globalAccesses++;
            stats.globalTransactions += t.transactions;
            stats.idealTransactions += t.ideal;
            cost += t.transactions * MACHINE.globalTxCycles;
          } else {
            conflict = bankConflict(addrs);
            stats.sharedAccesses++;
            const extra = Math.max(0, conflict - 1) * MACHINE.bankConflictCycles;
            stats.bankConflictCycles += extra;
            stats.worstBankConflict = Math.max(stats.worstBankConflict, conflict);
            cost += extra;
          }
          if (kind === 'atomic') {
            stats.atomics += count(m);
            const perAddr = new Map<number, number>();
            for (let l = 0; l < WARP; l++) if (m[l]) perAddr.set(addrs[l], (perAddr.get(addrs[l]) ?? 0) + 1);
            let worst = 0;
            for (const [a, c] of perAddr) {
              worst = Math.max(worst, c);
              if (space === 'global') {
                const k = `${array}:${a}`;
                const total = (atomicCounts.get(k) ?? 0) + c;
                atomicCounts.set(k, total);
                stats.atomicHotspot = Math.max(stats.atomicHotspot, total);
              }
            }
            cost += (worst - 1) * MACHINE.atomicSerialCycles;
          }
          // Do the access lane by lane, checking for races. Shared memory is
          // ordered only by sync(); global memory is never ordered between
          // blocks, and within a block only by sync().
          const recs = space === 'shared' ? sharedRec : globalRec;
          const conflicts = (r: AccessRecord) => r.block !== b || r.epoch === epoch;
          const warpOf = (other: number) => (space === 'shared' ? Math.floor(other / WARP) : Math.floor(other / launch.block) === b ? Math.floor((other % launch.block) / WARP) : -1);
          for (let l = 0; l < WARP; l++) {
            if (!m[l]) continue;
            const a = addrs[l];
            const me = space === 'shared' ? tid(l) : gid(l);
            const rk = `${array}:${a}`;
            const rec = recs.get(rk);
            const prior = rec && conflicts(rec) ? rec : null;
            const race = (kind: RaceKind, other: number) => addRace({ kind, space, array, addr: a, line, threads: [other, me], sameWarp: warpOf(other) === w });
            if (kind === 'load') {
              if (prior && prior.writer >= 0 && prior.writer !== me) race('read-after-write', prior.writer);
              out[l] = store[a];
              if (space === 'shared') {
                const r = prior ?? { epoch, block: b, writer: -1, readers: [] };
                if (r.readers.length < 2 && !r.readers.includes(me)) r.readers.push(me);
                recs.set(rk, r);
              }
            } else if (kind === 'store') {
              if (prior && prior.writer >= 0 && prior.writer !== me) race('write-write', prior.writer);
              else if (prior) {
                const other = prior.readers.find((r) => r !== me);
                if (other !== undefined) race('write-after-read', other);
              }
              store[a] = (values as Float64Array)[l];
              recs.set(rk, { epoch, block: b, writer: me, readers: prior ? prior.readers : [] });
            } else {
              out[l] = store[a];
              store[a] += (values as Float64Array)[l];
            }
          }
          issue(m, cost);
          record({ line, kind: 'mem', mask: bits(m), cost, mem: { array, space, kind, addrs, transactions, conflict } });
          return out;
        };

        const ev = (e: Expr, m: Mask): Float64Array => {
          const out = new Float64Array(WARP);
          switch (e.k) {
            case 'num':
              out.fill(e.v);
              return out;
            case 'var': {
              if (data.params[e.name] !== undefined) {
                out.fill(data.params[e.name]);
                return out;
              }
              const v = env.get(e.name);
              if (!v) fail(`'${e.name}' is not defined (declare it with let)`, e.line);
              return v as Float64Array;
            }
            case 'builtin':
              for (let l = 0; l < WARP; l++)
                out[l] = e.name === 'threadIdx' ? tid(l) : e.name === 'blockIdx' ? b : e.name === 'blockDim' ? launch.block : launch.grid;
              return out;
            case 'index': {
              const idx = ev(e.index, m);
              return memory(e.array, idx, m, 'load', e.line);
            }
            case 'unary': {
              const v = ev(e.e, m);
              issue(m, 1);
              for (let l = 0; l < WARP; l++) out[l] = e.op === '-' ? -v[l] : v[l] ? 0 : 1;
              return out;
            }
            case 'binary': {
              if (e.op === '&&' || e.op === '||') {
                const a = ev(e.a, m);
                const sub = new Uint8Array(WARP);
                for (let l = 0; l < WARP; l++) sub[l] = m[l] && (e.op === '&&' ? a[l] !== 0 : a[l] === 0) ? 1 : 0;
                const bv = anyOn(sub) ? ev(e.b, sub) : out;
                issue(m, 1);
                for (let l = 0; l < WARP; l++) out[l] = sub[l] ? (bv[l] !== 0 ? 1 : 0) : e.op === '&&' ? 0 : a[l] !== 0 ? 1 : 0;
                return out;
              }
              const a = ev(e.a, m);
              const bv = ev(e.b, m);
              issue(m, 1);
              for (let l = 0; l < WARP; l++) {
                if (!m[l]) continue;
                const x = a[l];
                const y = bv[l];
                switch (e.op) {
                  case '+': out[l] = x + y; break;
                  case '-': out[l] = x - y; break;
                  case '*': out[l] = x * y; break;
                  case '/':
                    if (Number.isInteger(x) && Number.isInteger(y)) {
                      if (y === 0) fail('integer division by zero', e.line, l);
                      out[l] = Math.trunc(x / y);
                    } else out[l] = x / y;
                    break;
                  case '%':
                    if (y === 0) fail('remainder by zero', e.line, l);
                    out[l] = x % y;
                    break;
                  case '==': out[l] = x === y ? 1 : 0; break;
                  case '!=': out[l] = x !== y ? 1 : 0; break;
                  case '<': out[l] = x < y ? 1 : 0; break;
                  case '<=': out[l] = x <= y ? 1 : 0; break;
                  case '>': out[l] = x > y ? 1 : 0; break;
                  case '>=': out[l] = x >= y ? 1 : 0; break;
                }
              }
              return out;
            }
            case 'cond': {
              // Both sides run under a predicate: a select, not a branch.
              const c = ev(e.c, m);
              const mt = new Uint8Array(WARP);
              const mf = new Uint8Array(WARP);
              for (let l = 0; l < WARP; l++) {
                mt[l] = m[l] && c[l] !== 0 ? 1 : 0;
                mf[l] = m[l] && c[l] === 0 ? 1 : 0;
              }
              const tv = anyOn(mt) ? ev(e.t, mt) : out;
              const fv = anyOn(mf) ? ev(e.f, mf) : out;
              issue(m, 1);
              for (let l = 0; l < WARP; l++) out[l] = mt[l] ? tv[l] : fv[l];
              return out;
            }
            case 'call': {
              if (e.name === 'atomicAdd') {
                const arr = (e.args[0] as { name: string }).name;
                const idx = ev(e.args[1], m);
                const val = ev(e.args[2], m);
                return memory(arr, idx, m, 'atomic', e.line, val);
              }
              const args = e.args.map((a) => ev(a, m));
              issue(m, 1);
              for (let l = 0; l < WARP; l++) {
                const x = args[0][l];
                out[l] =
                  e.name === 'min' ? Math.min(x, args[1][l]) : e.name === 'max' ? Math.max(x, args[1][l]) : e.name === 'abs' ? Math.abs(x) : e.name === 'floor' ? Math.floor(x) : Math.sqrt(x);
              }
              return out;
            }
          }
        };

        const assign = (s: Extract<Stmt, { k: 'assign' }>, m: Mask) => {
          const value = ev(s.value, m);
          if (s.target.k === 'var') {
            const name = s.target.name;
            if (data.params[name] !== undefined) fail(`'${name}' is a read-only parameter`, s.line);
            if (BUILTINS.has(name)) fail(`'${name}' cannot be assigned`, s.line);
            const cur = env.get(name);
            if (!cur) fail(`'${name}' is not defined (declare it with let)`, s.line);
            const next = Float64Array.from(cur as Float64Array);
            for (let l = 0; l < WARP; l++) if (m[l]) next[l] = combine(s.op, next[l], value[l], s.line, l);
            env.set(name, next);
            issue(m, 1);
            record({ line: s.line, kind: 'stmt', mask: bits(m), cost: 1 });
          } else {
            const idx = ev(s.target.index, m);
            let v = value;
            if (s.op !== '=') {
              const old = memory(s.target.array, idx, m, 'load', s.line);
              v = new Float64Array(WARP);
              for (let l = 0; l < WARP; l++) if (m[l]) v[l] = combine(s.op, old[l], value[l], s.line, l);
            }
            memory(s.target.array, idx, m, 'store', s.line, v);
          }
        };
        const combine = (op: string, a: number, b2: number, line: number, l: number): number => {
          switch (op) {
            case '=': return b2;
            case '+=': return a + b2;
            case '-=': return a - b2;
            case '*=': return a * b2;
            default:
              if (Number.isInteger(a) && Number.isInteger(b2)) {
                if (b2 === 0) fail('integer division by zero', line, l);
                return Math.trunc(a / b2);
              }
              return a / b2;
          }
        };

        function* exec(s: Stmt, mask: Mask): Generator<'sync', void> {
          const m = live(mask);
          if (!anyOn(m)) return;
          switch (s.k) {
            case 'block':
              for (const t of s.body) yield* exec(t, m);
              return;
            case 'let': {
              const v = ev(s.init, m);
              const cur = env.get(s.name) ?? new Float64Array(WARP);
              const next = Float64Array.from(cur);
              for (let l = 0; l < WARP; l++) if (m[l]) next[l] = v[l];
              env.set(s.name, next);
              issue(m, 1);
              record({ line: s.line, kind: 'stmt', mask: bits(m), cost: 1 });
              return;
            }
            case 'assign':
              assign(s, m);
              return;
            case 'expr':
              ev(s.e, m);
              return;
            case 'shared':
              return;
            case 'return':
              for (let l = 0; l < WARP; l++) if (m[l]) exited[l] = 1;
              record({ line: s.line, kind: 'return', mask: bits(m), cost: 0 });
              return;
            case 'sync': {
              const alive = live(lanes);
              if (!sameMask(m, alive)) fail('sync() was reached by only some threads of a warp (it is inside a branch they did not all take); a barrier must be reached by every thread of the block', s.line);
              issue(m, 1);
              stats.syncs++;
              record({ line: s.line, kind: 'sync', mask: bits(m), cost: 1 });
              yield 'sync';
              return;
            }
            case 'if': {
              const c = ev(s.c, m);
              const mt = new Uint8Array(WARP);
              const mf = new Uint8Array(WARP);
              for (let l = 0; l < WARP; l++) {
                mt[l] = m[l] && c[l] !== 0 ? 1 : 0;
                mf[l] = m[l] && c[l] === 0 ? 1 : 0;
              }
              const diverged = anyOn(mt) && anyOn(mf);
              stats.branches++;
              if (diverged) stats.divergentBranches++;
              issue(m, 1);
              record({ line: s.line, kind: 'branch', mask: bits(m), cost: 1, diverged });
              if (anyOn(mt)) yield* exec(s.then, mt);
              if (s.else && anyOn(mf)) yield* exec(s.else, mf);
              return;
            }
            case 'while':
            case 'for': {
              if (s.k === 'for' && s.init) yield* exec(s.init, m);
              let cur = live(m);
              for (;;) {
                cur = live(cur);
                if (!anyOn(cur)) return;
                const cond = s.c ? ev(s.c, cur) : null;
                const nextMask = new Uint8Array(WARP);
                for (let l = 0; l < WARP; l++) nextMask[l] = cur[l] && (cond === null || cond[l] !== 0) ? 1 : 0;
                const diverged = anyOn(nextMask) && !sameMask(nextMask, cur);
                stats.branches++;
                if (diverged) stats.divergentBranches++;
                issue(cur, 1);
                record({ line: s.line, kind: 'branch', mask: bits(cur), cost: 1, diverged });
                if (!anyOn(nextMask)) return;
                cur = nextMask;
                yield* exec(s.body, cur);
                if (s.k === 'for' && s.update) yield* exec(s.update, cur);
              }
            }
          }
        }

        function* run(): Generator<'sync', void> {
          for (const s of program.body) yield* exec(s, lanes);
        }
        return run();
      };

      const gens = Array.from({ length: warpsPerBlock }, (_, w) => makeWarp(w));
      const done = new Array<boolean>(warpsPerBlock).fill(false);
      for (;;) {
        const startCost = warpCost.slice();
        let atBarrier = 0;
        for (let w = 0; w < warpsPerBlock; w++) {
          if (done[w]) continue;
          const r = gens[w].next();
          if (r.done) done[w] = true;
          else atBarrier++;
        }
        segments.push(warpCost.map((c, i) => c - startCost[i]));
        if (atBarrier === 0) break;
        epoch++;
      }
      let blockCycles = 0;
      for (const seg of segments) {
        const max = Math.max(...seg);
        const sum = seg.reduce((a, c) => a + c, 0);
        blockCycles += Math.max(max, Math.ceil(sum / MACHINE.schedulersPerSm));
      }
      blockCycles += MACHINE.blockOverheadCycles;
      let sm = 0;
      for (let i = 1; i < MACHINE.sms; i++) if (smLoad[i] < smLoad[sm]) sm = i;
      result.blocks.push({ block: b, sm, start: smLoad[sm], cycles: blockCycles, warps: warpsPerBlock });
      smLoad[sm] += blockCycles;
    }
  } catch (e) {
    const err = e as KernelError & { thread?: number };
    if (!(err instanceof KernelError)) throw e;
    result.error = { message: err.message, line: err.line, kind: 'runtime', ...(err.thread !== undefined ? { thread: err.thread } : {}) };
  }

  stats.smCycles = smLoad;
  stats.laneUtilization = stats.issues ? stats.laneOps / (stats.issues * WARP) : 0;
  stats.coalescing = stats.globalTransactions ? stats.idealTransactions / stats.globalTransactions : 1;
  const busiest = Math.max(...smLoad);
  stats.gpuCycles = MACHINE.launchOverheadCycles + Math.max(busiest, stats.atomicHotspot * MACHINE.atomicUnitCycles);
  stats.cpuCycles = stats.laneOps;
  stats.gpuMicros = stats.gpuCycles / MACHINE.gpuGHz / 1000;
  stats.cpuMicros = stats.cpuCycles / MACHINE.cpuGHz / 1000;
  result.ok = result.error === null;
  return result;
}
