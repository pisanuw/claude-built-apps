// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_TEXT, mountApp, browserDownload, type AppDeps, type DroppedFile } from '../src/ui/app';
import { rawZip, statusIndex, text, zipFixture } from './helpers';

const idx = statusIndex();

function file(name: string, bytes: Uint8Array): DroppedFile {
  return { name, arrayBuffer: async () => bytes.slice().buffer };
}

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
    const { app, q } = setup({ loadStatus: async () => { throw new Error('boom'); } });
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
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
