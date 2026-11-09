/**
 * CORS for the gateway: any https://<label>.hintwise.org origin and the Vite
 * dev server on http://localhost:5173. A disallowed origin gets no
 * access-control-allow-origin header, so the browser refuses the response.
 */

export const DEV_ORIGINS: readonly string[] = ['http://localhost:5173'];
const HINTWISE = /^https:\/\/[a-z0-9-]+\.hintwise\.org$/i;

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return HINTWISE.test(origin) || DEV_ORIGINS.includes(origin);
}

export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  if (!isAllowedOrigin(origin)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin as string,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/** The preflight answer: status and headers for the Deno entry to wrap in a Response. */
export function preflight(origin: string | null | undefined): { status: number; headers: Record<string, string> } {
  return { status: isAllowedOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) };
}

/** Headers for a JSON answer: CORS plus content type. */
export function jsonHeaders(origin: string | null | undefined): Record<string, string> {
  return { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' };
}
