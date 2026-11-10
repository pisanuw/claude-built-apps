/**
 * HintWise Send Email Hook: once switched on in Supabase Auth (the
 * "Supabase admin" workflow's email-hook on, with the owner's yes), Auth
 * hands every auth email to this function instead of sending it. Only
 * magic links, sign-ups, sign-in codes and password recovery for the apps
 * outside HintWise (HOOK_EXTERNAL_HOSTS) go out, through Resend and the same
 * per-address ladder as sign-in-link; everything else is refused with "Use
 * the HintWise sign-in-link service", logged as 'refused' in
 * platform.sign_in_requests and reported to the owner.
 * Deployed by deploy-function auth-email-hook; verify_jwt = false (Auth signs
 * the call with Standard Webhooks, secret SEND_EMAIL_HOOK_SECRET, checked in
 * platform/src/signin/hook.ts). This file only passes Deno's environment.
 */
import { handleEmailHook, type HookEnv } from '../../../src/signin/hook-service.ts';

const NAMES: Array<keyof HookEnv> = ['SEND_EMAIL_HOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIGN_IN_HASH_KEY', 'RESEND_API', 'ADMIN_EMAIL', 'HOOK_EXTERNAL_HOSTS'];
const env: HookEnv = Object.fromEntries(NAMES.map((n) => [n, Deno.env.get(n) ?? '']));

const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;

Deno.serve((req: Request) =>
  handleEmailHook(req, {
    env,
    fetch: (input, init) => fetch(input, init),
    background: (task) => runtime?.waitUntil(task),
  }),
);
