/**
 * The emails visitors get: the sign-in link, and the Auth emails the
 * send-email hook sends (magic link, sign-up confirmation, sign-in code and
 * password recovery for apps outside HintWise; invite, email change,
 * reauthentication and account notices for every app). Plain text plus
 * simple HTML, every value escaped. No times in the text: links expire "in
 * about an hour".
 *
 * Every email (docs/platform.md, "Email footer, logo and opt-out"):
 * - starts with the HintWise header: the logo (EMAIL_LOGO_URL, read through
 *   emailLogoUrl) or, without it, the text wordmark;
 * - carries Reply-To support@hintwise.org;
 * - for visitors, ends with the footer: why this address got it, the
 *   support address, one line about HintWise, and "Stop all email from
 *   HintWise" (the opt-out link, optout.ts). The owner's alerts (alerts.ts)
 *   have no footer.
 *
 * The HTML is inline-styled. Body text has no colour of its own, so the mail
 * client's light or dark colours apply. The brand colour (deep indigo) is on
 * the button (white on indigo, readable in both), the links and the text
 * wordmark; a dark-mode media query lightens the links and the wordmark in
 * the clients that read it, and the others (Gmail's apps, Outlook.com)
 * adjust text colours themselves. The logo sits on a small white panel, so
 * the indigo wordmark stays on white even in a dark client that keeps
 * backgrounds. With images off, the logo's alt text reads "HintWise" in the
 * same indigo, and nothing else depends on the image.
 */
import type { EmailMessage } from './resend.ts';
import { hintwiseLabel } from './validate.ts';

export const SIGN_IN_FROM = 'HintWise <sign-in@hintwise.org>';
/** Reply-To of every email, and the address the footer names. Cloudflare routes hintwise.org mail to the owner. */
export const SUPPORT_EMAIL = 'support@hintwise.org';
export const STUDIO_URL = 'https://studio.hintwise.org/';
/** Deep indigo (platform/brand/README.md): the button, the links and the text wordmark. Coral is for the logo's sparks only. */
export const BRAND_INDIGO = '#312E81';
/** The links in a dark mail client (indigo is unreadable on dark). */
export const DARK_LINK = '#A5B4FC';
/** The text wordmark in a dark mail client. */
export const DARK_BRAND = '#E0E7FF';

/** How one email looks beyond its words: the recipient's opt-out link and the header logo. */
export interface EmailLook {
  /** The footer's opt-out link for this recipient (optout.ts optOutUrl); null: the footer names support instead. */
  optOutUrl?: string | null;
  /** The header logo's src (emailLogoUrl); null: the text wordmark. */
  logoUrl?: string | null;
}

/**
 * EMAIL_LOGO_URL as the header logo's src, or null for the text wordmark.
 * The one place the setting is read: it must be an https URL on hintwise.org
 * or one of its subdomains (the planned host is the public Storage bucket
 * `brand` on auth.hintwise.org), without credentials or a port.
 */
export function emailLogoUrl(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v || v.length > 500) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return host === 'hintwise.org' || host.endsWith('.hintwise.org') ? u.href : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The app's name for the subject, or null: only when the slug is the
 * redirect's own subdomain (paste-md on paste-md.hintwise.org), so a request
 * cannot put arbitrary words in the subject.
 */
