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

describe('the minors of round 1', () => {
  it('R5b.1-3: the banner’s Save of an earlier drop does not tie the drop on the page to that project; a save of this drop does', async () => {
    const session = new Map<string, string>();
    const sess = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    let cb: ((u: { id: string } | null) => void) | null = null;
    let who: string | null = null;
    const account: Account = { mountSignIn: () => () => {}, onUser: (f) => ((cb = f), f(who ? { id: who } : null)), store: () => store };
    const mount = () => {
      document.body.innerHTML = '<div id="app"></div>';
      const root = document.getElementById('app') as HTMLElement;
      return { root, app: mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: sess, download: () => {}, pause: async () => {}, account }) };
    };
    const btn = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
    // Signed out: scan A and choose Save; the page keeps the save for after the sign-in.
    let { root, app } = mount();
    await app.handleFile(file('A.zip', zip({ 'main.tex': doc('\\includegraphics{a.pdf}'), 'a.pdf': '%PDF-A' })));
    btn(root, 'Save').click();
    await settle();
    // The sign-in reloads the page.
    who = 'u1';
    ({ root, app } = mount());
    await settle();
    expect(root.querySelector('#pending')?.textContent).toContain('You scanned A before signing in');
    await app.handleFile(file('B.zip', zip({ 'main.tex': doc('\\includegraphics{a.pdf}'), 'a.pdf': '%PDF-B' })));
    btn(root, 'Alt text for figures').click();
    const li = root.querySelector('li.figure-item') as HTMLElement;
    const ta = li.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Text for B';
    ta.dispatchEvent(new Event('input'));
    (li.querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    btn(root, 'Save to a course').click();
    await settle();
    (root.querySelector('#save-course-name') as HTMLInputElement).value = 'C';
    root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
    await settle(30);
    expect((await db.select<{ name: string }>('projects')).map((p) => p.name)).toEqual(['A']);
    expect(await db.select('alt_texts')).toEqual([]);
    // Kept: a save asked for signed out and finished after a sign-in on the same page keeps this drop's texts.
    who = null;
    ({ root, app } = mount());
    await app.handleFile(file('D.zip', zip({ 'main.tex': doc('\\includegraphics{a.pdf}'), 'a.pdf': '%PDF-D' })));
    btn(root, 'Alt text for figures').click();
    const li2 = root.querySelector('li.figure-item') as HTMLElement;
    const ta2 = li2.querySelector('textarea') as HTMLTextAreaElement;
    ta2.value = 'Text for D';
    ta2.dispatchEvent(new Event('input'));
    (li2.querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    btn(root, 'Save').click();
    await settle();
    who = 'u1';
    (cb as ((u: { id: string } | null) => void) | null)?.({ id: 'u1' });
    await settle();
    const pick = root.querySelector('#save-course') as HTMLSelectElement;
    pick.value = [...pick.options].find((o) => o.textContent?.startsWith('C'))?.value ?? '';
    pick.dispatchEvent(new Event('change'));
    await settle();
    root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
    await settle(30);
    expect((await db.select<AltTextRow>('alt_texts')).map((r) => r.text)).toEqual(['Text for D']);
  });

  it('R5b.1-4: a picture added above two others does not shift their texts; unchanged pictures come back', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { figureKeys, restoreAlts } = await import('../src/lib/alts');
    const { newChoice } = await import('../src/ui/figures');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const pic = (n: number) => `\\begin{tikzpicture}\\draw (0,0) -- (${n},${n});\\end{tikzpicture}`;
    const keysOf = async (body: string) => {
      const p = openProject('t.zip', zip({ 'main.tex': doc(body) }));
      const figures = listFigures(p, scanDocument(p, 'main.tex', idx));
      return { figures, keys: await figureKeys(p, figures) };
    };
    const v1 = await keysOf(`${pic(1)}\n${pic(2)}`);
    const rows = v1.figures.map((f, i) => ({ id: `r${i}`, figure_path: v1.keys.get(f.id)?.path ?? '', figure_hash: v1.keys.get(f.id)?.hash ?? '', text: `Picture ${i + 1}`, decision: 'approved', source: 'typed' }));
    const v2 = await keysOf(`${pic(9)}\n${pic(1)}\n${pic(2)}`);
    const choices = new Map();
    const r = restoreAlts(v2.figures, v2.keys, rows, choices, newChoice);
    expect(v2.figures.map((f) => choices.get(f.id)?.text ?? '')).toEqual(['', 'Picture 1', 'Picture 2']);
    expect(r.restored).toHaveLength(2);
    // The new picture is not told another picture's text was its own.
    expect(choices.get(v2.figures[0].id)?.note ?? null).toBeNull();
    // Kept: a picture whose source changed still shows its earlier text; two identical pictures keep two slots.
    const v3 = await keysOf(`${pic(1)}\n${pic(3)}`);
    const c3 = new Map();
    restoreAlts(v3.figures, v3.keys, rows, c3, newChoice);
    expect(c3.get(v3.figures[1].id)?.note).toContain('Picture 2');
    const same = await keysOf(`${pic(1)}\n${pic(1)}`);
    expect(new Set([...same.keys.values()].map((k) => k.path)).size).toBe(2);
  });

  it('R5b.1-5: a nested picture, an end with a space, and a data file the picture reads change its fingerprint; a picture with no end has no slot', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { figureKeys } = await import('../src/lib/alts');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const hash = async (body: string, extra: Record<string, string> = {}) => {
      const p = openProject('t.zip', zip({ 'main.tex': doc(body), ...extra }));
      const figures = listFigures(p, scanDocument(p, 'main.tex', idx));
      const keys = await figureKeys(p, figures);
      return keys.get(figures[0].id)?.hash ?? null;
    };
    const nested = (n: number) => `\\begin{tikzpicture}\\node {\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}};\n\\draw (0,0) -- (${n},${n});\\end{tikzpicture}`;
    expect(await hash(nested(1))).not.toBe(await hash(nested(9)));
    const spaced = (n: number) => `\\begin{tikzpicture}\\draw (0,0) -- (${n},${n});\\end {tikzpicture}`;
    expect(await hash(spaced(1))).not.toBe(await hash(spaced(9)));
    const input = '\\begin{tikzpicture}\\input{plot.tikz}\\end{tikzpicture}';
    expect(await hash(input, { 'plot.tikz': '\\draw (0,0) -- (1,1);' })).not.toBe(await hash(input, { 'plot.tikz': '\\draw (0,0) -- (9,9);' }));
    expect(await hash('\\begin{tikzpicture}\\addplot table {data.csv};\\end{tikzpicture}', { 'data.csv': '1 2' })).not.toBe(await hash('\\begin{tikzpicture}\\addplot table {data.csv};\\end{tikzpicture}', { 'data.csv': '1 3' }));
    expect(await hash('\\begin{tikzpicture}\\draw (0,0);')).toBeNull();
    // Kept: the plain picture's fingerprint is that of its lines.
    const plain = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}';
    const { createHash } = await import('node:crypto');
    expect(await hash(plain)).toBe(createHash('sha256').update(plain).digest('hex'));
  });

  it('R5b.1-7: a caption in the minipage beside the image is found; a section label in a body minipage is not the figure’s', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const figs = (body: string) => {
      const p = openProject('t.zip', zip({ 'main.tex': doc(body) }));
      return listFigures(p, scanDocument(p, 'main.tex', idx)).map((f) => [f.caption, f.label]);
    };
    expect(figs('\\begin{figure}\\begin{minipage}{.5\\textwidth}\\includegraphics{a}\\end{minipage}\\begin{minipage}{.5\\textwidth}\\caption{Side caption}\\label{fig:side}\\end{minipage}\\end{figure}')).toEqual([['Side caption', 'fig:side']]);
    expect(figs('\\begin{minipage}{\\textwidth}\\section{S}\\label{sec:s}\\includegraphics{a}\\end{minipage}')).toEqual([['', '']]);
    // Kept: two minipages with a caption each; two subfigures and a main image.
    expect(figs('\\begin{figure}\\begin{minipage}{.5\\textwidth}\\includegraphics{a}\\caption{Left one}\\end{minipage}\\begin{minipage}{.5\\textwidth}\\includegraphics{b}\\caption{Right one}\\end{minipage}\\end{figure}')).toEqual([
      ['Left one', ''],
      ['Right one', ''],
    ]);
    expect(figs('\\begin{figure}\\begin{subfigure}{.4\\textwidth}\\includegraphics{a}\\caption{Sub A}\\end{subfigure}\\begin{subfigure}{.4\\textwidth}\\includegraphics{b}\\caption{Sub B}\\end{subfigure}\\includegraphics{c}\\caption{Main}\\end{figure}')).toEqual([
      ['Sub A', ''],
      ['Sub B', ''],
      ['Main', ''],
    ]);
  });

  it('R5b.1-8 (c): a neighbour’s folders go from options with brackets and from \\input and \\includepdf', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const p = openProject('t.zip', zip({ 'main.tex': doc('\\includegraphics[width=\\linewidth,alt={x [y] z}]{/Users/me/secret/one.png}\nText \\input{/Users/me/secret/part} and \\includepdf{/Users/me/secret/doc.pdf}.\n\\includegraphics{b.pdf}') }));
    const f = listFigures(p, scanDocument(p, 'main.tex', idx)).find((x) => x.file === 'b.pdf');
    expect(f?.before).not.toContain('/Users/');
    expect(f?.before).toContain('{one.png}');
    expect(f?.before).toContain('\\input{part}');
    expect(f?.before).toContain('\\includepdf{doc.pdf}');
  });

  it('R5b.1-8 (a), (e): the restore note goes on typing; a deleted project says so, and lets Save be chosen again', async () => {
    const p = page();
    await p.open('lab.zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    await p.save('Course');
    p.approve('p.pdf', 'Old chart');
    await settle();
    await p.open('lab (1).zip', zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': '%PDF-q' }));
    expect(p.item('p.pdf').querySelector('.note')?.textContent).toBe(RESTORED_NOTE);
    p.approve('p.pdf', 'New chart with 2026 data');
    expect(p.item('p.pdf').querySelector('.note')).toBeNull();
    // Saved to the project, which is then deleted elsewhere: the next approval says so.
    await p.save('Course');
    const store = p.storeOf('u1');
    const [proj] = await store.projects((await store.courses())[0].id);
    await store.deleteProject(proj.id);
    p.approve('q.pdf', 'After the delete');
    await settle();
    expect(p.root.querySelector('.figures-status')?.textContent).toBe((await import('../src/ui/app')).ALTS_PROJECT_GONE);
  });
});

