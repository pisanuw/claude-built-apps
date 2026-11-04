import { clip } from './html';
import type { DayRange, FreeShippingClaim, ReturnClaim, ShippingClaim } from './types';

/**
 * Shipping times, return windows and free-shipping thresholds, read from the
 * sentences a page states them in. These are the details store owners most
 * often get out of step: the policy page says one thing, the product page,
 * FAQ or banner another.
 */

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90, a: 1, an: 1,
};
const NUM = String.raw`(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|sixty|ninety)`;

export function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : WORDS[s.toLowerCase()] ?? NaN;
}

const RANGE = new RegExp(
  String.raw`\b${NUM}(?:\s*(?:-|–|—|to|or)\s*${NUM})?\s*(?:\+\s*)?(business|working|calendar)?\s*(day|week|hour)s?\b(?!\s+a\s+week)`,
  'gi',
);

/** Every "3-5 business days" style range in a piece of text, in days. */
export function dayRanges(text: string): DayRange[] {
  const out: DayRange[] = [];
  RANGE.lastIndex = 0;
  for (let m = RANGE.exec(text); m; m = RANGE.exec(text)) {
    const a = num(m[1]);
    const b = m[2] ? num(m[2]) : a;
    const unit = m[4].toLowerCase();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    let min = a;
    let max = b;
    if (unit === 'week') {
      min = a * 7;
      max = b * 7;
    } else if (unit === 'hour') {
      if (b > 96) continue;
      min = Math.max(1, Math.ceil(a / 24));
      max = Math.max(1, Math.ceil(b / 24));
    }
    if (max > 120 || max === 0) continue;
    out.push({ min, max, business: /business|working/i.test(m[3] ?? '') });
  }
  return out;
}

export function overlaps(a: { min: number; max: number }, b: { min: number; max: number }): boolean {
  return a.min <= b.max && b.min <= a.max;
}

export function formatRange(r: DayRange): string {
  const d = r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`;
  return `${d} ${r.business ? 'business ' : ''}day${r.max === 1 ? '' : 's'}`;
}

const SHIP_WORD = /\b(ship|ships|shipped|shipping|deliver|delivered|delivery|dispatch|dispatched|arrive|arrives|arrival|transit|processing|processed|handling|fulfil|fulfill|fulfilled|post|posted|postage)\b/i;
const RETURN_WORD = /\b(return|returns|returned|refund|refunds|exchange|exchanges)\b/i;
const PROCESSING = /\b(process|processed|processing|dispatch|dispatched|ships?\s+(?:out\s+)?(?:with)?in|shipped\s+(?:with)?in|ready to ship|(?:days?|weeks?)\s+to\s+ship|before (?:it|they|your order|orders) ships?|handling|prepare|prepared|made to order|leave[s]? our|fulfil+ed|packed)\b/i;
const NOISE = /\b(days a week|7 days|24\/7|open \w+ days|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** Which shipping speed a clause talks about: comparing express with standard would be unfair. */
export function speedOf(text: string): 'standard' | 'express' | 'international' {
  if (/\b(international|worldwide|overseas|outside the (?:us|usa|uk|eu|united states|united kingdom))\b/i.test(text)) return 'international';
  if (/\b(express|expedited|overnight|next[- ]day|priority|two[- ]day|2[- ]day|rush)\b/i.test(text)) return 'express';
  return 'standard';
}

export function findShipping(sentences: string[]): ShippingClaim[] {
  const out: ShippingClaim[] = [];
  for (const s of sentences) {
    if (!SHIP_WORD.test(s) || s.length > 400) continue;
    // Return shipping and refund timing are not shipping times.
    if (RETURN_WORD.test(s) && !/\b(orders?|items?)\s+(?:are|is|will be)?\s*(?:shipped|dispatched|processed)\b/i.test(s)) continue;
    const sentenceStage: ShippingClaim['stage'] = PROCESSING.test(s) ? 'processing' : 'delivery';
    const sentenceSpeed = speedOf(s);
    for (const clause of s.split(/[;,]|\band\b|\bthen\b|\bwhile\b|\bplus\b/i)) {
      if (NOISE.test(clause)) continue;
      const ranges = dayRanges(clause);
      if (!ranges.length) continue;
      // "Arrives in 1-2 days after dispatch" is a delivery time: the arrival verb wins inside a clause.
      const stage: ShippingClaim['stage'] = /\b(deliver|arriv|transit|receive|reach)/i.test(clause) ? 'delivery' : PROCESSING.test(clause) ? 'processing' : sentenceStage;
      const clauseSpeed = speedOf(clause);
      const speed = clauseSpeed !== 'standard' ? clauseSpeed : sentenceSpeed;
      for (const r of ranges) out.push({ ...r, stage, speed, text: clip(s) });
    }
  }
  return out;
}

const NO_RETURNS = /\b(all sales (?:are )?final|no returns|(?:do not|don['’]t|cannot|can['’]t|does not) (?:accept|offer) (?:any )?(?:returns|refunds)|returns are not accepted|not (?:eligible for|accept(?:ing)?) returns|no refunds)\b|\b(?:all|every|any)\b[^.]{0,40}\bnon-?returnable\b|\beverything\b[^.]{0,20}\bnon-?returnable\b/i;
const EXCEPTION = /\b(sale|clearance|discounted|personali[sz]ed|custom|engraved|gift cards?|final[- ]sale items|intimates|underwear|swimwear|earrings|perishable|digital|downloadable|hygiene|opened|used|damaged by|worn|unless|except|after|if|outside|beyond|past|once|expired)\b/i;
const RETURN_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b${NUM}[- ](day|week)s?\s+(?:no[- ]questions[- ]asked\s+|hassle[- ]free\s+|free\s+|easy\s+)?(?:money[- ]back|return|returns|refund|exchange|satisfaction|trial)`, 'i'),
  new RegExp(String.raw`\bwithin\s+${NUM}\s+(?:calendar\s+)?(day|week)s?\b[^.;]{0,60}?\b(?:deliver|purchase|receipt|receiv|arriv|order|bought|shipment)`, 'i'),
  new RegExp(String.raw`\b${NUM}\s+(day|week)s?\s+to\s+(?:request\s+a\s+)?(?:return|send|exchange|ask for a refund)`, 'i'),
  new RegExp(String.raw`\b(?:returns?|exchanges?|refunds?)\s+(?:are\s+)?(?:accepted|available|possible|welcome)\s+(?:for|within|up to)\s+(?:up\s+to\s+)?${NUM}\s+(day|week)s?`, 'i'),
  new RegExp(String.raw`\b(?:return|refund|exchange)s?\s+(?:window|period|policy)\s+(?:is|of|lasts)\s+(?:up\s+to\s+)?${NUM}\s+(day|week)s?`, 'i'),
];

