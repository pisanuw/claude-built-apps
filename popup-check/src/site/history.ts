/** Past reports, kept in this browser only. */
import { hostOf } from '../engine/report';
import type { Report } from '../engine/types';

export const HISTORY_KEY = 'popup-check:history:v1';
const MAX = 60;

export function loadHistory(storage: Storage | null): Report[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((r): r is Report => !!r && (r as Report).v === 1 && Array.isArray((r as Report).overlays)) : [];
  } catch {
    return [];
  }
}

function save(storage: Storage | null, list: Report[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX)));
    return true;
  } catch {
    return false;
  }
}

const same = (a: Report, b: Report): boolean => a.url === b.url && a.checkedAt === b.checkedAt;

/** Add a report (newest first); a report already kept is replaced, not duplicated. */
export function addToHistory(storage: Storage | null, r: Report): Report[] {
  const list = [r, ...loadHistory(storage).filter((x) => !same(x, r))];
  list.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  save(storage, list);
  return list;
}

export function removeFromHistory(storage: Storage | null, r: Report): Report[] {
  const list = loadHistory(storage).filter((x) => !same(x, r));
  save(storage, list);
  return list;
}

/** The most recent earlier report for the same store. */
export function previousFor(list: Report[], r: Report): Report | undefined {
  const host = hostOf(r.url);
  return list.filter((x) => hostOf(x.url) === host && x.checkedAt < r.checkedAt).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
}
