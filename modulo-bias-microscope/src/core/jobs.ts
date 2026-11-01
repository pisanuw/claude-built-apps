import { compileSampler } from './compile';
import { enumerateExact, type ExactResult } from './exact';
import { grade, type Exercise, type GradeResult } from './grade';
import { exactReport, type ExactReport } from './report';
import { chiSquare, sampleMany, type ChiSquare, type StatSample } from './stats';
import { targetDistribution, type TargetSpec } from './target';

/** Work the page hands to the Web Worker. Everything here is structured-cloneable. */
export type JobRequest =
  | { kind: 'exact'; code: string; args: unknown[]; target: TargetSpec; bits: number; allowBelow: boolean }
  | { kind: 'stat'; code: string; args: unknown[]; target: TargetSpec; draws: number; seed: number; allowBelow: boolean }
  | { kind: 'grade'; code: string; exercise: Exercise };

export type JobResponse =
  | { kind: 'exact'; result: ExactResult; report: ExactReport | null }
  | { kind: 'stat'; sample: StatSample; chi: ChiSquare }
  | { kind: 'grade'; result: GradeResult }
  | { kind: 'error'; message: string };

export function runJob(req: JobRequest, onProgress?: (done: number) => void): JobResponse {
  try {
    const fn = compileSampler(req.code);
    if (req.kind === 'grade') return { kind: 'grade', result: grade(fn, req.exercise) };
    const target = targetDistribution(req.target);
    if (req.kind === 'exact') {
      const result = enumerateExact(fn, req.args, { bits: req.bits, allowBelow: req.allowBelow });
      return { kind: 'exact', result, report: result.ok ? exactReport(result, target) : null };
    }
    const sample = sampleMany(fn, req.args, { draws: req.draws, seed: req.seed, allowBelow: req.allowBelow }, onProgress);
    return { kind: 'stat', sample, chi: chiSquare(sample, target) };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}
