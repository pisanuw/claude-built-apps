import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { classFix, COMPATIBLE_CLASSES, suggestedFix } from '../src/core/fixes';
import { blankComments } from '../src/core/latex';
import { projectZip } from '../src/core/outzip';
import { isRecordName, isStudentRecord, openProject, recordFolder } from '../src/core/project';
import { buildReport, reportHtml, reportJson } from '../src/core/report';
import { findMainFiles, scanDocument, type DocumentScan } from '../src/core/scan';
import { rawZip, statusIndex, text } from './helpers';
import Ajv2020 from 'ajv/dist/2020';
import schema from '../schema/report.schema.json';

const idx = statusIndex();
const scanTex = (src: string, name = 'main.tex'): DocumentScan => scanDocument(openProject(name, text(src)), name, idx);
const byPkg = (s: DocumentScan, pkg: string, rule = 'package-status') => s.findings.filter((f) => f.package === pkg && f.rule === rule);

describe('R1.3-1: the pair join stays inside one run of letters, except "grade book"', () => {
  it.each([
    // The reviewer's four rows, and the three more he found.
    ["Student's Guide.tex", false],
    ['student-s-t-test.tex', false],
    ['student_s_t_distribution.png', false],
    ['Grade 5 Book.pdf', false],
    ['student(s).tex', false],
    ['grade3-book.tex', false],
    // Still left out: grade book with one separator, in any case, and camel case inside a run.
    ['grade-book-report.tex', true],
    ['5th-grade-book-report.tex', true],
    ['Grade.Books.xlsx', true],
    ['FinalGrade-Book.csv', true],
    ['myGRades.txt', true],
    ['fooSTUDents.csv', true],
    ['GradeBook.xlsx', true],
    ['grade--book.xlsx', false],
    ['StudentsGuide.tex', true],
  ])('%s -> %s', (name, want) => {
    expect(isStudentRecord(name)).toBe(want);
  });

  it('lists what the new rule catches that a rule without any join would not, on generated names', () => {
    // The knowledge candidate of R1.3: read what a widening catches. Without joins,
    // only whole runs and camel parts count; with them, these names are added.
    const noJoin = (n: string) =>
      (n.match(/[A-Za-z]+/g) ?? []).some((r) => ['grades', 'gradebook', 'gradebooks', 'roster', 'rosters', 'students'].includes(r.toLowerCase()) ||
        (r.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) ?? []).some((w) => ['grades', 'gradebook', 'gradebooks', 'roster', 'rosters', 'students'].includes(w.toLowerCase())));
    const words = ['grade', 'book', 'books', 'student', 's', 'guide', 'Grade', 'Book', 'Student', 'GRADE', 'BOOK'];
    const seps = ['', ' ', '-', '_', '.', "'", ' 5 ', '('];
    const added = new Set<string>();
    for (const a of words) for (const sep of seps) for (const b of words) {
      const n = `${a}${sep}${b}`;
      if (isRecordName(n) && !noJoin(n)) added.add(n.toLowerCase().replace(/[ ._-]/, '+'));
    }
    expect([...added].sort()).toEqual(['grade+book', 'grade+books']);
  });

  it('R1.3-3: the rule has no regex lookbehind, which Safari before 16.4 cannot parse', async () => {
    const fs = await import('node:fs');
    for (const f of ['src/core/project.ts', 'src/core/latex.ts', 'src/core/scan.ts', 'src/core/report.ts', 'src/core/fixes.ts', 'src/core/zip.ts', 'src/core/status.ts', 'src/core/outzip.ts', 'src/ui/app.ts']) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\(\?<[=!]/);
    }
  });
});

