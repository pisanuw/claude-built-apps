// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_TEXT, mountApp, browserDownload, type AppDeps, type DroppedFile } from '../src/ui/app';
import { rawZip, statusIndex, text, zipFixture } from './helpers';

const idx = statusIndex();

function file(name: string, bytes: Uint8Array, ms = 0): DroppedFile {
  return {
    name,
    arrayBuffer: () => new Promise<ArrayBuffer>((r) => setTimeout(() => r(bytes.slice().buffer), ms)),
  };
}

const DOC = (pre: string) => `\\documentclass{article}${pre}\\begin{document}\\end{document}`;

function setup(over: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const store = new Map<string, string>();
  const downloads: { name: string; type: string; content: string }[] = [];
  const deps: AppDeps = {
    loadStatus: async () => idx,
    now: () => new Date('2026-11-19T12:00:00Z'),
    session: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    download: (name, type, content) => void downloads.push({ name, type, content }),
    pause: async () => {},
    ...over,
  };
  const app = mountApp(root, deps);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const qa = (sel: string) => [...root.querySelectorAll(sel)] as HTMLElement[];
  const button = (label: string) => qa('button').find((b) => b.textContent === label) as HTMLButtonElement;
  return { root, app, deps, store, downloads, q, qa, button };
}

describe('the scan screen', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts empty, with the drop area, "Choose files" and the empty-state line', () => {
    const { q, button } = setup();
    expect(q('#drop-text').textContent).toBe(EMPTY_TEXT);
    expect(EMPTY_TEXT).toBe('Drop a zip of your LaTeX project, or one .tex file. Nothing is uploaded: the scan runs in your browser.');
    expect(button('Choose files')).toBeTruthy();
    expect(q('#status').getAttribute('aria-live')).toBe('polite');
    expect(q('#error').getAttribute('role')).toBe('alert');
    expect(q('#result').hidden).toBe(true);
  });

  it('"Choose files" opens the file chooser', () => {
    const { q, button } = setup();
    const click = vi.spyOn(q<HTMLInputElement>('#file'), 'click');
    button('Choose files').click();
    expect(click).toHaveBeenCalled();
  });

  it('scans one document and lists the findings by group (AC-1)', async () => {
    const { app, q, qa } = setup();
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    expect(q('#result-h').textContent).toBe('2 blockers found');
    expect(q('#status').textContent).toMatch(/^Scan finished in \d+\.\d s: one document\.$/);
    const blockers = qa('li.finding.blocker');
    expect(blockers.map((li) => li.dataset.package)).toEqual(['tabu', 'caption']);
    expect(blockers[0].textContent).toContain('main.tex, line 3');
    expect(blockers[0].textContent).toContain('The LaTeX Project says:');
    expect(blockers[0].textContent).toContain('Suggested fix: Replace tabu with tabularx or array.');
    expect(blockers[0].querySelector('a')?.getAttribute('href')).toBe('https://latex3.github.io/tagging-project/tagging-status/#tabu');
    expect(qa('li.finding.warning').map((li) => li.dataset.package)).toEqual(['titlesec']);
    expect(q('details.group.ok summary').textContent).toBe('Works with tagging (2)');
    expect(q('.meta').textContent).toContain(`Package data as of ${idx.data.asOf}`);
    expect(q('.figures').textContent).toBe('0 images (0 without alt text), 0 TikZ pictures (0 without alt text).');
    expect(qa('section.group.unknown p')[0].textContent).toBe('None.');
  });

  it('downloads the HTML and JSON reports', async () => {
    const { app, button, downloads } = setup();
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    button('Download report').click();
    button('Download JSON').click();
    expect(downloads.map((d) => [d.name, d.type])).toEqual([
      ['tagging-doctor-blockers.html', 'text/html'],
      ['tagging-doctor-blockers.json', 'application/json'],
    ]);
    expect(downloads[0].content).toMatch(/^<!doctype html>/);
    expect(JSON.parse(downloads[1].content).documents).toHaveLength(1);
  });

  it('lists the documents of a course zip, scans one or all, and remembers the choice (AC-5)', async () => {
    const { app, q, qa, button, store, downloads } = setup();
    await app.handleFile(file('course.zip', zipFixture('course')));
    expect(q('#docs-h').textContent).toBe('This zip holds 4 documents');
    expect(q('#status').textContent).toBe('This zip holds 4 documents. Choose one, or scan all.');
    expect(q('#result').hidden).toBe(true);

    button('Scan hw2/hw2.tex').click();
    expect(q('#result-h').textContent).toBe('1 blocker found');
    expect(q('#status').textContent).toBe('Scanned hw2/hw2.tex.');
    expect(JSON.parse(store.get('tagging-doctor.choice.course.zip') as string)).toEqual({ all: false, doc: 'hw2/hw2.tex' });

    button('Scan all').click();
    const rows = qa('#all tbody tr').map((tr) => [...tr.querySelectorAll('td')].slice(0, 4).map((td) => td.textContent));
    expect(rows).toEqual([
      ['hw1/hw1.tex', 'No known blockers', '0', '0'],
      ['hw2/hw2.tex', '1 blocker found', '1', '0'],
      ['hw3/hw3.tex', 'No known blockers', '0', '0'],
      ['notes/notes.tex', '1 blocker found', '1', '1'],
    ]);
    expect(q('#all').textContent).toContain('2 of 4 documents have blockers.');
    expect(q('#result .doc-name').textContent).toBe('Document: hw2/hw2.tex in course.zip');
    expect(q('[data-show="hw2/hw2.tex"]').textContent).toBe('Shown below');

    (q('[data-show="notes/notes.tex"]') as HTMLButtonElement).click();
    expect(q('#result .doc-name').textContent).toBe('Document: notes/notes.tex in course.zip');
    expect(q('[data-show="notes/notes.tex"]').textContent).toBe('Shown below');
    expect(q('[data-show="hw2/hw2.tex"]').textContent).toBe('Show details');
    expect(JSON.parse(store.get('tagging-doctor.choice.course.zip') as string)).toEqual({ all: true, doc: 'notes/notes.tex' });

    button('Download JSON').click();
    expect(JSON.parse(downloads[0].content).documents).toHaveLength(4);

    // A rescan in the same session keeps the choice.
    await app.handleFile(file('course.zip', zipFixture('course')));
    expect(qa('#all tbody tr')).toHaveLength(4);
    expect(q('#result .doc-name').textContent).toBe('Document: notes/notes.tex in course.zip');
    expect(q('#status').textContent).toMatch(/4 documents\.$/);
  });

  it('keeps a single choice for a rescan, and ignores a stale or broken one', async () => {
    const { app, q, store } = setup();
    store.set('tagging-doctor.choice.course.zip', JSON.stringify({ all: false, doc: 'hw3/hw3.tex' }));
    await app.handleFile(file('course.zip', zipFixture('course')));
    expect(q('#result .doc-name').textContent).toBe('Document: hw3/hw3.tex in course.zip');
    expect(q('#all').hidden).toBe(true);
    store.set('tagging-doctor.choice.course.zip', '{not json');
    await app.handleFile(file('course.zip', zipFixture('course')));
    expect(q('#result').hidden).toBe(true);
    store.set('tagging-doctor.choice.course.zip', JSON.stringify({ all: false, doc: 'gone.tex' }));
    await app.handleFile(file('course.zip', zipFixture('course')));
    expect(q('#result').hidden).toBe(true);
  });

  it('works without session storage, or when it refuses to store', async () => {
    const a = setup({ session: null });
    await a.app.handleFile(file('course.zip', zipFixture('course')));
    a.button('Scan all').click();
    expect(a.qa('#all tbody tr')).toHaveLength(4);
    const b = setup({ session: { getItem: () => null, setItem: () => { throw new Error('full'); } } });
    await b.app.handleFile(file('course.zip', zipFixture('course')));
    b.button('Scan hw1/hw1.tex').click();
    expect(b.q('#result-h').textContent).toBe('No known blockers');
  });

  it('says so when no file has \\documentclass, and offers another file (AC-5)', async () => {
    const { app, q, button } = setup();
    await app.handleFile(file('p.zip', rawZip([{ name: 'a.tex', data: 'just text' }])));
    expect(q('#error').textContent).toContain('No .tex file with \\documentclass was found');
    const click = vi.spyOn(q<HTMLInputElement>('#file'), 'click');
    button('Choose another file').click();
    expect(click).toHaveBeenCalled();
  });

  it.each([
    ['notes.pdf', text('%PDF-1.7'), /not a zip or a \.tex file/],
    ['p.zip', rawZip([{ name: 'a.tex', data: 'x', flags: 1 }]), /password-protected/],
    ['p.zip', rawZip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}`, data: '' }))), /more than the 2000/],
    ['p.zip', rawZip([{ name: 'a.png', data: 'x', declaredSize: 101 * 1024 * 1024 }]), /more than 100 MB/],
    ['p.zip', rawZip([{ name: 'main.tex', data: new Uint8Array(2 * 1024 * 1024), method: 8, declaredSize: 10 }]), /expands to more than the size/],
  ])('shows its own message for a refused file and stays usable (AC-6): %s', async (name, bytes, re) => {
    const { app, q, button } = setup();
    await app.handleFile(file(name, bytes));
    expect(q('#error').textContent).toMatch(re);
    expect(q('#result-h').textContent).toBe('Could not scan');
    expect(button('Choose files')).toBeTruthy();
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    expect(q('#error').textContent).toBe('');
    expect(q('#result-h').textContent).toBe('2 blockers found');
  });

  it('refuses a file over 20 MB before reading it (AC-6)', async () => {
    const { app, q } = setup();
    const read = vi.fn(async () => new ArrayBuffer(0));
    await app.handleFile({ name: 'huge.zip', size: 21 * 1024 * 1024, arrayBuffer: read });
    expect(read).not.toHaveBeenCalled();
    expect(q('#error').textContent).toMatch(/larger than 20 MB/);
  });

  it('shows a plain message for an unexpected failure', async () => {
    const { app, q } = setup();
    await app.handleFile({ name: 'p.zip', arrayBuffer: async () => { throw new Error('read failed'); } });
    expect(q('#error').textContent).toBe('Something went wrong while reading this file. Try again, or make the zip again.');
  });

  it('shows the skipped ../ entries and the student records left out (AC-6, AC-15)', async () => {
    const { app, qa } = setup();
    await app.handleFile(file('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\begin{document}\\end{document}' },
      { name: '../x.tex', data: 'x' },
      { name: 'grades.csv', data: 'SECRET' },
    ])));
    const items = qa('.project-warnings li').map((li) => li.textContent);
    expect(items[0]).toBe('Skipped ../x.tex: its path points outside the zip.');
    expect(items[1]).toMatch(/grades\.csv is named like grades or rosters, so the scan left it out/);
  });

  it('scans a file chosen with the chooser, or dropped on the drop area', async () => {
    const { q } = setup();
    const input = q<HTMLInputElement>('#file');
    Object.defineProperty(input, 'files', { configurable: true, value: [file('blockers.zip', zipFixture('blockers'))] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(q('#result-h').textContent).toBe('2 blockers found'));

    const drop = q('#drop');
    drop.dispatchEvent(new Event('dragover'));
    expect(drop.classList.contains('over')).toBe(true);
    drop.dispatchEvent(new Event('dragleave'));
    expect(drop.classList.contains('over')).toBe(false);

    const ev = new Event('drop');
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file('beamer.zip', zipFixture('beamer'))] } });
    drop.dispatchEvent(ev);
    await vi.waitFor(() => expect(q('#result-h').textContent).toBe('1 blocker found'));
    expect(q('.note').textContent).toBe('Beamer migration is not covered by this version.');

    const two = new Event('drop');
    Object.defineProperty(two, 'dataTransfer', { value: { files: [file('a.tex', text('x')), file('b.tex', text('y'))] } });
    drop.dispatchEvent(two);
    expect(q('#error').textContent).toBe('Drop one zip, or one .tex file. To scan several files, zip their folder.');

    const none = new Event('drop');
    Object.defineProperty(none, 'dataTransfer', { value: null });
    drop.dispatchEvent(none);
    Object.defineProperty(input, 'files', { configurable: true, value: [] });
    input.dispatchEvent(new Event('change'));
  });

  it('shows figure counts and the Beamer note', async () => {
    const { app, q } = setup();
    await app.handleFile(file('figures.zip', zipFixture('figures')));
    expect(q('.figures').textContent).toBe('5 images (3 without alt text), 2 TikZ pictures (1 without alt text).');
  });

  it('names a single .tex file without "in"', async () => {
    const { app, q } = setup();
    await app.handleFile(file('lecture.tex', text('\\documentclass{article}\\begin{document}\\end{document}')));
    expect(q('#result .doc-name').textContent).toBe('Document: lecture.tex');
  });
});

describe('review round 1', () => {
  it('R1.1-1: a second drop during the first shows only the second project, whichever finishes first', async () => {
    const zipA = rawZip([{ name: 'main.tex', data: DOC('\\usepackage{tabu}') }]);
    const zipB = rawZip([{ name: 'main.tex', data: DOC('\\title{x}') }]);
    for (const [ma, mb] of [[30, 5], [5, 30]]) {
      const { app, q } = setup();
      const a = app.handleFile(file('a.zip', zipA, ma));
      const b = app.handleFile(file('b.zip', zipB, mb));
      await Promise.all([a, b]);
      expect(`${q('#result-h').textContent} | ${q('#result .doc-name').textContent}`).toBe('No known blockers | Document: main.tex in b.zip');
    }
  });

  it('R1.1-2: with no main file, the warnings that explain why are shown', async () => {
    const cases: [Uint8Array, RegExp][] = [
      [rawZip([{ name: 'roster.tex', data: DOC('') }, { name: 'grades.csv', data: 'x' }]), /Remove student records from course folders: roster\.tex, grades\.csv/],
      [rawZip([{ name: '../course/main.tex', data: DOC('') }]), /Skipped \.\.\/course\/main\.tex: its path points outside the zip\./],
      [rawZip([{ name: 'main.tex', data: DOC(''), method: 12 }]), /main\.tex uses a compression method the scan cannot read/],
    ];
    for (const [bytes, re] of cases) {
      const { app, q } = setup();
      await app.handleFile(file('p.zip', bytes));
      expect(q('#error').textContent).toContain('No .tex file with \\documentclass was found');
      expect(q('#error').textContent).toMatch(/About the files you dropped/);
      expect(q('#error').textContent).toMatch(re);
    }
  });

  it('R1.1-3: a failed load of the package list says so, and the next drop works', async () => {
    let calls = 0;
    const { app, q } = setup({ loadStatus: async () => { if (calls++ === 0) throw new Error('chunk failed'); return idx; } });
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    expect(q('#error').textContent).toBe('The package list could not be loaded. Check your connection and drop the file again. Your file was not sent anywhere.');
    expect(q('#error').textContent).not.toMatch(/make the zip again/);
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    expect(q('#result-h').textContent).toBe('2 blockers found');
  });

  it('R1.1-4: a scan started from a button shows its error', async () => {
    const z = rawZip([
      { name: 'a.tex', data: DOC('\\usepackage{my}') },
      { name: 'b.tex', data: DOC('') },
      { name: 'my.sty', data: new Uint8Array(1024 * 1024), method: 8, declaredSize: 10 },
    ]);
    const { app, q, button } = setup();
    await app.handleFile(file('p.zip', z));
    expect(q('#status').textContent).toBe('This zip holds 2 documents. Choose one, or scan all.');
    const onError = vi.fn();
    window.addEventListener('error', onError);
    button('Scan a.tex').click();
    window.removeEventListener('error', onError);
    expect(q('#error').textContent).toMatch(/my\.sty expands to more than the size/);
    expect(q('#result-h').textContent).toBe('Could not scan');
    expect(q('#docs').hidden).toBe(true);
    expect(q('#status').textContent).toBe('');
    // "Scan all" goes through the same path.
    await app.handleFile(file('p.zip', z));
    button('Scan all').click();
    expect(q('#error').textContent).toMatch(/expands to more than the size/);
  });

  it('R1.1-13: the counts lines use the singular for one', async () => {
    const { app, q } = setup();
    const src = '\\DocumentMetadata{lang=en-US}\\documentclass{article}\\title{x}\\usepackage{tabu}\\usepackage{titlesec}\\usepackage{mysterypkg}'
      + '\\begin{document}\\includegraphics{a.png}\\begin{tikzpicture}\\end{tikzpicture}\\end{document}';
    await app.handleFile(file('p.zip', rawZip([{ name: 'main.tex', data: src }])));
    expect(q('#result .counts').textContent).toBe('1 blocker, 1 warning, 1 unknown, 1 working with tagging.');
    expect(q('.figures').textContent).toBe('1 image (1 without alt text), 1 TikZ picture (1 without alt text).');
  });
});

describe('review round 2', () => {
  const zipA = () => rawZip([{ name: 'main.tex', data: DOC('\\usepackage{tabu}') }]);
  const zipB = () => rawZip([{ name: 'main.tex', data: DOC('\\title{x}') }]);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shown = (q: (s: string) => HTMLElement) => `${q('#result-h').textContent} | ${q('#result .doc-name').textContent} | ${q('#error').textContent}`;
  const B_SHOWN = 'No known blockers | Document: main.tex in b.zip | ';

  it('R1.2-7: a drop goes stale while its file is read, and does not load the package list', async () => {
    let loads = 0;
    const { app, q } = setup({ loadStatus: async () => (loads++, idx) });
    const a = app.handleFile(file('a.zip', zipA(), 30));
    await app.handleFile(file('b.zip', zipB()));
    await a;
    expect(shown(q)).toBe(B_SHOWN);
    expect(loads).toBe(1);
  });

  it('R1.2-7: a drop goes stale while the package list loads, and reads none of its files', async () => {
    let t = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (t += 40));
    let calls = 0;
    let bDone = false;
    let pausesAfterB = 0;
    const many = rawZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.tex`, data: 'text' })));
    const { app, q } = setup({
      loadStatus: async () => (calls++ === 0 ? (await sleep(40), idx) : idx),
      pause: async () => void (bDone && pausesAfterB++),
    });
    const a = app.handleFile(file('a.zip', many));
    await sleep(10);
    await app.handleFile(file('b.zip', zipB()));
    bDone = true;
    await a;
    now.mockRestore();
    expect(shown(q)).toBe(B_SHOWN);
    expect(pausesAfterB).toBe(0);
  });

  it('R1.2-7: a drop goes stale while its package-list load fails', async () => {
    // R2.C-1: no timers. Drop B only once drop A has asked for the package list, and
    // fail that call (A's, the only call made before B) only after B has been shown.
    let calls = 0;
    let asked!: () => void;
    const aAsked = new Promise<void>((r) => (asked = r));
    let fail!: () => void;
    const failA = new Promise<void>((r) => (fail = r));
    const { app, q } = setup({
      loadStatus: async () => {
        if (calls++ === 0) {
          asked();
          await failA;
          throw new Error('lost');
        }
        return idx;
      },
    });
    const a = app.handleFile(file('a.zip', zipA()));
    await aAsked;
    await app.handleFile(file('b.zip', zipB()));
    expect(shown(q)).toBe(B_SHOWN);
    fail();
    await a;
    expect(calls).toBe(2);
    expect(shown(q)).toBe(B_SHOWN);
  });

  it('R1.2-7: a drop goes stale while it reads its files, and stops reading early (R1.2-8)', async () => {
    const many = rawZip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.tex`, data: 'text' })));
    let t = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (t += 40));
    let pauses = 0;
    let second: Promise<void> | null = null;
    const { app, q } = setup({
      pause: async () => {
        pauses++;
        if (!second) second = app.handleFile(file('b.zip', zipB()));
      },
    });
    await app.handleFile(file('a.zip', many));
    // The stale drop left the page alone (no "No .tex file" from its cut-short read).
    expect(q('#error').textContent).toBe('');
    await second;
    now.mockRestore();
    expect(shown(q)).toBe(B_SHOWN);
    // The stale drop stopped at its first pause; it did not read its other 29 files.
    expect(pauses).toBeLessThan(5);
  });

  it('R1.2-7: a stale drop that fails shows nothing', async () => {
    const { app, q } = setup();
    const a = app.handleFile({ name: 'a.zip', arrayBuffer: async () => { await sleep(30); throw new Error('read failed'); } });
    await app.handleFile(file('b.zip', zipB()));
    await a;
    expect(shown(q)).toBe(B_SHOWN);
  });

  it('R1.2-8: a result clears the "drop one file" message', async () => {
    const { app, q } = setup();
    const a = app.handleFile(file('b.zip', zipB(), 30));
    const two = new Event('drop');
    Object.defineProperty(two, 'dataTransfer', { value: { files: [file('a.tex', text('x')), file('b.tex', text('y'))] } });
    q('#drop').dispatchEvent(two);
    expect(q('#error').textContent).toMatch(/^Drop one zip/);
    await a;
    expect(shown(q)).toBe(B_SHOWN);
  });
});

describe('browserDownload', () => {
  it('clicks a temporary link to a blob', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    browserDownload('r.html', 'text/html', '<p>x</p>');
    vi.runAllTimers();
    HTMLAnchorElement.prototype.click = orig;
    vi.useRealTimers();
    expect(clicks).toEqual(['r.html']);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('R5a.1-8: a second click on "Alt text for figures" or "Suggest fixes" keeps the panel that is open', () => {
  it('the same panel stays, with the focus moved, and a draft that is out is drawn when it arrives', async () => {
    const { strToU8, zipSync } = await import('fflate');
    const { memoryStorage, setByokKey } = await import('../src/lib/llm');
    const storage = memoryStorage();
    setByokKey('k', storage);
    let release: () => void = () => {};
    const answer = { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Arrived.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    const { app, q, qa, button } = setup({
      figures: { storage, draft: { ask: () => new Promise((r) => (release = () => r(answer as never))) } },
    });
    const z = zipSync({ 'main.tex': strToU8('\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\includegraphics{a.pdf}\n\\end{document}\n'), 'a.pdf': strToU8('%PDF') });
    await app.handleFile(file('f.zip', z));
    button('Alt text for figures').click();
    const panel = q('#fixes');
    expect(document.activeElement?.id).toBe('figures-h');
    (qa('li.figure-item [data-role="draft"]')[0] as HTMLButtonElement).click();
    button('Suggest fixes').click();
    expect(q('#fixes')).toBe(panel);
    expect(document.activeElement?.id).toBe('fixes-h');
    button('Alt text for figures').click();
    expect(document.activeElement?.id).toBe('figures-h');
    release();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((q('li.figure-item textarea') as HTMLTextAreaElement).value).toBe('Arrived.');
  });
});
