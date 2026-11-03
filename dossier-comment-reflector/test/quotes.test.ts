import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis';
import { citation, overlap, pickQuotes, redact } from '../src/core/quotes';
import { sampleProject } from '../src/core/sample';
import { c, projectOf } from './helpers';

describe('redact', () => {
  it('removes titled names, listed names and emails', () => {
    expect(redact('Dr. Rivera and Professor Lee were great')).toBe('[name] and [name] were great');
    expect(redact('Ask sam.lee@uni.edu')).toBe('Ask [email]');
    expect(redact("Sam Lee's office hours; sam was kind", ['Sam Lee'])).toBe('[name] office hours; [name] was kind');
    expect(redact('Prof. Ann Smith rocks', ['Smith'])).toBe('[name] rocks');
    expect(redact('Nothing here', ['', 'x'])).toBe('Nothing here');
  });
});

describe('overlap', () => {
  it('measures shared words', () => {
    expect(overlap('the exams were hard', 'the exams were hard')).toBe(1);
    expect(overlap('', 'x')).toBe(0);
  });
});

describe('pickQuotes', () => {
  const sample = sampleProject();
  const a = analyze(sample);
  it('balances praise and criticism across terms without near-duplicates', () => {
    const q = pickQuotes(a, { theme: 'exams', count: 4, names: ['Rivera'] });
    expect(q).toHaveLength(4);
    expect(q.filter((x) => x.side === 'positive')).toHaveLength(2);
    expect(new Set(q.map((x) => x.analysis.comment.term)).size).toBeGreaterThan(1);
    for (const x of q) for (const y of q) if (x !== y) expect(overlap(x.text, y.text)).toBeLessThanOrEqual(0.6);
    expect(q.every((x) => !/Rivera/.test(x.text))).toBe(true);
  });
  it('limits by course, term and side', () => {
    const q = pickQuotes(a, { theme: 'feedback', course: 'CS 342', terms: ['Fall 2022'], count: 2, only: 'critical' });
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => x.side === 'critical' && x.analysis.comment.term === 'Fall 2022' && x.analysis.comment.course === 'CS 342')).toBe(true);
  });
  it('puts pinned comments first and never shows excluded ones', () => {
    const all = pickQuotes(a, { theme: 'exams', count: 6 });
    const pinId = a.comments.find((x) => x.themes.has('exams') && !all.some((q) => q.analysis === x))?.comment.id as string;
    const exId = all[0].analysis.comment.id;
    const q = pickQuotes(a, { theme: 'exams', count: 6, pinned: [pinId], excluded: [exId] });
    expect(q[0].analysis.comment.id).toBe(pinId);
    expect(q[0].pinned).toBe(true);
    expect(q.some((x) => x.analysis.comment.id === exId)).toBe(false);
  });
  it('fills from one side when the other runs out', () => {
    const p = projectOf([c('The exams were great and fair, I loved them'), c('Quizzes were helpful and clear every single week', 'BIO 101', 'Spring 2024')]);
    const q = pickQuotes(analyze(p), { theme: 'exams', count: 4 });
    expect(q.map((x) => x.side)).toEqual(['positive', 'positive']);
  });
  it('ranks short fragments and very long comments below quotable ones', () => {
    const long = `The exams were terrible. ${'Filler words here. '.repeat(25)}`;
    const p = projectOf([c('Exams bad'), c(long), c('The exams were unfair and covered material we never saw in class.')]);
    const q = pickQuotes(analyze(p), { theme: 'exams', count: 1, only: 'critical' });
    expect(q[0].analysis.comment.text).toMatch(/^The exams were unfair/);
  });
  it('cites course and term', () => {
    expect(citation(a.comments[0])).toBe('CS 142, Fall 2022');
  });
});