export function appDisplayName(app: string, redirectTo: string): string | null {
  if (hintwiseLabel(redirectTo) !== app) return null;
  return app
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export interface EmailParts {
  to: string;
  subject: string;
  /** Paragraphs before the link or code. */
  intro: string[];
  link?: { href: string; label: string };
  code?: string;
  /** Paragraphs after it. */
  outro: string[];
  /** The footer's first line: why this address got the email. Visitor emails only; without it there is no footer. */
  why?: string;
}

const STYLE = 'margin:0;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5';
const LINK_STYLE = `color:${BRAND_INDIGO};text-decoration:underline`;
const HEAD_STYLE =
  `:root{color-scheme:light dark;supported-color-schemes:light dark}` +
  `@media (prefers-color-scheme:dark){.hw-brand{color:${DARK_BRAND} !important}.hw-link{color:${DARK_LINK} !important}}`;
const FOOT_P = 'margin:0 0 8px';

export const SUPPORT_LINE = `Questions or trouble signing in? ${SUPPORT_EMAIL} (or just reply).`;
export const ABOUT_LINE = 'HintWise builds tools for small businesses, startups and educators.';
export const STOP_LABEL = 'Stop all email from HintWise';
export const STOP_NOTE = '(sign-in links too)';
/** The last footer line when there is no opt-out link (EMAIL_OPTOUT_SECRET unset). */
export const STOP_BY_EMAIL = `To stop all email from HintWise (sign-in links too), write to ${SUPPORT_EMAIL}.`;

const anchor = (href: string, text: string): string => `<a class="hw-link" href="${escapeHtml(href)}" style="${LINK_STYLE}">${escapeHtml(text)}</a>`;

/**
 * The header: the logo on a small white panel (so the indigo wordmark is on
 * white in a dark client too), or the text wordmark "HintWise" in indigo,
 * bold, 18px. The logo's alt text has the wordmark's style for images off.
 */
export function headerHtml(logoUrl: string | null | undefined): string {
  const word = `color:${BRAND_INDIGO};font-size:18px;font-weight:bold;line-height:28px`;
  if (!logoUrl) return `<p class="hw-brand" style="margin:0 0 20px;${word}">HintWise</p>`;
  const img = `<img src="${escapeHtml(logoUrl)}" width="100" height="28" alt="HintWise" style="display:block;width:100px;height:28px;border:0;outline:none;text-decoration:none;${word}">`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-collapse:separate"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:4px 6px;border-radius:6px">${img}</td></tr></table>`;
}

/** The footer as text lines: why, support, about, stop. */
export function footerText(why: string, optOutUrl: string | null | undefined): string[] {
  return [why, SUPPORT_LINE, `${ABOUT_LINE} More apps: ${STUDIO_URL}`, optOutUrl ? `${STOP_LABEL} ${STOP_NOTE}: ${optOutUrl}` : STOP_BY_EMAIL];
}

/** The footer as HTML: small text under a rule, underlined links with real text, in the same order as the text. */
export function footerHtml(why: string, optOutUrl: string | null | undefined): string {
  const mail = anchor(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL);
  const stop = optOutUrl ? `${anchor(optOutUrl, STOP_LABEL)} ${STOP_NOTE}` : `To stop all email from HintWise ${STOP_NOTE}, write to ${mail}.`;
  return [
    '<hr style="border:0;border-top:1px solid #8c8c8c;margin:28px 0 12px">',
    '<div style="font-size:13px;line-height:1.5">',
    `<p style="${FOOT_P}">${escapeHtml(why)}</p>`,
    `<p style="${FOOT_P}">Questions or trouble signing in? ${mail} (or just reply).</p>`,
    `<p style="${FOOT_P}">${ABOUT_LINE} More apps: ${anchor(STUDIO_URL, 'studio.hintwise.org')}</p>`,
    `<p style="margin:0">${stop}</p>`,
    '</div>',
  ].join('');
}

/**
 * Text and HTML bodies from the same parts, with the header and Reply-To.
 * With `why`, the footer follows, linking to `look.optOutUrl` (or naming
 * support when there is none).
 */
export function renderEmail(p: EmailParts, from = SIGN_IN_FROM, look: EmailLook = {}): EmailMessage {
  const text: string[] = [...p.intro];
  const html: string[] = p.intro.map((s) => `<p>${escapeHtml(s)}</p>`);
  if (p.link) {
    text.push(p.link.href);
    const href = escapeHtml(p.link.href);
    html.push(
      `<p><a href="${href}" style="display:inline-block;padding:10px 18px;background-color:${BRAND_INDIGO};color:#ffffff;font-weight:600;text-decoration:none;border-radius:6px">${escapeHtml(p.link.label)}</a></p>`,
      `<p style="font-size:13px">Or paste this address into your browser:<br><span style="word-break:break-all">${href}</span></p>`,
    );
  }
  if (p.code) {
    text.push(p.code);
    html.push(`<p style="font-size:24px;letter-spacing:4px;font-weight:600">${escapeHtml(p.code)}</p>`);
  }
  // No "HintWise" sign-off: the header carries the logo or the wordmark, and the From name says it.
  text.push(...p.outro);
  html.push(...p.outro.map((s) => `<p>${escapeHtml(s)}</p>`));
  let body = text.join('\n\n');
  if (p.why) {
    body += `\n\n----\n${footerText(p.why, look.optOutUrl).join('\n')}`;
    html.push(footerHtml(p.why, look.optOutUrl));
  }
  const head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    `<title>${escapeHtml(p.subject)}</title><style>${HEAD_STYLE}</style>`;
  return {
    from,
    to: [p.to],
    reply_to: SUPPORT_EMAIL,
    subject: p.subject,
    text: `${body}\n`,
    html: `<!doctype html><html lang="en"><head>${head}</head><body style="${STYLE}"><div style="max-width:560px">${headerHtml(look.logoUrl)}${html.join('')}</div></body></html>`,
  };
}

// The footer's first line, one per kind of email (owner, 11 Nov 2026).
const IGNORE_IT = "If it wasn't you, ignore it: nothing happens.";
/** " on <site>" or "". */
const on = (site: string | null): string => (site ? ` on ${site}` : '');

export const WHY = {
  signIn: (app: string): string => `You got this because someone asked to sign in to ${app} with this address. ${IGNORE_IT}`,
  code: (site: string): string => `You got this because someone asked for a code to sign in to ${site} with this address. ${IGNORE_IT}`,
  signup: (site: string): string => `You got this because someone signed up at ${site} with this address. If it wasn't you, ignore it: the address stays unconfirmed.`,
  recovery: (site: string | null): string => `You got this because someone asked to reset the password of the account with this address${on(site)}. If it wasn't you, ignore it: the password stays the same.`,
  invite: (site: string | null): string => `You got this because someone invited this address to an account${on(site)}. If you don't want it, ignore it: nothing happens.`,
  emailChangeCurrent: (site: string | null): string =>
    `You got this because someone asked to move the account with this address${on(site)} to another address. If it wasn't you, ignore it and change your password: nothing changes unless this link is opened.`,
  emailChangeNew: (site: string | null): string => `You got this because someone asked to use this address for an account${on(site)}. ${IGNORE_IT}`,
  reauthentication: (site: string | null): string =>
    `You got this because the account with this address${on(site)} asked for a code to confirm a change. If it wasn't you, ignore it and change your password: nothing changes without the code.`,
  notice: (site: string | null): string => `You got this because the account with this address${on(site)} changed, and every change is reported to its address.`,
} as const;

/** The sign-in link email; `host` is the site it signs in to (default the link's own host). */
export function signInEmail(to: string, link: string, appName: string | null, host: string = new URL(link).hostname, look: EmailLook = {}): EmailMessage {
  return renderEmail(
    {
      to,
      subject: appName ? `Your sign-in link for ${appName}` : 'Your sign-in link',
      intro: [`Here is your link to sign in to ${appName ? `${appName} (${host})` : host}:`],
      link: { href: link, label: 'Sign in' },
      outro: ['The link expires in about an hour. If you did not ask for it, ignore this email.'],
      why: WHY.signIn(appName ?? host),
    },
    SIGN_IN_FROM,
    look,
  );
}

const IGNORE = 'If you did not ask for this, ignore this email.';
const EXPIRES = 'The link expires in about an hour.';

// The send-email hook's emails. Worded for any app on the project, HintWise
// or not. The last argument of each is the recipient's look (opt-out link, logo).

export const recoveryEmail = (to: string, href: string, site: string | null = null, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: 'Reset your password', intro: [`Someone asked to reset the password of the account for ${to}. To choose a new one, open this link:`], link: { href, label: 'Reset password' }, outro: [`${EXPIRES} ${IGNORE}`], why: WHY.recovery(site) }, SIGN_IN_FROM, look);

