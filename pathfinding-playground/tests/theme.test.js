// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies"), in plain JavaScript
// like the rest of this package.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKENS } from '../src/ui/palette.js';

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
// The rgba() tokens (the canvas's washes and the figures drawn on them), as [r, g, b, alpha].
const tints = (re) =>
  Object.fromEntries(
    [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*rgba\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(',').map(Number)]),
  );
const light = tokens(LIGHT);
const dark = { ...light, ...tokens(DARK) };
const lightTints = tints(LIGHT);
const darkTints = { ...lightTints, ...tints(DARK) };
/** A tint laid over a colour. */
const over = ([r, g, b, a], under) => mix([r, g, b], under, a);

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
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets in dark every colour the light theme sets', () => {
    const names = (re) => [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):[^;]*(?:#[0-9a-f]{3,8}\b|rgba\()/gi)].map((m) => m[1]).sort();
    // Every colour token, the shadows with them; the fonts and the radius stay as they are.
    expect(names(DARK)).toEqual(names(LIGHT));
    expect(Object.keys(light)).toHaveLength(17);
    expect(Object.keys(lightTints)).toHaveLength(5);
    expect(block(LIGHT)).toContain('color-scheme: light;');
    expect(block(DARK)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for the edges and the drawn marks it lists, in both themes', () => {
    const text = [
      ['--ink', '--card'],
      ['--ink', '--paper'],
      ['--ink', '--paper-deep'],
      ['--ink', '--amber-soft'],
      ['--ink-soft', '--card'],
      ['--ink-soft', '--paper'],
      ['--ink-soft', '--paper-deep'],
      // The log's step numbers, on the current line's highlight too; --amber was 2.25:1 on the card.
      ['--amber-ink', '--card'],
      ['--amber-ink', '--amber-soft'],
      // "no route" and a hovered link on the page; #d2492a was 3.83:1.
      ['--route', '--paper-deep'],
      ['--route', '--card'],
      ['--green', '--paper-deep'],
      ['--green', '--card'],
      // The primary button and the toast; the current tool, and the primary button hovered.
      ['--paper', '--ink'],
      ['--amber-soft', '--ink'],
      ['--amber-soft', '--primary-hover'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]]) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // The focus ring and the sliders; --amber was 1.98 to 2.25:1.
      for (const bg of ['--card', '--paper', '--paper-deep']) {
        expect(ratio(rgb(t['--amber-ink']), rgb(t[bg])), `${theme}: --amber-ink on ${bg}`).toBeGreaterThanOrEqual(3);
      }
      // The lists' and the buttons' edges (WCAG 1.4.11).
      for (const edge of ['--ink-soft', '--ink']) expect(ratio(rgb(t[edge]), rgb(t['--card'])), `${theme}: ${edge} on --card`).toBeGreaterThanOrEqual(3);
      // On the map: walls, the final path and goal, the start, the hover outline.
      for (const mark of ['--ink', '--route', '--green', '--ink-soft']) {
        expect(ratio(rgb(t[mark]), rgb(t['--paper'])), `${theme}: ${mark} on --paper`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('draws the path, and the cost figures, clear of the search washes under them, in both themes', () => {
    for (const [theme, t, w] of [['light', light, lightTints], ['dark', dark, darkTints]]) {
      const paper = rgb(t['--paper']);
      const visited = over(w['--visited'], paper);
      const frontier = over(w['--frontier'], paper);
      expect(ratio(rgb(t['--route']), visited), `${theme}: path on visited`).toBeGreaterThanOrEqual(3);
      expect(ratio(over(w['--cost-visited'], visited), visited), `${theme}: g on visited`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(rgb(t['--cost-frontier']), frontier), `${theme}: f on frontier`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)[1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, dark]) {
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--paper-deep'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    const rest = css.replace(SCREEN_DEVICE, '').replace(SCREEN_ATTR, '').replace(/:root\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found = [];
    for (const [, selector, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) found.push(`${selector.trim()}: ${colour}`);
    }
    expect(found).toEqual([]);
  });

  it("gives the canvas the stylesheet's light set where no stylesheet is loaded", () => {
    // src/ui/palette.js reads the tokens when the map is drawn; its stand-ins are the light values.
    for (const [name, value] of Object.values(TOKENS)) {
      const want = light[name] ?? (lightTints[name] && `rgba(${lightTints[name].join(', ')})`);
      expect(value.toLowerCase(), name).toBe(want);
    }
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

// jsdom has no canvas: a 2D context that counts what is drawn and keeps the colours it is given.
const drawn = { calls: 0, colours: [] };
const fakeContext = new Proxy(
  {},
  {
    get: (_t, key) => (key === 'getImageData' ? () => ({ data: [] }) : () => void drawn.calls++),
    set: (_t, key, value) => {
      if (key === 'fillStyle' || key === 'strokeStyle') drawn.colours.push(value);
      return true;
    },
  },
);

// Stands in for matchMedia (jsdom has none) and keeps the print query's change listeners.
const onPrint = new Set();
const fakeMatchMedia = (media) => ({
  media,
  matches: false,
  onchange: null,
  addEventListener: (type, fn) => void (media === 'print' && type === 'change' && onPrint.add(fn)),
  removeEventListener: (type, fn) => void onPrint.delete(fn),
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

describe('the switch in the header', () => {
  let root;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('matchMedia', fakeMatchMedia);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    HTMLCanvasElement.prototype.getContext = () => fakeContext;
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
    // main.jsx draws the app as it loads, after defining the switch.
    await act(async () => {
      await import('../src/main.jsx');
    });
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    window.hintwise.theme.set(null);
  });
  const button = () => root.querySelector('header hw-theme-toggle').shadowRoot.querySelector('button');
  const press = (label) =>
    act(() => {
      [...root.querySelectorAll('button')].find((b) => b.textContent === label).click();
    });

  it("ends the title row, which takes the header's first line, and says what it will do", () => {
    const toggles = root.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    const row = toggles[0].parentElement;
    expect(row.classList.contains('title-row')).toBe(true);
    expect(row.lastElementChild).toBe(toggles[0]);
    expect(toggles[0].previousElementSibling.tagName).toBe('H1');
    expect(row.parentElement.matches('header.masthead')).toBe(true);
    expect(row.parentElement.firstElementChild).toBe(row);
    // The tagline and the actions share the next line.
    expect(row.nextElementSibling.matches('p.masthead__sub')).toBe(true);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('keeps the title row a line of its own, with the switch at its end', () => {
    const row = root.querySelector('.title-row');
    const own = rulesFor(row);
    expect(own).toMatch(/flex:\s*1 1 100%/);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
    expect(rulesFor(row.querySelector('h1'))).toMatch(/min-width:\s*0/);
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

  it("draws the map again when the theme changes, in the stylesheet's colours at that moment", () => {
    const before = drawn.calls;
    button().click();
    expect(drawn.calls).toBeGreaterThan(before);
    // The colours come from the tokens, read when it draws (jsdom loads no stylesheet, so set one here).
    document.documentElement.style.setProperty('--paper', '#010203');
    document.documentElement.style.setProperty('--visited', 'rgba(1, 2, 3, 0.5)');
    try {
      drawn.colours = [];
      // The device setting changing, with nothing stored, fires the same event.
      document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'dark' } }));
      expect(drawn.colours).toContain('#010203');
      expect(drawn.colours).toContain('#14304a');
      press('Run search');
      press('+ step');
      drawn.colours = [];
      document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'dark' } }));
      expect(drawn.colours).toContain('rgba(1, 2, 3, 0.5)');
    } finally {
      document.documentElement.style.removeProperty('--paper');
      document.documentElement.style.removeProperty('--visited');
    }
  });

  it('draws the map again at once on the way into print and back, so a dark choice prints in the light colours', () => {
    // Print takes the light set, but a canvas keeps the pixels it drew on screen until it is drawn again.
    expect(onPrint.size).toBe(1);
    const before = drawn.calls;
    for (const fn of onPrint) fn();
    expect(drawn.calls).toBeGreaterThan(before);
  });

  it('lets the narration be scrolled by keyboard: the log is a named region that takes focus', () => {
    const logs = [...root.querySelectorAll('.log__body')];
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.getAttribute('tabindex')).toBe('0');
      expect(log.getAttribute('role')).toBe('region');
      expect(log.getAttribute('aria-label')).toMatch(/narration$/);
    }
  });

  it('gives each list an edge of 3:1 (--ink-soft, checked above) and a label', () => {
    const selects = [...root.querySelectorAll('select')];
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(rulesFor(s)).toMatch(/border:\s*1px solid var\(--ink-soft\)/);
      expect(s.labels[0]?.textContent).toBeTruthy();
    }
  });

  it('keeps --amber to fills and edges, and gives amber text, the focus ring and the sliders --amber-ink', () => {
    // --amber is 1.98 to 2.25:1 on the light card and page.
    const uses = [...css.matchAll(/([\w-]+)\s*:[^;{}]*var\(--amber\)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const property of uses) expect(property).toMatch(/^(background|border-left)$/);
    expect(rules('.log__line::before')).toMatch(/(?:^|;)\s*color:\s*var\(--amber-ink\)/);
    expect(rules(':focus-visible')).toMatch(/outline:\s*2px solid var\(--amber-ink\)/);
    expect(rulesFor(root.querySelector('input[type="range"]'))).toMatch(/accent-color:\s*var\(--amber-ink\)/);
  });

  it('lets the two maps share a phone screen without a sideways scroll', () => {
    expect(rules('.panels--compare')).toMatch(/minmax\(min\(340px, 100%\), 1fr\)/);
  });

  it('prints the labels on the ink fill in the ink, underlines the current tool and keeps the swatches', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    const within = (selector) =>
      [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    // The hovered primary too: the pointer may rest on it when the page is printed.
    for (const s of ['.btn--primary', '.btn--primary:hover', ".seg__btn[aria-pressed='true']", '.toast']) {
      expect(within(s), s).toMatch(/color:\s*var\(--ink\)/);
    }
    expect(within(".seg__btn[aria-pressed='true']")).toMatch(/text-decoration:\s*underline/);
    expect(within('.swatch')).toMatch(/(?:^|;)\s*print-color-adjust:\s*exact/);
    expect(within('.swatch')).toMatch(/-webkit-print-color-adjust:\s*exact/);
    // One print block, the last thing in the file, so it wins over the screen rules it changes.
    const blocks = [...css.matchAll(PRINT)];
    expect(blocks).toHaveLength(1);
    expect(css.slice(blocks[0].index + blocks[0][0].length).trim()).toBe('');
  });
});
