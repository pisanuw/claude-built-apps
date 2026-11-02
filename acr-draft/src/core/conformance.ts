import { answerFor, type Answer, type Project } from './project';
import { CRITERIA, GATES, type Criterion } from './wcag';

/** The conformance levels defined by the VPAT 2.5 template. */
export type Conformance = 'Supports' | 'Partially Supports' | 'Does Not Support' | 'Not Applicable' | 'Not Evaluated';

export const CONFORMANCE_LEVELS: Conformance[] = [
  'Supports',
  'Partially Supports',
  'Does Not Support',
  'Not Applicable',
  'Not Evaluated',
];

/**
 * "block": the report would make a claim the evidence does not back, or uses
 * a level VPAT does not allow for A/AA. "check": worth a second look.
 */
export type Severity = 'block' | 'check';

export interface Warning {
  severity: Severity;
  /** not-evaluated: no answer yet; others are about a specific claim. */
  kind: 'not-evaluated' | 'conflict' | 'evidence' | 'review' | 'scan-only';
  message: string;
}

export interface ScreenHit {
  screen: string;
  nodes: number;
  targets: string[];
}

export interface Finding {
  ruleId: string;
  help: string;
  helpUrl: string;
  impact: string | null;
  screens: ScreenHit[];
  totalNodes: number;
}

export interface CriterionResult {
  criterion: Criterion;
  level: Conformance;
  remark: string;
  warnings: Warning[];
  answer: Answer;
  violations: Finding[];
  incomplete: Finding[];
  /** Screens whose scan evaluated at least one rule for this criterion. */
  scannedScreens: number;
  /** Of those, screens with no violation for it. */
  cleanScreens: number;
}

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return /[.!?)]$/.test(t) ? t : `${t}.`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function collect(p: Project, criterionId: string) {
  const violations = new Map<string, Finding>();
  const incomplete = new Map<string, Finding>();
  let scannedScreens = 0;
  let cleanScreens = 0;
  const engines = new Set<string>();
  for (const s of p.screens) {
    if (!s.scan) continue;
    const rules = s.scan.rules.filter((r) => r.criteria.includes(criterionId));
    if (rules.length === 0) continue;
    scannedScreens += 1;
    engines.add(s.scan.engine);
    let failed = false;
    for (const r of rules) {
      if (r.outcome === 'pass') continue;
      if (r.outcome === 'violation') failed = true;
      const map = r.outcome === 'violation' ? violations : incomplete;
      const f = map.get(r.id) ?? { ruleId: r.id, help: r.help, helpUrl: r.helpUrl, impact: r.impact, screens: [], totalNodes: 0 };
      f.screens.push({ screen: s.name, nodes: r.nodes, targets: r.targets });
      f.totalNodes += r.nodes;
      map.set(r.id, f);
    }
    if (!failed) cleanScreens += 1;
  }
  return { violations: [...violations.values()], incomplete: [...incomplete.values()], scannedScreens, cleanScreens, engines };
}

function automatedSentence(found: ReturnType<typeof collect>): string {
  if (found.scannedScreens === 0) return '';
  const engine = found.engines.size === 1 ? [...found.engines][0] : 'axe-core';
  if (found.violations.length === 0) {
    return `Automated testing (${engine}) found no failures on ${plural(found.scannedScreens, 'screen')} tested.`;
  }
  const parts = found.violations.map((f) => {
    const where = listNames(f.screens.map((s) => s.screen));
    return `${f.help.replace(/\.$/, '')} (${plural(f.totalNodes, 'element')} on ${where})`;
  });
  return `Automated testing (${engine}) found: ${parts.join('; ')}.`;
}

function failingScreens(found: ReturnType<typeof collect>): string {
  const names = new Set(found.violations.flatMap((f) => f.screens.map((s) => s.screen)));
  return listNames([...names]);
}

