// @vitest-environment jsdom
// Regressions for the day-6 security review.
import { beforeEach, describe, expect, it } from 'vitest';
import { importCsv as parseImport, MAX_CELL } from '../src/core/importer';
import { wrap } from '../src/core/pdf';
import { Files, MemoryFileStore } from '../src/store/stores';
import { mountApp } from '../src/ui/app';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 25; i++) await flush();
};
let root: HTMLElement;
const status = () => root.querySelector('p.status')?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

function pick(input: HTMLInputElement, f: unknown) {
  Object.defineProperty(input, 'files', { configurable: true, value: [f] });
  input.dispatchEvent(new Event('change'));
}

describe('security review, day 6', () => {
  it('wraps a very long unbroken cell quickly, every piece within the width', () => {
    const t = Date.now();
    const lines = wrap('W'.repeat(20000), 100, 9);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(lines.join('')).toBe('W'.repeat(20000));
    expect(lines.length).toBeGreaterThan(100);
  });

  it('cuts runaway cells at import', () => {
    const r = parseImport(`Employee,Date,Hours,Rate\n${'x'.repeat(5000)},2026-11-02,45,20\n`);
    expect(r.lines[0].employeeName.length).toBe(MAX_CELL);
  });

  it('does not put a file into another client file opened while it was read', async () => {
    let n = 0;
    await mountApp(root, { files: new Files(new MemoryFileStore('browser')), newId: () => `id${++n}`, confirm: () => true, saveDelay: 0 });
    await settle();
    let release: (s: string) => void = () => {};
    const slow = { name: 'slow.csv', size: 40, text: () => new Promise<string>((r) => (release = r)) };
    pick(root.querySelector('#hours-file') as HTMLInputElement, slow);
    await settle();
    const newFile = [...root.querySelectorAll('button')].find((b) => b.textContent === 'New client file') as HTMLButtonElement;
    newFile.click();
    await settle();
    release('Employee,Date,Hours,Rate\nPat,2026-11-02,45,20\n');
    await settle();
    expect(status()).toMatch(/not imported: another client file was opened/);
    expect(root.textContent).not.toMatch(/Pat/);
  });

  it('refuses a CSV over 50 MB before reading it', async () => {
    await mountApp(root, { files: new Files(new MemoryFileStore('browser')), confirm: () => true, saveDelay: 0 });
    await settle();
    let read = false;
    pick(root.querySelector('#hours-file') as HTMLInputElement, { name: 'huge.csv', size: 51 * 1024 * 1024, text: async () => ((read = true), '') });
    await settle();
    expect(read).toBe(false);
    expect(status()).toMatch(/over 50 MB/);
  });
});
