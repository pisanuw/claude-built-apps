/**
 * The "Late download orders" card: drop Shopify's Orders export, see the paid
 * download orders still unfulfilled after the grace period, and keep each
 * scan. The file is read in the browser; only the summary is saved.
 */
import { hex } from '../core/linkcheck';
import { APP_NAMES } from '../core/links';
import { toCsv } from '../core/csv';
import {
  ageText,
  DEFAULT_GRACE,
  GRACE_CHOICES,
  graceText,
  importShopifyOrders,
  itemsText,
  lateCsvRows,
  MAX_CSV_BYTES,
  OrdersError,
  scanOrders,
  type ScanSummary,
} from '../core/orders';
import { sampleOrdersCsv } from '../core/orders-sample';
import type { DeliveryAppId } from '../core/types';
import { newId } from '../lib/repository';
import type { ScanRow, ShopRow, Stores } from '../store/stores';
import { clear, h, when } from './dom';

export interface OrdersDeps {
  stores: () => Stores;
  /** The shop to save under, created on first use. */
  ensureShop: () => Promise<ShopRow>;
  /** The shop as loaded, or null before one exists (nothing is listed then). */
  shop: () => ShopRow | null;
  now: () => Date;
  digest?: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  /** Offers a text file to the visitor; the default makes a download link. */
  download?: (name: string, text: string) => void;
}

const NOTE_LABEL: Record<ScanSummary['notes'][number]['severity'], string> = { fail: 'Problem', warn: 'Warning', ok: 'OK', info: 'Note' };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The summary sentence under the headline. */
export function countsText(s: ScanSummary): string {
  const c = s.counts;
  const parts = [`${plural(c.orders, 'order')} in the file, ${c.digital} with downloads`];
  const digital = [`${c.delivered} delivered`, `${c.late} late`];
  if (c.undated) digital.push(`${c.undated} with no readable date`);
  if (c.waiting) digital.push(`${c.waiting} within the ${graceText(s.graceMinutes)} grace period`);
  if (c.notPaid) digital.push(`${c.notPaid} not paid yet`);
  if (c.refunded) digital.push(`${c.refunded} refunded`);
  const other: string[] = [];
  if (c.cancelled) other.push(`${plural(c.cancelled, 'cancelled order')}`);
  if (c.physical) other.push(`${plural(c.physical, 'order')} with parcels only`);
  return `${parts[0]}: ${digital.join(', ')}.${other.length ? ` Not checked: ${other.join(' and ')}.` : ''}`;
}

/** ", export of 12 Nov, 09:00" when the export is more than five minutes older than the scan. */
function asOfText(s: ScanSummary): string {
  if (!s.asOf || Date.parse(s.scannedAt) - Date.parse(s.asOf) < 5 * 60_000) return '';
  return `, export of ${when(s.asOf)}`;
}

function resendHint(app: string): string {
  const name = app && app !== 'unknown' && app in APP_NAMES ? APP_NAMES[app as DeliveryAppId] : 'your delivery app';
  return `For each order: open it in Shopify admin, resend the download from ${name} (most apps add a resend button to the order page), and check the order now shows as fulfilled. If the buyer says the email never came, ask them to look in Promotions and Spam, or send the file another way.`;
}

