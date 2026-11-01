import { cloneArgs, type Sampler } from './compile';
import { toNumber, type Q } from './rational';
import { streamRng, type Rng } from './rng';
import { outcomeKey } from './target';

export interface StatOptions {
  draws: number;
  seed: number;
  allowBelow: boolean;
  /** One call drawing more than this is stopped and counted as an error (a loop tuned to a narrow source can spin ~2^32 times). */
  maxDrawsPerCall: number;
}

export const DEFAULT_STAT: StatOptions = { draws: 200_000, seed: 1, allowBelow: true, maxDrawsPerCall: 10_000 };

export class DrawLimitError extends Error {
  constructor(limit: number) {
    super(`one call drew more than ${limit.toLocaleString('en-US')} times from a 32-bit source (is a loop bound tied to a narrow source?)`);
    this.name = 'DrawLimitError';
  }
}

export interface StatSample {
  draws: number;
  seed: number;
  counts: Map<string, number>;
  errors: Map<string, number>;
}

/** Calls the sampler `draws` times on a 32-bit xoshiro128** stream and tallies results. */
export function sampleMany(
  fn: Sampler,
  args: readonly unknown[],
  opts: Partial<StatOptions> = {},
  onProgress?: (done: number) => void,
): StatSample {
  const o = { ...DEFAULT_STAT, ...opts };
  const base = streamRng(o.seed, o.allowBelow);
  let used = 0;
  const guard = (): void => {
    if (++used > o.maxDrawsPerCall) throw new DrawLimitError(o.maxDrawsPerCall);
  };
  const rng: Rng = {
    bits: base.bits,
    next: () => (guard(), base.next()),
    random: () => (guard(), base.random()),
    below: (k: number) => (guard(), base.below(k)),
  };
  const counts = new Map<string, number>();
  const errors = new Map<string, number>();
  for (let i = 0; i < o.draws; i++) {
    used = 0;
    try {
      const k = outcomeKey(fn(rng, ...cloneArgs(args)));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    } catch (e) {
      const k = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
    if (onProgress && (i + 1) % 50_000 === 0) onProgress(i + 1);
  }
  return { draws: o.draws, seed: o.seed, counts, errors };
}

export interface ChiSquare {
  statistic: number;
  df: number;
  /** P(X ≥ statistic) for a correct sampler; 0 when an impossible outcome appeared. */
  pValue: number;
  /** Outcomes seen that the target gives probability zero. */
  unexpected: string[];
  /** Cells whose expected count is under 5, where the chi-square approximation is weak. */
  sparseCells: number;
}

export function chiSquare(sample: StatSample, target: Map<string, Q>): ChiSquare {
  const n = sample.draws;
  const unexpected: string[] = [];
  for (const k of sample.counts.keys()) {
    const t = target.get(k);
    if (!t || t.n === 0n) unexpected.push(k);
  }
  for (const k of sample.errors.keys()) unexpected.push(k);
  let stat = 0;
  let cells = 0;
  let sparse = 0;
  for (const [k, t] of target) {
    const p = toNumber(t);
    if (p <= 0) continue;
    cells++;
    const e = p * n;
    if (e < 5) sparse++;
    const obs = sample.counts.get(k) ?? 0;
    stat += ((obs - e) * (obs - e)) / e;
  }
  const df = Math.max(1, cells - 1);
  const pValue = unexpected.length > 0 ? 0 : gammaQ(df / 2, stat / 2);
  return { statistic: stat, df, pValue, unexpected, sparseCells: sparse };
}

/** Lanczos approximation, accurate to about 15 digits for x > 0. */
export function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Upper regularized incomplete gamma Q(a, x) (series below a+1, continued fraction above). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const lead = -x + a * Math.log(x) - lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - sum * Math.exp(lead));
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.min(1, Math.exp(lead) * h);
}
