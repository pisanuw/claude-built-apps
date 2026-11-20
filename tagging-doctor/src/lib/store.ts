/**
 * Saved courses, projects and scans (SPEC.md section 5) behind a small Db
 * interface, so the pages and the tests never depend on the network:
 * MemoryDb for vitest, `vite preview` and the Playwright walkthrough;
 * SupabaseDb over the app's schema for the live site, where row level
 * security keeps every call to the signed-in user's rows and the database
 * fills user_id (so this code never sends or filters by user).
 */
import { blockerDelta, type Delta, type SaveItem, type StoredFinding, type StoredScan, type StoredSummary } from '../core/saved';
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
  created_at: string;
}

export interface AltTextRow {
  id: string;
  project_id: string;
  figure_path: string;
  text: string;
  decision: string;
}

export type Where = Record<string, string | string[]>;

export interface Db {
  /** Rows of one table, filtered by equality (an array means "one of"), oldest first. */
  select<T>(table: Table, where?: Where): Promise<T[]>;
  /** Inserts one row and returns it as stored (id, user_id and created_at filled). */
  insert<T>(table: Table, row: Record<string, unknown>): Promise<T>;
  remove(table: Table, id: string): Promise<void>;
}

/** Keeps rows in memory, with the database's cascades and unique project names (tests, preview). */
export class MemoryDb implements Db {
  private readonly rows: Record<Table, Record<string, unknown>[]> = { courses: [], projects: [], scans: [], jobs: [], alt_texts: [] };
  private tick = 0;

  constructor(
    private readonly userId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async select<T>(table: Table, where: Where = {}): Promise<T[]> {
    const ok = (r: Record<string, unknown>) =>
      Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k] as string) : r[k] === v));
    return this.rows[table].filter(ok).map((r) => structuredClone(r) as T);
  }

  async insert<T>(table: Table, row: Record<string, unknown>): Promise<T> {
    if (table === 'projects' && this.rows.projects.some((p) => p.course_id === row.course_id && p.name === row.name)) {
      throw new Error('projects: duplicate key value violates unique constraint');
    }
    // created_at strictly increasing, so "latest" is well defined within one millisecond.
    const at = new Date(this.now().getTime() + this.tick++).toISOString();
    const stored = { id: newId(), user_id: this.userId, created_at: at, ...structuredClone(row) };
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
export interface TableQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: string): TableQuery;
  in(column: string, values: string[]): TableQuery;
  order(column: string, opts: { ascending: boolean }): TableQuery;
  select(columns?: string): TableQuery;
  single(): TableQuery;
}

export interface TableClient {
  from(table: string): {
    select(columns?: string): TableQuery;
    insert(row: Record<string, unknown>): TableQuery;
    delete(): TableQuery;
  };
}

/** One query per call, in the app's schema (the client is made with db.schema = app_tagging_doctor). */
export class SupabaseDb implements Db {
  constructor(private readonly client: TableClient) {}

  async select<T>(table: Table, where: Where = {}): Promise<T[]> {
    let q = this.client.from(table).select('*');
    for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
    const { data, error } = await q.order(table === 'alt_texts' ? 'updated_at' : 'created_at', { ascending: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as T[];
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

  /** The scans of these projects, oldest first. */
  async scansOf(projectIds: string[]): Promise<ScanRow[]> {
    if (!projectIds.length) return [];
    return sortByCreated(await this.db.select<ScanRow>('scans', { project_id: projectIds }));
  }

  /**
   * Saves each item under the course: a new project for a new name, or a
   * new scan of the project that has that name (AC-17, AC-21).
   */
  async save(courseId: string, items: SaveItem[]): Promise<SavedResult[]> {
    const existing = await this.projects(courseId);
    const out: SavedResult[] = [];
    for (const item of items) {
      const name = item.name.trim();
      let project = existing.find((p) => p.name === name);
      const created = !project;
      if (!project) {
        project = await this.db.insert<ProjectRow>('projects', { course_id: courseId, name, main_file: item.mainFile });
        existing.push(project);
      }
      const before = created ? [] : await this.scansOf([project.id]);
      const previous = before[before.length - 1];
      const scan = await this.db.insert<ScanRow>('scans', { project_id: project.id, ...item.scan });
      out.push({ project, scan, created, delta: previous ? blockerDelta(previous, scan) : null });
    }
    return out;
  }

  async history(projectId: string): Promise<ProjectHistory | undefined> {
    const project = (await this.db.select<ProjectRow>('projects', { id: projectId }))[0];
    if (!project) return undefined;
    const [course, scans, jobs, altTexts] = await Promise.all([
      this.course(project.course_id),
      this.scansOf([projectId]),
      this.db.select<JobRow>('jobs', { project_id: projectId }),
      this.db.select<AltTextRow>('alt_texts', { project_id: projectId }),
    ]);
    const withDelta = scans.map((scan, i) => ({ scan, delta: i > 0 ? blockerDelta(scans[i - 1], scan) : null }));
    return { project, course, scans: withDelta.reverse(), jobs, altTexts };
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
