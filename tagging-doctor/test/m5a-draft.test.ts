/**
 * Milestone 5a, drafting: the own key and the gateway (AC-46, AC-47), the
 * image re-encoded under 680 KB and no request over 1,000,000 bytes, and
 * "Draft all" (AC-50). Every model call is a stand-in.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FigureItem } from '../src/core/figures';
import { ImageError, MAX_SEND_BYTES, prepareImage, sniffType, toBase64, type ImageDeps } from '../src/core/image';
import {
  capWords,
  DRAFT_ALL_LIMIT,
  DRAFT_MODEL,
  draftAll,
  draftErrorWords,
  draftFigure,
  draftMode,
  draftRequest,
  localTime,
  MAX_REQUEST_BYTES,
  NOT_REGISTERED,
  RequestTooLarge,
  requestBytes,
} from '../src/lib/draft';
import { ask, CapReached, GatewayError, LlmUnavailable, memoryStorage, setByokKey, type Message } from '../src/lib/llm';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (n: number) => {
  const b = new Uint8Array(n);
  b.set(PNG_HEAD);
  return b;
};

function fig(over: Partial<FigureItem> = {}): FigureItem {
  return {
    id: 'main.tex:10',
    kind: 'image',
    path: 'main.tex',
    line: 3,
    offset: 10,
    file: 'plot',
    resolved: 'plot.png',
    preview: 'image/png',
    caption: 'Sample means',
    label: 'fig:m',
    before: 'Before text.',
    after: 'After text.',
    existing: null,
    inDefinition: false,
    moving: false,
    insert: { kind: 'none', at: 26 },
    notPatched: null,
    ...over,
  };
}

const reply = (text: string, stop: Message['stop_reason'] = 'end_turn'): Message =>
  ({ id: 'm', type: 'message', role: 'assistant', model: DRAFT_MODEL, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Message;

/** Image deps that report a size and "encode" to a given length per try. */
function imageDeps(width: number, height: number, sizes: number[]): ImageDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  let k = 0;
  return {
    calls,
    decode: async () => ({ width, height, source: null }),
    encode: async (_d, w, h, type, q) => {
      calls.push([w, h, type, q]);
      return png(sizes[Math.min(k++, sizes.length - 1)]);
    },
  };
}

describe('AC-50: images re-encoded in the browser to at most 680 KB', () => {
  it('sends a small image as it is', async () => {
    const r = await prepareImage(png(1000), imageDeps(800, 600, []));
    expect(r).toMatchObject({ mediaType: 'image/png', bytes: 1000, resized: false });
  });
  it('redraws a large one until it fits, trying PNG then JPEG at a smaller size', async () => {
    const deps = imageDeps(4000, 3000, [900_000, 800_000, 700_000, 600_000]);
    const r = await prepareImage(png(3_000_000), deps);
    expect(r.bytes).toBeLessThanOrEqual(MAX_SEND_BYTES);
    expect(r.resized).toBe(true);
    expect(r.mediaType).toBe('image/png');
    expect(deps.calls[0]).toEqual([1568, 1176, 'image/png', undefined]);
    expect(deps.calls[3]).toEqual([1176, 882, 'image/png', undefined]);
  });
  it('a small file with a long edge is redrawn too', async () => {
    const r = await prepareImage(png(5000), imageDeps(3000, 100, [4000]));
    expect(r.resized).toBe(true);
  });
  it('refuses what cannot be made small enough, an empty file, a file that is not an image, and one that does not decode', async () => {
    await expect(prepareImage(png(2_000_000), imageDeps(2000, 2000, [700_000]))).rejects.toThrow(ImageError);
    await expect(prepareImage(new Uint8Array(), imageDeps(1, 1, []))).rejects.toThrow('empty');
    await expect(prepareImage(new Uint8Array([1, 2, 3, 4]), imageDeps(1, 1, []))).rejects.toThrow('not a PNG');
    await expect(prepareImage(png(10), { decode: () => Promise.reject(new Error('x')), encode: async () => png(1) })).rejects.toThrow('damaged');
  });
  it('knows the four types by their bytes, and base64 matches Node', () => {
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
    expect(sniffType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffType(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    const b = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
  });
});

describe('the request (S2-12, AC-45)', () => {
  it('the cheapest model, thinking off, effort low; the image first, then the caption, label and text around it', () => {
    const req = draftRequest(fig(), { base64: 'AAAA', mediaType: 'image/png', bytes: 3, resized: false });
    expect(req).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, output_config: { effort: 'low' } });
    const content = req.messages[0].content as { type: string; text?: string }[];
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
    expect(content[1].text).toContain('Caption: Sample means');
    expect(content[1].text).toContain('Label: fig:m');
    expect(content[1].text).toContain('Text before the figure: Before text.');
  });
  it('text only for TikZ and for a figure with no preview, which says so', () => {
    const t = draftRequest(fig({ kind: 'tikz', file: null, resolved: null, preview: null }), null).messages[0].content as { type: string; text: string }[];
    expect(t.map((c) => c.type)).toEqual(['text']);
    expect(t[0].text).toMatch(/TikZ picture.*text only/);
    const p = draftRequest(fig({ resolved: 'scan.pdf', preview: null }), null).messages[0].content as { text: string }[];
    expect(p[0].text).toMatch(/no preview/);
    const m = draftRequest(fig({ resolved: null, preview: null, caption: '', label: '', before: '', after: '' }), null).messages[0].content as { text: string }[];
    expect(m[0].text).toMatch(/not in the project[\s\S]*Caption: \(none\)/);
  });
});

