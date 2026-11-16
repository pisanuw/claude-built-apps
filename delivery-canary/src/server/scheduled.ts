/**
 * Netlify Scheduled Function entry (bundled by scripts/build-function.mjs
 * into netlify/functions/canary-run/, whose wrapper declares the schedule:
 * every JOB_EVERY_MIN minutes). Reads DELIVERY_CANARY_KEY and RESEND_API
 * from the function's environment at run time (never bundled); without the
 * key it does nothing, without RESEND_API it runs canaries but sends no
 * email. The Supabase URL and anon key are public and baked in.
 */
import { fetchFile } from './fetchfile';
import { runJob, type JobDeps, type JobSummary } from './job';
import { jobStore } from './jobrest';
import { sendResend } from './mail';
import { jobToken, keyFrom } from './secretbox';
import { seedCheckLive } from './seed';
import type { RestConfig } from './supabase-rest';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export function jobDeps(cfg: RestConfig, env: Record<string, string | undefined>, log: (m: string) => void): JobDeps | null {
  const key = keyFrom(env.DELIVERY_CANARY_KEY);
  if (!key || !cfg.url || !cfg.anonKey) return null;
  const resend = (env.RESEND_API ?? '').trim();
  return {
    key,
    store: jobStore(cfg, jobToken(key)),
    seedCheck: (q, budgetMs) => seedCheckLive(q, budgetMs),
    fetchFile: (u, budgetMs) => fetchFile(u, { budgetMs }),
    send: resend ? (m, timeoutMs) => sendResend(resend, m, cfg.fetchImpl ?? fetch, timeoutMs) : null,
    log,
  };
}

export async function scheduledRun(cfg: RestConfig, env: Record<string, string | undefined>, log: (m: string) => void = console.log): Promise<JobSummary | null> {
  const deps = jobDeps(cfg, env, log);
  if (!deps) {
    log('canary-run: DELIVERY_CANARY_KEY or the Supabase config is missing; nothing to do.');
    return null;
  }
  const summary = await runJob(deps);
  log(`canary-run: ${JSON.stringify(summary)}${deps.send ? '' : ' (RESEND_API not set: no email sent)'}`);
  return summary;
}

/* v8 ignore start -- wiring only; the build defines both constants */
export default async function run(): Promise<Response> {
  const cfg: RestConfig = { url: typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : '', anonKey: typeof __SUPABASE_ANON_KEY__ === 'string' ? __SUPABASE_ANON_KEY__ : '' };
  const summary = await scheduledRun(cfg, process.env);
  return new Response(JSON.stringify(summary ?? { off: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}
/* v8 ignore stop */
