/**
 * "Compile patched and compare" (AC-42, AC-43), the parts that need no
 * network: the original's and the patched copy's results side by side, the
 * change per veraPDF clause, and which fix's removal made a failing patched
 * compile pass. Behind the build flag of AC-80; the page code is
 * src/ui/compare.ts.
 */
import { CLAUSE_WORDS, MAPPED_SPECIFICATION, type CheckerJob } from './compile';

/**
 * What happened to a clause (AC-42's fixed, new, unchanged; R4a.1-8 b): a
 * clause that fails in both results is "unchanged" only with the same number
 * of failed checks, else "fewer" or "more". "unknown" when a side's list of
 * rules is not complete (R4a.1-8 a), so a clause missing from it may still
 * fail there, and a count on it may be short. "not-checked" when a side has
 * no check at all (it did not compile, or veraPDF gave no result): its
 * clauses are not known, and the words say why (AC-42; acceptance/m4b.md).
 */
export type ClauseChange = 'fixed' | 'new' | 'unchanged' | 'fewer' | 'more' | 'unknown' | 'not-checked';

export interface RunSide {
  /** True when the checker made a PDF. */
  compiled: boolean;
  pages: number | null;
  /** veraPDF's failed checks and rules; null when there was no check. */
  failedChecks: number | null;
  failedRules: number | null;
  passed: boolean | null;
  profile: string | null;
}

export interface CompareRow {
  clause: string;
  specification: string;
  words: string;
  original: number | null;
  patched: number | null;
  change: ClauseChange;
  /** The words of the Change column. */
  changeText: string;
}

export interface Comparison {
  original: RunSide;
  patched: RunSide;
  /** Per clause, the most failed checks first: fixed, new or unchanged (AC-42). */
  rows: CompareRow[];
  /** Fewer, the same or more failed checks in the patched copy; null when either side has no check. */
  trend: 'fewer' | 'same' | 'more' | null;
}

export function side(job: CheckerJob): RunSide {
  const v = job.status === 'done' ? (job.result?.validation ?? null) : null;
  return {
    compiled: job.status === 'done',
    pages: job.status === 'done' ? (job.result?.pages ?? null) : null,
    failedChecks: v ? v.failedChecks : null,
    failedRules: v ? v.failedRules : null,
    passed: v ? v.compliant : null,
    profile: v ? v.profile : null,
  };
}

/**
 * True when the result lists every rule that failed: veraPDF's report counts
 * the failed rules, and the checker sends one entry per rule (at most the
 * checker's cap; before m4b, the 20 most frequent). A result with no check is
 * not complete.
 */
export function complete(job: CheckerJob): boolean {
  const v = job.status === 'done' ? job.result?.validation : null;
  return !!v && v.clauses.length >= v.failedRules;
}

function byClause(job: CheckerJob): Map<string, { specification: string; clause: string; count: number; description: string }> {
  const out = new Map<string, { specification: string; clause: string; count: number; description: string }>();
  const v = job.status === 'done' ? job.result?.validation : null;
  for (const c of v?.clauses ?? []) {
    const k = `${c.specification}\u0000${c.clause}`;
    const row = out.get(k);
    if (row) row.count += c.failedChecks;
    else out.set(k, { specification: c.specification, clause: c.clause, count: c.failedChecks, description: c.description });
  }
  return out;
}

/** The two results side by side, and per clause whether the patch fixed it, made it new or left it (AC-42). */
export function compareJobs(original: CheckerJob, patched: CheckerJob): Comparison {
  const a = byClause(original);
  const b = byClause(patched);
  const known = { a: complete(original), b: complete(patched) };
  const o = side(original);
  const p = side(patched);
  // A side with no check says nothing about any clause, whatever the other side's list holds.
  const unchecked = o.failedChecks === null ? 'original' : p.failedChecks === null ? 'patched' : null;
  const change = (x: number | undefined, y: number | undefined): ClauseChange => {
    if (unchecked) return 'not-checked';
    if (x !== undefined && y !== undefined) {
      if (!known.a || !known.b) return 'unknown';
      return y === x ? 'unchanged' : y < x ? 'fewer' : 'more';
    }
    // In one list only: fixed or new only when the other list is complete.
    if (x !== undefined) return known.b ? 'fixed' : 'unknown';
    return known.a ? 'new' : 'unknown';
  };
  const rows: CompareRow[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k);
    const y = b.get(k);
    const any = (x ?? y) as { specification: string; clause: string; description: string };
    const mapped = any.specification === MAPPED_SPECIFICATION && Object.hasOwn(CLAUSE_WORDS, any.clause) ? CLAUSE_WORDS[any.clause] : undefined;
    rows.push({
      clause: any.clause,
      specification: any.specification,
      words: mapped ?? any.description,
      original: x?.count ?? null,
      patched: y?.count ?? null,
      change: change(x?.count, y?.count),
      changeText: '',
    });
  }
  rows.sort((p, q) => Math.max(q.original ?? 0, q.patched ?? 0) - Math.max(p.original ?? 0, p.patched ?? 0) || p.clause.localeCompare(q.clause, 'en', { numeric: true }));
  const notChecked = unchecked ? notCheckedWords(unchecked === 'original' ? o : p, unchecked) : '';
  for (const r of rows) r.changeText = r.change === 'not-checked' ? notChecked : CHANGE_WORDS[r.change as Exclude<ClauseChange, 'not-checked'>];
  const trend = o.failedChecks === null || p.failedChecks === null ? null : p.failedChecks < o.failedChecks ? 'fewer' : p.failedChecks > o.failedChecks ? 'more' : 'same';
  return { original: o, patched: p, rows, trend };
}

