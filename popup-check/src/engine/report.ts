/** Report helpers: the link that carries a report, counts, comparisons, advice and text versions. */
import { CHECK_TITLES, KIND_LABELS, STATUS_LABELS, type CheckId, type Finding, type OverlayResult, type Report, type Status } from './types';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response((new Response(bytes as BodyInit).body as ReadableStream<Uint8Array>).pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

/** Pack a report into a short code for a link (compressed when the browser can). */
export async function encodeReport(r: Report): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(r));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return `1.${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      // fall through to plain
    }
  }
  return `0.${toBase64Url(bytes)}`;
}

function isReport(x: unknown): x is Report {
  const r = x as Report;
  return !!r && r.v === 1 && typeof r.url === 'string' && typeof r.checkedAt === 'string' && Array.isArray(r.overlays);
}

/** Unpack a report code; throws a plain-language error when it is damaged. */
export async function decodeReport(code: string): Promise<Report> {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) throw new Error('This does not look like a Popup Check report code.');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(m[2]);
    if (m[1] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } catch {
    throw new Error('The report code is damaged or cut short. Copy it again from the Popup Check panel.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The report code is damaged or cut short. Copy it again from the Popup Check panel.');
  }
  if (!isReport(parsed)) throw new Error('This report was made by a different version of Popup Check and cannot be read.');
  return parsed;
}

export interface Counts {
  fail: number;
  warn: number;
  pass: number;
  manual: number;
  notrun: number;
}

export function countFindings(list: Finding[]): Counts {
  const c: Counts = { fail: 0, warn: 0, pass: 0, manual: 0, notrun: 0 };
  for (const f of list) if (f.status !== 'na') c[f.status]++;
  return c;
}

export function reportCounts(r: Report): Counts {
  return countFindings(r.overlays.flatMap((o) => o.findings));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function overlayKey(o: OverlayResult): string {
  return `${o.kind}|${o.app ?? ''}`;
}

export interface Comparison {
  fixed: string[];
  newProblems: string[];
  stillFailing: string[];
  newOverlays: string[];
  goneOverlays: string[];
}

const lineFor = (o: OverlayResult, check: CheckId): string => `${KIND_LABELS[o.kind]}${o.app ? ` (${o.app})` : ''}: ${CHECK_TITLES[check]}`;

/** What changed between an earlier report of the same store and this one. */
export function compareReports(before: Report, after: Report): Comparison {
  const c: Comparison = { fixed: [], newProblems: [], stillFailing: [], newOverlays: [], goneOverlays: [] };
  const prev = new Map(before.overlays.map((o) => [overlayKey(o), o]));
  const seen = new Set<string>();
  for (const o of after.overlays) {
    const key = overlayKey(o);
    const old = prev.get(key);
    if (!old) {
      c.newOverlays.push(KIND_LABELS[o.kind] + (o.app ? ` (${o.app})` : ''));
      continue;
    }
    seen.add(key);
    for (const f of o.findings) {
      const was = old.findings.find((x) => x.check === f.check)?.status;
      if (f.status === 'fail' && was === 'fail') c.stillFailing.push(lineFor(o, f.check));
      else if (f.status === 'fail') c.newProblems.push(lineFor(o, f.check));
      else if (f.status === 'pass' && (was === 'fail' || was === 'warn')) c.fixed.push(lineFor(o, f.check));
    }
  }
  for (const [key, o] of prev) if (!seen.has(key)) c.goneOverlays.push(KIND_LABELS[o.kind] + (o.app ? ` (${o.app})` : ''));
  return c;
}

const FIXES: Record<CheckId, string> = {
  'focus-in': 'When it opens, focus should move to its first field or its close button.',
  'tab-trap': 'While it is open, Tab and Shift+Tab should go round the popup’s own controls only.',
  escape: 'Pressing Escape should close it, the same as the close button.',
  'focus-return': 'After it closes, focus should go back to where the shopper was: the button that opened it, or the start of the page.',
  'close-name': 'The close button needs a name, for example aria-label="Close". A bare × is read out as “times”.',
  'close-size': 'Make the close button at least 24 by 24 pixels (44 by 44 is kinder on phones). Many popup apps have a size setting for it.',
  'dialog-role': 'The popup box needs role="dialog" and aria-modal="true", or should be an HTML <dialog> opened with showModal().',
  'dialog-name': 'Give the dialog a title: aria-labelledby pointing at its heading, or an aria-label.',
  background: 'Add aria-modal="true" to the dialog, or make the rest of the page inert while it is open.',
  'field-labels': 'Every field needs a label. Placeholder text alone disappears while the shopper types.',
  'button-names': 'Buttons that show only an icon need a text name (aria-label).',
  'image-alt': 'Add alt text that says what the picture shows, or alt="" if it is only decoration.',
  contrast: 'Darken the text or lighten the background. Most popup apps let you pick the colours; aim for at least 4.5 to 1.',
  'fake-buttons': 'Clickable parts need to be real buttons or links, so Tab reaches them and Enter presses them.',
  'keyboard-reach': 'It must be a real button or link, so the Tab key can reach it.',
  frame: 'Give the frame a title (for example title="Chat window"), and test what is inside it with the keyboard.',
};

/** Plain advice for one problem: what good looks like, and whose job the fix is. */
export function adviceFor(o: OverlayResult, check: CheckId): { what: string; who: string } {
  const who = o.app
    ? `This comes from ${o.app}, so you usually cannot change its code. Look in ${o.app}’s settings first; if there is no setting, send their support the message below. If they cannot fix it, consider a different app.`
    : 'This looks like part of your theme or a custom code snippet. Send this report to whoever built or maintains your site; fixes like this are usually small.';
  return { what: FIXES[check], who };
}

export function problemsOf(o: OverlayResult): Finding[] {
  return o.findings.filter((f) => f.status === 'fail' || f.status === 'warn');
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** A message the owner can send to the popup app's support. */
export function vendorMessage(r: Report, o: OverlayResult): string {
  const problems = problemsOf(o);
  const who = o.app ? `${o.app} support` : 'there';
  const lines = problems.map((f) => `- ${CHECK_TITLES[f.check]}: ${f.status === 'fail' ? 'no' : 'not quite'}. ${f.detail}`);
  return [
    `Hello ${who},`,
    '',
    `I use ${o.app ?? 'your popup'} on ${hostOf(r.url)}. On ${formatDate(r.checkedAt)} I tested the ${KIND_LABELS[o.kind].toLowerCase()} with the keyboard and a screen-reader view (Popup Check), and it has these problems:`,
    '',
    ...lines,
    '',
    'Shoppers who use a keyboard or a screen reader cannot use it properly. Is there a setting that fixes this, or can it be fixed on your side?',
    '',
    'Thank you.',
  ].join('\n');
}

/** The whole report as plain text, for email or notes. */
export function reportText(r: Report): string {
  const c = reportCounts(r);
  const out = [
    `Popup Check report for ${hostOf(r.url)}`,
    `Page: ${r.url}`,
    `Checked: ${formatDate(r.checkedAt)}`,
    `Popups found: ${r.overlays.length}. Problems: ${c.fail}. Worth a look: ${c.warn}. Passed: ${c.pass}.`,
    '',
    'These are test results for the popups that were open when the check ran, not a statement that the site meets ADA or WCAG.',
  ];
  for (const o of r.overlays) {
    out.push('', `${KIND_LABELS[o.kind]}${o.app ? ` (looks like ${o.app})` : ''}: “${o.label}”`);
    for (const f of o.findings) {
      if (f.status === 'na') continue;
      out.push(`  [${STATUS_LABELS[f.status as Status]}] ${CHECK_TITLES[f.check]}. ${f.detail}`);
      for (const e of f.examples ?? []) out.push(`      ${e}`);
    }
  }
  if (r.appsOnPage.length) out.push('', `Apps seen on the page: ${r.appsOnPage.join(', ')}.`);
  return out.join('\n');
}
