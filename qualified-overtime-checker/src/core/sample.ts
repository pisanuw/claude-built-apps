/**
 * A made-up employer for "Try the sample": a small restaurant and catering
 * business with six hourly staff, biweekly pay on the Friday after each
 * period, one 2026 tax year of dated daily hours (plus the weeks either side
 * of the year end), and the TT figures a payroll produced, each one wrong in
 * a way the comparison should name (or right, for two of them).
 */
import { toCsv } from './csv';
import { dayNumber, isoDay } from './dates';
import { buildWeeks, round2 } from './engine';
import { importCsv } from './importer';
import { mistakeCandidates } from './compare';
import type { EmployerSettings, TimeLine } from './types';

export const SAMPLE_SETTINGS: EmployerSettings = { name: 'Cedar Lane Kitchen (sample)', taxYear: 2026, workweekStart: 0 };

/** First Sunday of the sample (the week that holds 1 January 2026) and the number of weeks. */
const FIRST = dayNumber('2025-12-28');
const WEEKS = 53;

interface Person {
  id: string;
  name: string;
  /** Hours by job for workweek i: [rate, hours][] */
  week(i: number): [number, number][];
}

const PEOPLE: Person[] = [
  { id: 'E101', name: 'Maria Lopez', week: (i) => [[21, i % 3 === 0 ? 46 : 40]] },
  { id: 'E102', name: 'Dev Patel', week: (i) => (i % 2 === 0 ? [[19.5, 38], [26, 9]] : [[19.5, 40]]) },
  { id: 'E103', name: 'Sam Okafor', week: (i) => [[17.25, i % 4 === 1 ? 40 : 44]] },
  { id: 'E104', name: 'Jo Kim', week: (i) => [[18, i % 5 === 0 ? 32 : 38]] },
  { id: 'E105', name: 'Ana Silva', week: (i) => [[24, i % 2 === 0 ? 50 : 34]] },
  { id: 'E106', name: 'Lee Chen', week: (i) => [[22, i % 6 === 0 || i === WEEKS - 1 ? 48 : 40]] },
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

/** The sample timesheet as an export would give it, SSN column included (it is dropped on import). */
export function sampleCsv(): string {
  const rows: (string | number)[][] = [['Employee ID', 'Employee', 'SSN', 'Date', 'Pay Type', 'Hours', 'Rate', 'Pay Date']];
  PEOPLE.forEach((p, n) => {
    for (let i = 0; i < WEEKS; i++) {
      const start = FIRST + 7 * i;
      // Biweekly periods from the first Sunday; paid on the Friday after the period ends.
      const periodStart = FIRST + 14 * Math.floor(i / 2);
      const payDate = isoDay(periodStart + 13 + 6);
      for (const [rate, hours] of p.week(i)) {
        daily(hours).forEach((h, d) => {
          if (h > 0) rows.push([p.id, p.name, `***-**-${String(4821 + n * 7).padStart(4, '0')}`, isoDay(start + d), rate === 26 ? 'Catering' : 'Regular', h, rate.toFixed(2), payDate]);
        });
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
 * the week paid in January 2027 included.
 */
export function buildSample(): Sample {
  const csv = sampleCsv();
  const { lines } = importCsv(csv);
  const weeks = buildWeeks(lines, SAMPLE_SETTINGS);
  const reported: Record<string, number> = {};
  for (const ew of weeks) {
    const year = ew.weeks.filter((w) => w.taxYear === SAMPLE_SETTINGS.taxYear);
    const correct = round2(year.reduce((a, w) => a + w.premium, 0));
    const c = mistakeCandidates(year, ew.weeks, SAMPLE_SETTINGS.taxYear);
    const find = (re: RegExp) => (c.find((x) => re.test(x.cause)) as { value: number }).value;
    const figure: Record<string, () => number> = {
      E101: () => correct,
      E102: () => find(/One pay rate \(\$19\.50\)/),
      E103: () => find(/full overtime pay/),
      E104: () => 0,
      E105: () => find(/per pay period/),
      E106: () => find(/paid in 2027/),
    };
    reported[ew.employee.key] = figure[ew.employee.id]();
  }
  return { settings: { ...SAMPLE_SETTINGS }, csv, lines, reported };
}
