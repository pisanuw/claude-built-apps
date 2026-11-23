/**
 * Milestone 4b: the findings carried from m4a's review (R4a.1-8 a and b,
 * R4a.2-4 g, R4a.3-1 to R4a.3-4) and Manager's two minors at af12111.
 */
import { describe, expect, it } from 'vitest';
import type { CheckerClause, CheckerJob } from '../src/core/compile';
import { CHANGE_WORDS, compareJobs, complete } from '../src/core/compare';
import { applyFixes, unicodeMathPlace } from '../src/core/patch';
import { babelLanguage } from '../src/core/scan';
import { card, defaults, DOC, patchApplies, setup } from './patch-helpers';

const UA2 = 'ISO 14289-2:2024';
const clause = (c: string, n: number, t = 1): CheckerClause => ({ specification: UA2, clause: c, testNumber: t, failedChecks: n, description: `veraPDF says ${c}` });
function done(clauses: CheckerClause[], failedRules = clauses.length): CheckerJob {
  return {
    id: 'a'.repeat(32),
    status: 'done',
    mainFile: 'main.tex',
    createdAt: '2026-11-23T12:00:00.000Z',
    startedAt: '2026-11-23T12:00:01.000Z',
    finishedAt: '2026-11-23T12:00:30.000Z',
    result: {
      pages: 3,
      seconds: 29,
      warnings: 0,
      runs: 2,
      bibliography: null,
      validation: { profile: 'PDF/UA-2', verapdfVersion: 'veraPDF 1.30.4', compliant: clauses.length === 0, failedRules, failedChecks: clauses.reduce((a, c) => a + c.failedChecks, 0), clauses },
      validationError: null,
    },
    failure: null,
    logTail: [],
    pdf: true,
    expiresAt: null,
    note: null,
  };
}
const change = (a: CheckerJob, b: CheckerJob) => Object.fromEntries(compareJobs(a, b).rows.map((r) => [r.clause, r.change]));

describe('R4a.1-8 (b): a clause in both results is "unchanged" only with the same count', () => {
  it('4,668 to 181 is "fewer", 9 to 12 "more", 5 to 5 "unchanged"; fixed and new as before', () => {
    const a = done([clause('8.2.2', 4668), clause('8.4.3', 9), clause('7.1', 5), clause('8.8', 89)]);
    const b = done([clause('8.2.2', 181), clause('8.4.3', 12), clause('7.1', 5), clause('5', 3)]);
    expect(change(a, b)).toEqual({ '8.2.2': 'fewer', '8.4.3': 'more', '7.1': 'unchanged', '8.8': 'fixed', '5': 'new' });
    expect([CHANGE_WORDS.fewer, CHANGE_WORDS.more, CHANGE_WORDS.unchanged]).toEqual(['Fewer', 'More', 'Unchanged']);
  });

  it('adds up the rules of one clause before comparing (two tests of 8.2.2)', () => {
    expect(change(done([clause('8.2.2', 3, 1), clause('8.2.2', 4, 2)]), done([clause('8.2.2', 7, 1)]))['8.2.2']).toBe('unchanged');
  });
});

describe('R4a.1-8 (a): "fixed" and "new" only when the other list is complete', () => {
  // 25 rules failed and the list holds 20: a checker that sent the 20 most frequent, as before m4b.
  const top = Array.from({ length: 20 }, (_, i) => clause(`9.${i}`, 100 - i));
  const cut = done(top, 25);
  it('tells a cut list from a whole one by veraPDF\'s count of failed rules', () => {
    expect(complete(cut)).toBe(false);
    expect(complete(done(top))).toBe(true);
    expect(complete({ ...done(top), status: 'failed', result: null })).toBe(false);
  });

  it('original cut, copy whole: a clause gone from the copy is fixed; one only in the copy, or in both, is not known', () => {
    const copy = done([clause('9.0', 100), clause('1.1', 2)]);
    const c = change(cut, copy);
    expect(c['9.5']).toBe('fixed'); // the copy's list is whole: it does not fail there
    expect(c['1.1']).toBe('unknown'); // may be among the original's 5 rules not listed
    expect(c['9.0']).toBe('unknown'); // the original's count of 9.0 may be short
  });

  it('copy cut, original whole: a clause only in the original is not known, one only in the copy is new', () => {
    const orig = done([clause('9.0', 100), clause('1.1', 2)]);
    const c = change(orig, cut);
    expect(c['1.1']).toBe('unknown'); // may be among the copy's 5 rules not listed
    expect(c['9.5']).toBe('new');
    expect(CHANGE_WORDS.unknown).toMatch(/^Not known/);
  });

  it('math-notes as the hub\'s checker reports it (every rule): eight fixed and 8.2.2 fewer, none not known', () => {
    const orig = done([clause('8.2.2', 4668), clause('8.8', 40), clause('8.9.3.3', 20), clause('6.1', 15), clause('6.2', 15), clause('8.2.1', 10), clause('8.4.4', 7), clause('8.11.1', 6), clause('8.11.2', 4)]);
    const copy = done([clause('8.2.2', 181)]);
    const c = Object.values(change(orig, copy));
    expect(c.filter((x) => x === 'fixed')).toHaveLength(8);
    expect(c.filter((x) => x === 'fewer')).toHaveLength(1);
    expect(c).not.toContain('unknown');
  });
});

