// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { evaluate, toReport } from '../src/core/findings';
import { emptyResult } from '../src/core/linkcheck';
import { sampleEmail } from '../src/core/sample';
import type { LinkResult } from '../src/core/types';
import { InMemoryRepository } from '../src/lib/repository';
import type { AppClient } from '../src/lib/supabase';
import { MemoryCheckStore, MemoryScanStore, MemorySeedStore, SupabaseSeedStore, type CheckRow, type SeedInboxRow, type ShopRow, type Stores } from '../src/store/stores';
import { mountApp, type AppDeps } from '../src/ui/app';
import { renderReport } from '../src/ui/report';
import { OUTCOME_TEXT } from '../src/ui/seed';
import { checkSeedInbox, parseSeedResponse, SeedCheckFailed, seedKeepAvailable, type SeedRequest, type SeedResponse } from '../src/ui/seedclient';

const ORIGIN = 'https://delivery-canary.test';
const goodFile = (url: string): LinkResult => ({ ...emptyResult(url), status: 200, contentType: 'application/pdf', fileName: 'canary-pattern.pdf', size: 685, sha256: 'a'.repeat(64) });
const tick = async (n = 40) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const RAW = sampleEmail('https://files.juniperstitch.example/d/abc/pattern.pdf');
const rawBuffer = () => new TextEncoder().encode(RAW).buffer as ArrayBuffer;

function savedStores(seeds = new MemorySeedStore()): Stores {
  return { shops: new InMemoryRepository<ShopRow>(), checks: new MemoryCheckStore(), scans: new MemoryScanStore(), seeds, saved: true };
}

function setup(opts: { stores?: Stores; check?: (req: SeedRequest, token: string) => Promise<SeedResponse>; keep?: boolean; token?: string | null; noSeed?: boolean } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const requests: SeedRequest[] = [];
  const stores = opts.stores ?? savedStores();
  const deps: AppDeps = {
    stores,
    checkLink: async (url) => goodFile(url),
    origin: ORIGIN,
    basePath: '/',
    now: () => new Date('2026-11-14T12:00:00Z'),
    seed: opts.noSeed
      ? undefined
      : {
          token: async () => (opts.token === undefined ? 'tok' : opts.token),
          keepAvailable: async () => opts.keep ?? true,
          check: async (req, token) => {
            requests.push(req);
            if (opts.check) return opts.check(req, token);
            return { found: true, where: 'updates', placement: 'other', receivedAt: '2026-11-14T09:12:40.000Z', labels: [], truncated: false, raw: rawBuffer(), kept: req.remember, saved: true };
          },
        },
  };
  mountApp(root, deps);
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  const fill = (vals: Partial<Record<'address' | 'sender' | 'subject' | 'password', string>>) => {
    for (const [k, v] of Object.entries(vals)) $<HTMLInputElement>(`#seed-${k}`).value = v;
  };
  const submit = () => $<HTMLFormElement>('#seed-form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { root, $, fill, submit, requests, stores };
}

describe('seed inbox card, signed out', () => {
  it('explains the setup and runs the sample as found in Promotions', async () => {
    const t = setup({ stores: { ...savedStores(), saved: false }, noSeed: true });
    await tick();
    expect(t.$('#seed-form').hidden).toBe(true);
    expect(t.$('#seed-signin-note').hidden).toBe(false);
    t.$('#seed-sample').click();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/Promotions tab/);
    expect(t.$('[data-finding="placement-promotions"]')).not.toBeNull();
    expect(t.$('#result').textContent).toContain('seed inbox: the Promotions tab');
  });
});

