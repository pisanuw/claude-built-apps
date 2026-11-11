// Milestone 4: real export layouts, from fixture files.
import { describe, expect, it } from 'vitest';
import { newClientFile, runChecks } from '../src/core/clientFile';
import { decodeFile, encodeFile } from '../src/core/codec';
import { buildWeeks } from '../src/core/engine';
import { detectLayout, importCsv } from '../src/core/importer';
import { mergeLines } from '../src/core/layout';

import qboCsv from './fixtures/qbo-time-activities.csv?raw';
import toastCsv from './fixtures/toast-time-entries.csv?raw';

const FIXTURES: Record<string, string> = { 'toast-time-entries.csv': toastCsv, 'qbo-time-activities.csv': qboCsv };
const fixture = (name: string) => FIXTURES[name];
const settings = { name: 'T', taxYear: 2026, workweekStart: 0, minimumWage: 7.25, bonusPeriod: 'week' as const, bonusAllocation: 'per-week' as const };

describe('Toast time entries (columns from Toast’s field reference)', () => {
  const r = importCsv(fixture('toast-time-entries.csv'));

  it('is recognised and mapped to regular hours, overtime hours, wage and overtime pay', () => {
    expect(r.report.layout).toMatchObject({ name: 'Toast time entries', confirmed: true });
    const header = r.table.rows[0].cells;
    const col = (i: number | null) => (i === null ? null : header[i]);
    expect(col(r.mapping.hours)).toBe('Regular Hours');
    expect(col(r.mapping.overtimeHours)).toBe('Overtime Hours');
    expect(col(r.mapping.rate)).toBe('Wage');
    expect(col(r.mapping.overtimePay)).toBe('Overtime Pay');
    expect(col(r.mapping.date)).toBe('In Date');
    expect(col(r.mapping.employeeId)).toBe('Employee Id');
    expect(r.mapping.amount).toBeNull();
  });

  it('loses no rows and reports the malformed one by its line', () => {
    expect(r.report.rowsRead).toBe(12);
    expect(r.report.skipped).toEqual([{ line: 13, reason: 'The work date "not a date" could not be read.' }]);
    expect(r.report.employees).toBe(2);
  });

  it('works the week across two locations and two rates, and caps the tipped server at the premium paid', () => {
    const [ann, rosa] = buildWeeks(r.lines, settings);
    // Ann: 40 h at $20, 5 h overtime at $20, 4 h overtime at the Harbor rate of $22: 988 / 49 / 2 x 9.
    expect(ann.weeks[0]).toMatchObject({ hours: 49, straightPay: 988, overtimeHours: 9, flsaPremium: 90.73, paidPremium: 94, premium: 90.73 });
    // Rosa: $2.13 cash wage, 46 h: the FLSA premium is 6 x $3.625 = $21.75, but Toast paid 6 x (3.195 - 2.13) = $6.39.
    expect(rosa.weeks[0]).toMatchObject({ tipCredit: true, flsaPremium: 21.75, paidPremium: 6.39, premium: 6.39 });
    expect(rosa.weeks[0].notes.join(' ')).toMatch(/\$15\.36 of overtime looks owed/);
  });

  it('a second import of the same file adds nothing, and the base rate survives saving', () => {
    expect(mergeLines(r.lines, importCsv(fixture('toast-time-entries.csv')).lines)).toMatchObject({ added: 0, duplicates: r.lines.length });
    const f = { ...newClientFile('t', settings), lines: r.lines };
    const back = decodeFile('t', JSON.parse(JSON.stringify(encodeFile(f))));
    expect(back).toEqual(f);
    expect(back.lines.find((l) => l.baseRate === 22)).toBeTruthy();
  });
});

describe('QuickBooks Online time activities (layout inferred)', () => {
  const r = importCsv(fixture('qbo-time-activities.csv'));

  it('is recognised, takes employees from their name rows, and reads hours:minutes', () => {
    expect(r.report.layout).toMatchObject({ name: 'QuickBooks Online time activities', confirmed: false });
    expect(r.mapping).toMatchObject({ employeeGroup: 0, rate: null, amount: null });
    expect(r.lines.map((l) => [l.employeeName, l.hours])).toEqual([
      ['Ann Lee', 9], ['Ann Lee', 9], ['Ann Lee', 9], ['Ann Lee', 9], ['Ann Lee', 9],
      ['Bo Ray', 10.5], ['Bo Ray', 10.5], ['Bo Ray', 10.5], ['Bo Ray', 10.5],
    ]);
    expect(r.report).toMatchObject({ rowsRead: 15, linesUsed: 9, rateMissingLines: 9 });
    expect(r.report.skipped).toEqual([{ line: 14, reason: 'The hours "" could not be read.' }]);
  });

  it('asks for pay rates, then checks with them', () => {
    const f = { ...newClientFile('q', settings), lines: r.lines };
    const before = runChecks(f);
    expect(before.checks.map((c) => c.status)).toEqual(['rate-needed', 'rate-needed']);
    expect(before.summary.rateNeeded).toBe(2);
    const after = runChecks({ ...f, rates: { 'name:ann lee': 20, 'name:bo ray': 18 } });
    expect(after.checks.map((c) => [c.employee.name, c.correct, c.status])).toEqual([
      ['Ann Lee', 50, 'not-entered'],
      ['Bo Ray', 18, 'not-entered'],
    ]);
    expect(decodeFile('q', JSON.parse(JSON.stringify(encodeFile({ ...f, rates: { a: 1 } })))).rates).toEqual({ a: 1 });
  });
});

describe('other layouts', () => {
  it('knows nothing of a generic file', () => {
    expect(detectLayout(['Employee', 'Date', 'Hours', 'Rate'])).toBeNull();
  });
  it('reads regular hours, not total hours, beside an overtime column', () => {
    const r = importCsv('Employee,Date,Total Hours,Regular Hours,OT Hours,Rate\nAnn,2026-03-02,45,40,5,20\n');
    expect(r.table.rows[0].cells[r.mapping.hours as number]).toBe('Regular Hours');
    expect(buildWeeks(r.lines, settings)[0].weeks[0].hours).toBe(45);
  });
});
