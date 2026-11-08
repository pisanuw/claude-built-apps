import { describe, expect, it } from 'vitest';
import { data, index, tinyIndex } from './helpers';
import { describeRate, parseLayerPercent, parseRate, trimNum } from '../src/core/rates';
import { digitsOnly, formatCode, isFullCode, valueCondition } from '../src/core/hts';
import { CATEGORIES, categoryById, categoryGroups, WATCH_NOTES } from '../src/core/categories';
import { UK_LAYER, UK_LAYER_HISTORY } from '../src/core/layer';
import { ceilPenny, gbp, pct, readNumber, roundUpToEnding, roundUpToStep, ukDate, usd } from '../src/core/money';
import { defaultSettings, emptyCatalog, newProduct, type Settings } from '../src/core/model';
import { findBand, layerPercent, priceAll, priceProduct, statusLabel } from '../src/core/pricing';
import history from '../src/data/rate-history.json';

const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), bandsAreExample: false, ...over });

describe('rates', () => {
  it('reads plain, free and compound rates', () => {
    expect(parseRate('6.3%')).toMatchObject({ percent: 6.3, centsPerKg: 0, centsEach: 0, approximate: false });
    expect(parseRate('Free')).toMatchObject({ percent: 0 });
    expect(parseRate('25.4¢/kg + 7.7%')).toMatchObject({ percent: 7.7, centsPerKg: 25.4 });
    expect(parseRate('$1.035/kg + 14.9%')).toMatchObject({ percent: 14.9, centsPerKg: 103.5 });
    expect(parseRate('40¢/kg +10.4%')).toMatchObject({ percent: 10.4, centsPerKg: 40 });
    expect(parseRate('0.4¢ each + 2.7%')).toMatchObject({ percent: 2.7, centsEach: 0.4 });
    expect(parseRate('13.5¢/kg + 6.3% + 1.9¢/article')).toMatchObject({ percent: 6.3, centsPerKg: 13.5, centsEach: 1.9 });
    expect(parseRate('14.4¢/gross + 2%')!.centsEach).toBeCloseTo(0.1, 5);
    expect(parseRate('12¢/doz.')!.centsEach).toBeCloseTo(1, 5);
    expect(parseRate('$1 each')).toMatchObject({ centsEach: 100 });
  });
  it('flags weights measured on something else', () => {
    expect(parseRate('6¢/kg on drained weight + 8.5%')).toMatchObject({ approximate: true, centsPerKg: 6, percent: 8.5 });
    expect(parseRate('3¢ each on the contents')).toMatchObject({ approximate: true });
  });
  it('refuses rates it cannot compute', () => {
    expect(parseRate('7.85¢/liter')).toBeNull();
    expect(parseRate('The rate applicable to each garment in the ensemble if separately entered')).toBeNull();
    expect(parseRate('')).toBeNull();
  });
  it('describes rates and reads the layer', () => {
    expect(describeRate(parseRate('Free')!)).toBe('Free');
    expect(describeRate(parseRate('25.4¢/kg + 7.7%')!)).toBe('7.7% + 25.4¢/kg');
    expect(describeRate(parseRate('0.4¢ each')!)).toBe('0.4¢ each');
    expect(parseLayerPercent('The duty provided in the applicable subheading + 10%')).toBe(10);
    expect(parseLayerPercent('nothing here')).toBeNull();
    expect(trimNum(1 / 3)).toBe('0.3333');
  });
  it('can compute almost every general rate in the bundled data', () => {
    const lines = data.lines.filter((l) => !l[2].startsWith('The rate applicable'));
    const failed = lines.filter((l) => parseRate(l[2]) === null);
    expect(failed.length / lines.length).toBeLessThan(0.03);
  });
});

