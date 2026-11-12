/**
 * Reads a raw delivery email (.eml file, or the "Show original" source
 * pasted from Gmail) into an EmailAnalysis. Parsing runs in the browser: the
 * raw email never leaves the device.
 */
import PostalMime from 'postal-mime';
import { labelPlacement, summariseAuth, transit, type HeaderPair } from './headers';
import { detectApp, extractLinks } from './links';
import type { EmailAnalysis } from './types';

/** Larger than any delivery email; a bigger file is not one. */
export const MAX_EMAIL_BYTES = 5 * 1024 * 1024;

export class EmailError extends Error {}

function iso(date: string | undefined): string {
  if (!date) return '';
  const t = Date.parse(date);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** Gmail's "Show original" page puts a summary table above the message when the whole page is copied. */
export function trimShowOriginal(raw: string): string {
  let lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  // An mbox message (Google Takeout) starts with a "From " separator line.
  if (/^From \S/.test(lines[0] ?? '')) lines = lines.slice(1);
  // Already a message: its first line is a header.
  if (HEADER_LINE.test(lines[0] ?? '')) return lines.join('\r\n');
  const start = lines.findIndex((l) => /^(Delivered-To|Received|Return-Path|ARC-Seal|X-Received|X-Gmail-Labels|MIME-Version|DKIM-Signature|Authentication-Results):/i.test(l));
  return start > 0 ? lines.slice(start).join('\r\n') : lines.join('\r\n');
}

/** RFC 5322 header field syntax: printable characters except ":" and space, then ":". */
const HEADER_LINE = /^[\x21-\x39\x3b-\x7e]+:/;

export function looksLikeEmail(raw: string): boolean {
  const head = raw.slice(0, 64 * 1024);
  return /^(from|subject|received|date|message-id|mime-version):/im.test(head) && /\r?\n\r?\n/.test(head + '\n\n');
}

export async function analyseEmail(input: string | ArrayBuffer): Promise<EmailAnalysis> {
  const size = typeof input === 'string' ? input.length : input.byteLength;
  if (size === 0) throw new EmailError('The email is empty.');
  if (size > MAX_EMAIL_BYTES) throw new EmailError('That file is over 5 MB, which is larger than any delivery email. Choose the .eml of the delivery email itself.');
  let raw = typeof input === 'string' ? input : new TextDecoder().decode(input);
  raw = trimShowOriginal(raw);
  if (!looksLikeEmail(raw)) {
    throw new EmailError('This does not look like an email source. In Gmail, open the email, choose More (three dots), then "Download message", and drop the .eml file here.');
  }
  const email = await PostalMime.parse(raw);
  const headers: HeaderPair[] = email.headers.map((h) => ({ key: h.key, value: h.value }));
  const from = email.from && 'address' in email.from && email.from.address ? { name: email.from.name ?? '', address: email.from.address.toLowerCase() } : { name: '', address: '' };
  const auth = summariseAuth(headers);
  const links = extractLinks(email.html, email.text);
  const t = transit(headers);
  return {
    from,
    subject: (email.subject ?? '').slice(0, 500),
    sentAt: iso(email.date),
    receivedAt: t.receivedAt,
    transitSeconds: t.seconds,
    auth,
    links,
    app: detectApp(from.address, auth?.signedBy ?? [], links),
    labelPlacement: labelPlacement(headers),
    listUnsubscribe: headers.some((h) => h.key.toLowerCase() === 'list-unsubscribe'),
  };
}
