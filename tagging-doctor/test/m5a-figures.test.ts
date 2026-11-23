/**
 * Milestone 5a, the core: the figure list (AC-45) and the alt text in the
 * patch (AC-49), with LaTeX's special characters escaped and read back.
 */
import { describe, expect, it } from 'vitest';
import { altEdits, CONTEXT_CHARS, escapeAlt, figureAttention, IN_DEFINITION, listFigures, normalizeAlt, TIKZ_NOT_PATCHED, unescapeAlt, type AltDecision } from '../src/core/figures';
import { applyFixes } from '../src/core/patch';
import { patchApplies, setup } from './patch-helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const DOC = (body: string, preamble = '') => `\\documentclass{article}\n\\usepackage{graphicx}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;

function figs(files: Record<string, string | Uint8Array>) {
  const s = setup(files);
  return { ...s, figures: listFigures(s.p, s.scan) };
}

describe('AC-45: the figure list', () => {
  it('lists each \\includegraphics and tikzpicture with its file, caption, label, text around it and preview', () => {
    const body = [
      'The mean of the sample is shown below.',
      '\\begin{figure}[h]',
      '\\centering',
      '\\includegraphics[width=0.5\\textwidth]{img/plot}',
      '\\caption{Sample means by week}',
      '\\label{fig:means}',
      '\\end{figure}',
      'After the plot, the variance.',
      '\\begin{tikzpicture}[scale=2]',
      '\\draw (0,0) -- (1,1);',
      '\\end{tikzpicture}',
      '\\includegraphics{scan.pdf} % a comment that is not context',
      '\\includegraphics{diagram}',
    ].join('\n');
    const { figures } = figs({ 'main.tex': DOC(body), 'img/plot.png': PNG, 'scan.pdf': '%PDF-1.4', 'diagram.eps': '%!PS' });
    expect(figures.map((f) => [f.kind, f.file, f.resolved, f.preview])).toEqual([
      ['image', 'img/plot', 'img/plot.png', 'image/png'],
      ['tikz', null, null, null],
      ['image', 'scan.pdf', 'scan.pdf', null],
      ['image', 'diagram', 'diagram.eps', null],
    ]);
    const [plot, tikz, pdf] = figures;
    expect(plot.caption).toBe('Sample means by week');
    expect(plot.label).toBe('fig:means');
    expect(plot.line).toBe(7);
    expect(plot.before).toContain('The mean of the sample is shown below.');
    expect(plot.after).toContain('After the plot, the variance.');
    expect(tikz.caption).toBe('');
    expect(tikz.insert).toBeNull();
    expect(tikz.notPatched).toBe(TIKZ_NOT_PATCHED);
    expect(pdf.after).not.toContain('a comment');
    expect(figures.every((f) => f.existing === null && !f.inDefinition)).toBe(true);
  });

  it('keeps at most 600 characters on each side', () => {
    const long = 'word '.repeat(400);
    const { figures } = figs({ 'main.tex': DOC(`${long}\n\\includegraphics{a.png}\n${long}`), 'a.png': PNG });
    expect(figures[0].before.length).toBe(CONTEXT_CHARS);
    expect(figures[0].after.length).toBeLessThanOrEqual(CONTEXT_CHARS);
    expect(figures[0].after.length).toBeGreaterThan(500);
  });

  it('finds the image through \\graphicspath, in an \\input file, with every preview type', () => {
    const files = {
      'main.tex': DOC('\\input{ch/one}', '\\graphicspath{{figs/}}\n'),
      'ch/one.tex': '\\includegraphics{a}\\includegraphics{b.JPG}\\includegraphics{c}\\includegraphics{d}\\includegraphics{missing}',
      'figs/a.webp': PNG,
      'b.JPG': PNG,
      'figs/c.gif': PNG,
      'figs/d.jpeg': PNG,
    };
    const { figures } = figs(files);
    expect(figures.map((f) => [f.path, f.resolved, f.preview])).toEqual([
      ['ch/one.tex', 'figs/a.webp', 'image/webp'],
      ['ch/one.tex', 'b.JPG', 'image/jpeg'],
      ['ch/one.tex', 'figs/c.gif', 'image/gif'],
      ['ch/one.tex', 'figs/d.jpeg', 'image/jpeg'],
      ['ch/one.tex', null, null],
    ]);
  });

  it('says what the source already has: alt, actualtext, or artifact (decorative); an empty alt is none', () => {
    const { figures } = figs({ 'main.tex': DOC('\\includegraphics[alt={A cat}]{a.png}\\includegraphics[actualtext=x]{a.png}\\includegraphics[artifact]{a.png}\\includegraphics[alt={}]{a.png}\\begin{tikzpicture}[alt={Two lines}]\\end{tikzpicture}'), 'a.png': PNG });
    expect(figures.map((f) => f.existing)).toEqual(['alt', 'alt', 'decorative', null, 'alt']);
  });

  it('a figure inside \\newcommand, \\def or \\newenvironment is listed, not patched, and under "Needs your attention"', () => {
    const pre = '\\newcommand{\\logo}{\\includegraphics{a.png}}\n\\def\\pic{\\includegraphics[width=1cm]{a.png}}\n\\newenvironment{pfig}{\\begin{figure}\\includegraphics{a.png}}{\\end{figure}}\n\\newcommand{\\fig}[1]{\\includegraphics{#1}}\n';
    const { figures } = figs({ 'main.tex': DOC('\\logo \\fbox{\\includegraphics{a.png}}', pre), 'a.png': PNG });
    expect(figures.map((f) => [f.inDefinition, f.insert === null])).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [false, false],
    ]);
    expect(figures[0].notPatched).toBe(IN_DEFINITION);
    const att = figureAttention(figures);
    expect(att).toHaveLength(4);
    expect(att[0]).toEqual({ title: 'Figure a.png', where: 'main.tex, line 3', message: IN_DEFINITION });
  });

  it('style and class files are not the document: their figures are not listed', () => {
    const { figures } = figs({ 'main.tex': '\\documentclass{article}\n\\usepackage{course}\n\\begin{document}\nHi\n\\end{document}\n', 'course.sty': '\\RequirePackage{graphicx}\n\\includegraphics{logo.png}\n', 'logo.png': PNG });
    expect(figures).toEqual([]);
  });

  it('an escaped backslash before the name is not a figure; the two-bracket form and a file not in UTF-8 are not patched', () => {
    const latin1 = new Uint8Array([...new TextEncoder().encode(DOC('\\includegraphics{a.png} caf')), 0xe9]);
    expect(figs({ 'main.tex': latin1, 'a.png': PNG }).figures[0].insert).toBeNull();
    const { figures } = figs({ 'main.tex': DOC('\\\\includegraphics{a.png} \\includegraphics[0,0][10,10]{a.png}'), 'a.png': PNG });
    expect(figures).toHaveLength(1);
    expect(figures[0].notPatched).toMatch(/two bracket groups/);
  });
});

