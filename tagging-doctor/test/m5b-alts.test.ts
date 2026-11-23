// @vitest-environment jsdom
/**
 * Milestone 5b, AC-51: approved alt texts are saved with the figure's path
 * and a hash of its file, and restored on a new drop when the file is
 * unchanged.
 */
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { listFigures, type FigureItem } from '../src/core/figures';
import { openProject } from '../src/core/project';
import { versionNames } from '../src/core/saved';
import { scanDocument } from '../src/core/scan';
import { altSync, figureKeys, restoreAlts, restoredWords, RESTORED_DECORATIVE_NOTE, RESTORED_NOTE, sha256Hex, staleNote, type SavedAlt } from '../src/lib/alts';
import { CourseStore, MemoryDb, type AltTextRow } from '../src/lib/store';
import { ALTS_NOT_READ, ALTS_NOT_SAVED, mountApp, type Account, type DroppedFile } from '../src/ui/app';
import { ALTS_KEPT, newChoice, type FigureChoice } from '../src/ui/figures';
import { KEEP_POINTS } from '../src/ui/pages';
import { statusIndex } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-23T12:00:00Z');
const sha = (b: Uint8Array | string) => createHash('sha256').update(typeof b === 'string' ? Buffer.from(b, 'utf8') : b).digest('hex');
const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
async function settle(n = 12) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

const TIKZ = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}';
const MAIN = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\usepackage{tikz}',
  '\\newcommand{\\logo}{\\includegraphics{#1}}',
  '\\begin{document}',
  '\\includegraphics{a.pdf}',
  '\\includegraphics{b.pdf}',
  '\\includegraphics{a.pdf}',
  TIKZ,
  '\\includegraphics{missing.pdf}',
  '\\end{document}',
  '',
].join('\n');

function zip(over: Record<string, string> = {}): Uint8Array {
  return zipSync({ 'main.tex': strToU8(over['main.tex'] ?? MAIN), 'a.pdf': strToU8(over['a.pdf'] ?? '%PDF-a'), 'b.pdf': strToU8(over['b.pdf'] ?? '%PDF-b') });
}

