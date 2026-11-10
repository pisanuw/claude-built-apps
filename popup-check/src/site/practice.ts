/**
 * A practice shop with sample popups, some built badly on purpose, so an owner
 * can see what Popup Check reports before trying it on their own store.
 * Layout styles are inline so the samples behave the same everywhere.
 */
import { togglePanel, type Panel, type PanelOptions } from '../panel/panel';
import { hIn } from '../ui/h';

export type SampleId = 'bad-email' | 'good-email' | 'age' | 'cookie' | 'chat';

export const SAMPLES: { id: SampleId; label: string; note: string }[] = [
  { id: 'bad-email', label: 'Discount popup, badly built', note: 'The kind that gets stores into trouble: no name on the ×, no focus, no Escape.' },
  { id: 'good-email', label: 'Discount popup, well built', note: 'What a passing popup looks like.' },
  { id: 'age', label: 'Age gate', note: 'Built well, so it should pass.' },
  { id: 'cookie', label: 'Cookie banner', note: 'One hidden problem.' },
  { id: 'chat', label: 'Chat button', note: 'An icon with no name.' },
];

const BACKDROP = 'position:fixed;inset:0;background:rgba(10,20,30,.55);display:flex;align-items:center;justify-content:center;z-index:1000;';
const BOX = 'background:#ffffff;color:#1d2430;max-width:420px;width:calc(100% - 32px);padding:24px;border-radius:12px;position:relative;font:16px/1.5 system-ui,sans-serif;';

export interface Practice {
  open(id: SampleId): HTMLElement;
  close(id: SampleId): void;
  isOpen(id: SampleId): boolean;
  launchCheck(): Panel | null;
}

