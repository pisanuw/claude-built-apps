import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkThinking } from '../src/gateway/thinking.ts';
import { validateRequest, type AppRow } from '../src/gateway/validate.ts';

// The admin script talks to the Management API; SUPABASE_ADMIN_NO_RUN=1 lets
// its pure helpers be imported without running a command.
type Admin = typeof import('../supabase-admin.mjs');
let m: Admin;
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  m = await import('../supabase-admin.mjs');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = (type: string, data: Record<string, unknown> = {}): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const row = (over: Record<string, unknown> = {}) => ({ ok: true, error: null, input_tokens: 21, output_tokens: 32, cost_usd: 0.000018, ...over });
const LEFT = 'ClientLeft: the caller closed the stream before message_stop; the reply was read to its end';

describe('gateway-check: the test app and the calls', () => {
  it('upserts the test app idempotently: only the cheapest model, 64 tokens, small caps', () => {
    const q = m.gatewayCheckAppSql();
    expect(q).toContain("values ('gateway-check', true, 'claude-haiku-5-5', array['claude-haiku-5-5'], 64, 0.05, 0.20, 0.50, 0.05)");
    expect(q).toContain('on conflict (slug) do update set enabled = excluded.enabled');
    for (const col of ['default_model', 'allowed_models', 'max_tokens', 'cap_day_usd', 'cap_week_usd', 'cap_month_usd', 'cap_user_day_usd']) {
      expect(q).toContain(`${col} = excluded.${col}`);
    }
    expect(q).toMatch(/select jsonb_build_object\(.*\)::text as result\s+from platform\.llm_apps where slug = 'gateway-check';$/s);
  });

  it('sends a body the gateway accepts for that app: thinking off on the cheapest model, 32 tokens, stream only when asked', () => {
    const plain = m.gatewayCheckBody(false);
    const streamed = m.gatewayCheckBody(true);
    expect(plain).toEqual({
      app: 'gateway-check', model: 'claude-haiku-5-5', max_tokens: 32, thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: m.CHECK_PROMPT }],
    });
    expect(streamed).toEqual({ ...plain, stream: true });
    const app: AppRow = { slug: 'gateway-check', enabled: true, default_model: 'claude-haiku-5-5', allowed_models: ['claude-haiku-5-5'], max_tokens: 64 };
    expect(validateRequest(streamed as Record<string, unknown>, app)).toMatchObject({ ok: true, request: { max_tokens: 32, thinking: { type: 'disabled' }, stream: true } });
    expect(checkThinking(plain as Record<string, unknown>, m.CHECK_MODEL)).toEqual({ ok: true, thinking: { type: 'disabled' } });
    expect(m.CHECK_URL).toBe('https://auth.hintwise.org/functions/v1/llm-gateway');
    expect(m.CHECK_PROMPT).not.toMatch(/\n/);
  });
});

