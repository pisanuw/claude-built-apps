/**
 * credits-grant: a HintWise admin adds (or, with a negative number, removes)
 * credits for one account in one app (shared/0008_credits.sql). Pure parts,
 * unit tested; the edge function (supabase/functions/credits-grant) wires them.
 *
 * Request:  POST with Authorization: Bearer <admin's session token> and
 *           { app, email, credits, note? }; credits 0 only reads the balance.
 * Response: 200 { email, balance }, or a JSON error: 401 auth, 403 admin,
 *           400 request or below_zero, 404 not_found, 500 database.
 */

export const MAX_GRANT = 10000;
export const MAX_NOTE = 200;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Grant {
  app: string;
  email: string;
  credits: number;
  note: string | null;
}

export type GrantParse = { ok: true; grant: Grant } | { ok: false; status: number; error: string };

const bad = (error: string): GrantParse => ({ ok: false, status: 400, error });

export function parseGrant(text: string): GrantParse {
  if (text.length > 4096) return { ok: false, status: 413, error: 'The request body is too large.' };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return bad('Send a JSON object: { app, email, credits, note? }.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('Send a JSON object: { app, email, credits, note? }.');
  const b = body as Record<string, unknown>;
  if (typeof b.app !== 'string' || !SLUG.test(b.app)) return bad('"app" must be the app slug, e.g. "photo2pgn".');
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (!EMAIL.test(email) || email.length > 320) return bad('"email" must be the account\'s email address.');
  if (typeof b.credits !== 'number' || !Number.isInteger(b.credits) || Math.abs(b.credits) > MAX_GRANT) {
    return bad(`"credits" must be a whole number from -${MAX_GRANT} to ${MAX_GRANT} (0 reads the balance).`);
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return bad('"note" must be text when given.');
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, MAX_NOTE) : null;
  return { ok: true, grant: { app: b.app, email, credits: b.credits, note } };
}

/** The answer for a database error from platform.credit_grant (codes set in shared/0008). */
export function grantError(err: { code?: string; message?: string } | null): { status: number; body: { error: string; message: string } } {
  if (err?.code === 'P0002') return { status: 404, body: { error: 'not_found', message: err.message || 'No account with that email.' } };
  if (err?.code === 'P0001' && /below zero/.test(err.message ?? '')) {
    return { status: 400, body: { error: 'below_zero', message: 'That would take the balance below 0; nothing changed.' } };
  }
  return { status: 500, body: { error: 'database', message: err?.message || 'The grant failed.' } };
}
