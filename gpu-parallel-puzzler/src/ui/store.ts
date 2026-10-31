import type { Launch } from '../core/gpu';

export interface LevelProgress {
  code: string;
  launch: Launch;
  stars: number;
  bestCycles: number | null;
  attempts: number;
}

export type Progress = Record<string, LevelProgress>;

const KEY = 'gpu-parallel-puzzler:v1';
const NAME_KEY = 'gpu-parallel-puzzler:name';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === 'object' ? (p as Progress) : {};
  } catch {
    return {};
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable; progress then lasts for this visit only */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function download(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
