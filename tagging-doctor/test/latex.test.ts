import { describe, expect, it } from 'vitest';
import { blankComments, dirOf, extOf, findCommands, groupEnds, keyValues, lineIndex, resolvePath, splitList } from '../src/core/latex';

describe('blankComments', () => {
  it('blanks comments but keeps \\% and offsets', () => {
    const src = 'a % comment\nb 50\\% c\n\\\\% after a break\nd';
    const out = blankComments(src);
    expect(out).toHaveLength(src.length);
    expect(out.split('\n')).toEqual(['a          ', 'b 50\\% c', `\\\\${' '.repeat(15)}`, 'd']);
  });

  it('blanks the contents of verbatim-like environments', () => {
    const src = '\\begin{verbatim}\n\\usepackage{tabu}\n\\end{verbatim}\n\\begin{lstlisting}\nx\n';
    const out = blankComments(src);
    expect(out).not.toContain('tabu');
    expect(out).toContain('\\end{verbatim}');
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
  });
});

describe('review round 1: the reader', () => {
  const specs = { usepackage: { args: 1 }, documentclass: { args: 1 }, includegraphics: { args: 1 }, input: { args: 1, bare: true }, title: { args: 1 } };

  it('R1.1-6: blanks \\verb, \\verb* and \\lstinline, and keeps the rest of the line', () => {
    const src = 'Write \\verb|\\documentclass{beamer}| and \\verb*+\\usepackage{tabu}+ and \\lstinline!\\usepackage{caption}! and \\lstinline[language=TeX]{\\usepackage{x}} then \\usepackage{real}';
    const out = blankComments(src);
    expect(out).toHaveLength(src.length);
    expect(findCommands(out, specs).map((c) => c.args[0])).toEqual(['real']);
  });

  it('R1.1-6: a % inside \\url{...} or the first argument of \\href does not start a comment', () => {
    const src = '\\href{http://a/b%20c}{x} \\url{http://e/%41} \\includegraphics{a.eps} % real comment \\usepackage{tabu}';
    const out = blankComments(src);
    expect(findCommands(out, specs).map((c) => [c.name, c.args[0]])).toEqual([['includegraphics', 'a.eps']]);
    expect(out).toContain('http://a/b%20c');
  });

  it('R1.1-11: hostile repeated input is read in linear time', () => {
    // Compares a quarter of the input with the whole (quadratic would be 16 times slower);
    // a wall-clock budget alone failed on a busy CI runner (a778c8f).
    const run = (n: number) => {
      const t0 = performance.now();
      findCommands(blankComments('\\input{'.repeat(n)), specs);
      findCommands(blankComments('\\title['.repeat(n)), specs);
      findCommands(blankComments('\\input '.repeat(n)), specs);
      blankComments('\\begin{comment}\\end{comment}'.repeat(n / 2));
      blankComments('\\verb|'.repeat(n));
      blankComments('\\url{'.repeat(n));
      blankComments('\\verb{'.repeat(n));
      blankComments('\\lstinline['.repeat(n));
      return performance.now() - t0;
    };
    const small = run(25_000);
    const big = run(100_000);
    expect(big).toBeLessThan(8 * small + 500);
    expect(big).toBeLessThan(15_000);
  });

  it('R1.2-3: \\mintinline, \\Verb, \\nolinkurl, \\path, and braces inside an argument', () => {
    const read = (line: string) => findCommands(blankComments(line), specs).map((c) => c.args[0]);
    expect(read('\\mintinline{latex}|\\usepackage{tabu}| \\usepackage{a}')).toEqual(['a']);
    expect(read('\\mintinline[fontsize=x]{latex}{\\usepackage{tabu}} \\usepackage{a}')).toEqual(['a']);
    expect(read('\\Verb|\\usepackage{tabu}| \\usepackage{a}')).toEqual(['a']);
    expect(read('\\Verb[x]!\\usepackage{tabu}! \\usepackage{a}')).toEqual(['a']);
    expect(read('\\nolinkurl{a%b} \\usepackage{tabu}')).toEqual(['tabu']);
    expect(read('\\path{a%b} \\usepackage{tabu}')).toEqual(['tabu']);
    expect(read('\\lstinline{a{b}%c} \\usepackage{tabu}')).toEqual(['tabu']);
    expect(read('\\href{http://a/{x}%20y}{t} \\usepackage{tabu}')).toEqual(['tabu']);
    expect(read('\\pathological \\Verbatim % \\usepackage{no}')).toEqual([]);
  });

  it('R1.2-6: many different \\verb delimiters stay linear', () => {
    // R2.C-1: a quarter of the input against the whole, as D-55, at sizes where no
    // delimiter repeats (under 51,200 of them), so a reader that scans ahead for
    // each one is 16 times slower on the whole; then the 2 MB case with a loose bound.
    const source = (length: number) => {
      let src = '';
      for (let c = 0x0800; src.length < length; c = c >= 0xcfff ? 0x0800 : c + 1) src += `\\verb${String.fromCharCode(c)}`;
      return src;
    };
    const time = (src: string) => {
      const t0 = performance.now();
      blankComments(src);
      return performance.now() - t0;
    };
    const quarter = source(75_000);
    const whole = source(300_000);
    time(quarter);
    const a = time(quarter);
    const b = time(whole);
    expect(b).toBeLessThan(8 * a + 300);
    expect(time(source(2_000_000))).toBeLessThan(15_000);
  });

  it('R1.1-11: still reads a long but closed argument', () => {
    const long = `\\title{${'x'.repeat(5000)}}`;
    expect(findCommands(long, specs)[0].args[0]).toHaveLength(5000);
  });
});

