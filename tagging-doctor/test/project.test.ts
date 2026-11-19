import { describe, expect, it, vi } from 'vitest';
import { isStudentRecord, isUnsafePath, MAX_TEXT_BYTES, openProject } from '../src/core/project';
import * as zip from '../src/core/zip';
import { rawZip, text, zipFixture } from './helpers';

describe('openProject', () => {
  it('opens a single .tex file as a project of one file', () => {
    const p = openProject('notes/lecture.tex', text('\\documentclass{article}'));
    expect(p.paths).toEqual(['lecture.tex']);
    expect(p.text('lecture.tex')).toBe('\\documentclass{article}');
    expect(p.size('lecture.tex')).toBe(23);
    expect(p.size('nope')).toBe(0);
    expect(() => p.bytes('nope')).toThrow();
  });

  it('refuses a single .tex over 20 MB and one named like a student record', () => {
    expect(() => openProject('big.tex', new Uint8Array(zip.LIMITS.maxFileBytes + 1))).toThrow(zip.ZipError);
    expect(() => openProject('roster.tex', text('x'))).toThrow(/student record/);
  });

  it('skips ../ and absolute entries with a warning (AC-6)', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'main.tex', data: 'x' },
      { name: '../evil.tex', data: 'x' },
      { name: 'a/../../evil2.tex', data: 'x' },
      { name: '/etc/evil3', data: 'x' },
      { name: 'C:/evil4', data: 'x' },
      { name: './ok.tex', data: 'y' },
      { name: '__MACOSX/._main.tex', data: 'x' },
      { name: 'sub/.DS_Store', data: 'x' },
    ]));
    expect(p.paths).toEqual(['main.tex', 'ok.tex']);
    expect(p.warnings.filter((w) => w.rule === 'unsafe-path').map((w) => w.path)).toEqual(['../evil.tex', 'a/../../evil2.tex', '/etc/evil3', 'C:/evil4']);
    expect(p.warnings[0].message).toMatch(/Skipped \.\.\/evil\.tex: its path points outside the zip/);
  });

  it('leaves student records out and never inflates them (AC-15)', () => {
    const spy = vi.spyOn(zip, 'readEntry');
    const p = openProject('students.zip', zipFixture('students'));
    expect(p.leftOut.sort()).toEqual(['Gradebook_Fall.xlsx', 'data/roster.txt', 'grades.csv', 'students.tex']);
    expect(p.paths).toEqual(['main.tex']);
    expect(spy).not.toHaveBeenCalled();
    p.text('main.tex');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].name).toBe('main.tex');
    const w = p.warnings.find((x) => x.rule === 'student-records');
    expect(w?.message).toMatch(/^Remove student records from course folders: .*left them out and never read them\.$/);
    spy.mockRestore();
  });

  it('words the student-record warning for one file', () => {
    const p = openProject('p.zip', rawZip([{ name: 'roster.csv', data: 'x' }, { name: 'a.tex', data: 'x' }]));
    expect(p.warnings[0].message).toMatch(/roster\.csv is named like grades or rosters, so the scan left it out and never read it\./);
  });

  it('reads text once, and warns for a file too large or damaged', () => {
    const p = openProject('p.zip', rawZip([
      { name: 'big.tex', data: 'x', declaredSize: MAX_TEXT_BYTES + 1 },
      { name: 'bad.tex', data: 'abc', method: 12 },
      { name: 'ok.tex', data: '\uFEFFhello' },
    ]));
    expect(p.text('big.tex')).toBeNull();
    expect(p.text('bad.tex')).toBeNull();
    expect(p.text('missing.tex')).toBeNull();
    expect(p.text('ok.tex')).toBe('hello');
    expect(p.text('ok.tex')).toBe('hello');
    expect(p.warnings.map((w) => w.rule)).toEqual(['too-large-to-read', 'unreadable']);
  });

  it('stops the whole scan on a zip bomb', () => {
    const p = openProject('p.zip', rawZip([{ name: 'a.tex', data: new Uint8Array(4 * 1024 * 1024), method: 8, declaredSize: 10 }]));
    expect(() => p.text('a.tex')).toThrow(/expands to more than the size/);
  });

  it('refuses what the zip reader refuses', () => {
    expect(() => openProject('notes.pdf', text('%PDF-1.7'))).toThrow(/not a zip or a \.tex file/);
  });
});

describe('isStudentRecord (AC-15)', () => {
  it.each([
    ['grades.csv', true],
    ['Grades.xlsx', true],
    ['data/gradebook', true],
    ['gradebooks.json', true],
    ['class_roster.pdf', true],
    ['rosters.txt', true],
    ['students.tex', true],
    ['fall-students-list.csv', true],
    ['student-handout.tex', false],
    ['upgrades.tex', false],
    ['grade-scale.tex', false],
    ['main.tex', false],
  ])('%s -> %s', (name, want) => {
    expect(isStudentRecord(name)).toBe(want);
  });
});

describe('isUnsafePath', () => {
  it('flags absolute and climbing paths only', () => {
    expect(isUnsafePath('a/b.tex')).toBe(false);
    expect(isUnsafePath('a/..b/c')).toBe(false);
    expect(isUnsafePath('a/../b')).toBe(true);
    expect(isUnsafePath('/x')).toBe(true);
    expect(isUnsafePath('d:/x')).toBe(true);
  });
});
