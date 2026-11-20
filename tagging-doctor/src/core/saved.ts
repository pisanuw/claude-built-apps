/**
 * What a saved scan holds, and what the course pages make of saved scans
 * (AC-19 to AC-21, AC-23, AC-24). Pure: no storage and no network.
 *
 * A saved scan keeps the summary and, per finding, only the file path, the
 * line, the rule, the group, the package name with its kind and status word,
 * and an excerpt of at most 200 characters (AC-23). The messages, the fixes
 * and the LaTeX Project's comments are not stored: they follow from the rule
 * and the package, and the page writes them again.
 */
import { CAVEAT, escapeHtml, REPORT_CSS } from './report';
import type { DocumentScan, Finding, Rule } from './scan';
import type { Group } from './status';

/** Longest excerpt a saved finding keeps (AC-23; the database refuses longer). */
export const MAX_EXCERPT = 200;

export interface StoredFinding {
  path: string;
  line: number | null;
  rule: Rule;
  severity: Group;
  package?: string;
  kind?: 'package' | 'class' | 'library';
  status?: string;
  excerpt?: string;
}

export interface StoredSummary {
  mainFile: string;
  verdict: string;
  blockers: number;
  warnings: number;
  unknown: number;
  ok: number;
  notes: string[];
  figures: { images: number; imagesWithoutAlt: number; tikz: number; tikzWithoutAlt: number };
}

/** The part of a scans row the app writes. */
export interface StoredScan {
  data_as_of: string;
  summary: StoredSummary;
  findings: StoredFinding[];
}

/** One document of a drop, ready to save: its project name (the main file's path, or the zip's name) and its scan. */
export interface SaveItem {
  name: string;
  mainFile: string;
  scan: StoredScan;
}

export function storedFinding(f: Finding): StoredFinding {
  const out: StoredFinding = { path: f.path, line: f.line, rule: f.rule, severity: f.severity };
  if (f.package) out.package = f.package;
  if (f.kind) out.kind = f.kind;
  if (f.status) out.status = f.status;
  if (f.excerpt) out.excerpt = f.excerpt.length > MAX_EXCERPT ? `${f.excerpt.slice(0, MAX_EXCERPT - 1)}…` : f.excerpt;
  return out;
}

/** The scan as it is saved: never the source, never the comments (AC-23). */
export function toStoredScan(scan: DocumentScan, dataAsOf: string): StoredScan {
  const s = scan.summary;
  const fg = scan.figures;
  return {
    data_as_of: dataAsOf,
    summary: {
      mainFile: scan.mainFile,
      verdict: s.verdict,
      blockers: s.blockers,
      warnings: s.warnings,
      unknown: s.unknown,
      ok: s.ok,
      notes: [...s.notes],
      figures: { images: fg.images, imagesWithoutAlt: fg.imagesWithoutAlt, tikz: fg.tikz, tikzWithoutAlt: fg.tikzWithoutAlt },
    },
    findings: scan.findings.map(storedFinding),
  };
}

/** The project name a single drop is saved under by default: the zip's or file's name without its extension. */
export function defaultProjectName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.(zip|tex)$/i, '') || base;
}

/** What identifies a blocker across two scans: the package and its kind, or the rule and the file. */
export function blockerKey(f: Pick<StoredFinding, 'rule' | 'package' | 'kind' | 'path'>): string {
  return f.package ? `${f.kind ?? 'package'}:${f.package}` : `${f.rule}:${f.path}`;
}

/** A blocker's name in the course report: "tabu (package)". */
export function blockerLabel(f: Pick<StoredFinding, 'rule' | 'package' | 'kind' | 'path'>): string {
  return f.package ? `${f.package} (${f.kind ?? 'package'})` : `${f.rule} (${f.path})`;
}

export interface Delta {
  fixed: number;
  added: number;
}

/** Blockers fixed and new since the previous scan of the same project (AC-21). */
export function blockerDelta(previous: Pick<StoredScan, 'findings'>, next: Pick<StoredScan, 'findings'>): Delta {
  const keys = (s: Pick<StoredScan, 'findings'>) => new Set(s.findings.filter((f) => f.severity === 'blocker').map(blockerKey));
  const before = keys(previous);
  const after = keys(next);
  return { fixed: [...before].filter((k) => !after.has(k)).length, added: [...after].filter((k) => !before.has(k)).length };
}

/** "2 blockers fixed and 1 new since the previous scan." */
export function deltaLine(d: Delta): string {
  return `${d.fixed === 1 ? '1 blocker' : `${d.fixed} blockers`} fixed and ${d.added} new since the previous scan.`;
}

/** A date for people: "19 Nov 2026" (UTC, so tests and every reader agree). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export interface CourseReportRow {
  project: string;
  mainFile: string;
  /** Null when the project has no saved scan yet. */
  verdict: string | null;
  blockers: number;
  warnings: number;
  scannedAt: string | null;
}

export interface BlockerRow {
  blocker: string;
  projects: string[];
}

/** The latest scan of each project, by created_at. */
export function latestByProject<T extends { project_id: string; created_at: string }>(scans: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const s of scans) {
    const cur = out.get(s.project_id);
    if (!cur || s.created_at > cur.created_at) out.set(s.project_id, s);
  }
  return out;
}

