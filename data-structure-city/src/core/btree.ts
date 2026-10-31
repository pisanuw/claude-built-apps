import type { Building } from './building';
import { compareKeys } from './keys';
import { type CityEvent, type Cost, type OpResult, zeroCost } from './types';

export interface BNode {
  id: number;
  keys: string[];
  vals: string[];
  children: BNode[];
}

export interface BTreeSnapshot {
  root: BNode;
  height: number;
  minDegree: number;
}

function isLeaf(n: BNode): boolean {
  return n.children.length === 0;
}

function cloneNode(n: BNode): BNode {
  return { id: n.id, keys: [...n.keys], vals: [...n.vals], children: n.children.map(cloneNode) };
}

/**
 * CLRS-style B-tree with minimum degree t: every node except the root holds
 * between t-1 and 2t-1 keys. Insert splits full nodes on the way down; delete
 * borrows from or merges with a sibling on the way down so it never has to
 * back up. The default t = 2 is a 2-3-4 tree, which splits often enough to see.
 */
export class BTreeBuilding implements Building {
  private root!: BNode;
  private nextId = 0;
  private count = 0;
  private cost: Cost = zeroCost();
  private events: CityEvent[] = [];
  private touched = new Set<string>();

  constructor(readonly t = 2) {
    if (t < 2) throw new Error('minimum degree must be at least 2');
    this.reset();
  }

  reset(): void {
    this.nextId = 0;
    this.root = this.node();
    this.count = 0;
  }

  private node(): BNode {
    return { id: this.nextId++, keys: [], vals: [], children: [] };
  }

  private begin(): void {
    this.cost = zeroCost();
    this.events = [];
    this.touched = new Set();
  }

  private finish(op: OpResult['op'], value: string | null, pairs?: [string, string][]): OpResult {
    const r: OpResult = { op, value, cost: this.cost, events: this.events, touched: [...this.touched] };
    if (pairs) r.pairs = pairs;
    return r;
  }

  size(): number {
    return this.count;
  }

  height(): number {
    let h = 1;
    for (let n = this.root; !isLeaf(n); n = n.children[0]) h++;
    return h;
  }

  keys(): string[] {
    const out: string[] = [];
    const walk = (n: BNode): void => {
      n.keys.forEach((k, i) => {
        if (!isLeaf(n)) walk(n.children[i]);
        out.push(k);
      });
      if (!isLeaf(n)) walk(n.children[n.keys.length]);
    };
    walk(this.root);
    return out;
  }

  snapshot(): BTreeSnapshot {
    return { root: cloneNode(this.root), height: this.height(), minDegree: this.t };
  }

  /** Index of the first key >= k in n, counting comparisons. */
  private lowerBound(n: BNode, k: string): number {
    this.cost.probes++;
    let i = 0;
    while (i < n.keys.length) {
      this.cost.comparisons++;
      if (compareKeys(n.keys[i], k) >= 0) break;
      i++;
    }
    return i;
  }

  private search(k: string): { node: BNode; index: number } | null {
    let n = this.root;
    for (;;) {
      const i = this.lowerBound(n, k);
      if (i < n.keys.length && n.keys[i] === k) return { node: n, index: i };
      if (isLeaf(n)) return null;
      n = n.children[i];
    }
  }

  get(key: string): OpResult {
    this.begin();
    const hit = this.search(key);
    if (hit) this.touched.add(key);
    return this.finish('get', hit ? hit.node.vals[hit.index] : null);
  }

  set(key: string, value: string): OpResult {
    this.begin();
    const hit = this.search(key);
    this.touched.add(key);
    if (hit) {
      hit.node.vals[hit.index] = value;
      return this.finish('set', 'OK');
    }
    this.cost = zeroCost(); // the real insert re-descends; count that path only
    const max = 2 * this.t - 1;
    if (this.root.keys.length === max) {
      const s = this.node();
      s.children.push(this.root);
      this.root = s;
      this.splitChild(s, 0);
      this.events.push({ type: 'grow', height: this.height() });
    }
    this.insertNonFull(this.root, key, value);
    this.count++;
    return this.finish('set', 'OK');
  }

