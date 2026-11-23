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
import { jobLine, type JobSummary } from './compile';
import { CAVEAT, escapeHtml, REPORT_CSS } from './report';
import { cutAt, wellFormed, type DocumentScan, type Finding, type Rule } from './scan';
import type { Group, StatusData } from './status';

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
  /**
   * What this version's patched copy carries from Tagging Doctor (AC-52,
   * D-153): the saved alt texts and decorative marks of this version's own
   * figures, for files unchanged since they were approved, that the patch
   * writes. Set by the page after the save and after each change; absent on
   * a scan saved before milestone 5b, or whose figure panel never ran.
   */
  altCopy?: AltCopy;
}

export interface AltCopy {
  approved: number;
  decorative: number;
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
  // Every string is well formed: the database refuses NUL and half characters in JSON (R2.1-4).
  const out: StoredFinding = { path: wellFormed(f.path), line: f.line, rule: f.rule, severity: f.severity };
  if (f.package) out.package = wellFormed(f.package);
  if (f.kind) out.kind = f.kind;
  if (f.status) out.status = f.status;
  if (f.excerpt) {
    const ex = wellFormed(f.excerpt);
    out.excerpt = ex.length > MAX_EXCERPT ? `${cutAt(ex, MAX_EXCERPT - 1)}\u2026` : ex;
  }
  return out;
}

