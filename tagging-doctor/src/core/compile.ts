/**
 * Compile and check (milestone 3b), the parts that need no network: what goes
 * into the upload, how the checker's answer reads in plain words (AC-29,
 * AC-30), and what a saved job row holds (AC-35). The checker is
 * `tagging-doctor-worker/`; its job view is mirrored by the types below.
 */
import type { Project } from './project';
import { OUTSIDE_PROGRAM } from './scan';
import rulesData from '../data/verapdf-rules.json';

/** The file types the checker accepts (tagging-doctor-worker/src/zip.ts, ALLOWED_EXTENSIONS). */
export const CHECKER_EXTENSIONS = [
  '.tex', '.sty', '.cls', '.bst', '.bib', '.bbx', '.cbx', '.def', '.cfg', '.clo', '.fd',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.eps', '.svg', '.tikz', '.pgf', '.txt',
] as const;

/** The checker's upload limit (AC-32). */
export const CHECKER_MAX_BYTES = 25 * 1024 * 1024;

/** True when the checker takes a file of this path (its own rule, so it never answers "not a file type"). */
export function checkerTakes(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  return CHECKER_EXTENSIONS.some((ext) => base.endsWith(ext) && base.length > ext.length);
}

/** The project's files that are not sent to the checker, by path (S2-9's list of files left out before Compile). */
export function leftOutOfUpload(project: Pick<Project, 'paths'>): string[] {
  return [...project.paths].filter((p) => !checkerTakes(p)).sort();
}

/** "2 files are not sent: notes.docx, data.csv." or '' (the names cut after five). */
export function leftOutOfUploadLine(paths: string[]): string {
  if (!paths.length) return '';
  const shown = paths.slice(0, 5).join(', ');
  const more = paths.length > 5 ? `, and ${paths.length - 5} more` : '';
  return `${paths.length === 1 ? '1 file is' : `${paths.length} files are`} not sent, because the checker does not use their type: ${shown}${more}.`;
}

// ---- The checker's answers ---------------------------------------------------

export interface CheckerClause {
  specification: string;
  clause: string;
  testNumber: number;
  failedChecks: number;
  description: string;
}

export interface CheckerValidation {
  profile: string;
  verapdfVersion: string;
  compliant: boolean;
  failedRules: number;
  failedChecks: number;
  clauses: CheckerClause[];
}

export interface CheckerResult {
  pages: number | null;
  seconds: number;
  warnings: number;
  runs: number;
  bibliography: 'biber' | 'bibtex' | null;
  validation: CheckerValidation | null;
  validationError: string | null;
}

export interface CheckerError {
  file: string | null;
  line: number | null;
  message: string;
}

export interface CheckerFailure {
  kind: string;
  message: string;
  error: CheckerError | null;
}

export interface CheckerJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  mainFile: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: CheckerResult | null;
  failure: CheckerFailure | null;
  logTail: string[];
  pdf: boolean;
  expiresAt: string | null;
  note: string | null;
  /** In the answer to a new job only: how many more checks the person may start this hour (S2-13). */
  checksLeft?: number;
}

// ---- AC-30: veraPDF's failures by clause ----------------------------------------

const RULES = rulesData as { specification: string; seenInFixtures: string[]; clauses: Record<string, string> };
/** The specification whose clauses the map holds; another one's clause shows veraPDF's own words. */
export const MAPPED_SPECIFICATION = RULES.specification;
/** Plain words for PDF/UA-2 clauses, those seen in the fixtures first (src/data/verapdf-rules.json). */
export const CLAUSE_WORDS: Record<string, string> = RULES.clauses;
export const CLAUSES_SEEN_IN_FIXTURES: string[] = RULES.seenInFixtures;

export interface ClauseRow {
  clause: string;
  specification: string;
  failedChecks: number;
  /** Plain words from the map, or veraPDF's own description. */
  words: string;
  /** True when the words are from the map. */
  plain: boolean;
}

