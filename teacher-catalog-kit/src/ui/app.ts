/**
 * The page: pick a seller tier, add resources with their product type and the
 * stores they are on, and see what each tier's rules say about every one.
 * Plain DOM, no framework; every node is built with text, never innerHTML
 * from data.
 */
import { centsToInput, formatCents, parseCents } from '../core/money';
import { checkResource, DATES, PRODUCT_TYPES, productType, RULES_CHECKED, SOURCES, verdict, VERDICT_LABELS, type Finding, type ProductTypeId, type Verdict } from '../core/rules';
import { LIMITS, STORES, storeLabel, TIER_LABELS, TIERS, type Listing, type Resource, type StoreId, type Tier } from '../core/types';
import type { CatalogStore } from '../store/catalog';
import { fill, h, uuid } from './dom';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthHooks {
  mount(el: HTMLElement): void;
  onUser(callback: (user: AuthUser | null) => void): void;
  accountStore(): CatalogStore;
}

export interface AppDeps {
  browser: CatalogStore;
  auth?: AuthHooks;
  /** Set when the browser blocks storage: the catalog then lasts only while the tab is open. */
  storageBlocked?: boolean;
  confirm?: (question: string) => boolean;
  now?: () => Date;
  newId?: () => string;
}

export interface AppHandle {
  /** Resolves when the current load (after a sign-in change) has finished. */
  ready(): Promise<void>;
  readonly store: CatalogStore;
}

const TIER_HELP: Record<Tier, string> = {
  undecided: 'See what each tier would mean for every resource before you choose.',
  exclusive: 'Higher payout on TPT, but digital teaching resources may be sold only on TPT.',
  basic: 'Sell anywhere, but TPT buyers must not pay more than buyers elsewhere.',
};

const BADGE: Record<Verdict, string> = { ok: 'good', note: 'muted', check: 'warn', conflict: 'bad' };

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function badge(v: Verdict, prefix = ''): HTMLElement {
  return h('span', { class: `badge ${BADGE[v]}` }, `${prefix}${VERDICT_LABELS[v]}`);
}

function findingList(findings: readonly Finding[], labelId?: string): HTMLElement {
  if (findings.length === 0) return h('p', { class: 'ok', text: 'Nothing to change.' });
  return h(
    'ul',
    { class: 'findings', 'aria-labelledby': labelId },
    ...findings.map((f) => h('li', { class: `finding ${f.severity}` }, h('span', { class: 'sr-only' }, `${f.severity === 'conflict' ? 'Problem' : f.severity === 'check' ? 'Check' : 'Note'}: `), f.message)),
  );
}

/** The tiers a page shows: both while the seller is still deciding. */
function shownTiers(tier: Tier): ('exclusive' | 'basic')[] {
  return tier === 'undecided' ? ['exclusive', 'basic'] : [tier];
}

