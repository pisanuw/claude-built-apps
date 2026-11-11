import { describe, expect, it } from 'vitest';
import { newClientFile, runChecks } from '../src/core/clientFile';
import { checkEmployee, mistakeCandidates, needsCorrection, statusOf, summarize } from '../src/core/compare';
import { dayNumber, isoDay } from '../src/core/dates';
import { buildWeeks } from '../src/core/engine';
import { resultsCsv, worksheetCsv } from '../src/core/export';
import { importReported, keepKnown } from '../src/core/reported';
import { buildSample, sampleCsv, SAMPLE_SETTINGS } from '../src/core/sample';
import type { TimeLine } from '../src/core/types';

function weekLines(sunday: string, total: number, rate: number, payDate: string | null, key = 'id:e1'): TimeLine[] {
  const start = dayNumber(sunday);
  return [{ employeeKey: key, employeeId: key.slice(3), employeeName: key, date: isoDay(start + 1), hours: total, rate, kind: 'work', multiplier: 1, payDate, code: '', line: 1 }];
}

describe('status', () => {
  it('matches, rounding, over, under, not entered', () => {
    expect(statusOf(null, 10)).toBe('not-entered');
    expect(statusOf(10, 10)).toBe('match');
    expect(statusOf(10.5, 10)).toBe('rounding');
    expect(statusOf(9, 10)).toBe('rounding');
    expect(statusOf(12, 10)).toBe('over');
    expect(statusOf(8, 10)).toBe('under');
    expect(needsCorrection('over')).toBe(true);
    expect(needsCorrection('rounding')).toBe(false);
  });
});

describe('likely causes', () => {
  const lines = [...weekLines('2026-03-01', 50, 20, '2026-03-13'), ...weekLines('2026-03-08', 30, 20, '2026-03-13')];
  const [ew] = buildWeeks(lines, { workweekStart: 0 });

  it('names the per-pay-period mistake', () => {
    const c = checkEmployee(ew, 2026, 0);
    expect(c.correct).toBe(100);
    expect(c.status).toBe('under');
    expect(c.causes[0]).toMatch(/per pay period/);
    expect(c.causes[1]).toMatch(/no qualified overtime/);
  });
  it('names full overtime pay and doubling', () => {
    expect(checkEmployee(ew, 2026, 300).causes[0]).toMatch(/full overtime pay/);
    expect(checkEmployee(ew, 2026, 200).causes[0]).toMatch(/doubled/);
  });
  it('gives no cause for a figure no mistake explains, or a match', () => {
    expect(checkEmployee(ew, 2026, 137).causes).toEqual([]);
    expect(checkEmployee(ew, 2026, 100).causes).toEqual([]);
    expect(checkEmployee(ew, 2026, null)).toMatchObject({ status: 'not-entered', difference: null });
  });
  it('names a premium paid at another rate, from overtime-coded lines', () => {
    const ot: TimeLine[] = [
      ...weekLines('2026-03-01', 40, 20, null),
      { ...weekLines('2026-03-01', 10, 40, null)[0], kind: 'overtime', multiplier: 2 },
    ];
    const [w] = buildWeeks(ot, { workweekStart: 0 });
    const c = checkEmployee(w, 2026, 200);
    expect(c.correct).toBe(100);
    expect(c.causes[0]).toMatch(/premium it paid/);
  });
  it('names a year-end week counted in the wrong year', () => {
    const ls = [...weekLines('2026-12-20', 45, 20, '2026-12-24'), ...weekLines('2026-12-27', 45, 20, '2027-01-08')];
    const [w] = buildWeeks(ls, { workweekStart: 0 });
    const c = checkEmployee(w, 2026, 100);
    expect(c.correct).toBe(50);
    expect(c.otherYearPremium).toBe(50);
    expect(c.causes[0]).toMatch(/paid in 2027/);
    const next = checkEmployee(w, 2027, 0);
    expect(next.correct).toBe(50);
    expect(next.causes.join(' ')).toMatch(/leaves out overtime worked in late 2026/);
  });
  it('lists no candidates for a year without overtime', () => {
    expect(mistakeCandidates([], [], 2026).map((c) => c.value)).toEqual([0, 0]);
    expect(checkEmployee(ew, 2026, 200).causes).toHaveLength(1);
  });
});

