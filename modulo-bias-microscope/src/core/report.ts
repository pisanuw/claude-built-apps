import type { ExactDistribution } from './exact';
import { abs, add, cmp, div, isZero, ONE, q, sub, toNumber, ZERO, type Q } from './rational';
import type { StatSample } from './stats';

export interface ExactRow {
  key: string;
  actual: Q;
  /** actual divided by the chance of returning at all (differs from actual when paths are cut off or throw). */
  given: Q;
  target: Q;
  /** actual − target */
  error: Q;
  /** actual / target; Infinity for an outcome the target forbids, 0 for one never produced. */
  ratio: number;
}

export interface ExactReport {
  rows: ExactRow[];
  errors: [string, Q][];
  unresolved: Q;
  /** Total variation distance, ½ Σ |actual − target|, counting errors and cut-off mass as wrong. */
  tv: Q;
  /** The same distance after conditioning on the sampler returning a value. */
  conditionalTv: Q;
  /** True when the conditional distribution equals the target exactly and nothing throws. */
  exactMatch: boolean;
  missing: string[];
  unexpected: string[];
}

/** Orders numeric keys numerically and everything else as text. */
export function compareKeys(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function exactReport(dist: ExactDistribution, target: Map<string, Q>): ExactReport {
  const keys = [...new Set([...target.keys(), ...dist.outcomes.keys()])].sort(compareKeys);
  const rows: ExactRow[] = [];
  let diff = ZERO;
  let returned = ZERO;
  for (const p of dist.outcomes.values()) returned = add(returned, p);
  let condDiff = ZERO;
  for (const key of keys) {
    const actual = dist.outcomes.get(key) ?? ZERO;
    const t = target.get(key) ?? ZERO;
    const error = sub(actual, t);
    diff = add(diff, abs(error));
    const given = isZero(returned) ? ZERO : div(actual, returned);
    condDiff = add(condDiff, abs(sub(given, t)));
    rows.push({ key, actual, given, target: t, error, ratio: isZero(t) ? (isZero(actual) ? 1 : Infinity) : toNumber(div(actual, t)) });
  }
  const errors = [...dist.errors.entries()].sort((a, b) => cmp(b[1], a[1]));
  for (const [, p] of errors) diff = add(diff, p);
  diff = add(diff, dist.unresolved);
  const conditionalTv = isZero(returned) ? ONE : q(condDiff.n, condDiff.d * 2n);
  return {
    rows,
    errors,
    unresolved: dist.unresolved,
    tv: q(diff.n, diff.d * 2n),
    conditionalTv,
    exactMatch: isZero(conditionalTv) && errors.length === 0,
    missing: rows.filter((r) => isZero(r.actual) && !isZero(r.target)).map((r) => r.key),
    unexpected: rows.filter((r) => !isZero(r.actual) && isZero(r.target)).map((r) => r.key),
  };
}

export interface HistogramBar {
  key: string;
  actual: number;
  target: number;
}

export function histogramFromExact(report: ExactReport): HistogramBar[] {
  return report.rows.map((r) => ({ key: r.key, actual: toNumber(r.actual), target: toNumber(r.target) }));
}

export function histogramFromSample(sample: StatSample, target: Map<string, Q>): HistogramBar[] {
  const keys = [...new Set([...target.keys(), ...sample.counts.keys()])].sort(compareKeys);
  return keys.map((key) => ({
    key,
    actual: (sample.counts.get(key) ?? 0) / sample.draws,
    target: toNumber(target.get(key) ?? ZERO),
  }));
}

export interface PositionMatrix {
  /** The distinct items, sorted; columns of the matrix. */
  items: string[];
  /** cells[position][item] = P(item lands at position). */
  cells: number[][];
  /** The same probabilities under the target. */
  expected: number[][];
}

/**
 * For samplers that return arrays of one length (shuffles), the probability
 * that each item ends up at each position. A fair shuffle is flat at 1/n.
 */
export function positionMatrix(probs: Map<string, number>, target: Map<string, Q>): PositionMatrix | null {
  const parse = (k: string): unknown[] | null => {
    try {
      const v: unknown = JSON.parse(k);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const all = [...new Set([...probs.keys(), ...target.keys()])];
  const arrays = all.map(parse);
  if (arrays.length === 0 || arrays.some((a) => a === null)) return null;
  const len = arrays[0]!.length;
  if (len < 2 || len > 12 || arrays.some((a) => a!.length !== len)) return null;
  const items = [...new Set(arrays.flatMap((a) => a!.map((x) => JSON.stringify(x))))].sort(compareKeys);
  if (items.length > 12) return null;
  const build = (src: (k: string) => number): number[][] => {
    const m = Array.from({ length: len }, () => new Array<number>(items.length).fill(0));
    all.forEach((k, i) => {
      const p = src(k);
      if (p === 0) return;
      arrays[i]!.forEach((x, pos) => (m[pos][items.indexOf(JSON.stringify(x))] += p));
    });
    return m;
  };
  return {
    items,
    cells: build((k) => probs.get(k) ?? 0),
    expected: build((k) => toNumber(target.get(k) ?? ZERO)),
  };
}
