import { parseCsv } from './csv';
import { hostOf, isDate, normalizeUrl, type Fleet, type Finding, type Impact, type PageResult } from './model';
import { criteriaForRule, criteriaInText, tagToCriterion } from './wcag';

/**
 * Turn checker output into page results. Supported: axe-core JSON (browser
 * extension, console snippet, @axe-core/cli), pa11y and pa11y-ci JSON,
 * Lighthouse JSON, and CSV from any checker or spreadsheet. Only failures are
 * kept, as rule ids, WCAG criteria and element counts per page.
 */

export type Format = 'axe' | 'pa11y' | 'pa11y-ci' | 'lighthouse' | 'csv';

export interface ImportResult {
  format: Format;
  engine: string;
  /** Date the checker ran, if the file says (YYYY-MM-DD). */
  date: string | null;
  pages: PageResult[];
  /** Things the owner should know (skipped warnings, missing page address). */
  notes: string[];
}

export interface ImportOptions {
  /** Page address to use when the file does not name one (pa11y JSON). */
  pageUrl?: string;
  /** CSV column choice, when the guess was wrong. */
  csvMapping?: CsvMapping;
}

class PageBag {
  private pages = new Map<string, Map<string, Finding>>();

  add(url: string, f: Finding): void {
    const key = normalizeUrl(url);
    let rules = this.pages.get(key);
    if (!rules) {
      rules = new Map();
      this.pages.set(key, rules);
    }
    const prev = rules.get(f.ruleId);
    if (prev) {
      prev.count += f.count;
      for (const c of f.criteria) if (!prev.criteria.includes(c)) prev.criteria.push(c);
      if (!prev.impact) prev.impact = f.impact;
    } else rules.set(f.ruleId, { ...f, criteria: [...f.criteria] });
  }

  /** A page that was checked and passed still counts: it proves fixes. */
  touch(url: string): void {
    const key = normalizeUrl(url);
    if (!this.pages.has(key)) this.pages.set(key, new Map());
  }

  result(): PageResult[] {
    return [...this.pages.entries()].map(([url, rules]) => ({ url, findings: [...rules.values()] }));
  }
}

const IMPACT_WORDS: [RegExp, Impact][] = [
  [/^(critical|blocker|urgent)$/i, 'critical'],
  [/^(serious|high|major|error|errors|violation|fail|failed|failure)$/i, 'serious'],
  [/^(moderate|medium|warning|warnings)$/i, 'moderate'],
  [/^(minor|low|notice|notices|info)$/i, 'minor'],
];

export function readImpact(v: unknown): Impact | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  for (const [re, imp] of IMPACT_WORDS) if (re.test(s)) return imp;
  return null;
}

function dateOf(ts: unknown): string | null {
  if (typeof ts !== 'string') return null;
  const d = ts.slice(0, 10);
  return isDate(d) ? d : null;
}

// ---------- axe-core ----------

interface AxeRule {
  id?: unknown;
  help?: unknown;
  impact?: unknown;
  tags?: unknown;
  nodes?: unknown;
}

function isAxe(x: unknown): x is { url?: unknown; timestamp?: unknown; testEngine?: { version?: unknown }; violations: unknown[]; incomplete?: unknown } {
  return !!x && typeof x === 'object' && Array.isArray((x as { violations?: unknown }).violations);
}

function axeCriteria(rule: AxeRule): string[] {
  const tags = Array.isArray(rule.tags) ? rule.tags.filter((t): t is string => typeof t === 'string') : [];
  const fromTags = [...new Set(tags.map(tagToCriterion).filter((x): x is string => x !== null))];
  return fromTags.length > 0 ? fromTags : typeof rule.id === 'string' ? criteriaForRule(rule.id) : [];
}

function importAxe(list: unknown[], opts: ImportOptions): ImportResult {
  const bag = new PageBag();
  const notes: string[] = [];
  let version = '';
  let date: string | null = null;
  let review = 0;
  list.forEach((r, i) => {
    if (!isAxe(r)) throw new Error(`Item ${i + 1} is not an axe-core result (no "violations" list).`);
    const url = typeof r.url === 'string' && r.url ? r.url : opts.pageUrl ?? '';
    if (!url) throw new Error('These axe results do not say which page they are for. Type the page address and import again.');
    if (!version && r.testEngine && typeof r.testEngine.version === 'string') version = r.testEngine.version;
    date = date ?? dateOf(r.timestamp);
    bag.touch(url);
    for (const raw of r.violations as AxeRule[]) {
      if (!raw || typeof raw.id !== 'string') continue;
      const nodes = Array.isArray(raw.nodes) ? raw.nodes.length : 0;
      bag.add(url, {
        ruleId: raw.id,
        help: typeof raw.help === 'string' ? raw.help : raw.id,
        criteria: axeCriteria(raw),
        impact: readImpact(raw.impact),
        count: Math.max(1, nodes),
      });
    }
    if (Array.isArray(r.incomplete)) review += r.incomplete.length;
  });
  if (review > 0) notes.push(`${review} "needs review" result${review === 1 ? '' : 's'} left out: axe could not decide them, so a person should check them by hand.`);
  return { format: 'axe', engine: version ? `axe-core ${version}` : 'axe-core', date, pages: bag.result(), notes };
}

