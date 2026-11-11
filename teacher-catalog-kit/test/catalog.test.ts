import { describe, expect, it } from 'vitest';
import type { Resource } from '../src/core/types';
import { DAMAGED_STORAGE, FULL_STORAGE, LOCAL_RESOURCES, LOCAL_TIER, LocalCatalog, MemoryCatalog, resourceToRow, rowToResource, SupabaseCatalog, type KeyValue, type TableClient } from '../src/store/catalog';

function res(id: string, createdAt: string, extra: Partial<Resource> = {}): Resource {
  return { id, title: `R ${id}`, productType: 'digital-education', tptPriceCents: 300, tptId: null, listings: [], notes: '', createdAt, updatedAt: createdAt, ...extra };
}

class FakeStorage implements KeyValue {
  data = new Map<string, string>();
  full = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error('QuotaExceeded');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('MemoryCatalog', () => {
  it('stores copies, oldest first, and a tier', async () => {
    const m = new MemoryCatalog('browser', [res('b', '2026-11-02'), res('a', '2026-11-01')]);
    expect((await m.list()).map((r) => r.id)).toEqual(['a', 'b']);
    const r = res('c', '2026-11-03');
    await m.put(r);
    r.title = 'changed';
    expect((await m.list())[2].title).toBe('R c');
    await m.remove('a');
    expect((await m.list()).map((x) => x.id)).toEqual(['b', 'c']);
    expect(await m.getTier()).toBe('undecided');
    await m.setTier('basic');
    expect(await m.getTier()).toBe('basic');
    expect(new MemoryCatalog().location).toBe('browser');
  });
});

describe('LocalCatalog', () => {
  it('round-trips resources and the tier', async () => {
    const s = new FakeStorage();
    const c = new LocalCatalog(s);
    expect(await c.list()).toEqual([]);
    await c.put(res('a', '2026-11-01'));
    await c.put(res('b', '2026-11-02'));
    await c.put(res('a', '2026-11-01', { title: 'New title' }));
    expect((await c.list()).map((r) => r.title)).toEqual(['New title', 'R b']);
    await c.remove('b');
    expect((await c.list()).length).toBe(1);
    expect(await c.getTier()).toBe('undecided');
    await c.setTier('exclusive');
    expect(await new LocalCatalog(s).getTier()).toBe('exclusive');
  });

  it('never writes over damaged storage', async () => {
    const s = new FakeStorage();
    s.data.set(LOCAL_RESOURCES, '{not json');
    s.data.set(LOCAL_TIER, 'premium');
    const c = new LocalCatalog(s);
    expect(await c.list()).toEqual([]);
    expect(await c.getTier()).toBe('undecided');
    await expect(c.put(res('a', '2026-11-01'))).rejects.toThrow(DAMAGED_STORAGE);
    await expect(c.remove('a')).rejects.toThrow(DAMAGED_STORAGE);
    expect(s.data.get(LOCAL_RESOURCES)).toBe('{not json');
    s.data.set(LOCAL_RESOURCES, '{"a":1}');
    expect(await c.list()).toEqual([]);
    await expect(c.put(res('a', '2026-11-01'))).rejects.toThrow(DAMAGED_STORAGE);
  });

  it('keeps entries it cannot read when it writes', async () => {
    const s = new FakeStorage();
    s.data.set(LOCAL_RESOURCES, JSON.stringify([res('a', '2026-11-01'), { id: '', future: true }]));
    const c = new LocalCatalog(s);
    expect((await c.list()).length).toBe(1);
    await c.put(res('b', '2026-11-02'));
    await c.remove('a');
    expect(JSON.parse(s.data.get(LOCAL_RESOURCES) as string)).toEqual([res('b', '2026-11-02'), { id: '', future: true }]);
  });

  it('says so when the browser is full', async () => {
    const s = new FakeStorage();
    s.full = true;
    const c = new LocalCatalog(s);
    await expect(c.put(res('a', '2026-11-01'))).rejects.toThrow(FULL_STORAGE);
    await expect(c.setTier('basic')).rejects.toThrow(FULL_STORAGE);
  });
});

type Call = { table: string; op: string; arg?: unknown; opts?: unknown };

function fakeClient(rows: Record<string, unknown[]>, error: { message: string } | null = null): { client: TableClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: TableClient = {
    from(table) {
      return {
        select(columns) {
          return {
            order(column, opts) {
              calls.push({ table, op: 'select-order', arg: [columns, column], opts });
              return Promise.resolve({ data: error ? null : rows[table] ?? [], error });
            },
            maybeSingle() {
              calls.push({ table, op: 'select-single', arg: columns });
              return Promise.resolve({ data: error ? null : (rows[table] ?? [])[0] ?? null, error });
            },
          };
        },
        upsert(row, opts) {
          calls.push({ table, op: 'upsert', arg: row, opts });
          return Promise.resolve({ error });
        },
        delete() {
          return {
            eq(column, value) {
              calls.push({ table, op: 'delete', arg: [column, value] });
              return Promise.resolve({ error });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('SupabaseCatalog', () => {
  const row = {
    id: 'a',
    title: 'Unit',
    product_type: 'physical',
    tpt_price_cents: 500,
    tpt_id: '123',
    listings: [{ store: 'etsy', priceCents: 450 }],
    notes: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
  };

  it('maps rows both ways', () => {
    const r = rowToResource(row);
    expect(r).toMatchObject({ id: 'a', productType: 'physical', tptPriceCents: 500, tptId: '123', notes: '', listings: [{ store: 'etsy', priceCents: 450 }] });
    const back = resourceToRow({ ...(r as Resource), listings: [{ store: 'etsy', priceCents: 450, url: 'https://etsy.com/l/1' }, { store: 'tes', priceCents: null }] });
    expect(back).toEqual({
      id: 'a',
      title: 'Unit',
      product_type: 'physical',
      tpt_price_cents: 500,
      tpt_id: '123',
      listings: [{ store: 'etsy', priceCents: 450, url: 'https://etsy.com/l/1' }, { store: 'tes', priceCents: null }],
      notes: '',
      created_at: '2026-11-01T00:00:00Z',
    });
    expect('user_id' in back).toBe(false);
  });

  it('lists, saves, deletes and keeps the tier, never naming a user', async () => {
    const { client, calls } = fakeClient({ resources: [row, { ...row, id: '', title: '' }], seller_settings: [{ tier: 'basic' }] });
    const c = new SupabaseCatalog(client);
    expect(c.location).toBe('account');
    expect((await c.list()).map((r) => r.id)).toEqual(['a']);
    expect(await c.getTier()).toBe('basic');
    await c.put(res('b', '2026-11-03'));
    await c.remove('b');
    await c.setTier('exclusive');
    expect(calls.find((x) => x.op === 'upsert' && x.table === 'resources')?.opts).toEqual({ onConflict: 'id' });
    expect(calls.find((x) => x.op === 'upsert' && x.table === 'seller_settings')).toMatchObject({ arg: { tier: 'exclusive' }, opts: { onConflict: 'user_id' } });
    expect(calls.find((x) => x.op === 'delete')?.arg).toEqual(['id', 'b']);
    for (const c of calls.filter((x) => x.op === 'upsert')) expect(Object.keys(c.arg as object)).not.toContain('user_id');
  });

  it('reads an unknown or missing tier as undecided', async () => {
    expect(await new SupabaseCatalog(fakeClient({ seller_settings: [] }).client).getTier()).toBe('undecided');
    expect(await new SupabaseCatalog(fakeClient({ seller_settings: [{ tier: 'x' }] }).client).getTier()).toBe('undecided');
    expect(await new SupabaseCatalog(fakeClient({}).client).list()).toEqual([]);
  });

  it('turns database errors into messages', async () => {
    const c = new SupabaseCatalog(fakeClient({}, { message: 'boom' }).client);
    await expect(c.list()).rejects.toThrow('Could not load your catalog: boom.');
    await expect(c.put(res('a', 'x'))).rejects.toThrow('Could not save');
    await expect(c.remove('a')).rejects.toThrow('Could not update');
    await expect(c.getTier()).rejects.toThrow('Could not load');
    await expect(c.setTier('basic')).rejects.toThrow('Could not save');
  });

  it('names a missing answer', async () => {
    const client: TableClient = {
      from: () => ({
        select: () => ({ order: () => Promise.resolve({ data: null, error: null as never }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        upsert: () => Promise.resolve({ error: null }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };
    expect(await new SupabaseCatalog(client).list()).toEqual([]);
  });
});
