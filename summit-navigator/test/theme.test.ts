// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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
    expect(at).toBeLessThan(main.indexOf("import './style.css';"));
  });

  it('the stylesheet is linked in the head, not added by the script (no flash of the device theme)', () => {
    // The head check above passes when the head has no stylesheet; Vite links one that main.ts imports as a file.
    expect(main).toMatch(/^import '\.\/style\.css';$/m);
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
    expect(Object.keys(light)).toHaveLength(25);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--ink', '--bg'],
      ['--ink', '--card'],
      ['--ink', '--accent-soft'],
      ['--ink', '--now-bg'],
      ['--muted', '--bg'],
      ['--muted', '--card'],
      ['--accent', '--card'],
      ['--accent', '--bg'],
      ['--on-accent', '--accent'],
      ['--star', '--card'],
      ['--star-off', '--card'],
      ['--now', '--card'],
      ['--now', '--now-bg'],
      ['--invite', '--card'],
      ['--invite', '--bg'],
      ['--badge-ink', '--kind-bg'],
      ['--hdr-btn-on-ink', '--hdr-ink'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // The search field's edge (WCAG 1.4.11): --line was 1.17 to 1.25:1.
      for (const bg of ["--bg", "--card"]) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring.
      for (const bg of ["--bg", "--card"]) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: --accent on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--hdr-ink']), rgb(t['--hdr-to'])];
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


describe('the switch in the header', () => {
  const root = (): HTMLElement => document.getElementById('app')!;
  beforeAll(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app" class="app"></div>';
    // main.ts draws the page as it loads, after defining the switch.
    await import('../src/main');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
  });
  const button = (): HTMLButtonElement => root().querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('ends the title row above the venue line, and says what it will do', () => {
    expectInTitleRow(root());
    expect(root().querySelector('header.hdr .title-row + .sub')).not.toBeNull();
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

  it("gives the switch's outline 3:1 on every stop of the header's gradient, in both themes", () => {
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    const tok = (re: RegExp): Record<string, string> =>
      Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
    const light = tok(/:root\s*\{([^}]*)\}/);
    for (const t of [light, { ...light, ...tok(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) }]) {
      for (const stop of ['--hdr-from', '--hdr-mid', '--hdr-to']) {
        const bg = rgb(t[stop]);
        expect(ratio(mix(rgb(t['--hdr-ink']), bg, share), bg), stop).toBeGreaterThanOrEqual(3);
        expect(ratio(rgb(t['--hdr-ink']), bg), stop).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(rules('.hdr')).toMatch(/linear-gradient\(135deg, var\(--hdr-from\), var\(--hdr-mid\) 60%, var\(--hdr-to\)\)/);
  });

  it('gives the search field its edge from --field-border (--line was 1.2:1)', () => {
    expectFieldToken([...root().querySelectorAll(FIELDS)]);
  });

  it('marks a break with a dashed edge, not by fading it (its time and badges were 2.83 to 4.32:1)', () => {
    expect(rules('.card.dim')).not.toMatch(/opacity/);
    expect(rules('.card.dim')).toMatch(/border-style:\s*dashed/);
  });

  it("colours a session kind's badge from a token, not in script", () => {
    const kinds = [...root().querySelectorAll<HTMLElement>('.badge.kind')];
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(k.style.background).toBe('');
    expect(rules('.badge.kind')).toMatch(/background:\s*var\(--kind-bg\)/);
    // An empty star is a text glyph: it takes the token, 4.5:1 on the card.
    expect(rules('.star')).toMatch(/color:\s*var\(--star-off\)/);
  });

  it("prints the header's text in the ink, underlines the chosen day, and keeps the badges' fill", () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/\.hdr, \.hdr-btn, \.daytab\[aria-selected='true'\] \{ color: var\(--ink\); \}/);
    expect(print).toMatch(/\.daytab\[aria-selected='true'\] \{ text-decoration: underline; \}/);
    expect(print).toMatch(/\.badge, \.chip\[aria-pressed='true'\] \{ print-color-adjust: exact; -webkit-print-color-adjust: exact; \}/);
    expect(css.match(/@media print/g)).toHaveLength(1);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css.indexOf('@media print')).toBeGreaterThan(css.lastIndexOf('.hdr-btn[aria-pressed'));
    // The page's colour-scheme meta allows both.
    expect(html).toMatch(/<meta name="color-scheme" content="light dark" \/>/);
  });
});

