/**
 * AC-82 (CR-13): the hub's image with the checker mounted beside mult-streak.
 * Runs only against the hub's image (WORKER_IMAGE=backend-hub:dev, the default).
 *
 * (a) While a compile runs, and during and after the infinite-loop and
 *     memory-bomb fixtures of AC-31, the hub's own /api/health and a
 *     mult-streak route each answer 200 within 2 seconds, probed every second.
 * (b) The container, at --memory 512m (and the hub's 0.5 CPU), runs the tagged
 *     math-notes job (AC-68's zip) with mult-streak mounted and is not
 *     killed; the peak memory is printed for DECISIONS.md and is under about 450 MB.
 * (c) When the checker's self-test fails (forced two ways), its health route
 *     answers 200 with compile: false, it takes no job, and the hub's other
 *     mounts still answer.
 * And mult-streak's players' file and the hub's environment are out of a job's reach.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { docker, FIXTURES, fixture, freshToken, IMAGE, IN_HUB, projectZip, Worker, type JobView } from './harness.ts';

const AC68_TAGGED = new Uint8Array(readFileSync(path.join(FIXTURES, 'ac68', 'math-notes-tagged.zip')));
const PROBE_LIMIT_MS = 2_000;
const MULT_STREAK_ROUTE = '/mult-streak/api/state';

let w: Worker | null = null;
afterEach(async () => {
  await w?.stop();
  w = null;
});

interface Probe {
  path: string;
  status: number;
  ms: number;
}

/** Probes the hub's health and a mult-streak route once a second until stopped; each probe waits at most 5 s. */
function probe(root: string) {
  const seen: Probe[] = [];
  let stop = false;
  const one = async (p: string) => {
    const t0 = Date.now();
    let status = 0;
    try {
      const r = await fetch(`${root}${p}`, { signal: AbortSignal.timeout(5_000) });
      status = r.status;
      await r.arrayBuffer();
    } catch {
      status = -1;
    }
    seen.push({ path: p, status, ms: Date.now() - t0 });
  };
  const loop = (async () => {
    while (!stop) {
      const tick = Date.now();
      await Promise.all([one('/api/health'), one(MULT_STREAK_ROUTE)]);
      await new Promise((r) => setTimeout(r, Math.max(0, 1_000 - (Date.now() - tick))));
    }
  })();
  return {
    seen,
    async end() {
      stop = true;
      await loop;
      return seen;
    },
  };
}

function summary(label: string, seen: Probe[]): string {
  const worst = (p: string) => Math.max(0, ...seen.filter((s) => s.path === p).map((s) => s.ms));
  const bad = seen.filter((s) => s.status !== 200 || s.ms > PROBE_LIMIT_MS);
  return `AC-82a ${label}: probes=${seen.length} slowest_hub_ms=${worst('/api/health')} slowest_mult_streak_ms=${worst(MULT_STREAK_ROUTE)} bad=${bad.length}`;
}

function expectAllAnswered(seen: Probe[]) {
  expect(seen.length).toBeGreaterThan(4);
  for (const p of seen) {
    expect(p.status, `${p.path} after ${p.ms} ms`).toBe(200);
    expect(p.ms, p.path).toBeLessThanOrEqual(PROBE_LIMIT_MS);
  }
}

const run = async (w: Worker, files: Record<string, string>): Promise<JobView> => w.run(projectZip(files), 'main.tex', freshToken());