describe('bundled tariff data', () => {
  it('is a real USITC revision with the UK layer', () => {
    expect(data.revision).toMatch(/^\d{4}HTS/);
    expect(data.lines.length).toBeGreaterThan(5000);
    expect(data.ukLayer?.heading).toBe('9903.05.81');
  });
  it('agrees with the hand-kept UK layer', () => {
    expect(parseLayerPercent(data.ukLayer!.general)).toBe(UK_LAYER.percent);
    expect(UK_LAYER_HISTORY[UK_LAYER_HISTORY.length - 1]).toMatchObject({ heading: UK_LAYER.heading, percent: UK_LAYER.percent, to: null });
  });
  it('looks up codes in any format', () => {
    const mug = index.get('6912004400')!;
    expect(mug.code).toBe('6912.00.44.00');
    expect(mug.general).toBe('10%');
    expect(mug.chain.at(-1)).toMatch(/Mugs/);
    expect(index.get('6912.00.44.00')).toEqual(mug);
    expect(index.get('0000.00.00.00')).toBeNull();
  });
  it('searches by words and by code prefix', () => {
    const candles = index.search('candles');
    expect(candles.some((l) => l.code === '3406.00.00.00')).toBe(true);
    expect(index.search('wool scarves').some((l) => l.code.startsWith('6117.10.10'))).toBe(true);
    expect(index.search('6913').every((l) => l.code.startsWith('6913'))).toBe(true);
    expect(index.search('6913', 3)).toHaveLength(3);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('a')).toEqual([]);
    expect(index.search('boxes').length).toBeGreaterThan(0);
    expect(index.search('batteries').length).toBeGreaterThanOrEqual(0);
    expect(index.size).toBe(data.lines.length);
  });
  it('formats codes and finds value tests', () => {
    expect(formatCode('4202921500')).toBe('4202.92.15.00');
    expect(formatCode('4202')).toBe('4202');
    expect(digitsOnly('4202.92')).toBe('420292');
    expect(isFullCode('4202.92.15.00')).toBe(true);
    expect(isFullCode('4202.92')).toBe(false);
    expect(valueCondition(index.get('7013.99.90.90')!)).toMatch(/Valued over \$5/);
    expect(valueCondition(index.get('3406.00.00.00')!)).toBeNull();
  });
});

describe('categories', () => {
  it('every suggested code exists and has a computable rate', () => {
    for (const c of CATEGORIES) {
      expect(c.candidates.length, c.id).toBeGreaterThan(0);
      for (const cand of c.candidates) {
        const line = index.get(cand.code);
        expect(line, `${c.id} ${cand.code}`).not.toBeNull();
        expect(parseRate(line!.general), `${c.id} ${cand.code} ${line!.general}`).not.toBeNull();
      }
      for (const w of c.watch ?? []) expect(WATCH_NOTES[w]).toBeTruthy();
    }
  });
  it('has unique ids and groups them', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    expect(categoryById('candles')?.name).toMatch(/Candles/);
    expect(categoryById('nope')).toBeUndefined();
    const groups = categoryGroups();
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(CATEGORIES.length);
  });
});

describe('money', () => {
  it('rounds up without float dust', () => {
    expect(ceilPenny(12.301)).toBe(12.31);
    expect(ceilPenny(0.1 + 0.2)).toBe(0.3);
    expect(roundUpToEnding(23.1, '0.99')).toBe(23.99);
    expect(roundUpToEnding(23.995, '0.99')).toBe(24.99);
    expect(roundUpToEnding(23.1, '0.00')).toBe(24);
    expect(roundUpToEnding(24, '0.00')).toBe(24);
    expect(roundUpToEnding(23.6, '0.50')).toBe(24.5);
    expect(roundUpToEnding(23.4, '0.50')).toBe(23.5);
    expect(roundUpToEnding(23.401, 'none')).toBe(23.41);
    expect(roundUpToStep(12.31, 0.5)).toBe(12.5);
    expect(roundUpToStep(12.5, 0.5)).toBe(12.5);
    expect(roundUpToStep(12.31, 0)).toBe(12.31);
    expect(roundUpToStep(12.01, 1)).toBe(13);
  });
  it('formats and reads numbers', () => {
    expect(gbp(3)).toBe('£3.00');
    expect(gbp(null)).toBe('–');
    expect(usd(2.5)).toBe('$2.50');
    expect(usd(undefined)).toBe('–');
    expect(pct(17.7)).toBe('17.7%');
    expect(pct(null)).toBe('–');
    expect(readNumber('£12.50')).toBe(12.5);
    expect(readNumber('12,50')).toBe(12.5);
    expect(readNumber('1,250.00')).toBe(1250);
    expect(readNumber('')).toBeNull();
    expect(readNumber('abc')).toBeNull();
    expect(ukDate('10/30/2026')).toBe('30 Oct 2026');
    expect(ukDate('2026-07-24')).toBe('24 Jul 2026');
    expect(ukDate('soon')).toBe('soon');
  });
});

