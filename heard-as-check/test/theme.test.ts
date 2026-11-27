// @vitest-environment jsdom
/**
 * The light and dark mode switch and the colour tokens (platform/src/theme/README.md,
 * "The test an app copies"; SPEC open item S3-9, DECISIONS.md D-3). AC-75's scans
 * of both themes come in milestone 7.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Session } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthClient } from '../src/lib/auth';
import { mount } from '../src/ui/app';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64') => createHash('sha256').update(s).digest(enc);
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the copies of the shared switch', () => {
  it('hw-theme.js and hw-theme.d.ts are the platform copies, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
    expect(readFileSync('src/lib/hw-theme.d.ts', 'utf8')).toBe(readFileSync(`${SOURCE}hw-theme.d.ts`, 'utf8'));
  });
  it('the head snippet is unchanged and first in <head>, before any stylesheet', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    expect(head.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<head>\s*/, '').startsWith(m![0])).toBe(true);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
  });
  it('main.ts defines the switch before it draws the page', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeGreaterThan(-1);
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf('mount('));
  });
  it('the two dark blocks are the same', () => {
    const block = (re: RegExp) => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });
});

describe('the palette', () => {
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = { ...light, ...tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) };
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;

  it('meets contrast in both themes: text, the notice, field borders and the switch\'s outline', () => {
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      const pairs: [string, string, number][] = [
        ['--text', '--bg', 4.5],
        ['--text', '--surface', 4.5],
        ['--muted', '--surface', 4.5],
        ['--muted', '--bg', 4.5],
        ['--accent', '--bg', 4.5],
        ['--accent', '--surface', 4.5],
        ['--on-accent', '--accent', 4.5],
        ['--notice-text', '--notice-bg', 4.5],
        ['--field-border', '--surface', 3],
        ['--field-border', '--bg', 3],
      ];
      for (const [fg, bg, min] of pairs) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
      const [text, bg] = [rgb(t['--text']), rgb(t['--bg'])];
      const outline = text.map((v, i) => share * v + (1 - share) * bg[i]);
      expect(ratio(outline, bg), `${theme}: the switch's outline`).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    const rest = css
      .replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(/:root(\[data-theme="dark"\])?\s*\{[^}]*\}/g, '');
    const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    expect(rest.match(COLOUR) ?? []).toEqual([]);
  });
});

describe('in the page', () => {
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
    document.body.innerHTML = '<div id="app"></div>';
    const session = { access_token: 't', user: { id: 'u', email: 'u@example.com' } } as unknown as Session;
    const client = {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }),
      },
    } as unknown as AuthClient;
    mount(document.getElementById('app') as HTMLElement, { client });
  });
  it('the header has the button; a click switches the whole page and is remembered', () => {
    const toggle = document.querySelector('header hw-theme-toggle')!;
    const button = toggle.shadowRoot!.querySelector('button')!;
    const before = document.documentElement.dataset.theme;
    button.click();
    const after = document.documentElement.dataset.theme;
    expect(after).not.toBe(before);
    expect(localStorage.getItem('hw-theme')).toBe(after);
    expect(button.getAttribute('aria-label')).toBe(after === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  });
  it('the page has no text field of its own yet (the sign-in panel styles its own; AC-75 checks them in milestone 7)', () => {
    expect(document.querySelectorAll('main input, main textarea, main select').length).toBe(0);
  });
});
