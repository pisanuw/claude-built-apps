// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, STORAGE_KEY, type MountOptions } from '../src/ui/app';
import { parseFleet, serializeFleet } from '../src/core/model';
import { sampleFleet } from '../src/core/sample';
import { check, fleet, site } from './helpers';

const NOW = () => new Date('2026-11-04T12:00:00Z');

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

function setFile(input: HTMLInputElement, name: string, text: string): void {
  const file = { name, text: () => Promise.resolve(text) } as unknown as File;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string, ev = 'change'): void {
  el.value = v;
  el.dispatchEvent(new Event(ev));
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (root: HTMLElement) => root.textContent ?? '';
const status = (root: HTMLElement) => root.querySelector('[role="status"]')?.textContent ?? '';
const buttons = (el: ParentNode, label: string | RegExp) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')));
const click = (el: ParentNode, label: string | RegExp, i = 0) => {
  const b = buttons(el, label)[i];
  if (!b) throw new Error(`no button ${label}`);
  b.click();
};
const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

const AXE = JSON.stringify({
  url: 'https://shop.example.com/contact',
  timestamp: '2026-11-03T10:00:00Z',
  testEngine: { version: '4.11.0' },
  violations: [{ id: 'label', help: 'Form elements must have labels', impact: 'critical', tags: ['wcag2a', 'wcag412'], nodes: [{}, {}] }],
  incomplete: [{ id: 'color-contrast' }],
});

describe('ui', () => {
  let root: HTMLElement;
  let storage: Storage;
  let opts: MountOptions;
  let copied: string[];
  let confirmAnswer: boolean;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    storage = memoryStorage();
    copied = [];
    confirmAnswer = true;
    opts = {
      now: NOW,
      storage,
      confirm: () => confirmAnswer,
      copy: (t) => {
        copied.push(t);
        return Promise.resolve();
      },
      print: vi.fn(),
    };
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  function withShop() {
    storage.setItem(STORAGE_KEY, serializeFleet(fleet([site()], [check('s1', '2026-10-01', { '/': ['image-alt', 'color-contrast'], '/contact': [] }), check('s1', '2026-11-01', { '/': ['color-contrast', 'region'] })])));
    return mount(root, opts);
  }

  it('starts empty with an introduction and five tabs', () => {
    mount(root, opts);
    expect($(root, 'h1').textContent).toBe('Accessibility Fleet Log');
    expect([...root.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(text(root)).toContain('Try the demo fleet');
    for (const id of ['site', 'add', 'reports']) {
      click(root, TABLABEL[id]);
      expect(text(root)).toContain('No client sites yet');
    }
    click(root, 'Go to All sites');
    expect($(root, '#panel').getAttribute('aria-labelledby')).toBe('tab-fleet');
  });

  it('loads the demo fleet and shows the dashboard', () => {
    const app = mount(root, opts);
    click(root, 'Try the demo fleet');
    expect(app.fleet().sites).toHaveLength(6);
    expect(status(root)).toContain('demo fleet');
    expect(root.querySelectorAll('table.fleet tbody tr')).toHaveLength(6);
    expect(text(root)).toContain('Problems that come up across clients');
    expect(text(root)).toContain('check due');
    expect(parseFleet(storage.getItem(STORAGE_KEY)!).sites).toHaveLength(6);
    for (const v of ['open', 'lastCheck', 'name']) {
      setValue($(root, '#sort'), v);
      expect($<HTMLSelectElement>(root, '#sort').value).toBe(v);
    }
    expect($(root, 'table.fleet tbody th button').textContent).toBe('Bright Paws Grooming');
    click(root, 'Corner Hardware');
    expect($(root, '#panel').getAttribute('aria-labelledby')).toBe('tab-site');
    expect(text(root)).toContain('came back');
  });

  it('adds a site and checks the address', () => {
    const app = mount(root, opts);
    root.querySelector<HTMLFormElement>('form.add-site')!.dispatchEvent(new Event('submit'));
    expect(status(root)).toContain('https://');
    setValue($(root, '#new-url'), 'https://www.cafe.example.com/');
    setValue($(root, '#new-client'), 'Cafe GmbH');
    root.querySelector<HTMLFormElement>('form.add-site')!.dispatchEvent(new Event('submit'));
    expect(app.fleet().sites[0]).toMatchObject({ name: 'cafe.example.com', client: 'Cafe GmbH', owner: 'Cafe GmbH', url: 'https://www.cafe.example.com' });
    expect(status(root)).toContain('Added cafe.example.com');
    expect(text(root)).toContain('never');
  });

  it('edits site details, notes and filters the issue log', () => {
    const app = withShop();
    app.openTab('site', 's1');
    setValue($(root, '#site-name'), 'Shop Two');
    setValue($(root, '#site-manualReview'), 'bad');
    setValue($(root, '#site-manualReview'), '2026-10-15');
    setValue($(root, '#site-jurisdiction'), 'us');
    setValue($(root, '#site-target'), '2.2');
    setValue($(root, '#site-knownLimits'), 'Widget');
    expect(app.fleet().sites[0]).toMatchObject({ name: 'Shop Two', manualReview: '2026-10-15', jurisdiction: 'us', target: '2.2', knownLimits: 'Widget' });
    const note = $<HTMLInputElement>(root, 'input.note');
    setValue(note, 'Theme update pending');
    expect(Object.values(app.fleet().notes)).toEqual(['Theme update pending']);
    setValue(note, '  ');
    expect(app.fleet().notes).toEqual({});
    click(root, /^Fixed \(/);
    expect(root.querySelectorAll('table.issues tbody tr')).toHaveLength(1);
    expect(text(root)).toContain('image-alt');
    click(root, /^All \(/);
    expect(root.querySelectorAll('table.issues tbody tr')).toHaveLength(3);
    click(root, 'Download issue log (CSV)');
    expect(URL.createObjectURL).toHaveBeenCalled();
    setValue($(root, '#site-target'), '2.1');
    expect(app.fleet().sites[0].target).toBe('2.1');
  });

  it('copies, saves and compares statement versions', async () => {
    const app = withShop();
    app.openTab('site', 's1');
    expect(text(root)).toContain('No version saved yet.');
    click(root, 'Copy as HTML');
    click(root, 'Copy as text');
    await flush();
    expect(copied[0]).toContain('<h1>Accessibility statement for Shop</h1>');
    expect(copied[1]).toContain('# Accessibility statement for Shop');
    expect(status(root)).toContain('Copied the statement as text');
    click(root, 'Save as new dated version');
    expect(app.fleet().statements).toHaveLength(1);
    expect(buttons(root, 'Saved version is current')[0].disabled).toBe(true);
    // Change the site so the draft differs, then save a second version.
    setValue($(root, '#site-contactEmail'), 'help@shop.example.com');
    app.openTab('site', 's1');
    expect(text(root)).toContain('The draft below differs from it.');
    click(root, 'Save as new dated version');
    click(root, 'What changed');
    expect(root.querySelector('ul.diff li.added')?.textContent).toContain('help@shop.example.com');
    click(root, 'What changed');
    expect(root.querySelector('ul.diff')).toBeNull();
    click(root, 'Download');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('reports a blocked clipboard', async () => {
    opts.copy = () => Promise.reject(new Error('no'));
    const app = withShop();
    app.openTab('site', 's1');
    click(root, 'Copy as text');
    await flush();
    expect(status(root)).toContain('blocked');
    app.openTab('add');
    click(root, 'Copy snippet');
    await flush();
    expect(status(root)).toContain('blocked');
  });

  it('deletes checks and removes sites only after confirming', () => {
    const app = withShop();
    app.openTab('site', 's1');
    confirmAnswer = false;
    click(root, 'Delete');
    click(root, 'Remove site');
    expect(app.fleet().checks).toHaveLength(2);
    expect(app.fleet().sites).toHaveLength(1);
    confirmAnswer = true;
    click(root, 'Delete');
    expect(app.fleet().checks).toHaveLength(1);
    expect(status(root)).toContain('Deleted the check of 1 Nov 2026');
    click(root, 'Remove site');
    expect(app.fleet().sites).toHaveLength(0);
    expect(text(root)).toContain('No client sites yet');
  });

  it('imports axe results: preview, site match, add to log', () => {
    storage.setItem(STORAGE_KEY, serializeFleet(fleet([site('other', { name: 'Other', url: 'https://other.example.com' }), site()])));
    const app = mount(root, opts);
    app.openTab('site', 'other');
    expect(text(root)).toContain('No checks yet.');
    click(root, 'Add the first results');
    expect(text(root)).toContain('Getting results without installing anything');
    expect($<HTMLAnchorElement>(root, 'a.bookmarklet').href.startsWith('javascript:')).toBe(true);
    click(root, 'Copy snippet');
    expect(copied[0]).toContain('axe.run');
    const ta = $<HTMLTextAreaElement>(root, '#paste');
    setValue(ta, AXE, 'input');
    click(root, 'Preview');
    expect(text(root)).toContain('axe-core 4.11.0: 1 page, 1 failing rule. It will be logged for Shop on 3 Nov 2026.');
    expect(text(root)).toContain('needs review');
    expect($<HTMLSelectElement>(root, '#add-site').value).toBe('s1');
    setValue($(root, '#check-date'), '2026-11-02');
    click(root, 'Preview');
    expect(text(root)).toContain('on 2 Nov 2026');
    click(root, 'Add this check to the log');
    expect(app.fleet().checks).toEqual([expect.objectContaining({ siteId: 's1', date: '2026-11-02', engine: 'axe-core 4.11.0' })]);
    expect($(root, '#panel').getAttribute('aria-labelledby')).toBe('tab-site');
    expect(status(root)).toContain('Logged the check of 2 Nov 2026 for Shop');
  });

  it('warns about pages from another site and shows import errors', () => {
    const app = withShop();
    app.openTab('add');
    setValue($(root, '#paste'), JSON.stringify({ url: 'https://elsewhere.example/', violations: [] }), 'input');
    click(root, 'Preview');
    expect(text(root)).toContain('1 page is not on https://shop.example.com');
    setValue($(root, '#add-site'), 's1');
    setValue($(root, '#paste'), '{broken', 'input');
    click(root, 'Preview');
    expect(status(root)).toContain('cannot be read');
    expect(text(root)).not.toContain('Add this check to the log');
  });

  it('imports CSV files with adjustable columns', async () => {
    const app = withShop();
    app.openTab('add');
    setValue($(root, '#page-url'), 'https://shop.example.com/x');
    setFile($(root, '#file'), 'export.csv', 'Where,What,Sev\nhttps://shop.example.com/a,image-alt,high\nhttps://shop.example.com/b,label,low');
    await flush();
    expect(status(root)).toContain('column with the issue');
    expect(text(root)).toContain('Which column is which?');
    setValue($(root, '#map-rule'), '1');
    expect(text(root)).toContain('Columns used');
    expect(text(root)).toContain('CSV import: 1 page');
    setValue($(root, '#map-url'), '0');
    expect(text(root)).toContain('CSV import: 2 pages, 2 failing rules');
    setValue($(root, '#map-rule'), '-1');
    expect(status(root)).toContain('column with the issue');
    const input = $<HTMLInputElement>(root, '#file');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
  });

  it('previews, prints and downloads monthly reports', () => {
    const app = withShop();
    app.openTab('reports', 's1');
    expect(text(root)).toContain('Add your details');
    const frame = $<HTMLIFrameElement>(root, 'iframe.report-frame');
    expect(frame.srcdoc).toContain('Accessibility report, November 2026');
    setValue($(root, '#report-month'), '2026-10');
    expect($<HTMLIFrameElement>(root, 'iframe.report-frame').srcdoc).toContain('October 2026');
    click(root, 'Print or save as PDF');
    expect(opts.print).toHaveBeenCalledTimes(1);
    click(root, 'Download as HTML');
    expect(URL.createObjectURL).toHaveBeenCalled();
    setValue($(root, '#report-site'), 's1');
    click(root, 'Add your details');
    expect($(root, '#panel').getAttribute('aria-labelledby')).toBe('tab-settings');
  });

  it('saves agency details and backs up, opens and clears the fleet', async () => {
    const app = withShop();
    app.openTab('settings');
    setValue($(root, '#ag-name'), 'Lakeside Web');
    setValue($(root, '#ag-color'), '#336699');
    click(root, 'Save details');
    expect(app.fleet().agency).toMatchObject({ name: 'Lakeside Web', color: '#336699' });
    expect(status(root)).toBe('Saved your details.');
    click(root, 'Save fleet file');
    expect(URL.createObjectURL).toHaveBeenCalled();
    const input = () => $<HTMLInputElement>(root, '#open-fleet');
    setFile(input(), 'bad.json', '{"x":1}');
    await flush();
    expect(status(root)).toContain('not a fleet file');
    confirmAnswer = false;
    setFile(input(), 'demo.json', serializeFleet(sampleFleet('2026-11-04')));
    await flush();
    expect(app.fleet().sites).toHaveLength(1);
    confirmAnswer = true;
    setFile(input(), 'demo.json', serializeFleet(sampleFleet('2026-11-04')));
    await flush();
    expect(app.fleet().sites).toHaveLength(6);
    expect(status(root)).toContain('Opened demo.json: 6 sites');
    Object.defineProperty(input(), 'files', { value: [], configurable: true });
    input().dispatchEvent(new Event('change'));
    confirmAnswer = false;
    click(root, 'Clear everything');
    expect(app.fleet().sites).toHaveLength(6);
    confirmAnswer = true;
    click(root, 'Clear everything');
    expect(app.fleet().sites).toHaveLength(0);
  });

  it('copes with storage that is broken, full or missing', () => {
    storage.setItem(STORAGE_KEY, 'not json');
    mount(root, opts);
    expect(status(root)).toContain('could not be read');
    const full = memoryStorage();
    full.setItem = () => {
      throw new Error('quota');
    };
    const app = mount(root, { ...opts, storage: full });
    click(root, 'Try the demo fleet');
    app.openTab('settings');
    expect(text(root)).toContain('This browser is not saving your work');
    const none = mount(root, { ...opts, storage: null });
    none.setFleet(sampleFleet('2026-11-04'));
    expect(none.fleet().sites).toHaveLength(6);
  });

  it('moves between tabs with the arrow keys', () => {
    withShop();
    const key = (k: string) => {
      const sel = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
      sel.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      return root.querySelector('[role="tab"][aria-selected="true"]')!.id;
    };
    expect(key('ArrowRight')).toBe('tab-site');
    expect(document.activeElement?.id).toBe('tab-site');
    expect(key('ArrowLeft')).toBe('tab-fleet');
    expect(key('ArrowLeft')).toBe('tab-settings');
    expect(key('Home')).toBe('tab-fleet');
    expect(key('End')).toBe('tab-settings');
    expect(key('x')).toBe('tab-settings');
  });

  it('uses real browser defaults when no options are given', () => {
    window.localStorage.clear();
    const app = mount(root);
    click(root, 'Try the demo fleet');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    app.openTab('settings');
    click(root, 'Clear everything');
    expect(spy).toHaveBeenCalled();
    app.openTab('reports');
    const frame = $<HTMLIFrameElement>(root, 'iframe.report-frame');
    const print = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { focus: vi.fn(), print, close: vi.fn() }, configurable: true });
    click(root, 'Print or save as PDF');
    expect(print).toHaveBeenCalled();
    window.localStorage.clear();
  });
});

const TABLABEL: Record<string, string> = { site: 'Site log', add: 'Add results', reports: 'Client reports' };
