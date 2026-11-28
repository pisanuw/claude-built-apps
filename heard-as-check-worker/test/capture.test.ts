/**
 * The capture's logic over a scripted CDP peer (AC-12, AC-15, AC-18, AC-21):
 * the tree read in parts, both caps, the page's output in slices, the
 * requests outside the job's origin counted and failed. The real Chromium
 * runs in the image tests.
 */
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cdp, CdpError, type CdpEvent } from '../src/cdp.ts';
import { axRecord, capture, CaptureFailure, type Browser } from '../src/capture.ts';
import { assemble, notesFor } from '../src/output.ts';

interface Page {
  elements: number;
  structNodes: number;
  outputBytes: number;
  capped?: string | null;
  ax: Record<string, { nodeId: string; childIds?: string[]; role?: { value: string }; name?: { value: string }; ignored?: boolean }>;
}

/** A Chromium that answers the capture's calls from a script. */
function fakeBrowser(o: {
  pages: Page[];
  open?: Record<string, unknown>;
  own?: string;
  finish?: Record<string, unknown>;
  readyAfter?: number;
  requests?: string[];
  failChild?: string[];
  sliceStuck?: boolean;
}): Browser & { calls: string[]; continued: string[]; failed: string[] } {
  const handlers: ((e: CdpEvent) => void)[] = [];
  const calls: string[] = [];
  const continued: string[] = [];
  const failed: string[] = [];
  let page = 0;
  let readyPolls = 0;
  const own = o.own ?? '"structTrees":[],"runs":[]';
  const b = {
    calls,
    continued,
    failed,
    on: (h: (e: CdpEvent) => void) => handlers.push(h),
    async send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
      calls.push(method);
      const r = (v: unknown) => v as T;
      switch (method) {
        case 'Browser.getVersion':
          return r({ product: 'HeadlessChrome/158.0.8127.36' });
        case 'Target.createTarget':
          return r({ targetId: 't1' });
        case 'Target.attachToTarget':
          return r({ sessionId: 's1' });
        case 'Fetch.enable':
          return r({});
        case 'Fetch.continueRequest':
          continued.push(String(params.requestId));
          return r({});
        case 'Fetch.failRequest':
          failed.push(String(params.requestId));
          return r({});
        case 'Page.navigate':
          (o.requests ?? []).forEach((url, i) => handlers.forEach((h) => h({ method: 'Fetch.requestPaused', sessionId, params: { requestId: `r${i}`, request: { url } } })));
          handlers.forEach((h) => h({ method: 'Fetch.requestPaused', sessionId: 'other', params: { requestId: 'x', request: { url: 'https://evil.example/' } } }));
          handlers.forEach((h) => h({ method: 'Page.loadEventFired', sessionId }));
          return r({});
        case 'Accessibility.getFullAXTree': {
          const ax = o.pages[page - 1].ax;
          return r({ nodes: [ax.root] });
        }
        case 'Accessibility.getChildAXNodes': {
          const id = String(params.id);
          if (o.failChild?.includes(id)) throw new CdpError('No node');
          const ax = o.pages[page - 1].ax;
          return r({ nodes: (ax[id]?.childIds ?? []).map((c) => ax[c]) });
        }
        case 'Runtime.evaluate': {
          const e = String(params.expression);
          if (e === 'window.__ready === true') return r({ result: { value: ++readyPolls > (o.readyAfter ?? 0) } });
          if (e === 'window.__open()')
            return r({ result: { value: o.open ?? { pages: o.pages.length, pagesRead: o.pages.length, pdfjs: '6.5.438', declaredUa: 1, options: { disableFontFace: true, isEvalSupported: false, enableScripting: false } } } });
          const pm = /^window\.__page\((\d+)\)$/.exec(e);
          if (pm) {
            page = Number(pm[1]);
            const p = o.pages[page - 1];
            return r({ result: { value: { capped: p.capped ?? null, elements: p.elements, structNodes: p.structNodes, outputBytes: p.outputBytes } } });
          }
          if (e === 'window.__finish()') {
            const last = o.pages.at(-1) as Page;
            return r({ result: { value: { outputBytes: Buffer.byteLength(own), outputChars: own.length, capped: null, structNodes: last?.structNodes ?? 0, structCut: false, tagged: true, ...o.finish } } });
          }
          const sm = /^window\.__slice\((\d+), (\d+)\)$/.exec(e);
          if (sm) {
            const from = Number(sm[1]);
            if (o.sliceStuck) return r({ result: { value: { text: '', next: from } } });
            const end = Math.min(own.length, from + 7);
            return r({ result: { value: { text: own.slice(from, end), next: end } } });
          }
          return r({ result: {} });
        }
        default:
          return r({});
      }
    },
  };
  return b;
}

