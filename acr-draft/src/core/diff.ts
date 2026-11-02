import { evaluate, type Conformance } from './conformance';
import type { Project } from './project';

export interface LevelChange {
  id: string;
  name: string;
  from: Conformance;
  to: Conformance;
  direction: 'better' | 'worse' | 'changed';
}

export interface RuleChange {
  ruleId: string;
  help: string;
  /** Affected elements across all screens. */
  from: number;
  to: number;
  status: 'new' | 'fixed' | 'more' | 'fewer';
}

export interface ProjectDiff {
  fromLabel: string;
  toLabel: string;
  levelChanges: LevelChange[];
  ruleChanges: RuleChange[];
  screensAdded: string[];
  screensRemoved: string[];
  unchanged: number;
}

const RANK: Partial<Record<Conformance, number>> = {
  'Does Not Support': 1,
  'Partially Supports': 2,
  Supports: 3,
};

function label(p: Project): string {
  const v = [p.product.name, p.product.version].filter((x) => x.trim()).join(' ');
  const when = p.product.reportDate || p.savedAt.slice(0, 10);
  return [v || 'Untitled product', when ? `(${when})` : ''].filter(Boolean).join(' ');
}

function violationTotals(p: Project): Map<string, { help: string; nodes: number }> {
  const out = new Map<string, { help: string; nodes: number }>();
  for (const s of p.screens) {
    for (const r of s.scan?.rules ?? []) {
      if (r.outcome !== 'violation') continue;
      const cur = out.get(r.id) ?? { help: r.help, nodes: 0 };
      cur.nodes += r.nodes;
      out.set(r.id, cur);
    }
  }
  return out;
}

/** What changed between an earlier project file (`before`) and the current one (`after`). */
export function diffProjects(before: Project, after: Project): ProjectDiff {
  const a = evaluate(before).results;
  const b = evaluate(after).results;
  const levelChanges: LevelChange[] = [];
  let unchanged = 0;
  b.forEach((r, i) => {
    const from = a[i].level;
    const to = r.level;
    if (from === to) {
      unchanged += 1;
      return;
    }
    const rf = RANK[from];
    const rt = RANK[to];
    const direction = rf !== undefined && rt !== undefined ? (rt > rf ? 'better' : 'worse') : 'changed';
    levelChanges.push({ id: r.criterion.id, name: r.criterion.name, from, to, direction });
  });
  const va = violationTotals(before);
  const vb = violationTotals(after);
  const ruleChanges: RuleChange[] = [];
  for (const id of new Set([...va.keys(), ...vb.keys()])) {
    const from = va.get(id)?.nodes ?? 0;
    const to = vb.get(id)?.nodes ?? 0;
    if (from === to && va.has(id) === vb.has(id)) continue;
    const help = (vb.get(id) ?? va.get(id))!.help;
    const status = !va.has(id) ? 'new' : !vb.has(id) ? 'fixed' : to > from ? 'more' : 'fewer';
    ruleChanges.push({ ruleId: id, help, from, to, status });
  }
  const order = { new: 0, more: 1, fewer: 2, fixed: 3 };
  ruleChanges.sort((x, y) => order[x.status] - order[y.status] || x.ruleId.localeCompare(y.ruleId));
  const namesA = new Set(before.screens.map((s) => s.name));
  const namesB = new Set(after.screens.map((s) => s.name));
  return {
    fromLabel: label(before),
    toLabel: label(after),
    levelChanges,
    ruleChanges,
    screensAdded: [...namesB].filter((n) => !namesA.has(n)),
    screensRemoved: [...namesA].filter((n) => !namesB.has(n)),
    unchanged,
  };
}
