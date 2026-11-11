// @vitest-environment jsdom
// Regressions for the day-7 review of the whole app.
import { beforeEach, describe, expect, it } from 'vitest';
import { newClientFile, runChecks } from '../src/core/clientFile';
import { inYear, summarize, worksheetWeeks, type EmployeeCheck } from '../src/core/compare';
import { parseCsv } from '../src/core/csv';
import { worksheetCsv } from '../src/core/export';
import { importCsv as parseImport } from '../src/core/importer';
import { followIds } from '../src/core/reported';
import { buildSample } from '../src/core/sample';
import { googleButton, googleLogoSvg } from '../src/lib/auth';
import { Files, MemoryFileStore } from '../src/store/stores';
import { MAX_NAME, MAX_STORED, mountApp } from '../src/ui/app';

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

async function mount() {
  const browser = new MemoryFileStore('browser');
  let n = 0;
  await mountApp(root, { files: new Files(browser), newId: () => `id${++n}`, confirm: () => true, saveDelay: 0 });
  await settle();
  return browser;
}

async function importText(name: string, text: string) {
  pick(root.querySelector('#hours-file') as HTMLInputElement, new File([text], name));
  await settle();
}

function type(id: string, value: string) {
  const el = root.querySelector(`#${id}`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('change'));
}

const days = (from: number, name: string, id?: string) =>
  [0, 1, 2, 3, 4].map((i) => `${id === undefined ? '' : `${id},`}${name},2026-11-${String(from + i).padStart(2, '0')},9`).join('\n');

describe('typed rates and figures follow an employee who gains an ID', () => {
  it('moves a name key to the one employee of that name with an ID', () => {
    const employees = [{ key: 'id:77', id: '77', name: 'Jane Doe' }, { key: 'name:bo', id: '', name: 'Bo' }];
    expect(followIds({ 'name:jane doe': 20, 'name:bo': 5, 'name:gone': 1 }, employees)).toEqual({ 'id:77': 20, 'name:bo': 5, 'name:gone': 1 });
    // Two people of that name with IDs: ambiguous, left alone.
    const two = [...employees, { key: 'id:78', id: '78', name: 'Jane Doe' }];
    expect(followIds({ 'name:jane doe': 20 }, two)).toEqual({ 'name:jane doe': 20 });
    // A figure already under the ID wins.
    expect(followIds({ 'name:jane doe': 20, 'id:77': 30 }, employees)).toEqual({ 'name:jane doe': 20, 'id:77': 30 });
  });

  it('keeps them when a second export with IDs is added', async () => {
    const browser = await mount();
    await importText('names.csv', `Employee,Date,Hours\n${days(2, 'Jane Doe')}\n`);
    type('rate-0', '20');
    await settle();
    type('rep-0', '50');
    await settle();
    expect(root.querySelector('#results')?.textContent ?? root.textContent).toMatch(/Jane Doe/);
    const add = root.querySelector('#mode-add') as HTMLInputElement;
    add.checked = true;
    add.dispatchEvent(new Event('change'));
    await importText('ids.csv', `Employee ID,Employee,Date,Hours\n${days(9, 'Jane Doe', '77')}\n`);
    expect(status()).toMatch(/^Added 5 lines/);
    const saved = await browser.get('id1');
    expect(saved?.rates).toEqual({ 'id:77': 20 });
    expect(saved?.reported['2026']).toEqual({ 'id:77': 50 });
    expect(new Set(saved?.lines.map((l) => l.employeeKey))).toEqual(new Set(['id:77']));
    // The report says what the file holds, and which export the counts are for.
    const report = root.querySelector('.report')?.textContent ?? '';
    expect(report).toContain('In this file: 10 lines for 1 employees, from 2 exports (names.csv + ids.csv).');
    expect(report).toContain('Last added, ids.csv:');
  });
});

