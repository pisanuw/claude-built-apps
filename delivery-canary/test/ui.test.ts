// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyResult } from '../src/core/linkcheck';
import { sampleEmail } from '../src/core/sample';
import type { CheckReport, LinkResult } from '../src/core/types';
import { InMemoryRepository } from '../src/lib/repository';
import { byNewest, HISTORY_LIMIT, MemoryCheckStore, MemoryScanStore, MemorySeedStore, memoryStores, SupabaseCheckStore, supabaseStores, type CheckRow, type ShopRow, type Stores } from '../src/store/stores';
import { mountApp, type AppDeps } from '../src/ui/app';
import { h, when } from '../src/ui/dom';
import { checkInBrowser, checkLink, checkOnServer, LinkTestSkipped, NeedsSignIn, sameOrigin } from '../src/ui/linkclient';
import { renderReport, sortFindings } from '../src/ui/report';
import type { AppClient } from '../src/lib/supabase';

const ORIGIN = 'https://delivery-canary.test';
const SAMPLE_URL = `${ORIGIN}/sample/canary-pattern.pdf`;

const goodFile = (url: string, sha = 'a'.repeat(64)): LinkResult => ({ ...emptyResult(url), status: 200, contentType: 'application/pdf', fileName: 'canary-pattern.pdf', size: 685, sha256: sha });

async function allChecks(stores: Stores): Promise<CheckRow[]> {
  const shops = await stores.shops.list();
  const out: CheckRow[] = [];
  for (const sh of shops) for (const c of await stores.checks.summaries(sh.id, 10_000)) out.push((await stores.checks.get(c.id))!);
  return out;
}

const tick = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function savedStores(): Stores {
  return { shops: new InMemoryRepository<ShopRow>(), checks: new MemoryCheckStore(), scans: new MemoryScanStore(), seeds: new MemorySeedStore(), saved: true };
}

function setup(over: Partial<AppDeps> = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  let n = 0;
  const deps: AppDeps = {
    stores: memoryStores(),
    checkLink: async (url) => goodFile(url),
    origin: ORIGIN,
    basePath: '/',
    now: () => new Date(Date.parse('2026-11-12T12:00:00Z') + n++ * 1000),
    ...over,
  };
  const app = mountApp(root, deps);
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  const $$ = (sel: string) => [...root.querySelectorAll(sel)];
  return { root, app, deps, $, $$ };
}

describe('dom helpers', () => {
  it('builds elements with text only', () => {
    const el = h('p', { class: 'x', hidden: true, title: undefined, open: false }, '<b>no</b>', null, h('span', {}, 'y'));
    expect(el.outerHTML).toBe('<p class="x" hidden="">&lt;b&gt;no&lt;/b&gt;<span>y</span></p>');
    expect(when('')).toBe('');
    expect(when('nope')).toBe('');
    expect(when('2026-11-12T12:00:00Z')).toMatch(/2026/);
  });
});

describe('stores', () => {
  it('sorts newest first and wraps Supabase tables', () => {
    expect(byNewest([{ created_at: '1' }, { created_at: '3' }, { created_at: '2' }, { created_at: '2' }]).map((r) => r.created_at)).toEqual(['3', '2', '2', '1']);
    const s = supabaseStores({} as AppClient);
    expect(s.saved).toBe(true);
    expect(memoryStores().saved).toBe(false);
  });
});

