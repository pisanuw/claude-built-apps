// Milestone 4: saved layouts, adding exports without duplicates, weekly totals, pay-period totals.
import { describe, expect, it } from 'vitest';
import { newClientFile } from '../src/core/clientFile';
import { decodeFile, encodeFile } from '../src/core/codec';
import { checkEmployee } from '../src/core/compare';
import { buildWeeks } from '../src/core/engine';
import { guessMapping, importCsv } from '../src/core/importer';
import { headerSignature, lineKey, mergeLines, periodTotals } from '../src/core/layout';

const base = { workweekStart: 0 };

describe('layouts', () => {
  it('fingerprints a header row regardless of case and punctuation', () => {
    expect(headerSignature(['Employee', 'Work Date', 'Hours'])).toBe(headerSignature(['employee', 'work-date', 'HOURS ']));
    expect(headerSignature(['Employee', 'Hours'])).not.toBe(headerSignature(['Hours', 'Employee']));
  });

  it('keeps saved mappings in a stored file', () => {
    const f = { ...newClientFile('x'), mappings: { 'a|b': guessMapping(['Employee', 'Date', 'Hours', 'Rate']) } };
    expect(decodeFile('x', JSON.parse(JSON.stringify(encodeFile(f)))).mappings).toEqual(f.mappings);
    expect(decodeFile('x', JSON.parse(JSON.stringify(encodeFile(newClientFile('y'))))).mappings).toBeUndefined();
  });
});

describe('adding an export', () => {
  const first = importCsv('Employee,Date,Hours,Rate\nAnn,2026-03-02,8,20\nAnn,2026-03-03,8,20\nAnn,2026-03-03,8,20\n').lines;
  it('leaves out rows already imported, but keeps two identical shifts within one export', () => {
    expect(first).toHaveLength(3);
    const again = mergeLines(first, first);
    expect(again).toMatchObject({ added: 0, duplicates: 3 });
    const next = importCsv('Employee,Date,Hours,Rate\nAnn,2026-03-03,8,20\nAnn,2026-03-04,8,20\n').lines;
    const merged = mergeLines(first, next);
    expect(merged).toMatchObject({ added: 1, duplicates: 1 });
    expect(merged.lines.map((l) => l.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-03', '2026-03-04']);
  });
  it('tells rows apart by every field that changes pay', () => {
    const [a] = first;
    expect(lineKey(a)).not.toBe(lineKey({ ...a, rate: 21 }));
    expect(lineKey(a)).not.toBe(lineKey({ ...a, payDate: '2026-03-13' }));
    expect(lineKey(a)).toBe(lineKey({ ...a, line: 99 }));
  });
});

describe('weekly totals', () => {
  it('checks a weekly-hours export by week, and says so', () => {
    const r = importCsv('Employee,Week Ending,Hours,Rate\nAnn,2026-03-07,46,20\nAnn,2026-03-14,38,20\n');
    expect(r.mapping.date).toBe(1);
    const [ew] = buildWeeks(r.lines, base);
    expect(ew.weeks.map((w) => [w.start, w.premium, w.weeklyOnly])).toEqual([['2026-03-01', 60, true], ['2026-03-08', 0, true]]);
    expect(ew.weeks[0].notes.join(' ')).toMatch(/checked by week only/);
    expect(checkEmployee(ew, 2026, null).weeklyOnly).toBe(true);
    expect(periodTotals(r.lines)).toEqual([]);
  });

  it('refuses pay-period totals', () => {
    const biweekly = importCsv('Employee,Pay Period End,Hours,Rate\nAnn,2026-03-14,84,20\nAnn,2026-03-28,80,20\nBo,2026-03-14,70,18\nBo,2026-03-28,72,18\nCy,2026-03-14,30,18\n');
    expect(periodTotals(biweekly.lines)).toEqual(['Ann', 'Bo']);
    expect(periodTotals(importCsv('Employee,Date,Hours,Rate\nDee,2026-03-14,90,20\n').lines)).toEqual(['Dee']);
    expect(periodTotals(importCsv('Employee,Date,Hours,Rate\nEd,2026-03-02,8,20\n').lines)).toEqual([]);
  });
});
