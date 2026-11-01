import type { Exercise } from './grade';
import type { TargetSpec } from './target';

/** Everything needed to reproduce a session in a link. */
export interface Workspace {
  code: string;
  args: unknown[];
  target: TargetSpec;
  bits: number;
  draws: number;
  /** Present when the link is an exercise. */
  exercise?: Exercise;
}

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeWorkspace(w: Workspace): string {
  return toBase64Url(JSON.stringify(w));
}

function isTarget(t: unknown): t is TargetSpec {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (o.kind === 'uniform-int' || o.kind === 'permutations') return typeof o.n === 'number';
  return (
    o.kind === 'weights' &&
    Array.isArray(o.entries) &&
    o.entries.every((e) => Array.isArray(e) && e.length === 2 && e.every((x) => typeof x === 'string'))
  );
}

/** Parses a link payload, returning null for anything malformed rather than throwing. */
export function decodeWorkspace(s: string): Workspace | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(s));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.code !== 'string' || !Array.isArray(o.args) || !isTarget(o.target)) return null;
  if (typeof o.bits !== 'number' || typeof o.draws !== 'number') return null;
  const w: Workspace = { code: o.code, args: o.args, target: o.target, bits: o.bits, draws: o.draws };
  if (o.exercise !== undefined) {
    const e = o.exercise as Record<string, unknown>;
    if (
      !e ||
      typeof e.title !== 'string' ||
      typeof e.prompt !== 'string' ||
      !Array.isArray(e.args) ||
      !isTarget(e.target) ||
      typeof e.alpha !== 'number' ||
      typeof e.bits !== 'number' ||
      typeof e.draws !== 'number' ||
      typeof e.allowBelow !== 'boolean' ||
      typeof e.starter !== 'string'
    ) {
      return null;
    }
    w.exercise = e as unknown as Exercise;
  }
  return w;
}
