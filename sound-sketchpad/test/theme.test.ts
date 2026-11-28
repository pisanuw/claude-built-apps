// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountApp } from '../src/ui/app';
const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const main = readFileSync('src/main.ts', 'utf8');

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the head snippet is unchanged and runs before any stylesheet', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
  });

  it('main.ts loads hw-theme.js first, before the stylesheet and before it draws the header', () => {
    const at = main.indexOf("import './lib/hw-theme.js';");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("import './ui/style.css';"));
  });

  it('the stylesheet is linked in the head, not added by the script (no flash of the device theme)', () => {
    // The head check above passes when the head has no stylesheet; Vite links one that main.ts imports as a file.
    expect(main).toMatch(/^import '\.\/ui\/style\.css';$/m);
    expect(main).not.toMatch(/\.css\?inline/);
    expect(main).not.toMatch(/createElement\(\s*['"]style['"]/);
  });
});

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]): number => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: number[], b: number[], share: number): number[] => a.map((v, i) => share * v + (1 - share) * b[i]);
const PRINT = /@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
const SCREEN_ATTR = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g;
const SCREEN_DEVICE = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g;

describe('the palette', () => {
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

  it('is the same for the switch and for the device setting', () => {
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
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

  it('sets every colour the light theme sets', () => {
    const names = (re: RegExp): string[] => [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
    const darkNames = names(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    // Each dark token is one the light theme sets too; a colour the dark set leaves out keeps its light value on purpose.
    for (const n of darkNames) expect(names(/:root\s*\{([^}]*)\}/), n).toContain(n);
    expect(Object.keys(light)).toHaveLength(19);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text', '--bg-glow'],
      ['--text', '--panel'],
      ['--text', '--field-bg'],
      ['--text', '--btn-bg'],
      ['--dim', '--bg'],
      ['--dim', '--bg-glow'],
      ['--dim', '--panel'],
      ['--dim', '--field-bg'],
      ['--dim', '--btn-bg'],
      ['--accent', '--bg'],
      ['--accent', '--bg-glow'],
      ['--accent', '--panel'],
      ['--accent', '--field-bg'],
      ['--blue', '--bg'],
      ['--blue', '--bg-glow'],
      ['--blue', '--panel'],
      ['--pink', '--panel'],
      ['--amber', '--panel'],
      ['--on-primary', '--accent-dark'],
      ['--on-primary', '--accent'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields', buttons' and chips' edges (WCAG 1.4.11): --panel-edge was 1.23 to 1.33:1 (the app was dark only).
      for (const bg of ["--bg", "--panel", "--field-bg", "--btn-bg"]) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring and the sliders.
      for (const bg of ["--panel", "--field-bg"]) expect(ratio(rgb(t['--accent-dark']), rgb(t[bg])), `${theme}: --accent-dark on ${bg}`).toBeGreaterThanOrEqual(3);
      // The oscilloscope's wave and playhead.
      for (const bg of ["--scope-bg"]) expect(ratio(rgb(t['--scope-wave']), rgb(t[bg])), `${theme}: --scope-wave on ${bg}`).toBeGreaterThanOrEqual(3);
      // The playhead.
      for (const bg of ["--scope-bg"]) expect(ratio(rgb(t['--scope-head']), rgb(t[bg])), `${theme}: --scope-head on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--text']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    
    const ALLOWED: [string, string][] = [

    ];
    const rest = css.replace(SCREEN_DEVICE, '').replace(SCREEN_ATTR, '').replace(/:root\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found: string[] = [];
    for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) {
        for (const selector of selectors.split(',').map((x) => x.trim().replace(/\s+/g, ' '))) {
          if (!ALLOWED.some(([s, col]) => s === selector && col === colour.toLowerCase())) found.push(`${selector}: ${colour}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

// Every rule whose selector matches the element, media queries included.
const rulesFor = (el: Element): string =>
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
const rules = (selector: string): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');

const FIELDS =
  'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])';

// The stylesheet's rules that give an element a border colour.
const BORDERS = [...css.replace(/@[a-z-]+[^;{}]*;/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
  [...body.matchAll(/(?:^|;)\s*border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?\s*:([^;]+)/g)].map((d) => ({
    selector: selector.trim(),
    value: d[1].trim(),
  })),
);
const matches = (el: Element, selector: string): boolean => {
  try {
    return el.matches(selector);
  } catch {
    return false; // ::placeholder and other selectors jsdom does not take
  }
};
/** Every text field takes its edge from --field-border (a rule with no edge, border: none, aside). */
function expectFieldToken(fields: Element[]): void {
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    const own = BORDERS.filter((b) => matches(field, b.selector) && !/^(none|0)\b/.test(b.value));
    expect(own.length, field.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML.slice(0, 120)}`).toContain('var(--field-border)');
  }
}

/** The switch is the last thing in a one-line title row, right after the h1, inside a header. */
function expectInTitleRow(root: ParentNode): void {
  const toggles = root.querySelectorAll('hw-theme-toggle');
  expect(toggles).toHaveLength(1);
  const row = toggles[0].parentElement!;
  expect(row.classList.contains('title-row')).toBe(true);
  expect(row.lastElementChild).toBe(toggles[0]);
  expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
  expect(row.closest('header')).not.toBeNull();
  const own = rulesFor(row);
  expect(own).toMatch(/display:\s*flex/);
  expect(own).toMatch(/justify-content:\s*space-between/);
  expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b/);
  expect(rulesFor(row.querySelector('h1')!)).toMatch(/min-width:\s*0/);
  expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
  // In a header that wraps (flex-wrap), the row takes a whole line, so the switch is never alone on one.
  const header = row.parentElement!;
  if (/flex-wrap:\s*wrap/.test(rulesFor(header))) expect(own).toMatch(/flex:\s*1 1 100%|flex-basis:\s*100%/);
}

// jsdom has no canvas: a 2D context that counts what is drawn and keeps the colours it is given.
const drawn = { calls: 0, colours: [] as string[] };
const fakeContext = new Proxy({} as Record<string, unknown>, {
  get: (_t, key) => {
    if (key === 'measureText') return () => ({ width: 6 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
    if (key === 'getImageData' || key === 'createImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    return () => void drawn.calls++;
  },
  set: (_t, key, value) => {
    if (key === 'fillStyle' || key === 'strokeStyle') drawn.colours.push(String(value));
    return true;
  },
});
HTMLCanvasElement.prototype.getContext = (() => fakeContext) as unknown as HTMLCanvasElement['getContext'];

// Stands in for matchMedia (jsdom has none) and keeps the print query's change listeners.
const onPrint = new Set<() => void>();
vi.stubGlobal('matchMedia', (media: string) => ({
  media,
  matches: false,
  onchange: null,
  addEventListener: (type: string, fn: () => void) => void (media === 'print' && type === 'change' && onPrint.add(fn)),
  removeEventListener: (_type: string, fn: () => void) => void onPrint.delete(fn),
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
}));


describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    mountApp(root);
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('ends the title row above the tagline, and says what it will do', () => {
    expectInTitleRow(root);
    expect(root.querySelector('header.header > .title-row + .tagline')).not.toBeNull();
    // The title stays in the middle, as the header is: it is padded by the switch's width and gap.
    expect(rules('.title')).toMatch(/padding-left:\s*56px/);
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

  it("draws the oscilloscope again when the theme changes, in the tokens' colours at that moment", () => {
    document.documentElement.style.setProperty('--scope-bg', '#010203');
    document.documentElement.style.setProperty('--scope-wave', '#040506');
    try {
      drawn.colours = [];
      // The device setting changing, with nothing stored, fires the same event as the switch.
      document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'dark' } }));
      expect(drawn.colours).toContain('#010203');
      expect(drawn.colours).toContain('#040506');
    } finally {
      document.documentElement.style.removeProperty('--scope-bg');
      document.documentElement.style.removeProperty('--scope-wave');
    }
  });

  it('draws it again at once on the way into print and back, so a dark choice prints in the light colours', () => {
    expect(onPrint.size).toBeGreaterThan(0);
    document.documentElement.style.setProperty('--scope-bg', '#010203');
    try {
      drawn.colours = [];
      [...onPrint].at(-1)!();
      expect(drawn.colours).toContain('#010203');
    } finally {
      document.documentElement.style.removeProperty('--scope-bg');
    }
  });

  it("gives the scope the stylesheet's light colours where no stylesheet is loaded", () => {
    const light = Object.fromEntries([...css.match(/:root\s*\{([^}]*)\}/)![1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
    const uses = [...readFileSync('src/ui/app.ts', 'utf8').matchAll(/token\('(--[\w-]+)', '(#[0-9a-f]{6})'\)/g)];
    expect(uses.map((m) => m[1]).sort()).toEqual(['--scope-axis', '--scope-bg', '--scope-head', '--scope-wave']);
    for (const [, name, fallback] of uses) expect(fallback, name).toBe(light[name]);
    // No colour is written into the drawing itself any more.
    expect(readFileSync('src/ui/app.ts', 'utf8')).not.toMatch(/Style = '#/);
  });

  it('gives the fields, the buttons and the chips their edge from --field-border, and names the export lists', () => {
    const fields = [...root.querySelectorAll<HTMLElement>(FIELDS)];
    expect(fields.length).toBe(3);
    expectFieldToken([...fields, ...root.querySelectorAll('button:not(.primary)')]);
    expect(root.querySelectorAll('button.chip').length).toBeGreaterThan(0);
    const lists = [...root.querySelectorAll('select')].map((s) => s.getAttribute('aria-label'));
    expect(lists).toEqual(['Sample rate', 'Bit depth']);
  });

  it('keeps the recipe tags readable on their tints, in both themes', () => {
    const block = (re: RegExp): string => css.match(re)![1];
    const sets = [block(/:root\s*\{([^}]*)\}/), block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)];
    const hex = (set: string, name: string): number[] => rgb(set.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1]);
    const tint = (set: string, name: string): number[] => set.match(new RegExp(`${name}:\\s*rgba\\(([^)]*)\\)`))![1].split(',').map(Number);
    for (const set of sets) {
      for (const [fg, bg] of [['--accent', '--tag-base-bg'], ['--blue', '--tag-mod-bg'], ['--amber', '--tag-warn-bg']]) {
        const [r, g, b, a] = tint(set, bg);
        expect(ratio(hex(set, fg), mix([r, g, b], hex(set, '--panel'), a)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('prints the primary button and the title in the ink, and keeps the tags', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    const within = (selector: string): string =>
      [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    expect(within('.btn.primary')).toMatch(/color:\s*var\(--text\)/);
    // The title's colour is a background clipped to its letters, which paper leaves out.
    expect(within('.title')).toMatch(/background:\s*none/);
    expect(within('.title')).toMatch(/color:\s*var\(--text\)/);
    expect(within('.tag')).toMatch(/(?:^|;)\s*print-color-adjust:\s*exact/);
    expect(within('.tag')).toMatch(/-webkit-print-color-adjust:\s*exact/);
    const blocks = [...css.matchAll(PRINT)];
    expect(blocks).toHaveLength(1);
    expect(css.slice(blocks[0].index! + blocks[0][0].length).trim()).toBe('');
  });
});

