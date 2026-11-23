/** The page with two stand-in accounts, for the AC-51 tests of rounds 1 and 2. */
import { strToU8, zipSync } from 'fflate';
import { CourseStore, MemoryDb, type AltTextRow } from '../src/lib/store';
import { mountApp, type Account, type DroppedFile } from '../src/ui/app';
import { statusIndex } from './helpers';

export const idx = statusIndex();
export const NOW = new Date('2026-11-23T12:00:00Z');
export const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
export async function settle(n = 14) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
export const doc = (body: string) => `\\documentclass{article}\n\\usepackage{graphicx}\n\\usepackage{tikz}\n\\begin{document}\n${body}\n\\end{document}\n`;
export function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

/** The page with a stand-in sign-in that can change person; each person has their own database. */
export function page() {
  const dbs = new Map<string, MemoryDb>();
  const stores = new Map<string, CourseStore>();
  let who: string | null = 'u1';
  const storeOf = (id: string) => {
    let s = stores.get(id);
    if (!s) {
      const db = new MemoryDb(id, () => NOW);
      dbs.set(id, db);
      stores.set(id, (s = new CourseStore(db)));
    }
    return s;
  };
  let cb: ((u: { id: string } | null) => void) | null = null;
  const account: Account = {
    mountSignIn: () => () => {},
    onUser: (f) => {
      cb = f;
      f(who ? { id: who } : null);
    },
    store: () => storeOf(who as string),
  };
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account });
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
  const items = () => [...root.querySelectorAll('li.figure-item')] as HTMLElement[];
  const item = (name: string) => items().find((li) => li.querySelector('h4')?.textContent?.endsWith(name)) as HTMLElement;
  const text = (name: string) => (item(name).querySelector('textarea') as HTMLTextAreaElement).value;
  const approve = (name: string, t: string) => {
    const li = item(name);
    const ta = li.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = t;
    ta.dispatchEvent(new Event('input'));
    (item(name).querySelector('[data-role="approve"]') as HTMLButtonElement).click();
  };
  const choose = (name: string, role: string) => (item(name).querySelector(`[data-role="${role}"]`) as HTMLButtonElement).click();
  const save = async (course: string) => {
    button('Save').click();
    await settle();
    const pick = root.querySelector('#save-course') as HTMLSelectElement | null;
    const existing = pick ? [...pick.options].find((o) => o.textContent?.startsWith(course)) : undefined;
    if (pick) {
      pick.value = existing ? existing.value : '';
      pick.dispatchEvent(new Event('change'));
      await settle();
    }
    if (!existing) (root.querySelector('#save-course-name') as HTMLInputElement).value = course;
    root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
    await settle(30);
  };
  const as = (id: string | null) => {
    who = id;
    cb?.(id ? { id } : null);
  };
  const rows = async (id: string) => (await (dbs.get(id) as MemoryDb).select<AltTextRow>('alt_texts')).map((r) => [r.figure_path, r.text, r.decision]);
  const open = async (name: string, bytes: Uint8Array) => {
    await app.handleFile(file(name, bytes));
    button('Alt text for figures').click();
    await settle();
  };
  return { root, app, button, items, item, text, approve, choose, save, as, rows, open, storeOf };
}

