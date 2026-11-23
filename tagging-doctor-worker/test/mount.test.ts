/** CR-13: the checker as a mountable part (startChecker), as backend-hub and main.ts use it. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startChecker, type Checker } from '../src/mount.ts';
import type { RunResult, Spawner } from '../src/sandbox.ts';
import { UNAVAILABLE_MESSAGE } from '../src/server.ts';
import { makeZip } from './zipmaker.ts';

const projectZipFor = (files: Record<string, string>) => makeZip(Object.entries(files).map(([name, data]) => ({ name, data, method: 8 as const })));

let root = '';
let server: Server | null = null;
let checker: Checker | null = null;
const lines: string[] = [];
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tdw-mount-'));
  lines.length = 0;
});
afterEach(async () => {
  checker?.stop();
  checker = null;
  if (server) await new Promise((r) => (server as Server).close(r));
  server = null;
  rmSync(root, { recursive: true, force: true });
});

const ENV = { SUPABASE_URL: 'https://auth.example.org', SUPABASE_ANON_KEY: 'anon' };
/** A self-test that passes: TeX runs as uid 10001, which cannot read the server's file. */
const passing: Spawner = async (argv) => {
  const cmd = argv[argv.lastIndexOf('--') + 1];
  const out: Partial<RunResult> = cmd === 'id' ? { stdout: '10001\n' } : cmd === 'cat' ? { code: 1 } : cmd === 'lualatex' ? { stdout: 'This is LuaHBTeX, Version 1.24.0' } : {};
  return { code: 0, signal: null, timedOut: false, stdout: '', ...out };
};

/** Serves the checker under a prefix, as the hub does (the request's URL is the path below the mount). */
async function serve(c: Checker, prefix = '/tagging-doctor'): Promise<string> {
  server = createServer((req, res) => {
    if (!req.url?.startsWith(prefix + '/')) {
      res.writeHead(404).end();
      return;
    }
    req.url = req.url.slice(prefix.length);
    void c.handle(req, res);
  });
  await new Promise<void>((r) => (server as Server).listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${((server as Server).address() as AddressInfo).port}${prefix}`;
}

describe('startChecker', () => {
  it('with a passing self-test: health says compile true, and a new job’s Location carries the mount’s prefix', async () => {
    checker = await startChecker({ ...ENV, JOBS_ROOT: root, TEX_GID: '10001' }, { basePath: '/tagging-doctor/', spawner: passing, verify: async (t) => (t === 'token-of-user-a' ? 'user-a' : null), write: (l) => lines.push(l) });
    expect(checker.selfTest).toMatchObject({ separateUser: true, texRuns: true });
    expect(checker.maxWaiting).toBe(3);
    const base = await serve(checker);
    const h = await fetch(`${base}/api/health`);
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ status: 'ok', compile: true, texlive: 'unknown', verapdf: 'unknown' });
    const r = await fetch(`${base}/api/jobs?mainFile=main.tex`, { method: 'POST', body: projectZipFor({ 'main.tex': '\\documentclass{article}\\begin{document}Hi\\end{document}' }), headers: { authorization: 'Bearer token-of-user-a' } });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    expect(r.headers.get('location')).toBe(`/tagging-doctor/api/jobs/${id}`);
    // The log names the self-test, and holds no path or token.
    expect(lines.some((l) => l.includes('"event":"self-test"') && l.includes('"separateUser":true'))).toBe(true);
    expect(lines.join('\n')).not.toContain('token-of-user-a');
  });

  it('with a failing self-test (AC-64, AC-82 c): health is 200 with compile false, and a job is refused with 503', async () => {
    checker = await startChecker({ ...ENV, JOBS_ROOT: root, TEX_UID: 'none' }, { verify: async () => 'user-a', write: (l) => lines.push(l) });
    expect(checker.selfTest).toMatchObject({ separateUser: false, texRuns: false });
    expect(checker.maxWaiting).toBe(0);
    const base = await serve(checker);
    const h = await fetch(`${base}/api/health`);
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ status: 'ok', compile: false, queue: { maxWaiting: 0 } });
    const r = await fetch(`${base}/api/jobs?mainFile=main.tex`, { method: 'POST', body: 'x', headers: { authorization: 'Bearer token-of-user-a' } });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: UNAVAILABLE_MESSAGE });
    expect(readdirSync(root)).toEqual([]); // nothing stored
  });

  it('throws on settings it cannot use, so the hub can mount its stand-in instead', async () => {
    await expect(startChecker({ JOBS_ROOT: root })).rejects.toThrow('SUPABASE_URL is required');
  });

  it('defaults to the real token check and stdout', async () => {
    checker = await startChecker({ ...ENV, JOBS_ROOT: root, TEX_UID: 'none' });
    const base = await serve(checker);
    // No token: 401 before any call to Supabase.
    expect((await fetch(`${base}/api/jobs/${'a'.repeat(32)}`)).status).toBe(401);
  });
});
