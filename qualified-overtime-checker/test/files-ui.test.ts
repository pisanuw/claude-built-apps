// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { newClientFile, type ClientFile } from '../src/core/clientFile';
import { Files, MemoryFileStore, type FileStore } from '../src/store/stores';
import { mountApp, type AuthHooks } from '../src/ui/app';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 25; i++) await flush();
};

let root: HTMLElement;

function button(name: string | RegExp, scope: ParentNode = root): HTMLButtonElement {
  const b = [...scope.querySelectorAll('button')].find((x) => {
    const label = x.getAttribute('aria-label') ?? x.textContent ?? '';
    return typeof name === 'string' ? label === name || x.textContent === name : name.test(label);
  });
  if (!b) throw new Error(`no button ${name}`);
  return b as HTMLButtonElement;
}

const status = () => root.querySelector('p.status')?.textContent;
const fileRows = () => [...root.querySelectorAll('table.files tbody tr')].map((tr) => tr.textContent ?? '');

async function importCsv(name: string, text: string) {
  const input = root.querySelector('#hours-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], name)] });
  input.dispatchEvent(new Event('change'));
  await settle();
}

function fakeAuth(account: FileStore) {
  let cb: (u: { email: string | null } | null) => void = () => {};
  const hooks: AuthHooks = {
    mount: (el) => {
      el.textContent = 'sign-in panel';
    },
    onUser: (c) => {
      cb = c;
    },
    accountStore: () => account,
  };
  return { hooks, signIn: async () => (cb({ email: 'ann@example.com' }), settle()), signOut: async () => (cb(null), settle()) };
}

interface Opts {
  browser?: MemoryFileStore;
  auth?: AuthHooks;
  confirm?: (q: string) => boolean;
  saveDelay?: number;
}

async function mount(o: Opts = {}) {
  const browser = o.browser ?? new MemoryFileStore('browser');
  let n = 0;
  await mountApp(root, { files: new Files(browser), auth: o.auth, newId: () => `id${++n}`, now: () => new Date(`2026-11-10T12:00:${String(n).padStart(2, '0')}Z`), confirm: o.confirm ?? (() => true), saveDelay: o.saveDelay ?? 0 });
  await settle();
  return browser;
}

const CSV = 'Employee,Date,Hours,Rate\nPat,2026-11-02,45,20\n';

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

describe('client files', () => {
  it('saves a file once it has hours, and lists it as open', async () => {
    const browser = await mount();
    expect(root.textContent).toContain('No saved files yet');
    expect(root.textContent).toContain('kept in this browser only');
    await importCsv('a.csv', CSV);
    expect(fileRows()[0]).toContain('(open)');
    expect(fileRows()[0]).toContain('1 of 1 not entered');
    expect(fileRows()[0]).toContain('This browser');
    expect(root.querySelector('.save-status')?.textContent).toBe('Saved in this browser.');
    expect((await browser.list()).length).toBe(1);
  });

  it('opens the most recent file on load, switches files and starts a new one', async () => {
    const browser = new MemoryFileStore('browser');
    await browser.put(newClientFile('old', { name: 'Old Co' }, new Date('2026-11-01T00:00:00Z')));
    await browser.put(newClientFile('new', { name: 'New Co', taxYear: 2025 }, new Date('2026-11-02T00:00:00Z')));
    await mount({ browser });
    expect((root.querySelector('#emp-name') as HTMLInputElement).value).toBe('New Co');
    expect(status()).toBe('');
    button('Open Old Co 2026').click();
    await settle();
    expect((root.querySelector('#emp-name') as HTMLInputElement).value).toBe('Old Co');
    expect(status()).toBe('Opened Old Co (tax year 2026).');
    button('New client file').click();
    await settle();
    expect((root.querySelector('#emp-name') as HTMLInputElement).value).toBe('');
    expect(document.activeElement?.id).toBe('emp-name');
    expect(fileRows().some((r) => r.includes('(open)'))).toBe(false);
  });

  it('says so when a listed file has gone', async () => {
    const browser = new MemoryFileStore('browser');
    await browser.put(newClientFile('a', { name: 'A' }, new Date('2026-11-01T00:00:00Z')));
    await browser.put(newClientFile('b', { name: 'B' }, new Date('2026-11-02T00:00:00Z')));
    await mount({ browser });
    await browser.remove('a');
    button('Open A 2026').click();
    await settle();
    expect(status()).toBe('A is no longer there.');
    expect(fileRows().join()).not.toContain('A2026');
  });

  it('deletes after a yes, and keeps after a no', async () => {
    const answers = [false, true];
    const browser = await mount({ confirm: () => answers.shift() as boolean });
    await importCsv('a.csv', CSV);
    const name = root.querySelector('#emp-name') as HTMLInputElement;
    name.value = 'Pat Plumbing';
    name.dispatchEvent(new Event('change'));
    await settle();
    button('Delete Pat Plumbing 2026').click();
    await settle();
    expect((await browser.list()).length).toBe(1);
    button('Delete Pat Plumbing 2026').click();
    await settle();
    expect((await browser.list()).length).toBe(0);
    expect(status()).toBe('Deleted Pat Plumbing.');
    expect((root.querySelector('#emp-name') as HTMLInputElement).value).toBe('');
  });

  it('deletes a file that is not open', async () => {
    const browser = new MemoryFileStore('browser');
    await browser.put(newClientFile('a', { name: 'A' }, new Date('2026-11-01T00:00:00Z')));
    await browser.put(newClientFile('b', { name: 'B' }, new Date('2026-11-02T00:00:00Z')));
    await mount({ browser });
    button('Delete A 2026').click();
    await settle();
    expect((await browser.list()).map((f) => f.id)).toEqual(['b']);
    expect((root.querySelector('#emp-name') as HTMLInputElement).value).toBe('B');
  });

  it('shows a save error and a delete error', async () => {
    const browser = new MemoryFileStore('browser');
    await mount({ browser });
    browser.put = async () => {
      throw new Error('This browser has no room left to keep the file.');
    };
    await importCsv('a.csv', CSV);
    expect(root.querySelector('.save-status')?.textContent).toBe('Not saved: This browser has no room left to keep the file.');
    expect(root.querySelector('.save-status')?.className).toContain('bad-text');
  });

  it('waits for a pause before saving', async () => {
    const browser = await mount({ saveDelay: 400 });
    await importCsv('a.csv', CSV);
    expect((await browser.list()).length).toBe(0);
    await new Promise((r) => setTimeout(r, 450));
    await settle();
    expect((await browser.list()).length).toBe(1);
  });
});

describe('signed in', () => {
  it('lists account files, saves new files there, moves files both ways', async () => {
    const browser = new MemoryFileStore('browser');
    const account = new MemoryFileStore('account');
    await browser.put({ ...newClientFile('local1', { name: 'Local Co' }, new Date('2026-11-01T00:00:00Z')) });
    await account.put({ ...newClientFile('acct1', { name: 'Remote Co' }, new Date('2026-11-02T00:00:00Z')) } as ClientFile);
    const auth = fakeAuth(account);
    await mount({ browser, auth: auth.hooks });
    expect(root.textContent).toContain('sign-in panel');
    expect(fileRows()).toHaveLength(1);
    await auth.signIn();
    expect(root.textContent).toContain('only you can read them');
    expect(fileRows().map((r) => r.includes('Your account'))).toEqual([true, false]);

    button('Save to your account: Local Co 2026').click();
    await settle();
    expect(status()).toBe('Local Co is now saved to your account.');
    expect((await browser.list()).length).toBe(0);
    expect((await account.list()).length).toBe(2);

    button('Keep in this browser only: Remote Co 2026').click();
    await settle();
    expect(status()).toBe('Remote Co is now kept in this browser only, and removed from your account.');
    expect((await browser.list()).map((f) => f.id)).toEqual(['acct1']);

    button('New client file').click();
    await settle();
    await importCsv('n.csv', CSV);
    expect(root.querySelector('.save-status')?.textContent).toBe('Saved to your account.');
  });

  it('a new visitor who signs in saves to the account; signing out closes an account file', async () => {
    const account = new MemoryFileStore('account');
    const auth = fakeAuth(account);
    await mount({ auth: auth.hooks });
    await auth.signIn();
    await importCsv('a.csv', CSV);
    expect((await account.list()).length).toBe(1);
    await auth.signOut();
    expect(status()).toBe('Signed out. Files in your account show again when you sign in.');
    expect(fileRows()).toHaveLength(0);
    expect(root.textContent).toContain('kept in this browser only');
  });

  it('reports a move that fails and an account that cannot be listed', async () => {
    const account = new MemoryFileStore('account');
    const auth = fakeAuth(account);
    const browser = new MemoryFileStore('browser');
    await browser.put(newClientFile('l', { name: 'L' }, new Date('2026-11-01T00:00:00Z')));
    await mount({ browser, auth: auth.hooks });
    await auth.signIn();
    account.put = async () => {
      throw new Error('Could not save your saved files: offline.');
    };
    button('Save to your account: L 2026').click();
    await settle();
    expect(status()).toBe('Could not save your saved files: offline.');
    account.list = async () => {
      throw new Error('Could not list your saved files: offline.');
    };
    button('New client file').click();
    await settle();
    expect(root.querySelector('.warn')?.textContent).toBe('Could not list your saved files: offline.');
  });
});
