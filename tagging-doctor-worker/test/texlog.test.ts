import { describe, expect, it } from 'vitest';
import { firstError, pageCount, tail, warningCount, wantsRerun } from '../src/texlog.ts';

describe('reading the TeX log', () => {
  it('finds the page count', () => {
    expect(pageCount('Output written on main.pdf (22 pages, 341758 bytes).')).toBe(22);
    expect(pageCount('Output written on main.pdf (1 page, 3 bytes).')).toBe(1);
    expect(pageCount('No pages of output.')).toBeNull();
  });

  it('counts LaTeX, package and class warnings', () => {
    const log = ['LaTeX Warning: Reference `x\' undefined.', 'Package hyperref Warning: Token not allowed.', 'Class article Warning: x', 'LaTeX Font Warning: Font shape', 'Overfull \\hbox', 'Not a Warning: here'].join('\n');
    expect(warningCount(log)).toBe(4);
  });

  it('knows when LaTeX asks for a rerun', () => {
    expect(wantsRerun('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.')).toBe(true);
    expect(wantsRerun('Package rerunfilecheck Info: File `main.out\' has not changed.')).toBe(false);
  });

  it('finds the first error, with its file and line', () => {
    expect(firstError('x\n./sub/ch1.tex:12: Undefined control sequence.\n./main.tex:3: other')).toEqual({ file: 'sub/ch1.tex', line: 12, message: 'Undefined control sequence.' });
    expect(firstError('! LaTeX Error: File `tabu.sty\' not found.\n\nType X to quit\nl.4 \\usepackage\n')).toEqual({ file: null, line: 4, message: 'LaTeX Error: File `tabu.sty\' not found.' });
    expect(firstError('! Emergency stop.\n')).toEqual({ file: null, line: null, message: 'Emergency stop.' });
    expect(firstError('all fine')).toBeNull();
  });

  it('keeps the last lines', () => {
    expect(tail('a\nb\nc\n', 2)).toEqual(['b', 'c']);
    expect(tail('a\r\nb', 5)).toEqual(['a', 'b']);
  });
});

describe('R3a.3-1 (b): the page count over a log the document fills itself', () => {
  it('reads the last "Output written on", also when its file name wraps', () => {
    const fake = 'Output written on fake.pdf (99 pages, 1 bytes).\n'.repeat(3);
    expect(pageCount(`${fake}Output written on main.pdf (22 pages, 341758 bytes).`)).toBe(22);
    // A 512-character name (the longest the upload allows), wrapped at 79 characters as TeX does.
    const name = 'n'.repeat(508) + '.pdf';
    const line = `Output written on ${name} (3 pages, 9 bytes).`.replace(/(.{79})/g, '$1\n');
    expect(pageCount(`x\n${line}\n`)).toBe(3);
    // The last one has no count: none, even when an earlier one had one.
    expect(pageCount('Output written on a.pdf (2 pages, 1 bytes).\nOutput written on ')).toBeNull();
  });

  it('stays linear on a log full of "Output written on " with no count', () => {
    // D-55: a size against eight times that size. The old expression took about
    // 0.2 s on 128 KB and 11 s on 1 MB (64 times); a linear reader about 8 times.
    // Then 8 MB, the most any log here could hold, with a loose bound.
    const flood = (n: number) => 'Output written on '.repeat(Math.ceil(n / 18)).slice(0, n);
    const time = (log: string) => {
      const t0 = performance.now();
      expect(pageCount(log)).toBeNull();
      return performance.now() - t0;
    };
    const small = flood(128 * 1024);
    const large = flood(1024 * 1024);
    time(small);
    const a = time(small);
    const b = time(large);
    expect(b).toBeLessThan(16 * a + 250);
    expect(time(flood(8 * 1024 * 1024))).toBeLessThan(5_000);
  }, 120_000);
});