// ---------- pa11y ----------

interface Pa11yIssue {
  code?: unknown;
  type?: unknown;
  message?: unknown;
  runner?: unknown;
}

function addPa11y(bag: PageBag, url: string, issues: unknown[]): number {
  let skipped = 0;
  bag.touch(url);
  for (const raw of issues as Pa11yIssue[]) {
    if (!raw || typeof raw.code !== 'string') continue;
    if (raw.type !== undefined && raw.type !== 'error') {
      skipped += 1;
      continue;
    }
    const fromCode = criteriaInText(raw.code);
    bag.add(url, {
      ruleId: raw.code,
      help: typeof raw.message === 'string' ? raw.message.split('\n')[0].slice(0, 200) : raw.code,
      criteria: fromCode.length > 0 ? fromCode : criteriaForRule(raw.code),
      impact: 'serious',
      count: 1,
    });
  }
  return skipped;
}

function skippedNote(n: number): string[] {
  return n > 0 ? [`${n} warning${n === 1 ? '' : 's'} and notice${n === 1 ? '' : 's'} left out: only errors are logged.`] : [];
}

function importPa11y(issues: unknown[], opts: ImportOptions): ImportResult {
  const url = opts.pageUrl?.trim();
  if (!url) throw new Error('pa11y JSON does not say which page it checked. Type the page address and import again.');
  const bag = new PageBag();
  const skipped = addPa11y(bag, url, issues);
  return { format: 'pa11y', engine: 'pa11y', date: null, pages: bag.result(), notes: skippedNote(skipped) };
}

function importPa11yCi(results: Record<string, unknown>): ImportResult {
  const bag = new PageBag();
  let skipped = 0;
  for (const [url, issues] of Object.entries(results)) {
    if (!Array.isArray(issues)) continue;
    // pa11y-ci puts an { message } object in the list when a page failed to load.
    if (issues.some((x) => x && typeof x === 'object' && !('code' in x) && 'message' in x)) continue;
    skipped += addPa11y(bag, url, issues);
  }
  return { format: 'pa11y-ci', engine: 'pa11y-ci', date: null, pages: bag.result(), notes: skippedNote(skipped) };
}

// ---------- Lighthouse ----------

interface LhAudit {
  title?: unknown;
  score?: unknown;
  scoreDisplayMode?: unknown;
  details?: { items?: unknown };
}

function importLighthouse(lhr: Record<string, unknown>, opts: ImportOptions): ImportResult {
  const url = [lhr.finalDisplayedUrl, lhr.finalUrl, lhr.requestedUrl, opts.pageUrl].find((u): u is string => typeof u === 'string' && u !== '');
  if (!url) throw new Error('This Lighthouse report does not say which page it checked.');
  const audits = (lhr.audits ?? {}) as Record<string, LhAudit>;
  const cats = lhr.categories as { accessibility?: { auditRefs?: { id?: unknown }[] } } | undefined;
  const refs = cats?.accessibility?.auditRefs;
  const ids = Array.isArray(refs) ? refs.map((r) => r.id).filter((x): x is string => typeof x === 'string') : Object.keys(audits).filter((id) => criteriaForRule(id).length > 0);
  if (ids.length === 0) throw new Error('This Lighthouse report has no accessibility results. Run Lighthouse with the Accessibility category ticked.');
  const bag = new PageBag();
  bag.touch(url);
  for (const id of ids) {
    const a = audits[id];
    if (!a || a.scoreDisplayMode !== 'binary' || a.score !== 0) continue;
    const items = Array.isArray(a.details?.items) ? a.details.items.length : 0;
    bag.add(url, { ruleId: id, help: typeof a.title === 'string' ? a.title : id, criteria: criteriaForRule(id), impact: null, count: Math.max(1, items) });
  }
  const v = typeof lhr.lighthouseVersion === 'string' ? ` ${lhr.lighthouseVersion}` : '';
  return { format: 'lighthouse', engine: `Lighthouse${v}`, date: dateOf(lhr.fetchTime), pages: bag.result(), notes: [] };
}

// ---------- CSV ----------

export interface CsvMapping {
  url: number;
  rule: number;
  help: number;
  criteria: number;
  impact: number;
  count: number;
  status: number;
}

