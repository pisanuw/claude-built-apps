// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies"), in plain JavaScript
// like the rest of this package. The colour engine's tests stay on node --test (*.test.mjs).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPngReport } from '../src/report/exportPng.js';

const sha = (s, enc) => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const main = readFileSync('src/main.jsx', 'utf8');

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the head snippet is unchanged and runs before any stylesheet', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m[1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m[0]) < stylesheet).toBe(true);
  });

  it('main.jsx loads hw-theme.js first, before the stylesheet and before the app draws the header', () => {
    const at = main.indexOf("import './lib/hw-theme.js';");
    expect(at).toBeGreaterThan(-1);
    expect(main.indexOf('import ')).toBe(at);
    expect(at).toBeLessThan(main.indexOf("import './styles.css';"));
  });

  it('the stylesheet is linked in the head, not added by the script (no flash of the device theme)', () => {
    // The head check above passes when the head has no stylesheet; Vite links one that main.jsx imports as a file.
    expect(main).toMatch(/^import '\.\/styles\.css';$/m);
    expect(main).not.toMatch(/\.css\?inline/);
    expect(main).not.toMatch(/createElement\(\s*['"]style['"]/);
  });
});

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a, b, share) => a.map((v, i) => share * v + (1 - share) * b[i]);
const PRINT = /@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
const SCREEN_ATTR = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g;
const SCREEN_DEVICE = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g;
const LIGHT = /:root\s*\{([^}]*)\}/;
const DARK = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;

const block = (re) => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
const tokens = (re) =>
  Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
// The rgba() tokens (the drop zone's wash), as [r, g, b, alpha].
const tints = (re) =>
  Object.fromEntries(
    [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*rgba\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(',').map(Number)]),
  );
const light = tokens(LIGHT);
const dark = { ...light, ...tokens(DARK) };
const lightTints = tints(LIGHT);
const darkTints = { ...lightTints, ...tints(DARK) };

describe('the palette', () => {
  it('is the same for the switch and for the device setting', () => {
    const attr = block(DARK);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });

  it('keeps both dark blocks to the screen, so paper gets the light set', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    expect(css).toMatch(new RegExp(SCREEN_ATTR.source));
    expect(css).toMatch(new RegExp(SCREEN_DEVICE.source));
    // No other rule follows the theme or the device setting, which print would then follow too.
    expect(css.replace(SCREEN_ATTR, '').replace(SCREEN_DEVICE, '')).not.toMatch(/data-theme|prefers-color-scheme/);
    // The app was dark only: color-scheme on html said so for every medium.
    expect(css).not.toMatch(/(?:^|[\s}])html\s*\{[^}]*color-scheme/);
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets in dark every colour the light theme sets', () => {
    const names = (re) => [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):[^;]*(?:#[0-9a-f]{3,8}\b|rgba\()/gi)].map((m) => m[1]).sort();
    // Every colour token; the fonts and the radius stay as they are.
    expect(names(DARK)).toEqual(names(LIGHT));
    expect(Object.keys(light)).toHaveLength(15);
    expect(Object.keys(lightTints)).toHaveLength(1);
    expect(block(LIGHT)).toContain('color-scheme: light;');
    expect(block(DARK)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for the field and button edges, in both themes', () => {
    const text = [
      ['--text', '--bg'],
      ['--text', '--surface'],
      ['--text', '--surface-2'],
      ['--muted', '--bg'],
      ['--muted', '--surface'],
      ['--muted', '--surface-2'],
      // The eyebrow, the notes, the arrows and the footer; the dark --faint was 3.18 to 3.77:1.
      ['--faint', '--bg'],
      ['--faint', '--surface'],
      ['--faint', '--surface-2'],
      ['--accent', '--bg'],
      ['--accent', '--surface'],
      ['--accent-ink', '--accent'],
      ['--accent-ink', '--accent-hover'],
      ['--ok', '--bg'],
      ['--ok', '--surface'],
      ['--bad', '--bg'],
      ['--bad', '--surface'],
      ['--warn', '--bg'],
      ['--warn', '--surface'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]]) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields' and buttons' edges (WCAG 1.4.11): --line was 1.20 to 1.43:1 in dark.
      for (const bg of ['--bg', '--surface', '--surface-2']) {
        expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)[1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, dark]) {
      const [ink, bg] = [rgb(t['--text']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    // The palette under inspection is content: it is drawn from the data, in inline styles, never from the theme.
    const rest = css.replace(SCREEN_DEVICE, '').replace(SCREEN_ATTR, '').replace(/:root\s*\{[^}]*\}/, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found = [];
    for (const [, selector, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) found.push(`${selector.trim()}: ${colour}`);
    }
    expect(found).toEqual([]);
  });
});

// Every rule whose selector matches the element, media queries included.
const rulesFor = (el) =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, s]) =>
      s.split(',').some((x) => {
        try {
          return el.matches(x.trim());
        } catch {
          return false; // selectors jsdom does not take
        }
      }),
    )
    .map((m) => m[2])
    .join(';');
const rules = (selector) =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
/** The border declarations of the screen rules that match the element (print aside). */
const borders = (el) => {
  const screen = css.replace(PRINT, '');
  return [...screen.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, s]) =>
      s.split(',').some((x) => {
        try {
          return el.matches(x.trim());
        } catch {
          return false;
        }
      }),
    )
    .flatMap(([, , body]) => [...body.matchAll(/(?:^|;)\s*(border(?:-color)?)\s*:([^;]+)/g)].map((d) => d[2].trim()));
};

