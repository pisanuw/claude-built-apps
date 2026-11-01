import { describe, expect, it } from 'vitest';
import { compileSampler } from '../src/core/compile';
import { enumerateExact } from '../src/core/exact';
import { GALLERY, galleryEntry } from '../src/core/gallery';
import { exactReport } from '../src/core/report';
import { targetDistribution } from '../src/core/target';

describe('bug gallery', () => {
  it('has unique ids and a lookup', () => {
    expect(new Set(GALLERY.map((g) => g.id)).size).toBe(GALLERY.length);
    expect(galleryEntry('modulo')?.title).toBe('Modulo bias');
    expect(galleryEntry('nope')).toBeUndefined();
  });
  for (const g of GALLERY) {
    it(`${g.id}: broken is biased, fixed is exact`, () => {
      const target = targetDistribution(g.target);
      const broken = enumerateExact(compileSampler(g.broken), g.args, { bits: g.bits });
      const fixed = enumerateExact(compileSampler(g.fixed), g.args, { bits: g.bits });
      if (!broken.ok || !fixed.ok) throw new Error('enumeration failed');
      expect(exactReport(broken, target).exactMatch).toBe(false);
      expect(exactReport(fixed, target).exactMatch).toBe(true);
    });
  }
});
