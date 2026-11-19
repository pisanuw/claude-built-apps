/**
 * The LaTeX Project's tagging status, as converted into
 * src/data/tagging-status.json, and the mapping from its five status words
 * to the report's groups (AC-62).
 */

export type Group = 'blocker' | 'warning' | 'unknown' | 'ok';

export type StatusWord = 'no-support' | 'currently-incompatible' | 'partially-compatible' | 'compatible' | 'unchecked';

export interface StatusEntry {
  name: string;
  type: 'package' | 'class' | 'library';
  status: string;
  group: Group;
  link: string;
  comment?: string;
  subpackages?: string[];
}

export interface StatusData {
  asOf: string;
  latestEntryUpdate: string;
  source: {
    name: string;
    url: string;
    page: string;
    commit: string;
    retrieved: string;
    note: string;
    licence: string;
  };
  entries: StatusEntry[];
}

/** AC-62: the source's own words, mapped to the report's groups. Anything else is unknown. */
export function groupOf(status: string | undefined): Group {
  switch (status) {
    case 'no-support':
    case 'currently-incompatible':
      return 'blocker';
    case 'partially-compatible':
      return 'warning';
    case 'compatible':
      return 'ok';
    default:
      return 'unknown';
  }
}

export interface Lookup {
  entry: StatusEntry;
  /** Set when the name was found as a subpackage of `entry`. */
  via?: string;
}

export class StatusIndex {
  private readonly byType = new Map<string, Map<string, StatusEntry>>();
  private readonly subOf = new Map<string, StatusEntry>();

  constructor(readonly data: StatusData) {
    for (const e of data.entries) {
      let m = this.byType.get(e.type);
      if (!m) this.byType.set(e.type, (m = new Map()));
      if (!m.has(e.name)) m.set(e.name, e);
      for (const sub of e.subpackages ?? []) if (!this.subOf.has(sub)) this.subOf.set(sub, e);
    }
  }

  /**
   * Looks a name up as the given type first, then as any other type, then as
   * a subpackage (which counts as its parent, AC-62). Null means unknown.
   */
  lookup(name: string, type: 'package' | 'class' | 'library'): Lookup | null {
    const own = this.byType.get(type)?.get(name);
    if (own) return { entry: own };
    if (type !== 'library') {
      for (const t of ['package', 'class']) {
        const other = this.byType.get(t)?.get(name);
        if (other) return { entry: other };
      }
    }
    const parent = this.subOf.get(name);
    if (parent) return { entry: parent, via: name };
    return null;
  }
}

let cached: Promise<StatusIndex> | null = null;

/** Loads the data file once, as its own chunk, so the first page stays small. */
export function loadStatus(): Promise<StatusIndex> {
  cached ??= import('../data/tagging-status.json').then((m) => new StatusIndex((m.default ?? m) as unknown as StatusData));
  return cached;
}
