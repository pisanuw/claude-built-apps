// Milestone 5: worksheet PDFs, the employer summary, the W-2c list.
import { describe, expect, it } from 'vitest';
import { newClientFile, runChecks, withReported } from '../src/core/clientFile';
import { inYear, needsCorrection } from '../src/core/compare';
import { parseCsv } from '../src/core/csv';
import { PdfWriter, pdfString, textWidth, toWinAnsi, wrap } from '../src/core/pdf';
import { summaryPdf, w2cListCsv, worksheetPdf, worksheetWeeks } from '../src/core/reports';
import { buildSample } from '../src/core/sample';

const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('');

/** Checks the PDF's structure: header, every xref offset pointing at its object, the trailer. */
function checkPdf(bytes: Uint8Array): { pages: number; text: string } {
  const s = latin1(bytes);
  expect(s.startsWith('%PDF-1.4\n')).toBe(true);
  expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  const start = Number(/startxref\n(\d+)\n/.exec(s)?.[1]);
  expect(s.slice(start, start + 4)).toBe('xref');
  const [, count] = /xref\n0 (\d+)\n/.exec(s.slice(start)) as RegExpExecArray;
  const offsets = s.slice(start).split('\n').slice(3, 2 + Number(count)).map((l) => Number(l.slice(0, 10)));
  offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)?.[1]);
  // The text drawn, from the (...) Tj operands.
  const text = [...s.matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join('\n');
  return { pages, text };
}

const sample = () => {
  const s = buildSample();
  const f = withReported({ ...newClientFile('x', s.settings), lines: s.lines }, s.reported);
  return { f, ...runChecks(f) };
};
const when = new Date('2026-11-11T12:00:00Z');

describe('pdf writer', () => {
  it('measures, wraps and escapes text', () => {
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 1);
    expect(textWidth('Hello', 10, true)).toBeGreaterThan(textWidth('Hello', 10));
    expect(wrap('one two three four', 40, 10)).toEqual(['one two', 'three', 'four']);
    expect(wrap('Supercalifragilistic', 30, 10).length).toBeGreaterThan(1);
    expect(wrap('', 30, 10)).toEqual(['']);
    expect(pdfString('a(b)c\\d – é 中')).toBe('(a\\(b\\)c\\\\d \\226 \\351 ?)');
    expect(toWinAnsi('€•')).toEqual([128, 149]);
  });

  it('breaks a long table across pages and repeats its header', () => {
    const pdf = new PdfWriter();
    pdf.footer = 'foot';
    pdf.table([{ title: 'Name', width: 200 }, { title: 'Amount', width: 100, align: 'right' }], Array.from({ length: 120 }, (_, i) => ({ cells: [`Row ${i}`, `$${i}.00`], shade: i % 2 === 0 })));
    pdf.paragraph('After the table, a paragraph long enough to wrap onto a second line when the page is narrow enough to need it.', 10, true);
    const { pages, text } = checkPdf(pdf.render('t'));
    expect(pages).toBeGreaterThan(2);
    expect(text.split('\n').filter((t) => t === 'Name')).toHaveLength(pages);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text).toContain('Row 119');
  });
});

describe('worksheets and summary', () => {
  it('each worksheet total equals the results figure, week by week', () => {
    const { f, checks } = sample();
    for (const c of checks) {
      const weeks = worksheetWeeks(c, f.settings.taxYear);
      const total = Math.round(weeks.reduce((a, w) => a + inYear(w, f.settings.taxYear), 0) * 100) / 100;
      expect(total).toBe(c.correct);
      const { text } = checkPdf(worksheetPdf([c], f.settings, when));
      if (weeks.length) {
        const money = `$${c.correct.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        const lines = text.split('\n');
        // After "Total": the overtime hours, then the W-2 figure (empty cells draw nothing visible).
        expect(lines.slice(lines.lastIndexOf('Total') + 1).filter(Boolean)[1]).toBe(money);
      }
    }
  });

  it('puts every employee in one worksheet PDF and names the figure and cause', () => {
    const { f, checks } = sample();
    const { pages, text } = checkPdf(worksheetPdf(checks, f.settings, when));
    expect(pages).toBeGreaterThanOrEqual(checks.length);
    for (const c of checks) expect(text).toContain(`Qualified overtime worksheet: ${c.employee.name}`);
    expect(text).toContain('Likely cause: The bonuses were left out of the regular rate');
    expect(text).toContain('Prepared Nov 11, 2026');
    expect(checkPdf(worksheetPdf([], f.settings, when)).text).toContain('No employees in this file.');
  });

  it('says when an employee has no overtime week, or is waiting for a rate', () => {
    const { f, checks } = sample();
    const jo = checks.find((c) => c.employee.id === 'E104')!;
    expect(checkPdf(worksheetPdf([jo], f.settings, when)).text).toContain('No workweek over 40 hours.');
    const waiting = { ...jo, status: 'rate-needed' as const };
    expect(checkPdf(worksheetPdf([waiting], f.settings, when)).text).toContain('not worked out yet');
  });

  it('summarises the employer with totals equal to the results', () => {
    const { f, checks, summary } = sample();
    const { pages, text } = checkPdf(summaryPdf(checks, f.settings, when));
    expect(pages).toBe(1);
    expect(text).toContain(`8 employees; 6 with a Box 12 code TT figure that needs correcting. Total by the workweek rules: $${summary.totalCorrect.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(text).toContain('What to correct');
    expect(text).toContain('Ana Silva: TT should be $3,000.00, not $1,200.00.');
    const clean = summaryPdf(checks.filter((c) => !needsCorrection(c.status)), { ...f.settings, name: '' }, when);
    expect(checkPdf(clean).text).not.toContain('What to correct');
  });
});

describe('W-2c list', () => {
  it('lists exactly the employees whose figure needs correcting', () => {
    const { f, checks } = sample();
    const rows = parseCsv(w2cListCsv(checks, f.settings)).rows.slice(2).map((r) => r.cells);
    expect(rows.map((r) => r[0]).sort()).toEqual(checks.filter((c) => needsCorrection(c.status)).map((c) => c.employee.id).sort());
    const ana = rows.find((r) => r[0] === 'E105')!;
    expect(ana.slice(2, 5)).toEqual(['1200.00', '3000.00', '1800.00']);
    expect(parseCsv(w2cListCsv([], { ...f.settings, name: '' })).rows).toHaveLength(2);
  });
});
