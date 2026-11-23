/**
 * Milestone 4's patch engine (src/core/patch.ts): the fix cards (AC-37), the
 * \DocumentMetadata line (AC-38), the engine fix (AC-39), the swap table
 * (AC-40), the patched zip and its diff (AC-41), "Needs your attention" and
 * byte-identical output (AC-44), and unicode-math (AC-66).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { openProject, type Project } from '../src/core/project';
import { scanDocument } from '../src/core/scan';
import {
  applyFixes,
  DIFF_NAME,
  documentLanguage,
  MATH_FONT_PACKAGES,
  metadataLine,
  offeredSwap,
  patchedZip,
  patchedZipName,
  suggestFixes,
  SWAPS,
  swapAdvice,
  validLanguage,
  type SwapRecord,
} from '../src/core/patch';
import swapsFile from '../src/data/package-swaps.json';
import data from '../src/data/tagging-status.json';
import { statusIndex } from './helpers';

const index = statusIndex();
const MATH_NOTES = fs.readFileSync(path.join(__dirname, '..', '..', 'tagging-doctor-worker', 'fixtures', 'math-notes', 'main.tex'));

function project(files: Record<string, string | Uint8Array>, name = 'p.zip'): Project {
  const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [typeof v === 'string' ? strToU8(v) : v, { mtime: new Date(1980, 0, 1) }]])));
  return openProject(name, z);
}

function setup(files: Record<string, string | Uint8Array>, main = 'main.tex') {
  const p = project(files);
  const scan = scanDocument(p, main, index);
  return { p, scan, plan: suggestFixes(p, scan) };
}

const DOC = '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath}\n\\title{T}\n\\begin{document}\nHello $x$.\n\\end{document}\n';

/** A swap table whose `here` entry passed and `footnote` entry failed. */
const TABLE = [
  { from: 'here', to: 'float', why: 'here only loads float.', fixture: 'x', record: { date: '2026-11-23', before: { compiled: true, failedChecks: 10 }, after: { compiled: true, failedChecks: 10 }, passed: true } },
  { from: 'footnote', to: 'footnotehyper', why: 'w', fixture: 'y', record: { date: '2026-11-23', before: { compiled: true, failedChecks: 10 }, after: { compiled: true, failedChecks: 12 }, passed: false } },
  { from: 'tabu', to: null, advice: 'Rewrite the tables by hand.' },
];

