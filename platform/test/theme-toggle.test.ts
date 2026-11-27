// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** A prefers-color-scheme query the tests can flip. */
const media = {
  matches: false,
  listeners: new Set<() => void>(),
  addEventListener(_type: string, fn: () => void) {
    this.listeners.add(fn);
  },
  set(dark: boolean) {
    this.matches = dark;
    this.listeners.forEach((fn) => fn());
  },
};

const SRC = '../src/theme/hw-theme.js';
const root = document.documentElement;
let api: HwThemeApi;

const mount = (html: string): void => {
  document.body.innerHTML = html;
};
const host = (i = 0): HTMLElement => document.querySelectorAll('hw-theme-toggle')[i] as HTMLElement;
const buttonOf = (el: HTMLElement): HTMLButtonElement => el.shadowRoot!.querySelector('button')!;

beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => media);
  root.removeAttribute('data-theme');
  localStorage.clear();
  await import(SRC);
  api = window.hintwise!.theme!;
});

beforeEach(() => {
  media.matches = false;
  api.set(null);
  localStorage.clear();
  mount('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the theme on <html>', () => {
  it('is set at load from the device when the head snippet is missing', () => {
    // Checked in beforeEach's state too, but the load itself set it first.
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(api.get()).toBe('light');
  });

  it('set() stores a choice and applies it; set(null) forgets it and follows the device', () => {
    api.set('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(api.get()).toBe('dark');
    media.matches = true;
    api.set(null);
    expect(localStorage.getItem('hw-theme')).toBeNull();
    expect(api.get()).toBe('dark');
    media.matches = false;
    api.set(null);
    expect(api.get()).toBe('light');
  });

  it('toggle() flips the theme and stores the new one', () => {
    api.toggle();
    expect(api.get()).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    api.toggle();
    expect(api.get()).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
  });

  it('refuses a value that is not a theme', () => {
    expect(() => api.set('blue' as HwTheme)).toThrow(TypeError);
    expect(api.get()).toBe('light');
  });

  it('get() falls back to the choice, then the device, if something removed the attribute', () => {
    root.removeAttribute('data-theme');
    media.matches = true;
    expect(api.get()).toBe('dark');
    api.set('light');
    root.removeAttribute('data-theme');
    expect(api.get()).toBe('light');
  });

  it('fires hw-themechange on document once per change, with the new theme', () => {
    const seen: string[] = [];
    const listener = (e: CustomEvent<{ theme: HwTheme }>): void => {
      seen.push(e.detail.theme);
    };
    document.addEventListener('hw-themechange', listener);
    api.set('dark');
    api.set('dark');
    api.set('light');
    document.removeEventListener('hw-themechange', listener);
    expect(seen).toEqual(['dark', 'light']);
  });

  it('follows device changes while no choice is stored, and not after one', () => {
    media.set(true);
    expect(api.get()).toBe('dark');
    media.set(false);
    expect(api.get()).toBe('light');
    api.set('light');
    media.set(true);
    expect(api.get()).toBe('light');
  });

  it('keeps a choice for this page when storage is blocked, and the device does not undo it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    api.toggle();
    expect(api.get()).toBe('dark');
    media.set(false);
    expect(api.get()).toBe('dark');
    expect(() => api.set(null)).not.toThrow();
    expect(api.get()).toBe('light');
  });

  it('applies a change made in another tab (storage event), and a cleared store', () => {
    localStorage.setItem('hw-theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'hw-theme', newValue: 'dark' }));
    expect(api.get()).toBe('dark');
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(api.get()).toBe('light');
    localStorage.setItem('hw-theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(api.get()).toBe('light');
  });

  it('re-reads the choice when the page comes back from the back-forward cache', () => {
    localStorage.setItem('hw-theme', 'dark');
    const fresh = new Event('pageshow');
    Object.defineProperty(fresh, 'persisted', { value: false });
    window.dispatchEvent(fresh);
    expect(api.get()).toBe('light');
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    expect(api.get()).toBe('dark');
  });

  it('a blocked store reads as no choice', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    window.dispatchEvent(new StorageEvent('storage', { key: 'hw-theme' }));
    expect(api.get()).toBe('light');
  });
});

describe('<hw-theme-toggle>', () => {
  it('draws a real button, named for what it will do, with a moon in light mode', () => {
    mount('<header><hw-theme-toggle></hw-theme-toggle></header>');
    const b = buttonOf(host());
    expect(b.tagName).toBe('BUTTON');
    expect(b.type).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(b.getAttribute('title')).toBe('Switch to dark mode');
    expect(b.getAttribute('data-shows')).toBe('moon');
    expect(b.getAttribute('part')).toBe('button');
    const svg = b.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.querySelectorAll('path')).toHaveLength(1);
  });

  it('switches the page at once on click, then shows a sun and offers light mode', () => {
    mount('<hw-theme-toggle></hw-theme-toggle>');
    const b = buttonOf(host());
    b.click();
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(b.getAttribute('aria-label')).toBe('Switch to light mode');
    expect(b.getAttribute('data-shows')).toBe('sun');
    expect(b.querySelector('circle')).not.toBeNull();
    b.click();
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(b.getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('starts in the right state when the page is already dark', () => {
    api.set('dark');
    mount('<hw-theme-toggle></hw-theme-toggle>');
    expect(buttonOf(host()).getAttribute('aria-label')).toBe('Switch to light mode');
  });

  it('is in the tab order and takes focus', () => {
    mount('<hw-theme-toggle></hw-theme-toggle>');
    const b = buttonOf(host());
    expect(b.tabIndex).toBe(0);
    expect(b.disabled).toBe(false);
    b.focus();
    expect(host().shadowRoot!.activeElement).toBe(b);
  });

  it('keeps every toggle on the page in step, lets a removed one go, and repaints it when it returns', () => {
    mount('<hw-theme-toggle></hw-theme-toggle><hw-theme-toggle></hw-theme-toggle>');
    const [a, b] = [host(0), host(1)];
    buttonOf(a).click();
    expect(buttonOf(b).getAttribute('aria-label')).toBe('Switch to light mode');
    b.remove();
    api.set('light');
    expect(buttonOf(a).getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(buttonOf(b).getAttribute('aria-label')).toBe('Switch to light mode');
    document.body.append(b);
    expect(buttonOf(b).getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(b.shadowRoot!.querySelectorAll('button')).toHaveLength(1);
  });

  it('follows the device on its own when nothing is stored', () => {
    mount('<hw-theme-toggle></hw-theme-toggle>');
    media.set(true);
    expect(buttonOf(host()).getAttribute('data-shows')).toBe('sun');
  });

  it('works when an app creates it from script (a vanilla app or React)', () => {
    const header = document.createElement('header');
    header.append(document.createElement('hw-theme-toggle'));
    document.body.append(header);
    expect(buttonOf(header.querySelector('hw-theme-toggle')!).getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('is styled by a <style> in its shadow root where constructed stylesheets are missing (jsdom)', () => {
    mount('<hw-theme-toggle></hw-theme-toggle>');
    const css = host().shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toContain('width:var(--hw-theme-toggle-size,44px)');
    expect(css).toContain('height:var(--hw-theme-toggle-size,44px)');
    expect(css).toContain('border-radius:50%');
    expect(css).toContain('button:focus-visible{outline:2px solid currentColor');
  });

  describe('with constructed stylesheets', () => {
    const adopted = new WeakMap<object, unknown[]>();
    beforeEach(() => {
      Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
        configurable: true,
        get(this: object) {
          return adopted.get(this) ?? [];
        },
        set(this: object, v: unknown[]) {
          adopted.set(this, v);
        },
      });
    });
    afterEach(() => {
      delete (ShadowRoot.prototype as unknown as Record<string, unknown>).adoptedStyleSheets;
      vi.unstubAllGlobals();
      vi.stubGlobal('matchMedia', () => media);
    });

    it('falls back to a <style> if building the sheet fails', () => {
      vi.stubGlobal(
        'CSSStyleSheet',
        class {
          replaceSync(): void {
            throw new Error('not allowed');
          }
        },
      );
      mount('<hw-theme-toggle></hw-theme-toggle>');
      expect(host().shadowRoot!.querySelector('style')).not.toBeNull();
    });

    it('adopts one shared sheet, so a strict CSP needs no style hash', () => {
      class Sheet {
        css = '';
        replaceSync(css: string): void {
          this.css = css;
        }
      }
      vi.stubGlobal('CSSStyleSheet', Sheet);
      mount('<hw-theme-toggle></hw-theme-toggle><hw-theme-toggle></hw-theme-toggle>');
      const [a, b] = [host(0).shadowRoot!, host(1).shadowRoot!];
      expect(a.querySelector('style')).toBeNull();
      const sheets = (a as unknown as { adoptedStyleSheets: Sheet[] }).adoptedStyleSheets;
      expect(sheets).toHaveLength(1);
      expect(sheets[0].css).toContain('border-radius:50%');
      expect((b as unknown as { adoptedStyleSheets: Sheet[] }).adoptedStyleSheets[0]).toBe(sheets[0]);
    });
  });
});

describe('loading it more than once', () => {
  it('a second copy changes nothing', async () => {
    const before = window.hintwise!.theme;
    const Toggle = customElements.get('hw-theme-toggle');
    vi.resetModules();
    await import(SRC);
    expect(window.hintwise!.theme).toBe(before);
    expect(customElements.get('hw-theme-toggle')).toBe(Toggle);
  });

  it('keeps window.hintwise.track from hw-events.js', async () => {
    const track = (): void => {};
    window.hintwise = { track } as HintwiseGlobal;
    vi.resetModules();
    vi.stubGlobal('matchMedia', undefined);
    await import(SRC);
    expect((window.hintwise as HintwiseGlobal & { track: unknown }).track).toBe(track);
    // Without matchMedia it starts from the stored choice, else light.
    expect(window.hintwise!.theme!.get()).toBe(root.getAttribute('data-theme'));
    window.hintwise!.theme!.set(null);
    expect(window.hintwise!.theme!.get()).toBe('light');
  });

  it('listens with addListener in browsers that only have that', async () => {
    let listener: (() => void) | undefined;
    const old = { matches: false, addListener: (fn: () => void) => (listener = fn) };
    window.hintwise = undefined;
    vi.resetModules();
    vi.stubGlobal('matchMedia', () => old);
    await import(SRC);
    old.matches = true;
    listener!();
    expect(window.hintwise!.theme!.get()).toBe('dark');
  });

  it('defines nothing in a browser without custom elements', async () => {
    window.hintwise = undefined;
    vi.resetModules();
    vi.stubGlobal('customElements', undefined);
    await import(SRC);
    expect(window.hintwise!.theme).toBeDefined();
    vi.unstubAllGlobals();
  });
});
