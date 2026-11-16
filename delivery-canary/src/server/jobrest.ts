/**
 * The scheduled job's database calls (milestone 5). The job has no user
 * token: it calls the job_* security definer functions with the public anon
 * key and proves itself with the job token (secretbox.jobToken), which the
 * functions check against each schedule's tag. Kept secrets come back
 * sealed and are opened in the function.
 */
import type { Baseline } from '../core/types';
import { SCHEMA, type RestConfig } from './supabase-rest';

export interface SealedSeed {
  address: string;
  sender: string;
  subject: string;
  /** Sealed app password, or null when none is kept. */
  secret: string | null;
}

export interface ClaimedSchedule {
  shopId: string;
  userId: string;
  shopName: string;
  baseline: Baseline | null;
  variantId: string | null;
  variantTitle: string;
  alerts: boolean;
  connection: { domain: string; clientId: string; secret: string; canaryEmail: string } | null;
  seed: SealedSeed | null;
}

export interface WaitingCanary {
  canaryId: string;
  shopId: string;
  userId: string;
  placedAt: string;
  orderName: string;
  variantTitle: string;
  shopName: string;
  baseline: Baseline | null;
  alerts: boolean;
  seed: SealedSeed | null;
}

export interface DigestDue {
  shopId: string;
  shopName: string;
  canaries: Array<{ created_at: string; status: string; placement: string | null; transit_seconds: number | null; order_name: string; source: string }>;
  checks: Array<{ created_at: string; verdict: 'pass' | 'warn' | 'fail'; placement: string }>;
}

export type StartResult = { id: string } | { error: 'limited' | 'busy' | 'not-scheduled'; message?: string };
export type Reserve = { sendId: string; email: string; shopName: string } | { skip: string };

export interface CanaryJobPatch {
  status?: 'placed' | 'failed' | 'unknown' | 'arrived' | 'no-email';
  order_id?: string;
  order_name?: string;
  variant_title?: string;
  placed_at?: string;
  arrived_at?: string | null;
  transit_seconds?: number | null;
  placement?: string;
  seed_where?: string;
  error?: string;
}

export interface CheckSave {
  verdict: 'pass' | 'warn' | 'fail';
  placement: string;
  subject: string;
  report: unknown;
}

/** The job_* calls, bound to one job token. */
export interface JobStore {
  claim(): Promise<ClaimedSchedule | null>;
  start(shopId: string, variantId: string, variantTitle: string): Promise<StartResult>;
  update(canaryId: string, patch: CanaryJobPatch, check?: CheckSave | null): Promise<string | null>;
  waiting(): Promise<WaitingCanary[]>;
  outcome(shopId: string, text: string): Promise<void>;
  reserve(shopId: string, kind: 'alert' | 'digest', dedupe: string): Promise<Reserve>;
  done(sendId: string, ok: boolean, detail: string): Promise<void>;
  digestDue(): Promise<DigestDue[]>;
  unsubscribe(shopId: string): Promise<boolean>;
  heartbeat(summary: Record<string, number>): Promise<void>;
  lastRun(): Promise<string | null>;
}

export function jobStore(cfg: RestConfig, token: string): JobStore {
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const res = await (cfg.fetchImpl ?? fetch)(`${cfg.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${cfg.anonKey}`, 'content-profile': SCHEMA, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token, ...args }),
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    claim: () => call<ClaimedSchedule | null>('job_claim', {}),
    start: (shopId, variantId, variantTitle) => call<StartResult>('job_canary_start', { p_shop: shopId, p_variant_id: variantId, p_variant_title: variantTitle }),
    update: (canaryId, patch, check) => call<string | null>('job_canary_update', { p_canary: canaryId, p_patch: patch, p_check: check ?? null }),
    waiting: async () => (await call<WaitingCanary[] | null>('job_waiting', {})) ?? [],
    outcome: async (shopId, text) => {
      await call<boolean>('job_outcome', { p_shop: shopId, p_text: text.slice(0, 300) });
    },
    reserve: (shopId, kind, dedupe) => call<Reserve>('job_mail_reserve', { p_shop: shopId, p_kind: kind, p_dedupe: dedupe }),
    done: async (sendId, ok, detail) => {
      await call<boolean>('job_mail_done', { p_send: sendId, p_ok: ok, p_detail: detail.slice(0, 300) });
    },
    digestDue: async () => (await call<DigestDue[] | null>('job_digest_due', {})) ?? [],
    unsubscribe: (shopId) => call<boolean>('job_unsubscribe', { p_shop: shopId }),
    heartbeat: async (summary) => {
      await call<boolean>('job_heartbeat', { p_summary: summary });
    },
    lastRun: () => call<string | null>('job_last_run', {}),
  };
}
