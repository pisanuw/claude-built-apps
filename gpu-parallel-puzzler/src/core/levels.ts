import type { Launch } from './gpu';

export interface LaunchRules {
  /** Allowed block sizes (empty = any 1..1024). */
  blocks?: number[];
  /** Largest grid allowed. */
  maxGrid?: number;
  /** Fixed block size. */
  fixedBlock?: number;
}

export interface Level {
  id: string;
  title: string;
  /** The idea this level teaches, in a few words. */
  concept: string;
  /** What to do, in a few sentences. */
  brief: string[];
  inputs: () => Record<string, number[]>;
  /** Output arrays and their lengths (zero-filled before each run). */
  outputs: Record<string, number>;
  params: Record<string, number>;
  expected: (inputs: Record<string, number[]>) => Record<string, number[]>;
  starter: string;
  starterLaunch: Launch;
  rules: LaunchRules;
  /** A three-star solution; its cost is par. Hidden until the level is solved. */
  reference: string;
  referenceLaunch: Launch;
  /** What is wrong with the starter, for tests and the level list. */
  starterProblem: 'incomplete' | 'error' | 'race' | 'slow';
}

/** Small deterministic generator so every student gets the same data. */
export function seeded(seed: number, n: number, max: number): number[] {
  let x = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out.push(x % max);
  }
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const f = (x: number) => {
  for (let k = 0; k < 24; k++) x = (x * 5 + 1) % 1009;
  return x;
};
const g = (x: number) => {
  for (let k = 0; k < 24; k++) x = (x * 7 + 3) % 1013;
  return x;
};

