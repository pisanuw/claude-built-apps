/**
 * CORS for the platform's edge functions: any https://<label>.hintwise.org
 * origin, and for the gateway also the Vite dev server on
 * http://localhost:5173. A disallowed origin gets no
 * access-control-allow-origin header, so the browser refuses the response.
 *
 * The sign-in-link function passes { dev: false }: its links may only point
 * at https://<label>.hintwise.org pages, so a dev server has no use for it.
 */

export const DEV_ORIGINS: readonly string[] = ['http://localhost:5173'];
const HINTWISE = /^https:\/\/[a-z0-9-]+\.hintwise\.org$/i;

export interface CorsOptions {
  /** Also allow DEV_ORIGINS (default true, as the gateway needs). */
  dev?: boolean;
}

/** One-label https://<label>.hintwise.org origins only. */
export const HINTWISE_ONLY: CorsOptions = { dev: false };

export function isHintwiseOrigin(origin: string | null | undefined): boolean {
  return !!origin && HINTWISE.test(origin);
}

export function isAllowedOrigin(origin: string | null | undefined, opts: CorsOptions = {}): boolean {
  if (!origin) return false;
  return HINTWISE.test(origin) || ((opts.dev ?? true) && DEV_ORIGINS.includes(origin));
}

export function corsHeaders(origin: string | null | undefined, opts: CorsOptions = {}): Record<string, string> {
  if (!isAllowedOrigin(origin, opts)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin as string,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/** The preflight answer: status and headers for the Deno entry to wrap in a Response. */
export function preflight(origin: string | null | undefined, opts: CorsOptions = {}): { status: number; headers: Record<string, string> } {
  return { status: isAllowedOrigin(origin, opts) ? 204 : 403, headers: corsHeaders(origin, opts) };
}

/** Headers for a JSON answer: CORS plus content type. */
export function jsonHeaders(origin: string | null | undefined, opts: CorsOptions = {}): Record<string, string> {
  return { ...corsHeaders(origin, opts), 'content-type': 'application/json; charset=utf-8' };
}