export function mountPractice(root: HTMLElement, opts: { panel?: Partial<PanelOptions>; checkDelayMs?: number } = {}): Practice {
  const doc = root.ownerDocument;
  const h = hIn(doc);
  const open = new Map<SampleId, { el: HTMLElement; cleanup: () => void }>();
  let panel: Panel | null = null;

  function close(id: SampleId): void {
    const o = open.get(id);
    if (!o) return;
    o.cleanup();
    o.el.remove();
    open.delete(id);
  }

  function badEmail(): { el: HTMLElement; cleanup: () => void } {
    const closeX = h('span', { class: 'x', style: 'position:absolute;top:6px;right:10px;cursor:pointer;color:#555;font-size:18px;' }, '×');
    const submit = h('div', { class: 'btn', style: 'cursor:pointer;background:#c2185b;color:#ffffff;text-align:center;padding:10px;border-radius:6px;margin-top:10px;' }, 'Get my code');
    const el = h(
      'div',
      { class: 'promo-overlay', style: BACKDROP },
      h(
        'div',
        { class: 'promo-box', style: BOX },
        closeX,
        h('img', { src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2240%22/%3E', width: '80', height: '40', style: 'display:block;margin:0 auto 8px;' }),
        h('div', { style: 'font-size:24px;font-weight:700;' }, 'Get 15% off your first order'),
        h('input', { type: 'email', placeholder: 'Email', style: 'width:100%;padding:8px;margin-top:10px;' }),
        submit,
        h('div', { style: 'color:#b5b5b5;font-size:13px;margin-top:8px;' }, 'No spam. Unsubscribe any time.'),
      ),
    );
    const done = (): void => close('bad-email');
    closeX.addEventListener('click', done);
    submit.addEventListener('click', done);
    return { el, cleanup: () => undefined };
  }

  function trapped(el: HTMLElement, id: SampleId, opener: Element | null, escape: boolean): () => void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && escape) {
        e.preventDefault();
        close(id);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>('button, input, a[href]'));
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }

  function goodEmail(opener: Element | null): { el: HTMLElement; cleanup: () => void } {
    const email = h('input', { type: 'email', id: 'pc-good-email', autocomplete: 'email', style: 'width:100%;padding:8px;margin-top:4px;' });
    const box = h(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pc-good-title', style: BOX },
      h('button', { type: 'button', 'aria-label': 'Close', 'data-close': '', style: 'position:absolute;top:8px;right:8px;width:36px;height:36px;font-size:22px;background:#ffffff;color:#1d2430;border:1px solid #6b7480;border-radius:6px;cursor:pointer;' }, '×'),
      h('h2', { id: 'pc-good-title', style: 'margin:0 0 8px;font-size:24px;' }, 'Get 15% off your first order'),
      h('label', { for: 'pc-good-email' }, 'Email address'),
      email,
      h('button', { type: 'button', 'data-close': '', style: 'display:block;width:100%;margin-top:10px;padding:10px;background:#ad1457;color:#ffffff;border:0;border-radius:6px;cursor:pointer;' }, 'Get my code'),
      h('p', { style: 'color:#4f5866;font-size:14px;margin:8px 0 0;' }, 'No spam. Unsubscribe any time.'),
    );
    const el = h('div', { class: 'promo-overlay', style: BACKDROP }, box);
    box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close('good-email')));
    const cleanup = trapped(box, 'good-email', opener, true);
    queueMicrotask(() => email.focus());
    return { el, cleanup };
  }

  function ageGate(opener: Element | null): { el: HTMLElement; cleanup: () => void } {
    const yes = h('button', { type: 'button', style: 'padding:10px 18px;margin-right:8px;background:#2e5e3e;color:#ffffff;border:0;border-radius:6px;cursor:pointer;' }, 'Yes, I am 21 or older');
    const no = h('button', { type: 'button', style: 'padding:10px 18px;background:#ffffff;color:#1d2430;border:1px solid #6b7480;border-radius:6px;cursor:pointer;' }, 'No');
    const box = h(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pc-age-title', style: BOX },
      h('h2', { id: 'pc-age-title', style: 'margin:0 0 8px;font-size:22px;' }, 'Are you 21 or older?'),
      h('p', {}, 'You must be of legal drinking age to enter this shop.'),
      yes,
      no,
    );
    const el = h('div', { class: 'entry-check', style: `${BACKDROP}background:#1d2430;` }, box);
    yes.addEventListener('click', () => close('age'));
    no.addEventListener('click', () => {
      box.querySelector('p')!.textContent = 'Sorry, you need to be 21 or older to enter.';
    });
    const cleanup = trapped(box, 'age', opener, false);
    queueMicrotask(() => yes.focus());
    return { el, cleanup };
  }

  function cookie(): { el: HTMLElement; cleanup: () => void } {
    const accept = h('button', { type: 'button', style: 'padding:8px 14px;background:#1f5f8b;color:#ffffff;border:0;border-radius:6px;cursor:pointer;' }, 'Accept all');
    const reject = h('button', { type: 'button', style: 'padding:8px 14px;background:#ffffff;color:#1f5f8b;border:1px solid #1f5f8b;border-radius:6px;cursor:pointer;' }, 'Reject');
    const manage = h('span', { class: 'manage-link', style: 'cursor:pointer;text-decoration:underline;color:#1f5f8b;' }, 'Manage choices');
    const el = h(
      'div',
      { class: 'cookie-bar', role: 'region', 'aria-label': 'Cookie choices', style: 'position:fixed;left:0;right:0;bottom:0;height:120px;background:#f4f6f8;color:#1d2430;border-top:1px solid #c5ccd6;padding:14px 16px;z-index:999;font:15px/1.5 system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:center;' },
      h('p', { style: 'margin:0;flex:1 1 300px;' }, 'We use cookies to remember your basket and to see which pages are popular.'),
      accept,
      reject,
      manage,
    );
    for (const b of [accept, reject]) b.addEventListener('click', () => close('cookie'));
    return { el, cleanup: () => undefined };
  }

  function chat(): { el: HTMLElement; cleanup: () => void } {
    const btn = h(
      'button',
      { type: 'button', class: 'chat-launcher', style: 'position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#1f5f8b;border:0;cursor:pointer;z-index:998;' },
    );
    btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M4 4h16v12H7l-3 3z"/></svg>';
    return { el: btn, cleanup: () => undefined };
  }

  function openSample(id: SampleId): HTMLElement {
    if (open.has(id)) return open.get(id)!.el;
    const opener = doc.activeElement;
    const made = id === 'bad-email' ? badEmail() : id === 'good-email' ? goodEmail(opener) : id === 'age' ? ageGate(opener) : id === 'cookie' ? cookie() : chat();
    open.set(id, made);
    (doc.body ?? root).append(made.el);
    return made.el;
  }

  function launchCheck(): Panel | null {
    panel = togglePanel({ siteUrl: new URL('./', doc.location?.href ?? 'https://popup-check.hintwise.org/').href, ...opts.panel }, panel);
    return panel;
  }

  /** A modal sample covers the page, so the check starts on its own shortly after a sample opens. */
  function checkSoon(): void {
    (doc.defaultView ?? window).setTimeout(() => {
      if (panel?.isOpen()) void panel.check();
      else launchCheck();
    }, opts.checkDelayMs ?? 700);
  }

  root.replaceChildren(
    h(
      'div',
      { class: 'practice-bar' },
      h('p', { class: 'practice-intro' }, h('strong', {}, 'Practice shop. '), 'Nothing here is for sale. Open a sample popup and Popup Check runs on it a moment later, just as it does when you click the bookmark on your own store. Close the popup to try the next one.'),
      h(
        'div',
        { class: 'practice-buttons' },
        ...SAMPLES.map((s) => {
          const b = h('button', { type: 'button', title: s.note }, `Open: ${s.label}`);
          b.addEventListener('click', () => {
            openSample(s.id);
            checkSoon();
          });
          return b;
        }),
      ),
      (() => {
        const b = h('button', { type: 'button', class: 'run' }, 'Run Popup Check here');
        b.addEventListener('click', () => launchCheck());
        return b;
      })(),
    ),
    h(
      'div',
      { class: 'shop' },
      h('header', { class: 'shop-head' }, h('span', { class: 'shop-name' }, 'Fern & Field Goods'), h('nav', { 'aria-label': 'Shop' }, h('a', { href: '#' }, 'Candles'), ' ', h('a', { href: '#' }, 'Soap'), ' ', h('a', { href: '#' }, 'Gifts'))),
      h(
        'main',
        { class: 'shop-grid' },
        ...['Cedar candle', 'Oat soap bar', 'Linen tea towel', 'Gift box'].map((name, i) =>
          h('article', { class: 'product' }, h('div', { class: 'swatch', 'aria-hidden': 'true', style: `background:hsl(${i * 70 + 20} 35% 70%)` }), h('h3', {}, name), h('p', {}, `$${(12 + i * 6).toFixed(2)}`), h('a', { href: '#' }, `View ${name}`)),
        ),
      ),
    ),
  );

  return { open: openSample, close, isOpen: (id) => open.has(id), launchCheck };
}
