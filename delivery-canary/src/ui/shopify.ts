/**
 * The "Canary orders from Shopify" card (milestone 4). Signed in, the shop
 * connects its own Shopify app (made in the Dev Dashboard), picks a download
 * product, and places a canary: a free, tagged test order to the seed
 * address. The page then looks in the seed inbox for the download email at
 * set times (WAIT_SCHEDULE_S), records how long it took and where Gmail put
 * it, and runs the full delivery-email check on it. The late download order
 * scan can read the last 30 days of orders straight from Shopify too.
 *
 * Signed out, a sample canary shows what a result looks like.
 */
import { SLOW_TRANSIT_S, transitText, variantId, WAIT_SCHEDULE_S } from '../core/canary';
import type { ImportResult } from '../core/orders';
import { WHERE_TEXT, type SeedWhere } from '../core/seedwhere';
import type { Placement } from '../core/types';
import { newId } from '../lib/repository';
import { MemoryCanaryStore, type CanaryRow, type SeedInboxRow, type ShopConnectionRow, type ShopRow, type Stores } from '../store/stores';
import { clear, h, when } from './dom';
import { SeedCheckFailed, type SeedRequest, type SeedResponse } from './seedclient';
import { ShopifyCallFailed, type ShopClient, type Variant } from './shopclient';

