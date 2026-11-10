// @vitest-environment jsdom
// Regression tests for the day-2 review findings.
import { beforeEach, describe, expect, it } from 'vitest';
import { newClientFile } from '../src/core/clientFile';
import { decodeFile, encodeFile } from '../src/core/codec';
import { parseCsv } from '../src/core/csv';
import { ssnColumns } from '../src/core/importer';
import { Files, LOCAL_INDEX, LocalFileStore, MemoryFileStore, type KeyValue } from '../src/store/stores';
import { mountApp, type AuthHooks } from '../src/ui/app';
import { uuid } from '../src/ui/dom';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 25; i++) await tick();
};
let root: HTMLElement;
const status = () => root.querySelector('p.status')?.textContent;
const CSV = 'Employee,Date,Hours,Rate\nPat,2026-11-02,45,20\n';

function button(label: string): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? x.textContent) === label || x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b as HTMLButtonElement;
}

async function importCsv(text = CSV, wait = true) {
  const input = root.querySelector('#hours-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'a.csv')] });
  input.dispatchEvent(new Event('change'));
  if (wait) await settle();
}

function auth(account: MemoryFileStore) {
  let cb: (u: { id: string; email: string | null } | null) => void = () => {};
  const hooks: AuthHooks = { mount: () => {}, onUser: (c) => (cb = c), accountStore: () => account };
  return { hooks, as: async (id: string | null) => (cb(id ? { id, email: `${id}@x.org` } : null), settle()) };
}

async function mount(opts: { browser?: MemoryFileStore; hooks?: AuthHooks; confirm?: (q: string) => boolean; saveDelay?: number } = {}) {
  const browser = opts.browser ?? new MemoryFileStore('browser');
  let n = 0;
  await mountApp(root, { files: new Files(browser), auth: opts.hooks, newId: () => `id${++n}`, confirm: opts.confirm ?? (() => true), saveDelay: opts.saveDelay ?? 0 });
  await settle();
  return browser;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

describe('day-2 review fixes', () => {
  it('asks before leaving a file that could not be saved', async () => {
    const answers = [false, true];
    const asked: string[] = [];
    const browser = await mount({ confirm: (q) => (asked.push(q), answers.shift() as boolean) });
    browser.put = async () => {
      throw new Error('no room');
    };
    await importCsv();
    button('New client file').click();
    await settle();
    expect(asked[0]).toMatch(/could not be saved \(no room\)\. Leave it without saving\?/);
    expect(root.textContent).toContain('Pat');
    button('New client file').click();
    await settle();
    expect(asked).toHaveLength(2);
    expect(root.querySelector('#hours-file')).not.toBeNull();
    expect(root.textContent).toContain('Results appear once hours are imported');
  });

  it('keeps unsaved account changes as a browser copy on sign-out', async () => {
    const account = new MemoryFileStore('account');
    const a = auth(account);
    const browser = await mount({ hooks: a.hooks, saveDelay: 10_000 });
    await a.as('u1');
    await importCsv();
    expect(await account.list()).toHaveLength(0);
    await a.as(null);
    expect(status()).toMatch(/kept as a copy in this browser/);
    expect((await browser.list()).map((f) => f.employees)).toEqual([1]);
  });

  it('never shows one user the account file of another', async () => {
    const account = new MemoryFileStore('account');
    const a = auth(account);
    await mount({ hooks: a.hooks });
    await a.as('u1');
    await importCsv();
    expect(await account.list()).toHaveLength(1);
    await a.as('u2');
    expect(root.textContent).not.toContain('Pat');
    expect(status()).toBe('Signed out. Files in your account show again when you sign in.');
  });

  it('a save in flight cannot bring a deleted file back', async () => {
    const account = new MemoryFileStore('account');
    const a = auth(account);
    let release: () => void = () => {};
    await mount({ hooks: a.hooks });
    await a.as('u1');
    await importCsv();
    const realPut = account.put.bind(account);
    account.put = async (f) => {
      await new Promise<void>((r) => (release = r));
      return realPut(f);
    };
    const name = root.querySelector('#emp-name') as HTMLInputElement;
    name.value = 'Late Save';
    name.dispatchEvent(new Event('change'));
    await tick();
    button('Delete unnamed file 2026').click();
    await tick();
    release();
    await settle();
    expect(await account.list()).toHaveLength(0);
  });

  it('starts blank and says why when the newest file cannot be read', async () => {
    const browser = new MemoryFileStore('browser');
    await browser.put(newClientFile('bad', { name: 'Broken Co' }));
    browser.get = async () => decodeFile('bad', { v: 1, settings: {}, employees: [], codes: [], lines: [] });
    await mount({ browser });
    expect(status()).toBe('Broken Co could not be opened: This saved file is damaged or in a format this version cannot read.');
    expect(root.querySelector('#emp-name')).not.toBeNull();
  });

  it('saves a browser file when the page is left', async () => {
    const browser = await mount({ saveDelay: 10_000 });
    await importCsv();
    expect(await browser.list()).toHaveLength(0);
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(await browser.list()).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('rejects damaged stored files', () => {
    const good = encodeFile(newClientFile('x'));
    expect(() => decodeFile('x', { ...good, codes: undefined })).toThrow(/damaged/);
    expect(() => decodeFile('x', { ...good, lines: [[5, '2026-01-01', 1, 1, 0, 1, null, 0, 1]] })).toThrow(/damaged/);
    expect(() => decodeFile('x', { ...good, lines: [[0, 1]] })).toThrow(/damaged/);
  });

  it('removes a file entry when the index cannot be written', async () => {
    const data = new Map<string, string>();
    const st: KeyValue = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (k === LOCAL_INDEX && data.has('qoc.file.a')) throw new Error('quota');
        data.set(k, v);
      },
      removeItem: (k) => void data.delete(k),
    };
    await expect(new LocalFileStore(st).put(newClientFile('a', { name: 'A' }))).rejects.toThrow(/no room/);
    expect(data.has('qoc.file.a')).toBe(false);
    data.set('qoc.file.b', 'old');
    const st2: KeyValue = { ...st, setItem: (k, v) => (k === LOCAL_INDEX ? (() => { throw new Error('quota'); })() : void data.set(k, v)) };
    await expect(new LocalFileStore(st2).put(newClientFile('b', { name: 'B' }))).rejects.toThrow(/no room/);
    expect(data.get('qoc.file.b')).toBe('old');
  });

  it('drops a column of undashed nine-digit numbers as SSNs', () => {
    expect(ssnColumns(parseCsv('Employee ID,Name\n123456789,A\n987654321,B\n'))).toEqual([0]);
  });

  it('makes v4 uuids with or without randomUUID', () => {
    expect(uuid({ randomUUID: () => 'r', getRandomValues: (a: Uint8Array) => a } as unknown as Crypto)).toBe('r');
    const fake = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => (new Uint8Array((a as unknown as Uint8Array).buffer).fill(255), a) } as unknown as Crypto;
    expect(uuid(fake)).toMatch(/^ffffffff-ffff-4fff-bfff-ffffffffffff$/);
  });
});
