/**
 * The documents a bookkeeper keeps or hands over: a worksheet per employee
 * (every workweek that adds to the tax year's TT figure), an employer summary,
 * and the list of W-2s that need correcting. The worksheet's total is the sum
 * of its rows, each week's amount on the year's W-2 (inYear), which is how the
 * results table's figure is made, so the two always agree.
 */
import { round2 } from './engine';
import { inYear, needsCorrection, type EmployeeCheck } from './compare';
import { toCsv } from './csv';
import { formatDay, WEEKDAYS } from './dates';
import { STATUS_TEXT } from './export';
import { MARGIN, PAGE_W, PdfWriter, type Column, type TableRow } from './pdf';
import type { EmployerSettings, WeekResult } from './types';

const money = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (x: number) => Number(x.toFixed(2)).toString();

export const FOOTER = 'Worksheet, not tax advice. FLSA workweek method (29 CFR 778): premium = hours over 40 x half the regular rate, per fixed workweek, in the year it is paid.';

export const METHOD = [
  'Hours are put into fixed seven-day workweeks starting on the employer\u2019s chosen day, whatever the pay period (29 CFR 778.104).',
  'Regular rate = all straight-time pay for the week (with shift differentials and non-discretionary bonuses spread back to the weeks they were earned in) divided by all hours worked; tip-credit hours count at the minimum wage set (29 CFR 778.109, 778.115, 778.209, 531.60).',
  'Qualified overtime for a week = hours over 40 x half the regular rate, rounded to the cent; where the file shows the overtime actually paid, the figure is capped at it. Overtime the FLSA does not require (daily or double time) is not qualified.',
  'A week counts on the W-2 of the year it is paid; a bonus\u2019s share counts in the year the bonus is paid.',
];

/** The weeks a worksheet lists: those that add to the year's figure, or have overtime or a note in the year. */
export function worksheetWeeks(c: EmployeeCheck, taxYear: number): WeekResult[] {
  return c.weeks.filter((w) => inYear(w, taxYear) !== 0 || (w.taxYear === taxYear && (w.overtimeHours > 0 || w.notes.length > 0)));
}

/** The local calendar date, ISO (a document prepared at 6 pm on 31 December is dated 31 December). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function header(pdf: PdfWriter, title: string, settings: EmployerSettings, prepared: Date): void {
  pdf.paragraph(title, 15, true, 2);
  const line = `${settings.name || 'Employer'} \u2022 W-2 tax year ${settings.taxYear} \u2022 Workweek starts ${WEEKDAYS[settings.workweekStart]} \u2022 Prepared ${formatDay(localDay(prepared))} with Qualified Overtime Checker`;
  pdf.paragraph(line, 9, false, 6);
  pdf.line(MARGIN, pdf.y + 6, PAGE_W - MARGIN, pdf.y + 6, 0.6, 0.5);
  pdf.y -= 8;
}

function worksheetPage(pdf: PdfWriter, c: EmployeeCheck, settings: EmployerSettings, prepared: Date): void {
  const year = settings.taxYear;
  header(pdf, `Qualified overtime worksheet: ${c.employee.name}${c.employee.id ? ` (${c.employee.id})` : ''}`, settings, prepared);
  const rateNeeded = c.status === 'rate-needed';
  pdf.paragraph(
    rateNeeded
      ? `Box 12 code TT: not worked out yet. ${STATUS_TEXT[c.status]}.`
      : `Box 12 code TT for ${year} by the workweek rules: ${money(c.correct)}. On the payroll\u2019s W-2: ${c.reported === null ? 'not entered' : money(c.reported)}${c.difference === null ? '' : ` (difference ${c.difference > 0 ? '+' : ''}${money(c.difference)})`}. ${STATUS_TEXT[c.status]}.`,
    11,
    true,
    2,
  );
  if (c.causes.length) pdf.paragraph(`Likely cause: ${c.causes.join(' ')}`, 9.5, false, 2);
  if (rateNeeded) {
    pdf.paragraph('Enter the employee\u2019s hourly pay rate in step 3 of the checker, then download this worksheet again.', 9.5, false, 8);
    return;
  }
  pdf.paragraph(`${hrs(c.hours)} hours worked in ${year} weeks, ${hrs(c.overtimeHours)} of them over 40 in ${c.weeksWithOvertime} workweeks${c.weeklyOnly ? '; some weeks came as weekly totals and are checked by week only' : ''}. Weeks paid in another year show only what counts on the ${year} W-2 (a bonus share paid in ${year}).`, 9.5, false, 8);
  const weeks = worksheetWeeks(c, year);
  if (!weeks.length) {
    pdf.paragraph('No workweek over 40 hours.', 10, false, 4);
    return;
  }
  const cols: Column[] = [
    { title: 'Workweek', width: 132 },
    { title: 'Hours', width: 38, align: 'right' },
    { title: 'Straight-time pay', width: 66, align: 'right' },
    { title: 'Regular rate', width: 56, align: 'right' },
    { title: 'Overtime hours', width: 48, align: 'right' },
    { title: 'Week premium', width: 58, align: 'right' },
    { title: 'Bonus premium', width: 56, align: 'right' },
    { title: `On the ${year} W-2`, width: 62, align: 'right' },
    { title: 'Paid on', width: 62 },
    { title: 'Notes', width: PAGE_W - 2 * MARGIN - 578 },
  ];
  const rows: TableRow[] = weeks.map((w) => {
    // Only this year's parts: a week paid in another year shows just the bonus share paid this year.
    const own = w.taxYear === year;
    const bonus = round2(w.bonusParts.filter((p) => p.taxYear === year).reduce((a, p) => a + p.premium, 0));
    return {
      cells: [
        `${formatDay(w.start)} \u2013 ${formatDay(w.end)}`,
        hrs(w.hours),
        money(w.straightPay),
        `$${w.regularRate.toFixed(4)}`,
        own ? hrs(w.overtimeHours) : '',
        own ? money(w.basePremium) : `paid ${w.taxYear}`,
        bonus ? money(bonus) : '',
        money(inYear(w, year)),
        w.payDate ? formatDay(w.payDate) : `none (${w.taxYear})`,
        w.notes.join(' '),
      ],
      shade: inYear(w, year) === 0,
    };
  });
  const total = round2(weeks.reduce((a, w) => a + inYear(w, year), 0));
  const otShown = weeks.filter((w) => w.taxYear === year).reduce((a, w) => a + w.overtimeHours, 0);
  rows.push({ cells: ['Total', '', '', '', hrs(otShown), '', '', money(total), '', ''], bold: true });
  pdf.table(cols, rows);
}

/** One worksheet per employee (each on its own pages), in one PDF. */
export function worksheetPdf(checks: EmployeeCheck[], settings: EmployerSettings, prepared: Date = new Date()): Uint8Array {
  const pdf = new PdfWriter();
  pdf.footer = FOOTER;
  checks.forEach((c, i) => {
    if (i > 0) pdf.newPage();
    worksheetPage(pdf, c, settings, prepared);
  });
  if (!checks.length) pdf.paragraph('No employees in this file.');
  const who = checks.length === 1 ? checks[0].employee.name : settings.name || 'employer';
  return pdf.render(`Qualified overtime worksheet, ${who}, ${settings.taxYear}`);
}

