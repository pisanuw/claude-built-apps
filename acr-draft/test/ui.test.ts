// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type MountOptions } from '../src/ui/app';
import { serializeProject } from '../src/core/project';
import { sampleProject } from '../src/core/sample';
import { rule, screen } from './helpers';

const NOW = () => new Date('2026-11-02T12:00:00Z');

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const AXE_JSON = JSON.stringify({
  url: 'https://app.example/settings',
  testEngine: { version: '4.11.0' },
  violations: [{ id: 'image-alt', help: 'Images must have alternative text', tags: ['wcag2a', 'wcag111'], nodes: [{ target: ['img.logo'] }] }],
  passes: [{ id: 'document-title', help: 'Documents must have <title>', tags: ['wcag242'], nodes: [{ target: ['html'] }] }],
  incomplete: [],
});

function setFile(input: HTMLInputElement, name: string, text: string): void {
  const file = { name, text: () => Promise.resolve(text) } as unknown as File;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (root: HTMLElement) => root.textContent ?? '';
const buttons = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label);
const click = (el: ParentNode, label: string, i = 0) => buttons(el, label)[i].click();

describe('ui', () => {
  let root: HTMLElement;
  let storage: Storage;
  let opts: MountOptions;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    storage = memoryStorage();
    opts = { now: NOW, storage };
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('starts on the product step with five tabs', () => {
    mount(root, opts);
    expect(root.querySelector('h1')?.textContent).toBe('ACR Draft');
    expect([...root.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(root.querySelector('#panel')?.getAttribute('aria-labelledby')).toBe('tab-product');
    expect((root.querySelector('#f-reportDate') as HTMLInputElement).value).toBe('2026-11-02');
    expect(root.querySelectorAll('fieldset.gate')).toHaveLength(12);
  });

  it('edits product details and product questions, saving to the browser', () => {
    const app = mount(root, opts);
    const name = root.querySelector('#f-name') as HTMLInputElement;
    name.value = 'Gradebook Pro';
    name.dispatchEvent(new Event('input'));
    const live = root.querySelector('#gate-live-no') as HTMLInputElement;
    live.checked = true;
    live.dispatchEvent(new Event('change'));
    expect(app.project().product.name).toBe('Gradebook Pro');
    expect(app.project().gates.live).toBe('no');
    expect(JSON.parse(storage.getItem('acr-draft:project')!).product.name).toBe('Gradebook Pro');
    expect(root.querySelector('#tab-review')?.textContent).toBe('3. Guided review (2/50)');
    click(root, 'Next: screens and scans');
    expect(root.querySelector('#tab-screens')?.getAttribute('aria-selected')).toBe('true');
  });

  it('runs the example through every step', () => {
    mount(root, opts);
    (root.querySelector('#example') as HTMLButtonElement).click();
    expect(text(root)).toContain('Loaded the example: QuizNest 4.2');
    expect((root.querySelector('#f-name') as HTMLInputElement).value).toBe('QuizNest');
    expect((root.querySelector('#gate-media-yes') as HTMLInputElement).checked).toBe(true);
    (root.querySelector('#tab-screens') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.screen')).toHaveLength(4);
    expect(text(root)).toContain('Imported axe results (axe-core 4.11.0, 2026-10-30): 1 failed rule on 1 element, 0 to check by hand, 8 passed.');
    expect(text(root)).toContain('npx @axe-core/cli@4.11.0 https://app.quiznest.example/signin');
    (root.querySelector('#tab-review') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.crit')).toHaveLength(50);
    const alt = root.querySelector('#c-1-1-1') as HTMLElement;
    expect(alt.textContent).toContain('Partially Supports');
    expect(alt.textContent).toContain('.course-card:nth-child(2) > img');
    expect(root.querySelector('#c-1-2-4')?.textContent).toContain('Not applicable because you answered No');
    expect(root.querySelector('#c-4-1-1 fieldset')).toBeNull();
    expect(root.querySelector('#c-1-3-2')?.textContent).toContain('Automated checkers cannot test this criterion');
    expect(root.querySelector('#c-1-4-1')?.textContent).toContain('found no failures on 1 screen');
    expect(root.querySelector('#c-1-4-10')?.textContent).toContain('Automated checkers cannot test');
    expect(root.querySelector('#c-1-4-12')?.textContent).toContain('No scan results cover this criterion yet.');
    expect(root.querySelector('#c-1-4-3')?.textContent).toContain('Check by hand: ');
    (root.querySelector('#tab-report') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.tile')).toHaveLength(5);
    expect(root.querySelector('.callout.bad')).not.toBeNull();
    expect(root.querySelector('.not-yet')?.textContent).toMatch(/^Not evaluated yet \(\d+\): /);
    expect(text(root)).toContain('1.4.3 Contrast (Minimum): You marked this as passing');
    expect(root.querySelector('details.checks')).not.toBeNull();
    expect(root.querySelectorAll('table')).toHaveLength(2);
    (root.querySelector('#tab-compare') as HTMLButtonElement).click();
    expect(text(root)).toContain('No earlier release loaded.');
    (root.querySelector('#compare-example') as HTMLButtonElement).click();
    const diff = root.querySelector('.diff') as HTMLElement;
    expect(diff.textContent).toContain('QuizNest 4.1 (2026-07-15) → QuizNest 4.2 (2026-10-30)');
    expect(diff.textContent).toContain('Got worse (1)');
    expect(diff.textContent).toContain('Screens added: Sign in.');
    expect(diff.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('records answers and notes in the guided review without re-rendering the card', () => {
    const app = mount(root, opts);
    app.openTab('review');
    const card = root.querySelector('#c-2-4-7') as HTMLElement;
    const pass = card.querySelector('#o-2\\.4\\.7-pass') as HTMLInputElement;
    pass.checked = true;
    pass.dispatchEvent(new Event('change'));
    expect(card.querySelector('.level')?.textContent).toBe('Supports');
    expect(card.querySelector('.warnings')?.textContent).toContain('no evidence note');
    const note = card.querySelector('textarea') as HTMLTextAreaElement;
    note.value = 'Focus ring visible everywhere';
    note.dispatchEvent(new Event('input'));
    expect(root.querySelector('#c-2-4-7')).toBe(card);
    expect(card.querySelector('.warnings')?.textContent).toBe('');
    expect(card.querySelector('.remark')?.textContent).toBe('Report remark: Focus ring visible everywhere.');
    expect(app.project().answers['2.4.7']).toEqual({ outcome: 'pass', note: 'Focus ring visible everywhere' });
  });

  it('filters the review list', () => {
    const app = mount(root, opts);
    app.setProject(sampleProject());
    app.openTab('review');
    const pick = (v: string) => {
      const sel = root.querySelector('#filter') as HTMLSelectElement;
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
      return root.querySelectorAll('.crit').length;
    };
    const failures = pick('failures');
    expect(failures).toBe(5); // 1.1.1, 1.3.5, 1.4.3, 2.1.1, 4.1.2
    expect(pick('untested')).toBeLessThan(50);
    expect(pick('attention')).toBeGreaterThan(0);
    app.setProject({ ...sampleProject(), screens: [] });
    expect(pick('failures')).toBe(0);
    expect(text(root)).toContain('Nothing matches this filter.');
    expect(pick('all')).toBe(50);
  });

  it('imports axe results by paste, upload and command-line file, and scans pasted HTML', async () => {
    const scanHtml = vi.fn(async () => ({ scan: { source: 'html-scan' as const, engine: 'axe-core 4.11.0', url: '', timestamp: '', rules: [rule('image-alt', 'violation', ['1.1.1'])] }, removedScripts: 1, unstyled: true }));
    const app = mount(root, { ...opts, scanHtml });
    app.openTab('screens');
    expect(text(root)).toContain('No screens yet.');
    (root.querySelector('#add-screen') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(root.querySelector('.screen input[type="text"]'));
    const card = () => root.querySelector('.screen') as HTMLElement;
    click(card(), 'Paste axe results');
    click(card(), 'Use these results');
    expect(card().textContent).toContain('Paste something first.');
    (card().querySelector('textarea') as HTMLTextAreaElement).value = 'oops';
    click(card(), 'Use these results');
    expect(card().textContent).toContain('not valid JSON');
    (card().querySelector('textarea') as HTMLTextAreaElement).value = AXE_JSON;
    click(card(), 'Use these results');
    expect(text(root)).toContain('Imported results for Screen 1.');
    expect(app.project().screens[0].url).toBe('https://app.example/settings');
    expect(card().textContent).toContain('1 failed rule on 1 element');
    click(card(), 'Paste axe results');
    click(card(), 'Cancel');
    expect(card().querySelector('textarea')).toBeNull();

    // upload: two pages in one file adds a screen
    setFile(card().querySelector('input[type="file"]') as HTMLInputElement, 'cli.json', `[${AXE_JSON},${AXE_JSON.replace('/settings', '/')}]`);
    await flush();
    expect(text(root)).toContain('added 1 more screen from the same file');
    expect(app.project().screens.map((s) => s.name)).toEqual(['Screen 1', 'app.example']);
    setFile(card().querySelector('input[type="file"]') as HTMLInputElement, 'bad.json', '{}');
    await flush();
    expect(root.querySelector('.status')?.textContent).toBe('bad.json: These are not axe-core results (no "violations" list found).');
    expect(root.querySelector('.status')?.classList.contains('error')).toBe(true);

    // command-line import
    const cli = [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((i) => i.getAttribute('aria-label') === 'Command-line results file')!;
    setFile(cli, 'all.json', `[${AXE_JSON.replace('/settings', '/grades/')}]`);
    await flush();
    expect(text(root)).toContain('Added 1 screen from the file.');
    expect(app.project().screens[2].name).toBe('/grades');
    setFile(cli, 'x.json', 'nope');
    await flush();
    expect(root.querySelector('.status')?.textContent).toContain('x.json: That is not valid JSON');
    expect(app.importCli(`[${AXE_JSON},${AXE_JSON}]`)).toBe('Added 2 screens from the file.');
    expect(() => app.importAxe('missing', AXE_JSON)).toThrow('That screen no longer exists.');

    // HTML scan
    app.openTab('screens');
    click(card(), 'Scan page HTML');
    click(card(), 'Scan this HTML');
    expect(card().textContent).toContain('Paste something first.');
    (card().querySelector('textarea') as HTMLTextAreaElement).value = '<html><body><img src=a></body></html>';
    click(card(), 'Scan this HTML');
    await flush();
    expect(scanHtml).toHaveBeenCalledWith('<html><body><img src=a></body></html>', 'https://app.example/settings');
    expect(root.querySelector('.status')?.textContent).toBe('Scanned Screen 1. 1 script was removed before scanning. The HTML had no stylesheets, so contrast results may be wrong; add the screen address so its styles can load.');
    expect(card().textContent).toContain('Scanned from pasted HTML');
    scanHtml.mockRejectedValueOnce(new Error('frame blocked'));
    click(card(), 'Scan page HTML');
    (card().querySelector('textarea') as HTMLTextAreaElement).value = '<p>x</p>';
    click(card(), 'Scan this HTML');
    await flush();
    expect(card().textContent).toContain('The scan failed: frame blocked');

    // rename and remove
    const nameInput = card().querySelector('input[type="text"]') as HTMLInputElement;
    nameInput.value = 'Settings';
    nameInput.dispatchEvent(new Event('input'));
    const url = card().querySelector('input[type="url"]') as HTMLInputElement;
    url.value = 'https://app.example/s';
    url.dispatchEvent(new Event('input'));
    expect(app.project().screens[0]).toMatchObject({ name: 'Settings', url: 'https://app.example/s' });
    expect(card().getAttribute('aria-label')).toBe('Settings');
    const before = app.project().screens.length;
    click(card(), 'Remove screen');
    expect(app.project().screens).toHaveLength(before - 1);
    expect(text(root)).toContain('Removed Settings.');
    click(root, 'Next: guided review');
    expect(root.querySelector('#tab-review')?.getAttribute('aria-selected')).toBe('true');
  });

  it('copies the console snippet, or explains when the browser refuses', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const app = mount(root, opts);
    app.openTab('screens');
    click(root, 'Copy snippet');
    await flush();
    expect(writeText.mock.calls[0][0]).toContain('axe.run(document');
    expect(root.querySelector('.status')?.textContent).toBe('Snippet copied.');
    click(root, 'Copy command');
    await flush();
    expect(root.querySelector('.status')?.textContent).toContain('blocked copying');
  });

  it('downloads the report as Word, HTML and project file, and prints', async () => {
    const makeDocx = vi.fn().mockResolvedValueOnce(new Blob(['docx'])).mockRejectedValueOnce(new Error('out of memory'));
    const app = mount(root, { ...opts, makeDocx });
    app.setProject(sampleProject());
    app.openTab('report');
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    (root.querySelector('#dl-docx') as HTMLButtonElement).click();
    await flush();
    expect(makeDocx).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.status')?.textContent).toBe('Word file downloaded.');
    (root.querySelector('#dl-docx') as HTMLButtonElement).click();
    await flush();
    expect(root.querySelector('.status')?.textContent).toBe('Could not build the Word file: out of memory');
    expect((root.querySelector('#dl-docx') as HTMLButtonElement).disabled).toBe(false);
    (root.querySelector('#dl-html') as HTMLButtonElement).click();
    (root.querySelector('#dl-project') as HTMLButtonElement).click();
    expect(clicks).toHaveBeenCalledTimes(3);
    expect(root.querySelector('.status')?.textContent).toBe('Project file downloaded. Keep it with this release.');
    (root.querySelector('#print') as HTMLButtonElement).click();
    const frame = document.querySelector('iframe.print-frame') as HTMLIFrameElement;
    expect(frame.srcdoc).toContain('QuizNest Accessibility Conformance Report');
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, 'print', { value: print, configurable: true });
    frame.dispatchEvent(new Event('load'));
    expect(print).toHaveBeenCalled();
    clicks.mockRestore();
  });

  it('jumps from a report issue to the criterion and shows the all-clear state', () => {
    const app = mount(root, opts);
    app.setProject(sampleProject());
    app.openTab('report');
    const first = root.querySelector('.issues button.link') as HTMLButtonElement;
    first.click();
    expect(root.querySelector('#tab-review')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.classList.contains('crit')).toBe(true);
    // answer everything with evidence: no blocking issues left
    const p = app.project();
    p.screens = [];
    for (const c of root.querySelectorAll('.crit')) {
      const id = c.id.slice(2).replace(/-/g, '.');
      p.answers[id] = { outcome: 'pass', note: 'Tested by hand.' };
    }
    app.setProject(p);
    app.openTab('report');
    expect(root.querySelector('.callout.good')?.textContent).toContain('Every criterion has a level backed by your evidence.');
    expect(root.querySelector('#tab-report')?.textContent).toBe('4. Report');
    expect(root.querySelector('details.checks')).toBeNull();
  });

  it('compares with an earlier project file and reports bad files', async () => {
    const app = mount(root, opts);
    app.setProject(sampleProject());
    app.openTab('compare');
    const input = root.querySelector('#prev-file') as HTMLInputElement;
    const prev = sampleProject();
    prev.product.version = '4.0';
    prev.screens = [screen('Old screen', [rule('image-alt', 'violation', ['1.1.1'], 2)])];
    setFile(input, 'old.json', serializeProject(prev, NOW()));
    await flush();
    expect(root.querySelector('.status')?.textContent).toBe('Compared with old.json.');
    expect(text(root)).toContain('Screens no longer tested: Old screen. A buyer may ask why.');
    setFile(root.querySelector('#prev-file') as HTMLInputElement, 'bad.json', '{}');
    await flush();
    expect(root.querySelector('.status')?.textContent).toContain('bad.json: This is not an ACR Draft project file');
    const d = app.compareWith(sampleProject());
    expect(d.levelChanges).toEqual([]);
    app.openTab('compare');
    expect(text(root)).toContain('Automated failures are the same as before.');
    app.setProject({ ...sampleProject(), product: { ...sampleProject().product, name: 'Other' } });
    expect(root.querySelector('#compare-example')).toBeNull();
  });

  it('opens a saved project, restores from the browser, and starts over', async () => {
    const saved = serializeProject(sampleProject(), NOW());
    const restored = mount(root, { now: NOW, storage: memoryStorage({ 'acr-draft:project': saved }) });
    expect(root.querySelector('.status')?.textContent).toBe('Restored your work from this browser.');
    expect(restored.project().product.name).toBe('QuizNest');
    setFile(root.querySelector('#open-file') as HTMLInputElement, 'q.json', saved);
    await flush();
    expect(root.querySelector('.status')?.textContent).toBe('Opened q.json.');
    setFile(root.querySelector('#open-file') as HTMLInputElement, 'q.txt', 'hello');
    await flush();
    expect(root.querySelector('.status')?.textContent).toContain('not valid JSON');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    (root.querySelector('#new') as HTMLButtonElement).click();
    expect(restored.project().product.name).toBe('QuizNest');
    (root.querySelector('#new') as HTMLButtonElement).click();
    expect(restored.project().product.name).toBe('');
    expect(root.querySelector('.status')?.textContent).toBe('Started a new, empty report.');
    (root.querySelector('#new') as HTMLButtonElement).click(); // empty project: no confirm needed
    expect(confirm).toHaveBeenCalledTimes(2);
    // a file input change with no file does nothing
    const open = root.querySelector('#open-file') as HTMLInputElement;
    Object.defineProperty(open, 'files', { value: [], configurable: true });
    open.dispatchEvent(new Event('change'));
  });

  it('survives broken or blocked storage', () => {
    const broken = memoryStorage({ 'acr-draft:project': '{"format":"other"}' });
    const app = mount(root, { now: NOW, storage: broken });
    expect(app.project().product.name).toBe('');
    const full = memoryStorage();
    full.setItem = () => {
      throw new Error('quota');
    };
    const app2 = mount(root, { now: NOW, storage: full });
    expect(() => app2.setProject(sampleProject())).not.toThrow();
    const app3 = mount(root, { now: NOW, storage: null });
    app3.setProject(sampleProject());
    expect(app3.project().product.name).toBe('QuizNest');
    const app4 = mount(root, { now: NOW });
    expect(app4.project().format).toBe('acr-draft');
  });

  it('moves between tabs with arrow, Home and End keys', () => {
    mount(root, opts);
    const key = (k: string) => (document.activeElement ?? root.querySelector('#tab-product'))!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    (root.querySelector('#tab-product') as HTMLElement).focus();
    key('ArrowRight');
    expect(document.activeElement?.id).toBe('tab-screens');
    key('End');
    expect(document.activeElement?.id).toBe('tab-compare');
    key('ArrowRight');
    expect(document.activeElement?.id).toBe('tab-product');
    key('ArrowLeft');
    expect(document.activeElement?.id).toBe('tab-compare');
    key('Home');
    expect(document.activeElement?.id).toBe('tab-product');
    key('x');
    expect(document.activeElement?.id).toBe('tab-product');
  });
});