export const signupEmail = (to: string, href: string, host: string, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: 'Confirm your email address', intro: [`To finish signing up at ${host}, confirm your email address:`], link: { href, label: 'Confirm my address' }, outro: [`${EXPIRES} ${IGNORE}`], why: WHY.signup(host) }, SIGN_IN_FROM, look);

export const codeEmail = (to: string, code: string, host: string, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: 'Your sign-in code', intro: [`Your code to sign in to ${host} is:`], code, outro: [`The code expires in about an hour. ${IGNORE}`], why: WHY.code(host) }, SIGN_IN_FROM, look);

/** "your account" or "your account on <host>". */
const account = (host: string | null): string => (host ? `your account on ${host}` : 'your account');
const NOT_YOU = 'If this was not you, change your password or contact the site that sent it.';

export const inviteEmail = (to: string, href: string, host: string | null, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: 'You are invited', intro: [`You have been invited to ${host ? `an account on ${host}` : 'an account'} for ${to}. To accept, open this link:`], link: { href, label: 'Accept the invitation' }, outro: [IGNORE], why: WHY.invite(host) }, SIGN_IN_FROM, look);

/** To the current address when the email changes (secure email change sends both). */
export const emailChangeCurrentEmail = (to: string, newEmail: string, href: string, host: string | null, look: EmailLook = {}): EmailMessage =>
  renderEmail(
    { to, subject: 'Confirm the change of your email address', intro: [`Someone asked to change the email address of ${account(host)} from ${to} to ${newEmail}. To confirm, open this link:`], link: { href, label: 'Confirm the change' }, outro: [`${EXPIRES} ${NOT_YOU}`], why: WHY.emailChangeCurrent(host) },
    SIGN_IN_FROM,
    look,
  );