/** Decide the conformance level, remark and warnings for one criterion. */
export function evaluateCriterion(p: Project, criterion: Criterion): CriterionResult {
  const answer = answerFor(p, criterion.id);
  const found = collect(p, criterion.id);
  const warnings: Warning[] = [];
  const base = {
    criterion,
    answer,
    violations: found.violations,
    incomplete: found.incomplete,
    scannedScreens: found.scannedScreens,
    cleanScreens: found.cleanScreens,
  };
  const note = sentence(answer.note);
  const auto = automatedSentence(found);
  const remarkOf = (...parts: string[]) => parts.filter(Boolean).join(' ');
  const hasViolations = found.violations.length > 0;
  const conflictText = () =>
    `the automated scan found ${plural(found.violations.length, 'failed rule')} on ${failingScreens(found)}. Fix and re-scan, or record what you found as Partly.`;

  if (criterion.alwaysSupports) {
    return { ...base, level: 'Supports', remark: criterion.alwaysSupports, warnings };
  }

  const gate = criterion.gate ? GATES.find((g) => g.id === criterion.gate) : undefined;
  const gateAnswer = gate ? p.gates[gate.id] : undefined;

  if (gate && gateAnswer === 'no' && answer.outcome === 'untested') {
    if (hasViolations) {
      warnings.push({ severity: 'block', kind: 'conflict', message: `You said "${gate.question}" is no, but ${conflictText()}` });
    }
    return { ...base, level: 'Not Applicable', remark: remarkOf(gate.naRemark, hasViolations ? auto : ''), warnings };
  }

  if (found.incomplete.length > 0 && answer.outcome !== 'na') {
    const n = found.incomplete.reduce((sum, f) => sum + f.totalNodes, 0);
    warnings.push({
      severity: 'check',
      kind: 'review',
      message: `axe could not decide on ${plural(n, 'element')} (${found.incomplete.map((f) => f.ruleId).join(', ')}) and asks a person to check them. Make sure your manual test covered them.`,
    });
  }

  switch (answer.outcome) {
    case 'untested': {
      if (hasViolations) {
        warnings.push({
          severity: 'check',
          kind: 'scan-only',
          message: 'Set from the automated scan only. Do the guided test and add a note so the remark explains the impact.',
        });
        const level: Conformance = found.cleanScreens === 0 ? 'Does Not Support' : 'Partially Supports';
        return { ...base, level, remark: auto, warnings };
      }
      const gateHint = gate && gateAnswer !== 'no' && gateAnswer !== 'yes' ? ` Or answer the product question "${gate.question}"` : '';
      warnings.push({
        severity: 'block',
        kind: 'not-evaluated',
        message: `Not evaluated yet. VPAT 2.5 allows "Not Evaluated" only for AAA criteria, so do the guided test.${gateHint}`,
      });
      return { ...base, level: 'Not Evaluated', remark: remarkOf('Not yet evaluated.', auto), warnings };
    }
    case 'pass': {
      if (!note) {
        warnings.push({
          severity: 'block',
          kind: 'evidence',
          message: 'Marked as passing with no evidence note. Say what you tested, on which screens, and with which browser or assistive technology.',
        });
      }
      if (hasViolations) {
        warnings.push({ severity: 'block', kind: 'conflict', message: `You marked this as passing, but ${conflictText()}` });
        return { ...base, level: 'Partially Supports', remark: remarkOf(note, auto), warnings };
      }
      return { ...base, level: 'Supports', remark: remarkOf(note, auto), warnings };
    }
    case 'partial':
    case 'fail': {
      if (!note) {
        warnings.push({
          severity: 'block',
          kind: 'evidence',
          message: 'Say what does not work and where. Buyers read this remark to judge the impact.',
        });
      }
      const level: Conformance = answer.outcome === 'fail' ? 'Does Not Support' : 'Partially Supports';
      return { ...base, level, remark: remarkOf(note, auto), warnings };
    }
    case 'na': {
      if (!note) {
        warnings.push({ severity: 'block', kind: 'evidence', message: 'Say why this does not apply (for example, "The product has no video").' });
      }
      if (hasViolations) {
        warnings.push({ severity: 'block', kind: 'conflict', message: `You marked this as not applicable, but ${conflictText()}` });
      }
      return { ...base, level: 'Not Applicable', remark: remarkOf(note, hasViolations ? auto : ''), warnings };
    }
  }
}

export interface Evaluation {
  results: CriterionResult[];
  counts: Record<'A' | 'AA', Record<Conformance, number>>;
  blocking: number;
  checks: number;
  /** Criteria the vendor has answered (or that are settled by a product question or by rule). */
  settled: number;
}

function emptyCounts(): Record<Conformance, number> {
  return { Supports: 0, 'Partially Supports': 0, 'Does Not Support': 0, 'Not Applicable': 0, 'Not Evaluated': 0 };
}

export function evaluate(p: Project): Evaluation {
  const results = CRITERIA.map((c) => evaluateCriterion(p, c));
  const counts = { A: emptyCounts(), AA: emptyCounts() };
  let blocking = 0;
  let checks = 0;
  let settled = 0;
  for (const r of results) {
    counts[r.criterion.level][r.level] += 1;
    for (const w of r.warnings) {
      if (w.severity === 'block') blocking += 1;
      else checks += 1;
    }
    if (r.level !== 'Not Evaluated') settled += 1;
  }
  return { results, counts, blocking, checks, settled };
}
