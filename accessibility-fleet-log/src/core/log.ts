import type { Check, Fleet, Impact, Site } from './model';
import { compareCriteria, inTarget, type Target } from './wcag';

/**
 * The dated issue log. An issue is one checker rule failing on one page. Its
 * history comes from replaying the site's checks in date order:
 *
 * - found: the first check of that page that reported the rule;
 * - fixed: the first later check of the same page that no longer reports it;
 * - reopened: reported again after being fixed.
 *
 * A check that did not cover the page says nothing about the issue, so a
 * partial check never marks issues on other pages as fixed.
 */

export type IssueStatus = 'open' | 'fixed';

/** Whether an issue counts against the site's WCAG target. */
export type Scope = 'target' | 'beyond' | 'best-practice';

export interface IssueEvent {
  date: string;
  kind: 'found' | 'fixed' | 'reopened';
}

export interface Issue {
  key: string;
  siteId: string;
  pageUrl: string;
  ruleId: string;
  help: string;
  criteria: string[];
  impact: Impact | null;
  /** Elements affected in the most recent check that reported it. */
  count: number;
  firstFound: string;
  lastSeen: string;
  /** Date of the check that found it gone; null while open. */
  fixedOn: string | null;
  status: IssueStatus;
  events: IssueEvent[];
  scope: Scope;
}

export function issueKey(siteId: string, pageUrl: string, ruleId: string): string {
  return `${siteId}|${pageUrl}|${ruleId}`;
}

export function scopeOf(criteria: string[], target: Target): Scope {
  if (criteria.length === 0) return 'best-practice';
  return criteria.some((c) => inTarget(c, target)) ? 'target' : 'beyond';
}

/** Checks for one site, oldest first (ties keep the order they were added). */
export function siteChecks(fleet: Fleet, siteId: string): Check[] {
  return fleet.checks
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.siteId === siteId)
    .sort((a, b) => (a.c.date < b.c.date ? -1 : a.c.date > b.c.date ? 1 : a.i - b.i))
    .map(({ c }) => c);
}

/** Replay a site's checks up to and including `asOf` (YYYY-MM-DD). */
export function buildLog(fleet: Fleet, site: Site, asOf = '9999-12-31'): Issue[] {
  const issues = new Map<string, Issue>();
  for (const check of siteChecks(fleet, site.id)) {
    if (check.date > asOf) break;
    for (const page of check.pages) {
      const seen = new Set<string>();
      for (const f of page.findings) {
        const key = issueKey(site.id, page.url, f.ruleId);
        seen.add(key);
        const prev = issues.get(key);
        if (!prev) {
          issues.set(key, {
            key,
            siteId: site.id,
            pageUrl: page.url,
            ruleId: f.ruleId,
            help: f.help,
            criteria: [...f.criteria].sort(compareCriteria),
            impact: f.impact,
            count: f.count,
            firstFound: check.date,
            lastSeen: check.date,
            fixedOn: null,
            status: 'open',
            events: [{ date: check.date, kind: 'found' }],
            scope: scopeOf(f.criteria, site.target),
          });
          continue;
        }
        if (prev.status === 'fixed') {
          prev.status = 'open';
          prev.fixedOn = null;
          prev.events.push({ date: check.date, kind: 'reopened' });
        }
        prev.lastSeen = check.date;
        prev.count = f.count;
        prev.impact = f.impact ?? prev.impact;
        prev.help = f.help || prev.help;
      }
      for (const issue of issues.values()) {
        if (issue.pageUrl === page.url && issue.status === 'open' && !seen.has(issue.key)) {
          issue.status = 'fixed';
          issue.fixedOn = check.date;
          issue.events.push({ date: check.date, kind: 'fixed' });
        }
      }
    }
  }
  return [...issues.values()];
}

const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/** Open first, then by impact, then by criterion and page. */
export function sortIssues(list: Issue[]): Issue[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    const ia = IMPACT_RANK[a.impact ?? ''] ?? 4;
    const ib = IMPACT_RANK[b.impact ?? ''] ?? 4;
    if (ia !== ib) return ia - ib;
    const ca = a.criteria[0] ?? '9';
    const cb = b.criteria[0] ?? '9';
    const c = compareCriteria(ca, cb);
    if (c !== 0) return c;
    return a.pageUrl < b.pageUrl ? -1 : a.pageUrl > b.pageUrl ? 1 : a.ruleId < b.ruleId ? -1 : 1;
  });
}

export interface CriterionGroup {
  /** WCAG id, or '' for best-practice rules. */
  id: string;
  issues: Issue[];
  pages: number;
}

