// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/ui/app';
import { download, h } from '../src/ui/dom';
import { analyze } from '../src/core/analyze';
import { parseHar } from '../src/core/capture';
import { saveCheck } from '../src/core/check';
import { sampleHar } from '../src/core/sample';
import { makeHar } from './helpers';

const NOW = () => new Date('2026-11-06T12:00:00Z');

function fileList(files: File[]): FileList {
  const list = { length: files.length, item: (i: number) => files[i] ?? null } as unknown as FileList;
  files.forEach((f, i) => ((list as unknown as Record<number, File>)[i] = f));
  (list as unknown as { [Symbol.iterator]: () => Iterator<File> })[Symbol.iterator] = () => files[Symbol.iterator]();
  return list;
}

function textFile(text: string, name: string): File {
  const f = new File([text], name);
  // jsdom's File has no text() in some versions.
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) });
  return f;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ui', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('starts with questions, two ways to add pages and an empty result', () => {
    const app = mount(root, NOW);
    expect(root.querySelector('h1')?.textContent).toBe('Health Page Tracker Watch');
    expect(root.querySelectorAll('input[name="practice"]')).toHaveLength(3);
    expect((root.querySelector('input[value="unsure"]') as HTMLInputElement).checked).toBe(true);
    expect(root.querySelectorAll('.zone')).toHaveLength(2);
    expect(root.querySelector('.results')?.textContent).toBe('');
    expect(app.state.report).toBeNull();
    expect(root.querySelectorAll('.vendors tbody tr').length).toBeGreaterThanOrEqual(50);
  });

  it('runs the example end to end, with the diff, kind changes and downloads', () => {
    const app = mount(root, NOW);
    (root.querySelector('#example') as HTMLButtonElement).click();
    const text = root.textContent ?? '';
    expect(text).toContain('Results for harborview-counseling.example');
    expect(text).toContain('Since your check of 2026-10-06');
    expect(text).toContain('New: Hotjar');
    expect(text).toContain('Now on more health pages: Meta Pixel (Facebook / Instagram) (/book)');
    expect((root.querySelector('input[value="hipaa"]') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('input[value="WA"]') as HTMLInputElement).checked).toBe(true);
    expect(root.querySelectorAll('.tool.review').length).toBe(5);
    expect(root.querySelector('.zone.loaded')).not.toBeNull();
    expect(app.state.report?.counts.review).toBe(5);

    // Mark the about page as a service page: Google Maps moves up from fyi.
    const sel = root.querySelector('select[aria-label="Kind of page /about"]') as HTMLSelectElement;
    sel.value = 'service';
    sel.dispatchEvent(new Event('change'));
    expect(app.state.report?.tools.find((t) => t.key === 'google-maps')?.level).toBe('check');

    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const print = vi.fn();
    window.print = print;
    for (const b of root.querySelectorAll<HTMLButtonElement>('.actions button')) b.click();
    expect(clicks).toHaveBeenCalledTimes(3);
    expect(print).toHaveBeenCalledTimes(1);

    // Printing opens closed sections and closes them again afterwards.
    const closed = root.querySelectorAll('.results details:not([open])').length;
    expect(closed).toBeGreaterThan(0);
    window.dispatchEvent(new Event('beforeprint'));
    expect(root.querySelectorAll('.results details:not([open])').length).toBe(0);
    window.dispatchEvent(new Event('afterprint'));
    expect(root.querySelectorAll('.results details:not([open])').length).toBe(closed);
  });

  it('changes the practice profile from the form', () => {
    const app = mount(root, NOW);
    app.addRecording(sampleHar(true), 'r.har');
    const wellness = root.querySelector('input[value="wellness"]') as HTMLInputElement;
    wellness.checked = true;
    wellness.dispatchEvent(new Event('change'));
    expect(app.state.profile.practice).toBe('wellness');
    expect(root.querySelector('.context')?.textContent).toMatch(/^If HIPAA does not cover you/);
    const nv = root.querySelector('input[value="NV"]') as HTMLInputElement;
    nv.checked = true;
    nv.dispatchEvent(new Event('change'));
    const wa = root.querySelector('input[value="WA"]') as HTMLInputElement;
    wa.checked = true;
    wa.dispatchEvent(new Event('change'));
    expect(app.state.profile.states).toEqual(['WA', 'NV']);
    nv.checked = false;
    nv.dispatchEvent(new Event('change'));
    expect(app.state.profile.states).toEqual(['WA']);
  });

  it('adds and removes inputs, and reports errors in plain words', () => {
    const app = mount(root, NOW);
    app.addRecording('not json', 'bad.har');
    expect(root.querySelector('.error')?.textContent).toMatch(/not a browser recording/);
    app.addRecording(sampleHar(true), 'good.har');
    expect((root.querySelector('.error') as HTMLElement).hidden).toBe(true);
    expect(root.querySelectorAll('.inputs li')).toHaveLength(1);
    app.addRecording(makeHar([{ url: 'https://other.test/', type: 'document' }]), 'other.har');
    expect(root.querySelector('.error')?.textContent).toMatch(/different site/);
    expect(root.querySelectorAll('.inputs li')).toHaveLength(1);
    (root.querySelector('.inputs button') as HTMLButtonElement).click();
    expect(app.state.inputs).toHaveLength(0);
    expect(root.querySelector('.results')?.textContent).toBe('');
    app.loadPrevious('{"app":"x"}', 'x.json');
    expect(root.querySelector('.error')?.textContent).toMatch(/not a check saved/);
    expect(app.state.previous).toBeNull();
    app.remove(999);
  });

  it('adds a page from pasted source through the form', () => {
    const app = mount(root, NOW);
    (root.querySelector('#src-url') as HTMLInputElement).value = 'https://clinic.test/book';
    (root.querySelector('#src-html') as HTMLTextAreaElement).value = '<html><script src="https://connect.facebook.net/fbevents.js"></script></html>';
    (root.querySelector('.source-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(app.state.inputs).toHaveLength(1);
    expect((root.querySelector('#src-url') as HTMLInputElement).value).toBe('');
    expect(root.textContent).toContain('Page source: /book');
    expect(root.textContent).toContain('This check read page source only');
    (root.querySelector('#src-url') as HTMLInputElement).value = 'https://clinic.test/x';
    (root.querySelector('#src-html') as HTMLTextAreaElement).value = 'plain words';
    (root.querySelector('.source-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(root.querySelector('.error')?.textContent).toMatch(/does not look like page source/);
    expect((root.querySelector('#src-html') as HTMLTextAreaElement).value).toBe('plain words');
  });

  it('reads dropped and chosen files', async () => {
    const app = mount(root, NOW);
    const [harZone, prevZone] = [...root.querySelectorAll<HTMLElement>('.zone')];
    harZone.dispatchEvent(new Event('dragover', { cancelable: true }));
    expect(harZone.classList.contains('over')).toBe(true);
    harZone.dispatchEvent(new Event('dragleave'));
    expect(harZone.classList.contains('over')).toBe(false);
    const drop = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
    drop.dataTransfer = { files: fileList([textFile(sampleHar(true), 'a.har')]) };
    harZone.dispatchEvent(drop);
    await flush();
    expect(app.state.inputs).toHaveLength(1);

    const prevInput = root.querySelector('#file-prev') as HTMLInputElement;
    const last = analyze(parseHar(sampleHar(false)), app.state.profile, {}, new Date('2026-10-06T00:00:00Z'));
    Object.defineProperty(prevInput, 'files', { value: fileList([textFile(saveCheck(last), 'last.json')]) });
    prevInput.dispatchEvent(new Event('change'));
    await flush();
    expect(prevZone.textContent).toContain('Loaded: last.json');
    expect(root.textContent).toContain('Since your check of 2026-10-06');

    const harInput = root.querySelector('#file-har') as HTMLInputElement;
    Object.defineProperty(harInput, 'files', { value: fileList([textFile(sampleHar(false), 'b.har')]) });
    harInput.dispatchEvent(new Event('change'));
    await flush();
    expect(app.state.inputs).toHaveLength(2);

    const prevDrop = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
    prevDrop.dataTransfer = undefined;
    prevZone.dispatchEvent(prevDrop);
    await flush();
  });

  it('filters the vendor table', () => {
    mount(root, NOW);
    const search = root.querySelector('.vendors input[type="search"]') as HTMLInputElement;
    search.value = 'jane';
    search.dispatchEvent(new Event('input'));
    const visible = [...root.querySelectorAll<HTMLTableRowElement>('.vendors tbody tr')].filter((r) => !r.hidden);
    expect(visible.map((r) => r.cells[0].textContent)).toEqual(['Jane']);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect([...root.querySelectorAll<HTMLTableRowElement>('.vendors tbody tr')].every((r) => !r.hidden)).toBe(true);
  });

  it('shows a same-site note when nothing changed and when the old check is for another site', () => {
    const app = mount(root, NOW);
    app.addRecording(sampleHar(true), 'now.har');
    const same = analyze(parseHar(sampleHar(true)), app.state.profile, {}, new Date('2026-10-06T00:00:00Z'));
    app.loadPrevious(saveCheck(same));
    expect(root.textContent).toContain('No change in the outside tools');
    const other = JSON.parse(saveCheck(same));
    other.site = 'elsewhere.test';
    other.pages.push({ url: 'https://www.harborview-counseling.example/old', kind: 'other' });
    other.tools[0].baa = 'ask';
    app.loadPrevious(JSON.stringify(other));
    expect(root.textContent).toContain('different site');
    expect(root.textContent).toContain('Not checked this time: /old');
    expect(root.textContent).toContain('Vendor BAA position changed');
  });
});

describe('dom helpers', () => {
  it('builds elements and downloads', () => {
    const fn = vi.fn();
    const el = h('button', { class: 'x', disabled: true, hidden: false, onclick: fn }, 'hi', null, false, undefined, h('span', {}, '!'));
    expect(el.outerHTML).toBe('<button class="x" disabled="">hi<span>!</span></button>');
    el.click();
    URL.createObjectURL = vi.fn(() => 'blob:y');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    download('a.txt', 'x', 'text/plain');
    vi.runAllTimers();
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:y');
    vi.useRealTimers();
  });
});
