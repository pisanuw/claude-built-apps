// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoAcademy } from '../src/core/demo';
import type { KeyValue } from '../src/core/history';
import { runStep } from '../src/core/steps';
import type { StepId } from '../src/core/types';
import { mount, type Deps } from '../src/ui/app';
import { remoteRunner } from '../src/ui/remote';

function memory(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A fake /api/step that runs the demo academy, as the real server would run a real site. */
function fakeServer(status = 200) {
  const academy = demoAcademy();
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    if (status !== 200) return new Response(JSON.stringify({ error: 'Nope from server.' }), { status });
    const out = await runStep(req.step as StepId, { ...req.config, siteUrl: 'https://lotus-yoga-academy.example' }, req.state, academy);
    return new Response(JSON.stringify(out), { status: 200 });
  });
}

let root: HTMLElement;
let clock: number;
function setup(extra: Deps = {}) {
  clock = Date.parse('2026-11-03T08:00:00Z');
  return mount(root, { storage: memory(), demoDelayMs: 0, now: () => new Date((clock += 30_000)), copy: async () => undefined, ...extra });
}
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const $$ = (sel: string) => [...root.querySelectorAll(sel)];
const flush = () => new Promise((r) => setTimeout(r, 0));

function fill(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) $<HTMLInputElement>(`#f-${k}`).value = v;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app') as HTMLElement;
});

describe('page', () => {
  it('shows the pitch, the demo first and the limits', () => {
    setup();
    expect($('h1').textContent).toBe('Student Journey Check');
    expect($('#panel-demo').hidden).toBe(false);
    expect($('#panel-site').hidden).toBe(true);
    expect($$('.break input')).toHaveLength(7);
    expect($('.limits').textContent).toContain('cannot see');
  });
  it('switches tabs by click and arrow keys', () => {
    setup();
    $('#tab-site').click();
    expect($('#panel-site').hidden).toBe(false);
    expect($('#tab-site').getAttribute('aria-selected')).toBe('true');
    $('#tab-site').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect($('#panel-demo').hidden).toBe(false);
    $('#tab-demo').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect($('#panel-site').hidden).toBe(false);
    $('#tab-site').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect($('#panel-site').hidden).toBe(false);
  });
});

describe('demo', () => {
  it('walks the demo with the chosen breakages and shows the result', async () => {
    const app = setup();
    $<HTMLInputElement>('#break-video').checked = true;
    $<HTMLButtonElement>('#panel-demo button.primary').click();
    await vi.waitFor(() => expect(app.runs).toHaveLength(1));
    expect($('.summary').className).toContain('bad');
    expect($('.summary .big').textContent).toBe('1 step would stop your students. First: lesson and video.');
    expect($$('.step.fail')).toHaveLength(1);
    expect($('.step.fail .advice').textContent).toContain('no-referrer');
    expect($('pre.mail').textContent).toContain('Subject: lotus-yoga-academy.example: lesson and video is broken for students');
    expect($('.history tbody').children).toHaveLength(1);
  });
  it('shows what changed since the last run, and clears history', async () => {
    const app = setup();
    await app.runDemo([]);
    await app.runDemo(['nonce']);
    expect($('.changes').textContent).toContain('New problem: certificate page');
    expect($('.history tbody').children).toHaveLength(2);
    $<HTMLButtonElement>('.history button.link').click();
    expect($('.history').children).toHaveLength(0);
    expect(app.runs).toEqual([]);
  });
  it('copies the alert email and offers a download', async () => {
    const copy = vi.fn(async () => undefined);
    const app = setup({ copy });
    await app.runDemo(['popup']);
    const [copyBtn, saveBtn] = $$('.actions button') as HTMLButtonElement[];
    copyBtn.click();
    await flush();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Subject: '));
    expect(copyBtn.textContent).toBe('Copied');
    const created = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    saveBtn.click();
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
    expect(created).toHaveBeenCalled();
  });
  it('says so when copying fails', async () => {
    const app = setup({ copy: async () => Promise.reject(new Error('denied')) });
    await app.runDemo([]);
    const copyBtn = $$('.actions button')[0] as HTMLButtonElement;
    copyBtn.click();
    await flush();
    expect(copyBtn.textContent).toContain('Copy failed');
  });
  it('pauses between demo steps when asked', async () => {
    const app = setup({ demoDelayMs: 1 });
    const run = await app.runDemo([]);
    expect(run.results).toHaveLength(8);
  });
});

