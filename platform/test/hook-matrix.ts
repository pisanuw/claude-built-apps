/**
 * Every Send Email hook action type (Supabase's list, 22 Nov 2026), for an
 * app outside HintWise, a HintWise app and no app at all: the payloads
 * behind fixtures/hook-plans-main.json and the "Auth's code never shows"
 * test. The token and token_new are Auth's own codes (10 digits, as
 * mailer_otp_length will be), distinct from every other value here.
 */
import { createHash } from 'node:crypto';
import type { HookPayload, HookPlan } from '../src/signin/hook.ts';

export const AUTH_CODE = '8302917465';
export const AUTH_CODE_NEW = '5937106284';
export const MATRIX_AUTH_BASE = 'https://ref.supabase.co';
export const MATRIX_EXTERNAL_HOSTS: readonly string[] = ['how-of-happiness.netlify.app', 'wcv-live-together.netlify.app'];
export const MATRIX_LOOK = {
  optOutUrl: 'https://auth.hintwise.org/functions/v1/email-optout?t=v1.abc.sig',
  logoUrl: 'https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png',
};
/** Supabase's email_action_type list (send-email-hook docs), plus a notice type it may add later. */
export const HOOK_ACTION_TYPES: readonly string[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
  'reauthentication',
  'password_changed_notification',
  'email_changed_notification',
  'phone_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'mfa_factor_enrolled_notification',
  'mfa_factor_unenrolled_notification',
  'some_new_notification',
];
/** redirect_to of each site; "none" has only Auth's own address as site_url. */
export const MATRIX_SITES: Readonly<Record<string, string>> = {
  external: 'https://how-of-happiness.netlify.app/welcome',
  hintwise: 'https://pluck-lab.hintwise.org/app',
  none: '',
};

export interface MatrixCase {
  name: string;
  payload: RawPayload;
}

/** Auth's payload as it arrives, codes included (parseHookPayload drops them; planHook must not need them). */
export type RawPayload = HookPayload & { email_data: { token: string; token_new: string } };

const payload = (type: string, redirect: string, data: Partial<RawPayload['email_data']> = {}): RawPayload => ({
  user: { id: 'u1', email: 'ann@example.com', new_email: type === 'email_change' ? 'new@example.com' : undefined },
  email_data: {
    token: AUTH_CODE,
    token_hash: 'hash-1',
    redirect_to: redirect,
    email_action_type: type,
    site_url: 'https://auth.hintwise.org/auth/v1',
    token_new: type === 'email_change' ? AUTH_CODE_NEW : '',
    token_hash_new: type === 'email_change' ? 'hash-2' : '',
    ...data,
  },
});

/** Every type on every site, and an email change with secure email change off (one message). */
export function matrixCases(): MatrixCase[] {
  const out: MatrixCase[] = [];
  for (const [site, redirect] of Object.entries(MATRIX_SITES)) {
    for (const type of HOOK_ACTION_TYPES) out.push({ name: `${type} ${site}`, payload: payload(type, redirect) });
    out.push({ name: `email_change-single ${site}`, payload: payload('email_change', redirect, { token: AUTH_CODE_NEW, token_hash_new: '', token_new: '' }) });
  }
  return out;
}

/** A plan as the fixture keeps it: every field, each message's HTML as its sha256 (the text is kept whole). */
export function pinnedPlan(plan: HookPlan): Record<string, unknown> {
  if (plan.action === 'refuse') return { ...plan };
  const { messages, ...rest } = plan;
  return {
    ...rest,
    messages: messages.map(({ html, ...m }) => ({ ...m, html_sha256: createHash('sha256').update(html).digest('hex') })),
  };
}