describe('AC-46 and AC-47: who drafts', () => {
  it('the own key first, with no sign-in; else the gateway when signed in; else nothing', () => {
    expect(draftMode(true, false)).toBe('byok');
    expect(draftMode(true, true)).toBe('byok');
    expect(draftMode(false, true)).toBe('gateway');
    expect(draftMode(false, false)).toBeNull();
  });

  it('with the own key the SDK is called with that key and the request, and nothing is fetched', async () => {
    const storage = memoryStorage();
    setByokKey('sk-ant-mine', storage);
    const create = vi.fn(async () => reply(' A bar chart  of means. '));
    const fetch = vi.fn();
    const d = await draftFigure(fig(), { mode: 'byok', bytes: () => png(100), imageDeps: imageDeps(10, 10, []), ask, askDeps: { storage, fetch: fetch as unknown as typeof globalThis.fetch, createAnthropic: (key) => (expect(key).toBe('sk-ant-mine'), { messages: { create } }) } });
    expect(d).toEqual({ text: 'A bar chart of means.', source: 'byok', textOnly: false, imageNote: null });
    expect(fetch).not.toHaveBeenCalled();
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ model: DRAFT_MODEL });
  });

  it('signed in with no key: the llm-gateway function, with app "tagging-doctor" and the token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(reply('A plot.')), { status: 200 }));
    const d = await draftFigure(fig({ preview: null }), { mode: 'gateway', ask, askDeps: { storage: memoryStorage(), fetch: fetch as unknown as typeof globalThis.fetch, getToken: async () => 'tok', gatewayUrl: 'https://auth.hintwise.org/functions/v1/llm-gateway' } });
    expect(d).toMatchObject({ text: 'A plot.', source: 'model', textOnly: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.hintwise.org/functions/v1/llm-gateway');
    expect(JSON.parse(init.body as string)).toMatchObject({ app: 'tagging-doctor', model: DRAFT_MODEL, thinking: { type: 'disabled' }, output_config: { effort: 'low' } });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('on a 429 the page gets the scope in plain words, the reset in local time, and "use your own key"', async () => {
    const fetch = async () => new Response(JSON.stringify({ error: 'cap', scope: 'user-day', resets_at: '2026-11-24T00:00:00Z' }), { status: 429 });
    const e = await draftFigure(fig({ preview: null }), { mode: 'gateway', ask, askDeps: { storage: memoryStorage(), fetch, getToken: async () => 'tok', gatewayUrl: 'https://x/llm-gateway' } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CapReached);
    const words = draftErrorWords(e);
    expect(words).toContain('your daily HintWise allowance is used up');
    expect(words).toContain(localTime('2026-11-24T00:00:00Z'));
    expect(words).toContain('use your own key');
    expect(capWords('app-user-day')).toBe('your daily allowance in this app is used up');
    expect(capWords('app-user-day-calls')).toBe('your daily allowance in this app is used up');
    expect(capWords('app-user-week')).toBe('your weekly allowance in this app is used up');
    expect(capWords('app-user-week-calls')).toBe('your weekly allowance in this app is used up');
    expect(capWords('app-day')).toBe('this app’s shared allowance is used up');
    expect(capWords('app-month')).toBe('this app’s shared allowance is used up');
    expect(localTime('not a time')).toBe('later');
  });

  it('on a 403 "app" answer: not available yet, use your own key; and the own key still drafts', async () => {
    const fetch = async () => new Response(JSON.stringify({ error: 'app', message: 'App "tagging-doctor" is not enabled for the HintWise key.' }), { status: 403 });
    const e = await draftFigure(fig({ preview: null }), { mode: 'gateway', ask, askDeps: { storage: memoryStorage(), fetch, getToken: async () => 'tok', gatewayUrl: 'https://x' } }).catch((x: unknown) => x);
    expect(draftErrorWords(e)).toBe(NOT_REGISTERED);
    expect(NOT_REGISTERED).toBe('Drafting with HintWise’s key is not available yet; use your own key.');
    const storage = memoryStorage();
    setByokKey('k', storage);
    const d = await draftFigure(fig({ preview: null }), { mode: 'byok', ask, askDeps: { storage, createAnthropic: () => ({ messages: { create: async () => reply('Fine.') } }) } });
    expect(d.text).toBe('Fine.');
  });

  it('other failures in plain words', () => {
    expect(draftErrorWords(new GatewayError(401, {}))).toMatch(/sign-in has expired/);
    expect(draftErrorWords(new GatewayError(403, { error: 'model' }))).toMatch(/answered 403/);
    expect(draftErrorWords(new GatewayError(502, null))).toMatch(/answered 502/);
    expect(draftErrorWords(new LlmUnavailable('Sign in to use the HintWise key.'))).toBe('Sign in to use the HintWise key.');
    expect(draftErrorWords(Object.assign(new Error('x'), { status: 401 }))).toMatch(/refused your key/);
    expect(draftErrorWords(Object.assign(new Error('x'), { status: 429 }))).toMatch(/limiting your key/);
    expect(draftErrorWords(Object.assign(new Error('x'), { status: 500 }))).toMatch(/answered 500/);
    expect(draftErrorWords(new TypeError('Failed to fetch'))).toMatch(/connection failed/);
    expect(draftErrorWords(new RequestTooLarge(1_200_000))).toMatch(/1,200,000 bytes.*not sent/);
  });

  it('a refusal and an empty answer are no draft', async () => {
    const deps = (m: Message) => ({ mode: 'byok' as const, ask: async () => m });
    await expect(draftFigure(fig({ preview: null }), deps(reply('', 'refusal')))).rejects.toThrow(/declined/);
    await expect(draftFigure(fig({ preview: null }), deps(reply('   ')))).rejects.toThrow(/no text/);
  });

  it('an image that cannot be prepared: the draft goes from the text only and says why', async () => {
    const asked = vi.fn(async () => reply('From text.'));
    const d = await draftFigure(fig(), { mode: 'byok', bytes: () => new Uint8Array([1, 2, 3]), imageDeps: imageDeps(1, 1, []), ask: asked });
    expect(d.textOnly).toBe(true);
    expect(d.imageNote).toMatch(/not a PNG.*text only/);
    const d2 = await draftFigure(fig(), { mode: 'byok', bytes: () => { throw new Error('gone'); }, imageDeps: imageDeps(1, 1, []), ask: asked });
    expect(d2.imageNote).toMatch(/could not be read/);
  });
});

describe('AC-50: a request over 1,000,000 bytes is never sent', () => {
  it('measures the body as the gateway gets it, and refuses before calling', async () => {
    const big = 'x'.repeat(MAX_REQUEST_BYTES);
    const asked = vi.fn();
    await expect(draftFigure(fig({ preview: null, before: big }), { mode: 'gateway', ask: asked })).rejects.toBeInstanceOf(RequestTooLarge);
    expect(asked).not.toHaveBeenCalled();
    // An image at the 680 KB limit fits: base64 grows it to about 907 KB, under the limit with the text.
    const atLimit = { base64: toBase64(new Uint8Array(MAX_SEND_BYTES)), mediaType: 'image/png' as const, bytes: MAX_SEND_BYTES, resized: true };
    const req = draftRequest(fig({ before: 'b'.repeat(600), after: 'a'.repeat(600) }), atLimit);
    expect(requestBytes(req)).toBeLessThan(MAX_REQUEST_BYTES);
    expect(requestBytes(req)).toBeGreaterThan(900_000);
  });
});

describe('AC-50: Draft all', () => {
  it('at most 3 calls at once, and at most 40 figures in a run', async () => {
    let now = 0;
    let most = 0;
    const done: number[] = [];
    const items = Array.from({ length: 50 }, (_, i) => i);
    const r = await draftAll(items, async (i) => {
      now++;
      most = Math.max(most, now);
      await new Promise((res) => setTimeout(res, 1));
      now--;
      done.push(i);
    });
    expect(most).toBe(3);
    expect(done).toHaveLength(DRAFT_ALL_LIMIT);
    expect(DRAFT_ALL_LIMIT).toBe(40);
    expect(r).toEqual({ started: 40, stop: null, cap: null, left: 10 });
  });

  it('stops at the first error the run is given (a cap): no call starts after it', async () => {
    const started: number[] = [];
    const cap = new CapReached('app-day', '2026-11-24T00:00:00Z');
    const r = await draftAll(Array.from({ length: 10 }, (_, i) => i), async (i) => {
      started.push(i);
      await new Promise((res) => setTimeout(res, 1));
      if (i === 4) throw cap;
    });
    expect(r.cap).toBe(cap);
    expect(r.stop).toBe(cap);
    // 0 to 5 start (three at a time, 4 throws while 5 and 6 may be running); nothing after the cap is seen.
    expect(Math.max(...started)).toBeLessThanOrEqual(6);
    expect(r.started).toBe(started.length);
    expect(r.left).toBe(10 - started.length);
  });

  it('stops when the person cancels, and with fewer figures than workers', async () => {
    let stop = false;
    const seen: number[] = [];
    const r = await draftAll([1, 2, 3, 4, 5, 6], async (i) => {
      seen.push(i);
      if (i === 2) stop = true;
    }, { concurrency: 1, stopped: () => stop });
    expect(seen).toEqual([1, 2]);
    expect(r.left).toBe(4);
    expect((await draftAll([1], async () => {})).started).toBe(1);
  });
});