function figuresOf(bytes: Uint8Array): { project: ReturnType<typeof openProject>; figures: FigureItem[] } {
  const project = openProject('f.zip', bytes);
  const scan = scanDocument(project, 'main.tex', idx);
  return { project, figures: listFigures(project, scan) };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC-51: the slots and fingerprints', () => {
  it('SHA-256 in hex, as Node computes it', async () => {
    expect(await sha256Hex(strToU8('abc'))).toBe(sha('abc'));
    expect(await sha256Hex(strToU8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('an image by its path (again: #2), a TikZ picture by its file and number, and no slot for a missing file or a definition', async () => {
    const { project, figures } = figuresOf(zip());
    const keys = await figureKeys(project, figures);
    const byFile = (i: number) => keys.get(figures[i].id);
    // The \newcommand's #1 is listed first, with no slot.
    expect(figures.map((f) => f.file ?? f.kind)).toEqual(['#1', 'a.pdf', 'b.pdf', 'a.pdf', 'tikz', 'missing.pdf']);
    expect(byFile(0)).toBeUndefined();
    expect(byFile(1)).toEqual({ path: 'a.pdf', hash: sha('%PDF-a'), base: 'a.pdf' });
    expect(byFile(2)).toEqual({ path: 'b.pdf', hash: sha('%PDF-b'), base: 'b.pdf' });
    expect(byFile(3)).toEqual({ path: 'a.pdf#2', hash: sha('%PDF-a'), base: 'a.pdf' });
    expect(byFile(4)).toEqual({ path: 'main.tex#tikz-1', hash: sha(TIKZ), base: 'main.tex#tikz' });
    expect(byFile(5)).toBeUndefined();
    expect(keys.size).toBe(4);
  });

  it('one hash per file, and a file that cannot be read has no slot', async () => {
    const { project, figures } = figuresOf(zip());
    let calls = 0;
    const keys = await figureKeys(
      { ...project, bytes: (p: string) => (p === 'b.pdf' ? (() => { throw new Error('bad entry'); })() : project.bytes(p)) } as typeof project,
      figures,
      async (b) => {
        calls++;
        return sha(b);
      },
    );
    expect(calls).toBe(2); // a.pdf once for two uses, and the TikZ picture
    expect([...keys.values()].map((k) => k.path)).toEqual(['a.pdf', 'a.pdf#2', 'main.tex#tikz-1']);
  });

  it('without Web Crypto the fingerprint is refused, not faked', async () => {
    const saved = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      await expect(sha256Hex(strToU8('x'))).rejects.toThrow(/fingerprint/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true });
    }
  });

  it('versionNames: the name, then the name without a copy suffix', () => {
    expect(versionNames('hw1')).toEqual(['hw1']);
    expect(versionNames('hw1 (1)')).toEqual(['hw1 (1)', 'hw1']);
    expect(versionNames('hw1(12)')).toEqual(['hw1(12)', 'hw1']);
  });
});

describe('AC-51: restore and sync, as functions', () => {
  const fig = (id: string, extra: Partial<FigureItem> = {}) => ({ id, existing: null, ...extra }) as FigureItem;
  const row = (path: string, hash: string, text: string, decision = 'approved', source = 'model'): SavedAlt => ({ id: path, figure_path: path, figure_hash: hash, text, decision, source });
  const keys = new Map([
    ['f1', { path: 'a.pdf', hash: 'h1', base: 'a.pdf' }],
    ['f2', { path: 'b.pdf', hash: 'h2', base: 'b.pdf' }],
    ['f3', { path: 'c.pdf', hash: 'h3', base: 'c.pdf' }],
    ['f4', { path: 'd.pdf', hash: 'h4', base: 'd.pdf' }],
    ['f5', { path: 'e.pdf', hash: 'h5', base: 'e.pdf' }],
  ]);

  it('fills an unchanged file, notes a changed one, and leaves a figure the person started on', () => {
    const choices = new Map<string, FigureChoice>();
    choices.set('f3', { ...newChoice(), text: 'mine', status: 'draft' });
    const r = restoreAlts(
      [fig('f1'), fig('f2'), fig('f3'), fig('f4'), fig('f5', { existing: 'alt' })],
      keys,
      [row('a.pdf', 'h1', 'A chart'), row('b.pdf', 'old', 'Old text'), row('c.pdf', 'h3', 'Saved'), row('d.pdf', 'h4', '', 'decorative', 'typed'), row('e.pdf', 'h5', 'In source')],
      choices,
      newChoice,
    );
    expect(r).toEqual({ restored: ['f1', 'f4'], stale: ['f2'] });
    expect(choices.get('f1')).toMatchObject({ text: 'A chart', status: 'approved', source: 'model', note: RESTORED_NOTE });
    expect(choices.get('f2')).toMatchObject({ text: '', status: 'none', note: staleNote({ text: 'Old text', decision: 'approved' }) });
    expect(choices.get('f2')?.note).toContain('“Old text”');
    expect(choices.get('f3')).toMatchObject({ text: 'mine', status: 'draft', note: null });
    expect(choices.get('f4')).toMatchObject({ text: '', status: 'decorative', source: 'typed', note: RESTORED_DECORATIVE_NOTE });
    expect(choices.has('f5')).toBe(false);
    expect(staleNote({ text: '', decision: 'decorative' })).toMatch(/marked decorative, for an earlier version/);
  });

  it('an unknown source reads as typed; an approved row with no text is not filled', () => {
    const choices = new Map<string, FigureChoice>();
    const r = restoreAlts([fig('f1'), fig('f2')], keys, [row('a.pdf', 'h1', 'T', 'approved', 'odd'), row('b.pdf', 'h2', '  ')], choices, newChoice);
    expect(r.restored).toEqual(['f1']);
    expect(choices.get('f1')?.source).toBe('typed');
    expect(choices.get('f2')?.status).toBe('none');
  });

  it('sync writes approved and decorative figures, removes drafts and skips, and keeps figures with no choice', () => {
    const choices = new Map<string, FigureChoice>([
      ['f1', { ...newChoice(), text: '  A chart  ', drafted: 'A chart', status: 'approved', source: 'byok' }],
      ['f2', { ...newChoice(), status: 'decorative' }],
      ['f3', { ...newChoice(), text: 'half', status: 'draft' }],
      ['f4', { ...newChoice(), status: 'skipped' }],
    ]);
    const r = altSync([fig('f1'), fig('f2'), fig('f3'), fig('f4'), fig('f5'), fig('nokey')], keys, choices);
    expect(r.want).toEqual([
      { figure_path: 'a.pdf', figure_hash: 'h1', text: 'A chart', decision: 'approved', source: 'byok' },
      { figure_path: 'b.pdf', figure_hash: 'h2', text: '', decision: 'decorative', source: 'typed' },
    ]);
    expect(r.drop).toEqual(['c.pdf', 'd.pdf']);
  });

  it('the panel line', () => {
    expect(restoredWords(0, 0)).toBeNull();
    expect(restoredWords(1, 0)).toBe('1 alt text restored from the saved project, for files that are unchanged.');
    expect(restoredWords(2, 1)).toBe('2 alt texts restored from the saved project, for files that are unchanged; 1 figure has a saved text for an earlier version of its file, shown on the figure.');
    expect(restoredWords(0, 3)).toBe('3 figures have a saved text for an earlier version of its file, shown on the figure.');
  });
});

describe('AC-51: the store', () => {
  it('inserts, updates only what changed, removes, and keeps one row per slot', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    const [{ project }] = await store.save(c.id, [{ name: 'f', mainFile: 'main.tex', scan: { data_as_of: 'x', summary: {} as never, findings: [] } }]);
    const w = (path: string, text: string, hash = 'h') => ({ figure_path: path, figure_hash: hash, text, decision: 'approved' as const, source: 'typed' as const });
    expect(await store.syncAltTexts(project.id, [w('a.pdf', 'A'), w('b.pdf', 'B')], [])).toEqual({ written: 2, removed: 0 });
    const first = await store.altTexts(project.id);
    expect(first.map((r) => [r.figure_path, r.text, r.figure_hash, r.updated_at > ''])).toEqual([
      ['a.pdf', 'A', 'h', true],
      ['b.pdf', 'B', 'h', true],
    ]);
    expect(await store.syncAltTexts(project.id, [w('a.pdf', 'A'), w('b.pdf', 'B2', 'h2')], ['c.pdf'])).toEqual({ written: 1, removed: 0 });
    expect(await store.syncAltTexts(project.id, [], ['a.pdf', 'a.pdf'])).toEqual({ written: 0, removed: 1 });
    const rows = await store.altTexts(project.id);
    expect(rows.map((r) => [r.figure_path, r.text, r.figure_hash])).toEqual([['b.pdf', 'B2', 'h2']]);
    // The table's unique slot, as the database has it.
    await expect(db.insert('alt_texts', { project_id: project.id, ...w('b.pdf', 'again') })).rejects.toThrow(/duplicate/);
    expect(await store.projectsMatching('f', 'main.tex')).toHaveLength(1);
    expect(await store.projectsMatching('f', 'other.tex')).toHaveLength(0);
    // The history and the export carry them.
    expect((await store.history(project.id))?.altTexts).toHaveLength(1);
    expect((await store.exportAll()).alt_texts).toHaveLength(1);
  });
});

