import { describe, expect, it } from 'vitest';
import { CURATED, plainWords, suggestedFix } from '../src/core/fixes';
import { openProject } from '../src/core/project';
import {
  BEAMER_NOTE,
  commentInPlainWords,
  findMainFiles,
  isMainSource,
  OUTSIDE_PROGRAM,
  OUTSIDE_PROJECT,
  scanDocument,
  verdictFor,
  type DocumentScan,
} from '../src/core/scan';
import { findingTitle } from '../src/core/report';
import type { Finding } from '../src/core/scan';
import { rawZip, statusIndex, text, zipFixture } from './helpers';

const idx = statusIndex();

function scanFixture(name: string, main?: string, prefix = ''): DocumentScan {
  const p = openProject(`${name}.zip`, zipFixture(name, prefix));
  const m = main ?? p.paths.find((x) => x.endsWith('.tex') && isMainSource(p.text(x) ?? '')) ?? '';
  return scanDocument(p, m, idx);
}

function scanTex(src: string, name = 'main.tex'): DocumentScan {
  return scanDocument(openProject(name, text(src)), name, idx);
}

const byPkg = (s: DocumentScan, pkg: string, rule = 'package-status') => s.findings.filter((f) => f.package === pkg && f.rule === rule);

describe('AC-1: blockers and a warning, each with file, line, comment and a named fix', () => {
  it('lists tabu and caption as blockers and titlesec as a warning, within 3 seconds', async () => {
    const t0 = performance.now();
    const p = openProject('blockers.zip', zipFixture('blockers'));
    const [main] = await findMainFiles(p);
    const s = scanDocument(p, main, idx);
    expect(performance.now() - t0).toBeLessThan(3000);

    const tabu = byPkg(s, 'tabu');
    const caption = byPkg(s, 'caption');
    const titlesec = byPkg(s, 'titlesec');
    expect(tabu).toHaveLength(1);
    expect(caption).toHaveLength(1);
    expect(titlesec).toHaveLength(1);
    expect(tabu[0]).toMatchObject({ severity: 'blocker', path: 'main.tex', line: 3, status: 'no-support' });
    expect(caption[0]).toMatchObject({ severity: 'blocker', path: 'main.tex', line: 4, status: 'currently-incompatible' });
    expect(titlesec[0]).toMatchObject({ severity: 'warning', path: 'main.tex', line: 5, status: 'partially-compatible' });
    for (const f of [tabu[0], caption[0], titlesec[0]]) {
      expect(commentInPlainWords(f).length).toBeGreaterThan(10);
      expect(commentInPlainWords(f)).not.toMatch(/\*\*|`/);
      expect(f.fix?.name).toBeTruthy();
      expect(f.sourceLink).toMatch(/^https:\/\/latex3\.github\.io\/tagging-project\/tagging-status\/#/);
    }
    expect(tabu[0].fix?.name).toBe('Replace tabu with tabularx or array');
    expect(commentInPlainWords(tabu[0])).toMatch(/^In theory a nice package but it is broken and not maintained\./);
    expect(s.summary).toMatchObject({ verdict: '2 blockers found', blockers: 2, warnings: 1 });
    expect(s.findings.filter((f) => f.severity === 'blocker').map((f) => f.package)).toEqual(['tabu', 'caption']);
  });
});

describe('AC-3: Beamer', () => {
  it('is a blocker with the two honest options, and the summary says migration is not covered', () => {
    const s = scanFixture('beamer');
    const b = s.findings.find((f) => f.rule === 'beamer');
    expect(b?.severity).toBe('blocker');
    expect(b?.message).toMatch(/^Tagging does not support Beamer/);
    expect(b?.message).toMatch(/keep the slides untagged and give readers a separate text version/);
    expect(b?.message).toMatch(/move them by hand to the ltx-talk class, which the LaTeX Project recommends for tagged slides/);
    expect(b?.message).toMatch(/This version does not make the move\./);
    expect(s.summary.notes).toEqual([BEAMER_NOTE]);
    expect(BEAMER_NOTE).toBe('Beamer migration is not covered by this version.');
  });
});

describe('AC-4: every file the main file reaches', () => {
  const s = scanFixture('multi', 'course/main.tex');

  it('reads inputs, includes, subfiles, imports, \\InputIfFileExists, the local class and style, and a cycle once', () => {
    expect(s.filesRead).toEqual([
      'course/main.tex',
      'course/mycourse.cls',
      'course/course.sty',
      'common/preamble.tex',
      'course/chapters/intro.tex',
      'course/chapters/loop.tex',
      'course/chapters/ch1.tex',
      'course/parts/part1.tex',
      'course/shared/defs.tex',
      'course/shared/inner/deep.tex',
      'course/chapters/extra.tex',
      'common/appendix.tex',
      'course/chapters/bare.tex',
    ]);
  });

  it('reports the blocker that course.sty loads, located in course.sty', () => {
    expect(byPkg(s, 'tabu')).toEqual([expect.objectContaining({ severity: 'blocker', path: 'course/course.sty', line: 4 })]);
  });

  it('reports what the local class loads, and looks classes and packages not in the zip up by name', () => {
    expect(byPkg(s, 'article', 'class-status')[0]).toMatchObject({ path: 'course/mycourse.cls', line: 3, severity: 'ok' });
    expect(byPkg(s, 'xcolor')[0]).toMatchObject({ path: 'course/mycourse.cls', line: 4 });
    expect(byPkg(s, 'mycourse', 'class-status')).toEqual([]);
    expect(byPkg(s, 'course')).toEqual([]);
  });

  it('follows a .. path that stays inside the zip, and warns for one that leaves it or is absolute', () => {
    expect(byPkg(s, 'booktabs')[0]).toMatchObject({ path: 'common/preamble.tex', line: 1 });
    const outside = s.findings.filter((f) => f.rule === 'outside-project');
    expect(outside.map((f) => [f.line, f.severity])).toEqual([[13, 'warning'], [14, 'warning']]);
    for (const f of outside) expect(f.message.startsWith(OUTSIDE_PROJECT)).toBe(true);
    expect(OUTSIDE_PROJECT).toBe('This file is outside the project you dropped.');
  });

  it('makes a missing include a warning, not a crash', () => {
    expect(s.findings.filter((f) => f.rule === 'missing-file').map((f) => [f.path, f.line])).toEqual([['course/main.tex', 12]]);
  });

  it('reads only the body of a subfiles part, and \\subimport relative to the importing file (S2-10)', () => {
    expect(byPkg(s, 'pgfplots')).toEqual([]);
    expect(byPkg(s, 'siunitx')[0]).toMatchObject({ path: 'course/parts/part1.tex', line: 5 });
    expect(byPkg(s, 'listings')[0]).toMatchObject({ path: 'course/shared/inner/deep.tex', line: 1 });
    expect(byPkg(s, 'multicol')[0]).toMatchObject({ path: 'course/chapters/bare.tex' });
  });

  it('warns for \\include of a file above the main file\'s folder (S3-6), not for \\input', () => {
    const w = s.findings.filter((f) => f.rule === 'include-parent-path');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: 'course/main.tex', line: 15, severity: 'warning' });
    expect(w[0].message).toMatch(/^The checker cannot write this file's \.aux next to it; use \\input, or move the main file up a folder\./);
  });

  it('works the same when the zip has a top folder', () => {
    const t = scanFixture('multi', 'top/course/main.tex', 'top/');
    expect(t.filesRead).toHaveLength(13);
    expect(byPkg(t, 'tabu')[0].path).toBe('top/course/course.sty');
  });

  it('scans a single .tex dropped without a zip the same way', () => {
    const one = scanDocument(openProject('lecture.tex', zipFixtureText('single', 'lecture.tex')), 'lecture.tex', idx);
    expect(byPkg(one, 'tabu')[0]).toMatchObject({ severity: 'blocker', path: 'lecture.tex', line: 2 });
  });

  it('looks in the current folder first, then the main file\'s, for \\input and packages', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\begin{document}\\import{a/}{x}\\end{document}' },
      { name: 'a/x.tex', data: '\\input{y}\\input{z}\\usepackage{local}' },
      { name: 'a/y.tex', data: '\\usepackage{tabu}' },
      { name: 'z.tex', data: '\\usepackage{caption}' },
      { name: 'local.sty', data: '\\RequirePackage{titlesec}' },
    ]));
    const r = scanDocument(p, 'main.tex', idx);
    expect(r.filesRead).toEqual(['main.tex', 'a/x.tex', 'a/y.tex', 'z.tex', 'local.sty']);
  });

  it('warns when an \\import folder leaves the project', () => {
    const r = scanTex('\\documentclass{article}\\begin{document}\\import{../x/}{y}\\subimport{/abs/}{z}\\end{document}');
    expect(r.findings.filter((f) => f.rule === 'outside-project')).toHaveLength(2);
  });
});

describe('AC-5: which files are documents', () => {
  it('lists every document, and leaves out subfiles and standalone parts and commented lines (S2-10)', async () => {
    const p = openProject('course.zip', zipFixture('course'));
    const seen: [number, number][] = [];
    const mains = await findMainFiles(p, (d, t) => seen.push([d, t]));
    expect(mains).toEqual(['hw1/hw1.tex', 'hw2/hw2.tex', 'hw3/hw3.tex', 'notes/notes.tex']);
    expect(seen.at(-1)).toEqual([7, 7]);
  });

  it('finds none in a project without \\documentclass', async () => {
    const p = openProject('p.zip', rawZip([{ name: 'a.tex', data: 'text' }, { name: 'b.tex', data: '\\documentclass{article} no body' }]));
    expect(await findMainFiles(p)).toEqual([]);
  });

  it('pauses now and then on a long list, so the page can show progress', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}.tex`, data: 'x'.repeat(10) }));
    const p = openProject('p.zip', rawZip(many));
    let pauses = 0;
    const realNow = Date.now;
    let t = 0;
    Date.now = () => (t += 20);
    try {
      await findMainFiles(p, () => {}, async () => void pauses++);
    } finally {
      Date.now = realNow;
    }
    expect(pauses).toBeGreaterThan(5);
  });
});