  private splitChild(x: BNode, i: number): void {
    const t = this.t;
    const y = x.children[i];
    const z = this.node();
    const median = y.keys[t - 1];
    const medianVal = y.vals[t - 1];
    z.keys = y.keys.splice(t);
    z.vals = y.vals.splice(t);
    y.keys.pop();
    y.vals.pop();
    if (!isLeaf(y)) z.children = y.children.splice(t);
    x.keys.splice(i, 0, median);
    x.vals.splice(i, 0, medianVal);
    x.children.splice(i + 1, 0, z);
    this.cost.moves += t; // t-1 keys to the new sibling, plus the median up
    this.touched.add(median);
    z.keys.forEach((k) => this.touched.add(k));
    this.events.push({ type: 'split', median, left: [...y.keys], right: [...z.keys] });
  }

  private insertNonFull(x: BNode, k: string, v: string): void {
    let i = this.lowerBound(x, k);
    if (isLeaf(x)) {
      this.cost.moves += x.keys.length - i + 1; // shift the tail right, write the new key
      x.keys.splice(i, 0, k);
      x.vals.splice(i, 0, v);
      return;
    }
    if (x.children[i].keys.length === 2 * this.t - 1) {
      this.splitChild(x, i);
      this.cost.comparisons++;
      if (compareKeys(k, x.keys[i]) > 0) i++;
    }
    this.insertNonFull(x.children[i], k, v);
  }

  del(key: string): OpResult {
    this.begin();
    if (!this.search(key)) return this.finish('del', '0');
    this.cost = zeroCost();
    this.touched.add(key);
    this.remove(this.root, key);
    this.count--;
    if (this.root.keys.length === 0 && !isLeaf(this.root)) {
      this.root = this.root.children[0];
      this.events.push({ type: 'shrink', height: this.height() });
    }
    return this.finish('del', '1');
  }

  private remove(x: BNode, k: string): void {
    const t = this.t;
    let i = this.lowerBound(x, k);
    if (i < x.keys.length && x.keys[i] === k) {
      if (isLeaf(x)) {
        this.cost.moves += x.keys.length - i - 1;
        x.keys.splice(i, 1);
        x.vals.splice(i, 1);
        return;
      }
      const left = x.children[i];
      const right = x.children[i + 1];
      if (left.keys.length >= t) {
        const [pk, pv] = this.extreme(left, 'max');
        x.keys[i] = pk;
        x.vals[i] = pv;
        this.cost.moves++;
        this.touched.add(pk);
        this.remove(left, pk);
      } else if (right.keys.length >= t) {
        const [sk, sv] = this.extreme(right, 'min');
        x.keys[i] = sk;
        x.vals[i] = sv;
        this.cost.moves++;
        this.touched.add(sk);
        this.remove(right, sk);
      } else {
        this.merge(x, i);
        this.remove(left, k);
      }
      return;
    }
    // Key is not in this node, so it is in subtree i, which must have >= t keys before we descend.
    const child = x.children[i];
    if (child.keys.length < t) {
      const leftSib = i > 0 ? x.children[i - 1] : null;
      const rightSib = i < x.keys.length ? x.children[i + 1] : null;
      if (leftSib && leftSib.keys.length >= t) {
        this.borrowLeft(x, i);
      } else if (rightSib && rightSib.keys.length >= t) {
        this.borrowRight(x, i);
      } else if (rightSib) {
        this.merge(x, i);
      } else {
        this.merge(x, i - 1);
        i--;
      }
    }
    this.remove(x.children[i], k);
  }

  private extreme(n: BNode, which: 'min' | 'max'): [string, string] {
    while (!isLeaf(n)) {
      this.cost.probes++;
      n = which === 'max' ? n.children[n.children.length - 1] : n.children[0];
    }
    this.cost.probes++;
    const j = which === 'max' ? n.keys.length - 1 : 0;
    return [n.keys[j], n.vals[j]];
  }