/**
 * veraPDF's failed rules grouped by clause, with their counts added up, the
 * most frequent first, at most `top` (AC-30). A clause's words come from the
 * map, else from veraPDF's description of its most frequent rule.
 */
export function clauseRows(clauses: CheckerClause[], top = 20): ClauseRow[] {
  const by = new Map<string, ClauseRow>();
  for (const c of [...clauses].sort((a, b) => b.failedChecks - a.failedChecks)) {
    const key = `${c.specification}\u0000${c.clause}`;
    const row = by.get(key);
    if (row) {
      row.failedChecks += c.failedChecks;
      continue;
    }
    const mapped = c.specification === MAPPED_SPECIFICATION && Object.hasOwn(CLAUSE_WORDS, c.clause) ? CLAUSE_WORDS[c.clause] : undefined;
    by.set(key, { clause: c.clause, specification: c.specification, failedChecks: c.failedChecks, words: mapped ?? c.description, plain: !!mapped });
  }
  return [...by.values()].sort((a, b) => b.failedChecks - a.failedChecks || a.clause.localeCompare(b.clause, 'en', { numeric: true })).slice(0, top);
}

/** "Passed" or "Did not pass", never a claim of conformance (AC-9's rule, kept here too). */
export function validationVerdict(v: CheckerValidation): string {
  return v.compliant ? `Passed the ${profileName(v.profile)} check` : `Did not pass the ${profileName(v.profile)} check`;
}

/** veraPDF's profile name without its long tail: "PDF/UA-2 + Tagged PDF validation profile" reads "PDF/UA-2 + Tagged PDF". */
export function profileName(profile: string): string {
  return profile.replace(/\s+validation profile$/i, '').trim() || 'PDF/UA';
}

/** "Checked against PDF/UA-2 + Tagged PDF validation profile by veraPDF 1.30.4." */
export function validationLine(v: CheckerValidation): string {
  return `Checked against ${v.profile} by ${v.verapdfVersion}.`;
}

/** "9 rules failed, 4,785 checks in all." */
export function failuresLine(v: CheckerValidation): string {
  if (!v.failedRules) return 'No rule failed.';
  return `${v.failedRules === 1 ? '1 rule' : `${v.failedRules.toLocaleString('en-US')} rules`} failed, ${v.failedChecks === 1 ? '1 check' : `${v.failedChecks.toLocaleString('en-US')} checks`} in all.`;
}

// ---- AC-29: the compile -----------------------------------------------------------

/** "22 pages, compiled in 7.7 s, 3 LaTeX warnings." */
export function compiledLine(r: Pick<CheckerResult, 'pages' | 'seconds' | 'warnings'>): string {
  const pages = r.pages === null ? 'The page count was not found in the log' : r.pages === 1 ? '1 page' : `${r.pages} pages`;
  const warnings = r.warnings === 1 ? '1 LaTeX warning' : `${r.warnings} LaTeX warnings`;
  return `${pages}, compiled in ${r.seconds.toFixed(1)} s, ${warnings}.`;
}

/**
 * A missing file of a type the page does not send (R3b.1-5): it may be in the
 * person's zip, so "add it" would be wrong. Null for a type the checker takes,
 * or a name with no type.
 */
function notSent(name: string): string | null {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || checkerTakes(name)) return null;
  return `The checker does not take ${base.slice(dot).toLowerCase()} files, so ${name} was not sent; the compile needs it.`;
}

/** pgfplots' table error when the log line ends before the file's name does (R4a.1-3). */
export const PGF_TABLE_CUT =
  'pgfplots could not read a table file; the log cuts its name. The checker does not take .csv or .dat files, so a table in one was not sent; a table of another type must be in the zip, under the name the document gives.';

/** TeX ran out of the memory the checker gives one job (R4b.2-3). */
export const MEMORY_WORDS =
  'The document needs more memory than the checker gives one job. It is not an error in your source: a long tagged document can need this much (about 50 pages of dense mathematics). Check a part of it, or the untagged original. It can also mean that a command calls itself without end.';