export const LEVELS: readonly Level[] = [
  {
    id: 'index',
    title: 'One thread per element',
    concept: 'threadIdx, blockIdx and the grid',
    brief: [
      'Double every element: out[i] = 2 * a[i] for all 1,024 elements.',
      'Each thread knows only its position: threadIdx.x inside its block and blockIdx.x for the block. The starter uses only threadIdx.x and launches one block of 256 threads, so most of the array is never touched.',
      'Give every thread a global index and launch enough blocks to cover the array.',
    ],
    inputs: () => ({ a: seeded(1, 1024, 100) }),
    outputs: { out: 1024 },
    params: { n: 1024 },
    expected: ({ a }) => ({ out: a.map((x) => 2 * x) }),
    starter: `// One thread per element.\nlet i = threadIdx.x;\nout[i] = 2 * a[i];\n`,
    starterLaunch: { grid: 1, block: 256 },
    rules: {},
    reference: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nout[i] = 2 * a[i];\n`,
    referenceLaunch: { grid: 4, block: 256 },
    starterProblem: 'incomplete',
  },
  {
    id: 'bounds',
    title: 'Off the end',
    concept: 'bounds checks',
    brief: [
      'Add two vectors: out[i] = a[i] + b[i], with n = 1,000.',
      'Blocks come in whole sizes, so a grid that covers 1,000 elements has some threads left over. The starter lets them write past the end of the array.',
      'Keep the extra threads from touching memory.',
    ],
    inputs: () => ({ a: seeded(2, 1000, 100), b: seeded(3, 1000, 100) }),
    outputs: { out: 1000 },
    params: { n: 1000 },
    expected: ({ a, b }) => ({ out: a.map((x, i) => x + b[i]) }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nout[i] = a[i] + b[i];\n`,
    starterLaunch: { grid: 4, block: 256 },
    rules: {},
    reference: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  out[i] = a[i] + b[i];\n}\n`,
    referenceLaunch: { grid: 4, block: 256 },
    starterProblem: 'error',
  },
  {
    id: 'warps',
    title: 'Warp-sized blocks',
    concept: 'warps of 32 lanes; block size',
    brief: [
      'Square 4,096 numbers: out[i] = a[i] * a[i]. The kernel is already right.',
      'The hardware runs threads 32 at a time, in warps. A block of 48 threads is one full warp and one warp with 16 idle lanes, and every block has a fixed start-up cost.',
      'Only the launch needs changing: pick a block size and grid that keep every lane busy.',
    ],
    inputs: () => ({ a: seeded(4, 4096, 50) }),
    outputs: { out: 4096 },
    params: { n: 4096 },
    expected: ({ a }) => ({ out: a.map((x) => x * x) }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  out[i] = a[i] * a[i];\n}\n`,
    starterLaunch: { grid: 86, block: 48 },
    rules: {},
    reference: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  out[i] = a[i] * a[i];\n}\n`,
    referenceLaunch: { grid: 16, block: 256 },
    starterProblem: 'slow',
  },
  {
    id: 'divergence',
    title: 'Branches that split a warp',
    concept: 'divergence',
    brief: [
      'Even elements go through one 24-step loop, odd elements through another (multiply-add, then remainder).',
      'The starter branches on i % 2, so every warp has lanes on both sides. A warp cannot run two paths at once: it runs the even path with the odd lanes switched off, then the odd path. Half of every lane sits idle.',
      'Get the same answers without making a warp take both paths. Hint: the two loops differ only in their constants.',
    ],
    inputs: () => ({ a: seeded(5, 4096, 1000) }),
    outputs: { out: 4096 },
    params: { n: 4096 },
    expected: ({ a }) => ({ out: a.map((x, i) => (i % 2 === 0 ? f(x) : g(x))) }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  let x = a[i];\n  if (i % 2 == 0) {\n    for (let k = 0; k < 24; k++) { x = (x * 5 + 1) % 1009; }\n  } else {\n    for (let k = 0; k < 24; k++) { x = (x * 7 + 3) % 1013; }\n  }\n  out[i] = x;\n}\n`,
    starterLaunch: { grid: 16, block: 256 },
    rules: {},
    reference: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  let even = i % 2 == 0;\n  let m = even ? 5 : 7;\n  let c = even ? 1 : 3;\n  let p = even ? 1009 : 1013;\n  let x = a[i];\n  for (let k = 0; k < 24; k++) { x = (x * m + c) % p; }\n  out[i] = x;\n}\n`,
    referenceLaunch: { grid: 16, block: 256 },
    starterProblem: 'slow',
  },
  {
    id: 'grid-stride',
    title: 'More elements than threads',
    concept: 'grid-stride loops',
    brief: [
      'Compute out[i] = 3 * a[i] + 1 for n = 20,000 elements.',
      'This launch is capped at 8 blocks of 256 threads: 2,048 threads for 20,000 elements. Each thread has to handle several elements.',
      'Loop so that every element is covered exactly once, and stop at n.',
    ],
    inputs: () => ({ a: seeded(6, 20000, 100) }),
    outputs: { out: 20000 },
    params: { n: 20000 },
    expected: ({ a }) => ({ out: a.map((x) => 3 * x + 1) }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  out[i] = 3 * a[i] + 1;\n}\n`,
    starterLaunch: { grid: 8, block: 256 },
    rules: { maxGrid: 8, fixedBlock: 256 },
    reference: `let stride = gridDim.x * blockDim.x;\nfor (let i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += stride) {\n  out[i] = 3 * a[i] + 1;\n}\n`,
    referenceLaunch: { grid: 8, block: 256 },
    starterProblem: 'incomplete',
  },
  {
    id: 'coalescing',
    title: 'Chunks or stripes',
    concept: 'memory coalescing',
    brief: [
      'Same job as before on 16,384 elements: out[i] = 3 * a[i] + 1, with 8 blocks of 256 threads.',
      'The starter gives each thread its own chunk of 8 neighbouring elements, which is how you would split work between CPU cores. On a GPU the 32 lanes of a warp read memory together; when lane k reads element 8k, the warp touches 8 times as many 128-byte segments as it needs.',
      'Keep the answers, but make neighbouring lanes read neighbouring elements.',
    ],
    inputs: () => ({ a: seeded(7, 16384, 100) }),
    outputs: { out: 16384 },
    params: { n: 16384 },
    expected: ({ a }) => ({ out: a.map((x) => 3 * x + 1) }),
    starter: `let t = blockIdx.x * blockDim.x + threadIdx.x;\n// Each thread takes 8 neighbouring elements.\nfor (let k = 0; k < 8; k++) {\n  let i = t * 8 + k;\n  if (i < n) {\n    out[i] = 3 * a[i] + 1;\n  }\n}\n`,
    starterLaunch: { grid: 8, block: 256 },
    rules: { maxGrid: 8, fixedBlock: 256 },
    reference: `let stride = gridDim.x * blockDim.x;\nfor (let i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += stride) {\n  out[i] = 3 * a[i] + 1;\n}\n`,
    referenceLaunch: { grid: 8, block: 256 },
    starterProblem: 'slow',
  },
  {
    id: 'race',
    title: 'Everyone writes one counter',
    concept: 'data races and atomics',
    brief: [
      'Count the elements of a that are at least 50, into out[0]. n = 8,192.',
      'The starter does out[0] += 1. That is a read, an add and a write; when 32 lanes do it at once they all read the same old value. The count comes out wrong and the race detector flags it.',
      'Make it correct first (atomicAdd), then make it fast: thousands of atomics on one address queue up behind each other. Count within the block first.',
    ],
    inputs: () => ({ a: seeded(8, 8192, 100) }),
    outputs: { out: 1 },
    params: { n: 8192 },
    expected: ({ a }) => ({ out: [a.filter((x) => x >= 50).length] }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n && a[i] >= 50) {\n  out[0] += 1;\n}\n`,
    starterLaunch: { grid: 32, block: 256 },
    rules: {},
    reference: `shared s[256];\nlet t = threadIdx.x;\nlet i = blockIdx.x * blockDim.x + t;\nlet c = 0;\nfor (; i < n; i += gridDim.x * blockDim.x) {\n  c += a[i] >= 50 ? 1 : 0;\n}\ns[t] = c;\nsync();\nfor (let st = blockDim.x / 2; st > 0; st = st / 2) {\n  if (t < st) { s[t] += s[t + st]; }\n  sync();\n}\nif (t == 0) { atomicAdd(out, 0, s[0]); }\n`,
    referenceLaunch: { grid: 8, block: 256 },
    starterProblem: 'race',
  },
  {
    id: 'reduce',
    title: 'Sum in shared memory',
    concept: 'shared memory and sync()',
    brief: [
      'Sum all 16,384 elements of a into out[0].',
      'The starter is correct but sends one atomic per element to the same address. A block can do better: put its values in a shared array, add pairs in a tree (halving the active threads each round), and send one atomic per block.',
      'Between rounds every thread must wait for the others with sync(), or it may read a partial sum that is not there yet.',
    ],
    inputs: () => ({ a: seeded(9, 16384, 100) }),
    outputs: { out: 1 },
    params: { n: 16384 },
    expected: ({ a }) => ({ out: [a.reduce((x, y) => x + y, 0)] }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  atomicAdd(out, 0, a[i]);\n}\n`,
    starterLaunch: { grid: 64, block: 256 },
    rules: {},
    reference: `shared s[256];\nlet t = threadIdx.x;\nlet sum = 0;\nfor (let i = blockIdx.x * blockDim.x + t; i < n; i += gridDim.x * blockDim.x) {\n  sum += a[i];\n}\ns[t] = sum;\nsync();\nfor (let st = blockDim.x / 2; st > 0; st = st / 2) {\n  if (t < st) { s[t] += s[t + st]; }\n  sync();\n}\nif (t == 0) { atomicAdd(out, 0, s[0]); }\n`,
    referenceLaunch: { grid: 8, block: 256 },
    starterProblem: 'slow',
  },
  {
    id: 'barrier',
    title: 'A barrier in a branch',
    concept: 'where sync() may go',
    brief: [
      'The same block sum, n = 8,192, already written as a tree, but it stops with an error.',
      'sync() makes every thread of the block wait until all of them reach it. Here it sits inside if (t < st), which only some threads enter, so the others never arrive.',
      'Move the barrier so every thread reaches it, every round.',
    ],
    inputs: () => ({ a: seeded(10, 8192, 100) }),
    outputs: { out: 1 },
    params: { n: 8192 },
    expected: ({ a }) => ({ out: [a.reduce((x, y) => x + y, 0)] }),
    starter: `shared s[256];\nlet t = threadIdx.x;\nlet i = blockIdx.x * blockDim.x + t;\ns[t] = i < n ? a[i] : 0;\nsync();\nfor (let st = blockDim.x / 2; st > 0; st = st / 2) {\n  if (t < st) {\n    s[t] += s[t + st];\n    sync();\n  }\n}\nif (t == 0) { atomicAdd(out, 0, s[0]); }\n`,
    starterLaunch: { grid: 32, block: 256 },
    rules: {},
    reference: `shared s[256];\nlet t = threadIdx.x;\nlet i = blockIdx.x * blockDim.x + t;\ns[t] = i < n ? a[i] : 0;\nsync();\nfor (let st = blockDim.x / 2; st > 0; st = st / 2) {\n  if (t < st) {\n    s[t] += s[t + st];\n  }\n  sync();\n}\nif (t == 0) { atomicAdd(out, 0, s[0]); }\n`,
    referenceLaunch: { grid: 32, block: 256 },
    starterProblem: 'error',
  },
  {
    id: 'banks',
    title: 'Bank conflicts',
    concept: 'shared memory banks',
    brief: [
      'Block sums again (n = 8,192), with a different tree.',
      "Shared memory is split into 32 banks; word k lives in bank k % 32, and a warp can read one word from each bank per cycle. The starter's tree has thread t work on s[2 * st * t], so lanes land on the same bank and queue up: in the later rounds, eight or sixteen deep.",
      'Same additions, different addressing: have thread t combine s[t] and s[t + st] so that neighbouring lanes use neighbouring words.',
    ],
    inputs: () => ({ a: seeded(11, 8192, 100) }),
    outputs: { out: 1 },
    params: { n: 8192 },
    expected: ({ a }) => ({ out: [a.reduce((x, y) => x + y, 0)] }),
    starter: `shared s[256];\nlet t = threadIdx.x;\nlet i = blockIdx.x * blockDim.x + t;\ns[t] = i < n ? a[i] : 0;\nsync();\nfor (let st = 1; st < blockDim.x; st = st * 2) {\n  let k = 2 * st * t;\n  if (k < blockDim.x) { s[k] += s[k + st]; }\n  sync();\n}\nif (t == 0) { atomicAdd(out, 0, s[0]); }\n`,
    starterLaunch: { grid: 32, block: 256 },
    rules: {},
    reference: `shared s[256];\nlet t = threadIdx.x;\nlet i = blockIdx.x * blockDim.x + t;\ns[t] = i < n ? a[i] : 0;\nsync();\nfor (let st = blockDim.x / 2; st > 0; st = st / 2) {\n  if (t < st) { s[t] += s[t + st]; }\n  sync();\n}\nif (t == 0) { atomicAdd(out, 0, s[0]); }\n`,
    referenceLaunch: { grid: 32, block: 256 },
    starterProblem: 'slow',
  },
  {
    id: 'stencil',
    title: 'Neighbours in a tile',
    concept: 'shared-memory tiling',
    brief: [
      'Moving sum: out[i] = a[i-4] + … + a[i+4] (nine elements; treat anything outside the array as 0). n = 8,192.',
      'The starter reads all nine neighbours from global memory, so every element is fetched nine times by different threads.',
      'Load each block’s elements once into a shared tile with four extra on each side (the halo), sync(), then add from the tile. Blocks are fixed at 256 threads.',
    ],
    inputs: () => ({ a: seeded(12, 8192, 100) }),
    outputs: { out: 8192 },
    params: { n: 8192 },
    expected: ({ a }) => ({ out: a.map((_, i) => range(9).reduce((s, k) => s + (a[i + k - 4] ?? 0), 0)) }),
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  let s = 0;\n  for (let k = -4; k <= 4; k++) {\n    let j = i + k;\n    if (j >= 0 && j < n) { s += a[j]; }\n  }\n  out[i] = s;\n}\n`,
    starterLaunch: { grid: 32, block: 256 },
    rules: { fixedBlock: 256 },
    reference: `shared tile[264];\nlet t = threadIdx.x;\nlet base = blockIdx.x * blockDim.x;\nlet i = base + t;\ntile[t + 4] = i < n ? a[i] : 0;\nif (t < 4) {\n  let l = base - 4 + t;\n  let r = base + blockDim.x + t;\n  tile[t] = l >= 0 ? a[max(l, 0)] : 0;\n  tile[t + blockDim.x + 4] = r < n ? a[min(r, n - 1)] : 0;\n}\nsync();\nif (i < n) {\n  let s = 0;\n  for (let k = 0; k < 9; k++) { s += tile[t + k]; }\n  out[i] = s;\n}\n`,
    referenceLaunch: { grid: 32, block: 256 },
    starterProblem: 'slow',
  },
  {
    id: 'histogram',
    title: 'Sixteen bins',
    concept: 'privatization',
    brief: [
      'Histogram: count how many elements of a fall in each of 16 bins (bin = a[i] % 16) into out[0..15]. n = 16,384.',
      'The starter is correct: one global atomic per element. But only 16 addresses take all 16,384 atomics, so they queue up.',
      'Give each block its own histogram in shared memory, fill it with shared atomics, then add it to out with 16 global atomics per block.',
    ],
    inputs: () => ({ a: seeded(13, 16384, 1000) }),
    outputs: { out: 16 },
    params: { n: 16384, bins: 16 },
    expected: ({ a }) => {
      const h = new Array(16).fill(0);
      for (const x of a) h[x % 16]++;
      return { out: h };
    },
    starter: `let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n  atomicAdd(out, a[i] % bins, 1);\n}\n`,
    starterLaunch: { grid: 64, block: 256 },
    rules: {},
    reference: `shared h[16];\nlet t = threadIdx.x;\nif (t < bins) { h[t] = 0; }\nsync();\nfor (let i = blockIdx.x * blockDim.x + t; i < n; i += gridDim.x * blockDim.x) {\n  atomicAdd(h, a[i] % bins, 1);\n}\nsync();\nif (t < bins) { atomicAdd(out, t, h[t]); }\n`,
    referenceLaunch: { grid: 8, block: 256 },
    starterProblem: 'slow',
  },
];

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** Apply a level's launch rules; returns a problem or null. */
export function checkLaunch(level: Level, launch: Launch): string | null {
  const r = level.rules;
  if (r.fixedBlock !== undefined && launch.block !== r.fixedBlock) return `This level uses blocks of ${r.fixedBlock} threads.`;
  if (r.maxGrid !== undefined && launch.grid > r.maxGrid) return `This level allows at most ${r.maxGrid} blocks.`;
  if (r.blocks && r.blocks.length && !r.blocks.includes(launch.block)) return `Block size must be one of ${r.blocks.join(', ')}.`;
  return null;
}
