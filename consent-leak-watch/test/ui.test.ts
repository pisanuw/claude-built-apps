// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/ui/app';
import { download, h } from '../src/ui/dom';
import { sampleNoChoice } from '../src/core/sample';
import { makeHar } from './helpers';

const NOW = () => new Date('2026-11-02T00:00:00Z');

describe('ui', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('starts with instructions and three empty drop zones', () => {
    mount(root, NOW);
    expect(root.querySelector('h1')?.textContent).toBe('Consent Leak Watch');
    expect(root.querySelectorAll('.zone')).toHaveLength(3);
    expect(root.querySelector('.results')?.textContent).toBe('');
  });

  it('runs the example end to end, with diff and downloads', () => {
    mount(root, NOW);
    (root.querySelector('#example') as HTMLButtonElement).click();
    const text = root.textContent ?? '';
    expect(text).toContain('3 trackers fired before choosing.');
    expect(text).toContain('1 tracker fired after Reject all.');
    expect(text).toContain('Likely cause: Meta for WooCommerce updated from 3.7.5 to 3.7.6');
    expect(text).toContain('stored choice: rejected');
    expect(root.querySelectorAll('.finding.leak').length).toBe(4);
    expect(root.querySelectorAll('.zone.loaded').length).toBe(3);
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    for (const b of root.querySelectorAll<HTMLButtonElement>('.actions button')) b.click();
    expect(clicks).toHaveBeenCalledTimes(2);
  });

  it('shows readable errors per zone and clears them on a good file', () => {
    const app = mount(root, NOW);
    app.load('no-choice', 'garbage', 'bad.har');
    const zone = root.querySelector('[data-slot="no-choice"]') as HTMLElement;
    expect(zone.classList.contains('error')).toBe(true);
    expect(zone.textContent).toContain('not a HAR recording');
    app.load('previous', makeHar([{ url: 'https://s.com/' }]), 'x.har');
    expect(root.querySelector('[data-slot="previous"]')?.textContent).toContain('Drop it in one of the two recording boxes');
    app.load('no-choice', sampleNoChoice(true), 'good.har');
    expect(zone.classList.contains('loaded')).toBe(true);
    expect(zone.textContent).toContain('Loaded: good.har');
  });

  it('warns about mixed sites and lists unknown cookies and notices', () => {
    const app = mount(root, NOW);
    app.load('no-choice', makeHar([{ url: 'https://a.com/', type: 'document' }, { url: 'https://a.com/x', cookie: 'mystery=1' }, { url: 'https://fonts.googleapis.com/css' }]), 'a.har');
    app.load('rejected', makeHar([{ url: 'https://b.com/', type: 'document' }]), 'b.har');
    const text = root.textContent ?? '';
    expect(text).toContain('different sites');
    expect(text).toContain('does not recognise');
    expect(text).toContain('worth knowing');
    expect(text).toContain('not recognised');
  });

  it('flags a previous check from another site', () => {
    const app = mount(root, NOW);
    app.loadExample();
    app.load('no-choice', makeHar([{ url: 'https://other.com/', type: 'document' }, { url: 'https://other.com/wp-content/plugins/x/a.js?ver=1' }]), 'o.har');
    expect(root.textContent).toContain('different site');
  });

  it('loads files from the file input and drag and drop', async () => {
    const app = mount(root, NOW);
    const input = root.querySelector('#file-no-choice') as HTMLInputElement;
    const file = { name: 'in.har', text: () => Promise.resolve(sampleNoChoice(false)) };
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(app.state.reports['no-choice']).toBeDefined());

    const zone = root.querySelector('[data-slot="rejected"]') as HTMLElement;
    const over = new Event('dragover', { cancelable: true });
    zone.dispatchEvent(over);
    expect(zone.classList.contains('over')).toBe(true);
    zone.dispatchEvent(new Event('dragleave'));
    expect(zone.classList.contains('over')).toBe(false);
    const drop = Object.assign(new Event('drop', { cancelable: true }), { dataTransfer: { files: [{ name: 'd.har', text: () => Promise.resolve(sampleNoChoice(false)) }] } });
    zone.dispatchEvent(drop);
    await vi.waitFor(() => expect(app.state.reports.rejected).toBeDefined());
    const empty = Object.assign(new Event('drop', { cancelable: true }), { dataTransfer: { files: [] } });
    zone.dispatchEvent(empty);
    Object.defineProperty(root.querySelector('#file-rejected') as HTMLInputElement, 'files', { value: [] });
    (root.querySelector('#file-rejected') as HTMLInputElement).dispatchEvent(new Event('change'));
  });

  it('h and download helpers', () => {
    const el = h('div', { hidden: true, off: false, title: 't' }, 'a', null, false, h('span'));
    expect(el.outerHTML).toBe('<div hidden="" title="t">a<span></span></div>');
    vi.useFakeTimers();
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    download('x.txt', 'hi', 'text/plain');
    expect(clicks).toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
  });
});
