/**
 * Streaming for the gateway (docs/platform.md, section 3). With
 * `"stream": true` Anthropic's server-sent events pass through to the caller
 * byte for byte, while SseMeter reads the usage from them: message_start
 * gives the model, the input and the cache tokens, message_delta the output
 * tokens (its counts are cumulative). `onEnd` runs exactly once, when the
 * stream ends, and the entry writes the one llm_usage row there:
 *
 * - complete: message_stop arrived and no `error` event. ok; no refund.
 * - failed: Anthropic sent an `error` event (passed on unchanged), or the
 *   upstream stream broke or ended before message_stop, or the function is
 *   shutting down. ok=false with the tokens seen so far; a credit is
 *   refunded. When the gateway, not Anthropic, ends the stream early, it
 *   first sends the caller an Anthropic-style `error` event (api_error).
 * - aborted: the caller went away. The upstream call is stopped and the
 *   tokens seen so far are recorded, ok=false. The credit is not refunded:
 *   the caller chose to stop, and a non-streaming call whose caller leaves is
 *   charged in full as well.
 *
 * Without a final message_delta the output count is unknown, so the row
 * takes the larger of message_start's count and an estimate from the
 * streamed deltas (text, thinking, tool input): one token per
 * BYTES_PER_TOKEN UTF-8 bytes. Thinking that streams no text (the default
 * display "omitted") is not in the estimate.
 *
 * An error before the first event (the stream breaks or ends empty, or its
 * first event is `error`) is not streamed: startRelay returns it, and the
 * entry answers with JSON as for a non-streaming call.
 *
 * Pure: web streams and TextDecoder only, so vitest runs it on Node; the
 * Deno entry wires it to the SDK and supabase-js.
 */
import { costUsd } from './pricing.ts';
import { describeError, type UsageRow } from './request.ts';
import type { GatewayRequest } from './validate.ts';

export interface StreamTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** What the meter has read from the events so far. */
export interface MeterState {
  /** Events dispatched, of any type (ping included). */
  events: number;
  /** The first event's type: normally message_start; "error" when the call failed at once. */
  first: string | null;
  /** The model that answers, from message_start (a server-side fallback may differ from the request). */
  model: string | null;
  usage: StreamTokens;
  /** A message_delta gave output_tokens, so the output count is exact. */
  outputFinal: boolean;
  stopped: boolean;
  stopReason: string | null;
  /** An `error` event's error object. */
  error: { type: string; message: string } | null;
  /** UTF-8 bytes of the text, thinking and tool-input deltas. */
  deltaBytes: number;
}

const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;
const DELTA_FIELDS = ['text', 'thinking', 'partial_json'] as const;

/** The output estimate's divisor: about 4 bytes a token in English, 3 in CJK text, so this errs high. */
export const BYTES_PER_TOKEN = 3;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** UTF-8 length of a string without allocating. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4; // a surrogate pair
      i += 1;
    } else n += 3;
  }
  return n;
}

export function estimatedOutputTokens(state: MeterState): number {
  return Math.ceil(state.deltaBytes / BYTES_PER_TOKEN);
}

/**
 * An incremental parser of a server-sent event stream (the WHATWG rules:
 * lines end in LF or CRLF, a blank line dispatches, `:` starts a comment,
 * `data:` lines join with LF) that keeps only what the ledger needs.
 */
export class SseMeter {
  readonly state: MeterState = {
    events: 0,
    first: null,
    model: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    outputFinal: false,
    stopped: false,
    stopReason: null,
    error: null,
    deltaBytes: 0,
  };
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private eventName = '';
  private data: string[] = [];

  /** Reads one chunk of bytes; returns how many events it completed. */
  push(chunk: Uint8Array): number {
    return this.lines(this.decoder.decode(chunk, { stream: true }));
  }

  /** The end of the stream: a last event without its blank line still counts. */
  end(): number {
    let n = this.lines(this.decoder.decode());
    if (this.buffer) n += this.line(this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer);
    this.buffer = '';
    return n + this.dispatch();
  }