  /** Fold x.keys[i] and children i+1 into child i. */
  private merge(x: BNode, i: number): void {
    const a = x.children[i];
    const b = x.children[i + 1];
    a.keys.push(x.keys[i], ...b.keys);
    a.vals.push(x.vals[i], ...b.vals);
    a.children.push(...b.children);
    this.cost.moves += 1 + b.keys.length;
    x.keys.splice(i, 1);
    x.vals.splice(i, 1);
    x.children.splice(i + 1, 1);
    a.keys.forEach((k) => this.touched.add(k));
    this.events.push({ type: 'merge', keys: [...a.keys] });
  }

  private borrowLeft(x: BNode, i: number): void {
    const c = x.children[i];
    const l = x.children[i - 1];
    c.keys.unshift(x.keys[i - 1]);
    c.vals.unshift(x.vals[i - 1]);
    if (!isLeaf(l)) c.children.unshift(l.children.pop() as BNode);
    x.keys[i - 1] = l.keys.pop() as string;
    x.vals[i - 1] = l.vals.pop() as string;
    this.cost.moves += 2 + c.keys.length - 1;
    this.touched.add(c.keys[0]);
    this.touched.add(x.keys[i - 1]);
    this.events.push({ type: 'borrow', key: x.keys[i - 1], from: 'left' });
  }

  private borrowRight(x: BNode, i: number): void {
    const c = x.children[i];
    const r = x.children[i + 1];
    c.keys.push(x.keys[i]);
    c.vals.push(x.vals[i]);
    if (!isLeaf(r)) c.children.push(r.children.shift() as BNode);
    x.keys[i] = r.keys.shift() as string;
    x.vals[i] = r.vals.shift() as string;
    this.cost.moves += 2 + r.keys.length;
    this.touched.add(c.keys[c.keys.length - 1]);
    this.touched.add(x.keys[i]);
    this.events.push({ type: 'borrow', key: x.keys[i], from: 'right' });
  }

  range(lo: string, hi: string): OpResult {
    this.begin();
    const pairs: [string, string][] = [];
    const walk = (n: BNode): void => {
      const i0 = this.lowerBound(n, lo);
      for (let i = i0; i <= n.keys.length; i++) {
        if (!isLeaf(n)) walk(n.children[i]);
        if (i === n.keys.length) break;
        this.cost.comparisons++;
        if (compareKeys(n.keys[i], hi) > 0) return;
        pairs.push([n.keys[i], n.vals[i]]);
      }
    };
    walk(this.root);
    pairs.forEach((p) => this.touched.add(p[0]));
    return this.finish('range', null, pairs);
  }

  /** Check every B-tree invariant; returns a list of violations (empty when healthy). */
  validate(): string[] {
    const errs: string[] = [];
    const t = this.t;
    let leafDepth = -1;
    const walk = (n: BNode, depth: number, lo: string | null, hi: string | null): void => {
      const isRoot = n === this.root;
      if (n.keys.length > 2 * t - 1) errs.push(`node ${n.id} has ${n.keys.length} keys`);
      if (!isRoot && n.keys.length < t - 1) errs.push(`node ${n.id} underfull`);
      for (let i = 1; i < n.keys.length; i++) if (compareKeys(n.keys[i - 1], n.keys[i]) >= 0) errs.push(`node ${n.id} out of order`);
      for (const k of n.keys) {
        if (lo !== null && compareKeys(k, lo) <= 0) errs.push(`key ${k} below bound`);
        if (hi !== null && compareKeys(k, hi) >= 0) errs.push(`key ${k} above bound`);
      }
      if (isLeaf(n)) {
        if (leafDepth === -1) leafDepth = depth;
        else if (leafDepth !== depth) errs.push('leaves at different depths');
        return;
      }
      if (n.children.length !== n.keys.length + 1) errs.push(`node ${n.id} child count`);
      n.children.forEach((c, i) => walk(c, depth + 1, i === 0 ? lo : n.keys[i - 1], i === n.keys.length ? hi : n.keys[i]));
    };
    walk(this.root, 0, null, null);
    return errs;
  }
}
