// Milestone 3: bonuses, differentials, tip credit, pay that is not wages, the paid cap.
import { describe, expect, it } from 'vitest';
import { newClientFile, runChecks } from '../src/core/clientFile';
import { decodeFile, encodeFile } from '../src/core/codec';
import { checkEmployee } from '../src/core/compare';
import { allocateBonus, bonusSpan, buildWeeks } from '../src/core/engine';
import { importCsv } from '../src/core/importer';
import { dayNumber } from '../src/core/dates';
import type { EmployerSettings, TimeLine } from '../src/core/types';

const base: EmployerSettings = { name: 'T', taxYear: 2026, workweekStart: 0, minimumWage: 7.25, bonusPeriod: 'week', bonusAllocation: 'per-week' };
const csv = (rows: string[]) => ['Employee,Date,Pay Type,Hours,Rate,Amount,Pay Date', ...rows].join('\n');
/** Monday-Friday 9 h a day of the week starting Sunday `sun` at `rate`. */
const nineHourDays = (sun: string, rate: number, pay = '') =>
  [1, 2, 3, 4, 5].map((d) => {
    const day = new Date(Date.UTC(+sun.slice(0, 4), +sun.slice(5, 7) - 1, +sun.slice(8, 10) + d)).toISOString().slice(0, 10);
    return `Ann,${day},Regular,9,${rate},,${pay}`;
  });

function weeksOf(rows: string[], settings: Partial<EmployerSettings> = {}) {
  const r = importCsv(csv(rows));
  return { r, ew: buildWeeks(r.lines, { ...base, ...settings })[0] };
}

