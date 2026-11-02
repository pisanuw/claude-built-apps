import { CRITERIA_BY_ID, GATES, type GateId } from './wcag';

/** What the vendor found when doing a guided manual test. */
export type Outcome = 'pass' | 'partial' | 'fail' | 'na' | 'untested';

export interface Answer {
  outcome: Outcome;
  /** Evidence: what was tested, where, with what, and what happened. */
  note: string;
}

export type RuleOutcome = 'violation' | 'pass' | 'incomplete';

/** One axe-core rule result on one screen, reduced to what the report needs. */
export interface RuleResult {
  id: string;
  help: string;
  helpUrl: string;
  impact: string | null;
  outcome: RuleOutcome;
  criteria: string[];
  nodes: number;
  /** Up to five CSS selectors of affected elements, for the evidence appendix. */
  targets: string[];
}

export interface Scan {
  /** "axe-json" for imported results, "html-scan" for an in-app scan of pasted HTML. */
  source: 'axe-json' | 'html-scan';
  engine: string;
  url: string;
  timestamp: string;
  rules: RuleResult[];
}

export interface Screen {
  id: string;
  name: string;
  url: string;
  scan: Scan | null;
}

export interface Product {
  name: string;
  version: string;
  reportDate: string;
  description: string;
  contact: string;
  /** Extra notes for the report's Notes section. */
  notes: string;
  /** Browsers and assistive technology used for manual testing. */
  testedWith: string;
}

export type GateAnswer = 'yes' | 'no' | 'unsure';

export interface Project {
  format: 'acr-draft';
  version: 1;
  product: Product;
  gates: Partial<Record<GateId, GateAnswer>>;
  screens: Screen[];
  answers: Record<string, Answer>;
  savedAt: string;
}

export function emptyProject(today: string): Project {
  return {
    format: 'acr-draft',
    version: 1,
    product: { name: '', version: '', reportDate: today, description: '', contact: '', notes: '', testedWith: '' },
    gates: {},
    screens: [],
    answers: {},
    savedAt: '',
  };
}

let counter = 0;
/** Short unique id for a screen. */
export function newId(prefix = 's'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function answerFor(p: Project, id: string): Answer {
  return p.answers[id] ?? { outcome: 'untested', note: '' };
}

const OUTCOMES: Outcome[] = ['pass', 'partial', 'fail', 'na', 'untested'];
const GATE_IDS = new Set<string>(GATES.map((g) => g.id));

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function parseRule(raw: unknown): RuleResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const outcome = r.outcome;
  if (typeof r.id !== 'string' || (outcome !== 'violation' && outcome !== 'pass' && outcome !== 'incomplete')) return null;
  return {
    id: r.id,
    help: str(r.help, r.id),
    helpUrl: str(r.helpUrl),
    impact: typeof r.impact === 'string' ? r.impact : null,
    outcome,
    criteria: Array.isArray(r.criteria) ? r.criteria.filter((x): x is string => typeof x === 'string' && CRITERIA_BY_ID.has(x)) : [],
    nodes: typeof r.nodes === 'number' && r.nodes >= 0 ? Math.floor(r.nodes) : 0,
    targets: Array.isArray(r.targets) ? r.targets.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
  };
}

function parseScan(raw: unknown): Scan | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.rules)) return null;
  return {
    source: s.source === 'html-scan' ? 'html-scan' : 'axe-json',
    engine: str(s.engine, 'axe-core'),
    url: str(s.url),
    timestamp: str(s.timestamp),
    rules: s.rules.map(parseRule).filter((x): x is RuleResult => x !== null),
  };
}

/**
 * Read a saved project file. Throws an Error with a readable message if the
 * text is not an ACR Draft project. Unknown fields are dropped.
 */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON, so it is not an ACR Draft project file.');
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).format !== 'acr-draft') {
    throw new Error('This is not an ACR Draft project file (it has no "format": "acr-draft").');
  }
  const r = raw as Record<string, unknown>;
  const prod = (r.product && typeof r.product === 'object' ? r.product : {}) as Record<string, unknown>;
  const gates: Project['gates'] = {};
  if (r.gates && typeof r.gates === 'object') {
    for (const [k, v] of Object.entries(r.gates as Record<string, unknown>)) {
      if (GATE_IDS.has(k) && (v === 'yes' || v === 'no' || v === 'unsure')) gates[k as GateId] = v;
    }
  }
  const answers: Record<string, Answer> = {};
  if (r.answers && typeof r.answers === 'object') {
    for (const [k, v] of Object.entries(r.answers as Record<string, unknown>)) {
      if (!CRITERIA_BY_ID.has(k) || !v || typeof v !== 'object') continue;
      const a = v as Record<string, unknown>;
      const outcome = OUTCOMES.includes(a.outcome as Outcome) ? (a.outcome as Outcome) : 'untested';
      answers[k] = { outcome, note: str(a.note) };
    }
  }
  const screens: Screen[] = Array.isArray(r.screens)
    ? r.screens
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({ id: str(s.id) || newId(), name: str(s.name, 'Untitled screen'), url: str(s.url), scan: parseScan(s.scan) }))
    : [];
  return {
    format: 'acr-draft',
    version: 1,
    product: {
      name: str(prod.name),
      version: str(prod.version),
      reportDate: str(prod.reportDate),
      description: str(prod.description),
      contact: str(prod.contact),
      notes: str(prod.notes),
      testedWith: str(prod.testedWith),
    },
    gates,
    screens,
    answers,
    savedAt: str(r.savedAt),
  };
}

export function serializeProject(p: Project, now: Date): string {
  return JSON.stringify({ ...p, savedAt: now.toISOString() }, null, 2);
}

/** File name for a saved project, e.g. "quiznest-4.2-acr-project.json". */
export function projectFileName(p: Project, suffix = 'acr-project.json'): string {
  const base = [p.product.name, p.product.version]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'product'}-${suffix}`;
}