describe('AC-38: the \\DocumentMetadata line', () => {
  it('pins the line the tagging documentation gives for LuaLaTeX and PDF/UA-2, math setting included', () => {
    expect(metadataLine('en-US')).toBe('\\DocumentMetadata{lang=en-US, pdfstandard=ua-2, tagging=on, tagging-setup={math/setup=mathml-SE}}');
  });

  it('is put before \\documentclass, above any code but below leading comments, with en-US by default', () => {
    const { p, scan, plan } = setup({ 'main.tex': `% !TEX program = lualatex\n\n${DOC}` });
    const card = plan.cards.find((c) => c.id === 'metadata');
    expect(card).toMatchObject({ state: 'ready', acceptedByDefault: true });
    expect(card?.changes).toEqual([{ path: 'main.tex', line: 3, before: ['\\documentclass{article}'], after: [metadataLine('en-US'), '\\documentclass{article}'] }]);
    const out = applyFixes(p, scan, new Set(['metadata'])).files.get('main.tex') as string;
    expect(out.split('\n').slice(0, 4)).toEqual(['% !TEX program = lualatex', '', metadataLine('en-US'), '\\documentclass{article}']);
  });

  it('goes above a \\RequirePackage that comes before \\documentclass', () => {
    const { p, scan } = setup({ 'main.tex': `\\RequirePackage{fix-cm}\n${DOC}` });
    const out = applyFixes(p, scan, new Set(['metadata'])).files.get('main.tex') as string;
    expect(out.startsWith(`${metadataLine('en-US')}\n\\RequirePackage{fix-cm}\n\\documentclass`)).toBe(true);
  });

  it('takes the language from babel, polyglossia or \\babelprovide, or from the person', () => {
    const lang = (pre: string) => {
      const p = project({ 'main.tex': `\\documentclass${pre}\n\\begin{document}x\\end{document}` });
      return documentLanguage(p, scanDocument(p, 'main.tex', index));
    };
    expect(lang('{article}\n\\usepackage[ngerman]{babel}').tag).toBe('de');
    expect(lang('{article}\n\\usepackage[french,english]{babel}')).toMatchObject({ tag: 'en', from: 'from babel’s main language, english' });
    expect(lang('{article}\n\\usepackage[english,main=french]{babel}').tag).toBe('fr');
    expect(lang('[12pt,british]{article}\n\\usepackage{babel}').tag).toBe('en-GB');
    expect(lang('{article}\n\\usepackage[USenglish]{babel}').tag).toBe('en-US');
    expect(lang('{article}\n\\usepackage{polyglossia}\n\\setdefaultlanguage[variant=british]{english}').tag).toBe('en-GB');
    expect(lang('{article}\n\\usepackage{polyglossia}\n\\setmainlanguage{spanish}').tag).toBe('es');
    expect(lang('{article}\n\\usepackage{babel}\n\\babelprovide[main,import]{italian}').tag).toBe('it');
    expect(lang('{article}\n\\usepackage[klingon]{babel}')).toMatchObject({ tag: 'en-US', unmapped: 'klingon' });
    expect(lang('{article}')).toMatchObject({ tag: 'en-US', from: 'the default, because the document sets no language' });
    // From a style file of the project, as the scan reads it.
    const p = project({ 'main.tex': '\\documentclass{article}\\usepackage{course}\\begin{document}x\\end{document}', 'course.sty': '\\RequirePackage[spanish]{babel}' });
    expect(documentLanguage(p, scanDocument(p, 'main.tex', index)).tag).toBe('es');
    // The person's choice wins; a malformed one is ignored.
    const q = project({ 'main.tex': DOC });
    const s = scanDocument(q, 'main.tex', index);
    expect(suggestFixes(q, s, { language: 'de-CH' }).cards[0].changes[0].after[0]).toBe(metadataLine('de-CH'));
    expect(suggestFixes(q, s, { language: 'de"}x' }).cards[0].changes[0].after[0]).toBe(metadataLine('en-US'));
    expect(validLanguage('zh-Hant')).toBe(true);
    expect(validLanguage('en US')).toBe(false);
  });

  it('leaves a present line alone, and the card says "already done"', () => {
    const { p, scan, plan } = setup({ 'main.tex': `\\DocumentMetadata{lang=fr}\n${DOC}` });
    const card = plan.cards[0];
    expect(card).toMatchObject({ id: 'metadata', state: 'already-done', changes: [] });
    expect(card.note).toMatch(/^Already done/);
    expect(applyFixes(p, scan, new Set(['metadata'])).files.size).toBe(0);
  });
});

