import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_STATUS,
  errorEvent,
  refundsCredit,
  SseMeter,
  startRelay,
  streamRecord,
  streamRow,
  type MeterState,
  type StreamOutcome,
} from '../src/gateway/stream.ts';
import { costUsd } from '../src/gateway/pricing.ts';
import type { GatewayRequest } from '../src/gateway/validate.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Anthropic's wire format: an event line, a data line with the same type, a blank line.
const ev = (type: string, data: Record<string, unknown> = {}): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const START = ev('message_start', {
  message: {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 2679, cache_creation_input_tokens: 100, cache_read_input_tokens: 2000, output_tokens: 3 },
  },
});
const BLOCK = ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
const DELTA = (text: string): string => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
const PING = ev('ping');
const BLOCK_STOP = ev('content_block_stop', { index: 0 });
const MESSAGE_DELTA = ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 15 } });
const MESSAGE_STOP = ev('message_stop');
const OVERLOADED = ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } });
const FULL = [START, BLOCK, PING, DELTA('Hello'), DELTA(' world'), BLOCK_STOP, MESSAGE_DELTA, MESSAGE_STOP];
// Thinking under the default display ("omitted"): one empty thinking_delta, then the signature.
const THINK = [
  ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '' } }),
];
const THINK_END = [ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'EqQBCgIYAhIM' } }), ev('content_block_stop', { index: 0 })];
const AFTER_THINK = [
  ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'positive' } }),
  ev('content_block_stop', { index: 1 }),
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 900 } }),
  MESSAGE_STOP,
];

const req: GatewayRequest = { app: 'demo-app', model: 'claude-opus-5-5', max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }], stream: true };

function meterOf(text: string, split = 0): MeterState {
  const m = new SseMeter();
  const bytes = enc.encode(text);
  if (split <= 0) m.push(bytes);
  else for (let i = 0; i < bytes.length; i += split) m.push(bytes.slice(i, i + split));
  m.end();
  return m.state;
}

