import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHex,
  toHex,
  relativeLuminance,
  contrastRatio,
  rgbToOklab,
  oklabToLinear,
  linearToRgb,
  rgbToOklch,
  oklchToRgb,
  deltaEok,
} from '../src/color/color.js';
import { CVD_TYPES, simulateColor } from '../src/color/cvd.js';
import { suggestFix, findConfusions } from '../src/color/analyze.js';

test('parseHex accepts common forms and rejects junk', () => {
  assert.deepEqual(parseHex('#ff0000'), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseHex('ff0000'), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseHex('#F80'), { r: 255, g: 136, b: 0 });
  assert.equal(parseHex('#ff00'), null);
  assert.equal(parseHex('red'), null);
  assert.equal(toHex({ r: 255, g: 136, b: 0 }), '#ff8800');
});

test('WCAG luminance and contrast match the spec anchors', () => {
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.ok(Math.abs(relativeLuminance(parseHex('#ff0000')) - 0.2126) < 1e-9);
  assert.equal(contrastRatio(parseHex('#ffffff'), parseHex('#000000')), 21);
  // Order independence
  const a = parseHex('#123456');
  const b = parseHex('#fedcba');
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
});

test('OKLab round-trips sRGB within 1/255 per channel', () => {
  const samples = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#123456', '#c0392b', '#7f8c8d', '#f1c40f'];
  for (const hex of samples) {
    const rgb = parseHex(hex);
    const back = linearToRgb(
      oklabToLinear(rgbToOklab(rgb)).map((c) => Math.min(1, Math.max(0, c)))
    );
    assert.ok(Math.abs(back.r - rgb.r) <= 1, hex + ' r');
    assert.ok(Math.abs(back.g - rgb.g) <= 1, hex + ' g');
    assert.ok(Math.abs(back.b - rgb.b) <= 1, hex + ' b');
  }
});

test('OKLab anchors: white is L=1 neutral, black is L=0', () => {
  const w = rgbToOklab({ r: 255, g: 255, b: 255 });
  assert.ok(Math.abs(w.L - 1) < 0.001 && Math.abs(w.a) < 0.001 && Math.abs(w.b) < 0.001);
  const k = rgbToOklab({ r: 0, g: 0, b: 0 });
  assert.ok(Math.abs(k.L) < 0.001);
});

test('oklchToRgb clamps out-of-gamut chroma while preserving hue', () => {
  const { rgb, clipped } = oklchToRgb({ L: 0.7, C: 0.5, H: 145 });
  assert.equal(clipped, true);
  const back = rgbToOklch(rgb);
  assert.ok(Math.abs(back.H - 145) < 2, 'hue preserved, got ' + back.H);
});

test('CVD matrices preserve white and neutral gray', () => {
  for (const t of CVD_TYPES) {
    const w = simulateColor({ r: 255, g: 255, b: 255 }, t.id);
    assert.ok(
      Math.abs(w.r - 255) <= 2 && Math.abs(w.g - 255) <= 2 && Math.abs(w.b - 255) <= 2,
      t.id + ' white -> ' + JSON.stringify(w)
    );
    const g = simulateColor({ r: 128, g: 128, b: 128 }, t.id);
    assert.ok(
      Math.abs(g.r - 128) <= 3 && Math.abs(g.g - 128) <= 3 && Math.abs(g.b - 128) <= 3,
      t.id + ' gray -> ' + JSON.stringify(g)
    );
  }
});

test('red and green collapse under deuteranopia and protanopia', () => {
  const red = parseHex('#e74c3c');
  const green = parseHex('#27ae60');
  const base = deltaEok(red, green);
  const dDeut = deltaEok(simulateColor(red, 'deuteranopia'), simulateColor(green, 'deuteranopia'));
  assert.ok(dDeut < base * 0.45, `deuteranopia: ${dDeut.toFixed(3)} vs base ${base.toFixed(3)}`);
  // Protanopes darken reds, so a lightness gap remains; still a large drop.
  const dProt = deltaEok(simulateColor(red, 'protanopia'), simulateColor(green, 'protanopia'));
  assert.ok(dProt < base * 0.65, `protanopia: ${dProt.toFixed(3)} vs base ${base.toFixed(3)}`);
  // Blue stays separable from red under red-green deficiencies.
  const blue = parseHex('#2980b9');
  const d2 = deltaEok(simulateColor(red, 'deuteranopia'), simulateColor(blue, 'deuteranopia'));
  assert.ok(d2 > 0.15, 'red vs blue survives deuteranopia: ' + d2.toFixed(3));
});

test('suggestFix reaches the target and keeps hue', () => {
  const fix = suggestFix('#c0392b', '#7f8c8d', 4.5);
  assert.ok(fix, 'a fix exists');
  const got = contrastRatio(parseHex(fix.hex), parseHex('#7f8c8d'));
  assert.ok(got >= 4.5 - 1e-6, 'ratio ' + got);
  const h0 = rgbToOklch(parseHex('#c0392b')).H;
  const h1 = rgbToOklch(parseHex(fix.hex)).H;
  const dh = Math.min(Math.abs(h0 - h1), 360 - Math.abs(h0 - h1));
  assert.ok(dh < 8, 'hue drift ' + dh.toFixed(1));
});

test('suggestFix returns the color unchanged when it already passes', () => {
  const fix = suggestFix('#ffffff', '#000000', 4.5);
  assert.equal(fix.direction, 'none');
  assert.equal(fix.deltaL, 0);
});

