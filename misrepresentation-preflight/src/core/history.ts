import type { ScanResult, Severity } from './types';
import { bareHost } from './urls';

/**
 * The dated re-check log: what each check found, kept in the owner's own
 * browser. Before a review request the owner can show what was fixed and when.
 */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LogEntry {
  id: string;
  site: string;
  checkedAt: string;
  pagesRead: number;
  counts: Record<Severity, number>;
  findings: Array<{ id: string; severity: Severity; title: string }>;
  note: string;
}

export interface Comparison {
  previous: LogEntry;
  fixed: LogEntry['findings'];
  added: LogEntry['findings'];
  still: LogEntry['findings'];
}

export const LOG_KEY = 'misrepresentation-preflight.log.v1';
export const MAX_ENTRIES = 200;

export function siteKey(site: string): string {
  try {
    return bareHost(new URL(site).hostname);
  } catch {
    return site.toLowerCase();
  }
}

export function toEntry(r: ScanResult): LogEntry {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of r.findings) counts[f.severity]++;
  return {
    id: `${siteKey(r.site)}@${r.checkedAt}`,
    site: siteKey(r.site),
    checkedAt: r.checkedAt,
    pagesRead: r.pages.length,
    counts,
    findings: r.findings.map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
    note: '',
  };
}

function valid(e: unknown): e is LogEntry {
  const x = e as LogEntry;
  return !!x && typeof x.id === 'string' && typeof x.site === 'string' && typeof x.checkedAt === 'string' && Array.isArray(x.findings) && !!x.counts;
}

export function loadLog(store: KeyValue | null): LogEntry[] {
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(valid).map((e) => ({ ...e, note: typeof e.note === 'string' ? e.note : '' })) : [];
  } catch {
    return [];
  }
}

export function saveLog(store: KeyValue | null, entries: LogEntry[]): boolean {
  if (!store) return false;
  try {
    store.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

/** Add (or replace) an entry and return the new log, oldest first. */
export function addEntry(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  return [...entries.filter((e) => e.id !== entry.id), entry].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).slice(-MAX_ENTRIES);
}

export function setNote(entries: LogEntry[], id: string, note: string): LogEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, note: note.slice(0, 1000) } : e));
}

export function removeEntry(entries: LogEntry[], id: string): LogEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** The latest check of the same store before this one. */
export function previousFor(entries: LogEntry[], site: string, before: string): LogEntry | undefined {
  const key = siteKey(site);
  return entries.filter((e) => e.site === key && e.checkedAt < before).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
}

export function compare(previous: LogEntry, current: LogEntry): Comparison {
  const now = new Set(current.findings.map((f) => f.id));
  const then = new Set(previous.findings.map((f) => f.id));
  return {
    previous,
    fixed: previous.findings.filter((f) => !now.has(f.id)),
    added: current.findings.filter((f) => !then.has(f.id)),
    still: current.findings.filter((f) => then.has(f.id)),
  };
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The log as a spreadsheet, one row per check. */
export function logCsv(entries: LogEntry[]): string {
  const head = ['Store', 'Checked at (UTC)', 'Pages read', 'High', 'Medium', 'Low', 'Findings', 'Note'];
  const rows = entries.map((e) => [e.site, e.checkedAt.replace('T', ' ').slice(0, 16), e.pagesRead, e.counts.high, e.counts.medium, e.counts.low, e.findings.map((f) => f.title).join('; '), e.note]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
