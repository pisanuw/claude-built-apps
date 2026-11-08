import raw from '../src/data/hts.json';
import { HtsIndex, type HtsData } from '../src/core/hts';
import type { Store } from '../src/core/storage';

export const data = raw as unknown as HtsData;
export const index = new HtsIndex(data);

export function memoryStore(initial: Record<string, string> = {}): Store & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

/** A tiny tariff dataset for tests that need to change rates. */
export function tinyIndex(overrides: Partial<HtsData> = {}): HtsIndex {
  return new HtsIndex({
    revision: '2026HTSRev22',
    revisionTitle: 'Revision 22 (2026)',
    revisionStart: '10/30/2026',
    fetched: '2026-11-08',
    source: 'test',
    ukLayer: { heading: '9903.05.81', general: 'The duty provided in the applicable subheading + 10%', description: 'UK' },
    lines: [
      ['6912.00.44.00', 'Ceramic tableware | Mugs and other steins', '10%'],
      ['3406.00.00.00', 'Candles', 'Free'],
      ['6505.00.30.90', 'Hats | Of wool | Other', '25.4¢/kg + 7.7%'],
      ['2009.11.00.00', 'Orange juice', '7.85¢/liter'],
      ['7013.99.90.90', 'Glassware | Valued over $5 each | Other', '7.2%'],
    ],
    ...overrides,
  });
}
