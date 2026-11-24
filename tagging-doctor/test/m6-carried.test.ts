// @vitest-environment jsdom
/**
 * Milestone 6: the minor findings carried from milestones 4b and 5b, each
 * beside the nearest case the old code got right and another form of it.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { listFigures } from '../src/core/figures';
import { applyFixes } from '../src/core/patch';
import { openProject } from '../src/core/project';
import { scanDocument } from '../src/core/scan';
import { figureKeys, restoreAlts, staleNote, type SavedAlt } from '../src/lib/alts';
import { memoryStorage, setByokKey } from '../src/lib/llm';
import { CourseStore, MemoryDb, type JobRow } from '../src/lib/store';
import { newChoice } from '../src/ui/figures';
import { forgetRestored, mountFixes, newFixesState } from '../src/ui/fixes';
import { doc, idx, NOW, page, settle, zip } from './alt-page';
import { card, setup } from './patch-helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const TWO = doc('\\includegraphics{p.pdf}\n\\includegraphics{q.pdf}');
const v = (q = '%PDF-q') => zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': q });
const status = (p: ReturnType<typeof page>, name: string) => p.item(name).querySelector('.alt-status')?.textContent ?? '';

describe('R5b.3-1: a choice made without typing, on a figure the restore only noted or marked, stays at sign-out', () => {
  for (const [role, words] of [
    ['decorative', /^Decorative/],
    ['skip', /^Skipped/],
  ] as const) {
    it(`the stale note, then ${role}: the choice stays after the sign-out`, async () => {
      const p = page();
      await p.open('lab.zip', v());
      await p.save('Course');
      p.approve('q.pdf', 'Q, first plot');
      await settle();
      await p.open('lab (1).zip', v('%PDF-q-redrawn'));
      expect(p.item('q.pdf').querySelector('.note')?.textContent).toContain('Q, first plot');
      p.choose('q.pdf', role);
      p.as(null);
      await settle();
      expect(status(p, 'q.pdf')).toMatch(words);
      expect(p.root.querySelector('#fixes')?.textContent).not.toContain('Q, first plot');
    });
  }

  it('another form: a restored decorative mark changed to Skip stays Skipped after the sign-out', async () => {
    const p = page();
    await p.open('lab.zip', v());
    await p.save('Course');
    p.choose('q.pdf', 'decorative');
    await settle();
    await p.open('lab (1).zip', v());
    expect(status(p, 'q.pdf')).toMatch(/^Decorative/);
    p.choose('q.pdf', 'skip');
    p.as(null);
    await settle();
    expect(status(p, 'q.pdf')).toMatch(/^Skipped/);
  });

  it('kept: a stale note left alone goes, a restored decorative mark left alone is emptied, a restored text with Skip is emptied', async () => {
    const p = page();
    await p.open('lab.zip', v());
    await p.save('Course');
    p.approve('p.pdf', 'P of u1');
    p.choose('q.pdf', 'decorative');
    await settle();
    await p.open('lab (1).zip', v());
    expect(status(p, 'q.pdf')).toMatch(/^Decorative/);
    p.choose('p.pdf', 'skip');
    p.as(null);
    await settle();
    expect(p.text('p.pdf')).toBe('');
    expect(status(p, 'p.pdf')).toBe('No alt text yet.');
    expect(status(p, 'q.pdf')).toBe('No alt text yet.');

    const s = page();
    await s.open('lab.zip', v());
    await s.save('Course');
    s.approve('q.pdf', 'Q, first plot');
    await settle();
    await s.open('lab (1).zip', v('%PDF-q-redrawn'));
    s.as(null);
    await settle();
    expect(s.item('q.pdf').querySelector('.note')).toBeNull();
    expect(status(s, 'q.pdf')).toBe('No alt text yet.');
  });
});

describe('R5b.3-4 (d): an emptied choice keeps no text read from the account', () => {
  it('a model-drafted saved text: `drafted` goes with the text; kept: an edited text keeps its own fields', () => {
    const state = newFixesState();
    state.alts.set('a', { ...newChoice(), text: 'Saved', drafted: 'Saved', source: 'model', status: 'approved', note: 'n' });
    state.restored.set('a', { text: 'Saved', status: 'approved', note: 'n' });
    state.alts.set('b', { ...newChoice(), text: 'Mine now', drafted: 'Saved B', source: 'model', status: 'draft', note: 'm' });
    state.restored.set('b', { text: 'Saved B', status: 'approved', note: 'm' });
    expect(forgetRestored(state).sort()).toEqual(['a', 'b']);
    expect(state.alts.get('a')).toMatchObject({ text: '', status: 'none', source: 'typed' });
    expect(state.alts.get('a')?.drafted).toBeUndefined();
    expect(state.alts.get('b')).toMatchObject({ text: 'Mine now', note: null });
  });
});

describe('R5b.3-2: an image used three times, a use removed, the texts do not change places', () => {
  const uses = (n: number) => doc(Array.from({ length: n }, () => '\\includegraphics{logo.pdf}').join('\n'));
  async function restore(n: number, rows: [string, string][]) {
    const p = openProject('t.zip', zip({ 'main.tex': uses(n), 'logo.pdf': '%PDF-logo' }));
    const figures = listFigures(p, scanDocument(p, 'main.tex', idx));
    const keys = await figureKeys(p, figures);
    const hash = keys.get(figures[0].id)?.hash ?? '';
    const saved: SavedAlt[] = rows.map(([path, text], i) => ({ id: `r${i}`, figure_path: path, figure_hash: hash, text, decision: 'approved', source: 'typed' }));
    const choices = new Map();
    restoreAlts(figures, keys, saved, choices, newChoice);
    return figures.map((f) => choices.get(f.id)?.text ?? '');
  }

  it('texts on the second and third use, a use removed: the second use keeps its own text, none moves to the first', async () => {
    expect(await restore(2, [['logo.pdf#2', 'Use 2'], ['logo.pdf#3', 'Use 3']])).toEqual(['', 'Use 2']);
  });

  it('kept: unchanged, three in place; the second use only; texts on the first two with two uses', async () => {
    expect(await restore(3, [['logo.pdf#2', 'Use 2'], ['logo.pdf#3', 'Use 3']])).toEqual(['', 'Use 2', 'Use 3']);
    expect(await restore(3, [['logo.pdf', 'Use 1'], ['logo.pdf#2', 'Use 2'], ['logo.pdf#3', 'Use 3']])).toEqual(['Use 1', 'Use 2', 'Use 3']);
    expect(await restore(2, [['logo.pdf#2', 'Use 2']])).toEqual(['', 'Use 2']);
    expect(await restore(2, [['logo.pdf', 'Use 1'], ['logo.pdf#2', 'Use 2']])).toEqual(['Use 1', 'Use 2']);
  });

  it('kept (R5b.1-4): one use left, and its row at another slot, still takes it', async () => {
    expect(await restore(1, [['logo.pdf#2', 'Use 2']])).toEqual(['Use 2']);
  });
});

describe('R5b.3-3: the figure list reads a picture’s files without adding to the scan’s warnings', () => {
  const pic = (read: string) => doc(`\\begin{tikzpicture}\\begin{axis}\\addplot ${read};\\end{axis}\\end{tikzpicture}`);
  it('a data file over 4 MB: no new warning; another form, `file {…}`; kept: a small file still changes the fingerprint', async () => {
    const big = 'x,y\n'.repeat(1_100_000);
    for (const read of ['table {big.csv}', 'file {big.csv}']) {
      const p = openProject('t.zip', zipSync({ 'main.tex': strToU8(pic(read)), 'big.csv': strToU8(big) }));
      const before = p.warnings.length;
      listFigures(p, scanDocument(p, 'main.tex', idx));
      expect(p.warnings.length).toBe(before);
      expect(p.warnings.map((w) => w.path)).not.toContain('big.csv');
    }
    const hashOf = async (data: string) => {
      const p = openProject('t.zip', zip({ 'main.tex': pic('table {d.csv}'), 'd.csv': data }));
      const figures = listFigures(p, scanDocument(p, 'main.tex', idx));
      return (await figureKeys(p, figures)).get(figures[0].id)?.hash;
    };
    expect(await hashOf('1,2')).not.toBe(await hashOf('1,3'));
  });

  it('a damaged entry the picture inputs: the list does not throw and adds no warning', () => {
    const main = pic('table {data.csv}').replace('\\addplot table {data.csv};', '\\input{part.tex}');
    const z = zipSync({ 'main.tex': [strToU8(main), { level: 0 }], 'part.tex': [new Uint8Array(4000).map((_, i) => (i * 7) % 251), { level: 9 }] });
    const mark = (sig: number[], nameAt: number, methodAt: number) => {
      for (let k = 0; k < z.length - 4; k++) if (sig.every((b, j) => z[k + j] === b) && new TextDecoder().decode(z.subarray(k + nameAt, k + nameAt + 8)) === 'part.tex') z[k + methodAt] = 99;
    };
    mark([0x50, 0x4b, 3, 4], 30, 8);
    mark([0x50, 0x4b, 1, 2], 46, 10);
    const p = openProject('bad.zip', z);
    const scan = scanDocument(p, 'main.tex', idx);
    const before = p.warnings.length;
    expect(() => listFigures(p, scan)).not.toThrow();
    expect(p.warnings.length).toBe(before);
  });
});

describe('R5b.3-4 (a): a project’s own class that loads a Beamer class is stopped', () => {
  const deck = (cls: string) => `\\documentclass{${cls}}\n\\begin{document}\nx\n\\end{document}\n`;
  it('mybeamer.cls loading ctexbeamer, by \\LoadClass and by \\LoadClassWithOptions; kept: notbeamer.cls loading article gets the line, beamer is stopped', () => {
    expect(card(setup({ 'main.tex': deck('mybeamer'), 'mybeamer.cls': '\\LoadClass{ctexbeamer}\n' }).plan, 'metadata')?.state).toBe('not-done');
    expect(card(setup({ 'main.tex': deck('mybeamer'), 'mybeamer.cls': '\\LoadClassWithOptions{ctexbeamer}\n' }).plan, 'metadata')?.state).toBe('not-done');
    expect(card(setup({ 'main.tex': deck('notbeamer'), 'notbeamer.cls': '\\LoadClass{article}\n' }).plan, 'metadata')?.state).toBe('ready');
    expect(card(setup({ 'main.tex': deck('beamer') }).plan, 'metadata')?.state).toBe('not-done');
    expect(card(setup({ 'main.tex': deck('article') }).plan, 'metadata')?.state).toBe('ready');
  });
});

/** The figure panel on six figures with a stand-in model, as in m5b-r2's (g) tests. */
async function panel(answer: (n: number) => Promise<unknown>, n = 6) {
  const pr = openProject('t.zip', zip({ 'main.tex': doc(Array.from({ length: n }, (_, i) => `\\includegraphics{f${i}.pdf}`).join('\n')) }));
  const storage = memoryStorage();
  setByokKey('k', storage);
  document.body.innerHTML = '<div id="p"></div>';
  const el = document.getElementById('p') as HTMLElement;
  let calls = 0;
  const state = newFixesState();
  mountFixes(el, { project: pr, scan: scanDocument(pr, 'main.tex', idx), state, downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false, storage, draft: { ask: (async () => answer(calls++)) as never } } });
  return { el, state, calls: () => calls };
}
const refusal = (status: number, msg: string) => Object.assign(new Error(String(status)), { status, error: { error: { message: msg } } });
const reply = (t: string) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: t }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