describe('AC-7 and AC-62: unknown is never ok', () => {
  it('lists a package that is not in the data as unknown, and an unchecked one with its word', () => {
    const s = scanFixture('single');
    expect(byPkg(s, 'mysterypackage-not-in-list')[0]).toMatchObject({ severity: 'unknown' });
    expect(byPkg(s, 'mysterypackage-not-in-list')[0].status).toBeUndefined();
    const m = scanFixture('misplaced');
    expect(byPkg(m, 'babel')[0]).toMatchObject({ severity: 'unknown', status: 'unchecked' });
  });

  it('counts a subpackage as its parent', () => {
    const s = scanTex('\\documentclass{article}\\usepackage{caption3}\\begin{document}\\end{document}');
    expect(s.findings.find((f) => f.via === 'caption3')).toMatchObject({ package: 'caption', severity: 'blocker' });
    expect(s.summary.unknown).toBe(0);
  });

  it('reports each package once', () => {
    const s = scanTex('\\documentclass{article}\\usepackage{tabu}\\usepackage{tabu,fontenc}\\RequirePackage{fontenc}\\begin{document}\\end{document}');
    expect(byPkg(s, 'tabu')).toHaveLength(1);
    expect(byPkg(s, 'fontenc', 'pdftex-only')).toHaveLength(1);
  });
});

