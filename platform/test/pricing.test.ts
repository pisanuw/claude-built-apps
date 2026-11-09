import { describe, expect, it } from 'vitest';
import { costUsd, DEFAULT_MODEL, FALLBACK_MODELS, KNOWN_MODELS, priceFor, PRICES, promptTokens } from '../src/gateway/pricing.ts';

const M = 1_000_000;

describe('pricing table', () => {
  it('knows the three platform models and defaults to Opus', () => {
    expect(KNOWN_MODELS).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(FALLBACK_MODELS).toContain('claude-opus-5-5');
    expect(FALLBACK_MODELS).toContain('claude-sonnet-5-5');
    expect(FALLBACK_MODELS).not.toContain('claude-haiku-5-5');
  });
  it('prices cache writes at 1.25x input', () => {
    for (const p of Object.values(PRICES)) {
      expect(p.cacheWrite).toBeCloseTo(p.input * 1.25, 9);
      if (p.longPrompt) expect(p.longPrompt.cacheWrite).toBeCloseTo(p.longPrompt.input * 1.25, 9);
    }
  });
  it('falls back to Opus prices for an unknown model', () => {
    expect(priceFor('claude-opus-5-5')).toEqual({ price: PRICES['claude-opus-5-5'], known: true });
    expect(priceFor('claude-opus-4-8')).toEqual({ price: PRICES['claude-opus-5-5'], known: false });
  });
});

describe('costUsd', () => {
  it('bills Opus at $4 in, $20 out, $0.20 cache read, $5 cache write per million', () => {
    expect(costUsd('claude-opus-5-5', { input_tokens: M, output_tokens: M })).toBe(24);
    expect(costUsd('claude-opus-5-5', { cache_read_input_tokens: M })).toBe(0.2);
    expect(costUsd('claude-opus-5-5', { cache_creation_input_tokens: M })).toBe(5);
    expect(costUsd('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500 })).toBeCloseTo(0.014, 9);
  });
  it('bills Sonnet at $2 / $10', () => {
    expect(costUsd('claude-sonnet-5-5', { input_tokens: M, output_tokens: M, cache_read_input_tokens: M, cache_creation_input_tokens: M })).toBe(14.7);
  });
  it('bills Haiku at $0.10 / $0.50 up to 100K prompt tokens and $0.50 / $2.50 beyond', () => {
    expect(costUsd('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1000 })).toBeCloseTo(0.0105, 9);
    expect(costUsd('claude-haiku-5-5', { input_tokens: 100_001, output_tokens: 1000 })).toBe(0.052501);
    // cache reads count toward the prompt size and cost 10% of input
    expect(costUsd('claude-haiku-5-5', { input_tokens: 50_000, cache_read_input_tokens: 60_000 })).toBeCloseTo(0.028, 9);
    expect(promptTokens({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 })).toBe(6);
  });
  it('treats missing, null and negative token counts as zero', () => {
    expect(costUsd('claude-opus-5-5', {})).toBe(0);
    expect(costUsd('claude-opus-5-5', { input_tokens: null, output_tokens: -5 })).toBe(0);
    expect(costUsd('claude-opus-5-5', { input_tokens: Number.NaN })).toBe(0);
  });
  it('rounds to six decimals and bills unknown models at Opus prices', () => {
    expect(costUsd('claude-opus-5-5', { input_tokens: 1 })).toBe(0.000004);
    expect(costUsd('claude-opus-5-5', { cache_read_input_tokens: 1 })).toBe(0);
    expect(costUsd('something-new', { input_tokens: M })).toBe(4);
  });
});
