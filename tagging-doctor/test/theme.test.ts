// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { shellHtml } from '../src/ui/app';
import { googleButton, googleLogoSvg } from '../src/lib/auth';
import { SIGN_IN_CSS } from '../src/lib/signin-styles';
const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
// The page's own stylesheet, inline in its head (the second <style> is the no-script one).
const css = html.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, '');
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
    expect(stylesheet).toBeGreaterThan(-1);
    expect(head.indexOf(m![0])).toBeLessThan(stylesheet);
  });

  it('main.ts loads hw-theme.js before anything else, so the switch is defined before the page draws its top bar', () => {
    expect(main.indexOf("import './lib/hw-theme.js';")).toBe(main.indexOf('import '));
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
    expect(Object.keys(light)).toHaveLength(21);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--ink', '--bg'],
      ['--ink', '--soft'],
      ['--ink', '--surface'],
      ['--ink', '--drop-over'],
      ['--ink', '--after-bg'],
      ['--muted', '--bg'],
      ['--muted', '--soft'],
      ['--muted', '--surface'],
      ['--accent', '--bg'],
      ['--on-primary', '--primary'],
      ['--focus', '--bg'],
      ['--focus', '--soft'],
      ['--danger', '--bg'],
      ['--danger', '--soft'],
      ['--danger', '--after-bg'],
      ['--warning', '--bg'],
      ['--signin-text', '--signin-bg'],
      ['--signin-text', '--signin-hover'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields' and buttons' edges (WCAG 1.4.11).
      for (const bg of ["--bg", "--soft", "--surface"]) expect(ratio(rgb(t['--line']), rgb(t[bg])), `${theme}: --line on ${bg}`).toBeGreaterThanOrEqual(3);
      // A finding's mark: unknown.
      for (const bg of ["--bg"]) expect(ratio(rgb(t['--unknown']), rgb(t[bg])), `${theme}: --unknown on ${bg}`).toBeGreaterThanOrEqual(3);
      // A finding's or fix's mark: fine.
      for (const bg of ["--bg"]) expect(ratio(rgb(t['--ok']), rgb(t[bg])), `${theme}: --ok on ${bg}`).toBeGreaterThanOrEqual(3);
      // The sign-in buttons' edges.
      for (const bg of ["--bg"]) expect(ratio(rgb(t['--signin-border']), rgb(t[bg])), `${theme}: --signin-border on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--bg'])];
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





describe('the switch in the top bar', () => {
  beforeAll(async () => {
    // The page as it is painted before its script runs (its module script is not run here), and the switch.
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
  });
  const button = (): HTMLButtonElement => document.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it("ends the title's row, first in the top bar, before the pages and sign-in, in the static bar and the drawn one", () => {
    const toggles = document.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    const row = toggles[0].parentElement!;
    expect(row.matches('header.top-bar > .title-row:first-child')).toBe(true);
    expect(row.lastElementChild).toBe(toggles[0]);
    expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
    // The title's row takes the bar's free space, so the switch is at its end; the pages and sign-in follow, and
    // wrap below it on a phone.
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).toMatch(/flex:\s*1 1 auto/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
    expect(shellHtml()).toContain('<div class="title-row"><h1>Tagging Doctor</h1><hw-theme-toggle></hw-theme-toggle></div>');
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

  it("gives the sign-in buttons Google's light theme on the light page and its dark theme on the dark one", () => {
    const block = (re: RegExp): string => css.match(re)![1].toLowerCase();
    const light = block(/:root\s*\{([^}]*)\}/);
    const dark = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    // The light values are the ones in src/lib/signin-styles.ts; the dark ones are the branding guidelines'.
    const button = SIGN_IN_CSS.match(/\n\.hw-signin-button \{([^}]*)\}/)![1].toLowerCase();
    for (const [token, declaration] of [['--signin-bg', 'background: '], ['--signin-border', 'border: 1px solid '], ['--signin-text', 'color: ']] as const) {
      const value = light.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`))![1];
      expect(button).toContain(`${declaration}${value};`);
    }
    expect(dark).toMatch(/--signin-bg:\s*#131314/);
    expect(dark).toMatch(/--signin-border:\s*#8e918f/);
    expect(dark).toMatch(/--signin-text:\s*#e3e3e3/);
    expect(rules('.hw-signin .hw-signin-button')).toMatch(/background:\s*var\(--signin-bg\);\s*border-color:\s*var\(--signin-border\);\s*color:\s*var\(--signin-text\)/);
    // Google's dark G on the dark page, not the light G's white square: both are drawn, the page shows one.
    expect(light).toMatch(/--g-light:\s*block;\s*--g-dark:\s*none/);
    expect(dark).toMatch(/--g-light:\s*none;\s*--g-dark:\s*block/);
    expect(rules('.hw-signin-google-logo .hw-g-dark')).toMatch(/display:\s*var\(--g-dark\)/);
    expect(SIGN_IN_CSS).toMatch(/\.hw-signin-google-logo \.hw-g-dark \{\s*display: none;\s*\}/);
    const logo = googleButton(() => {}).querySelector('.hw-signin-google-logo')!;
    expect([...logo.children].map((c) => c.className)).toEqual(['hw-g-light', 'hw-g-dark']);
    // Google's dark asset ("Theme=Dark" from signin-assets.zip), byte for byte the file delivery-canary ships.
    expect(sha(readFileSync('src/lib/google-g-dark.svg'), 'hex')).toBe('2f7ecc307b1db0f1738456269ee2c4433b3a73c35060ced67a9afcfc6821e786');
    // The dark asset's own fill (Google's dark theme), from google-g-dark.svg.
    expect(logo.querySelector('.hw-g-dark svg')!.innerHTML.toLowerCase()).toContain('#131314');
    expect(logo.querySelector('.hw-g-light svg')!.innerHTML.toLowerCase()).not.toContain('#131314');
    expect(googleLogoSvg('dark').startsWith('<svg width="20" height="20" viewBox="10 10 20 20" focusable="false" aria-hidden="true"')).toBe(true);
  });

  it('keeps a figure on white in both modes, and the panel in the page\'s colours', () => {
    const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)![1];
    expect(dark).not.toContain('--thumb-bg:');
    expect(rules('.hw-signin-panel')).toMatch(/background:\s*var\(--bg\);\s*color:\s*var\(--ink\)/);
  });

  it('prints the filled buttons in the ink, without the switch, as the only print block, last', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    const within = (selector: string): string =>
      [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    expect(within('button.primary')).toMatch(/color:\s*var\(--ink\)/);
    expect(within('.choose button[aria-pressed="true"]')).toMatch(/color:\s*var\(--ink\)/);
    const blocks = [...css.matchAll(PRINT)];
    expect(blocks).toHaveLength(1);
    expect(css.slice(blocks[0].index! + blocks[0][0].length).trim()).toBe('');
  });
});

