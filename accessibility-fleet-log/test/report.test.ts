import { describe, expect, it } from 'vitest';
import { contrastRatio, monthBounds, monthLabel, monthlyReport, readableOnWhite, reportHtml, reportMonths } from '../src/core/report';
import { emptyAgency } from '../src/core/model';
import { check, fleet, site } from './helpers';

const S = site();

function demo() {
  return fleet(
    [S],
    [
      check('s1', '2026-09-10', { '/': ['image-alt', 'color-contrast'], '/menu': ['label'] }),
      check('s1', '2026-10-05', { '/': ['color-contrast', 'link-name'], '/menu': ['label'] }),
      check('s1', '2026-10-28', { '/': ['link-name'], '/menu': ['label', 'target-size'] }),
    ],
    { statements: [{ siteId: 's1', date: '2026-09-11', text: 'v1' }, { siteId: 's1', date: '2026-11-02', text: 'v2' }] },
  );
}

describe('monthly report', () => {
  it('works out month bounds and labels', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthBounds('2028-02').end).toBe('2028-02-29');
    expect(monthLabel('2026-10')).toBe('October 2026');
  });

  it('lists months with checks plus the current one', () => {
    expect(reportMonths(demo(), 's1', '2026-11-04')).toEqual(['2026-11', '2026-10', '2026-09']);
  });

  it('counts fixed, new and open issues for the month', () => {
    const r = monthlyReport(demo(), S, '2026-10');
    expect(r.checks).toHaveLength(2);
    expect(r.openAtStart).toBe(3);
    expect(r.openAtEnd).toBe(3);
    expect(r.fixed.map((i) => i.ruleId).sort()).toEqual(['color-contrast', 'image-alt']);
    expect(r.found.map((i) => i.ruleId).sort()).toEqual(['link-name', 'target-size']);
    expect(r.criteria.map((c) => c.id)).toEqual(['2.4.4', '4.1.2']);
    expect(r.status).toBe('partial');
    expect(r.statementDate).toBe('2026-09-11');
  });

  it('renders a white-label HTML document', () => {
    const agency = { ...emptyAgency(), name: 'Lakeside <Web>', email: 'care@lakeside.example', website: 'lakeside.example', color: '#ffee00', reportFooter: 'Reply to your care-plan email.' };
    const html = reportHtml(monthlyReport(demo(), S, '2026-10'), S, agency);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Lakeside &lt;Web&gt;');
    expect(html).toContain('Accessibility report, October 2026');
    expect(html).toContain('2 checks were run this month');
    expect(html).toContain('Open issues: 3 (no change)');
    expect(html).toContain('Reply to your care-plan email.');
    expect(html).toContain('care@lakeside.example · lakeside.example');
    expect(html).not.toContain('#ffee00');
    expect(html).toContain('not a certificate of compliance');
  });

  it('describes empty months and fewer or more issues', () => {
    const agency = emptyAgency();
    const nov = reportHtml(monthlyReport(demo(), S, '2026-11'), S, { ...agency, color: 'bad' });
    expect(nov).toContain('No check was run this month');
    expect(nov).toContain('Nothing was confirmed fixed this month.');
    expect(nov).toContain('No new issues were found this month.');
    expect(nov).toContain('Your web team');
    const sep = reportHtml(monthlyReport(demo(), S, '2026-09'), S, agency);
    expect(sep).toContain('One check was run');
    expect(sep).toContain('3 more than at the start');
    const clean = fleet([S], [check('s1', '2026-09-10', { '/': ['label'] }), check('s1', '2026-10-10', { '/': [] })]);
    const oct = reportHtml(monthlyReport(clean, S, '2026-10'), S, agency);
    expect(oct).toContain('1 fewer than at the start');
    expect(oct).toContain('No open problems against the accessibility standard.');
    expect(oct).toContain('<p>None.</p>');
    expect(oct).toContain('No accessibility statement has been published yet.');
  });

  it('truncates long issue tables', () => {
    const pages: Record<string, string[]> = {};
    for (let i = 0; i < 45; i++) pages[`/p${i}`] = ['label'];
    const f = fleet([S], [check('s1', '2026-10-10', pages)]);
    expect(reportHtml(monthlyReport(f, S, '2026-10'), S, emptyAgency())).toContain('And 5 more');
  });

  it('keeps brand colors readable', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(readableOnWhite('#1f5f8b')).toBe('#1f5f8b');
    expect(contrastRatio(readableOnWhite('#ffee00'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
