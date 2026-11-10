/**
 * HintWise sign-in links: a Supabase Edge Function (Deno) that apps call
 * instead of supabase.auth.signInWithOtp. It applies the per-address and
 * per-browser wait ladder, the per-IP allowance and the Turnstile challenge,
 * creates the link with Auth's admin API, emails it through Resend, logs
 * the request in platform.sign_in_requests and alerts the owner
 * (docs/platform.md, "Sign-in links and abuse limits"; contract in
 * platform/src/signin/README.md). Deployed by the "Supabase admin" workflow
 * (deploy-function sign-in-link); public (verify_jwt = false in
 * supabase/config.toml). All logic lives in platform/src/signin/ (vitest);
 * this file only passes Deno's environment, fetch and waitUntil.
 *
 * Request:  POST JSON { email, redirectTo, app, browserId, turnstileToken? }
 * Response: 200 {status:'sent'} | 429 {status:'wait', retryAt}
 *           | 403 {status:'challenge', siteKey, failed?} | 4xx/5xx {status:'error', message}
 */
import { handleSignInLink, type SignInEnv } from '../../../src/signin/service.ts';

const NAMES: Array<keyof SignInEnv> = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SIGN_IN_HASH_KEY',
  'RESEND_API',
  'ADMIN_EMAIL',
  'TURNSTILE_SECRET',
  'TURNSTILE_SITE_KEY',
];
const env: SignInEnv = Object.fromEntries(NAMES.map((n) => [n, Deno.env.get(n) ?? '']));

// Supabase's runtime keeps the worker alive for promises passed to waitUntil.
const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;

Deno.serve((req: Request) =>
  handleSignInLink(req, {
    env,
    fetch: (input, init) => fetch(input, init),
    background: (task) => runtime?.waitUntil(task),
  }),
);
