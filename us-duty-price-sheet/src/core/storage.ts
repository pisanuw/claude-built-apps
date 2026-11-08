import { defaultSettings, emptyCatalog, newProduct, type Catalog, type Product, type Settings, type SnapshotItem } from './model';

export const STORAGE_KEY = 'us-duty-price-sheet:v1';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

function readSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const bands = Array.isArray(r.bands)
    ? r.bands
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b, i) => ({ id: str(b.id, `b${i + 1}`), name: str(b.name, `Band ${i + 1}`), maxGrams: num(b.maxGrams, 0), price: num(b.price, 0) }))
    : d.bands;
  const endings = ['0.99', '0.95', '0.50', '0.00', 'none'];
  return {
    shopName: str(r.shopName),
    usdPerGbp: num(r.usdPerGbp, d.usdPerGbp) || d.usdPerGbp,
    handlingFee: num(r.handlingFee, d.handlingFee),
    packagingGrams: num(r.packagingGrams, d.packagingGrams),
    mode: r.mode === 'price' ? 'price' : 'postage',
    priceEnding: endings.includes(r.priceEnding as string) ? (r.priceEnding as Settings['priceEnding']) : d.priceEnding,
    postageStep: num(r.postageStep, d.postageStep),
    bands,
    bandsAreExample: typeof r.bandsAreExample === 'boolean' ? r.bandsAreExample : false,
    layerOverride: typeof r.layerOverride === 'number' && Number.isFinite(r.layerOverride) ? r.layerOverride : null,
  };
}

function readProduct(raw: unknown): Product | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const c = r.confirmed as Record<string, unknown> | null | undefined;
  return newProduct({
    id: str(r.id) || undefined,
    title: str(r.title),
    sku: str(r.sku),
    categoryId: str(r.categoryId),
    grams: num(r.grams, 0),
    price: num(r.price, 0),
    code: str(r.code),
    confirmed: c && typeof c === 'object' ? { code: str(c.code), general: str(c.general), revision: str(c.revision), on: str(c.on) } : null,
    ukMade: r.ukMade !== false,
    layerExempt: r.layerExempt === true,
    manualRate: typeof r.manualRate === 'number' && Number.isFinite(r.manualRate) ? r.manualRate : null,
    notes: str(r.notes),
  });
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readSnapshotItem(raw: unknown): SnapshotItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.productId !== 'string') return null;
  return {
    productId: r.productId, title: str(r.title), code: str(r.code), general: str(r.general),
    dutyPercent: numOrNull(r.dutyPercent), usPrice: numOrNull(r.usPrice), usPostage: numOrNull(r.usPostage),
    extraItemPostage: numOrNull(r.extraItemPostage),
  };
}

/** Reads a saved or backed-up catalogue, tolerating missing or odd fields. Throws on non-JSON. */
export function parseCatalog(text: string): Catalog {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.products)) throw new Error('This file is not a US Duty Price Sheet backup.');
  const cat = emptyCatalog();
  cat.settings = readSettings(raw.settings);
  cat.products = raw.products.map(readProduct).filter((p): p is Product => p !== null);
  const s = raw.snapshot as Record<string, unknown> | null | undefined;
  if (s && typeof s === 'object' && Array.isArray(s.items)) {
    cat.snapshot = { on: str(s.on), revision: str(s.revision), layer: num(s.layer, 10), items: s.items.map(readSnapshotItem).filter((i): i is SnapshotItem => i !== null) };
  }
  cat.lastSeenRevision = typeof raw.lastSeenRevision === 'string' ? raw.lastSeenRevision : null;
  return cat;
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function load(store: Store | null): { catalog: Catalog | null; error: string | null } {
  if (!store) return { catalog: null, error: null };
  try {
    const text = store.getItem(STORAGE_KEY);
    if (!text) return { catalog: null, error: null };
    return { catalog: parseCatalog(text), error: null };
  } catch (e) {
    return { catalog: null, error: (e as Error).message };
  }
}

/** Returns false when the browser refuses to save (private window, storage full). */
export function save(store: Store | null, catalog: Catalog): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(catalog));
    return true;
  } catch {
    return false;
  }
}

export function browserStore(): Store | null {
  try {
    const s = globalThis.localStorage;
    const k = `${STORAGE_KEY}:probe`;
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
