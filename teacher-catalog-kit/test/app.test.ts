// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Resource } from '../src/core/types';
import { MemoryCatalog, type CatalogStore } from '../src/store/catalog';
import { mountApp, type AuthHooks, type AuthUser } from '../src/ui/app';
import { fill, h, uuid } from '../src/ui/dom';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush();
};

let root: HTMLElement;
let ids: number;

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
  ids = 0;
});

const $ = <T extends Element = HTMLInputElement>(sel: string) => root.querySelector(sel) as T;
function button(name: string | RegExp): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find((x) => (typeof name === 'string' ? x.textContent === name : name.test(x.textContent ?? '')));
  if (!b) throw new Error(`no button ${name}`);
  return b as HTMLButtonElement;
}
function type(sel: string, value: string) {
  const el = $(sel);
  el.value = value;
  el.dispatchEvent(new Event('input'));
}
function tick(store: string, price?: string) {
  const box = $(`#s-${store}`);
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change'));
  if (price !== undefined) type(`#s-${store}-price`, price);
}
function pickType(id: string) {
  const s = $<HTMLSelectElement>('#f-type');
  s.value = id;
  s.dispatchEvent(new Event('change'));
}
async function save() {
  $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}
async function chooseTier(t: string) {
  const r = $(`#tier-${t}`);
  r.checked = true;
  r.dispatchEvent(new Event('change'));
  await settle();
}
const status = () => $('[role=status]').textContent ?? '';
const listText = () => $('#list').textContent ?? '';

function mount(browser: CatalogStore = new MemoryCatalog(), extra: Partial<Parameters<typeof mountApp>[1]> = {}) {
  return mountApp(root, { browser, newId: () => `id-${++ids}`, now: () => new Date('2026-11-11T12:00:00Z'), confirm: () => true, ...extra });
}