export function findReturns(sentences: string[]): ReturnClaim[] {
  const out: ReturnClaim[] = [];
  for (const s of sentences) {
    if (s.length > 400) continue;
    // "Outside the 30-day window we do not accept returns" is a condition, not a no-returns policy.
    if (NO_RETURNS.test(s) && !EXCEPTION.test(s) && !dayRanges(s).length) {
      out.push({ days: 0, noReturns: true, text: clip(s) });
      continue;
    }
    if (!RETURN_WORD.test(s) && !/money[- ]back|satisfaction/i.test(s)) continue;
    // "Refunds are processed within 5-10 business days" is refund timing, not a return window.
    if (/\b(refunds?|credit)\b[^.]{0,40}\b(processed|issued|credited|appear|posted)\b/i.test(s) && !/\bwithin\s+\S+\s+days?\b[^.;]{0,60}?\b(?:deliver|purchase|receipt|arriv)/i.test(s)) continue;
    for (const re of RETURN_PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const n = num(m[1]);
      const days = m[2].toLowerCase() === 'week' ? n * 7 : n;
      if (Number.isFinite(days) && days > 0 && days <= 400) {
        out.push({ days, noReturns: false, text: clip(s) });
        break;
      }
    }
  }
  return out;
}

const SYMBOL: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const FREE = [
  /\bfree\s+(?:standard\s+|domestic\s+|ground\s+|us\s+|uk\s+|eu\s+)?(?:shipping|delivery|postage)\s+(?:on\s+|for\s+)?(?:all\s+)?(?:orders?|purchases?)?\s*(?:over|above|of|from|exceeding|\+)\s*(?:a\s+)?([$€£¥])?\s*(\d{1,5}(?:[.,]\d{2})?)\s*(usd|eur|gbp|cad|aud|nzd|€|£)?/i,
  /\b(?:orders?|purchases?)\s+(?:over|above|of)\s+([$€£¥])?\s*(\d{1,5}(?:[.,]\d{2})?)\s*(usd|eur|gbp|cad|aud|nzd|€|£)?\s+(?:ship|get|qualify for|receive)\s+(?:free|for free)/i,
  /\bfree\s+(?:shipping|delivery)\s+([$€£¥])\s*(\d{1,5}(?:[.,]\d{2})?)\s*\+/i,
];

export function findFreeShipping(sentences: string[]): FreeShippingClaim[] {
  const out: FreeShippingClaim[] = [];
  for (const s of sentences) {
    for (const re of FREE) {
      const m = re.exec(s);
      if (!m) continue;
      const threshold = Number(m[2].replace(',', '.'));
      if (!Number.isFinite(threshold) || threshold <= 0) continue;
      const code = (m[3] ?? '').toUpperCase();
      const currency = SYMBOL[m[1] ?? ''] ?? SYMBOL[code] ?? (code && code.length === 3 ? code : '');
      out.push({ threshold, currency, text: clip(s) });
      break;
    }
  }
  return out;
}
