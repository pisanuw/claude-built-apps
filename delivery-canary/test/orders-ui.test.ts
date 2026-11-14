// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyResult } from '../src/core/linkcheck';
import { importShopifyOrders, scanOrders } from '../src/core/orders';
import { SAMPLE_PEOPLE, SAMPLE_STREET, sampleOrdersCsv } from '../src/core/orders-sample';
import type { AppClient } from '../src/lib/supabase';
import { InMemoryRepository } from '../src/lib/repository';
import { MemoryCheckStore, MemoryScanStore, MemorySeedStore, SCAN_LIST_LIMIT, SupabaseScanStore, type ScanRow, type ShopRow, type Stores } from '../src/store/stores';
import { mountApp, type AppDeps } from '../src/ui/app';
import { countsText, renderScan } from '../src/ui/orders';

const NOW = Date.parse('2026-11-13T12:00:00Z');

const tick = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function savedStores(): Stores {
  return { shops: new InMemoryRepository<ShopRow>(), checks: new MemoryCheckStore(), scans: new MemoryScanStore(), seeds: new MemorySeedStore(), saved: true };
}

/** A stand-in for SHA-256: the byte length and first bytes, enough to tell files apart. */
async function fakeDigest(d: ArrayBuffer): Promise<ArrayBuffer> {
  const out = new Uint8Array(32);
  const v = new Uint8Array(d);
  out[0] = v.length & 255;
  out[1] = (v.length >> 8) & 255;
  let sum = 0;
  for (const b of v) sum = (sum * 31 + b) >>> 0;
  new DataView(out.buffer).setUint32(4, sum);
  return out.buffer;
}

function setup(over: Partial<AppDeps> = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  let n = 0;
  const downloads: Array<[string, string]> = [];
  const deps: AppDeps = {
    stores: savedStores(),
    checkLink: async (url) => emptyResult(url),
    origin: 'https://delivery-canary.test',
    basePath: '/',
    now: () => new Date(NOW + n++ * 1000),
    digest: fakeDigest,
    download: (name, text) => downloads.push([name, text]),
    ...over,
  };
  mountApp(root, deps);
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  const $$ = (sel: string) => [...root.querySelectorAll(sel)];
  const upload = (text: string, name = 'orders_export_1.csv') => {
    const input = $<HTMLInputElement>('#orders-file');
    const bytes = new TextEncoder().encode(text);
    Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => bytes.buffer }], configurable: true });
    $<HTMLFormElement>('#scan-form').dispatchEvent(new Event('submit', { cancelable: true }));
  };
  return { root, deps, $, $$, upload, downloads };
}

async function allScans(stores: Stores): Promise<ScanRow[]> {
  const out: ScanRow[] = [];
  for (const sh of await stores.shops.list()) for (const s of await stores.scans.list(sh.id, 1000)) out.push((await stores.scans.get(s.id))!);
  return out;
}

