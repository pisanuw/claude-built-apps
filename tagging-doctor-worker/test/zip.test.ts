import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWED_EXTENSIONS, allowedType, badMainFile, badPath, inspectUpload, readEntry, unpack, UploadError } from '../src/zip.ts';
import { makeZip } from './zipmaker.ts';

const DOC = '\\documentclass{article}\\begin{document}x\\end{document}';
const kind = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(UploadError);
    return { kind: (e as UploadError).kind, message: (e as Error).message };
  }
  throw new Error('no error');
};

describe('AC-32: the upload check', () => {
  it('accepts a project and returns its entries', () => {
    const z = makeZip([{ name: 'main.tex', data: DOC }, { name: 'figs/' }, { name: 'figs/a.PNG', data: 'png', method: 8 }]);
    const entries = inspectUpload(z, 'main.tex');
    expect(entries.map((e) => e.name)).toEqual(['main.tex', 'figs/', 'figs/a.PNG']);
    expect(entries[1].isDirectory).toBe(true);
  });

  it('rejects what is not a zip, and a damaged zip', () => {
    expect(kind(() => inspectUpload(new Uint8Array(10), 'm.tex')).kind).toBe('not-zip');
    expect(kind(() => inspectUpload(new TextEncoder().encode('x'.repeat(40)), 'm.tex')).kind).toBe('not-zip');
    const z = makeZip([{ name: 'main.tex', data: DOC }]);
    const cut = z.slice(0, z.length - 22); // no end record
    expect(kind(() => inspectUpload(cut, 'main.tex')).kind).toBe('damaged');
    const bad = z.slice();
    const v = new DataView(bad.buffer);
    v.setUint32(bad.length - 22 + 16, bad.length, true); // directory offset past the end
    expect(kind(() => inspectUpload(bad, 'main.tex')).kind).toBe('damaged');
    const broken = z.slice();
    new DataView(broken.buffer).setUint32(30 + 8 + DOC.length, 0, true); // central signature
    expect(kind(() => inspectUpload(broken, 'main.tex')).kind).toBe('damaged');
  });

  it('rejects path traversal, absolute paths and odd names, each with its name', () => {
    for (const name of ['../x.tex', 'a/../../x.tex', '/etc/x.tex', 'C:/x.tex', 'a/./b.tex', 'a//b.tex', 'a\\..\\x.tex']) {
      const r = kind(() => inspectUpload(makeZip([{ name: 'main.tex', data: DOC }, { name, data: 'x' }]), 'main.tex'));
      expect(r.kind, name).toBe('path');
      expect(r.message).toContain(JSON.stringify(name.replace(/\\/g, '/')).slice(0, 10));
    }
    expect(badPath('a\u0001.tex')).toMatch(/control/);
    expect(badPath('')).toMatch(/empty/);
    expect(badPath('ok/fine.tex')).toBeNull();
  });

  it('rejects symlinks', () => {
    const r = kind(() => inspectUpload(makeZip([{ name: 'main.tex', data: DOC }, { name: 'link.tex', data: '/etc/passwd', symlink: true }]), 'main.tex'));
    expect(r).toEqual({ kind: 'symlink', message: '"link.tex" is a symbolic link; links are not accepted.' });
  });

  it('rejects more than 2000 entries and more than 100 MB uncompressed', () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.tex`, data: '' }));
    expect(kind(() => inspectUpload(makeZip(many), 'f0.tex'))).toEqual({ kind: 'too-many-entries', message: 'The zip has more than 2000 entries.' });
    const big = makeZip([{ name: 'main.tex', data: DOC }, { name: 'a.pdf', data: 'x', declaredSize: 60 * 1024 * 1024 }, { name: 'b.pdf', data: 'x', declaredSize: 60 * 1024 * 1024 }]);
    expect(kind(() => inspectUpload(big, 'main.tex'))).toEqual({ kind: 'too-much-uncompressed', message: 'The zip expands to more than 100 MB.' });
  });

  it('rejects any file type not on the allowlist, and accepts every one on it', () => {
    for (const name of ['run.sh', 'a.exe', 'latexmkrc', '.latexmkrc', 'x.lua', 'grades.csv', 'a.tex.sh', 'figs/.png']) {
      const r = kind(() => inspectUpload(makeZip([{ name: 'main.tex', data: DOC }, { name, data: 'x' }]), 'main.tex'));
      expect(r.kind, name).toBe('file-type');
      expect(r.message).toContain('.tex .sty .cls');
    }
    for (const ext of ALLOWED_EXTENSIONS) expect(allowedType(`a/b${ext.toUpperCase()}`), ext).toBe(true);
    expect(ALLOWED_EXTENSIONS).toHaveLength(22);
  });

  it('rejects a main file that is missing or starts with -, & or \\ (400 messages)', () => {
    const z = makeZip([{ name: 'main.tex', data: DOC }, { name: '-x.tex', data: DOC }, { name: 'notes.txt', data: 'x' }]);
    expect(kind(() => inspectUpload(z, 'other.tex'))).toEqual({ kind: 'main-file', message: 'The main file "other.tex" is not in the zip.' });
    expect(kind(() => inspectUpload(z, '-x.tex')).message).toBe('The main file "-x.tex" may not start with -, & or \\.');
    expect(kind(() => inspectUpload(z, '&x.tex')).kind).toBe('main-file');
    expect(kind(() => inspectUpload(z, '\\input x.tex')).kind).toBe('main-file');
    expect(kind(() => inspectUpload(z, '')).message).toBe('No main file was named.');
    expect(kind(() => inspectUpload(z, 'notes.txt')).message).toBe('The main file must be a .tex file.');
    expect(badMainFile('sub/main.tex', new Set(['sub/main.tex']))).toBeNull();
  });

  it('rejects encryption, duplicates, a file inside a file, and unknown methods', () => {
    expect(kind(() => inspectUpload(makeZip([{ name: 'main.tex', data: DOC, encrypted: true }]), 'main.tex')).kind).toBe('encrypted');
    expect(kind(() => inspectUpload(makeZip([{ name: 'main.tex', data: DOC }, { name: 'main.tex', data: DOC }]), 'main.tex')).kind).toBe('duplicate');
    expect(kind(() => inspectUpload(makeZip([{ name: 'a.tex', data: DOC }, { name: 'a.tex/b.tex', data: DOC }]), 'a.tex')).kind).toBe('duplicate');
    expect(kind(() => inspectUpload(makeZip([{ name: 'main.tex', data: DOC, methodNumber: 12 }]), 'main.tex')).kind).toBe('damaged');
  });
});

describe('unpacking a job', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('writes the files and folders under the job folder', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tdw-'));
    const z = makeZip([{ name: 'main.tex', data: DOC, method: 8 }, { name: 'sub/' }, { name: 'sub/a.tex', data: 'A' }, { name: 'deep/x/y.bib', data: '' }]);
    unpack(z, inspectUpload(z, 'main.tex'), dir);
    expect(readFileSync(path.join(dir, 'main.tex'), 'utf8')).toBe(DOC);
    expect(readFileSync(path.join(dir, 'sub/a.tex'), 'utf8')).toBe('A');
    expect(existsSync(path.join(dir, 'deep/x/y.bib'))).toBe(true);
  });

  it('stops an entry that inflates past its declared size (a zip bomb), and a short one', () => {
    const bomb = makeZip([{ name: 'main.tex', data: 'x'.repeat(100_000), method: 8, declaredSize: 10 }]);
    const entries = inspectUpload(bomb, 'main.tex');
    expect(kind(() => readEntry(bomb, entries[0]))).toEqual({ kind: 'bomb', message: 'main.tex expands to more than the size the zip lists for it.' });
    const zero = makeZip([{ name: 'main.tex', data: 'abc', method: 8, declaredSize: 0 }]);
    expect(kind(() => readEntry(zero, inspectUpload(zero, 'main.tex')[0])).kind).toBe('bomb');
    const short = makeZip([{ name: 'main.tex', data: 'abc', method: 8, declaredSize: 10 }]);
    expect(kind(() => readEntry(short, inspectUpload(short, 'main.tex')[0])).kind).toBe('damaged');
    const stored = makeZip([{ name: 'main.tex', data: 'abc', declaredSize: 5 }]);
    expect(kind(() => readEntry(stored, inspectUpload(stored, 'main.tex')[0])).kind).toBe('damaged');
    const empty = makeZip([{ name: 'main.tex', data: '', method: 8 }]);
    expect(readEntry(empty, inspectUpload(empty, 'main.tex')[0])).toHaveLength(0);
  });

  it('reports damage inside an entry', () => {
    const z = makeZip([{ name: 'main.tex', data: 'hello world', method: 8 }]);
    const entries = inspectUpload(z, 'main.tex');
    const garbled = z.slice();
    garbled.fill(0xff, 30 + 'main.tex'.length, 30 + 'main.tex'.length + 4);
    expect(kind(() => readEntry(garbled, entries[0])).kind).toBe('damaged');
    expect(kind(() => readEntry(z, { ...entries[0], localHeaderOffset: 5 })).kind).toBe('damaged');
    expect(kind(() => readEntry(z, { ...entries[0], compressedSize: 10_000 })).kind).toBe('damaged');
  });

  it('refuses an entry that would leave the folder even if the check were skipped', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tdw-'));
    const z = makeZip([{ name: 'main.tex', data: DOC }]);
    const [e] = inspectUpload(z, 'main.tex');
    expect(kind(() => unpack(z, [{ ...e, name: '../escape.tex' }], dir)).kind).toBe('path');
  });
});
