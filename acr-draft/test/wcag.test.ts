import { describe, expect, it } from 'vitest';
import { CRITERIA, CRITERIA_BY_ID, GATES, compareIds, tagToCriterion } from '../src/core/wcag';

describe('wcag criteria', () => {
  it('lists the 30 Level A and 20 Level AA criteria of WCAG 2.1, once each, in order', () => {
    expect(CRITERIA.filter((c) => c.level === 'A')).toHaveLength(30);
    expect(CRITERIA.filter((c) => c.level === 'AA')).toHaveLength(20);
    expect(new Set(CRITERIA.map((c) => c.id)).size).toBe(50);
    const sorted = [...CRITERIA].sort((a, b) => compareIds(a.id, b.id)).map((c) => c.id);
    expect(CRITERIA.map((c) => c.id)).toEqual(sorted);
    expect(CRITERIA.filter((c) => c.wcag21).map((c) => c.id)).toEqual([
      '1.3.4', '1.3.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13', '2.1.4', '2.5.1', '2.5.2', '2.5.3', '2.5.4', '4.1.3',
    ]);
  });

  it('gives every criterion a test and every gate at least one criterion', () => {
    for (const c of CRITERIA) {
      expect(c.steps.length, c.id).toBeGreaterThan(0);
      expect(c.ask, c.id).toMatch(/\?|No test needed/);
    }
    for (const g of GATES) expect(CRITERIA.some((c) => c.gate === g.id), g.id).toBe(true);
    expect(CRITERIA_BY_ID.get('4.1.1')?.alwaysSupports).toMatch(/always satisfied/);
  });

  it('maps axe tags to criteria and ignores level, AAA and 2.2 tags', () => {
    expect(tagToCriterion('wcag111')).toBe('1.1.1');
    expect(tagToCriterion('wcag1410')).toBe('1.4.10');
    expect(tagToCriterion('wcag412')).toBe('4.1.2');
    expect(tagToCriterion('wcag2aa')).toBeNull();
    expect(tagToCriterion('wcag21a')).toBeNull();
    expect(tagToCriterion('wcag213')).toBeNull(); // AAA
    expect(tagToCriterion('wcag258')).toBeNull(); // WCAG 2.2
    expect(tagToCriterion('best-practice')).toBeNull();
  });

  it('compares dotted ids numerically', () => {
    expect(compareIds('1.4.2', '1.4.10')).toBeLessThan(0);
    expect(compareIds('2.1', '2.1.0')).toBe(0);
    expect(compareIds('4.1.3', '1.1.1')).toBeGreaterThan(0);
  });
});
