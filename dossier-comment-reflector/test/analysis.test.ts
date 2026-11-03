import { describe, expect, it } from 'vitest';
import { analyze, analyzeComment, changeImpact, pct, sortChanges, suggestThemes } from '../src/core/analysis';
import { BUILT_IN_THEMES, compileThemes } from '../src/core/themes';
import { sampleProject } from '../src/core/sample';
import { c, projectOf } from './helpers';

const compiled = compileThemes(BUILT_IN_THEMES);

describe('analyzeComment', () => {
  it('gives each theme the tone of its own clause', () => {
    const a = analyzeComment(c('The lectures were clear but the exams were brutal.'), compiled);
    expect(a.themes.get('clarity')?.polarity).toBe('positive');
    expect(a.themes.get('exams')?.polarity).toBe('critical');
    expect(a.polarity).toBe('mixed');
  });
  it('carries themes to a following clause with none', () => {
    const a = analyzeComment(c('The exams. They were brutal. The slides were great.'), compiled);
    expect(a.themes.get('exams')?.polarity).toBe('critical');
    expect(a.themes.get('materials')?.polarity).toBe('positive');
  });
  it('gives a quiet clause the tone of its sentence', () => {
    const a = analyzeComment(c('The projects were challenging but really rewarding and I learned a lot. The slides were bad.'), compiled);
    expect(a.themes.get('assignments')?.polarity).toBe('positive');
  });
  it('gives a lone theme the whole comment tone', () => {
    const a = analyzeComment(c('Quizzes every week. Loved it!'), compiled);
    expect(a.themes.get('exams')?.polarity).toBe('positive');
  });
  it('marks suggestions', () => {
    expect(analyzeComment(c('Please post the slides earlier.'), compiled).suggestion).toBe(true);
  });
});

describe('analyze', () => {
  const p = projectOf([
    c('The exams were unfair and stressful', 'BIO 101', 'Fall 2023'),
    c('Great lectures', 'BIO 101', 'Spring 2024'),
    c('Exams were fair', 'BIO 101', 'Spring 2024'),
    c('Recursion recursion homework', 'BIO 20', 'Spring 2024'),
    c('Recursion again', 'BIO 20', 'Spring 2024'),
    c('More recursion', 'BIO 20', 'Spring 2024'),
  ]);
  p.settings.names = ['Again'];
  const a = analyze(p);
  it('summarizes each course by theme and term', () => {
    expect(a.courses.map((x) => x.course)).toEqual(['BIO 20', 'BIO 101']);
    expect(a.terms).toEqual(['Fall 2023', 'Spring 2024']);
    const bio = a.courses[1];
    expect(bio.totals).toEqual([1, 2]);
    const exams = bio.rows.find((r) => r.theme.id === 'exams');
    expect(exams).toMatchObject({ mentions: 2, critical: 1, positive: 1 });
    expect(exams?.cells.map((x) => [x.total, x.mentions, x.critical])).toEqual([[1, 1, 1], [2, 1, 0]]);
  });
  it('lists frequent words no theme covers, leaving out names', () => {
    expect(a.otherWords).toEqual([{ word: 'recursion', count: 3 }]);
  });
  it('adds custom themes', () => {
    const q = { ...p, settings: { ...p.settings, customThemes: [{ id: 'rec', label: 'Recursion', keywords: ['recursion'] }] } };
    expect(analyze(q).overall.find((r) => r.theme.id === 'rec')?.mentions).toBe(3);
  });
});

describe('changeImpact', () => {
  const sample = sampleProject();
  const a = analyze(sample);
  it('compares the terms before a change with the terms from it on', () => {
    const [exams] = changeImpact(a, sample.changes[0]);
    expect(exams.before.terms).toEqual(['Fall 2022', 'Spring 2023']);
    expect(exams.after.terms).toEqual(['Fall 2023', 'Spring 2024', 'Fall 2024', 'Spring 2025']);
    expect(exams.enough).toBe(true);
    expect(exams.criticalDelta).toBeLessThan(-30);
  });
  it('reports when there are too few comments', () => {
    const [x] = changeImpact(a, { ...sample.changes[0], term: 'Spring 2025', themes: ['climate'] });
    expect(x.enough).toBe(false);
    expect(x.criticalDelta).toBeNull();
  });
  it('ignores unknown courses and themes', () => {
    expect(changeImpact(a, { ...sample.changes[0], course: 'NOPE' })).toEqual([]);
    expect(changeImpact(a, { ...sample.changes[0], themes: ['nope'] })).toEqual([]);
  });
  it('handles a change after the last term', () => {
    const [x] = changeImpact(a, { ...sample.changes[0], term: 'Fall 2030' });
    expect(x.after.total).toBe(0);
    expect(x.mentionDelta).toBeNull();
  });
});

describe('helpers', () => {
  it('pct', () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(1, 0)).toBe(0);
  });
  it('suggests themes from a change description', () => {
    expect(suggestThemes('replaced the midterms with weekly quizzes and a rubric', BUILT_IN_THEMES)).toEqual(['grading', 'exams']);
  });
  it('sorts changes by term then course', () => {
    const base = { id: '', what: 'x', why: '', themes: [] };
    const s = sortChanges([{ ...base, id: 'b', course: 'B', term: 'Fall 2024' }, { ...base, id: 'a', course: 'A', term: 'Spring 2024' }, { ...base, id: 'c', course: 'A', term: 'Fall 2024' }], []);
    expect(s.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
});
