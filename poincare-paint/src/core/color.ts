/** HSV colour helpers for the colour wheel. h in [0, 360), s and v in [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hsvToHex(h: number, s: number, v: number): string {
  return '#' + hsvToRgb(h, s, v).map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Parses #rrggbb. Hue is 0 for greys. */
export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Maps a point on the wheel (offsets from its centre, divided by its radius,
 * y pointing down) to hue and saturation. Points past the rim clamp to s = 1.
 */
export function wheelToHs(dx: number, dy: number): { h: number; s: number } {
  const h = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
  return { h, s: Math.min(1, Math.hypot(dx, dy)) };
}

/** Inverse of wheelToHs: unit-radius offsets of the marker for (h, s). */
export function hsToWheel(h: number, s: number): [number, number] {
  const a = (h * Math.PI) / 180;
  return [s * Math.cos(a), -s * Math.sin(a)];
}
