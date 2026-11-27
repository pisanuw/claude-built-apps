// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { googleButton } from '../src/lib/auth';
import { SIGN_IN_CSS } from '../src/lib/signin-styles';
import { handleUnsubscribe, THEME_INIT_SNIPPET, UNSUB_HEADERS, type SchedApiDeps } from '../src/server/schedapi';
import { unsubToken } from '../src/server/secretbox';
import { memoryStores } from '../src/store/stores';
import { mountApp, type AppDeps } from '../src/ui/app';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const css = readFileSync('src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged, in the bundle and in public/ (for the unsubscribe page)', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
    expect(sha(readFileSync('public/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the page has the head snippet, unchanged, before any stylesheet', () => {
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
    expect(at).toBeLessThan(main.indexOf("import './styles.css';"));
    expect(at).toBeLessThan(main.indexOf('mountApp('));
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
const OUTLINE_SHARE = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;

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
    // No other rule follows the theme or the device setting, which print would then follow too
    // (the dark sign-in rules are in screen queries of their own).
    const screenOnly = /@media\s+screen[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
    expect(css.replace(screenOnly, '')).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('gives the sign-in controls the same dark rules for the switch and for the device setting, on screen only', () => {
    const rulesIn = (re: RegExp): string[] =>
      [...css.matchAll(re)].flatMap((m) => [...m[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => `${r[1].trim()} {${r[2].trim()}}`));
    const attr = rulesIn(/@media screen\s*\{((?:\s*:root\[data-theme="dark"\] \.[^{}]*\{[^{}]*\})+)\s*\}/g).map((r) => r.replaceAll(':root[data-theme="dark"] ', ''));
    const media = rulesIn(/@media screen and \(prefers-color-scheme: dark\)\s*\{((?:\s*:root:not\(\[data-theme="light"\]\) \.[^{}]*\{[^{}]*\})+)\s*\}/g).map((r) =>
      r.replaceAll(':root:not([data-theme="light"]) ', ''),
    );
    expect(attr).toHaveLength(5);
    expect(media).toEqual(attr);
    expect(attr.join('\n')).toContain('.hw-signin-google-logo .hw-g-light {display: none;}');
    expect(attr.join('\n')).toContain('.hw-signin-google-logo .hw-g-dark {display: block;}');
    expect(attr.join('\n')).toContain('.hw-signin .hw-signin-button:focus-visible {outline-color: var(--focus);}');
  });

  it('draws the sign-in panel in the page colours, not the light ones the sign-in styles set', () => {
    expect(rules('.hw-signin-panel')).toMatch(/background:\s*var\(--card\)/);
    expect(rules('.hw-signin-panel')).toMatch(/color:\s*var\(--ink\)/);
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(/@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(19);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for edges and the focus ring, in both themes', () => {
    const text: [string, string][] = [
      ...['--bg', '--card', '--fail-bg', '--warn-bg', '--ok-bg', '--info-bg'].map((bg): [string, string] => ['--ink', bg]),
      ['--muted', '--bg'],
      ['--muted', '--card'],
      ['--muted', '--info-bg'],
      ['--accent', '--bg'],
      ['--accent', '--card'],
      ['--on-accent', '--accent'],
      // The findings' labels on their tints, and the verdicts on the cards.
      ['--fail', '--fail-bg'],
      ['--warn', '--warn-bg'],
      ['--ok', '--ok-bg'],
      ['--info', '--info-bg'],
      ['--fail', '--card'],
      ['--warn', '--card'],
      ['--ok', '--card'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' and buttons' edges (WCAG 1.4.11), the focus ring, and a report's verdict edge, on the cards and the page.
      for (const edge of ['--field-border', '--button-border', '--focus', '--warn-edge', '--ok', '--fail']) {
        for (const bg of ['--card', '--bg']) expect(ratio(rgb(t[edge]), rgb(t[bg])), `${theme}: ${edge} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    expect(OUTLINE_SHARE).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      // The header sits on the page: --ink on --bg.
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, OUTLINE_SHARE), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks, except the dark Google buttons', () => {
    // Google's dark sign-in button (its branding guidelines), in both dark forms.
    const GOOGLE = ['#131314', '#8e918f', '#e3e3e3'];
    const ALLOWED: [string, string][] = [':root[data-theme="dark"]', ':root:not([data-theme="light"])'].flatMap((root) =>
      [`${root} .hw-signin .hw-signin-button`, `${root} .hw-signin-panel input[type='email']`].flatMap((s) => GOOGLE.map((c): [string, string] => [s, c])),
    );
    const rest = css
      .replace(/@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(/@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g, '')
      .replace(/:root\s*\{[^}]*\}/g, '');
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
function expectBorderToken(els: Element[], token: string): void {
  for (const el of els) {
    const own = BORDERS.filter((b) => matches(el, b.selector));
    expect(own.length, el.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    // A rule with no colour of its own (border: none) is the link buttons'.
    for (const b of own) if (b.value !== 'none') expect(b.value, `${b.selector} on ${el.outerHTML.slice(0, 120)}`).toContain(`var(${token})`);
  }
}

describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  const mount = (over: Partial<AppDeps> = {}): void => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    mountApp(root, { stores: memoryStores(), checkLink: async () => ({}) as never, origin: 'https://delivery-canary.test', basePath: '/', ...over });
  };
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    mount();
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('comes after the title and right before sign-in (beyankontrol.com: the menu follows the switch), and says what it will do', () => {
    mount({ mountAuth: (el) => void el.append(googleButton(() => {})) });
    const toggles = root.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    const bar = toggles[0].parentElement!;
    expect(bar.classList.contains('top-bar')).toBe(true);
    expect(bar.closest('header')).not.toBeNull();
    expect([...bar.children].map((k) => `${k.tagName}${k.id ? `#${k.id}` : ''}`)).toEqual(['H1', 'HW-THEME-TOGGLE', 'SECTION#signin']);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('keeps the switch on the title row: the title takes the free space, and sign-in wraps below at the right', () => {
    expect(rules('.top-bar')).toMatch(/display:\s*flex/);
    expect(rules('.top-bar h1')).toMatch(/flex:\s*1 1 auto/);
    expect(rules('.top-bar h1')).toMatch(/min-width:\s*0/);
    expect(rules('.top-bar #signin')).toMatch(/margin-left:\s*auto/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/width:\s*var\(--hw-theme-toggle-size, 44px\)/);
  });

  it('is in the static header that shows before the script runs, after its title', () => {
    const doc = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
    const toggles = doc.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    const bar = toggles[0].parentElement!;
    expect(bar.classList.contains('top-bar')).toBe(true);
    expect(bar.closest('header')).not.toBeNull();
    expect([...bar.children].map((k) => k.tagName)).toEqual(['H1', 'HW-THEME-TOGGLE']);
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

  it('gives every text field its edge from --field-border and every button from --button-border (back on #8a94a2 or #6b7582 fails)', () => {
    const fields = [...root.querySelectorAll(FIELDS)];
    expect(fields.length).toBeGreaterThan(2);
    expectBorderToken(fields, '--field-border');
    const plain = [...root.querySelectorAll('button:not(.primary):not(.link)')];
    expect(plain.length).toBeGreaterThan(1);
    expectBorderToken(plain, '--button-border');
    expect(rules('button.primary')).toMatch(/color:\s*var\(--on-accent\)/);
    expect(rules(':focus-visible')).toMatch(/outline:\s*3px solid var\(--focus\)/);
    expect(rules('.report.verdict-warn')).toMatch(/border-color:\s*var\(--warn-edge\)/);
  });

  it('shows Google’s dark G on a dark page: both assets are in the button, the CSS picks one', () => {
    const logo = googleButton(() => {}).querySelector('.hw-signin-google-logo')!;
    expect([...logo.children].map((k) => k.className)).toEqual(['hw-g-light', 'hw-g-dark']);
    expect(logo.querySelector('.hw-g-dark svg')!.innerHTML).toContain('#131314');
    expect(logo.querySelector('.hw-g-light svg')!.innerHTML).not.toContain('#131314');
    // Light by default (the sign-in styles); the page's dark rules swap them (above).
    expect(SIGN_IN_CSS.replace(/\s+/g, ' ')).toContain('.hw-signin-google-logo .hw-g-dark { display: none; }');
  });
});

describe('nothing widens the page on a phone', () => {
  it('keeps a table’s hidden caption inside its scroll box (it widened the page to 372 px at 320)', () => {
    expect(rules('.visually-hidden')).toMatch(/position:\s*absolute/);
    expect(rules('.table-wrap')).toMatch(/position:\s*relative/);
    expect(rules('.table-wrap')).toMatch(/overflow-x:\s*auto/);
  });

  it('breaks the long address in the seed card’s steps', () => {
    expect(rules('.howto')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('the switch on the unsubscribe page (rendered by the API)', () => {
  const KEY = Buffer.alloc(32, 7);
  const SHOP = '00000000-0000-4000-8000-000000000001';
  const deps = { key: KEY, unsubscribe: async () => {} } as unknown as SchedApiDeps;
  const pages = async (): Promise<string[]> => {
    const route = `/api/unsubscribe/${unsubToken(KEY, SHOP)}`;
    return Promise.all([
      handleUnsubscribe('GET', route, deps),
      handleUnsubscribe('POST', route, deps),
      handleUnsubscribe('GET', '/api/unsubscribe/u1.bad', deps),
      handleUnsubscribe('PUT', route, deps),
    ]).then((r) => r.map((x) => x.html!));
  };
  const style = (html: string): string => html.match(/<style>([\s\S]*?)<\/style>/)![1];

  it('has the head snippet, unchanged, before its style, and loads the public copy of hw-theme.js', async () => {
    expect(`'sha256-${sha(THEME_INIT_SNIPPET.replace(/^<script>|<\/script>$/g, ''), 'base64')}'`).toBe(THEME_INIT_CSP);
    for (const html of await pages()) {
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head.indexOf(THEME_INIT_SNIPPET)).toBeGreaterThan(-1);
      expect(head.indexOf(THEME_INIT_SNIPPET)).toBeLessThan(head.indexOf('<style>'));
      expect(head).toContain('<script defer src="/hw-theme.js"></script>');
    }
  });

  it('lets both scripts run under its Content-Security-Policy, and nothing else', () => {
    const csp = UNSUB_HEADERS['content-security-policy'];
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc.split(/\s+/).slice(1).sort()).toEqual(["'self'", THEME_INIT_CSP].sort());
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('puts the switch at the end of the title row in a header, on every answer', async () => {
    for (const html of await pages()) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const toggles = doc.querySelectorAll('hw-theme-toggle');
      expect(toggles).toHaveLength(1);
      const row = toggles[0].parentElement!;
      expect(row.className).toBe('title-row');
      expect(row.closest('header')).not.toBeNull();
      expect([...row.children].map((k) => k.tagName)).toEqual(['H1', 'HW-THEME-TOGGLE']);
      expect(doc.querySelector('main')).not.toBeNull();
    }
    const s = style((await pages())[0]);
    expect(s).toMatch(/\.title-row\{display:flex;align-items:center;justify-content:space-between;gap:12px\}/);
    expect(s).toMatch(/\.title-row h1\{min-width:0;/);
    expect(s).toMatch(/hw-theme-toggle:not\(\[hidden\]\)\{display:inline-flex;flex:none;width:var\(--hw-theme-toggle-size, 44px\)/);
  });

  it('has one dark set for the switch and the device, on screen only, and leaves the switch off paper', async () => {
    const s = style((await pages())[0]);
    const attr = s.match(/@media screen\{:root\[data-theme="dark"\]\{([^}]*)\}\}/)?.[1];
    const device = s.match(/@media screen and \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{([^}]*)\}\}/)?.[1];
    expect(attr).toBeTruthy();
    expect(device).toBe(attr);
    expect(s.replace(/@media screen[^{]*\{[^{}]*\{[^{}]*\}\}/g, '')).not.toMatch(/data-theme|prefers-color-scheme/);
    expect(s).toContain('@media print{hw-theme-toggle{display:none !important}}');
    // Every colour is a token: no literal outside the two sets.
    const rest = s.replace(/:root\{[^}]*\}/, '').replace(/@media screen[^{]*\{[^{}]*\{[^{}]*\}\}/g, '');
    expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('meets WCAG AA in both themes, and the switch outline 3:1', async () => {
    const s = style((await pages())[0]);
    const set = (re: RegExp): Record<string, number[]> => Object.fromEntries([...s.match(re)![1].matchAll(/(--[\w-]+):(#[0-9a-f]{6})/g)].map((m) => [m[1], rgb(m[2])]));
    const light = set(/:root\{([^}]*)\}/);
    const dark = set(/:root\[data-theme="dark"\]\{([^}]*)\}/);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    for (const t of [light, dark]) {
      expect(ratio(t['--ink'], t['--bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--accent'], t['--bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--on-accent'], t['--accent'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(mix(t['--ink'], t['--bg'], OUTLINE_SHARE), t['--bg'])).toBeGreaterThanOrEqual(3);
    }
  });
});
