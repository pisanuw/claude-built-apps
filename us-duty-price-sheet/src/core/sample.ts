import { defaultSettings, emptyCatalog, newProduct, type Catalog } from './model';
import type { HtsIndex } from './hts';

/** A made-up maker's shop, so a first-time visitor can see the sheet working. */
export function sampleCatalog(index: HtsIndex, today: string): Catalog {
  const cat = emptyCatalog();
  cat.settings = { ...defaultSettings(), shopName: 'Hare & Thistle Studio (sample)' };
  const confirm = (code: string) => {
    const line = index.get(code);
    return line ? { code: line.code, general: line.general, revision: index.data.revision, on: today } : null;
  };
  const items: [string, string, string, number, number, string, boolean][] = [
    ['Speckled stoneware mug', 'MUG-01', 'mug-stoneware', 420, 28, '6912.00.44.00', true],
    ['Sterling silver leaf earrings', 'EAR-LEAF', 'jewel-silver', 15, 38, '7113.11.50.00', true],
    ['Screen-printed cotton tote', 'TOTE-HARE', 'bag-tote-cotton', 180, 18, '4202.92.15.00', true],
    ['Hand-knitted merino scarf', 'SCARF-M', 'knit-scarf', 160, 65, '6117.10.10.00', true],
    ['Knitted wool beanie', 'HAT-W', 'knit-hat', 110, 32, '6505.00.30.90', true],
    ['Soy candle in a tin', 'CAN-200', 'candles', 250, 16, '3406.00.00.00', true],
    ['Illustrated greeting card', 'CARD-07', 'cards', 30, 3.75, '4909.00.40.00', true],
    ['Crochet bear, collector’s piece', 'BEAR-L', 'soft-toys', 220, 34, '9503.00.00.90', true],
    ['Lavender soap bar', 'SOAP-LAV', 'soap', 110, 6.5, '3401.11.50.00', false],
    ['Leather card holder', 'CARD-HOLD', 'leather-wallet', 40, 29, '', false],
  ];
  cat.products = items.map(([title, sku, categoryId, grams, price, code, confirmed]) =>
    newProduct({ title, sku, categoryId, grams, price, code, confirmed: confirmed ? confirm(code) : null }));
  cat.lastSeenRevision = index.data.revision;
  return cat;
}