describe('AC-8: figures', () => {
  it('counts images and TikZ pictures, and those without alt text', () => {
    const s = scanFixture('figures');
    expect(s.figures).toMatchObject({ images: 5, imagesWithoutAlt: 3, tikz: 2, tikzWithoutAlt: 1 });
    expect(s.figures.list.filter((f) => !f.hasAlt).map((f) => [f.kind, f.line, f.file])).toEqual([
      ['image', 8, 'img/photo.png'],
      ['image', 10, 'img/old'],
      ['tikz', 14, undefined],
      ['image', 17, 'img/diagram.eps'],
    ]);
    // alt, artifact (decorative) and an alt on the picture all count as handled.
    expect(s.figures.list.filter((f) => f.hasAlt).map((f) => f.line)).toEqual([7, 9, 11]);
  });
});

describe('AC-9: the verdict', () => {
  it('reads "No known blockers" or "N blockers found"', () => {
    expect(verdictFor(0)).toBe('No known blockers');
    expect(verdictFor(1)).toBe('1 blocker found');
    expect(verdictFor(7)).toBe('7 blockers found');
  });
});

describe('AC-10: the preamble checks', () => {
  it('reports no \\DocumentMetadata, inputenc and fontenc, no language and no title, each with its line', () => {
    const s = scanFixture('preamble');
    const rule = (r: string) => s.findings.filter((f) => f.rule === r).map((f) => [f.severity, f.line, f.package]);
    expect(rule('no-document-metadata')).toEqual([['warning', 1, undefined]]);
    expect(s.findings.find((f) => f.rule === 'no-document-metadata')?.message).toMatch(/Added by the patch/);
    expect(rule('pdftex-only')).toEqual([['warning', 2, 'inputenc'], ['warning', 3, 'fontenc']]);
    expect(s.findings.find((f) => f.rule === 'pdftex-only')?.message).toMatch(/not needed with LuaLaTeX/);
    expect(rule('no-language')).toEqual([['warning', 1, undefined]]);
    expect(rule('no-title')).toEqual([['warning', 1, undefined]]);
  });

  it('reports \\DocumentMetadata after \\documentclass as misplaced, and accepts babel, hyperref and \\hypersetup', () => {
    const s = scanFixture('misplaced');
    expect(s.findings.filter((f) => f.rule === 'misplaced-document-metadata').map((f) => f.line)).toEqual([2]);
    expect(s.findings.some((f) => f.rule === 'no-document-metadata' || f.rule === 'no-language' || f.rule === 'no-title')).toBe(false);
  });

  it('takes the language from \\DocumentMetadata, babel (also through class options), polyglossia, and the title from pdftitle', () => {
    const ok = (src: string) => scanTex(src).findings.filter((f) => f.rule === 'no-language' || f.rule === 'no-title').map((f) => f.rule);
    const doc = (pre: string) => `\\documentclass[english]{article}${pre}\\begin{document}\\end{document}`;
    expect(ok(doc('\\usepackage{babel}\\title{x}'))).toEqual([]);
    expect(ok(doc('\\usepackage[main=french]{babel}\\usepackage[pdftitle=x]{hyperref}'))).toEqual([]);
    expect(ok(doc('\\usepackage{polyglossia}\\setdefaultlanguage{english}\\title{x}'))).toEqual([]);
    expect(ok(doc('\\usepackage[french]{polyglossia}\\title{x}'))).toEqual([]);
    expect(ok('\\documentclass{article}\\usepackage{babel}\\begin{document}\\end{document}')).toEqual(['no-language', 'no-title']);
    const s = scanTex(doc('\\usepackage{babel}'));
    expect(s.findings.find((f) => f.package === 'babel-english')).toMatchObject({ severity: 'ok', line: 1 });
  });

  it('does not read a commented \\documentclass or a \\DocumentMetadata inside a comment', () => {
    const s = scanTex('% \\DocumentMetadata{lang=en}\n\\documentclass{article}\n\\begin{document}\\end{document}');
    expect(s.findings.find((f) => f.rule === 'no-document-metadata')?.line).toBe(2);
  });

  it('places the document-level warnings at line 1 when there is no \\documentclass', () => {
    const s = scanTex('just text');
    expect(s.findings.find((f) => f.rule === 'no-title')).toMatchObject({ line: 1, excerpt: '' });
  });
});