describe('the worksheet CSV and the totals agree with the PDF', () => {
  const s = buildSample();
  const file = { ...newClientFile('f', s.settings), lines: s.lines, reported: { '2026': s.reported } };
  const { checks } = runChecks(file);

  it('lists the PDF weeks, and the W-2 column adds up to each figure', () => {
    const rows = parseCsv(worksheetCsv(checks, file.settings)).rows.slice(2).map((r) => r.cells);
    const col = 12;
    for (const c of checks) {
      const mine = rows.filter((r) => r[1] === c.employee.name);
      expect(mine.length).toBe(worksheetWeeks(c, 2026).length);
      const total = mine.reduce((a, r) => a + Number(r[col] || 0), 0);
      expect(total).toBeCloseTo(c.correct, 2);
      expect(total).toBeCloseTo(worksheetWeeks(c, 2026).reduce((a, w) => a + inYear(w, 2026), 0), 2);
    }
  });

  it('marks an employee waiting for a pay rate, and leaves them out of both totals', () => {
    const waiting: EmployeeCheck = { ...checks[0], status: 'rate-needed', reported: 999, correct: 0 };
    const csv = worksheetCsv([waiting], file.settings);
    expect(csv).toContain('Pay rate needed: no figure yet.');
    const ok: EmployeeCheck = { ...checks[1], status: 'match', correct: 25, reported: 25 };
    expect(summarize([ok, waiting])).toMatchObject({ totalCorrect: 25, totalReported: 25 });
  });
});

describe('imports', () => {
  it('refuses an import too big to save', async () => {
    const before = MAX_STORED.browser;
    MAX_STORED.browser = 200;
    try {
      const browser = await mount();
      await importText('big.csv', `Employee,Date,Hours,Rate\n${days(2, 'Jane Doe').replace(/,9/g, ',9,20')}\n`);
      expect(status()).toMatch(/more than this browser can keep/);
      expect(await browser.get('id1')).toBeUndefined();
    } finally {
      MAX_STORED.browser = before;
    }
  });

  it('reports a quote that is never closed', async () => {
    const text = 'Employee,Date,Hours,Rate\nAnn,2026-11-02,9,20\n"Bo,2026-11-03,9,20\nCy,2026-11-04,9,20\n';
    expect(parseCsv(text).unclosedQuote).toBe(3);
    expect(parseImport(text).report.unclosedQuote).toBe(3);
    expect(parseCsv('a,b\n"x",y\n').unclosedQuote).toBeUndefined();
    await mount();
    await importText('broken.csv', text);
    expect(root.querySelector('.report')?.textContent).toContain('Line 3 opens a quote');
  });

  it('does not put a file still being read into the sample', async () => {
    await mount();
    let release: (s: string) => void = () => {};
    pick(root.querySelector('#hours-file') as HTMLInputElement, { name: 'slow.csv', size: 40, text: () => new Promise<string>((r) => (release = r)) });
    await settle();
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Try the sample employer') as HTMLButtonElement).click();
    await settle();
    release('Employee,Date,Hours,Rate\nPat Client,2026-11-02,45,20\n');
    await settle();
    expect(status()).toMatch(/not imported: another client file was opened/);
    expect(root.textContent).not.toMatch(/Pat Client/);
  });

  it('uses the newest of two overlapping reads', async () => {
    const browser = await mount();
    let releaseBig: (s: string) => void = () => {};
    pick(root.querySelector('#hours-file') as HTMLInputElement, { name: 'big.csv', size: 40, text: () => new Promise<string>((r) => (releaseBig = r)) });
    await settle();
    await importText('small.csv', 'Employee,Date,Hours,Rate\nNew Person,2026-11-02,45,20\n');
    releaseBig('Employee,Date,Hours,Rate\nOld Person,2026-11-02,45,20\n');
    await settle();
    expect(status()).toMatch(/big\.csv was not imported: a newer file was chosen/);
    expect((await browser.get('id1'))?.lines.map((l) => l.employeeName)).toEqual(['New Person']);
  });

  it('keeps the employer name to its limit', async () => {
    const browser = await mount();
    type('emp-name', 'x'.repeat(MAX_NAME + 50));
    await settle();
    expect((root.querySelector('#emp-name') as HTMLInputElement).getAttribute('maxlength')).toBe(String(MAX_NAME));
    expect((await browser.get('id1'))?.settings.name.length).toBe(MAX_NAME);
  });
});

describe('small UI fixes', () => {
  it('does not offer sign-in when storage is blocked and there is no sign-in', async () => {
    await mountApp(root, { files: new Files(new MemoryFileStore('browser')), storageBlocked: true, saveDelay: 0, confirm: () => true });
    await settle();
    expect(root.textContent).toContain('Download the CSV and PDF files before closing.');
    expect(root.textContent).not.toContain('Sign in to keep them');
  });

  it('carries Google’s dark G next to the light one', () => {
    expect(googleLogoSvg('dark')).toContain('fill="#131314"');
    expect(googleLogoSvg()).toContain('fill="white"');
    const b = googleButton(() => {});
    expect(b.querySelector('.hw-g-light svg')).not.toBeNull();
    expect(b.querySelector('.hw-g-dark svg')).not.toBeNull();
  });
});