/** An upstream body: each part is one chunk, an Error makes the read fail, `hang` leaves the last read pending. */
function upstream(parts: Array<string | Error>, opts: { hang?: boolean } = {}) {
  let i = 0;
  const state = { cancelled: false, reads: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      state.reads += 1;
      if (i < parts.length) {
        const p = parts[i++];
        if (p instanceof Error) c.error(p);
        else c.enqueue(enc.encode(p));
        return;
      }
      if (opts.hang) return new Promise<void>(() => undefined);
      c.close();
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { stream, state };
}

/** An upstream the test feeds by hand: send(part) and end(). */
function manual() {
  let c: ReadableStreamDefaultController<Uint8Array> | null = null;
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      c = controller;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    stream,
    state,
    send: (part: string) => c?.enqueue(enc.encode(part)),
    end: () => c?.close(),
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  let out = '';
  for (;;) {
    const r = await reader.read();
    if (r.done) return out + dec.decode();
    out += dec.decode(r.value, { stream: true });
  }
}

function recorder() {
  const outcomes: StreamOutcome[] = [];
  const aborts = { count: 0 };
  return {
    outcomes,
    aborts,
    opts: {
      onEnd: (o: StreamOutcome) => {
        // a copy: the meter keeps its state object
        outcomes.push({ ...o, meter: { ...o.meter, usage: { ...o.meter.usage } } });
      },
      abortUpstream: () => {
        aborts.count += 1;
      },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('SseMeter', () => {
  it('reads the model and the usage: message_start for input and cache, message_delta for output', () => {
    const s = meterOf(FULL.join(''));
    expect(s).toEqual({
      events: 8,
      first: 'message_start',
      started: true,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 2679, output_tokens: 15, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 },
      outputFinal: true,
      stopped: true,
      stopReason: 'end_turn',
      error: null,
    });
  });

  it('gives the same answer however the bytes are split, multibyte characters included', () => {
    const text = [START, DELTA('日本語 😀 é'), MESSAGE_DELTA, MESSAGE_STOP].join('');
    const whole = meterOf(text);
    expect(whole.usage.output_tokens).toBe(15);
    for (const split of [1, 2, 3, 7, 64]) expect(meterOf(text, split)).toEqual(whole);
  });

  it('takes message_delta counts as cumulative: the last value of each field wins', () => {
    const s = meterOf([
      START,
      ev('message_delta', { delta: {}, usage: { output_tokens: 5 } }),
      ev('message_delta', { delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 40, input_tokens: 2700, cache_read_input_tokens: null } }),
    ].join(''));
    expect(s.usage).toEqual({ input_tokens: 2700, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 });
    expect(s.stopReason).toBe('max_tokens');
    expect(s.outputFinal).toBe(true);
  });

  it('ignores counts that are missing, negative or not numbers, and rounds the rest', () => {
    const s = meterOf(ev('message_start', { message: { model: '', usage: { input_tokens: -1, output_tokens: 'x', cache_read_input_tokens: Number.NaN, cache_creation_input_tokens: 2.6 } } }));
    expect(s.model).toBeNull();
    expect(s.usage).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 3 });
    expect(meterOf(ev('message_start', { message: 'nope' })).usage.input_tokens).toBe(0);
    expect(meterOf(ev('message_delta', { usage: [] })).outputFinal).toBe(false);
    expect(meterOf(ev('message_delta', { usage: { input_tokens: 9 } })).outputFinal).toBe(false);
  });

  it('follows the SSE line rules: CRLF, comments, no space after the colon, joined data lines, bare fields', () => {
    const text = [
      ': a comment\r\n',
      'event: message_start\r\n',
      'data:{"type":"message_start",\r\n',
      'data: "message":{"model":"claude-sonnet-5-5"}}\r\n',
      'id: 1\r\n',
      '\r\n',
      'event: ping\n', // an event name without data is dropped at the blank line
      '\n',
      'data\n', // a bare field name: empty data, which is not JSON
      '\n',
    ].join('');
    const s = meterOf(text);
    expect(s.model).toBe('claude-sonnet-5-5');
    expect(s.events).toBe(2);
    expect(s.first).toBe('message_start');
    expect(s.started).toBe(true);
  });

  it('names an event by its data type, else its event line, else "message"', () => {
    const m = new SseMeter();
    expect(m.push(enc.encode('event: error\ndata: not json\n\n'))).toBe(1);
    expect(m.state.error).toEqual({ type: 'error', message: '' });
    expect(m.state.first).toBe('error');
    expect(m.state.started).toBe(false);
    m.push(enc.encode('data: [1]\n\n'));
    expect(m.state.events).toBe(2);
  });

  it('reads an error event, and passes over thinking deltas', () => {
    const s = meterOf([START, ...THINK, ...THINK_END, OVERLOADED].join(''));
    expect(s.error).toEqual({ type: 'overloaded_error', message: 'Overloaded' });
    expect(s.outputFinal).toBe(false);
    expect(meterOf(ev('error', { error: 'x' })).error).toEqual({ type: 'error', message: '' });
  });

  it('dispatches a last event that has no blank line after it, at the end', () => {
    const m = new SseMeter();
    expect(m.push(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\r'))).toBe(0);
    expect(m.end()).toBe(1);
    expect(m.state.stopped).toBe(true);
    const n = new SseMeter();
    n.push(enc.encode('data: {"type":"message_stop"}'));
    expect(n.end()).toBe(1);
    expect(new SseMeter().end()).toBe(0);
  });
});

describe('startRelay', () => {
  it('passes the events through byte for byte and reports one complete outcome', async () => {
    const up = upstream([FULL.slice(0, 2).join(''), ...FULL.slice(2)]);
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    expect(relay.ok).toBe(true);
    if (!relay.ok) return;
    expect(await readAll(relay.body)).toBe(FULL.join(''));
    await relay.done;
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ end: 'complete', streamed: true, clientLeft: false, error: null, meter: { stopped: true, events: 8 } });
    expect(r.aborts.count).toBe(0);
    await relay.stop({ name: 'Shutdown', status: null, message: 'late' }); // after the end: nothing happens
    expect(r.outcomes).toHaveLength(1);
  });

  it('answers an HTTP-level failure before the first event instead of streaming it', async () => {
    const broken = recorder();
    const a = await startRelay(upstream([new TypeError('connection reset')]).stream, broken.opts);
    expect(a).toEqual({ ok: false, error: { name: 'TypeError', status: null, message: 'connection reset' } });
    expect(broken.outcomes).toMatchObject([{ end: 'failed', streamed: false, clientLeft: false, error: { name: 'TypeError' } }]);
    expect(broken.aborts.count).toBe(1);

    const empty = recorder();
    expect(await startRelay(upstream([]).stream, empty.opts)).toEqual({
      ok: false, error: { name: 'StreamError', status: null, message: 'The upstream stream ended before its first event.' },
    });
    expect(empty.outcomes).toHaveLength(1);

    const none = recorder();
    expect(await startRelay(null, none.opts)).toMatchObject({ ok: false, error: { name: 'StreamError', message: /no body/ } });
    expect(none.outcomes).toMatchObject([{ end: 'failed', streamed: false }]);
  });

  it('turns an error as the first event into the JSON answer, with its HTTP status', async () => {
    const up = upstream([OVERLOADED], { hang: true });
    const r = recorder();
    expect(await startRelay(up.stream, r.opts)).toEqual({ ok: false, error: { name: 'overloaded_error', status: 529, message: 'Overloaded' } });
    expect(r.outcomes).toMatchObject([{ end: 'failed', streamed: false, error: { status: 529 } }]);
    expect(r.aborts.count).toBe(1);
    expect(up.state.cancelled).toBe(true);
    // nothing was generated, so the row has no output
    expect(streamRow(req, 'u', r.outcomes[0])).toMatchObject({ output_tokens: 0, cost_usd: 0, ok: false, error: 'overloaded_error 529: Overloaded' });
    // an unknown type has no status, an empty message gets one
    const odd = await startRelay(upstream([ev('error', { error: { type: 'strange_error', message: '' } })]).stream, recorder().opts);
    expect(odd).toEqual({ ok: false, error: { name: 'strange_error', status: null, message: 'The model stream failed.' } });
    expect(ERROR_STATUS.rate_limit_error).toBe(429);
  });

  it('passes a mid-stream error event on unchanged and records a failure', async () => {
    const parts = [START, BLOCK, DELTA('Hel'), OVERLOADED];
    const r = recorder();
    const relay = await startRelay(upstream(parts).stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    expect(await readAll(relay.body)).toBe(parts.join(''));
    expect(r.outcomes).toMatchObject([{ end: 'failed', streamed: true, error: { name: 'overloaded_error', status: 529, message: 'Overloaded' } }]);
  });

  it('streams an error event that shares the first chunk with message_start', async () => {
    const r = recorder();
    const relay = await startRelay(upstream([START + OVERLOADED]).stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    expect(await readAll(relay.body)).toBe(START + OVERLOADED);
    expect(r.outcomes).toMatchObject([{ end: 'failed', streamed: true, error: { name: 'overloaded_error', status: 529 } }]);
  });

  it('adds an Anthropic-style error event when the upstream ends early or breaks', async () => {
    const early = recorder();
    const a = await startRelay(upstream([START, DELTA('Hi')]).stream, early.opts);
    if (!a.ok) throw new Error('expected a stream');
    expect(await readAll(a.body)).toBe(START + DELTA('Hi') + errorEvent('The upstream stream ended before message_stop.'));
    expect(early.outcomes).toMatchObject([{ end: 'failed', error: { name: 'StreamError' } }]);

    const broke = recorder();
    const b = await startRelay(upstream([START, new Error('socket hang up')]).stream, broke.opts);
    if (!b.ok) throw new Error('expected a stream');
    const text = await readAll(b.body);
    expect(text).toBe(START + errorEvent('The upstream stream broke: socket hang up'));
    expect(JSON.parse(text.split('data: ').pop() as string)).toEqual({ type: 'error', error: { type: 'api_error', message: 'The upstream stream broke: socket hang up' } });
    expect(broke.outcomes).toMatchObject([{ end: 'failed', error: { name: 'Error', message: 'The upstream stream broke: socket hang up' } }]);
  });

  it('ends a stream that finished inside the first read: complete, or failed without message_stop', async () => {
    const r = recorder();
    const a = await startRelay(upstream(['data: {"type":"message_stop"}']).stream, r.opts);
    if (!a.ok) throw new Error('expected a stream');
    expect(r.outcomes).toMatchObject([{ end: 'complete' }]); // already settled when startRelay returns
    expect(await readAll(a.body)).toBe('data: {"type":"message_stop"}');
    await a.done;

    const s = recorder();
    const b = await startRelay(upstream(['data: {"type":"message_start","message":{}}']).stream, s.opts);
    if (!b.ok) throw new Error('expected a stream');
    expect(await readAll(b.body)).toMatch(/event: error/);
    expect(s.outcomes).toMatchObject([{ end: 'failed' }]);
  });

  it('keeps reading after the caller leaves mid-text, and records the real usage as a counted call', async () => {
    const up = upstream([START, BLOCK, DELTA('x'.repeat(30)), DELTA('more'), BLOCK_STOP, MESSAGE_DELTA, MESSAGE_STOP]);
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    await reader.read(); // START
    await reader.read(); // BLOCK
    await reader.read(); // the first delta
    await reader.cancel();
    await relay.done;
    expect(r.aborts.count).toBe(0);
    expect(up.state.cancelled).toBe(false);
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ end: 'complete', clientLeft: true, error: null, meter: { stopped: true, outputFinal: true } });
    expect(streamRow(req, 'u1', r.outcomes[0])).toMatchObject({
      ok: true, output_tokens: 15, input_tokens: 2679,
      error: 'ClientLeft: the caller closed the stream before message_stop; the reply was read to its end',
    });
    expect(refundsCredit(r.outcomes[0])).toBe(false);
  });

  it('counts hidden thinking in full when the caller leaves during it (G1.1)', async () => {
    // The caller leaves while the model thinks: nothing but an empty
    // thinking_delta has streamed. The upstream is read on, and the row gets
    // message_delta's real output, not message_start's 3 tokens.
    const up = upstream([START, ...THINK, ...THINK_END, ...AFTER_THINK]);
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    await reader.read(); // START
    await reader.read(); // the thinking block
    await reader.read(); // the empty thinking_delta
    await reader.cancel();
    await relay.done;
    expect(r.outcomes).toHaveLength(1);
    const row = streamRow(req, 'u1', r.outcomes[0]);
    expect(row).toMatchObject({ ok: true, output_tokens: 900, model: 'claude-opus-5-5' });
    expect(row.cost_usd).toBe(costUsd('claude-opus-5-5', { input_tokens: 2679, output_tokens: 900, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 }));
    expect(r.aborts.count).toBe(0);
  });

  it('counts max_tokens when the worker ends during hidden thinking after the caller left', async () => {
    const up = upstream([START, ...THINK], { hang: true });
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    for (let i = 0; i < 3; i += 1) await reader.read();
    await reader.cancel();
    await tick(); // the drain now waits on the hanging upstream
    await relay.stop({ name: 'Shutdown', status: null, message: 'The gateway stopped before the stream ended (WallClockTime).' });
    await relay.done;
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ end: 'failed', clientLeft: true, error: { name: 'Shutdown' } });
    expect(r.aborts.count).toBe(1);
    expect(up.state.cancelled).toBe(true);
    expect(streamRow(req, 'u1', r.outcomes[0])).toMatchObject({
      ok: false, output_tokens: 1000,
      error: 'Shutdown: The gateway stopped before the stream ended (WallClockTime).; the caller had closed the stream; output_tokens is max_tokens (no final message_delta)',
    });
  });

  it('counts the exact output when the caller leaves after message_delta', async () => {
    const up = upstream([START, BLOCK, DELTA('Hi'), BLOCK_STOP, MESSAGE_DELTA, MESSAGE_STOP]);
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    for (let i = 0; i < 5; i += 1) await reader.read(); // through message_delta
    await reader.cancel();
    await relay.done;
    expect(r.outcomes).toMatchObject([{ end: 'complete', clientLeft: true }]);
    expect(streamRow(req, 'u', r.outcomes[0])).toMatchObject({ ok: true, output_tokens: 15 });
  });

  it('records a failure with max_tokens when the upstream breaks after the caller left', async () => {
    const up = upstream([START, BLOCK, DELTA('Hi'), new Error('socket hang up')]);
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    await reader.read();
    await reader.cancel();
    await relay.done;
    expect(r.outcomes).toMatchObject([{ end: 'failed', clientLeft: true, error: { message: 'The upstream stream broke: socket hang up' } }]);
    expect(streamRow(req, 'u', r.outcomes[0])).toMatchObject({ ok: false, output_tokens: 1000 });
    expect(refundsCredit(r.outcomes[0])).toBe(true);
  });

  it('does not mark the caller as gone when it leaves after message_stop', async () => {
    const up = upstream([START, MESSAGE_DELTA, MESSAGE_STOP], { hang: true });
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    for (let i = 0; i < 3; i += 1) await reader.read();
    await reader.cancel();
    await tick();
    expect(r.outcomes).toHaveLength(0); // still reading: the upstream has not closed
    await relay.stop({ name: 'Shutdown', status: null, message: 'end' });
    expect(r.outcomes).toMatchObject([{ end: 'complete', clientLeft: false, error: null }]);
    expect(streamRow(req, 'u', r.outcomes[0])).toMatchObject({ ok: true, output_tokens: 15, error: null });
  });

  it('ends open streams on shutdown with an error event, and records max_tokens as the output', async () => {
    const up = upstream([START, DELTA('partial')], { hang: true });
    const r = recorder();
    const relay = await startRelay(up.stream, r.opts);
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    await reader.read();
    await reader.read();
    const pending = reader.read(); // waits on the hanging upstream
    await relay.stop({ name: 'Shutdown', status: null, message: 'The gateway stopped before the stream ended (WallClockTime).' });
    expect(dec.decode((await pending).value)).toBe(errorEvent('The gateway stopped before the stream ended (WallClockTime).'));
    expect((await reader.read()).done).toBe(true);
    expect(r.outcomes).toMatchObject([{ end: 'failed', clientLeft: false, error: { name: 'Shutdown' } }]);
    expect(r.aborts.count).toBe(1);
    expect(streamRow(req, 'u', r.outcomes[0])).toMatchObject({ ok: false, output_tokens: 1000, cost_usd: costUsd('claude-opus-5-5', { input_tokens: 2679, output_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 }) });
    expect(refundsCredit(r.outcomes[0])).toBe(true);
    await relay.stop({ name: 'Shutdown', status: null, message: 'again' });
    expect(r.outcomes).toHaveLength(1);
  });

  it('writes exactly one outcome when cancel, the upstream end and shutdown race (G1.1 race)', async () => {
    const up = manual();
    let release: () => void = () => undefined;
    let calls = 0;
    const starting = startRelay(up.stream, {
      onEnd: () => {
        calls += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      abortUpstream: () => undefined,
    });
    up.send(START); // startRelay waits for the first event
    const relay = await starting;
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    await reader.read();
    const cancelled = reader.cancel(); // the caller leaves: the drain starts
    up.send(MESSAGE_DELTA);
    up.send(MESSAGE_STOP);
    up.end(); // the upstream ends while...
    const stops = [relay.stop({ name: 'Shutdown', status: null, message: 'a' }), relay.stop({ name: 'Shutdown', status: null, message: 'b' })]; // ...shutdown fires twice
    await cancelled;
    await tick();
    release();
    await Promise.all(stops);
    await relay.done;
    await tick();
    expect(calls).toBe(1);
  });

  it('still closes the stream when onEnd or abortUpstream throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const relay = await startRelay(upstream(FULL).stream, {
      onEnd: () => {
        throw new Error('database down');
      },
    });
    if (!relay.ok) throw new Error('expected a stream');
    expect(await readAll(relay.body)).toBe(FULL.join(''));
    expect(logged).toHaveBeenCalledWith('stream onEnd failed:', 'database down');

    const r = recorder();
    const throwing = await startRelay(upstream([START], { hang: true }).stream, {
      onEnd: r.opts.onEnd,
      abortUpstream: () => {
        throw new Error('already aborted');
      },
    });
    if (!throwing.ok) throw new Error('expected a stream');
    await throwing.stop({ name: 'Shutdown', status: null, message: 'stop' });
    expect(r.outcomes).toMatchObject([{ end: 'failed' }]);
  });

  it('keeps one complete outcome when the caller cancels while the row is being written', async () => {
    let release: () => void = () => undefined;
    const outcomes: StreamOutcome[] = [];
    const relay = await startRelay(upstream(FULL).stream, {
      onEnd: (o) => {
        outcomes.push(o);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    for (let i = 0; i < FULL.length; i += 1) await reader.read();
    const last = reader.read(); // pulls the upstream's end: onEnd starts and waits
    await tick();
    expect(outcomes).toMatchObject([{ end: 'complete', clientLeft: false }]);
    await reader.cancel();
    release();
    expect((await last).done).toBe(true);
    await relay.done;
    expect(outcomes).toHaveLength(1);
  });

  it('ignores a read that fails after the stream was stopped', async () => {
    let fail: (e: Error) => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(START));
      },
      pull(c) {
        return new Promise<void>((resolve) => {
          fail = (e) => {
            c.error(e);
            resolve();
          };
        });
      },
    });
    const r = recorder();
    const relay = await startRelay(stream, { onEnd: r.opts.onEnd, abortUpstream: () => fail(new Error('aborted')) });
    if (!relay.ok) throw new Error('expected a stream');
    const reader = relay.body.getReader();
    await reader.read();
    const pending = reader.read();
    await relay.stop({ name: 'Shutdown', status: null, message: 'stop' });
    await pending;
    expect(r.outcomes).toMatchObject([{ end: 'failed', error: { name: 'Shutdown' } }]);
  });
});

