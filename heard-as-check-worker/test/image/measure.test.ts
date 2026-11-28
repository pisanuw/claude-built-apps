/**
 * AC-1's measurements again, on the mount itself in the hub's real image
 * (acceptance/m1.md: "M2's image tests on the real image are the numbers that
 * count"), and the output cap measured on a many-glyphs file just under it
 * (S3-1, question 7; D-36). Each run starts a fresh container on a cold page
 * cache. The job's non-file memory is read from the host (Pss_Anon +
 * Pss_Shmem, same instant), the monitor's own measure from its log line, and
 * the container's non-reclaimable memory from its cgroup. MEASURE_OUT names a
 * file for the numbers (DECISIONS.md D-42).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { writePdf, manyGlyphsDoc } from '../../../heard-as-check/test/fixtures/generate.ts';
import { fixture, freshToken, Hub, hostJobMemory, MB, sampler } from './harness.ts';

const rows: Record<string, unknown>[] = [];
afterAll(() => {
  if (process.env.MEASURE_OUT) writeFileSync(process.env.MEASURE_OUT, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows));
});

async function measure(hub: Hub, name: string, pdf: Buffer, opts: { keepResult?: boolean } = {}) {
  const job = sampler(() => hostJobMemory().nonFile);
  const fallback = sampler(() => hostJobMemory().fallback);
  const container = sampler(() => hub.containerMemory());
  const token = freshToken();
  const t0 = Date.now();
  const sub = await hub.submit(pdf, token);
  if (sub.status !== 202) throw new Error(`${name}: ${sub.status} ${await sub.text()}`);
  const { id } = (await sub.json()) as { id: string };
  const j = await hub.waitFor(id, token, 200_000);
  const wallMs = Date.now() - t0;
  const nf = job.stop();
  const fb = fallback.stop();
  const c = container.stop();
  const finished = hub.events('job-finished').at(-1) as { jobMB?: number; containerMB?: number; gapMs?: number; bytes?: number; ms?: number };
  let bytes: number | null = null;
  let verapdf: unknown = null;
  if (j.status === 'done' && !opts.keepResult) {
    const r = await hub.result(id, token);
    bytes = Buffer.byteLength(JSON.stringify(r));
    verapdf = r.verapdf?.compliant ?? null;
  }
  const row = {
    name,
    status: j.status,
    failure: j.failure?.reason ?? null,
    wallMs,
    jobMs: finished?.ms,
    outputBytes: finished?.bytes ?? bytes,
    verapdfCompliant: verapdf,
    nonFilePssMB: +(nf.peak / MB).toFixed(1),
    hostFallbackMB: +(fb.peak / MB).toFixed(1),
    monitorJobMB: finished?.jobMB,
    monitorContainerMB: finished?.containerMB,
    monitorMaxGapMs: finished?.gapMs,
    containerNonReclaimableMB: +(c.peak / MB).toFixed(1),
    hostSamplerMaxGapMs: Math.max(nf.maxGap, c.maxGap),
  };
  rows.push(row);
  return { row, id, token };
}

describe('AC-1 on the mount, in the real image, cold page cache', () => {
  it('five-pages, stress, big-tree, big-tree with one result held, five-pages', async () => {
    const hub = await Hub.start({ coldCache: true });
    try {
      const a = await measure(hub, 'five-pages', fixture('five-pages'));
      const b = await measure(hub, 'stress', fixture('stress'));
      const c = await measure(hub, 'big-tree', fixture('big-tree'), { keepResult: true });
      const d = await measure(hub, 'big-tree, one result held', fixture('big-tree'));
      await hub.result(c.id, c.token);
      const e = await measure(hub, 'five-pages again', fixture('five-pages'));
      for (const r of [a, b, c, d, e]) {
        expect(r.row.status, r.row.name).toBe('done');
        expect(r.row.containerNonReclaimableMB, r.row.name).toBeLessThan(450);
        // A file within the limits is never killed: the monitor's measure stays under its 300 MB threshold.
        expect(r.row.monitorJobMB ?? 0, r.row.name).toBeLessThan(300);
      }
      expect(a.row.wallMs).toBeLessThan(30_000);
      expect(b.row.wallMs).toBeLessThan(90_000);
    } finally {
      await hub.stop();
    }
  });
});

describe('the output cap (S3-1, D-36)', () => {
  it('a many-glyphs file just under 20 MB of output is read, within the memory limits', async () => {
    const hub = await Hub.start({ coldCache: true });
    try {
      // 22 pages of 18,000 one-glyph strings: about 19 MB of show-text records.
      const pdf = writePdf(manyGlyphsDoc(22, 18_000));
      const r = await measure(hub, 'many-glyphs, 22 pages (under the cap)', pdf);
      expect(r.row.status).toBe('done');
      expect(r.row.outputBytes as number).toBeGreaterThan(15 * MB);
      expect(r.row.outputBytes as number).toBeLessThanOrEqual(20 * MB + 256 * 1024);
      expect(r.row.containerNonReclaimableMB).toBeLessThan(450);
      expect(r.row.monitorJobMB ?? 0).toBeLessThan(300);
    } finally {
      await hub.stop();
    }
  });
});
