/** App state shared by the tabs: the brain roster, the experiment log and the last ladder run. */
import samples from '../data/sample-brains.json';
import type { GameRecord } from '../core/match';
import type { LadderResult } from '../core/ladder';
import { type BrainFile, compileBrain, type Net, validateBrain } from '../core/net';
import type { RunRecord } from '../core/experiments';
import type { EvalResult } from '../core/train';

export interface BrainEntry {
  id: string;
  file: BrainFile;
  params: number;
  source: 'sample' | 'trained' | 'uploaded';
  addedAt: string;
  eval?: EvalResult;
}

export interface ReplayRequest {
  game: GameRecord;
  names: Record<string, string>;
}

const KEY_BRAINS = 'tbl:brains:v1';
const KEY_RUNS = 'tbl:runs:v1';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the session still works, it just will not persist */
  }
}

const sampleEntries: BrainEntry[] = (samples as unknown as BrainFile[]).map((file) => ({
  id: `sample:${file.name}`,
  file,
  params: validateBrain(file).params,
  source: 'sample',
  addedAt: '2026-10-31',
  eval: typeof file.meta?.vsRandom === 'number' && typeof file.meta?.vsScripted === 'number' ? { vsRandom: file.meta.vsRandom, vsScripted: file.meta.vsScripted } : undefined,
}));

type Listener = () => void;
const listeners = new Set<Listener>();

export const state = {
  brains: [...sampleEntries, ...load<BrainEntry[]>(KEY_BRAINS, []).filter((b) => validateBrain(b.file).ok)],
  runs: load<RunRecord[]>(KEY_RUNS, []),
  ladder: null as LadderResult | null,
  replay: null as ReplayRequest | null,
};

const netCache = new Map<string, Net>();

export function netFor(id: string): Net | null {
  const entry = state.brains.find((b) => b.id === id);
  if (!entry) return null;
  let net = netCache.get(id);
  if (!net) {
    net = compileBrain(entry.file);
    netCache.set(id, net);
  }
  return net;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  save(KEY_BRAINS, state.brains.filter((b) => b.source !== 'sample'));
  save(KEY_RUNS, state.runs);
  listeners.forEach((fn) => fn());
}

export function uniqueName(name: string): string {
  const taken = new Set(state.brains.map((b) => b.file.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const n = `${name.slice(0, 36)}-${i}`;
    if (!taken.has(n)) return n;
  }
}

export function addBrain(file: BrainFile, source: BrainEntry['source'], params: number, evalResult?: EvalResult): BrainEntry {
  const entry: BrainEntry = { id: `${source}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`, file, params, source, addedAt: new Date().toISOString().slice(0, 10), eval: evalResult };
  state.brains.push(entry);
  notify();
  return entry;
}

export function removeBrain(id: string): void {
  state.brains = state.brains.filter((b) => b.id !== id || b.source === 'sample');
  netCache.delete(id);
  notify();
}

export function download(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brain';
}