/** TeX ran out of a stack or nesting level: a definition that uses itself (R5a.1-6 c). */
export const RECURSION_WORDS = 'A command calls itself without end, or groups or files are nested too deeply: look for a definition that uses its own name.';

/**
 * The first error in plain words (AC-29; S2-9's map of common TeX errors), or
 * null when the message is not one of them (TeX's own words are then shown).
 * Outside programs get the scan's own words (S2-8, AC-8).
 */
export const TEX_ERRORS: [RegExp, (m: RegExpExecArray) => string][] = [
  // The checker caps TeX's memory in the hub (D-134): a long tagged document can reach the cap (R4b.2-3, D-139).
  // LuaTeX's two memory sizes (node and token memory; the image's luahbtex has no pdfTeX "main memory"), and Lua's (R5a.2-5).
  [/TeX capacity exceeded, sorry \[(?:node memory|token memory|main memory)|not enough memory/i, () => MEMORY_WORDS],
  // A stack, a nesting level or the expansion depth: a command that calls itself, not the checker's cap (R5a.1-6 c, R5a.2-5).
  [/TeX capacity exceeded, sorry \[(?:input stack|text input levels|grouping levels|parameter stack|save size|semantic nest|expansion depth)/i, () => RECURSION_WORDS],
  [/Undefined control sequence/i, () => 'A command is not defined. Check its spelling, or load the package that defines it.'],
  // pgfplots' own words. TeX wraps the log at 79 columns, so the name is read only up to its closing quote on the
  // same line; a name the wrap cut is not named at all (R3b.2-4, R4a.1-3). The closing quote is the one before
  // " in '…'" or the line's end, so a name may hold an apostrophe (R4a.2-4 e).
  [/Could not read table file(?: [`'‘](.+?)['’](?= in [`'‘]|[.,;:]?(?:\s|$)))?/i, (m) => (m[1] ? (notSent(m[1]) ?? `The table file ${m[1]} could not be read. Add it to the zip, or check its name.`) : PGF_TABLE_CUT)],
  [/LaTeX Error: File [`'‘]([^'’`]+)['’] not found/i, (m) => notSent(m[1]) ?? `The file ${m[1]} was not found. Add it to the zip, or check its name; packages outside TeX Live are not installed on the checker.`],
  [/File [`'‘]([^'’`]+)['’] not found/i, (m) => notSent(m[1]) ?? `The file ${m[1]} was not found. Add it to the zip, or check its name.`],
  [/Missing \$ inserted/i, () => 'A math symbol is outside math mode: a $ is missing, or a _ or ^ is in plain text.'],
  [/Missing \\begin\{document\}/i, () => 'Text comes before \\begin{document}, or the preamble has a stray character.'],
  [/Environment (\S+) undefined/i, (m) => `The environment ${m[1]} is not defined. Load the package that defines it, or check its name.`],
  [/\\begin\{([^}]+)\} on input line (\d+) ended by \\end\{([^}]+)\}/i, (m) => `The ${m[1]} environment opened on line ${m[2]} is closed by \\end{${m[3]}}. Close each environment with its own name.`],
  [/Extra \}, or forgotten \$/i, () => 'A closing brace has no opening brace, or a $ is missing.'],
  [/Missing \} inserted/i, () => 'A closing brace is missing.'],
  [/Too many \}'s/i, () => 'There are more closing braces than opening ones.'],
  [/Runaway argument/i, () => 'An argument does not end: a closing brace is probably missing.'],
  [/Paragraph ended before (\S+) was complete/i, (m) => `A blank line came inside the argument of ${m[1]}: a closing brace is probably missing.`],
  [/Option clash for package (\S+)/i, (m) => `The package ${m[1]} is loaded twice with different options. Load it once, with all its options.`],
  [/Can be used only in preamble/i, () => 'A command that belongs in the preamble is used after \\begin{document}. Move it above.'],
  [/Missing number, treated as zero/i, () => 'A number or a length is expected and is missing.'],
  [/Illegal unit of measure/i, () => 'A length has no unit or a wrong one (use pt, mm, cm, in or em).'],
  [/Unknown graphics extension/i, () => 'A figure has a file type the compile cannot read. Convert it to PDF or PNG.'],
  [/Emergency stop/i, () => 'The compile could not go on, usually because of the error just before it in the log.'],
  [/luaotfload|font .* not (found|loadable)|Font \S+ not loadable/i, () => 'A font was not found. Use a font installed with TeX Live: the checker does not take font files.'],
  [/shell escape|write18|\\immediate\\write18|-shell-escape/i, () => OUTSIDE_PROGRAM],
  [/minted|pythontex|gnuplot|epstopdf|inkscape|\\tikzexternalize/i, () => OUTSIDE_PROGRAM],
];

export function plainTexError(message: string): string | null {
  for (const [re, words] of TEX_ERRORS) {
    const m = re.exec(message);
    if (m) return words(m);
  }
  return null;
}

/** "In chapters/ch1.tex, line 12:" or "" when the checker gave neither. */
export function errorWhere(e: CheckerError): string {
  if (e.file && e.line !== null) return `In ${e.file}, line ${e.line}`;
  if (e.file) return `In ${e.file}`;
  if (e.line !== null) return `On line ${e.line}`;
  return '';
}

// ---- AC-35: the job row ---------------------------------------------------------------

/** What a saved job row's `result` holds: counts, the profile and the failures by clause; no PDF, no source, no log. */
export interface JobSummary {
  pages: number | null;
  seconds: number;
  warnings: number;
  runs: number;
  bibliography: 'biber' | 'bibtex' | null;
  profile: string | null;
  verapdfVersion: string | null;
  passed: boolean | null;
  failedRules: number | null;
  failedChecks: number | null;
  /** Clause and count only, at most 20. */
  failures: { clause: string; failedChecks: number }[];
}

export interface JobRecord {
  kind: 'check' | 'patched-check';
  status: 'done' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  result: JobSummary | null;
  /** The failure's kind and message, and the first error's place and message (at most 300 characters); never log lines. */
  error: string | null;
}

/** The row for a finished job (AC-35). A job still running has none. */
export function jobRecord(job: CheckerJob, kind: JobRecord['kind'] = 'check'): JobRecord | null {
  if (job.status !== 'done' && job.status !== 'failed') return null;
  const r = job.result;
  const v = r?.validation ?? null;
  const f = job.failure;
  const error = f
    ? [`${f.kind}: ${f.message}`, f.error ? `${errorWhere(f.error)}${errorWhere(f.error) ? ': ' : ''}${f.error.message.slice(0, 300)}` : '']
        .filter(Boolean)
        .join(' ')
        .slice(0, 4000)
    : null;
  return {
    kind,
    status: job.status,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    result: r
      ? {
          pages: r.pages,
          seconds: r.seconds,
          warnings: r.warnings,
          runs: r.runs,
          bibliography: r.bibliography,
          profile: v?.profile ?? null,
          verapdfVersion: v?.verapdfVersion ?? null,
          passed: v ? v.compliant : null,
          failedRules: v?.failedRules ?? null,
          failedChecks: v?.failedChecks ?? null,
          failures: v ? clauseRows(v.clauses).map((c) => ({ clause: c.clause, failedChecks: c.failedChecks })) : [],
        }
      : null,
    error,
  };
}

/** One line for a saved job in the project's history (AC-35). */
export function jobLine(row: { status: string; result: JobSummary | null; error: string | null }): string {
  if (row.status === 'failed') return `Did not compile. ${row.error ? row.error.replace(/^[a-z-]+: /, '') : ''}`.trim();
  const r = row.result;
  if (!r) return row.status === 'done' ? 'Compiled.' : `Status: ${row.status}.`;
  const compiled = compiledLine(r);
  if (r.passed === null) return `${compiled} The PDF could not be checked.`;
  return `${compiled} ${r.passed ? 'Passed' : 'Did not pass'} the ${profileName(r.profile ?? '')} check${r.failedRules ? ` (${r.failedRules === 1 ? '1 rule' : `${r.failedRules} rules`} failed)` : ''}.`;
}
