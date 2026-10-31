const NUMERIC = /^-?\d+(\.\d+)?$/;
const CHUNK = /(\d+)|(\D+)/g;

/**
 * Order keys the way a student expects. Two numbers compare numerically
 * ("-1" < "2" < "10"); numbers come before words; words compare naturally,
 * with digit runs as numbers ("k2" < "k10" < "user").
 */
export function compareKeys(a: string, b: string): number {
  const an = NUMERIC.test(a);
  const bn = NUMERIC.test(b);
  if (an && bn) {
    const d = Number(a) - Number(b);
    if (d !== 0) return d < 0 ? -1 : 1;
  } else if (an !== bn) {
    return an ? -1 : 1;
  } else {
    const ca = a.match(CHUNK) ?? [];
    const cb = b.match(CHUNK) ?? [];
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      const x = ca[i];
      const y = cb[i];
      const xd = /^\d/.test(x);
      const yd = /^\d/.test(y);
      if (xd && yd) {
        const d = Number(x) - Number(y);
        if (d !== 0) return d < 0 ? -1 : 1;
      } else if (xd !== yd) {
        return xd ? -1 : 1;
      } else if (x !== y) {
        return x < y ? -1 : 1;
      }
    }
    if (ca.length !== cb.length) return ca.length < cb.length ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 32-bit FNV-1a over UTF-16 code units. Deterministic, so rehash demos repeat exactly. */
export function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