describe('AC-39: the engine fix', () => {
  it('removes inputenc and fontenc, whole lines where they stand alone, in the main file and the files it reads', () => {
    const { p, scan, plan } = setup({
      'main.tex': '\\documentclass{article}\n\\usepackage[utf8]{inputenc} % for pdflatex\n\\usepackage{inputenc,amsmath}\n\\usepackage{course}\n\\input{ch1}\n\\begin{document}x\\end{document}\n',
      'course.sty': '\\RequirePackage[T1]{fontenc}\n\\RequirePackage{xcolor}\n',
      'ch1.tex': 'Text \\usepackage[T1]{fontenc} after text\n',
    });
    const card = plan.cards.find((c) => c.id === 'engine');
    expect(card).toMatchObject({ acceptedByDefault: true, state: 'ready' });
    expect(card?.changes.map((c) => [c.path, c.line, c.before, c.after])).toEqual([
      ['main.tex', 2, ['\\usepackage[utf8]{inputenc} % for pdflatex', '\\usepackage{inputenc,amsmath}'], ['\\usepackage{amsmath}']],
      ['course.sty', 1, ['\\RequirePackage[T1]{fontenc}'], []],
      ['ch1.tex', 1, ['Text \\usepackage[T1]{fontenc} after text'], ['Text  after text']],
    ]);
    const r = applyFixes(p, scan, new Set(['engine']));
    expect(r.files.get('main.tex')).toBe('\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{course}\n\\input{ch1}\n\\begin{document}x\\end{document}\n');
    expect(r.files.get('course.sty')).toBe('\\RequirePackage{xcolor}\n');
    // The scan of the patched copy finds neither package.
    const after = openProject('x.zip', patchedZip(p, r));
    expect(scanDocument(after, 'main.tex', index).findings.filter((f) => f.rule === 'pdftex-only')).toEqual([]);
  });

  it('has no card when neither package is loaded', () => {
    const { plan } = setup({ 'main.tex': '\\documentclass{article}\\begin{document}x\\end{document}' });
    expect(plan.cards.map((c) => c.id)).toEqual(['metadata', 'unicode-math']);
  });

  it('leaves a file that is not UTF-8 alone, and lists it under "Needs your attention"', () => {
    const latin1 = new Uint8Array([...strToU8('\\documentclass{article}\n\\usepackage[latin1]{inputenc}\n\\begin{document}Caf'), 0xe9, ...strToU8('\n\\end{document}\n')]);
    const { p, scan, plan } = setup({ 'main.tex': latin1 });
    expect(plan.cards.find((c) => c.id === 'engine')).toBeUndefined();
    expect(plan.cards[0]).toMatchObject({ id: 'metadata', state: 'not-needed' });
    expect(plan.attention.map((a) => a.title)).toContain('Not saved as UTF-8');
    expect(plan.attention.some((a) => a.title.startsWith('inputenc') || a.message.includes('inputenc'))).toBe(true);
    const r = applyFixes(p, scan, new Set(plan.cards.map((c) => c.id)));
    expect(r.files.size).toBe(0);
    // The zip keeps the file's own bytes.
    expect(unzipSync(patchedZip(p, r))['main.tex']).toEqual(latin1);
  });
});

describe('AC-40: package swaps', () => {
  it('every entry names a fixture and, when it has a record, a whole one; only passing records are offered', () => {
    for (const e of swapsFile.entries) {
      expect(typeof e.from).toBe('string');
      if (e.to === null) {
        expect('advice' in e && typeof e.advice === 'string' && e.advice.length > 20).toBe(true);
        continue;
      }
      // A replacement the pinned data lists as compatible, and a fixture project that exists.
      const target = data.entries.find((x) => x.name === e.to);
      expect(target?.status, e.to).toBe('compatible');
      expect('fixture' in e && fs.existsSync(path.join(__dirname, '..', '..', String(e.fixture), 'main.tex')), String(e.from)).toBe(true);
      const rec = ('record' in e ? e.record : null) as SwapRecord | null;
      if (rec) {
        expect(rec).toMatchObject({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), before: { compiled: expect.any(Boolean) }, after: { compiled: expect.any(Boolean) } });
        const pass = rec.after.compiled && (!rec.before.compiled || (rec.after.failedChecks ?? Infinity) <= (rec.before.failedChecks ?? Infinity));
        expect(rec.passed, String(e.from)).toBe(pass);
      }
      expect(!!offeredSwap(e.from)).toBe(rec?.passed === true);
    }
    expect(offeredSwap('here', TABLE)).toMatchObject({ to: 'float' });
    expect(offeredSwap('footnote', TABLE)).toBeNull();
    expect(swapAdvice('footnote', TABLE)).toMatch(/^No tested replacement yet: footnotehyper has no passing record/);
    expect(swapAdvice('tabu', TABLE)).toBe('Rewrite the tables by hand.');
    expect(swapAdvice('here', TABLE)).toBeNull();
    expect(swapAdvice('nothere', TABLE)).toBeNull();
    expect(SWAPS.length).toBe(swapsFile.entries.length);
  });

  it('offers a passing swap as a card skipped by default, keeping the options; a failing one is "no tested replacement"', () => {
    const files = { 'main.tex': '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{here,fontenc}\n\\usepackage{footnote}\n\\usepackage{tabu}\n\\begin{document}x\\end{document}\n' };
    const p = project(files);
    const scan = scanDocument(p, 'main.tex', index);
    const plan = suggestFixes(p, scan, {}, TABLE);
    expect(plan.cards.map((c) => [c.id, c.acceptedByDefault])).toEqual([['metadata', true], ['engine', true], ['swap:here', false], ['unicode-math', false]]);
    expect(plan.cards[2].changes).toEqual([{ path: 'main.tex', line: 3, before: ['\\usepackage{here,fontenc}'], after: ['\\usepackage{float,fontenc}'] }]);
    // The engine fix and the swap on one line: both apply.
    const both = applyFixes(p, scan, new Set(['engine', 'swap:here']), {}, TABLE).files.get('main.tex');
    expect(both).toBe('\\documentclass{article}\n\\usepackage{float}\n\\usepackage{footnote}\n\\usepackage{tabu}\n\\begin{document}x\\end{document}\n');
    const att = plan.attention.map((a) => `${a.title}: ${a.advice}`);
    expect(att.find((a) => a.startsWith('footnote'))).toMatch(/No tested replacement\. No tested replacement yet: footnotehyper/);
    expect(att.find((a) => a.startsWith('tabu'))).toMatch(/No tested replacement\. Rewrite the tables by hand\./);
    expect(att.some((a) => a.startsWith('here'))).toBe(false);
    // With options: kept.
    const q = project({ 'main.tex': '\\documentclass{article}\n\\usepackage[x]{here}\n\\begin{document}x\\end{document}' });
    expect(suggestFixes(q, scanDocument(q, 'main.tex', index), {}, TABLE).cards[1].changes[0].after).toEqual(['\\usepackage[x]{float}']);
  });
});