const GUESS: [keyof CsvMapping, RegExp][] = [
  ['url', /\b(url|page|address|link|permalink|location)\b/i],
  ['criteria', /(wcag|criteri|success|\bsc\b|guideline|standard)/i],
  ['rule', /\b(rule|check|code|test|issue( ?id| ?type)?|problem|error|violation)\b/i],
  ['help', /(description|message|summary|title|help|details|name)/i],
  ['impact', /(impact|severity|priority|level|type)/i],
  ['count', /(count|instances|occurrences|elements|nodes|number|total)/i],
  ['status', /\b(status|state|resolved|ignored)\b/i],
];

/** Guess which column holds what. -1 means "not present". */
export function guessCsvMapping(headers: string[]): CsvMapping {
  const m: CsvMapping = { url: -1, rule: -1, help: -1, criteria: -1, impact: -1, count: -1, status: -1 };
  const used = new Set<number>();
  for (const [key, re] of GUESS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h));
    if (i >= 0) {
      m[key] = i;
      used.add(i);
    }
  }
  return m;
}

const CLOSED = /^(ignored?|dismissed|resolved|fixed|pass(ed)?|closed|false positive|won'?t fix|n\/?a)$/i;

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'issue'
  );
}

export function csvHeaders(text: string): string[] {
  return parseCsv(text)[0] ?? [];
}

function importCsv(text: string, opts: ImportOptions): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('The file is empty.');
  const headers = rows[0].map((h) => h.trim());
  const m = opts.csvMapping ?? guessCsvMapping(headers);
  if (m.url < 0 && !opts.pageUrl) throw new Error('No column with page addresses found. Name one "Page" or "URL", or pick it below.');
  if (m.rule < 0 && m.help < 0) throw new Error('No column with the issue found. Name one "Rule", "Issue" or "Description", or pick it below.');
  const bag = new PageBag();
  let closed = 0;
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const url = get(m.url) || opts.pageUrl || '';
    if (!url) continue;
    if (CLOSED.test(get(m.status))) {
      closed += 1;
      bag.touch(url);
      continue;
    }
    const help = get(m.help);
    const ruleText = get(m.rule) || help;
    if (!ruleText) {
      bag.touch(url);
      continue;
    }
    const ruleId = /\s/.test(ruleText) && ruleText.length > 40 ? slug(ruleText) : ruleText;
    const fromCol = criteriaInText(get(m.criteria));
    const fromRule = criteriaInText(ruleText);
    const criteria = fromCol.length > 0 ? fromCol : fromRule.length > 0 ? fromRule : criteriaForRule(ruleId);
    const n = Number.parseInt(get(m.count).replace(/[^\d]/g, ''), 10);
    bag.add(url, { ruleId, help: help || ruleText, criteria, impact: readImpact(get(m.impact)), count: Number.isFinite(n) && n > 0 ? n : 1 });
  }
  const notes = closed > 0 ? [`${closed} row${closed === 1 ? '' : 's'} marked ignored, resolved or passed were not logged as issues.`] : [];
  return { format: 'csv', engine: 'CSV import', date: null, pages: bag.result(), notes };
}

// ---------- entry point ----------

/** Work out the format from the content and import it. */
export function importResults(text: string, opts: ImportOptions = {}): ImportResult {
  const t = text.trim();
  if (!t) throw new Error('Nothing to import: the file or box is empty.');
  if (t.startsWith('{') || t.startsWith('[')) {
    let raw: unknown;
    try {
      raw = JSON.parse(t);
    } catch {
      throw new Error('This looks like JSON but cannot be read. Paste or upload the whole file.');
    }
    if (Array.isArray(raw)) {
      if (raw.length > 0 && isAxe(raw[0])) return importAxe(raw, opts);
      return importPa11y(raw, opts);
    }
    const o = raw as Record<string, unknown>;
    if (isAxe(o)) return importAxe([o], opts);
    if (o.audits && typeof o.audits === 'object') return importLighthouse(o, opts);
    if (o.results && typeof o.results === 'object' && !Array.isArray(o.results)) return importPa11yCi(o.results as Record<string, unknown>);
    throw new Error('This JSON is not from a checker this app reads (axe-core, pa11y, pa11y-ci or Lighthouse).');
  }
  return importCsv(t, opts);
}

/** The site whose address matches most of the imported pages, if any. */
export function matchSite(fleet: Fleet, pages: PageResult[]): string | null {
  const votes = new Map<string, number>();
  for (const p of pages) {
    const h = hostOf(p.url);
    const site = fleet.sites.find((s) => h && hostOf(s.url) === h);
    if (site) votes.set(site.id, (votes.get(site.id) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [id, v] of votes) {
    if (v > n) {
      best = id;
      n = v;
    }
  }
  return best;
}

/** Pages whose host differs from the site's address. */
export function foreignPages(siteUrl: string, pages: PageResult[]): string[] {
  const h = hostOf(siteUrl);
  if (!h) return [];
  return pages.filter((p) => hostOf(p.url) !== h).map((p) => p.url);
}
