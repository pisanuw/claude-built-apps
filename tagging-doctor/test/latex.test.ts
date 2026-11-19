import { describe, expect, it } from 'vitest';
import { blankComments, dirOf, extOf, findCommands, keyValues, lineIndex, readGroup, resolvePath, splitList } from '../src/core/latex';

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

describe('lineIndex', () => {
  it('maps offsets to 1-based lines', () => {
    const at = lineIndex('ab\ncd\n\nef');
    expect([at(0), at(2), at(3), at(6), at(7), at(9)]).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

describe('readGroup', () => {
  it('reads balanced braces and brackets', () => {
    expect(readGroup('{a{b}c}d', 0, '{', '}')).toEqual(['a{b}c', 7]);
    expect(readGroup('[x={a]b}, y][z]', 0, '[', ']')).toEqual(['x={a]b}, y', 12]);
    expect(readGroup('{a\\}b}', 0, '{', '}')).toEqual(['a\\}b', 6]);
    expect(readGroup('{open', 0, '{', '}')).toBeNull();
    expect(readGroup('x', 0, '{', '}')).toBeNull();
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
