/**
 * HintWise app-notify: once a day, emails each person who opted in to an
 * app's "tell me what is new" the items of the app's public releases feed
 * they have not been sent yet (docs/platform.md, "App-notify"; contract in
 * platform/src/notify/README.md). NOT DEPLOYED YET: waits for the owner's
 * yes, after apply-shared (0011_app_notify.sql).
 *
 * Called by the daily schedule with POST and the header
 * x-app-notify-secret: <APP_NOTIFY_SECRET> (verify_jwt = false in
 * supabase/config.toml; the shared secret is the check, see
 * src/notify/service.ts). All logic lives in platform/src/notify/ (vitest);
 * this file only passes Deno's environment and fetch.
 */
import { handleAppNotify, type AppNotifyEnv } from '../../../src/notify/service.ts';

const NAMES: Array<keyof AppNotifyEnv> = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SIGN_IN_HASH_KEY',
  'RESEND_API',
  'EMAIL_OPTOUT_SECRET',
  'EMAIL_LOGO_URL',
  'APP_NOTIFY_SECRET',
];
const env: AppNotifyEnv = Object.fromEntries(NAMES.map((n) => [n, Deno.env.get(n) ?? '']));

Deno.serve((req: Request) => handleAppNotify(req, { env, fetch: (input, init) => fetch(input, init) }));
