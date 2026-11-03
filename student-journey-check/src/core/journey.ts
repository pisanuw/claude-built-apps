import { STEP_LABELS, STEP_ORDER } from './steps';
import { emptyState, type JourneyConfig, type JourneyRun, type StepId, type StepResult, type StepRunner } from './types';
import { normalizeSiteUrl } from './urls';

/**
 * Walk every step in order, carrying the student's session along. `onStep`
 * fires as each step finishes, so the page can show progress live.
 */
export async function runJourney(
  config: JourneyConfig,
  runner: StepRunner,
  opts: { demo?: boolean; now?: () => Date; onStep?: (r: StepResult, index: number) => void; steps?: StepId[] } = {},
): Promise<JourneyRun> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let state = emptyState();
  const results: StepResult[] = [];
  const steps = opts.steps ?? STEP_ORDER;
  for (const [i, step] of steps.entries()) {
    // Only the login step needs the password; the other steps never see it.
    const stepConfig = step === 'login' ? config : { ...config, password: undefined };
    const out = await runner(step, stepConfig, state);
    state = out.state;
    results.push(out.result);
    opts.onStep?.(out.result, i);
  }
  return { siteUrl: normalizeSiteUrl(config.siteUrl), startedAt, finishedAt: now().toISOString(), results, demo: !!opts.demo };
}

export interface RunSummary {
  passed: number;
  warnings: number;
  failures: number;
  skipped: number;
  checked: number;
  /** One line for the top of the report. */
  headline: string;
  tone: 'good' | 'warn' | 'bad';
}

export function summarize(run: JourneyRun): RunSummary {
  const count = (s: StepResult['status']) => run.results.filter((r) => r.status === s).length;
  const passed = count('pass');
  const warnings = count('warn');
  const failures = count('fail');
  const skipped = count('skip');
  const checked = passed + warnings + failures;
  let headline: string;
  let tone: RunSummary['tone'];
  if (failures) {
    const first = run.results.find((r) => r.status === 'fail') as StepResult;
    headline = `${failures} step${failures === 1 ? '' : 's'} would stop your students. First: ${STEP_LABELS[first.id].toLowerCase()}.`;
    tone = 'bad';
  } else if (warnings) {
    headline = `Students can get through, but ${warnings} thing${warnings === 1 ? ' looks' : 's look'} wrong.`;
    tone = 'warn';
  } else if (checked) {
    headline = `All ${checked} checked step${checked === 1 ? '' : 's'} work for students.`;
    tone = 'good';
  } else {
    headline = 'Nothing could be checked.';
    tone = 'warn';
  }
  return { passed, warnings, failures, skipped, checked, headline, tone };
}

export type Change = { id: StepId; kind: 'new' | 'fixed' | 'still' };

/** What changed since the last check of the same site: new problems, fixed ones, ones still there. */
export function compareRuns(previous: JourneyRun, current: JourneyRun): Change[] {
  const bad = (r?: StepResult) => r?.status === 'fail' || r?.status === 'warn';
  const changes: Change[] = [];
  for (const r of current.results) {
    const before = previous.results.find((p) => p.id === r.id);
    if (!before || before.status === 'skip' || r.status === 'skip') continue;
    if (bad(r) && !bad(before)) changes.push({ id: r.id, kind: 'new' });
    else if (!bad(r) && bad(before)) changes.push({ id: r.id, kind: 'fixed' });
    else if (bad(r) && bad(before)) changes.push({ id: r.id, kind: 'still' });
  }
  return changes;
}
