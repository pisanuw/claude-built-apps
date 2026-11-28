/**
 * Runs the hub's image (backend-hub:dev, or HUB_IMAGE) as Render runs it, at
 * 0.5 CPU and 512 MB, with a stand-in for Supabase's auth/v1/user, for the
 * tests that need Chromium, pdf.js, veraPDF and the real users. Needs a
 * Docker daemon, the fixtures (`npm run fixtures` in heard-as-check/), and
 * SECCOMP: the seccomp profile Chromium's sandbox needs under Docker, which is
 * Docker's default profile plus one rule (spike/make-seccomp.mjs, D-15):
 *   curl -fsSL -o default.json https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json
 *   node spike/make-seccomp.mjs default.json seccomp-chromium.json
 *   SECCOMP=$PWD/seccomp-chromium.json npm run test:image
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as netServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE = process.env.HUB_IMAGE ?? 'backend-hub:dev';
export const SECCOMP = process.env.SECCOMP ?? '';
export const FIXTURES = fileURLToPath(new URL('../../../heard-as-check/test/fixtures/out', import.meta.url));
export const PREFIX = '/heard-as-check';
export const TOKEN_A = 'image-test-token-user-a-0000000000';
export const TOKEN_B = 'image-test-token-user-b-0000000000';
export const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FRESH = 'image-test-token-fresh-';
let fresh = 0;
/** A token for a person of their own, so the daily cap (AC-25) does not stop a suite. */
export const freshToken = () => `${FRESH}${process.pid}-${++fresh}-0000000000`;
function userFor(token: string): string {
  const h = createHash('sha256').update(token).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function fixture(name: string): Buffer {
  const file = path.join(FIXTURES, `${name}.pdf`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run npm run fixtures in heard-as-check/`);
  return readFileSync(file);
}

export function docker(args: string[], input?: string): string {
  return execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
}

async function freePort(): Promise<number> {
  const s = netServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

export interface JobView {
  id: string;
  status: 'running' | 'done' | 'failed';
  stage: string | null;
  failure: { reason: string; message: string } | null;
  result: boolean;
}

export class Hub {
  root = '';
  base = '';
  name = '';
  id = '';
  private auth: Server | null = null;

  static async start(opts: { cpus?: string; env?: Record<string, string>; coldCache?: boolean; waitForSelfTest?: boolean } = {}): Promise<Hub> {
    if (!SECCOMP) throw new Error('SECCOMP must name the seccomp profile Chromium needs (see harness.ts)');
    const h = new Hub();
    h.auth = createServer((req, res) => {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const id = token === TOKEN_A ? USER_A : token === TOKEN_B ? USER_B : token?.startsWith(FRESH) ? userFor(token) : null;
      res.writeHead(id ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(id ? { id } : { msg: 'invalid JWT' }));
    });
    await new Promise<void>((r) => (h.auth as Server).listen(0, '127.0.0.1', r));
    const authPort = ((h.auth as Server).address() as AddressInfo).port;
    const port = await freePort();
    h.root = `http://127.0.0.1:${port}`;
    h.base = `${h.root}${PREFIX}`;
    h.name = `hac-image-${port}`;
    const auth = `http://127.0.0.1:${authPort}`;
    const env: Record<string, string> = {
      PORT: String(port),
      COOKIE_SECRET: 'image-test-cookie-secret',
      TAGGING_DOCTOR_SUPABASE_URL: auth,
      TAGGING_DOCTOR_SUPABASE_ANON_KEY: 'anon-test',
      HEARD_AS_CHECK_SUPABASE_URL: auth,
      HEARD_AS_CHECK_SUPABASE_ANON_KEY: 'anon-test',
      ...opts.env,
    };
    // A new container after a deploy starts with a cold page cache (SPEC section 3).
    if (opts.coldCache) dropCaches();
    h.id = docker([
      'run', '-d', '--name', h.name, '--network', 'host', '--memory', '512m', '--memory-swap', '512m', '--cpus', opts.cpus ?? '0.5',
      '--security-opt', `seccomp=${SECCOMP}`,
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      IMAGE,
    ]).trim();
    const t0 = Date.now();
    for (;;) {
      try {
        const r = await fetch(`${h.base}/api/health`);
        if (r.ok) {
          const body = (await r.json()) as { selfTest?: { reason?: string } };
          if (opts.waitForSelfTest === false || body.selfTest?.reason !== 'running') break;
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() - t0 > 180_000) throw new Error(`the hub did not start:\n${h.logs()}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    return h;
  }

  exec(argv: string[], user?: string): string {
    return docker(['exec', ...(user ? ['--user', user] : []), this.name, ...argv]);
  }

  execStatus(argv: string[], user?: string): { status: number | null; out: string } {
    const r = spawnSync('docker', ['exec', ...(user ? ['--user', user] : []), this.name, ...argv], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  logs(): string {
    const r = spawnSync('docker', ['logs', this.name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return `${r.stdout}${r.stderr}`;
  }

  /** The mount's JSON log lines of one event. */
  events(event: string): Record<string, unknown>[] {
    return this.logs()
      .split('\n')
      .filter((l) => l.startsWith('{') && l.includes('"app":"heard-as-check"') && l.includes(`"event":"${event}"`))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  async health(): Promise<Record<string, unknown>> {
    return (await (await fetch(`${this.base}/api/health`)).json()) as Record<string, unknown>;
  }

  async submit(pdf: Buffer, token = TOKEN_A): Promise<Response> {
    return fetch(`${this.base}/api/jobs`, { method: 'POST', body: pdf, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' } });
  }

  async job(id: string, token = TOKEN_A): Promise<JobView> {
    return (await (await fetch(`${this.base}/api/jobs/${id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as JobView;
  }

  async waitFor(id: string, token = TOKEN_A, limitMs = 200_000, onPoll?: () => Promise<void>): Promise<JobView> {
    const t0 = Date.now();
    for (;;) {
      const j = await this.job(id, token);
      if (j.status !== 'running') return j;
      if (Date.now() - t0 > limitMs) throw new Error(`job ${id} still running`);
      if (onPoll) await onPoll();
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async result(id: string, token = TOKEN_A): Promise<Record<string, any>> {
    const r = await fetch(`${this.base}/api/jobs/${id}/result`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 200) throw new Error(`result: ${r.status} ${await r.text()}`);
    return (await r.json()) as Record<string, any>;
  }

  /** Submits and waits; returns the job and, when it is done, its result. */
  async run(pdf: Buffer, token = freshToken()): Promise<{ job: JobView; result: Record<string, any> | null; token: string }> {
    const r = await this.submit(pdf, token);
    if (r.status !== 202) throw new Error(`submit: ${r.status} ${await r.text()}`);
    const { id } = (await r.json()) as { id: string };
    const job = await this.waitFor(id, token);
    return { job, result: job.status === 'done' ? await this.result(id, token) : null, token };
  }

  /** The container's cgroup v1 memory folder on the host. */
  cgroupDir(): string {
    const v1 = `/sys/fs/cgroup/memory/docker/${this.id}`;
    if (existsSync(v1)) return v1;
    return `/sys/fs/cgroup/system.slice/docker-${this.id}.scope`;
  }

  /** The container's non-reclaimable memory now (SPEC section 3), read from the host. */
  containerMemory(): number {
    const stat = readFileSync(path.join(this.cgroupDir(), 'memory.stat'), 'utf8');
    const f = (n: string) => Number(new RegExp(`^${n} (\\d+)$`, 'm').exec(stat)?.[1] ?? NaN);
    return Number.isNaN(f('total_rss')) ? f('anon') + f('shmem') : f('total_rss') + f('total_shmem');
  }

  /** Bytes the container's cgroup has hit its limit (oom kills), when readable. */
  oomKills(): number {
    try {
      return Number(/oom_kill (\d+)/.exec(readFileSync(path.join(this.cgroupDir(), 'memory.oom_control'), 'utf8'))?.[1] ?? 0);
    } catch {
      return 0;
    }
  }

  async stop() {
    spawnSync('docker', ['rm', '-f', this.name]);
    await new Promise((r) => (this.auth ? this.auth.close(r) : r(null)));
  }
}

/** Drops the host's page cache, so the next container starts cold (as Manager measured AC-1). */
export function dropCaches(): void {
  spawnSync('sh', ['-c', 'sync; echo 3 > /proc/sys/vm/drop_caches']);
}

/**
 * The job's non-file memory read from the host (SPEC section 3): Pss_Anon +
 * Pss_Shmem of every process of uid `uid`, summed at one instant. The host
 * can read smaps_rollup; root in the container cannot.
 */
export function hostJobMemory(uid = 10002): { nonFile: number; fallback: number; file: number } {
  let nonFile = 0;
  let fallback = 0;
  let file = 0;
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== uid) continue;
      const kb = (t: string, f: string) => Number(new RegExp(`^${f}:\\s+(\\d+) kB$`, 'm').exec(t)?.[1] ?? 0) * 1024;
      fallback += kb(status, 'RssAnon') + kb(status, 'RssShmem');
      const r = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      nonFile += kb(r, 'Pss_Anon') + kb(r, 'Pss_Shmem');
      file += kb(r, 'Pss_File');
    } catch {
      /* gone */
    }
  }
  return { nonFile, fallback, file };
}

/** Samples a reading every `ms` until stopped; returns the peak and the largest gap. */
export function sampler(read: () => number, ms = 100): { stop: () => { peak: number; maxGap: number; samples: number } } {
  let peak = 0;
  let samples = 0;
  let last = Date.now();
  let maxGap = 0;
  const tick = () => {
    const now = Date.now();
    if (samples) maxGap = Math.max(maxGap, now - last);
    last = now;
    samples++;
    try {
      peak = Math.max(peak, read());
    } catch {
      /* the container went away */
    }
  };
  tick();
  const t = setInterval(tick, ms);
  return {
    stop: () => {
      clearInterval(t);
      tick();
      return { peak, maxGap, samples };
    },
  };
}

/** TCP and UDP sockets of uid `uid` on the host's network (the container shares it, --network host): local and remote addresses. */
export function socketsOf(uid = 10002): string[] {
  const out: string[] = [];
  for (const f of ['tcp', 'tcp6', 'udp', 'udp6']) {
    let text = '';
    try {
      text = readFileSync(`/proc/net/${f}`, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 7 && Number(cols[7]) === uid) out.push(`${f} ${cols[1]} -> ${cols[2]} st ${cols[3]}`);
    }
  }
  return out;
}

export const MB = 2 ** 20;