describe('R5b.3-4 (b): Draft all stops only at refusals every call would meet', () => {
  it('two content-filter refusals in a row do not stop the run; another form, a policy refusal', async () => {
    for (const msg of ['Output blocked by content filtering policy', 'This request was refused under the usage policy']) {
      const s = await panel(async () => Promise.reject(refusal(400, msg)));
      (s.el.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
      await settle(30);
      expect(s.calls()).toBe(6);
    }
  });

  it('kept: a model that is not found, a key with no credit, and a request parameter refused stop it', async () => {
    for (const msg of ['model: claude-old not found', 'Your credit balance is too low', 'max_tokens: unsupported parameter']) {
      const s = await panel(async () => Promise.reject(refusal(400, msg)));
      (s.el.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
      await settle(30);
      expect(s.calls()).toBeLessThanOrEqual(4);
      expect(s.el.querySelector('.figures-status')?.textContent).toMatch(/Anthropic refused two in a row/);
    }
  });
});

describe('R5b.3-4 (c): a draft keeps the stale note, which a change of person still takes away', () => {
  it('the stale note stays under the draft; at a change of person the note goes and the draft stays', async () => {
    let release: (v: unknown) => void = () => {};
    const s = await panel(() => new Promise((r) => (release = r)), 1);
    const [id] = [...s.state.alts.keys()];
    const note = staleNote({ text: 'Old words of u1', decision: 'approved' });
    Object.assign(s.state.alts.get(id) ?? {}, { note });
    s.state.restored.set(id, { text: '', status: 'none', note });
    (s.el.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
    release(reply('A fresh draft'));
    await settle();
    expect(s.state.alts.get(id)).toMatchObject({ text: 'A fresh draft', status: 'draft' });
    expect(s.state.alts.get(id)?.note?.startsWith(note)).toBe(true);
    forgetRestored(s.state);
    expect(s.state.alts.get(id)).toMatchObject({ text: 'A fresh draft', note: null });
  });

  it('kept: a figure with no note gets the draft’s own note (none for a PDF drawn from text: its image note)', async () => {
    let release: (v: unknown) => void = () => {};
    const s = await panel(() => new Promise((r) => (release = r)), 1);
    const [id] = [...s.state.alts.keys()];
    (s.el.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
    release(reply('A draft'));
    await settle();
    const c = s.state.alts.get(id);
    expect(c?.text).toBe('A draft');
    expect(c?.note ?? '').not.toMatch(/^In the saved project/);
  });
});

describe('R5b.1-8 (f): the course report reads each project’s latest check whole, and only the times of the others', () => {
  it('two projects, three checks each: the latest of each, by when it finished; the second read asks by id', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const course = await db.insert<{ id: string }>('courses', { name: 'C', term: null });
    const ids: string[] = [];
    for (const name of ['a', 'b']) {
      const pr = await db.insert<{ id: string }>('projects', { course_id: course.id, name, main_file: 'main.tex' });
      const sc = await db.insert<{ id: string }>('scans', { project_id: pr.id, summary: {}, findings: [], data_as_of: '2026-11-01' });
      for (const [k, fin] of [['1', '2026-11-20T10:00:00Z'], ['2', '2026-11-22T10:00:00Z'], ['3', null]] as const) {
        await db.insert('jobs', { project_id: pr.id, scan_id: sc.id, kind: 'check', status: fin ? 'done' : 'failed', started_at: null, finished_at: fin, result: null, error: `${name}${k}` });
      }
      ids.push(pr.id);
    }
    const reads: { where: unknown; columns?: string }[] = [];
    const select = db.select.bind(db);
    db.select = (async (t: never, where?: never, columns?: string) => {
      reads.push({ where, columns });
      return select(t, where, columns);
    }) as typeof db.select;
    const latest = await store.latestJobs(ids);
    // A check that never finished counts by when it was saved (NOW, 2026-11-23), so it is the latest.
    expect(latest.map((j: JobRow) => j.error).sort()).toEqual(['a3', 'b3']);
    expect(reads[0].columns).toBe('id, project_id, finished_at, created_at');
    expect([...((reads[1].where as { id: string[] }).id)].sort()).toEqual(latest.map((j) => j.id).sort());
    expect(reads[1].columns).toBeUndefined();
    expect(await store.latestJobs([])).toEqual([]);
  });

  it('kept: a project with no check has no row, and one check is its latest', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const course = await db.insert<{ id: string }>('courses', { name: 'C', term: null });
    const a = await db.insert<{ id: string }>('projects', { course_id: course.id, name: 'a', main_file: 'main.tex' });
    const b = await db.insert<{ id: string }>('projects', { course_id: course.id, name: 'b', main_file: 'main.tex' });
    const sc = await db.insert<{ id: string }>('scans', { project_id: a.id, summary: {}, findings: [], data_as_of: '2026-11-01' });
    await db.insert('jobs', { project_id: a.id, scan_id: sc.id, kind: 'patched-check', status: 'done', started_at: null, finished_at: '2026-11-20T00:00:00Z', result: null, error: null });
    const latest = await store.latestJobs([a.id, b.id]);
    expect(latest.map((j) => [j.project_id, j.kind])).toEqual([[a.id, 'patched-check']]);
  });
});

describe('R5a.1-10: a thumbnail is unpacked when its figure is first shown', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const MAIN = doc('\\includegraphics{a.png}\n\\includegraphics{b.png}\n\\includegraphics{c.pdf}');
  function mount(whenShown: ((el: Element, show: () => void) => () => void) | null) {
    const p = openProject('t.zip', zipSync({ 'main.tex': strToU8(MAIN), 'a.png': PNG, 'b.png': PNG, 'c.pdf': strToU8('%PDF') }));
    document.body.innerHTML = '<div id="p"></div>';
    const el = document.getElementById('p') as HTMLElement;
    const made: string[] = [];
    const revoked: string[] = [];
    const run = mountFixes(el, {
      project: p,
      scan: scanDocument(p, 'main.tex', idx),
      state: newFixesState(),
      downloadBlob: () => {},
      onClose: () => {},
      figures: { signedIn: () => false, storage: memoryStorage(), whenShown, objectUrl: () => `blob:${made.push('x')}`, revokeUrl: (u) => void revoked.push(u) },
    });
    return { el, made, revoked, run };
  }

  it('nothing is unpacked at the opening; the first figure shown gets its image; a redraw and the panel going stop the watches', () => {
    const watches: { el: Element; show: () => void; stopped: boolean }[] = [];
    const s = mount((el, show) => {
      const w = { el, show, stopped: false };
      watches.push(w);
      return () => void (w.stopped = true);
    });
    const live = () => watches.filter((w) => !w.stopped);
    expect(s.made).toHaveLength(0);
    // The two PNGs (the PDF has no preview to wait for); a figure drawn again stops its earlier watch.
    expect(live()).toHaveLength(2);
    expect(live().every((w) => w.el.isConnected)).toBe(true);
    expect(s.el.querySelectorAll('.thumb-wait')).toHaveLength(2);
    expect(s.el.querySelector('.no-preview')?.textContent).toMatch(/PDF, EPS or another type/);
    const [first, second] = live();
    first.show();
    expect(s.made).toHaveLength(1);
    expect(s.el.querySelectorAll('img.thumb')).toHaveLength(1);
    expect(s.el.querySelectorAll('.thumb-wait')).toHaveLength(1);
    s.run.cancel();
    expect(second.stopped).toBe(true);
    expect(s.revoked).toEqual(['blob:1']);
    second.show();
    expect(s.made).toHaveLength(1); // shown after the panel went: nothing is unpacked
  });

  it('kept: with no observer (an old browser, or none given) every thumbnail is made at once, and given back', () => {
    const s = mount(null);
    expect(s.made).toHaveLength(2);
    expect(s.el.querySelectorAll('img.thumb')).toHaveLength(2);
    s.run.cancel();
    expect(s.revoked).toHaveLength(2);
  });
});

describe('R4b.2-5 (c): two wrapped commands removed before \\begin{document} leave no empty line', () => {
  it('inputenc and fontenc each wrapped, the second ending on the \\begin{document} line; kept: one wrapped, and text before the first', () => {
    const run = (main: string) => {
      const { p, scan } = setup({ 'main.tex': main });
      return applyFixes(p, scan, new Set(['engine', 'unicode-math'])).files.get('main.tex') as string;
    };
    const head = '\\documentclass{article}\n\\usepackage{amsmath}\n';
    const tail = '\\begin{document}\nHi\n\\end{document}\n';
    expect(run(`${head}\\usepackage[\nutf8]{inputenc}\\usepackage[\nT1]{fontenc}${tail}`)).toBe(`${head}\\usepackage{unicode-math}\n${tail}`);
    // Blanks between the two are kept before the inserted line; no empty line is left.
    expect(run(`${head}\\usepackage[\nutf8]{inputenc}  \\usepackage[\nT1]{fontenc}${tail}`)).toBe(`${head}  \\usepackage{unicode-math}\n${tail}`);
    expect(run(`${head}\\usepackage[\nT1]{fontenc}${tail}`)).toBe(`${head}\\usepackage{unicode-math}\n${tail}`);
    expect(run(`${head}x \\usepackage[\nutf8]{inputenc}\\usepackage[\nT1]{fontenc}${tail}`)).toContain('x \n\\usepackage{unicode-math}\n\\begin{document}');
  });
});
