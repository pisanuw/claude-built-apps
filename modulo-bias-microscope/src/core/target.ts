import { add, parse, q, ZERO, type Q } from './rational';

/** What the student meant the sampler to produce. */
export type TargetSpec =
  | { kind: 'uniform-int'; n: number; offset?: number }
  | { kind: 'permutations'; n: number }
  | { kind: 'weights'; entries: [string, string][] };

/** Canonical key for a returned value: JSON for data, a readable tag otherwise. */
export function outcomeKey(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'function') return 'function';
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s;
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) {
    for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  }
  return out;
}

export const MAX_TARGET_OUTCOMES = 5040;

/** Target probabilities as exact fractions keyed by outcomeKey. */
export function targetDistribution(spec: TargetSpec): Map<string, Q> {
  const out = new Map<string, Q>();
  if (spec.kind === 'uniform-int') {
    if (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > MAX_TARGET_OUTCOMES) {
      throw new RangeError(`n must be an integer from 1 to ${MAX_TARGET_OUTCOMES}`);
    }
    const off = spec.offset ?? 0;
    for (let i = 0; i < spec.n; i++) out.set(String(i + off), q(1, spec.n));
    return out;
  }
  if (spec.kind === 'permutations') {
    if (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > 7) throw new RangeError('n must be an integer from 1 to 7');
    const all = permutations(spec.n).map((p) => JSON.stringify(p)).sort();
    for (const k of all) out.set(k, q(1, all.length));
    return out;
  }
  const weights: [string, Q][] = [];
  let total = ZERO;
  for (const [rawKey, rawW] of spec.entries) {
    let key: string;
    try {
      key = outcomeKey(JSON.parse(rawKey));
    } catch {
      throw new SyntaxError(`outcome ${rawKey} is not JSON (quote strings: "red")`);
    }
    const w = parse(rawW);
    if (w.n < 0n) throw new RangeError(`weight for ${rawKey} is negative`);
    if (out.has(key) || weights.some(([k]) => k === key)) throw new RangeError(`outcome ${rawKey} is listed twice`);
    weights.push([key, w]);
    total = add(total, w);
  }
  if (total.n === 0n) throw new RangeError('weights must not all be zero');
  for (const [k, w] of weights) out.set(k, q(w.n * total.d, w.d * total.n));
  return out;
}

/** Parses "key: weight" lines; keys are JSON values ("red", 3, [0,1]). */
export function parseWeightLines(text: string): [string, string][] {
  const entries: [string, string][] = [];
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const at = t.lastIndexOf(':');
    if (at <= 0) throw new SyntaxError(`line ${i + 1}: expected "outcome: weight"`);
    entries.push([t.slice(0, at).trim(), t.slice(at + 1).trim()]);
  });
  return entries;
}

export function describeTarget(spec: TargetSpec): string {
  if (spec.kind === 'uniform-int') {
    const off = spec.offset ?? 0;
    return `uniform over ${off}…${off + spec.n - 1}`;
  }
  if (spec.kind === 'permutations') return `every permutation of 0…${spec.n - 1} equally likely`;
  return `weights ${spec.entries.map(([k, w]) => `${k}:${w}`).join(', ')}`;
}
