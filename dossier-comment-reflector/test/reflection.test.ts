import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis';
import { asClause, draftReflection, excerpt, parseBlocks, placeholders, toText, wordCount } from '../src/core/reflection';
import { sampleProject } from '../src/core/sample';
import { BUILT_IN_THEMES } from '../src/core/themes';
import { c, projectOf } from './helpers';

const exams = BUILT_IN_THEMES.find((t) => t.id === 'exams')!;

describe('text helpers', () => {
  it('turns the user’s words into a clause', () => {
    expect(asClause('I replaced the midterm. ')).toBe('replaced the midterm');
    expect(asClause('Replaced it!')).toBe('replaced it');
    expect(asClause('TA sections added')).toBe('TA sections added');
  });
  it('counts words', () => {
    expect(wordCount('One two, three — 4')).toBe(4);
  });
  it('keeps only the sentences about the theme, marking cuts', () => {
    expect(excerpt('Short and sweet.', exams)).toBe('Short and sweet.');
    expect(excerpt('Labs were fine. The exams were hard. Slides ok.', exams)).toBe('… The exams were hard. …');
    expect(excerpt('The exams were hard. Labs fine. The quiz was fair.', exams)).toBe('The exams were hard. … The quiz was fair.');
    expect(excerpt('Nothing about it here. At all.', exams)).toBe('Nothing about it here. At all.');
    const long = excerpt(`The exams ${'were very long '.repeat(30)}.`, exams, 60);
    expect(long.length).toBeLessThanOrEqual(62);
    expect(long.endsWith(' …')).toBe(true);
  });
  it('reads edited text back into blocks', () => {
    expect(parseBlocks('# Title\n\n## Head\n\nPara one\ncontinues\r\n\r\nPara two')).toEqual([
      { kind: 'title', text: 'Title' },
      { kind: 'heading', text: 'Head' },
      { kind: 'paragraph', text: 'Para one continues' },
      { kind: 'paragraph', text: 'Para two' },
    ]);
  });
  it('finds placeholders but not redactions', () => {
    expect(placeholders('Hi [name] and [email]. [Say what you plan next.]')).toEqual(['[Say what you plan next.]']);
  });
});

describe('draftReflection', () => {
  const sample = sampleProject();
  const a = analyze(sample);
  it('writes an intro, a paragraph per change, strengths and open concerns', () => {
    const d = draftReflection(a, sample);
    const text = toText(d);
    expect(d.sections.map((s) => s.heading)).toEqual(['', 'How student comments shaped my courses', 'What students consistently value', 'What I am still working on']);
    expect(text).toMatch(/^# Reflection on Student Feedback/);
    expect(text).toContain(`draws on ${sample.comments.length} written comments`);
    expect(text).toContain('In Fall 2023 I replaced the two high-stakes midterms with six short quizzes and a retake week.');
    expect(text).toContain('I made this change because students kept saying the midterms measured anxiety more than understanding.');
    expect(text).toMatch(/share of critical comments about exams and quizzes fell from \d+% to \d+%/);
    expect(text).toContain('(CS 142, Spring 2023)');
    expect(text).not.toContain('Rivera');
    expect(text).toContain('pace and the workload');
    expect(d.words).toBeLessThanOrEqual(d.budget);
    expect(d.trimmed).toEqual([]);
  });
  it('trims to fit a tight page limit', () => {
    const tight = { ...sample, settings: { ...sample.settings, pages: 0.5, wordsPerPage: 500 } };
    const d = draftReflection(a, tight);
    expect(d.trimmed.length).toBeGreaterThan(0);
    expect(d.words).toBeLessThan(draftReflection(a, sample).words);
  });
  it('says when there is no evidence yet after a change, or too little', () => {
    const p = { ...sample, changes: [{ ...sample.changes[0], term: 'Fall 2030' }] };
    expect(toText(draftReflection(a, p))).toContain('I have no evaluations from after this change yet.');
    const q = { ...sample, changes: [{ ...sample.changes[0], term: 'Spring 2025', themes: ['exams', 'climate'] }] };
    expect(toText(draftReflection(a, q))).toMatch(/too few to say whether it helped/);
  });
  it('reports a rise and a flat share honestly', () => {
    const mk = (before: string[], after: string[]) =>
      projectOf([...before.map((t) => c(t, 'X 1', 'Fall 2023')), ...after.map((t) => c(t, 'X 1', 'Fall 2024'))], {
        changes: [{ id: 'k', course: 'X 1', term: 'Fall 2024', what: 'moved the exam', why: 'because students asked', themes: ['exams', 'grading'] }],
      });
    const good = Array(6).fill('The exam was fair and great');
    const bad = Array(6).fill('The exam was unfair and awful');
    const rose = mk(good, bad);
    expect(toText(draftReflection(analyze(rose), rose))).toMatch(/rose from 0% to 100%.*still work in progress/);
    const flat = mk(good, good);
    const text = toText(draftReflection(analyze(flat), flat));
    expect(text).toMatch(/stayed about the same, 0% before and 0% since/);
    expect(text).toContain('I made this change because students asked.');
    expect(text).toContain('Before Fall 2024, 6 of 6 comments');
  });
  it('handles changes without themes, and no changes at all', () => {
    const p = projectOf([c('The labs were great and fun')], { changes: [{ id: 'k', course: 'BIO 101', term: 'Fall 2023', what: 'added labs', why: '', themes: [] }] });
    expect(toText(draftReflection(analyze(p), p))).toContain('[Link this change to the themes');
    const q = projectOf([c('A single comment about labs that were fine')]);
    const t = toText(draftReflection(analyze(q), q));
    expect(t).toContain('draws on 1 written comment from student course evaluations across 1 term (Fall 2023) in BIO 101');
    expect(t).toContain('[Record the changes you made');
  });
  it('notes a theme students rarely raised before the change', () => {
    const p = projectOf([c('Lectures were clear', 'X', 'Fall 2023'), c('The quizzes were great', 'X', 'Fall 2024')], {
      changes: [{ id: 'k', course: 'X', term: 'Fall 2024', what: 'added quizzes', why: '', themes: ['exams'] }],
    });
    expect(toText(draftReflection(analyze(p), p))).toContain('Before Fall 2024, students in X rarely wrote about exams and quizzes.');
  });
});
