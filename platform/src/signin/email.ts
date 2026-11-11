/**
 * The emails visitors get: the sign-in link, and the Auth emails the
 * send-email hook sends (magic link, sign-up confirmation, sign-in code and
 * password recovery for apps outside HintWise; invite, email change,
 * reauthentication and account notices for every app). Plain text plus
 * simple HTML, every value escaped. No times in the text: links expire "in
 * about an hour".
 *
 * Every visitor email ends with the same short footer (docs/platform.md,
 * "Email footer and opt-out"): why this address got it, the support
 * address, one line about HintWise, and "Stop all email from HintWise" (the
 * opt-out link, optout.ts). Every email carries Reply-To
 * support@hintwise.org. The owner's alerts (alerts.ts) have no footer.
 *
 * The HTML is inline-styled and sets no text colour, so the mail client's
 * own light or dark colours apply; only the button has its own (white on
 * blue, readable in both). It reads the same with images off: there is no
 * image yet (HEADER_LOGO_HTML).
 */
import type { EmailMessage } from './resend.ts';
import { hintwiseLabel } from './validate.ts';

export const SIGN_IN_FROM = 'HintWise <sign-in@hintwise.org>';
/** Reply-To of every email, and the address the footer names. Cloudflare routes hintwise.org mail to the owner. */
export const SUPPORT_EMAIL = 'support@hintwise.org';
export const STUDIO_URL = 'https://studio.hintwise.org/';

/**
 * HEADER LOGO SLOT. Empty until the owner picks a logo. When there is one:
 * an <img> with an https src on a hintwise.org host, alt="HintWise",
 * explicit width and height, style="display:block;border:0", inside a <p>.
 * Nothing in the email may depend on the image (images are often off).
 */
export const HEADER_LOGO_HTML = '';

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

const STYLE = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;max-width:560px';
const FOOT_P = 'margin:0 0 8px';

export const SUPPORT_LINE = `Questions or trouble signing in? ${SUPPORT_EMAIL} (or just reply).`;
export const STOP_LABEL = 'Stop all email from HintWise';
export const STOP_NOTE = '(sign-in links too)';
/** The last footer line when there is no opt-out link (EMAIL_OPTOUT_SECRET unset). */
export const STOP_BY_EMAIL = `To stop all email from HintWise (sign-in links too), write to ${SUPPORT_EMAIL}.`;

/** The footer as text lines: why, support, about, stop. */
export function footerText(why: string, optOutUrl: string | null): string[] {
  return [why, SUPPORT_LINE, `HintWise builds tools for small businesses, startups and educators. More apps: ${STUDIO_URL}`, optOutUrl ? `${STOP_LABEL} ${STOP_NOTE}: ${optOutUrl}` : STOP_BY_EMAIL];
}

/** The footer as HTML: small text under a rule, real link text, no colours of its own. */
export function footerHtml(why: string, optOutUrl: string | null): string {
  const mail = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;
  const stop = optOutUrl ? `<a href="${escapeHtml(optOutUrl)}">${STOP_LABEL}</a> ${STOP_NOTE}` : `To stop all email from HintWise ${STOP_NOTE}, write to ${mail}.`;
  return [
    '<hr style="border:0;border-top:1px solid #8c8c8c;margin:28px 0 12px">',
    '<div style="font-size:13px;line-height:1.5">',
    `<p style="${FOOT_P}">${escapeHtml(why)}</p>`,
    `<p style="${FOOT_P}">Questions or trouble signing in? ${mail} (or just reply).</p>`,
    `<p style="${FOOT_P}">HintWise builds tools for small businesses, startups and educators. More apps: <a href="${STUDIO_URL}">studio.hintwise.org</a></p>`,
    `<p style="margin:0">${stop}</p>`,
    '</div>',
  ].join('');
}

/**
 * Text and HTML bodies from the same parts. With `why`, the footer follows,
 * linking to `optOutUrl` (or naming support when it is null).
 */
