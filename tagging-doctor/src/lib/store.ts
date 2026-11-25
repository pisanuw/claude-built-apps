/**
 * Saved courses, projects and scans (SPEC.md section 5) behind a small Db
 * interface, so the pages and the tests never depend on the network:
 * MemoryDb for vitest, `vite preview` and the Playwright walkthrough;
 * SupabaseDb over the app's schema for the live site, where row level
 * security keeps every call to the signed-in user's rows and the database
 * fills user_id (so this code never sends or filters by user).
 */
import type { JobRecord, JobSummary } from '../core/compile';
import { blockerDelta, type AltCopy, type Delta, type SaveItem, type StoredFinding, type StoredScan, type StoredSummary } from '../core/saved';
import type { AltWant } from './alts';
import { newId } from './repository';

export type Table = 'courses' | 'projects' | 'scans' | 'jobs' | 'alt_texts';
export const TABLES: Table[] = ['courses', 'projects', 'scans', 'jobs', 'alt_texts'];

export interface CourseRow {
  id: string;
  user_id?: string;
  name: string;
  term: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  user_id?: string;
  course_id: string;
  name: string;
  main_file: string;
  created_at: string;
}

export interface ScanRow extends StoredScan {
  id: string;
  user_id?: string;
  project_id: string;
  created_at: string;
  summary: StoredSummary;
  findings: StoredFinding[];
}

export interface JobRow {
  id: string;
  project_id: string;
  scan_id: string;
  kind: 'check' | 'patched-check';
  status: string;
  started_at: string | null;
  finished_at: string | null;
  result: JobSummary | null;
  error: string | null;
  created_at: string;
}

export interface AltTextRow {
  id: string;
  project_id: string;
  figure_path: string;
  /** SHA-256 of the figure's file (AC-51; src/lib/alts.ts). */
  figure_hash: string;
  text: string;
  decision: string;
  source: string;
  updated_at: string;
}

export type Where = Record<string, string | string[]>;

export interface Db {
  /** Rows of one table, filtered by equality (an array means "one of"), oldest first; `columns` as in a select list. */
  select<T>(table: Table, where?: Where, columns?: string): Promise<T[]>;
  /** Inserts one row and returns it as stored (id, user_id and created_at filled). */
  insert<T>(table: Table, row: Record<string, unknown>): Promise<T>;
  /** Changes some fields of one row. */
  update(table: Table, id: string, fields: Record<string, unknown>): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
}

/** The columns of a check the course report needs to find each project's latest (R5b.1-8 f). */
export const JOB_TIME_COLUMNS = 'id, project_id, finished_at, created_at';

/** The columns of a scan the course pages need: no findings (R2.1-6). */
export const SCAN_SUMMARY_COLUMNS = 'id, project_id, created_at, data_as_of, summary';

export type ScanSummaryRow = Pick<ScanRow, 'id' | 'project_id' | 'created_at' | 'data_as_of' | 'summary'>;

/** A save that stopped part way: what was saved before the failure, and the failure (R2.1-5). */
export class SaveError extends Error {
  constructor(
    readonly saved: SavedResult[],
    readonly reason: unknown,
  ) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

/** Keeps rows in memory, with the database's cascades and unique project names (tests, preview). */
export class MemoryDb implements Db {
  private readonly rows: Record<Table, Record<string, unknown>[]> = { courses: [], projects: [], scans: [], jobs: [], alt_texts: [] };
  private tick = 0;

