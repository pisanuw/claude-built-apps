// Works out duty and the US price or postage for each product.
//
// US duty on a duty-paid (DDP) parcel is charged on the value of the goods.
// Two ways to pass it on:
//   - in the price: raise the US item price so that, after duty on that higher
//     price and Royal Mail's handling fee, the maker keeps their UK price;
//   - in the postage: keep the item price and add the duty and fee to US postage.

import type { Band, Product, Settings } from './model';
import type { HtsIndex, HtsLine } from './hts';
import { isFullCode, valueCondition } from './hts';
import { parseRate } from './rates';
import { UK_LAYER } from './layer';
import { categoryById, WATCH_NOTES } from './categories';
import { roundUpToEnding, roundUpToStep } from './money';

/** Royal Mail's duty-paid service to the US takes parcels valued up to this many dollars. */
export const PDDP_LIMIT_USD = 2500;

export type Status = 'ok' | 'no-code' | 'unknown-code' | 'needs-rate' | 'too-high';

export interface Warning {
  level: 'stop' | 'check' | 'info';
  text: string;
}

export interface PriceResult {
  status: Status;
  line: HtsLine | null;
  /** General rate as a percentage (from the data, or set by hand). */
  generalPercent: number | null;
  layerPercent: number;
  /** Total ad valorem percentage (general + UK layer). */
  dutyPercent: number | null;
  /** Weight or per-item duty, in GBP per item. */
  specificDuty: number;
  /** Duty on one item at the normal UK price, GBP. */
  dutyAtUkPrice: number | null;
  band: Band | null;
  parcelGrams: number;
  /** Duty folded into the price. */
  usPrice: number | null;
  usPriceUsd: number | null;
  dutyAtUsPrice: number | null;
  /** Duty folded into postage. */
  usPostage: number | null;
  extraItemPostage: number | null;
  warnings: Warning[];
}

export function layerPercent(settings: Settings): number {
  return settings.layerOverride ?? UK_LAYER.percent;
}

export function findBand(bands: Band[], grams: number): Band | null {
  const sorted = [...bands].filter((b) => b.maxGrams > 0).sort((a, b) => a.maxGrams - b.maxGrams);
  return sorted.find((b) => grams <= b.maxGrams) ?? null;
}

