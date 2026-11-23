/**
 * Milestone 5b: the minors carried from 5a's round 2 (review-m5a-r2.md,
 * R5a.2-2 to R5a.2-7) in the core, each beside the input that was right.
 */
import { describe, expect, it } from 'vitest';
import { plainTexError } from '../src/core/compile';
import { altEdits, listFigures, notCarried, STYLE_FIGURE, styleFigureAttention, type AltDecision } from '../src/core/figures';
import { applyFixes } from '../src/core/patch';
import { card, setup } from './patch-helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const DOC = (body: string, preamble = '') => `\\documentclass{article}\n\\usepackage{graphicx}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;
const figs = (files: Record<string, string | Uint8Array>) => {
  const s = setup(files);
  return { ...s, figures: listFigures(s.p, s.scan) };
};

describe('R5a.2-2: "Needs your attention" names only the style file\'s figures without alt text', () => {
  it('the review\'s course.sty gives one line, for plain.png', () => {
    const sty = [
      '\\let\\oldincludegraphics\\includegraphics',
      '\\renewcommand{\\includegraphics}[2][]{\\oldincludegraphics[#1]{#2}}',
      '\\newcommand\\fig[1]{\\includegraphics{#1}}',
      '\\newcommand\\crest{\\includegraphics[artifact]{crest.png}}',
      '\\newcommand\\logo{\\includegraphics[alt={The logo}]{logo.png}}',
      '\\newcommand\\plain{\\includegraphics[width=1cm]{plain.png}}',
      '',
    ].join('\n');
    const s = setup({ 'main.tex': '\\documentclass{article}\n\\usepackage{course}\n\\begin{document}\nHi\n\\end{document}\n', 'course.sty': sty });
    expect(styleFigureAttention(s.p, s.scan)).toEqual([{ title: 'Figure plain.png', where: 'course.sty, line 6', message: STYLE_FIGURE }]);
  });
});

describe('R5a.2-3: the moving arguments, by position', () => {
  const body = [
    '\\begin{minipage}{5cm}x\\captionof{figure}{C \\includegraphics{a.png}}\\end{minipage}',
    '\\subcaptionbox{S \\includegraphics{a.png}}{\\includegraphics{a.png}}',
    '\\addcontentsline{toc}{section}{T \\includegraphics{a.png}}',
    '\\markboth{L \\includegraphics{a.png}}{R \\includegraphics{a.png}}',
    '\\section[Short \\includegraphics{a.png}]{Long}',
    '\\captionsetup{font=small}\\sectionmark{x}\\footnote{F \\includegraphics{a.png}}',
    '\\begin{tabular}{c}\\includegraphics{a.png}\\end{tabular}\\fbox{\\includegraphics{a.png}}',
  ].join('\n');
  it('\\captionof\'s second argument, \\subcaptionbox\'s first, \\addcontentsline\'s third, both of \\markboth\'s and a [short] title move; the rest do not', () => {
    const { figures } = figs({ 'main.tex': DOC(body, '\\usepackage{caption}\n\\usepackage{subcaption}\n'), 'a.png': PNG });
    expect(figures.map((f) => f.moving)).toEqual([true, true, false, true, true, true, true, false, false, false]);
  });
  it('so a backslash in a \\captionof figure\'s text is not written, and a text without it is', () => {
    const { p, scan, figures } = figs({ 'main.tex': DOC('\\begin{minipage}{5cm}x\\captionof{figure}{C \\includegraphics{a.png}}\\end{minipage}', '\\usepackage{caption}\n'), 'a.png': PNG });
    expect(notCarried(figures[0], 'a \\ b')).toBe(true);
    const r = (text: string) => applyFixes(p, scan, new Set(), { alts: altEdits(p, figures, new Map<string, AltDecision>([[figures[0].id, { decision: 'approved', text }]])) }).altTexts;
    expect(r('a \\ b')).toBe(0);
    expect(r('a plain caption icon')).toBe(1);
  });
});