  private lines(text: string): number {
    const buf = this.buffer + text;
    let n = 0;
    let start = 0;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n', start)) {
      const stop = i > start && buf.charCodeAt(i - 1) === 13 ? i - 1 : i;
      n += this.line(buf.slice(start, stop));
      start = i + 1;
    }
    this.buffer = buf.slice(start);
    return n;
  }

  private line(line: string): number {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return 0;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.eventName = value;
    return 0;
  }

  private dispatch(): number {
    const name = this.eventName;
    this.eventName = '';
    if (this.data.length === 0) return 0;
    const text = this.data.join('\n');
    this.data = [];
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const p = isObject(payload) ? payload : {};
    this.apply(typeof p.type === 'string' && p.type ? p.type : name || 'message', p);
    return 1;
  }

  private apply(type: string, p: Record<string, unknown>): void {
    const s = this.state;
    s.events += 1;
    if (s.first === null) s.first = type;
    if (type === 'message_start') {
      const m = isObject(p.message) ? p.message : {};
      if (typeof m.model === 'string' && m.model) s.model = m.model;
      this.tokens(m.usage, false);
    } else if (type === 'message_delta') {
      this.tokens(p.usage, true);
      const d = isObject(p.delta) ? p.delta : {};
      if (typeof d.stop_reason === 'string') s.stopReason = d.stop_reason;
    } else if (type === 'message_stop') {
      s.stopped = true;
    } else if (type === 'error') {
      const e = isObject(p.error) ? p.error : {};
      s.error = { type: typeof e.type === 'string' && e.type ? e.type : 'error', message: typeof e.message === 'string' ? e.message : '' };
    } else if (type === 'content_block_delta') {
      const d = isObject(p.delta) ? p.delta : {};
      for (const f of DELTA_FIELDS) {
        const v = d[f];
        if (typeof v === 'string') s.deltaBytes += utf8Bytes(v);
      }
    }
  }

  /** message_start's usage, then message_delta's cumulative counts over it, field by field. */
  private tokens(usage: unknown, delta: boolean): void {
    if (!isObject(usage)) return;
    for (const f of TOKEN_FIELDS) {
      const v = count(usage[f]);
      if (v === null) continue;
      this.state.usage[f] = v;
      if (delta && f === 'output_tokens') this.state.outputFinal = true;
    }
  }
}

/** A failure as the ledger and the 502 body describe it (as describeError in request.ts). */
export interface UpstreamError {
  name: string;
  status: number | null;
  message: string;
}

export type StreamEnd = 'complete' | 'failed' | 'aborted';

export interface StreamOutcome {
  end: StreamEnd;
  /** False when nothing was streamed and the caller gets a JSON error instead. */
  streamed: boolean;
  meter: MeterState;
  /** Why it did not complete; null when complete. */
  error: UpstreamError | null;
}

export interface RelayOptions {
  /** Called exactly once, when the stream ends for any reason; the stream closes after it settles. */
  onEnd(outcome: StreamOutcome): Promise<void> | void;
  /** Stops the upstream call (the entry aborts the SDK request). */
  abortUpstream?(): void;
}

export interface Relay {
  ok: true;
  /** The bytes for the caller: Anthropic's events unchanged. */
  body: ReadableStream<Uint8Array>;
  /** Ends the stream now (the function is shutting down): an error event to the caller, a failed outcome. */
  stop(error: UpstreamError): Promise<void>;
}

export type RelayStart = Relay | { ok: false; error: UpstreamError };

/** The HTTP status each Anthropic error type stands for (api/errors). */
export const ERROR_STATUS: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  conflict_error: 409,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

const streamError = (message: string): UpstreamError => ({ name: 'StreamError', status: null, message });

function eventError(e: { type: string; message: string }): UpstreamError {
  return { name: e.type, status: ERROR_STATUS[e.type] ?? null, message: (e.message || 'The model stream failed.').slice(0, 500) };
}

/** An Anthropic-style `error` event, for a stream the gateway ends itself. */
export function errorEvent(message: string, type: string = 'api_error'): string {
  return `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type, message } })}\n\n`;
}

/**
 * Reads the upstream stream up to its first event. An error by then comes
 * back as { ok: false } (after onEnd). Otherwise the returned body replays
 * the bytes read so far and relays the rest, and onEnd runs when it ends.
 */