const BASE = 'http://127.0.0.1:1234/secret/';
const input = (over: Partial<Parameters<typeof capture>[1]> = {}) => ({ base: BASE, outputCap: 20 * 2 ** 20, nodeCap: 24_700, maxPages: 60, deadline: Date.now() + 60_000, pause: async () => {}, ...over });

/** A page whose tree is a root with `n` text children. */
function flatPage(n: number, extra: Partial<Page> = {}): Page {
  const ax: Page['ax'] = { root: { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: Array.from({ length: n }, (_, i) => `n${i}`) } };
  for (let i = 0; i < n; i++) ax[`n${i}`] = { nodeId: `n${i}`, role: { value: 'StaticText' }, name: { value: `t${i}` } };
  return { elements: n + 5, structNodes: 10, outputBytes: 100, ax, ...extra };
}

describe('capture', () => {
  it('reads every page\'s tree in parts, then the page\'s own output in slices', async () => {
    const own = '"structTrees":[{"p":1,"tree":null}],"runs":[{"p":1,"text":"שלום"}]';
    const b = fakeBrowser({ pages: [flatPage(3), flatPage(130)], own, readyAfter: 2 });
    const c = await capture(b, input());
    expect(c.chromium).toBe('158.0.8127.36');
    expect(c.axNodes).toBe(4 + 131);
    expect(c.heard[0]).toBe(JSON.stringify({ p: 1, i: 'root', r: 'RootWebArea', c: ['n0', 'n1', 'n2'] }));
    expect(c.own.toString('utf8')).toBe(own);
    expect(c.opened.declaredUa).toBe(1);
    // 131 children on page 2: the root's children in one call (one call per node with children).
    expect(b.calls.filter((m) => m === 'Accessibility.getChildAXNodes')).toHaveLength(2);
    expect(c.outputBytes).toBe(Buffer.byteLength(own) + c.heard.reduce((a, h) => a + Buffer.byteLength(h) + 1, 0));
    expect(b.calls).toContain('Accessibility.enable');
  });

  it('continues requests to the job\'s own origin and fails and counts any other (AC-15)', async () => {
    const b = fakeBrowser({ pages: [flatPage(1)], requests: [`${BASE}capture.html`, `${BASE}pdfjs/build/pdf.mjs`, 'https://evil.example/x', 'http://127.0.0.1:1234/other/'] });
    const c = await capture(b, input());
    await new Promise((r) => setImmediate(r));
    expect(c.outside).toBe(2);
    expect(b.continued).toEqual(['r0', 'r1']);
    expect(b.failed).toEqual(['r2', 'r3']);
  });

  it('counts a failed read, never drops it silently', async () => {
    const page = flatPage(2);
    page.ax.n0.childIds = ['n1'];
    const c = await capture(fakeBrowser({ pages: [page], failChild: ['n0'] }), input());
    expect(c.failedReads).toBe(1);
  });

  it('ends with password or unreadable when pdf.js cannot open the file (AC-17)', async () => {
    await expect(capture(fakeBrowser({ pages: [], open: { failed: 'password' } }), input())).rejects.toMatchObject({ reason: 'password' });
    await expect(capture(fakeBrowser({ pages: [], open: { failed: 'unreadable' } }), input())).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('stops at the node cap: the element count before the tree is asked for, then while it is read (AC-18)', async () => {
    const before = fakeBrowser({ pages: [flatPage(3, { elements: 30_000 })] });
    await expect(capture(before, input())).rejects.toMatchObject({ reason: 'tree-cap' });
    expect(before.calls).not.toContain('Accessibility.getFullAXTree');
    // The nearest case that passes: exactly at the cap.
    await expect(capture(fakeBrowser({ pages: [flatPage(3, { elements: 24_690 - 1, structNodes: 10 })] }), input({ nodeCap: 24_700 }))).resolves.toBeTruthy();
    const during = fakeBrowser({ pages: [flatPage(100, { elements: 5, structNodes: 10 })] });
    await expect(capture(during, input({ nodeCap: 50 }))).rejects.toMatchObject({ reason: 'tree-cap' });
    // The structure tree alone over the cap.
    await expect(capture(fakeBrowser({ pages: [flatPage(1, { structNodes: 60 })] }), input({ nodeCap: 50 }))).rejects.toMatchObject({ reason: 'tree-cap' });
  });

  it('stops at the output cap: the page\'s own count, the heard tree, and the slices (AC-18)', async () => {
    await expect(capture(fakeBrowser({ pages: [flatPage(1, { capped: 'output' })] }), input())).rejects.toMatchObject({ reason: 'output-cap' });
    await expect(capture(fakeBrowser({ pages: [flatPage(1, { outputBytes: 2000 })] }), input({ outputCap: 1000 }))).rejects.toMatchObject({ reason: 'output-cap' });
    await expect(capture(fakeBrowser({ pages: [flatPage(200, { outputBytes: 0 })] }), input({ outputCap: 4000 }))).rejects.toMatchObject({ reason: 'output-cap' });
    await expect(capture(fakeBrowser({ pages: [flatPage(1, { outputBytes: 0 })], finish: { capped: 'output' } }), input())).rejects.toMatchObject({ reason: 'output-cap' });
    const own = '"structTrees":[],"runs":[' + '"x",'.repeat(100) + '"x"]';
    await expect(capture(fakeBrowser({ pages: [flatPage(1, { outputBytes: 0 })], own, finish: { outputBytes: 0 } }), input({ outputCap: 300 }))).rejects.toMatchObject({ reason: 'output-cap' });
  });

  it('stops at its deadline, and on an answer that is not the page\'s', async () => {
    let t = 0;
    await expect(capture(fakeBrowser({ pages: [flatPage(1)] }), input({ deadline: 5, now: () => (t += 1) }))).rejects.toMatchObject({ reason: 'timeout' });
    await expect(capture(fakeBrowser({ pages: [flatPage(1)], sliceStuck: true }), input())).rejects.toMatchObject({ reason: 'unreadable' });
    const err = new CaptureFailure('timeout');
    expect(err.message).toBe('timeout');
    expect(new CaptureFailure('unreadable', 'x').message).toBe('unreadable: x');
  });
});

describe('axRecord', () => {
  it('keeps role, name, description, value, ignored, children and the level and url properties', () => {
    const rec = axRecord(2, {
      nodeId: '7',
      role: { value: 'heading' },
      name: { value: 'Quarterly sales' },
      description: { value: 'shalom' },
      value: { value: '' },
      ignored: true,
      childIds: ['8'],
      properties: [
        { name: 'level', value: { value: 1 } },
        { name: 'focusable', value: { value: true } },
        { name: 'url', value: { value: 'https://example.org' } },
        { name: 'busy', value: {} },
      ],
    });
    expect(JSON.parse(rec)).toEqual({ p: 2, i: '7', r: 'heading', n: 'Quarterly sales', d: 'shalom', g: 1, c: ['8'], pr: { level: 1, url: 'https://example.org' } });
    expect(JSON.parse(axRecord(1, { nodeId: '1' }))).toEqual({ p: 1, i: '1', r: null, c: [] });
    expect(JSON.parse(axRecord(1, { nodeId: '1', value: { value: 3 } })).v).toBe('3');
  });
});

describe('the output (payloadVersion 1)', () => {
  const captured = {
    chromium: '158.0.8127.36',
    opened: { pages: 75, pagesRead: 60, pdfjs: '6.5.438', declaredUa: null, options: { disableFontFace: true, isEvalSupported: false, enableScripting: false } },
    tagged: false,
    structCut: true,
    structNodes: 3,
    axNodes: 2,
    heard: ['{"p":1,"i":"1"}', '{"p":1,"i":"2"}'],
    own: Buffer.from('"structTrees":[],"runs":[{"text":"םולש"}]'),
    outputBytes: 0,
    outside: 0,
    maxElements: 0,
    failedReads: 0,
  };

  it('is one JSON object assembled as bytes, with the notes of AC-17, AC-18 and AC-21', () => {
    const out = assemble(captured, { bytes: 10, sha256: 'ab' }, null, 'failed');
    const o = JSON.parse(out.toString('utf8'));
    expect(o).toMatchObject({
      payloadVersion: 1,
      viewer: { pdfjs: '6.5.438', chromium: '158.0.8127.36' },
      file: { bytes: 10, sha256: 'ab', pages: 75, pagesRead: 60 },
      tagged: false,
      structCut: true,
      pdfjsOptions: { disableFontFace: true, isEvalSupported: false, enableScripting: false },
      requests: { outside: 0 },
      markedContent: null,
      verapdf: null,
      verapdfError: 'failed',
      heard: [{ p: 1, i: '1' }, { p: 1, i: '2' }],
      structTrees: [],
      runs: [{ text: 'םולש' }],
    });
    expect(o.notes).toEqual([
      'Read the first 60 of 75 pages.',
      'This PDF has no tags: a screen reader has only the plain text to go on.',
      'The structure tree is deeper than 40 levels; pdf.js reads only the first 40.',
    ]);
    const empty = JSON.parse(assemble({ ...captured, heard: [], own: Buffer.alloc(0) }, { bytes: 1, sha256: 'x' }, null, null).toString());
    expect(empty.heard).toEqual([]);
    expect(empty.runs).toEqual([]);
    expect(notesFor({ ...captured, tagged: true, structCut: false, opened: { ...captured.opened, pages: 5, pagesRead: 5 } })).toEqual([]);
  });
});

describe('Cdp over the pipe', () => {
  function pair(max = 1000) {
    const toChrome = new PassThrough();
    const fromChrome = new PassThrough();
    const cdp = new Cdp(toChrome, fromChrome, max);
    const sent: string[] = [];
    toChrome.on('data', (b: Buffer) => sent.push(b.toString()));
    return { cdp, fromChrome, sent };
  }

  it('matches answers to calls, splits on NUL before decoding (a character across two chunks), and passes events on', async () => {
    const { cdp, fromChrome, sent } = pair();
    const events: CdpEvent[] = [];
    cdp.on((e) => events.push(e));
    const p = cdp.send('Runtime.evaluate', { expression: '1' }, 's');
    await new Promise((r) => setImmediate(r));
    expect(sent[0]).toBe('{"id":1,"method":"Runtime.evaluate","params":{"expression":"1"},"sessionId":"s"}\0');
    const msg = Buffer.from(JSON.stringify({ id: 1, result: { v: 'שלום' } }) + '\0' + JSON.stringify({ method: 'Fetch.requestPaused', params: { a: 1 }, sessionId: 's' }) + '\0');
    const cut = msg.indexOf(Buffer.from('ל')) + 1; // inside a two-byte character
    fromChrome.write(msg.subarray(0, cut));
    fromChrome.write(msg.subarray(cut));
    expect(await p).toEqual({ v: 'שלום' });
    expect(events).toEqual([{ method: 'Fetch.requestPaused', params: { a: 1 }, sessionId: 's' }]);
    expect(cdp.largest).toBeGreaterThan(10);
  });

  it('rejects an error answer, and every call once the pipe ends, an answer is unreadable, or a message passes the cap', async () => {
    const a = pair();
    const p = a.cdp.send('X');
    a.fromChrome.write(JSON.stringify({ id: 1, error: { message: 'No node' } }) + '\0');
    await expect(p).rejects.toThrow('No node');
    const q = a.cdp.send('Y');
    a.fromChrome.end();
    await expect(q).rejects.toThrow(/closed the pipe/);
    await expect(a.cdp.send('Z')).rejects.toThrow(/closed the pipe/);
    expect(a.cdp.error).toBeInstanceOf(CdpError);
    const b = pair();
    const r = b.cdp.send('X');
    b.fromChrome.write('{nope\0');
    await expect(r).rejects.toThrow(/unreadable/);
    const c = pair(100);
    const s = c.cdp.send('X');
    c.fromChrome.write('x'.repeat(150));
    await expect(s).rejects.toThrow(/over the cap/);
    expect(c.cdp.largest).toBe(150);
    const d = pair();
    const t = d.cdp.send('X');
    d.fromChrome.emit('error', new Error('EPIPE'));
    await expect(t).rejects.toThrow(/from chromium closed/);
    const e = new Cdp(new PassThrough(), new PassThrough(), 10);
    const u = e.send('X');
    // @ts-expect-error reaching the private stream for the test
    e.out.emit('error', new Error('EPIPE'));
    await expect(u).rejects.toThrow(/to chromium closed/);
  });
});

describe('the capture page (AC-15)', () => {
  it('opens pdf.js with font faces, eval and scripting off, reads only the page\'s own content, and draws no canvas', () => {
    const src = readFileSync(path.resolve(__dirname, '../static/capture.mjs'), 'utf8');
    expect(src).toContain('Object.freeze({ disableFontFace: true, isEvalSupported: false, enableScripting: false })');
    expect(src).toMatch(/getDocument\(\{\s*url: 'job\.pdf',\s*\.\.\.OPTIONS,/);
    expect(src).toContain('getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE })');
    expect(src).toContain('PDFPageView.prototype._drawCanvas');
    // Nothing from another host: every URL the page names is relative.
    expect(src).not.toMatch(/https?:\/\//);
  });
});