export async function mountApp(root: HTMLElement, deps: AppDeps): Promise<AppHandle> {
  const confirmFn = deps.confirm ?? ((q: string) => window.confirm(q));
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => uuid());

  let store: CatalogStore = deps.browser;
  let user: AuthUser | null = null;
  let resources: Resource[] = [];
  let tier: Tier = 'undecided';
  let editing: Resource | null = null;
  let loading: Promise<void> = Promise.resolve();
  let loadSeq = 0;
  let browserCount = 0;

  // ---- skeleton -------------------------------------------------------
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const accountBox = h('div', { class: 'account-note' });
  const signin = h('section', { class: 'card', 'aria-labelledby': 'account-h' },
    h('h2', { id: 'account-h', text: 'Your catalog' }),
    accountBox,
  );
  const authEl = h('div', { class: 'auth' });
  if (deps.auth) signin.append(authEl);

  const tierFieldset = h('fieldset', { class: 'mode' }, h('legend', { text: 'Your TPT seller tier from 1 January 2027' }));
  const tierInputs = new Map<Tier, HTMLInputElement>();
  for (const t of TIERS) {
    const input = h('input', { type: 'radio', name: 'tier', value: t, id: `tier-${t}`, 'aria-describedby': `tier-${t}-help` });
    input.addEventListener('change', () => void chooseTier(t));
    tierInputs.set(t, input);
    tierFieldset.append(
      h('div', { class: 'radio' }, input, h('label', { for: `tier-${t}`, text: TIER_LABELS[t] })),
      h('p', { class: 'help tier-help', id: `tier-${t}-help`, text: TIER_HELP[t] }),
    );
  }
  const tierSection = h('section', { class: 'card', 'aria-labelledby': 'tier-h' },
    h('h2', { id: 'tier-h', text: 'Which tier?' }),
    tierFieldset,
    h('p', { class: 'help' }, `Exclusive sign-up closes ${longDate(DATES.exclusiveDeadline)}. Premium sellers who do not sign up become Basic on ${longDate(DATES.basicConversion)}.`),
  );

  // Form
  const formTitle = h('h2', { id: 'form-h', text: 'Add a resource' });
  const titleInput = h('input', { type: 'text', id: 'f-title', maxlength: LIMITS.title, autocomplete: 'off', required: true });
  const typeSelect = h('select', { id: 'f-type', 'aria-describedby': 'f-type-help' });
  for (const t of PRODUCT_TYPES) typeSelect.append(h('option', { value: t.id, text: t.label }));
  const typeHelp = h('p', { class: 'help', id: 'f-type-help' });
  const tptPrice = h('input', { type: 'text', id: 'f-tpt', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'f-tpt-help' });
  const storeRows = new Map<StoreId, { box: HTMLInputElement; price: HTMLInputElement }>();
  const storeFieldset = h('fieldset', { class: 'stores' }, h('legend', { text: 'Also sold on' }));
  for (const s of STORES) {
    const box = h('input', { type: 'checkbox', id: `s-${s.id}` });
    const price = h('input', { type: 'text', id: `s-${s.id}-price`, inputmode: 'decimal', autocomplete: 'off', class: 'price', disabled: true, 'aria-label': `Price on ${s.label}` });
    box.addEventListener('change', () => {
      price.disabled = !box.checked;
      if (box.checked) price.focus();
      preview();
    });
    price.addEventListener('input', preview);
    storeRows.set(s.id, { box, price });
    storeFieldset.append(h('div', { class: 'store-row' }, box, h('label', { for: `s-${s.id}`, text: s.label }), price));
  }
  const notesInput = h('textarea', { id: 'f-notes', rows: 2, maxlength: LIMITS.notes });
  const formError = h('p', { class: 'problems', id: 'form-error', role: 'alert' });
  const previewBox = h('div', { class: 'preview', 'aria-live': 'polite', id: 'preview' });
  const saveBtn = h('button', { type: 'submit', class: 'primary', text: 'Save resource' });
  const cancelBtn = h('button', { type: 'button', text: 'Cancel', hidden: true });
  const form = h('form', { class: 'resource-form', novalidate: true },
    h('div', { class: 'grid' },
      h('label', { for: 'f-title', text: 'Title' }), titleInput,
      h('label', { for: 'f-type', text: 'Product type' }), h('div', {}, typeSelect, typeHelp),
      h('label', { for: 'f-tpt', text: 'Price on TPT' }), h('div', {}, tptPrice, h('p', { class: 'help', id: 'f-tpt-help', text: 'In dollars, for example 4.50. Enter 0 if it is free; leave empty if it is not on TPT.' })),
    ),
    storeFieldset,
    h('p', { class: 'help', text: 'Tick each other store it is listed on and enter its price there (0 for free).' }),
    h('div', { class: 'grid' }, h('label', { for: 'f-notes', text: 'Notes (optional)' }), notesInput),
    previewBox,
    formError,
    h('div', { class: 'row' }, saveBtn, cancelBtn),
  );
  const formSection = h('section', { class: 'card', 'aria-labelledby': 'form-h' }, formTitle, form);

  const listHeading = h('h2', { id: 'list-h', text: 'Your resources', tabindex: -1 });
  const summary = h('p', { class: 'lead', id: 'summary' });
  const listBox = h('div', { class: 'scroll', id: 'list' });
  const listSection = h('section', { class: 'card', 'aria-labelledby': 'list-h' }, listHeading, summary, listBox);

  const sources = h('section', { class: 'card sources', 'aria-labelledby': 'sources-h' },
    h('h2', { id: 'sources-h', text: 'Where the rules come from' }),
    h('p', {}, `The rules were last checked on ${longDate(RULES_CHECKED)}. TPT can change them; read TPT's own pages before you decide.`),
    h('ul', {}, ...Object.values(SOURCES).map((s) => h('li', {}, h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title), s.confirmed ? '' : ' (TPT help centre)'))),
    h('p', { class: 'help', text: 'Teacher Catalog Kit is not made by, or affiliated with, Teachers Pay Teachers. It gives no legal or tax advice.' }),
  );

  fill(root,
    h('header', {},
      h('h1', { text: 'Teacher Catalog Kit' }),
      h('p', { class: 'lede', text: 'Check every resource you sell against the TPT Exclusive and Basic seller rules: which products may stay on Payhip, Etsy, TES or your own site, and which prices need to match.' }),
    ),
    status,
    tierSection,
    formSection,
    listSection,
    signin,
    sources,
  );

  // ---- helpers ----------------------------------------------------------
  const say = (text: string) => {
    status.textContent = text;
  };

  function readForm(): { resource: Resource | null; error: string } {
    const title = titleInput.value.trim();
    const tptText = tptPrice.value.trim();
    const tptCents = tptText === '' ? null : parseCents(tptText);
    const listings: Listing[] = [];
    let error = '';
    if (!title) error = 'Give the resource a title.';
    else if (tptText !== '' && tptCents === null) error = 'The TPT price should be a number of dollars, like 4.50.';
    for (const s of STORES) {
      const row = storeRows.get(s.id);
      if (!row?.box.checked) continue;
      const t = row.price.value.trim();
      const c = t === '' ? null : parseCents(t);
      if (t !== '' && c === null && !error) error = `The price on ${s.label} should be a number of dollars, like 4.50.`;
      const kept = editing?.listings.find((l) => l.store === s.id);
      listings.push({ store: s.id, priceCents: c, ...(kept?.url ? { url: kept.url } : {}) });
    }
    const stamp = now().toISOString();
    const resource: Resource = {
      id: editing?.id ?? 'preview',
      title: title || 'This resource',
      productType: typeSelect.value as ProductTypeId,
      tptPriceCents: tptCents,
      tptId: editing?.tptId ?? null,
      listings,
      notes: notesInput.value.slice(0, LIMITS.notes),
      createdAt: editing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    return { resource: error ? null : resource, error };
  }

  function verdictBlock(r: Resource, headingLevel: 'h3' | 'h4', idBase: string): HTMLElement {
    const check = checkResource(r, storeLabel);
    const wrap = h('div', { class: 'verdicts' });
    for (const t of shownTiers(tier)) {
      const findings = check[t];
      const id = `${idBase}-${t}`;
      wrap.append(h('div', { class: 'verdict' },
        h(headingLevel, { id }, `If you are ${TIER_LABELS[t]}: `, badge(verdict(findings))),
        findingList(findings, id),
      ));
    }
    return wrap;
  }

  function preview(): void {
    typeHelp.textContent = `For example: ${productType(typeSelect.value as ProductTypeId).examples}. ${productType(typeSelect.value as ProductTypeId).rule}`;
    const { resource } = readForm();
    if (!resource || (!titleInput.value.trim() && resource.listings.length === 0)) {
      fill(previewBox);
      return;
    }
    if (resource.listings.length === 0) {
      fill(previewBox, h('p', { class: 'help', text: 'Tick the other stores it is on to see what the rules say.' }));
      return;
    }
    fill(previewBox, h('h3', { text: 'What the rules say' }), verdictBlock(resource, 'h4', 'pv'));
  }

  function resetForm(): void {
    editing = null;
    form.reset();
    for (const { price } of storeRows.values()) price.disabled = true;
    formTitle.textContent = 'Add a resource';
    saveBtn.textContent = 'Save resource';
    cancelBtn.hidden = true;
    formError.textContent = '';
    titleInput.removeAttribute('aria-invalid');
    preview();
  }

  function editResource(r: Resource): void {
    editing = r;
    titleInput.value = r.title;
    typeSelect.value = r.productType;
    tptPrice.value = centsToInput(r.tptPriceCents);
    notesInput.value = r.notes;
    for (const s of STORES) {
      const row = storeRows.get(s.id);
      if (!row) continue;
      const l = r.listings.find((x) => x.store === s.id);
      row.box.checked = Boolean(l);
      row.price.disabled = !l;
      row.price.value = l ? centsToInput(l.priceCents) : '';
    }
    formTitle.textContent = `Edit "${r.title}"`;
    saveBtn.textContent = 'Save changes';
    cancelBtn.hidden = false;
    formError.textContent = '';
    preview();
    titleInput.focus();
  }

  function renderTier(): void {
    for (const [t, input] of tierInputs) input.checked = t === tier;
  }

  function renderAccount(): void {
    const where = store.location === 'account'
      ? `Saved to your account${user?.email ? ` (${user.email})` : ''}. Sign in on any device to see it.`
      : deps.storageBlocked
        ? 'This browser blocks storage, so the catalog lasts only while this tab is open. Sign in to keep it.'
        : 'Kept in this browser only. Sign in to save it to an account and use it on any device.';
    const parts: (Node | string)[] = [h('p', { text: where })];
    if (store.location === 'account' && browserCount > 0) {
      const copy = h('button', { type: 'button', text: `Copy ${browserCount} resource${browserCount === 1 ? '' : 's'} from this browser to your account` });
      copy.addEventListener('click', () => void copyBrowserToAccount());
      parts.push(h('div', { class: 'row' }, copy));
    }
    if (!deps.auth) parts.push(h('p', { class: 'help', text: 'Sign-in is not available in this preview.' }));
    fill(accountBox, ...parts);
  }

  function renderList(): void {
    if (resources.length === 0) {
      fill(summary);
      fill(listBox, h('p', { class: 'empty', text: 'No resources yet. Add your first one above.' }));
      return;
    }
    const counts = shownTiers(tier).map((t) => {
      const bad = resources.filter((r) => verdict(checkResource(r)[t]) === 'conflict').length;
      return `${TIER_LABELS[t]}: ${bad === 0 ? 'no problems' : `${bad} of ${resources.length} ${bad === 1 ? 'breaks' : 'break'} the rules`}`;
    });
    summary.textContent = `${resources.length} resource${resources.length === 1 ? '' : 's'}. ${counts.join('. ')}.`;
    const table = h('table', { class: 'results' },
      h('caption', { class: 'sr-only', text: 'Your resources and what each tier allows' }),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', text: 'Resource' }),
        h('th', { scope: 'col', text: 'TPT price' }),
        h('th', { scope: 'col', text: 'Other stores' }),
        ...shownTiers(tier).map((t) => h('th', { scope: 'col', text: TIER_LABELS[t] })),
        h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' })),
      )),
    );
    const body = h('tbody');
    for (const r of resources) {
      const check = checkResource(r, storeLabel);
      const tr = h('tr', {},
        h('th', { scope: 'row' }, r.title, h('div', { class: 'id', text: productType(r.productType).label })),
        h('td', { 'data-label': 'TPT price', text: r.tptPriceCents === null ? 'Not on TPT' : formatCents(r.tptPriceCents) }),
        h('td', { 'data-label': 'Other stores', text: r.listings.length ? r.listings.map((l) => `${storeLabel(l.store)} ${l.priceCents === null ? '(no price)' : formatCents(l.priceCents)}`).join(', ') : 'None' }),
      );
      for (const t of shownTiers(tier)) {
        const findings = check[t];
        const cell = h('td', { 'data-label': TIER_LABELS[t], class: 'tier-cell' }, badge(verdict(findings)));
        if (findings.length) cell.append(h('ul', { class: 'cause' }, ...findings.map((f) => h('li', { text: f.message }))));
        tr.append(cell);
      }
      const edit = h('button', { type: 'button', class: 'link', 'aria-label': `Edit ${r.title}`, text: 'Edit' });
      edit.addEventListener('click', () => editResource(r));
      const del = h('button', { type: 'button', class: 'link danger', 'aria-label': `Delete ${r.title}`, text: 'Delete' });
      del.addEventListener('click', () => void removeResource(r));
      tr.append(h('td', { class: 'actions' }, edit, del));
      body.append(tr);
    }
    table.append(body);
    fill(listBox, table);
  }

  function renderAll(): void {
    renderTier();
    renderAccount();
    renderList();
    preview();
  }

  // ---- actions ----------------------------------------------------------
  async function load(): Promise<void> {
    const seq = ++loadSeq;
    const from = store;
    try {
      const [list, t, local] = await Promise.all([from.list(), from.getTier(), from === deps.browser ? Promise.resolve(null) : deps.browser.list()]);
      if (seq !== loadSeq) return; // a newer sign-in change won
      resources = list;
      tier = t;
      browserCount = local?.length ?? 0;
    } catch (e) {
      if (seq !== loadSeq) return;
      resources = [];
      say((e as Error).message);
    }
    renderAll();
  }

  async function chooseTier(t: Tier): Promise<void> {
    tier = t;
    renderAll();
    try {
      await store.setTier(t);
    } catch (e) {
      say((e as Error).message);
    }
  }

  async function saveResource(): Promise<void> {
    const { resource, error } = readForm();
    if (!resource) {
      formError.textContent = error;
      if (!titleInput.value.trim()) {
        titleInput.setAttribute('aria-invalid', 'true');
        titleInput.focus();
      }
      return;
    }
    titleInput.removeAttribute('aria-invalid');
    const isNew = !editing;
    const saved: Resource = { ...resource, id: editing?.id ?? newId() };
    const target = store;
    saveBtn.disabled = true;
    try {
      await target.put(saved);
      if (target !== store) return; // signed in or out meanwhile; the reload shows the truth
      const i = resources.findIndex((r) => r.id === saved.id);
      if (i >= 0) resources[i] = saved;
      else resources.push(saved);
      const v = shownTiers(tier).map((t) => `${TIER_LABELS[t]}: ${VERDICT_LABELS[verdict(checkResource(saved)[t])].toLowerCase()}`).join('; ');
      say(`${isNew ? 'Saved' : 'Updated'} "${saved.title}". ${v}.`);
      resetForm();
      renderList();
    } catch (e) {
      formError.textContent = (e as Error).message;
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function removeResource(r: Resource): Promise<void> {
    if (!confirmFn(`Delete "${r.title}" from your catalog?`)) return;
    try {
      await store.remove(r.id);
      resources = resources.filter((x) => x.id !== r.id);
      if (editing?.id === r.id) resetForm();
      say(`Deleted "${r.title}".`);
      renderList();
      listHeading.focus();
    } catch (e) {
      say((e as Error).message);
    }
  }

  async function copyBrowserToAccount(): Promise<void> {
    const target = store;
    if (target.location !== 'account') return;
    try {
      const local = await deps.browser.list();
      const have = new Set(resources.map((r) => r.id));
      let copied = 0;
      for (const r of local) {
        if (have.has(r.id)) continue;
        await target.put(r);
        copied++;
      }
      for (const r of local) await deps.browser.remove(r.id);
      say(`Copied ${copied} resource${copied === 1 ? '' : 's'} to your account and cleared them from this browser.`);
    } catch (e) {
      say((e as Error).message);
    }
    if (target === store) {
      loading = load();
      await loading;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void saveResource();
  });
  cancelBtn.addEventListener('click', () => {
    resetForm();
    say('Edit cancelled.');
  });
  for (const el of [titleInput, tptPrice, notesInput]) el.addEventListener('input', preview);
  typeSelect.addEventListener('change', preview);

  if (deps.auth) {
    deps.auth.mount(authEl);
    deps.auth.onUser((u) => {
      if ((u?.id ?? null) === (user?.id ?? null)) return;
      user = u;
      store = u ? (deps.auth as AuthHooks).accountStore() : deps.browser;
      if (editing) resetForm();
      loading = load();
    });
  }

  loading = load();
  await loading;
  return {
    ready: () => loading,
    get store() {
      return store;
    },
  };
}
