import { describe, expect, it } from 'vitest';
import { FRIGHT_TICKS, LEVEL1_SCHEDULE, modeAt, phaseBoundaries } from '../src/core/modes';

describe('level 1 schedule', () => {
  it('alternates scatter and chase and ends in endless chase', () => {
    expect(LEVEL1_SCHEDULE.map((p) => p.seconds)).toEqual([7, 20, 7, 20, 5, 20, 5, Infinity]);
    expect(modeAt(0).mode).toBe('scatter');
    expect(modeAt(419).mode).toBe('scatter');
    expect(modeAt(420)).toMatchObject({ mode: 'chase', index: 1, start: 420, end: 1620 });
    expect(modeAt(84 * 60)).toMatchObject({ mode: 'chase', index: 7, end: Infinity });
    expect(modeAt(1e9).index).toBe(7);
    expect(phaseBoundaries()).toEqual([420, 1620, 2040, 3240, 3540, 4740, 5040]);
    expect(FRIGHT_TICKS).toBe(360);
  });
});
