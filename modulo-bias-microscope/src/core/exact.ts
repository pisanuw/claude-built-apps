import { cloneArgs, type Sampler } from './compile';
import { add, q, ZERO, type Q } from './rational';
import { BelowDisabledError, checkBelow, type Rng } from './rng';
import { outcomeKey } from './target';

export interface ExactOptions {
  /** Width of the narrow source: next() returns 0 … 2^bits − 1. */
  bits: number;
  /** Give up after this many complete runs of the sampler. */
  maxRuns: number;
  /** Stop following a path once its probability would fall below 2^-cutoffLog2. */
  cutoffLog2: number;
  /** Hard cap on draws along one path. */
  maxCalls: number;
  allowBelow: boolean;
}

export const DEFAULT_EXACT: ExactOptions = {
  bits: 8,
  maxRuns: 1_000_000,
  cutoffLog2: 32,
  maxCalls: 64,
  allowBelow: true,
};

export interface ExactDistribution {
  ok: true;
  bits: number;
  runs: number;
  /** Probability of each returned value, exactly. */
  outcomes: Map<string, Q>;
  /** Probability of each thrown error message. */
  errors: Map<string, Q>;
  /** Mass on paths cut off by cutoffLog2 or maxCalls (rejection loops never fully terminate). */
  unresolved: Q;
  longestPath: number;
  /** One draw sequence for each outcome, for "how did it get here" explanations. */
  witness: Map<string, number[]>;
}

export interface ExactFailure {
  ok: false;
  reason: 'too-many-runs' | 'nondeterministic';
  message: string;
  runs: number;
  /** For too-many-runs: the number of leaves implied by the first path's branching, when known. */
  estimate?: number;
}

export type ExactResult = ExactDistribution | ExactFailure;

class Cut {}
class Nondeterministic extends Error {}

/**
 * Enumerates every sequence of draws the sampler can make from a narrow
 * source, odometer style: run, then bump the deepest draw that has room and
 * replay that prefix. Each leaf has probability 1/(a1·a2·…·ak) where ai is
 * the number of values the i-th draw could take.
 */
export function enumerateExact(fn: Sampler, args: readonly unknown[], opts: Partial<ExactOptions> = {}): ExactResult {
  const o = { ...DEFAULT_EXACT, ...opts };
  if (!Number.isInteger(o.bits) || o.bits < 1 || o.bits > 16) throw new RangeError('exact mode needs 1 to 16 bits');
  const range = 2 ** o.bits;
  const counts = new Map<string, Map<bigint, number>>();
  const errCounts = new Map<string, Map<bigint, number>>();
  const witness = new Map<string, number[]>();
  let unresolved = ZERO;
  let prefix: number[] = [];
  let prefixArity: number[] = [];
  let runs = 0;
  let longest = 0;
  let estimate: number | undefined;

  const bump = (m: Map<string, Map<bigint, number>>, key: string, denom: bigint): void => {
    let inner = m.get(key);
    if (!inner) m.set(key, (inner = new Map()));
    inner.set(denom, (inner.get(denom) ?? 0) + 1);
  };

  for (;;) {
    if (runs >= o.maxRuns) {
      return {
        ok: false,
        reason: 'too-many-runs',
        runs,
        estimate,
        message:
          `Stopped after ${runs.toLocaleString('en-US')} runs` +
          (estimate ? ` of about ${estimate.toLocaleString('en-US')}` : '') +
          '. Use fewer bits, a smaller input, or statistical mode.',
      };
    }
    runs++;
    const path: number[] = [];
    const arity: number[] = [];
    let log2 = 0;
    const draw = (a: number): number => {
      const pos = path.length;
      if (pos >= o.maxCalls || log2 + Math.log2(a) > o.cutoffLog2 + 1e-9) throw new Cut();
      let v = 0;
      if (pos < prefix.length) {
        if (prefixArity[pos] !== a) throw new Nondeterministic();
        v = prefix[pos];
      }
      path.push(v);
      arity.push(a);
      log2 += Math.log2(a);
      return v;
    };
    const rng: Rng = {
      bits: o.bits,
      next: () => draw(range),
      random: () => draw(range) / range,
      below(k: number): number {
        if (!o.allowBelow) throw new BelowDisabledError();
        checkBelow(k);
        return draw(k);
      },
    };
    let outcome: { kind: 'value'; key: string } | { kind: 'error'; key: string } | { kind: 'cut' };
    try {
      outcome = { kind: 'value', key: outcomeKey(fn(rng, ...cloneArgs(args))) };
    } catch (e) {
      if (e instanceof Cut) outcome = { kind: 'cut' };
      else if (e instanceof Nondeterministic) return nondeterministic(runs);
      else outcome = { kind: 'error', key: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
    if (path.length < prefix.length) return nondeterministic(runs);
    let denom = 1n;
    for (const a of arity) denom *= BigInt(a);
    if (runs === 1) estimate = arity.reduce((p, a) => p * a, 1);
    longest = Math.max(longest, path.length);
    if (outcome.kind === 'cut') unresolved = add(unresolved, q(1n, denom));
    else if (outcome.kind === 'error') bump(errCounts, outcome.key, denom);
    else {
      bump(counts, outcome.key, denom);
      if (!witness.has(outcome.key)) witness.set(outcome.key, [...path]);
    }

    let i = path.length - 1;
    while (i >= 0 && path[i] === arity[i] - 1) i--;
    if (i < 0) break;
    prefix = path.slice(0, i + 1);
    prefix[i]++;
    prefixArity = arity.slice(0, i + 1);
  }

  return {
    ok: true,
    bits: o.bits,
    runs,
    outcomes: collapse(counts),
    errors: collapse(errCounts),
    unresolved,
    longestPath: longest,
    witness,
  };
}

function nondeterministic(runs: number): ExactFailure {
  return {
    ok: false,
    reason: 'nondeterministic',
    runs,
    message:
      'Replaying the same draws gave a different sequence of calls. The sampler must depend only on rng and its arguments (no Date, no shared state between calls).',
  };
}

function collapse(m: Map<string, Map<bigint, number>>): Map<string, Q> {
  const out = new Map<string, Q>();
  for (const [key, inner] of m) {
    let total = ZERO;
    for (const [denom, count] of inner) total = add(total, q(BigInt(count), denom));
    out.set(key, total);
  }
  return out;
}
