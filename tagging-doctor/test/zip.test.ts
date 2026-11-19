import { describe, expect, it } from 'vitest';
import { LIMITS, looksLikeZip, readDirectory, readEntry, ZipError } from '../src/core/zip';
import { rawZip, text } from './helpers';

function kindOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZipError) return e.kind;
    throw e;
  }
  return 'none';
}

describe('readDirectory (AC-6)', () => {
  it('reads a stored and a deflated entry', () => {
    const z = rawZip([
      { name: 'a.tex', data: 'stored' },
      { name: 'b.tex', data: 'deflated '.repeat(50), method: 8 },
      { name: 'dir/', data: '' },
    ]);
    const d = readDirectory(z);
    expect(d.map((e) => e.name)).toEqual(['a.tex', 'b.tex', 'dir/']);
    expect(d[2].isDirectory).toBe(true);
    expect(new TextDecoder().decode(readEntry(z, d[0]))).toBe('stored');
    expect(new TextDecoder().decode(readEntry(z, d[1]))).toBe('deflated '.repeat(50));
  });

  it('turns backslashes in names into slashes', () => {
    expect(readDirectory(rawZip([{ name: 'ch\\a.tex', data: 'x' }]))[0].name).toBe('ch/a.tex');
  });

  it('refuses a file that is not a zip, with its own message', () => {
    expect(kindOf(() => readDirectory(text('hello, not a zip')))).toBe('not-zip');
    expect(kindOf(() => readDirectory(new Uint8Array(2)))).toBe('not-zip');
    expect(looksLikeZip(new Uint8Array(0))).toBe(false);
  });

  it('refuses a zip over 20 MB before reading it', () => {
    const big = new Uint8Array(LIMITS.maxFileBytes + 1);
    big.set([0x50, 0x4b, 3, 4]);
    expect(kindOf(() => readDirectory(big))).toBe('too-big');
  });

  it('refuses a zip with more than 2000 entries', () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.txt`, data: '' }));
    expect(kindOf(() => readDirectory(rawZip(many)))).toBe('too-many-entries');
    expect(kindOf(() => readDirectory(rawZip([{ name: 'a', data: '' }], { count: 0xffff })))).toBe('too-many-entries');
    expect(readDirectory(rawZip(many.slice(0, 2000)))).toHaveLength(2000);
  });

  it('refuses a zip whose declared sizes pass 100 MB, before inflating anything', () => {
    const z = rawZip([
      { name: 'a.png', data: 'x', declaredSize: 60 * 1024 * 1024 },
      { name: 'b.png', data: 'x', declaredSize: 50 * 1024 * 1024 },
    ]);
    expect(kindOf(() => readDirectory(z))).toBe('too-much-uncompressed');
  });

  it('refuses a password-protected zip', () => {
    expect(kindOf(() => readDirectory(rawZip([{ name: 'a.tex', data: 'x', flags: 1 }])))).toBe('encrypted');
  });

  it('says a zip is damaged when its directory is missing or wrong', () => {
    const z = rawZip([{ name: 'a.tex', data: 'x' }]);
    expect(kindOf(() => readDirectory(z.subarray(0, z.length - 22)))).toBe('damaged');
    expect(kindOf(() => readDirectory(rawZip([{ name: 'a.tex', data: 'x' }], { cdOffset: 5 })))).toBe('damaged');
    expect(kindOf(() => readDirectory(rawZip([{ name: 'a.tex', data: 'x' }], { cdOffset: 0xffffffff })))).toBe('too-many-entries');
  });
});

describe('readEntry (AC-6)', () => {
  it('stops as soon as the real output passes the declared size', () => {
    // 8 MB of zeros deflates to a few kB; the directory claims 100 bytes.
    const z = rawZip([{ name: 'bomb.tex', data: new Uint8Array(8 * 1024 * 1024), method: 8, declaredSize: 100 }]);
    const [e] = readDirectory(z);
    expect(kindOf(() => readEntry(z, e))).toBe('bomb');
  });

  it('says an entry is damaged when it is shorter than declared, cut short or unreadable', () => {
    const short = rawZip([{ name: 'a.tex', data: 'abc', method: 8, declaredSize: 10 }]);
    expect(kindOf(() => readEntry(short, readDirectory(short)[0]))).toBe('damaged');
    const stored = rawZip([{ name: 'a.tex', data: 'abc', declaredSize: 10 }]);
    expect(kindOf(() => readEntry(stored, readDirectory(stored)[0]))).toBe('damaged');
    const z = rawZip([{ name: 'a.tex', data: 'abc' }]);
    const e = readDirectory(z)[0];
    expect(kindOf(() => readEntry(z, { ...e, localHeaderOffset: 7 }))).toBe('damaged');
    expect(kindOf(() => readEntry(z, { ...e, compressedSize: 1e6 }))).toBe('damaged');
    const junk = rawZip([{ name: 'a.tex', data: new Uint8Array([0xff, 0xff, 0xff, 0xff]), method: 0 }]);
    const je = { ...readDirectory(junk)[0], method: 8, uncompressedSize: 4 };
    expect(kindOf(() => readEntry(junk, je))).toBe('damaged');
  });

  it('refuses compression methods other than stored and deflate', () => {
    const z = rawZip([{ name: 'a.tex', data: 'abc', method: 12 }]);
    expect(kindOf(() => readEntry(z, readDirectory(z)[0]))).toBe('damaged');
  });

  it('reads an empty deflated entry', () => {
    const z = rawZip([{ name: 'a.tex', data: '', method: 8 }]);
    expect(readEntry(z, readDirectory(z)[0])).toHaveLength(0);
  });
});
