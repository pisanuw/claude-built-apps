/**
 * Comparing a new check with an earlier saved one: which leaks are new, which
 * are gone, and which plugins changed version in between. A plugin that both
 * changed version and is named on a new leak is the prime suspect.
 */
import type { Finding, Mode, ScanReport } from './analyze';

export interface PluginChange {
  slug: string;
  label: string;
  before: string[];
  after: string[];
  change: 'updated' | 'added' | 'removed';
}

export interface Suspect {
  slug: string;
  label: string;
  vendor: string;
  before: string[];
  after: string[];
}

export interface ScanDiff {
  site: string;
  mode: Mode;
  sameSite: boolean;
  sameMode: boolean;
  newLeaks: Finding[];
  fixedLeaks: Finding[];
  stillLeaking: Finding[];
  /** Cookie or request names that are new within a vendor that was already leaking. */
  newEvidence: Array<{ vendor: string; names: string[] }>;
  pluginChanges: PluginChange[];
  suspects: Suspect[];
}

function leaks(r: ScanReport): Map<string, Finding> {
  return new Map(r.findings.filter((f) => f.severity === 'leak').map((f) => [f.vendorId, f]));
}

function sameVersions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export function diffReports(before: ScanReport, after: ScanReport): ScanDiff {
  const b = leaks(before);
  const a = leaks(after);
  const newLeaks = [...a.values()].filter((f) => !b.has(f.vendorId));
  const fixedLeaks = [...b.values()].filter((f) => !a.has(f.vendorId));
  const stillLeaking = [...a.values()].filter((f) => b.has(f.vendorId));

  const newEvidence: ScanDiff['newEvidence'] = [];
  for (const f of stillLeaking) {
    const old = new Set((b.get(f.vendorId) as Finding).evidence.filter((e) => e.leak).map((e) => e.name));
    const names = [...new Set(f.evidence.filter((e) => e.leak && !old.has(e.name)).map((e) => e.name))];
    if (names.length) newEvidence.push({ vendor: f.vendor, names });
  }

  const key = (p: { kind: string; slug: string }) => `${p.kind}:${p.slug}`;
  const pb = new Map(before.plugins.map((p) => [key(p), p]));
  const pa = new Map(after.plugins.map((p) => [key(p), p]));
  const pluginChanges: PluginChange[] = [];
  for (const [k, p] of pa) {
    const old = pb.get(k);
    if (!old) pluginChanges.push({ slug: p.slug, label: p.label, before: [], after: p.versions, change: 'added' });
    else if (!sameVersions(old.versions, p.versions)) pluginChanges.push({ slug: p.slug, label: p.label, before: old.versions, after: p.versions, change: 'updated' });
  }
  for (const [k, p] of pb) {
    if (!pa.has(k)) pluginChanges.push({ slug: p.slug, label: p.label, before: p.versions, after: [], change: 'removed' });
  }
  pluginChanges.sort((x, y) => x.label.localeCompare(y.label));

  const suspects: Suspect[] = [];
  const changed = new Map(pluginChanges.filter((c) => c.change !== 'removed').map((c) => [c.slug, c]));
  const worse = [...newLeaks, ...stillLeaking.filter((f) => newEvidence.some((n) => n.vendor === f.vendor))];
  for (const f of worse) {
    for (const at of f.attributions) {
      const c = at.slug ? changed.get(at.slug) : undefined;
      if (c) suspects.push({ slug: c.slug, label: c.label, vendor: f.vendor, before: c.before, after: c.after });
    }
  }

  return {
    site: after.site,
    mode: after.mode,
    sameSite: before.site === after.site,
    sameMode: before.mode === after.mode,
    newLeaks,
    fixedLeaks,
    stillLeaking,
    newEvidence,
    pluginChanges,
    suspects,
  };
}
