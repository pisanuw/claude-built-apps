/**
 * Builds the Anthropic call and the ledger row for the gateway. Pure, so the
 * Deno entry only wires it to the SDK and supabase-js.
 */
import { costUsd, FALLBACK_MODELS, type Usage } from './pricing.ts';
import type { GatewayRequest } from './validate.ts';

/**
 * Server-side refusal fallback (beta): when a safety classifier declines, the
 * API re-runs the request on Anthropic's recommended model inside the same
 * call. One switch for both the beta header and the `fallbacks` field. Not
 * sent for Haiku 5.5, which has no fallback (a list even returns a 400).
 */
export const SERVER_SIDE_FALLBACK = true;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicParams {
  model: string;
  max_tokens: number;
  messages: unknown[];
  system?: string | unknown[];
  tools?: unknown[];
  betas?: string[];
  fallbacks?: 'default';
}

/** The `client.beta.messages.create` params. No thinking or temperature: the model defaults apply. */
export function buildAnthropicParams(req: GatewayRequest, fallback: boolean = SERVER_SIDE_FALLBACK): AnthropicParams {
  const params: AnthropicParams = { model: req.model, max_tokens: req.max_tokens, messages: req.messages };
  if (req.system !== undefined) params.system = req.system;
  if (req.tools !== undefined) params.tools = req.tools;
  if (fallback && FALLBACK_MODELS.includes(req.model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

/** A platform.llm_usage row. */
export interface UsageRow {
  app: string;
  user_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  ok: boolean;
  error: string | null;
}

const count = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** The ledger row for a successful call; `model` is the model that answered (a fallback may differ from the request). */
export function usageRow(req: GatewayRequest, userId: string | null, response: { model?: string; usage?: Usage | null }): UsageRow {
  const model = response.model || req.model;
  const usage = response.usage || {};
  const input_tokens = count(usage.input_tokens);
  const output_tokens = count(usage.output_tokens);
  const cache_read_tokens = count(usage.cache_read_input_tokens);
  const cache_write_tokens = count(usage.cache_creation_input_tokens);
  return {
    app: req.app,
    user_id: userId,
    model,
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_write_tokens,
    // Priced from the rounded counts so the row is consistent with itself.
    cost_usd: costUsd(model, {
      input_tokens,
      output_tokens,
      cache_read_input_tokens: cache_read_tokens,
      cache_creation_input_tokens: cache_write_tokens,
    }),
    ok: true,
    error: null,
  };
}

/** The upstream error as the ledger and the 502 body see it: class name, status and message. */
export function describeError(err: unknown): { name: string; status: number | null; message: string } {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { name?: unknown; status?: unknown; message?: unknown; constructor?: { name?: string } };
  const ctor = e.constructor?.name;
  const name = (typeof e.name === 'string' && e.name) || (ctor && ctor !== 'Object' ? ctor : 'Error');
  const status = typeof e.status === 'number' ? e.status : null;
  const message = typeof e.message === 'string' ? e.message : String(err);
  return { name, status, message: message.slice(0, 500) };
}

/** The ledger row for a failed call (no tokens, no cost). */
export function errorRow(req: GatewayRequest, userId: string | null, err: unknown): UsageRow {
  const d = describeError(err);
  return {
    app: req.app,
    user_id: userId,
    model: req.model,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    ok: false,
    error: `${d.name}${d.status ? ` ${d.status}` : ''}: ${d.message}`.slice(0, 500),
  };
}
