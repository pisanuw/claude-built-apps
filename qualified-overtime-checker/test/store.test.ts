import { describe, expect, it } from 'vitest';
import { newClientFile, withReported, type ClientFile } from '../src/core/clientFile';
import { decodeFile, encodeFile, summarizeFile, worthSaving } from '../src/core/codec';
import { buildSample } from '../src/core/sample';
import { Files, LOCAL_INDEX, LocalFileStore, MemoryFileStore, SupabaseFileStore, TABLE, type KeyValue, type TableClient } from '../src/store/stores';

function sampleFile(id = 'a1', when = '2026-11-10T12:00:00.000Z'): ClientFile {
  const s = buildSample();
  return withReported({ ...newClientFile(id, s.settings, new Date(when)), lines: s.lines, source: 'sample.csv' }, s.reported);
}

class FakeStorage implements KeyValue {
  data = new Map<string, string>();
  full = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

/** A fake of the supabase-js query builder calls SupabaseFileStore makes, with one table in memory. */
function fakeDb(opts: { fail?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const err = opts.fail ? { message: 'permission denied' } : null;
  const client: TableClient = {
    from(table: string) {
      calls.push(`from ${table}`);
      return {
        select(columns: string) {
          calls.push(`select ${columns}`);
          return {
            order: async () => ({ data: err ? null : [...rows.values()].map((r) => ({ id: r.id, name: r.name, tax_year: r.tax_year, summary: r.summary, updated_at: r.updated_at })), error: err }),
            eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: err ? null : (rows.get(id) ? { id, data: rows.get(id)?.data } : null), error: err }) }),
          };
        },
        upsert: async (row: Record<string, unknown>, opts: { onConflict: string }) => {
          calls.push(`upsert on ${opts.onConflict}`);
          if (!err) rows.set(row.id as string, JSON.parse(JSON.stringify(row)));
          return { error: err };
        },
        delete: () => ({
          eq: async (_c: string, id: string) => {
            if (!err) rows.delete(id);
            return { error: err };
          },
        }),
      };
    },
  };
  return { client, rows, calls };
}

describe('codec', () => {
  it('round-trips a file and is much smaller than the plain objects', () => {
    const f = sampleFile();
    const enc = encodeFile(f);
    expect(decodeFile('a1', JSON.parse(JSON.stringify(enc)))).toEqual(f);
    expect(JSON.stringify(enc).length).toBeLessThan(JSON.stringify(f).length / 2);
    expect(enc.employees).toHaveLength(8);
    expect(enc.codes).toEqual(['Regular', 'Catering', 'Server', 'Quarterly bonus']);
  });
  it('refuses an unknown format and fills defaults', () => {
    expect(() => decodeFile('x', { v: 2 })).toThrow(/format/);
    expect(() => decodeFile('x', null)).toThrow(/format/);
    const minimal = decodeFile('x', { v: 1, settings: { name: '', taxYear: 2026, workweekStart: 0 }, employees: [['k', '', 'K']], codes: [], lines: [[0, '2026-11-02', 8, 20, 9, 1, null, 3, 2]], updatedAt: 't' });
    expect(minimal).toMatchObject({ reported: {}, source: null, mapping: null, report: null });
    expect(minimal.lines[0]).toMatchObject({ kind: 'work', code: '' });
  });
  it('summarizes and decides what is worth saving', () => {
    expect(summarizeFile(sampleFile(), 'account')).toMatchObject({ id: 'a1', name: 'Cedar Lane Kitchen (sample)', employees: 8, needCorrection: 6, notEntered: 0, location: 'account' });
    expect(worthSaving(newClientFile('x'))).toBe(false);
    expect(worthSaving(newClientFile('x', { name: ' Bo ' }))).toBe(true);
  });
});