describe('seed inbox card, signed in', () => {
  it('asks for each missing field first', async () => {
    const t = setup();
    await tick();
    expect(t.$('#seed-form').hidden).toBe(false);
    expect(t.$('#seed-sample').hidden).toBe(true);
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/seed Gmail address/);
    t.fill({ address: 'canary@gmail.com' });
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/come from/);
    t.fill({ sender: 'hello@juniperstitch.example' });
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/Paste the app password/);
    expect(t.requests).toEqual([]);
  });

  it('checks the seed inbox, runs the email check with Gmail\'s placement and saves it', async () => {
    const t = setup();
    await tick();
    t.fill({ address: 'canary@gmail.com', sender: 'hello@juniperstitch.example', subject: 'pattern', password: 'abcd efgh ijkl mnop' });
    t.$<HTMLInputElement>('#seed-remember').checked = true;
    t.submit();
    await tick();
    expect(t.requests[0]).toMatchObject({ address: 'canary@gmail.com', sender: 'hello@juniperstitch.example', subject: 'pattern', password: 'abcd efgh ijkl mnop', remember: true });
    expect(t.requests[0].shopId).toMatch(/[0-9a-f-]{36}/);
    expect(t.$('#seed-status').textContent).toMatch(/the Updates tab/);
    expect(t.$('#seed-status').textContent).toMatch(/kept, encrypted/);
    expect(t.$<HTMLInputElement>('#seed-password').value).toBe('');
    const finding = t.$('[data-finding="placement-other"]');
    expect(finding.textContent).toContain('the Updates tab');
    const shops = await t.stores.shops.list();
    const saved = await t.stores.checks.summaries(shops[0].id);
    expect(saved[0].placement).toBe('other');
    const full = (await t.stores.checks.get(saved[0].id)) as CheckRow;
    expect(full.report.seed).toEqual({ where: 'updates', receivedAt: '2026-11-14T09:12:40.000Z' });
    // The form's placement choice is left alone.
    expect(t.$<HTMLInputElement>('input[name="placement"][value="unknown"]').checked).toBe(true);
  });

  it('says when nothing was found, and shows server errors in plain words', async () => {
    let answer: () => Promise<SeedResponse> = async () => ({ found: false, kept: false, saved: false });
    const t = setup({ check: () => answer() });
    await tick();
    t.fill({ address: 'canary@gmail.com', sender: 'shop.example', password: 'abcdabcdabcdabcd' });
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/No email from shop.example in the last 14 days.*could not be saved/);
    answer = async () => {
      throw new SeedCheckFailed('Gmail did not accept this address and app password.', 'login-failed', 422);
    };
    t.fill({ password: 'abcdabcdabcdabcd' });
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toBe('Gmail did not accept this address and app password.');
    answer = async () => {
      throw new SeedCheckFailed('No app password is kept for this shop. Paste it to check.', 'no-password', 400);
    };
    t.fill({ password: 'abcdabcdabcdabcd' });
    t.submit();
    await tick();
    expect(document.activeElement?.id).toBe('seed-password');
    answer = async () => {
      throw new Error('weird');
    };
    t.fill({ password: 'abcdabcdabcdabcd' });
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/could not run/);
  });

  it('needs a session token', async () => {
    const t = setup({ token: null });
    await tick();
    t.fill({ address: 'canary@gmail.com', sender: 'shop.example', password: 'abcdabcdabcdabcd' });
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/Sign in/);
  });

  it('shows the saved inbox, uses its kept password, and forgets it', async () => {
    const seeds = new MemorySeedStore();
    const stores = savedStores(seeds);
    const shop = await stores.shops.put({ id: 's1', name: 'Juniper', delivery_app: 'unknown', baseline: null, created_at: '2026-11-01T00:00:00Z' });
    const row: SeedInboxRow = { shop_id: shop.id, address: 'canary@gmail.com', sender: 'shop.example', subject_hint: 'pattern', has_secret: true, last_checked_at: '2026-11-13T10:00:00Z', last_outcome: 'not-found' };
    seeds.rows.set(shop.id, row);
    const t = setup({ stores });
    await tick();
    expect(t.$<HTMLInputElement>('#seed-address').value).toBe('canary@gmail.com');
    expect(t.$<HTMLInputElement>('#seed-subject').value).toBe('pattern');
    expect(t.$('#seed-password-hint').textContent).toMatch(/leave this empty/);
    expect(t.$<HTMLInputElement>('#seed-remember').checked).toBe(true);
    expect(t.$('#seed-last').textContent).toContain(OUTCOME_TEXT['not-found']);
    t.submit();
    await tick();
    expect(t.requests[0]).toMatchObject({ shopId: 's1', password: '', remember: true });
    t.$('#seed-forget').click();
    await tick();
    expect(seeds.rows.size).toBe(0);
    expect(t.$('#seed-status').textContent).toMatch(/forgotten/);
    expect(t.$('#seed-forget').hidden).toBe(true);
  });

  it('turns keeping off when the server cannot keep passwords, and reports store errors', async () => {
    const seeds = new MemorySeedStore();
    seeds.get = async () => {
      throw new Error('denied');
    };
    seeds.remove = async () => {
      throw new Error('nope');
    };
    const stores = savedStores(seeds);
    await stores.shops.put({ id: 's1', name: 'J', delivery_app: 'unknown', baseline: null, created_at: '2026-11-01T00:00:00Z' });
    const t = setup({ stores, keep: false });
    await tick();
    expect(t.$<HTMLInputElement>('#seed-remember').disabled).toBe(true);
    expect(t.$('#seed-status').textContent).toMatch(/Could not load the seed inbox: denied/);
    t.fill({ address: 'canary@gmail.com', sender: 'shop.example', password: 'abcdabcdabcdabcd' });
    t.$<HTMLInputElement>('#seed-remember').checked = true;
    t.submit();
    await tick();
    expect(t.requests[0].remember).toBe(false);
  });

  it('suggests the sender of the last checked email', async () => {
    const t = setup();
    await tick();
    t.$('#run-sample').click();
    await tick();
    // The card re-renders on refresh; an empty sender takes the suggestion.
    t.fill({ sender: '' });
    t.$<HTMLInputElement>('#seed-address').value = '';
    t.submit();
    await tick();
    expect(t.$('#seed-status').textContent).toMatch(/seed Gmail address/);
  });
});