describe('AC-66: unicode-math', () => {
  it('is its own card, skipped by default, and adds the package as the last line of the preamble', () => {
    const { p, scan, plan } = setup({ 'main.tex': DOC });
    const card = plan.cards.find((c) => c.id === 'unicode-math');
    expect(card).toMatchObject({ acceptedByDefault: false, state: 'ready' });
    expect(card?.changes[0]).toEqual({ path: 'main.tex', line: 6, before: ['\\begin{document}'], after: ['\\usepackage{unicode-math}', '\\begin{document}'] });
    expect(applyFixes(p, scan, new Set(['unicode-math'])).files.get('main.tex')).toContain('\\title{T}\n\\usepackage{unicode-math}\n\\begin{document}');
  });

  it('adds nothing where the document sets a math font package, and says which', () => {
    for (const pkg of ['mathptmx', 'newtxmath', 'fourier', 'bm']) {
      expect(MATH_FONT_PACKAGES.has(pkg)).toBe(true);
      const { p, scan, plan } = setup({ 'main.tex': DOC.replace('\\usepackage{amsmath}', `\\usepackage{amsmath,${pkg}}`) });
      const card = plan.cards.find((c) => c.id === 'unicode-math');
      expect(card).toMatchObject({ state: 'not-needed', changes: [] });
      expect(card?.note).toContain(pkg);
      expect(applyFixes(p, scan, new Set(['unicode-math'])).files.size).toBe(0);
    }
    const done = setup({ 'main.tex': DOC.replace('\\usepackage{amsmath}', '\\usepackage{unicode-math}') }).plan.cards.find((c) => c.id === 'unicode-math');
    expect(done).toMatchObject({ state: 'already-done' });
    const noBegin = setup({ 'main.tex': '\\documentclass{article}\n\\input{body}\n', 'body.tex': '\\begin{document}x\\end{document}' }).plan.cards.find((c) => c.id === 'unicode-math');
    expect(noBegin).toMatchObject({ state: 'not-needed' });
  });
});

