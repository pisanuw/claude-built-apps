/**
 * Alerts to the owner (ADMIN_EMAIL, from builder@hintwise.org) about sign-in
 * abuse, at most one per kind an hour (platform.sign_in_alerts). Pure: the
 * counts come from platform.sign_in_finish. The emails carry counts and
 * hashed keys; only the "one address asked many times" alert names the
 * address, so the owner can tell a visitor who cannot find the email from
 * someone filling a stranger's inbox (the address is in auth.users already
 * once a link went out).
 */
import { renderEmail } from './email.ts';
import { shortHash, type KeyHashes } from './keys.ts';
import type { EmailMessage } from './resend.ts';
import { num as n } from './util.ts';

export type AlertKind = 'many-addresses' | 'address-repeated' | 'challenge-failures' | 'bypass' | 'volume';
export const ALERT_KINDS: readonly AlertKind[] = ['many-addresses', 'address-repeated', 'challenge-failures', 'bypass', 'volume'];

export const ALERT_LIMITS = {
  /** Different addresses asked for from one IP or one browser in an hour. */
  addressesPerHour: 5,
  /** Requests for one address in an hour. */
  requestsPerAddressHour: 5,
  /** Failed challenges from one IP in an hour. */
  challengeFailuresPerIpHour: 3,
  /** Links sent project-wide in an hour: an alert above this. */
  sentPerHour: 100,
} as const;

export const ALERT_EVERY_MS = 60 * 60 * 1000;
export const ALERT_FROM = 'HintWise <builder@hintwise.org>';

/** What platform.sign_in_finish returns (counts include the finished request). */
export interface AlertCounts {
  ip_addresses_1h: number;
  browser_addresses_1h: number;
  email_requests_1h: number;
  ip_challenge_failures_1h: number;
  sent_1h: number;
  /** Last alert time per kind. */
  alerts?: Record<string, string | null>;
}


/** The kinds whose rule holds now. IP rules are skipped when the IP is unknown. */
export function triggeredAlerts(c: AlertCounts, ipKnown = true): AlertKind[] {
  const out: AlertKind[] = [];
  if ((ipKnown && n(c.ip_addresses_1h) >= ALERT_LIMITS.addressesPerHour) || n(c.browser_addresses_1h) >= ALERT_LIMITS.addressesPerHour) out.push('many-addresses');
  if (n(c.email_requests_1h) >= ALERT_LIMITS.requestsPerAddressHour) out.push('address-repeated');
  if (ipKnown && n(c.ip_challenge_failures_1h) >= ALERT_LIMITS.challengeFailuresPerIpHour) out.push('challenge-failures');
  if (n(c.sent_1h) > ALERT_LIMITS.sentPerHour) out.push('volume');
  return out;
}

/** True when the kind has not been sent in the last hour (the claim in SQL decides races). */
export function alertDue(last: string | null | undefined, now: Date): boolean {
  if (!last) return true;
  const t = Date.parse(last);
  return Number.isNaN(t) || now.getTime() - t >= ALERT_EVERY_MS;
}

/** The triggered kinds that are due. */
export function dueAlerts(c: AlertCounts, now: Date, ipKnown = true): AlertKind[] {
  return triggeredAlerts(c, ipKnown).filter((k) => alertDue(c.alerts?.[k], now));
}

export interface AlertContext {
  hashes: KeyHashes;
  /** Raw address: only the address-repeated alert shows it. */
  email?: string | null;
  app?: string | null;
  outcome?: string;
  ipKnown?: boolean;
}

const TITLES: Record<AlertKind, string> = {
  'many-addresses': 'one IP or browser asked for many addresses',
  'address-repeated': 'one address asked for many times',
  'challenge-failures': 'failed challenges from one IP',
  bypass: 'a sign-in email went around sign-in-link',
  volume: 'many sign-in links sent',
};

const lookup = (column: string, hash: string | null) =>
  hash ? `To see the rows: select created_at, app, outcome, detail from platform.sign_in_requests where ${column} like '${shortHash(hash)}%' order by created_at desc limit 50;` : '';

/** The alert email for one kind raised by a sign-in-link request. */
export function alertEmail(kind: Exclude<AlertKind, 'bypass'>, c: AlertCounts, ctx: AlertContext, to: string): EmailMessage {
  const h = ctx.hashes;
  const intro: string[] = [];
  const outro: string[] = [];
  if (kind === 'many-addresses') {
    if (ctx.ipKnown !== false) intro.push(`In the last hour one IP asked for sign-in links to ${n(c.ip_addresses_1h)} different addresses (IP hash ${shortHash(h.ip_hash)}).`);
    intro.push(`One browser asked for links to ${n(c.browser_addresses_1h)} different addresses (browser hash ${shortHash(h.browser_hash)}).`);
    outro.push(lookup('ip_hash', ctx.ipKnown !== false ? h.ip_hash : null) || lookup('browser_hash', h.browser_hash));
  } else if (kind === 'address-repeated') {
    intro.push(
      `In the last hour sign-in links for ${ctx.email ?? 'one address'} were asked for ${n(c.email_requests_1h)} times (address hash ${shortHash(h.email_hash)}).`,
      'Each request waits its turn on the ladder; this means someone keeps trying: a visitor who cannot find the email, or someone filling that inbox.',
    );
    outro.push(lookup('email_hash', h.email_hash));
  } else if (kind === 'challenge-failures') {
    intro.push(`In the last hour ${n(c.ip_challenge_failures_1h)} Turnstile checks failed from one IP (IP hash ${shortHash(h.ip_hash)}).`);
    outro.push(lookup('ip_hash', h.ip_hash));
  } else {
    intro.push(`${n(c.sent_1h)} sign-in links went out in the last hour across all apps (this alert starts above ${ALERT_LIMITS.sentPerHour}).`);
  }
  intro.push(`Latest request: app ${ctx.app ?? '(unknown)'}, outcome ${ctx.outcome ?? '(unknown)'}.`);
  outro.push('At most one alert of this kind an hour.');
  return renderEmail({ to, subject: `HintWise sign-in alert: ${TITLES[kind]}`, intro, outro: outro.filter(Boolean) }, ALERT_FROM);
}

/** The alert for a magic link or sign-up that reached Supabase Auth directly and was refused by the hook. */
export function bypassAlertEmail(to: string, ctx: { emailHash: string | null; actionType: string; redirectHost: string | null }): EmailMessage {
  return renderEmail(
    {
      to,
      subject: `HintWise sign-in alert: ${TITLES.bypass}`,
      intro: [
        `Supabase Auth was asked to email a ${ctx.actionType} directly (signInWithOtp or signUp), not through the sign-in-link function. The send-email hook refused it.`,
        `Address hash ${shortHash(ctx.emailHash)}; return page ${ctx.redirectHost ?? '(none)'}.`,
        'An app still calling signInWithOtp needs the template\'s sendMagicLink; anything else is someone trying to get around the limits.',
      ],
      outro: [lookup('email_hash', ctx.emailHash), 'At most one alert of this kind an hour.'].filter(Boolean),
    },
    ALERT_FROM,
  );
}
