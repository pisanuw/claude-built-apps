import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_CONFIG, demoAcademy } from '../src/core/demo';
import { runJourney } from '../src/core/journey';
import { runStep } from '../src/core/steps';
import { netTransport } from '../src/server/transport';

/**
 * The demo academy served over real HTTP, read through the real network
 * transport (Node fetch, manual redirects, Set-Cookie handling). DNS is
 * faked to a public address and the connection goes to localhost.
 */
let server: Server;
let port = 0;

beforeAll(async () => {
  const academy = demoAcademy(['sale']);
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const out = await academy({ method: req.method as 'GET' | 'POST', url: `https://lotus-yoga-academy.example${req.url}`, headers, body: body || undefined });
      res.statusCode = out.status;
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      if (out.setCookies.length) res.setHeader('set-cookie', out.setCookies);
      res.end(out.text);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('real HTTP round trip', () => {
  it('walks the whole journey', async () => {
    const transport = netTransport({
      lookup: async () => [{ address: '93.184.215.14', family: 4 }],
      fetchImpl: ((url: URL, init: RequestInit) => fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init)) as unknown as typeof fetch,
    });
    const run = await runJourney(DEMO_CONFIG, (s, c, st) => runStep(s, c, st, transport));
    expect(run.results.map((r) => `${r.id}:${r.status}`)).toEqual([
      'home:pass',
      'login:pass',
      'dashboard:pass',
      'course:pass',
      'lesson:pass',
      'quiz:pass',
      'certificate:pass',
      'price:fail',
    ]);
  });
});