describe('AC-41: the patched zip and the diff', () => {
  const files = {
    'main.tex': DOC,
    'figures/a.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    'notes.docx': 'not sent to the checker, but kept in the zip',
    'grades.csv': 'Ann,90',
    'STAT201/grades/x.tex': 'secret',
  };

  it('holds the whole project but the student records, with the accepted changes and tagging-doctor.diff', () => {
    const { p, scan, plan } = setup(files);
    const before = new Uint8Array(p.bytes('main.tex'));
    const accepted = new Set(plan.cards.filter((c) => c.acceptedByDefault).map((c) => c.id));
    const r = applyFixes(p, scan, accepted);
    const z = unzipSync(patchedZip(p, r));
    expect(Object.keys(z).sort()).toEqual(['figures/a.png', 'main.tex', 'notes.docx', DIFF_NAME].sort());
    expect(strFromU8(z['main.tex'])).toBe(`${metadataLine('en-US')}\n\\documentclass{article}\n\\usepackage{amsmath}\n\\title{T}\n\\begin{document}\nHello $x$.\n\\end{document}\n`);
    expect(z['figures/a.png']).toEqual(files['figures/a.png']);
    expect(strFromU8(z[DIFF_NAME])).toBe(r.diff);
    expect(r.applied).toEqual(['metadata', 'engine']);
    // The upload itself is unchanged.
    expect(p.bytes('main.tex')).toEqual(before);
    expect(p.leftOut.sort()).toEqual(['STAT201/grades/x.tex', 'grades.csv']);
  });

  it('changes nothing for fixes not accepted', () => {
    const { p, scan } = setup(files);
    const r = applyFixes(p, scan, new Set());
    expect(r.files.size).toBe(0);
    expect(r.diff).toMatch(/# No changes: no fix was accepted\.\n$/);
    const z = unzipSync(patchedZip(p, r));
    expect(strFromU8(z['main.tex'])).toBe(DOC);
    // A card that is not ready changes nothing even when its id is accepted.
    const q = setup({ 'main.tex': `\\DocumentMetadata{lang=fr}\n${DOC}` });
    expect(applyFixes(q.p, q.scan, new Set(['metadata'])).applied).toEqual([]);
  });

  it('writes a unified diff that patch applies to the original, CRLF and a missing last newline included', () => {
    const cases: Record<string, string>[] = [
      { 'main.tex': DOC },
      { 'main.tex': '% top\r\n\\documentclass{article}\r\n\\usepackage[utf8]{inputenc}\r\n\\input{sub/x}\r\n\\begin{document}\r\nx\r\n\\end{document}', 'sub/x.tex': '\\usepackage[T1]{fontenc}' },
      { 'main.tex': `\\RequirePackage[T1]{fontenc}\n\\documentclass{article}\n${'a\n'.repeat(12)}\\usepackage{inputenc,amsmath}\n\\begin{document}\nx\n\\end{document}\n` },
    ];
    let hasPatch = true;
    try {
      execFileSync('patch', ['--version'], { stdio: 'ignore' });
    } catch {
      hasPatch = false;
    }
    for (const files of cases) {
      const { p, scan, plan } = setup(files);
      const r = applyFixes(p, scan, new Set(plan.cards.map((c) => c.id)));
      expect(r.diff.startsWith('# Tagging Doctor')).toBe(true);
      if (!hasPatch) continue;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-patch-'));
      for (const [k, v] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
        fs.writeFileSync(path.join(dir, k), v);
      }
      fs.writeFileSync(path.join(dir, '..', `${path.basename(dir)}.diff`), r.diff);
      execFileSync('patch', ['-p1', '-s', '-i', path.join(dir, '..', `${path.basename(dir)}.diff`)], { cwd: dir });
      for (const [k, v] of r.files) expect(fs.readFileSync(path.join(dir, k), 'utf8'), k).toBe(v);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // The second case's hunks, exactly.
    const crlf = setup(cases[1]);
    expect(applyFixes(crlf.p, crlf.scan, new Set(['metadata', 'engine'])).diff).toBe(
      '# Tagging Doctor: the changes in this copy. To make them in your own copy: patch -p1 < tagging-doctor.diff\n' +
        '--- a/main.tex\n+++ b/main.tex\n@@ -1,6 +1,6 @@\n % top\r\n+' + metadataLine('en-US') + '\r\n \\documentclass{article}\r\n-\\usepackage[utf8]{inputenc}\r\n \\input{sub/x}\r\n \\begin{document}\r\n x\r\n' +
        '--- a/sub/x.tex\n+++ b/sub/x.tex\n@@ -1,1 +0,0 @@\n-\\usepackage[T1]{fontenc}\n\\ No newline at end of file\n',
    );
  });

  it('keeps a byte order mark', () => {
    const { p, scan } = setup({ 'main.tex': new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(DOC)]) });
    const z = unzipSync(patchedZip(p, applyFixes(p, scan, new Set(['metadata']))));
    expect([...z['main.tex'].subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(z['main.tex'].subarray(3)).startsWith(metadataLine('en-US'))).toBe(true);
  });

  it('names the zip after the dropped file', () => {
    expect(patchedZipName('calc1-hw1.zip')).toBe('calc1-hw1-patched.zip');
    expect(patchedZipName('notes.tex')).toBe('notes-patched.zip');
    expect(patchedZipName('C:\\x\\a.ZIP')).toBe('a-patched.zip');
    expect(patchedZipName('.zip')).toBe('project-patched.zip');
  });
});

describe('AC-44: the same input gives the same bytes; what the patch cannot fix stays listed', () => {
  it('applies the same fixes to the same scan twice with byte-identical output', () => {
    const files = { 'main.tex': MATH_NOTES, 'figures/damped.png': new Uint8Array([1, 2, 3]) };
    const a = setup(files);
    const b = setup(files);
    const ids = new Set(a.plan.cards.map((c) => c.id));
    const za = patchedZip(a.p, applyFixes(a.p, a.scan, ids));
    const zb = patchedZip(b.p, applyFixes(b.p, b.scan, ids));
    expect(za).toEqual(zb);
    // And on the same Project object.
    expect(patchedZip(a.p, applyFixes(a.p, a.scan, ids))).toEqual(za);
  });

  it('keeps Beamer, unknown packages, a blocking class and other findings under "Needs your attention"', () => {
    const { plan } = setup({ 'main.tex': '\\documentclass{beamer}\n\\usepackage{nosuchpackage-xyz}\n\\usepackage{tabu}\n\\DocumentMetadata{lang=en}\n\\begin{document}x\\end{document}' });
    const titles = plan.attention.map((a) => a.title);
    expect(titles).toContain('Beamer');
    expect(titles).toContain('nosuchpackage-xyz');
    expect(titles.some((t) => t.startsWith('tabu'))).toBe(true);
    expect(titles).toContain('Move \\DocumentMetadata above \\documentclass');
    expect(plan.attention.find((a) => a.title === 'Beamer')?.advice).toContain('Beamer migration is not covered by this version.');
    expect(plan.attention.find((a) => a.title === 'nosuchpackage-xyz')?.advice).toMatch(/^No tested replacement\. Check nosuchpackage-xyz by hand/);
    const exam = setup({ 'main.tex': '\\documentclass{exam}\n\\begin{document}x\\end{document}' }).plan;
    expect(exam.attention.find((a) => a.title.startsWith('exam'))?.advice).toMatch(/Keep exam for now/);
    // The metadata and language findings are fixed by the card, so they are not listed.
    expect(exam.attention.some((a) => /DocumentMetadata|language/.test(a.message))).toBe(false);
    expect(exam.attention.some((a) => a.title === 'Add a \\title')).toBe(true);
  });

  it('lists every finding of the scan that is not ok and no card fixes', () => {
    const { scan, plan } = setup({ 'main.tex': MATH_NOTES });
    const fixed = new Set(['no-document-metadata', 'no-language', 'pdftex-only']);
    const open = scan.findings.filter((f) => f.severity !== 'ok' && !fixed.has(f.rule));
    expect(plan.attention.length).toBe(open.length);
    expect(plan.attention.map((a) => a.where)).toEqual(open.map((f) => `${f.path}, line ${f.line}`));
  });
});