describe('own site', () => {
  const good = { siteUrl: 'lotus-yoga-academy.example', username: 'maya.test', password: 'stretch-daily-7', coursePath: '/courses/morning-flow/', expectedPrice: '$79.00' };

  it('validates the form before calling the server', async () => {
    const fetchImpl = fakeServer();
    const app = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const submit = () => $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
    submit();
    expect($('.form-error').textContent).toContain('permission');
    $<HTMLInputElement>('#f-consent').checked = true;
    submit();
    await flush();
    expect($('.form-error').textContent).toBe('Enter your course site address.');
    expect(await app.runSite({ siteUrl: 'a.com', username: '', coursePath: '' })).toBeNull();
    expect($('.form-error').textContent).toContain('username');
    expect(await app.runSite({ siteUrl: 'a.com', username: 'u', coursePath: '' })).toBeNull();
    expect($('.form-error').textContent).toContain('password');
    expect(await app.runSite({ siteUrl: 'a.com', username: 'u', password: 'p', coursePath: '' })).toBeNull();
    expect($('.form-error').textContent).toContain('course');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('warns about an admin login', () => {
    setup();
    const u = $<HTMLInputElement>('#f-username');
    u.value = 'admin';
    u.dispatchEvent(new Event('input'));
    expect($('.warn-note').hidden).toBe(false);
    u.value = 'maya';
    u.dispatchEvent(new Event('input'));
    expect($('.warn-note').hidden).toBe(true);
  });

  it('runs every step through the server and remembers settings without the password', async () => {
    const fetchImpl = fakeServer();
    const storage = memory();
    const app = setup({ fetchImpl: fetchImpl as unknown as typeof fetch, storage });
    fill(good);
    $<HTMLInputElement>('#f-consent').checked = true;
    $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(app.runs).toHaveLength(1));
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies.filter((b) => b.config.password).map((b) => b.step)).toEqual(['login']);
    expect($('.summary .big').textContent).toBe('All 6 checked steps work for students.');
    expect($$('.step.skip')).toHaveLength(2);
    expect(storage.getItem('sjc.settings.v1')).toContain('maya.test');
    expect(storage.getItem('sjc.settings.v1')).not.toContain('stretch');
    // A fresh page fills the form from the saved settings, password left empty.
    mount(root, { storage });
    expect($<HTMLInputElement>('#f-siteUrl').value).toBe('https://lotus-yoga-academy.example');
    expect($<HTMLInputElement>('#f-password').value).toBe('');
  });

  it('shows the server’s reason for a bad request next to the form', async () => {
    const app = setup({ fetchImpl: fakeServer(400) as unknown as typeof fetch });
    expect(await app.runSite({ ...good })).toBeNull();
    expect($('.form-error').textContent).toBe('Nope from server.');
    expect($('#results').children).toHaveLength(0);
  });

  it('turns server trouble into failed steps', async () => {
    const app = setup({ fetchImpl: fakeServer(502) as unknown as typeof fetch });
    const run = await app.runSite({ ...good });
    expect(run?.results.every((r) => r.status === 'fail' && r.headline.includes('HTTP 502'))).toBe(true);
  });

  it('ignores a second run while one is going', async () => {
    let release: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<Response>((r) => (release = () => r(new Response('{}', { status: 500 })))));
    const app = setup({ fetchImpl: slow as unknown as typeof fetch });
    const first = app.runSite({ ...good });
    expect(await app.runSite({ ...good })).toBeNull();
    for (let i = 0; i < 8; i++) {
      release();
      await flush();
    }
    await first;
  });

  it('rethrows unexpected errors', async () => {
    const app = setup({ fetchImpl: fakeServer() as unknown as typeof fetch, storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    const orig = Element.prototype.replaceWith;
    Element.prototype.replaceWith = () => {
      throw new Error('dom broke');
    };
    await expect(app.runSite({ ...good })).rejects.toThrow('dom broke');
    Element.prototype.replaceWith = orig;
  });
});

describe('remoteRunner', () => {
  it('reports an unreachable service and unreadable replies as failed steps', async () => {
    const down = remoteRunner((async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch);
    const out = await down('home', { siteUrl: 'a.com', username: '', coursePath: '' }, { cookies: [], loggedIn: false });
    expect(out.result.headline).toContain('could not be reached');
    const garbage = remoteRunner((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch);
    expect((await garbage('home', { siteUrl: 'a.com', username: '', coursePath: '' }, { cookies: [], loggedIn: false })).result.headline).toContain('HTTP 200');
    const vague = remoteRunner((async () => new Response('{}', { status: 400 })) as unknown as typeof fetch);
    await expect(vague('home', { siteUrl: 'a.com', username: '', coursePath: '' }, { cookies: [], loggedIn: false })).rejects.toThrow('could not read those settings');
  });
  it('falls back to the browser defaults when no deps are given', () => {
    const app = mount(root);
    expect(app.runs).toEqual([]);
  });
});