describe('streamRow, refundsCredit and streamRecord', () => {
  const outcome = (end: StreamOutcome['end'], text: string, error: StreamOutcome['error'] = null, clientLeft = false): StreamOutcome => ({ end, streamed: true, clientLeft, meter: meterOf(text), error });

  it('records a complete stream like a non-streaming call: exact tokens, the answering model, ok', () => {
    const o = outcome('complete', FULL.join('').replace('"claude-opus-5-5"', '"claude-opus-5"'));
    expect(streamRow(req, 'u1', o)).toEqual({
      app: 'demo-app', user_id: 'u1', model: 'claude-opus-5',
      input_tokens: 2679, output_tokens: 15, cache_read_tokens: 2000, cache_write_tokens: 100,
      cost_usd: costUsd('claude-opus-5', { input_tokens: 2679, output_tokens: 15, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 }),
      ok: true, error: null, paid_with_credit: false,
    });
    expect(streamRow(req, 'u1', outcome('complete', FULL.join(''))).cost_usd).toBe(0.011916);
    expect(refundsCredit(o)).toBe(false);
  });

  it('records a failure with the exact output when message_delta came', () => {
    const o = outcome('failed', [START, MESSAGE_DELTA, OVERLOADED].join(''), { name: 'overloaded_error', status: 529, message: 'Overloaded' });
    expect(streamRow(req, null, o)).toMatchObject({ ok: false, user_id: null, output_tokens: 15, error: 'overloaded_error 529: Overloaded' });
    expect(refundsCredit(o)).toBe(true);
  });

  it('counts max_tokens as the output whenever message_start came and no final message_delta', () => {
    const o = outcome('failed', START + DELTA('ab'), { name: 'StreamError', status: null, message: 'gone' });
    expect(streamRow(req, 'u', o)).toMatchObject({ output_tokens: 1000, error: 'StreamError: gone; output_tokens is max_tokens (no final message_delta)' });
    expect(streamRow({ ...req, max_tokens: 8192 }, 'u', o).output_tokens).toBe(8192);
    // an odd complete stream without message_delta is bounded too
    expect(streamRow(req, 'u', outcome('complete', START + MESSAGE_STOP))).toMatchObject({ ok: true, output_tokens: 1000, error: 'output_tokens is max_tokens (no final message_delta)' });
  });

  it('falls back to the requested model and a generic error text, with no output before message_start', () => {
    const row = streamRow(req, 'u', outcome('failed', ev('ping')));
    expect(row).toMatchObject({ model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0, cost_usd: 0, ok: false, error: 'StreamError: The stream did not complete.' });
    expect(streamRow(req, 'u', outcome('failed', '', { name: 'X', status: null, message: 'y'.repeat(600) })).error).toHaveLength(500);
  });

  it('records a refunded credit as not paid with it, so the cost counts for the person (G1.3)', () => {
    const failed = outcome('failed', START + DELTA('x'), { name: 'StreamError', status: null, message: 'broke' });
    const complete = outcome('complete', FULL.join(''));
    const left = outcome('complete', FULL.join(''), null, true);
    expect(streamRecord(req, 'u', failed, true)).toMatchObject({ refund: true, row: { paid_with_credit: false, ok: false, output_tokens: 1000 } });
    expect(streamRecord(req, 'u', failed, false)).toMatchObject({ refund: false, row: { paid_with_credit: false } });
    expect(streamRecord(req, 'u', complete, true)).toMatchObject({ refund: false, row: { paid_with_credit: true, ok: true } });
    expect(streamRecord(req, 'u', left, true)).toMatchObject({ refund: false, row: { paid_with_credit: true, ok: true, error: /ClientLeft/ } });
    expect(streamRecord(req, 'u', complete, false)).toMatchObject({ refund: false, row: { paid_with_credit: false } });
  });
});
