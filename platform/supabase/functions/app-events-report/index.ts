/**
 * Totals for the pisan-analytics dashboard (shared/0015_app_events_summary.sql):
 * https://auth.hintwise.org/functions/v1/app-events-report?days=30 with the
 * x-report-secret header. verify_jwt = false (the dashboard has no session);
 * the shared secret APP_EVENTS_REPORT_SECRET is the check. Deployed by
 * deploy-function app-events-report. Logic in platform/src/analytics/report.ts.
 */
import { handleReport, type ReportEnv } from '../../../src/analytics/report.ts';

const env: ReportEnv = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  APP_EVENTS_REPORT_SECRET: Deno.env.get('APP_EVENTS_REPORT_SECRET') ?? '',
};

Deno.serve((req: Request) => handleReport(req, { env, fetch: (input, init) => fetch(input, init) }));
