/**
 * The app-events function (supabase/functions/app-events): browsers of the
 * apps in platform.analytics_apps send first-party analytics here with
 * navigator.sendBeacon. Public (verify_jwt = false): it checks the body
 * (events.ts), drops bots, and calls platform.app_events_record with the
 * Origin, the client IP's network (IPv6 by /64) and the user agent; the
 * database checks the origin and owns the daily salt the visitor id is hashed
 * with. The IP and user agent are never stored.
 *
 * Always 204 for a well-formed request (a beacon cannot read the answer, and
 * a refusal should not tell a scraper which apps exist); 400 for a body that
 * is not a batch, 413 for one too large, 405 for other methods.
 */
import { restDb, type Db } from '../signin/db.ts';
import { clientIp, ipKey } from '../signin/keys.ts';
import { errorText, readBody } from '../signin/util.ts';
import { deviceOf, isBot, MAX_BODY_BYTES, parseBatch } from './events.ts';

export interface AppEventsEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface AppEventsDeps {
  env: AppEventsEnv;
  fetch: typeof fetch;
  db?: Db;
  log?: (message: string) => void;
}

/** Lets the page's fetch read the answer when it wants to; a beacon never does. */
function cors(origin: string | null): Record<string, string> {
  return origin && /^https:\/\//.test(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' }
    : { vary: 'Origin' };
}

export async function handleAppEvents(req: Request, deps: AppEventsDeps): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });
  const text = await readBody(req, MAX_BODY_BYTES);
  if (text === null) return new Response(null, { status: 413, headers });
  const batch = parseBatch(text);
  if (!batch) return new Response(null, { status: 400, headers });
  const ua = req.headers.get('user-agent');
  if (!origin || isBot(ua) || batch.events.length === 0) return new Response(null, { status: 204, headers });
  const db = deps.db ?? restDb(deps.fetch, deps.env.SUPABASE_URL, deps.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const stored = await db.rpc<number>('app_events_record', {
      p_app: batch.app,
      p_origin: origin,
      p_ip: ipKey(clientIp(req.headers)),
      p_ua: ua,
      p_device: deviceOf(ua),
      p_events: batch.events,
    });
    if (typeof stored === 'number' && stored < 0) (deps.log ?? console.warn)(`app-events: refused ${batch.app} from ${origin} (${stored})`);
  } catch (e) {
    (deps.log ?? console.error)(`app-events: ${errorText(e)}`);
  }
  return new Response(null, { status: 204, headers });
}
