import type { Sampler } from './compile';
import { enumerateExact } from './exact';
import { cmp, format, q } from './rational';
import { exactReport } from './report';
import { chiSquare, sampleMany } from './stats';
import { describeTarget, targetDistribution, type TargetSpec } from './target';

/** An instructor-defined task: a target distribution plus how the sampler is called. */
export interface Exercise {
  title: string;
  prompt: string;
  args: unknown[];
  target: TargetSpec;
  /** False-fail probability for statistical grading (a correct sampler fails this often). */
  alpha: number;
  /** Source width for exact grading. */
  bits: number;
  /** Draws for statistical grading. */
  draws: number;
  allowBelow: boolean;
  starter: string;
}

export interface GradeResult {
  pass: boolean;
  mode: 'exact' | 'statistical';
  summary: string;
  details: string[];
  /** Probability that a correct sampler is failed by this mode. */
  falseFailRate: number;
}

/** Exact runs above this budget fall back to the statistical test. */
export const GRADE_MAX_RUNS = 300_000;
/** Rejection loops never finish on every path; this much cut-off mass is tolerated. */
export const UNRESOLVED_TOLERANCE = q(1, 2 ** 20);

export function validateExercise(ex: Exercise): string[] {
  const problems: string[] = [];
  if (!ex.title.trim()) problems.push('Give the exercise a title.');
  if (!Array.isArray(ex.args)) problems.push('Arguments must be a JSON array.');
  if (!(ex.alpha > 0 && ex.alpha < 0.5)) problems.push('False-fail rate must be between 0 and 0.5.');
  if (!Number.isInteger(ex.bits) || ex.bits < 1 || ex.bits > 16) problems.push('Exact bits must be 1 to 16.');
  if (!Number.isInteger(ex.draws) || ex.draws < 1000 || ex.draws > 5_000_000) problems.push('Draws must be 1,000 to 5,000,000.');
  try {
    targetDistribution(ex.target);
  } catch (e) {
    problems.push(`Target: ${(e as Error).message}`);
  }
  return problems;
}

export function grade(fn: Sampler, ex: Exercise, seed = 20261101): GradeResult {
  const target = targetDistribution(ex.target);
  const exact = enumerateExact(fn, ex.args, { bits: ex.bits, allowBelow: ex.allowBelow, maxRuns: GRADE_MAX_RUNS });
  if (exact.ok) {
    const r = exactReport(exact, target);
    const details: string[] = [];
    for (const [msg, p] of r.errors) details.push(`Throws ${msg} with probability ${format(p)}.`);
    if (r.missing.length) details.push(`Never returns ${r.missing.slice(0, 5).join(', ')}${r.missing.length > 5 ? ', …' : ''}.`);
    if (r.unexpected.length) details.push(`Returns ${r.unexpected.slice(0, 5).join(', ')}, which the target never does.`);
    const worst = [...r.rows].sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))[0];
    if (!r.exactMatch && worst && Number.isFinite(worst.ratio) && worst.ratio > 0) {
      details.push(`Largest relative error: ${worst.key} has ${format(worst.actual)} instead of ${format(worst.target)}.`);
    }
    const tooOpen = cmp(r.unresolved, UNRESOLVED_TOLERANCE) > 0;
    if (tooOpen) details.push(`Paths that never finish carry ${format(r.unresolved)} of the probability.`);
    const pass = r.exactMatch && !tooOpen;
    return {
      pass,
      mode: 'exact',
      falseFailRate: 0,
      summary: pass
        ? `Exact on ${aBits(ex.bits)} source: every outcome has exactly its target probability (${describeTarget(ex.target)}).`
        : `Exact on ${aBits(ex.bits)} source: off by ${format(r.conditionalTv)} in total variation.`,
      details,
    };
  }
  if (exact.reason === 'nondeterministic') {
    return { pass: false, mode: 'exact', falseFailRate: 0, summary: 'Could not grade.', details: [exact.message] };
  }
  const sample = sampleMany(fn, ex.args, { draws: ex.draws, seed, allowBelow: ex.allowBelow });
  const chi = chiSquare(sample, target);
  const details = [
    `Exact enumeration needs more than ${GRADE_MAX_RUNS.toLocaleString('en-US')} runs at ${ex.bits} bits, so this is a statistical test.`,
    `χ² = ${chi.statistic.toFixed(2)} with ${chi.df} degrees of freedom, p = ${chi.pValue.toPrecision(3)}.`,
  ];
  if (chi.unexpected.length) details.push(`Produced ${chi.unexpected.slice(0, 5).join(', ')}, which the target never does.`);
  if (chi.sparseCells) details.push(`${chi.sparseCells} outcomes expect fewer than 5 hits; raise the draws for a reliable test.`);
  const pass = chi.pValue >= ex.alpha;
  return {
    pass,
    mode: 'statistical',
    falseFailRate: ex.alpha,
    summary: pass
      ? `Consistent with the target over ${ex.draws.toLocaleString('en-US')} draws (a correct sampler fails ${pct(ex.alpha)} of the time; small biases can still pass).`
      : `Rejected at the ${pct(ex.alpha)} level over ${ex.draws.toLocaleString('en-US')} draws.`,
    details,
  };
}

/** "an 8-bit", "a 4-bit": the article follows how the number is spoken. */
export function aBits(n: number): string {
  return `${n === 8 || n === 11 || n === 18 ? 'an' : 'a'} ${n}-bit`;
}

function pct(x: number): string {
  return `${+(x * 100).toPrecision(3)}%`;
}