describe('R5a.2-5: LuaTeX\'s memory sizes get the memory words', () => {
  it('node memory size (from the image) and token memory size are memory; the stack and level sizes are a command that calls itself; buffer size gets TeX\'s own words', () => {
    expect(plainTexError('! TeX capacity exceeded, sorry [node memory size=21181405].')).toMatch(/more memory than the checker gives one job/);
    expect(plainTexError('./main.tex:1943: TeX capacity exceeded, sorry [token memory size=5906145]')).toMatch(/more memory than the checker gives one job/);
    for (const l of ['[input stack size=10000]', '[text input levels=15]', '[grouping levels=255]', '[parameter stack size=10000]', '[save size=100000]', '[semantic nest size=500]', '[expansion depth=10000]']) {
      expect(plainTexError(`! TeX capacity exceeded, sorry ${l}.`), l).toMatch(/^A command calls itself/);
    }
    expect(plainTexError('! TeX capacity exceeded, sorry [buffer size=200000].')).toBeNull();
  });
});

describe('R5a.2-6: the copy blanks each file once, not once per figure', () => {
  it('200 approved figures with options: compare 100 and 200 (not a time limit, knowledge 2026-11-20)', () => {
    const run = (n: number) => {
      const body = Array.from({ length: n }, (_, i) => `Some text ${'x'.repeat(1500)}\n\\includegraphics[width=3cm]{a.png} % ${i}`).join('\n');
      const { p, figures } = figs({ 'main.tex': DOC(body), 'a.png': PNG });
      const d = new Map<string, AltDecision>(figures.map((f) => [f.id, { decision: 'approved', text: 'A' }]));
      const t = performance.now();
      const edits = altEdits(p, figures, d);
      const ms = performance.now() - t;
      expect(edits).toHaveLength(n);
      return ms;
    };
    run(20);
    const a = run(100);
    const b = run(200);
    // Linear: twice the figures and twice the file is about twice the time; the old code was about four times.
    expect(b / Math.max(a, 0.5)).toBeLessThan(3.2);
  });
});

describe('R5a.2-7: small items', () => {
  it('(d) two minipages side by side in one figure each get their own caption and label', () => {
    const body = '\\begin{figure}\n\\begin{minipage}{0.4\\textwidth}\\includegraphics{a.png}\\caption{Left one}\\label{l}\\end{minipage}\n\\begin{minipage}{0.4\\textwidth}\\includegraphics{a.png}\\caption{Right one}\\label{r}\\end{minipage}\n\\end{figure}';
    expect(figs({ 'main.tex': DOC(body), 'a.png': PNG }).figures.map((f) => [f.caption, f.label])).toEqual([
      ['Left one', 'l'],
      ['Right one', 'r'],
    ]);
  });
  it('(d) beside it, as before: an image after a subfigure gets the figure\'s caption; a minipage with no caption takes the figure\'s', () => {
    const body = '\\begin{figure}\n\\begin{subfigure}{0.4\\textwidth}\\includegraphics{a.png}\\caption{Sub A}\\end{subfigure}\n\\includegraphics{a.png}\n\\caption{Whole}\\label{fw}\n\\end{figure}\n\\begin{figure}\\begin{minipage}{3cm}\\includegraphics{a.png}\\end{minipage}\\caption{Outer}\\end{figure}';
    expect(figs({ 'main.tex': DOC(body), 'a.png': PNG }).figures.map((f) => f.caption)).toEqual(['Sub A', 'Whole', 'Outer']);
  });
  it('(e) \\ifdefempty and \\ifdefstring with a one-word branch are tests', () => {
    const MAIN = '\\documentclass{article}\n\\usepackage{my}\n\\begin{document}\nHi\n\\end{document}\n';
    for (const sty of ['\\ifdefempty\\DocumentMetadata{yes}{no}\n', '\\ifdefstring\\DocumentMetadata{x}{yes}{no}\n']) {
      const s = setup({ 'main.tex': MAIN, 'my.sty': sty });
      expect(s.scan.metadataFile, sty).toBeNull();
      expect(card(s.plan, 'metadata')?.state).toBe('ready');
    }
  });
  it('(f) a neighbour\'s folders do not reach the text around', () => {
    const { figures } = figs({ 'main.tex': DOC('\\includegraphics{/Users/jsmith/Desktop/one.png}\n\\includegraphics[width=1cm]{C:\\Users\\js\\two.png}\n\\includegraphics{a.png}'), 'a.png': PNG });
    expect(figures[2].before).toContain('\\includegraphics{one.png}');
    expect(figures[2].before).toContain('\\includegraphics[width=1cm]{two.png}');
    expect(figures[2].before).not.toMatch(/jsmith|Users/);
  });
});
