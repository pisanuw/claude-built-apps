// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Files, MemoryFileStore } from '../src/store/stores';
import { mountApp } from '../src/ui/app';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 25; i++) await tick();
};
let root: HTMLElement;
const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

describe('documents in the page', () => {
  it('downloads the summary, the worksheets, the W-2c list and one employee’s worksheet, and prints', async () => {
    const got: { name: string; data: string | Uint8Array; type?: string }[] = [];
    const print = vi.fn();
    let n = 0;
    await mountApp(root, { files: new Files(new MemoryFileStore('browser')), newId: () => `id${++n}`, confirm: () => true, saveDelay: 0, now: () => new Date('2026-11-11T12:00:00Z'), download: (name, data, type) => got.push({ name, data, type }), print });
    await settle();
    button('Try the sample employer').click();
    await settle();
    button('Employer summary (PDF)').click();
    button('All worksheets (PDF)').click();
    button('W-2c list (CSV, 6)').click();
    button('Print results').click();
    expect(print).toHaveBeenCalled();
    const dev = [...root.querySelectorAll('table.results tbody tr')].find((tr) => tr.textContent?.includes('Dev Patel'))!.querySelector('button') as HTMLButtonElement;
    dev.click();
    await settle();
    button('Worksheet for Dev Patel (PDF)').click();
    expect(got.map((g) => [g.name, g.type ?? 'text/csv'])).toEqual([
      ['tt-summary-cedar-lane-kitchen-sample-2026.pdf', 'application/pdf'],
      ['tt-worksheets-cedar-lane-kitchen-sample-2026.pdf', 'application/pdf'],
      ['tt-w2c-list-cedar-lane-kitchen-sample-2026.csv', 'text/csv'],
      ['tt-worksheet-dev-patel-2026.pdf', 'application/pdf'],
    ]);
    expect(got[0].data).toBeInstanceOf(Uint8Array);
    expect(String(got[2].data)).toContain('E102,Dev Patel,1706.25,1815.25,109.00');
  });

  it('offers no W-2c list when nothing needs correcting, and a worksheet for an employee without overtime', async () => {
    const got: string[] = [];
    let n = 0;
    await mountApp(root, { files: new Files(new MemoryFileStore('browser')), newId: () => `id${++n}`, confirm: () => true, saveDelay: 0, download: (name) => got.push(name) });
    await settle();
    const input = root.querySelector('#hours-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['Employee,Date,Hours,Rate\nJo,2026-03-02,8,20\n'], 'a.csv')] });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(button('W-2c list (CSV)').disabled).toBe(true);
    (root.querySelector('table.results tbody tr button') as HTMLButtonElement).click();
    await settle();
    expect(root.textContent).toContain('No workweek over 40 hours.');
    button('Worksheet for Jo (PDF)').click();
    expect(got).toEqual(['tt-worksheet-jo-2026.pdf']);
  });
});
