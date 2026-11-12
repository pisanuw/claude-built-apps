/**
 * The rules: what the email, its placement and its link test mean, in plain
 * words with a fix for each problem. Deterministic; every finding has a
 * stable id that the tests pin.
 */
import { aligned, FREE_MAILBOXES, orgDomain } from './headers';
import { downloadCandidates, hostOf, isShortener } from './links';
import type { Baseline, CheckReport, EmailAnalysis, Finding, LinkResult, Placement, Verdict } from './types';

export const SLOW_WARN_SECONDS = 15 * 60;
export const SLOW_FAIL_SECONDS = 2 * 60 * 60;

export interface EvaluateInput {
  analysis: EmailAnalysis;
  placement: Placement;
  /** The link test, or null when it did not run. */
  link: LinkResult | null;
  /** Why the link test did not run (for example "Sign in to test the link"). */
  linkSkipped?: string;
  baseline: Baseline | null;
}

const f = (id: string, severity: Finding['severity'], title: string, detail: string, fix = ''): Finding => ({ id, severity, title, detail, fix });

function minutes(s: number): string {
  if (s < 90) return `${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes`;
  const h = Math.round(m / 6) / 10;
  return `${h} hours`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function placementFindings(p: Placement): Finding[] {
  switch (p) {
    case 'spam':
      return [f('placement-spam', 'fail', 'It landed in Spam', 'Gmail filed this delivery email as spam, so a buyer with Gmail may never see their download.', 'Fix the sender problems below first; then ask a few buyers to mark your email "Not spam". Check again next week to see whether it moves.')];
    case 'promotions':
      return [f('placement-promotions', 'warn', 'It landed in Promotions', 'Gmail put it in the Promotions tab. Buyers often miss it there and write to you that nothing arrived.', 'Keep the delivery email plain: one clear download link, few images, no discount banners or "shop more" sections. Say in your order confirmation that the download email may be in Promotions.')];
    case 'inbox':
      return [f('placement-inbox', 'ok', 'It reached the inbox', 'Gmail delivered it to the main inbox.')];
    case 'other':
      return [f('placement-other', 'warn', 'It was in another folder', 'It was not in the inbox. A filter or label may have moved it, or it landed in Updates or Social.', 'Check where it was and whether a buyer would look there.')];
    default:
      return [f('placement-unknown', 'info', 'Placement not given', 'Say where the email landed (Inbox, Promotions or Spam) to include it in the check.')];
  }
}

function senderFindings(a: EmailAnalysis): Finding[] {
  const out: Finding[] = [];
  const fromDomain = a.from.address.split('@')[1] ?? '';
  if (!a.auth) {
    out.push(f('auth-missing', 'info', 'No authentication results', 'This copy has no Authentication-Results header, so the sender checks cannot be read. Forwarded emails lose it.', 'Use the original from the mailbox that received the order: in Gmail, More (three dots), then "Download message".'));
  } else {
    const { spf, dkim, dmarc, signedBy } = a.auth;
    if (spf) {
      if (spf.result === 'pass') out.push(f('spf-pass', 'ok', 'SPF passed', `The sending server is allowed to send for ${spf.domain || 'the envelope domain'}.`));
      else if (spf.result === 'fail') out.push(f('spf-fail', 'fail', 'SPF failed', `The server that sent it is not listed as allowed to send for ${spf.domain || 'the envelope domain'}.`, 'Add the sending service to your domain\'s SPF record (the "include:" line your delivery app or Shopify gives you).'));
      else out.push(f('spf-weak', 'warn', `SPF result: ${spf.result}`, `SPF did not pass for ${spf.domain || 'the envelope domain'}; mailbox providers trust it less.`, 'Check your domain\'s SPF record includes the service that sends your delivery emails.'));
    }
    const dkimPass = dkim.filter((d) => d.result === 'pass');
    if (!dkim.length && !signedBy.length) {
      out.push(f('dkim-none', 'fail', 'Not signed (no DKIM)', 'The email carries no DKIM signature, which Gmail now expects from senders.', 'Authenticate your sending domain in Shopify (Settings, Notifications, Sender email) or in your delivery app\'s email settings, which adds DKIM records to your DNS.'));
    } else if (dkim.length && !dkimPass.length) {
      out.push(f('dkim-fail', 'fail', 'DKIM signature failed', `The signature${dkim[0].domain ? ` for ${dkim[0].domain}` : ''} did not verify, so the message looks altered or its DNS key is wrong.`, 'Re-check the DKIM records your sending service gave you; a typo or a removed record breaks every email.'));
    } else if (dkimPass.length) {
      out.push(f('dkim-pass', 'ok', 'DKIM signature verified', `Signed by ${dkimPass.map((d) => d.domain).join(', ')}.`));
    }
    const signers = dkimPass.length ? dkimPass.map((d) => d.domain) : signedBy;
    if (fromDomain && signers.length && !signers.some((d) => aligned(d, fromDomain)) && !FREE_MAILBOXES.has(fromDomain)) {
      out.push(f('dkim-unaligned', 'warn', 'Signed by someone else\'s domain', `It comes from ${fromDomain} but is signed by ${signers.join(', ')}. Gmail scores it on that other domain, shared with many senders.`, `Authenticate ${orgDomain(fromDomain)} with the service that sends the email (Shopify: Settings, Notifications, Sender email; delivery apps: custom sending domain), so the signature is your own.`));
    }
    if (dmarc) {
      if (dmarc.result === 'pass') out.push(f('dmarc-pass', 'ok', 'DMARC passed', `${dmarc.domain || fromDomain}'s policy check passed.`));
      else if (dmarc.result === 'fail') out.push(f('dmarc-fail', 'fail', 'DMARC failed', `Neither SPF nor DKIM lined up with ${dmarc.domain || fromDomain}, so its own policy tells Gmail to distrust this email.`, 'Make the signature or the sending server match your From domain (see the other findings), then check again.'));
      else if (dmarc.result === 'none') out.push(f('dmarc-none', 'warn', 'No DMARC record', `${dmarc.domain || fromDomain} has no DMARC policy. Gmail asks senders for one.`, `Add a TXT record at _dmarc.${orgDomain(dmarc.domain || fromDomain)} with "v=DMARC1; p=none;" to start.`));
      else out.push(f('dmarc-other', 'warn', `DMARC result: ${dmarc.result}`, 'The DMARC check did not finish cleanly.', 'Check your domain\'s DMARC record with your DNS provider.'));
    }
  }
  // A free-mailbox From is a problem only when another server sent it: no
  // passing DKIM signature of that domain, or DMARC did not pass.
  const ownSigned = !!a.auth && a.auth.dkim.some((d) => d.result === 'pass' && aligned(d.domain, fromDomain));
  const dmarcPassed = a.auth?.dmarc?.result === 'pass';
  if (FREE_MAILBOXES.has(fromDomain) && !(ownSigned && dmarcPassed)) {
    out.push(f('from-free-mailbox', 'fail', `Sent "as" a ${fromDomain} address`, `The From address is on ${fromDomain}, but another company's servers sent it. ${fromDomain}'s own policy tells mailbox providers to distrust that.`, 'Use an address on your own domain as the sender in Shopify and in your delivery app, and authenticate that domain.'));
  }
  return out;
}

function timingFindings(a: EmailAnalysis): Finding[] {
  let worst = a.transitSeconds ?? 0;
  if (a.sentAt && a.receivedAt) worst = Math.max(worst, Math.round((Date.parse(a.receivedAt) - Date.parse(a.sentAt)) / 1000));
  if (a.transitSeconds === null && !(a.sentAt && a.receivedAt)) return [];
  if (worst >= SLOW_FAIL_SECONDS) return [f('slow-fail', 'fail', 'Very slow to arrive', `It took about ${minutes(worst)} from sending to the mailbox.`, 'Buyers expect the file within minutes. Ask your delivery app whether its email queue is delayed.')];
  if (worst >= SLOW_WARN_SECONDS) return [f('slow-warn', 'warn', 'Slow to arrive', `It took about ${minutes(worst)} from sending to the mailbox.`, 'Watch this over the next checks; if it stays slow, ask your delivery app about its email queue.')];
  return [f('fast', 'ok', 'Arrived quickly', `It took about ${minutes(Math.max(0, worst))} from sending to the mailbox.`)];
}

function linkFindings(input: EvaluateInput): Finding[] {
  const out: Finding[] = [];
  const candidates = downloadCandidates(input.analysis.links);
  if (!candidates.length) {
    return [f('link-none', 'fail', 'No download link found', 'No link in the email looks like a download (no download wording and no file link).', 'Open the email yourself: if it has no download link, your delivery app sent the wrong template or no file is attached to the product.')];
  }
  const best = candidates[0];
  let host = '';
  try {
    const u = new URL(best.url);
    host = u.hostname;
    if (u.protocol === 'http:') out.push(f('link-http', 'warn', 'Download link is not secure (http)', 'Browsers warn about, and some block, downloads over plain http.', 'Switch the delivery app or file host to https links.'));
  } catch {
    /* extractLinks only keeps parseable URLs */
  }
  if (isShortener(host)) out.push(f('link-shortener', 'warn', 'Download link uses a link shortener', `${host} links are common in spam, which hurts placement.`, 'Link straight to the file or your delivery app\'s download page.'));
  const r = input.link;
  if (!r) {
    out.push(f('link-untested', 'info', 'Link not tested', input.linkSkipped || 'The download link was not tested.'));
    return out;
  }
  if (r.error) {
    out.push(f('link-error', 'fail', 'The download link did not work', r.error, 'Open the link yourself. If it fails, re-attach the file to the product in your delivery app and resend recent orders.'));
    return out;
  }
  if (r.status >= 400) {
    out.push(f('link-status', 'fail', `The download link answered ${r.status}`, r.status === 404 ? 'The file or page was not found.' : r.status === 403 || r.status === 401 ? 'Access was refused: the link may have expired or hit its download limit.' : 'The server answered with an error.', 'Re-attach the file in your delivery app, check its download limits and expiry, and resend recent orders.'));
    return out;
  }
  if (r.page) {
    if (r.pageSaysExpired) {
      out.push(f('link-expired', 'fail', 'The link opens an "expired" page', `The page${r.pageTitle ? ` "${r.pageTitle}"` : ''} says the link expired or ran out of downloads, on a fresh canary order.`, 'Raise the download limit and expiry in your delivery app; buyers need at least a few days and a few downloads.'));
    } else {
      out.push(f('link-page', 'info', 'The link opens a download page', `It opens a web page${r.pageTitle ? ` titled "${r.pageTitle}"` : ''}, not the file itself, which is normal for some delivery apps.`));
    }
    return out;
  }
  if (r.size === 0) {
    out.push(f('link-empty', 'fail', 'The downloaded file is empty', 'The link answered, but with a file of zero bytes.', 'Re-upload the file to the product in your delivery app.'));
    return out;
  }
  out.push(f('link-ok', 'ok', 'The download link works', `It gave ${r.fileName || 'a file'} (${r.contentType || 'unknown type'}, ${bytes(r.size)}${r.truncated ? ' read so far; larger files are checked by their first part' : ''}).`));
  const b = input.baseline;
  if (!b) {
    out.push(f('baseline-none', 'info', 'No baseline file yet', 'Save this file as the baseline, and later checks will tell you if the delivered file ever changes.'));
  } else if (b.sha256 === r.sha256) {
    out.push(f('baseline-match', 'ok', 'Same file as the baseline', `Matches the file saved on ${b.setAt.slice(0, 10)}.`));
  } else {
    out.push(f('baseline-differs', 'warn', 'A different file than the baseline', `Expected ${b.fileName || 'the baseline file'} (${bytes(b.size)}); got ${r.fileName || 'a file'} (${bytes(r.size)}).`, 'If you replaced the file on purpose, save this one as the new baseline. If not, check which file is attached to the canary product.'));
  }
  return out;
}

export function evaluate(input: EvaluateInput): Finding[] {
  return [...placementFindings(input.placement), ...senderFindings(input.analysis), ...timingFindings(input.analysis), ...linkFindings(input)];
}

export function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((x) => x.severity === 'fail')) return 'fail';
  if (findings.some((x) => x.severity === 'warn')) return 'warn';
  return 'pass';
}

/** The saved form: hosts only, never the per-order download URL (it grants access to the file). */
export function toReport(input: EvaluateInput, findings: Finding[]): CheckReport {
  const { links, ...rest } = input.analysis;
  const r = input.link;
  return {
    analysis: { ...rest, links: links.slice(0, 10).map((l) => ({ host: hostOf(l.url), text: l.text })) },
    placement: input.placement,
    link: r
      ? {
          host: hostOf(r.url),
          finalHost: hostOf(r.finalUrl),
          status: r.status,
          redirects: r.redirects,
          contentType: r.contentType,
          fileName: r.fileName,
          size: r.size,
          truncated: r.truncated,
          sha256: r.sha256,
          page: r.page,
          pageTitle: r.pageTitle,
          pageSaysExpired: r.pageSaysExpired,
          error: r.error,
        }
      : null,
    findings,
  };
}

/** A baseline from a good file test. */
export function baselineFrom(r: LinkResult, now: Date = new Date()): Baseline | null {
  if (r.error || r.page || r.status >= 400 || r.size === 0) return null;
  return { fileName: r.fileName, contentType: r.contentType, size: r.size, sha256: r.sha256, host: hostOf(r.url), setAt: now.toISOString() };
}
