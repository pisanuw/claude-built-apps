export type PriceEnding = '0.99' | '0.95' | '0.50' | '0.00' | 'none';
export type Mode = 'price' | 'postage';

export interface Band {
  id: string;
  name: string;
  /** Upper weight limit in grams (parcel weight, including packaging). */
  maxGrams: number;
  /** Label price in GBP. */
  price: number;
}

export interface Settings {
  shopName: string;
  /** How many US dollars one pound buys, for dollar prices and per-kg duties. */
  usdPerGbp: number;
  /** Per-parcel handling fee Royal Mail adds to duty-paid US parcels, GBP. */
  handlingFee: number;
  /** Packaging weight added to each product, grams. */
  packagingGrams: number;
  /** Which way the maker passes duty on: in the US item price, or in US postage. */
  mode: Mode;
  /** Round US item prices up to this ending. */
  priceEnding: PriceEnding;
  /** Round US postage up to a multiple of this many pounds (0 = to the penny). */
  postageStep: number;
  bands: Band[];
  /** True until the maker changes the example postage bands. */
  bandsAreExample: boolean;
  /** Override for the UK layer percentage; null uses the bundled figure. */
  layerOverride: number | null;
}

export interface Confirmation {
  code: string;
  general: string;
  revision: string;
  on: string;
}

export interface Product {
  id: string;
  title: string;
  sku: string;
  categoryId: string;
  /** Product weight in grams (packaging is added from settings). */
  grams: number;
  /** Normal UK selling price in GBP. */
  price: number;
  /** US 10-digit code, formatted or not. */
  code: string;
  confirmed: Confirmation | null;
  /** Made in the UK: the UK layer applies. */
  ukMade: boolean;
  /** Maker has confirmed this product is exempt from the UK layer. */
  layerExempt: boolean;
  /** The code's general rate (percent) set by hand, used instead of the data; the UK layer is still added. */
  manualRate: number | null;
  notes: string;
}

/** What the shop showed for a product when the maker last said "my shop is up to date". */
export interface SnapshotItem {
  productId: string;
  title: string;
  code: string;
  general: string;
  dutyPercent: number | null;
  usPrice: number | null;
  usPostage: number | null;
  extraItemPostage: number | null;
}

export interface Snapshot {
  on: string;
  revision: string;
  layer: number;
  items: SnapshotItem[];
}

export interface Catalog {
  version: 1;
  settings: Settings;
  products: Product[];
  snapshot: Snapshot | null;
  /** Tariff data revision the maker last opened the app with. */
  lastSeenRevision: string | null;
}

export function defaultSettings(): Settings {
  return {
    shopName: '',
    usdPerGbp: 1.3,
    handlingFee: 0.5,
    packagingGrams: 60,
    mode: 'postage',
    priceEnding: '0.00',
    postageStep: 0.5,
    bands: exampleBands(),
    bandsAreExample: true,
    layerOverride: null,
  };
}

/**
 * Starting bands so the sheet has something to show. They are NOT Royal Mail's
 * prices: the maker replaces them with what Click & Drop charges them.
 */
export function exampleBands(): Band[] {
  return [
    { id: 'b1', name: 'Large letter up to 100 g', maxGrams: 100, price: 8.0 },
    { id: 'b2', name: 'Small parcel up to 250 g', maxGrams: 250, price: 12.0 },
    { id: 'b3', name: 'Small parcel up to 500 g', maxGrams: 500, price: 14.5 },
    { id: 'b4', name: 'Small parcel up to 750 g', maxGrams: 750, price: 16.5 },
    { id: 'b5', name: 'Small parcel up to 1 kg', maxGrams: 1000, price: 18.0 },
    { id: 'b6', name: 'Small parcel up to 2 kg', maxGrams: 2000, price: 21.0 },
  ];
}

export function emptyCatalog(): Catalog {
  return { version: 1, settings: defaultSettings(), products: [], snapshot: null, lastSeenRevision: null };
}

let counter = 0;
export function newId(prefix = 'p'): string {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newProduct(partial: Partial<Product> = {}): Product {
  return {
    id: newId(),
    title: '',
    sku: '',
    categoryId: '',
    grams: 0,
    price: 0,
    code: '',
    confirmed: null,
    ukMade: true,
    layerExempt: false,
    manualRate: null,
    notes: '',
    ...partial,
  };
}