// jsdom has no canvas: a 2D context that keeps, in order, the colours it is given.
const drawn = { colours: [] };
const fakeContext = new Proxy(
  {},
  {
    get: (_t, key) => (key === 'measureText' ? () => ({ width: 12 }) : () => {}),
    set: (_t, key, value) => {
      if (key === 'fillStyle' || key === 'strokeStyle') drawn.colours.push(value);
      return true;
    },
  },
);

describe('the switch in the header', () => {
  let root;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const realToBlob = HTMLCanvasElement.prototype.toBlob;
  beforeAll(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    HTMLCanvasElement.prototype.getContext = () => fakeContext;
    HTMLCanvasElement.prototype.toBlob = () => {};
    localStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
    // main.jsx draws the app as it loads, after defining the switch.
    await act(async () => {
      await import('../src/main.jsx');
    });
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    window.hintwise.theme.set(null);
  });
  const button = () => root.querySelector('header hw-theme-toggle').shadowRoot.querySelector('button');

  it("ends the title row, a line of its own under the eyebrow, and says what it will do", () => {
    const toggles = root.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    const row = toggles[0].parentElement;
    expect(row.classList.contains('title-row')).toBe(true);
    expect(row.lastElementChild).toBe(toggles[0]);
    expect(toggles[0].previousElementSibling.tagName).toBe('H1');
    expect(row.closest('header.masthead')).not.toBeNull();
    expect(row.previousElementSibling.matches('p.eyebrow')).toBe(true);
    // The tagline and the actions share the next line.
    expect(row.nextElementSibling.matches('.masthead__top')).toBe(true);
    expect(row.nextElementSibling.firstElementChild.matches('p.masthead__tagline')).toBe(true);
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
    expect(rulesFor(row.querySelector('h1'))).toMatch(/min-width:\s*0/);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('switches the page at once and remembers the choice', () => {
    button().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Switch to light mode');
    button().click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
  });

  it('gives the fields and the outlined buttons their edge from --field-border', () => {
    const FIELDS =
      'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"])';
    const fields = [...root.querySelectorAll(FIELDS)];
    // The target list, the add field and each chip's hex field (it had a transparent edge until hovered).
    expect(fields.length).toBeGreaterThanOrEqual(8);
    expect(root.querySelectorAll('input.chip__hex').length).toBeGreaterThanOrEqual(6);
    const buttons = [...root.querySelectorAll('.btn:not(.btn--ghost):not(.btn--primary)')];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const el of [...fields, ...buttons]) {
      // A reset (button { border: none }) aside.
      const own = borders(el).filter((b) => !/^(none|0)\b/.test(b));
      expect(own.length, el.outerHTML.slice(0, 100)).toBeGreaterThan(0);
      for (const b of own) expect(b, el.outerHTML.slice(0, 100)).toContain('var(--field-border)');
    }
  });

  it("keeps the focus ring on a chip's hex field: no rule takes its outline away", () => {
    // Its :focus rule had outline: none, which hid the :focus-visible ring (as batch 6 review R1-2 found elsewhere).
    const hex = root.querySelector('input.chip__hex');
    act(() => hex.focus());
    expect(document.activeElement).toBe(hex);
    expect(rulesFor(hex)).not.toMatch(/outline:\s*(?:none|0)\b/);
    expect(rules(':focus-visible')).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('lets the keyboard reach the contrast matrix, which scrolls sideways on a phone', () => {
    const box = root.querySelector('.matrix-scroll');
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-label')).toBe('Contrast matrix');
  });

  it('draws no theme colour on its canvases: the screenshots and the PNG report keep theirs in either theme', () => {
    // The vision lab's canvases copy the screenshot's pixels and nothing else.
    expect(readFileSync('src/components/VisionLab.jsx', 'utf8')).not.toMatch(/fillStyle|strokeStyle|getComputedStyle/);
    // The report is a document of its own, white with dark ink, like the printout: the same in dark as in light.
    const report = () => {
      drawn.colours = [];
      exportPngReport({ colors: [{ hex: '#1b2a20' }, { hex: '#3e8948' }, { hex: '#d95763' }], bgIndex: 0, target: 4.5 });
      return drawn.colours;
    };
    button().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    const inDark = report();
    expect(inDark[0]).toBe('#ffffff');
    button().click();
    expect(report()).toEqual(inDark);
  });

  it('prints in the light set, without the switch, nothing caught in a transition, and the swatches kept', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    const within = (selector) =>
      [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    // Its own light colours on :root are gone: the light set is the page's, and the dark one stays on screen.
    expect(print).not.toMatch(/:root\s*\{/);
    expect(within('body')).toMatch(/background:\s*var\(--surface\)/);
    expect(within('*')).toMatch(/(?:^|;)\s*print-color-adjust:\s*exact/);
    expect(within('*')).toMatch(/-webkit-print-color-adjust:\s*exact/);
    // A button's fill takes 120 ms to go from the dark set to the light one, and could be printed on the way.
    expect(within('*')).toMatch(/transition:\s*none\s*!important/);
    // One print block, the last thing in the file, so it wins over the screen rules it changes.
    const blocks = [...css.matchAll(PRINT)];
    expect(blocks).toHaveLength(1);
    expect(css.slice(blocks[0].index + blocks[0][0].length).trim()).toBe('');
  });
});