test('suggestFix admits impossibility: 7:1 against a worst-case mid gray', () => {
  // #757575 has relative luminance ~0.179; max contrast against ANY color
  // is ~4.6, so AAA normal (7:1) is unreachable.
  const fix = suggestFix('#c0392b', '#757575', 7);
  assert.equal(fix, null);
});

test('findConfusions flags red/green, not white pairs', () => {
  const res = findConfusions(['#e74c3c', '#27ae60', '#ffffff']);
  assert.ok(res.length >= 1);
  const rg = res.find((p) => p.i === 0 && p.j === 1);
  assert.ok(rg, 'red/green pair flagged');
  assert.ok(['deuteranopia', 'protanopia', 'deuteranomaly', 'protanomaly', 'achromatopsia'].includes(rg.worst.typeId));
  const withWhite = res.filter((p) => p.i === 2 || p.j === 2);
  assert.equal(withWhite.length, 0, 'white stays distinct from both');
});

// Copies of the presets in src/components/PaletteBench.jsx (JSX, so node
// cannot import it directly).
const PRESETS = [
  { name: 'Forest platformer', bg: 0, hexes: ['#1b2a20', '#3e8948', '#d95763', '#f4d35e', '#4e91d9', '#8a6f4d', '#e8e3d3'] },
  { name: 'Neon arcade', bg: 0, hexes: ['#0d0221', '#ff2975', '#00f0ff', '#ffd400', '#7a04eb', '#f8f8f2'] },
  { name: 'Red/green trap', bg: 0, hexes: ['#262626', '#e74c3c', '#27ae60', '#f1c40f', '#ecf0f1'] },
];

const band = (d) => (d < 0.04 ? 2 : d < 0.1 ? 1 : 0);
const views = (a, b) => [
  ['typical', deltaEok(a, b)],
  ...CVD_TYPES.map((t) => [t.id, deltaEok(simulateColor(a, t.id), simulateColor(b, t.id))]),
];

// What the fix studio's Apply button does: replace color i with the suggestion.
function applySuggestion(hexes, bg, i, target) {
  const fix = suggestFix(hexes[i], hexes[bg], target, { palette: hexes, index: i });
  const next = hexes.slice();
  if (fix?.hex) next[i] = fix.hex;
  return { fix, next };
}

test('Red/green trap: applying the suggested red creates no CRITICAL confusion', () => {
  const { hexes, bg } = PRESETS[2];
  const { fix, next } = applySuggestion(hexes, bg, 1, 4.5);
  const critical = findConfusions(next).filter((c) => c.severity === 'critical');
  assert.deepEqual(
    critical.map((c) => `${next[c.i]}/${next[c.j]} under ${c.worst.typeId}`),
    [],
    'no pair may become nearly identical under any vision type'
  );
  // Every lightness of this red that reaches 4.5:1 lands on the green's
  // luminance (or past it, into protanopia), so the studio must say so.
  assert.equal(fix.hex, null);
  assert.equal(fix.conflict.hex, '#27ae60');
  assert.equal(fix.conflict.label, 'Achromatopsia');
});

test('suggestions never push any pair into a worse confusion band, across presets and targets', () => {
  let offered = 0;
  for (const { name, hexes, bg } of PRESETS) {
    for (const target of [3, 4.5, 7]) {
      const criticalBefore = new Set(
        findConfusions(hexes).filter((c) => c.severity === 'critical').map((c) => `${c.i}-${c.j}`)
      );
      hexes.forEach((hex, i) => {
        if (i === bg || contrastRatio(parseHex(hex), parseHex(hexes[bg])) >= target) return;
        const { fix, next } = applySuggestion(hexes, bg, i, target);
        if (!fix?.hex) return;
        offered++;
        const where = `${name} @${target}: ${hex} -> ${fix.hex}`;
        assert.ok(contrastRatio(parseHex(fix.hex), parseHex(hexes[bg])) >= target, where + ' meets target');
        hexes.forEach((other, j) => {
          if (j === i) return;
          const before = views(parseHex(hex), parseHex(other));
          const after = views(parseHex(fix.hex), parseHex(other));
          after.forEach(([id, d], v) => {
            assert.ok(band(d) <= band(before[v][1]), `${where} vs ${other} worse under ${id}: ${d.toFixed(3)}`);
          });
        });
        for (const c of findConfusions(next)) {
          if (c.severity === 'critical') {
            assert.ok(criticalBefore.has(`${c.i}-${c.j}`), `${where} adds critical ${next[c.i]}/${next[c.j]}`);
          }
        }
      });
    }
  }
  assert.ok(offered >= 5, 'still offers fixes where a safe one exists, got ' + offered);
});

test('suggestFix with palette context will not break a contrast pair that already passes', () => {
  // #595959 fails 4.5:1 on black but passes against #eeeeee; any gray light
  // enough for 4.5:1 on black falls below 4.5:1 against #eeeeee.
  const palette = ['#000000', '#595959', '#eeeeee'];
  assert.ok(contrastRatio(parseHex('#595959'), parseHex('#eeeeee')) >= 4.5);
  assert.ok(suggestFix('#595959', '#000000', 4.5).hex, 'a contrast-only fix exists');
  const fix = suggestFix('#595959', '#000000', 4.5, { palette, index: 1 });
  assert.equal(fix.hex, null);
  assert.equal(fix.conflict.hex, '#eeeeee');
  assert.equal(fix.conflict.label, 'Contrast');
});
