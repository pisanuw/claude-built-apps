/**
 * The page: the shop, the delivery-email check, and the shop's history.
 * Everything the page needs from outside comes through AppDeps, so the
 * tests run it under jsdom with memory stores and fake link tests.
 */
import { analyseEmail, EmailError } from '../core/email';
import { baselineFrom, evaluate, toReport, verdictOf } from '../core/findings';
import { APP_NAMES, downloadCandidates } from '../core/links';
import { sampleEmail, sampleFileUrl } from '../core/sample';
import type { DeliveryAppId, EmailAnalysis, FoundLink, LinkResult, Placement } from '../core/types';
import { newId } from '../lib/repository';
import { byNewest, type CheckRow, type ShopRow, type Stores } from '../store/stores';
import { clear, h, when } from './dom';
import { NeedsSignIn } from './linkclient';
import { PLACEMENT_TEXT, renderReport, VERDICT_TEXT } from './report';

export interface AppDeps {
  /** Stores for the current sign-in state. */
  stores: Stores;
  checkLink: (url: string) => Promise<LinkResult>;
  /** Mounts the sign-in panel and calls back with the stores to use whenever the user changes; absent without Supabase. */
  mountAuth?: (el: HTMLElement, onStores: (stores: Stores) => void) => void;
  origin: string;
  basePath: string;
  now?: () => Date;
}

const PLACEMENTS: Placement[] = ['inbox', 'promotions', 'spam', 'other', 'unknown'];
const APP_IDS = Object.keys(APP_NAMES) as DeliveryAppId[];

interface Current {
  analysis: EmailAnalysis;
  placement: Placement;
  link: LinkResult | null;
  linkSkipped: string;
  linkUrl: string;
  savedId: string | null;
}