describe('one resource, one verdict', () => {
  it('starts empty and explains where the catalog is kept', async () => {
    await mount();
    expect(root.querySelector('h1')?.textContent).toBe('Teacher Catalog Kit');
    expect(listText()).toContain('No resources yet');
    expect(root.textContent).toContain('Kept in this browser only');
    expect(root.textContent).toContain('Sign-in is not available in this preview');
    expect(root.textContent).toContain('not made by, or affiliated with, Teachers Pay Teachers');
    expect($('#tier-undecided').checked).toBe(true);
  });

  it('previews and saves a worksheet on Payhip: Exclusive breaks, Basic is fine', async () => {
    const browser = new MemoryCatalog();
    await mount(browser);
    type('#f-title', 'Fractions worksheet');
    expect($('#preview').textContent).toContain('Tick the other stores');
    type('#f-tpt', '4.50');
    tick('payhip', '4.50');
    expect($('#preview').textContent).toContain('If you are Exclusive: Breaks the rules');
    expect($('#preview').textContent).toContain('If you are Basic: Allowed');
    await save();
    expect(status()).toContain('Saved "Fractions worksheet". Exclusive: breaks the rules; Basic: allowed.');
    const saved = await browser.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'id-1', productType: 'digital-education', tptPriceCents: 450, listings: [{ store: 'payhip', priceCents: 450 }] });
    expect(listText()).toContain('Fractions worksheet');
    expect($('#summary').textContent).toBe('1 resource. Exclusive: 1 of 1 breaks the rules. Basic: no problems.');
    expect($('#f-title').value).toBe('');
    expect($('#s-payhip').checked).toBe(false);
    expect($('#s-payhip-price').disabled).toBe(true);
  });

  it('a clip-art set on Payhip is allowed under Exclusive', async () => {
    await mount();
    await chooseTier('exclusive');
    type('#f-title', 'Apple clip art');
    pickType('non-teaching-digital');
    expect($('#f-type-help').textContent).toContain('clip art, fonts');
    type('#f-tpt', '6');
    tick('payhip', '6');
    await save();
    expect(status()).toContain('Exclusive: allowed.');
    expect(status()).not.toContain('Basic');
    expect($('#summary').textContent).toContain('Exclusive: no problems');
    expect(root.querySelectorAll('thead th').length).toBe(5);
  });

  it('remembers the tier per store and shows only that tier', async () => {
    const browser = new MemoryCatalog();
    await mount(browser);
    await chooseTier('basic');
    expect(await browser.getTier()).toBe('basic');
    type('#f-title', 'Unit');
    type('#f-tpt', '5');
    tick('etsy', '4');
    expect($('#preview').textContent).not.toContain('Exclusive');
    await save();
    expect(listText()).toContain('Breaks the rules');
    expect(listText()).toContain('raise Etsy to $5.00');
  });

  it('refuses a missing title or a bad price, and keeps the form', async () => {
    const browser = new MemoryCatalog();
    await mount(browser);
    await save();
    expect($('#form-error').textContent).toBe('Give the resource a title.');
    expect($('#f-title').getAttribute('aria-invalid')).toBe('true');
    type('#f-title', 'Unit');
    type('#f-tpt', 'four');
    await save();
    expect($('#form-error').textContent).toContain('The TPT price should be');
    expect($('#preview').textContent).toContain('(at most $100,000)');
    type('#f-tpt', '4');
    tick('tes', 'x');
    await save();
    expect($('#form-error').textContent).toContain('The price on TES should be');
    expect(await browser.list()).toEqual([]);
    type('#s-tes-price', '');
    await save();
    expect(await browser.list()).toHaveLength(1);
    expect(listText()).toContain('TES (no price)');
    expect($('#f-title').hasAttribute('aria-invalid')).toBe(false);
  });

  it('edits, cancels and deletes', async () => {
    const seed: Resource = { id: 'r1', title: 'Old', productType: 'physical', tptPriceCents: null, tptId: 't9', listings: [{ store: 'etsy', priceCents: 1200, url: 'https://etsy.com/l/1' }], notes: 'n', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
    const browser = new MemoryCatalog('browser', [seed]);
    await mount(browser);
    expect(listText()).toContain('Not on TPT');
    expect(listText()).toContain('Etsy $12.00');
    button('Edit').click();
    expect($('#form-h').textContent).toBe('Edit "Old"');
    expect($('#f-title').value).toBe('Old');
    expect($('#s-etsy').checked).toBe(true);
    expect($('#s-etsy-price').value).toBe('12.00');
    expect($<HTMLTextAreaElement>('#f-notes').value).toBe('n');
    button('Cancel').click();
    expect(status()).toBe('Edit cancelled.');
    expect($('#form-h').textContent).toBe('Add a resource');
    button('Edit').click();
    type('#f-title', 'New');
    await save();
    expect(status()).toContain('Updated "New"');
    const [r] = await browser.list();
    expect(r).toMatchObject({ id: 'r1', title: 'New', tptId: 't9', createdAt: '2026-11-01T00:00:00Z', listings: [{ store: 'etsy', priceCents: 1200, url: 'https://etsy.com/l/1' }] });
    button('Edit').click();
    button('Delete').click();
    await settle();
    expect(status()).toBe('Deleted "New".');
    expect(await browser.list()).toEqual([]);
    expect($('#form-h').textContent).toBe('Add a resource');
    expect(document.activeElement?.id).toBe('list-h');
  });

  it('keeps a resource when delete is not confirmed', async () => {
    const browser = new MemoryCatalog('browser', [{ id: 'r1', title: 'Keep', productType: 'physical', tptPriceCents: 100, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' }]);
    await mount(browser, { confirm: () => false });
    button('Delete').click();
    await settle();
    expect(await browser.list()).toHaveLength(1);
    expect(listText()).toContain('Other stores');
  });

  it('unticking a store drops it', async () => {
    const browser = new MemoryCatalog();
    await mount(browser);
    type('#f-title', 'Unit');
    tick('etsy', '3');
    tick('etsy');
    expect($('#preview').textContent).toContain('Tick the other stores');
    await save();
    expect((await browser.list())[0].listings).toEqual([]);
    expect(listText()).toContain('None');
  });

  it('says when storage is blocked', async () => {
    await mount(new MemoryCatalog(), { storageBlocked: true });
    expect(root.textContent).toContain('This browser blocks storage');
  });
});

class FailingCatalog extends MemoryCatalog {
  failList = false;
  failPut = false;
  failRemove = false;
  failTier = false;
  override async list() {
    if (this.failList) throw new Error('Could not load your catalog: offline.');
    return super.list();
  }
  override async put(r: Resource) {
    if (this.failPut) throw new Error('Could not save your catalog: offline.');
    return super.put(r);
  }
  override async remove(id: string) {
    if (this.failRemove) throw new Error('Could not update your catalog: offline.');
    return super.remove(id);
  }
  override async setTier(t: 'undecided' | 'exclusive' | 'basic') {
    if (this.failTier) throw new Error('Could not save your catalog: offline.');
    return super.setTier(t);
  }
}

describe('errors', () => {
  it('reports load, save, delete and tier failures', async () => {
    const c = new FailingCatalog('browser', [{ id: 'r1', title: 'One', productType: 'physical', tptPriceCents: 100, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' }]);
    c.failList = true;
    await mount(c);
    expect(status()).toContain('Could not load your catalog');
    c.failList = false;
    root.replaceChildren();
    await mount(c);
    c.failPut = true;
    type('#f-title', 'Two');
    await save();
    expect($('#form-error').textContent).toContain('Could not save');
    c.failRemove = true;
    button('Delete').click();
    await settle();
    expect(status()).toContain('Could not update');
    c.failTier = true;
    await chooseTier('basic');
    expect(status()).toContain('Could not save');
  });
});

function fakeAuth(account: CatalogStore) {
  let cb: ((u: AuthUser | null) => void) | null = null;
  const mounted: HTMLElement[] = [];
  const hooks: AuthHooks = {
    mount: (el) => {
      mounted.push(el);
      el.append(h('button', { type: 'button', text: 'Continue with Google' }));
    },
    onUser: (c) => {
      cb = c;
    },
    accountStore: () => account,
  };
  return { hooks, mounted, signIn: (u: AuthUser | null) => cb?.(u) };
}

describe('account', () => {
  it('switches to the account on sign-in and offers to copy the browser catalog', async () => {
    const browser = new MemoryCatalog('browser', [
      { id: 'b1', title: 'Browser one', productType: 'physical', tptPriceCents: 100, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' },
      { id: 'b2', title: 'Browser two', productType: 'physical', tptPriceCents: 100, tptId: null, listings: [], notes: '', createdAt: 'b', updatedAt: 'b' },
    ]);
    const account = new MemoryCatalog('account', [{ id: 'b2', title: 'Already there', productType: 'course', tptPriceCents: 100, tptId: null, listings: [], notes: '', createdAt: 'c', updatedAt: 'c' }]);
    await account.setTier('exclusive');
    const auth = fakeAuth(account);
    const app = await mount(browser, { auth: auth.hooks });
    expect(auth.mounted).toHaveLength(1);
    expect(root.textContent).toContain('Continue with Google');
    expect(root.textContent).not.toContain('Sign-in is not available');
    auth.signIn({ id: 'u1', email: 'seller@example.com' });
    await app.ready();
    expect(app.store).toBe(account);
    expect(root.textContent).toContain('Saved to your account (seller@example.com)');
    expect($('#tier-exclusive').checked).toBe(true);
    expect(listText()).toContain('Already there');
    button('Copy 2 resources from this browser to your account').click();
    await settle();
    await app.ready();
    expect(status()).toBe('Copied 1 resource to your account and cleared them from this browser.');
    expect((await account.list()).find((r) => r.title === 'Browser one')?.id).toMatch(/^id-|^[0-9a-f-]{36}$/);
    expect((await account.list()).map((r) => r.title).sort()).toEqual(['Already there', 'Browser one']);
    expect(await browser.list()).toEqual([]);
    expect(() => button(/^Copy/)).toThrow();
    // Same user again: nothing reloads.
    auth.signIn({ id: 'u1', email: 'seller@example.com' });
    expect(app.store).toBe(account);
    button('Edit').click();
    auth.signIn(null);
    await app.ready();
    expect(app.store).toBe(browser);
    expect($('#form-h').textContent).toBe('Add a resource');
    expect(root.textContent).toContain('Kept in this browser only');
  });

  it('a single browser resource reads in the singular, and a copy failure is reported', async () => {
    const browser = new MemoryCatalog('browser', [{ id: 'b1', title: 'Solo', productType: 'physical', tptPriceCents: 100, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' }]);
    const account = new FailingCatalog('account');
    const auth = fakeAuth(account);
    const app = await mount(browser, { auth: auth.hooks });
    auth.signIn({ id: 'u1', email: null });
    await app.ready();
    expect(root.textContent).toContain('Saved to your account. Sign in');
    account.failPut = true;
    button('Copy 1 resource from this browser to your account').click();
    await settle();
    await app.ready();
    expect(status()).toContain('Could not save');
    expect(status()).toContain('0 copied so far; the rest are still in this browser.');
    expect(await browser.list()).toHaveLength(1);
  });

  it('uploads a newer browser copy of a resource the account has, under a fresh id when needed', async () => {
    const uuidA = '123e4567-e89b-42d3-a456-426614174000';
    const base = { productType: 'physical' as const, tptPriceCents: 100, tptId: null, listings: [], notes: '' };
    const browser = new MemoryCatalog('browser', [
      { ...base, id: uuidA, title: 'Newer edit', createdAt: 'a', updatedAt: '2026-11-10' },
      { ...base, id: 'old-style', title: 'Hand made id', createdAt: 'b', updatedAt: 'b' },
    ]);
    const account = new MemoryCatalog('account', [{ ...base, id: uuidA, title: 'Older', createdAt: 'a', updatedAt: '2026-11-01' }]);
    const auth = fakeAuth(account);
    const app = await mount(browser, { auth: auth.hooks });
    auth.signIn({ id: 'u1', email: null });
    await app.ready();
    button(/^Copy 2/).click();
    await settle();
    await app.ready();
    const after = await account.list();
    expect(after.find((r) => r.id === uuidA)?.title).toBe('Newer edit');
    expect(after.find((r) => r.title === 'Hand made id')?.id).toBe('id-1');
    expect(status()).toBe('Copied 2 resources to your account and cleared them from this browser.');
  });

  it('shows a failed account load as an error, not an empty catalog, and waits while loading', async () => {
    let release: () => void = () => {};
    class Gate extends FailingCatalog {
      override async list() {
        await new Promise<void>((r) => {
          release = r;
        });
        return super.list();
      }
    }
    const account = new Gate('account', [{ id: 'a1', title: 'Account one', productType: 'physical', tptPriceCents: 1, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' }]);
    account.failList = true;
    const browser = new MemoryCatalog('browser', [{ id: 'b1', title: 'Local', productType: 'physical', tptPriceCents: 1, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' }]);
    const auth = fakeAuth(account);
    const app = await mount(browser, { auth: auth.hooks });
    button('Edit').click();
    auth.signIn({ id: 'u1', email: null });
    await flush();
    expect(listText()).toContain('Loading your catalog');
    expect($('#tier-basic').disabled).toBe(true);
    expect(button('Save resource').disabled).toBe(true);
    release();
    await app.ready();
    expect(listText()).toContain('could not be loaded');
    expect(listText()).not.toContain('No resources yet');
    account.failList = false;
    auth.signIn(null);
    await app.ready();
    auth.signIn({ id: 'u1', email: null });
    await flush();
    release();
    await app.ready();
    expect(listText()).toContain('Account one');
    expect(status()).toBe('');
  });

  it('a save that finishes after sign-out does not land in the new list', async () => {
    let release: () => void = () => {};
    class Slow extends MemoryCatalog {
      override put(r: Resource) {
        return new Promise<void>((res) => {
          release = () => void super.put(r).then(res);
        });
      }
    }
    const account = new Slow('account');
    const auth = fakeAuth(account);
    const app = await mount(new MemoryCatalog(), { auth: auth.hooks });
    auth.signIn({ id: 'u1', email: null });
    await app.ready();
    type('#f-title', 'Late');
    const saving = save();
    auth.signIn(null);
    await app.ready();
    release();
    await saving;
    await settle();
    expect(listText()).not.toContain('Late');
  });

  it('ignores a slow load that a newer sign-in change replaced', async () => {
    let releaseList: () => void = () => {};
    class SlowList extends MemoryCatalog {
      override list() {
        return new Promise<Resource[]>((res) => {
          releaseList = () => res([{ id: 'x', title: 'Stale', productType: 'physical', tptPriceCents: 1, tptId: null, listings: [], notes: '', createdAt: 'a', updatedAt: 'a' }]);
        });
      }
    }
    class SlowFail extends MemoryCatalog {
      override list(): Promise<Resource[]> {
        return new Promise((_res, rej) => {
          releaseList = () => rej(new Error('late failure'));
        });
      }
    }
    for (const Kind of [SlowList, SlowFail]) {
      root.replaceChildren();
      const auth = fakeAuth(new Kind('account'));
      const app = await mount(new MemoryCatalog(), { auth: auth.hooks });
      auth.signIn({ id: 'u1', email: null });
      auth.signIn(null);
      await app.ready();
      releaseList();
      await settle();
      expect(listText()).not.toContain('Stale');
      expect(status()).not.toContain('late failure');
    }
  });
});

describe('dom helpers', () => {
  it('builds nodes from text only', () => {
    const el = h('p', { class: 'x', text: '<b>hi</b>', hidden: true, title: null, 'data-n': 3 }, 'tail', null, false);
    expect(el.innerHTML).toBe('&lt;b&gt;hi&lt;/b&gt;tail');
    expect(el.className).toBe('x');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.getAttribute('data-n')).toBe('3');
    fill(el, 'a', null, h('span', { text: 'b' }));
    expect(el.textContent).toBe('ab');
  });

  it('makes v4 uuids with or without randomUUID', () => {
    expect(uuid({ randomUUID: () => 'fixed', getRandomValues: (a: Uint8Array) => a } as never)).toBe('fixed');
    const id = uuid({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => a } as never);
    expect(id).toMatch(/^00000000-0000-4000-8000-000000000000$/);
  });
});