describe('S2-8: parts that need an outside program', () => {
  it('warns for minted, svg, gnuplottex, pythontex, \\includesvg, \\tikzexternalize and EPS figures, with the same words', () => {
    const s = scanFixture('programs');
    const w = s.findings.filter((f) => f.rule === 'outside-program');
    expect(w.map((f) => f.package ?? f.line)).toEqual(['minted', 'svg', 'gnuplottex', 'pythontex', 9, 12]);
    for (const f of w) expect(f.message.startsWith(OUTSIDE_PROGRAM)).toBe(true);
    const eps = scanFixture('figures').findings.filter((f) => f.rule === 'outside-program');
    expect(eps.map((f) => [f.line, f.fix?.name])).toEqual([[10, 'Convert it to PDF'], [17, 'Convert it to PDF']]);
  });

  it('does not warn for an image whose PDF or PNG is also in the zip', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\begin{document}\\includegraphics{a}\\includegraphics{b}\\end{document}' },
      { name: 'a.eps', data: 'x' },
      { name: 'a.pdf', data: 'x' },
      { name: 'b.png', data: 'x' },
    ]));
    expect(scanDocument(p, 'main.tex', idx).findings.filter((f) => f.rule === 'outside-program')).toEqual([]);
  });

  it('ignores commands inside verbatim environments', () => {
    expect(byPkg(scanFixture('programs'), 'tabu')).toEqual([]);
  });
});

