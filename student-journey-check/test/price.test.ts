import { describe, expect, it } from 'vitest';
import { findPrices, formatPrice, parseAmount, parseExpectedPrice, samePrice } from '../src/core/price';

describe('parseAmount', () => {
  it.each([
    ['79', 79],
    ['79.00', 79],
    ['79,00', 79],
    ['1,234.50', 1234.5],
    ['1.234,50', 1234.5],
    ['1 234,50', 1234.5],
    ['1,234', 1234],
    ['1234', 1234],
  ])('%s -> %d', (s, n) => expect(parseAmount(s)).toBe(n));
});

describe('findPrices', () => {
  it('reads symbols before and after the number', () => {
    expect(findPrices('Only $79.00 today, or €79,00, or 79 € or £1,299').map((p) => [p.amount, p.currency])).toEqual([
      [79, '$'],
      [79, '€'],
      [79, '€'],
      [1299, '£'],
    ]);
  });
  it('reads ISO codes and Nordic kroner', () => {
    expect(findPrices('USD 49 and 499 SEK and 300 kr').map((p) => [p.amount, p.currency])).toEqual([
      [49, 'USD'],
      [499, 'SEK'],
      [300, 'KR'],
    ]);
  });
  it('does not count a code-and-symbol price twice', () => {
    expect(findPrices('A$59.95')).toEqual([{ amount: 59.95, currency: 'A$', raw: 'A$59.95' }]);
  });
  it('ignores plain numbers', () => {
    expect(findPrices('30 lessons, 5 quizzes, 2026')).toEqual([]);
  });
});

describe('expected price', () => {
  it('accepts a bare number or a written price', () => {
    expect(parseExpectedPrice('79')).toEqual({ amount: 79, currency: '', raw: '79' });
    expect(parseExpectedPrice(' $79 ')?.currency).toBe('$');
    expect(parseExpectedPrice('')).toBeNull();
    expect(parseExpectedPrice('seventy')).toBeNull();
  });
  it('compares amount, and currency only when both name one', () => {
    const usd = parseExpectedPrice('$79')!;
    expect(samePrice(usd, parseExpectedPrice('79.00')!)).toBe(true);
    expect(samePrice(usd, parseExpectedPrice('€79')!)).toBe(false);
    expect(samePrice(usd, parseExpectedPrice('$78.99')!)).toBe(false);
    expect(formatPrice(usd)).toBe('$79');
  });
});