export function renderEmail(p: EmailParts, from = SIGN_IN_FROM, optOutUrl: string | null = null): EmailMessage {
  const text: string[] = [...p.intro];
  const html: string[] = p.intro.map((s) => `<p>${escapeHtml(s)}</p>`);
  if (p.link) {
    text.push(p.link.href);
    const href = escapeHtml(p.link.href);
    html.push(
      `<p><a href="${href}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(p.link.label)}</a></p>`,
      `<p style="font-size:13px">Or paste this address into your browser:<br><span style="word-break:break-all">${href}</span></p>`,
    );
  }
  if (p.code) {
    text.push(p.code);
    html.push(`<p style="font-size:24px;letter-spacing:4px;font-weight:600">${escapeHtml(p.code)}</p>`);
  }
  text.push(...p.outro, 'HintWise');
  html.push(...p.outro.map((s) => `<p>${escapeHtml(s)}</p>`), '<p>HintWise</p>');
  let body = text.join('\n\n');
  if (p.why) {
    body += `\n\n----\n${footerText(p.why, optOutUrl).join('\n')}`;
    html.push(footerHtml(p.why, optOutUrl));
  }
  const head = `<meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(p.subject)}</title>`;
  return {
    from,
    to: [p.to],
    reply_to: SUPPORT_EMAIL,
    subject: p.subject,
    text: `${body}\n`,
    html: `<!doctype html><html lang="en"><head>${head}</head><body style="${STYLE}"><!-- header logo slot (HEADER_LOGO_HTML in platform/src/signin/email.ts) -->${HEADER_LOGO_HTML}${html.join('')}</body></html>`,
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
export function signInEmail(to: string, link: string, appName: string | null, host: string = new URL(link).hostname, optOut: string | null = null): EmailMessage {
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
    optOut,
  );
}

const IGNORE = 'If you did not ask for this, ignore this email.';
const EXPIRES = 'The link expires in about an hour.';

// The send-email hook's emails. Worded for any app on the project, HintWise
// or not. The last argument of each is the recipient's opt-out link.

export const recoveryEmail = (to: string, href: string, site: string | null = null, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: 'Reset your password', intro: [`Someone asked to reset the password of the account for ${to}. To choose a new one, open this link:`], link: { href, label: 'Reset password' }, outro: [`${EXPIRES} ${IGNORE}`], why: WHY.recovery(site) }, SIGN_IN_FROM, optOut);

export const signupEmail = (to: string, href: string, host: string, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: 'Confirm your email address', intro: [`To finish signing up at ${host}, confirm your email address:`], link: { href, label: 'Confirm my address' }, outro: [`${EXPIRES} ${IGNORE}`], why: WHY.signup(host) }, SIGN_IN_FROM, optOut);

export const codeEmail = (to: string, code: string, host: string, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: 'Your sign-in code', intro: [`Your code to sign in to ${host} is:`], code, outro: [`The code expires in about an hour. ${IGNORE}`], why: WHY.code(host) }, SIGN_IN_FROM, optOut);

/** "your account" or "your account on <host>". */
const account = (host: string | null): string => (host ? `your account on ${host}` : 'your account');
const NOT_YOU = 'If this was not you, change your password or contact the site that sent it.';

export const inviteEmail = (to: string, href: string, host: string | null, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: 'You are invited', intro: [`You have been invited to ${host ? `an account on ${host}` : 'an account'} for ${to}. To accept, open this link:`], link: { href, label: 'Accept the invitation' }, outro: [IGNORE], why: WHY.invite(host) }, SIGN_IN_FROM, optOut);

/** To the current address when the email changes (secure email change sends both). */
export const emailChangeCurrentEmail = (to: string, newEmail: string, href: string, host: string | null, optOut: string | null = null): EmailMessage =>
  renderEmail(
    { to, subject: 'Confirm the change of your email address', intro: [`Someone asked to change the email address of ${account(host)} from ${to} to ${newEmail}. To confirm, open this link:`], link: { href, label: 'Confirm the change' }, outro: [`${EXPIRES} ${NOT_YOU}`], why: WHY.emailChangeCurrent(host) },
    SIGN_IN_FROM,
    optOut,
  );

/** To the new address when the email changes. */
export const emailChangeNewEmail = (to: string, href: string, host: string | null, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: 'Confirm your new email address', intro: [`To use ${to} as the email address of ${account(host)}, open this link:`], link: { href, label: 'Confirm this address' }, outro: [`${EXPIRES} ${IGNORE}`], why: WHY.emailChangeNew(host) }, SIGN_IN_FROM, optOut);

export const reauthenticationEmail = (to: string, code: string, host: string | null = null, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: 'Your confirmation code', intro: ['Your confirmation code is:'], code, outro: [`The code expires in about an hour. ${IGNORE}`], why: WHY.reauthentication(host) }, SIGN_IN_FROM, optOut);

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

export const noticeEmail = (to: string, type: string, host: string | null, optOut: string | null = null): EmailMessage =>
  renderEmail({ to, subject: host ? `Your account on ${host} changed` : 'Your account changed', intro: [NOTICES[type] ?? GENERIC_NOTICE], outro: [NOT_YOU], why: WHY.notice(host) }, SIGN_IN_FROM, optOut);
