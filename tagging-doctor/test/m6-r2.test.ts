// @vitest-environment jsdom
/**
 * Milestone 6, review round 2 (review-m6-r2.md): each fix beside the input
 * the code before it got right.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFigures } from '../src/core/figures';
import { openProject } from '../src/core/project';
import { buildReport, reportHtml } from '../src/core/report';
import { scanDocument } from '../src/core/scan';
import { figureKeys, staleNote } from '../src/lib/alts';
import { memoryStorage, setByokKey } from '../src/lib/llm';
import { forgetRestored, mountFixes, newFixesState } from '../src/ui/fixes';
import { tableRegion } from '../src/ui/table-region';
import { doc, file, idx, NOW, settle, zip } from './alt-page';

afterEach(() => {
  document.body.innerHTML = '';
});

const ARRIVED = 'A draft arrived after you changed this figure, so your text and choice were kept.';

/** The fix panel on one figure whose image cannot be opened, with the stale note of an earlier text; `gate` holds a draft back. */
function noted() {
  const pr = openProject('t.zip', zipSync({ 'main.tex': strToU8(doc('\\includegraphics{f.png}')), 'f.png': new Uint8Array([1, 2, 3]) }));
  const storage = memoryStorage();
  setByokKey('k', storage);
  document.body.innerHTML = '<div id="p"></div>';
  const el = document.getElementById('p') as HTMLElement;
  const state = newFixesState();
  const hold = { gate: Promise.resolve() as Promise<void> };
  const ask = async () => {
    await hold.gate;
    return { id: 'm', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'A draft' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  };
  const mount = () =>
    mountFixes(el, { project: pr, scan: scanDocument(pr, 'main.tex', idx), state, downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false, storage, draft: { ask: ask as never }, imageDeps: { decode: async () => Promise.reject(new Error('bad')) } as never } });
  mount();
  const [id] = [...state.alts.keys()];
  const note = staleNote({ text: 'Old words of u1', decision: 'approved' });
  Object.assign(state.alts.get(id) ?? {}, { note });
  state.restored.set(id, { text: '', status: 'none', note });
  const draft = () => (el.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
  /** A draft that arrives after the person typed in the box. */
  const draftWhileTyping = async (words: string) => {
    let open!: () => void;
    hold.gate = new Promise((r) => (open = r));
    draft();
    await settle();
    const ta = el.querySelector('li.figure-item textarea') as HTMLTextAreaElement;
    ta.value = words;
    ta.dispatchEvent(new Event('input'));
    open();
    await settle();
    hold.gate = Promise.resolve();
  };
  return { el, state, id, note, mount, draft, draftWhileTyping };
}

describe('R6.2-1: no copy of the stale note outlives a change of person', () => {
  it('a draft that arrived after typing, then a change of person: the next draft shows nothing of the earlier text (Reviewer\'s steps)', async () => {
    const t = noted();
    t.draft();
    await settle();
    await t.draftWhileTyping('My own words');
    forgetRestored(t.state);
    expect(t.state.alts.get(t.id)?.stale).toBeUndefined();
    t.mount();
    t.draft();
    await settle();
    expect(JSON.stringify(t.state.alts.get(t.id))).not.toContain('Old words of u1');
    expect(t.el.textContent).not.toContain('Old words of u1');
  });

  it('kept: the same person, no change of person: the stale note stays in front of the next draft\'s note, once', async () => {
    const t = noted();
    t.draft();
    await settle();
    await t.draftWhileTyping('My own words');
    // Empty the box so the next draft is used.
    const ta = t.el.querySelector('li.figure-item textarea') as HTMLTextAreaElement;
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    t.state.alts.get(t.id)!.status = 'none';
    t.draft();
    await settle();
    const got = t.state.alts.get(t.id)?.note ?? '';
    expect(got.startsWith(t.note)).toBe(true);
    expect(got.split(t.note).length - 1).toBe(1);
  });
});

describe('R6.2-4 (c): a draft that arrives after the person typed keeps the stale note in front', () => {
  it('the note is the stale note, then the kept-text line; a change of person takes the stale note and leaves the line', async () => {
    const t = noted();
    await t.draftWhileTyping('My own words');
    const c = t.state.alts.get(t.id)!;
    expect(c.note).toBe(`${t.note} ${ARRIVED}`);
    expect(c.text).toBe('My own words');
    forgetRestored(t.state);
    expect(c.note).toBe(ARRIVED);
    expect(c.text).toBe('My own words');
  });

  it('kept: with no stale note, the line alone, as before', async () => {
    const t = noted();
    const c = t.state.alts.get(t.id)!;
    c.note = null;
    t.state.restored.clear();
    await t.draftWhileTyping('My own words');
    expect(c.note).toBe(ARRIVED);
  });
});

describe('R6.2-2: the compare\'s script arriving late is added to the open panel, which is not drawn again', () => {
  async function app(signedIn: boolean) {
    const { mountApp } = await import('../src/ui/app');
    const { CourseStore, MemoryDb } = await import('../src/lib/store');
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const account = { mountSignIn: () => () => {}, onUser: (cb: (u: { id: string } | null) => void) => cb(signedIn ? { id: 'u1' } : null), store: () => new CourseStore(new MemoryDb('u1', () => NOW)), token: async () => 't' };
    const checker = { base: 'https://checker.invalid', fetch: (async () => new Response('{}')) as typeof fetch, sleep: async () => {}, now: () => 0 };
    const a = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account, compile: { checker, downloadBlob: () => {} } });
    const mod = { calls: 0, compareSlot: () => {
      mod.calls++;
      return (slot: HTMLElement) => {
        slot.append(Object.assign(document.createElement('p'), { className: 'stand-in-compare' }));
        return { cancel: () => {} };
      };
    } };
    await a.handleFile(file('lab.zip', zip({ 'main.tex': doc('\\includegraphics{f.png}\n\\includegraphics{g.png}'), 'f.png': 'x', 'g.png': 'y' })));
    const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
    button('Suggest fixes').click();
    await settle();
    button('Alt text for figures').click();
    await settle();
    return { root, a, mod };
  }

  it('signed in, typing in a figure\'s box: the box keeps the focus and its text; the compare appears once', async () => {
    const { root, a, mod } = await app(true);
    const heading = root.querySelector('#fixes-h');
    const ta = root.querySelectorAll('li.figure-item textarea')[1] as HTMLTextAreaElement;
    ta.focus();
    ta.value = 'Half a sent';
    ta.dispatchEvent(new Event('input'));
    a.setCompare(mod as never);
    expect(root.querySelectorAll('.stand-in-compare')).toHaveLength(1);
    expect(document.activeElement).toBe(ta);
    expect(ta.isConnected).toBe(true);
    expect(ta.value).toBe('Half a sent');
    expect(root.querySelector('#fixes-h')).toBe(heading);
    // A second arrival adds nothing.
    a.setCompare(mod as never);
    expect(root.querySelectorAll('.stand-in-compare')).toHaveLength(1);
  });

  it('signed out: nothing is drawn and no compare is made; the panel stays as it is', async () => {
    const { root, a, mod } = await app(false);
    const ta = root.querySelector('li.figure-item textarea') as HTMLTextAreaElement;
    ta.focus();
    a.setCompare(mod as never);
    expect(mod.calls).toBe(0);
    expect(root.querySelector('.stand-in-compare')).toBeNull();
    expect(document.activeElement).toBe(ta);
  });
});