describe('stores', () => {
  it('memory store keeps copies, lists recent first and removes', async () => {
    const m = new MemoryFileStore();
    await m.put(sampleFile('a', '2026-11-01T00:00:00Z'));
    await m.put({ ...newClientFile('b', { name: 'Bo' }, new Date('2026-11-05T00:00:00Z')) });
    expect((await m.list()).map((s) => s.id)).toEqual(['b', 'a']);
    const a = await m.get('a');
    a!.lines.length = 0;
    expect((await m.get('a'))!.lines.length).toBeGreaterThan(0);
    await m.remove('a');
    expect(await m.get('a')).toBeUndefined();
    expect(new MemoryFileStore('account').location).toBe('account');
  });

  it('local store writes an index and one key per file', async () => {
    const st = new FakeStorage();
    const l = new LocalFileStore(st);
    await l.put(sampleFile('a'));
    await l.put(newClientFile('b', { name: 'Bo' }, new Date('2026-11-11T00:00:00Z')));
    await l.put(newClientFile('b', { name: 'Bo Ray' }, new Date('2026-11-12T00:00:00Z')));
    expect((await l.list()).map((s) => [s.id, s.name])).toEqual([['b', 'Bo Ray'], ['a', 'Cedar Lane Kitchen (sample)']]);
    expect((await l.get('a'))!.lines.length).toBe(sampleFile().lines.length);
    expect(await l.get('zz')).toBeUndefined();
    await l.remove('a');
    expect(st.getItem('qoc.file.a')).toBeNull();
    expect((await l.list()).map((s) => s.id)).toEqual(['b']);
  });

  it('local store survives a broken index and reports a full browser', async () => {
    const st = new FakeStorage();
    st.setItem(LOCAL_INDEX, '{oops');
    const l = new LocalFileStore(st);
    expect(await l.list()).toEqual([]);
    st.setItem(LOCAL_INDEX, '{"not":"a list"}');
    expect(await l.list()).toEqual([]);
    st.full = true;
    await expect(l.put(sampleFile())).rejects.toThrow(/no room left/);
  });

  it('supabase store saves rows without user_id and reads them back', async () => {
    const db = fakeDb();
    const s = new SupabaseFileStore(db.client);
    const f = sampleFile('5b0e6c6a-0000-4000-8000-000000000001');
    await s.put(f);
    const row = db.rows.get(f.id)!;
    expect(row).not.toHaveProperty('user_id');
    expect(row).toMatchObject({ name: 'Cedar Lane Kitchen (sample)', tax_year: 2026, summary: { employees: 8, needCorrection: 6, notEntered: 0 } });
    expect(JSON.stringify(row)).not.toContain('***-**');
    expect(db.calls).toContain(`from ${TABLE}`);
    expect(db.calls).toContain('upsert on user_id,id');
    expect(await s.list()).toEqual([expect.objectContaining({ id: f.id, employees: 8, needCorrection: 6, location: 'account', taxYear: 2026 })]);
    expect(await s.get(f.id)).toEqual(f);
    expect(await s.get('missing')).toBeUndefined();
    await s.remove(f.id);
    expect(await s.list()).toEqual([]);
  });

  it('supabase store fills a missing summary and turns errors into sentences', async () => {
    const db = fakeDb();
    db.rows.set('x', { id: 'x', name: 'Old', tax_year: 2026, summary: null, updated_at: '2026-11-10T00:00:00Z', data: encodeFile(newClientFile('x')) });
    expect((await new SupabaseFileStore(db.client).list())[0]).toMatchObject({ employees: 0, needCorrection: 0 });
    const bad = new SupabaseFileStore(fakeDb({ fail: true }).client);
    await expect(bad.list()).rejects.toThrow('Could not list your saved files: permission denied.');
    await expect(bad.get('x')).rejects.toThrow(/open/);
    await expect(bad.put(newClientFile('x'))).rejects.toThrow(/save/);
    await expect(bad.remove('x')).rejects.toThrow(/delete/);
  });

  it('files merges both stores, moves between them and reports a broken account', async () => {
    const browser = new MemoryFileStore('browser');
    const account = new MemoryFileStore('account');
    const files = new Files(browser);
    expect(files.signedIn).toBe(false);
    expect(() => files.store('account')).toThrow(/Sign in/);
    await browser.put(newClientFile('b', { name: 'Local' }, new Date('2026-11-01T00:00:00Z')));
    files.setAccount(account);
    await account.put(newClientFile('a', { name: 'Remote' }, new Date('2026-11-02T00:00:00Z')));
    expect((await files.list()).files.map((f) => [f.id, f.location])).toEqual([['a', 'account'], ['b', 'browser']]);
    const b = (await browser.get('b'))!;
    await files.move(b, 'browser', 'account');
    await files.move(b, 'account', 'account');
    expect((await browser.list()).length).toBe(0);
    expect((await account.list()).map((f) => f.id).sort()).toEqual(['a', 'b']);
    files.setAccount(new SupabaseFileStore(fakeDb({ fail: true }).client));
    expect(await files.list()).toEqual({ files: [], error: 'Could not list your saved files: permission denied.' });
  });
});