export interface ShopifyCardDeps {
  stores: () => Stores;
  shop: () => ShopRow | null;
  ensureShop: () => Promise<ShopRow>;
  token: () => Promise<string | null>;
  /** The Shopify routes; null in previews (then only the sample runs). */
  client: ShopClient | null;
  seedCheck: (req: SeedRequest, token: string) => Promise<SeedResponse>;
  /** Runs the delivery-email check on the found message; the saved check's id, or null. */
  runEmail: (raw: ArrayBuffer, placement: Placement, seed: { where: SeedWhere; receivedAt: string }) => Promise<string | null>;
  /** The sample email as the canary would find it (signed out). */
  runSample: () => Promise<string | null>;
  /** Scans orders read from Shopify in the late orders card. */
  scanOrders: (imp: ImportResult, label: string) => Promise<boolean>;
  /** The seed inbox card's state changed (a check ran from here). */
  seedChanged?: () => Promise<void>;
  /** The schedule card should redraw: the canary product picked here changed, or the shop was disconnected. */
  chosenChanged?: () => Promise<void>;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export const STATUS_TEXT: Record<CanaryRow['status'], string> = {
  placing: 'being placed',
  placed: 'placed, email not found yet',
  failed: 'not placed',
  unknown: 'may have been placed',
  arrived: 'email arrived',
  'no-email': 'no email arrived',
};

/** One line on what became of a canary. */
export function canaryText(r: CanaryRow): string {
  const where = r.seed_where ? WHERE_TEXT[r.seed_where] : 'the seed inbox';
  if (r.status === 'arrived' && r.transit_seconds === null) return `Email arrived in ${where}; its arrival time could not be read.`;
  if (r.status === 'arrived' && r.transit_seconds !== null) {
    return `Email arrived after ${transitText(r.transit_seconds)}, in ${where}.${r.transit_seconds > SLOW_TRANSIT_S ? ' Slow: buyers usually expect it within a few minutes.' : ''}`;
  }
  if (r.status === 'unknown') return r.error || 'Shopify did not answer in time: look for the order in Shopify.';
  if (r.status === 'failed') return `Not placed: ${r.error || 'Shopify refused the order.'}`;
  if (r.status === 'no-email') return r.error || 'No download email arrived in the seed inbox.';
  if (r.status === 'placed') return r.error ? `Placed; ${r.error}` : 'Placed; its email has not been found yet.';
  return 'Being placed…';
}

export const NO_EMAIL_TEXT = `No download email reached the seed inbox within ${WAIT_SCHEDULE_S[WAIT_SCHEDULE_S.length - 1] / 60} minutes. Check the order in Shopify: if your delivery app did not send anything, it may ignore orders made from drafts; place a 100% off order through the shop once to compare. If it did send, look for it in the seed inbox and check the sender in the seed inbox card.`;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function mountShopify(deps: ShopifyCardDeps): { el: HTMLElement; refresh: () => Promise<void>; reset: () => void; chosen: () => { id: string; title: string } | null } {
  const sleep = deps.sleep ?? realSleep;
  let conn: ShopConnectionRow | undefined;
  let seedRow: SeedInboxRow | undefined;
  let chosen: { id: string; title: string } | null = null;
  let busy = false;
  let stopRequested = false;
  /** Bumped on each refresh and reset, so an older refresh never draws over a newer one. */
  let generation = 0;

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', id: 'shopify-status' });
  const say = (t: string) => {
    status.textContent = t;
  };

  // Connect.
  const domain = h('input', { id: 'shopify-domain', type: 'text', maxlength: '300', autocomplete: 'off', spellcheck: 'false', placeholder: 'myshop.myshopify.com' });
  const clientId = h('input', { id: 'shopify-client-id', type: 'text', maxlength: '128', autocomplete: 'off', spellcheck: 'false' });
  const clientSecret = h('input', { id: 'shopify-client-secret', type: 'password', maxlength: '128', autocomplete: 'new-password', spellcheck: 'false' });
  const connectBtn = h('button', { type: 'submit', id: 'shopify-connect', class: 'primary' }, 'Connect my shop');
  const connectForm = h(
    'form',
    { id: 'shopify-form', novalidate: true },
    h(
      'div',
      { class: 'grid2' },
      h('div', {}, h('label', { for: 'shopify-domain', class: 'block' }, 'Store address'), domain, h('p', { class: 'hint' }, 'Your myshopify.com address (Settings, then Domains), not your own domain.')),
      h('div', {}, h('label', { for: 'shopify-client-id', class: 'block' }, 'Client ID'), clientId),
      h('div', {}, h('label', { for: 'shopify-client-secret', class: 'block' }, 'Client secret'), clientSecret),
    ),
    h('div', { class: 'actions' }, connectBtn),
  );

  // Connected.
  const connectedLine = h('p', { id: 'shopify-connected' });
  const disconnectBtn = h('button', { type: 'button', id: 'shopify-disconnect', class: 'link danger' }, 'Disconnect this shop');
  const product = h('input', { id: 'canary-product', type: 'text', maxlength: '300', autocomplete: 'off', spellcheck: 'false', placeholder: 'Product name, or its variant ID', 'aria-describedby': 'canary-product-hint' });
  const productHint = h('p', { class: 'hint', id: 'canary-product-hint' }, 'A small, cheap download product works best: each canary downloads it once.');
  const findBtn = h('button', { type: 'button', id: 'canary-find' }, 'Find');
  const results = h('ul', { class: 'variant-list', id: 'canary-results' });
  const chosenLine = h('p', { id: 'canary-chosen' });
  const placeBtn = h('button', { type: 'button', id: 'canary-place', class: 'primary' }, 'Place a canary order now');
  const stopBtn = h('button', { type: 'button', id: 'canary-stop', hidden: true }, 'Stop waiting');
  const seedNeed = h('p', { class: 'hint', id: 'canary-seed-need' });
  const scanBtn = h('button', { type: 'button', id: 'shopify-scan' }, 'Scan the last 30 days of orders from Shopify');
  const connectedBox = h(
    'div',
    { id: 'shopify-connected-box' },
    connectedLine,
    h('div', { class: 'actions' }, disconnectBtn),
    h('h3', {}, 'Canary order'),
    h('label', { for: 'canary-product', class: 'block' }, 'Canary product'),
    h('div', { class: 'inline' }, product, findBtn),
    productHint,
    results,
    chosenLine,
    seedNeed,
    h('div', { class: 'actions' }, placeBtn, stopBtn),
    h('h3', {}, 'Late download orders'),
    h('p', { class: 'hint' }, 'Reads paid orders of the last 30 days from Shopify (no customer details) and runs the late order scan below on them.'),
    h('div', { class: 'actions' }, scanBtn),
  );

  const signedOutNote = h('p', { class: 'hint', id: 'shopify-signin-note' }, 'Sign in (top of the page) to connect your shop. Canary orders are placed from our server, so they need an account.');
  const sampleBtn = h('button', { type: 'button', id: 'canary-sample' }, 'See a sample canary order');
  const list = h('div', { id: 'canary-list' });

  const el = h(
    'section',
    { class: 'card', 'aria-labelledby': 'shopify-h', id: 'shopify-card' },
    h('h2', { id: 'shopify-h' }, 'Canary orders from Shopify'),
    h('p', {}, 'Connect your shop and Delivery Canary places a free test order for a download product, addressed to your seed inbox, then watches for the download email: how long it took, where Gmail put it, and whether its link still opens the right file.'),
    h(
      'details',
      { class: 'howto' },
      h('summary', {}, 'How to connect your shop (about 5 minutes)'),
      h(
        'ol',
        {},
        h('li', {}, 'Open the Shopify Dev Dashboard (dev.shopify.com/dashboard), signed in as the store owner, and choose Create app. Name it "Delivery Canary".'),
        h('li', {}, 'In the app\'s version, set the Admin API access scopes to read_orders, write_draft_orders and read_products (read_products only lets you search for the canary product here). Release the version.'),
        h('li', {}, 'Install the app on your store and approve its access.'),
        h('li', {}, 'In the app\'s Settings, copy the Client ID and the Client secret, and paste them here with your store\'s myshopify.com address.'),
      ),
      h('p', {}, 'This works for stores in the same Shopify organization as the app. The secret is kept encrypted with a key only our server holds and is never shown again. An app with more access than these three scopes is refused. To cut the connection, disconnect here, or uninstall the app or rotate its secret in Shopify.'),
      h('p', {}, 'Each canary is a real order in your shop with a 100% discount and the tag "delivery-canary", so your reports will count it (at zero). A product that would still cost something (shipping, tax) is refused before the order is placed. At most 5 canaries a day.'),
    ),
    signedOutNote,
    connectForm,
    connectedBox,
    h('div', { class: 'actions' }, sampleBtn),
    status,
    h('h3', { id: 'canaries-h' }, 'Earlier canaries'),
    list,
  );

  const signedIn = () => deps.stores().saved;

  function setChosen(c: { id: string; title: string } | null): void {
    const changed = (chosen?.id ?? null) !== (c?.id ?? null);
    chosen = c;
    chosenLine.textContent = c ? `Canary product: ${c.title || c.id}` : '';
    if (changed) void deps.chosenChanged?.();
  }

  /** The connection's canary address no longer matches the seed inbox: only pasting the secret again can change it. */
  function needsReconnect(): boolean {
    return !!conn && !!seedRow && conn.canary_email !== seedRow.address.toLowerCase();
  }

  function seedProblem(): string {
    if (!seedRow) return 'Set up the seed inbox first (the card above): the canary order goes to that address.';
    if (!seedRow.has_secret) return 'In the seed inbox card, tick "Keep the app password" and check once: the canary needs it to look for the email while you wait.';
    if (needsReconnect()) {
      return conn?.canary_email
        ? `Canaries go to ${conn.canary_email}, the seed address when you connected the shop. To send them to ${seedRow.address}, connect the shop again below (paste the client secret): this keeps anyone who gets into your account from redirecting free orders.`
        : 'The seed inbox was set up after you connected the shop. Connect the shop again below (paste the client secret) so canaries can go to it.';
    }
    return '';
  }

  function render(): void {
    const on = signedIn() && deps.client !== null;
    signedOutNote.hidden = on;
    sampleBtn.hidden = on;
    connectForm.hidden = !on || (!!conn && !needsReconnect());
    if (conn && needsReconnect()) {
      if (!domain.value) domain.value = conn.shop_domain;
      if (!clientId.value) clientId.value = conn.client_id;
    }
    connectedBox.hidden = !on || !conn;
    if (conn) {
      const scopes = conn.scopes.split(',').filter(Boolean);
      connectedLine.textContent = `Connected to ${conn.shop_name || conn.shop_domain} (${conn.shop_domain}). Access: ${scopes.join(', ') || 'unknown'}.`;
      findBtn.hidden = !scopes.includes('read_products');
      product.placeholder = scopes.includes('read_products') ? 'Product name, or its variant ID' : 'The variant ID (from the product\'s admin page)';
    }
    const need = seedProblem();
    seedNeed.textContent = need;
    placeBtn.disabled = busy || !!need;
    scanBtn.disabled = busy;
  }

  function renderList(rows: CanaryRow[]): void {
    clear(list);
    if (!rows.length) {
      list.append(h('p', { class: 'empty' }, signedIn() ? 'No canaries yet. Each one is listed here with how long its email took.' : 'A sample canary is listed here when you run it.'));
      return;
    }
    const ul = h('ul', { class: 'history-list canaries' });
    for (const r of rows) {
      const tone = r.status === 'arrived' ? (r.placement === 'inbox' && r.transit_seconds !== null && r.transit_seconds <= SLOW_TRANSIT_S ? 'pass' : 'warn') : r.status === 'failed' || r.status === 'no-email' ? 'fail' : 'info';
      const li = h(
        'li',
        { 'data-canary': r.id, class: `canary-${tone}` },
        h('span', { class: 'v' }, STATUS_TEXT[r.status]),
        h('span', { class: 't' }, `${r.order_name || 'Canary'}: ${r.variant_title || r.variant_id}${r.source === 'schedule' ? ' (scheduled)' : ''}`),
        h('span', { class: 'when' }, when(r.placed_at ?? r.created_at)),
        h('span', { class: 's' }, canaryText(r)),
      );
      if (r.status === 'placed' && r.placed_at && signedIn()) {
        const again = h('button', { type: 'button', class: 'link', 'data-look': r.id }, 'Look for its email now');
        again.addEventListener('click', () => void lookOnce(r));
        li.append(again);
      }
      ul.append(li);
    }
    list.append(ul);
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    const shop = deps.shop();
    const stores = deps.stores();
    let rows: CanaryRow[] = [];
    let c: ShopConnectionRow | undefined;
    let sr: SeedInboxRow | undefined;
    let failed = '';
    try {
      if (shop) {
        rows = await stores.canaries.list(shop.id);
        if (stores.saved) {
          c = await stores.connections.get(shop.id);
          sr = await stores.seeds.get(shop.id);
        }
      }
    } catch (e) {
      failed = (e as Error).message;
    }
    if (mine !== generation) return;
    conn = c;
    seedRow = sr;
    if (!chosen) {
      const last = rows.find((r) => r.variant_id);
      if (last) setChosen({ id: last.variant_id, title: last.variant_title });
    }
    render();
    if (failed) {
      clear(list);
      list.append(h('p', { class: 'empty' }, `Could not load your Shopify connection: ${failed}`));
      return;
    }
    renderList(rows);
  }

  function reset(): void {
    generation++;
    stopRequested = true;
    conn = undefined;
    seedRow = undefined;
    setChosen(null);
    clear(results);
    clear(list);
    domain.value = '';
    clientId.value = '';
    clientSecret.value = '';
    product.value = '';
    say('');
    render();
  }

  async function withToken(): Promise<string | null> {
    const t = await deps.token();
    if (!t) say('Sign in to use your Shopify connection.');
    return t;
  }

  /** Waits ms in steps of a second, so "Stop waiting" takes effect at once. */
  async function waitFor(ms: number): Promise<void> {
    const until = deps.now().getTime() + ms;
    for (let left = ms; left > 0 && !stopRequested; left = until - deps.now().getTime()) await sleep(Math.min(left, 1000));
  }

  function failText(e: unknown, what: string): string {
    return e instanceof ShopifyCallFailed ? e.message : `Could not ${what}: ${(e as Error).message}`;
  }

  async function connect(): Promise<void> {
    if (busy || !deps.client) return;
    const req = { domain: domain.value.trim(), clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() };
    if (!req.domain) {
      say('Enter your store\'s myshopify.com address.');
      domain.focus();
      return;
    }
    if (!req.clientId || !req.clientSecret) {
      say('Paste the app\'s client ID and client secret from its Settings in the Dev Dashboard.');
      (req.clientId ? clientSecret : clientId).focus();
      return;
    }
    busy = true;
    connectBtn.disabled = true;
    try {
      const token = await withToken();
      if (!token) return;
      const shop = await deps.ensureShop();
      say(`Connecting to ${req.domain}…`);
      const c = await deps.client.connect({ ...req, shopId: shop.id }, token);
      clientSecret.value = '';
      say(`Connected to ${c.shopName || c.domain}.${c.canaryEmail ? ` Canaries will go to ${c.canaryEmail}.` : ' Set up the seed inbox, then connect again, before placing canaries.'}${c.products ? '' : ' The app cannot read products, so paste the canary product\'s variant ID.'}`);
      await refresh();
      product.focus();
    } catch (e) {
      say(failText(e, 'connect the shop'));
    } finally {
      busy = false;
      connectBtn.disabled = false;
      render();
    }
  }

  async function find(): Promise<void> {
    if (busy || !deps.client) return;
    const text = product.value.trim();
    const direct = variantId(text);
    if (direct) {
      setChosen({ id: direct, title: '' });
      clear(results);
      say('Variant ID set as the canary product.');
      return;
    }
    busy = true;
    try {
      const token = await withToken();
      if (!token) return;
      const shop = await deps.ensureShop();
      say('Searching your products…');
      const found = await deps.client.products({ shopId: shop.id, q: text }, token);
      showResults(found);
      say(found.length ? `${found.length} product variant${found.length === 1 ? '' : 's'} found. Pick the canary product.` : 'No products match. Try another word, or paste the variant ID.');
    } catch (e) {
      say(failText(e, 'search the products'));
    } finally {
      busy = false;
      render();
    }
  }

  function showResults(found: Variant[]): void {
    clear(results);
    for (const v of found) {
      const b = h('button', { type: 'button', class: 'link', 'data-variant': v.id }, `${v.title}${v.price ? ` (${v.price})` : ''}${v.status && v.status !== 'active' ? `, ${v.status}` : ''}`);
      b.addEventListener('click', () => {
        setChosen({ id: v.id, title: v.title });
        clear(results);
        say(`Canary product set: ${v.title}.`);
        placeBtn.focus();
      });
      results.append(h('li', {}, b));
    }
  }

  /** One look in the seed inbox for the canary's email; true when found (and recorded). */
  async function look(r: { id: string; placed_at: string }): Promise<boolean | 'stop'> {
    if (!seedRow) return 'stop';
    // A fresh token for every look: the wait outlasts a session token's refresh (code review).
    const token = await withToken();
    if (!token) return 'stop';
    const shop = deps.shop();
    if (!shop) return 'stop';
    let res: SeedResponse;
    try {
      res = await deps.seedCheck({ shopId: shop.id, address: seedRow.address, sender: seedRow.sender, subject: seedRow.subject_hint, password: '', remember: true, after: r.placed_at }, token);
    } catch (e) {
      const msg = e instanceof SeedCheckFailed ? e.message : 'The seed inbox check could not run.';
      say(`Could not look in the seed inbox: ${msg}`);
      await deps
        .stores()
        .canaries.update(r.id, { error: `the seed inbox check failed (${msg.slice(0, 200)})` })
        .catch(() => undefined);
      return 'stop';
    }
    if (!res.found) return false;
    const transit = Math.max(0, Math.round((Date.parse(res.receivedAt) - Date.parse(r.placed_at)) / 1000));
    say(`The canary's email arrived after ${Number.isFinite(transit) ? transitText(transit) : 'an unknown time'}, in ${WHERE_TEXT[res.where]}. The full check is in the first card.`);
    const checkId = await deps.runEmail(res.raw, res.placement, { where: res.where, receivedAt: res.receivedAt });
    await deps
      .stores()
      .canaries.update(r.id, {
        status: 'arrived',
        arrived_at: res.receivedAt || null,
        transit_seconds: Number.isFinite(transit) ? transit : null,
        placement: res.placement,
        seed_where: res.where,
        check_id: checkId,
        error: '',
      })
      .catch((e: Error) => say(`The email was found, but the canary could not be updated: ${e.message}`));
    return true;
  }

  async function lookOnce(r: CanaryRow): Promise<void> {
    if (busy || !r.placed_at) return;
    busy = true;
    render();
    try {
      const token = await withToken();
      if (!token) return;
      say(`Looking for the email of ${r.order_name || 'the canary'}…`);
      const got = await look({ id: r.id, placed_at: r.placed_at });
      if (got === false) say(`No email from ${seedRow?.sender ?? 'the sender'} since the canary was placed.`);
      await deps.seedChanged?.();
    } finally {
      busy = false;
      render();
      await refresh();
    }
  }

  async function place(): Promise<void> {
    if (busy || !deps.client) return;
    const need = seedProblem();
    if (need) {
      say(need);
      return;
    }
    // A variant ID typed in the box wins over the product chosen earlier (code review).
    const typed = variantId(product.value);
    const pick = typed && typed !== chosen?.id ? { id: typed, title: '' } : chosen;
    if (!pick) {
      say('Pick the canary product first: search for it, or paste its variant ID.');
      product.focus();
      return;
    }
    busy = true;
    stopRequested = false;
    render();
    try {
      const token = await withToken();
      if (!token) return;
      const shop = await deps.ensureShop();
      say('Placing the canary order in Shopify…');
      let placed;
      try {
        placed = await deps.client.canary({ shopId: shop.id, variantId: pick.id, variantTitle: pick.title }, token);
      } catch (e) {
        say(failText(e, 'place the canary order'));
        return;
      }
      await refresh();
      stopBtn.hidden = false;
      const start = Date.parse(placed.placedAt);
      for (const at of WAIT_SCHEDULE_S) {
        const wait = start + at * 1000 - deps.now().getTime();
        say(`Canary ${placed.orderName} placed for ${placed.seedAddress}. Looking for its download email (next look in ${transitText(Math.max(0, wait / 1000))}). You can leave this page open and keep working.`);
        await waitFor(wait);
        if (stopRequested) {
          say(`Stopped waiting. ${placed.orderName} stays in the list: use "Look for its email now" later.`);
          return;
        }
        const got = await look({ id: placed.canaryId, placed_at: placed.placedAt });
        if (got === true || got === 'stop') return;
      }
      say(NO_EMAIL_TEXT);
      await deps
        .stores()
        .canaries.update(placed.canaryId, { status: 'no-email', error: NO_EMAIL_TEXT })
        .catch(() => undefined);
    } finally {
      busy = false;
      stopBtn.hidden = true;
      render();
      await deps.seedChanged?.();
      await refresh();
    }
  }

  async function scan(): Promise<void> {
    if (busy || !deps.client) return;
    busy = true;
    render();
    try {
      const token = await withToken();
      if (!token) return;
      const shop = await deps.ensureShop();
      say('Reading the last 30 days of orders from Shopify…');
      const imp = await deps.client.orders({ shopId: shop.id, days: 30 }, token);
      busy = false;
      const scanned = await deps.scanOrders(imp, `Shopify, last ${imp.days} days`);
      const read = `Read ${imp.orders.length} order${imp.orders.length === 1 ? '' : 's'} from Shopify${imp.partial ? ' (the newest only: the shop has more than one request can read)' : ''}`;
      say(scanned ? `${read}. The scan is in the late orders card.` : `${read}, but the late orders card is busy with another scan. Try again when it finishes.`);
    } catch (e) {
      say(failText(e, 'read the orders'));
    } finally {
      busy = false;
      render();
    }
  }

  async function sample(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const shop = await deps.ensureShop();
      const now = deps.now();
      const placedAt = new Date(now.getTime() - 102_000).toISOString();
      const checkId = await deps.runSample();
      const store = deps.stores().canaries;
      if (store instanceof MemoryCanaryStore) {
        store.add({
          id: newId(),
          shop_id: shop.id,
          created_at: placedAt,
          variant_id: 'gid://shopify/ProductVariant/1',
          variant_title: 'Canary pattern (sample)',
          status: 'arrived',
          order_name: '#1042',
          placed_at: placedAt,
          arrived_at: now.toISOString(),
          transit_seconds: 102,
          placement: 'promotions',
          seed_where: 'promotions',
          check_id: checkId,
          error: '',
        });
      }
      say('Sample: canary #1042 was placed and its download email arrived in the seed inbox 1 min 42 s later, in the Promotions tab. The full check is in the first card.');
      await refresh();
    } catch (e) {
      say(`The sample could not run: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }

  connectForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void connect();
  });
  findBtn.addEventListener('click', () => void find());
  product.addEventListener('input', () => {
    if (chosen && product.value.trim()) setChosen(null);
  });
  product.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void find();
    }
  });
  placeBtn.addEventListener('click', () => void place());
  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    say('Stopping…');
  });
  scanBtn.addEventListener('click', () => void scan());
  sampleBtn.addEventListener('click', () => void sample());
  disconnectBtn.addEventListener('click', () => {
    void (async () => {
      const shop = deps.shop();
      if (!shop) return;
      try {
        await deps.stores().connections.remove(shop.id);
        conn = undefined;
        // The database removes the shop's schedule with the connection (migration 0005).
        say('Shop disconnected and its kept secret deleted, and its schedule removed. To be sure, uninstall the app or rotate its secret in Shopify too.');
        await deps.chosenChanged?.();
      } catch (e) {
        say(`Could not disconnect: ${(e as Error).message}`);
      }
      await refresh();
    })();
  });

  render();
  return { el, refresh, reset, chosen: () => chosen };
}
