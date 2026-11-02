// Palette analysis: contrast repair suggestions and CVD confusion pairs.

import {
  contrastRatio,
  deltaEok,
  parseHex,
  rgbToOklch,
  oklchToRgb,
  toHex,
} from './color.js';
import { CVD_TYPES, simulateColor } from './cvd.js';

/**
 * Suggest a replacement for `fg` that reaches `target` contrast against `bg`
 * while keeping the original hue (and as much chroma as the gamut allows).
 * Strategy: hold OKLCH hue/chroma, move lightness away from the background in
 * whichever direction needs the smaller change. Returns null when no
 * lightness can reach the target in either direction (possible for AAA 7:1
 * against mid-tone backgrounds, where even pure black and white fall short).
 *
 * Pass `context` ({ palette, index }: the whole palette and fg's slot in it)
 * and the fix is also checked against the rest of the palette: a lightness
 * step that fixes contrast can make the color collide with a neighbor under
 * another vision type (a lighter red lands on green's luminance, so the pair
 * merges under achromatopsia). With context, candidates are scanned from the
 * smallest lightness change outward and the first one is returned that, for
 * every other palette color, neither pushes the pair into a worse confusion
 * band (distinct -> confusable -> near identical) under typical vision or any
 * of the eight simulated vision types, nor drops a pair that met `target` in
 * the contrast matrix below it. If every contrast-passing candidate would do
 * one of those, the result is { hex: null, conflict } naming the worst
 * collision of the nearest candidate.
 *
 * @returns {{hex:string, ratio:number, direction:'lighter'|'darker'|'none', deltaL:number}
 *   | {hex:null, conflict:{hex:string, index:number, label:string, d?:number, ratio?:number}}
 *   | null}
 */
export function suggestFix(fgHex, bgHex, target, context) {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  const { L, C, H } = rgbToOklch(fg);

  const ratioAt = (l) => {
    const { rgb } = oklchToRgb({ L: l, C, H });
    return { rgb, ratio: contrastRatio(rgb, bg) };
  };

  const search = (lo, hi, increasingTowardHi) => {
    // Find the L closest to the original that meets the target within [lo, hi],
    // where contrast is monotonic toward `hi`.
    if (ratioAt(hi).ratio < target) return null;
    let a = lo;
    let b = hi;
    for (let i = 0; i < 28; i++) {
      const mid = (a + b) / 2;
      if (ratioAt(mid).ratio >= target) b = mid;
      else a = mid;
    }
    const { rgb, ratio } = ratioAt(b);
    // Guard against floating point landing a hair under target.
    if (ratio < target) {
      const nudged = ratioAt(Math.min(Math.max(b + (increasingTowardHi ? 1e-4 : -1e-4), 0), 1));
      return { l: b, ...nudged };
    }
    return { l: b, rgb, ratio };
  };

  const current = ratioAt(L);
  if (current.ratio >= target) {
    return { hex: toHex(current.rgb), ratio: current.ratio, direction: 'none', deltaL: 0 };
  }

  const lighter = search(L, 1, true);
  const darker = search(L, 0, false); // monotonic toward 0 on the dark side
  const options = [];
  if (lighter) options.push({ ...lighter, direction: 'lighter', deltaL: Math.abs(lighter.l - L) });
  if (darker) options.push({ ...darker, direction: 'darker', deltaL: Math.abs(darker.l - L) });
  if (options.length === 0) return null;
  options.sort((a, b) => a.deltaL - b.deltaL);
  if (!context) {
    const best = options[0];
    return { hex: toHex(best.rgb), ratio: best.ratio, direction: best.direction, deltaL: best.deltaL };
  }

  // Every in-target lightness in each direction, nearest first. Contrast is
  // monotonic away from the background, so everything past the boundary passes.
  const candidates = [];
  for (const o of options) {
    const end = o.direction === 'lighter' ? 1 : 0;
    const steps = Math.ceil(Math.abs(end - o.l) / L_STEP);
    for (let k = 0; k <= steps; k++) {
      const l = k === steps ? end : o.l + Math.sign(end - o.l) * k * L_STEP;
      const { rgb, ratio } = ratioAt(l);
      if (ratio >= target) candidates.push({ rgb, ratio, direction: o.direction, deltaL: Math.abs(l - L) });
    }
  }
  candidates.sort((a, b) => a.deltaL - b.deltaL);

  const others = context.palette
    .map((hex, j) => ({ j, rgb: parseHex(hex) }))
    .filter(({ j, rgb }) => j !== context.index && rgb);
  const before = others.map(({ rgb }) => ({
    d: viewDistances(fg, rgb),
    ratio: contrastRatio(fg, rgb),
  }));
  // The worst collision a candidate would cause, or null if it causes none.
  const conflictOf = (cand) => {
    let worst = null;
    for (let n = 0; n < others.length; n++) {
      const after = viewDistances(cand.rgb, others[n].rgb);
      for (let v = 0; v < VIEWS.length; v++) {
        if (band(after[v]) > band(before[n].d[v]) && (!worst || after[v] < worst.d)) {
          worst = { hex: toHex(others[n].rgb), index: others[n].j, label: VIEWS[v].label, d: after[v] };
        }
      }
      const ratio = contrastRatio(cand.rgb, others[n].rgb);
      if (!worst && before[n].ratio >= target && ratio < target) {
        worst = { hex: toHex(others[n].rgb), index: others[n].j, label: 'Contrast', ratio };
      }
    }
    return worst;
  };

  let firstConflict = null;
  const seen = new Set();
  for (const cand of candidates) {
    const hex = toHex(cand.rgb);
    if (seen.has(hex)) continue;
    seen.add(hex);
    const conflict = conflictOf(cand);
    if (!conflict) return { hex, ratio: cand.ratio, direction: cand.direction, deltaL: cand.deltaL };
    firstConflict ??= conflict;
  }
  return { hex: null, conflict: firstConflict };
}

