import { BTreeBuilding } from './btree';
import type { Building } from './building';
import { HashMapBuilding } from './hashmap';
import { compareKeys } from './keys';
import { LruBuilding } from './lru';
import { CostMeter, type MeterReading } from './meter';
import { describeOp } from './narrate';
import { type Command, HELP_TEXT, ParseError, parseCommand } from './parser';
import { SkipListBuilding } from './skiplist';
import { addCost, BUILDING_IDS, type BuildingId, type OpResult } from './types';

export const MAX_KEYS = 40;

export interface Outcome {
  input: string;
  ok: boolean;
  /** Redis-style reply lines. */
  reply: string[];
  /** Per-building result of the data operation, if the command touched data. */
  ops: Partial<Record<BuildingId, OpResult>>;
  /** One sentence per building (and per sweep) for the narration log. */
  narration: string[];
  expired: string[];
  /** True when the command rebuilt the city from scratch. */
  reset: boolean;
}

export interface CityOptions {
  seed?: number;
  lruCapacity?: number;
  minDegree?: number;
  initialBuckets?: number;
}

function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Merge several results from one command (FILL, multi-key DEL) into one. */
export function combine(results: OpResult[]): OpResult {
  const first = results[0];
  const out: OpResult = {
    op: first.op,
    value: first.value,
    cost: results.reduce((c, r) => addCost(c, r.cost), { probes: 0, comparisons: 0, moves: 0 }),
    events: results.flatMap((r) => r.events),
    touched: [...new Set(results.flatMap((r) => r.touched))],
  };
  if (first.op === 'del') out.value = String(results.filter((r) => r.value === '1').length);
  return out;
}

export class City {
  readonly hash: HashMapBuilding;
  readonly btree: BTreeBuilding;
  readonly skip: SkipListBuilding;
  readonly lru: LruBuilding;
  readonly meters: Record<BuildingId, CostMeter>;
  clock = 0;
  private expiries = new Map<string, number>();

  constructor(opts: CityOptions = {}) {
    this.hash = new HashMapBuilding(opts.initialBuckets ?? 4);
    this.btree = new BTreeBuilding(opts.minDegree ?? 2);
    this.skip = new SkipListBuilding(opts.seed ?? 7);
    this.lru = new LruBuilding(opts.lruCapacity ?? 5);
    this.meters = { hash: new CostMeter(), btree: new CostMeter(), skip: new CostMeter(), lru: new CostMeter() };
  }

  building(id: BuildingId): Building {
    return this[id];
  }

  meter(id: BuildingId): MeterReading {
    return this.meters[id].reading();
  }

  /** The hash map is the source of truth for which keys exist (the LRU forgets on purpose). */
  has(key: string): boolean {
    return this.hash.get(key).value !== null;
  }

  ttl(key: string): number {
    if (!this.has(key)) return -2;
    const at = this.expiries.get(key);
    return at === undefined ? -1 : at - this.clock;
  }

  reset(seed = this.skip.currentSeed()): void {
    for (const id of BUILDING_IDS) this.meters[id].reset();
    this.hash.reset();
    this.btree.reset();
    this.skip.reset(seed);
    this.lru.reset();
    this.expiries.clear();
    this.clock = 0;
  }

  private all(fn: (b: Building, id: BuildingId) => OpResult, label: string): Record<BuildingId, OpResult> {
    const out = {} as Record<BuildingId, OpResult>;
    for (const id of BUILDING_IDS) {
      const r = fn(this.building(id), id);
      this.meters[id].record(r.op, r.cost, label);
      out[id] = r;
    }
    return out;
  }

  private narrate(ops: Partial<Record<BuildingId, OpResult>>): string[] {
    return BUILDING_IDS.filter((id) => ops[id]).map((id) => describeOp(id, ops[id] as OpResult));
  }

  execute(input: string): Outcome {
    const base: Outcome = { input, ok: true, reply: [], ops: {}, narration: [], expired: [], reset: false };
    let cmd: Command;
    try {
      cmd = parseCommand(input);
    } catch (e) {
      if (e instanceof ParseError) return { ...base, ok: false, reply: [`(error) ${e.message}`] };
      throw e;
    }
    return this.run(cmd, base);
  }

  private setOne(key: string, value: string, label: string): Record<BuildingId, OpResult> | string {
    if (!this.has(key) && this.hash.size() >= MAX_KEYS) return `(error) the city holds at most ${MAX_KEYS} keys; DEL some or RESET`;
    return this.all((b) => b.set(key, value), label);
  }

