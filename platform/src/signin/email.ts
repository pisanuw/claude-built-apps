/**
 * The emails visitors get: the sign-in link, and the few Auth emails the
 * send-email hook still sends for apps outside HintWise (magic link, sign-up
 * confirmation, sign-in code, password recovery). Plain text plus simple
 * HTML, every value escaped. No times in the text: links expire "in about an
 * hour".
 */
import type { EmailMessage } from './resend.ts';
import { hintwiseLabel } from './validate.ts';

export const SIGN_IN_FROM = 'HintWise <sign-in@hintwise.org>';

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
}

const STYLE = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px';

/** Text and HTML bodies from the same parts. */
export function renderEmail(p: EmailParts, from = SIGN_IN_FROM): EmailMessage {
  const text: string[] = [...p.intro];
  const html: string[] = p.intro.map((s) => `<p>${escapeHtml(s)}</p>`);
  if (p.link) {
    text.push(p.link.href);
    const href = escapeHtml(p.link.href);
    html.push(
      `<p><a href="${href}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(p.link.label)}</a></p>`,
      `<p style="font-size:13px;color:#555555">Or paste this address into your browser:<br><span style="word-break:break-all">${href}</span></p>`,
    );
  }
  if (p.code) {
    text.push(p.code);
    html.push(`<p style="font-size:24px;letter-spacing:4px;font-weight:600">${escapeHtml(p.code)}</p>`);
  }
  text.push(...p.outro, 'HintWise');
  html.push(...p.outro.map((s) => `<p>${escapeHtml(s)}</p>`), '<p>HintWise</p>');
  return {
    from,
    to: [p.to],
    subject: p.subject,
    text: `${text.join('\n\n')}\n`,
    html: `<!doctype html><html><body style="${STYLE}">${html.join('')}</body></html>`,
  };
}

/** The sign-in link email; `host` is the site it signs in to (default the link's own host). */
export function signInEmail(to: string, link: string, appName: string | null, host: string = new URL(link).hostname): EmailMessage {
  return renderEmail({
    to,
    subject: appName ? `Your sign-in link for ${appName}` : 'Your sign-in link',
    intro: [`Here is your link to sign in to ${appName ? `${appName} (${host})` : host}:`],
    link: { href: link, label: 'Sign in' },
    outro: ['The link expires in about an hour. If you did not ask for it, ignore this email.'],
  });
}

const IGNORE = 'If you did not ask for this, ignore this email.';
const EXPIRES = 'The link expires in about an hour.';

// The send-email hook's emails, for the apps outside HintWise that share the project.

export const recoveryEmail = (to: string, href: string): EmailMessage =>
  renderEmail({ to, subject: 'Reset your password', intro: [`Someone asked to reset the password of the account for ${to}. To choose a new one, open this link:`], link: { href, label: 'Reset password' }, outro: [`${EXPIRES} ${IGNORE}`] });

export const signupEmail = (to: string, href: string, host: string): EmailMessage =>
  renderEmail({ to, subject: 'Confirm your email address', intro: [`To finish signing up at ${host}, confirm your email address:`], link: { href, label: 'Confirm my address' }, outro: [`${EXPIRES} ${IGNORE}`] });

export const codeEmail = (to: string, code: string, host: string): EmailMessage =>
  renderEmail({ to, subject: 'Your sign-in code', intro: [`Your code to sign in to ${host} is:`], code, outro: [`The code expires in about an hour. ${IGNORE}`] });
