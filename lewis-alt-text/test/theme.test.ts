// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memoryStorage } from '../src/lib/llm';
import { mountApp, type AppDeps } from '../src/ui/app';
import { mountTerminal } from '../src/ui/terminal';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const PAGES = ['index.html', 'terminal/index.html'];
const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('both pages have the head snippet, unchanged, before any stylesheet', () => {
    for (const page of PAGES) {
      const html = readFileSync(page, 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
      expect(m, page).not.toBeNull();
      expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
      const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
      expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
    }
  });

  it('both entry points load hw-theme.js before they draw a header', () => {
    for (const [file, mount] of [['src/main.ts', 'mountApp('], ['src/terminal.ts', 'mountTerminal(']]) {
      const main = readFileSync(file, 'utf8');
      expect(main.indexOf("import './lib/hw-theme.js';"), file).toBeGreaterThan(-1);
      expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf("import './ui/styles.css';"));
      expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf(mount));
    }
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
    expect(attr.join('\n')).toContain('.hw-signin-google-logo .hw-g-dark {display: block;}');
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(/@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(14);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field borders and the focus ring, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text', '--card'],
      ['--text', '--note-bg'],
      ['--text', '--warn-bg'],
      ['--text', '--err-bg'],
      ['--muted', '--bg'],
      ['--muted', '--card'],
      ['--accent', '--bg'],
      ['--accent', '--card'],
      ['--accent-text', '--accent'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' and the drop zone's edges: 3:1 against what they sit on (WCAG 1.4.11); --border was 1.39 to 1.86:1.
      for (const bg of ['--card', '--bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring on what it surrounds.
      for (const bg of ['--card', '--bg']) expect(ratio(rgb(t['--focus']), rgb(t[bg])), `${theme}: focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
      // The notices' left edge.
      for (const [edge, bg] of [['--warn-border', '--warn-bg'], ['--err-border', '--err-bg'], ['--accent', '--note-bg']]) expect(ratio(rgb(t[edge]), rgb(t[bg])), `${theme}: ${edge}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      // The header sits on the page: --text on --bg.
      const [ink, bg] = [rgb(t['--text']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks, except the dark Google buttons and the figure on white', () => {
    // Google's dark sign-in button (its branding guidelines), in both dark forms; the uploaded figure on white (content).
    const GOOGLE = ['#131314', '#8e918f', '#e3e3e3'];
    const ALLOWED: [string, string][] = [
      ...[':root[data-theme="dark"]', ':root:not([data-theme="light"])'].flatMap((root) =>
        [`${root} .hw-signin .hw-signin-button`, `${root} .hw-signin-panel input[type='email']`].flatMap((s) => GOOGLE.map((c): [string, string] => [s, c])),
      ),
      ['.drop img', '#fff'],
    ];
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
function expectFieldToken(fields: Element[]): void {
  for (const field of fields) {
    const own = BORDERS.filter((b) => matches(field, b.selector));
    expect(own.length, field.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML.slice(0, 120)}`).toContain('var(--field-border)');
  }
}

/** The switch is the last thing in a one-line title row, beside the h1, inside a header. */
function expectInTitleRow(root: ParentNode): void {
  const toggles = root.querySelectorAll('hw-theme-toggle');
  expect(toggles).toHaveLength(1);
  const row = toggles[0].parentElement!;
  expect(row.classList.contains('title-row')).toBe(true);
  expect(row.lastElementChild).toBe(toggles[0]);
  expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
  expect(row.closest('header')).not.toBeNull();
}

describe('the switch on the app page', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  const mount = (over: Partial<AppDeps> = {}): void => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.getElementById('app') as HTMLElement;
    mountApp(root, {
      skill: '# Skill',
      generate: async () => ({ text: 'A Lewis structure.', model: 'm' }),
      live: false,
      storage: memoryStorage(),
      prepare: async () => ({ base64: 'QUJD', mediaType: 'image/png', width: 10, height: 10, bytes: 3, resized: false }),
      createObjectURL: () => 'blob:x',
      clipboard: { writeText: async () => {} },
      ...over,
    });
  };
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    mount();
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the top bar after the title and says what it will do; with no sign-in it ends the bar', () => {
    const toggles = root.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    const bar = toggles[0].parentElement!;
    expect(bar.classList.contains('top-bar')).toBe(true);
    expect(bar.closest('header')).not.toBeNull();
    expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
    // The sign-in region after it is hidden here.
    expect([...bar.children].filter((k) => !(k as HTMLElement).hidden).at(-1)).toBe(toggles[0]);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('comes right before the sign-in controls when there are some (beyankontrol.com: the menu follows the switch)', () => {
    mount({ live: true, mountSignIn: (el) => void el.append(Object.assign(document.createElement('button'), { textContent: 'Magic link' })) });
    const kids = [...root.querySelector('header .top-bar')!.children];
    expect(kids.map((k) => k.tagName)).toEqual(['H1', 'HW-THEME-TOGGLE', 'DIV']);
    expect(kids[2].id).toBe('signin');
    expect((kids[2] as HTMLElement).hidden).toBe(false);
  });

  it('keeps the top bar one line at every width, with the switch at its own size', () => {
    expect(rules('.top-bar')).toMatch(/display:\s*flex/);
    expect(rules('.top-bar')).toMatch(/justify-content:\s*space-between/);
    expect(rules('.top-bar')).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)/);
    expect(rules('.top-bar h1')).toMatch(/flex:\s*1 1 auto/);
    expect(rules('.top-bar h1')).toMatch(/min-width:\s*0/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
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

  it('gives every text field, with your own key chosen, and the drop zone their border from --field-border (back on --border fails)', () => {
    root.querySelector<HTMLInputElement>('input[name=mode][value=byok]')!.click();
    const fields = [...root.querySelectorAll(FIELDS)];
    expect(new Set(fields.map((f) => f.tagName + (f.getAttribute('type') ?? '')))).toEqual(new Set(['INPUTpassword', 'SELECT', 'TEXTAREA']));
    const drop = root.querySelector('#drop')!;
    expect(drop.getAttribute('role')).toBe('button');
    expectFieldToken([...fields, drop]);
  });
});

describe('the switch on the terminal page', () => {
  const mount = (href: string): HTMLElement => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.getElementById('app') as HTMLElement;
    mountTerminal(root, {
      redirectTo: 'https://lewis-alt-text.hintwise.org/terminal/',
      sendLink: async () => ({ status: 'sent' }),
      loadTurnstile: async () => ({ render: () => 'w', reset: () => {} }) as never,
      turnstileAction: 'sign-in',
      href,
      replaceUrl: () => {},
      clipboard: { writeText: async () => {} },
    });
    return root;
  };

  it('is at the end of the title row when it asks for an email, and when it shows the code', () => {
    for (const href of ['https://lewis-alt-text.hintwise.org/terminal/', 'https://lewis-alt-text.hintwise.org/terminal/?token_hash=abc&type=magiclink']) {
      const root = mount(href);
      expectInTitleRow(root);
      const row = root.querySelector('hw-theme-toggle')!.parentElement!;
      const own = rulesFor(row);
      expect(own).toMatch(/display:\s*flex/);
      expect(own).toMatch(/justify-content:\s*space-between/);
      expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)/);
      expect(rulesFor(row.querySelector('h1')!)).toMatch(/min-width:\s*0/);
      expectFieldToken([...root.querySelectorAll(FIELDS)]);
    }
  });
});
