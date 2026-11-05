/** Runs the checks on every open overlay and keeps the results together. */
import { appsOnPage } from './apps';
import { staticChecks } from './checks';
import { findOverlays, type Overlay } from './detect';
import type { Env } from './dom';
import { guidedFindings, type GuidedResult } from './guided';
import { escapeFindings, focusInFinding, tabTrapFinding } from './keyboard';
import type { CheckId, Finding, OverlayResult, Report } from './types';

export interface ScanItem {
  overlay: Overlay;
  result: OverlayResult;
}

export interface Scan {
  url: string;
  title: string;
  checkedAt: string;
  appsOnPage: string[];
  items: ScanItem[];
}

export const CHECK_ORDER: CheckId[] = [
  'focus-in',
  'tab-trap',
  'escape',
  'focus-return',
  'keyboard-reach',
  'close-name',
  'close-size',
  'dialog-role',
  'dialog-name',
  'background',
  'field-labels',
  'button-names',
  'image-alt',
  'contrast',
  'fake-buttons',
  'frame',
];

function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort((a, b) => CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check));
}

/** Replace the finding for the same check (or add it). */
export function setFinding(result: OverlayResult, f: Finding): void {
  result.findings = sortFindings([...result.findings.filter((x) => x.check !== f.check), f]);
}

/** Look at the page now. `focused` is where focus was before Popup Check was clicked. */
export function scanPage(env: Env, focused: Element | null, now: Date = new Date()): Scan {
  const overlays = findOverlays(env);
  const items = overlays.map((overlay, i): ScanItem => {
    const findings = staticChecks(env, overlay);
    if (overlay.modal) {
      findings.push(focusInFinding(overlay, focused));
      findings.push({ check: 'tab-trap', status: 'notrun', how: 'simulated', detail: 'Not tested yet.' });
    }
    if (overlay.kind !== 'chat') {
      findings.push({ check: 'escape', status: 'notrun', how: 'simulated', detail: 'Not tested yet: pressing Escape may close the popup, so it runs only when you ask.' });
    }
    return {
      overlay,
      result: {
        id: `o${i + 1}`,
        kind: overlay.kind,
        app: overlay.app?.name,
        label: overlay.label,
        where: overlay.where,
        modal: overlay.modal,
        framed: overlay.framed,
        findings: sortFindings(findings),
      },
    };
  });
  return {
    url: env.doc.location?.href ?? '',
    title: env.doc.title,
    checkedAt: now.toISOString(),
    appsOnPage: appsOnPage(env.doc),
    items,
  };
}

/** Simulated Tab test on every popup that should hold focus. */
export async function runTabTests(env: Env, scan: Scan): Promise<void> {
  for (const item of scan.items) {
    if (!item.overlay.modal) continue;
    if (item.result.findings.some((f) => f.check === 'tab-trap' && f.how === 'you')) continue;
    setFinding(item.result, await tabTrapFinding(env, item.overlay));
  }
}

/** Simulated Escape test on one overlay (closes it if Escape works). */
export async function runEscapeTest(env: Env, item: ScanItem): Promise<void> {
  for (const f of await escapeFindings(env, item.overlay)) setFinding(item.result, f);
}

/** Results of the owner's own key presses replace the simulated ones. */
export function applyGuided(item: ScanItem, g: GuidedResult): void {
  for (const f of guidedFindings(g, item.overlay)) setFinding(item.result, f);
}

export function toReport(scan: Scan): Report {
  return {
    v: 1,
    url: scan.url,
    title: scan.title,
    checkedAt: scan.checkedAt,
    appsOnPage: scan.appsOnPage,
    overlays: scan.items.map((i) => i.result),
  };
}