describe('pricing', () => {
  const tiny = tinyIndex();
  const mug = () => newProduct({ title: 'Mug', price: 28, grams: 420, code: '6912.00.44.00', categoryId: 'mug-stoneware' });

  it('adds the UK layer to the general rate and works out postage with duty', () => {
    const s = settings({ handlingFee: 0.5, packagingGrams: 60, postageStep: 0 });
    const r = priceProduct(mug(), s, tiny);
    expect(r.generalPercent).toBe(10);
    expect(r.layerPercent).toBe(10);
    expect(r.dutyPercent).toBe(20);
    expect(r.dutyAtUkPrice).toBeCloseTo(5.6, 6);
    expect(r.parcelGrams).toBe(480);
    expect(r.band?.maxGrams).toBe(500);
    // 14.50 label + 5.60 duty + 0.50 fee
    expect(r.usPostage).toBe(20.6);
    expect(r.extraItemPostage).toBe(5.6);
    expect(r.status).toBe('ok');
  });

  it('builds duty into a price that leaves the maker their UK price', () => {
    const s = settings({ handlingFee: 0.5, priceEnding: 'none' });
    const r = priceProduct(mug(), s, tiny);
    // (28 + 0.5) / 0.8 = 35.625 -> 35.63
    expect(r.usPrice).toBe(35.63);
    expect(r.usPrice! - r.dutyAtUsPrice! - 0.5).toBeGreaterThanOrEqual(28);
    expect(r.usPriceUsd).toBeCloseTo(46.32, 2);
    const rounded = priceProduct(mug(), settings({ priceEnding: '0.99' }), tiny);
    expect(rounded.usPrice).toBe(35.99);
  });

  it('handles weight-based duty, the what-if layer and exemptions', () => {
    const hat = newProduct({ title: 'Hat', price: 32, grams: 110, code: '6505.00.30.90' });
    const s = settings({ usdPerGbp: 1.25 });
    const r = priceProduct(hat, s, tiny);
    expect(r.dutyPercent).toBeCloseTo(17.7, 6);
    // 25.4 cents/kg * 0.11 kg = 2.794 cents = $0.02794 -> /1.25
    expect(r.specificDuty).toBeCloseTo(0.02794 / 1.25, 6);
    const whatIf = priceProduct(hat, settings({ layerOverride: 25 }), tiny);
    expect(whatIf.dutyPercent).toBeCloseTo(32.7, 6);
    expect(layerPercent(settings({ layerOverride: 25 }))).toBe(25);
    const exempt = priceProduct({ ...hat, layerExempt: true }, s, tiny);
    expect(exempt.dutyPercent).toBeCloseTo(7.7, 6);
    expect(exempt.warnings.some((w) => /exempt/.test(w.text))).toBe(true);
    const foreign = priceProduct({ ...hat, ukMade: false }, s, tiny);
    expect(foreign.layerPercent).toBe(0);
    expect(foreign.warnings.some((w) => /Not made in the UK/.test(w.text))).toBe(true);
  });

  it('explains what is missing', () => {
    const s = settings();
    const none = priceProduct(newProduct({ title: 'x', price: 10, grams: 10 }), s, tiny);
    expect(none.status).toBe('no-code');
    expect(statusLabel(none)).toBe('Needs a code');
    const unknown = priceProduct(newProduct({ price: 10, code: '9999.99.99.99' }), s, tiny);
    expect(unknown.status).toBe('unknown-code');
    expect(statusLabel(unknown)).toBe('Code not found');
    const short = priceProduct(newProduct({ price: 10, code: '6912' }), s, tiny);
    expect(short.warnings[0].text).toMatch(/10 digits/);
    const litre = priceProduct(newProduct({ price: 10, code: '2009.11.00.00' }), s, tiny);
    expect(litre.status).toBe('needs-rate');
    expect(statusLabel(litre)).toBe('Needs a rate');
    const manual = priceProduct(newProduct({ price: 10, code: '2009.11.00.00', manualRate: 5 }), s, tiny);
    expect(manual.dutyPercent).toBe(15);
    const manualOnly = priceProduct(newProduct({ price: 10, manualRate: 3 }), s, tiny);
    expect(manualOnly.dutyPercent).toBe(13);
    const manualUnknown = priceProduct(newProduct({ price: 10, code: '9999.99.99.99', manualRate: 3 }), s, tiny);
    expect(manualUnknown.dutyPercent).toBe(13);
    expect(manualUnknown.warnings[0].level).toBe('check');
  });

  it('warns about weight, value, high duty, unconfirmed codes and changed rates', () => {
    const heavy = priceProduct(newProduct({ price: 10, grams: 5000, code: '3406.00.00.00' }), settings(), tiny);
    expect(heavy.band).toBeNull();
    expect(heavy.usPostage).toBeNull();
    expect(statusLabel(heavy)).toBe('Check');
    const pricey = priceProduct(newProduct({ price: 3000, grams: 10, code: '3406.00.00.00' }), settings(), tiny);
    expect(pricey.warnings[0].text).toMatch(/\$2500/);
    const pricedIn = priceProduct(newProduct({ price: 1900, grams: 10, code: '6912.00.44.00' }), settings({ mode: 'price' }), tiny);
    expect(pricedIn.warnings.some((w) => /\$2500/.test(w.text))).toBe(true);
    const huge = priceProduct(newProduct({ price: 10, code: '3406.00.00.00' }), settings({ layerOverride: 120 }), tiny);
    expect(huge.status).toBe('too-high');
    expect(huge.usPrice).toBeNull();
    expect(statusLabel(huge)).toBe('Use postage');
    const glass = priceProduct(newProduct({ price: 40, code: '7013.99.90.90' }), settings(), tiny);
    expect(glass.warnings.some((w) => /depends on value/.test(w.text))).toBe(true);
    expect(glass.warnings.some((w) => /not confirmed/.test(w.text))).toBe(true);
    const changed = priceProduct(newProduct({ price: 40, code: '6912.00.44.00', confirmed: { code: '6912.00.44.00', general: '9.8%', revision: 'r', on: 'd' } }), settings(), tiny);
    expect(changed.warnings.some((w) => /changed from 9.8% to 10%/.test(w.text))).toBe(true);
    const watched = priceProduct(newProduct({ price: 5, code: '3406.00.00.00', categoryId: 'soft-toys' }), settings(), tiny);
    expect(watched.warnings.some((w) => w.level === 'info' && /Children/.test(w.text))).toBe(true);
    const approx = priceProduct(newProduct({ price: 5, code: '2008.99.00.00' }), settings(), tinyIndex({ lines: [['2008.99.00.00', 'Fruit', '6¢/kg on drained weight']] }));
    expect(approx.warnings.some((w) => /estimate/.test(w.text))).toBe(true);
  });

  it('picks the smallest band that fits and prices a whole catalogue', () => {
    const bands = defaultSettings().bands;
    expect(findBand(bands, 100)?.maxGrams).toBe(100);
    expect(findBand(bands, 101)?.maxGrams).toBe(250);
    expect(findBand([], 10)).toBeNull();
    const rows = priceAll([mug(), newProduct({ price: 3, code: '3406.00.00.00' })], settings(), tiny);
    expect(rows).toHaveLength(2);
    expect(rows[1].result.dutyPercent).toBe(10);
  });

  it('uses the real data for the sample codes', () => {
    const tote = priceProduct(newProduct({ price: 18, grams: 180, code: '4202.92.15.00' }), settings(), index);
    expect(tote.dutyPercent).toBeCloseTo(16.3, 6);
    expect(emptyCatalog().products).toEqual([]);
    expect(Array.isArray(history)).toBe(true);
  });
});
