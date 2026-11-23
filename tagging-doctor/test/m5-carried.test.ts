/**
 * Milestone 5: the findings carried from m4b's review (R4b.2-1 c, R4b.2-2,
 * R4b.2-3, R4b.F-1, R4b.F-2). Beside each new case, the input the old code
 * already got right (knowledge, 2026-11-23).
 */
import { describe, expect, it } from 'vitest';
import { plainTexError } from '../src/core/compile';
import { applyFixes } from '../src/core/patch';
import { card, setup } from './patch-helpers';

const ABOVE = (keys: string) => ({ 'main.tex': '\\input{meta}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'meta.tex': `\\DocumentMetadata{${keys}}\n` });
const STY = (keys: string) => ({ 'main.tex': '\\RequirePackage{setup}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'setup.sty': `\\DocumentMetadata{${keys}}\n` });
const noLanguage = (s: ReturnType<typeof setup>) => s.scan.findings.some((f) => f.rule === 'no-language');

describe('R4b.F-1: language= sets the language, as lang= does', () => {
  it.each([
    ['in an \\input above the class', ABOVE('language=en-US, tagging=on')],
    ['in a style file', STY('language=en-US')],
    ['in the main file', { 'main.tex': '\\DocumentMetadata{language=en-US, tagging=on}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n' }],
    ['with a value of the form [de-DE]German', STY('language=[de-DE]German')],
  ])('no "does not set its language" warning: %s', (_l, files) => {
    const s = setup(files as Record<string, string>);
    expect(card(s.plan, 'metadata')?.state).toBe('already-done');
    expect(noLanguage(s)).toBe(false);
  });

  it('beside it, as before: {} and {tagging=on} still warn; {lang=de} does not; Lang= (which LaTeX refuses) warns', () => {
    expect(noLanguage(setup(STY('')))).toBe(true);
    expect(noLanguage(setup(STY('tagging=on')))).toBe(true);
    expect(noLanguage(setup(STY('lang=de')))).toBe(false);
    expect(noLanguage(setup(STY('Lang=de')))).toBe(true);
  });
});

describe('R4b.2-1 (c) and R4b.F-2: a test of the command is not a call; a call with a key LaTeX does not know is one', () => {
  const MAIN = '\\documentclass{article}\n\\usepackage{my}\n\\begin{document}\nHi\n\\end{document}\n';
  it.each([
    ['\\cs_if_exist:NTF with an empty first branch', '\\cs_if_exist:NTF \\DocumentMetadata { } { \\def\\x{0} }\n'],
    ['\\cs_if_free:NTF with a one-word first branch', '\\cs_if_free:NTF \\DocumentMetadata { tagging } { }\n'],
    ['\\cs_if_free:NTF with { language }', '\\cs_if_free:NTF \\DocumentMetadata { language } { }\n'],
    ['\\cs_if_exist:NT', '\\cs_if_exist:NT \\DocumentMetadata { lang }\n'],
    ['\\cs_if_exist_p:N', '\\bool_if:nT { \\cs_if_exist_p:N \\DocumentMetadata } { }\n\\cs_if_exist_p:N \\DocumentMetadata\n'],
    ['\\cs_set_eq:NN', '\\cs_set_eq:NN \\my_meta:n \\DocumentMetadata\n'],
    ['\\cs_new:Npn', '\\cs_new:Npn \\DocumentMetadata { }\n'],
    ['\\@ifdefinable with a one-word branch', '\\@ifdefinable\\DocumentMetadata{tagging}\n'],
  ])('%s, in a style file loaded after the class: no call, no "misplaced", the card is ready', (_l, sty) => {
    const s = setup({ 'main.tex': MAIN, 'my.sty': sty });
    expect(s.scan.metadataFile).toBeNull();
    expect(card(s.plan, 'metadata')?.state).toBe('ready');
    expect(s.scan.findings.some((f) => f.rule === 'misplaced-document-metadata')).toBe(false);
  });

  it.each([
    ['a key of debug written one level up', 'lang=en-US, pdfmanagement=false'],
    ['nopdfinfo', 'nopdfinfo'],
    ['firstaidoff', 'lang=en-US, firstaidoff={pgf}'],
    ['a misspelt key', 'lang=en-US, taging=on'],
    ['a key in the wrong case', 'Language=en-US'],
  ])('a real call with a key the image does not have is still a call, and the copy gets no second line: %s', (_l, keys) => {
    for (const files of [STY(keys), ABOVE(keys)]) {
      const s = setup(files as Record<string, string>);
      expect(s.scan.metadataFile).not.toBeNull();
      expect(card(s.plan, 'metadata')?.state).toBe('already-done');
      const r = applyFixes(s.p, s.scan, new Set(['metadata', 'engine']));
      expect(r.files.get('main.tex') ?? files['main.tex']).not.toContain('\\DocumentMetadata');
    }
  });

  it('beside them, as before: round 1\'s tests with code in a branch, \\providecommand and a definition stay tests; a macro as the argument is not a call; real calls count', () => {
    for (const sty of [
      '\\cs_if_exist:NTF \\DocumentMetadata { \\def\\x{1} } { \\def\\x{0} }\n',
      '\\@ifdefinable\\DocumentMetadata{\\def\\x{1}}\n',
      '\\providecommand\\DocumentMetadata[1]{}\n',
      '\\def\\DocumentMetadata#1{}\n',
      '\\DocumentMetadata{\\mykeys}\n',
    ]) expect(setup({ 'main.tex': MAIN, 'my.sty': sty }).scan.metadataFile).toBeNull();
    for (const keys of ['lang=de,tagging=on', '', 'testphase=phase-III', 'tagging=on, tagging-setup={math/setup={mathml-SE,mathml-AF}}', 'uncompress', 'debug={pdfmanagement=false}', 'pdfstandard={ua-2,a-4f}, pdfversion=2.0', 'lang=en-US,% the language\n  tagging=on'])
      expect(setup(STY(keys)).scan.metadataFile).toBe('setup.sty');
  });
});

describe('R4b.2-2: when the body is opened by the document\'s own environment or macro, a file read in it is body', () => {
  it.each([
    ['an environment', '\\documentclass{article}\n\\newenvironment{doc}{\\begin{document}}{\\end{document}}\n\\begin{doc}\n\\input{help}\n\\end{doc}\n'],
    ['a macro', '\\documentclass{article}\n\\newcommand{\\go}{\\begin{document}}\n\\go\n\\input{help}\n\\end{document}\n'],
    ['a group closed in the body', '\\documentclass{article}\n{\\begin{document}\n\\input{help}\n}\n\\end{document}\n'],
  ])('%s: help.tex\'s mention is not a call, the card is ready and the copy gets the line', (_l, main) => {
    const files = { 'main.tex': main, 'help.tex': 'Put \\DocumentMetadata{tagging=on} first.\n' };
    const s = setup(files);
    expect(s.scan.metadataFile).toBeNull();
    expect(card(s.plan, 'metadata')?.state).toBe('ready');
    expect(s.scan.findings.some((f) => f.rule === 'misplaced-document-metadata')).toBe(false);
  });

  it('beside it, as before: R4b.1-6 (b)\'s meta.tex above the class counts, help.tex in a plain body does not, and a brace left open still finds the body', () => {
    expect(setup({ 'main.tex': '\\newcommand{\\go}{\\begin{document}}\n\\input{meta}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'meta.tex': '\\DocumentMetadata{lang=en-US}\n' }).scan.metadataFile).toBe('meta.tex');
    expect(setup({ 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\input{help}\n\\end{document}\n', 'help.tex': 'Put \\DocumentMetadata{tagging=on} first.\n' }).scan.metadataFile).toBeNull();
    expect(setup({ 'main.tex': '\\documentclass{article}\n{\\begin{document}\n\\input{help}\n\\end{document}\n', 'help.tex': '\\DocumentMetadata{tagging=on}\n' }).scan.metadataFile).toBeNull();
    // The limit of the fallback, written down in D-139: a definition holding \begin{document} after the class, with a
    // file read between it and its use, makes that file body, as before R4b.1-6.
    const limit = setup({ 'main.tex': '\\documentclass{article}\n\\newenvironment{doc}{\\begin{document}}{\\end{document}}\n\\input{late}\n\\begin{doc}\nHi\n\\end{doc}\n', 'late.tex': '\\DocumentMetadata{tagging=on}\n' });
    expect(limit.scan.metadataFile).toBeNull();
  });
});

describe('R4b.2-3: TeX running out of memory gets plain words', () => {
  it.each([
    ['./main.tex:1943: TeX capacity exceeded, sorry [token memory size=5906145].'],
    ['(lua): not enough memory'],
    ['! TeX capacity exceeded, sorry [main memory size=5000000].'],
  ])('%s', (line) => {
    const w = plainTexError(line);
    expect(w).toMatch(/more memory than the checker gives one job/);
    expect(w).toMatch(/not an error in your source/);
    expect(w).toMatch(/calls itself/);
  });
  it('beside it, as before: an undefined command keeps its words', () => {
    expect(plainTexError('./main.tex:3: Undefined control sequence.')).toMatch(/A command is not defined/);
  });
});
