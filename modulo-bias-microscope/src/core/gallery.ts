import type { TargetSpec } from './target';

export interface GalleryEntry {
  id: string;
  title: string;
  /** One line naming the bug. */
  bug: string;
  /** Why it is wrong, written so a student can check the numbers by hand. */
  explanation: string;
  args: unknown[];
  target: TargetSpec;
  bits: number;
  broken: string;
  fixed: string;
  fixName: string;
}

const REJECTION = `// Rejection sampling: throw away the top sliver that
// does not divide evenly, then reduce.
function sample(rng, n) {
  const range = 2 ** rng.bits;
  const limit = range - (range % n); // largest multiple of n
  let x;
  do {
    x = rng.next();
  } while (x >= limit);
  return x % n;
}`;

const FISHER_YATES = `// Fisher-Yates: position i swaps with a random index in 0..i,
// giving n! equally likely paths for n! permutations.
function sample(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}`;

export const GALLERY: GalleryEntry[] = [
  {
    id: 'modulo',
    title: 'Modulo bias',
    bug: 'rng.next() % n favours the low outcomes',
    explanation:
      'With an 8-bit source there are 256 equally likely values. 256 = 6 × 42 + 4, so the remainders 0 to 3 each come from 43 values and 4 and 5 from only 42: 43/256 against 42/256. A 32-bit source has the same flaw, with an error around one in a billion: far too small for any histogram, but exact mode on a narrow source shows it in one run.',
    args: [6],
    target: { kind: 'uniform-int', n: 6 },
    bits: 8,
    broken: `// Roll a fair die: return 0..n-1.
function sample(rng, n) {
  return rng.next() % n;
}`,
    fixed: REJECTION,
    fixName: 'rejection sampling',
  },
  {
    id: 'float-scale',
    title: 'Scaling a float',
    bug: 'Math.floor(rng.random() * n) moves the bias, it does not remove it',
    explanation:
      'random() is still one of 256 evenly spaced values, and 256 values cannot split evenly into 6 buckets. Scaling spreads the leftover values across the range (faces 0, 1, 3 and 4 get 43/256) instead of piling them at the bottom, which is why it looks fair in a histogram. With 53-bit doubles the error is tiny but still there.',
    args: [6],
    target: { kind: 'uniform-int', n: 6 },
    bits: 8,
    broken: `// "Multiply then floor" instead of modulo.
function sample(rng, n) {
  return Math.floor(rng.random() * n);
}`,
    fixed: REJECTION,
    fixName: 'rejection sampling',
  },
  {
    id: 'off-by-one',
    title: 'Off-by-one range',
    bug: 'min + below(max − min) never returns max',
    explanation:
      'The die should land on 1..6 inclusive, which is 6 values, but below(max - min) has only 5. Every unit test that checks "result is between 1 and 6" passes; only the distribution shows that 6 is missing and the others are 1/5 instead of 1/6.',
    args: [1, 6],
    target: { kind: 'uniform-int', n: 6, offset: 1 },
    bits: 8,
    broken: `// Inclusive range min..max.
function sample(rng, min, max) {
  return min + rng.below(max - min);
}`,
    fixed: `// max - min + 1 values in an inclusive range.
function sample(rng, min, max) {
  return min + rng.below(max - min + 1);
}`,
    fixName: 'count both ends',
  },
  {
    id: 'naive-shuffle',
    title: 'Naive shuffle',
    bug: 'swapping with any index gives n^n paths for n! permutations',
    explanation:
      'Each of the 3 steps picks one of 3 indexes, so there are 27 equally likely paths. 27 is not a multiple of 3! = 6, so the six orders cannot all get 1/6: three get 5/27 and three get 4/27. The index draws here are perfectly fair (rng.below); the algorithm alone is biased.',
    args: [[0, 1, 2]],
    target: { kind: 'permutations', n: 3 },
    bits: 8,
    broken: `// Swap every position with a random position.
function sample(rng, a) {
  for (let i = 0; i < a.length; i++) {
    const j = rng.below(a.length);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}`,
    fixed: FISHER_YATES,
    fixName: 'Fisher-Yates',
  },
  {
    id: 'sort-shuffle',
    title: 'Shuffle by random comparator',
    bug: 'a.sort(() => coin flip) depends on the sort algorithm',
    explanation:
      'The comparator answers at random, so the result depends on which comparisons the engine’s sort happens to make, and every outcome has a power-of-two denominator. No power of two divides into sixths, so the result cannot be uniform. It can also differ between browsers.',
    args: [[0, 1, 2]],
    target: { kind: 'permutations', n: 3 },
    bits: 8,
    broken: `// "Sort randomly."
function sample(rng, a) {
  return a.sort(() => (rng.below(2) === 0 ? -1 : 1));
}`,
    fixed: FISHER_YATES,
    fixName: 'Fisher-Yates',
  },
  {
    id: 'fy-modulo',
    title: 'Right algorithm, wrong integers',
    bug: 'Fisher-Yates with next() % (i + 1) inherits modulo bias',
    explanation:
      'The shuffle is correct in structure, but with a 4-bit source next() % 3 picks 0 with probability 6/16 and 1 or 2 with 5/16 each. The permutations come out as multiples of 1/256 instead of 1/6. Exact mode with few bits makes the inherited bias easy to see.',
    args: [[0, 1, 2]],
    target: { kind: 'permutations', n: 3 },
    bits: 4,
    broken: `// Fisher-Yates, but the index comes from modulo.
function sample(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.next() % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}`,
    fixed: `// Fisher-Yates with an unbiased index (rejection sampling).
function below(rng, k) {
  const range = 2 ** rng.bits;
  const limit = range - (range % k);
  let x;
  do {
    x = rng.next();
  } while (x >= limit);
  return x % k;
}

function sample(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = below(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}`,
    fixName: 'unbiased index',
  },
  {
    id: 'rounded-weights',
    title: 'Weights that fall off the end',
    bug: 'cumulative floats that do not reach 1 return undefined',
    explanation:
      'Rounding 1/3 to 0.33 makes the cumulative sum stop at 0.99, so whenever random() ≥ 0.99 the loop finishes without returning. With 8 bits that is 2/256 of the time, and the three items get 85, 84 and 85 out of 256 instead of a third each. Integer weights avoid floats entirely.',
    args: [['rock', 'paper', 'scissors'], [1, 1, 1]],
    target: { kind: 'weights', entries: [['"rock"', '1'], ['"paper"', '1'], ['"scissors"', '1']] },
    bits: 8,
    broken: `// Weighted choice via rounded percentages.
function sample(rng, items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  const pct = weights.map((w) => Math.round((100 * w) / total) / 100);
  const r = rng.random();
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += pct[i];
    if (r < acc) return items[i];
  }
}`,
    fixed: `// Integer-weight choice: draw below the total, walk the weights.
function sample(rng, items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let x = rng.below(total);
  for (let i = 0; i < items.length; i++) {
    if (x < weights[i]) return items[i];
    x -= weights[i];
  }
}`,
    fixName: 'integer weights',
  },
];

export function galleryEntry(id: string): GalleryEntry | undefined {
  return GALLERY.find((g) => g.id === id);
}