/** Open issues grouped by WCAG criterion (an issue mapped to two criteria appears under both). */
export function byCriterion(list: Issue[]): CriterionGroup[] {
  const groups = new Map<string, Issue[]>();
  for (const i of list) {
    const ids = i.criteria.length > 0 ? i.criteria : [''];
    for (const id of ids) {
      const g = groups.get(id) ?? [];
      g.push(i);
      groups.set(id, g);
    }
  }
  return [...groups.entries()]
    .map(([id, issues]) => ({ id, issues, pages: new Set(issues.map((i) => i.pageUrl)).size }))
    .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : compareCriteria(a.id, b.id)));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// ---------- fleet dashboard ----------

/** A check older than this many days is "due". */
export const CHECK_DUE_DAYS = 35;
/** Statements should be reviewed at least yearly. */
export const STATEMENT_DUE_DAYS = 365;

export type StatementState = 'none' | 'current' | 'outdated' | 'old';

export interface SiteRow {
  site: Site;
  lastCheck: string | null;
  checks: number;
  pages: number;
  open: number;
  /** Open issues that count against the WCAG target. */
  openTarget: number;
  critical: number;
  /** Change in open issues since the previous check (null with fewer than two checks). */
  trend: number | null;
  fixed30: number;
  due: boolean;
  statement: StatementState;
  statementDate: string | null;
}

export function latestStatement(fleet: Fleet, siteId: string) {
  const list = fleet.statements.filter((s) => s.siteId === siteId);
  return list.length > 0 ? list[list.length - 1] : null;
}

export function siteRow(fleet: Fleet, site: Site, today: string): SiteRow {
  const checks = siteChecks(fleet, site.id);
  const log = buildLog(fleet, site);
  const open = log.filter((i) => i.status === 'open');
  const last = checks.length > 0 ? checks[checks.length - 1].date : null;
  let trend: number | null = null;
  if (checks.length >= 2) trend = open.length - openWithout(fleet, site, checks[checks.length - 1].id);
  const st = latestStatement(fleet, site.id);
  let statement: StatementState = 'none';
  if (st) {
    if (daysBetween(st.date, today) > STATEMENT_DUE_DAYS) statement = 'old';
    else if (last && last > st.date) statement = 'outdated';
    else statement = 'current';
  }
  return {
    site,
    lastCheck: last,
    checks: checks.length,
    pages: new Set(checks.flatMap((c) => c.pages.map((p) => p.url))).size,
    open: open.length,
    openTarget: open.filter((i) => i.scope === 'target').length,
    critical: open.filter((i) => i.impact === 'critical').length,
    trend,
    fixed30: log.filter((i) => i.fixedOn !== null && daysBetween(i.fixedOn, today) <= 30).length,
    due: last === null || daysBetween(last, today) > CHECK_DUE_DAYS,
    statement,
    statementDate: st ? st.date : null,
  };
}

function openWithout(fleet: Fleet, site: Site, checkId: string): number {
  const f = { ...fleet, checks: fleet.checks.filter((c) => c.id !== checkId) };
  return buildLog(f, site).filter((i) => i.status === 'open').length;
}

export interface FleetSummary {
  sites: number;
  open: number;
  critical: number;
  due: number;
  statementsToUpdate: number;
  fixed30: number;
}

export function fleetSummary(rows: SiteRow[]): FleetSummary {
  return {
    sites: rows.length,
    open: rows.reduce((n, r) => n + r.open, 0),
    critical: rows.reduce((n, r) => n + r.critical, 0),
    due: rows.filter((r) => r.due).length,
    statementsToUpdate: rows.filter((r) => r.statement !== 'current').length,
    fixed30: rows.reduce((n, r) => n + r.fixed30, 0),
  };
}

export type SortKey = 'attention' | 'open' | 'name' | 'lastCheck';

/** "attention": critical first, then most open target issues, then stalest. */
export function sortRows(rows: SiteRow[], key: SortKey): SiteRow[] {
  const name = (r: SiteRow) => `${r.site.client} ${r.site.name}`.toLowerCase();
  return [...rows].sort((a, b) => {
    if (key === 'name') return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
    if (key === 'lastCheck') return (a.lastCheck ?? '') < (b.lastCheck ?? '') ? -1 : (a.lastCheck ?? '') > (b.lastCheck ?? '') ? 1 : 0;
    if (key === 'open') return b.open - a.open || (name(a) < name(b) ? -1 : 1);
    return b.critical - a.critical || b.openTarget - a.openTarget || Number(b.due) - Number(a.due) || (name(a) < name(b) ? -1 : 1);
  });
}

/** Fleet-wide open issues per criterion: which problems recur across clients. */
export function fleetCriteria(fleet: Fleet): { id: string; issues: number; sites: number }[] {
  const all: Issue[] = [];
  for (const s of fleet.sites) all.push(...buildLog(fleet, s).filter((i) => i.status === 'open'));
  return byCriterion(all)
    .map((g) => ({ id: g.id, issues: g.issues.length, sites: new Set(g.issues.map((i) => i.siteId)).size }))
    .sort((a, b) => b.sites - a.sites || b.issues - a.issues || compareCriteria(a.id || '9', b.id || '9'));
}