/** The employer summary: every employee's figure, what needs correcting and why, and the method. */
export function summaryPdf(checks: EmployeeCheck[], settings: EmployerSettings, prepared: Date = new Date()): Uint8Array {
  const pdf = new PdfWriter();
  pdf.footer = FOOTER;
  header(pdf, `Qualified overtime summary, ${settings.taxYear}`, settings, prepared);
  const flagged = checks.filter((c) => needsCorrection(c.status));
  // Both totals over the same employees: those waiting for a pay rate have no figure yet.
  const counted = checks.filter((c) => c.status !== 'rate-needed');
  const waiting = checks.length - counted.length;
  pdf.paragraph(`${checks.length} employees; ${flagged.length} with a Box 12 code TT figure that needs correcting. Total by the workweek rules: ${money(round2(counted.reduce((a, c) => a + c.correct, 0)))}; on the payroll\u2019s W-2s: ${money(round2(counted.reduce((a, c) => a + (c.reported ?? 0), 0)))}${waiting ? ` (both without the ${waiting} employee${waiting > 1 ? 's' : ''} still waiting for a pay rate)` : ''}.`, 10.5, true, 8);
  const cols: Column[] = [
    { title: 'Employee', width: 160 },
    { title: 'ID', width: 60 },
    { title: 'Hours worked', width: 62, align: 'right' },
    { title: 'Overtime hours', width: 62, align: 'right' },
    { title: 'TT by the workweek rules', width: 86, align: 'right' },
    { title: 'TT on payroll\u2019s W-2', width: 86, align: 'right' },
    { title: 'Reported \u2013 correct', width: 70, align: 'right' },
    { title: 'Status', width: PAGE_W - 2 * MARGIN - 586 },
  ];
  pdf.table(
    cols,
    checks.map((c) => ({
      cells: [c.employee.name, c.employee.id, hrs(c.hours), hrs(c.overtimeHours), c.status === 'rate-needed' ? '\u2014' : money(c.correct), c.reported === null ? '' : money(c.reported), c.difference === null ? '' : `${c.difference > 0 ? '+' : ''}${money(c.difference)}`, STATUS_TEXT[c.status]],
      bold: needsCorrection(c.status),
    })),
  );
  if (flagged.length) {
    pdf.ensure(40);
    pdf.paragraph('What to correct', 11, true, 2);
    for (const c of flagged) {
      pdf.paragraph(`${c.employee.name}: TT should be ${money(c.correct)}, not ${money(c.reported as number)}.${c.causes.length ? ` ${c.causes.join(' ')}` : ''}`, 9.5, false, 2);
    }
    pdf.paragraph('Before W-2s are filed, change the Box 12 code TT figure in the payroll software. After filing, each of these needs a Form W-2c showing the amount previously reported and the correct amount.', 9.5, false, 8);
  }
  pdf.ensure(60);
  pdf.paragraph('How the figures are worked out', 11, true, 2);
  for (const m of METHOD) pdf.paragraph(`\u2022 ${m}`, 9, false, 1);
  return pdf.render(`Qualified overtime summary, ${settings.name || 'employer'}, ${settings.taxYear}`);
}

/** The W-2c list: only the employees whose figure needs correcting. */
export function w2cListCsv(checks: EmployeeCheck[], settings: EmployerSettings): string {
  const rows: (string | number)[][] = [
    [`W-2 Box 12 code TT corrections, ${settings.name || 'employer'}, tax year ${settings.taxYear}. Before filing: change the figure in payroll. After filing: file a W-2c; its "previously reported" amount is what the filed W-2 shows, so check it against the first column.`],
    ['Employee ID', 'Employee', 'TT on the payroll\u2019s W-2 (as entered)', 'TT correct', 'Difference (reported - correct)', 'Likely cause'],
  ];
  for (const c of checks.filter((x) => needsCorrection(x.status))) {
    rows.push([c.employee.id, c.employee.name, (c.reported as number).toFixed(2), c.correct.toFixed(2), round2((c.reported as number) - c.correct).toFixed(2), c.causes.join(' ')]);
  }
  return toCsv(rows);
}