describe('R6.2-4 (a): each document\'s figures region in a report has its own name', () => {
  it('two documents with figures without alt text: two names; kept: the caption is the name, and the Documents region', () => {
    const p = openProject('c.zip', zip({ 'a/main.tex': doc('\\includegraphics{x.png}'), 'b/main.tex': doc('\\includegraphics{y.png}'), 'a/x.png': 'x', 'b/y.png': 'y' }));
    const html = reportHtml(buildReport(p.name, p.leftOut, p.warnings, [scanDocument(p, 'a/main.tex', idx), scanDocument(p, 'b/main.tex', idx)], idx.data, NOW));
    const d = document.createElement('div');
    d.innerHTML = /<main>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
    const names = [...d.querySelectorAll('.table-wrap')].map((w) => [w.getAttribute('aria-label'), w.querySelector('caption')?.textContent]);
    expect(names).toEqual([
      ['Documents', 'Documents'],
      ['Figures without alt text in a/main.tex', 'Figures without alt text in a/main.tex'],
      ['Figures without alt text in b/main.tex', 'Figures without alt text in b/main.tex'],
    ]);
  });
});

describe('R6.2-4 (b): a table with an empty caption is named "Table"', () => {
  it('empty or blank caption, or an empty name given; kept: the caption, or the name given', () => {
    const t = (caption: string | null) => {
      const table = document.createElement('table');
      if (caption !== null) table.createCaption().textContent = caption;
      return table;
    };
    expect(tableRegion(t('')).getAttribute('aria-label')).toBe('Table');
    expect(tableRegion(t('  ')).getAttribute('aria-label')).toBe('Table');
    expect(tableRegion(t(null), '').getAttribute('aria-label')).toBe('Table');
    expect(tableRegion(t('Checks')).getAttribute('aria-label')).toBe('Checks');
    expect(tableRegion(t('Checks'), 'Given').getAttribute('aria-label')).toBe('Given');
  });
});