export function mountApp(root: HTMLElement, deps: AppDeps): { refresh: () => Promise<void> } {
  const now = deps.now ?? (() => new Date());
  let stores = deps.stores;
  let shop: ShopRow | null = null;
  let current: Current | null = null;
  let busy = false;

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const say = (text: string) => {
    status.textContent = text;
  };

  // Shop settings.
  const shopName = h('input', { id: 'shop-name', type: 'text', maxlength: '120', autocomplete: 'organization', placeholder: 'My pattern shop' });
  const appSelect = h('select', { id: 'shop-app' }, ...APP_IDS.map((id) => h('option', { value: id }, id === 'unknown' ? 'Not sure / other' : APP_NAMES[id])));
  const baselineLine = h('p', { class: 'baseline', id: 'baseline-line' });
  const saveShop = h('button', { type: 'button', id: 'save-shop' }, 'Save shop');
  const saveNote = h('p', { class: 'hint', id: 'save-note' });

  // The check form.
  const fileInput = h('input', { id: 'eml-file', type: 'file', accept: '.eml,message/rfc822,.txt' });
  const paste = h('textarea', { id: 'eml-paste', rows: '6', spellcheck: 'false', placeholder: 'Or paste the email source here (Gmail: More, then "Show original", then "Copy to clipboard")' });
  const placementBox = h(
    'fieldset',
    { class: 'placement' },
    h('legend', {}, 'Where did it land?'),
    ...PLACEMENTS.map((p) =>
      h('label', {}, h('input', { type: 'radio', name: 'placement', value: p, checked: p === 'unknown' }), ` ${p === 'unknown' ? 'Not sure' : PLACEMENT_TEXT[p]}`),
    ),
  );
  const checkBtn = h('button', { type: 'submit', id: 'run-check', class: 'primary' }, 'Check this email');
  const sampleBtn = h('button', { type: 'button', id: 'run-sample' }, 'Try the sample email');
  const form = h(
    'form',
    { id: 'check-form', novalidate: true },
    h('label', { for: 'eml-file', class: 'block' }, 'The delivery email (.eml file)'),
    fileInput,
    h('label', { for: 'eml-paste', class: 'visually-hidden' }, 'Email source'),
    paste,
    placementBox,
    h('div', { class: 'actions' }, checkBtn, sampleBtn),
  );

  const result = h('div', { id: 'result', tabindex: '-1' });
  const history = h('div', { id: 'history' });
  const authEl = h('section', { id: 'signin', 'aria-label': 'Sign in' });

  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('div', {}, h('h1', {}, 'Delivery Canary'), h('p', { class: 'tagline' }, 'Does your download email reach the inbox, and does its link still open the right file? Check one in a minute.')),
      authEl,
    ),
    h(
      'main',
      {},
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'check-h' },
        h('h2', { id: 'check-h' }, 'Check a delivery email'),
        h(
          'details',
          { class: 'howto' },
          h('summary', {}, 'How to get the email from Gmail'),
          h(
            'ol',
            {},
            h('li', {}, 'Place a test order in your shop (a 100% off code works) using a Gmail address you keep for testing.'),
            h('li', {}, 'Open the download email in that Gmail account and note where it landed: Inbox, Promotions or Spam.'),
            h('li', {}, 'Choose More (the three dots next to Reply), then "Download message". Drop the .eml file here.'),
          ),
          h('p', {}, 'The email is read in your browser and never uploaded. Only the download link is tested, and only its host and the result are saved.'),
        ),
        form,
        status,
        result,
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'shop-h' },
        h('h2', { id: 'shop-h' }, 'Your shop'),
        h('div', { class: 'grid2' }, h('div', {}, h('label', { for: 'shop-name', class: 'block' }, 'Shop name'), shopName), h('div', {}, h('label', { for: 'shop-app', class: 'block' }, 'Delivery app'), appSelect)),
        baselineLine,
        h('div', { class: 'actions' }, saveShop),
        saveNote,
      ),
      h('section', { class: 'card', 'aria-labelledby': 'history-h' }, h('h2', { id: 'history-h' }, 'History'), history),
    ),
  );

  function placementChosen(): Placement {
    const el = placementBox.querySelector<HTMLInputElement>('input[name="placement"]:checked');
    return (el?.value as Placement | undefined) ?? 'unknown';
  }

  function setPlacement(p: Placement): void {
    const el = placementBox.querySelector<HTMLInputElement>(`input[value="${p}"]`);
    if (el) el.checked = true;
  }

  function renderShop(): void {
    shopName.value = shop?.name ?? '';
    appSelect.value = shop?.delivery_app && APP_IDS.includes(shop.delivery_app as DeliveryAppId) ? shop.delivery_app : 'unknown';
    const b = shop?.baseline;
    baselineLine.textContent = b
      ? `Baseline file: ${b.fileName || 'unnamed file'} from ${b.host}, saved ${when(b.setAt)}. Later checks compare the delivered file with it.`
      : 'No baseline file yet. After a check whose link gives the right file, save it as the baseline.';
    saveNote.textContent = stores.saved ? 'Saved to your account.' : 'Sign in to keep your shop and its history. Signed out, nothing leaves this page.';
  }

  async function ensureShop(): Promise<ShopRow> {
    if (shop) return shop;
    const row: ShopRow = { id: newId(), name: shopName.value.trim() || 'My shop', delivery_app: appSelect.value, baseline: null, created_at: now().toISOString() };
    shop = await stores.shops.put(row);
    return shop;
  }

  async function renderHistory(): Promise<void> {
    clear(history);
    const rows = shop ? byNewest((await stores.checks.list()).filter((c) => c.shop_id === shop?.id)) : [];
    if (!rows.length) {
      history.append(h('p', { class: 'empty' }, stores.saved ? 'No checks yet. Your checks will be listed here.' : 'Checks made while signed out are listed here until you leave the page.'));
      return;
    }
    const list = h('ul', { class: 'history-list' });
    for (const c of rows) {
      const view = h('button', { type: 'button', class: 'link', 'data-view': c.id }, 'View');
      const del = h('button', { type: 'button', class: 'link danger', 'data-delete': c.id, 'aria-label': `Delete the check of ${when(c.created_at)}` }, 'Delete');
      view.addEventListener('click', () => {
        current = null;
        clear(result);
        result.append(renderReport(c.report, { verdict: c.verdict, checkedAt: c.created_at }));
        result.focus();
      });
      del.addEventListener('click', () => {
        void (async () => {
          try {
            await stores.checks.remove(c.id);
            if (current?.savedId === c.id) current.savedId = null;
            say('Check deleted.');
          } catch (e) {
            say(`Could not delete: ${(e as Error).message}`);
          }
          await renderHistory();
        })();
      });
      list.append(
        h(
          'li',
          { class: `verdict-${c.verdict}` },
          h('span', { class: 'when' }, when(c.created_at)),
          h('span', { class: 'v' }, VERDICT_TEXT[c.verdict]),
          h('span', { class: 'p' }, PLACEMENT_TEXT[c.placement]),
          h('span', { class: 's' }, c.subject),
          h('span', { class: 'row-actions' }, view, del),
        ),
      );
    }
    history.append(list);
  }

  async function load(): Promise<void> {
    try {
      const shops = byNewest(await stores.shops.list());
      shop = shops[shops.length - 1] ?? null; // the oldest: the first shop made
    } catch (e) {
      shop = null;
      say(`Could not load your shop: ${(e as Error).message}`);
    }
    renderShop();
    try {
      await renderHistory();
    } catch (e) {
      say(`Could not load your history: ${(e as Error).message}`);
    }
  }

  /** Re-evaluates the current check (after a new link test or a new baseline) and shows it. */
  async function show(save: boolean): Promise<void> {
    if (!current) return;
    const input = { analysis: current.analysis, placement: current.placement, link: current.link, linkSkipped: current.linkSkipped, baseline: shop?.baseline ?? null };
    const findings = evaluate(input);
    const verdict = verdictOf(findings);
    const report = toReport(input, findings);
    clear(result);
    result.append(renderReport(report, { verdict }));
    const extra = h('div', { class: 'after' });
    const good = current.link ? baselineFrom(current.link, now()) : null;
    if (good && (!shop?.baseline || shop.baseline.sha256 !== good.sha256)) {
      const b = h('button', { type: 'button', id: 'set-baseline' }, shop?.baseline ? 'Save this file as the new baseline' : 'Save this file as the baseline');
      b.addEventListener('click', () => void setBaseline());
      extra.append(b);
    }
    const others = downloadCandidates(current.analysis.links).filter((l) => l.url !== current?.linkUrl);
    if (others.length) {
      extra.append(h('p', {}, 'Other links that may be the download:'));
      const ul = h('ul', { class: 'others' });
      for (const l of others.slice(0, 5)) ul.append(h('li', {}, otherLinkButton(l)));
      extra.append(ul);
    }
    if (extra.childNodes.length) result.append(extra);
    if (save) {
      const saving = current;
      try {
        const s = await ensureShop();
        const row: CheckRow = { id: saving.savedId ?? newId(), shop_id: s.id, created_at: now().toISOString(), verdict, placement: saving.placement, subject: saving.analysis.subject, report };
        await stores.checks.put(row);
        saving.savedId = row.id;
        say(stores.saved ? 'Checked and saved to your history.' : 'Checked. Sign in to keep this check.');
      } catch (e) {
        say(`Checked, but not saved: ${(e as Error).message}`);
      }
    }
    await renderHistory();
    result.focus();
  }

  function otherLinkButton(l: FoundLink): HTMLButtonElement {
    let host = '';
    try {
      host = new URL(l.url).hostname;
    } catch {
      /* found links are valid URLs */
    }
    const b = h('button', { type: 'button', class: 'link' }, `Test the link "${l.text || host}" (${host})`);
    b.addEventListener('click', () => void retest(l.url));
    return b;
  }

  async function testLink(url: string): Promise<void> {
    if (!current) return;
    current.linkUrl = url;
    current.link = null;
    current.linkSkipped = '';
    try {
      say('Testing the download link…');
      current.link = await deps.checkLink(url);
    } catch (e) {
      current.linkSkipped = e instanceof NeedsSignIn ? e.message : 'The link test could not run.';
    }
  }

  async function retest(url: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await testLink(url);
      await show(true);
    } finally {
      busy = false;
    }
  }

  async function setBaseline(): Promise<void> {
    if (!current?.link) return;
    const b = baselineFrom(current.link, now());
    if (!b) return;
    try {
      const s = await ensureShop();
      shop = await stores.shops.put({ ...s, baseline: b, updated_at: now().toISOString() });
      renderShop();
      say(`Saved ${b.fileName || 'this file'} as the baseline.`);
    } catch (e) {
      say(`Could not save the baseline: ${(e as Error).message}`);
      return;
    }
    await show(true);
  }

  async function run(raw: string | ArrayBuffer): Promise<void> {
    if (busy) return;
    busy = true;
    checkBtn.disabled = true;
    sampleBtn.disabled = true;
    try {
      say('Reading the email…');
      let analysis: EmailAnalysis;
      try {
        analysis = await analyseEmail(raw);
      } catch (e) {
        clear(result);
        say(e instanceof EmailError ? e.message : 'This file could not be read as an email.');
        return;
      }
      let placement = placementChosen();
      if (placement === 'unknown' && analysis.labelPlacement) {
        placement = analysis.labelPlacement;
        setPlacement(placement);
      }
      if (shop?.delivery_app === 'unknown' || !shop) {
        if (analysis.app.id !== 'unknown') appSelect.value = analysis.app.id;
      }
      current = { analysis, placement, link: null, linkSkipped: '', linkUrl: '', savedId: null };
      const best = downloadCandidates(analysis.links)[0];
      if (best) await testLink(best.url);
      await show(true);
    } finally {
      busy = false;
      checkBtn.disabled = false;
      sampleBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const file = fileInput.files?.[0];
    if (file) {
      void file.arrayBuffer().then(run, () => say('The file could not be opened.'));
      return;
    }
    if (paste.value.trim()) {
      void run(paste.value);
      return;
    }
    say('Choose the .eml file of a delivery email, or paste its source, or try the sample.');
  });

  sampleBtn.addEventListener('click', () => {
    const raw = sampleEmail(sampleFileUrl(deps.origin, deps.basePath));
    fileInput.value = '';
    paste.value = raw;
    setPlacement('unknown');
    void run(raw);
  });

  saveShop.addEventListener('click', () => {
    void (async () => {
      const name = shopName.value.trim();
      if (!name) {
        say('Give the shop a name first.');
        shopName.focus();
        return;
      }
      try {
        const base: ShopRow = shop ?? { id: newId(), name, delivery_app: appSelect.value, baseline: null, created_at: now().toISOString() };
        shop = await stores.shops.put({ ...base, name, delivery_app: appSelect.value, updated_at: now().toISOString() });
        renderShop();
        say(stores.saved ? 'Shop saved.' : 'Shop saved on this page. Sign in to keep it.');
      } catch (e) {
        say(`Could not save the shop: ${(e as Error).message}`);
      }
    })();
  });

  if (deps.mountAuth) {
    deps.mountAuth(authEl, (next) => {
      stores = next;
      current = null;
      clear(result);
      void load();
    });
  } else {
    authEl.append(h('p', { class: 'hint' }, 'Preview: checks stay on this page.'));
  }
  void load();
  return { refresh: load };
}
