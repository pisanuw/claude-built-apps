/**
 * HintWise email opt-out: the page behind every email footer's "Stop all
 * email from HintWise" link, and the support commands of the "Supabase
 * admin" workflow (email-optout status|remove). Public (verify_jwt = false
 * in supabase/config.toml): a GET only shows a question, a form POST with a
 * signed token stops or restores email for that token's address, and a
 * support command needs the service-role key. Links point at
 * https://auth.hintwise.org/functions/v1/email-optout, the custom domain,
 * where Supabase serves text/html (on *.supabase.co a GET's HTML becomes
 * text/plain). Deployed by deploy-function email-optout. All logic lives in
 * platform/src/signin/optout-service.ts (vitest); this file only passes
 * Deno's environment and fetch.
 */
import { handleOptOut, type OptOutEnv } from '../../../src/signin/optout-service.ts';

const NAMES: Array<keyof OptOutEnv> = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIGN_IN_HASH_KEY', 'EMAIL_OPTOUT_SECRET'];
const env: OptOutEnv = Object.fromEntries(NAMES.map((n) => [n, Deno.env.get(n) ?? '']));

Deno.serve((req: Request) => handleOptOut(req, { env, fetch: (input, init) => fetch(input, init) }));
