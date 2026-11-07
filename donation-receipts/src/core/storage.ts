/** Keep the books in this browser. Storage can be blocked (private windows), so every access is guarded. */
import { emptyData, validateData, type AppData } from './model';

export const STORAGE_KEY = 'donation-receipts:v1';

export function loadData(store: Pick<Storage, 'getItem'> | null): AppData {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (raw) return validateData(JSON.parse(raw));
  } catch {
    // fall through to a fresh start
  }
  return emptyData();
}

/** Returns false when the browser refused to save (full or blocked). */
export function saveData(store: Pick<Storage, 'setItem'> | null, data: AppData): boolean {
  try {
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
