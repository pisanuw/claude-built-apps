import { compareRuns, summarize, type Change } from './journey';
import { STEP_LABELS } from './steps';
import type { JourneyRun, StepResult } from './types';
import { shortUrl } from './urls';

const MARK: Record<StepResult['status'], string> = { pass: 'OK', warn: 'CHECK', fail: 'BROKEN', skip: 'SKIPPED' };

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function stepLines(r: StepResult): string[] {
  const lines = [`[${MARK[r.status]}] ${STEP_LABELS[r.id]}: ${r.headline}`];
  if (r.detail) lines.push(`    ${r.detail}`);
  if (r.evidence) lines.push(`    The page said: "${r.evidence}"`);
  if (r.url) lines.push(`    Page: ${shortUrl(r.url)}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}`);
  if (r.advice && r.status !== 'pass') lines.push(`    What to try: ${r.advice}`);
  return lines;
}

/**
 * The alert a course owner would get: subject line plus a short body that
 * leads with what students would hit.
 */
export function alertEmail(run: JourneyRun, previous?: JourneyRun): { subject: string; body: string } {
  const s = summarize(run);
  const site = host(run.siteUrl);
  const problems = run.results.filter((r) => r.status === 'fail' || r.status === 'warn');
  const subject = s.failures
    ? `${site}: ${STEP_LABELS[problems.find((r) => r.status === 'fail')!.id].toLowerCase()} is broken for students`
    : s.warnings
      ? `${site}: ${s.warnings} thing${s.warnings === 1 ? '' : 's'} to look at on your course site`
      : `${site}: your student journey works`;
  const body: string[] = [`Student Journey Check for ${site}, ${when(run.finishedAt)}`, '', s.headline, ''];
  if (previous) {
    const changes = compareRuns(previous, run);
    const lines = describeChanges(changes);
    if (lines.length) body.push(`Since the check on ${when(previous.finishedAt)}:`, ...lines.map((l) => `  - ${l}`), '');
  }
  if (problems.length) {
    body.push('What needs you:', '');
    for (const r of problems) body.push(...stepLines(r), '');
  }
  const fine = run.results.filter((r) => r.status === 'pass').map((r) => STEP_LABELS[r.id].toLowerCase());
  if (fine.length) body.push(`Working: ${fine.join(', ')}.`);
  const skipped = run.results.filter((r) => r.status === 'skip').map((r) => STEP_LABELS[r.id].toLowerCase());
  if (skipped.length) body.push(`Not checked: ${skipped.join(', ')}.`);
  return { subject, body: body.join('\n').trimEnd() + '\n' };
}

export function describeChanges(changes: Change[]): string[] {
  return changes.map((c) => {
    const label = STEP_LABELS[c.id];
    if (c.kind === 'new') return `New problem: ${label.toLowerCase()}`;
    if (c.kind === 'fixed') return `Fixed: ${label.toLowerCase()}`;
    return `Still a problem: ${label.toLowerCase()}`;
  });
}

/** A plain-text report of every step, for saving or forwarding to whoever looks after the site. */
export function textReport(run: JourneyRun): string {
  const s = summarize(run);
  const out = [
    `Student Journey Check: ${host(run.siteUrl)}${run.demo ? ' (demo academy)' : ''}`,
    `Checked ${when(run.finishedAt)}`,
    '',
    s.headline,
    `${s.passed} working, ${s.warnings} to look at, ${s.failures} broken, ${s.skipped} not checked.`,
    '',
  ];
  for (const r of run.results) out.push(...stepLines(r), '');
  out.push('This check reads each page the way the server sends it. It does not run the page’s scripts or watch videos play.');
  return out.join('\n') + '\n';
}
