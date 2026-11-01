import { describe, expect, it } from 'vitest';
import { q } from '../src/core/rational';
import { describeTarget, outcomeKey, parseWeightLines, targetDistribution } from '../src/core/target';

describe('outcomeKey', () => {
  it('gives JSON for data and tags for the rest', () => {
    expect(outcomeKey(3)).toBe('3');
    expect(outcomeKey('red')).toBe('"red"');
    expect(outcomeKey([2, 0, 1])).toBe('[2,0,1]');
    expect(outcomeKey(undefined)).toBe('undefined');
    expect(outcomeKey(NaN)).toBe('NaN');
    expect(outcomeKey(Infinity)).toBe('Infinity');
    expect(outcomeKey(5n)).toBe('5n');
    expect(outcomeKey(() => 1)).toBe('function');
    expect(outcomeKey(Symbol('s'))).toBe('Symbol(s)');
  });
});

describe('targetDistribution', () => {
  it('builds uniform integers with an offset', () => {
    const t = targetDistribution({ kind: 'uniform-int', n: 6, offset: 1 });
    expect([...t.keys()]).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(t.get('6')).toEqual(q(1, 6));
    expect(() => targetDistribution({ kind: 'uniform-int', n: 0 })).toThrow(RangeError);
    expect(() => targetDistribution({ kind: 'uniform-int', n: 2.5 })).toThrow(RangeError);
  });
  it('builds every permutation', () => {
    const t = targetDistribution({ kind: 'permutations', n: 4 });
    expect(t.size).toBe(24);
    expect(t.get('[3,2,1,0]')).toEqual(q(1, 24));
    expect(() => targetDistribution({ kind: 'permutations', n: 8 })).toThrow(RangeError);
  });
  it('normalizes weights exactly', () => {
    const t = targetDistribution({ kind: 'weights', entries: [['"a"', '1'], ['"b"', '0.5'], ['[0,1]', '1/2']] });
    expect(t.get('"a"')).toEqual(q(1, 2));
    expect(t.get('"b"')).toEqual(q(1, 4));
    expect(t.get('[0,1]')).toEqual(q(1, 4));
  });
  it('rejects bad weights', () => {
    expect(() => targetDistribution({ kind: 'weights', entries: [['red', '1']] })).toThrow(/not JSON/);
    expect(() => targetDistribution({ kind: 'weights', entries: [['1', '-1']] })).toThrow(/negative/);
    expect(() => targetDistribution({ kind: 'weights', entries: [['1', '1'], ['1.0', '2']] })).toThrow(/twice/);
    expect(() => targetDistribution({ kind: 'weights', entries: [['1', '0']] })).toThrow(/zero/);
  });
});

describe('parseWeightLines', () => {
  it('reads "key: weight" lines, skipping blanks and comments', () => {
    expect(parseWeightLines('"red": 3\n\n# note\n[0,1]: 1/2')).toEqual([
      ['"red"', '3'],
      ['[0,1]', '1/2'],
    ]);
    expect(() => parseWeightLines('nothing here')).toThrow(/line 1/);
  });
});

describe('describeTarget', () => {
  it('describes each kind', () => {
    expect(describeTarget({ kind: 'uniform-int', n: 6 })).toBe('uniform over 0…5');
    expect(describeTarget({ kind: 'permutations', n: 3 })).toMatch(/permutation of 0…2/);
    expect(describeTarget({ kind: 'weights', entries: [['"a"', '2']] })).toBe('weights "a":2');
  });
});
