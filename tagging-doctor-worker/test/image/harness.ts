/**
 * Runs the built image with a stand-in for Supabase's auth/v1/user, for the
 * tests that need TeX, veraPDF and the real users and permissions.
 * Needs a Docker daemon; the image name is WORKER_IMAGE (default tagging-doctor-worker:dev).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as netServer, createServer as netCreateServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, type RawEntry } from '../zipmaker.ts';

export const IMAGE = process.env.WORKER_IMAGE ?? 'tagging-doctor-worker:dev';
export const TOKEN_A = 'image-test-token-user-a-0000000000';
export const TOKEN_B = 'image-test-token-user-b-0000000000';
export const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FRESH = 'image-test-token-fresh-';
let fresh = 0;
/** A token for a user of its own, so the hourly limit (AC-33) does not stop a suite. */
export const freshToken = () => `${FRESH}${process.pid}-${++fresh}-0000000000`;
function userFor(token: string): string {
  const h = createHash('sha256').update(token).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

export interface JobView {
  id: string;
  status: string;
  result: { pages: number | null; seconds: number; warnings: number; runs: number; validation: { compliant: boolean; profile: string; verapdfVersion: string; failedRules: number } | null } | null;
  failure: { kind: string; message: string } | null;
  logTail: string[];
  pdf: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

async function freePort(): Promise<number> {
  const s = netServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

export function docker(args: string[], input?: string): string {
  return execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
}

export function projectZip(files: Record<string, string>): Uint8Array {
  return makeZip(Object.entries(files).map(([name, data]): RawEntry => ({ name, data, method: 8 })));
}

/** A folder of the repository as a zip (the math-notes fixture). */
export function folderZip(dir: string): Uint8Array {
  const entries: RawEntry[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else entries.push({ name: r, data: readFileSync(path.join(dir, r)), method: 8 });
    }
  };
  walk('');
  return makeZip(entries);
}

export class Worker {
  base = '';
  name = '';
  private auth: Server | null = null;

  static async start(opts: { cpus?: string; jobLimitMs?: number; extraEnv?: Record<string, string>; authDelayMs?: number } = {}): Promise<Worker> {
    const w = new Worker();
    w.auth = createServer(async (req, res) => {
      if (opts.authDelayMs) await new Promise((r) => setTimeout(r, opts.authDelayMs));
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const id = token === TOKEN_A ? USER_A : token === TOKEN_B ? USER_B : token?.startsWith(FRESH) ? userFor(token) : null;
      res.writeHead(id ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(id ? { id } : { msg: 'invalid JWT' }));
    });
    await new Promise<void>((r) => (w.auth as Server).listen(0, '127.0.0.1', r));
    const authPort = ((w.auth as Server).address() as AddressInfo).port;
    const port = await freePort();
    w.base = `http://127.0.0.1:${port}`;
    w.name = `tdw-test-${port}`;
    const env = { PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${authPort}`, SUPABASE_ANON_KEY: 'anon-test', ...(opts.jobLimitMs ? { JOB_LIMIT_MS: String(opts.jobLimitMs) } : {}), ...(opts.extraEnv ?? {}) };
    docker([
      'run', '-d', '--name', w.name, '--network', 'host', '--memory', '512m', '--memory-swap', '512m',
      ...(opts.cpus ? ['--cpus', opts.cpus] : []),
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      IMAGE,
    ]);
    // The planted file only the server user can read, and the hint folder (AC-31).
    w.exec(['sh', '-c', 'install -d -m 0755 /srv/planted /srv/hint && umask 077 && printf "%s\\n" "$0" > /srv/planted/secret.tex', ABS_MARK]);
    const t0 = Date.now();
    for (;;) {
      try {
        const r = await fetch(`${w.base}/api/health`);
        if (r.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() - t0 > 120_000) throw new Error(`the worker did not start:\n${w.logs()}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    return w;
  }

  exec(argv: string[]): string {
    return docker(['exec', this.name, ...argv]);
  }

  logs(): string {
    const r = spawnSync('docker', ['logs', this.name], { encoding: 'utf8' });
    return `${r.stdout}${r.stderr}`;
  }

  /** Files of the TeX user anywhere outside /proc (the job folders are gone after each job). */
  texUserFiles(): string[] {
    return this.exec(['sh', '-c', 'find / /dev/shm -xdev -user 10001 -not -path "/proc/*" 2>/dev/null || true']).split('\n').filter(Boolean);
  }

  hint(paths: string[]) {
    this.exec(['sh', '-c', 'umask 022 && printf "%s" "$0" > /srv/hint/hint.txt.new && mv /srv/hint/hint.txt.new /srv/hint/hint.txt', paths.join('\n') + '\n']);
  }

  clearHint() {
    this.exec(['rm', '-f', '/srv/hint/hint.txt']);
  }

  async submit(zip: Uint8Array, mainFile = 'main.tex', token = TOKEN_A): Promise<Response> {
    return fetch(`${this.base}/api/jobs?mainFile=${encodeURIComponent(mainFile)}`, { method: 'POST', body: zip, headers: { authorization: `Bearer ${token}` } });
  }

  async job(id: string, token = TOKEN_A): Promise<JobView> {
    return (await (await fetch(`${this.base}/api/jobs/${id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as JobView;
  }

  async waitFor(id: string, status: string[], token = TOKEN_A, limitMs = 300_000): Promise<JobView> {
    const t0 = Date.now();
    for (;;) {
      const j = await this.job(id, token);
      if (status.includes(j.status)) return j;
      if (Date.now() - t0 > limitMs) throw new Error(`job ${id} still ${j.status}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async run(zip: Uint8Array, mainFile = 'main.tex', token = TOKEN_A): Promise<JobView> {
    const r = await this.submit(zip, mainFile, token);
    if (r.status !== 202) throw new Error(`submit: ${r.status} ${await r.text()}`);
    const { id } = (await r.json()) as { id: string };
    return this.waitFor(id, ['done', 'failed'], token);
  }

  /** The PDF's text (pdftotext when present) and its raw bytes, or '' when there is none. */
  async pdfText(id: string, token = TOKEN_A): Promise<string> {
    const r = await fetch(`${this.base}/api/jobs/${id}/pdf`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 200) return '';
    const bytes = Buffer.from(await r.arrayBuffer());
    const p = spawnSync('pdftotext', ['-', '-'], { input: bytes, encoding: 'utf8' });
    return `${p.status === 0 ? p.stdout : ''}\n${bytes.toString('latin1')}`;
  }

  async stop() {
    spawnSync('docker', ['rm', '-f', this.name]);
    await new Promise((r) => (this.auth ? this.auth.close(r) : r(null)));
  }
}

export const ABS_MARK = `ABSMARKER${Date.now().toString(36)}`;
export const QUEUED_MARK = 'QUEUEDMARKER';
export const LEFT_MARK = 'LEFTMARKER';

export function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, 'hostile', name), 'utf8');
}

/**
 * A TCP listener on the host that counts every connection (http, https, ftp
 * alike) and answers HTTP with a small BibTeX entry (AC-31's network check).
 */
export async function startListener(): Promise<{ url: string; port: number; seen: string[]; close: () => Promise<void> }> {
  const seen: string[] = [];
  const server = netCreateServer((sock) => {
    sock.once('data', (b) => {
      seen.push(b.toString('latin1').split('\r\n')[0] || '(binary)');
      sock.end('HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\n@book{knuth, author={Leaked}, title={Leaked}, year={1}}\n');
    });
    sock.on('error', () => {});
    seen.push('connection');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, seen, close: () => new Promise((r) => server.close(() => r())) };
}
