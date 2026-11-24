/**
 * Milestone 4a, review round 1: the patch's fixes (R4a.1-1, -2, -4, -5, -6,
 * -9) and Manager's notes 1, 2, 3 and 6 (acceptance/m4a.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { strToU8 } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { scanDocument, scannedSource } from '../src/core/scan';
import { applyFixes, documentLanguage, metadataLine, topLevelBegin, UNICODE_MATH_CLASHES, MATH_FONT_PACKAGES } from '../src/core/patch';
import swapsFile from '../src/data/package-swaps.json';
import { card, defaults, DOC, index, patchApplies, project, setup } from './patch-helpers';

describe('R4a.1-1: the diff applies with patch -p1 when a path holds a space', () => {
  it.each([['main.tex'], ['Lecture 1/main.tex'], ['my dir/main file.tex']])('%s', (main) => {
    const files = { [main]: DOC };
    const { p, scan, plan } = setup(files, main);
    const r = applyFixes(p, scan, defaults(plan));
    expect(r.diff).toContain(`--- a/${main}\t\n+++ b/${main}\t\n`);
    const dir = patchApplies(files, r);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('R4a.1-2: the diff of a file with a byte order mark applies', () => {
  it('keeps the mark on the first line of the diff, and patch gives the patched file', () => {
    const files = { 'main.tex': new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(DOC)]) };
    const { p, scan, plan } = setup(files);
    const r = applyFixes(p, scan, defaults(plan));
    expect(r.diff).toContain('\n-\uFEFF\\documentclass{article}\n');
    expect(r.diff).toContain(`\n+\uFEFF${metadataLine('en-US')}\n+\\documentclass{article}\n`);
    const dir = patchApplies(files, r);
    if (dir) {
      expect([...fs.readFileSync(path.join(dir, 'main.tex')).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('R4a.1-4: a \\DocumentMetadata in a file the main file reads', () => {
  it('is seen: the card is already done, names the file, and the copy gets no second line', () => {
    const files = {
      'main.tex': '\\input{preamble}\n\\begin{document}\nHi\n\\end{document}\n',
      'preamble.tex': '\\DocumentMetadata{lang=de, pdfstandard=ua-2, tagging=on}\n\\documentclass{article}\n\\usepackage[T1]{fontenc}\n',
    };
    const { p, scan, plan } = setup(files);
    expect(card(plan, 'metadata')).toMatchObject({ state: 'already-done', changes: [], what: 'Nothing: the document has its own \\DocumentMetadata line.' });
    expect(card(plan, 'metadata')?.note).toContain('preamble.tex');
    const r = applyFixes(p, scan, defaults(plan));
    expect(r.files.has('main.tex')).toBe(false);
    expect(r.diff).not.toContain('+\\DocumentMetadata');
  });

  it('is not seen in a comment or after \\end{document} of the main file', () => {
    const { plan } = setup({ 'main.tex': `% \\DocumentMetadata{lang=fr}\n${DOC}\\DocumentMetadata{lang=fr}\n` });
    expect(card(plan, 'metadata')?.state).toBe('ready');
  });
});

describe('R4a.1-5: the language and the math font come from what TeX reads', () => {
  const standalone = '\\documentclass{standalone}\n\\usepackage[french]{babel}\n\\usepackage{mathpazo}\n\\begin{document}\nfig\n\\end{document}\n';

  it('(a) ignores the own preamble of a standalone part, and text after \\end{document}', () => {
    const files = {
      'main.tex': '\\documentclass{article}\n\\usepackage[english]{babel}\n\\usepackage{standalone}\n\\begin{document}\n\\input{fig}\n\\end{document}\n\\usepackage{newtxmath}\n',
      'fig.tex': standalone,
    };
    const { plan } = setup(files);
    expect(plan.language).toMatchObject({ tag: 'en', from: 'from babel’s main language, english' });
    expect(card(plan, 'unicode-math')?.state).toBe('ready');
  });

  it('(a) still reads a part that has no preamble of its own', () => {
    const { plan } = setup({
      'main.tex': '\\documentclass{article}\n\\input{pre}\n\\begin{document}\nx\n\\end{document}\n',
      'pre.tex': '\\usepackage[french]{babel}\n\\usepackage{mathpazo}\n',
    });
    expect(plan.language.tag).toBe('fr');
    expect(card(plan, 'unicode-math')?.state).toBe('not-needed');
  });

  it('(b) takes babel’s last language even when the table does not know it, and asks', () => {
    // germanb is babel-german's older name for German, so it is de since round 2 (R4a.2-1).
    expect(setup({ 'main.tex': DOC.replace('\\usepackage{amsmath}', '\\usepackage[english,germanb]{babel}') }).plan.language).toMatchObject({ tag: 'de', from: 'from babel’s main language, germanb' });
    for (const opts of ['english,esperanto', 'esperanto']) {
      const name = opts.split(',').pop();
      const { plan } = setup({ 'main.tex': DOC.replace('\\usepackage{amsmath}', `\\usepackage[${opts}]{babel}`) });
      expect(plan.language, opts).toMatchObject({ tag: 'en-US', unmapped: name });
    }
  });

  it('(b) passes over babel’s flags and key=value options, and class options the table does not know', () => {
    const lang = (cls: string, babel: string) => {
      const p = project({ 'main.tex': `\\documentclass[${cls}]{article}\n\\usepackage[${babel}]{babel}\n\\begin{document}x\\end{document}` });
      return documentLanguage(p, { filesRead: ['main.tex'], mainFile: 'main.tex' });
    };
    expect(lang('11pt', 'ngerman,shorthands=off,activeacute')).toMatchObject({ tag: 'de', from: 'from babel’s main language, ngerman' });
    expect(lang('11pt,french', 'english')).toMatchObject({ tag: 'en' });
    expect(lang('english,a4paper', 'french,main=ngerman')).toMatchObject({ tag: 'de' });
    expect(lang('ngerman', 'silent')).toMatchObject({ tag: 'de' });
  });

  it('scannedSource keeps the length and blanks what TeX does not read', () => {
    const main = '\\documentclass{x}\n\\begin{document}a\\end{document}\nafter % c\n';
    const s = scannedSource(main, true);
    expect(s).toHaveLength(main.length);
    expect(s.trimEnd()).toBe('\\documentclass{x}\n\\begin{document}a\\end{document}');
    const part = scannedSource(standalone, false);
    expect(part).toHaveLength(standalone.length);
    expect(part).not.toMatch(/babel|mathpazo|\\end\{document\}/);
    expect(part).toContain('\\begin{document}\nfig\n');
    expect(scannedSource('\\documentclass{x}\n% only a preamble\n', false)).toBe('\\documentclass{x}\n                 \n');
    expect(scannedSource('\\usepackage{a}', false)).toBe('\\usepackage{a}');
    expect(scannedSource('no end', true)).toBe('no end');
  });
});

describe('R4a.1-6: the unicode-math line goes just before the top-level \\begin{document}', () => {
  // The diff gives the same file with patch -p1.
  const apply = (text: string) => {
    const { p, scan } = setup({ 'main.tex': text });
    const r = applyFixes(p, scan, new Set(['metadata', 'unicode-math']));
    const dir = patchApplies({ 'main.tex': text }, r);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    return r.files.get('main.tex') ?? '';
  };

  it('after \\documentclass on the same line', () => {
    expect(apply('\\documentclass{article}\\begin{document}Hi\\end{document}')).toBe(`${metadataLine('en-US')}\n\\documentclass{article}\n\\usepackage{unicode-math}\n\\begin{document}Hi\\end{document}`);
  });

  it('after amsmath on the same line', () => {
    expect(apply('\\documentclass{article}\n\\usepackage{amsmath} \\begin{document}x\n\\end{document}\n')).toContain('\\usepackage{amsmath} \n\\usepackage{unicode-math}\n\\begin{document}x');
  });

  it('not at a \\begin{document} inside a macro', () => {
    const out = apply('\\documentclass{article}\n\\newcommand{\\startdoc}{\\begin{document}}\n\\usepackage{amsmath}\n\\begin{document}\nx\n\\end{document}\n');
    expect(out).toContain('\\newcommand{\\startdoc}{\\begin{document}}\n\\usepackage{amsmath}\n\\usepackage{unicode-math}\n\\begin{document}\nx');
    expect(topLevelBegin('\\def\\a{\\begin{document}}\\begin  {document}')).toBe(24);
    expect(topLevelBegin('\\{\\begin{document}')).toBe(2);
    expect(topLevelBegin('{\\begin{document}')).toBe(-1);
  });
});

describe('R4a.1-9', () => {
  it('(a) reads each file once per plan, however many lines the patch removes', () => {
    const many = (n: number) => `\\documentclass{article}\n${'\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n'.repeat(n)}\\begin{document}x\\end{document}\n`;
    const reads = (n: number) => {
      const p = project({ 'main.tex': many(n) });
      const scan = scanDocument(p, 'main.tex', index);
      const spy = vi.spyOn(p, 'bytes');
      const r = applyFixes(p, scan, new Set(['engine']));
      expect(r.files.get('main.tex')).not.toContain('inputenc');
      return spy.mock.calls.length;
    };
    expect(reads(200)).toBe(reads(2));
    expect(reads(2)).toBeLessThanOrEqual(2);
  });

  it('(c) .env.example gives AC-80’s rule for the compare flag since CR-13', () => {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    expect(env).toContain('# checker in backend-hub (AC-80, D-152).\nVITE_COMPARE_PATCHED=off');
    expect(env).not.toMatch(/owner\s+#?\s*says yes/);
  });

  it('(d) package-swaps.json names the test that writes its records, and that file exists', () => {
    const about = (swapsFile as { about: string }).about;
    const named = /written by (\S+\.ts)/.exec(about)?.[1] ?? '';
    expect(named).toBe('tagging-doctor/image-test/swaps.test.ts');
    // Read from the app's own folder, whatever that folder is called (the pisan-labs mirror, a clone; R6.1-6 d).
    expect(fs.existsSync(path.join(__dirname, '..', named.replace(/^tagging-doctor\//, '')))).toBe(true);
  });

  it('(b) leaves a line whose options are shared with a package that stays, and lists it', () => {
    const { p, scan, plan } = setup({ 'main.tex': DOC.replace('\\usepackage[T1]{fontenc}', '\\usepackage[T1]{fontenc,amsmath}').replace('\\usepackage{amsmath}\n', '') });
    expect(card(plan, 'engine')?.changes.map((c) => c.before)).toEqual([['\\usepackage[utf8]{inputenc}']]);
    const item = plan.attention.find((a) => a.title === 'inputenc or fontenc with shared options');
    expect(item).toMatchObject({ where: 'main.tex, line 3' });
    expect(item?.advice).toMatch(/^Remove fontenc from this line by hand/);
    expect(plan.attention.find((a) => a.title.startsWith('fontenc'))?.advice).toBe('Remove fontenc by hand: LuaLaTeX does not need it.');
    expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex')).toContain('\\usepackage[T1]{fontenc,amsmath}');
    // Options for the two removed packages alone are no reason to keep the line.
    const both = setup({ 'main.tex': DOC.replace('\\usepackage[T1]{fontenc}', '\\usepackage[utf8,T1]{inputenc,fontenc}') });
    expect(both.plan.attention.some((a) => a.title === 'inputenc or fontenc with shared options')).toBe(false);
  });
});

describe('Manager’s notes on m4a (acceptance/m4a.md)', () => {
  it('1: a file that is not UTF-8 gives "by hand" advice, not the card’s words', () => {
    const latin1 = new Uint8Array([...strToU8(DOC.replace('Hello', 'Gr')), 0xfc, 0x0a]);
    const { plan } = setup({ 'main.tex': latin1 });
    const advice = plan.attention.map((a) => a.advice ?? '');
    expect(advice).toContain(`Add this line by hand above \\documentclass: ${metadataLine('en-US')}`);
    expect(advice).toContain('Remove inputenc by hand: LuaLaTeX does not need it.');
    expect(advice).toContain('Remove fontenc by hand: LuaLaTeX does not need it.');
  });

  it('2: a card already done says it does nothing', () => {
    const { plan } = setup({ 'main.tex': `\\DocumentMetadata{lang=en}\n${DOC.replace('\\usepackage{amsmath}', '\\usepackage{unicode-math}')}` });
    expect(card(plan, 'metadata')?.what).toBe('Nothing: the document has its own \\DocumentMetadata line.');
    expect(card(plan, 'unicode-math')?.what).toBe('Nothing: the document loads unicode-math.');
  });

  it('3: bm and stmaryrd are named as the status list’s clashes, not as math fonts', () => {
    expect([...UNICODE_MATH_CLASHES].sort()).toEqual(['bm', 'stmaryrd']);
    for (const pkg of ['bm', 'stmaryrd']) {
      expect(MATH_FONT_PACKAGES.has(pkg)).toBe(false);
      const { plan } = setup({ 'main.tex': DOC.replace('\\usepackage{amsmath}', `\\usepackage{amsmath,${pkg}}`) });
      const c = card(plan, 'unicode-math');
      expect(c?.state).toBe('not-needed');
      expect(c?.note).toBe(`Not added: the document loads ${pkg}, which the LaTeX Project’s status list marks “Incompatible with unicode-math”.`);
    }
  });

  it('6: the engine card says to compile with LuaLaTeX, and names a % !TEX program line', () => {
    const plain = card(setup({ 'main.tex': DOC }).plan, 'engine');
    expect(plain?.what).toBe('Removes the inputenc and fontenc packages, which only pdfLaTeX uses. Compile the copy with LuaLaTeX, as the checker does.');
    const magic = card(setup({ 'main.tex': `% !TEX program = pdflatex\n${DOC}` }).plan, 'engine');
    expect(magic?.what).toContain('Line 1 of main.tex, “% !TEX program = pdflatex”, tells your editor to use pdflatex; change it to lualatex.');
    expect(card(setup({ 'main.tex': `% !TEX TS-program = lualatex\n${DOC}` }).plan, 'engine')?.what).not.toContain('tells your editor');
  });
});