  constructor(
    private readonly userId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async select<T>(table: Table, where: Where = {}, columns = '*'): Promise<T[]> {
    const ok = (r: Record<string, unknown>) =>
      Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k] as string) : r[k] === v));
    const cols = columns === '*' ? null : columns.split(',').map((c) => c.trim());
    const pick = (r: Record<string, unknown>) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : r);
    return this.rows[table].filter(ok).map((r) => structuredClone(pick(r)) as T);
  }

  async update(table: Table, id: string, fields: Record<string, unknown>): Promise<void> {
    const row = this.rows[table].find((r) => r.id === id);
    if (row) Object.assign(row, structuredClone(fields));
  }

  async insert<T>(table: Table, row: Record<string, unknown>): Promise<T> {
    if (table === 'projects' && this.rows.projects.some((p) => p.course_id === row.course_id && p.name === row.name)) {
      throw new Error('projects: duplicate key value violates unique constraint');
    }
    // A row of a project that is gone is refused, as the database's composite key does (R5b.1-8 d).
    if ((table === 'scans' || table === 'jobs' || table === 'alt_texts') && !this.rows.projects.some((p) => p.id === row.project_id)) {
      throw new Error(`${table}: insert or update on table violates foreign key constraint`);
    }
    if (table === 'alt_texts' && this.rows.alt_texts.some((a) => a.project_id === row.project_id && a.figure_path === row.figure_path)) {
      throw new Error('alt_texts: duplicate key value violates unique constraint');
    }
    // created_at strictly increasing, so "latest" is well defined within one millisecond.
    const at = new Date(this.now().getTime() + this.tick++).toISOString();
    const stored = { id: newId(), user_id: this.userId, ...(table === 'alt_texts' ? { updated_at: at } : { created_at: at }), ...structuredClone(row) };
    this.rows[table].push(stored);
    return structuredClone(stored) as T;
  }

  async remove(table: Table, id: string): Promise<void> {
    const drop = (t: Table, keep: (r: Record<string, unknown>) => boolean) => {
      const gone = this.rows[t].filter((r) => !keep(r));
      this.rows[t] = this.rows[t].filter(keep);
      return gone.map((r) => r.id as string);
    };
    const ids = drop(table, (r) => r.id !== id);
    if (table === 'courses') for (const c of ids) for (const p of drop('projects', (r) => r.course_id !== c)) this.cascadeProject(p);
    if (table === 'projects') for (const p of ids) this.cascadeProject(p);
    if (table === 'scans') for (const s of ids) drop('jobs', (r) => r.scan_id !== s);
  }

  private cascadeProject(projectId: string) {
    for (const t of ['scans', 'jobs', 'alt_texts'] as Table[]) this.rows[t] = this.rows[t].filter((r) => r.project_id !== projectId);
  }
}

/** The part of the supabase-js query builder SupabaseDb uses. */
export interface TableQuery extends PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> {
  eq(column: string, value: string): TableQuery;
  in(column: string, values: string[]): TableQuery;
  order(column: string, opts: { ascending: boolean }): TableQuery;
  range(from: number, to: number): TableQuery;
  select(columns?: string): TableQuery;
  single(): TableQuery;
}

export interface TableClient {
  from(table: string): {
    select(columns?: string, opts?: { count: 'exact' }): TableQuery;
    insert(row: Record<string, unknown>): TableQuery;
    update(fields: Record<string, unknown>): TableQuery;
    delete(): TableQuery;
  };
}

/** Rows per request: at most Supabase's default API limit. */
export const PAGE_ROWS = 1000;

/** In the app's schema (the client is made with db.schema = app_tagging_doctor); a write is one query, a read one query per 1,000 rows. */
export class SupabaseDb implements Db {
  constructor(private readonly client: TableClient) {}