describe('excerpts', () => {
  it('keeps the source line, at most 200 characters', () => {
    const s = scanTex(`\\documentclass{article}\\usepackage{tabu}${'x'.repeat(300)}\n\\begin{document}\\end{document}`);
    const f = byPkg(s, 'tabu')[0];
    expect(f.excerpt?.length).toBe(200);
    expect(f.excerpt?.endsWith('\u2026')).toBe(true);
  });
});

describe('suggested fixes', () => {
  it('names only replacements that the pinned data lists as compatible', () => {
    for (const { replacements } of Object.values(CURATED)) {
      for (const r of replacements) expect(idx.lookup(r, 'package')?.entry.status).toBe('compatible');
    }
  });

  it('names a fix for every group but ok', () => {
    expect(suggestedFix('x', 'package', 'blocker', 'no-support')?.name).toBe('Replace x');
    expect(suggestedFix('x', 'class', 'blocker', 'currently-incompatible')?.detail).toMatch(/the x class/);
    expect(suggestedFix('x', 'library', 'warning', 'partially-compatible')?.detail).toMatch(/the x library/);
    expect(suggestedFix('x', 'package', 'unknown', undefined)?.name).toBe('Check x by hand');
    expect(suggestedFix('x', 'package', 'ok', 'compatible')).toBeNull();
    expect(suggestedFix('epsfig', 'package', 'blocker', 'no-support')?.name).toBe('Replace epsfig with graphicx');
  });

  it('turns the source\'s markdown into plain words', () => {
    expect(plainWords('**broken** and `\\begin{x}` see [the list](https://x) *now*')).toBe('broken and \\begin{x} see the list now');
    expect(plainWords(undefined)).toBe('');
    // R1.1-8: PDF tag names stay.
    expect(plainWords('Produces empty `<Div>`s.')).toBe('Produces empty <Div>s.');
    expect(plainWords(idx.lookup('listliketab', 'package')?.entry.comment)).toContain('<Div>');
  });
});