// Lightness grid for palette-aware candidates (OKLCH L runs 0..1).
const L_STEP = 0.005;

// Typical vision plus every simulated deficiency.
const VIEWS = [{ id: null, label: 'Typical vision' }, ...CVD_TYPES];

// Severity band of a distance, as findConfusions reports it: 0 distinct,
// 1 confusable (warning), 2 near identical (critical).
const band = (d) => (d < NEAR_IDENTICAL ? 2 : d < CONFUSABLE ? 1 : 0);

function viewDistances(a, b) {
  return VIEWS.map((t) =>
    t.id ? deltaEok(simulateColor(a, t.id), simulateColor(b, t.id)) : deltaEok(a, b)
  );
}

// Thresholds on OKLab distance (black-white = 1.0).
// Below NEAR_IDENTICAL two game elements read as the same color at a glance;
// below CONFUSABLE they are separable only with effort or side by side.
export const NEAR_IDENTICAL = 0.04;
export const CONFUSABLE = 0.1;

/**
 * Find palette pairs that are clearly distinct with typical vision but
 * collapse under at least one deficiency.
 *
 * @param {string[]} hexes
 * @returns {Array<{i:number, j:number, base:number, worst:{typeId:string, label:string, d:number, a:string, b:string}, severity:'critical'|'warning'}>}
 */
export function findConfusions(hexes) {
  const rgbs = hexes.map(parseHex);
  const sims = {};
  for (const t of CVD_TYPES) {
    sims[t.id] = rgbs.map((rgb) => simulateColor(rgb, t.id));
  }
  const out = [];
  for (let i = 0; i < rgbs.length; i++) {
    for (let j = i + 1; j < rgbs.length; j++) {
      const base = deltaEok(rgbs[i], rgbs[j]);
      if (base < CONFUSABLE) continue; // already a problem for everyone; the matrix shows it
      let worst = null;
      for (const t of CVD_TYPES) {
        const d = deltaEok(sims[t.id][i], sims[t.id][j]);
        if (!worst || d < worst.d) {
          worst = {
            typeId: t.id,
            label: t.label,
            d,
            a: toHex(sims[t.id][i]),
            b: toHex(sims[t.id][j]),
          };
        }
      }
      if (worst.d < CONFUSABLE) {
        out.push({
          i,
          j,
          base,
          worst,
          severity: worst.d < NEAR_IDENTICAL ? 'critical' : 'warning',
        });
      }
    }
  }
  out.sort((a, b) => a.worst.d - b.worst.d);
  return out;
}