describe('R4a.3-1: after a brace left open in the preamble, the unicode-math line goes outside it or not at all', () => {
  const um = (files: Record<string, string>, extra: string[] = []) => {
    const { p, scan, plan } = setup(files);
    const c = card(plan, 'unicode-math');
    const out = () => applyFixes(p, scan, new Set(['unicode-math', ...extra]));
    return { c, out, files };
  };
  const open = (main: string) => um({ 'main.tex': main });

  it.each([
    ['the group starts on an earlier line', '\\documentclass{article}\n\\usepackage{amsmath}\n\\title{A\n  B}{\\begin{document}\nHi\n\\end{document}\n'],
    ['a \\title never closed', '\\documentclass{article}\n\\usepackage{amsmath}\n\\title{T\n\\begin{document}\nHi\n\\end{document}\n'],
    ['everything on one line', '\\documentclass{article}\\title{T}{\\begin{document}\nHi\n\\end{document}\n'],
    ['two groups open', '\\documentclass{article}\n{{\\begin{document}\nHi\n\\end{document}\n'],
  ])('%s: "not needed", with the reason, and the copy has no line', (_label, main) => {
    const t = open(main);
    expect(t.c).toMatchObject({ state: 'not-needed', what: "Nothing: a brace is left open in main.tex's preamble." });
    expect(t.c?.note).toMatch(/never closed/);
    expect(t.out().files.get('main.tex') ?? main).not.toContain('unicode-math');
  });

  it('a removed command that ends on that line, with the engine card: no "overlapping edits", the engine fix still applies', () => {
    const main = '\\documentclass{article}\n\\usepackage[T1]{\n  fontenc}{\\begin{document}\nHi\n\\end{document}\n';
    const t = open(main);
    expect(t.c?.state).toBe('not-needed');
    expect(() => t.out()).not.toThrow();
    expect(() => applyFixes(setup({ 'main.tex': main }).p, setup({ 'main.tex': main }).scan, new Set(['engine', 'unicode-math']))).not.toThrow();
  });

  it('a \\begin{document} inside a definition above the real one: the line goes before the real one, as the scan reads the body', () => {
    const main = '\\documentclass{article}\n\\usepackage{amsmath}\n\\newenvironment{doc}{%\n  \\begin{document}}{\\end{document}}\n{\\begin{document}\nHi\n\\end{document}\n';
    const t = open(main);
    expect(t.c?.state).toBe('ready');
    const out = t.out().files.get('main.tex') as string;
    expect(out).toContain('{%\n  \\begin{document}}');
    expect(out.indexOf('\\usepackage{unicode-math}')).toBeGreaterThan(out.indexOf('\\newenvironment'));
    expect(out).toContain('\\usepackage{unicode-math}\n{\\begin{document}');
    patchApplies(t.files, t.out());
  });

  it('round 2’s case stays: `{\\begin{document}` on a line of its own, the line goes at its start (indent kept)', () => {
    for (const lead of ['', '  ']) {
      const t = open(`\\documentclass{article}\n\\usepackage{amsmath}\n${lead}{\\begin{document}\nHi\n\\end{document}\n`);
      expect(t.c?.state).toBe('ready');
      expect(t.out().files.get('main.tex')).toContain(`\\usepackage{unicode-math}\n${lead}{\\begin{document}`);
      patchApplies(t.files, t.out());
    }
  });

  it('the top-level cases are as before, and unicodeMathPlace is "no-begin" without one', () => {
    const t = open('\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n');
    expect(t.out().files.get('main.tex')).toContain('\\usepackage{amsmath}\n\\usepackage{unicode-math}\n\\begin{document}');
    expect(unicodeMathPlace('\\documentclass{article}\n')).toBe('no-begin');
    expect(unicodeMathPlace('\\newcommand{\\x}{\\begin{document}}')).toBe('no-begin');
    expect(unicodeMathPlace('a\\begin{document}')).toEqual({ at: 1, begin: 1 });
  });
});

