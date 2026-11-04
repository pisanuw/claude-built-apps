import { describe, expect, it } from 'vitest';
import { emptyFleet, hostOf, isDate, newId, normalizeUrl, parseFleet, removeSite, serializeFleet, todayIso } from '../src/core/model';
import { check, fleet, site } from './helpers';

describe('model', () => {
  it('normalizes page addresses', () => {
    expect(normalizeUrl(' https://Shop.Example.com/menu/#top ')).toBe('https://shop.example.com/menu');
    expect(normalizeUrl('https://shop.example.com')).toBe('https://shop.example.com/');
    expect(normalizeUrl('https://shop.example.com/p?id=2&utm_source=x&gclid=1')).toBe('https://shop.example.com/p?id=2');
    expect(normalizeUrl('/relative')).toBe('/relative');
    expect(normalizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  it('reads hosts and dates', () => {
    expect(hostOf('https://www.Shop.example.com/x')).toBe('shop.example.com');
    expect(hostOf('nope')).toBe('');
    expect(isDate('2026-11-04')).toBe(true);
    expect(isDate('2026-13-40')).toBe(false);
    expect(isDate(4)).toBe(false);
    expect(todayIso(new Date('2026-11-04T23:00:00Z'))).toBe('2026-11-04');
    expect(newId('x')).not.toBe(newId('x'));
  });

  it('round-trips a fleet file', () => {
    const f = fleet([site()], [check('s1', '2026-10-01', { '/': ['image-alt'] })], {
      statements: [{ siteId: 's1', date: '2026-10-02', text: 'hi' }],
      notes: { 's1|https://shop.example.com/|image-alt': 'vendor' },
    });
    f.agency.name = 'Studio';
    const back = parseFleet(serializeFleet(f));
    expect(back).toEqual(f);
  });

  it('rejects files that are not fleet files', () => {
    expect(() => parseFleet('nope')).toThrow(/not valid JSON/);
    expect(() => parseFleet('{"sites":[]}')).toThrow(/not a fleet file/);
  });

  it('drops broken entries instead of failing', () => {
    const text = JSON.stringify({
      kind: 'accessibility-fleet-log',
      agency: { name: 'A', color: 'red' },
      sites: [{ id: 's1', jurisdiction: 'mars', target: '3.0', manualReview: 'soon' }, { name: 'no id' }, null],
      checks: [
        { id: 'c1', siteId: 's1', date: '2026-10-01', pages: [{ url: 'https://x/', findings: [{ ruleId: 'label', count: -3, impact: 'huge', criteria: ['4.1.2', 7] }, { help: 'no id' }, null] }, { nope: 1 }] },
        { id: 'c2', siteId: 'ghost', date: '2026-10-01' },
        { id: 'c3', siteId: 's1', date: 'yesterday' },
        { id: 'c4', siteId: 's1', date: '2026-10-02' },
      ],
      statements: [{ siteId: 's1', date: '2026-10-01', text: 'ok' }, { siteId: 's1', date: 'x', text: 'bad' }],
      notes: { a: 'kept', b: '  ', c: 3 },
    });
    const f = parseFleet(text);
    expect(f.agency.color).toBe(emptyFleet().agency.color);
    expect(f.sites).toHaveLength(1);
    expect(f.sites[0]).toMatchObject({ jurisdiction: 'both', target: '2.1', manualReview: '', name: '' });
    expect(f.checks.map((c) => c.id)).toEqual(['c1', 'c4']);
    expect(f.checks[0].engine).toBe('unknown');
    expect(f.checks[0].pages).toHaveLength(1);
    expect(f.checks[0].pages[0].findings).toEqual([{ ruleId: 'label', help: 'label', criteria: ['4.1.2'], impact: null, count: 1 }]);
    expect(f.checks[1].pages).toEqual([]);
    expect(f.statements).toHaveLength(1);
    expect(f.notes).toEqual({ a: 'kept' });
  });

  it('removes a site with its history', () => {
    const f = fleet([site('s1'), site('s2')], [check('s1', '2026-10-01', {}), check('s2', '2026-10-01', {})], {
      statements: [{ siteId: 's1', date: '2026-10-01', text: '' }],
      notes: { 's1|x|y': 'a', 's2|x|y': 'b' },
    });
    const out = removeSite(f, 's1');
    expect(out.sites.map((s) => s.id)).toEqual(['s2']);
    expect(out.checks.map((c) => c.siteId)).toEqual(['s2']);
    expect(out.statements).toEqual([]);
    expect(out.notes).toEqual({ 's2|x|y': 'b' });
  });
});
