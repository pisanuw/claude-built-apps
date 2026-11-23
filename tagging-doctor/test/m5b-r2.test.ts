// @vitest-environment jsdom
/**
 * Milestone 5b, review round 2: each fix beside the cases the old code and
 * round 1's fix got right.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RESTORED_NOTE } from '../src/lib/alts';
import { doc, page, settle, zip } from './alt-page';

afterEach(() => {
  document.body.innerHTML = '';
});

const TWO = doc('\\includegraphics{p.pdf}\n\\includegraphics{q.pdf}');
const v = (q = '%PDF-q') => zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': q });

describe('R5b.2-1 (AC-51): a restored text goes on a change of person, whatever its choice now', () => {
  for (const role of ['skip', 'decorative']) {
    it(`restored, then ${role}: signed out the box is empty, and person 2 cannot save it`, async () => {
      const p = page();
      await p.open('lab.zip', v());
      await p.save('Course');
      p.approve('p.pdf', 'SECRET of u1');
      p.approve('q.pdf', 'Q of u1');
      await settle();
      await p.open('lab (1).zip', v());
      expect(p.text('p.pdf')).toBe('SECRET of u1');
      p.choose('p.pdf', role);
      p.as(null);
      await settle();
      expect(p.text('p.pdf')).toBe('');
      expect(p.item('p.pdf').querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
      expect(p.root.querySelector('#fixes')?.textContent).not.toContain('of u1');
      p.as('u2');
      await settle();
      expect(p.root.querySelector('#fixes')?.textContent).not.toContain('of u1');
      p.approve('q.pdf', 'Person two');
      await p.save('Mine');
      expect(await p.rows('u2')).toEqual([['q.pdf', 'Person two', 'approved']]);
    });
  }

  it('kept: an edited text stays without the note; a restored decorative mark changed to a text of the person’s own stays; the same person again changes nothing; signing in again restores', async () => {
    const p = page();
    await p.open('lab.zip', v());
    await p.save('Course');
    p.approve('p.pdf', 'P text');
    p.choose('q.pdf', 'decorative');
    await settle();
    await p.open('lab (1).zip', v());
    expect(p.item('q.pdf').querySelector('.alt-status')?.textContent).toMatch(/^Decorative/);
    p.as('u1');
    await settle();
    expect(p.text('p.pdf')).toBe('P text');
    p.approve('p.pdf', 'P text, edited');
    p.approve('q.pdf', 'Q, my own words');
    p.as(null);
    await settle();
    expect(p.text('p.pdf')).toBe('P text, edited');
    expect(p.item('p.pdf').querySelector('.note')).toBeNull();
    expect(p.text('q.pdf')).toBe('Q, my own words');
    expect(p.item('q.pdf').querySelector('.alt-status')?.textContent).toMatch(/^Approved/);
    p.as('u1');
    await settle();
    // Both figures are the person's now, so the restore leaves them as they are.
    expect(p.text('p.pdf')).toBe('P text, edited');
  });

  it('kept: a text typed on the page (never restored) stays for the next person', async () => {
    const p = page();
    await p.open('lab.zip', v());
    p.approve('p.pdf', 'Typed on the page');
    p.as(null);
    await settle();
    p.as('u2');
    await settle();
    expect(p.text('p.pdf')).toBe('Typed on the page');
  });
});

describe('R5b.2-2 (AC-51): an image used twice keeps each use’s text in place', () => {
  const LOGO = doc('\\includegraphics{logo.pdf}\n\\includegraphics[width=4cm]{logo.pdf}\n\\includegraphics{q.pdf}');
  const files = (main = LOGO) => zip({ 'main.tex': main, 'logo.pdf': '%PDF-logo', 'q.pdf': '%PDF-q' });
  const box = (p: ReturnType<typeof page>, n: number) => (p.items()[n].querySelector('textarea') as HTMLTextAreaElement).value;
  const approveAt = (p: ReturnType<typeof page>, n: number, t: string) => {
    const ta = p.items()[n].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = t;
    ta.dispatchEvent(new Event('input'));
    (p.items()[n].querySelector('[data-role="approve"]') as HTMLButtonElement).click();
  };

  it('a text for the second use only comes back on the second use, and the copy follows', async () => {
    const p = page();
    await p.open('deck.zip', files());
    await p.save('Course');
    (p.items()[0].querySelector('[data-role="skip"]') as HTMLButtonElement).click();
    approveAt(p, 1, 'The large logo, second use');
    await settle();
    await p.open('deck.zip', files());
    expect(box(p, 0)).toBe('');
    expect(p.items()[0].querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
    expect(box(p, 1)).toBe('The large logo, second use');
    expect(p.items()[1].querySelector('.note')?.textContent).toBe(RESTORED_NOTE);
    await p.save('Course');
    expect((await p.rows('u1')).sort()).toEqual([['logo.pdf#2', 'The large logo, second use', 'approved']]);
  });

  it('the first use with alt in its source: the second use still gets its text', async () => {
    const main = doc('\\includegraphics[alt={Logo}]{logo.pdf}\n\\includegraphics[width=4cm]{logo.pdf}');
    const p = page();
    await p.open('deck.zip', files(main));
    await p.save('Course');
    approveAt(p, 1, 'Second use');
    await settle();
    await p.open('deck.zip', files(main));
    expect(box(p, 1)).toBe('Second use');
  });

  it('kept (R5b.1-4): three uses with a row each come back in place; a TikZ picture added above two leaves them their texts', async () => {
    const three = doc('\\includegraphics{logo.pdf}\n\\includegraphics{logo.pdf}\n\\includegraphics{logo.pdf}');
    const p = page();
    await p.open('deck.zip', files(three));
    await p.save('Course');
    (p.items()[0].querySelector('[data-role="decorative"]') as HTMLButtonElement).click();
    approveAt(p, 1, 'Use 2');
    approveAt(p, 2, 'Use 3');
    await settle();
    await p.open('deck.zip', files(three));
    expect(p.items()[0].querySelector('.alt-status')?.textContent).toMatch(/^Decorative/);
    expect([box(p, 1), box(p, 2)]).toEqual(['Use 2', 'Use 3']);
    const pic = (n: number) => `\\begin{tikzpicture}\\draw (0,0) -- (${n},${n});\\end{tikzpicture}`;
    const q = page();
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(1)}\n${pic(2)}`) }));
    await q.save('Course');
    approveAt(q, 0, 'Picture 1');
    approveAt(q, 1, 'Picture 2');
    await settle();
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(9)}\n${pic(1)}\n${pic(2)}`) }));
    expect([box(q, 0), box(q, 1), box(q, 2)]).toEqual(['', 'Picture 1', 'Picture 2']);
    expect(q.items()[0].querySelector('.note')).toBeNull();
    // Two swapped pictures keep their texts; a changed one shows its earlier text.
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(2)}\n${pic(1)}`) }));
    expect([box(q, 0), box(q, 1)]).toEqual(['Picture 2', 'Picture 1']);
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(1)}\n${pic(5)}`) }));
    expect(box(q, 0)).toBe('Picture 1');
    expect(q.items()[1].querySelector('.note')?.textContent).toContain('Picture 2');
  });
});

describe('the minors of round 2', () => {
  it('R5b.2-3: an image with no caption does not take the caption of the image beside it; the side caption and a caption for two still work', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const { idx } = await import('./alt-page');
    const figs = (body: string) => {
      const p = openProject('t.zip', zip({ 'main.tex': doc(body) }));
      return listFigures(p, scanDocument(p, 'main.tex', idx)).map((f) => [f.caption, f.label]);
    };
    const mp = (x: string) => `\\begin{minipage}{.5\\textwidth}${x}\\end{minipage}`;
    expect(figs(`\\begin{figure}${mp('\\includegraphics{a}\\caption{L}\\label{l}')}${mp('\\includegraphics{b}')}\\end{figure}`)).toEqual([
      ['L', 'l'],
      ['', ''],
    ]);
    // Kept: the side caption (R5b.1-7); two images with one caption in a third minipage; a caption each.
    expect(figs(`\\begin{figure}${mp('\\includegraphics{a}')}${mp('\\caption{Side}\\label{s}')}\\end{figure}`)).toEqual([['Side', 's']]);
    expect(figs(`\\begin{figure}${mp('\\includegraphics{a}')}${mp('\\includegraphics{b}')}${mp('\\caption{Both}')}\\end{figure}`)).toEqual([
      ['Both', ''],
      ['Both', ''],
    ]);
    expect(figs(`\\begin{figure}${mp('\\includegraphics{a}\\caption{A}')}${mp('\\includegraphics{b}\\caption{B}')}\\end{figure}`)).toEqual([
      ['A', ''],
      ['B', ''],
    ]);
  });

  it('R5b.2-4: a TikZ picture’s fingerprint follows its images as figures are found, \\input without braces, and inputs of inputs; its note says what was compared', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { figureKeys, restoreAlts, RESTORED_TIKZ_NOTE } = await import('../src/lib/alts');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const { newChoice } = await import('../src/ui/figures');
    const { idx } = await import('./alt-page');
    const keyOf = async (main: string, extra: Record<string, string>) => {
      const p = openProject('t.zip', zip({ 'main.tex': main, ...extra }));
      const figures = listFigures(p, scanDocument(p, 'main.tex', idx));
      const keys = await figureKeys(p, figures);
      const f = figures.find((x) => x.kind === 'tikz');
      return { figures, keys, hash: f ? keys.get(f.id)?.hash : undefined };
    };
    const pic = (body: string, pre = '') => doc(`${pre}\\begin{tikzpicture}${body}\\end{tikzpicture}`);
    const differs = async (main: string, a: Record<string, string>, b: Record<string, string>) => expect((await keyOf(main, a)).hash).not.toBe((await keyOf(main, b)).hash);
    await differs(pic('\\node{\\includegraphics{img}};'), { 'img.png': 'A' }, { 'img.png': 'B' });
    await differs(pic('\\node{\\includegraphics{img.png}};', '\\graphicspath{{figs/}}\n'), { 'figs/img.png': 'A' }, { 'figs/img.png': 'B' });
    await differs(pic('\\input plot.tikz '), { 'plot.tikz': 'A' }, { 'plot.tikz': 'B' });
    await differs(pic('\\input{a.tikz}'), { 'a.tikz': '\\input{b.tikz}', 'b.tikz': 'A' }, { 'a.tikz': '\\input{b.tikz}', 'b.tikz': 'B' });
    // Kept: the same files give the same fingerprint; the note names what was compared.
    const one = await keyOf(pic('\\input{a.tikz}'), { 'a.tikz': '\\input{b.tikz}', 'b.tikz': 'A' });
    expect(one.hash).toBe((await keyOf(pic('\\input{a.tikz}'), { 'a.tikz': '\\input{b.tikz}', 'b.tikz': 'A' })).hash);
    const f = one.figures.find((x) => x.kind === 'tikz');
    const k = f && one.keys.get(f.id);
    const choices = new Map();
    restoreAlts(one.figures, one.keys, [{ id: 'r', figure_path: k?.path ?? '', figure_hash: k?.hash ?? '', text: 'A plot', decision: 'approved', source: 'typed' }], choices, newChoice);
    expect(choices.get(f?.id)?.note).toBe(RESTORED_TIKZ_NOTE);
    expect(RESTORED_TIKZ_NOTE).toMatch(/Styles and data the document sets elsewhere are not compared/);
  });

  it('R5b.2-5 (a): an article whose language is hyperref’s pdflang gets that language in the line; kept: babel and the default', async () => {
    const { setup } = await import('./patch-helpers');
    const { metadataLine } = await import('../src/core/patch');
    const line = (pre: string) => {
      const s = setup({ 'main.tex': `\\documentclass{article}\n${pre}\\begin{document}\nx\n\\end{document}\n` });
      return [s.plan.language.tag, s.plan.language.from];
    };
    expect(line('\\usepackage{hyperref}\n\\hypersetup{pdflang=de-DE}\n')).toEqual(['de-DE', 'from hyperref’s pdflang']);
    expect(line('\\usepackage[pdflang=fr]{hyperref}\n')).toEqual(['fr', 'from hyperref’s pdflang']);
    expect(line('\\usepackage[ngerman]{babel}\n')[1]).toMatch(/babel/);
    expect(line('')).toEqual(['en-US', 'the default, because the document sets no language']);
    expect(metadataLine('de-DE')).toContain('lang=de-DE');
  });

  it('R5b.2-5 (b): the Beamer pointer only with a Beamer finding; a project class named …beamer that loads article gets the line', async () => {
    const { setup, card } = await import('./patch-helpers');
    const fix = (files: Record<string, string>) => setup(files).scan.findings.find((x) => x.rule === 'no-document-metadata')?.fix?.detail ?? '';
    const deck = (cls: string) => `\\documentclass{${cls}}\n\\begin{document}\nx\n\\end{document}\n`;
    expect(fix({ 'main.tex': deck('ctexbeamer') })).not.toContain('see the Beamer finding');
    expect(fix({ 'main.tex': deck('beamer') })).toContain('(see the Beamer finding)');
    expect(card(setup({ 'main.tex': deck('notbeamer'), 'notbeamer.cls': '\\LoadClass{article}\n' }).plan, 'metadata')?.state).toBe('ready');
    // Kept (R5a.F-3): ctexbeamer from the distribution, and a project's own copy of a listed class.
    expect(card(setup({ 'main.tex': deck('ctexbeamer') }).plan, 'metadata')?.state).toBe('not-done');
    expect(card(setup({ 'main.tex': deck('tufte-handout'), 'tufte-handout.cls': '\\LoadClass{article}\n' }).plan, 'metadata')?.state).toBe('not-done');
  });

  it('R5b.2-5 (c): folders go from the overlay form, two levels of brackets, \\includesvg, \\graphicspath, \\bibliography and \\input without braces', async () => {
    const { listFigures } = await import('../src/core/figures');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const { idx } = await import('./alt-page');
    const before = [
      '\\includegraphics<2->[width=1cm]{/Users/me/secret/one.png}',
      '\\includegraphics[alt={a [b [c] d] e}]{/Users/me/secret/two.png}',
      '\\includesvg{/Users/me/secret/three}',
      '\\graphicspath{{/Users/me/secret/figs/}{C:\\Users\\me\\pics\\}}',
      '\\bibliography{/Users/me/secret/refs}',
      '\\input /Users/me/secret/part ',
    ].join('\n');
    const p = openProject('t.zip', zip({ 'main.tex': `\\documentclass{beamer}\n\\begin{document}\n${before}\n\\includegraphics{b.pdf}\n\\end{document}\n` }));
    const f = listFigures(p, scanDocument(p, 'main.tex', idx)).find((x) => x.file === 'b.pdf');
    expect(f?.before).not.toMatch(/Users|secret/);
    expect(f?.before).toContain('{one.png}');
    expect(f?.before).toContain('{two.png}');
    expect(f?.before).toContain('\\graphicspath{{figs/}{pics/}}');
    expect(f?.before).toContain('\\input part');
  });

  it('R5b.2-5 (d): after a sign-in that reloaded the page, the same project dropped again and the banner’s Save keep its alt texts; another zip does not', async () => {
    const { CourseStore, MemoryDb } = await import('../src/lib/store');
    const { mountApp } = await import('../src/ui/app');
    const { idx, NOW, file } = await import('./alt-page');
    const session = new Map<string, string>();
    const sess = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, val: string) => void session.set(k, val), removeItem: (k: string) => void session.delete(k) };
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    let who: string | null = null;
    const account = { mountSignIn: () => () => {}, onUser: (f: (u: { id: string } | null) => void) => f(who ? { id: who } : null), store: () => store };
    const mount = () => {
      document.body.innerHTML = '<div id="app"></div>';
      const root = document.getElementById('app') as HTMLElement;
      return { root, app: mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: sess, download: () => {}, pause: async () => {}, account }) };
    };
    const btn = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
    const A = () => zip({ 'main.tex': doc('\\includegraphics{a.pdf}'), 'a.pdf': '%PDF-A' });
    let { root, app } = mount();
    await app.handleFile(file('A.zip', A()));
    btn(root, 'Save').click();
    await settle();
    who = 'u1';
    ({ root, app } = mount());
    await settle();
    await app.handleFile(file('A.zip', A()));
    btn(root, 'Alt text for figures').click();
    const li = root.querySelector('li.figure-item') as HTMLElement;
    const ta = li.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Text for A';
    ta.dispatchEvent(new Event('input'));
    (li.querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    btn(root, 'Save to a course').click();
    await settle();
    (root.querySelector('#save-course-name') as HTMLInputElement).value = 'C';
    root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
    await settle(30);
    expect((await db.select<{ text: string }>('alt_texts')).map((r) => r.text)).toEqual(['Text for A']);
  });

  it('R5b.2-5 (f): the stale note stays while the person types, and goes when they choose', async () => {
    const p = page();
    await p.open('lab.zip', v());
    await p.save('Course');
    p.approve('q.pdf', 'Q, first plot');
    await settle();
    await p.open('lab (1).zip', v('%PDF-q-redrawn'));
    const ta = p.item('q.pdf').querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Q, redrawn';
    ta.dispatchEvent(new Event('input'));
    expect(p.item('q.pdf').querySelector('.note')?.textContent).toContain('Q, first plot');
    (p.item('q.pdf').querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    expect(p.item('q.pdf').querySelector('.note')).toBeNull();
  });

  it('R5b.2-5 (i): many unclosed pictures are listed in linear time', async () => {
    const { tikzEnds } = await import('../src/core/figures');
    const src = `${'\\begin{tikzpicture} x '.repeat(20000)}\\end{tikzpicture}`;
    const ends = tikzEnds(src);
    expect(ends.size).toBe(1);
    expect([...ends.keys()][0]).toBe('\\begin{tikzpicture} x '.length * 19999);
  });
});

describe('R5b.2-5 (g), (h): Draft all and a draft across a change of person', () => {
  async function panel(answer: (n: number) => Promise<unknown>, n = 6) {
    const { mountFixes, newFixesState } = await import('../src/ui/fixes');
    const { memoryStorage, setByokKey } = await import('../src/lib/llm');
    const { openProject } = await import('../src/core/project');
    const { scanDocument } = await import('../src/core/scan');
    const { idx } = await import('./alt-page');
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
  const refusal = (msg: string) => Object.assign(new Error('404'), { status: 404, error: { error: { message: msg } } });
  const reply = (t: string) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: t }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

  it('(g) a retired model, refused on every call, stops the run; kept: two image refusals do not', async () => {
    const s = await panel(async () => Promise.reject(refusal('model: claude-old not found')));
    (s.el.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await settle(30);
    expect(s.calls()).toBeLessThanOrEqual(4);
    expect(s.el.querySelector('.figures-status')?.textContent).toMatch(/Anthropic refused two in a row/);
    const t = await panel(async (k) => (k < 2 ? Promise.reject(Object.assign(new Error('400'), { status: 400, error: { error: { message: 'Could not process image' } } })) : reply('ok')));
    (t.el.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await settle(30);
    expect(t.calls()).toBe(6);
  });

  it('(h) a draft out for a restored figure when the person changes arrives on the emptied figure', async () => {
    const { forgetRestored } = await import('../src/ui/fixes');
    let release: (v: unknown) => void = () => {};
    const s = await panel(() => new Promise((r) => (release = r)), 1);
    const [id] = [...s.state.alts.keys()];
    Object.assign(s.state.alts.get(id) ?? {}, { text: 'Restored text', status: 'approved', note: RESTORED_NOTE });
    s.state.restored.set(id, { text: 'Restored text', status: 'approved', note: RESTORED_NOTE });
    (s.el.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
    forgetRestored(s.state);
    expect(s.state.alts.get(id)?.text).toBe('');
    release(reply('A fresh draft'));
    await settle();
    expect(s.state.alts.get(id)).toMatchObject({ text: 'A fresh draft', status: 'draft' });
  });
});

describe('R5b.2-5 (e): a sync queued by one person is not sent as the next', () => {
  it('the second approval, queued while the first sync is out, is dropped when the person changes; no false words to the next person', async () => {
    const { ALTS_PROJECT_GONE, ALTS_NOT_SAVED } = await import('../src/ui/app');
    const p = page();
    await p.open('lab.zip', v());
    await p.save('Course');
    const store = p.storeOf('u1');
    const sync = store.syncAltTexts.bind(store);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    store.syncAltTexts = async (...a) => {
      calls++;
      if (calls === 1) await gate;
      return sync(...a);
    };
    p.approve('p.pdf', 'First');
    await settle();
    p.approve('q.pdf', 'Second');
    p.as('u2');
    release();
    await settle(30);
    expect(calls).toBe(1);
    expect((await p.rows('u1')).map((r) => r[1])).toEqual(['First']);
    const status = p.root.querySelector('.figures-status')?.textContent ?? '';
    expect(status).not.toBe(ALTS_PROJECT_GONE);
    expect(status).not.toBe(ALTS_NOT_SAVED);
  });
});