describe('the sample employer', () => {
  const s = buildSample();
  const file = { ...newClientFile('f', s.settings), lines: s.lines, reported: { '2026': s.reported } };
  const { checks, summary } = runChecks(file);
  const by = (id: string) => checks.find((c) => c.employee.id === id)!;

  it('drops the SSN column and imports every row', () => {
    expect(s.csv).toContain('SSN');
    expect(JSON.stringify(s.lines)).not.toContain('***-**');
    expect(s.lines.length + 53).toBe(sampleCsv().trim().split('\r\n').length - 1); // 53 weekly tips lines are not wages
  });
  it('flags the two-rate employee and not the single-rate one', () => {
    expect(by('E102').status).toBe('under');
    expect(by('E102').causes[0]).toMatch(/One pay rate \(\$19\.50\)/);
    expect(by('E101').status).toBe('match');
    expect(by('E104')).toMatchObject({ status: 'match', correct: 0 });
  });
  it('names each planted mistake', () => {
    expect(by('E103').causes[0]).toMatch(/full overtime pay/);
    expect(by('E105').causes.join(' ')).toMatch(/per pay period/);
    expect(by('E106').causes[0]).toMatch(/paid in 2027/);
    expect(summary).toMatchObject({ employees: 8, withOvertime: 7, needCorrection: 6, notEntered: 0 });
  });
  it('works the blended rate by hand for a 47-hour week', () => {
    const w = by('E102').yearWeeks.find((x) => x.hours === 47)!;
    // 38 h x $19.50 + 9 h x $26 = $975; premium = 7 x (975 / 47) / 2
    expect(w.straightPay).toBe(975);
    expect(w.premium).toBe(72.61);
  });
  it('summarizes an empty list', () => {
    expect(summarize([])).toMatchObject({ employees: 0, totalCorrect: 0 });
    expect(SAMPLE_SETTINGS.taxYear).toBe(2026);
  });

  it('exports results and the worksheet as CSV', () => {
    const r = resultsCsv(checks, file.settings);
    expect(r.split('\r\n')[2]).toMatch(/^E105,Ana Silva,/);
    expect(r).toContain('Too low');
    const w = worksheetCsv(checks, { ...file.settings, name: '' });
    expect(w).toContain('employer, tax year 2026');
    // The year-end week is paid in 2027: on the 2027 worksheet, not the 2026 one (as in the PDF).
    expect(w).not.toContain('2026-12-27,2027-01-02');
    expect(worksheetCsv(checks, { ...file.settings, taxYear: 2027 })).toContain('2026-12-27,2027-01-02');
    expect(resultsCsv([{ ...checks[0], reported: null, difference: null, status: 'not-entered' }], { ...file.settings, name: '' })).toContain('not entered');
  });
});

describe('reported figures', () => {
  const employees = [
    { key: 'id:e1', id: 'E1', name: 'Ann Lee' },
    { key: 'name:bo ray', id: '', name: 'Bo Ray' },
  ];
  it('matches by ID or name and reports the rest', () => {
    const r = importReported('Employee ID,Employee,SSN,Box 12 TT\nE1,Ann Lee,123-45-6789,"$1,000.00"\n,bo  ray,,250\n,Cy,,10\nE1,,,abc\n', employees);
    expect(r.values).toEqual({ 'id:e1': 1000, 'name:bo ray': 250 });
    expect(r.unmatched).toEqual([{ line: 4, name: 'Cy' }]);
    expect(r.unreadable).toEqual([5]);
  });
  it('falls back to the last column for the amount', () => {
    expect(importReported('Name,Figure\nAnn Lee,12\n', employees).values).toEqual({ 'id:e1': 12 });
    expect(importReported('', employees).values).toEqual({});
  });
  it('keeps only known employees', () => {
    expect(keepKnown({ 'id:e1': 1, 'id:gone': 2 }, employees)).toEqual({ 'id:e1': 1 });
  });
});