describe('AC-51: the page', () => {
  function page(signedIn = true) {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    let user: ((u: { id: string } | null) => void) | null = null;
    const account: Account = {
      mountSignIn: () => () => {},
      onUser: (cb) => {
        user = cb;
        cb(signedIn ? { id: 'u1' } : null);
      },
      store: () => store,
    };
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account });
    const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
    const items = () => [...root.querySelectorAll('li.figure-item')] as HTMLElement[];
    const item = (file: string, nth = 0) => items().filter((li) => li.querySelector('h4')?.textContent?.endsWith(file))[nth];
    const approve = (li: HTMLElement, text: string) => {
      const ta = li.querySelector('textarea') as HTMLTextAreaElement;
      ta.value = text;
      ta.dispatchEvent(new Event('input'));
      (li.querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    };
    const choose = (li: HTMLElement, role: string) => (li.querySelector(`[data-role="${role}"]`) as HTMLButtonElement).click();
    const save = async (course?: string) => {
      button('Save').click();
      await settle();
      if (course) {
        // A new course: the list's "new course" choice, then its name.
        const pick = root.querySelector('#save-course') as HTMLSelectElement | null;
        if (pick) {
          pick.value = '';
          pick.dispatchEvent(new Event('change'));
          await settle();
        }
        (root.querySelector('#save-course-name') as HTMLInputElement).value = course;
      } else {
        const pick = root.querySelector('#save-course') as HTMLSelectElement;
        pick.value = pick.options[pick.options.length - 1].value;
        pick.dispatchEvent(new Event('change'));
        await settle();
      }
      root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
      await settle(30);
    };
    const rows = async () => (await db.select<AltTextRow>('alt_texts')).map((r) => [r.figure_path, r.figure_hash, r.text, r.decision, r.source]);
    return { root, app, db, store, button, items, item, approve, choose, save, rows, signOut: () => user?.(null) };
  }

  it('a saved project keeps the approved texts with path and hash, and a new drop gets them back where the file is unchanged', async () => {
    const p = page();
    await p.app.handleFile(file('f.zip', zip()));
    p.button('Alt text for figures').click();
    expect(p.root.querySelector('.figures-panel')?.textContent).toContain(ALTS_KEPT);
    // Approved before the save: kept once the scan is saved.
    p.approve(p.item('a.pdf'), 'A rising line chart');
    await settle();
    expect(await p.rows()).toEqual([]);
    await p.save('Course');
    expect(await p.rows()).toEqual([['a.pdf', sha('%PDF-a'), 'A rising line chart', 'approved', 'typed']]);
    // After the save, each choice is saved as it is made.
    p.choose(p.item('b.pdf'), 'decorative');
    p.approve(p.items()[4], 'Two points joined by a line');
    p.approve(p.item('a.pdf', 1), 'The same chart, smaller');
    await settle();
    expect((await p.rows()).sort()).toEqual(
      [
        ['a.pdf', sha('%PDF-a'), 'A rising line chart', 'approved', 'typed'],
        ['a.pdf#2', sha('%PDF-a'), 'The same chart, smaller', 'approved', 'typed'],
        ['b.pdf', sha('%PDF-b'), '', 'decorative', 'typed'],
        ['main.tex#tikz-1', sha(TIKZ), 'Two points joined by a line', 'approved', 'typed'],
      ].sort(),
    );

    // A new version: b.pdf changed, the rest unchanged; a browser's copy name.
    await p.app.handleFile(file('f (1).zip', zip({ 'b.pdf': '%PDF-b2' })));
    p.button('Alt text for figures').click();
    await settle();
    const a = p.item('a.pdf');
    expect((a.querySelector('textarea') as HTMLTextAreaElement).value).toBe('A rising line chart');
    expect(a.querySelector('.alt-status')?.textContent).toBe('Approved: in the patched copy as its alt text.');
    expect(a.querySelector('.note')?.textContent).toBe(RESTORED_NOTE);
    expect((p.item('a.pdf', 1).querySelector('textarea') as HTMLTextAreaElement).value).toBe('The same chart, smaller');
    expect((p.items()[4].querySelector('textarea') as HTMLTextAreaElement).value).toBe('Two points joined by a line');
    const b = p.item('b.pdf');
    expect(b.querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
    expect(b.querySelector('.note')?.textContent).toMatch(/marked decorative, for an earlier version of its file/);
    expect(p.root.querySelector('.figures-status')?.textContent).toBe(
      '3 alt texts restored from the saved project, for files that are unchanged; 1 figure has a saved text for an earlier version of its file, shown on the figure.',
    );

    // Saved again to the same project: taking an approval back removes its row; the changed file's slot takes the new hash.
    await p.save();
    expect(await p.store.courses()).toHaveLength(1);
    expect((await p.db.select('projects')).length).toBe(1);
    p.choose(p.item('a.pdf', 1), 'skip');
    p.approve(p.item('b.pdf'), 'A new photo');
    await settle();
    expect((await p.rows()).sort()).toEqual(
      [
        ['a.pdf', sha('%PDF-a'), 'A rising line chart', 'approved', 'typed'],
        ['b.pdf', sha('%PDF-b2'), 'A new photo', 'approved', 'typed'],
        ['main.tex#tikz-1', sha(TIKZ), 'Two points joined by a line', 'approved', 'typed'],
      ].sort(),
    );
  });

  it('what the person started on in the new drop is kept; signed out, nothing is read or written', async () => {
    const p = page();
    await p.app.handleFile(file('f.zip', zip()));
    await p.save('Course');
    p.button('Alt text for figures').click();
    p.approve(p.item('a.pdf'), 'Saved text');
    await settle();
    // The new drop: the person types before the restore can run (the panel opens on the scan).
    await p.app.handleFile(file('f.zip', zip()));
    p.button('Alt text for figures').click();
    const ta = p.item('a.pdf').querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Typed now';
    ta.dispatchEvent(new Event('input'));
    await settle();
    expect((p.item('a.pdf').querySelector('textarea') as HTMLTextAreaElement).value).toBe('Typed now');
    expect(p.root.querySelector('.figures-status')?.textContent).toBe('');

    // Signed out: a third drop reads nothing.
    p.signOut();
    let reads = 0;
    const altTexts = p.store.altTexts.bind(p.store);
    p.store.altTexts = async (id) => {
      reads++;
      return altTexts(id);
    };
    const matching = p.store.projectsMatching.bind(p.store);
    p.store.projectsMatching = async (n, m) => {
      reads++;
      return matching(n, m);
    };
    await p.app.handleFile(file('f.zip', zip()));
    p.button('Alt text for figures').click();
    await settle();
    expect(reads).toBe(0);
    expect((p.item('a.pdf').querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('two saved projects of the same name: nothing is filled until the scan is saved to one of them', async () => {
    const p = page();
    for (const course of ['One', 'Two']) {
      await p.app.handleFile(file('f.zip', zip()));
      await p.save(course);
      p.button('Alt text for figures').click();
      p.approve(p.item('a.pdf'), `Text in ${course}`);
      await settle();
    }
    await p.app.handleFile(file('f.zip', zip()));
    p.button('Alt text for figures').click();
    await settle();
    expect((p.item('a.pdf').querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    // Saved to course One (the first in the list): its text comes back.
    p.button('Save').click();
    await settle();
    const pick = p.root.querySelector('#save-course') as HTMLSelectElement;
    pick.value = [...pick.options].find((o) => o.textContent?.startsWith('One'))?.value ?? '';
    pick.dispatchEvent(new Event('change'));
    await settle();
    p.root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
    await settle(30);
    expect((p.item('a.pdf').querySelector('textarea') as HTMLTextAreaElement).value).toBe('Text in One');
  });

  it('a failure to read or to write says so in the figure panel', async () => {
    const p = page();
    await p.app.handleFile(file('f.zip', zip()));
    await p.save('Course');
    p.store.syncAltTexts = async () => {
      throw new Error('offline');
    };
    p.button('Alt text for figures').click();
    p.approve(p.item('a.pdf'), 'Text');
    await settle();
    expect(p.root.querySelector('.figures-status')?.textContent).toBe(ALTS_NOT_SAVED);
    p.store.altTexts = async () => {
      throw new Error('offline');
    };
    await p.app.handleFile(file('f.zip', zip()));
    p.button('Alt text for figures').click();
    await settle();
    expect(p.root.querySelector('.figures-status')?.textContent).toBe(ALTS_NOT_READ);
  });

  it('What we keep says what is kept, and that the file is not', () => {
    expect(KEEP_POINTS.join(' ')).toMatch(/SHA-256 fingerprint of the file’s contents[^.]*never the file/);
  });
});
