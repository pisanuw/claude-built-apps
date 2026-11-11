/**
 * HintWise self-service account deletion ("Delete my account"). A signed-in
 * person on a deployed app page sends POST { confirm: "DELETE" } with their
 * session token; the function deletes their rows in platform and every
 * app_% schema and then their sign-in, unless another app on the shared
 * project still uses it (docs/platform.md, "Account deletion";
 * 0004_account_deletion.sql). verify_jwt = false in supabase/config.toml:
 * the function checks the token itself (GET /auth/v1/user) and also answers
 * the CORS preflight, which carries no token. Deployed by deploy-function
 * delete-account. All logic lives in platform/src/account/delete-service.ts
 * (vitest); this file only passes Deno's environment and fetch.
 */
import { handleDeleteAccount, type DeleteEnv } from '../../../src/account/delete-service.ts';

const env: DeleteEnv = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
};

Deno.serve((req: Request) => handleDeleteAccount(req, { env, fetch: (input, init) => fetch(input, init) }));
