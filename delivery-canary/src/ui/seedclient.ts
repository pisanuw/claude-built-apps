/**
 * The browser side of the seed inbox check: one POST to /api/seed-check with
 * the signed-in user's token. The app password goes to our server over
 * HTTPS only when the shop owner types it, and is never sent back.
 */
import { SEED_WHERES as WHERES, type SeedWhere } from '../core/seedwhere';
import type { Placement } from '../core/types';
const PLACEMENTS: Placement[] = ['inbox', 'promotions', 'spam', 'other', 'unknown'];

export interface SeedRequest {
  shopId: string;
  address: string;
  sender: string;
  subject: string;
  /** '' to use the password kept for this shop. */
  password: string;
  remember: boolean;
}

export interface SeedFoundResponse {
  found: true;
  where: SeedWhere;
  placement: Placement;
  receivedAt: string;
  labels: string[];
  truncated: boolean;
  /** The message bytes. */
  raw: ArrayBuffer;
  kept: boolean;
  saved: boolean;
}

export interface SeedNotFoundResponse {
  found: false;
  kept: boolean;
  saved: boolean;
}

export type SeedResponse = SeedFoundResponse | SeedNotFoundResponse;

/** The check did not finish; `outcome` says why ('no-password', 'login-failed', ...). */
export class SeedCheckFailed extends Error {
  constructor(
    message: string,
    readonly outcome: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SeedClientDeps {
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Validates the server's answer into a SeedResponse (anything malformed is a failure, never a pass). */
export function parseSeedResponse(data: unknown): SeedResponse {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const kept = d.kept === true;
  const saved = d.saved !== false;
  if (d.found === false) return { found: false, kept, saved };
  if (d.found !== true || typeof d.raw !== 'string' || !WHERES.includes(d.where as SeedWhere)) throw new SeedCheckFailed('The seed inbox check sent back an answer this page cannot read.', 'protocol', 200);
  let raw: ArrayBuffer;
  try {
    raw = fromBase64(d.raw);
  } catch {
    throw new SeedCheckFailed('The seed inbox check sent back an answer this page cannot read.', 'protocol', 200);
  }
  return {
    found: true,
    where: d.where as SeedWhere,
    placement: PLACEMENTS.includes(d.placement as Placement) ? (d.placement as Placement) : 'unknown',
    receivedAt: typeof d.receivedAt === 'string' ? d.receivedAt : '',
    labels: Array.isArray(d.labels) ? d.labels.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
    truncated: d.truncated === true,
    raw,
    kept,
    saved,
  };
}

export async function checkSeedInbox(req: SeedRequest, token: string, deps: SeedClientDeps = {}): Promise<SeedResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${deps.apiBase ?? ''}/api/seed-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
  } catch {
    throw new SeedCheckFailed('Could not reach the seed inbox check. Check your connection and try again.', 'offline', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: unknown; outcome?: unknown };
    const msg = typeof d.error === 'string' ? d.error.slice(0, 400) : `The seed inbox check answered ${res.status}.`;
    throw new SeedCheckFailed(msg, typeof d.outcome === 'string' ? d.outcome : String(res.status), res.status);
  }
  return parseSeedResponse(data);
}

/** Whether the server can keep app passwords (DELIVERY_CANARY_KEY is set); false when unknown. */
export async function seedKeepAvailable(deps: SeedClientDeps = {}): Promise<boolean> {
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${deps.apiBase ?? ''}/api/health`, { cache: 'no-store' });
    if (!res.ok) return false;
    const d = (await res.json()) as { seedKeep?: unknown };
    return d.seedKeep === true;
  } catch {
    return false;
  }
}
