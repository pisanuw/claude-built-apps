import type { Building } from './building';
import { compareKeys } from './keys';
import { mulberry32 } from './rng';
import { type CityEvent, type Cost, type OpResult, zeroCost } from './types';

interface SNode {
  key: string;
  value: string;
  next: (SNode | null)[];
}

export interface SkipSnapshot {
  /** Keys in order with the height of each tower. */
  towers: { key: string; value: string; height: number }[];
  levels: number;
  maxLevel: number;
}

/**
 * Skip list with p = 1/2 coin flips from a seeded PRNG, so the same commands
 * and seed always build the same towers.
 */
export class SkipListBuilding implements Building {
  private head!: SNode;
  private level = 1;
  private count = 0;
  private rand: () => number = Math.random;

  constructor(
    private seed = 7,
    readonly maxLevel = 6,
  ) {
    this.reset();
  }

  reset(seed = this.seed): void {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.head = { key: '', value: '', next: new Array(this.maxLevel).fill(null) };
    this.level = 1;
    this.count = 0;
  }

  currentSeed(): number {
    return this.seed;
  }

  size(): number {
    return this.count;
  }

  keys(): string[] {
    const out: string[] = [];
    for (let n = this.head.next[0]; n; n = n.next[0]) out.push(n.key);
    return out;
  }

  snapshot(): SkipSnapshot {
    const towers: SkipSnapshot['towers'] = [];
    for (let n = this.head.next[0]; n; n = n.next[0]) towers.push({ key: n.key, value: n.value, height: n.next.length });
    return { towers, levels: this.level, maxLevel: this.maxLevel };
  }

  private randomLevel(): number {
    let lvl = 1;
    while (lvl < this.maxLevel && this.rand() < 0.5) lvl++;
    return lvl;
  }

  /** Descend from the top level; update[i] is the last node before key on level i. */
  private descend(key: string, cost: Cost): (SNode | null)[] {
    const update: (SNode | null)[] = new Array(this.maxLevel).fill(null);
    let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      for (;;) {
        const nx = x.next[i];
        cost.probes++;
        if (!nx) break;
        cost.comparisons++;
        if (compareKeys(nx.key, key) >= 0) break;
        x = nx;
      }
      update[i] = x;
    }
    return update;
  }

  get(key: string): OpResult {
    const cost = zeroCost();
    const update = this.descend(key, cost);
    const cand = (update[0] as SNode).next[0];
    const hit = cand && cand.key === key ? cand : null;
    return { op: 'get', value: hit ? hit.value : null, cost, events: [], touched: hit ? [key] : [] };
  }

  set(key: string, value: string): OpResult {
    const cost = zeroCost();
    const events: CityEvent[] = [];
    const update = this.descend(key, cost);
    const cand = (update[0] as SNode).next[0];
    if (cand && cand.key === key) {
      cand.value = value;
      return { op: 'set', value: 'OK', cost, events, touched: [key] };
    }
    const lvl = this.randomLevel();
    if (lvl > this.level) {
      for (let i = this.level; i < lvl; i++) update[i] = this.head;
      this.level = lvl;
    }
    const node: SNode = { key, value, next: new Array(lvl).fill(null) };
    for (let i = 0; i < lvl; i++) {
      const prev = update[i] as SNode;
      node.next[i] = prev.next[i];
      prev.next[i] = node;
      cost.moves += 2;
    }
    this.count++;
    if (lvl > 1) events.push({ type: 'promote', key, level: lvl });
    return { op: 'set', value: 'OK', cost, events, touched: [key] };
  }

  del(key: string): OpResult {
    const cost = zeroCost();
    const update = this.descend(key, cost);
    const cand = (update[0] as SNode).next[0];
    if (!cand || cand.key !== key) return { op: 'del', value: '0', cost, events: [], touched: [] };
    for (let i = 0; i < cand.next.length; i++) {
      (update[i] as SNode).next[i] = cand.next[i];
      cost.moves++;
    }
    while (this.level > 1 && this.head.next[this.level - 1] === null) this.level--;
    this.count--;
    return { op: 'del', value: '1', cost, events: [], touched: [key] };
  }

  range(lo: string, hi: string): OpResult {
    const cost = zeroCost();
    const update = this.descend(lo, cost);
    const pairs: [string, string][] = [];
    for (let n = (update[0] as SNode).next[0]; n; n = n.next[0]) {
      cost.probes++;
      cost.comparisons++;
      if (compareKeys(n.key, hi) > 0) break;
      pairs.push([n.key, n.value]);
    }
    return { op: 'range', value: null, pairs, cost, events: [], touched: pairs.map((p) => p[0]) };
  }
}