describe('non-discretionary bonuses (29 CFR 778.209)', () => {
  it('a weekly bonus raises that week\'s regular rate', () => {
    // 45 h at $10 plus a $50 production bonus: (450 + 50) / 45 = 11.11; 5 h x 5.56 = 27.78.
    const { r, ew } = weeksOf([...nineHourDays('2026-03-01', 10), 'Ann,2026-03-06,Production bonus,,,50,']);
    expect(r.report.bonusLines).toBe(1);
    const w = ew.weeks[0];
    expect(w).toMatchObject({ flsaPremium: 25, basePremium: 25, premium: 27.78, straightPay: 500 });
    expect(w.bonusParts).toEqual([expect.objectContaining({ amount: 50, premium: 2.78, taxYear: 2026 })]);
    expect(w.notes.join(' ')).toMatch(/adds \$2\.78 of premium/);
  });

  it('a quarterly bonus is spread per week or per hour over the worked weeks of the quarter', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((d) => `Ann,2026-01-0${d + 3},Regular,10,20,,`), // week of Jan 4: 50 h
      ...[1, 2, 3, 4, 5].map((d) => `Ann,2026-02-${String(d + 1).padStart(2, '0')},Regular,8,20,,`), // week of Feb 1: 40 h
      'Ann,2026-03-31,Quarterly bonus,,,260,2026-04-10',
    ];
    const perWeek = weeksOf(rows, { bonusPeriod: 'quarter' }).ew;
    expect(perWeek.weeks.map((w) => w.bonusParts[0]?.amount)).toEqual([130, 130]);
    expect(perWeek.weeks[0].premium).toBe(100 + 13); // 10 h x $10 + 0.5 x 130 x 10 / 50
    const perHour = weeksOf(rows, { bonusPeriod: 'quarter', bonusAllocation: 'per-hour' }).ew;
    expect(perHour.weeks.map((w) => w.bonusParts[0]?.amount)).toEqual([144.44, 115.56]);
    expect(perHour.weeks[0].bonusParts[0].premium).toBe(14.44);
    expect(perHour.weeks[1].bonusParts[0].premium).toBe(0);
  });

  it('a week across the period edge counts only for its days inside it', () => {
    const rows = [
      'Ann,2025-12-29,Regular,40,20,,', // week of Dec 28: Jan 1-3 are in Q1
      'Ann,2026-01-05,Regular,40,20,,', // week of Jan 4: all in Q1
      'Ann,2026-03-31,Bonus,,,700,2026-04-10',
    ];
    const { ew } = weeksOf(rows, { bonusPeriod: 'quarter' });
    // Weights 3/7 and 7/7: 700 x 3/10 = 210 and 700 x 7/10 = 490. Weeks of Feb-Mar have no hours, so they take none.
    expect(ew.weeks.map((w) => w.bonusParts[0]?.amount)).toEqual([210, 490]);
  });

  it('reads the earning period from period columns', () => {
    const r = importCsv('Employee,Date,Pay Type,Hours,Rate,Amount,Pay Date,Period Start,Period End\nAnn,2026-03-02,Regular,45,20,,,,\nAnn,2026-03-13,Bonus,,,90,2026-03-13,2026-03-01,2026-03-14\n');
    expect(r.mapping).toMatchObject({ earnedFrom: 7, earnedTo: 8 });
    expect(r.lines[1]).toMatchObject({ earnedFrom: '2026-03-01', earnedTo: '2026-03-14' });
    const [ew] = buildWeeks(r.lines, base);
    expect(ew.weeks[0].bonusParts[0]).toMatchObject({ amount: 90, premium: 5 }); // 0.5 x 90 x 5 / 45
  });

  it('a bonus paid in January adds premium to the next year\'s W-2', () => {
    const rows = [...nineHourDays('2026-12-13', 20, '2026-12-24'), 'Ann,2026-12-18,Bonus,,,90,2027-01-15'];
    const { ew } = weeksOf(rows);
    const c26 = checkEmployee(ew, 2026, null);
    const c27 = checkEmployee(ew, 2027, null);
    expect(c26.correct).toBe(50);
    expect(c27.correct).toBe(5); // 0.5 x 90 x 5 / 45
    expect(c26.otherYearPremium).toBe(5);
    expect(c27.bonusPremium).toBe(5);
    expect(c27.overtimeHours).toBe(0);
    expect(ew.weeks[0].notes.join(' ')).toMatch(/on the 2027 W-2/);
  });

  it('names a payroll that left the bonus out, and lists a bonus with no worked week', () => {
    const { ew } = weeksOf([...nineHourDays('2026-03-01', 10), 'Ann,2026-03-06,Bonus,,,50,', 'Ann,2026-05-20,Bonus,,,70,']);
    const c = checkEmployee(ew, 2026, 25);
    expect(c.correct).toBe(27.78);
    expect(c.causes).toEqual([expect.stringMatching(/bonuses were left out of the regular rate/)]);
    expect(ew.unallocated).toEqual([{ label: 'Bonus paid May 20, 2026', amount: 70 }]);
    const big = weeksOf([...nineHourDays('2026-03-01', 10), 'Ann,2026-03-06,Bonus,,,900,']).ew;
    const cb = checkEmployee(big, 2026, 25);
    expect(cb.correct).toBe(75); // (450 + 900) / 45 / 2 x 5
    expect(cb.causes[0]).toMatch(/bonuses were left out of the regular rate/);
  });

  it('spans: own dates, week, month, quarter, year', () => {
    const l = { date: '2026-05-20', earnedFrom: null, earnedTo: null } as unknown as TimeLine;
    const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
    expect(bonusSpan(l, 'week', 0).map(iso)).toEqual(['2026-05-17', '2026-05-23']);
    expect(bonusSpan(l, 'month', 0).map(iso)).toEqual(['2026-05-01', '2026-05-31']);
    expect(bonusSpan(l, 'quarter', 0).map(iso)).toEqual(['2026-04-01', '2026-06-30']);
    expect(bonusSpan(l, 'year', 0).map(iso)).toEqual(['2026-01-01', '2026-12-31']);
    expect(bonusSpan({ ...l, earnedFrom: '2026-02-10', earnedTo: '2026-02-01' }, 'week', 0).map(iso)).toEqual(['2026-02-01', '2026-02-10']);
    expect(allocateBonus({ ...l, amount: 5 }, [], base)).toBe(0);
    expect(dayNumber('2026-05-17')).toBe(bonusSpan(l, 'week', 0)[0]);
  });
});