  private run(cmd: Command, o: Outcome): Outcome {
    switch (cmd.name) {
      case 'SET': {
        const r = this.setOne(cmd.key, cmd.value, `SET ${cmd.key}`);
        if (typeof r === 'string') return { ...o, ok: false, reply: [r] };
        if (cmd.ex === null) this.expiries.delete(cmd.key);
        else this.expiries.set(cmd.key, this.clock + cmd.ex);
        return { ...o, reply: ['OK'], ops: r, narration: this.narrate(r) };
      }
      case 'GET': {
        const r = this.all((b) => b.get(cmd.key), `GET ${cmd.key}`);
        return { ...o, reply: [r.hash.value === null ? '(nil)' : quote(r.hash.value)], ops: r, narration: this.narrate(r) };
      }
      case 'DEL': {
        const per = cmd.keys.map((k) => this.all((b) => b.del(k), `DEL ${k}`));
        cmd.keys.forEach((k) => this.expiries.delete(k));
        const ops = {} as Record<BuildingId, OpResult>;
        for (const id of BUILDING_IDS) ops[id] = combine(per.map((p) => p[id]));
        return { ...o, reply: [`(integer) ${ops.hash.value}`], ops, narration: this.narrate(ops) };
      }
      case 'FILL': {
        const per: Record<BuildingId, OpResult>[] = [];
        let error: string | null = null;
        for (let i = 1; i <= cmd.count; i++) {
          const key = `${cmd.prefix}${i}`;
          const r = this.setOne(key, String(i), `SET ${key}`);
          if (typeof r === 'string') {
            error = r;
            break;
          }
          this.expiries.delete(key);
          per.push(r);
        }
        if (!per.length) return { ...o, ok: false, reply: [error as string] };
        const ops = {} as Record<BuildingId, OpResult>;
        for (const id of BUILDING_IDS) ops[id] = combine(per.map((p) => p[id]));
        const reply = [`OK (${per.length} keys set)`];
        if (error) reply.push(error);
        return { ...o, ok: !error, reply, ops, narration: this.narrate(ops) };
      }
      case 'RANGE': {
        if (compareKeys(cmd.lo, cmd.hi) > 0) return { ...o, ok: false, reply: ['(error) lo must not be after hi'] };
        const r = this.all((b) => b.range(cmd.lo, cmd.hi), `RANGE ${cmd.lo} ${cmd.hi}`);
        const pairs = r.btree.pairs ?? [];
        const reply = pairs.length ? pairs.map(([k, v], i) => `${i + 1}) ${quote(k)} -> ${quote(v)}`) : ['(empty list)'];
        return { ...o, reply, ops: r, narration: this.narrate(r) };
      }
      case 'EXPIRE': {
        if (!this.has(cmd.key)) return { ...o, reply: ['(integer) 0'] };
        this.expiries.set(cmd.key, this.clock + cmd.ticks);
        return { ...o, reply: ['(integer) 1'], narration: [`"${cmd.key}" will expire at tick ${this.clock + cmd.ticks}.`] };
      }
      case 'TTL':
        return { ...o, reply: [`(integer) ${this.ttl(cmd.key)}`] };
      case 'TICK': {
        this.clock += cmd.ticks;
        const due = [...this.expiries].filter(([, at]) => at <= this.clock).map(([k]) => k);
        due.sort(compareKeys);
        if (!due.length) return { ...o, reply: [`clock = ${this.clock}`], narration: [`Clock advanced to tick ${this.clock}; nothing expired.`] };
        const per = due.map((k) => this.all((b) => b.del(k), `expire ${k}`));
        due.forEach((k) => this.expiries.delete(k));
        const ops = {} as Record<BuildingId, OpResult>;
        for (const id of BUILDING_IDS) ops[id] = combine(per.map((p) => p[id]));
        return {
          ...o,
          reply: [`clock = ${this.clock}`, `expired: ${due.join(', ')}`],
          ops,
          expired: due,
          narration: [`Clock advanced to tick ${this.clock}; expired ${due.join(', ')}.`, ...this.narrate(ops)],
        };
      }
      case 'CAPACITY': {
        const evicted = this.lru.setCapacity(cmd.capacity);
        const msg = evicted.length ? `; evicted ${evicted.join(', ')}` : '';
        return { ...o, reply: [`OK (LRU capacity ${cmd.capacity}${msg})`], narration: [`LRU cache resized to ${cmd.capacity} slots${msg}.`] };
      }
      case 'SEED':
        this.reset(cmd.seed);
        return { ...o, reset: true, reply: [`OK (city reset, skip-list seed ${cmd.seed})`], narration: [`City reset with skip-list seed ${cmd.seed}.`] };
      case 'RESET':
        this.reset();
        return { ...o, reset: true, reply: ['OK (city reset)'], narration: ['City reset: every building is empty and the meters are zero.'] };
      case 'KEYS': {
        const keys = this.btree.keys();
        return { ...o, reply: keys.length ? keys.map((k, i) => `${i + 1}) ${quote(k)}`) : ['(empty list)'] };
      }
      case 'HELP':
        return { ...o, reply: HELP_TEXT.map(([u, d]) => `${u.padEnd(26)} ${d}`) };
    }
  }
}
