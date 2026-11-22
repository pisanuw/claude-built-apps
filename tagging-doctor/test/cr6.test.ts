// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { projectZip } from '../src/core/outzip';
import { leftOutDocumentsLines, openProject, RENAME_FOLDER } from '../src/core/project';
import { buildReport, reportHtml, reportJson } from '../src/core/report';
import { findMainFiles, scanDocument } from '../src/core/scan';
import { mountApp, noMainMessage, type AppDeps } from '../src/ui/app';
import { rawZip, statusIndex } from './helpers';

const idx = statusIndex();
const DOC = '\\documentclass{article}\\title{x}\\begin{document}\\end{document}';
const count = (s: string) => s.split(RENAME_FOLDER).length - 1;

describe('AC-77: each left-out folder\'s warning says how to have it read', () => {
  it('once for one folder, on the page data and in both reports', () => {
    const p = openProject('stat.zip', rawZip([
      { name: 'STAT201/main.tex', data: DOC },
      { name: 'STAT201/grades/notes.tex', data: 'SECRET' },
      { name: 'STAT201/grades/hw1.txt', data: 'SECRET' },
    ]));
    const w = p.warnings.filter((x) => x.rule === 'student-records');
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe(`Files in STAT201/grades/ were left out as student records (2 files), and the scan never read them. Remove student records from course folders. ${RENAME_FOLDER}`);
    expect(RENAME_FOLDER).toBe('If this folder holds course material, not student records, rename it and drop the zip again.');
    const r = buildReport(p.name, p.leftOut, p.warnings, [scanDocument(p, 'STAT201/main.tex', idx)], idx.data, new Date('2026-11-20T12:00:00Z'), p.leftOutFolders);
    expect(count(reportHtml(r))).toBe(1);
    expect(count(reportJson(r))).toBe(1);
  });

  it('twice for two folders, one sentence each, and never for a file named so', () => {
    const p = openProject('two.zip', rawZip([
      { name: 'main.tex', data: DOC },
      { name: 'grades/a.csv', data: 'x' },
      { name: 'grades/b.csv', data: 'x' },
      { name: 'roster/c.csv', data: 'x' },
      { name: 'students.csv', data: 'x' },
    ]));
    const msgs = p.warnings.filter((x) => x.rule === 'student-records').map((x) => x.message);
    expect(msgs.map(count)).toEqual([1, 1, 0]);
    expect(msgs[0]).toMatch(/^Files in grades\//);
    expect(msgs[1]).toMatch(/^Files in roster\//);
  });
});

describe('AC-78: a zip whose only documents were left out with their folder', () => {
  const calc = (folder: string) =>
    rawZip([
      { name: `${folder}/week1.tex`, data: DOC },
      { name: `${folder}/week2.tex`, data: DOC },
    ]);

  it('says so after "No .tex file …", names the folder, and shows its warning', async () => {
    const p = openProject('calc.zip', calc('Calculus-for-students'));
    expect(await findMainFiles(p)).toEqual([]);
    expect(leftOutDocumentsLines(p)).toEqual(['2 files in Calculus-for-students/ were left out as student records; see the warning below to have them read.']);
    expect(noMainMessage(p)).toBe(
      'No .tex file with \\documentclass was found. 2 files in Calculus-for-students/ were left out as student records; see the warning below to have them read. A main file has a \\documentclass line and \\begin{document}.',
    );
    document.body.innerHTML = '<div id="app"></div>';
    const deps: AppDeps = { loadStatus: async () => idx, now: () => new Date(), session: null, download: () => {}, pause: async () => {} };
    const app = mountApp(document.getElementById('app') as HTMLElement, deps);
    await app.handleFile({ name: 'calc.zip', arrayBuffer: async () => calc('Calculus-for-students').slice().buffer });
    const err = document.getElementById('error') as HTMLElement;
    expect(err.querySelector('p')?.textContent).toBe(noMainMessage(p));
    expect(err.querySelector('.project-warnings')?.textContent).toContain(`Files in Calculus-for-students/ were left out as student records (2 files)`);
    expect(count(err.textContent ?? '')).toBe(1);
  });

  it('is unchanged for a zip with no .tex file and no left-out folder, and for one whose folder holds no .tex', () => {
    const none = openProject('n.zip', rawZip([{ name: 'readme.txt', data: 'x' }]));
    expect(noMainMessage(none)).toBe('No .tex file with \\documentclass was found. A main file has a \\documentclass line and \\begin{document}.');
    const csvOnly = openProject('c.zip', rawZip([{ name: 'readme.txt', data: 'x' }, { name: 'grades/a.csv', data: 'x' }]));
    expect(leftOutDocumentsLines(csvOnly)).toEqual([]);
    const one = openProject('o.zip', rawZip([{ name: 'students/a.tex', data: DOC }]));
    expect(leftOutDocumentsLines(one)).toEqual(['1 file in students/ was left out as student records; see the warning below to have them read.']);
  });
});

describe('AC-79: the folder rule leaves out the same files as before CR-6', () => {
  const zip = () =>
    rawZip([
      { name: 'CS142/main.tex', data: DOC },
      { name: 'CS142/grades/midterm-feedback.tex', data: 'SECRET' },
      { name: 'CS142/grades/hw1.txt', data: 'SECRET' },
      { name: 'CS142/grades/midterm-scores.pdf', data: 'SECRET' },
      { name: 'STAT201/Gradebook/a.tex', data: 'SECRET' },
      { name: 'STAT201/grade-book/b.csv', data: 'SECRET' },
      { name: 'STAT201/roster/c.csv', data: 'SECRET' },
      { name: 'STAT201/students/d.csv', data: 'SECRET' },
      { name: 'Calculus-for-students/week1.tex', data: 'SECRET' },
      { name: 'Calculus-for-students/week2.tex', data: 'SECRET' },
      { name: 'MATH124/Students Version/hw1.tex', data: 'SECRET' },
      { name: 'MATH124/solutions/hw1-sol.tex', data: DOC },
    ]);

  it('same files, same counts, none in any zip the app builds', async () => {
    const p = openProject('all.zip', zip());
    expect(p.paths.sort()).toEqual(['CS142/main.tex', 'MATH124/solutions/hw1-sol.tex']);
    expect(p.leftOutFolders).toEqual([
      { folder: 'CS142/grades/', files: 3 },
      { folder: 'STAT201/Gradebook/', files: 1 },
      { folder: 'STAT201/grade-book/', files: 1 },
      { folder: 'STAT201/roster/', files: 1 },
      { folder: 'STAT201/students/', files: 1 },
      { folder: 'Calculus-for-students/', files: 2 },
      { folder: 'MATH124/Students Version/', files: 1 },
    ]);
    expect(p.leftOut).toHaveLength(10);
    expect(await findMainFiles(p)).toEqual(['CS142/main.tex', 'MATH124/solutions/hw1-sol.tex']);
    for (const out of [projectZip(p), projectZip(p, { changes: new Map([['CS142/main.tex', 'x']]), extra: new Map([['tagging-doctor.diff', '']]) })]) {
      const files = unzipSync(out);
      expect(Object.keys(files).filter((f) => f !== 'tagging-doctor.diff').sort()).toEqual(['CS142/main.tex', 'MATH124/solutions/hw1-sol.tex']);
      expect(Object.values(files).map((b) => strFromU8(b)).join('')).not.toContain('SECRET');
    }
  });

  it('a renamed folder is read, listed, and gives no folder warning', async () => {
    const p = openProject('calc.zip', rawZip([
      { name: 'Calculus/week1.tex', data: DOC },
      { name: 'Calculus/week2.tex', data: DOC },
    ]));
    expect(await findMainFiles(p)).toEqual(['Calculus/week1.tex', 'Calculus/week2.tex']);
    expect(p.warnings).toEqual([]);
    expect(p.leftOutFolders).toEqual([]);
  });
});