export function renderScan(s: ScanSummary, opts: { fileName: string; deliveryApp: string; onDownload?: () => void }): HTMLElement {
  const late = s.counts.late;
  const verdict = late ? (s.notes.some((n) => n.id === 'app-does-not-fulfill') ? 'warn' : 'fail') : 'pass';
  const headline = late ? `${plural(late, 'download order')} ${late === 1 ? 'looks' : 'look'} undelivered` : 'No late download orders';
  const art = h(
    'article',
    { class: `report verdict-${verdict}`, 'aria-label': 'Order scan result' },
    h('h3', { class: 'verdict' }, headline),
    h('p', { class: 'summary' }, `Scanned ${when(s.scannedAt)}${opts.fileName ? ` from ${opts.fileName}` : ''}${asOfText(s)}. ${countsText(s)}`),
  );
  const notes = h('ul', { class: 'findings' });
  for (const n of s.notes) {
    notes.append(h('li', { class: `finding sev-${n.severity}`, 'data-note': n.id }, h('span', { class: 'sev' }, NOTE_LABEL[n.severity]), h('div', {}, h('strong', {}, n.title), h('p', {}, n.detail))));
  }
  art.append(notes);

  if (s.late.length) {
    const body = h('tbody');
    for (const l of s.late) {
      body.append(
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, l.name),
          h('td', {}, l.since ? when(l.since) : 'unknown'),
          h('td', {}, ageText(l.ageMinutes)),
          h(
            'td',
            {},
            itemsText(l),
            l.partial ? h('span', { class: 'tag' }, ' (rest of the order delivered or shipped)') : null,
            l.financial === 'partially_refunded' ? h('span', { class: 'tag' }, ' (partly refunded: check the refund was not for this item)') : null,
          ),
          h('td', {}, l.flaggedSince ? `Also late on ${when(l.flaggedSince)}` : 'New'),
        ),
      );
    }
    // The title sits outside the scrolling wrapper, so a phone shows all of it.
    art.append(
      h('p', { class: 'table-title', id: 'late-title' }, 'Paid download orders still unfulfilled, oldest first'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'orders', 'aria-labelledby': 'late-title' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Order'), h('th', { scope: 'col' }, 'Paid'), h('th', { scope: 'col' }, 'Waiting'), h('th', { scope: 'col' }, 'Not delivered'), h('th', { scope: 'col' }, 'Earlier scans'))),
          body,
        ),
      ),
    );
    if (s.lateNotKept) art.append(h('p', { class: 'hint' }, `${s.lateNotKept} more late orders are counted but not listed. Export a shorter date range to see them.`));
    art.append(h('p', { class: 'fix' }, h('span', { class: 'fix-label' }, 'What to do: '), resendHint(opts.deliveryApp)));
    if (opts.onDownload) {
      const b = h('button', { type: 'button', id: 'download-late' }, 'Download this list (CSV)');
      b.addEventListener('click', opts.onDownload);
      art.append(h('div', { class: 'actions' }, b));
    }
  }
  if (s.compared) {
    const r = s.compared.resolved;
    art.append(
      h(
        'p',
        { class: 'hint', id: 'compared' },
        r.length
          ? `Since the scan of ${when(s.compared.at)}: ${r.join(', ')} ${r.length === 1 ? 'is' : 'are'} no longer late (delivered, refunded or cancelled).`
          : `Compared with the scan of ${when(s.compared.at)}.`,
      ),
    );
  }
  art.append(
    h(
      'p',
      { class: 'hint', id: 'dropped' },
      s.droppedPersonal.length
        ? `Left out as the file was read, never saved: ${s.droppedPersonal.join(', ')}.`
        : 'This file had no customer columns; only order numbers, dates, statuses and product names were read.',
    ),
  );
  return art;
}

