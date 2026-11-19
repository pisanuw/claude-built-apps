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
    const t0 = performance.now();
    findCommands(blankComments('\\input{'.repeat(100_000)), specs);
    findCommands(blankComments('\\title['.repeat(100_000)), specs);
    findCommands(blankComments('\\input '.repeat(100_000)), specs);
    blankComments('\\begin{comment}\\end{comment}'.repeat(50_000));
    blankComments('\\verb|'.repeat(100_000));
    blankComments('\\url{'.repeat(100_000));
    blankComments('\\verb{'.repeat(100_000));
    blankComments('\\lstinline['.repeat(100_000));
    expect(performance.now() - t0).toBeLessThan(3000);
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
