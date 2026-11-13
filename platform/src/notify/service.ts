/**
 * The app-notify function (supabase/functions/app-notify): one run per
 * call, meant for a daily schedule. Contract in src/notify/README.md.
 *
 *   POST, header x-app-notify-secret: <APP_NOTIFY_SECRET>
 *   body (optional JSON): { "app": "<slug>", "dryRun": true }
 *   200 { ok, dryRun, day, sent, failed, stopped, apps: [...] }   (no addresses)
 *   401 wrong or missing secret; 405 not POST; 400 bad body;
 *   503 APP_NOTIFY_SECRET, the database settings or RESEND_API unset.
 *
 * Authentication is a shared secret, not the platform's JWT check
 * (verify_jwt = false in supabase/config.toml): the anon key is public, so
 * a JWT check alone would let anyone start a run, and asking for the
 * service-role key would put the project's strongest key in the scheduler.
 * The secret is compared in constant time and must be at least 32
 * characters; without it the function refuses every call.
 */
import { restDb, type Db } from '../signin/db.ts';
import { sendEmail, type EmailMessage, type SendResult } from '../signin/resend.ts';
import { errorText, readBody, sameText } from '../signin/util.ts';
import { runNotify, type NotifyEnv, type RunDeps } from './run.ts';

export interface AppNotifyEnv extends NotifyEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API?: string;
  /** The shared secret the scheduler sends in x-app-notify-secret. */
  APP_NOTIFY_SECRET?: string;
}

export interface AppNotifyDeps {
  env: AppNotifyEnv;
  fetch: typeof fetch;
  db?: Db;
  send?: (msg: EmailMessage) => Promise<SendResult>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  limits?: RunDeps['limits'];
}

export const SECRET_HEADER = 'x-app-notify-secret';
export const MIN_SECRET_CHARS = 32;
const MAX_BODY = 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleAppNotify(req: Request, deps: AppNotifyDeps): Promise<Response> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  const env = deps.env;
  if (req.method !== 'POST') return new Response('Use POST.', { status: 405, headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' } });
  const secret = env.APP_NOTIFY_SECRET ?? '';
  if (secret.length < MIN_SECRET_CHARS) {
    log('app-notify: APP_NOTIFY_SECRET is unset or shorter than 32 characters');
    return json(503, { ok: false, error: 'app-notify is not configured.' });
  }
  if (!sameText(req.headers.get(SECRET_HEADER) ?? '', secret)) return json(401, { ok: false, error: `Send ${SECRET_HEADER}.` });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API) {
    log('app-notify: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or RESEND_API unset');
    return json(503, { ok: false, error: 'app-notify is not configured.' });
  }
  const text = await readBody(req, MAX_BODY);
  if (text === null) return json(400, { ok: false, error: 'Body too large.' });
  let body: { app?: unknown; dryRun?: unknown } = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return json(400, { ok: false, error: 'Send JSON { app?, dryRun? } or nothing.' });
    }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json(400, { ok: false, error: 'Send JSON { app?, dryRun? } or nothing.' });
  if (body.app !== undefined && (typeof body.app !== 'string' || !SLUG.test(body.app))) return json(400, { ok: false, error: 'app must be an app slug.' });
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return json(400, { ok: false, error: 'dryRun must be true or false.' });
  const resendKey = env.RESEND_API;
  try {
    const report = await runNotify(
      {
        db: deps.db ?? restDb(deps.fetch, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
        fetch: deps.fetch,
        send: deps.send ?? ((msg) => sendEmail(deps.fetch, resendKey, msg)),
        env,
        now: deps.now,
        sleep: deps.sleep,
        log,
        limits: deps.limits,
      },
      { app: body.app as string | undefined, dryRun: body.dryRun === true },
    );
    return json(report.error ? 500 : 200, report);
  } catch (e) {
    log(`app-notify failed: ${errorText(e)}`);
    return json(500, { ok: false, error: 'The run failed.' });
  }
}