describe('seed client', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const req: SeedRequest = { shopId: 's', address: 'a@gmail.com', sender: 'b.example', subject: '', password: 'p', remember: false };
  it('posts with the token and decodes the message', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ found: true, where: 'spam', placement: 'spam', receivedAt: 'x', labels: ['L', 3], raw: btoa('hi'), kept: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await checkSeedInbox(req, 'tok', { fetchImpl });
    expect((seen?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(r).toMatchObject({ found: true, where: 'spam', labels: ['L'], saved: true });
    expect(new TextDecoder().decode((r as { raw: ArrayBuffer }).raw)).toBe('hi');
  });
  it('turns errors into SeedCheckFailed', async () => {
    await expect(checkSeedInbox(req, 't', { fetchImpl: ok({ error: 'nope', outcome: 'login-failed' }, 422) })).rejects.toMatchObject({ message: 'nope', outcome: 'login-failed', status: 422 });
    await expect(checkSeedInbox(req, 't', { fetchImpl: ok('x', 500) })).rejects.toMatchObject({ message: /answered 500/, outcome: '500' });
    await expect(checkSeedInbox(req, 't', { fetchImpl: (async () => new Response('not json', { status: 502 })) as unknown as typeof fetch })).rejects.toMatchObject({ outcome: '502' });
    await expect(checkSeedInbox(req, 't', { fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch })).rejects.toMatchObject({ outcome: 'offline' });
  });
  it('refuses malformed answers and reads not-found', () => {
    expect(parseSeedResponse({ found: false, kept: true, saved: false })).toEqual({ found: false, kept: true, saved: false });
    expect(() => parseSeedResponse(null)).toThrow(SeedCheckFailed);
    expect(() => parseSeedResponse({ found: true, raw: 'x', where: 'attic' })).toThrow(/cannot read/);
    expect(() => parseSeedResponse({ found: true, raw: '***', where: 'spam' })).toThrow(/cannot read/);
    expect(parseSeedResponse({ found: true, raw: '', where: 'primary', placement: 'nowhere' })).toMatchObject({ placement: 'unknown', receivedAt: '', labels: [], truncated: false });
  });
  it('asks the server whether it keeps passwords', async () => {
    expect(await seedKeepAvailable({ fetchImpl: ok({ seedKeep: true }) })).toBe(true);
    expect(await seedKeepAvailable({ fetchImpl: ok({ seedKeep: false }) })).toBe(false);
    expect(await seedKeepAvailable({ fetchImpl: ok({}, 500) })).toBe(false);
    expect(await seedKeepAvailable({ fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch })).toBe(false);
  });
});

describe('seed store and report', () => {
  it('reads seed inboxes from Supabase without the sealed password, and deletes', async () => {
    const calls: unknown[][] = [];
    let result: unknown = { data: { shop_id: 's1' }, error: null };
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of ['select', 'eq', 'maybeSingle', 'delete']) q[k] = (...a: unknown[]) => (calls.push([k, ...a]), q);
    q.then = (res: unknown) => (res as (v: unknown) => unknown)(result);
    const store = new SupabaseSeedStore({ from: (t: string) => (calls.push(['from', t]), q) } as unknown as AppClient);
    expect(await store.get('s1')).toEqual({ shop_id: 's1' });
    expect(calls[1]).toEqual(['select', 'shop_id, address, sender, subject_hint, has_secret, last_checked_at, last_outcome']);
    expect(String(calls[1][1]).split(', ')).not.toContain('secret');
    await store.remove('s1');
    expect(calls.slice(-3)).toEqual([['from', 'seed_inboxes'], ['delete'], ['eq', 'shop_id', 's1']]);
    result = { data: null, error: null };
    expect(await store.get('s1')).toBeUndefined();
    result = { data: null, error: { message: 'denied' } };
    await expect(store.get('s1')).rejects.toThrow('seed_inboxes: denied');
    await expect(store.remove('s1')).rejects.toThrow('seed_inboxes: denied');
  });
  it('names the archived case and renders the seed placement', async () => {
    const { analyseEmail } = await import('../src/core/email');
    const analysis = await analyseEmail(RAW);
    const input = { analysis, placement: 'other' as const, link: null, baseline: null, seed: { where: 'archived' as const, receivedAt: '' } };
    const findings = evaluate(input);
    expect(findings[0].detail).toContain('outside the inbox');
    expect(findings[0].fix).toMatch(/filter/);
    const el = renderReport(toReport(input, findings), { verdict: 'warn' });
    expect(el.textContent).toContain('Other folder (seed inbox: All Mail, outside the inbox');
    const plain = toReport({ ...input, seed: null }, evaluate({ ...input, seed: null }));
    expect(plain.seed).toBeUndefined();
  });
});