describe('AC-49: special characters escaped, and read back', () => {
  const ALL = 'Rate % of # & a_b {set} ~ ^ \\ $5, with = and [brackets], é';
  it('round-trips a text holding every special character, a comma, =, brackets and a non-ASCII letter', () => {
    const e = escapeAlt(ALL);
    expect(unescapeAlt(e)).toBe(ALL);
    // Nothing unescaped that TeX would read as code.
    expect(e.replace(/\\csname @backslashchar\\endcsname\{\}|\\string[~^]|\\[%#&_{}$]/g, '')).not.toMatch(/[%#&_{}~^\\$]/);
    expect(e).toBe('Rate \\% of \\# \\& a\\_b \\{set\\} \\string~ \\string^ \\csname @backslashchar\\endcsname{} \\$5, with = and [brackets], é');
  });
  it('turns line breaks, tabs and runs of spaces into one space, and drops control characters', () => {
    expect(normalizeAlt('  A\n\nplot\tof\u0007 x  ')).toBe('A plot of x');
    expect(unescapeAlt(escapeAlt('a\n\nb'))).toBe('a b');
  });
});

describe('AC-49: approved alt texts go into the patch', () => {
  const files = {
    'main.tex': DOC('\\includegraphics[width=3cm]{a.png}\n\\includegraphics{a.png}\n\\includegraphics*[ width=1cm , ]{a.png}\n\\includegraphics[]{a.png}\n\\includegraphics[alt={Kept}]{a.png}\n\\includegraphics{b.png}'),
    'a.png': PNG,
    'b.png': PNG,
  };
  it('as alt={…} in the options, after them, or as [alt={…}]; decorative as artifact; one with alt in the source is left', () => {
    const { p, scan, figures } = figs(files);
    const ids = figures.map((f) => f.id);
    const d = new Map<string, AltDecision>([
      [ids[0], { decision: 'approved', text: 'A 50% rise' }],
      [ids[1], { decision: 'approved', text: 'x_1 & {y}' }],
      [ids[2], { decision: 'decorative', text: '' }],
      [ids[3], { decision: 'approved', text: 'Empty options' }],
      [ids[4], { decision: 'approved', text: 'Never written' }],
    ]);
    const r = applyFixes(p, scan, new Set(), { alts: altEdits(p, figures, d) });
    expect(r.altTexts).toBe(4);
    expect(r.applied).toEqual([]);
    const main = r.files.get('main.tex') as string;
    expect(main).toContain('\\includegraphics[width=3cm, alt={A 50\\% rise}]{a.png}');
    expect(main).toContain('\\includegraphics[alt={x\\_1 \\& \\{y\\}}]{a.png}');
    expect(main).toContain('\\includegraphics*[ width=1cm , artifact ]{a.png}');
    expect(main).toContain('\\includegraphics[alt={Empty options}]{a.png}');
    expect(main).toContain('\\includegraphics[alt={Kept}]{a.png}');
    expect(main).not.toContain('Never written');
    expect(main).toContain('\\includegraphics{b.png}');
    patchApplies(files, r);
  });

  it('with the fix cards: both in one copy and one diff, and twice the same bytes', () => {
    const withPre = { ...files, 'main.tex': `\\usepackage[utf8]{inputenc}\n${files['main.tex']}`.replace('\\usepackage[utf8]{inputenc}\n', '').replace('\\usepackage{graphicx}', '\\usepackage{graphicx}\n\\usepackage[T1]{fontenc}') };
    const { p, scan, plan, figures } = figs(withPre);
    const d = new Map<string, AltDecision>([[figures[1].id, { decision: 'approved', text: 'A plot' }]]);
    const accepted = new Set(plan.cards.filter((c) => c.acceptedByDefault && c.state === 'ready').map((c) => c.id));
    const a = applyFixes(p, scan, accepted, { alts: altEdits(p, figures, d) });
    const b = applyFixes(p, scan, accepted, { alts: altEdits(p, figures, d) });
    expect(a.diff).toBe(b.diff);
    expect(a.files.get('main.tex')).toContain('\\includegraphics[alt={A plot}]{a.png}');
    expect(a.files.get('main.tex')).toContain('\\DocumentMetadata');
    expect(a.files.get('main.tex')).not.toContain('fontenc');
    patchApplies(withPre, a);
  });

  it('an approved text that is only spaces, a figure not patched, and an unknown id change nothing', () => {
    const { p, figures } = figs({ 'main.tex': DOC('\\includegraphics{a.png}\\begin{tikzpicture}\\end{tikzpicture}'), 'a.png': PNG });
    const d = new Map<string, AltDecision>([
      [figures[0].id, { decision: 'approved', text: '  \n ' }],
      [figures[1].id, { decision: 'approved', text: 'Two lines' }],
      ['main.tex:0', { decision: 'approved', text: 'x' }],
    ]);
    expect(altEdits(p, figures, d)).toEqual([]);
  });

  it('in an \\input file, with a byte order mark', () => {
    const files2 = { 'main.tex': DOC('\\input{ch}'), 'ch.tex': '\uFEFF\\includegraphics{a.png}\n', 'a.png': PNG };
    const { p, scan, figures } = figs(files2);
    const r = applyFixes(p, scan, new Set(), { alts: altEdits(p, figures, new Map([[figures[0].id, { decision: 'approved', text: 'A' }]])) });
    expect(r.files.get('ch.tex')).toBe('\uFEFF\\includegraphics[alt={A}]{a.png}\n');
    patchApplies(files2, r);
  });
});
