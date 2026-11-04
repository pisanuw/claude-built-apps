import { describe, expect, it } from 'vitest';
import { buildLog, byCriterion, daysBetween, fleetCriteria, fleetSummary, issueKey, latestStatement, scopeOf, siteRow, sortIssues, sortRows } from '../src/core/log';
import { check, fleet, site } from './helpers';

const S = site();

describe('issue log', () => {
  it('records found, fixed and reopened dates per page', () => {
    const f = fleet([S], [
      check('s1', '2026-08-01', { '/': ['image-alt', 'color-contrast'], '/menu': ['label'] }),
      check('s1', '2026-09-01', { '/': ['color-contrast'] }),
      check('s1', '2026-10-01', { '/': ['image-alt', ['color-contrast', 5]] }),
    ]);
    const log = buildLog(f, S);
    const by = (rule: string) => log.find((i) => i.ruleId === rule)!;
    expect(by('image-alt')).toMatchObject({ status: 'open', firstFound: '2026-08-01', lastSeen: '2026-10-01', fixedOn: null });
    expect(by('image-alt').events.map((e) => e.kind)).toEqual(['found', 'fixed', 'reopened']);
    expect(by('color-contrast')).toMatchObject({ status: 'open', count: 5 });
    // /menu was not in the later checks, so its issue stays open.
    expect(by('label')).toMatchObject({ status: 'open', firstFound: '2026-08-01', lastSeen: '2026-08-01' });
    expect(by('label').key).toBe(issueKey('s1', 'https://shop.example.com/menu', 'label'));
  });

  it('marks issues fixed when the page is checked again without them', () => {
    const f = fleet([S], [check('s1', '2026-08-01', { '/': ['image-alt'] }), check('s1', '2026-09-01', { '/': [] })]);
    expect(buildLog(f, S)[0]).toMatchObject({ status: 'fixed', fixedOn: '2026-09-01' });
    expect(buildLog(f, S, '2026-08-15')[0]).toMatchObject({ status: 'open' });
  });

  it('replays checks in date order, keeping insertion order on ties', () => {
    const f = fleet([S], [check('s1', '2026-09-01', { '/': [] }), check('s1', '2026-08-01', { '/': ['label'] })]);
    expect(buildLog(f, S)[0].status).toBe('fixed');
    const g = fleet([S], [check('s1', '2026-09-01', { '/': ['label'] }), check('s1', '2026-09-01', { '/': [] })]);
    expect(buildLog(g, S)[0].status).toBe('fixed');
  });

  it('scopes issues against the target', () => {
    expect(scopeOf([], '2.1')).toBe('best-practice');
    expect(scopeOf(['2.5.8'], '2.1')).toBe('beyond');
    expect(scopeOf(['2.5.8'], '2.2')).toBe('target');
    const f = fleet([S], [check('s1', '2026-08-01', { '/': ['target-size', 'region'] })]);
    expect(buildLog(f, S).map((i) => i.scope).sort()).toEqual(['best-practice', 'beyond']);
  });

  it('sorts open first, then by impact and criterion', () => {
    const f = fleet([S], [check('s1', '2026-08-01', { '/': ['color-contrast', 'image-alt', 'region'], '/b': ['label'] }), check('s1', '2026-09-01', { '/b': [] })]);
    const log = buildLog(f, S);
    log.find((i) => i.ruleId === 'image-alt')!.impact = 'critical';
    log.find((i) => i.ruleId === 'region')!.impact = null;
    expect(sortIssues(log).map((i) => i.ruleId)).toEqual(['image-alt', 'color-contrast', 'region', 'label']);
  });

  it('groups by criterion with best practice last', () => {
    const f = fleet([S], [check('s1', '2026-08-01', { '/': ['link-name', 'region'], '/b': ['link-name'] })]);
    const g = byCriterion(buildLog(f, S));
    expect(g.map((x) => [x.id, x.issues.length, x.pages])).toEqual([
      ['2.4.4', 2, 2],
      ['4.1.2', 2, 2],
      ['', 1, 1],
    ]);
  });

  it('counts days', () => {
    expect(daysBetween('2026-10-01', '2026-11-04')).toBe(34);
  });
});

describe('fleet dashboard', () => {
  it('summarizes a site', () => {
    const f = fleet([S], [check('s1', '2026-09-01', { '/': ['image-alt', 'label'] }), check('s1', '2026-10-20', { '/': ['label', 'target-size'] })], {
      statements: [{ siteId: 's1', date: '2026-09-02', text: 'v1' }],
    });
    f.checks[1].pages[0].findings[0].impact = 'critical';
    const r = siteRow(f, S, '2026-11-04');
    expect(r).toMatchObject({ lastCheck: '2026-10-20', checks: 2, pages: 1, open: 2, openTarget: 1, critical: 1, trend: 0, fixed30: 1, due: false, statement: 'outdated', statementDate: '2026-09-02' });
    expect(latestStatement(f, 's1')?.text).toBe('v1');
  });

  it('flags due checks and statement age', () => {
    const none = siteRow(fleet([S]), S, '2026-11-04');
    expect(none).toMatchObject({ lastCheck: null, due: true, statement: 'none', trend: null });
    const old = fleet([S], [check('s1', '2025-09-01', { '/': [] })], { statements: [{ siteId: 's1', date: '2025-09-01', text: '' }] });
    expect(siteRow(old, S, '2026-11-04')).toMatchObject({ due: true, statement: 'old' });
    const cur = fleet([S], [check('s1', '2026-10-30', { '/': [] })], { statements: [{ siteId: 's1', date: '2026-10-30', text: '' }] });
    expect(siteRow(cur, S, '2026-11-04')).toMatchObject({ due: false, statement: 'current' });
  });

  it('totals and sorts rows', () => {
    const a = site('a', { name: 'Alpha', client: 'A' });
    const b = site('b', { name: 'Beta', client: 'B' });
    const c = site('c', { name: 'Gamma', client: 'C' });
    const f = fleet([a, b, c], [check('a', '2026-11-01', { '/': ['label'] }), check('b', '2026-08-01', { '/': ['label', 'image-alt'] })]);
    f.checks[0].pages[0].findings[0].impact = 'critical';
    const rows = [a, b, c].map((s) => siteRow(f, s, '2026-11-04'));
    expect(fleetSummary(rows)).toEqual({ sites: 3, open: 3, critical: 1, due: 2, statementsToUpdate: 3, fixed30: 0 });
    expect(sortRows(rows, 'attention').map((r) => r.site.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 'open').map((r) => r.site.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, 'name').map((r) => r.site.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 'lastCheck').map((r) => r.site.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows([rows[2], rows[1]], 'open').map((r) => r.site.id)).toEqual(['b', 'c']);
  });

  it('finds problems shared across sites', () => {
    const a = site('a');
    const b = site('b');
    const f = fleet([a, b], [check('a', '2026-10-01', { '/': ['color-contrast', 'label'] }), check('b', '2026-10-01', { '/': ['color-contrast'], '/x': ['color-contrast'] })]);
    expect(fleetCriteria(f)).toEqual([
      { id: '1.4.3', issues: 3, sites: 2 },
      { id: '4.1.2', issues: 1, sites: 1 },
    ]);
  });
});
