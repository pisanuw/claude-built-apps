import { describe, expect, it } from 'vitest';
import { clauses, normalize, polarityOf, sentences, stripTone, toneOf } from '../src/core/sentiment';

const pol = (t: string) => polarityOf(toneOf(t));

describe('toneOf', () => {
  it('reads praise and criticism', () => {
    expect(pol('The lectures were clear and engaging')).toBe('positive');
    expect(pol('The exams were brutal and unfair')).toBe('critical');
    expect(pol('The textbook')).toBe('neutral');
  });
  it('flips negated words, including contractions with curly apostrophes', () => {
    expect(pol('The slides were not helpful')).toBe('critical');
    expect(pol('The feedback wasn’t clear')).toBe('critical');
    expect(pol('The labs were never boring')).toBe('positive');
  });
  it('does not flip after "not only"', () => {
    expect(pol('She was not only helpful but kind')).toBe('positive');
  });
  it('counts "too <word>" against, but not "too much" twice', () => {
    expect(toneOf('The pace was too fast').negative).toBe(1);
    expect(toneOf('There was too much work').negative).toBe(1);
    expect(toneOf('Me too and also').negative).toBe(0);
  });
  it('lets the longest phrase win and strengthens after an intensifier', () => {
    expect(toneOf('It was well organized').positive).toBe(1.5);
    expect(toneOf('It was very clear').positive).toBe(1.5);
  });
  it('reads unprefixed words without matching inside longer ones', () => {
    expect(pol('The staff were unhelpful')).toBe('critical');
    expect(pol('I felt uncomfortable')).toBe('critical');
  });
  it('flags suggestions and leans wishes critical', () => {
    const t = toneOf('I wish the slides were posted before class');
    expect(t.suggestion).toBe(true);
    expect(t.negative).toBeGreaterThan(0);
    expect(toneOf('You should post solutions').suggestion).toBe(true);
  });
});

describe('polarityOf', () => {
  it('calls balanced comments mixed', () => {
    expect(polarityOf({ positive: 1, negative: 1 })).toBe('mixed');
    expect(polarityOf({ positive: 0.2, negative: 0 })).toBe('neutral');
    expect(polarityOf({ positive: 2, negative: 0.5 })).toBe('positive');
  });
});

describe('splitting', () => {
  it('splits sentences and clauses at contrast words', () => {
    expect(sentences('One. Two!\nThree')).toEqual(['One.', 'Two!', 'Three']);
    expect(clauses('Great lectures but the exams were hard; labs fine -- slides ok')).toEqual(['Great lectures', 'but the exams were hard', 'labs fine', 'slides ok']);
    expect(clauses('... 123')).toEqual([]);
  });
  it('normalizes apostrophes and strips tone words', () => {
    expect(normalize('didn’t')).toBe("didn't");
    expect(stripTone('great recursion').trim()).toBe('recursion');
  });
});
