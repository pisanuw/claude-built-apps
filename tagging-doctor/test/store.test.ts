import { describe, expect, it } from 'vitest';
import { openProject } from '../src/core/project';
import {
  blockerDelta,
  blockerKey,
  blockerLabel,
  blockerTable,
  courseReportBody,
  courseReportHtml,
  courseRows,
  defaultProjectName,
  deltaLine,
  EXPORT_FORMAT,
  exportJson,
  dataLine,
  latestByProject,
  MAX_EXCERPT,
  reportData,
  shortDate,
  shortDateTime,
  suggestedProjectName,
  storedFinding,
  toStoredScan,
  type StoredScan,
} from '../src/core/saved';
import { findMainFiles, scanDocument, type Finding } from '../src/core/scan';
import { CourseStore, MemoryDb, PAGE_ROWS, SupabaseDb, TABLES, type ScanRow, type TableClient, type TableQuery } from '../src/lib/store';
import { statusIndex, zipFixture } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-20T12:00:00Z');

async function scanOf(name: string) {
  const p = openProject(`${name}.zip`, zipFixture(name));
  const [main] = await findMainFiles(p);
  return { project: p, scan: scanDocument(p, main, idx) };
}

const stored = (blockers: string[], extra: Partial<StoredScan['summary']> = {}): StoredScan => ({
  data_as_of: '2026-11-19',
  summary: { mainFile: 'main.tex', verdict: `${blockers.length} blockers found`, blockers: blockers.length, warnings: 1, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 }, ...extra },
  findings: [
    ...blockers.map((b) => ({ path: 'main.tex', line: 3, rule: 'package-status' as const, severity: 'blocker' as const, package: b, kind: 'package' as const, status: 'currently-incompatible' })),
    { path: 'main.tex', line: 1, rule: 'no-title' as const, severity: 'warning' as const },
  ],
});

describe('AC-23: a saved scan holds paths, lines, package names and short excerpts, and no other source text', () => {
  it('keeps exactly those fields from a fixture scan', async () => {
    const { project, scan } = await scanOf('blockers');
    const s = toStoredScan(scan, idx.data.asOf);
    expect(s.data_as_of).toBe('2026-11-19');
    expect(s.summary).toMatchObject({ mainFile: 'main.tex', verdict: '2 blockers found', blockers: 2 });
    expect(s.findings).toHaveLength(scan.findings.length);
    const allowed = new Set(['path', 'line', 'rule', 'severity', 'package', 'kind', 'status', 'excerpt']);
    const sources = project.paths.map((p) => project.text(p) ?? '');
    for (const f of s.findings) {
      for (const k of Object.keys(f)) expect(allowed.has(k), k).toBe(true);
      expect(project.paths).toContain(f.path);
      expect((f.excerpt ?? '').length).toBeLessThanOrEqual(MAX_EXCERPT);
      // An excerpt is a piece of one line of the source, no more.
      if (f.excerpt) expect(sources.some((t) => t.includes(f.excerpt!.replace(/^\u2026/, '').replace(/\u2026$/, ''))), f.excerpt).toBe(true);
    }
    // Nothing else of the source: no message, no fix, no comment from the status list.
    const json = JSON.stringify(s);
    expect(json).not.toContain('message');
    expect(json).not.toContain('fix');
    expect(json).not.toContain('sourceComment');
    expect(json).not.toContain('\\\\begin{document}');
    // Every string in it is a path, a rule or group word, a package name or status word, the verdict, a date or an excerpt.
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(s);
    const known = new Set([...project.paths, ...s.findings.flatMap((f) => [f.rule, f.severity, f.package ?? '', f.kind ?? '', f.status ?? '', f.excerpt ?? '']), s.summary.verdict, s.data_as_of]);
    for (const x of strings) expect(known.has(x), x).toBe(true);
  });

  it('cuts an excerpt over 200 characters, which the scan never makes', () => {
    const f = { severity: 'warning', rule: 'no-title', path: 'a.tex', line: 1, message: 'm', fix: null, excerpt: 'x'.repeat(300) } as Finding;
    expect(storedFinding(f).excerpt).toHaveLength(200);
    expect(storedFinding({ ...f, excerpt: undefined })).toEqual({ path: 'a.tex', line: 1, rule: 'no-title', severity: 'warning' });
  });
});

