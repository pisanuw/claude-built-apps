import type { JourneyConfig, JourneyRun, StepResult } from './types';

/** Minimal storage so tests can pass a fake and private windows can fail quietly. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RUNS_KEY = 'sjc.runs.v1';
const SETTINGS_KEY = 'sjc.settings.v1';
export const MAX_RUNS = 30;

const STATUSES = new Set(['pass', 'warn', 'fail', 'skip']);

function isResult(x: unknown): x is StepResult {
  const r = x as StepResult;
  return !!r && typeof r.id === 'string' && STATUSES.has(r.status) && typeof r.headline === 'string';
}

function isRun(x: unknown): x is JourneyRun {
  const r = x as JourneyRun;
  return !!r && typeof r.siteUrl === 'string' && typeof r.finishedAt === 'string' && Array.isArray(r.results) && r.results.every(isResult);
}

/** Checks done on this device, newest first. Bad or missing data reads as no history. */
export function loadRuns(store: KeyValue | null): JourneyRun[] {
  if (!store) return [];
  try {
    const data = JSON.parse(store.getItem(RUNS_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter(isRun) : [];
  } catch {
    return [];
  }
}

export function saveRun(store: KeyValue | null, run: JourneyRun): JourneyRun[] {
  const runs = [run, ...loadRuns(store)].slice(0, MAX_RUNS);
  try {
    store?.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    /* storage full or blocked: history is a convenience */
  }
  return runs;
}

export function clearRuns(store: KeyValue | null): void {
  try {
    store?.removeItem(RUNS_KEY);
  } catch {
    /* ignore */
  }
}

/** The newest earlier check of the same site (not the run itself). */
export function previousRun(runs: JourneyRun[], run: JourneyRun): JourneyRun | undefined {
  return runs.find((r) => r !== run && r.siteUrl === run.siteUrl && r.demo === run.demo && r.finishedAt < run.finishedAt);
}

/** Settings saved for next time. The password is never saved. */
export function saveSettings(store: KeyValue | null, config: JourneyConfig): void {
  const rest: Partial<JourneyConfig> = { ...config };
  delete rest.password;
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

export function loadSettings(store: KeyValue | null): Partial<JourneyConfig> {
  try {
    const data = JSON.parse(store?.getItem(SETTINGS_KEY) ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && k !== 'password') out[k] = v;
    return out as Partial<JourneyConfig>;
  } catch {
    return {};
  }
}