/** The failures that end a run with the checker's verdict on the source; a stop at the limit, a cancel or a lost check does not (AC-43). */
const FINISHED_FAILURES = new Set(['compile-error', 'no-pdf', 'bibliography']);

/** True when the run ran to its end: compiled, or stopped by an error in the source (AC-43's "finished"). */
export function finished(job: CheckerJob): boolean {
  if (job.status === 'done') return true;
  return job.status === 'failed' && !!job.failure && FINISHED_FAILURES.has(job.failure.kind);
}

export interface PatchedRun {
  /** The ids of the fixes in the copy that was compiled. */
  accepted: ReadonlySet<string>;
  job: CheckerJob;
}

/**
 * The fix whose removal made the compile pass (AC-43): the earlier patched
 * run failed, the next one compiled, the next one has exactly one fix fewer
 * and no other, and both runs finished. Otherwise null, and no card is
 * highlighted.
 */
export function madeItFail(before: PatchedRun, after: PatchedRun): string | null {
  if (!finished(before.job) || !finished(after.job)) return null;
  if (before.job.status !== 'failed' || after.job.status !== 'done') return null;
  const removed = [...before.accepted].filter((id) => !after.accepted.has(id));
  const added = [...after.accepted].filter((id) => !before.accepted.has(id));
  return removed.length === 1 && added.length === 0 ? removed[0] : null;
}

/** "Compiled, 22 pages" / "Did not compile". */
export function compiledWords(s: RunSide): string {
  if (!s.compiled) return 'Did not compile';
  return s.pages === null ? 'Compiled' : `Compiled, ${s.pages === 1 ? '1 page' : `${s.pages} pages`}`;
}

/** "4,786 failed checks (9 rules)", "No failure", or "Not checked". */
export function failuresWords(s: RunSide): string {
  if (s.failedChecks === null) return 'Not checked';
  if (!s.failedChecks) return 'No failure';
  const rules = s.failedRules === null ? '' : ` (${s.failedRules === 1 ? '1 rule' : `${s.failedRules.toLocaleString('en-US')} rules`})`;
  return `${s.failedChecks === 1 ? '1 failed check' : `${s.failedChecks.toLocaleString('en-US')} failed checks`}${rules}`;
}

/** The one line under the table. */
export function trendLine(c: Comparison): string {
  if (!c.patched.compiled) return 'The patched copy did not compile. Turn off one fix and compile again to find the one that stops it.';
  if (!c.original.compiled) return 'The original did not compile; the patched copy did.';
  switch (c.trend) {
    case 'fewer':
      return `The patched copy has ${((c.original.failedChecks ?? 0) - (c.patched.failedChecks ?? 0)).toLocaleString('en-US')} fewer failed checks than the original.`;
    case 'more':
      return `The patched copy has ${((c.patched.failedChecks ?? 0) - (c.original.failedChecks ?? 0)).toLocaleString('en-US')} more failed checks than the original. Look at the new clauses below.`;
    case 'same':
      return 'The patched copy has as many failed checks as the original.';
    default:
      return 'One of the two PDFs could not be checked, so the failures cannot be compared.';
  }
}

/** "Not checked: the patched copy did not compile", or "… was not checked" when it compiled and veraPDF gave no result. */
export function notCheckedWords(s: RunSide, which: 'original' | 'patched'): string {
  const name = which === 'original' ? 'the original' : 'the patched copy';
  return s.compiled ? `Not checked: ${name}’s PDF could not be checked` : `Not checked: ${name} did not compile`;
}

export const CHANGE_WORDS: Record<Exclude<ClauseChange, 'not-checked'>, string> = {
  fixed: 'Fixed',
  new: 'New',
  unchanged: 'Unchanged',
  fewer: 'Fewer',
  more: 'More',
  unknown: 'Not known: not in the list of the most frequent',
};