function defaultDownload(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function mountOrders(deps: OrdersDeps): { el: HTMLElement; refresh: () => Promise<void>; reset: () => void } {
  const digest = deps.digest ?? ((d: ArrayBuffer) => crypto.subtle.digest('SHA-256', d));
  const download = deps.download ?? defaultDownload;
  let busy = false;
  /** Bumped on each refresh and reset, so an older, slower refresh never draws over a newer one. */
  let generation = 0;

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', id: 'orders-status' });
  const say = (t: string) => {
    status.textContent = t;
  };
  const fileInput = h('input', { id: 'orders-file', type: 'file', accept: '.csv,text/csv' });
  const grace = h(
    'select',
    { id: 'orders-grace' },
    ...GRACE_CHOICES.map((m) => h('option', { value: String(m), selected: m === DEFAULT_GRACE }, graceText(m))),
  );
  const scanBtn = h('button', { type: 'submit', id: 'run-scan', class: 'primary' }, 'Scan orders');
  const sampleBtn = h('button', { type: 'button', id: 'run-sample-scan' }, 'Try a sample export');
  const form = h(
    'form',
    { id: 'scan-form', novalidate: true },
    h('div', { class: 'grid2' }, h('div', {}, h('label', { for: 'orders-file', class: 'block' }, 'Shopify orders export (.csv)'), fileInput), h('div', {}, h('label', { for: 'orders-grace', class: 'block' }, 'Late after'), grace)),
    h('div', { class: 'actions' }, scanBtn, sampleBtn),
  );
  const result = h('div', { id: 'scan-result', tabindex: '-1' });
  const list = h('div', { id: 'scan-list' });

  const el = h(
    'section',
    { class: 'card', 'aria-labelledby': 'orders-h' },
    h('h2', { id: 'orders-h' }, 'Late download orders'),
    h('p', { class: 'hint' }, 'Delivery apps mark a download order fulfilled when they send its email. A paid download order still unfulfilled an hour later usually means the buyer never got the file.'),
    h(
      'details',
      { class: 'howto' },
      h('summary', {}, 'How to export your orders from Shopify'),
      h(
        'ol',
        {},
        h('li', {}, 'In Shopify admin, open Orders and choose Export.'),
        h('li', {}, 'Pick a date range (the last 30 days is plenty) and "CSV for Excel, Numbers, or other spreadsheet programs".'),
        h('li', {}, 'Choose Export orders. Shopify downloads the file, or emails it for a big shop. Drop it here without editing it.'),
      ),
      h('p', {}, 'The file is read in your browser. Customer emails, names, phone numbers and addresses are left out as it is read; only order numbers, dates, statuses and product names are kept, and only the scan result is saved.'),
    ),
    form,
    status,
    result,
    h('h3', { id: 'scans-h' }, 'Earlier scans'),
    list,
  );

  function graceChosen(): number {
    const v = Number(grace.value);
    return (GRACE_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_GRACE;
  }

  function show(row: Pick<ScanRow, 'summary' | 'file_name'>): void {
    clear(result);
    const s = row.summary;
    const shop = deps.shop();
    result.append(
      renderScan(s, {
        fileName: row.file_name,
        deliveryApp: shop?.delivery_app ?? 'unknown',
        onDownload: () => download(`late-download-orders-${s.scannedAt.slice(0, 10)}.csv`, toCsv(lateCsvRows(s))),
      }),
    );
    result.focus();
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    const shop = deps.shop();
    const stores = deps.stores();
    let rows: Awaited<ReturnType<Stores['scans']['list']>> = [];
    let failed = '';
    try {
      rows = shop ? await stores.scans.list(shop.id) : [];
    } catch (e) {
      failed = (e as Error).message;
    }
    if (mine !== generation) return;
    clear(list);
    if (failed) {
      list.append(h('p', { class: 'empty' }, `Could not load your scans: ${failed}`));
      return;
    }
    if (!rows.length) {
      list.append(h('p', { class: 'empty' }, stores.saved ? 'No scans yet. Each scan is kept here, and the next one says which late orders were sorted out since.' : 'Scans made while signed out are listed here until you leave the page.'));
      return;
    }
    const ul = h('ul', { class: 'history-list scans' });
    for (const r of rows) {
      const view = h('button', { type: 'button', class: 'link', 'data-view-scan': r.id }, 'View');
      const del = h('button', { type: 'button', class: 'link danger', 'data-delete-scan': r.id, 'aria-label': `Delete the scan of ${when(r.updated_at)}` }, 'Delete');
      view.addEventListener('click', () => {
        void (async () => {
          try {
            const full = await deps.stores().scans.get(r.id);
            if (!full) {
              say('That scan is no longer saved.');
              return;
            }
            show(full);
          } catch (e) {
            say(`Could not open the scan: ${(e as Error).message}`);
          }
        })();
      });
      del.addEventListener('click', () => {
        void (async () => {
          try {
            await deps.stores().scans.remove(r.id);
            say('Scan deleted.');
          } catch (e) {
            say(`Could not delete: ${(e as Error).message}`);
          }
          await refresh();
        })();
      });
      ul.append(
        h(
          'li',
          { class: r.flagged ? 'verdict-fail' : 'verdict-pass' },
          h('span', { class: 'when' }, when(r.updated_at)),
          h('span', { class: 'v' }, r.flagged ? `${plural(r.flagged, 'late order')}` : 'None late'),
          h('span', { class: 'p' }, `${plural(r.orders_total, 'order')}`),
          h('span', { class: 's' }, r.file_name || 'Orders export'),
          h('span', { class: 'row-actions' }, view, del),
        ),
      );
    }
    list.append(ul);
  }

  /** Forgets what is on screen (sign-in changes): another account's scan must not stay visible. */
  function reset(): void {
    generation++;
    clear(result);
    clear(list);
    say('');
    fileInput.value = '';
  }

  async function run(bytes: ArrayBuffer, fileName: string, asOf: Date | null): Promise<void> {
    if (busy) return;
    busy = true;
    scanBtn.disabled = true;
    sampleBtn.disabled = true;
    try {
      if (bytes.byteLength > MAX_CSV_BYTES) {
        clear(result);
        say('This file is over 50 MB. Export a shorter date range.');
        return;
      }
      say('Reading the orders…');
      let imp;
      try {
        imp = importShopifyOrders(new TextDecoder('utf-8').decode(bytes));
      } catch (e) {
        clear(result);
        say(e instanceof OrdersError ? e.message : 'This file could not be read as a CSV export.');
        return;
      }
      let sha: string;
      try {
        sha = hex(await digest(bytes));
      } catch {
        say('This browser could not fingerprint the file (it needs a secure https page). Reload the page and try again.');
        return;
      }
      const stores = deps.stores();
      const now = deps.now();
      let shop: ShopRow;
      let same: ScanRow | undefined;
      let previous: ScanRow | undefined;
      try {
        shop = await deps.ensureShop();
      } catch (e) {
        say(`Could not save your shop: ${(e as Error).message}`);
        return;
      }
      try {
        same = await stores.scans.byFile(shop.id, sha);
        previous = await stores.scans.latest(shop.id, same?.id);
      } catch (e) {
        say(`Could not read your earlier scans: ${(e as Error).message}`);
        return;
      }
      // Compare with the shop's latest other file, never with this file's own earlier scan.
      // Ages run to the file's own time (when Shopify made the export), so a file scanned again later gives the same answer.
      const at = asOf && asOf.getTime() <= now.getTime() ? asOf : now;
      const summary = scanOrders(imp, now, graceChosen(), previous?.summary ?? null, at);
      const row: ScanRow = {
        id: same?.id ?? newId(),
        shop_id: shop.id,
        created_at: same?.created_at ?? now.toISOString(),
        updated_at: now.toISOString(),
        file_sha256: sha,
        file_name: fileName.slice(0, 200),
        grace_minutes: summary.graceMinutes,
        orders_total: summary.counts.orders,
        flagged: summary.counts.late,
        summary,
      };
      show(row);
      try {
        await stores.scans.put(row);
        const again = same ? ' This file was scanned before, so that scan was updated instead of adding another.' : '';
        say(stores.saved ? `Scanned and saved.${again}` : `Scanned. Sign in to keep this scan.${again}`);
      } catch (e) {
        say(`Scanned, but not saved: ${(e as Error).message}`);
      }
      await refresh();
      result.focus();
    } finally {
      busy = false;
      scanBtn.disabled = false;
      sampleBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) {
      say('Choose the orders export (.csv) from Shopify, or try the sample.');
      return;
    }
    const modified = typeof file.lastModified === 'number' && file.lastModified > 0 ? new Date(file.lastModified) : null;
    void file.arrayBuffer().then(
      (b) => run(b, file.name, modified),
      () => say('The file could not be opened.'),
    );
  });

  sampleBtn.addEventListener('click', () => {
    fileInput.value = '';
    // The sample's times follow the clock, so each run of it is a new file.
    const text = sampleOrdersCsv(deps.now());
    void run(new TextEncoder().encode(text).buffer as ArrayBuffer, 'sample-orders-export.csv', null);
  });

  return { el, refresh, reset };
}
