import type { Target } from './wcag';

/**
 * Everything the app knows lives in one Fleet object, saved in the browser and
 * exported as a "fleet file" for backup. Only page addresses, rule ids, WCAG
 * criteria and counts are stored: never visitor data or page content.
 */

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';
export const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

export type Jurisdiction = 'eu' | 'us' | 'both';

export interface Agency {
  name: string;
  email: string;
  website: string;
  /** Hex color used on client reports. */
  color: string;
  /** Line printed under every client report. */
  reportFooter: string;
}

export interface Site {
  id: string;
  name: string;
  client: string;
  url: string;
  /** Who the statement is published by (usually the client's legal name). */
  owner: string;
  /** Where visitors report accessibility problems. */
  contactEmail: string;
  jurisdiction: Jurisdiction;
  target: Target;
  /** Date of the last manual (human) review, YYYY-MM-DD, or ''. */
  manualReview: string;
  /** Free text for the statement: known limits the client accepts, third-party content. */
  knownLimits: string;
}

export interface Finding {
  ruleId: string;
  /** Short description from the checker. */
  help: string;
  criteria: string[];
  impact: Impact | null;
  /** Elements affected on the page. */
  count: number;
}

export interface PageResult {
  url: string;
  findings: Finding[];
}

export interface Check {
  id: string;
  siteId: string;
  /** YYYY-MM-DD */
  date: string;
  /** "axe-core 4.11.0", "pa11y", "Lighthouse 12.1", "CSV" ... */
  engine: string;
  pages: PageResult[];
}

export interface StatementVersion {
  siteId: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
}

export interface Fleet {
  version: 1;
  agency: Agency;
  sites: Site[];
  checks: Check[];
  statements: StatementVersion[];
  /** Notes keyed by issue key (site + page + rule), shown in logs and statements. */
  notes: Record<string, string>;
}

export function emptyAgency(): Agency {
  return { name: '', email: '', website: '', color: '#1f5f8b', reportFooter: '' };
}

export function emptyFleet(): Fleet {
  return { version: 1, agency: emptyAgency(), sites: [], checks: [], statements: [], notes: {} };
}

export function emptySite(id: string): Site {
  return { id, name: '', client: '', url: '', owner: '', contactEmail: '', jurisdiction: 'both', target: '2.1', manualReview: '', knownLimits: '' };
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Normalize a page address so the same page from two tools matches:
 * lower-case host, no fragment, no trailing slash (except the root), common
 * tracking parameters dropped. Text that is not a URL is trimmed and kept.
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return s;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
  }
  let path = u.pathname.replace(/\/+$/, '');
  if (path === '') path = '/';
  const q = u.searchParams.toString();
  return `${u.protocol}//${u.host.toLowerCase()}${path}${q ? `?${q}` : ''}`;
}

/** Host name of a site address, for matching imported pages to sites. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ---------- fleet file ----------

const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : d);

function readImpact(x: unknown): Impact | null {
  return typeof x === 'string' && (IMPACTS as string[]).includes(x) ? (x as Impact) : null;
}

function readFinding(x: unknown): Finding | null {
  if (!x || typeof x !== 'object') return null;
  const f = x as Record<string, unknown>;
  if (typeof f.ruleId !== 'string' || !f.ruleId) return null;
  const count = typeof f.count === 'number' && Number.isFinite(f.count) && f.count >= 0 ? Math.round(f.count) : 1;
  return {
    ruleId: f.ruleId,
    help: str(f.help, f.ruleId),
    criteria: Array.isArray(f.criteria) ? f.criteria.filter((c): c is string => typeof c === 'string') : [],
    impact: readImpact(f.impact),
    count,
  };
}

function readSite(x: unknown): Site | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) return null;
  const base = emptySite(s.id);
  const j = s.jurisdiction;
  return {
    id: s.id,
    name: str(s.name),
    client: str(s.client),
    url: str(s.url),
    owner: str(s.owner),
    contactEmail: str(s.contactEmail),
    jurisdiction: j === 'eu' || j === 'us' || j === 'both' ? j : base.jurisdiction,
    target: s.target === '2.2' ? '2.2' : '2.1',
    manualReview: isDate(s.manualReview) ? s.manualReview : '',
    knownLimits: str(s.knownLimits),
  };
}

function readCheck(x: unknown, siteIds: Set<string>): Check | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.siteId !== 'string' || !siteIds.has(c.siteId) || !isDate(c.date)) return null;
  const pages: PageResult[] = [];
  if (Array.isArray(c.pages)) {
    for (const p of c.pages) {
      if (!p || typeof p !== 'object' || typeof (p as PageResult).url !== 'string') continue;
      const raw = (p as { findings?: unknown }).findings;
      const findings = Array.isArray(raw) ? raw.map(readFinding).filter((f): f is Finding => f !== null) : [];
      pages.push({ url: (p as PageResult).url, findings });
    }
  }
  return { id: c.id, siteId: c.siteId, date: c.date, engine: str(c.engine, 'unknown'), pages };
}

/** Read a fleet file. Unknown or broken entries are dropped, not fatal. */
export function parseFleet(text: string): Fleet {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a fleet file (it is not valid JSON).');
  }
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== 'accessibility-fleet-log') {
    throw new Error('This is not a fleet file saved by Accessibility Fleet Log.');
  }
  const r = raw as Record<string, unknown>;
  const a = (r.agency && typeof r.agency === 'object' ? r.agency : {}) as Record<string, unknown>;
  const agency: Agency = {
    name: str(a.name),
    email: str(a.email),
    website: str(a.website),
    color: typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : emptyAgency().color,
    reportFooter: str(a.reportFooter),
  };
  const sites = (Array.isArray(r.sites) ? r.sites : []).map(readSite).filter((s): s is Site => s !== null);
  const ids = new Set(sites.map((s) => s.id));
  const checks = (Array.isArray(r.checks) ? r.checks : []).map((c) => readCheck(c, ids)).filter((c): c is Check => c !== null);
  const statements: StatementVersion[] = [];
  for (const v of Array.isArray(r.statements) ? r.statements : []) {
    if (v && typeof v === 'object' && ids.has((v as StatementVersion).siteId) && isDate((v as StatementVersion).date) && typeof (v as StatementVersion).text === 'string') {
      const sv = v as StatementVersion;
      statements.push({ siteId: sv.siteId, date: sv.date, text: sv.text });
    }
  }
  const notes: Record<string, string> = {};
  if (r.notes && typeof r.notes === 'object') {
    for (const [k, v] of Object.entries(r.notes as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) notes[k] = v;
  }
  return { version: 1, agency, sites, checks, statements, notes };
}

export function serializeFleet(f: Fleet): string {
  return JSON.stringify({ kind: 'accessibility-fleet-log', ...f }, null, 1);
}

/** Remove a site and everything recorded for it. */
export function removeSite(f: Fleet, siteId: string): Fleet {
  const prefix = `${siteId}|`;
  return {
    ...f,
    sites: f.sites.filter((s) => s.id !== siteId),
    checks: f.checks.filter((c) => c.siteId !== siteId),
    statements: f.statements.filter((s) => s.siteId !== siteId),
    notes: Object.fromEntries(Object.entries(f.notes).filter(([k]) => !k.startsWith(prefix))),
  };
}