/** The scan as it is saved: never the source, never the comments (AC-23). */
export function toStoredScan(scan: DocumentScan, dataAsOf: string): StoredScan {
  const s = scan.summary;
  const fg = scan.figures;
  return {
    data_as_of: dataAsOf,
    summary: {
      mainFile: wellFormed(scan.mainFile),
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

/** A browser's copy suffix at the end of a name: "hw1 (1)", "hw1(12)". */
const COPY_SUFFIX = /^(.+?) ?\((\d+)\)$/;

/**
 * The project name a save suggests (AC-73, AC-74): the name itself when the
 * course has a project of that name; else, when the name ends in a
 * browser's copy suffix and the course has a project of the name without it,
 * that project's name (a new version downloaded again); else the name as it
 * is. Nothing else is taken off (`hw1-v2`, `hw1 final` stay).
 */
export function suggestedProjectName(name: string, existing: readonly string[]): string {
  if (existing.includes(name)) return name;
  const m = COPY_SUFFIX.exec(name);
  return m && existing.includes(m[1]) ? m[1] : name;
}

/** The names a saved project of a dropped file may have, in order (AC-51): its own, then the one without a browser's copy suffix (AC-73). */
export function versionNames(name: string): string[] {
  const m = COPY_SUFFIX.exec(name);
  return m ? [name, m[1]] : [name];
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

/**
 * A date and time for people, with its zone: "19 Nov 2026, 14:05 GMT-8", so
 * scans saved the same day can be told apart. In the person's own zone
 * unless one is given (R2.1-8).
 */
export function shortDateTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone });
  return `${shortDate(iso, timeZone)}, ${time}`;
}

/** A date for people: "19 Nov 2026", in the person's own zone unless one is given (R2.1-8). */
export function shortDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

export interface CourseReportRow {
  project: string;
  mainFile: string;
  /** Null when the project has no saved scan yet. */
  verdict: string | null;
  blockers: number;
  warnings: number;
  scannedAt: string | null;
  /** The latest compile and veraPDF result (AC-52); null when none was run. */
  check?: ReportCheck | null;
  /** Alt text coverage of the latest scan (AC-52); null when the project has no saved scan. */
  alt?: ReportAlt | null;
}

/** One project's latest check, as the course report shows it (AC-52). */
export interface ReportCheck {
  /** The original or the patched copy. */
  kind: 'original' | 'patched';
  /** When it finished (or was saved). */
  at: string;
  /** Its words: compiled or not, pages, and the veraPDF result. */
  result: string;
  /** Its scan is not the project's latest. */
  older: boolean;
}

/** Figures with alt text in the latest scan's sources, out of its figures, and what that version's patched copy adds (AC-52, AC-51). */
export interface ReportAlt {
  withAlt: number;
  figures: number;
  copy: AltCopy | null;
}

/** What the course report needs of a saved check (a jobs row). */
export interface CheckRow {
  project_id: string;
  scan_id: string;
  kind: 'check' | 'patched-check';
  status: string;
  finished_at: string | null;
  created_at: string;
  result: JobSummary | null;
  error: string | null;
}

/** A check in the report's words: the result line of the project's history, without the error's detail (it names files). */
export function checkResult(j: Pick<CheckRow, 'status' | 'result' | 'error'>): string {
  return j.status === 'failed' ? 'Did not compile.' : jobLine(j);
}

/** Each project's latest check: by when it finished, else when it was saved. */
export function latestCheck(jobs: CheckRow[]): Map<string, CheckRow> {
  const at = (j: CheckRow) => j.finished_at ?? j.created_at;
  const out = new Map<string, CheckRow>();
  for (const j of jobs) {
    const cur = out.get(j.project_id);
    if (!cur || at(j) > at(cur) || (at(j) === at(cur) && j.created_at > cur.created_at)) out.set(j.project_id, j);
  }
  return out;
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
  latest: Map<string, { id?: string; created_at: string; summary: StoredSummary }>,
  checks: Map<string, CheckRow> = new Map(),
): CourseReportRow[] {
  return projects.map((p) => {
    const s = latest.get(p.id);
    const j = checks.get(p.id);
    const fg = s?.summary.figures;
    return {
      project: p.name,
      mainFile: p.main_file,
      verdict: s ? s.summary.verdict : null,
      blockers: s ? s.summary.blockers : 0,
      warnings: s ? s.summary.warnings : 0,
      scannedAt: s ? s.created_at : null,
      check: j ? { kind: j.kind === 'patched-check' ? 'patched' : 'original', at: j.finished_at ?? j.created_at, result: checkResult(j), older: !s || j.scan_id !== s.id } : null,
      alt: fg ? { figures: fg.images + fg.tikz, withAlt: fg.images - fg.imagesWithoutAlt + (fg.tikz - fg.tikzWithoutAlt), copy: s?.summary.altCopy ?? null } : null,
    };
  });
}

/** "Compiled, 12 pages … (the patched copy, 23 Nov 2026; older than the latest scan)", or "not run" (AC-52). */
export function checkWords(c: ReportCheck | null | undefined, timeZone?: string): string {
  if (!c) return 'not run';
  return `${c.result} (${c.kind === 'patched' ? 'the patched copy' : 'the original'}, ${shortDate(c.at, timeZone)}${c.older ? '; older than the latest scan' : ''})`;
}

/**
 * "3 of 10 figures", with what the latest version's patched copy adds:
 * "; in Tagging Doctor's patched copy, 2 more with alt text and 1 marked
 * decorative"; "no figures", or "not run" (AC-52, D-153).
 */
export function altWords(a: ReportAlt | null | undefined): string {
  if (!a) return 'not run';
  if (!a.figures) return 'no figures';
  const base = `${a.withAlt} of ${a.figures} ${a.figures === 1 ? 'figure' : 'figures'}`;
  const c = a.copy;
  if (!c || (!c.approved && !c.decorative)) return base;
  const parts: string[] = [];
  if (c.approved) parts.push(`${c.approved} more with alt text`);
  if (c.decorative) parts.push(`${c.decorative} marked decorative`);
  return `${base}; in Tagging Doctor’s patched copy, ${parts.join(' and ')}`;
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

/** The package data the report's verdicts come from (AC-75, AC-76). */
export interface ReportData {
  /** The earliest and the latest `data_as_of` of the projects' latest scans; null when none is scanned. */
  from: string | null;
  to: string | null;
  /** From the data file's header, as the scan report reads it. */
  source: string;
  commit: string;
  retrieved: string;
  licence: string;
}

export interface CourseReport {
  course: { name: string; term: string | null };
  generatedAt: string;
  rows: CourseReportRow[];
  blockers: BlockerRow[];
  data: ReportData;
}

/** The data of the report from the latest scans' dates and the data file's header (AC-75, AC-76). */
export function reportData(latest: Iterable<{ data_as_of: string }>, data: Pick<StatusData, 'source'>): ReportData {
  const dates = [...latest].map((s) => s.data_as_of).filter(Boolean).sort();
  return {
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    source: data.source.url,
    commit: data.source.commit,
    retrieved: data.source.retrieved,
    licence: data.source.licence,
  };
}

/** "Package data as of 2026-11-12 to 2026-11-19: the LaTeX Project’s tagging status list, …" (AC-75, AC-76). */
export function dataLine(d: ReportData): string {
  const when = !d.from ? 'Package data: no project has a saved scan yet' : d.from === d.to ? `Package data as of ${d.from}` : `Package data as of ${d.from} to ${d.to}`;
  return `${when}: the LaTeX Project’s tagging status list, ${d.source}. This version of Tagging Doctor uses its copy at commit ${d.commit.slice(0, 7)}, retrieved ${d.retrieved} (${d.licence}).`;
}

/** The report's content, shared by the printable page and the downloaded file (AC-20). */
/**
 * The page shows dates in the person's zone; the downloaded file, which is
 * handed on, in UTC, and says so (R2.1-8).
 */
export function courseReportBody(r: CourseReport, top = 1, zone: 'local' | 'UTC' = 'UTC'): string {
  const tz = zone === 'UTC' ? 'UTC' : undefined;
  const title = `${r.course.name}${r.course.term ? `, ${r.course.term}` : ''}`;
  const out: string[] = [];
  out.push(`<h${top} id="course-report-h" tabindex="-1">Course report: ${escapeHtml(title)}</h${top}>`);
  out.push(`<p class="meta">Made ${escapeHtml(r.generatedAt.slice(0, 16).replace('T', ' '))} UTC by Tagging Doctor (https://tagging-doctor.hintwise.org), from the latest saved scan of each project.</p>`);
  out.push(`<p class="meta data-line">${escapeHtml(dataLine(r.data))}</p>`);
  out.push(`<p class="caveat">${escapeHtml(CAVEAT)}</p>`);
  const withBlockers = r.rows.filter((x) => x.blockers > 0).length;
  out.push(`<p>${withBlockers} of ${r.rows.length === 1 ? '1 project has' : `${r.rows.length} projects have`} blockers.</p>`);
  // When every project is named by its main file ("Save all"), one column says it.
  const files = r.rows.some((x) => x.project !== x.mainFile);
  out.push(`<table><caption>Projects</caption><thead><tr><th scope="col">Project</th>${files ? '<th scope="col">Main file</th>' : ''}<th scope="col">Verdict</th><th scope="col">Blockers</th><th scope="col">Warnings</th><th scope="col">${zone === 'UTC' ? 'Latest scan (UTC)' : 'Latest scan'}</th><th scope="col">Latest compile and PDF/UA check</th><th scope="col">Alt text in the sources</th></tr></thead><tbody>`);
  for (const x of r.rows) {
    out.push(
      `<tr><td>${escapeHtml(x.project)}</td>${files ? `<td>${escapeHtml(x.mainFile)}</td>` : ''}<td>${escapeHtml(x.verdict ?? 'Not scanned yet')}</td><td>${x.blockers}</td><td>${x.warnings}</td><td>${escapeHtml(x.scannedAt ? shortDate(x.scannedAt, tz) : 'none')}</td><td>${escapeHtml(checkWords(x.check, tz))}</td><td>${escapeHtml(altWords(x.alt))}</td></tr>`,
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
    courseReportBody(r, 1, 'UTC'),
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