describe('check stores', () => {
  it('lists summaries of one shop, newest first, capped', async () => {
    const m = new MemoryCheckStore();
    const row = (id: string, shop: string, at: string): CheckRow => ({ id, shop_id: shop, created_at: at, verdict: 'pass', placement: 'inbox', subject: id, report: {} as CheckReport });
    await m.put(row('a', 's1', '1'));
    await m.put(row('b', 's1', '2'));
    await m.put(row('c', 's2', '3'));
    expect((await m.summaries('s1')).map((r) => r.id)).toEqual(['b', 'a']);
    expect(await m.summaries('s1', 1)).toEqual([{ id: 'b', shop_id: 's1', created_at: '2', verdict: 'pass', placement: 'inbox', subject: 'b' }]);
    await m.remove('b');
    expect((await m.get('a'))?.id).toBe('a');
  });
  it('asks Supabase for list columns of one shop only', async () => {
    const calls: unknown[][] = [];
    const chain = (result: unknown) => {
      const q: Record<string, (...a: unknown[]) => unknown> = {};
      for (const k of ['select', 'eq', 'order', 'limit']) q[k] = (...a: unknown[]) => (calls.push([k, ...a]), k === 'limit' ? Promise.resolve(result) : q);
      return q;
    };
    let result: unknown = { data: [{ id: 'x' }], error: null };
    const client = { from: (t: string) => (calls.push(['from', t]), chain(result)) } as unknown as AppClient;
    const store = new SupabaseCheckStore(client);
    expect(await store.summaries('s1')).toEqual([{ id: 'x' }]);
    expect(calls).toEqual([['from', 'checks'], ['select', 'id, shop_id, created_at, verdict, placement, subject'], ['eq', 'shop_id', 's1'], ['order', 'created_at', { ascending: false }], ['limit', HISTORY_LIMIT]]);
    result = { data: null, error: { message: 'denied' } };
    await expect(store.summaries('s1')).rejects.toThrow('checks: denied');
    result = { data: null, error: null };
    expect(await store.summaries('s1')).toEqual([]);
  });
});

describe('report', () => {
  const report: CheckReport = {
    analysis: {
      from: { name: '', address: 'a@b.example' },
      subject: 'S',
      sentAt: '',
      receivedAt: '',
      transitSeconds: 200,
      auth: { authServ: 'mx', spf: null, dkim: [], dmarc: null, signedBy: ['b.example'] },
      app: { id: 'unknown', name: 'Not recognised', because: '' },
      labelPlacement: null,
      listUnsubscribe: false,
      links: [],
    },
    placement: 'spam',
    link: { host: 'a', finalHost: 'b', status: 200, redirects: 1, contentType: '', fileName: '', size: 0, truncated: false, sha256: '', page: true, pageTitle: 'T', pageSaysExpired: false, error: '' },
    findings: [
      { id: 'ok1', severity: 'ok', title: 'fine', detail: 'd', fix: '' },
      { id: 'f1', severity: 'fail', title: 'bad', detail: 'd', fix: 'do it' },
    ],
  };
  it('puts problems first and shows details', () => {
    expect(sortFindings(report.findings).map((f) => f.id)).toEqual(['f1', 'ok1']);
    const el = renderReport(report, { verdict: 'fail', checkedAt: '2026-11-12T00:00:00Z' });
    expect(el.querySelector('.verdict')?.textContent).toBe('Buyers may not get their download');
    expect(el.querySelector('.summary')?.textContent).toMatch(/^1 thing to fix, checked/);
    expect(el.textContent).toContain('signed by b.example, result not recorded');
    expect(el.textContent).toContain('3 min');
    expect(el.textContent).toContain('after 1 redirect');
    expect(el.textContent).toContain('web page: T');
    expect(el.querySelector('.fix')?.textContent).toBe('Fix: do it');
  });
  it('words a clean report and a link error', () => {
    const el = renderReport({ ...report, findings: [], analysis: { ...report.analysis, auth: null, from: { name: 'N', address: 'a@b' }, transitSeconds: null }, link: { ...report.link!, error: 'boom', page: false, size: 10, truncated: true, sha256: 'f'.repeat(64), redirects: 2 } }, { verdict: 'pass' });
    expect(el.querySelector('.summary')?.textContent).toBe('Nothing to fix.');
    expect(el.textContent).toContain('N <a@b>');
    expect(el.textContent).toContain('boom');
    expect(el.textContent).toContain('(first part)');
    expect(el.textContent).toContain('after 2 redirects');
    const none = renderReport({ ...report, link: null, findings: [report.findings[1], { ...report.findings[1], id: 'f2' }] }, { verdict: 'fail' });
    expect(none.querySelector('.summary')?.textContent).toBe('2 things to fix.');
    expect(none.querySelectorAll('table')).toHaveLength(1);
  });
});