describe('review round 1: the scan', () => {
  const doc = (pre: string, body = '') => `\\DocumentMetadata{lang=en-US}\\documentclass{article}\\title{t}${pre}\n\\begin{document}\n${body}\n\\end{document}`;

  it('R1.1-5: stops reading the main file at \\end{document}', () => {
    const s = scanTex(`${doc('')}\nOld: \\usepackage{tabu} \\includegraphics{old.eps} \\input{gone}\n`);
    expect(s.summary.verdict).toBe('No known blockers');
    expect(s.findings.filter((f) => f.severity === 'warning')).toEqual([]);
    expect(s.figures.images).toBe(0);
  });

  it('R1.1-6: inline verbatim and % in addresses, through the whole scan', () => {
    const body = 'Write \\verb|\\documentclass{beamer}| and \\verb|\\usepackage{tabu}| and \\lstinline!\\usepackage{caption}!\n\\href{http://a/b%20c}{x} \\includegraphics{a.eps}';
    const s = scanTex(doc('', body));
    expect(s.summary.verdict).toBe('No known blockers');
    expect(s.figures.images).toBe(1);
    expect(s.findings.filter((f) => f.rule === 'outside-program')).toHaveLength(1);
  });

  it('R1.1-7: what a \\subfile reads resolves against the subfile\'s own folder', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: doc('', '\\subfile{chapters/ch1}') },
      { name: 'chapters/ch1.tex', data: '\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\input{sec1}\n\\includegraphics{fig}\n\\input{shared}\n\\end{document}' },
      { name: 'chapters/sec1.tex', data: '\\usepackage{tabu}' },
      { name: 'chapters/fig.eps', data: 'x' },
      { name: 'shared.tex', data: 'Found through the main folder, as older subfiles versions do.' },
    ]));
    const s = scanDocument(p, 'main.tex', idx);
    expect(s.filesRead).toEqual(['main.tex', 'chapters/ch1.tex', 'chapters/sec1.tex', 'shared.tex']);
    expect(byPkg(s, 'tabu')[0]).toMatchObject({ path: 'chapters/sec1.tex' });
    expect(s.findings.filter((f) => f.rule === 'outside-program')).toHaveLength(1);
    expect(s.findings.filter((f) => f.rule === 'missing-file')).toEqual([]);
  });

  it('R1.1-11: hostile files scan in linear time', () => {
    // Linear, not fast: a quarter of the input takes about a quarter of the time.
    // A wall-clock budget alone failed on a busy CI runner (a778c8f), so the
    // check compares the two sizes; quadratic time would be 16 times slower.
    const run = (k: number) => {
      const t0 = performance.now();
      for (const [unit, n] of [['\\input x ', 80_000], ['\\input{', 100_000], ['\\title[', 100_000], ['\\usepackage{a}', 50_000], ['\\includegraphics{a.eps}', 30_000], ['\\begin{comment}\\end{comment}', 50_000]] as const) {
        scanTex(`\\documentclass{article}\\begin{document}${unit.repeat(Math.round(n * k))}`);
      }
      return performance.now() - t0;
    };
    const small = run(0.25);
    const big = run(1);
    expect(big).toBeLessThan(8 * small + 1000);
    expect(big).toBeLessThan(30_000);
  }, 60_000);

  it('R1.1-11: names a missing file once, however often it is read', () => {
    const s = scanTex(doc('', '\\input{gone}\\input{gone}\\input{/etc/x}\\input{/etc/x}'));
    expect(s.findings.filter((f) => f.rule === 'missing-file' || f.rule === 'outside-project')).toHaveLength(2);
  });

  it('R1.1-12: a package named like an Object property is just unknown', () => {
    const s = scanTex(doc('\\usepackage{constructor,toString,hasOwnProperty}'));
    expect(s.findings.filter((f) => f.rule === 'outside-program')).toEqual([]);
    for (const n of ['constructor', 'toString', 'hasOwnProperty']) {
      expect(byPkg(s, n)[0]).toMatchObject({ severity: 'unknown', fix: { name: `Check ${n} by hand` } });
    }
    expect(suggestedFix('constructor', 'package', 'blocker', 'no-support')?.name).toBe('Replace constructor');
  });

  it('R1.1-14: a figure inside a macro definition is not counted', () => {
    const s = scanTex(doc('\\newcommand{\\fig}[1]{\\includegraphics{#1}}', '\\fig{a}\\fig{b}\\includegraphics[alt={x}]{c}'));
    expect(s.figures).toMatchObject({ images: 1, imagesWithoutAlt: 0 });
  });

  it('R1.1-14: babel options from every file count, so a language set in the main file is kept', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\usepackage[french]{babel}\\usepackage{course}\\title{t}\\begin{document}\\end{document}' },
      { name: 'course.sty', data: '\\RequirePackage{babel}' },
    ]));
    expect(scanDocument(p, 'main.tex', idx).findings.filter((f) => f.rule === 'no-language')).toEqual([]);
  });

  it('R1.1-14: an empty alt or actualtext is not alt text', () => {
    const s = scanTex(doc('', '\\includegraphics[alt={}]{a}\\includegraphics[alt=]{b}\\includegraphics[actualtext={ }]{c}\\includegraphics[alt={A cat}]{d}\\begin{tikzpicture}[alt={}]\\end{tikzpicture}'));
    expect(s.figures).toMatchObject({ images: 4, imagesWithoutAlt: 3, tikz: 1, tikzWithoutAlt: 1 });
  });

  it('R1.1-14: a file left out as a student record is named as such, not as missing', () => {
    const p = openProject('p.zip', zipFixture('students'));
    const f = scanDocument(p, 'main.tex', idx).findings.find((x) => x.rule === 'left-out-file');
    expect(f?.message).toBe('students is in the zip but was left out as a student record, so the scan did not read it.');
  });
});

