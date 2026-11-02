/**
 * Turning a report into words: advice per finding, a Markdown summary an
 * agency can paste into a care-plan update, and JSON save/load for later
 * comparison.
 */
import type { Finding, ScanReport } from './analyze';
import { leakCount, modeLabel } from './analyze';
import type { Attribution } from './attribution';
import type { ScanDiff } from './diff';

export const DISCLAIMER =
  'These are technical findings for the pages and visit recorded, not legal advice, and a clean result is not a certificate of compliance.';

/** One sentence naming where a tracker came from. */
export function describeAttribution(a: Attribution): string {
  const ver = a.version ? ` ${a.version}` : '';
  switch (a.kind) {
    case 'plugin':
      return `Loaded by the plugin ${a.label ?? a.slug}${ver}.`;
    case 'theme':
      return `Loaded by the theme ${a.slug}${ver}.`;
    case 'inline':
      if (a.element === 'iframe') return 'Embedded directly in the page content (an <iframe> in the HTML), usually pasted into a product description, post or page-builder block.';
      return a.slug ? `Added by an inline snippet with WordPress handle “${a.slug}”, which does not match a plugin folder in this recording.` : 'Added by an inline snippet in the page HTML with no id.';
    case 'optimizer':
      return `Cannot name the plugin: ${a.label} combined and minified the file that loaded it, which removes the plugin’s folder name.`;
    case 'server':
      return 'Set by the shop’s own server (PHP), so there is no script path to follow.';
    default:
      return 'Cannot name the plugin: nothing in the recording points to a WordPress plugin or theme.';
  }
}

/** A next step for the owner, based on the purpose and the best attribution. */
export function advice(f: Finding): string {
  const a = f.attributions.find((x) => x.kind === 'plugin' || x.kind === 'theme') ?? f.attributions[0];
  if (f.severity === 'notice') {
    if (f.vendorId === 'google-fonts') return 'Host the fonts on your own server (many themes and optimizers have a “local Google Fonts” option).';
    return 'Not a leak by itself. Check that anything it loads waits for consent.';
  }
  if (f.purpose === 'embed') return 'Turn on your consent banner’s placeholder for this embed (Complianz, Borlabs and others offer one) so the player loads only after a click.';
  switch (a?.kind) {
    case 'plugin':
    case 'theme':
      return `In ${a.label ?? a.slug}, look for a consent or “wait for cookie banner” setting, or ask its support whether version ${a.version ?? 'in use'} changed how it loads ${f.vendor}. Rolling back the last update and recording again confirms it.`;
    case 'optimizer':
      return `Temporarily turn off JavaScript combining in ${a.label} (or exclude ${f.vendor}) and record again: the recording will then name the plugin.`;
    case 'server':
      return 'A plugin sets this cookie from PHP. Deactivate likely plugins one at a time on a staging copy, or ask your developer to search the code for the cookie name.';
    default:
      return 'Look for the tag in your theme’s header, a code-snippets plugin (WPCode, Header Footer Code Manager) or Google Tag Manager, and gate it behind your banner.';
  }
}

export function verdict(r: ScanReport): string {
  const n = leakCount(r);
  if (n === 0) return `No tracking found ${modeLabel(r.mode)} on the ${r.pages.length || 1} page(s) recorded.`;
  return `${n} tracker${n === 1 ? '' : 's'} fired ${modeLabel(r.mode)}.`;
}

const PHASE: Record<string, string> = { 'before-choice': 'before any choice', 'after-reject': 'after Reject all' };

export function toMarkdown(reports: ScanReport[], diffs: ScanDiff[] = []): string {
  const lines: string[] = [];
  const site = reports[0]?.site ?? 'site';
  lines.push(`# Consent check: ${site}`, '');
  for (const r of reports) {
    lines.push(`## ${modeLabel(r.mode)[0].toUpperCase() + modeLabel(r.mode).slice(1)}`, '');
    lines.push(`Recorded ${r.recordedAt ? r.recordedAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'at an unknown time'}, ${r.requestCount} requests, ${r.pages.length} page(s).`);
    if (r.cmp.name) lines.push(`Banner: ${r.cmp.name}, stored choice: ${r.cmp.choice}.`);
    lines.push('', `**${verdict(r)}**`, '');
    for (const f of r.findings) {
      lines.push(`### ${f.severity === 'leak' ? 'LEAK' : 'Note'}: ${f.vendor} (${f.purpose})`);
      for (const e of f.evidence) {
        const what = e.type === 'cookie' ? `cookie \`${e.name}\` (set by ${e.setBy})` : `request to ${e.name}`;
        lines.push(`- ${what}, ${PHASE[e.phase]}, ${e.count}x${e.note ? `. ${e.note}` : ''}`);
      }
      for (const a of f.attributions) lines.push(`- Source: ${describeAttribution(a)}`);
      lines.push(`- Next step: ${advice(f)}`, '');
    }
    if (r.warnings.length) {
      lines.push('Recording notes:');
      for (const w of r.warnings) lines.push(`- ${w}`);
      lines.push('');
    }
  }
  for (const diff of diffs) {
    lines.push(`## Since the last check (${modeLabel(diff.mode)})`, '');
    lines.push(`New leaks: ${diff.newLeaks.map((f) => f.vendor).join(', ') || 'none'}.`);
    lines.push(`Fixed: ${diff.fixedLeaks.map((f) => f.vendor).join(', ') || 'none'}.`);
    for (const s of diff.suspects) lines.push(`- Suspect: ${s.label} changed ${s.before.join('/') || '(new)'} -> ${s.after.join('/') || '?'} and is named on ${s.vendor}.`);
    for (const c of diff.pluginChanges) lines.push(`- ${c.label}: ${c.change} ${c.before.join('/') || '-'} -> ${c.after.join('/') || '-'}`);
    lines.push('');
  }
  lines.push(`_${DISCLAIMER}_`, '');
  return lines.join('\n');
}

export interface SavedCheck {
  app: 'consent-leak-watch';
  version: 1;
  savedAt: string;
  reports: ScanReport[];
}

export function saveCheck(reports: ScanReport[], now: Date = new Date()): string {
  const doc: SavedCheck = { app: 'consent-leak-watch', version: 1, savedAt: now.toISOString(), reports };
  return JSON.stringify(doc, null, 2);
}

/** Load a saved check. Throws an Error with a readable message when the file is something else. */
export function loadCheck(text: string): SavedCheck {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('That file is not a saved Consent Leak Watch check (not JSON).');
  }
  const d = doc as Partial<SavedCheck> | null;
  if (!d || d.app !== 'consent-leak-watch' || d.version !== 1 || !Array.isArray(d.reports)) {
    if (d && typeof d === 'object' && 'log' in d) throw new Error('That is a HAR recording. Drop it in one of the two recording boxes; this box takes a check you saved earlier.');
    throw new Error('That file is not a saved Consent Leak Watch check.');
  }
  return d as SavedCheck;
}
