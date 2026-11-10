import { describe, expect, it } from 'vitest';
import { buildAnthropicParams, describeError, errorRow, FALLBACK_BETA, SERVER_SIDE_FALLBACK, usageRow } from '../src/gateway/request.ts';
import type { GatewayRequest } from '../src/gateway/validate.ts';

const req: GatewayRequest = { app: 'demo-app', model: 'claude-opus-5-5', max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }] };

describe('buildAnthropicParams', () => {
  it('sends the server-side refusal fallback for Opus and Sonnet', () => {
    expect(SERVER_SIDE_FALLBACK).toBe(true);
    expect(buildAnthropicParams(req)).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      messages: req.messages,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
    expect(buildAnthropicParams({ ...req, model: 'claude-sonnet-5-5' })).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  });
  it('never sends it for Haiku, or when switched off', () => {
    const haiku = buildAnthropicParams({ ...req, model: 'claude-haiku-5-5' });
    expect(haiku).toEqual({ model: 'claude-haiku-5-5', max_tokens: 1000, messages: req.messages });
    expect(buildAnthropicParams(req, false)).toEqual({ model: 'claude-opus-5-5', max_tokens: 1000, messages: req.messages });
  });
  it('passes system and tools through and sets no thinking or temperature', () => {
    const p = buildAnthropicParams({ ...req, system: 'S', tools: [{ name: 't' }] });
    expect(p.system).toBe('S');
    expect(p.tools).toEqual([{ name: 't' }]);
    expect(Object.keys(p).sort()).toEqual(['betas', 'fallbacks', 'max_tokens', 'messages', 'model', 'system', 'tools']);
  });
});

describe('usageRow', () => {
  it('records tokens and the cost at the answering model', () => {
    const row = usageRow(req, 'user-1', {
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    expect(row).toEqual({
      app: 'demo-app', user_id: 'user-1', model: 'claude-opus-5-5',
      input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0,
      cost_usd: 0.014, ok: true, error: null,
    });
  });
  it('uses the response model when a fallback answered, and copes with missing usage', () => {
    expect(usageRow(req, null, { model: 'claude-opus-4-8', usage: { input_tokens: 10.4, output_tokens: null } })).toMatchObject({
      model: 'claude-opus-4-8', user_id: null, input_tokens: 10, output_tokens: 0, cost_usd: 0.00004,
    });
    expect(usageRow(req, 'u', {})).toMatchObject({ model: 'claude-opus-5-5', input_tokens: 0, cost_usd: 0, ok: true });
    expect(usageRow(req, 'u', { usage: null })).toMatchObject({ cost_usd: 0 });
  });
});

describe('errors', () => {
  class RateLimitError extends Error {
    status = 429;
    constructor() { super('Rate limited'); this.name = 'RateLimitError'; }
  }
  it('describes SDK errors by class name, status and message', () => {
    expect(describeError(new RateLimitError())).toEqual({ name: 'RateLimitError', status: 429, message: 'Rate limited' });
    expect(describeError(new TypeError('fetch failed'))).toEqual({ name: 'TypeError', status: null, message: 'fetch failed' });
    expect(describeError('boom')).toEqual({ name: 'Error', status: null, message: 'boom' });
    expect(describeError(null)).toMatchObject({ name: 'Error', status: null });
    expect(describeError({ message: 'x'.repeat(600) }).message).toHaveLength(500);
  });
  it('uses the constructor name when name is missing', () => {
    class Weird { message = 'odd'; }
    expect(describeError(new Weird())).toMatchObject({ name: 'Weird', message: 'odd' });
  });
  it('writes a failed call with ok=false, no cost and the error class', () => {
    const row = errorRow(req, 'user-1', new RateLimitError());
    expect(row).toEqual({
      app: 'demo-app', user_id: 'user-1', model: 'claude-opus-5-5',
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      cost_usd: 0, ok: false, error: 'RateLimitError 429: Rate limited',
    });
    expect(errorRow(req, null, new Error('x')).error).toBe('Error: x');
  });
});