export async function startRelay(upstream: ReadableStream<Uint8Array> | null, opts: RelayOptions): Promise<RelayStart> {
  const meter = new SseMeter();
  const settle = async (end: StreamEnd, streamed: boolean, error: UpstreamError | null): Promise<void> => {
    try {
      await opts.onEnd({ end, streamed, meter: meter.state, error });
    } catch (err) {
      console.error('stream onEnd failed:', describeError(err).message);
    }
  };
  const early = async (error: UpstreamError): Promise<RelayStart> => {
    await settle('failed', false, error);
    return { ok: false, error };
  };

  if (!upstream) return early(streamError('The upstream answer had no body.'));
  const reader = upstream.getReader();
  const release = (): void => {
    try {
      opts.abortUpstream?.();
    } catch {
      // the upstream call is gone already
    }
    reader.cancel().catch(() => undefined);
  };

  const pending: Uint8Array[] = [];
  let done = false;
  try {
    while (meter.state.events === 0) {
      const r = await reader.read();
      if (r.done) {
        done = true;
        meter.end();
        break;
      }
      pending.push(r.value);
      meter.push(r.value);
    }
  } catch (err) {
    release();
    return early(describeError(err));
  }
  if (meter.state.events === 0) return early(streamError('The upstream stream ended before its first event.'));
  // The meter sets `error` for every error event, so a first event of that type has one.
  const firstError = meter.state.first === 'error' ? meter.state.error : null;
  if (firstError) {
    if (!done) release();
    return early(eventError(firstError));
  }

  const encoder = new TextEncoder();
  let finished = false;
  let out: ReadableStreamDefaultController<Uint8Array> | null = null;
  // `out` is cleared in cancel(), and this stream is never errored, so the
  // controller is open whenever `out` is set.
  const toCaller = (send: (c: ReadableStreamDefaultController<Uint8Array>) => void): void => {
    if (out) send(out);
  };
  // Runs once: every caller returns early when `finished` is set. `notice`:
  // an error event for the caller, when the gateway ends the stream and
  // Anthropic did not.
  const finish = async (end: StreamEnd, error: UpstreamError | null, notice: string | null): Promise<void> => {
    finished = true;
    if (notice !== null) toCaller((c) => c.enqueue(encoder.encode(errorEvent(notice))));
    await settle(end, true, error);
    toCaller((c) => c.close());
  };
  const ended = (): Promise<void> => {
    const s = meter.state;
    if (s.error) return finish('failed', eventError(s.error), null);
    if (s.stopped) return finish('complete', null, null);
    const e = streamError('The upstream stream ended before message_stop.');
    return finish('failed', e, e.message);
  };
  // Stopped early (caller gone, or shutdown): complete if message_stop came already.
  const cut = (end: 'failed' | 'aborted', error: UpstreamError, notice: boolean): Promise<void> => {
    if (finished) return Promise.resolve();
    release();
    if (meter.state.stopped && !meter.state.error) return finish('complete', null, null);
    return finish(end, error, notice ? error.message : null);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      out = controller;
      for (const chunk of pending) controller.enqueue(chunk);
      return done ? ended() : undefined;
    },
    async pull(controller) {
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await reader.read();
      } catch (err) {
        if (finished) return;
        const d = describeError(err);
        const e = { ...d, message: `The upstream stream broke: ${d.message}`.slice(0, 500) };
        return finish('failed', e, e.message);
      }
      if (finished) return;
      if (r.done) {
        meter.end();
        return ended();
      }
      meter.push(r.value);
      controller.enqueue(r.value);
    },
    cancel() {
      out = null; // the caller closed it: nothing more can be sent
      return cut('aborted', { name: 'ClientAbort', status: null, message: 'The caller closed the stream before message_stop.' }, false);
    },
  });

  return { ok: true, body, stop: (error) => cut('failed', error, true) };
}

/** The llm_usage row for a stream; the entry sets paid_with_credit, as for usageRow. */
export function streamRow(req: GatewayRequest, userId: string | null, outcome: StreamOutcome): UsageRow {
  const m = outcome.meter;
  const model = m.model || req.model;
  const estimate = estimatedOutputTokens(m);
  const estimated = !m.outputFinal && estimate > m.usage.output_tokens;
  const output_tokens = estimated ? estimate : m.usage.output_tokens;
  const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = m.usage;
  let error: string | null = null;
  if (outcome.end !== 'complete') {
    const e = outcome.error ?? streamError('The stream did not complete.');
    error = `${e.name}${e.status ? ` ${e.status}` : ''}${estimated ? ' (output tokens estimated)' : ''}: ${e.message}`.slice(0, 500);
  }
  return {
    app: req.app,
    user_id: userId,
    model,
    input_tokens,
    output_tokens,
    cache_read_tokens: cache_read_input_tokens,
    cache_write_tokens: cache_creation_input_tokens,
    cost_usd: costUsd(model, { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }),
    ok: outcome.end === 'complete',
    error,
    paid_with_credit: false,
  };
}

/** A reserved credit goes back when the call failed (Anthropic or the gateway ended it), not when the caller left. */
export function refundsCredit(outcome: StreamOutcome): boolean {
  return outcome.end === 'failed';
}