describe('link client', () => {
  it('tells same-origin links apart', () => {
    expect(sameOrigin(SAMPLE_URL, ORIGIN)).toBe(true);
    expect(sameOrigin('https://other.example/x', ORIGIN)).toBe(false);
    expect(sameOrigin('nope', ORIGIN)).toBe(false);
  });
  it('hashes a same-origin file in the browser', async () => {
    const r = await checkInBrowser(SAMPLE_URL, {
      fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf' } })) as unknown as typeof fetch,
      digest: async () => new Uint8Array(32).fill(255).buffer,
    });
    expect(r).toMatchObject({ status: 200, size: 3, sha256: 'f'.repeat(64), fileName: 'canary-pattern.pdf', page: false });
    const page = await checkInBrowser(SAMPLE_URL, { fetchImpl: (async () => new Response('<title>Gone</title>link has expired', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch, digest: async () => new ArrayBuffer(32) });
    expect(page).toMatchObject({ page: true, pageTitle: 'Gone', pageSaysExpired: true });
    const missing = await checkInBrowser(SAMPLE_URL, { fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch });
    expect(missing.status).toBe(404);
    const empty = await checkInBrowser(SAMPLE_URL, { fetchImpl: (async () => new Response(new Uint8Array(0), { status: 200 })) as unknown as typeof fetch });
    expect(empty).toMatchObject({ size: 0, sha256: '' });
    const broken = await checkInBrowser(SAMPLE_URL, { fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
    expect(broken.error).toMatch(/could not be read/);
  });
  it('calls the server with the token and reads its answers', async () => {
    let sent: RequestInit | undefined;
    const ok = await checkOnServer('https://f.example/a', 'tok', {
      apiBase: 'https://app',
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        sent = init;
        return new Response(JSON.stringify({ status: 200, size: 4, sha256: 'b'.repeat(64) }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect((sent?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(ok).toMatchObject({ url: 'https://f.example/a', size: 4 });
    await expect(checkOnServer('u', 't', { fetchImpl: (async () => new Response(JSON.stringify({ error: 'Too many' }), { status: 429 })) as unknown as typeof fetch })).rejects.toThrow('The link was not tested: Too many');
    await expect(checkOnServer('u', 't', { fetchImpl: (async () => new Response('oops', { status: 502 })) as unknown as typeof fetch })).rejects.toThrow('The link tester answered 502.');
    await expect(checkOnServer('u', 't', { fetchImpl: (async () => new Response('{"error":"Sign in"}', { status: 401 })) as unknown as typeof fetch })).rejects.toBeInstanceOf(NeedsSignIn);
    await expect(checkOnServer('u', 't', { fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch })).rejects.toBeInstanceOf(LinkTestSkipped);
  });
  it('routes by origin and needs sign-in for other sites', async () => {
    const fetchImpl = (async () => new Response(new Uint8Array([1]), { status: 200 })) as unknown as typeof fetch;
    const local = await checkLink(SAMPLE_URL, { origin: ORIGIN, token: async () => null, fetchImpl, digest: async () => new ArrayBuffer(32) });
    expect(local.size).toBe(1);
    await expect(checkLink('https://f.example/a', { origin: ORIGIN, token: async () => null })).rejects.toBeInstanceOf(NeedsSignIn);
    const remote = await checkLink('https://f.example/a', { origin: ORIGIN, token: async () => 'tok', fetchImpl: (async () => new Response('{"status":200}', { status: 200 })) as unknown as typeof fetch });
    expect(remote.status).toBe(200);
  });
});

describe('the app', () => {
  it('runs the sample signed out and keeps the check on the page', async () => {
    const tested: string[] = [];
    const { $, $$ } = setup({ checkLink: async (u) => (tested.push(u), goodFile(u)) });
    await tick();
    expect($('#history').textContent).toContain('until you leave the page');
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect(tested).toEqual([SAMPLE_URL]);
    expect($('.report .verdict').textContent).toBe('Works, with problems to fix');
    const ids = $$('.finding').map((li) => li.getAttribute('data-finding'));
    expect(ids).toEqual(expect.arrayContaining(['placement-promotions', 'dkim-unaligned', 'dmarc-none', 'link-ok', 'baseline-none']));
    expect($<HTMLInputElement>('input[value="promotions"]').checked).toBe(true);
    expect($<HTMLSelectElement>('#shop-app').value).toBe('shopify');
    expect($('.status').textContent).toBe('Checked. Sign in to keep this check.');
    expect($$('.history-list li')).toHaveLength(1);
    expect($('#save-note').textContent).toMatch(/Sign in/);
  });
  it('saves a baseline, then a changed file is flagged', async () => {
    let sha = 'a'.repeat(64);
    const stores = savedStores();
    const { $, $$ } = setup({ stores, checkLink: async (u) => goodFile(u, sha) });
    await tick();
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    $<HTMLButtonElement>('#set-baseline').click();
    await tick();
    expect($('.status').textContent).toBe('Checked and saved to your history.');
    expect($('#baseline-line').textContent).toContain('canary-pattern.pdf');
    expect($$('.finding').map((li) => li.getAttribute('data-finding'))).toContain('baseline-match');
    expect(await allChecks(stores)).toHaveLength(1); // re-evaluation updates the same check
    expect((await stores.shops.list())[0].baseline?.sha256).toBe(sha);
    sha = 'b'.repeat(64);
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect($$('.finding').map((li) => li.getAttribute('data-finding'))).toContain('baseline-differs');
    expect($('#set-baseline').textContent).toBe('Save this file as the new baseline');
    expect(await allChecks(stores)).toHaveLength(2);
  });
  it('checks a pasted email, with the placement given, and tests another link on request', async () => {
    const tested: string[] = [];
    const { $, $$ } = setup({ stores: savedStores(), checkLink: async (u) => (tested.push(u), u.includes('second') ? goodFile(u) : { ...emptyResult(u), status: 404 }) });
    await tick();
    const raw = 'From: Shop <hi@shop.example>\r\nSubject: Files\r\n\r\nDownload: https://files.example/download/first.pdf\r\nAlso download: https://files.example/download/second.zip\r\n';
    $<HTMLTextAreaElement>('#eml-paste').value = raw;
    $<HTMLInputElement>('input[value="spam"]').checked = true;
    $<HTMLFormElement>('#check-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect($('.report .verdict').textContent).toBe('Buyers may not get their download');
    expect($$('.finding').map((li) => li.getAttribute('data-finding'))).toEqual(expect.arrayContaining(['placement-spam', 'auth-missing', 'link-status']));
    const other = $$('.others button')[0] as HTMLButtonElement;
    expect(other.textContent).toContain('files.example');
    other.click();
    await tick();
    expect(tested).toHaveLength(2);
    expect($$('.finding').map((li) => li.getAttribute('data-finding'))).toContain('link-ok');
  });
  it('explains what to do with bad input', async () => {
    const { $ } = setup();
    await tick();
    $<HTMLFormElement>('#check-form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect($('.status').textContent).toMatch(/Choose the .eml file/);
    $<HTMLTextAreaElement>('#eml-paste').value = 'hello there';
    $<HTMLFormElement>('#check-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect($('.status').textContent).toMatch(/does not look like an email/);
  });
  it('reads an uploaded file', async () => {
    const { $ } = setup();
    await tick();
    const input = $<HTMLInputElement>('#eml-file');
    const bytes = new TextEncoder().encode(sampleEmail(SAMPLE_URL));
    const file = { name: 'order.eml', arrayBuffer: async () => bytes.buffer };
    Object.defineProperty(input, 'files', { value: [file] });
    $<HTMLFormElement>('#check-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(60);
    expect($('.report .verdict').textContent).toBe('Works, with problems to fix');
  });
  it('says when the link needs sign-in', async () => {
    const { $, $$ } = setup({ checkLink: async () => { throw new NeedsSignIn('Sign in to test real download links'); } });
    await tick();
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    const untested = $$('.finding').find((li) => li.getAttribute('data-finding') === 'link-untested');
    expect(untested?.textContent).toContain('Sign in to test real download links');
    const { $: $3, $$: $$3 } = setup({ checkLink: async () => { throw new LinkTestSkipped('The link was not tested: Too many'); } });
    await tick();
    $3<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect($$3('.finding').map((li) => li.getAttribute('data-finding'))).not.toContain('link-error');
    expect($$3('.finding').find((li) => li.getAttribute('data-finding') === 'link-untested')?.textContent).toContain('Too many');
    const { $: $2, $$: $$2 } = setup({ checkLink: async () => { throw new Error('x'); } });
    await tick();
    $2<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect($$2('.finding').find((li) => li.getAttribute('data-finding') === 'link-untested')?.textContent).toContain('could not run');
  });
  it('saves the shop, views and deletes history', async () => {
    const stores = savedStores();
    const { $, $$ } = setup({ stores });
    await tick();
    $<HTMLInputElement>('#shop-name').value = '  ';
    $<HTMLButtonElement>('#save-shop').click();
    await tick();
    expect($('.status').textContent).toBe('Give the shop a name first.');
    $<HTMLInputElement>('#shop-name').value = 'Juniper';
    $<HTMLSelectElement>('#shop-app').value = 'filemonk';
    $<HTMLButtonElement>('#save-shop').click();
    await tick();
    expect((await stores.shops.list())[0]).toMatchObject({ name: 'Juniper', delivery_app: 'filemonk' });
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect($<HTMLSelectElement>('#shop-app').value).toBe('filemonk'); // a chosen app is kept
    ($$('[data-view]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('.report .summary').textContent).toMatch(/checked/);
    ($$('[data-delete]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('.status').textContent).toBe('Check deleted.');
    expect(await allChecks(stores)).toHaveLength(0);
    expect($('#history').textContent).toContain('No checks yet');
  });
  it('reports store failures in plain words', async () => {
    const fail = { list: async () => { throw new Error('offline'); }, get: async () => undefined, put: async () => { throw new Error('denied'); }, remove: async () => { throw new Error('nope'); } };
    const stores: Stores = { shops: fail as unknown as Stores['shops'], checks: fail as unknown as Stores['checks'], scans: new MemoryScanStore(), seeds: new MemorySeedStore(), saved: true };
    const { $ } = setup({ stores });
    await tick();
    expect($('.status').textContent).toMatch(/Could not load your (shop|history): offline/);
    $<HTMLInputElement>('#shop-name').value = 'X';
    $<HTMLButtonElement>('#save-shop').click();
    await tick();
    expect($('.status').textContent).toBe('Could not save the shop: denied');
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect($('.status').textContent).toBe('Checked, but not saved: denied');
    $<HTMLButtonElement>('#set-baseline').click();
    await tick();
    expect($('.status').textContent).toBe('Could not save the baseline: denied');
  });
  it('reports a failed delete', async () => {
    const stores = savedStores();
    const { $, $$ } = setup({ stores });
    await tick();
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    stores.checks.remove = async () => {
      throw new Error('nope');
    };
    ($$('[data-delete]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('.status').textContent).toBe('Could not delete: nope');
  });
  it('switches stores when the user signs in', async () => {
    let switchTo: ((s: Stores) => void) | null = null;
    const saved = savedStores();
    await saved.shops.put({ id: 's1', name: 'Saved shop', delivery_app: 'sendowl', baseline: null, created_at: '2026-11-01T00:00:00Z' });
    const { $ } = setup({ mountAuth: (el, cb) => { el.textContent = 'panel'; switchTo = cb; } });
    await tick();
    expect($('#signin').textContent).toBe('panel');
    switchTo!(saved);
    await tick();
    expect($<HTMLInputElement>('#shop-name').value).toBe('Saved shop');
    expect($('#save-note').textContent).toBe('Saved to your account.');
    expect($('#history').textContent).toContain('No checks yet');
  });
  it('says when a saved check cannot be opened, and caps the list', async () => {
    const stores = savedStores();
    const { $, $$ } = setup({ stores });
    await tick();
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    stores.checks.get = async () => undefined;
    ($$('[data-view]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('.status').textContent).toBe('That check is no longer saved.');
    stores.checks.get = async () => {
      throw new Error('offline');
    };
    ($$('[data-view]')[0] as HTMLButtonElement).click();
    await tick();
    expect($('.status').textContent).toBe('Could not open the check: offline');
    const shop = (await stores.shops.list())[0];
    for (let i = 0; i < HISTORY_LIMIT; i++) await stores.checks.put({ id: `x${i}`, shop_id: shop.id, created_at: `2026-11-13T00:00:${String(i).padStart(2, '0')}Z`, verdict: 'pass', placement: 'inbox', subject: 's', report: {} as CheckReport });
    $<HTMLButtonElement>('#run-sample').click();
    await tick();
    expect($$('.history-list li')).toHaveLength(HISTORY_LIMIT);
    expect($('#history').textContent).toContain(`Showing the latest ${HISTORY_LIMIT} checks.`);
  });
  it('shows the preview note without sign-in', async () => {
    const { $ } = setup();
    expect($('#signin').textContent).toContain('Preview');
  });
});