describe.runIf(IN_HUB)('AC-82 on the hub’s image, with mult-streak mounted', () => {
  it('(a) the hub and mult-streak answer within 2 s, every second, through a compile, the infinite loop and the memory bomb, and after them', async () => {
    // The checker's own 120-second limit: the tagged job needs more than a shortened one.
    w = await Worker.start({ cpus: '0.5' });
    const p = probe(w.root);
    const compile = await w.run(AC68_TAGGED, 'main.tex', freshToken());
    expect(compile.status).toBe('done');
    const loop = await run(w, { 'main.tex': fixture('loop.tex') });
    expect(loop.failure?.kind).toBe('timeout');
    const bomb = await run(w, { 'main.tex': fixture('memory-bomb.tex') });
    expect(bomb.status).toBe('failed');
    // After them: ten more seconds of probes.
    await new Promise((r) => setTimeout(r, 10_000));
    const seen = await p.end();
    console.log(summary('compile+loop+bomb at 0.5 CPU', seen));
    expectAllAnswered(seen);
    expect(docker(['inspect', '-f', '{{.State.OOMKilled}} {{.State.Running}} {{.RestartCount}}', w.name]).trim()).toBe('false true 0');
  });

  it('(b) the tagged math-notes job at --memory 512m and 0.5 CPU, with mult-streak mounted: not killed, peak under about 450 MB', async () => {
    w = await Worker.start({ cpus: '0.5' });
    const id = docker(['inspect', '-f', '{{.Id}}', w.name]).trim();
    const cg = `/sys/fs/cgroup/memory/docker/${id}`;
    const read = (f: string) => (existsSync(`${cg}/${f}`) ? readFileSync(`${cg}/${f}`, 'utf8') : '0');
    let peakRss = 0;
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, Number(/^total_rss (\d+)$/m.exec(read('memory.stat'))?.[1] ?? 0));
    }, 100);
    // mult-streak in use while the job runs.
    const p = probe(w.root);
    const job = await w.run(AC68_TAGGED, 'main.tex', freshToken());
    clearInterval(sampler);
    const seen = await p.end();
    const mb = (b: number) => Math.round(b / 1048576);
    const jobSeconds = (Date.parse(job.finishedAt as string) - Date.parse(job.startedAt as string)) / 1000;
    const oom = docker(['inspect', '-f', '{{.State.OOMKilled}} {{.State.Running}} {{.RestartCount}}', w.name]).trim();
    console.log(
      `AC-82b tagged math-notes (AC-68 zip) cpus=0.5 memory=512m status=${job.status} job_s=${jobSeconds.toFixed(1)} pages=${job.result?.pages} failed_rules=${job.result?.validation?.failedRules} peak_rss_mb=${mb(peakRss)} max_usage_incl_cache_mb=${mb(Number(read('memory.max_usage_in_bytes')))} oom_running_restarts=${oom}`,
    );
    console.log(summary('during the tagged job', seen));
    expect(job.status).toBe('done');
    expect(oom).toBe('false true 0');
    expect(mb(peakRss)).toBeLessThan(450);
    expect(peakRss).toBeGreaterThan(0); // the sampler read the container's cgroup
    expect(jobSeconds).toBeLessThan(90); // AC-68's rule, on the image (AC-80 decides it live)
    expectAllAnswered(seen);
  });

  it.each([
    ['no TeX user of its own', { TEX_UID: 'none' }],
    ['TeX would run as the server’s own user', { TEX_UID: '0' }],
  ])('(c) a failed self-test (%s): health 200 with compile false, no job, and the hub’s other mounts answer', async (_label, extraEnv) => {
    w = await Worker.start({ extraEnv });
    const h = (await (await fetch(`${w.base}/api/health`)).json()) as Record<string, unknown>;
    expect(h).toMatchObject({ status: 'ok', compile: false, queue: { maxWaiting: 0 } });
    const r = await w.submit(projectZip({ 'main.tex': '\\documentclass{article}\\begin{document}Hi\\end{document}' }), 'main.tex', freshToken());
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('The checker is not available. The scan still works.');
    const hub = await fetch(`${w.root}/api/health`);
    expect(hub.status).toBe(200);
    expect(((await hub.json()) as { status: string }).status).toBe('ok');
    expect((await fetch(`${w.root}${MULT_STREAK_ROUTE}`)).status).toBe(200);
    expect((await fetch(`${w.root}/mult-streak/`)).status).toBe(200);
  });

  it('mult-streak’s players’ file and the hub’s environment are out of a job’s reach (TeX Live 2026 does not check reads)', async () => {
    const mark = `HUBDATAMARK${Date.now().toString(36)}`;
    w = await Worker.start({ hubEnv: { RESEND_API: `re_${mark}` } });
    // The hub's own file in mult-streak's folder, with a marker; and the server's environment (pid 1).
    w.exec(['sh', '-c', `printf '{"x":"%s"}' "$0" > /app/backend-hub/data/activity.json`, mark]);
    expect(w.exec(['stat', '-c', '%a %U', '/app/backend-hub/data']).trim()).toBe('700 root');
    w.hint(['/app/backend-hub/data/activity.json', '/proc/1/environ', '/app/backend-hub/data']);
    const token = freshToken();
    const j = await w.run(projectZip({ 'main.tex': fixture('lua-read-known.tex') }), 'main.tex', token);
    w.clearHint();
    expect(j.status).toBe('done');
    const results = j.logTail.filter((l) => l.includes('HOSTILE-RESULT')).join('\n');
    expect(results.match(/blocked/g)?.length).toBe(3);
    expect(`${j.logTail.join('\n')}\n${await w.pdfText(j.id, token)}`).not.toContain(mark);
    expect(w.texUserFiles()).toEqual([]);
  });
});

