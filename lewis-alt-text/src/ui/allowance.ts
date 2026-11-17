/**
 * What is left of the HintWise key's allowance before a call (the gateway's
 * free check mode), and plain-words messages for a reached cap
 * (docs/new-app-guide.md, "What the app shows on a 429").
 */
import { capMessage, formatReset } from '../core/caps';
import { GATEWAY_APP } from '../lib/llm';

export { capMessage, formatReset };

export interface Allowance {
  allowed: boolean;
  scope?: string | null;
  resetsAt?: string | null;
  callsLeft: number | null;
}

export interface CheckDeps {
  url: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

/** Null when not signed in or when the check itself fails (the call will say why). */
export async function checkAllowance(deps: CheckDeps): Promise<Allowance | null> {
  const token = await deps.getToken();
  if (!token) return null;
  try {
    const res = await (deps.fetch ?? fetch)(deps.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ app: GATEWAY_APP, check: true }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { allowed?: unknown; scope?: unknown; resets_at?: unknown; calls_left?: unknown };
    return {
      allowed: d.allowed === true,
      scope: typeof d.scope === 'string' ? d.scope : null,
      resetsAt: typeof d.resets_at === 'string' ? d.resets_at : null,
      callsLeft: typeof d.calls_left === 'number' ? d.calls_left : null,
    };
  } catch {
    return null;
  }
}

export function allowanceText(a: Allowance | null, format: (iso: string) => string = formatReset): string {
  if (!a) return '';
  if (!a.allowed) return a.scope ? capMessage(a.scope, a.resetsAt, format) : 'The HintWise key is not available right now.';
  if (a.callsLeft === null) return '';
  return `${a.callsLeft} alt text${a.callsLeft === 1 ? '' : 's'} left on the HintWise key.`;
}
