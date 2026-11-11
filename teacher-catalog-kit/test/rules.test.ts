import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseCents } from '../src/core/money';
import { checkResource, PRODUCT_TYPES, productType, verdict, type ProductTypeId } from '../src/core/rules';
import { isUuid, normalizeResource, safeUrl, storeLabel, type Listing, type Resource } from '../src/core/types';

function res(productType: ProductTypeId, tptPriceCents: number | null, listings: Listing[]): Resource {
  return { id: 'r1', title: 'Fractions task cards', productType, tptPriceCents, tptId: null, listings, notes: '', createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' };
}

const codes = (f: { code: string }[]) => f.map((x) => x.code);

describe('milestone 1 acceptance', () => {
  it('flags a digital worksheet listed on Payhip under Exclusive', () => {
    const c = checkResource(res('digital-education', 400, [{ store: 'payhip', priceCents: 400 }]), storeLabel);
    expect(verdict(c.exclusive)).toBe('conflict');
    expect(codes(c.exclusive)).toEqual(['exclusive-not-allowed']);
    expect(c.exclusive[0].message).toContain('Payhip');
    expect(verdict(c.basic)).toBe('ok');
  });

  it('does not flag a clip-art set on Payhip under Exclusive', () => {
    const c = checkResource(res('non-teaching-digital', 600, [{ store: 'payhip', priceCents: 600 }]));
    expect(c.exclusive).toEqual([]);
    expect(verdict(c.exclusive)).toBe('ok');
  });

  it('flags a lower price elsewhere under Basic', () => {
    const c = checkResource(res('digital-education', 500, [{ store: 'etsy', priceCents: 400 }]), storeLabel);
    expect(codes(c.basic)).toEqual(['basic-lower-elsewhere']);
    expect(c.basic[0].message).toContain('$5.00');
    expect(c.basic[0].message).toContain('$4.00');
    expect(verdict(c.basic)).toBe('conflict');
  });
});

describe('Exclusive rules', () => {
  it('treats licences and memberships like teaching resources', () => {
    for (const t of ['license', 'membership'] as const) {
      expect(codes(checkResource(res(t, 1000, [{ store: 'shopify', priceCents: 1000 }])).exclusive)).toEqual(['exclusive-not-allowed']);
    }
  });

  it('allows physical products and courses anywhere', () => {
    for (const t of ['physical', 'course'] as const) {
      expect(checkResource(res(t, 1000, [{ store: 'shopify', priceCents: 1000 }, { store: 'own-site', priceCents: 1000 }])).exclusive).toEqual([]);
    }
  });

  it('allows a free teaching resource off TPT when it is free on TPT too', () => {
    expect(checkResource(res('digital-education', 0, [{ store: 'tes', priceCents: 0 }])).exclusive).toEqual([]);
  });

  it('says how an own website may stay: a Buy button to TPT', () => {
    const c = checkResource(res('digital-education', 300, [{ store: 'own-site', priceCents: 300 }]));
    expect(codes(c.exclusive)).toEqual(['exclusive-own-site-checkout']);
    expect(c.exclusive[0].message).toMatch(/Buy button/);
  });

  it('asks for the price of an unpriced listing: free would be allowed', () => {
    const c = checkResource(res('digital-education', 300, [{ store: 'etsy', priceCents: null }]));
    expect(codes(c.exclusive)).toEqual(['exclusive-price-missing']);
    expect(verdict(c.exclusive)).toBe('check');
  });

  it('allows Boom Cards on Boom Learning and Kindle books on KDP, and asks to check elsewhere', () => {
    expect(checkResource(res('boom-cards', 400, [{ store: 'boom', priceCents: 400 }])).exclusive).toEqual([]);
    expect(checkResource(res('kindle', 400, [{ store: 'amazon-kdp', priceCents: 400 }])).exclusive).toEqual([]);
    const c = checkResource(res('kindle', 400, [{ store: 'payhip', priceCents: 400 }]), storeLabel);
    expect(codes(c.exclusive)).toEqual(['exclusive-wrong-platform']);
    expect(c.exclusive[0].message).toContain('Kindle books are allowed off TPT');
    expect(verdict(c.exclusive)).toBe('check');
  });

  it('asks the seller to pick a type when it is unknown', () => {
    const c = checkResource(res('other-digital', 400, [{ store: 'payhip', priceCents: 400 }]));
    expect(codes(c.exclusive)).toEqual(['exclusive-unknown-type']);
  });

  it('flags a teaching resource sold elsewhere even when it is not on TPT', () => {
    expect(codes(checkResource(res('digital-education', null, [{ store: 'payhip', priceCents: 400 }])).exclusive)).toEqual(['exclusive-not-allowed']);
  });
});

describe('Basic rules', () => {
  it('notes a higher price elsewhere without calling it a problem', () => {
    const c = checkResource(res('digital-education', 400, [{ store: 'etsy', priceCents: 500 }]));
    expect(codes(c.basic)).toEqual(['basic-higher-elsewhere']);
    expect(verdict(c.basic)).toBe('note');
  });

  it('asks for a missing price', () => {
    const c = checkResource(res('digital-education', 400, [{ store: 'etsy', priceCents: null }]));
    expect(codes(c.basic)).toEqual(['price-missing']);
    expect(verdict(c.basic)).toBe('check');
  });

  it('has nothing to compare when the resource is not on TPT', () => {
    expect(checkResource(res('digital-education', null, [{ store: 'etsy', priceCents: 100 }])).basic).toEqual([]);
  });

  it('flags a paid TPT resource that is free elsewhere, once per store, in both tiers', () => {
    const c = checkResource(res('non-teaching-digital', 400, [{ store: 'etsy', priceCents: 0 }, { store: 'tes', priceCents: 400 }]));
    expect(codes(c.basic)).toEqual(['free-elsewhere']);
    expect(codes(c.exclusive)).toEqual(['free-elsewhere']);
  });

  it('a teaching resource free elsewhere and paid on TPT breaks both tiers once', () => {
    const c = checkResource(res('digital-education', 400, [{ store: 'tes', priceCents: 0 }]));
    expect(codes(c.exclusive)).toEqual(['free-elsewhere']);
    expect(codes(c.basic)).toEqual(['free-elsewhere']);
  });

  it('matching prices are fine', () => {
    expect(checkResource(res('digital-education', 400, [{ store: 'etsy', priceCents: 400 }])).basic).toEqual([]);
  });
});

describe('rule table', () => {
  it('every type has a label, examples and a rule, and ids are unique', () => {
    const ids = new Set(PRODUCT_TYPES.map((t) => t.id));
    expect(ids.size).toBe(PRODUCT_TYPES.length);
    for (const t of PRODUCT_TYPES) expect(t.label && t.examples && t.rule).toBeTruthy();
  });

  it('falls back to the last type for an unknown id', () => {
    expect(productType('nope' as ProductTypeId).id).toBe('other-digital');
  });

  it('ranks verdicts', () => {
    expect(verdict([])).toBe('ok');
    expect(verdict([{ severity: 'note', code: 'basic-higher-elsewhere', message: '' }])).toBe('note');
    expect(verdict([{ severity: 'note', code: 'basic-higher-elsewhere', message: '' }, { severity: 'check', code: 'price-missing', message: '' }])).toBe('check');
  });
});

describe('money', () => {
  it('parses dollars to cents', () => {
    expect(parseCents('4.5')).toBe(450);
    expect(parseCents('$4.50')).toBe(450);
    expect(parseCents('4')).toBe(400);
    expect(parseCents('4,50')).toBe(450);
    expect(parseCents('1,250.00')).toBe(125000);
    expect(parseCents('0')).toBe(0);
    expect(parseCents('  ')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    expect(parseCents('-3')).toBeNull();
    expect(parseCents('4.555')).toBeNull();
    expect(parseCents('9'.repeat(20))).toBeNull();
    expect(parseCents('.99')).toBe(99);
    expect(parseCents('$.5')).toBe(50);
    expect(parseCents('.')).toBeNull();
    expect(parseCents('100000')).toBe(10_000_000);
    expect(parseCents('100000.01')).toBeNull();
    expect(parseCents('250000')).toBeNull();
  });

  it('formats cents', () => {
    expect(formatCents(450)).toBe('$4.50');
    expect(formatCents(0)).toBe('Free');
    expect(formatCents(null)).toBe('');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(centsToInput(450)).toBe('4.50');
    expect(centsToInput(null)).toBe('');
  });
});

describe('normalizeResource', () => {
  it('keeps a good resource', () => {
    const r = res('physical', 100, [{ store: 'etsy', priceCents: 100, url: 'https://etsy.com/x' }]);
    expect(normalizeResource(r)).toEqual(r);
  });

  it('drops malformed fields and duplicate stores', () => {
    const r = normalizeResource({
      id: 'a',
      title: '  Unit  ',
      productType: 'weird',
      tptPriceCents: -5,
      tptId: '',
      listings: [{ store: 'etsy', priceCents: 1.5, url: 'javascript:alert(1)' }, { store: 'etsy', priceCents: 3 }, { store: 'mars' }, null, 'x'],
      notes: 7,
    });
    expect(r).toMatchObject({ id: 'a', title: 'Unit', productType: 'other-digital', tptPriceCents: null, tptId: null, notes: '', listings: [{ store: 'etsy', priceCents: null }] });
    expect(r?.createdAt).toBe(new Date(0).toISOString());
    expect(r?.updatedAt).toBe(r?.createdAt);
  });

  it('refuses rows with no id or title', () => {
    expect(normalizeResource(null)).toBeNull();
    expect(normalizeResource('x')).toBeNull();
    expect(normalizeResource({ id: 'a', title: '   ' })).toBeNull();
    expect(normalizeResource({ title: 'x' })).toBeNull();
    expect(normalizeResource({ id: 'a', title: 'x', listings: 'no' })?.listings).toEqual([]);
  });

  it('keeps only http(s) links', () => {
    expect(safeUrl('https://payhip.com/b/x')).toBe('https://payhip.com/b/x');
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('not a url')).toBeUndefined();
    expect(safeUrl(5)).toBeUndefined();
    expect(safeUrl('https://x.com/' + 'a'.repeat(600))).toBeUndefined();
  });

  it('recognises uuids', () => {
    expect(isUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isUuid('r1')).toBe(false);
  });

  it('labels stores', () => {
    expect(storeLabel('own-site')).toBe('My own website');
    expect(storeLabel('zzz' as never)).toBe('zzz');
  });
});
