/**
 * Milestone 5a, review round 1 (review-m5a-r1.md) and Manager's REJECT
 * (acceptance/m5a.md): each fix beside the input the old code got right.
 */
import { describe, expect, it } from 'vitest';
import { altEdits, IN_DEFINITION, listFigures, notCarried, STYLE_FIGURE, styleFigureAttention, type AltDecision } from '../src/core/figures';
import { applyFixes } from '../src/core/patch';
import { patchApplies, setup } from './patch-helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const DOC = (body: string, preamble = '') => `\\documentclass{article}\n\\usepackage{graphicx}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;

function figs(files: Record<string, string | Uint8Array>, main = 'main.tex') {
  const s = setup(files, main);
  return { ...s, figures: listFigures(s.p, s.scan) };
}
function approveAll(files: Record<string, string | Uint8Array>, text = 'A plot', main = 'main.tex') {
  const { p, scan, figures } = figs(files, main);
  const d = new Map<string, AltDecision>(figures.map((f) => [f.id, { decision: 'approved', text }]));
  const r = applyFixes(p, scan, new Set(), { alts: altEdits(p, figures, d) });
  return { r, figures, out: r.files.get(main) ?? '' };
}

describe('R5a.1-3: an option list that ends in a comment gets the key before the comment', () => {
  it('both of Manager\'s layouts', () => {
    const files = {
      'main.tex': DOC('\\includegraphics[width=3cm, % the width\n  height=2cm % h\n]{a.png}\n\\includegraphics[\n  width=0.5\\linewidth, % half\n]{a.png}'),
      'a.png': PNG,
    };
    const { r, out } = approveAll(files);
    expect(out).toContain('  height=2cm, alt={A plot} % h\n]{a.png}');
    expect(out).toContain('  width=0.5\\linewidth, alt={A plot} % half\n]{a.png}');
    expect(r.altTexts).toBe(2);
    patchApplies(files, r);
  });
  it('beside it, as before: [ width=1cm , ], [width=3cm]% before {a} on the next line, a comment in the middle only, and an option list that is only a comment', () => {
    const files = { 'main.tex': DOC('\\includegraphics[ width=1cm , ]{a.png}\n\\includegraphics[width=3cm]%\n{a.png}\n\\includegraphics[width=1cm, % w\n height=1cm]{a.png}\n\\includegraphics[% none yet\n]{a.png}'), 'a.png': PNG };
    const { r, out } = approveAll(files);
    expect(out).toContain('\\includegraphics[ width=1cm , alt={A plot} ]{a.png}');
    expect(out).toContain('\\includegraphics[width=3cm, alt={A plot}]%\n{a.png}');
    expect(out).toContain('\\includegraphics[width=1cm, % w\n height=1cm, alt={A plot}]{a.png}');
    expect(out).toContain('\\includegraphics[alt={A plot}% none yet\n]{a.png}');
    patchApplies(files, r);
  });
});

describe('R5a.1-4: \\graphicspath is read from the main file\'s folder', () => {
  it('notes/main.tex with {img/} finds notes/img/a.png, with its preview', () => {
    const { figures } = figs({ 'notes/main.tex': DOC('\\includegraphics{a}', '\\graphicspath{{img/}}\n'), 'notes/img/a.png': PNG }, 'notes/main.tex');
    expect(figures[0]).toMatchObject({ resolved: 'notes/img/a.png', preview: 'image/png' });
  });
  it('beside it, as before: a root main file with {img/}, {./} and an empty entry for the main folder, {img/b.png} from the subfolder', () => {
    expect(figs({ 'main.tex': DOC('\\includegraphics{a}', '\\graphicspath{{img/}}\n'), 'img/a.png': PNG }).figures[0].resolved).toBe('img/a.png');
    expect(figs({ 'notes/main.tex': DOC('\\includegraphics{a}', '\\graphicspath{{./}}\n'), 'notes/a.png': PNG }, 'notes/main.tex').figures[0].resolved).toBe('notes/a.png');
    expect(figs({ 'notes/main.tex': DOC('\\includegraphics{a}', '\\graphicspath{{}{x/}}\n'), 'notes/a.png': PNG }, 'notes/main.tex').figures[0].resolved).toBe('notes/a.png');
    expect(figs({ 'notes/main.tex': DOC('\\includegraphics{img/b.png}'), 'notes/img/b.png': PNG }, 'notes/main.tex').figures[0].resolved).toBe('notes/img/b.png');
    // The zip's root is not the main file's folder: an img/ at the root is not where LaTeX looks.
    expect(figs({ 'notes/main.tex': DOC('\\includegraphics{a}', '\\graphicspath{{img/}}\n'), 'img/a.png': PNG }, 'notes/main.tex').figures[0].resolved).toBeNull();
  });
});

describe('R5a.1-9 (c), Manager\'s AC-49: the end code of \\newenvironment is a definition', () => {
  it('is not patched, and is listed', () => {
    const files = { 'main.tex': DOC('\\begin{myfig}\\end{myfig}', '\\newenvironment{myfig}{\\begin{figure}}{\\includegraphics{a.png}\\end{figure}}\n'), 'a.png': PNG };
    const { figures, out } = approveAll(files, 'End code figure');
    expect(figures[0]).toMatchObject({ inDefinition: true, insert: null, notPatched: IN_DEFINITION });
    expect(out).not.toContain('End code figure');
  });
  it('and the other definers: \\renewenvironment with options, the xparse forms, \\def with parameters, \\newcommand* with a default', () => {
    const pre = [
      '\\renewenvironment{a}[1][x]{\\relax}{\\includegraphics{a.png}}',
      '\\NewDocumentCommand{\\b}{m}{\\includegraphics{a.png}}',
      '\\NewDocumentEnvironment{c}{o}{\\relax}{\\includegraphics{a.png}}',
      '\\def\\d#1.{\\includegraphics{a.png}}',
      '\\newcommand*{\\e}[2][y]{\\includegraphics{a.png}}',
      '\\DeclareRobustCommand\\f{\\includegraphics{a.png}}',
      '',
    ].join('\n');
    const { figures } = figs({ 'main.tex': DOC('x', pre), 'a.png': PNG });
    expect(figures.map((f) => f.inDefinition)).toEqual([true, true, true, true, true, true]);
  });
});