describe('the minors of round 1, in the figure panel', () => {
  async function panel(answer: (n: number) => Promise<unknown>, opts: { gateway?: boolean; figures?: number; check?: () => Promise<unknown> } = {}) {
    const { mountFixes, newFixesState } = await import('../src/ui/fixes');
    const { memoryStorage, setByokKey } = await import('../src/lib/llm');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const n = opts.figures ?? 12;
    const pr = openProject('t.zip', zip({ 'main.tex': doc(Array.from({ length: n }, (_, i) => `\\includegraphics{f${i}.pdf}`).join('\n')) }));
    const storage = memoryStorage();
    if (!opts.gateway) setByokKey('k', storage);
    document.body.innerHTML = '<div id="p"></div>';
    const el = document.getElementById('p') as HTMLElement;
    let calls = 0;
    let checks = 0;
    const state = newFixesState();
    mountFixes(el, {
      project: pr,
      scan: scanDocument(pr, 'main.tex', idx),
      state,
      downloadBlob: () => {},
      onClose: () => {},
      figures: {
        signedIn: () => true,
        storage,
        draft: {
          ask: (async () => answer(calls++)) as never,
          check: (async () => {
            checks++;
            return opts.check ? opts.check() : { allowed: true, scope: null, resets_at: null, limits: [{ scope: 'user-day', unit: 'usd', used: 0.0012 * checks, cap: 0.0024, resets_at: '' }], calls_left: null };
          }) as never,
        },
      },
    });
    return { el, state, calls: () => calls, checks: () => checks };
  }
  const reply = (t: string) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: t }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  const refusal = (msg: string) => Object.assign(new Error('400'), { status: 400, error: { error: { message: msg } } });

  it('R5b.1-6: two neighbouring figures with their own 400 do not stop Draft all; a key with no credit still does', async () => {
    const s = await panel(async (n) => (n < 2 ? Promise.reject(refusal('Could not process image')) : reply(`Draft ${n}`)));
    (s.el.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await settle(30);
    expect(s.calls()).toBe(12);
    expect(s.el.querySelector('.figures-status')?.textContent).toMatch(/^Asked for 12 drafts/);
    const c = await panel(async () => Promise.reject(refusal('Your credit balance is too low to access the Anthropic API.')));
    (c.el.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await settle(30);
    expect(c.calls()).toBeLessThanOrEqual(4);
    expect(c.el.querySelector('.figures-status')?.textContent).toMatch(/Anthropic refused two in a row/);
  });

  it('R5b.1-8 (b): the allowance line is asked for again after a single gateway draft', async () => {
    const s = await panel(async () => reply('One'), { gateway: true, figures: 2 });
    await settle();
    expect(s.checks()).toBe(1);
    expect(s.el.querySelector('.draft-mode')?.textContent).toContain('About 2 drafts are left');
    (s.el.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
    await settle();
    expect(s.checks()).toBe(2);
    expect(s.el.querySelector('.draft-mode')?.textContent).toContain('about no drafts left for you today');
  });

  it('the saved source: a draft approved as it came is the model’s; edited, or marked decorative, it is the person’s', async () => {
    const { altSync } = await import('../src/lib/alts');
    const s = await panel(async () => reply('A model text'), { figures: 3 });
    for (const li of [...s.el.querySelectorAll('li.figure-item')] as HTMLElement[]) (li.querySelector('[data-role="draft"]') as HTMLButtonElement).click();
    await settle();
    const lis = () => [...s.el.querySelectorAll('li.figure-item')] as HTMLElement[];
    (lis()[0].querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    const ta = lis()[1].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'My own words over the draft';
    ta.dispatchEvent(new Event('input'));
    (lis()[1].querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    (lis()[2].querySelector('[data-role="decorative"]') as HTMLButtonElement).click();
    const ids = [...s.state.alts.keys()];
    const keys = new Map(ids.map((id, i) => [id, { path: `f${i}.pdf`, hash: 'h', base: `f${i}.pdf` }]));
    const { want } = altSync(ids.map((id) => ({ id, existing: null }) as never), keys, s.state.alts);
    expect(want.map((w) => [w.figure_path, w.source])).toEqual([
      ['f0.pdf', 'byok'],
      ['f1.pdf', 'typed'],
      ['f2.pdf', 'typed'],
    ]);
  });
});
