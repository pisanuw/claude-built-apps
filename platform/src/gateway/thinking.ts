/**
 * The thinking and effort settings the gateway lets through (docs/platform.md,
 * section 3). Checked on 18 Nov 2026 against the Claude API documentation
 * (build-with-claude/thinking, its per-model table, and build-with-claude/effort):
 *
 * - All three platform models run adaptive thinking when a request has no
 *   `thinking` field, so a reply can begin with a thinking block, and
 *   thinking counts toward `max_tokens`.
 * - claude-opus-5-5 cannot turn thinking off: "disabled", "between_tools"
 *   and budgets are a 400 there. Effort is its only control.
 * - claude-sonnet-5-5 turns up-front thinking off with "between_tools"
 *   ("disabled" is a 400), at effort high or below.
 * - claude-haiku-5-5 turns it off with "disabled" ("between_tools" is a 400),
 *   at effort high or below.
 * - All three take `output_config.effort` low, medium, high, xhigh or max.
 *   The defaults: medium on claude-opus-5-5 and claude-haiku-5-5, high on
 *   claude-sonnet-5-5.
 *
 * Anything else is refused here with a 400, before the call, so the API never
 * sees a setting it would reject. A model outside this table (one an app added
 * to allowed_models later) takes neither field until the table knows it.
 */
import type { Failure } from './validate.ts';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export type ThinkingType = 'adaptive' | 'between_tools' | 'disabled';

/** The `thinking.type` values each model accepts through the gateway. */
export const THINKING_TYPES: Readonly<Record<string, readonly ThinkingType[]>> = {
  'claude-opus-5-5': ['adaptive'],
  'claude-sonnet-5-5': ['adaptive', 'between_tools'],
  'claude-haiku-5-5': ['adaptive', 'disabled'],
};

/** The settings that turn thinking off, and the effort levels they accept. */
export const THINKING_OFF: readonly ThinkingType[] = ['between_tools', 'disabled'];
export const THINKING_OFF_EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

export interface ThinkingSettings {
  thinking?: { type: ThinkingType };
  output_config?: { effort: Effort };
}

const fail = (error: string): Failure => ({ ok: false, status: 400, error });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (xs: readonly string[]): string => xs.map((x) => `"${x}"`).join(', ');

/**
 * Checks `thinking` and `output_config` for `model`. Each is an object with
 * one field (`type`, `effort`); any other field is refused, so the gateway
 * passes on exactly what this table allows.
 */
export function checkThinking(body: Record<string, unknown>, model: string): ({ ok: true } & ThinkingSettings) | Failure {
  const types = THINKING_TYPES[model];
  const out: { ok: true } & ThinkingSettings = { ok: true };

  if (body.thinking !== undefined) {
    const t = body.thinking;
    if (!isObject(t) || typeof t.type !== 'string') return fail('"thinking" must be an object like {"type": "adaptive"} when given.');
    const extra = Object.keys(t).filter((k) => k !== 'type');
    if (extra.length) return fail(`"thinking" takes only "type" through the gateway; not ${list(extra)}.`);
    if (!types) return fail(`"thinking" is not supported through the gateway for model "${model}".`);
    if (!(types as readonly string[]).includes(t.type)) {
      const hint = types.length === 1 ? ' Thinking cannot be turned off on this model; lower "output_config.effort" instead.' : '';
      return fail(`"thinking.type" "${t.type}" is not allowed for ${model}. Allowed: ${list(types)}.${hint}`);
    }
    out.thinking = { type: t.type as ThinkingType };
  }

  if (body.output_config !== undefined) {
    const c = body.output_config;
    if (!isObject(c) || typeof c.effort !== 'string') return fail('"output_config" must be an object like {"effort": "low"} when given.');
    const extra = Object.keys(c).filter((k) => k !== 'effort');
    if (extra.length) return fail(`"output_config" takes only "effort" through the gateway; not ${list(extra)}.`);
    if (!types) return fail(`"output_config.effort" is not supported through the gateway for model "${model}".`);
    if (!(EFFORTS as readonly string[]).includes(c.effort)) return fail(`"output_config.effort" must be one of ${list(EFFORTS)}.`);
    out.output_config = { effort: c.effort as Effort };
  }

  const off = out.thinking && THINKING_OFF.includes(out.thinking.type);
  if (off && out.output_config && !THINKING_OFF_EFFORTS.includes(out.output_config.effort)) {
    return fail(`"thinking.type" "${out.thinking?.type}" needs "output_config.effort" ${list(THINKING_OFF_EFFORTS)}; "${out.output_config.effort}" needs adaptive thinking.`);
  }
  return out;
}