describe('AC-69 and AC-70: folders named like student records', () => {
  const course = () =>
    rawZip([
      { name: 'CS142/main.tex', data: '\\documentclass{article}\\title{x}\\begin{document}\\input{grades/midterm-feedback}\\end{document}' },
      { name: 'CS142/grades/', data: '' },
      { name: 'CS142/grades/midterm-feedback.tex', data: '\\documentclass{article}\\begin{document}SECRET Alice 71\\end{document}' },
      { name: 'CS142/grades/hw1.txt', data: 'SECRET Bob 12' },
      { name: 'CS142/grades/midterm-scores.pdf', data: '%PDF SECRET' },
      { name: 'STAT201/Gradebook/old/a.tex', data: 'SECRET' },
      { name: 'STAT201/grade-book/b.csv', data: 'SECRET' },
      { name: 'STAT201/roster/c.csv', data: 'SECRET' },
      { name: 'STAT201/students/d.csv', data: 'SECRET' },
      { name: 'STAT201/Grade 5 Book/notes.tex', data: '\\documentclass{article}\\title{y}\\begin{document}\\end{document}' },
      { name: 'STAT201/final.grades', data: 'kept: the record word is only the extension' },
    ]);

  it('finds the first record folder in a path, by the words and rules of AC-15 and D-27', () => {
    expect(recordFolder('CS142/grades/hw1.txt')).toBe('CS142/grades/');
    expect(recordFolder('a/Gradebook/b/roster/x')).toBe('a/Gradebook/');
    expect(recordFolder('grade-book/x')).toBe('grade-book/');
    expect(recordFolder('grades.tex')).toBeNull();
    expect(recordFolder('Grade 5 Book/notes.tex')).toBeNull();
    expect(recordFolder("Student's Guide/x.tex")).toBeNull();
    expect(recordFolder('a//b.tex')).toBeNull();
  });

  it('never reads them, never lists them as documents, and never puts them in a zip the app builds', async () => {
    const p = openProject('course.zip', course());
    expect(p.paths.sort()).toEqual(['CS142/main.tex', 'STAT201/Grade 5 Book/notes.tex', 'STAT201/final.grades']);
    expect(p.leftOut).toHaveLength(7);
    expect(await findMainFiles(p)).toEqual(['CS142/main.tex', 'STAT201/Grade 5 Book/notes.tex']);
    const out = unzipSync(projectZip(p));
    expect(Object.keys(out).sort()).toEqual(['CS142/main.tex', 'STAT201/Grade 5 Book/notes.tex', 'STAT201/final.grades']);
    expect(Object.values(out).map((b) => strFromU8(b)).join('\n')).not.toMatch(/SECRET/);
    // The \input of a left-out file says so, and no text of it was read.
    const s = scanDocument(p, 'CS142/main.tex', idx);
    expect(s.findings.filter((f) => f.rule === 'left-out-file')).toHaveLength(1);
    expect(s.filesRead).toEqual(['CS142/main.tex']);
  });

  it('the AC-69 fixture through projectZip: CS142/main.tex and CS142/grades/ with a .tex, a .txt and a .pdf', () => {
    const p = openProject('CS142.zip', rawZip([
      { name: 'CS142/main.tex', data: '\\documentclass{article}\\begin{document}\\end{document}' },
      { name: 'CS142/grades/midterm-feedback.tex', data: 'SECRET' },
      { name: 'CS142/grades/hw1.txt', data: 'SECRET' },
      { name: 'CS142/grades/midterm-scores.pdf', data: 'SECRET' },
    ]));
    expect(Object.keys(unzipSync(projectZip(p)))).toEqual(['CS142/main.tex']);
    expect(Object.keys(unzipSync(projectZip(p, { changes: new Map([['CS142/main.tex', 'x']]), extra: new Map([['tagging-doctor.diff', '']]) }))).sort()).toEqual(['CS142/main.tex', 'tagging-doctor.diff']);
  });

  it('names each folder in the warning, with its count, in the page data and both reports', () => {
    const p = openProject('course.zip', course());
    const folders = p.warnings.filter((w) => w.rule === 'student-records' && w.path.endsWith('/'));
    expect(folders.map((w) => w.path)).toEqual(['CS142/grades/', 'STAT201/Gradebook/', 'STAT201/grade-book/', 'STAT201/roster/', 'STAT201/students/']);
    expect(folders[0].message).toBe('Files in CS142/grades/ were left out as student records (3 files), and the scan never read them. Remove student records from course folders.');
    expect(folders[1].message).toBe('Files in STAT201/Gradebook/ were left out as student records (1 file), and the scan never read it. Remove student records from course folders.');
    expect(p.leftOutFolders).toEqual([
      { folder: 'CS142/grades/', files: 3 },
      { folder: 'STAT201/Gradebook/', files: 1 },
      { folder: 'STAT201/grade-book/', files: 1 },
      { folder: 'STAT201/roster/', files: 1 },
      { folder: 'STAT201/students/', files: 1 },
    ]);
    const r = buildReport(p.name, p.leftOut, p.warnings, [scanDocument(p, 'CS142/main.tex', idx)], idx.data, new Date('2026-11-20T12:00:00Z'), p.leftOutFolders);
    const html = reportHtml(r);
    expect(html).toContain('Files in CS142/grades/ were left out as student records (3 files)');
    expect(html).toContain('7 files were left out as student records in all.');
    const json = JSON.parse(reportJson(r));
    expect(json.project.leftOut).toHaveLength(7);
    expect(json.project.leftOutFolders[0]).toEqual({ folder: 'CS142/grades/', files: 3 });
    expect(json.projectWarnings.map((w: { message: string }) => w.message).join(' ')).toContain('Files in STAT201/students/ were left out as student records');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    expect(ajv.validate(schema, json), JSON.stringify(ajv.errors)).toBe(true);
  });

  it('keeps the file-name warning for files named so, beside the folder ones', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: 'x' },
      { name: 'roster.csv', data: 'x' },
      { name: 'grades/a.csv', data: 'x' },
    ]));
    expect(p.warnings.map((w) => w.path)).toEqual(['grades/', 'roster.csv']);
    expect(p.leftOut).toEqual(['roster.csv', 'grades/a.csv']);
  });
});