describe.runIf(IN_HUB)('R4b.1-1: the hub runs with NODE_ENV=production, as on the native runtime', () => {
  it('an error reaching Express gives no stack trace, and mult-streak still refuses to start without COOKIE_SECRET', async () => {
    w = await Worker.start();
    expect(w.exec(['sh', '-c', 'tr "\\0" "\\n" < /proc/1/environ | grep "^NODE_ENV="']).trim()).toBe('NODE_ENV=production');
    const r = await fetch(`${w.root}/mult-streak/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    const text = await r.text();
    expect(r.status).toBe(400);
    expect(text).not.toMatch(/SyntaxError|node_modules|\/app\//);
    // The checker's own routes are as before.
    expect((await fetch(`${w.base}/api/health`)).status).toBe(200);
    const name = `tdw-nosecret-${process.pid}`;
    const run = spawnSync('docker', ['run', '--name', name, '-e', 'PORT=4999', IMAGE], { encoding: 'utf8', timeout: 60_000 });
    spawnSync('docker', ['rm', '-f', name]);
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('COOKIE_SECRET must be set in production');
  });
});

describe.runIf(IN_HUB)('R4b.1-4 (a): the memory bomb leaves room for the live hub', () => {
  it('at --memory 512m the bomb fails inside TeX\'s cap, and the container\'s peak leaves the live hub\'s 123 MB beside it', async () => {
    w = await Worker.start({ cpus: '0.5' });
    const id = docker(['inspect', '-f', '{{.Id}}', w.name]).trim();
    const cg = `/sys/fs/cgroup/memory/docker/${id}`;
    const read = (f: string) => (existsSync(`${cg}/${f}`) ? readFileSync(`${cg}/${f}`, 'utf8') : '0');
    const rss = () => Number(/^total_rss (\d+)$/m.exec(read('memory.stat'))?.[1] ?? 0);
    await new Promise((r) => setTimeout(r, 1_000));
    const idle = rss();
    let peak = 0;
    const sampler = setInterval(() => (peak = Math.max(peak, rss())), 50);
    const bomb = await run(w, { 'main.tex': fixture('memory-bomb.tex') });
    clearInterval(sampler);
    const mb = (b: number) => Math.round(b / 1048576);
    console.log(`R4b.1-4a bomb status=${bomb.status} idle_rss_mb=${mb(idle)} peak_rss_mb=${mb(peak)} max_usage_mb=${mb(Number(read('memory.max_usage_in_bytes')))} oom=${read('memory.oom_control').match(/oom_kill (\d+)/)?.[1] ?? '?'}`);
    expect(bomb.status).toBe('failed');
    expect(bomb.logTail.join('\n')).toMatch(/not enough memory/);
    // The sampler read the container's cgroup: on a host without the v1 path both would be 0 (R4b.2-5 a).
    expect(idle).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(idle);
    // With the live hub's own peak in place of the idle one, the container stays under 512 MB.
    expect(mb(peak) - mb(idle) + 123).toBeLessThan(500);
    expect(docker(['inspect', '-f', '{{.State.OOMKilled}} {{.State.Running}} {{.RestartCount}}', w.name]).trim()).toBe('false true 0');
  });
});
