// Regression tests for the day-1 review findings.
import { describe, expect, it } from 'vitest';
import { newClientFile, reportedFor, runChecks, withReported } from '../src/core/clientFile';
import { checkEmployee } from '../src/core/compare';
import { safeCell, toCsv } from '../src/core/csv';
import { buildWeeks } from '../src/core/engine';
import { classifyCode, guessMapping, importCsv, parseHours, parseMoney, ssnColumns } from '../src/core/importer';
import { parseCsv } from '../src/core/csv';
import { importReported } from '../src/core/reported';

const week = (rows: string[]) => ['Employee,Date,Pay Type,Hours,Rate', ...rows].join('\n');

describe('review fixes', () => {
  it('reads own overtime and double-time hours columns', () => {
    const r = importCsv('Employee,Date,Regular Hours,OT Hours,DT Hours,Rate\nAna,11/02/2026,40,6,,20\nAna,11/03/2026,,,2,20\n');
    expect(r.mapping).toMatchObject({ hours: 2, overtimeHours: 3, doubleHours: 4, rate: 5 });
    const [ew] = buildWeeks(r.lines, { workweekStart: 0 });
    expect(ew.weeks[0]).toMatchObject({ hours: 48, straightPay: 960, premium: 80, paidPremium: 100 });
    expect(r.report.overtimeLines).toBe(2);
  });
  it('derives the straight rate from an amount that includes overtime columns', () => {
    const r = importCsv('Employee,Date,Hours,Overtime Hours,Gross Pay\nAna,11/02/2026,40,4,920\n');
    expect(r.lines[0].rate).toBe(20);
    expect(r.lines[1]).toMatchObject({ rate: 30, multiplier: 1.5 });
  });
  it('does not take a bare Code header as the employee ID', () => {
    const m = guessMapping(['Employee', 'Date', 'Hours', 'Rate', 'Code']);
    expect(m).toMatchObject({ employeeId: null, employeeName: 0, code: 4 });
    expect(guessMapping(['ID', 'Name'])).toMatchObject({ employeeId: 0, employeeName: 1 });
    expect(guessMapping(['Emp #', 'Name'])).toMatchObject({ employeeId: 0 });
  });
  it('prefers a Date column over a Day column', () => {
    expect(guessMapping(['Employee', 'Day', 'Date', 'Hours', 'Rate'])).toMatchObject({ date: 2 });
  });
  it('drops SS#, SS Number and Tax ID columns', () => {
    const t = parseCsv('Name,SS#,SS Number,Tax ID,Hours\nA,123456789,123456789,123456789,8\n');
    expect(ssnColumns(t)).toEqual([1, 2, 3]);
  });
  it('treats an overtime line at the base rate as the straight rate', () => {
    const r = importCsv(week(['Pat,11/2/2026,Regular,40,20', 'Pat,11/3/2026,Overtime,5,20']));
    const w = buildWeeks(r.lines, { workweekStart: 0 })[0].weeks[0];
    expect(w).toMatchObject({ straightPay: 900, regularRate: 20, premium: 50, paidPremium: 50 });
    expect(w.notes).toEqual([]);
    // Two rates where the overtime rate is 1.5x one of them: still divided.
    const two = importCsv(week(['Pat,11/2/2026,Regular,20,20', 'Pat,11/3/2026,Regular,20,30', 'Pat,11/4/2026,Overtime,5,30']));
    expect(buildWeeks(two.lines, { workweekStart: 0 })[0].weeks[0].straightPay).toBe(1100);
  });
  it('counts Holiday OT as overtime, not paid time off', () => {
    expect(classifyCode('Holiday OT')).toEqual({ kind: 'overtime', multiplier: 1.5 });
    expect(classifyCode('Holiday Overtime')).toEqual({ kind: 'overtime', multiplier: 1.5 });
    expect(classifyCode('Holiday')).toEqual({ kind: 'excluded', multiplier: 1 });
  });
  it('reads a W-2 export with Box 12 code and amount columns, TT rows only, added up', () => {
    const emps = [{ key: 'id:e1', id: 'E1', name: 'Ann' }];
    const r = importReported('Employee ID,Box 12 Code,Box 12 Amount\nE1,TT,100\nE1,DD,5000\nE1,TT,25.50\n', emps);
    expect(r.values).toEqual({ 'id:e1': 125.5 });
    expect(r.otherCodes).toBe(1);
  });
  it('keeps payroll figures per tax year', () => {
    let f = { ...newClientFile('f', { taxYear: 2026 }) };
    f = withReported(f, { 'id:e1': 10 });
    const f25 = { ...f, settings: { ...f.settings, taxYear: 2025 } };
    expect(reportedFor(f25)).toEqual({});
    expect(reportedFor(f)).toEqual({ 'id:e1': 10 });
    expect(runChecks(f25).checks).toEqual([]);
  });
  it('reads decimal commas in semicolon files', () => {
    expect(parseMoney('1.234,50', true)).toBe(1234.5);
    expect(parseHours('7,5', true)).toBe(7.5);
    const r = importCsv('Employee;Date;Hours;Rate\nAna;2026-11-02;8,5;18,50\n');
    expect(r.lines[0]).toMatchObject({ hours: 8.5, rate: 18.5 });
  });
  it('joins a blank-ID row to the employee with that name', () => {
    const r = importCsv('ID,Employee,Date,Hours,Rate\nE7,Ana Ruiz,2026-11-02,38,20\n,Ana Ruiz,2026-11-03,6,20\n,Bo,2026-11-03,6,20\n');
    expect(r.report.employees).toBe(2);
    expect(buildWeeks(r.lines, { workweekStart: 0 })[0].weeks[0].premium).toBe(40);
  });
  it('names no year-end cause when the file has no pay dates', () => {
    const r = importCsv('Employee,Date,Hours,Rate\nAna,2026-12-21,45,20\nAna,2026-12-28,45,20\n');
    const [ew] = buildWeeks(r.lines, { workweekStart: 0 });
    const c = checkEmployee(ew, 2026, 100);
    expect(c.causes.join(' ')).not.toMatch(/paid in 2027/);
  });
  it('makes exported cells formula-safe', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('-109.00')).toBe('-109.00');
    expect(safeCell(-3)).toBe(-3);
    expect(toCsv([['+1 call me']])).toBe("'+1 call me\r\n");
  });
});
