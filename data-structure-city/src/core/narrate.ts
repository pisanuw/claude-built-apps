import type { BTreeSnapshot, BNode } from './btree';
import type { HashSnapshot } from './hashmap';
import type { LruSnapshot } from './lru';
import type { SkipSnapshot } from './skiplist';
import { BUILDING_NAMES, type BuildingId, type CityEvent, type OpResult, totalCost } from './types';

export function describeEvent(e: CityEvent): string {
  switch (e.type) {
    case 'rehash':
      return `load factor passed the limit: rehashed from ${e.from} to ${e.to} buckets, moving ${e.moved} entries`;
    case 'chain':
      return `collision: bucket ${e.bucket} now chains ${e.length} entries`;
    case 'split':
      return `a full node split: "${e.median}" moved up, leaving [${e.left.join(', ')}] and [${e.right.join(', ')}]`;
    case 'grow':
      return `the root split, so the tree grew to height ${e.height}`;
    case 'shrink':
      return `the root emptied, so the tree shrank to height ${e.height}`;
    case 'merge':
      return `two underfull nodes merged into [${e.keys.join(', ')}]`;
    case 'borrow':
      return `a node borrowed through its parent from its ${e.from} sibling; "${e.key}" is the new separator`;
    case 'promote':
      return `coin flips promoted "${e.key}" to a tower of height ${e.level}`;
    case 'evict':
      return `cache full: evicted least recently used "${e.key}"`;
    case 'hit':
      return `hit: "${e.key}" moved to the front`;
    case 'miss':
      return `miss: "${e.key}" is not cached`;
    case 'scan':
      return `full scan (${e.reason})`;
  }
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function costPhrase(r: OpResult): string {
  const c = r.cost;
  return `cost ${totalCost(c)} (${plural(c.probes, 'probe')}, ${plural(c.comparisons, 'comparison')}, ${plural(c.moves, 'move')})`;
}

export function describeOp(id: BuildingId, r: OpResult): string {
  const parts = [BUILDING_NAMES[id] + ':'];
  if (r.op === 'get') parts.push(r.value === null ? 'not found,' : `found "${r.value}",`);
  if (r.op === 'del') parts.push(r.value === '1' ? 'removed,' : 'nothing to remove,');
  if (r.op === 'range') parts.push(`${r.pairs?.length ?? 0} keys in range,`);
  parts.push(costPhrase(r));
  let s = parts.join(' ');
  if (r.events.length) s += '. ' + r.events.map(describeEvent).join('; ');
  return s + '.';
}

function describeNode(n: BNode): string {
  if (n.children.length === 0) return `[${n.keys.join(' ')}]`;
  return `[${n.keys.join(' ')}] over ${n.children.map(describeNode).join(' ')}`;
}

/** Plain-text description of a building's current shape, for the narration panel. */
export function describeHash(s: HashSnapshot): string {
  const used = s.buckets.filter((b) => b.length).length;
  const lines = [`${s.size} entries in ${s.buckets.length} buckets (${used} in use), load factor ${s.loadFactor.toFixed(2)} of ${s.maxLoad}.`];
  s.buckets.forEach((b, i) => {
    if (b.length) lines.push(`Bucket ${i}: ${b.map((e) => e.key).join(', ')}.`);
  });
  return lines.join(' ');
}

export function describeBTree(s: BTreeSnapshot): string {
  if (s.root.keys.length === 0) return `Empty, minimum degree ${s.minDegree}.`;
  return `Height ${s.height}, minimum degree ${s.minDegree}. ${describeNode(s.root)}.`;
}

export function describeSkip(s: SkipSnapshot): string {
  if (!s.towers.length) return `Empty, ${s.levels} level in use.`;
  const lines = [`${s.towers.length} keys on ${s.levels} levels.`];
  for (let lvl = s.levels; lvl >= 1; lvl--) {
    lines.push(`Level ${lvl}: ${s.towers.filter((t) => t.height >= lvl).map((t) => t.key).join(', ')}.`);
  }
  return lines.join(' ');
}

export function describeLru(s: LruSnapshot): string {
  if (!s.order.length) return `Empty, capacity ${s.capacity}.`;
  return `${s.order.length} of ${s.capacity} slots, most recent first: ${s.order.map((e) => e.key).join(', ')}.`;
}
