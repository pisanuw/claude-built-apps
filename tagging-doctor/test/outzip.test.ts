import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { projectZip } from '../src/core/outzip';
import { openProject } from '../src/core/project';
import { zipFixture } from './helpers';

describe('AC-15: the upload zip and the patched zip hold no student records', () => {
  const p = openProject('students.zip', zipFixture('students'));

  it('leaves every flagged file out of the upload zip', () => {
    const out = unzipSync(projectZip(p));
    expect(Object.keys(out)).toEqual(['main.tex']);
    for (const f of p.leftOut) expect(out[f]).toBeUndefined();
    const all = Object.values(out).map((b) => strFromU8(b)).join('\n');
    expect(all).not.toMatch(/SECRET/);
  });

  it('leaves them out of a patched zip too, with the changes and the diff', () => {
    const out = unzipSync(projectZip(p, {
      changes: new Map([['main.tex', 'patched']]),
      extra: new Map([['tagging-doctor.diff', '--- a\n+++ b\n']]),
    }));
    expect(Object.keys(out).sort()).toEqual(['main.tex', 'tagging-doctor.diff']);
    expect(strFromU8(out['main.tex'])).toBe('patched');
    expect(Object.values(out).map((b) => strFromU8(b)).join('\n')).not.toMatch(/SECRET/);
  });

  it('keeps only what an allowlist accepts', () => {
    const q = openProject('figures.zip', zipFixture('figures'));
    const out = unzipSync(projectZip(q, { include: (x) => x.endsWith('.tex') }));
    expect(Object.keys(out)).toEqual(['main.tex']);
  });

  it('is the same bytes each time', () => {
    expect(projectZip(p)).toEqual(projectZip(p));
  });
});