describe('AC-71 and AC-72: a blocking class gets a fix a document can follow', () => {
  it('the classes the fix names are compatible in the pinned data', () => {
    for (const c of COMPATIBLE_CLASSES) expect(idx.lookup(c, 'class')?.entry.status, c).toBe('compatible');
  });

  it('exam (currently-incompatible): keep it for now, or move by hand; never "remove"', () => {
    expect(idx.lookup('exam', 'class')?.entry.status).toBe('currently-incompatible');
    const s = scanTex('\\documentclass[12pt]{exam}\\title{x}\\begin{document}\\end{document}');
    const f = byPkg(s, 'exam', 'class-status')[0];
    expect(f.severity).toBe('blocker');
    expect(f.fix).toEqual({
      name: 'Keep exam for now, or move to a compatible class',
      detail:
        'The LaTeX Project expects the exam class to be updated for tagging, but it does not work yet. Keep the class for now and check the status page again before the next term, or move the content by hand to a class the list names as compatible, such as article, book or report.',
    });
    expect(`${f.fix?.name} ${f.fix?.detail}`).not.toMatch(/remove/i);
  });

  it('tufte-handout (no-support): move by hand to a compatible class; never "remove"', () => {
    expect(idx.lookup('tufte-handout', 'class')?.entry.status).toBe('no-support');
    const s = scanTex('\\documentclass{tufte-handout}\\title{x}\\begin{document}\\end{document}');
    const f = byPkg(s, 'tufte-handout', 'class-status')[0];
    expect(f.fix).toEqual({
      name: 'Move from tufte-handout to a compatible class',
      detail: 'The LaTeX Project does not expect the tufte-handout class ever to work with tagging. Move the content by hand to a class the list names as compatible, such as article, book or report.',
    });
    expect(`${f.fix?.name} ${f.fix?.detail}`).not.toMatch(/remove/i);
  });

  it('every blocking class in the pinned data gets one of the two, and Beamer keeps its own', () => {
    for (const e of idx.data.entries.filter((x) => x.type === 'class' && x.group === 'blocker')) {
      const fix = suggestedFix(e.name, 'class', 'blocker', e.status);
      expect(fix, e.name).toEqual(classFix(e.name, e.status));
      expect(`${fix?.name} ${fix?.detail}`, e.name).not.toMatch(/remove/i);
    }
    const b = scanTex('\\documentclass{beamer}\\title{x}\\begin{document}\\end{document}');
    expect(b.findings.find((f) => f.rule === 'beamer')?.fix?.name).toBe('Keep the slides untagged with a text version, or move to ltx-talk by hand');
    // Packages keep their wording.
    expect(suggestedFix('x', 'package', 'blocker', 'currently-incompatible')?.name).toBe('Remove x for now');
  });
});

describe('R1.3-2: one unclosed { before \\end{document} no longer switches the cut off', () => {
  it.each([
    ['a tcblisting body with an open brace', '\\begin{tcblisting}{}\nint f() {\n\\end{tcblisting}'],
    ['a forgotten } after {\\small', '{\\small text\n'],
    ['\\string{', '\\string{ x'],
  ])('%s', (_label, body) => {
    const s = scanTex(`\\documentclass{article}\\title{x}\n\\begin{document}\n${body}\n\\end{document}\n\\usepackage{tabu}\n\\includegraphics{a.png}\n`);
    expect(byPkg(s, 'tabu')).toEqual([]);
    expect(s.figures.images).toBe(0);
  });

  it('still reads past an \\end{document} inside a definition, before or after \\begin{document}', () => {
    const a = scanTex('\\documentclass{article}\\newcommand{\\finish}{\\end{document}}\\usepackage{tabu}\\title{x}\\begin{document}\nText\n\\finish');
    expect(byPkg(a, 'tabu')).toHaveLength(1);
    const b = scanTex('\\documentclass{article}\\title{x}\\begin{document}\\newcommand{\\fin}{\\end{document}}\\includegraphics{a.png}\\end{document}\\usepackage{tabu}');
    expect(b.figures.images).toBe(1);
    expect(byPkg(b, 'tabu')).toEqual([]);
  });
});

