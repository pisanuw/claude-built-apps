import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis';
import { SAMPLE_TERMS, sampleComments, sampleProject } from '../src/core/sample';

describe('sample', () => {
  it('is the same every time, with unique ids and texts', () => {
    const a = sampleComments();
    expect(sampleComments()).toEqual(a);
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
    expect(new Set(a.map((x) => x.text)).size).toBe(a.length);
    expect(a.length).toBeGreaterThan(200);
    expect(new Set(a.map((x) => x.term))).toEqual(new Set(SAMPLE_TERMS));
  });
  it('reads mostly as positive or critical, not neutral', () => {
    const an = analyze(sampleProject());
    expect(an.comments.filter((x) => x.polarity === 'neutral').length / an.comments.length).toBeLessThan(0.1);
    expect(an.comments.filter((x) => x.themes.size === 0).length).toBeLessThan(5);
  });
});
