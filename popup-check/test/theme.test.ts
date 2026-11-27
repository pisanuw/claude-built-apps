// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeReport } from '../src/engine/report';
import type { Report } from '../src/engine/types';
import { mount } from '../src/site/app';
import { memoryStorage, waitFor } from './helpers';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const css = readFileSync('src/site/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const PRINT = /@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the app page has the head snippet, unchanged, before any stylesheet', () => {
    const html = readFileSync('index.html', 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
  });

  it('main.ts loads hw-theme.js before the styles and before it draws the header', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const at = main.indexOf("import './lib/hw-theme.js';");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("import './site/styles.css';"));
    expect(at).toBeLessThan(main.indexOf('mount('));
  });

  it('leaves the practice shop light, without the switch: it stands in for a store, the thing Popup Check tests', () => {
    // data-theme="light" keeps the device's dark set off it too (that block is :root:not([data-theme="light"])).
    const html = readFileSync('practice.html', 'utf8');
    expect(html).toMatch(/<html lang="en" data-theme="light">/);
    expect(html).toContain('<meta name="color-scheme" content="light" />');
    expect(html).not.toMatch(/hw-theme/);
    expect(readFileSync('src/practice-main.ts', 'utf8')).not.toMatch(/hw-theme/);
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

  it('keeps both dark blocks to the screen, so paper gets the light set', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    const screenAttr = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/;
    const screenDevice = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/;
    expect(css).toMatch(screenAttr);
    expect(css).toMatch(screenDevice);
    // No other rule follows the theme or the device setting, which print would then follow too.
    const screenOnly = /@media\s+screen[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
    expect(css.replace(screenOnly, '')).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(17);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for edges and the focus ring, in both themes', () => {
    const text: [string, string][] = [
      ...['--bg', '--panel', '--neutral-bg', '--good-bg'].map((bg): [string, string] => ['--ink', bg]),
      ...['--bg', '--panel', '--neutral-bg'].flatMap((bg): [string, string][] => [['--muted', bg], ['--link', bg]]),
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent-ink', '--accent'],
      // The status line and the privacy line, and the badges on their tints.
      ['--good', '--good-bg'],
      ['--good', '--bg'],
      ['--bad', '--bad-bg'],
      ['--warn', '--warn-bg'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // The paste box and the support message box (on a grey box in a report): --line was 1.42:1.
      for (const bg of ['--panel', '--bg', '--neutral-bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring, and the findings' left edges, on the page and the report.
      for (const edge of ['--focus', '--bad', '--warn', '--good', '--accent']) {
        for (const bg of ['--panel', '--bg']) expect(ratio(rgb(t[edge]), rgb(t[bg])), `${theme}: ${edge} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      // The header sits on the page: --ink on --bg.
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks, except the always-light practice shop and paper', () => {
    // The practice shop is a stand-in store with fixed colours (practice.html); print is black on white.
    const PRACTICE = ['body.practice', 'body.practice a', '.practice-bar', '.practice-bar button', '.practice-bar button.run', '.shop-head', '.product'];
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(new Set(print.match(/#[0-9a-f]{3,8}\b/gi))).toEqual(new Set(['#ffffff', '#000000', '#999999']));
    const rest = css
      .replace(PRINT, '')
      .replace(/@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(/@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g, '')
      .replace(/:root\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found: string[] = [];
    for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!body.match(COLOUR)) continue;
      for (const selector of selectors.split(',').map((x) => x.trim())) if (!PRACTICE.includes(selector)) found.push(`${selector}: ${body.match(COLOUR)!.join(' ')}`);
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

/** The switch is the last thing in a one-line title row, beside the h1, inside a header. */
function expectInTitleRow(root: ParentNode): void {
  const toggles = root.querySelectorAll('hw-theme-toggle');
  expect(toggles).toHaveLength(1);
  const row = toggles[0].parentElement!;
  expect(row.classList.contains('title-row')).toBe(true);
  expect([...row.children].map((k) => k.tagName)).toEqual(['H1', 'HW-THEME-TOGGLE']);
  expect(row.closest('header')).not.toBeNull();
  const own = rulesFor(row);
  expect(own).toMatch(/display:\s*flex/);
  expect(own).toMatch(/justify-content:\s*space-between/);
  expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)/);
  expect(rulesFor(row.querySelector('h1')!)).toMatch(/min-width:\s*0/);
  expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
}

const REPORT: Report = {
  v: 1,
  url: 'https://shop.example/',
  title: 'Shop',
  checkedAt: '2026-11-05T10:00:00.000Z',
  appsOnPage: ['Klaviyo'],
  overlays: [
    {
      id: 'o1',
      kind: 'email',
      app: 'Klaviyo',
      label: 'Get 10% off',
      where: 'div',
      modal: true,
      framed: false,
      findings: [{ check: 'focus-in', status: 'fail', how: 'read', detail: 'Focus stayed behind.' }],
    },
  ],
} as Report;

describe('the switch in the header', () => {
  let root: HTMLElement;
  let api: ReturnType<typeof mount>;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    history.replaceState(null, '', '/');
    root = document.createElement('div');
    document.body.replaceChildren(root);
    api = mount(root, { bookmarkletCode: 'x', storage: memoryStorage() });
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('ends the title row and says what it will do', () => {
    expectInTitleRow(root);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row with a report open, from the address or from a pasted code', async () => {
    api.showReport(REPORT);
    expect((root.querySelector('#report') as HTMLElement).hidden).toBe(false);
    expectInTitleRow(root);
    history.replaceState(null, '', `/#report=${await encodeReport(REPORT)}`);
    root = document.createElement('div');
    document.body.replaceChildren(root);
    mount(root, { bookmarkletCode: 'x', storage: memoryStorage() });
    await waitFor(() => (root.querySelector('#report') as HTMLElement).hidden === false, 'report shown');
    expectInTitleRow(root);
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

  it('gives the paste box and the support message box their edge from --field-border, and focus its ring from --focus', () => {
    api.showReport(REPORT);
    const fields = [...root.querySelectorAll('textarea')];
    expect(fields).toHaveLength(2);
    expect(fields.filter((f) => f.id === 'paste-code')).toHaveLength(1);
    expect(fields.filter((f) => f.readOnly)).toHaveLength(1);
    for (const f of fields) {
      const own = rulesFor(f);
      expect(own).toMatch(/border:\s*1px solid var\(--field-border\)/);
      expect(own.replace(/border:\s*1px solid #999999/, '')).not.toMatch(/border[^;]*var\(--line\)/);
    }
    expect(rules(':focus-visible')).toMatch(/outline:\s*3px solid var\(--focus\)/);
  });
});