export function priceProduct(p: Product, settings: Settings, index: HtsIndex): PriceResult {
  const warnings: Warning[] = [];
  const parcelGrams = Math.max(0, p.grams) + Math.max(0, settings.packagingGrams);
  const band = findBand(settings.bands, parcelGrams);
  const layer = p.ukMade && !p.layerExempt ? layerPercent(settings) : 0;
  const base: PriceResult = {
    status: 'ok', line: null, generalPercent: null, layerPercent: layer, dutyPercent: null, specificDuty: 0,
    dutyAtUkPrice: null, band, parcelGrams, usPrice: null, usPriceUsd: null, dutyAtUsPrice: null,
    usPostage: null, extraItemPostage: null, warnings,
  };

  const cat = categoryById(p.categoryId);
  for (const w of cat?.watch ?? []) warnings.push({ level: 'info', text: WATCH_NOTES[w] });
  if (!p.ukMade) {
    warnings.push({ level: 'check', text: 'Not made in the UK: the UK duty layer is left out, but goods made elsewhere pay that country\'s US rate instead. Set it by hand with "General rate set by hand".' });
  } else if (p.layerExempt) {
    warnings.push({ level: 'check', text: 'You marked this product as exempt from the 10% UK layer. Keep a note of why.' });
  }
  if (!band) {
    warnings.push({ level: 'stop', text: `The parcel (${parcelGrams} g with packaging) is heavier than your largest postage band. Add a band in Settings.` });
  }

  if (!p.code.trim() && p.manualRate === null) {
    base.status = 'no-code';
    warnings.unshift({ level: 'stop', text: 'No US code yet. Pick one so duty can be worked out.' });
    return base;
  }

  let general: number | null = null;
  let centsPerKg = 0;
  let centsEach = 0;
  if (p.code.trim()) {
    base.line = isFullCode(p.code) ? index.get(p.code) : null;
    if (!base.line) {
      warnings.unshift({ level: p.manualRate === null ? 'stop' : 'check', text: isFullCode(p.code)
        ? 'This code is not in the tariff data bundled with the app (it covers the chapters handmade goods fall into). Check it on hts.usitc.gov and set the general rate by hand.'
        : 'A US code has 10 digits, like 4202.92.15.00.' });
    } else {
      const parsed = parseRate(base.line.general);
      if (parsed) {
        general = parsed.percent;
        centsPerKg = parsed.centsPerKg;
        centsEach = parsed.centsEach;
        if (parsed.approximate) warnings.push({ level: 'check', text: `The rate "${parsed.text}" is measured on something other than the item's weight; the figure here uses the item weight as an estimate.` });
      } else if (p.manualRate === null) {
        warnings.unshift({ level: 'stop', text: `The general rate "${base.line.general || '(blank)'}" can't be worked out from price and weight. Set it by hand.` });
      }
      const cond = valueCondition(base.line);
      if (cond) warnings.push({ level: 'check', text: `This code depends on value ("${cond}"). Check your declared value still fits it.` });
      if (p.confirmed && p.confirmed.code === base.line.code && p.confirmed.general !== base.line.general) {
        warnings.push({ level: 'check', text: `The general rate for this code changed from ${p.confirmed.general || 'blank'} to ${base.line.general || 'blank'} since you confirmed it.` });
      }
    }
  }
  if (p.manualRate !== null) {
    general = p.manualRate;
    centsPerKg = 0;
    centsEach = 0;
  }
  if (general === null) {
    base.status = base.line ? 'needs-rate' : 'unknown-code';
    return base;
  }
  if (p.code.trim() && !p.confirmed) {
    warnings.push({ level: 'check', text: 'Code not confirmed yet: read the legal wording and confirm it describes your product.' });
  }

  const total = general + layer;
  const specific = (centsPerKg * (Math.max(0, p.grams) / 1000) + centsEach) / 100 / (settings.usdPerGbp || 1);
  base.generalPercent = general;
  base.dutyPercent = total;
  base.specificDuty = specific;
  const dutyAt = (value: number) => (value * total) / 100 + specific;
  base.dutyAtUkPrice = dutyAt(p.price);

  // Duty in the postage.
  const bandPrice = band?.price ?? null;
  if (bandPrice !== null) {
    base.usPostage = roundUpToStep(bandPrice + base.dutyAtUkPrice + settings.handlingFee, settings.postageStep);
  }
  base.extraItemPostage = roundUpToStep(base.dutyAtUkPrice, settings.postageStep);

  // Duty in the price.
  if (total >= 100) {
    base.status = 'too-high';
    warnings.unshift({ level: 'stop', text: 'Duty of 100% or more cannot be folded into the item price; use duty in postage.' });
  } else {
    const needed = (p.price + settings.handlingFee + specific) / (1 - total / 100);
    base.usPrice = roundUpToEnding(needed, settings.priceEnding);
    base.usPriceUsd = roundUpToEnding(needed * settings.usdPerGbp, settings.priceEnding);
    base.dutyAtUsPrice = dutyAt(base.usPrice);
  }

  const declaredUsd = (settings.mode === 'price' && base.usPrice !== null ? base.usPrice : p.price) * settings.usdPerGbp;
  if (declaredUsd > PDDP_LIMIT_USD) {
    warnings.unshift({ level: 'stop', text: `Valued over $${PDDP_LIMIT_USD}: too much for Royal Mail's duty-paid US service; a formal US entry is needed.` });
  }
  return base;
}

export interface SheetRow {
  product: Product;
  result: PriceResult;
}

export function priceAll(products: Product[], settings: Settings, index: HtsIndex): SheetRow[] {
  return products.map((product) => ({ product, result: priceProduct(product, settings, index) }));
}

/** Short status word for the table. */
export function statusLabel(r: PriceResult): string {
  switch (r.status) {
    case 'no-code': return 'Needs a code';
    case 'unknown-code': return 'Code not found';
    case 'needs-rate': return 'Needs a rate';
    case 'too-high': return 'Use postage';
    default:
      if (r.warnings.some((w) => w.level === 'stop')) return 'Check';
      return 'Ready';
  }
}
