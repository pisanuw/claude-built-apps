// @vitest-environment jsdom
// Regression tests for the milestone 4 review findings.
import { beforeEach, describe, expect, it } from 'vitest';
import { newClientFile, runChecks } from '../src/core/clientFile';
import { buildWeeks } from '../src/core/engine';
import { resultsCsv } from '../src/core/export';
import { importCsv } from '../src/core/importer';
import { headerSignature, mergeLines, periodTotals } from '../src/core/layout';
import { Files, MemoryFileStore } from '../src/store/stores';
import { mountApp } from '../src/ui/app';
import toastCsv from './fixtures/toast-time-entries.csv?raw';

const settings = { workweekStart: 0 };

describe('milestone 4 review fixes', () => {
  it('refuses a single pay-period row when the date column is a period', () => {
    const r = importCsv('Employee,Period Ending,Hours,Rate\nAnn,3/14/26,80,20\n');
    expect(r.report.dateHeader).toBe('Period Ending');
    expect(periodTotals(r.lines, r.report.dateHeader)).toEqual(['Ann']);
  });

  it('takes overtime out of a total-hours column when there is no regular column', () => {
    const r = importCsv('Employee,Date,Total Hours,OT Hours,Rate\nAnn,3/2/26,45,5,20\n');
    expect(r.report.hoursWereTotal).toBe(true);
    const w = buildWeeks(r.lines, settings)[0].weeks[0];
    expect(w).toMatchObject({ hours: 45, overtimeHours: 5, flsaPremium: 50 });
  });

  it('keeps two equal shifts at two Toast locations, told apart by their GUID', () => {
    const header = toastCsv.split('\r\n')[0];
    const shift = (guid: string, loc: string) => `${loc},X,1,${guid},101,e,,Ann Lee,7,j,LC,Cook,3/7/26 9:00 AM,3/7/26 1:00 PM,4.00,0,0,4.00,0,0,0,0,0,20.00,4.00,0.00,80.00,0.00,80.00`;
    const main = importCsv(`${header}\n${shift('g-main', 'Main')}\n`).lines;
    const harbor = importCsv(`${header}\n${shift('g-harbor', 'Harbor')}\n`).lines;
    expect(mergeLines(main, harbor)).toMatchObject({ added: 1, duplicates: 0 });
    expect(mergeLines(main, main)).toMatchObject({ added: 0, duplicates: 1 });
  });

  it('joins a second export without IDs to the employees known by ID', () => {
    const byId = importCsv('Employee ID,Employee,Date,Hours,Rate\n101,Ann Lee,3/2/26,30,20\n').lines;
    const byName = importCsv('Employee,Date,Hours,Rate\nAnn Lee,3/4/26,15,20\n').lines;
    const merged = mergeLines(byId, byName).lines;
    expect(new Set(merged.map((l) => l.employeeKey))).toEqual(new Set(['id:101']));
    expect(buildWeeks(merged, settings)[0].weeks[0].overtimeHours).toBe(5);
    // The same rows read with the rate from an amount column instead are still duplicates.
    const viaAmount = importCsv('Employee,Date,Hours,Amount\nAnn Lee,3/4/26,15,300\n').lines;
    expect(mergeLines(byName, viaAmount)).toMatchObject({ added: 0, duplicates: 1 });
  });

  it('does not take weekly totals two weeks apart as pay-period totals', () => {
    const r = importCsv('Employee,Week Ending,Hours,Rate\nAnn,3/7/26,30,20\nAnn,3/21/26,30,20\n');
    expect(periodTotals(r.lines, r.report.dateHeader)).toEqual([]);
  });

  it('leaves an employee waiting for a rate out of the totals and the CSV figure', () => {
    const r = importCsv('Employee,Date,Hours\nAnn,3/2/26,45\n');
    const f = { ...newClientFile('x'), lines: r.lines };
    const { checks, summary } = runChecks(f);
    expect(summary.totalCorrect).toBe(0);
    expect(resultsCsv(checks, f.settings).split('\r\n')[2]).toMatch(/^,Ann,45,5,1,,/);
  });

  it('never puts header-less data, such as an SSN, into a layout fingerprint', () => {
    expect(headerSignature(['123-45-6789', 'Ann Lee', '3/2/26', '8'])).toBe('#|ann lee|#|#');
  });

  it('never takes a QuickBooks rate column as the pay rate', () => {
    const r = importCsv(',Activity Date,Customer,Rate,Duration,Amount\nAnn Lee,,,,,\n,03/02/2026,Cafe,85.00,9:00,765.00\n');
    expect(r.mapping.rate).toBeNull();
    expect(r.lines[0].rate).toBe(0);
  });

  it('treats a Toast overtime pay of 0.00 as overtime not paid', () => {
    const header = toastCsv.split('\r\n')[0];
    const row = 'Main,X,1,g1,101,e,,Ann Lee,7,j,LC,Cook,3/6/26 9:00 AM,3/6/26 7:00 PM,45.00,0,0,45.00,0,0,0,0,0,20.00,40.00,5.00,800.00,0.00,800.00';
    const r = importCsv(`${header}\n${row}\n`);
    const w = buildWeeks(r.lines, settings)[0].weeks[0];
    expect(w).toMatchObject({ flsaPremium: 50, paidPremium: 0, basePremium: 0 });
    expect(w.notes.join(' ')).toMatch(/\$50\.00 of overtime looks owed/);
    expect(runChecks({ ...newClientFile('t'), lines: r.lines }).checks[0].status).not.toBe('rate-needed');
  });
});

