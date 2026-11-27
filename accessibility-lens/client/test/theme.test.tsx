// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App.js';

// Paths from the client folder, where vitest runs (jsdom's URL is not a file URL).
const file = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const sha = (s: string, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../../platform/src/theme/';
const HW_THEME_SHA256 = sha(file(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(file(`${SOURCE}theme-init.js`), 'base64')}'`;

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(file('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the head snippet is unchanged and runs before any stylesheet', () => {
    const html = file('index.html');
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet).toBeGreaterThan(-1);
    expect(head.indexOf(m![0])).toBeLessThan(stylesheet);
  });

  it('main.tsx loads hw-theme.js before anything renders', () => {
    const main = file('src/main.tsx');
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeGreaterThan(-1);
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf('createRoot'));
  });
});

describe('the dark palette', () => {
  const css = file('src/index.css');
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const light = block(/:root\s*\{([^}]*)\}/)!;
  const dark = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)!;

  it('is the same for the switch and for the device setting', () => {
    expect(dark).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(dark);
  });

  it('sets every colour the light theme sets', () => {
    const names = (s: string): string[] => [...s.matchAll(/(--al-[a-z-]+):/g)].map((m) => m[1]).sort();
    expect(names(dark)).toEqual(names(light));
    expect(names(light)).toHaveLength(13);
    expect(dark).toContain('color-scheme: dark;');
  });

  const rgb = (s: string, name: string): number[] => s.match(new RegExp(`--al-${name}: (\\d+) (\\d+) (\\d+);`))!.slice(1).map(Number);
  const lum = (c: number[]): number => {
    const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('meets WCAG AA for text on both backgrounds, and 3:1 for field borders, in both themes', () => {
    for (const theme of [light, dark]) {
      for (const bg of ['paper', 'panel']) {
        for (const fg of ['ink', 'muted', 'accent', 'accent-soft', 'critical', 'serious', 'moderate', 'minor']) {
          expect(ratio(rgb(theme, fg), rgb(theme, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // The Scan button: panel-coloured text on the accent.
      expect(ratio(rgb(theme, 'panel'), rgb(theme, 'accent'))).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11).
      for (const bg of ['paper', 'panel']) {
        expect(ratio(rgb(theme, 'field'), rgb(theme, bg)), `field on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('prints with the light set and without the switch: both dark blocks are for screens only', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const screenAttr = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/;
    const screenDevice = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/;
    expect(plain).toMatch(screenAttr);
    expect(plain).toMatch(screenDevice);
    // No other rule follows the theme or the device setting, which print would then follow too.
    expect(plain.replace(screenAttr, '').replace(screenDevice, '')).not.toMatch(/data-theme|prefers-color-scheme/);
    const print = [...plain.matchAll(/@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(file('src/lib/hw-theme.js').match(/border-color:var\(--hw-theme-toggle-border,color-mix\(in srgb,currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const theme of [light, dark]) {
      // The header is bg-panel with text-ink.
      const ink = rgb(theme, 'ink');
      const panel = rgb(theme, 'panel');
      const outline = ink.map((v, i) => share * v + (1 - share) * panel[i]);
      expect(ratio(outline, panel)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the switch in the header', () => {
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
  });

  it('sits in the header and says what it will do', () => {
    render(<App />);
    const toggle = screen.getByRole('banner').querySelector('hw-theme-toggle')!;
    expect(toggle).not.toBeNull();
    const button = toggle.shadowRoot!.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('gives every text field its edge from the field colour (a field back on the line colour fails)', () => {
    render(<App />);
    // Text fields: not checkboxes, radios or the zoom slider, which have no border of their own.
    const fields = document.querySelectorAll(
      'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"])',
    );
    expect(fields.length).toBeGreaterThan(0);
    // A Tailwind border colour class: border-<name>, but not a width (border, border-2, border-b) or a style.
    const width = /^border-([xytrblse](-\d+)?|\d+|solid|dashed|dotted|double|hidden|none)$/;
    for (const field of fields) {
      const colours = [...field.classList].filter((c) => c.startsWith('border-') && !width.test(c));
      expect(colours, field.outerHTML).toEqual(['border-field']);
    }
  });

  it('switches the page at once and remembers the choice', () => {
    render(<App />);
    const button = screen.getByRole('banner').querySelector('hw-theme-toggle')!.shadowRoot!.querySelector('button')!;
    button.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Switch to light mode');
    button.click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
  });
});
