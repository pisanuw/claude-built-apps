/**
 * AC-23: at start the mount takes the hub's lock and captures a bundled
 * one-page file (static/selftest.pdf, a heading "Heard-As self-test" and a
 * paragraph, from the app's fixture generator). Only when the heard tree
 * names that heading, and Chromium ran under its sandbox (a seccomp filter on
 * every Chromium process, AC-14), does health say `capture: true`; until then,
 * and when it fails, jobs are refused with "The checker is not available."
 * A sandbox Chromium refuses to start (Render's answer, question 2) shows as
 * the reason `no-sandbox`.
 */
import { copyFileSync } from 'node:fs';
import type { Jobs } from './jobs.ts';
import type { RunOutcome } from './runner.ts';
import type { HeavyLock, SelfTestView } from './server.ts';

export const SELF_TEST_HEADING = 'Heard-As self-test';

/** Judges a self-test capture. Pure. */
export function judge(out: RunOutcome): Pick<SelfTestView, 'ok' | 'reason' | 'sandbox'> {
  const d = (out.summary.driver ?? {}) as { headings?: string[]; heading?: boolean; sandbox?: { processes: number; seccomp: number; namespaced: number } };
  const sandbox = d.sandbox ?? null;
  if (!out.ok) return { ok: false, reason: out.reason, sandbox };
  // Chromium's namespace sandbox: its renderer runs in a PID namespace of its own (D-38).
  if (!sandbox || sandbox.processes === 0 || !(sandbox.namespaced > 0)) return { ok: false, reason: 'no-sandbox', sandbox };
  if (!d.heading) return { ok: false, reason: 'no-heading', sandbox };
  return { ok: true, reason: 'ok', sandbox };
}

export interface SelfTestDeps {
  heavy: HeavyLock;
  jobs: Jobs;
  file: string;
  attempts?: number;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Runs the self-test once, as a job of the owner "self-test" under the lock. */
export async function runSelfTest(d: SelfTestDeps): Promise<SelfTestView> {
  const now = d.now ?? Date.now;
  const pause = d.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = now();
  const attempts = d.attempts ?? 12;
  for (let i = 0; i < attempts; i++) {
    const got = await d.heavy.acquire('self-test');
    if (got.ok) {
      const upload = d.jobs.uploadPath();
      try {
        copyFileSync(d.file, upload);
      } catch {
        got.release();
        return { ok: false, reason: 'internal', checkedAt: new Date(now()).toISOString(), ms: now() - t0, sandbox: null };
      }
      const job = d.jobs.start('self-test', upload, got.release, { verapdf: false, expect: SELF_TEST_HEADING });
      await d.jobs.idle();
      const out: RunOutcome =
        job.status === 'done' && job.result
          ? { ok: true, output: job.result, summary: job.summary as NonNullable<typeof job.summary> }
          : { ok: false, reason: job.failure?.reason ?? 'internal', message: job.failure?.message ?? '', summary: job.summary ?? { ms: 0, peakJobBytes: 0, peakContainerBytes: 0, monitorMaxGapMs: 0, monitorSamples: 0, driver: null } };
      d.jobs.remove('self-test', job.id);
      return { ...judge(out), checkedAt: new Date(now()).toISOString(), ms: now() - t0 };
    }
    // Something heavy runs (a restart in the middle of nothing should never see this): wait and try again.
    await pause(5_000);
  }
  return { ok: false, reason: 'lock', checkedAt: new Date(now()).toISOString(), ms: now() - t0, sandbox: null };
}
