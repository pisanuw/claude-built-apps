import { describe, expect, it } from 'vitest';
import { appSlug, MAX_BODY_BYTES, MAX_MESSAGES, MAX_TOOLS, parseBody, validateRequest, type AppRow } from '../src/gateway/validate.ts';

const app: AppRow = {
  slug: 'demo-app',
  enabled: true,
  default_model: 'claude-opus-5-5',
  allowed_models: ['claude-opus-5-5', 'claude-haiku-5-5'],
  max_tokens: 4096,
};
const good = { app: 'demo-app', messages: [{ role: 'user', content: 'Hello' }] };

describe('parseBody', () => {
  it('accepts a JSON object', () => {
    expect(parseBody(JSON.stringify(good))).toEqual({ ok: true, body: good });
  });
  it('rejects an empty body, bad JSON and non-objects', () => {
    expect(parseBody('')).toMatchObject({ ok: false, status: 400, error: /empty/ });
    expect(parseBody('   ')).toMatchObject({ ok: false, status: 400 });
    expect(parseBody('{nope')).toMatchObject({ ok: false, status: 400, error: /valid JSON/ });
    expect(parseBody('[1,2]')).toMatchObject({ ok: false, status: 400, error: /object/ });
    expect(parseBody('"str"')).toMatchObject({ ok: false, status: 400 });
    expect(parseBody('null')).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects a body over 1 MB with 413, counting bytes not characters', () => {
    const big = JSON.stringify({ ...good, pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(parseBody(big)).toMatchObject({ ok: false, status: 413, error: /limit is 1000000/ });
    const exactly = '{"a":"' + 'x'.repeat(MAX_BODY_BYTES - 8) + '"}';
    expect(new TextEncoder().encode(exactly).length).toBe(MAX_BODY_BYTES);
    expect(parseBody(exactly).ok).toBe(true);
    const multibyte = '{"a":"' + 'é'.repeat(MAX_BODY_BYTES / 2) + '"}'; // 2 bytes each
    expect(parseBody(multibyte)).toMatchObject({ ok: false, status: 413 });
  });
});

describe('appSlug', () => {
  it('requires a slug', () => {
    expect(appSlug({ app: 'demo-app' })).toEqual({ ok: true, slug: 'demo-app' });
    expect(appSlug({})).toMatchObject({ ok: false, status: 400, error: /"app" is required/ });
    expect(appSlug({ app: '' })).toMatchObject({ ok: false, status: 400 });
    expect(appSlug({ app: 42 })).toMatchObject({ ok: false, status: 400 });
    expect(appSlug({ app: 'Demo App' })).toMatchObject({ ok: false, status: 400, error: /slug/ });
    expect(appSlug({ app: '-x' })).toMatchObject({ ok: false });
    expect(appSlug({ app: 'a'.repeat(65) })).toMatchObject({ ok: false });
  });
});

describe('validateRequest', () => {
  it('fills the defaults for a minimal body', () => {
    expect(validateRequest(good, app)).toEqual({
      ok: true,
      request: { app: 'demo-app', model: 'claude-opus-5-5', max_tokens: 4096, messages: good.messages },
    });
  });
  it('passes system, tools and an allowed model through', () => {
    const body = { ...good, model: 'claude-haiku-5-5', max_tokens: 100, system: 'Be brief', tools: [{ name: 't' }] };
    expect(validateRequest(body, app)).toEqual({
      ok: true,
      request: { app: 'demo-app', model: 'claude-haiku-5-5', max_tokens: 100, system: 'Be brief', tools: [{ name: 't' }], messages: good.messages },
    });
    expect(validateRequest({ ...good, system: [{ type: 'text', text: 'x' }] }, app)).toMatchObject({ ok: true, request: { system: [{ type: 'text', text: 'x' }] } });
  });
  it('rejects a model outside allowed_models and a bad model field', () => {
    expect(validateRequest({ ...good, model: 'claude-sonnet-5-5' }, app)).toMatchObject({ ok: false, status: 400, error: /not allowed for app "demo-app"/ });
    expect(validateRequest({ ...good, model: '' }, app)).toMatchObject({ ok: false, status: 400, error: /"model"/ });
    expect(validateRequest({ ...good, model: 7 }, app)).toMatchObject({ ok: false, status: 400 });
    expect(validateRequest(good, { ...app, allowed_models: [] })).toMatchObject({ ok: false, error: /\(none\)/ });
    expect(validateRequest(good, { ...app, allowed_models: null as unknown as string[] })).toMatchObject({ ok: false });
  });
  it('clamps max_tokens to the app limit and rejects nonsense', () => {
    expect(validateRequest({ ...good, max_tokens: 99_999 }, app)).toMatchObject({ ok: true, request: { max_tokens: 4096 } });
    expect(validateRequest({ ...good, max_tokens: 4096 }, app)).toMatchObject({ ok: true, request: { max_tokens: 4096 } });
    expect(validateRequest({ ...good, max_tokens: 1 }, app)).toMatchObject({ ok: true, request: { max_tokens: 1 } });
    expect(validateRequest({ ...good, max_tokens: 0 }, app)).toMatchObject({ ok: false, error: /positive integer/ });
    expect(validateRequest({ ...good, max_tokens: 1.5 }, app)).toMatchObject({ ok: false });
    expect(validateRequest({ ...good, max_tokens: '100' }, app)).toMatchObject({ ok: false });
    // an app row with a broken max_tokens falls back to 4096
    expect(validateRequest({ ...good, max_tokens: 10_000 }, { ...app, max_tokens: 0 })).toMatchObject({ ok: true, request: { max_tokens: 4096 } });
    expect(validateRequest(good, { ...app, max_tokens: 8000 })).toMatchObject({ ok: true, request: { max_tokens: 8000 } });
  });
  it('checks the messages', () => {
    expect(validateRequest({ app: 'demo-app' }, app)).toMatchObject({ ok: false, error: /"messages" must be a non-empty array/ });
    expect(validateRequest({ app: 'demo-app', messages: [] }, app)).toMatchObject({ ok: false });
    expect(validateRequest({ app: 'demo-app', messages: 'hi' }, app)).toMatchObject({ ok: false });
    expect(validateRequest({ app: 'demo-app', messages: ['hi'] }, app)).toMatchObject({ ok: false, error: /messages\[0\]: each message must be an object/ });
    expect(validateRequest({ app: 'demo-app', messages: [{ role: 'system', content: 'x' }] }, app)).toMatchObject({ ok: false, error: /role "user" or "assistant"/ });
    expect(validateRequest({ app: 'demo-app', messages: [{ role: 'user', content: '' }] }, app)).toMatchObject({ ok: false, error: /must not be empty/ });
    expect(validateRequest({ app: 'demo-app', messages: [{ role: 'user', content: [] }] }, app)).toMatchObject({ ok: false, error: /array must not be empty/ });
    expect(validateRequest({ app: 'demo-app', messages: [{ role: 'user', content: 5 }] }, app)).toMatchObject({ ok: false, error: /needs content/ });
    expect(validateRequest({ app: 'demo-app', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: [{ type: 'text', text: 'b' }] }, { role: 'user', content: 'c' }] }, app)).toMatchObject({ ok: true });
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
    expect(validateRequest({ app: 'demo-app', messages: many }, app)).toMatchObject({ ok: false, error: /201 entries; the limit is 200/ });
    expect(validateRequest({ app: 'demo-app', messages: many.slice(0, MAX_MESSAGES) }, app)).toMatchObject({ ok: true });
  });
  it('checks system and tools', () => {
    expect(validateRequest({ ...good, system: 5 }, app)).toMatchObject({ ok: false, error: /"system"/ });
    expect(validateRequest({ ...good, tools: {} }, app)).toMatchObject({ ok: false, error: /"tools" must be an array/ });
    expect(validateRequest({ ...good, tools: Array.from({ length: MAX_TOOLS + 1 }, () => ({})) }, app)).toMatchObject({ ok: false, error: /65 entries/ });
    expect(validateRequest({ ...good, tools: [] }, app)).toMatchObject({ ok: true, request: { tools: [] } });
  });
  it('reports a bad app slug first', () => {
    expect(validateRequest({ messages: good.messages }, app)).toMatchObject({ ok: false, error: /"app" is required/ });
  });
});