describe('review round 2: the scan', () => {
  it('R1.2-2: only an \\end{document} outside every brace group ends the main file', () => {
    const a = scanTex('\\documentclass{article}\\newcommand{\\finish}{\\end{document}}\\usepackage{tabu}\\title{x}\\begin{document}\nText\n\\finish');
    expect(byPkg(a, 'tabu')).toHaveLength(1);
    const b = scanTex('\\documentclass{article}\\title{x}\\begin{document}\n\\mintinline{latex}|\\end{document}|\n\\includegraphics{a.png}\n\\end{document}\n\\usepackage{tabu}');
    expect(b.figures.images).toBe(1);
    expect(byPkg(b, 'tabu')).toEqual([]);
  });

  it('R1.2-4: two different missing files written the same way give two warnings', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\title{x}\\begin{document}\\subfile{a/part}\\subfile{b/part}\\input{gone}\\input{gone}\\end{document}' },
      { name: 'a/part.tex', data: '\\input{intro}' },
      { name: 'b/part.tex', data: '\\input{intro}' },
    ]));
    const w = scanDocument(p, 'main.tex', idx).findings.filter((f) => f.rule === 'missing-file').map((f) => f.path);
    expect(w.sort()).toEqual(['a/part.tex', 'b/part.tex', 'main.tex']);
  });

  it('R1.2-5: an \\input of a left-out file has its own rule and heading', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\title{x}\\begin{document}\\input{StudentsGuide}\\end{document}' },
      { name: 'StudentsGuide.tex', data: 'x' },
    ]));
    const f = scanDocument(p, 'main.tex', idx).findings.find((x) => x.message.includes('left out'));
    expect(f?.rule).toBe('left-out-file');
    expect(findingTitle(f as Finding)).toBe('File left out as a student record');
  });

  it('R1.2-8: a long line\'s excerpt shows the command', () => {
    const s = scanTex(`\\documentclass{article}\n${'x'.repeat(300)}\\usepackage{tabu} and more\n\\begin{document}\\end{document}`);
    const ex = byPkg(s, 'tabu')[0].excerpt ?? '';
    expect(ex).toContain('\\usepackage{tabu}');
    expect(ex.length).toBeLessThanOrEqual(200);
    expect(ex.startsWith('…')).toBe(true);
  });
});

function zipFixtureText(name: string, file: string): Uint8Array {
  const p = openProject(`${name}.zip`, zipFixture(name));
  return p.bytes(file);
}
