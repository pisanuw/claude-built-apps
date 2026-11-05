/** Text contrast inside an overlay, using WCAG relative luminance. */
import { allElements, computed, isHidden, parentOf, shortText } from './dom';

export type RGBA = [number, number, number, number];

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
  }
  const named: Record<string, RGBA> = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
  return named[s] ?? null;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: RGBA): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function ratio(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Paint `top` over `bottom`. */
export function blend(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + bottom[i] * (1 - a))).concat(1) as RGBA;
}

/** The solid colour behind an element, or null when an image or gradient is in the way. */
export function backgroundBehind(el: Element): RGBA | null {
  const layers: RGBA[] = [];
  let n: Element | null = el;
  while (n) {
    const s = computed(n);
    if (s.backgroundImage && s.backgroundImage !== 'none') return null;
    const c = parseColor(s.backgroundColor || 'transparent');
    if (c === null) return null;
    if (c[3] > 0) {
      layers.push(c);
      if (c[3] >= 1) break;
    }
    n = parentOf(n);
  }
  let out: RGBA = [255, 255, 255, 1];
  for (const layer of layers.reverse()) out = blend(layer, out);
  return out;
}

export interface ContrastProblem {
  text: string;
  ratio: number;
  needed: number;
  color: string;
  background: string;
}

const toCss = ([r, g, b]: RGBA): string => `rgb(${r}, ${g}, ${b})`;

/** Text in root whose contrast is below WCAG AA (4.5:1, or 3:1 for large text). */
export function contrastProblems(root: Element): { problems: ContrastProblem[]; checked: number; skipped: number } {
  const problems: ContrastProblem[] = [];
  let checked = 0;
  let skipped = 0;
  for (const el of [root, ...allElements(root)]) {
    const ownText = Array.from(el.childNodes)
      .filter((c) => c.nodeType === 3)
      .map((c) => c.textContent ?? '')
      .join('')
      .trim();
    if (!ownText || isHidden(el)) continue;
    const s = computed(el);
    const fg = parseColor(s.color || 'rgb(0, 0, 0)');
    const bg = backgroundBehind(el);
    if (!fg || !bg) {
      skipped++;
      continue;
    }
    checked++;
    const size = parseFloat(s.fontSize) || 16;
    const bold = Number(s.fontWeight) >= 700 || s.fontWeight === 'bold';
    const large = size >= 24 || (bold && size >= 18.66);
    const needed = large ? 3 : 4.5;
    const solidFg = fg[3] < 1 ? blend(fg, bg) : fg;
    const r = ratio(solidFg, bg);
    if (r + 1e-9 < needed) {
      problems.push({ text: shortText(el, 60), ratio: Math.round(r * 100) / 100, needed, color: toCss(solidFg), background: toCss(bg) });
    }
  }
  return { problems, checked, skipped };
}
