import { describe, expect, it, vi } from 'vitest';
import { buildRequest, DEFAULT_MODEL, MAX_TOKENS, writeAltText, type Generate } from '../../src/core/alt-text';

const base = { base64: 'QUJD', mediaType: 'image/png' as const, skill: 'name: x\n---\n# Skill' };

describe('writeAltText', () => {
  it('builds one request with the cached skill, the image and the options', () => {
    const r = buildRequest({ ...base, options: { purpose: 'question' } });
    expect(r.model).toBe(DEFAULT_MODEL);
    expect(r.max_tokens).toBe(MAX_TOKENS);
    expect(r.system[0].text.startsWith('# Skill')).toBe(true);
    expect(r.messages[0].content[1].text).toMatch(/question or problem/);
    expect(buildRequest({ ...base, model: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5');
  });
  it('returns alt text with warnings, the model, usage and time', async () => {
    let t = 1000;
    const generate: Generate = vi.fn(async () => ({ text: 'A double bond.', model: 'm', usage: { input_tokens: 5 }, stopReason: 'end_turn' }));
    const r = await writeAltText({ ...base, generate, now: () => (t += 500) });
    expect(r).toMatchObject({ kind: 'alt', altText: 'A double bond.', model: 'm', usage: { input_tokens: 5 }, ms: 500 });
    expect(r.warnings[0]).toMatch(/bond type/);
  });
  it('says so when the reply was cut off or refused', async () => {
    const cut = await writeAltText({ ...base, generate: async () => ({ text: 'Part', stopReason: 'max_tokens' }) });
    expect(cut.warnings[0]).toMatch(/cut off/);
    const refused = await writeAltText({ ...base, generate: async () => ({ text: '', stopReason: 'refusal' }) });
    expect(refused).toMatchObject({ kind: 'error', message: expect.stringMatching(/declined/) });
  });
  it('passes questions through without warnings', async () => {
    const r = await writeAltText({ ...base, generate: async () => ({ text: 'QUESTION: Answer key?' }) });
    expect(r).toMatchObject({ kind: 'question', question: 'Answer key?', warnings: [] });
  });
});
