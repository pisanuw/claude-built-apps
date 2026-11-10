/**
 * Where client files are kept (docs/platform.md, section 5: data access behind
 * a small interface). Three stores share one interface:
 *
 * - MemoryFileStore: tests only.
 * - LocalFileStore: this browser (localStorage), for visitors who do not sign
 *   in and for files a signed-in user keeps off the server.
 * - SupabaseFileStore: the signed-in user's account, table
 *   app_qualified_overtime_checker.client_files; row level security keeps
 *   every row to its owner and the database fills user_id.
 */
import { decodeFile, encodeFile, summarizeFile, type FileLocation, type FileSummary } from '../core/codec';
import type { ClientFile } from '../core/clientFile';

export interface FileStore {
  readonly location: FileLocation;
  /** Most recently saved first. */
  list(): Promise<FileSummary[]>;
  get(id: string): Promise<ClientFile | undefined>;
  put(file: ClientFile): Promise<void>;
  remove(id: string): Promise<void>;
}

function byRecent(a: FileSummary, b: FileSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
}

/** Keeps encoded copies, as the real stores do, so tests see the same round trip. */
export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, { data: string; summary: FileSummary }>();
  constructor(readonly location: FileLocation = 'browser') {}

  async list(): Promise<FileSummary[]> {
    return [...this.files.values()].map((f) => ({ ...f.summary })).sort(byRecent);
  }
  async get(id: string): Promise<ClientFile | undefined> {
    const f = this.files.get(id);
    return f ? decodeFile(id, JSON.parse(f.data)) : undefined;
  }
  async put(file: ClientFile): Promise<void> {
    this.files.set(file.id, { data: JSON.stringify(encodeFile(file)), summary: summarizeFile(file, this.location) });
  }
  async remove(id: string): Promise<void> {
    this.files.delete(id);
  }
}

/** The part of the Web Storage API the local store uses. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const LOCAL_INDEX = 'qoc.files';
const localKey = (id: string) => `qoc.file.${id}`;

export class LocalFileStore implements FileStore {
  readonly location = 'browser' as const;
  constructor(private readonly storage: KeyValue) {}

  private index(): FileSummary[] {
    try {
      const raw = this.storage.getItem(LOCAL_INDEX);
      const list = raw ? (JSON.parse(raw) as FileSummary[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      throw new Error('This browser has no room left to keep the file. Sign in to save it to your account, or delete an older file.');
    }
  }

  async list(): Promise<FileSummary[]> {
    return this.index().sort(byRecent);
  }

  async get(id: string): Promise<ClientFile | undefined> {
    const raw = this.storage.getItem(localKey(id));
    return raw ? decodeFile(id, JSON.parse(raw)) : undefined;
  }

  async put(file: ClientFile): Promise<void> {
    const key = localKey(file.id);
    const before = this.storage.getItem(key);
    this.write(key, JSON.stringify(encodeFile(file)));
    const rest = this.index().filter((s) => s.id !== file.id);
    try {
      this.write(LOCAL_INDEX, JSON.stringify([summarizeFile(file, 'browser'), ...rest]));
    } catch (e) {
      // Never leave a file the list cannot show (and so nobody can delete).
      if (before === null) this.storage.removeItem(key);
      else this.storage.setItem(key, before);
      throw e;
    }
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(localKey(id));
    this.write(LOCAL_INDEX, JSON.stringify(this.index().filter((s) => s.id !== id)));
  }
}

/** A supabase-js style error. */
type DbError = { message: string } | null;

/**
 * The slice of a supabase-js client (bound to the app schema) this store
 * calls. Typed loosely so tests can pass a small fake.
 */
export interface TableClient {
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: DbError }>;
      eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: DbError }> };
    };
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: DbError }>;
    delete(): { eq(column: string, value: string): PromiseLike<{ error: DbError }> };
  };
}

export const TABLE = 'client_files';

interface Row {
  id: string;
  name: string;
  tax_year: number;
  summary: Partial<FileSummary> | null;
  updated_at: string;
}

function fail(what: string, error: DbError): never {
  throw new Error(`Could not ${what} your saved files: ${error?.message ?? 'no answer from the server'}.`);
}

export class SupabaseFileStore implements FileStore {
  readonly location = 'account' as const;
  constructor(private readonly client: TableClient) {}

  async list(): Promise<FileSummary[]> {
    const { data, error } = await this.client.from(TABLE).select('id,name,tax_year,summary,updated_at').order('updated_at', { ascending: false });
    if (error) fail('list', error);
    return ((data ?? []) as Row[]).map((r) => ({
      employees: 0,
      needCorrection: 0,
      notEntered: 0,
      ...(r.summary ?? {}),
      id: r.id,
      name: r.name,
      taxYear: r.tax_year,
      updatedAt: r.updated_at,
      location: 'account' as const,
    }));
  }

  async get(id: string): Promise<ClientFile | undefined> {
    const { data, error } = await this.client.from(TABLE).select('id,data').eq('id', id).maybeSingle();
    if (error) fail('open', error);
    const row = data as { id: string; data: unknown } | null;
    return row ? decodeFile(row.id, row.data) : undefined;
  }

  async put(file: ClientFile): Promise<void> {
    const summary = summarizeFile(file, 'account');
    const { error } = await this.client.from(TABLE).upsert({
      id: file.id,
      name: file.settings.name,
      tax_year: file.settings.taxYear,
      summary: { employees: summary.employees, needCorrection: summary.needCorrection, notEntered: summary.notEntered },
      data: encodeFile(file),
      updated_at: file.updatedAt,
    }, { onConflict: 'user_id,id' });
    if (error) fail('save', error);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq('id', id);
    if (error) fail('delete', error);
  }
}

/** The browser store, plus the account store while someone is signed in. */
export class Files {
  private account: FileStore | null = null;
  constructor(private readonly browser: FileStore) {}

  setAccount(store: FileStore | null): void {
    this.account = store;
  }

  get signedIn(): boolean {
    return this.account !== null;
  }

  store(location: FileLocation): FileStore {
    if (location === 'account') {
      if (!this.account) throw new Error('Sign in to open the files saved to your account.');
      return this.account;
    }
    return this.browser;
  }

  /** Both stores, most recent first. An account that cannot be listed is reported, not thrown. */
  async list(): Promise<{ files: FileSummary[]; error: string | null }> {
    const local = await this.browser.list();
    let remote: FileSummary[] = [];
    let error: string | null = null;
    if (this.account) {
      try {
        remote = await this.account.list();
      } catch (e) {
        error = (e as Error).message;
      }
    }
    return { files: [...remote, ...local].sort(byRecent), error };
  }

  /** Copies the file to the other store, then removes it from the first. */
  async move(file: ClientFile, from: FileLocation, to: FileLocation): Promise<void> {
    if (from === to) return;
    await this.store(to).put(file);
    await this.store(from).remove(file.id);
  }
}