/** To the new address when the email changes. */
export const emailChangeNewEmail = (to: string, href: string, host: string | null, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: 'Confirm your new email address', intro: [`To use ${to} as the email address of ${account(host)}, open this link:`], link: { href, label: 'Confirm this address' }, outro: [`${EXPIRES} ${IGNORE}`], why: WHY.emailChangeNew(host) }, SIGN_IN_FROM, look);

export const reauthenticationEmail = (to: string, code: string, host: string | null = null, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: 'Your confirmation code', intro: ['Your confirmation code is:'], code, outro: [`The code expires in about an hour. ${IGNORE}`], why: WHY.reauthentication(host) }, SIGN_IN_FROM, look);

/** One sentence per account notice of the send-email hook; other *_notification types get the generic one. */
export const NOTICES: Readonly<Record<string, string>> = {
  password_changed_notification: 'The password of your account was changed.',
  email_changed_notification: 'The email address of your account was changed.',
  phone_changed_notification: 'The phone number of your account was changed.',
  identity_linked_notification: 'A sign-in method was linked to your account.',
  identity_unlinked_notification: 'A sign-in method was removed from your account.',
  mfa_factor_enrolled_notification: 'A second sign-in step was added to your account.',
  mfa_factor_unenrolled_notification: 'A second sign-in step was removed from your account.',
};
export const GENERIC_NOTICE = 'A setting of your account was changed.';

export const noticeEmail = (to: string, type: string, host: string | null, look: EmailLook = {}): EmailMessage =>
  renderEmail({ to, subject: host ? `Your account on ${host} changed` : 'Your account changed', intro: [NOTICES[type] ?? GENERIC_NOTICE], outro: [NOT_YOU], why: WHY.notice(host) }, SIGN_IN_FROM, look);
