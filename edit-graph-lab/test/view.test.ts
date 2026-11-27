import { describe, expect, it } from 'vitest';
import { myers } from '../src/core/myers';
import { tokenize } from '../src/core/script';
import { hunks } from '../src/core/unified';
import { cellSize, explainSnake, label, offGrid, segmentPoints, STEP_TONES, stepTone } from '../src/core/view';

const chars = (s: string) => tokenize(s, 'char');

describe('view helpers', () => {
  it('labels tokens compactly', () => {
    expect(label('')).toBe('⏎');
    expect(label('a b\tc')).toBe('a·b→c');
    expect(label('abcdefghijklmnopq', 6)).toBe('abcde…');
  });

  it('explains every kind of step', () => {
    const a = chars('ABCABBA');
    const b = chars('CBABAC');
    const r = myers(a, b);
    expect(explainSnake(r.steps[0]?.snakes[0] as never, a, b)).toBe('k = 0: start at (0,0), slide no free diagonals, so V[0] = 0.');
    const texts = r.steps.flatMap((s) => s.snakes.map((x) => explainSnake(x, a, b)));
    expect(texts.some((t) => /step right .* deleting A\[0\] "A"/.test(t))).toBe(true);
    expect(texts.some((t) => /step down .* inserting B\[0\] "C", then 1 free diagonal/.test(t))).toBe(true);
    expect(texts.some((t) => /free diagonals,/.test(t))).toBe(true);
  });

  it('flags snakes that leave the grid', () => {
    const a = chars('AAAA');
    const b = chars('B');
    const r = myers(a, b);
    const all = r.steps.flatMap((s) => s.snakes);
    const out = all.filter((s) => offGrid(s, a.length, b.length));
    expect(out.length).toBeGreaterThan(0);
    expect(explainSnake(out[0] as never, a, b)).toMatch(/leaves the grid/);
  });

  it('maps a hunk to its stretch of the path', () => {
    const a = tokenize('1\n2\n3\n4\n5\n6\n7\n8\n9\n', 'line');
    const b = tokenize('1\n2\n3\n4\nX\n6\n7\n8\n9\n', 'line');
    const r = myers(a, b);
    const h = hunks(r.script, a, b, 1)[0];
    if (!h) throw new Error('no hunk');
    const pts = segmentPoints(r.script, h.opStart, h.opEnd);
    expect(pts[0]).toEqual({ x: 3, y: 3 });
    expect(pts.at(-1)).toEqual({ x: 6, y: 6 });
  });

  it('picks step tones and cell sizes within bounds', () => {
    expect(STEP_TONES).toBe(6);
    expect(stepTone(0, 5)).toBe(0);
    expect(stepTone(5, 5)).toBe(5);
    expect(stepTone(2, 4)).toBe(3);
    expect(stepTone(9, 4)).toBe(5);
    expect(stepTone(0, 0)).toBe(0);
    expect(stepTone(1, 1)).toBe(5);
    expect(cellSize(7, 6, 600)).toBe(44);
    expect(cellSize(150, 10, 600)).toBe(4);
    expect(cellSize(0, 0, 100)).toBe(44);
  });
});