describe('R4a.3-2: a real \\DocumentMetadata outside the main file, told from a mention by where it stands', () => {
  const MAIN = '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n';
  it('a call in a style file read above \\documentclass: "already done", and no second line', () => {
    const files = { 'main.tex': `\\RequirePackage{setup}\n${MAIN}`, 'setup.sty': '\\DocumentMetadata{lang=de,tagging=on}\n' };
    const { p, scan, plan } = setup(files);
    expect(scan.metadataFile).toBe('setup.sty');
    expect(card(plan, 'metadata')).toMatchObject({ state: 'already-done', note: expect.stringContaining('setup.sty') });
    expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex') ?? '').not.toContain('\\DocumentMetadata');
    expect(scan.findings.some((f) => f.rule === 'no-document-metadata')).toBe(false);
    expect(scan.findings.some((f) => f.rule === 'no-language')).toBe(false); // its lang=de counts as set
  });

  it('a call in a file read after \\documentclass: "misplaced" for that file, and the card off', () => {
    const files = { 'main.tex': '\\documentclass{article}\n\\input{meta}\n\\begin{document}\nHi\n\\end{document}\n', 'meta.tex': '\\DocumentMetadata{lang=en-US,tagging=on}\n' };
    const { p, scan, plan } = setup(files);
    const f = scan.findings.find((x) => x.rule === 'misplaced-document-metadata');
    expect(f).toMatchObject({ path: 'meta.tex', line: 1 });
    expect(card(plan, 'metadata')?.state).toBe('already-done');
    expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex') ?? '').not.toContain('\\DocumentMetadata');
    // The same in a style file loaded after the class.
    const sty = setup({ 'main.tex': '\\documentclass{article}\n\\usepackage{late}\n\\begin{document}\nHi\n\\end{document}\n', 'late.sty': '\\DocumentMetadata{tagging=on}\n' });
    expect(sty.scan.findings.find((x) => x.rule === 'misplaced-document-metadata')).toMatchObject({ path: 'late.sty' });
  });

  it.each([
    ['compat.sty with \\providecommand', { 'main.tex': '\\documentclass{article}\n\\usepackage{compat}\n\\begin{document}\nHi\n\\end{document}\n', 'compat.sty': '\\providecommand\\DocumentMetadata[1]{}\n' }],
    ['compat.sty above the class, with \\providecommand', { 'main.tex': '\\RequirePackage{compat}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'compat.sty': '\\providecommand\\DocumentMetadata[1]{}\n\\ifdefined\\DocumentMetadata\\relax\\fi\n\\let\\OldDM\\DocumentMetadata\n\\newcommand*{\\DocumentMetadata}[1]{}\n' }],
    ['course.cls naming it inside a \\newcommand', { 'main.tex': '\\documentclass{course}\n\\begin{document}\nHi\n\\end{document}\n', 'course.cls': '\\LoadClass{article}\n\\newcommand{\\tagginghelp}{Put \\DocumentMetadata{tagging=on} first.}\n' }],
    ['help.tex read in the body', { 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\input{help}\n\\end{document}\n', 'help.tex': 'Put \\DocumentMetadata{tagging=on} first.\n' }],
  ])('round 2’s cases stay: %s leaves the card ready and gives no "misplaced"', (_label, files) => {
    const { scan, plan } = setup(files as Record<string, string>);
    expect(scan.metadataFile).toBeNull();
    expect(card(plan, 'metadata')?.state).toBe('ready');
    expect(scan.findings.some((x) => x.rule === 'misplaced-document-metadata')).toBe(false);
  });

  it('the main file’s own line, before and after the class, is as before', () => {
    expect(setup({ 'main.tex': `\\DocumentMetadata{lang=de,tagging=on}\n${MAIN}` }).scan.metadataFile).toBe('main.tex');
    const after = setup({ 'main.tex': '\\documentclass{article}\n\\DocumentMetadata{tagging=on}\n\\begin{document}\nHi\n\\end{document}\n' });
    expect(after.scan.findings.filter((x) => x.rule === 'misplaced-document-metadata')).toHaveLength(1);
    expect(card(after.plan, 'metadata')?.state).toBe('already-done');
  });
});

describe('R4a.3-3: a date after {babel} is not a language; babel’s own reading of a modifier', () => {
  const babelDoc = (pkg: string, cls = '') => DOC.replace('\\documentclass{article}', `\\documentclass${cls}{article}`).replace('\\usepackage{amsmath}', pkg);
  it.each([['english', 'en'], ['spanish', 'es'], ['british', 'en-GB']])('[%s]{babel}[2020/01/01] gives %s, and the scan looks up no babel-2020/01/01', (lang, tag) => {
    const { p, scan, plan } = setup({ 'main.tex': babelDoc(`\\usepackage[${lang}]{babel}[2020/01/01]`) });
    expect(plan.language.tag).toBe(tag);
    expect(plan.language.unmapped).toBeUndefined();
    expect(scan.findings.some((f) => (f.package ?? '').includes('2020'))).toBe(false);
    expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex')).toContain(`\\DocumentMetadata{lang=${tag},`);
  });

  it('babelLanguage: a date or a number is not a name; the names of round 2 stay', () => {
    expect(['2020/01/01', '3.9', 'spanish', 'spanish.mexico', 'es-tabla'].map(babelLanguage)).toEqual([null, null, 'spanish', 'spanish', null]);
  });

  it('as TeX Live 2026’s babel reads them (on the image): main=spanish.mexico is passed over; a class option spanish.mexico names no language', () => {
    expect(setup({ 'main.tex': babelDoc('\\usepackage[english,main=spanish.mexico]{babel}') }).plan.language).toMatchObject({ tag: 'en' });
    expect(setup({ 'main.tex': babelDoc('\\usepackage[english,main=spanish]{babel}') }).plan.language).toMatchObject({ tag: 'es' });
    const cls = setup({ 'main.tex': babelDoc('\\usepackage{babel}', '[spanish.mexico]') });
    expect(cls.plan.language.tag).toBe('en-US');
    expect(cls.plan.language.unmapped).toBeUndefined();
  });
});

describe('R4a.3-4 (a) to (c): the patch at size, a marked file emptied, two removals on the \\begin{document} line', () => {
  const pairs = (n: number) => `\\documentclass{article}\n${'\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n'.repeat(n)}\\begin{document}\nHi\n\\end{document}\n`;
  const timed = (n: number) => {
    const { p, scan } = setup({ 'main.tex': pairs(n) });
    const t0 = performance.now();
    const r = applyFixes(p, scan, new Set(['engine']));
    return { ms: performance.now() - t0, r };
  };

  it('(a) linear: 32,000 pairs take less than 16 times what 2,000 do (a square would be 256), and 64,000 pairs do not overflow the stack', () => {
    timed(500); // warm up
    const small = timed(2_000).ms;
    const big = timed(32_000);
    expect(big.ms).toBeLessThan(16 * 2 * small + 500);
    expect(big.r.files.get('main.tex')).toBe('\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n');
    expect(() => timed(64_000)).not.toThrow();
  }, 120_000);

  it('(b) a marked part whose every line is removed: the diff gives the zip’s file (the mark alone)', () => {
    const files = {
      'main.tex': '\\documentclass{article}\n\\input{pre}\n\\begin{document}\nHi\n\\end{document}\n',
      'pre.tex': new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('\\usepackage[utf8]{inputenc}\n')]),
    };
    const { p, scan } = setup(files);
    const r = applyFixes(p, scan, new Set(['engine']));
    expect(r.files.get('pre.tex')).toBe('\uFEFF');
    expect(r.diff).toContain('\\ No newline at end of file');
    patchApplies(files, r);
    // The cases of round 2 stay: the first line removed and another kept.
    const two = { ...files, 'pre.tex': new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n')]) };
    const s2 = setup(two);
    patchApplies(two, applyFixes(s2.p, s2.scan, new Set(['engine'])));
  });

  it('(c) inputenc and fontenc both on the \\begin{document} line, with the unicode-math card: no empty line', () => {
    const main = '\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage[utf8]{inputenc}\\usepackage[T1]{fontenc}\\begin{document}\nHi\n\\end{document}\n';
    const files = { 'main.tex': main };
    const { p, scan } = setup(files);
    const r = applyFixes(p, scan, new Set(['engine', 'unicode-math']));
    expect(r.files.get('main.tex')).toBe('\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{unicode-math}\n\\begin{document}\nHi\n\\end{document}\n');
    patchApplies(files, r);
    // Text that stays before them keeps the line break.
    const kept = setup({ 'main.tex': main.replace('\\usepackage[utf8]', 'x\\usepackage[utf8]') });
    expect(applyFixes(kept.p, kept.scan, new Set(['engine', 'unicode-math'])).files.get('main.tex')).toContain('x\n\\usepackage{unicode-math}\n\\begin{document}');
  });
});

describe('Manager’s minors at af12111', () => {
  it('1: the scan does not say the patch adds what it will not (a main file not in UTF-8; a \\DocumentMetadata without lang= in meta.tex)', () => {
    const latin1 = new Uint8Array([...new TextEncoder().encode('\\documentclass{article}\n\\usepackage[latin1]{inputenc}\n\\begin{document}\nCaf'), 0xe9, ...new TextEncoder().encode('\n\\end{document}\n')]);
    const a = setup({ 'main.tex': latin1 });
    const meta = a.scan.findings.find((f) => f.rule === 'no-document-metadata');
    expect(meta?.message).toBe('There is no \\DocumentMetadata line, which switches tagging on.');
    expect(meta?.fix?.name).toBe('Add \\DocumentMetadata by hand');
    expect(a.scan.findings.find((f) => f.rule === 'no-language')?.fix?.name).toBe('Set the language by hand');
    expect(JSON.stringify(a.scan.findings)).not.toMatch(/added by the patch/i);
    const b = setup({ 'main.tex': '\\input{meta}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', 'meta.tex': '\\DocumentMetadata{tagging=on}\n' });
    const lang = b.scan.findings.find((f) => f.rule === 'no-language');
    expect(lang?.fix).toEqual({ name: 'Set the language by hand', detail: expect.stringContaining('in meta.tex; the patch leaves that line alone') });
    // What the patch does add keeps its words.
    const c = setup({ 'main.tex': '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n' });
    expect(c.scan.findings.find((f) => f.rule === 'no-document-metadata')?.fix?.name).toBe('Add \\DocumentMetadata (added by the patch)');
    expect(c.scan.findings.find((f) => f.rule === 'no-language')?.fix?.name).toBe('Set the language (added by the patch)');
  });

  it('2: the % !TEX program hint is on the metadata card when there is no engine card, and only on the engine card when there is one', () => {
    const noEngine = setup({ 'main.tex': '% !TEX program = pdflatex\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n' });
    expect(card(noEngine.plan, 'engine')).toBeUndefined();
    expect(card(noEngine.plan, 'metadata')?.what).toContain('Compile the copy with LuaLaTeX. Line 1 of main.tex, “% !TEX program = pdflatex”, tells your editor to use pdflatex; change it to lualatex.');
    const withEngine = setup({ 'main.tex': `% !TEX program = pdflatex\n${DOC}` });
    expect(card(withEngine.plan, 'engine')?.what).toContain('change it to lualatex');
    expect(card(withEngine.plan, 'metadata')?.what).not.toContain('change it to lualatex');
    expect(card(setup({ 'main.tex': '% !TEX program = lualatex\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n' }).plan, 'metadata')?.what).not.toContain('lualatex');
  });
});

describe('AC-42 at m4b\'s acceptance: a side with no check names why, and the right cases keep their words', () => {
  const orig = done([clause('8.2.2', 4668), clause('6.1', 1)]);
  const noPdf: CheckerJob = { ...done([]), status: 'failed', result: null, pdf: false, failure: { kind: 'compile-error', message: 'LuaLaTeX stopped with an error.', error: null } };
  const noCheck: CheckerJob = { ...done([]), result: { ...(done([]).result as NonNullable<CheckerJob['result']>), validation: null } };
  const words = (a: CheckerJob, b: CheckerJob) => compareJobs(a, b).rows.map((r) => [r.clause, r.change, r.changeText]);
  it('the patched copy did not compile, or the original did not, or a PDF was not checked', () => {
    expect(words(orig, noPdf)).toEqual([
      ['8.2.2', 'not-checked', 'Not checked: the patched copy did not compile'],
      ['6.1', 'not-checked', 'Not checked: the patched copy did not compile'],
    ]);
    expect(words(noPdf, done([clause('8.2.2', 3)]))).toEqual([['8.2.2', 'not-checked', 'Not checked: the original did not compile']]);
    expect(words(orig, noCheck)[0]).toEqual(['8.2.2', 'not-checked', 'Not checked: the patched copy’s PDF could not be checked']);
  });

  it('beside them, as before: two whole lists give Fewer and Fixed; a really cut list gives "Not known"', () => {
    expect(words(orig, done([clause('8.2.2', 181)]))).toEqual([
      ['8.2.2', 'fewer', 'Fewer'],
      ['6.1', 'fixed', 'Fixed'],
    ]);
    const cut = done(Array.from({ length: 20 }, (_, i) => clause(`9.${i}`, 100 - i)), 25);
    expect(words(cut, done([clause('1.1', 2)]))).toContainEqual(['1.1', 'unknown', 'Not known: not in the list of the most frequent']);
  });
});
