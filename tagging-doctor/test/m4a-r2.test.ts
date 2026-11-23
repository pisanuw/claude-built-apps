/**
 * Milestone 4a, review round 2: R4a.2-1 to R4a.2-4 and Manager's minors at
 * 758efdb (acceptance/m4a.md, "Verdict again at 758efdb"). Each new case sits
 * beside inputs the code got right before, since R4a.2-1 came from a fix
 * (knowledge/README.md, 2026-11-20).
 */
import fs from 'node:fs';
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { plainTexError, PGF_TABLE_CUT } from '../src/core/compile';
import { applyFixes, metadataLine, suggestFixes } from '../src/core/patch';
import { babelLanguage, scanDocument } from '../src/core/scan';
import { card, defaults, DOC, index, patchApplies, project, setup } from './patch-helpers';

const babelDoc = (opts: string, cls = '') => DOC.replace('\\documentclass{article}', `\\documentclass${cls}{article}`).replace('\\usepackage{amsmath}', `\\usepackage[${opts}]{babel}`);

describe('R4a.2-1: a babel option that is not a language is not the main language', () => {
  it.each([['spanish,es-tabla'], ['spanish,mexico'], ['english,spanish,es-noshorthands'], ['spanish,es-nodecimaldot'], ['spanish.mexico'], ['english,spanish.notilde.lcroman'], ['spanish,mexico-com,es-tabla']])(
    'babel [%s] is Spanish',
    (opts) => {
      const { p, scan, plan } = setup({ 'main.tex': babelDoc(opts) });
      expect(plan.language).toMatchObject({ tag: 'es', from: 'from babel’s main language, spanish' });
      expect(plan.language.unmapped).toBeUndefined();
      expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex')).toContain('\\DocumentMetadata{lang=es,');
    },
  );

  it('the class option spanish with babel es-tabla is Spanish', () => {
    expect(setup({ 'main.tex': babelDoc('es-tabla', '[spanish]') }).plan.language).toMatchObject({ tag: 'es' });
  });

  it('keeps what was right before: languages, main=, flags, the class’s options, and the prompt for an unknown name', () => {
    const lang = (opts: string, cls = '') => setup({ 'main.tex': babelDoc(opts, cls) }).plan.language;
    expect(lang('british')).toMatchObject({ tag: 'en-GB' });
    expect(lang('ngerman,main=english')).toMatchObject({ tag: 'en' });
    expect(lang('', '[french]')).toMatchObject({ tag: 'fr' });
    expect(lang('british,activeacute')).toMatchObject({ tag: 'en-GB' });
    expect(lang('british', '[a4paper]')).toMatchObject({ tag: 'en-GB' });
    expect(lang('klingon')).toMatchObject({ tag: 'en-US', unmapped: 'klingon' });
    expect(lang('english,esperanto')).toMatchObject({ tag: 'en-US', unmapped: 'esperanto' });
    expect(lang('spanish,english')).toMatchObject({ tag: 'en' });
  });

  it('babelLanguage: a language, its modifier dropped; null for an option', () => {
    expect(['spanish', 'spanish.mexico', ' english ', 'es-tabla', 'ES-Tabla', 'mexico', 'mexico-com', 'activeacute', 'KeepShorthandsActive', 'main=english', '', 'provide*'].map(babelLanguage)).toEqual([
      'spanish',
      'spanish',
      'english',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('Manager’s minor 4: the scan looks up babel’s languages only, not its flags or babel-spanish’s options', () => {
    const p = project({ 'main.tex': babelDoc('british,activeacute,spanish.mexico,es-tabla') });
    const scan = scanDocument(p, 'main.tex', index);
    const named = scan.findings.map((f) => f.package ?? '').filter((n) => n.startsWith('babel-'));
    expect(named).toEqual(expect.arrayContaining(['babel-british', 'babel-spanish']));
    expect(named.filter((n) => /activeacute|es-tabla|mexico/.test(n))).toEqual([]);
    expect(scan.findings.some((f) => f.rule === 'no-language')).toBe(false);
    // babel with no language at all: the language is not set.
    const none = scanDocument(project({ 'main.tex': babelDoc('activeacute') }), 'main.tex', index);
    expect(none.findings.some((f) => f.rule === 'no-language')).toBe(true);
  });
});

describe('R4a.2-2: a marked file whose first line is removed', () => {
  const marked = (s: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(s)]);

  it('a marked part: the diff gives the zip’s file, LF and CRLF', () => {
    for (const eol of ['\n', '\r\n']) {
      const files = {
        'main.tex': '\\documentclass{article}\n\\input{pre}\n\\begin{document}\nHi\n\\end{document}\n',
        'pre.tex': marked(`\\usepackage[utf8]{inputenc}${eol}\\usepackage{amsmath}${eol}`),
      };
      const { p, scan } = setup(files);
      const r = applyFixes(p, scan, new Set(['engine']));
      expect(r.files.get('pre.tex')).toBe(`\uFEFF\\usepackage{amsmath}${eol}`);
      expect(r.diff).toContain(`\n-\uFEFF\\usepackage[utf8]{inputenc}${eol}-\\usepackage{amsmath}${eol}+\uFEFF\\usepackage{amsmath}${eol}`);
      const dir = patchApplies(files, r);
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a marked main file that starts with \\RequirePackage[utf8]{inputenc}, with the engine card alone and with both', () => {
    const files = { 'main.tex': marked(`\\RequirePackage[utf8]{inputenc}\n${DOC.replace('\\usepackage[utf8]{inputenc}\n', '')}`) };
    const { p, scan } = setup(files);
    for (const ids of [['engine'], ['engine', 'metadata']]) {
      const r = applyFixes(p, scan, new Set(ids));
      const dir = patchApplies(files, r);
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      expect(r.files.get('main.tex')?.startsWith(ids.length > 1 ? `\uFEFF${metadataLine('en-US')}\n\\documentclass` : '\uFEFF\\documentclass')).toBe(true);
    }
  });

  it('keeps round 1’s cases: an insertion on line 1 of a marked file, and a removal in an unmarked one', () => {
    const files = { 'main.tex': marked(DOC), 'b/main.tex': DOC };
    for (const main of ['main.tex', 'b/main.tex']) {
      const { p, scan, plan } = setup(files, main);
      const r = applyFixes(p, scan, defaults(plan));
      const dir = patchApplies(files, r);
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      expect(r.files.get(main)).toContain('\\usepackage{amsmath}\n\\title{T}');
    }
  });
});

describe('R4a.2-3: which \\DocumentMetadata turns tagging on', () => {
  it('(a) an "already done" card comes without advice to add the line by hand, and the scan agrees', () => {
    const { scan, plan } = setup({ 'main.tex': '\\input{meta}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'meta.tex': '\\DocumentMetadata{lang=de, tagging=on}\n' });
    expect(card(plan, 'metadata')).toMatchObject({ state: 'already-done' });
    expect(card(plan, 'metadata')?.note).toContain('meta.tex');
    expect(plan.attention.map((a) => a.advice ?? '').join('\n')).not.toContain('by hand');
    expect(scan.findings.map((f) => f.rule)).not.toEqual(expect.arrayContaining(['no-document-metadata']));
    expect(scan.findings.some((f) => f.rule === 'no-language')).toBe(false);
    expect(scan.metadataFile).toBe('meta.tex');
  });

  it('(a) the line without lang= still asks for the language, in words that fit the line that is there', () => {
    const { plan } = setup({ 'main.tex': '\\input{meta}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'meta.tex': '\\DocumentMetadata{tagging=on}\n' });
    const item = plan.attention.find((a) => a.title === 'Set the language');
    expect(item?.advice).toBe('Set the language by hand, with lang=en-US (or yours) in \\DocumentMetadata.');
    expect(plan.attention.some((a) => a.title.startsWith('Add \\DocumentMetadata'))).toBe(false);
  });

  it('(b) a style or class file, or a file read in the body, does not switch the fix off', () => {
    const cases: Record<string, string>[] = [
      { 'main.tex': '\\documentclass{article}\n\\usepackage{compat}\n\\begin{document}\nHi\n\\end{document}\n', 'compat.sty': '\\providecommand\\DocumentMetadata[1]{}\n' },
      { 'main.tex': '\\documentclass{course}\n\\begin{document}\nHi\n\\end{document}\n', 'course.cls': '\\LoadClass{article}\n\\newcommand{\\tagginghelp}{Put \\DocumentMetadata{tagging=on} first.}\n' },
      { 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\input{help}\n\\end{document}\n', 'help.tex': 'Put \\DocumentMetadata{tagging=on} first.\n' },
    ];
    for (const files of cases) {
      const { p, scan, plan } = setup(files);
      expect(card(plan, 'metadata')?.state, Object.keys(files).join()).toBe('ready');
      expect(scan.metadataFile).toBeNull();
      expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex')?.startsWith(metadataLine('en-US'))).toBe(true);
    }
  });

  it('keeps what was right: the main file’s line, round 1’s preamble.tex, and a comment that does not count', () => {
    expect(card(setup({ 'main.tex': `\\DocumentMetadata{lang=fr}\n${DOC}` }).plan, 'metadata')?.note).toContain('main.tex');
    const pre = setup({ 'main.tex': '\\input{preamble}\n\\begin{document}\nHi\n\\end{document}\n', 'preamble.tex': '\\DocumentMetadata{lang=de}\n\\documentclass{article}\n' });
    expect(card(pre.plan, 'metadata')?.note).toContain('preamble.tex');
    expect(card(setup({ 'main.tex': '\\input{meta}\n\\documentclass{article}\n\\begin{document}x\\end{document}\n', 'meta.tex': '% \\DocumentMetadata{lang=de}\n' }).plan, 'metadata')?.state).toBe('ready');
  });
});

describe('R4a.2-4', () => {
  it('(a) applying the engine fix stays linear in the number of lines', () => {
    const many = (n: number) => `\\documentclass{article}\n${'\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n'.repeat(n)}\\begin{document}x\\end{document}\n`;
    const time = (n: number) => {
      const p = project({ 'main.tex': many(n) });
      const scan = scanDocument(p, 'main.tex', index);
      const t0 = performance.now();
      const r = applyFixes(p, scan, new Set(['engine']));
      const t = performance.now() - t0;
      expect(r.files.get('main.tex')).not.toContain('fontenc');
      return t;
    };
    // A quarter against the whole, as D-55: quadratic time would be 16 times as long.
    time(500);
    const a = time(1000);
    const b = time(4000);
    expect(b).toBeLessThan(8 * a + 300);
  }, 60_000);

  it('(b) an indented \\begin{document} keeps its indent; a line the engine fix empties leaves no empty line', () => {
    const indented = setup({ 'main.tex': '\\documentclass{article}\n\\usepackage{amsmath}\n  \\begin{document}\nx\n\\end{document}\n' });
    expect(card(indented.plan, 'unicode-math')?.changes[0]).toMatchObject({ before: ['  \\begin{document}'], after: ['\\usepackage{unicode-math}', '  \\begin{document}'] });
    const shared = { 'main.tex': '\\documentclass{article}\n\\usepackage[T1]{fontenc}\\begin{document}\nx\n\\end{document}\n' };
    const { p, scan } = setup(shared);
    const both = applyFixes(p, scan, new Set(['engine', 'unicode-math']));
    expect(both.files.get('main.tex')).toBe('\\documentclass{article}\n\\usepackage{unicode-math}\n\\begin{document}\nx\n\\end{document}\n');
    const dir = patchApplies(shared, both);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    // Each card alone, as before.
    expect(applyFixes(p, scan, new Set(['unicode-math'])).files.get('main.tex')).toContain('\\usepackage[T1]{fontenc}\n\\usepackage{unicode-math}\n\\begin{document}');
    expect(applyFixes(p, scan, new Set(['engine'])).files.get('main.tex')).toContain('\\documentclass{article}\n\\begin{document}');
  });

  it('(c) after an unclosed brace, the line goes before the line of the \\begin{document} the scan takes', () => {
    const files = { 'main.tex': '\\documentclass{article}\n\\title{T}\n{\\begin{document}\nHi\n\\end{document}\n' };
    const { p, scan, plan } = setup(files);
    expect(card(plan, 'unicode-math')?.state).toBe('ready');
    const r = applyFixes(p, scan, new Set(['unicode-math']));
    expect(r.files.get('main.tex')).toContain('\\title{T}\n\\usepackage{unicode-math}\n{\\begin{document}');
    const dir = patchApplies(files, r);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    // A \begin{document} only inside a balanced macro is still not taken (D-113).
    expect(card(setup({ 'main.tex': '\\documentclass{article}\n\\newcommand{\\go}{\\begin{document}}\n\\go x\\end{document}\n' }).plan, 'unicode-math')?.state).toBe('not-needed');
  });

  it('(e) a table name with an apostrophe is read whole; a cut one is not named', () => {
    expect(plainTexError("Package pgfplots Error: Could not read table file 'data/o'brien.csv' in 'search path=.'.")).toBe(
      "The checker does not take .csv files, so data/o'brien.csv was not sent; the compile needs it.",
    );
    expect(plainTexError("Package pgfplots Error: Could not read table file 'data/o'brien.cs")).toBe(PGF_TABLE_CUT);
    // As before: R3b.1-5's line, a name with a space, a cut name.
    expect(plainTexError("! Package pgfplots Error: Could not read table file 'data/marks.csv'. File `data/marks.csv' not found.")).toBe(
      'The checker does not take .csv files, so data/marks.csv was not sent; the compile needs it.',
    );
    expect(plainTexError("Package pgfplots Error: Could not read table file 'data/week 1/marks.tex' in 'search path=.'.")).toBe(
      'The table file data/week 1/marks.tex could not be read. Add it to the zip, or check its name.',
    );
    expect(plainTexError("Package pgfplots Error: Could not read table file 'data/marks.cs")).toBe(PGF_TABLE_CUT);
  });
});

describe('Manager’s minors 2 and 3 at 758efdb: a card or an item that does nothing says so', () => {
  it('2: a file that is not UTF-8: no "added by the patch", and the metadata card says Nothing', () => {
    const latin1 = new Uint8Array([...strToU8(DOC.replace('Hello', 'Gr')), 0xfc, 0x0a]);
    const { plan } = setup({ 'main.tex': latin1 });
    const text = plan.attention.map((a) => `${a.title} ${a.message} ${a.advice ?? ''}`).join('\n');
    expect(text).not.toMatch(/added by the patch/i);
    expect(plan.attention.map((a) => a.title)).toEqual(expect.arrayContaining(['Add \\DocumentMetadata', 'Set the language']));
    expect(card(plan, 'metadata')).toMatchObject({ state: 'not-needed', what: 'Nothing: main.tex is not saved as UTF-8.' });
    expect(card(plan, 'unicode-math')).toMatchObject({ state: 'not-needed', what: 'Nothing: main.tex is not saved as UTF-8.' });
  });

  it('3: unicode-math not added says Nothing, with the reason', () => {
    const um = (files: Record<string, string>) => card(setup(files).plan, 'unicode-math');
    expect(um({ 'main.tex': DOC.replace('\\usepackage{amsmath}', '\\usepackage{newtxmath}') })?.what).toBe('Nothing: the document sets its own math font.');
    expect(um({ 'main.tex': DOC.replace('\\usepackage{amsmath}', '\\usepackage{bm}') })?.what).toBe('Nothing: unicode-math does not go with bm.');
    expect(um({ 'main.tex': '\\documentclass{article}\n\\input{body}\n', 'body.tex': '\\begin{document}x\\end{document}' })?.what).toBe('Nothing: \\begin{document} is not in main.tex.');
    // A ready card still says what it adds.
    expect(um({ 'main.tex': DOC })?.what).toBe('Adds \\usepackage{unicode-math} as the last line of the preamble of main.tex.');
    expect(suggestFixes(project({ 'main.tex': DOC }), scanDocument(project({ 'main.tex': DOC }), 'main.tex', index)).cards.map((c) => c.state)).toEqual(['ready', 'ready', 'ready']);
  });
});
