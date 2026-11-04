// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoFeed, demoFetcher } from '../src/core/demo';
import type { KeyValue } from '../src/core/history';
import { mount, parseDays, type Deps } from '../src/ui/app';
import { remoteFetcher } from '../src/ui/remote';

function memory(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A fake checker server that answers from the sample shop, as the real one answers for a real store. */
function fakeServer(mode: 'ok' | 'bad' | 'down' | 'broken' = 'ok') {
  const shop = demoFetcher();
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    if (mode === 'down') throw new TypeError('offline');
    if (mode === 'bad') return new Response(JSON.stringify({ error: 'Only pages of the store you entered can be read.' }), { status: 400 });
    if (mode === 'broken') return new Response('oops', { status: 502 });
    const body = JSON.parse(String(init?.body));
    expect(body.consent).toBe(true);
    if (String(url).endsWith('/robots')) return new Response(JSON.stringify({ robots: await shop.robots('') }));
    return new Response(JSON.stringify({ page: await shop.page(body.url) }));
  });
}

let root: HTMLElement;
let clock: number;
function setup(extra: Deps = {}) {
  clock = Date.parse('2026-11-04T08:00:00Z');
  return mount(root, { storage: memory(), demoDelayMs: 0, siteDelayMs: 0, now: () => new Date((clock += 60_000)), readFile: async () => demoFeed(), print: vi.fn(), ...extra });
}
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const $$ = (sel: string) => [...root.querySelectorAll(sel)];