describe('R6.2-4 (d): figureKeys unpacks a file many pictures read once', () => {
  const pic = '\\begin{tikzpicture}\\begin{axis}\\addplot table {data.csv};\\end{axis}\\end{tikzpicture}';
  it('forty pictures on one data file: one read; kept: each fingerprint is the one a single picture gets', async () => {
    const many = openProject('m.zip', zip({ 'main.tex': doc(Array.from({ length: 40 }, (_, i) => `${pic}% ${i}`).join('\n')), 'data.csv': '1,2\n3,4\n' }));
    const reads = vi.spyOn(many, 'bytes');
    const keys = await figureKeys(many, listFigures(many, scanDocument(many, 'main.tex', idx)));
    expect(keys.size).toBe(40);
    expect(reads.mock.calls.filter(([p]) => p === 'data.csv')).toHaveLength(1);
    const one = openProject('o.zip', zip({ 'main.tex': doc(pic), 'data.csv': '1,2\n3,4\n' }));
    const [k1] = [...(await figureKeys(one, listFigures(one, scanDocument(one, 'main.tex', idx)))).values()];
    expect(new Set([...keys.values()].map((k) => k.hash))).toEqual(new Set([k1.hash]));
  });

  it('kept: a data file that cannot be read still gives the fingerprint it gave before', async () => {
    const p = openProject('m.zip', zip({ 'main.tex': doc(`${pic}\n${pic}`), 'data.csv': '1,2\n' }));
    const figs = listFigures(p, scanDocument(p, 'main.tex', idx));
    const real = p.bytes.bind(p);
    vi.spyOn(p, 'bytes').mockImplementation((path: string) => {
      if (path === 'data.csv') throw new Error('damaged');
      return real(path);
    });
    const keys = [...(await figureKeys(p, figs)).values()];
    expect(keys).toHaveLength(2);
    // As before: the word "unreadable" stands for the file's bytes.
    const same = openProject('s.zip', zip({ 'main.tex': doc(`${pic}\n${pic}`), 'data.csv': 'unreadable' }));
    const want = [...(await figureKeys(same, listFigures(same, scanDocument(same, 'main.tex', idx)))).values()];
    expect(keys.map((k) => k.hash)).toEqual(want.map((k) => k.hash));
  });
});
