import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bearer, handleApi, LINK_TESTS_PER_HOUR, type ApiDeps } from '../src/server/api';
import { assertPublicUrl, BlockedError, fetchFile, guardedLookup, isPrivateAddress, type Lookup } from '../src/server/fetchfile';
import { liveDeps, makeHandler } from '../src/server/netlify';
import { recordTest, verifyUser } from '../src/server/supabase-rest';
import { emptyResult } from '../src/core/linkcheck';

const publicLookup: Lookup = async () => [{ address: '93.184.216.34', family: 4 }];

function streamOf(bytes: Uint8Array, chunk = 4): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.subarray(i, i + chunk));
      i += chunk;
    },
  });
}

function resp(status: number, headers: Record<string, string>, body?: Uint8Array | string): Response {
  const b = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return new Response(b ? streamOf(b) : null, { status, headers });
}

describe('isPrivateAddress', () => {
  it.each([
    ['10.0.0.1', true], ['127.0.0.1', true], ['169.254.169.254', true], ['172.16.0.1', true], ['192.168.1.1', true], ['100.64.0.1', true],
    ['0.0.0.0', true], ['224.0.0.1', true], ['198.18.0.1', true], ['192.0.0.1', true], ['::1', true], ['::', true], ['fd00::1', true], ['fe80::1', true],
    ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['64:ff9b::1', true], ['2002::1', true], ['ff02::1', true], ['not-ip', true],
    ['::127.0.0.1', true], ['::ffff:0:7f00:1', true], ['fec0::1', true], ['2001::1', true], ['2001:0:4136::1', true], ['2001:db8::1', true], ['198.51.100.1', true], ['203.0.113.9', true], ['240.0.0.1', true],
    ['93.184.216.34', false], ['2606:4700::1111', false], ['::ffff:8.8.8.8', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('assertPublicUrl', () => {
  const ok = (u: string, lookup: Lookup = publicLookup) => assertPublicUrl(new URL(u), lookup);
  it('allows public web hosts', async () => {
    await expect(ok('https://files.example.com/a.pdf')).resolves.toBeUndefined();
    await expect(ok('http://93.184.216.34/a')).resolves.toBeUndefined();
  });
  it('refuses other schemes, ports, credentials and private hosts', async () => {
    await expect(ok('ftp://example.com/a')).rejects.toBeInstanceOf(BlockedError);
    await expect(ok('https://example.com:8443/a')).rejects.toThrow(/standard web ports/);
    await expect(ok('https://u:p@example.com/a')).rejects.toThrow(/user name/);
    await expect(ok('http://localhost/a')).rejects.toThrow(/public website/);
    await expect(ok('http://metadata/a')).rejects.toThrow(/public website/);
    await expect(ok('http://printer.local/a')).rejects.toThrow(/public website/);
    await expect(ok('http://169.254.169.254/latest')).rejects.toThrow(/public website/);
    await expect(ok('http://[::1]/a')).rejects.toThrow(/public website/);
    await expect(ok('https://inside.example.com/', async () => [{ address: '10.1.2.3', family: 4 }])).rejects.toThrow(/public website/);
    await expect(ok('https://empty.example.com/', async () => [])).rejects.toThrow(/public website/);
    await expect(ok('https://nx.example.com/', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/No server/);
  });
});

describe('fetchFile', () => {
  const pdf = new TextEncoder().encode('%PDF-1.4 hello');
  const sha = createHash('sha256').update(pdf).digest('hex');

  it('hashes a file and reads its name', async () => {
    const r = await fetchFile('https://files.example.com/a', {
      lookup: publicLookup,
      fetchImpl: async () => resp(200, { 'content-type': 'application/pdf; x=1', 'content-disposition': 'attachment; filename="Meadow.pdf"' }, pdf),
    });
    expect(r).toMatchObject({ status: 200, contentType: 'application/pdf', fileName: 'Meadow.pdf', size: pdf.length, sha256: sha, page: false, truncated: false, error: '' });
  });
  it('follows redirects, checking every hop', async () => {
    const seen: string[] = [];
    const r = await fetchFile('https://a.example.com/d', {
      lookup: async (host) => [{ address: host === 'evil.example.com' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
      fetchImpl: async (u) => {
        seen.push(String(u));
        if (String(u).endsWith('/d')) return resp(302, { location: '/e' });
        if (String(u).endsWith('/e')) return resp(301, { location: 'https://cdn.example.com/f.pdf' });
        return resp(200, { 'content-type': 'application/pdf' }, pdf);
      },
    });
    expect(seen).toEqual(['https://a.example.com/d', 'https://a.example.com/e', 'https://cdn.example.com/f.pdf']);
    expect(r).toMatchObject({ redirects: 2, finalUrl: 'https://cdn.example.com/f.pdf', fileName: 'f.pdf', sha256: sha });
    const blocked = await fetchFile('https://a.example.com/d', {
      lookup: async (host) => [{ address: host === 'evil.example.com' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
      fetchImpl: async () => resp(302, { location: 'https://evil.example.com/x' }),
    });
    expect(blocked.error).toMatch(/public website/);
    expect(blocked.finalUrl).toBe('https://evil.example.com/x');
  });
  it('stops after too many redirects', async () => {
    const r = await fetchFile('https://a.example.com/0', { lookup: publicLookup, fetchImpl: async (u) => resp(302, { location: `${String(u)}0` }) });
    expect(r.error).toMatch(/more than 6 times/);
  });
  it('reports error statuses without reading the body', async () => {
    const r = await fetchFile('https://a.example.com/x', { lookup: publicLookup, fetchImpl: async () => resp(404, { 'content-type': 'text/html' }, '<title>Nope</title>') });
    expect(r).toMatchObject({ status: 404, page: true, size: 0, pageTitle: '' });
  });
  it('reads a page title and expiry wording', async () => {
    const r = await fetchFile('https://a.example.com/x', { lookup: publicLookup, fetchImpl: async () => resp(200, { 'content-type': 'text/html; charset=utf-8' }, '<title>Download</title><p>This link has expired.</p>') });
    expect(r).toMatchObject({ page: true, pageTitle: 'Download', pageSaysExpired: true, fileName: '' });
  });
  it('stops at the size cap and says so', async () => {
    const big = new Uint8Array(100).fill(7);
    const r = await fetchFile('https://a.example.com/x.bin', { lookup: publicLookup, maxBytes: 10, fetchImpl: async () => resp(200, { 'content-type': 'application/octet-stream' }, big) });
    expect(r).toMatchObject({ size: 10, truncated: true, sha256: createHash('sha256').update(big.subarray(0, 10)).digest('hex') });
  });
  it('does not call a file of exactly the cap truncated', async () => {
    const exact = new Uint8Array(8).fill(1);
    const r = await fetchFile('https://a.example.com/x.bin', { lookup: publicLookup, maxBytes: 8, fetchImpl: async () => resp(200, {}, exact) });
    expect(r).toMatchObject({ size: 8, truncated: false });
    const more = await fetchFile('https://a.example.com/x.bin', { lookup: publicLookup, maxBytes: 8, fetchImpl: async () => resp(200, {}, new Uint8Array(12)) });
    expect(more).toMatchObject({ size: 8, truncated: true });
  });
  it('handles an empty body', async () => {
    const r = await fetchFile('https://a.example.com/x.bin', { lookup: publicLookup, fetchImpl: async () => resp(200, {}) });
    expect(r).toMatchObject({ size: 0, sha256: '', contentType: '' });
  });
  it('turns failures into plain words', async () => {
    expect((await fetchFile('not a url', {})).error).toMatch(/not a valid link/);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect((await fetchFile('https://a.example.com/', { lookup: publicLookup, fetchImpl: async () => { throw abort; } })).error).toMatch(/longer than 8 seconds/);
    expect((await fetchFile('https://a.example.com/', { lookup: publicLookup, fetchImpl: async () => { throw new Error('ECONNRESET'); } })).error).toMatch(/did not answer/);
  });
  it('times out on its budget', async () => {
    const r = await fetchFile('https://a.example.com/', {
      lookup: publicLookup,
      budgetMs: 5,
      fetchImpl: (_u, init) =>
        new Promise((_res, rej) => {
          (init?.signal as AbortSignal).addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })));
        }),
    });
    expect(r.error).toMatch(/longer than 1 seconds/);
  });
});

function deps(over: Partial<ApiDeps> = {}): ApiDeps & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    recorded,
    verifyUser: async (t) => (t.startsWith('good') ? 'user-1' : null),
    record: async (_t, h) => {
      recorded.push(h);
      return 'ok';
    },
    fetchFile: async (u) => ({ ...emptyResult(u), status: 200, size: 3 }),
    ...over,
  };
}

const auth = { authorization: `Bearer good${'x'.repeat(30)}` };

describe('handleApi', () => {
  it('answers health and unknown routes', async () => {
    expect(await handleApi('GET', '/api/health', null, {}, deps())).toEqual({ status: 200, body: { ok: true, status: 'ok' } });
    expect(await handleApi('GET', '/.netlify/functions/api/health/', null, {}, deps())).toEqual({ status: 200, body: { ok: true, status: 'ok' } });
    expect((await handleApi('GET', '/api/nope', null, {}, deps())).status).toBe(404);
    expect((await handleApi('GET', '/api/link-check', null, auth, deps())).status).toBe(405);
  });
  it('needs a signed-in caller', async () => {
    expect((await handleApi('POST', '/api/link-check', '{"url":"https://a.example/x"}', {}, deps())).status).toBe(401);
    const bad = await handleApi('POST', '/api/link-check', '{"url":"https://a.example/x"}', { authorization: `Bearer bad${'x'.repeat(30)}` }, deps());
    expect(bad).toMatchObject({ status: 401, body: { error: expect.stringMatching(/session has ended/) } });
  });
  it('validates the body', async () => {
    const d = deps();
    expect((await handleApi('POST', '/api/link-check', 'nope', auth, d)).status).toBe(400);
    expect((await handleApi('POST', '/api/link-check', null, auth, d)).status).toBe(400);
    expect((await handleApi('POST', '/api/link-check', '{"url":5}', auth, d)).status).toBe(400);
    expect((await handleApi('POST', '/api/link-check', JSON.stringify({ url: `https://a.example/${'x'.repeat(2100)}` }), auth, d)).status).toBe(400);
    expect((await handleApi('POST', '/api/link-check', '{"url":"javascript:alert(1)"}', auth, d)).status).toBe(400);
    expect((await handleApi('POST', '/api/link-check', '{"url":"not a url"}', auth, d)).status).toBe(400);
    expect(d.recorded).toEqual([]);
  });
  it('tests the link and records the host', async () => {
    const d = deps();
    const r = await handleApi('POST', '/api/link-check', '{"url":" https://files.example/a.pdf "}', auth, d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ url: 'https://files.example/a.pdf', status: 200 });
    expect(d.recorded).toEqual(['files.example']);
  });
  it('refuses without fetching when the database says the user is at the limit', async () => {
    let fetched = false;
    const d = deps({ record: async () => 'limited', fetchFile: async (u) => ((fetched = true), emptyResult(u)) });
    const r = await handleApi('POST', '/api/link-check', '{"url":"https://a.example/x"}', auth, d);
    expect(r).toMatchObject({ status: 429, body: { error: expect.stringContaining(String(LINK_TESTS_PER_HOUR)) } });
    expect(fetched).toBe(false);
  });
  it('answers 503 when Supabase fails', async () => {
    const r = await handleApi('POST', '/api/link-check', '{"url":"https://a.example/x"}', auth, deps({ verifyUser: async () => { throw new Error('down'); } }));
    expect(r.status).toBe(503);
  });
  it('reads bearer tokens strictly', () => {
    expect(bearer({ Authorization: `Bearer ${'a'.repeat(25)}` })).toBe('a'.repeat(25));
    expect(bearer({ authorization: 'Bearer short' })).toBe('');
    expect(bearer({ authorization: `Basic ${'a'.repeat(25)}` })).toBe('');
    expect(bearer({})).toBe('');
  });
});

describe('supabase-rest', () => {
  const cfg = (fetchImpl: typeof fetch) => ({ url: 'https://auth.example/', anonKey: 'anon', fetchImpl });
  it('verifies the user', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push([u, init]);
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await verifyUser(cfg(f), 'tok')).toBe('u1');
    expect(calls[0][0]).toBe('https://auth.example/auth/v1/user');
    expect((calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(await verifyUser(cfg((async () => new Response('', { status: 401 })) as unknown as typeof fetch), 't')).toBeNull();
    expect(await verifyUser(cfg((async () => new Response('{}', { status: 200 })) as unknown as typeof fetch), 't')).toBeNull();
    await expect(verifyUser(cfg((async () => new Response('', { status: 500 })) as unknown as typeof fetch), 't')).rejects.toThrow(/auth 500/);
  });
  it('records a test', async () => {
    let body = '';
    const f = (async (_u: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    expect(await recordTest(cfg(f), 't', 'files.example')).toBe('ok');
    expect(JSON.parse(body)).toEqual({ host: 'files.example' });
    expect(await recordTest(cfg((async () => new Response('{"code":"PT429"}', { status: 429 })) as unknown as typeof fetch), 't', 'h')).toBe('limited');
    await expect(recordTest(cfg((async () => new Response(null, { status: 403 })) as unknown as typeof fetch), 't', 'h')).rejects.toThrow(/record 403/);
  });
});

describe('netlify handler', () => {
  it('wraps handleApi with JSON headers and base64 bodies', async () => {
    const handler = makeHandler(() => deps());
    const r = await handler({ httpMethod: 'POST', path: '/api/link-check', headers: auth, body: Buffer.from('{"url":"https://a.example/x"}').toString('base64'), isBase64Encoded: true });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.body).url).toBe('https://a.example/x');
    const h = await handler({ httpMethod: 'GET', path: '/api/health', body: null });
    expect(JSON.parse(h.body)).toEqual({ ok: true, status: 'ok' });
  });
  it('builds live deps over the REST config', async () => {
    const d = liveDeps({ url: 'https://auth.example', anonKey: 'anon', fetchImpl: (async () => new Response(JSON.stringify({ id: 'u9' }), { status: 200, headers: { 'content-range': '*/0' } })) as unknown as typeof fetch });
    expect(await d.verifyUser('t')).toBe('u9');
    expect(await d.record('t', 'h')).toBe('ok');
    expect((await d.fetchFile('not a url')).error).toMatch(/not a valid link/);
  });
});

describe('guardedLookup', () => {
  type Resolve = Parameters<typeof guardedLookup>[3];
  const fake = (addresses: Array<{ address: string; family: number }>, err: Error | null = null): Resolve =>
    ((_h: string, _o: unknown, cb: (e: Error | null, a: unknown) => void) => cb(err, addresses)) as unknown as Resolve;
  const run = (opts: { all?: boolean } | number | undefined, resolve: Resolve) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((done) => guardedLookup('h.example', opts, (err, address, family) => done({ err, address, family }), resolve));
  it('passes public addresses through, one or all', async () => {
    expect(await run(undefined, fake([{ address: '93.184.216.34', family: 4 }]))).toEqual({ err: null, address: '93.184.216.34', family: 4 });
    expect((await run({ all: true }, fake([{ address: '2606:4700::1111', family: 6 }]))).address).toEqual([{ address: '2606:4700::1111', family: 6 }]);
  });
  it('refuses a name with any private answer, or none', async () => {
    const r = await run({ all: true }, fake([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]));
    expect(r.err?.code).toBe('EBLOCKED');
    expect(r.address).toEqual([]);
    expect((await run(4, fake([]))).err?.code).toBe('EBLOCKED');
  });
  it('passes resolver errors on', async () => {
    const r = await run(undefined, fake([], Object.assign(new Error('nx'), { code: 'ENOTFOUND' })));
    expect(r.err?.code).toBe('ENOTFOUND');
    expect(r.address).toBe('');
  });
});
