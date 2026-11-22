/**
 * CR-11: the two zips the owner runs through the live app for AC-68's timed
 * jobs (fixtures/ac68, made by scripts/make-ac68-zips.py). They must be the
 * math-notes fixture, the second with `scripts/spike.sh tagged`'s line, and
 * pass the checker's own upload check, so the owner's run measures the job the
 * spike measured.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedType, inspectUpload, readEntry } from '../src/zip.ts';

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'fixtures', 'math-notes');
const TAGGED_LINE = '\\DocumentMetadata{lang=en-US, pdfversion=2.0, pdfstandard=ua-2, tagging=on}\n';

function fixtureFiles(rel = ''): string[] {
  return readdirSync(path.join(FIXTURE, rel)).flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return statSync(path.join(FIXTURE, r)).isDirectory() ? fixtureFiles(r) : [r];
  });
}

function zipFiles(name: string): Map<string, Buffer> {
  const bytes = new Uint8Array(readFileSync(path.join(ROOT, 'fixtures', 'ac68', name)));
  const entries = inspectUpload(bytes, 'main.tex');
  return new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.name, Buffer.from(readEntry(bytes, e))]));
}

describe('CR-11: the zips for AC-68\'s timed jobs', () => {
  it('spike.sh\'s tagged line is the one AC-68 names', () => {
    const spike = readFileSync(path.join(ROOT, 'scripts', 'spike.sh'), 'utf8');
    expect(spike).toContain(`'${TAGGED_LINE.trim()}'`);
  });

  for (const [name, tagged] of [['math-notes.zip', false], ['math-notes-tagged.zip', true]] as const) {
    it(`${name}: passes the checker's upload check and holds the fixture${tagged ? ', with the tagged line first' : ''}`, () => {
      const files = zipFiles(name);
      expect([...files.keys()].sort()).toEqual(fixtureFiles().sort());
      for (const n of files.keys()) expect(allowedType(n), n).toBe(true);
      for (const [n, data] of files) {
        const want = readFileSync(path.join(FIXTURE, n));
        expect(data.equals(tagged && n === 'main.tex' ? Buffer.concat([Buffer.from(TAGGED_LINE), want]) : want), n).toBe(true);
      }
    });
  }
});
