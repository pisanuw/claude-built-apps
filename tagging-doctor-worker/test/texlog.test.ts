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
