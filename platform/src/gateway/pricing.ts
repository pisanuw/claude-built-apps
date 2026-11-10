/**
 * Anthropic prices in USD per million tokens (docs/platform.md, section 3).
 * Check against https://platform.claude.com/docs/en/about-claude/pricing when
 * a model is added. Verified 9 Nov 2026.
 */

export interface Price {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read input tokens. */
  cacheRead: number;
  /** USD per million cache-write (cache creation) input tokens: 1.25x input. */
  cacheWrite: number;
  /** Higher tier for prompts above `threshold` tokens (Haiku 5.5 only). */
  longPrompt?: { threshold: number } & Omit<Price, 'longPrompt'>;
}

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPrompt: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
};

export const KNOWN_MODELS: readonly string[] = Object.keys(PRICES);
export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Models that accept the server-side refusal fallback (Haiku 5.5 does not). */
export const FALLBACK_MODELS: readonly string[] = ['claude-opus-5-5', 'claude-sonnet-5-5'];

/** The usage object of a Messages API response (fields may be missing or null). */
export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Price table for a model. An unknown model (for example one the owner added
 * to allowed_models before this table, or a fallback model named by the API)
 * is billed at Opus prices, the dearest, so the caps still bind.
 */
export function priceFor(model: string): { price: Price; known: boolean } {
  const price = PRICES[model];
  return price ? { price, known: true } : { price: PRICES[DEFAULT_MODEL], known: false };
}

/** Prompt size that selects Haiku's tier: every input token, cached or not. */
export function promptTokens(usage: Usage): number {
  return n(usage.input_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens);
}

/** Cost in USD of one call, rounded to 6 decimals (the ledger column is numeric(10,6)). */
export function costUsd(model: string, usage: Usage): number {
  let { price } = priceFor(model);
  if (price.longPrompt && promptTokens(usage) > price.longPrompt.threshold) price = price.longPrompt;
  const micro =
    n(usage.input_tokens) * price.input +
    n(usage.output_tokens) * price.output +
    n(usage.cache_read_input_tokens) * price.cacheRead +
    n(usage.cache_creation_input_tokens) * price.cacheWrite;
  return Math.round(micro) / 1_000_000;
}