describe('saved scans: names, deltas and the course report', () => {
  it('names a single drop by its file', () => {
    expect(defaultProjectName('hw1.zip')).toBe('hw1');
    expect(defaultProjectName('C:\\notes\\lecture.tex')).toBe('lecture');
    expect(defaultProjectName('.zip')).toBe('.zip');
  });

  it('AC-21: counts blockers fixed and new by package, or by rule and file', () => {
    expect(blockerDelta(stored(['tabu', 'caption']), stored(['caption', 'minted']))).toEqual({ fixed: 1, added: 1 });
    expect(blockerDelta(stored(['tabu']), stored([]))).toEqual({ fixed: 1, added: 0 });
    expect(deltaLine({ fixed: 1, added: 0 })).toBe('1 blocker fixed and 0 new since the previous scan.');
    expect(deltaLine({ fixed: 2, added: 3 })).toBe('2 blockers fixed and 3 new since the previous scan.');
    expect(blockerKey({ rule: 'beamer', package: 'beamer', kind: 'class', path: 'a' })).toBe('class:beamer');
    expect(blockerKey({ rule: 'no-title', path: 'a.tex' })).toBe('no-title:a.tex');
    expect(blockerLabel({ rule: 'no-title', path: 'a.tex' })).toBe('no-title (a.tex)');
    expect(blockerLabel({ rule: 'package-status', package: 'tabu', path: 'a.tex' })).toBe('tabu (package)');
  });

  it('dates read the same everywhere', () => {
    expect(shortDate('2026-11-19T23:30:00Z')).toBe('19 Nov 2026');
    expect(shortDate('not a date')).toBe('not a date');
  });

  it('AC-19, AC-20: one row per project, and blockers sorted by how many projects each affects', () => {
    const projects = [
      { id: 'p1', name: 'hw1', main_file: 'hw1.tex' },
      { id: 'p2', name: 'hw2', main_file: 'hw2.tex' },
      { id: 'p3', name: 'notes', main_file: 'notes.tex' },
    ];
    const scans = [
      { project_id: 'p1', created_at: '2026-11-18T00:00:00Z', ...stored(['tabu']) },
      { project_id: 'p1', created_at: '2026-11-19T00:00:00Z', ...stored(['caption', 'tabu']) },
      { project_id: 'p2', created_at: '2026-11-19T00:00:00Z', ...stored(['caption']) },
    ];
    const latest = latestByProject(scans);
    expect(latest.get('p1')?.created_at).toBe('2026-11-19T00:00:00Z');
    const rows = courseRows(projects, latest);
    expect(rows).toEqual([
      { project: 'hw1', mainFile: 'hw1.tex', verdict: '2 blockers found', blockers: 2, warnings: 1, scannedAt: '2026-11-19T00:00:00Z' },
      { project: 'hw2', mainFile: 'hw2.tex', verdict: '1 blockers found', blockers: 1, warnings: 1, scannedAt: '2026-11-19T00:00:00Z' },
      { project: 'notes', mainFile: 'notes.tex', verdict: null, blockers: 0, warnings: 0, scannedAt: null },
    ]);
    const blockers = blockerTable(projects, latest);
    expect(blockers).toEqual([
      { blocker: 'caption (package)', projects: ['hw1', 'hw2'] },
      { blocker: 'tabu (package)', projects: ['hw1'] },
    ]);
    const data = reportData([{ data_as_of: '2026-11-19' }], idx.data);
    const report = { course: { name: 'Calculus <I>', term: 'Fall 2026' }, generatedAt: NOW.toISOString(), rows, blockers, data };
    const html = courseReportHtml(report);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<h1 id="course-report-h" tabindex="-1">Course report: Calculus &lt;I&gt;, Fall 2026</h1>');
    expect(html).toContain('2 of 3 projects have blockers.');
    expect(html).toContain('<tr><td>caption (package)</td><td>2</td><td>hw1, hw2</td></tr>');
    expect(html).toContain('<td>notes</td><td>notes.tex</td><td>Not scanned yet</td><td>0</td><td>0</td><td>none</td>');
    expect(html).toContain('@media print');
    // Standalone, as AC-11's file: no script, no link, nothing loaded.
    expect(html).not.toMatch(/<script|<link|<img|src=|url\(/i);
    expect(html).not.toMatch(/<nav/i);
    expect(courseReportBody({ ...report, blockers: [], rows: rows.slice(0, 1) }, 2)).toContain('<p>No known blockers in the latest scans.</p>');
    expect(courseReportBody({ ...report, course: { name: 'X', term: null }, rows: rows.slice(0, 1) }, 2)).toContain('1 of 1 project has blockers.');
  });

  it('AC-24: the export holds every table', () => {
    const data = JSON.parse(exportJson({ courses: [1], projects: [], scans: [], jobs: [], alt_texts: [] }, NOW));
    expect(data).toEqual({ format: EXPORT_FORMAT, exportedAt: NOW.toISOString(), app: 'https://tagging-doctor.hintwise.org', courses: [1], projects: [], scans: [], jobs: [], alt_texts: [] });
  });
});

describe('CourseStore on the in-memory database', () => {
  const make = () => new CourseStore(new MemoryDb('user-a', () => NOW));

  it('AC-17: saves a scan under a new course, and it is there on the next read', async () => {
    const store = make();
    expect(await store.courses()).toEqual([]);
    const c = await store.createCourse('  Calculus I ', ' ');
    expect(c).toMatchObject({ name: 'Calculus I', term: null, user_id: 'user-a' });
    const { scan } = await scanOf('blockers');
    const [r] = await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: toStoredScan(scan, '2026-11-19') }]);
    expect(r.created).toBe(true);
    expect(r.delta).toBeNull();
    expect((await store.courses())[0]).toMatchObject({ id: c.id, projects: 1 });
    expect((await store.projects(c.id)).map((p) => p.name)).toEqual(['hw1']);
    expect(await store.scansOf([])).toEqual([]);
    const [s] = await store.scansOf([r.project.id]);
    expect(s.summary.verdict).toBe('2 blockers found');
  });

  it('AC-21: a new version saved under the same name is a new scan of that project, with the delta', async () => {
    const store = make();
    const c = await store.createCourse('Stats', 'Fall 2026');
    await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: stored(['tabu', 'caption']) }]);
    const [r] = await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: stored(['caption', 'minted']) }]);
    expect(r.created).toBe(false);
    expect(r.delta).toEqual({ fixed: 1, added: 1 });
    const h = await store.history(r.project.id);
    expect(h?.scans.map((x) => x.delta)).toEqual([{ fixed: 1, added: 1 }, null]);
    expect(h?.course?.name).toBe('Stats');
    expect(await store.history('nope')).toBeUndefined();
  });

  it('AC-17: "Save all" saves one project per main file in one call', async () => {
    const store = make();
    const c = await store.createCourse('Course', null);
    const rs = await store.save(c.id, [
      { name: 'hw1/hw1.tex', mainFile: 'hw1/hw1.tex', scan: stored([]) },
      { name: 'hw2/hw2.tex', mainFile: 'hw2/hw2.tex', scan: stored(['tabu']) },
    ]);
    expect(rs.map((r) => r.project.name)).toEqual(['hw1/hw1.tex', 'hw2/hw2.tex']);
    expect((await store.courses())[0].projects).toBe(2);
  });

  it('AC-25: deleting a project or a course takes its scans, jobs and alt texts with it', async () => {
    const db = new MemoryDb('u', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    const [r] = await store.save(c.id, [{ name: 'p', mainFile: 'p.tex', scan: stored(['tabu']) }]);
    await db.insert('jobs', { project_id: r.project.id, scan_id: r.scan.id, kind: 'check', status: 'done' });
    await db.insert('alt_texts', { project_id: r.project.id, figure_path: 'a.png', text: 't', decision: 'approved' });
    const [r2] = await store.save(c.id, [{ name: 'q', mainFile: 'q.tex', scan: stored([]) }]);
    await db.insert('jobs', { project_id: r2.project.id, scan_id: r2.scan.id, kind: 'check', status: 'done' });
    await store.deleteProject(r.project.id);
    expect(await db.select('scans', { project_id: r.project.id })).toEqual([]);
    expect(await db.select('jobs', { project_id: r.project.id })).toEqual([]);
    expect(await db.select('alt_texts')).toEqual([]);
    expect(await db.select('jobs')).toHaveLength(1);
    await db.remove('scans', r2.scan.id);
    expect(await db.select('jobs')).toEqual([]);
    await store.deleteCourse(c.id);
    for (const t of TABLES) expect(await db.select(t), t).toEqual([]);
  });

  it('refuses a second project of the same name in a course, as the database does', async () => {
    const db = new MemoryDb('u');
    await db.insert('projects', { course_id: 'c', name: 'p' });
    await expect(db.insert('projects', { course_id: 'c', name: 'p' })).rejects.toThrow(/unique/);
    const rows = await db.select<{ created_at: string }>('projects');
    expect(rows[0].created_at).toMatch(/^\d{4}-/);
  });

  it('AC-24: exports every table', async () => {
    const store = make();
    const c = await store.createCourse('C', null);
    await store.save(c.id, [{ name: 'p', mainFile: 'p.tex', scan: stored([]) }]);
    const all = await store.exportAll();
    expect(Object.keys(all)).toEqual(TABLES);
    expect(all.courses).toHaveLength(1);
    expect(all.scans).toHaveLength(1);
    expect(all.jobs).toEqual([]);
  });

  it('orders scans by created_at, whatever order the database returns', async () => {
    const rows = [
      { id: 'b', project_id: 'p', created_at: '2026-11-20T00:00:00Z' },
      { id: 'a', project_id: 'p', created_at: '2026-11-19T00:00:00Z' },
      { id: 'c', project_id: 'p', created_at: '2026-11-20T00:00:00Z' },
    ];
    const store = new CourseStore({ select: async () => rows as never, insert: async () => ({}) as never, remove: async () => {} });
    expect((await store.scansOf(['p'])).map((s: ScanRow) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('SupabaseDb: one query per call, in the app schema', () => {
  function fakeClient(result: { data: unknown; error: { message: string } | null } | (() => { data: unknown; error: { message: string } | null })) {
    const calls: unknown[][] = [];
    const q: TableQuery = {
      eq: (...a) => (calls.push(['eq', ...a]), q),
      in: (...a) => (calls.push(['in', ...a]), q),
      order: (...a) => (calls.push(['order', ...a]), q),
      range: (...a) => (calls.push(['range', ...a]), q),
      select: (...a) => (calls.push(['select', ...a]), q),
      single: () => (calls.push(['single']), q),
      then: (ok, bad) => Promise.resolve(typeof result === 'function' ? result() : result).then(ok, bad),
    };
    const client: TableClient = {
      from: (t) => {
        calls.push(['from', t]);
        return {
          select: (c) => (calls.push(['select', c]), q),
          insert: (row) => (calls.push(['insert', row]), q),
          delete: () => (calls.push(['delete']), q),
        };
      },
    };
    return { client, calls };
  }

  it('selects with filters and order, inserts one row, deletes by id', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 1 }], error: null });
    const db = new SupabaseDb(client);
    expect(await db.select('scans', { project_id: ['a', 'b'], user_id: 'u' })).toEqual([{ id: 1 }]);
    expect(calls).toEqual([
      ['from', 'scans'],
      ['select', '*'],
      ['in', 'project_id', ['a', 'b']],
      ['eq', 'user_id', 'u'],
      ['order', 'created_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['range', 0, 999],
    ]);
    calls.length = 0;
    await db.select('alt_texts');
    expect(calls.slice(-3)).toEqual([['order', 'updated_at', { ascending: true }], ['order', 'id', { ascending: true }], ['range', 0, 999]]);
    calls.length = 0;
    await db.insert('courses', { name: 'x' });
    expect(calls).toEqual([['from', 'courses'], ['insert', { name: 'x' }], ['select'], ['single']]);
    calls.length = 0;
    await db.remove('projects', 'p1');
    expect(calls).toEqual([['from', 'projects'], ['delete'], ['eq', 'id', 'p1']]);
  });

  it('reads past the API\'s 1,000-row limit, page by page (acceptance m2 note)', async () => {
    let n = 0;
    const pages = [PAGE_ROWS, PAGE_ROWS, 5];
    const { client, calls } = fakeClient(() => ({ data: Array.from({ length: pages[n++] }, (_, i) => ({ id: `${n}-${i}` })), error: null }));
    const rows = await new SupabaseDb(client).select('scans');
    expect(rows).toHaveLength(2 * PAGE_ROWS + 5);
    expect(calls.filter((c) => c[0] === 'range')).toEqual([['range', 0, 999], ['range', 1000, 1999], ['range', 2000, 2999]]);
  });

  it('turns an error into a message naming the table', async () => {
    const db = new SupabaseDb(fakeClient({ data: null, error: { message: 'permission denied' } }).client);
    await expect(db.select('courses')).rejects.toThrow('courses: permission denied');
    await expect(db.insert('courses', {})).rejects.toThrow('courses: permission denied');
    await expect(db.remove('courses', 'x')).rejects.toThrow('courses: permission denied');
    const empty = new SupabaseDb(fakeClient({ data: null, error: null }).client);
    expect(await empty.select('courses')).toEqual([]);
  });
});

describe('a course zip saved with "Save all"', () => {
  it('keeps one stored scan per main file', async () => {
    const p = openProject('course.zip', zipFixture('course'));
    const mains = await findMainFiles(p);
    const items = mains.map((m) => ({ name: m, mainFile: m, scan: toStoredScan(scanDocument(p, m, idx), idx.data.asOf) }));
    const store = new CourseStore(new MemoryDb('u'));
    const c = await store.createCourse('C', null);
    await store.save(c.id, items);
    expect((await store.projects(c.id)).map((x) => x.main_file)).toEqual(mains);
  });
});

describe('AC-73 and AC-74 (CR-4): a copy suffix is dropped only for a project the course has', () => {
  it.each([
    ['hw1 (1)', ['hw1'], 'hw1'],
    ['hw1 (12)', ['hw1'], 'hw1'],
    ['hw1(2)', ['hw1', 'hw2'], 'hw1'],
    ['hw1 (1)', [], 'hw1 (1)'],
    ['hw1 (1)', ['hw2'], 'hw1 (1)'],
    ['hw1 (1)', ['hw1 (1)', 'hw1'], 'hw1 (1)'],
    ['hw1-v2', ['hw1'], 'hw1-v2'],
    ['hw1 final', ['hw1'], 'hw1 final'],
    ['hw1 (a)', ['hw1'], 'hw1 (a)'],
    ['(1)', ['', '(1)'], '(1)'],
  ])('%s with %j -> %s', (name, existing, want) => {
    expect(suggestedProjectName(name, existing)).toBe(want);
  });

  it('works from the dropped file\'s name', () => {
    expect(suggestedProjectName(defaultProjectName('hw1 (1).zip'), ['hw1'])).toBe('hw1');
    expect(suggestedProjectName(defaultProjectName('hw1 (1).zip'), [])).toBe('hw1 (1)');
  });
});

describe('AC-75 and AC-76 (CR-5): the course report names its package data', () => {
  const rows = [{ project: 'hw1', mainFile: 'main.tex', verdict: 'No known blockers', blockers: 0, warnings: 0, scannedAt: '2026-11-19T00:00:00Z' }];
  const report = (dates: string[]) => ({
    course: { name: 'STAT 201', term: null },
    generatedAt: NOW.toISOString(),
    rows,
    blockers: [],
    data: reportData(dates.map((d) => ({ data_as_of: d })), idx.data),
  });
  const SOURCE = 'the LaTeX Project’s tagging status list, https://github.com/latex3/tagging-project/blob/main/_data/tagging-status.yml. This version of Tagging Doctor uses its copy at commit 407cadb, retrieved 2026-11-19 (LaTeX Project Public License, version 1.3c or later).';

  it.each([
    [['2026-11-19'], 'Package data as of 2026-11-19'],
    [['2026-11-19', '2026-11-19'], 'Package data as of 2026-11-19'],
    [['2026-11-19', '2026-11-12'], 'Package data as of 2026-11-12 to 2026-11-19'],
    [['2026-11-15', '2026-11-19', '2026-11-12'], 'Package data as of 2026-11-12 to 2026-11-19'],
  ])('%j -> %s, on the page and in the download', (dates, when) => {
    const r = report(dates);
    const line = `${when}: ${SOURCE}`;
    expect(dataLine(r.data)).toBe(line);
    expect(courseReportBody(r, 2)).toContain(line);
    expect(courseReportHtml(r)).toContain(line);
    expect(courseReportHtml(r)).not.toContain('2026-11-15');
  });

  it('reads the source from the data file\'s header, as the scan report does', () => {
    const d = reportData([], idx.data);
    expect(d).toEqual({ from: null, to: null, source: idx.data.source.url, commit: idx.data.source.commit, retrieved: idx.data.source.retrieved, licence: idx.data.source.licence });
    expect(dataLine(d)).toMatch(/^Package data: no project has a saved scan yet: the LaTeX Project’s tagging status list/);
  });

  it('shows one column for projects named by their main file', () => {
    const html = courseReportHtml({ ...report(['2026-11-19']), rows: [{ ...rows[0], project: 'main.tex' }] });
    expect(html).not.toContain('<th scope="col">Main file</th>');
    expect(courseReportHtml(report(['2026-11-19']))).toContain('<th scope="col">Main file</th>');
  });

  it('dates scans with their time, for scans saved the same day', () => {
    expect(shortDateTime('2026-11-20T14:05:09Z')).toBe('20 Nov 2026, 14:05 UTC');
    expect(shortDateTime('nope')).toBe('nope');
  });
});
