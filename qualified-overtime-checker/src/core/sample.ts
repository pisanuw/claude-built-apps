/**
 * A made-up employer for "Try the sample": a small restaurant and catering
 * business with eight hourly staff (one tipped server, one cook with a
 * quarterly bonus), biweekly pay on the Friday after each
 * period, one 2026 tax year of dated daily hours (plus the weeks either side
 * of the year end), and the TT figures a payroll produced, each one wrong in
 * a way the comparison should name (or right, for two of them).
 */
import { toCsv } from './csv';
import { dayNumber, isoDay } from './dates';
import { buildWeeks } from './engine';
import { importCsv } from './importer';
import { checkEmployee, mistakeCandidates } from './compare';
import { withDefaults, type EmployerSettings, type TimeLine } from './types';

export const SAMPLE_SETTINGS: EmployerSettings = withDefaults({ name: 'Cedar Lane Kitchen (sample)', bonusPeriod: 'quarter' });

/** First Sunday of the sample (the week that holds 1 January 2026) and the number of weeks. */
const FIRST = dayNumber('2025-12-28');
const WEEKS = 53;

interface Person {
  id: string;
  name: string;
  /** Hours by job for workweek i: [rate, hours][] */
  week(i: number): [number, number][];
  /** Tips paid each week (a "Tips" line, left out of the regular rate). */
  tips?: number;
  /** A bonus at each quarter's end, paid on the next check. */
  quarterlyBonus?: number;
}

const PEOPLE: Person[] = [
  { id: 'E101', name: 'Maria Lopez', week: (i) => [[21, i % 3 === 0 ? 46 : 40]] },
  { id: 'E102', name: 'Dev Patel', week: (i) => (i % 2 === 0 ? [[19.5, 38], [26, 9]] : [[19.5, 40]]) },
  { id: 'E103', name: 'Sam Okafor', week: (i) => [[17.25, i % 4 === 1 ? 40 : 44]] },
  { id: 'E104', name: 'Jo Kim', week: (i) => [[18, i % 5 === 0 ? 32 : 38]] },
  { id: 'E105', name: 'Ana Silva', week: (i) => [[24, i % 2 === 0 ? 50 : 34]] },
  { id: 'E106', name: 'Lee Chen', week: (i) => [[22, i % 6 === 0 || i === WEEKS - 1 ? 48 : 40]] },
  // A tipped server: $2.13 cash wage plus the tip credit; tips are paid too (not wages for the regular rate).
  { id: 'E107', name: 'Rosa Diaz', week: (i) => [[2.13, i % 3 === 2 ? 46 : 36]], tips: 410 },
  // A catering cook with a quarterly production bonus of $750.
  { id: 'E108', name: 'Theo Grant', week: (i) => [[23, i % 2 === 0 ? 43 : 38]], quarterlyBonus: 750 },
];

/** Spreads a week's hours over Monday to Saturday, 8 a day, the rest on Saturday. */
function daily(total: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  let left = total;
  for (let d = 1; d <= 5 && left > 0; d++) {
    out[d] = Math.min(8, left);
    left -= out[d];
  }
  out[6] = left;
  return out;
}

const ssn = (n: number) => `***-**-${String(4821 + n * 7).padStart(4, '0')}`;

/** The sample timesheet as an export would give it, SSN column included (it is dropped on import). */
export function sampleCsv(): string {
  const rows: (string | number)[][] = [['Employee ID', 'Employee', 'SSN', 'Date', 'Pay Type', 'Hours', 'Rate', 'Amount', 'Pay Date']];
  PEOPLE.forEach((p, n) => {
    for (let i = 0; i < WEEKS; i++) {
      const start = FIRST + 7 * i;
      // Biweekly periods from the first Sunday; paid on the Friday after the period ends.
      const periodStart = FIRST + 14 * Math.floor(i / 2);
      const payDate = isoDay(periodStart + 13 + 6);
      for (const [rate, hours] of p.week(i)) {
        daily(hours).forEach((h, d) => {
          if (h > 0) rows.push([p.id, p.name, ssn(n), isoDay(start + d), rate === 26 ? 'Catering' : rate < 7.25 ? 'Server' : 'Regular', h, rate.toFixed(2), '', payDate]);
        });
      }
      if (p.tips) rows.push([p.id, p.name, ssn(n), isoDay(start + 6), 'Tips', '', '', p.tips.toFixed(2), payDate]);
      // Quarter ends inside this week: the bonus is paid on the check of the next period.
      if (p.quarterlyBonus) {
        for (let d = 0; d < 7; d++) {
          const day = isoDay(start + d);
          // From 2026 on: the file has no hours for the rest of a 2025 quarter.
          if (/-(03-31|06-30|09-30|12-31)$/.test(day) && day >= '2026-01-01') {
            const nextPay = isoDay(FIRST + 14 * (Math.floor(i / 2) + 1) + 13 + 6);
            rows.push([p.id, p.name, ssn(n), day, 'Quarterly bonus', '', '', p.quarterlyBonus.toFixed(2), nextPay]);
          }
        }
      }
    }
  });
  return toCsv(rows);
}

export interface Sample {
  settings: EmployerSettings;
  csv: string;
  lines: TimeLine[];
  reported: Record<string, number>;
}

/**
 * The sample with the payroll's TT figures: Maria and Jo right; Dev at one
 * rate; Sam with the full overtime pay; Ana counted per pay period; Lee with
 * the week paid in January 2027 included; Rosa on her cash wage; Theo with
 * his bonuses left out.
 */
export function buildSample(): Sample {
  const csv = sampleCsv();
  const { lines } = importCsv(csv);
  const weeks = buildWeeks(lines, SAMPLE_SETTINGS);
  const reported: Record<string, number> = {};
  for (const ew of weeks) {
    const { yearWeeks, correct } = checkEmployee(ew, SAMPLE_SETTINGS.taxYear, null);
    const c = mistakeCandidates(yearWeeks, ew.weeks, SAMPLE_SETTINGS.taxYear);
    const find = (re: RegExp) => (c.find((x) => re.test(x.cause)) as { value: number }).value;
    const figure: Record<string, () => number> = {
      E101: () => correct,
      E102: () => find(/One pay rate \(\$19\.50\)/),
      E103: () => find(/full overtime pay/),
      E104: () => 0,
      E105: () => find(/per pay period/),
      E106: () => find(/paid in 2027/),
      E107: () => find(/cash wage/),
      E108: () => find(/bonuses were left out/),
    };
    reported[ew.employee.key] = figure[ew.employee.id]();
  }
  return { settings: { ...SAMPLE_SETTINGS }, csv, lines, reported };
}