describe('tip credit, differentials and pay that is not wages', () => {
  it('a tipped server counts at the full minimum wage, not the cash wage', () => {
    // 45 h at a $2.13 cash wage: the regular rate is $7.25; 5 h x $3.625 = $18.13.
    const { ew } = weeksOf([...nineHourDays('2026-03-01', 2.13), 'Ann,2026-03-06,Tips,,,400,']);
    const w = ew.weeks[0];
    expect(w).toMatchObject({ tipCredit: true, regularRate: 7.25, premium: 18.13 });
    expect(w.notes.join(' ')).toMatch(/Tip credit/);
    const state = weeksOf(nineHourDays('2026-03-01', 2.13), { minimumWage: 16.66 }).ew.weeks[0];
    expect(state.premium).toBe(41.65);
  });

  it('a shift differential adds to the week\'s pay but not its hours', () => {
    // 45 h at $20 plus 10 h x $2 night differential: (900 + 20) / 45 / 2 x 5 = 51.11.
    const { r, ew } = weeksOf([...nineHourDays('2026-03-01', 20), 'Ann,2026-03-04,Night differential,10,2,,']);
    expect(r.report.extraLines).toBe(1);
    expect(ew.weeks[0]).toMatchObject({ hours: 45, extraPay: 20, straightPay: 920, premium: 51.11 });
    expect(ew.weeks[0].notes.join(' ')).toMatch(/shift differential/);
  });

  it('leaves out tips, gifts and reimbursements, and counts them in the report', () => {
    const { r, ew } = weeksOf([...nineHourDays('2026-03-01', 20), 'Ann,2026-03-06,Christmas bonus,,,200,', 'Ann,2026-03-06,Mileage reimbursement,,,40,', 'Ann,2026-03-06,Discretionary bonus,,,500,']);
    expect(r.report.notWagesLines).toBe(3);
    expect(ew.weeks[0].premium).toBe(50);
  });

  it('skips bonus lines with no amount or no date, and pay with an unknown code', () => {
    const r = importCsv(csv(['Ann,2026-03-02,Bonus,,,,', 'Ann,,Bonus,,,50,', 'Ann,,Bonus,,,50,2026-03-13', 'Ann,2026-03-02,Misc pay,,,50,']));
    expect(r.report.skipped.map((s) => s.reason)).toEqual([
      'Bonus: no amount to add to the regular rate.',
      'Bonus: no work date or pay date to place it in a week.',
      expect.stringMatching(/pay type the checker does not know/),
    ]);
    expect(r.lines[0]).toMatchObject({ date: '2026-03-13', payDate: '2026-03-13', amount: 50 });
  });
});

describe('stored files and older files', () => {
  it('round-trips bonus and extra lines, and opens files saved before milestone 3', () => {
    const { r } = weeksOf([...nineHourDays('2026-03-01', 20), 'Ann,2026-03-06,Bonus,,,50,', 'Ann,2026-03-04,Night differential,10,2,,']);
    const f = { ...newClientFile('x', base), lines: r.lines };
    expect(decodeFile('x', JSON.parse(JSON.stringify(encodeFile(f))))).toEqual(f);
    const old = { v: 1, settings: { name: 'Old', taxYear: 2026, workweekStart: 0 }, employees: [['k', '', 'K']], codes: [''], lines: [[0, '2026-11-02', 8, 20, 0, 1, null, 0, 2]], updatedAt: 't' };
    expect(decodeFile('o', old).settings).toEqual({ name: 'Old', taxYear: 2026, workweekStart: 0, minimumWage: 7.25, bonusPeriod: 'week', bonusAllocation: 'per-week' });
    expect(runChecks(decodeFile('o', old)).checks[0].correct).toBe(0);
  });
});
