import { describe, expect, it } from 'vitest';
import { allThemes, BUILT_IN_THEMES, compileThemes, keywordSource, themesIn } from '../src/core/themes';

const compiled = compileThemes(BUILT_IN_THEMES);

describe('themes', () => {
  it('matches keywords with prefixes and phrases', () => {
    expect(themesIn('The midterms were hard', compiled)).toEqual(['exams']);
    expect(themesIn('Office  hours helped', compiled)).toContain('availability');
    expect(themesIn('Very well organized course', compiled)).toContain('organization');
    expect(themesIn('hands on labs', compiled)).toEqual(expect.arrayContaining(['assignments', 'active']));
  });
  it('respects word boundaries', () => {
    expect(themesIn('the label was wrong', compiled)).not.toContain('assignments');
    expect(themesIn('graduate school', compiled)).not.toContain('grading');
  });
  it('builds a regex source that matches hyphen or space', () => {
    expect(new RegExp(keywordSource('real-world'), 'i').test('real world')).toBe(true);
    expect(new RegExp(keywordSource('quiz*'), 'i').test('Quizzes')).toBe(true);
    expect(new RegExp(keywordSource('c++'), 'i').test('c++')).toBe(true);
  });
  it('adds custom themes that have a label and a keyword', () => {
    const t = allThemes([
      { id: 'ta', label: ' Lab TAs ', keywords: ['TA', 'TAs'] },
      { id: 'blank', label: '', keywords: ['x'] },
      { id: 'nowords', label: 'Nothing', keywords: [' '] },
    ]);
    expect(t).toHaveLength(BUILT_IN_THEMES.length + 1);
    const ta = t[t.length - 1];
    expect(ta).toMatchObject({ id: 'ta', label: 'Lab TAs', phrase: 'lab tas', custom: true });
    expect(themesIn('Our TA was great', compileThemes([ta]))).toEqual(['ta']);
    expect(themesIn('anything', compileThemes([{ ...ta, keywords: [] }]))).toEqual([]);
  });
});