describe('lineIndex', () => {
  it('maps offsets to 1-based lines', () => {
    const at = lineIndex('ab\ncd\n\nef');
    expect([at(0), at(2), at(3), at(6), at(7), at(9)]).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

describe('groupEnds', () => {
  const end = (s: string, j: number) => groupEnds(s)[j];
  it('closes braces and brackets at their own level', () => {
    expect(end('{a{b}c}d', 0)).toBe(6);
    expect(end('[x={a]b}, y][z]', 0)).toBe(11);
    expect(end('[x={a]b}, y][z]', 12)).toBe(14);
    expect(end('{a\\}b}', 0)).toBe(5);
    expect(end('{open', 0)).toBe(-1);
    expect(end('[a{b]', 0)).toBe(-1);
    expect(end('[a}b]', 0)).toBe(4);
    expect(end('[a[b]c]', 0)).toBe(6);
  });
});

describe('findCommands', () => {
  const specs = { usepackage: { args: 1 }, input: { args: 1, bare: true }, include: { args: 1 }, import: { args: 2 }, tikzexternalize: { args: 0 }, begin: { args: 1 } };

  it('reads optional and required arguments across lines', () => {
    const src = '\\usepackage[\n  utf8\n]{inputenc}[2020/01/01]\n\\usepackage{a, b}';
    const c = findCommands(src, specs);
    expect(c.map((x) => [x.name, x.opts, x.args])).toEqual([
      ['usepackage', ['\n  utf8\n', '2020/01/01'], ['inputenc']],
      ['usepackage', [], ['a, b']],
    ]);
  });

  it('does not match a longer name, an escaped backslash, or a command without its argument', () => {
    const src = '\\includegraphics{x} \\inputenc \\\\input{no} \\input \\include*{s} \\usepackage';
    const c = findCommands(src, specs);
    expect(c.map((x) => [x.name, x.star, x.args])).toEqual([['include', true, ['s']]]);
  });

  it('reads TeX\'s bare \\input and two-argument commands', () => {
    const src = '\\input chapters/one.tex\n\\import{dir/}{file}\n\\tikzexternalize\n\\begin{tikzpicture}[alt={x}]';
    const c = findCommands(src, specs);
    expect(c.map((x) => [x.name, x.args, x.opts])).toEqual([
      ['input', ['chapters/one.tex'], []],
      ['import', ['dir/', 'file'], []],
      ['tikzexternalize', [], []],
      ['begin', ['tikzpicture'], ['alt={x}']],
    ]);
  });

  it('skips a broken group', () => {
    expect(findCommands('\\usepackage[oops{x}', specs)).toEqual([]);
    expect(findCommands('\\usepackage{oops', specs)).toEqual([]);
    expect(findCommands('x', {})).toEqual([]);
  });
});

describe('keyValues and splitList', () => {
  it('splits at top-level commas only', () => {
    const kv = keyValues('width=3cm, alt={A, B = C}, Artifact,, x\\,y=1');
    expect([...kv]).toEqual([
      ['width', '3cm'],
      ['alt', '{A, B = C}'],
      ['artifact', ''],
      ['x\\,y', '1'],
    ]);
    expect(splitList(' a, ,b ,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('paths', () => {
  it('resolves like TeX against a folder, and refuses what leaves the zip', () => {
    expect(resolvePath('', 'a/b')).toEqual({ kind: 'inside', path: 'a/b' });
    expect(resolvePath('course', '../common/x.tex')).toEqual({ kind: 'inside', path: 'common/x.tex' });
    expect(resolvePath('course', './a//b')).toEqual({ kind: 'inside', path: 'course/a/b' });
    expect(resolvePath('course', '../../x')).toEqual({ kind: 'outside' });
    expect(resolvePath('', '/etc/passwd')).toEqual({ kind: 'outside' });
    expect(resolvePath('', 'C:\\x')).toEqual({ kind: 'outside' });
    expect(resolvePath('', '~/x')).toEqual({ kind: 'outside' });
    expect(dirOf('a/b/c.tex')).toBe('a/b');
    expect(dirOf('c.tex')).toBe('');
    expect(extOf('a.b/c.TEX')).toBe('tex');
    expect(extOf('a.b/c')).toBe('');
    expect(extOf('.hidden')).toBe('');
  });
});