describe('R5a.1-9 (b): a finished one-line definition does not make the next brace its body', () => {
  it('both of the review\'s inputs are patched', () => {
    const files = { 'main.tex': DOC('\\renewcommand{\\arraystretch}{1.2} {\\small\\includegraphics{a.png}}\n\\def\\x{1}{\\includegraphics{a.png}}'), 'a.png': PNG };
    const { figures, out, r } = approveAll(files);
    expect(figures.map((f) => f.inDefinition)).toEqual([false, false]);
    expect(out.match(/alt=\{A plot\}/g)).toHaveLength(2);
    patchApplies(files, r);
  });
  it('beside it, as before: the begin code and a body after [n] are still definitions; \\fbox is not', () => {
    const pre = '\\newcommand{\\logo}{\\includegraphics{a.png}}\n\\newenvironment{p}{\\begin{figure}\\includegraphics{a.png}}{\\end{figure}}\n\\newcommand{\\g}[1]{\\fbox{\\includegraphics{a.png}}}\n';
    const { figures } = figs({ 'main.tex': DOC('\\fbox{\\includegraphics{a.png}}', pre), 'a.png': PNG });
    expect(figures.map((f) => f.inDefinition)).toEqual([true, true, true, false]);
  });
});

describe('R5a.1-9 (a): a name with a dot and no extension', () => {
  it('plot.v2 finds plot.v2.png; plot.png as written still wins', () => {
    expect(figs({ 'main.tex': DOC('\\includegraphics{plot.v2}'), 'plot.v2.png': PNG }).figures[0].resolved).toBe('plot.v2.png');
    expect(figs({ 'main.tex': DOC('\\includegraphics{plot.png}'), 'plot.png': PNG, 'plot.png.pdf': '%PDF' }).figures[0].resolved).toBe('plot.png');
  });
});

describe('R5a.1-9 (d): figures in a style or class file are under "Needs your attention"', () => {
  it('one line each, with the file and line', () => {
    const files = { 'main.tex': '\\documentclass{course}\n\\usepackage{logo}\n\\begin{document}\nHi\n\\end{document}\n', 'course.cls': '\\LoadClass{article}\n\\RequirePackage{graphicx}\n\\newcommand\\crest{\\includegraphics{crest.png}}\n', 'logo.sty': '% \\includegraphics{not.png}\n\\includegraphics[width=1cm]{logo.png}\n\\\\includegraphics{escaped}\n' };
    const s = setup(files);
    expect(listFigures(s.p, s.scan)).toEqual([]);
    expect(styleFigureAttention(s.p, s.scan)).toEqual([
      { title: 'Figure crest.png', where: 'course.cls, line 3', message: STYLE_FIGURE },
      { title: 'Figure logo.png', where: 'logo.sty, line 2', message: STYLE_FIGURE },
    ]);
  });
});

describe('R5a.1-9 (f): the caption is the figure\'s own, not a subfigure\'s beside it', () => {
  it('an image after a subfigure in the same figure gets the figure\'s caption; the image in the subfigure gets the subfigure\'s', () => {
    const body = '\\begin{figure}\n\\begin{subfigure}{0.4\\textwidth}\\includegraphics{a.png}\\caption{Sub A}\\label{sa}\\end{subfigure}\n\\includegraphics{a.png}\n\\caption{Whole}\\label{fw}\n\\end{figure}';
    const { figures } = figs({ 'main.tex': DOC(body), 'a.png': PNG });
    expect(figures.map((f) => [f.caption, f.label])).toEqual([
      ['Sub A', 'sa'],
      ['Whole', 'fw'],
    ]);
  });
});

describe('R5a.1-5: in a title or a caption, a text with \\, ~ or ^ is not written into the copy', () => {
  const body = '\\tableofcontents\n\\section{S \\includegraphics{a.png}}\n\\begin{figure}\\includegraphics{a.png}\\caption{C \\includegraphics{a.png}}\\end{figure}\n\\footnote{F \\includegraphics{a.png}}';
  it('the section and caption figures are moving; the others are not', () => {
    const { figures } = figs({ 'main.tex': DOC(body), 'a.png': PNG });
    expect(figures.map((f) => f.moving)).toEqual([true, false, true, false]);
  });
  it('a backslash keeps it out there, and nowhere else; a text without the three characters goes in everywhere', () => {
    const files = { 'main.tex': DOC(body), 'a.png': PNG };
    const back = approveAll(files, 'a \\ b');
    expect(back.out.match(/alt=\{/g)).toHaveLength(2);
    expect(back.r.altTexts).toBe(2);
    expect(notCarried(back.figures[0], 'x ~ y')).toBe(true);
    expect(notCarried(back.figures[0], 'x ^ y')).toBe(true);
    expect(notCarried(back.figures[1], 'a \\ b')).toBe(false);
    const plain = approveAll(files, 'A 50% rise & {more}');
    expect(plain.out.match(/alt=\{/g)).toHaveLength(4);
  });
});