  /**
   * Reads page by page, so the API's row limit never cuts an export or a
   * long course short without saying so (R2.1-6). Each page asks for the
   * total count, and reading goes on until it is reached, whatever limit the
   * project sets (1,000 by default, or lower). Ordered by time, then id, so
   * the pages do not overlap.
   */
  async select<T>(table: Table, where: Where = {}, columns = '*'): Promise<T[]> {
    const out: T[] = [];
    for (;;) {
      let q = this.client.from(table).select(columns, { count: 'exact' });
      for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
      const from = out.length;
      const { data, error, count } = await q
        .order(table === 'alt_texts' ? 'updated_at' : 'created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_ROWS - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      const more = typeof count === 'number' ? out.length < count : rows.length === PAGE_ROWS;
      if (!rows.length || !more) return out;
    }
  }

  async update(table: Table, id: string, fields: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from(table).update(fields).eq('id', id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async insert<T>(table: Table, row: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.from(table).insert(row).select().single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as T;
  }

  async remove(table: Table, id: string): Promise<void> {
    const { error } = await this.client.from(table).delete().eq('id', id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export interface CourseSummary extends CourseRow {
  projects: number;
}

export interface SavedResult {
  project: ProjectRow;
  scan: ScanRow;
  /** Set when the project had a scan before this one (AC-21). */
  delta: Delta | null;
  /** True when this save made the project. */
  created: boolean;
}

export interface ProjectHistory {
  project: ProjectRow;
  course: CourseRow | undefined;
  /** Newest first, each with its change against the scan before it. */
  scans: { scan: ScanRow; delta: Delta | null }[];
  /** Newest first (AC-35). */
  jobs: JobRow[];
  altTexts: AltTextRow[];
}

/** What the pages ask of the saved data. */
export class CourseStore {
  constructor(private readonly db: Db) {}

  async courses(): Promise<CourseSummary[]> {
    const [courses, projects] = await Promise.all([this.db.select<CourseRow>('courses'), this.db.select<ProjectRow>('projects')]);
    return courses.map((c) => ({ ...c, projects: projects.filter((p) => p.course_id === c.id).length }));
  }

  async course(id: string): Promise<CourseRow | undefined> {
    return (await this.db.select<CourseRow>('courses', { id }))[0];
  }

  async createCourse(name: string, term: string | null): Promise<CourseRow> {
    return this.db.insert<CourseRow>('courses', { name: name.trim(), term: term?.trim() || null });
  }

  async projects(courseId: string): Promise<ProjectRow[]> {
    return this.db.select<ProjectRow>('projects', { course_id: courseId });
  }

  /** The scans of these projects, oldest first, with their findings. */
  async scansOf(projectIds: string[]): Promise<ScanRow[]> {
    if (!projectIds.length) return [];
    return sortByCreated(await this.db.select<ScanRow>('scans', { project_id: projectIds }));
  }

  /** The scans of these projects, oldest first, without their findings (R2.1-6). */
  async scanSummaries(projectIds: string[]): Promise<ScanSummaryRow[]> {
    if (!projectIds.length) return [];
    return sortByCreated(await this.db.select<ScanSummaryRow>('scans', { project_id: projectIds }, SCAN_SUMMARY_COLUMNS));
  }

  /**
   * The latest check of each of these projects (AC-52), oldest first: the
   * times of every check, then the whole row of each project's latest only
   * (R5b.1-8 f). Latest is by when it finished, else when it was saved, as
   * the course report's `latestCheck` says.
   */
  async latestJobs(projectIds: string[]): Promise<JobRow[]> {
    if (!projectIds.length) return [];
    const times = await this.db.select<Pick<JobRow, 'id' | 'project_id' | 'finished_at' | 'created_at'>>('jobs', { project_id: projectIds }, JOB_TIME_COLUMNS);
    const at = (j: Pick<JobRow, 'finished_at' | 'created_at'>) => j.finished_at ?? j.created_at;
    const latest = new Map<string, (typeof times)[number]>();
    for (const j of times) {
      const cur = latest.get(j.project_id);
      if (!cur || at(j) > at(cur) || (at(j) === at(cur) && j.created_at > cur.created_at)) latest.set(j.project_id, j);
    }
    const ids = [...latest.values()].map((j) => j.id);
    return ids.length ? sortByCreated(await this.db.select<JobRow>('jobs', { id: ids })) : [];
  }

  /** The saved projects of a name and main file, in any course: where a new drop's alt texts may come from (AC-51). */
  async projectsMatching(name: string, mainFile: string): Promise<ProjectRow[]> {
    return this.db.select<ProjectRow>('projects', { name, main_file: mainFile });
  }

  async altTexts(projectId: string): Promise<AltTextRow[]> {
    return this.db.select<AltTextRow>('alt_texts', { project_id: projectId });
  }

  /**
   * Brings a project's saved alt texts to `want` and removes the slots in
   * `drop` (AC-51): a new slot is inserted, a changed one updated with a new
   * updated_at, an unchanged one left. The page runs one sync at a time per
   * project, so two never insert the same slot.
   */
  async syncAltTexts(projectId: string, want: AltWant[], drop: string[]): Promise<{ written: number; removed: number }> {
    const rows = await this.altTexts(projectId);
    const byPath = new Map(rows.map((r) => [r.figure_path, r]));
    let written = 0;
    let removed = 0;
    for (const w of want) {
      const row = byPath.get(w.figure_path);
      if (!row) {
        await this.db.insert('alt_texts', { project_id: projectId, ...w });
        written++;
      } else if (row.figure_hash !== w.figure_hash || row.text !== w.text || row.decision !== w.decision || row.source !== w.source) {
        await this.db.update('alt_texts', row.id, { ...w, updated_at: new Date().toISOString() });
        written++;
      }
    }
    for (const path of new Set(drop)) {
      const row = byPath.get(path);
      if (!row) continue;
      await this.db.remove('alt_texts', row.id);
      removed++;
    }
    return { written, removed };
  }

  /**
   * Records with a saved scan what its version's patched copy carries from
   * Tagging Doctor (AC-52, D-153), in its summary; nothing is written when
   * it is already so. The page calls it after each sync of the document.
   */
  async setAltCopy(scanId: string, altCopy: AltCopy): Promise<void> {
    const row = (await this.db.select<Pick<ScanRow, 'id' | 'summary'>>('scans', { id: scanId }, 'id, summary'))[0];
    if (!row) return;
    const was = row.summary.altCopy;
    if (was && was.approved === altCopy.approved && was.decorative === altCopy.decorative) return;
    await this.db.update('scans', scanId, { summary: { ...row.summary, altCopy } });
  }

  /** The saved alt texts of these projects (AC-51). */
  async altTextsOf(projectIds: string[]): Promise<AltTextRow[]> {
    if (!projectIds.length) return [];
    return this.db.select<AltTextRow>('alt_texts', { project_id: projectIds });
  }

  /** These scans, with their findings. */
  async scansById(ids: string[]): Promise<ScanRow[]> {
    if (!ids.length) return [];
    return sortByCreated(await this.db.select<ScanRow>('scans', { id: ids }));
  }

  /**
   * Saves each item under the course: a new project for a new name, or a
   * new scan of the project that has that name (AC-17, AC-21).
   */
  async save(courseId: string, items: SaveItem[]): Promise<SavedResult[]> {
    const out: SavedResult[] = [];
    try {
      const existing = await this.projects(courseId);
      for (const item of items) out.push(await this.saveOne(courseId, existing, item));
    } catch (e) {
      // The items saved before the failure are kept and reported, so a retry can skip them (R2.1-5).
      throw new SaveError(out, e);
    }
    return out;
  }

  private async saveOne(courseId: string, existing: ProjectRow[], item: SaveItem): Promise<SavedResult> {
    const name = item.name.trim();
    let project = existing.find((p) => p.name === name);
    const created = !project;
    if (!project) {
      project = await this.db.insert<ProjectRow>('projects', { course_id: courseId, name, main_file: item.mainFile });
    }
    let previous: ScanRow | undefined;
    let scan: ScanRow;
    try {
      if (!created) {
        const before = await this.scanSummaries([project.id]);
        const last = before[before.length - 1];
        if (last) previous = (await this.scansById([last.id]))[0];
      }
      scan = await this.db.insert<ScanRow>('scans', { project_id: project.id, ...item.scan });
    } catch (e) {
      // A project made for this scan does not stay empty (R2.1-5).
      if (created) await this.db.remove('projects', project.id).catch(() => {});
      throw e;
    }
    if (created) existing.push(project);
    else if (project.main_file !== item.mainFile) {
      // The project's main file is the one of its latest scan (R2.1-9). It is a
      // label: the scan is saved already, so a failure here does not undo the
      // save, and a retry does not store the scan twice (R2.2-2).
      try {
        await this.db.update('projects', project.id, { main_file: item.mainFile });
        project = { ...project, main_file: item.mainFile };
        existing[existing.findIndex((p) => p.id === project?.id)] = project;
      } catch {
        // The project keeps its earlier main file until the next save.
      }
    }
    return { project, scan, created, delta: previous ? blockerDelta(previous, scan) : null };
  }

  async history(projectId: string): Promise<ProjectHistory | undefined> {
    const project = (await this.db.select<ProjectRow>('projects', { id: projectId }))[0];
    if (!project) return undefined;
    const [course, scans, jobs, altTexts] = await Promise.all([
      this.course(project.course_id),
      this.scansOf([projectId]),
      this.db.select<JobRow>('jobs', { project_id: projectId }).then((rows) => sortByCreated(rows).reverse()),
      this.db.select<AltTextRow>('alt_texts', { project_id: projectId }),
    ]);
    const withDelta = scans.map((scan, i) => ({ scan, delta: i > 0 ? blockerDelta(scans[i - 1], scan) : null }));
    return { project, course, scans: withDelta.reverse(), jobs, altTexts };
  }

  /** A finished compile of a saved scan (AC-35): its kind, status, timings and result summary; no PDF, no source. */
  async saveJob(projectId: string, scanId: string, record: JobRecord): Promise<JobRow> {
    return this.db.insert<JobRow>('jobs', { project_id: projectId, scan_id: scanId, ...record });
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.remove('projects', id);
  }

  async deleteCourse(id: string): Promise<void> {
    await this.db.remove('courses', id);
  }

  /** Every row of the person's, table by table (AC-24). */
  async exportAll(): Promise<Record<Table, unknown[]>> {
    const all = await Promise.all(TABLES.map((t) => this.db.select(t)));
    return Object.fromEntries(TABLES.map((t, i) => [t, all[i]])) as Record<Table, unknown[]>;
  }
}

function sortByCreated<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}
