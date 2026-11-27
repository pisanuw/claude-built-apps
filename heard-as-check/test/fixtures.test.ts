/**
 * AC-3: the fixture generator writes the same bytes twice, and veraPDF.json
 * holds a veraPDF result for every fixture made so far, for those exact bytes;
 * a fixture marked mustPass is compliant. The entries come from the hub image's
 * veraPDF 1.30.4 (test/fixtures/verapdf.ts, run in the spike image), so a change
 * to the generator fails here until veraPDF has been run on the new bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { codeOf, FIXTURES, generateAll, pdfText, writePdf, type Made } from './fixtures/generate';

const SPIKE_SET = ['basic', 'roles', 'five-pages', 'stress', 'big-tree', 'rtl-reversed', 'good-rtl', 'control-rowspan'];
const vera = JSON.parse(fs.readFileSync('test/fixtures/veraPDF.json', 'utf8')) as Record<string, { sha256: string; bytes: number; pages: number; mustPass: boolean; compliant: boolean; profile: string; verapdf: string; failedClauses: string[] }>;

let first: Made[];
let second: Made[];
beforeAll(() => {
  first = generateAll(fs.mkdtempSync(path.join(os.tmpdir(), 'hac-fx1-')));
  second = generateAll(fs.mkdtempSync(path.join(os.tmpdir(), 'hac-fx2-')));
}, 120_000);

describe('AC-3: the fixture generator', () => {
  it('makes milestone 1\'s eight fixtures, the ones the spike uses', () => {
    expect(FIXTURES.map((f) => f.name)).toEqual(SPIKE_SET);
  });

  it('writes every fixture with the same sha256 twice', () => {
    expect(second.map((m) => [m.name, m.sha256])).toEqual(first.map((m) => [m.name, m.sha256]));
    for (const m of first) expect(fs.readFileSync(m.file).equals(fs.readFileSync(second.find((s) => s.name === m.name)!.file)), m.name).toBe(true);
  });

  it('keeps the sizes the spike relies on: stress has 60 pages within 10 MB, big-tree within 10 MB', () => {
    const stress = first.find((m) => m.name === 'stress')!;
    expect(stress.pages).toBe(60);
    expect(stress.bytes).toBeLessThanOrEqual(10_000_000);
    expect(stress.bytes).toBeGreaterThan(9_000_000);
    expect(first.find((m) => m.name === 'big-tree')!.bytes).toBeLessThanOrEqual(10_000_000);
    expect(first.find((m) => m.name === 'five-pages')!.pages).toBe(5);
  });

  it('every fixture has a veraPDF entry for its exact bytes', () => {
    expect(Object.keys(vera).sort()).toEqual([...SPIKE_SET].sort());
    for (const m of first) {
      const e = vera[m.name];
      expect(e, m.name).toBeDefined();
      expect(e.sha256, `${m.name}: run test/fixtures/verapdf.ts after changing the generator`).toBe(m.sha256);
      expect(e.bytes).toBe(m.bytes);
      expect(e.profile).toBe('PDF/UA-1');
      expect(e.verapdf).toBe('1.30.4');
    }
  });

  it('a fixture marked mustPass is compliant; the entries carry the generator\'s marks', () => {
    for (const f of FIXTURES) {
      expect(vera[f.name].mustPass, f.name).toBe(f.mustPass);
      if (f.mustPass) expect(vera[f.name].compliant, f.name).toBe(true);
    }
    // roles has a figure without alt text: PDF/UA-1 clause 7.3 fails, and only that.
    expect(vera.roles).toMatchObject({ compliant: false, failedClauses: ['7.3-1'] });
    // The fulgur case passes the validator (SPEC AC-53).
    expect(vera['rtl-reversed'].compliant).toBe(true);
  });
});

describe('the writer', () => {
  it('stores visual-order text reversed and logical text as is', () => {
    const doc = (visual: boolean) => writePdf({ title: 't', lang: 'en', root: { role: 'Document', kids: [{ role: 'P', kids: [{ text: 'אב', visual }] }] } }).toString('latin1');
    expect(doc(false)).toContain('<A0A1> Tj');
    expect(doc(true)).toContain('<A1A0> Tj');
  });

  it('refuses a character the fixture font has no glyph for, rather than writing a wrong one', () => {
    expect(codeOf('A')).toBe(65);
    expect(codeOf('ש')).toBe(160 + 0x05e9 - 0x05d0);
    expect(() => codeOf('ب')).toThrow(/no glyph for U\+0628/);
    expect(() => writePdf({ title: 't', lang: 'en', root: { role: 'Document', kids: [{ role: 'P', kids: [{ text: 'é' }] }] } })).toThrow(/U\+00E9/);
  });

  it('writes text strings as UTF-16BE with a byte order mark', () => {
    expect(pdfText('he')).toBe('<FEFF00680065>');
  });

  it('refuses a table cell holding anything but text', () => {
    expect(() =>
      writePdf({ title: 't', lang: 'en', root: { role: 'Document', kids: [{ role: 'Table', kids: [{ role: 'TR', kids: [{ role: 'TD', kids: [{ role: 'P', kids: [] }] }] }] }] } }),
    ).toThrow(/text only/);
  });
});
