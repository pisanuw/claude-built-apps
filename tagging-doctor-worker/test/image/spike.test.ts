/**
 * AC-65 through the real worker: the math-notes job (every LuaLaTeX run plus
 * veraPDF) on the image at --cpus 0.1 --memory 512m, then at --cpus 0.5,
 * with the server's own setup (TeX user, flags, limits, caches). Peak memory
 * is the container's: cgroup v1 max usage (page cache included) and the
 * highest anonymous memory sampled every 100 ms, the server's own included.
 * Prints the numbers; go needs under 90 s and under about 450 MB at 0.1 CPU.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { docker, FIXTURES, folderZip, freshToken, Worker } from './harness.ts';

const MATH_NOTES = folderZip(path.join(FIXTURES, 'math-notes'));
let w: Worker | null = null;
afterEach(async () => {
  await w?.stop();
  w = null;
});

async function measure(cpus: string, zip = MATH_NOTES) {
  w = await Worker.start({ cpus });
  const id = docker(['inspect', '-f', '{{.Id}}', w.name]).trim();
  const cg = `/sys/fs/cgroup/memory/docker/${id}`;
  const read = (f: string) => (existsSync(`${cg}/${f}`) ? readFileSync(`${cg}/${f}`, 'utf8') : '0');
  docker(['exec', w.name, 'sh', '-c', `echo 0 > /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null || true`]);
  let peakRss = 0;
  const sampler = setInterval(() => {
    const rss = Number(/^total_rss (\d+)$/m.exec(read('memory.stat'))?.[1] ?? 0);
    peakRss = Math.max(peakRss, rss);
  }, 100);
  const t0 = Date.now();
  const token = freshToken();
  const job = await w.run(zip, 'main.tex', token);
  const wall = (Date.now() - t0) / 1000;
  clearInterval(sampler);
  const maxUsage = Number(read('memory.max_usage_in_bytes'));
  const jobSeconds = (Date.parse(job.finishedAt as string) - Date.parse(job.startedAt as string)) / 1000;
  const mb = (b: number) => Math.round(b / 1048576);
  const line = `SPIKE cpus=${cpus} status=${job.status} job_s=${jobSeconds.toFixed(1)} request_to_result_s=${wall.toFixed(1)} runs=${job.result?.runs} pages=${job.result?.pages} peak_rss_mb=${mb(peakRss)} max_usage_incl_cache_mb=${mb(maxUsage)} oom=${docker(['inspect', '-f', '{{.State.OOMKilled}}', w.name]).trim()}`;
  console.log(line);
  return { job, jobSeconds, peakRssMb: mb(peakRss), maxUsageMb: mb(maxUsage) };
}

describe('AC-65: the spike through the worker', () => {
  it('math-notes at 0.1 CPU and 512 MB: within 90 seconds and about 450 MB', async () => {
    const r = await measure('0.1');
    expect(r.job.status).toBe('done');
    expect(r.jobSeconds).toBeLessThan(90);
    expect(r.peakRssMb).toBeLessThan(450);
  });

  it('math-notes at 0.5 CPU and 512 MB', async () => {
    const r = await measure('0.5');
    expect(r.job.status).toBe('done');
  });
});