describe('gateway-check: reading the stream', () => {
  const FULL = [
    ev('message_start', { message: { model: 'claude-haiku-5-5', usage: { input_tokens: 21, output_tokens: 1 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('ping'),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'one, two' } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 32 } }),
    ev('message_stop'),
  ].join('');

  it('lists the complete events in order, and leaves out a trailing partial one', () => {
    expect(m.sseEventTypes(FULL)).toEqual(['message_start', 'content_block_start', 'ping', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    const cut = FULL.slice(0, FULL.indexOf('content_block_delta') + 30);
    expect(m.sseEventTypes(cut)).toEqual(['message_start', 'content_block_start', 'ping']);
    expect(m.sseEventTypes('')).toEqual([]);
  });

  it('reads CRLF, comments, events without data, and non-JSON data by the event name', () => {
    const text = ': keep-alive\r\n\r\nevent: ping\r\n\r\nevent: odd\r\ndata: not json\r\n\r\ndata: [1]\r\n\r\ndata:{"type":"message_stop"}\r\n\r\n';
    expect(m.sseEventTypes(text)).toEqual(['odd', 'message', 'message_stop']);
  });

  it('calls a stream complete only when message_stop came and no error event', () => {
    expect(m.sseComplete(m.sseEventTypes(FULL))).toBe(true);
    expect(m.sseComplete(['message_start', 'content_block_delta'])).toBe(false);
    expect(m.sseComplete(['message_start', 'error', 'message_stop'])).toBe(false);
  });
});

describe('gateway-check: matching the llm_usage rows', () => {
  it('passes three ok rows, the third with the ClientLeft note, and totals the cost', () => {
    const r = m.matchCheckRows([row(), row(), row({ error: LEFT })]);
    expect(r.problems).toEqual([]);
    expect(r.total).toBe(0.000054);
    expect(r.lines).toEqual([
      'a non-streaming: ok true, note none, input 21, output 32, cost $0.000018',
      'b streamed: ok true, note none, input 21, output 32, cost $0.000018',
      `c streamed, caller left: ok true, note ${JSON.stringify(LEFT)}, input 21, output 32, cost $0.000018`,
    ]);
  });

  it('names a missing third row as the drain or its insert not finishing', () => {
    const r = m.matchCheckRows([row(), row()]);
    expect(r.problems).toEqual(['expected 3 llm_usage rows for gateway-check since the run started, found 2: the stream the caller left has no row, so the gateway did not finish reading it or its insert']);
    expect(m.matchCheckRows([]).problems).toEqual(['expected 3 llm_usage rows for gateway-check since the run started, found 0']);
    expect(m.matchCheckRows([row(), row(), row({ error: LEFT }), row()]).problems[0]).toMatch(/found 4$/);
    expect(m.matchCheckRows([row(), row(), row({ error: LEFT }), row()]).lines[3]).toMatch(/^extra row 4:/);
  });

  it('tells a stream cut at max_tokens from one never left, and from a failure', () => {
    const bounded = m.matchCheckRows([row(), row(), row({ ok: false, error: 'Shutdown: stop; the caller had closed the stream; output_tokens is max_tokens (no final message_delta)' })]);
    expect(bounded.problems).toEqual(['c streamed, caller left: counted at max_tokens with no message_delta, so the gateway stopped reading after the caller left (the worker ended?)']);
    const late = m.matchCheckRows([row(), row(), row()]);
    expect(late.problems).toEqual(['c streamed, caller left: no ClientLeft note, so the abort reached the gateway only after message_stop and the drain was not tested; run the check again']);
    const failed = m.matchCheckRows([row(), row(), row({ ok: false, error: 'overloaded_error 529: Overloaded' })]);
    expect(failed.problems).toEqual(['c streamed, caller left: expected ok, got note "overloaded_error 529: Overloaded"']);
  });

  it('wants the first two rows ok with no note and every row with output tokens', () => {
    const r = m.matchCheckRows([row({ ok: false, error: 'BadRequestError 400: bad' }), row({ output_tokens: 0 }), row({ error: LEFT, output_tokens: null })]);
    expect(r.problems).toEqual([
      'a non-streaming: expected ok with no note, got ok false, note "BadRequestError 400: bad"',
      'b streamed: no output tokens recorded',
      'c streamed, caller left: no output tokens recorded',
    ]);
  });

  it('fails a run that cost $0.01 or more', () => {
    const r = m.matchCheckRows([row({ cost_usd: '0.004' }), row({ cost_usd: 0.004 }), row({ error: LEFT, cost_usd: 0.002 })]);
    expect(r.total).toBe(0.01);
    expect(r.problems).toEqual(['the total cost $0.010000 is not under $0.01']);
    expect(m.matchCheckRows([row({ cost_usd: null }), row(), row({ error: LEFT })]).total).toBe(0.000036);
  });
});

describe('gateway-check in the Supabase admin workflow', () => {
  const wf = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'supabase-admin.yml'), 'utf8');
  it('is a command, waits for the owner (not on the read-only skip list), and gets the service-role key', () => {
    expect(wf).toMatch(/description: '[^']*\| analytics-register \| gateway-check'/);
    const skip = wf.match(/approve:\n {4}if: \$\{\{ !contains\(fromJSON\('(\[[^\]]*\])'\)/);
    expect(skip).not.toBeNull();
    expect(JSON.parse((skip as RegExpMatchArray)[1])).not.toContain('gateway-check');
    expect(wf).toContain("inputs.command == 'gateway-check') && secrets.SUPABASE_SERVICE_ROLE_KEY || ''");
  });
});
