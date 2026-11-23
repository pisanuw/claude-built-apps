// @vitest-environment jsdom
/**
 * Milestone 5b, review round 1 and Manager's REJECT (AC-51, AC-52): each
 * fix beside the case the old code got right.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { altWords } from '../src/core/saved';
import { RESTORED_NOTE } from '../src/lib/alts';
import { CourseStore, MemoryDb, type AltTextRow } from '../src/lib/store';
import { mountApp, type Account, type DroppedFile } from '../src/ui/app';
import { courseReport } from '../src/ui/pages';
import { statusIndex } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-23T12:00:00Z');
const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
async function settle(n = 14) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

const doc = (body: string) => `\\documentclass{article}\n\\usepackage{graphicx}\n\\usepackage{tikz}\n\\begin{document}\n${body}\n\\end{document}\n`;
const TWO = doc('\\includegraphics{p.pdf}\n\\includegraphics{q.pdf}');
function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

afterEach(() => {
  document.body.innerHTML = '';
});

/** The page with a stand-in sign-in that can change person; each person has their own database. */
function page() {
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

describe('R5b.1-1 (AC-51): texts restored from one person’s rows go on a change of person', () => {
  it('signed out, the restored text, its note and the stale note are gone; the next person’s save holds none of them', async () => {
    const p = page();
    await p.open('lab.zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    await p.save('Course');
    p.approve('p.pdf', 'Person one private words');
    p.approve('q.pdf', 'Person one, q');
    await settle();
    // The next version: p.pdf unchanged (restored), q.pdf redrawn (a stale note quoting the text).
    await p.open('lab (1).zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q2' }));
    expect(p.text('p.pdf')).toBe('Person one private words');
    expect(p.item('p.pdf').querySelector('.note')?.textContent).toBe(RESTORED_NOTE);
    expect(p.item('q.pdf').querySelector('.note')?.textContent).toContain('Person one, q');
    // A text typed on the page is the drop's own work and stays (D-145).
    p.as(null);
    await settle();
    expect(p.text('p.pdf')).toBe('');
    expect(p.item('p.pdf').querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
    expect(p.item('p.pdf').querySelector('.note')).toBeNull();
    expect(p.item('q.pdf').querySelector('.note')).toBeNull();
    expect(p.root.querySelector('#fixes')?.textContent).not.toContain('Person one');
    // Person 2 signs in on the same tab and saves the scan to a course of their own.
    p.as('u2');
    await settle();
    expect(p.root.querySelector('#fixes')?.textContent).not.toContain('Person one');
    p.approve('q.pdf', 'Person two words');
    await p.save('Mine');
    await settle();
    expect(await p.rows('u2')).toEqual([['q.pdf', 'Person two words', 'approved']]);
  });

  it('kept: the same person again changes nothing; a text changed since the restore stays; signing in again restores again', async () => {
    const p = page();
    await p.open('lab.zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    await p.save('Course');
    p.approve('p.pdf', 'P text');
    p.approve('q.pdf', 'Q text');
    await settle();
    await p.open('lab (1).zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    // The library sends SIGNED_IN again for the same person (R2.1-2): nothing goes.
    p.as('u1');
    await settle();
    expect(p.text('p.pdf')).toBe('P text');
    // The person edits one restored text: that one is theirs now.
    p.approve('q.pdf', 'Q text, edited on the page');
    p.as(null);
    await settle();
    expect(p.text('p.pdf')).toBe('');
    expect(p.text('q.pdf')).toBe('Q text, edited on the page');
    expect(p.item('q.pdf').querySelector('.note')).toBeNull();
    // Person 1 signs in again: their saved text comes back for the untouched figure.
    p.as('u1');
    await settle();
    expect(p.text('p.pdf')).toBe('P text');
  });
});

describe('R5b.1-2 (AC-52): the report counts what the latest version’s copy carries', () => {
  async function reportAlt(p: ReturnType<typeof page>, user = 'u1'): Promise<string[]> {
    const store = p.storeOf(user);
    const [course] = await store.courses();
    const r = await courseReport(store, course.id, NOW, idx.data);
    return (r?.rows ?? []).map((x) => `${x.project}: ${altWords(x.alt)}`);
  }

  it('a redrawn plot: 1 of the 2 approved texts is in the copy, not 2', async () => {
    const p = page();
    await p.open('lab3.zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    await p.save('CHEM 2');
    p.approve('p.pdf', 'P, first plot');
    p.approve('q.pdf', 'Q, first plot');
    await settle();
    expect(await reportAlt(p)).toEqual(['lab3: 0 of 2 figures; in Tagging Doctor’s patched copy, 2 more with alt text']);
    await p.open('lab3 (1).zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q-redrawn' }));
    await p.save('CHEM 2');
    expect(await reportAlt(p)).toEqual(['lab3: 0 of 2 figures; in Tagging Doctor’s patched copy, 1 more with alt text']);
    // Approved again for the new file: 2.
    p.approve('q.pdf', 'Q, redrawn');
    await settle();
    expect(await reportAlt(p)).toEqual(['lab3: 0 of 2 figures; in Tagging Doctor’s patched copy, 2 more with alt text']);
  });

  it('a figure removed: never more than the figures; a decorative mark is named, a TikZ text is not counted', async () => {
    const p = page();
    const v1 = doc('\\includegraphics{p.pdf}\n\\includegraphics{q.pdf}\n\\includegraphics{r.pdf}\n\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}');
    await p.open('hw4.zip', zip({ 'main.tex': v1, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q', 'r.pdf': '%PDF-r' }));
    await p.save('BIO 1');
    p.approve('p.pdf', 'P');
    p.approve('q.pdf', 'Q');
    p.choose('r.pdf', 'decorative');
    p.approve('TikZ picture', 'A line');
    await settle();
    expect(await reportAlt(p)).toEqual(['hw4: 0 of 4 figures; in Tagging Doctor’s patched copy, 2 more with alt text and 1 marked decorative']);
    await p.open('hw4 (1).zip', zip({ 'main.tex': doc('\\includegraphics{p.pdf}'), 'p.pdf': '%PDF-p' }));
    await p.save('BIO 1');
    expect(await reportAlt(p)).toEqual(['hw4: 0 of 1 figure; in Tagging Doctor’s patched copy, 1 more with alt text']);
  });

  it('kept: a project with nothing approved, one with no figures, and a scan saved before 5b say what they did', async () => {
    const p = page();
    await p.open('hw1.zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    await p.save('BIO 1');
    await p.open('hw2.zip', zip({ 'main.tex': doc('Text.') }));
    await p.save('BIO 1');
    const store = p.storeOf('u1');
    const [course] = await store.courses();
    await store.save(course.id, [{ name: 'old', mainFile: 'main.tex', scan: { data_as_of: '2026-11-19', summary: { mainFile: 'main.tex', verdict: 'v', blockers: 0, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 2, imagesWithoutAlt: 1, tikz: 0, tikzWithoutAlt: 0 } }, findings: [] } }]);
    expect((await reportAlt(p)).sort()).toEqual(['hw1: 0 of 2 figures', 'hw2: no figures', 'old: 1 of 2 figures']);
  });
});
