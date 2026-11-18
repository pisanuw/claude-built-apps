import { describe, expect, it } from 'vitest';
import { checkThinking, EFFORTS, THINKING_OFF, THINKING_OFF_EFFORTS, THINKING_TYPES } from '../src/gateway/thinking.ts';
import { KNOWN_MODELS } from '../src/gateway/pricing.ts';

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';

describe('the allow-list', () => {
  it('covers exactly the priced models, from the API reference (18 Nov 2026)', () => {
    expect(Object.keys(THINKING_TYPES).sort()).toEqual([...KNOWN_MODELS].sort());
    expect(THINKING_TYPES[OPUS]).toEqual(['adaptive']);
    expect(THINKING_TYPES[SONNET]).toEqual(['adaptive', 'between_tools']);
    expect(THINKING_TYPES[HAIKU]).toEqual(['adaptive', 'disabled']);
    expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(THINKING_OFF).toEqual(['between_tools', 'disabled']);
    expect(THINKING_OFF_EFFORTS).toEqual(['low', 'medium', 'high']);
  });
});

describe('checkThinking', () => {
  it('returns nothing to add when neither field is given', () => {
    expect(checkThinking({}, OPUS)).toEqual({ ok: true });
    expect(checkThinking({}, 'claude-unknown')).toEqual({ ok: true });
  });

  it('lets each model turn thinking off its own way, and only that way', () => {
    expect(checkThinking({ thinking: { type: 'between_tools' } }, SONNET)).toEqual({ ok: true, thinking: { type: 'between_tools' } });
    expect(checkThinking({ thinking: { type: 'disabled' } }, HAIKU)).toEqual({ ok: true, thinking: { type: 'disabled' } });
    expect(checkThinking({ thinking: { type: 'disabled' } }, SONNET)).toMatchObject({ ok: false, status: 400, error: /"disabled" is not allowed for claude-sonnet-5-5. Allowed: "adaptive", "between_tools"\./ });
    expect(checkThinking({ thinking: { type: 'between_tools' } }, HAIKU)).toMatchObject({ ok: false, status: 400, error: /Allowed: "adaptive", "disabled"/ });
  });

  it('tells claude-opus-5-5 callers to lower the effort, since its thinking cannot be turned off', () => {
    for (const type of ['disabled', 'between_tools', 'enabled']) {
      const r = checkThinking({ thinking: { type } }, OPUS);
      expect(r).toMatchObject({ ok: false, status: 400 });
      expect(!r.ok && r.error).toMatch(/Allowed: "adaptive"\. Thinking cannot be turned off on this model; lower "output_config.effort" instead\./);
    }
  });

  it('accepts adaptive on every model', () => {
    for (const m of KNOWN_MODELS) expect(checkThinking({ thinking: { type: 'adaptive' } }, m)).toEqual({ ok: true, thinking: { type: 'adaptive' } });
  });

  it('refuses any other shape or field inside thinking', () => {
    for (const thinking of [null, 'adaptive', [], {}, { type: 5 }]) {
      expect(checkThinking({ thinking }, OPUS)).toEqual({ ok: false, status: 400, error: '"thinking" must be an object like {"type": "adaptive"} when given.' });
    }
    expect(checkThinking({ thinking: { type: 'adaptive', display: 'summarized' } }, OPUS)).toEqual({
      ok: false, status: 400, error: '"thinking" takes only "type" through the gateway; not "display".',
    });
    expect(checkThinking({ thinking: { type: 'enabled', budget_tokens: 1024 } }, HAIKU)).toMatchObject({ ok: false, error: /not "budget_tokens"/ });
  });

  it('accepts every effort level on every model', () => {
    for (const m of KNOWN_MODELS) {
      for (const effort of EFFORTS) expect(checkThinking({ output_config: { effort } }, m)).toEqual({ ok: true, output_config: { effort } });
    }
  });

  it('refuses a bad effort and any other output_config field', () => {
    expect(checkThinking({ output_config: { effort: 'none' } }, OPUS)).toEqual({
      ok: false, status: 400, error: '"output_config.effort" must be one of "low", "medium", "high", "xhigh", "max".',
    });
    for (const output_config of [null, 'low', [], {}, { effort: 1 }]) {
      expect(checkThinking({ output_config }, OPUS)).toMatchObject({ ok: false, status: 400, error: /"output_config" must be an object like/ });
    }
    expect(checkThinking({ output_config: { effort: 'low', format: { type: 'json_schema' } } }, OPUS)).toEqual({
      ok: false, status: 400, error: '"output_config" takes only "effort" through the gateway; not "format".',
    });
  });

  it('limits thinking-off settings to effort high or below, as the API does', () => {
    for (const effort of THINKING_OFF_EFFORTS) {
      expect(checkThinking({ thinking: { type: 'between_tools' }, output_config: { effort } }, SONNET)).toEqual({
        ok: true, thinking: { type: 'between_tools' }, output_config: { effort },
      });
      expect(checkThinking({ thinking: { type: 'disabled' }, output_config: { effort } }, HAIKU)).toMatchObject({ ok: true });
    }
    for (const effort of ['xhigh', 'max']) {
      expect(checkThinking({ thinking: { type: 'between_tools' }, output_config: { effort } }, SONNET)).toEqual({
        ok: false, status: 400,
        error: `"thinking.type" "between_tools" needs "output_config.effort" "low", "medium", "high"; "${effort}" needs adaptive thinking.`,
      });
      expect(checkThinking({ thinking: { type: 'disabled' }, output_config: { effort } }, HAIKU)).toMatchObject({ ok: false, status: 400 });
      expect(checkThinking({ thinking: { type: 'adaptive' }, output_config: { effort } }, SONNET)).toMatchObject({ ok: true });
    }
  });

  it('passes neither field for a model the table does not know', () => {
    expect(checkThinking({ thinking: { type: 'adaptive' } }, 'claude-opus-4-8')).toEqual({
      ok: false, status: 400, error: '"thinking" is not supported through the gateway for model "claude-opus-4-8".',
    });
    expect(checkThinking({ output_config: { effort: 'low' } }, 'claude-opus-4-8')).toEqual({
      ok: false, status: 400, error: '"output_config.effort" is not supported through the gateway for model "claude-opus-4-8".',
    });
  });
});
