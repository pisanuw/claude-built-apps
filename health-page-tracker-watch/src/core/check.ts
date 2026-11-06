/**
 * Saving a check and comparing it with the next one.
 *
 * The saved file is small JSON the owner keeps (nothing is stored online).
 * Next month they load it beside a fresh recording and see only what
 * changed: new tools, tools that spread onto more health pages, tools that
 * went away, and vendors whose BAA position changed in our table.
 */
import type { Level, PageRow, Profile, Report } from './analyze';
import { LEVEL_ORDER } from './analyze';
import type { PageKind } from './pages';
import { InputError } from './capture';
import type { BaaStatus } from './vendors';
import { VENDORS } from './vendors';

export const APP_ID = 'health-page-tracker-watch';

export interface SavedTool {
  key: string;
  name: string;
  level: Level;
  baa: BaaStatus | null;
  pages: string[];
  healthPages: string[];
}

export interface SavedCheck {
  app: typeof APP_ID;
  version: 1;
  savedAt: string;
  site: string;
  profile: Profile;
  pages: Array<{ url: string; kind: PageKind }>;
  tools: SavedTool[];
}

export function toSaved(r: Report): SavedCheck {
  return {
    app: APP_ID,
    version: 1,
    savedAt: r.generatedAt,
    site: r.site,
    profile: r.profile,
    pages: r.pages.map((p: PageRow) => ({ url: p.url, kind: p.kind })),
    tools: r.tools.map((t) => ({
      key: t.key,
      name: t.name,
      level: t.level,
      baa: t.baa,
      pages: t.pages.map((p) => p.url),
      healthPages: t.pages.filter((p) => p.health).map((p) => p.url),
    })),
  };
}

export function saveCheck(r: Report): string {
  return JSON.stringify(toSaved(r), null, 2);
}

export function loadCheck(text: string): SavedCheck {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new InputError('This is not a saved check (it is not valid JSON).');
  }
  const d = doc as Partial<SavedCheck> | null;
  if (!d || typeof d !== 'object' || d.app !== APP_ID || !Array.isArray(d.tools) || !Array.isArray(d.pages) || typeof d.site !== 'string') {
    throw new InputError('This file is not a check saved by Health Page Tracker Watch. Use the file from “Save this check”.');
  }
  return d as SavedCheck;
}

export interface CheckDiff {
  previousDate: string;
  sameSite: boolean;
  newTools: Array<{ key: string; name: string; level: Level; healthPages: string[] }>;
  goneTools: Array<{ key: string; name: string }>;
  spread: Array<{ key: string; name: string; newHealthPages: string[] }>;
  worse: Array<{ key: string; name: string; before: Level; after: Level }>;
  baaChanged: Array<{ key: string; name: string; before: BaaStatus | null; after: BaaStatus | null }>;
  /** Pages in the old check that this check did not cover, so absence there means nothing. */
  notRechecked: string[];
}

export function diffChecks(prev: SavedCheck, now: Report): CheckDiff {
  const old = new Map(prev.tools.map((t) => [t.key, t]));
  const cur = new Map(now.tools.map((t) => [t.key, t]));
  const nowPages = new Set(now.pages.map((p) => p.url));
  const d: CheckDiff = {
    previousDate: prev.savedAt.slice(0, 10),
    sameSite: prev.site === now.site,
    newTools: [],
    goneTools: [],
    spread: [],
    worse: [],
    baaChanged: [],
    notRechecked: prev.pages.map((p) => p.url).filter((u) => !nowPages.has(u)),
  };
  for (const t of now.tools) {
    const o = old.get(t.key);
    const healthPages = t.pages.filter((p) => p.health).map((p) => p.url);
    if (!o) {
      d.newTools.push({ key: t.key, name: t.name, level: t.level, healthPages });
      continue;
    }
    const added = healthPages.filter((u) => !o.healthPages.includes(u));
    if (added.length) d.spread.push({ key: t.key, name: t.name, newHealthPages: added });
    if (LEVEL_ORDER.indexOf(t.level) < LEVEL_ORDER.indexOf(o.level)) d.worse.push({ key: t.key, name: t.name, before: o.level, after: t.level });
    if (o.baa !== t.baa) d.baaChanged.push({ key: t.key, name: t.name, before: o.baa, after: t.baa });
  }
  for (const o of prev.tools) {
    if (cur.has(o.key)) continue;
    // Gone only counts if we looked at the same pages again.
    if (o.pages.some((u) => nowPages.has(u))) d.goneTools.push({ key: o.key, name: o.name });
  }
  return d;
}

export function hasChanges(d: CheckDiff): boolean {
  return d.newTools.length + d.goneTools.length + d.spread.length + d.worse.length + d.baaChanged.length > 0;
}

/** Vendors whose table entry changed since a check was saved, even if the tool was not re-seen. */
export function tableUpdatesSince(prev: SavedCheck): Array<{ name: string; before: BaaStatus | null; after: BaaStatus }> {
  const out: Array<{ name: string; before: BaaStatus | null; after: BaaStatus }> = [];
  for (const t of prev.tools) {
    const v = VENDORS[t.key];
    if (v && v.baa !== t.baa) out.push({ name: v.name, before: t.baa, after: v.baa });
  }
  return out;
}