describe('import mode and rates in the page', () => {
  let root: HTMLElement;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const settle = async () => {
    for (let i = 0; i < 25; i++) await tick();
  };
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.getElementById('app') as HTMLElement;
  });
  async function importFile(name: string, text: string) {
    const input = root.querySelector('#hours-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], name)] });
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  it('resets add mode for a new file, joins sources, and drops rates of employees gone', async () => {
    const browser = new MemoryFileStore('browser');
    let n = 0;
    await mountApp(root, { files: new Files(browser), newId: () => `id${++n}`, confirm: () => true, saveDelay: 0 });
    await settle();
    await importFile('a.csv', 'Employee,Date,Hours\nAnn,3/2/26,45\n');
    const rate = root.querySelector('input[aria-label="Hourly pay rate for Ann"]') as HTMLInputElement;
    rate.value = '20';
    rate.dispatchEvent(new Event('change'));
    await settle();
    const add = root.querySelector('#mode-add') as HTMLInputElement;
    add.checked = true;
    add.dispatchEvent(new Event('change'));
    await importFile('b.csv', 'Employee,Date,Hours\nAnn,3/3/26,2\n');
    expect(root.querySelector('.report')?.textContent).toContain('a.csv + b.csv');
    (root.querySelector('#mode-replace') as HTMLInputElement).checked = true;
    (root.querySelector('#mode-replace') as HTMLInputElement).dispatchEvent(new Event('change'));
    await importFile('c.csv', 'Employee,Date,Hours,Rate\nBo,3/2/26,40,18\n');
    expect((await browser.get('id1'))?.rates).toEqual({});
    expect(root.querySelector('input[aria-label^="Hourly pay rate"]')).toBeNull();
    // Add mode was chosen on this file; a new file starts in replace mode.
    (root.querySelector('#mode-add') as HTMLInputElement).checked = true;
    (root.querySelector('#mode-add') as HTMLInputElement).dispatchEvent(new Event('change'));
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'New client file')!.click();
    await settle();
    await importFile('d.csv', 'Employee,Date,Hours,Rate\nCy,3/2/26,40,18\n');
    expect((root.querySelector('#mode-replace') as HTMLInputElement).checked).toBe(true);
  });
});

describe('SSNs in ID columns', () => {
  it('drops an ID column if even one value is written like an SSN', async () => {
    const { ssnColumns } = await import('../src/core/importer');
    const { parseCsv } = await import('../src/core/csv');
    expect(ssnColumns(parseCsv('Employee ID,Name\nE1,A\nE2,B\n123-45-6789,C\n'))).toEqual([0]);
    expect(ssnColumns(parseCsv('Employee ID,Name\nE1,A\nE2,B\n'))).toEqual([]);
  });
});
