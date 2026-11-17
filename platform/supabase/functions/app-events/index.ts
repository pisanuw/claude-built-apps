/**
 * First-party analytics for HintWise apps (shared/0014_app_events.sql):
 * https://auth.hintwise.org/functions/v1/app-events. Public (verify_jwt =
 * false in supabase/config.toml): browsers send events with
 * navigator.sendBeacon, no session. Deployed by deploy-function app-events.
 * All logic lives in platform/src/analytics/service.ts (vitest); this file
 * only passes Deno's environment and fetch.
 */
import { handleAppEvents, type AppEventsEnv } from '../../../src/analytics/service.ts';

const env: AppEventsEnv = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
};

Deno.serve((req: Request) => handleAppEvents(req, { env, fetch: (input, init) => fetch(input, init) }));
