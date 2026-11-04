import { describe, expect, it } from 'vitest';
import { AXE_RULE_CRITERIA, compareCriteria, criteriaForRule, criteriaInText, criterion, CRITERIA, inTarget, tagToCriterion } from '../src/core/wcag';

describe('wcag', () => {
  it('lists the A and AA criteria of WCAG 2.2 plus 4.1.1', () => {
    expect(CRITERIA.length).toBe(56);
    expect(new Set(CRITERIA.map((c) => c.id)).size).toBe(CRITERIA.length);
    expect(criterion('1.4.3')?.name).toBe('Contrast (Minimum)');
    expect(criterion('9.9.9')).toBeUndefined();
  });

  it('sorts criteria numerically', () => {
    expect(['1.4.10', '1.4.5', '1.1.1', '4.1.2', '1.4'].sort(compareCriteria)).toEqual(['1.1.1', '1.4', '1.4.5', '1.4.10', '4.1.2']);
    expect(compareCriteria('2.1.1', '2.1.1')).toBe(0);
  });

  it('knows which criteria belong to each target', () => {
    expect(inTarget('2.5.8', '2.1')).toBe(false);
    expect(inTarget('2.5.8', '2.2')).toBe(true);
    expect(inTarget('4.1.1', '2.1')).toBe(true);
    expect(inTarget('4.1.1', '2.2')).toBe(false);
    expect(inTarget('1.4.3', '2.2')).toBe(true);
    expect(inTarget('nope', '2.2')).toBe(false);
  });

  it('reads axe tags', () => {
    expect(tagToCriterion('wcag143')).toBe('1.4.3');
    expect(tagToCriterion('wcag1410')).toBe('1.4.10');
    expect(tagToCriterion('wcag2aa')).toBeNull();
    expect(tagToCriterion('wcag999')).toBeNull();
  });

  it('finds criteria in free text and pa11y codes', () => {
    expect(criteriaInText('WCAG 1.4.3 Contrast; SC 2.4.4')).toEqual(['1.4.3', '2.4.4']);
    expect(criteriaInText('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail')).toEqual(['1.4.3']);
    expect(criteriaInText('version 12.1.4.3.9')).toEqual([]);
    expect(criteriaInText('1.4.3, 1.4.3')).toEqual(['1.4.3']);
  });

  it('maps axe rules, and every mapped criterion exists', () => {
    expect(criteriaForRule('color-contrast')).toEqual(['1.4.3']);
    expect(criteriaForRule('region')).toEqual([]);
    for (const ids of Object.values(AXE_RULE_CRITERIA)) for (const id of ids) expect(criterion(id)).toBeDefined();
  });
});
