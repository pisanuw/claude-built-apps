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
 *   shutting down. ok=false; a credit is refunded. When the gateway, not
 *   Anthropic, ends the stream early, it first sends the caller an
 *   Anthropic-style `error` event (api_error).
 *
 * When the caller goes away, the relay stops sending to it but keeps reading
 * the upstream to its end, so the row has the real usage, as for a
 * non-streaming call whose caller leaves. A stream that then reaches
 * message_stop is complete (ok, a counted call), with a note that the caller
 * left (`clientLeft`).
 *
 * Without a final message_delta after message_start (the function is ending,
 * or the upstream broke or ended early), the output count is unknown, and
 * thinking under the default display streams no text. So the row counts the
 * request's max_tokens as the output: the most it can be.
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
  /** message_start arrived: the model began, so output may be billed. */
  started: boolean;
  /** The model that answers, from message_start (a server-side fallback may differ from the request). */
  model: string | null;
  usage: StreamTokens;
  /** A message_delta gave output_tokens, so the output count is exact. */
  outputFinal: boolean;
  stopped: boolean;
  stopReason: string | null;
  /** An `error` event's error object. */
  error: { type: string; message: string } | null;
}

const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * An incremental parser of a server-sent event stream (the WHATWG rules:
 * lines end in LF or CRLF, a blank line dispatches, `:` starts a comment,
 * `data:` lines join with LF) that keeps only what the ledger needs.
 */
export class SseMeter {
  readonly state: MeterState = {
    events: 0,
    first: null,
    started: false,
    model: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    outputFinal: false,
    stopped: false,
    stopReason: null,
    error: null,
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
      s.started = true;
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

export type StreamEnd = 'complete' | 'failed';

export interface StreamOutcome {
  end: StreamEnd;
  /** False when nothing was streamed and the caller gets a JSON error instead. */
  streamed: boolean;
  /** The caller closed the stream before message_stop; the upstream was read on without it. */
  clientLeft: boolean;
  meter: MeterState;
  /** Why it did not complete; null when complete. */
  error: UpstreamError | null;
}

export interface RelayOptions {
  /** Called exactly once, when the stream ends for any reason; the stream closes after it settles. */
  onEnd(outcome: StreamOutcome): Promise<void> | void;
  /** Stops the upstream call (the entry aborts the SDK request): on an early error and on shutdown, not when the caller leaves. */
  abortUpstream?(): void;
}

export interface Relay {
  ok: true;
  /** The bytes for the caller: Anthropic's events unchanged. */
  body: ReadableStream<Uint8Array>;
  /** Ends the stream now (the function is shutting down): an error event to the caller, a failed outcome. */
  stop(error: UpstreamError): Promise<void>;
  /** Settles once onEnd has, also after the caller left: the entry keeps the worker alive for it. */
  done: Promise<void>;
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
  let clientLeft = false;
  const settle = async (end: StreamEnd, streamed: boolean, error: UpstreamError | null): Promise<void> => {
    try {
      await opts.onEnd({ end, streamed, clientLeft, meter: meter.state, error });
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
  let settled!: () => void; // set at once by the Promise executor
  const whenDone = new Promise<void>((resolve) => {
    settled = resolve;
  });
  // `out` is cleared when the caller cancels and after the close, and this
  // stream is never errored, so the controller is open whenever `out` is set.
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
    out = null;
    settled();
  };
  const ended = (): Promise<void> => {
    const s = meter.state;
    if (s.error) return finish('failed', eventError(s.error), null);
    if (s.stopped) return finish('complete', null, null);
    const e = streamError('The upstream stream ended before message_stop.');
    return finish('failed', e, e.message);
  };

  // One read: the meter sees every chunk; the caller gets it while it is there.
  const step = async (): Promise<void> => {
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
    const chunk = r.value;
    meter.push(chunk);
    toCaller((c) => c.enqueue(chunk));
  };
  // Reads run one at a time and in order, whether the caller's pull asks for
  // them or the drain after the caller left.
  let reads: Promise<void> = Promise.resolve();
  const next = (): Promise<void> => (reads = reads.then(step));

  // The function is ending: stop the upstream. Complete if message_stop came already.
  const stop = (error: UpstreamError): Promise<void> => {
    if (finished) return Promise.resolve();
    release();
    if (meter.state.stopped && !meter.state.error) return finish('complete', null, null);
    return finish('failed', error, error.message);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      out = controller;
      for (const chunk of pending) controller.enqueue(chunk);
      return done ? ended() : undefined;
    },
    pull() {
      return next();
    },
    cancel() {
      // The caller left: send nothing more, but read the upstream to its end,
      // so the row has the real usage.
      out = null;
      if (finished) return;
      if (!meter.state.stopped) clientLeft = true;
      void (async () => {
        while (!finished) await next();
      })();
    },
  });

  return { ok: true, body, stop, done: whenDone };
}

/** The llm_usage row for a stream; streamRecord sets paid_with_credit. */
export function streamRow(req: GatewayRequest, userId: string | null, outcome: StreamOutcome): UsageRow {
  const m = outcome.meter;
  const model = m.model || req.model;
  // After message_start with no final message_delta, the output is unknown
  // and hidden thinking streamed no bytes: count the most it can be.
  const bounded = m.started && !m.outputFinal;
  const output_tokens = bounded ? req.max_tokens : m.usage.output_tokens;
  const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = m.usage;
  const ok = outcome.end === 'complete';
  const notes: string[] = [];
  if (!ok) {
    const e = outcome.error ?? streamError('The stream did not complete.');
    notes.push(`${e.name}${e.status ? ` ${e.status}` : ''}: ${e.message}`);
  }
  if (outcome.clientLeft) notes.push(ok ? 'ClientLeft: the caller closed the stream before message_stop; the reply was read to its end' : 'the caller had closed the stream');
  if (bounded) notes.push('output_tokens is max_tokens (no final message_delta)');
  return {
    app: req.app,
    user_id: userId,
    model,
    input_tokens,
    output_tokens,
    cache_read_tokens: cache_read_input_tokens,
    cache_write_tokens: cache_creation_input_tokens,
    cost_usd: costUsd(model, { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }),
    ok,
    error: notes.length ? notes.join('; ').slice(0, 500) : null,
    paid_with_credit: false,
  };
}

/** A reserved credit goes back when the call failed (Anthropic or the gateway ended it), not when the caller left. */
export function refundsCredit(outcome: StreamOutcome): boolean {
  return outcome.end === 'failed';
}

/**
 * The row and the refund for a stream paid (or not) with a credit. A
 * refunded row is not paid with the credit, so paid_with_credit is false and
 * its cost counts for the person's own caps.
 */
export function streamRecord(req: GatewayRequest, userId: string | null, outcome: StreamOutcome, paid: boolean): { row: UsageRow; refund: boolean } {
  const refund = paid && refundsCredit(outcome);
  return { row: { ...streamRow(req, userId, outcome), paid_with_credit: paid && !refund }, refund };
}