/** One row per project, with its latest verdict, counts and date (AC-19, AC-20). */
export function courseRows(
  projects: { id: string; name: string; main_file: string }[],
  latest: Map<string, { created_at: string; summary: StoredSummary }>,
): CourseReportRow[] {
  return projects.map((p) => {
    const s = latest.get(p.id);
    return {
      project: p.name,
      mainFile: p.main_file,
      verdict: s ? s.summary.verdict : null,
      blockers: s ? s.summary.blockers : 0,
      warnings: s ? s.summary.warnings : 0,
      scannedAt: s ? s.created_at : null,
    };
  });
}

/** The blockers of the latest scans, sorted by how many projects each affects, then by name (AC-20). */
export function blockerTable(
  projects: { id: string; name: string }[],
  latest: Map<string, { findings: StoredFinding[] }>,
): BlockerRow[] {
  const by = new Map<string, { label: string; projects: Set<string> }>();
  for (const p of projects) {
    const s = latest.get(p.id);
    if (!s) continue;
    for (const f of s.findings) {
      if (f.severity !== 'blocker') continue;
      const k = blockerKey(f);
      const cur = by.get(k) ?? { label: blockerLabel(f), projects: new Set<string>() };
      cur.projects.add(p.name);
      by.set(k, cur);
    }
  }
  return [...by.values()]
    .map((v) => ({ blocker: v.label, projects: [...v.projects] }))
    .sort((a, b) => b.projects.length - a.projects.length || a.blocker.localeCompare(b.blocker));
}

export interface CourseReport {
  course: { name: string; term: string | null };
  generatedAt: string;
  rows: CourseReportRow[];
  blockers: BlockerRow[];
}

/** The report's content, shared by the printable page and the downloaded file (AC-20). */
export function courseReportBody(r: CourseReport, top = 1): string {
  const title = `${r.course.name}${r.course.term ? `, ${r.course.term}` : ''}`;
  const out: string[] = [];
  out.push(`<h${top} id="course-report-h" tabindex="-1">Course report: ${escapeHtml(title)}</h${top}>`);
  out.push(`<p class="meta">Made ${escapeHtml(r.generatedAt.slice(0, 16).replace('T', ' '))} UTC by Tagging Doctor (https://tagging-doctor.hintwise.org), from the latest saved scan of each project.</p>`);
  out.push(`<p class="caveat">${escapeHtml(CAVEAT)}</p>`);
  const withBlockers = r.rows.filter((x) => x.blockers > 0).length;
  out.push(`<p>${withBlockers} of ${r.rows.length === 1 ? '1 project has' : `${r.rows.length} projects have`} blockers.</p>`);
  out.push('<table><caption>Projects</caption><thead><tr><th scope="col">Project</th><th scope="col">Main file</th><th scope="col">Verdict</th><th scope="col">Blockers</th><th scope="col">Warnings</th><th scope="col">Latest scan</th></tr></thead><tbody>');
  for (const x of r.rows) {
    out.push(
      `<tr><td>${escapeHtml(x.project)}</td><td>${escapeHtml(x.mainFile)}</td><td>${escapeHtml(x.verdict ?? 'Not scanned yet')}</td><td>${x.blockers}</td><td>${x.warnings}</td><td>${escapeHtml(x.scannedAt ? shortDate(x.scannedAt) : 'none')}</td></tr>`,
    );
  }
  out.push('</tbody></table>');
  out.push(`<h${top + 1}>Blockers by how many projects they affect</h${top + 1}>`);
  if (!r.blockers.length) out.push('<p>No known blockers in the latest scans.</p>');
  else {
    out.push('<table><caption>Blockers</caption><thead><tr><th scope="col">Blocker</th><th scope="col">Projects affected</th><th scope="col">Which</th></tr></thead><tbody>');
    for (const b of r.blockers) out.push(`<tr><td>${escapeHtml(b.blocker)}</td><td>${b.projects.length}</td><td>${escapeHtml(b.projects.join(', '))}</td></tr>`);
    out.push('</tbody></table>');
  }
  return out.join('\n');
}

/** The standalone file of "Download HTML": inline styles, no scripts, nothing loaded (AC-20, as AC-11). */
export function courseReportHtml(r: CourseReport): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Tagging Doctor course report: ${escapeHtml(r.course.name)}</title>`,
    `<style>${REPORT_CSS}</style>`,
    '</head>',
    '<body><main>',
    courseReportBody(r),
    '</main></body>',
    '</html>',
    '',
  ].join('\n');
}

export const EXPORT_FORMAT = 'tagging-doctor-export/1';

/** "Export my data" (AC-24): every row of the person's, table by table. */
export function exportJson(rows: Record<'courses' | 'projects' | 'scans' | 'jobs' | 'alt_texts', unknown[]>, now: Date): string {
  return `${JSON.stringify({ format: EXPORT_FORMAT, exportedAt: now.toISOString(), app: 'https://tagging-doctor.hintwise.org', ...rows }, null, 2)}\n`;
}