describe('order scan card', () => {
  it('scans the sample export, flags the three late orders and saves no customer data', async () => {
    const { $, $$, deps, downloads } = setup();
    await tick();
    expect($('#scan-list').textContent).toContain('No scans yet');
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    const report = $('[aria-label="Order scan result"]');
    expect(report.querySelector('.verdict')?.textContent).toBe('3 download orders look undelivered');
    expect([...report.querySelectorAll('tbody th')].map((t) => t.textContent)).toEqual(['#1001', '#1005', '#1006']);
    expect(report.textContent).toContain('rest of the order delivered or shipped');
    expect(report.textContent).toContain('resend the download from your delivery app');
    expect($('#dropped').textContent).toContain('Email');
    expect($('#orders-status').textContent).toBe('Scanned and saved.');
    expect($$('#scan-list li')).toHaveLength(1);
    const saved = await allScans(deps.stores);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ file_name: 'sample-orders-export.csv', grace_minutes: 60, orders_total: 9, flagged: 3 });
    const json = JSON.stringify(saved);
    for (const email of SAMPLE_PEOPLE) expect(json).not.toContain(email);
    expect(json).not.toContain(SAMPLE_STREET);
    // The late list downloads as CSV.
    $<HTMLButtonElement>('#download-late').click();
    expect(downloads).toHaveLength(1);
    expect(downloads[0][0]).toBe('late-download-orders-2026-11-13.csv');
    expect(downloads[0][1].split('\r\n')[0]).toBe('Order,Paid at,Waiting,Items not delivered,Flagged since');
    expect(downloads[0][1]).toContain('#1005');
  });

  it('updates the same file instead of adding a scan, and compares a new file with the last one', async () => {
    const { $, $$, deps, upload } = setup();
    await tick();
    const day1 = sampleOrdersCsv(new Date(NOW));
    upload(day1);
    await tick();
    expect($('#orders-status').textContent).toBe('Scanned and saved.');
    upload(day1);
    await tick();
    expect($('#orders-status').textContent).toContain('This file was scanned before');
    expect(await allScans(deps.stores)).toHaveLength(1);
    expect($$('#scan-list li')).toHaveLength(1);
    // A later export: #1001 fixed (now fulfilled), the rest still late.
    const day2 = day1.replace(/(#1001,ada@example\.com,paid,[^,]*,)unfulfilled/, '$1fulfilled').replace(/(Fox Mittens Knitting Pattern \(PDF\),6\.00,PAT-FOX,false,)pending(,ada)/, '$1fulfilled$2');
    expect(day2).not.toBe(day1);
    upload(day2, 'orders_export_2.csv');
    await tick();
    expect(await allScans(deps.stores)).toHaveLength(2);
    expect($('#compared').textContent).toMatch(/#1001 is no longer late/);
    expect([...$$('[aria-label="Order scan result"] tbody td:last-child')].map((t) => t.textContent)).toEqual([expect.stringMatching(/^Also late on/), expect.stringMatching(/^Also late on/)]);
    // Rescanning the first file compares it with the second, not with itself.
    upload(day1);
    await tick();
    expect(await allScans(deps.stores)).toHaveLength(2);
    expect($('#compared').textContent).toMatch(/^Compared with the scan of/);
  });

  it('uses the chosen grace period and the shop\'s delivery app in the advice', async () => {
    const { $ } = setup();
    await tick();
    $<HTMLSelectElement>('#shop-app').value = 'sky-pilot';
    $<HTMLInputElement>('#shop-name').value = 'Fox Patterns';
    $<HTMLButtonElement>('#save-shop').click();
    await tick();
    $<HTMLSelectElement>('#orders-grace').value = '1440';
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    const report = $('[aria-label="Order scan result"]');
    expect([...report.querySelectorAll('tbody th')].map((t) => t.textContent)).toEqual(['#1001', '#1005']);
    expect(report.textContent).toContain('resend the download from Sky Pilot');
    expect(report.textContent).toContain('within the 24 hours grace period');
  });

  it('views and deletes saved scans', async () => {
    const { $, $$, deps } = setup();
    await tick();
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    $('#scan-result').replaceChildren();
    ($$('[data-view-scan]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('[aria-label="Order scan result"] .verdict').textContent).toContain('3 download orders');
    ($$('[data-delete-scan]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('#orders-status').textContent).toBe('Scan deleted.');
    expect(await allScans(deps.stores)).toHaveLength(0);
    expect($('#scan-list').textContent).toContain('No scans yet');
  });

  it('explains bad files in plain words', async () => {
    const { $, upload } = setup();
    await tick();
    $<HTMLFormElement>('#scan-form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect($('#orders-status').textContent).toMatch(/Choose the orders export/);
    upload('Handle,Title\nx,y');
    await tick();
    expect($('#orders-status').textContent).toMatch(/Products export/);
    expect($('#scan-result').textContent).toBe('');
    upload('x'.repeat(10), 'big.csv');
    await tick();
    expect($('#orders-status').textContent).toMatch(/does not look like/);
    const input = $<HTMLInputElement>('#orders-file');
    Object.defineProperty(input, 'files', { value: [{ name: 'huge.csv', arrayBuffer: async () => new ArrayBuffer(50 * 1024 * 1024 + 1) }], configurable: true });
    $<HTMLFormElement>('#scan-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect($('#orders-status').textContent).toBe('This file is over 50 MB. Export a shorter date range.');
    Object.defineProperty(input, 'files', { value: [{ name: 'gone.csv', arrayBuffer: () => Promise.reject(new Error('x')) }], configurable: true });
    $<HTMLFormElement>('#scan-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect($('#orders-status').textContent).toBe('The file could not be opened.');
  });

  it('says signed-out scans are not kept', async () => {
    const stores: Stores = { shops: new InMemoryRepository<ShopRow>(), checks: new MemoryCheckStore(), scans: new MemoryScanStore(), seeds: new MemorySeedStore(), saved: false };
    const { $ } = setup({ stores });
    await tick();
    expect($('#scan-list').textContent).toContain('until you leave the page');
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    expect($('#orders-status').textContent).toBe('Scanned. Sign in to keep this scan.');
  });

  it('reports store failures', async () => {
    const boom = async () => {
      throw new Error('offline');
    };
    const scans = new MemoryScanStore();
    const stores = savedStores();
    stores.scans = scans;
    const { $, $$ } = setup({ stores });
    await tick();
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    scans.get = boom;
    ($$('[data-view-scan]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('#orders-status').textContent).toBe('Could not open the scan: offline');
    scans.get = async () => undefined;
    ($$('[data-view-scan]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('#orders-status').textContent).toBe('That scan is no longer saved.');
    scans.remove = boom;
    ($$('[data-delete-scan]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('#orders-status').textContent).toBe('Could not delete: offline');
    scans.put = boom;
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    expect($('#orders-status').textContent).toBe('Scanned, but not saved: offline');
    expect($('[aria-label="Order scan result"]')).not.toBeNull();
    scans.byFile = boom;
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    expect($('#orders-status').textContent).toBe('Could not read your earlier scans: offline');
    scans.list = boom;
    $<HTMLInputElement>('#shop-name').value = 'X';
    $<HTMLButtonElement>('#save-shop').click();
    await tick();
    // A failing list shows in the list area, not as a crash.
    const fresh = setup({ stores });
    await tick();
    expect(fresh.$('#scan-list').textContent).toBe('Could not load your scans: offline');
  });
});

describe('renderScan', () => {
  it('words a clean scan, a suspect delivery app, an unlisted remainder and a file with no customer columns', () => {
    const csv = 'Name,Financial Status,Created at,Lineitem name,Lineitem requires shipping,Lineitem fulfillment status\n#1,paid,2026-11-13 08:00:00 +0000,PDF,false,fulfilled\n';
    const clean = scanOrders(importShopifyOrders(csv), new Date(NOW), 60);
    const el = renderScan(clean, { fileName: '', deliveryApp: 'unknown' });
    expect(el.querySelector('.verdict')?.textContent).toBe('No late download orders');
    expect(el.className).toContain('verdict-pass');
    expect(el.querySelector('#dropped')?.textContent).toContain('no customer columns');
    expect(el.querySelector('table')).toBeNull();
    expect(countsText(clean)).toBe('1 order in the file, 1 with downloads: 1 delivered, 0 late.');

    const rows = ['Name,Financial Status,Created at,Lineitem name,Lineitem requires shipping,Lineitem fulfillment status,Lineitem quantity'];
    for (let i = 0; i < 6; i++) rows.push(`#${i},paid,2026-11-13 08:00:00 +0000,PDF,false,pending,2`);
    rows.push('#50,refunded,2026-11-13 08:00:00 +0000,PDF,false,pending,1', '#51,paid,2026-11-13 08:00:00 +0000,Book,true,pending,1');
    const suspect = scanOrders(importShopifyOrders(rows.join('\n')), new Date(NOW), 60);
    suspect.lateNotKept = 4;
    const el2 = renderScan(suspect, { fileName: 'x.csv', deliveryApp: 'nonsense' });
    expect(el2.className).toContain('verdict-warn');
    expect(el2.querySelector('.verdict')?.textContent).toBe('6 download orders look undelivered');
    expect(el2.textContent).toContain('2 × PDF');
    expect(el2.textContent).toContain('4 more late orders are counted but not listed');
    expect(el2.querySelector('#download-late')).toBeNull();
    expect(countsText(suspect)).toBe('8 orders in the file, 7 with downloads: 0 delivered, 6 late, 1 refunded. Not checked: 1 order with parcels only.');

    const one = scanOrders(importShopifyOrders(`${rows[0]}\n${rows[1]}`), new Date(NOW), 60);
    one.compared = { at: '2026-11-12T12:00:00Z', resolved: ['#9'] };
    one.late[0].since = '';
    const el3 = renderScan(one, { fileName: '', deliveryApp: 'shopify' });
    expect(el3.querySelector('.verdict')?.textContent).toBe('1 download order looks undelivered');
    expect(el3.querySelector('#compared')?.textContent).toMatch(/#9 is no longer late/);
    expect(el3.querySelector('tbody td')?.textContent).toBe('unknown');
    expect(el3.textContent).toContain('resend the download from Shopify Digital Products');
    const two = { ...one, compared: { at: '2026-11-12T12:00:00Z', resolved: ['#8', '#9'] } };
    expect(renderScan(two, { fileName: '', deliveryApp: '' }).querySelector('#compared')?.textContent).toMatch(/#8, #9 are no longer late/);
  });
});

describe('scan stores', () => {
  const row = (id: string, shop: string, at: string, sha = id.padEnd(64, '0')): ScanRow => ({
    id,
    shop_id: shop,
    created_at: at,
    updated_at: at,
    file_sha256: sha,
    file_name: `${id}.csv`,
    grace_minutes: 60,
    orders_total: 1,
    flagged: 0,
    summary: scanOrders({ orders: [], rows: 0, droppedPersonal: [], droppedCount: 0 }, new Date(NOW), 60),
  });
  it('lists, finds by file and finds the latest other scan in memory', async () => {
    const m = new MemoryScanStore();
    await m.put(row('a', 's1', '1'));
    await m.put(row('b', 's1', '3'));
    await m.put(row('c', 's1', '2'));
    await m.put(row('d', 's2', '4'));
    expect((await m.list('s1')).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect((await m.list('s1', 1))[0]).not.toHaveProperty('summary');
    expect((await m.byFile('s1', 'a'.padEnd(64, '0')))?.id).toBe('a');
    expect(await m.byFile('s2', 'a'.padEnd(64, '0'))).toBeUndefined();
    expect((await m.latest('s1'))?.id).toBe('b');
    expect((await m.latest('s1', 'b'))?.id).toBe('c');
    expect(await m.latest('s3')).toBeUndefined();
    await m.remove('b');
    expect((await m.list('s1')).map((r) => r.id)).toEqual(['c', 'a']);
  });
  it('asks Supabase for one shop\'s scans', async () => {
    const calls: unknown[][] = [];
    let result: unknown = { data: [{ id: 'x' }], error: null };
    const chain = () => {
      const q: Record<string, (...a: unknown[]) => unknown> = {};
      for (const k of ['select', 'eq', 'neq', 'order', 'limit', 'maybeSingle', 'upsert', 'single', 'delete']) {
        q[k] = (...a: unknown[]) => {
          calls.push([k, ...a]);
          return q;
        };
      }
      q.then = (res: unknown) => (res as (v: unknown) => unknown)(result);
      return q;
    };
    const client = { from: (t: string) => (calls.push(['from', t]), chain()) } as unknown as AppClient;
    const store = new SupabaseScanStore(client);
    expect(await store.list('s1')).toEqual([{ id: 'x' }]);
    expect(calls).toEqual([['from', 'order_scans'], ['select', 'id, shop_id, created_at, updated_at, file_sha256, file_name, grace_minutes, orders_total, flagged'], ['eq', 'shop_id', 's1'], ['order', 'updated_at', { ascending: false }], ['limit', SCAN_LIST_LIMIT]]);
    calls.length = 0;
    result = { data: { id: 'y' }, error: null };
    expect(await store.byFile('s1', 'f')).toEqual({ id: 'y' });
    expect(calls).toEqual([['from', 'order_scans'], ['select', '*'], ['eq', 'shop_id', 's1'], ['eq', 'file_sha256', 'f'], ['maybeSingle']]);
    calls.length = 0;
    expect(await store.latest('s1', 'y')).toEqual({ id: 'y' });
    expect(calls).toEqual([['from', 'order_scans'], ['select', '*'], ['eq', 'shop_id', 's1'], ['neq', 'id', 'y'], ['order', 'updated_at', { ascending: false }], ['limit', 1], ['maybeSingle']]);
    calls.length = 0;
    await store.latest('s1');
    expect(calls.some((c) => c[0] === 'neq')).toBe(false);
    expect(await store.get('y')).toEqual({ id: 'y' });
    expect(await store.put(row('y', 's1', '1'))).toEqual({ id: 'y' });
    result = { data: null, error: null };
    expect(await store.list('s1')).toEqual([]);
    expect(await store.byFile('s1', 'f')).toBeUndefined();
    expect(await store.latest('s1')).toBeUndefined();
    await store.remove('y');
    result = { data: null, error: { message: 'denied' } };
    await expect(store.list('s1')).rejects.toThrow('order_scans: denied');
    await expect(store.byFile('s1', 'f')).rejects.toThrow('order_scans: denied');
    await expect(store.latest('s1')).rejects.toThrow('order_scans: denied');
  });
});

describe('order scan card, review fixes', () => {
  it('measures to the file time, so the same file scanned later gives the same answer', async () => {
    let clock = NOW;
    const { $, upload } = setup({ now: () => new Date(clock) });
    await tick();
    const text = sampleOrdersCsv(new Date(NOW));
    const input = $<HTMLInputElement>('#orders-file');
    const bytes = new TextEncoder().encode(text);
    const drop = () => {
      Object.defineProperty(input, 'files', { value: [{ name: 'e.csv', lastModified: NOW, arrayBuffer: async () => bytes.buffer }], configurable: true });
      $<HTMLFormElement>('#scan-form').dispatchEvent(new Event('submit', { cancelable: true }));
    };
    drop();
    await tick();
    expect($$late($)).toEqual(['#1001', '#1005', '#1006']);
    clock = NOW + 3 * 3_600_000;
    drop();
    await tick();
    expect($$late($)).toEqual(['#1001', '#1005', '#1006']);
    expect($('[aria-label="Order scan result"] .summary').textContent).toContain(', export of ');
    // Without a file time the scan time is used, and #1009 has aged past the grace period.
    upload(text, 'no-time.csv');
    await tick();
    expect($$late($)).toEqual(['#1001', '#1005', '#1006', '#1009']);
  });

  it('clears the scan when the account changes', async () => {
    let swap: ((s: Stores) => void) | undefined;
    const { $ } = setup({ mountAuth: (_el, onStores) => (swap = onStores) });
    await tick();
    $<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    expect($('[aria-label="Order scan result"]')).not.toBeNull();
    swap!(savedStores());
    await tick();
    expect($('[aria-label="Order scan result"]')).toBeNull();
    expect($('#orders-status').textContent).toBe('');
    expect($('#scan-list').textContent).toContain('No scans yet');
  });

  it('explains a failed fingerprint and a failed shop save', async () => {
    const a = setup({ digest: () => Promise.reject(new Error('no subtle')) });
    await tick();
    a.$<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    expect(a.$('#orders-status').textContent).toMatch(/could not fingerprint the file/);
    const stores = savedStores();
    stores.shops.put = () => Promise.reject(new Error('denied'));
    const b = setup({ stores });
    await tick();
    b.$<HTMLButtonElement>('#run-sample-scan').click();
    await tick();
    expect(b.$('#orders-status').textContent).toBe('Could not save your shop: denied');
  });

  it('marks partly refunded orders and counts undated ones', () => {
    const csv = 'Name,Financial Status,Paid at,Created at,Lineitem name,Lineitem requires shipping\n#1,partially_refunded,2026-11-13 08:00:00 +0000,2026-11-13 08:00:00 +0000,PDF,false\n#2,paid,,11/13/2026 08:00,PDF,false\n';
    const s = scanOrders(importShopifyOrders(csv), new Date(NOW), 60);
    const el = renderScan(s, { fileName: '', deliveryApp: 'unknown' });
    expect(el.textContent).toContain('partly refunded: check the refund was not for this item');
    expect(countsText(s)).toContain('1 with no readable date');
  });

  it('upserts Supabase scans on the file, leaving id and created_at to the database', async () => {
    const calls: unknown[][] = [];
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of ['upsert', 'select', 'single']) q[k] = (...a: unknown[]) => (calls.push([k, ...a]), q);
    q.then = (res: unknown) => (res as (v: unknown) => unknown)({ data: { id: 'db' }, error: null });
    const store = new SupabaseScanStore({ from: () => q } as unknown as AppClient);
    const row = { id: 'local', shop_id: 's', created_at: 'c', updated_at: 'u', file_sha256: 'f', file_name: 'n', grace_minutes: 60, orders_total: 1, flagged: 0, summary: {} as ScanRow['summary'] };
    expect(await store.put(row)).toEqual({ id: 'db' });
    expect(calls[0]).toEqual(['upsert', { shop_id: 's', updated_at: 'u', file_sha256: 'f', file_name: 'n', grace_minutes: 60, orders_total: 1, flagged: 0, summary: {} }, { onConflict: 'shop_id,file_sha256' }]);
    q.then = (res: unknown) => (res as (v: unknown) => unknown)({ data: null, error: { message: 'dup' } });
    await expect(store.put(row)).rejects.toThrow('order_scans: dup');
  });
});

function $$late($: <T extends Element = HTMLElement>(sel: string) => T): string[] {
  const art = $('[aria-label="Order scan result"]');
  return [...art.querySelectorAll('tbody th')].map((t) => t.textContent ?? '');
}
