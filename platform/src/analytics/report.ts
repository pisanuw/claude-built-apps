/**
 * The app-events-report function (supabase/functions/app-events-report): the
 * pisan-analytics dashboard (pisanuw/dashboards) reads the totals of
 * platform.app_events_summary (shared/0015) here. Public URL, so the caller
 * must send the shared secret APP_EVENTS_REPORT_SECRET in x-report-secret;
 * without the function secret set, every call is 503. Only aggregates leave:
 * no event rows, visitor ids or user ids.
 *
 *   GET ?days=30   (1-400; default 30)
 */
import { restDb, type Db } from '../signin/db.ts';
import { errorText, sameText } from '../signin/util.ts';

export interface ReportEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_EVENTS_REPORT_SECRET: string;
}

export interface ReportDeps {
  env: ReportEnv;
  fetch: typeof fetch;
  db?: Db;
  log?: (message: string) => void;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Days from the query: an integer from 1 to 400, else 30. */
export function reportDays(url: string): number {
  const raw = new URL(url).searchParams.get('days');
  const n = raw !== null && /^\d{1,3}$/.test(raw) ? Number(raw) : 30;
  return Math.min(Math.max(n, 1), 400);
}

export async function handleReport(req: Request, deps: ReportDeps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  const secret = deps.env.APP_EVENTS_REPORT_SECRET;
  if (!secret || secret.length < 32) return json(503, { error: 'not-configured' });
  const given = req.headers.get('x-report-secret') ?? '';
  if (!sameText(given, secret)) return json(401, { error: 'auth' });
  const db = deps.db ?? restDb(deps.fetch, deps.env.SUPABASE_URL, deps.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    return json(200, await db.rpc('app_events_summary', { p_days: reportDays(req.url) }));
  } catch (e) {
    (deps.log ?? console.error)(`app-events-report: ${errorText(e)}`);
    return json(500, { error: 'database' });
  }
}
