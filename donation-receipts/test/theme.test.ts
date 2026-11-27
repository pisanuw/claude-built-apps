// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '../src/ui/app';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

  it('main.ts loads hw-theme.js before the app draws its header', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeGreaterThan(-1);
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf('mount('));
  });
});

describe('the palette', () => {
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

  it('is the same for the switch and for the device setting', () => {
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(22);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
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

  it('meets WCAG AA for text, and 3:1 for field borders, in both themes', () => {
    const text: [string, string][] = [
      ['--ink', '--bg'],
      ['--ink', '--panel'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent-ink', '--accent'],
      ['--ink', '--accent-soft'],
      ['--muted', '--accent-soft'],
      ['--bad', '--bg'],
      ['--bad', '--panel'],
      ['--bad', '--bad-bg'],
      ['--warn', '--warn-bg'],
      ['--good', '--good-bg'],
      ['--good', '--bg'],
      ['--good', '--panel'],
      ['--paper-ink', '--paper'],
      ['--paper-muted', '--paper'],
      ['--paper-flag-ink', '--paper-flag-bg'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11).
      for (const bg of ['--panel', '--bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, dark]) {
      // The header sits on the page: --ink on --bg.
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--bg'])];
      const outline = ink.map((v, i) => share * v + (1 - share) * bg[i]);
      expect(ratio(outline, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    // None: every colour is a token (the receipt preview's paper colours are --paper tokens, the same in both themes).
    const ALLOWED: [string, string][] = [];
    const rest = css
      .replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(/:root(\[data-theme="dark"\])?\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found: string[] = [];
    for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) {
        for (const selector of selectors.split(',').map((x) => x.trim())) {
          if (!ALLOWED.some(([s, c]) => s === selector && c === colour.toLowerCase())) found.push(`${selector}: ${colour}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

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
    mount(root, () => new Date('2026-11-07T10:00:00'), null);
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the header beside the title and says what it will do', () => {
    const toggle = root.querySelector('header hw-theme-toggle')!;
    expect(toggle.previousElementSibling?.tagName).toBe('H1');
    expect(root.querySelectorAll('hw-theme-toggle')).toHaveLength(1);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row, which is one line at every width', () => {
    const toggle = root.querySelector('header hw-theme-toggle')!;
    const row = toggle.parentElement!;
    expect(row.classList.contains('title-row')).toBe(true);
    expect(row.lastElementChild).toBe(toggle);
    // Every rule for the row and the switch, media queries included.
    const rules = (selector: string): string[] =>
      [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]);
    expect(rules('.title-row').join(';')).toMatch(/display:\s*flex/);
    expect(rules('.title-row').join(';')).toMatch(/justify-content:\s*space-between/);
    expect(rules('.title-row').join(';')).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)/);
    expect(rules('hw-theme-toggle:not([hidden])').join(';')).toMatch(/flex:\s*none/);
  });

  it('makes every wide table a focusable, labelled region, so a keyboard can scroll it', () => {
    const regions = new Map<string, Element>();
    const collect = (): void => {
      for (const r of root.querySelectorAll('.scroll')) regions.set(r.getAttribute('aria-label') ?? r.outerHTML.slice(0, 60), r);
    };
    // The example's gifts, from import to statements.
    (root.querySelector('#example') as HTMLElement).click();
    collect();
    (root.querySelector('#do-import') as HTMLElement).click();
    collect();
    (root.querySelector('#accept-strong') as HTMLElement).click();
    for (const tab of ['receipts', 'statements', 'donors']) {
      (root.querySelector(`[data-tab="${tab}"]`) as HTMLElement).click();
      (root.querySelector('#issue') as HTMLElement | null)?.click();
      collect();
    }
    expect([...regions.keys()].sort()).toEqual(['Donors', 'Gifts', 'Gifts found', 'Receipt register', 'Statements by donor']);
    for (const r of regions.values()) {
      expect(r.getAttribute('tabindex'), r.getAttribute('aria-label')!).toBe('0');
      expect(r.getAttribute('role'), r.getAttribute('aria-label')!).toBe('region');
    }
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

  it('gives every text field and the drop zone its border from --field-border (one back on the divider colour fails)', () => {
    // The stylesheet's rules that give an element a border colour.
    const borders = [...css.replace(/@[a-z-]+[^;{}]*;/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
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
    const TEXT_FIELDS =
      'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])';
    // The organisation form (the first screen), then the import step's drop zone.
    const fields = [...root.querySelectorAll(TEXT_FIELDS)];
    expect(fields.length).toBeGreaterThan(5);
    (root.querySelector('[data-tab="import"]') as HTMLElement).click();
    const zones = [...root.querySelectorAll('.zone')];
    expect(zones).toHaveLength(1);
    fields.push(...zones);
    for (const field of fields) {
      const own = borders.filter((b) => matches(field, b.selector));
      expect(own.length, field.outerHTML).toBeGreaterThan(0);
      for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML}`).toContain('var(--field-border)');
    }
  });
});