function fill(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) $<HTMLInputElement>(`#f-${k}`).value = v;
}
function attachFeed(size = 100) {
  const file = new File(['x'], 'feed.tsv');
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty($<HTMLInputElement>('#f-feed'), 'files', { value: [file], configurable: true });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app') as HTMLElement;
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('page', () => {
  it('shows the pitch, the sample shop, the form and an empty log', () => {
    setup();
    expect($('h1').textContent).toBe('Misrepresentation Preflight');
    expect($('#demo').textContent).toBe('Try the sample store');
    expect($<HTMLButtonElement>('#demo-fixed').hidden).toBe(true);
    expect($('#results').hidden).toBe(true);
    expect($('#log').textContent).toContain('stays in this browser');
    expect($$('label[for]').every((l) => root.querySelector(`#${l.getAttribute('for')}`))).toBe(true);
  });
  it('says when the browser cannot keep a log', () => {
    setup({ storage: null });
    expect($('#log').textContent).toContain('re-check log is off');
  });
});

describe('sample shop', () => {
  it('runs the check, then the re-check shows what was fixed', async () => {
    const app = setup();
    await app.runDemo();
    expect($('#results').hidden).toBe(false);
    expect($('#summary').textContent).toBe('13 pages read. 9 to fix first, 5 to fix soon, 0 worth a look.');
    expect($$('.finding')).toHaveLength(14);
    expect($('.finding h4').textContent).toBe('Your return window is stated as 14 and 30 days on different pages');
    expect($('.finding .evidence q').textContent).toContain('30-day return policy');
    // Sample-shop addresses are not links (the shop does not exist).
    expect($$('.evidence a')).toHaveLength(0);
    expect($('details.facts summary').textContent).toBe('What each page says (13 pages)');
    expect($('details.not-read').textContent).toContain('/products/old-pine-candle');
    expect(document.activeElement?.id).toBe('results-title');
    expect($<HTMLButtonElement>('#demo-fixed').hidden).toBe(false);

    await app.runDemo(true);
    expect($('#diff').textContent).toContain('13 fixed, 0 new, 1 still open.');
    expect($('#summary').textContent).toContain('0 to fix first, 1 to fix soon');
    expect(app.log).toHaveLength(2);
    expect($$('#log tbody tr')).toHaveLength(2);
  });
  it('downloads the report and prints', async () => {
    const print = vi.fn();
    const app = setup({ print });
    await app.runDemo();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    $('#download-report').click();
    expect(click).toHaveBeenCalled();
    expect((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Blob);
    $('#print').click();
    expect(print).toHaveBeenCalled();
    $('#download-log').click();
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });
  it('keeps notes, removes and clears log entries', async () => {
    const storage = memory();
    const app = setup({ storage });
    await app.runDemo();
    await app.runDemo(true);
    const note = $<HTMLInputElement>('#log input.note');
    note.value = 'Fixed the FAQ';
    note.dispatchEvent(new Event('change'));
    expect(app.log[1].note).toBe('Fixed the FAQ');
    expect(storage.getItem('misrepresentation-preflight.log.v1')).toContain('Fixed the FAQ');
    ($$('#log button.link')[0] as HTMLButtonElement).click();
    expect(app.log).toHaveLength(1);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    $('#clear-log').click();
    expect(app.log).toHaveLength(1);
    $('#clear-log').click();
    expect(app.log).toHaveLength(0);
    expect($('#log').textContent).toContain('Every check you run is listed here');
    confirm.mockRestore();
  });
  it('ignores a second click while a check runs', async () => {
    const app = setup();
    const first = app.runDemo();
    expect(await app.runDemo()).toBeNull();
    expect(await app.runSite()).toBeNull();
    expect($<HTMLButtonElement>('#check').disabled).toBe(true);
    await first;
    expect($<HTMLButtonElement>('#check').disabled).toBe(false);
  });
});

describe('real store form', () => {
  it('checks the form before calling the server', async () => {
    const fetchImpl = fakeServer();
    const app = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await app.runSite()).toBeNull();
    expect($('#form-error').textContent).toBe('Enter your store’s web address.');
    fill({ site: 'fernhill-candles.example' });
    await app.runSite();
    expect($('#form-error').textContent).toMatch(/Tick the box/);
    $<HTMLInputElement>('#f-consent').checked = true;
    fill({ returnDays: 'thirty' });
    await app.runSite();
    expect($('#form-error').textContent).toMatch(/Return window/);
    fill({ returnDays: '', handlingDays: '5-2' });
    await app.runSite();
    expect($('#form-error').textContent).toMatch(/second number/);
    fill({ handlingDays: '' });
    attachFeed(25 * 1024 * 1024);
    await app.runSite();
    expect($('#form-error').textContent).toMatch(/larger than 20 MB/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('runs through the server with the feed and Merchant Center details', async () => {
    const fetchImpl = fakeServer();
    const app = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    fill({ site: 'https://fernhill-candles.example/shop', businessName: 'Totally Other Name', phone: '(828) 555-0147', email: 'hello@fernhill-candles.example', postcode: '28801', returnDays: '30', handlingDays: '1-2', transitDays: '3 to 5' });
    $<HTMLInputElement>('#f-consent').checked = true;
    attachFeed();
    const r = await app.runSite();
    expect(r?.findings.map((f) => f.id)).toContain('contact:mc-name');
    expect(r?.findings.map((f) => f.id)).toContain('feed:broken-links');
    expect(r?.feed?.items).toBe(5);
    expect($('#results').textContent).toContain('Product feed: 5 products read.');
    expect($$('.evidence a.where').length).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/robots');
  });
  it('shows server and network problems next to the form', async () => {
    for (const [mode, message] of [['bad', 'Only pages of the store you entered can be read.'], ['down', /could not be reached/], ['broken', /HTTP 502/]] as const) {
      document.body.innerHTML = '<div id="app"></div>';
      root = document.getElementById('app') as HTMLElement;
      const app = setup({ fetchImpl: fakeServer(mode) as unknown as typeof fetch });
      fill({ site: 'shop.com' });
      $<HTMLInputElement>('#f-consent').checked = true;
      expect(await app.runSite()).toBeNull();
      expect($('#form-error').textContent).toMatch(message);
      expect($('#progress').hidden).toBe(true);
    }
  });
  it('submits from the form and the demo button', async () => {
    const app = setup({ fetchImpl: fakeServer() as unknown as typeof fetch });
    $('#site-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect($('#form-error').textContent).toBe('Enter your store’s web address.');
    $('#demo').click();
    await vi.waitFor(() => expect(app.log).toHaveLength(1));
    $('#demo-fixed').click();
    await vi.waitFor(() => expect(app.log).toHaveLength(2));
  });
});

describe('helpers', () => {
  it('parses day ranges', () => {
    expect(parseDays('', 'x')).toBeUndefined();
    expect(parseDays('3', 'x')).toEqual({ min: 3, max: 3, business: true });
    expect(parseDays('3–5', 'x')).toEqual({ min: 3, max: 5, business: true });
    expect(() => parseDays('soon', 'Handling')).toThrow(/Handling: enter a number/);
  });
  it('the remote fetcher copes with odd answers', async () => {
    const odd = vi.fn(async () => new Response(JSON.stringify({ robots: 5, page: null })));
    const f = remoteFetcher(odd as unknown as typeof fetch, 'https://s.com/');
    expect(await f.robots('https://s.com/')).toBeNull();
    expect(await f.page('https://s.com/x')).toEqual({ url: 'https://s.com/x', error: 'The checker service sent an empty answer.' });
    const bad = vi.fn(async () => new Response('nope', { status: 400 }));
    await expect(remoteFetcher(bad as unknown as typeof fetch, 'https://s.com/').robots('')).rejects.toThrow('The checker could not use that address.');
  });
});