describe('R1.3-4: five small things', () => {
  it('the excerpt is the whole line when its start is up to about 140 characters back', () => {
    const line = `\\begin{center} some long text here to make it long \\end{center}} ${'y'.repeat(20)} \\usepackage{tabu} % tail`;
    const s = scanTex(`\\documentclass{article}\\title{x}\n${line}\n\\begin{document}\\end{document}`);
    expect(byPkg(s, 'tabu')[0].excerpt).toBe(line);
    const long = scanTex(`\\documentclass{article}\\title{x}\n${'x'.repeat(150)}\\usepackage{tabu}\n\\begin{document}\\end{document}`);
    const ex = byPkg(long, 'tabu')[0].excerpt ?? '';
    expect(ex.startsWith('\u2026')).toBe(true);
    expect(ex).toContain('\\usepackage{tabu}');
    expect(ex.length).toBeLessThanOrEqual(200);
  });

  it('\\verb[ and \\Verb with a [ delimiter end at the next [', () => {
    expect(blankComments('\\verb[\\usepackage{tabu}[ \\usepackage{a}')).not.toContain('tabu');
    expect(blankComments('\\verb[\\usepackage{tabu}[ \\usepackage{a}')).toContain('\\usepackage{a}');
    expect(blankComments('\\Verb[x]+\\usepackage{tabu}+ \\usepackage{a}')).not.toContain('tabu');
    const s = scanTex('\\documentclass{article}\\title{x}\\verb[\\usepackage{tabu}[ \\usepackage{caption}\\begin{document}\\end{document}');
    expect(byPkg(s, 'tabu')).toEqual([]);
    expect(byPkg(s, 'caption')).toHaveLength(1);
  });

  it('spaces before the option, the language and the code are skipped', () => {
    for (const src of [
      '\\mintinline {latex}{\\usepackage{tabu}}',
      '\\mintinline{latex} {\\usepackage{tabu}}',
      '\\mintinline\t[x] {latex} {\\usepackage{tabu}}',
      '\\lstinline {\\usepackage{tabu}}',
      '\\lstinline [style=x] |\\usepackage{tabu}|',
      '\\Verb |\\usepackage{tabu}|',
    ]) {
      expect(blankComments(src), src).not.toContain('tabu');
    }
  });

  it('one left-out file named from two folders gives one warning', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\title{x}\\begin{document}\\subfile{a/part}\\subfile{b/part}\\end{document}' },
      { name: 'a/part.tex', data: '\\documentclass[../main]{subfiles}\\begin{document}\\input{students}\\end{document}' },
      { name: 'b/part.tex', data: '\\documentclass[../main]{subfiles}\\begin{document}\\input{students}\\end{document}' },
      { name: 'students.tex', data: 'SECRET' },
    ]));
    const s = scanDocument(p, 'main.tex', idx);
    expect(s.findings.filter((f) => f.rule === 'left-out-file')).toHaveLength(1);
    // Two different missing files written the same way still give two (R1.2-4).
    const q = openProject('q.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\title{x}\\begin{document}\\subfile{a/part}\\subfile{b/part}\\end{document}' },
      { name: 'a/part.tex', data: '\\documentclass[../main]{subfiles}\\begin{document}\\input{gone}\\end{document}' },
      { name: 'b/part.tex', data: '\\documentclass[../main]{subfiles}\\begin{document}\\input{gone}\\end{document}' },
    ]));
    expect(scanDocument(q, 'main.tex', idx).findings.filter((f) => f.rule === 'missing-file')).toHaveLength(2);
  });

  it('a part with its own preamble ends at its top-level \\end{document}, not one in a definition', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: '\\documentclass{article}\\title{x}\\begin{document}\\subfile{part}\\end{document}' },
      { name: 'part.tex', data: '\\documentclass[main]{subfiles}\\newcommand{\\finish}{\\end{document}}\\begin{document}\n\\includegraphics{a.png}\n\\usepackage{tabu}\n\\end{document}\n\\usepackage{caption}' },
    ]));
    const s = scanDocument(p, 'main.tex', idx);
    expect(s.figures.images).toBe(1);
    expect(byPkg(s, 'tabu')).toHaveLength(1);
    expect(byPkg(s, 'caption')).toEqual([]);
  });
});
