/**
 * The "Scheduled canaries and alerts" card (milestone 5). Signed in, with
 * the shop connected and the seed inbox's app password kept, the owner
 * turns on a daily or weekly canary at a local time, picks whether to get
 * an alert email when something is wrong and a weekly digest, and sees the
 * placement trend of the last 8 weeks. Our scheduled function does the rest
 * with the page closed.
 *
 * Signed out, "See a sample schedule" shows what the card looks like with
 * a few weeks of canaries.
 */
import { transitText } from '../core/canary';
import { cadenceText, fromUtc, hourText, nextSlot, placementTrend, toUtc, WEEKDAYS, JOB_EVERY_MIN, NO_EMAIL_AFTER_MIN, type Cadence, type TrendCanary, type TrendCheck, type TrendWeek } from '../core/schedule';
import type { CanaryRow, ScheduleRow, ShopRow, Stores } from '../store/stores';
import { clear, h, when } from './dom';
import { ShopifyCallFailed, type ShopClient } from './shopclient';

export interface ScheduleCardDeps {
  stores: () => Stores;
  shop: () => ShopRow | null;
  token: () => Promise<string | null>;
  /** Null in previews (then only the sample runs). */
  client: ShopClient | null;
  /** The canary product picked in the Shopify card, if any. */
  chosen: () => { id: string; title: string } | null;
  now: () => Date;
  /** Minutes west of UTC, as Date#getTimezoneOffset gives them (tests pass a fixed one). */
  offsetMin?: () => number;
}

export function sampleTrendData(now: Date): { canaries: TrendCanary[]; checks: TrendCheck[] } {
  const day = 86_400_000;
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day).toISOString();
  const canaries: TrendCanary[] = [
    { created_at: at(49), status: 'arrived', placement: 'inbox', transit_seconds: 74 },
    { created_at: at(42), status: 'arrived', placement: 'inbox', transit_seconds: 81 },
    { created_at: at(35), status: 'arrived', placement: 'promotions', transit_seconds: 95 },
    { created_at: at(28), status: 'arrived', placement: 'promotions', transit_seconds: 102 },
    { created_at: at(21), status: 'arrived', placement: 'spam', transit_seconds: 610 },
    { created_at: at(14), status: 'no-email', placement: null, transit_seconds: null },
    { created_at: at(7), status: 'arrived', placement: 'promotions', transit_seconds: 88 },
    { created_at: at(0), status: 'arrived', placement: 'inbox', transit_seconds: 70 },
  ];
  const checks: TrendCheck[] = canaries
    .filter((c) => c.status === 'arrived')
    .map((c) => ({ created_at: c.created_at, verdict: c.placement === 'spam' ? 'fail' : c.placement === 'inbox' ? 'pass' : 'warn', placement: c.placement ?? 'unknown' }));
  return { canaries, checks };
}

function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function trendTable(weeks: TrendWeek[]): HTMLElement {
  const cell = (n: number) => (n ? String(n) : '–');
  const table = h(
    'table',
    { class: 'trend', id: 'sched-trend' },
    h('caption', { class: 'visually-hidden' }, 'Canaries per week and where their email landed'),
    h(
      'thead',
      {},
      h('tr', {}, ...['Week of', 'Canaries', 'Inbox', 'Promotions', 'Spam', 'No email', 'Not placed', 'Median arrival', 'Checks failed'].map((t) => h('th', { scope: 'col' }, t))),
    ),
    h(
      'tbody',
      {},
      ...weeks.map((w) =>
        h(
          'tr',
          { class: w.spam || w.noEmail || w.notPlaced ? 'bad' : w.promotions || w.other ? 'meh' : w.canaries ? 'good' : '' },
          h('th', { scope: 'row' }, weekLabel(w.week)),
          h('td', {}, cell(w.canaries)),
          h('td', {}, cell(w.inbox)),
          h('td', {}, cell(w.promotions)),
          h('td', {}, cell(w.spam)),
          h('td', {}, cell(w.noEmail)),
          h('td', {}, cell(w.notPlaced)),
          h('td', {}, w.medianTransit === null ? '–' : transitText(w.medianTransit)),
          h('td', {}, w.checks ? `${w.failedChecks} of ${w.checks}` : '–'),
        ),
      ),
    ),
  );
  // A focusable region, so keyboard users can scroll the table sideways on a phone.
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Placement by week (scrolls sideways)' }, table);
}

export function mountSchedule(deps: ScheduleCardDeps): { el: HTMLElement; refresh: () => Promise<void>; reset: () => void } {
  const offset = deps.offsetMin ?? (() => new Date().getTimezoneOffset());
  let row: ScheduleRow | undefined;
  let ready = { connected: false, seedKept: false };
  let busy = false;
  let generation = 0;
  /** The saved row the form last showed: the form is only rewritten when the saved schedule changed, so unsaved edits survive a refresh. */
  let shown: string | null = null;

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', id: 'sched-status' });
  const say = (t: string) => {
    status.textContent = t;
  };

  const onBox = h('input', { type: 'checkbox', id: 'sched-on' });
  const weekly = h('input', { type: 'radio', name: 'sched-cadence', id: 'sched-weekly', value: 'weekly', checked: true });
  const daily = h('input', { type: 'radio', name: 'sched-cadence', id: 'sched-daily', value: 'daily' });
  const daySel = h('select', { id: 'sched-day' }, ...WEEKDAYS.map((d, i) => h('option', { value: String(i), selected: i === 1 }, d)));
  const hourSel = h('select', { id: 'sched-hour' }, ...Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === 9 }, hourText(i))));
  const dayWrap = h('div', { id: 'sched-day-wrap' }, h('label', { for: 'sched-day', class: 'block' }, 'Day'), daySel);
  const productLine = h('p', { id: 'sched-product' });
  const alertsBox = h('input', { type: 'checkbox', id: 'sched-alerts', checked: true });
  const digestBox = h('input', { type: 'checkbox', id: 'sched-digest' });
  const saveBtn = h('button', { type: 'submit', id: 'sched-save', class: 'primary' }, 'Save the schedule');
  const need = h('p', { class: 'hint', id: 'sched-need' });
  const form = h(
    'form',
    { id: 'sched-form', novalidate: true },
    h('label', { class: 'check' }, onBox, ' Place a canary order on a schedule'),
    h(
      'fieldset',
      { class: 'placement', id: 'sched-cadence' },
      h('legend', {}, 'How often'),
      h('label', {}, weekly, ' Weekly'),
      h('label', {}, daily, ' Daily'),
    ),
    h('div', { class: 'grid2' }, dayWrap, h('div', {}, h('label', { for: 'sched-hour', class: 'block' }, 'Time (your time zone)'), hourSel)),
    productLine,
    h('fieldset', { class: 'placement column' }, h('legend', {}, 'Email me'), h('label', {}, alertsBox, ' Right away, when a canary lands in Spam, fails its check, gets no email or cannot be placed'), h('label', {}, digestBox, ' A weekly digest of every canary')),
    h('p', { class: 'hint' }, 'Emails go to the address you sign in with, from delivery-canary@hintwise.org: at most 4 a day, and each has a link to stop them.'),
    need,
    h('div', { class: 'actions' }, saveBtn),
  );
  const summary = h('div', { id: 'sched-summary' });
  const trend = h('div', { id: 'sched-trend-box' });
  const signedOutNote = h('p', { class: 'hint', id: 'sched-signin-note' }, 'Sign in (top of the page), connect your shop and keep the seed inbox\'s app password to schedule canaries.');
  const sampleBtn = h('button', { type: 'button', id: 'sched-sample' }, 'See a sample schedule');

  const el = h(
    'section',
    { class: 'card', 'aria-labelledby': 'sched-h', id: 'schedule-card' },
    h('h2', { id: 'sched-h' }, 'Scheduled canaries and alerts'),
    h('p', {}, `Delivery Canary places your canary order on a schedule, looks in the seed inbox for its email about every ${JOB_EVERY_MIN} minutes, runs the full check on it, and emails you when something is wrong. Nobody needs to keep this page open.`),
    h(
      'details',
      { class: 'howto' },
      h('summary', {}, 'What counts as wrong'),
      h(
        'ul',
        {},
        h('li', {}, 'The download email landed in Spam, or its check failed (a broken link, the wrong file, a failed signature).'),
        h('li', {}, `No email reached the seed inbox within ${NO_EMAIL_AFTER_MIN} minutes of the order.`),
        h('li', {}, 'Shopify refused the canary order, or the schedule could not run (the shop was disconnected, or the seed inbox changed).'),
      ),
      h('p', {}, 'Promotions is not an alert (many receipts land there) but shows in the weekly digest and the table below. Each canary is a free order in your shop and downloads the file once, so weekly is enough for most shops.'),
    ),
    signedOutNote,
    form,
    h('div', { class: 'actions' }, sampleBtn),
    status,
    summary,
    h('h3', { id: 'sched-trend-h' }, 'Placement over the last 8 weeks'),
    trend,
  );

  const signedIn = () => deps.stores().saved && deps.client !== null;
  const cadence = (): Cadence => (daily.checked ? 'daily' : 'weekly');

  function product(): { id: string; title: string } | null {
    const c = deps.chosen();
    if (c) return c;
    return row?.variant_id ? { id: row.variant_id, title: row.variant_title } : null;
  }

  function problem(): string {
    if (!deps.shop()) return 'Save your shop first (the "Your shop" card), then connect it to Shopify.';
    if (!ready.connected) return 'Connect your Shopify shop first (the card above).';
    if (!ready.seedKept) return 'In the seed inbox card, tick "Keep the app password" and check once: the schedule needs it to look for the email.';
    if (!product()) return 'Pick the canary product in the card above (Find, then choose it).';
    return '';
  }

  function render(): void {
    const on = signedIn();
    signedOutNote.hidden = on;
    sampleBtn.hidden = on;
    form.hidden = !on;
    dayWrap.hidden = cadence() === 'daily';
    const p = product();
    const c = deps.chosen();
    productLine.textContent = p
      ? `Canary product: ${p.title || p.id}${c && row?.variant_id && c.id !== row.variant_id ? ' (picked above; saving switches the schedule to it)' : ''}`
      : 'Canary product: none yet. Pick one in the card above.';
    const stop = onBox.checked ? problem() : '';
    need.textContent = stop;
    saveBtn.disabled = busy || !!stop;
  }

  function renderSummary(r: ScheduleRow | undefined): void {
    clear(summary);
    if (!r) return;
    const local = fromUtc(r.weekday, r.hour, offset());
    const lines: string[] = [];
    if (r.enabled) {
      lines.push(`${cadenceText(r.cadence, local.weekday, local.hour)}, for ${r.variant_title || 'the canary product'}.`);
      if (r.next_run_at) lines.push(`Next canary: ${when(r.next_run_at)} (within ${JOB_EVERY_MIN} minutes of it).`);
    } else lines.push('The schedule is off.');
    if (r.last_run_at) lines.push(`Last run ${when(r.last_run_at)}${r.last_outcome ? `: ${r.last_outcome}` : '.'}`);
    lines.push(r.alerts || r.digest ? `Email: ${[r.alerts ? 'alerts' : '', r.digest ? 'weekly digest' : ''].filter(Boolean).join(' and ')}.` : 'Email: none.');
    summary.append(h('ul', { class: 'plain' }, ...lines.map((t) => h('li', {}, t))));
  }

  function fill(r: ScheduleRow | undefined): void {
    if (!r) return;
    const local = fromUtc(r.weekday, r.hour, offset());
    onBox.checked = r.enabled;
    weekly.checked = r.cadence === 'weekly';
    daily.checked = r.cadence === 'daily';
    daySel.value = String(local.weekday);
    hourSel.value = String(local.hour);
    alertsBox.checked = r.alerts;
    digestBox.checked = r.digest;
  }

  function renderTrend(canaries: TrendCanary[], checks: TrendCheck[]): void {
    clear(trend);
    if (!canaries.length && !checks.length) {
      trend.append(h('p', { class: 'empty' }, signedIn() ? 'No canaries or checks in the last 8 weeks yet. Each week fills in as canaries run.' : 'Run the sample to see a few weeks of canaries.'));
      return;
    }
    trend.append(trendTable(placementTrend(canaries, checks, deps.now())));
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    const shop = deps.shop();
    const stores = deps.stores();
    if (!signedIn() || !shop) {
      row = undefined;
      ready = { connected: false, seedKept: false };
      render();
      renderSummary(undefined);
      if (signedIn()) renderTrend([], []);
      else if (!trend.childNodes.length) renderTrend([], []);
      return;
    }
    try {
      const [r, conn, seed, canaries, checks] = await Promise.all([
        stores.schedules.get(shop.id),
        stores.connections.get(shop.id),
        stores.seeds.get(shop.id),
        stores.canaries.list(shop.id, 200),
        stores.checks.summaries(shop.id, 200),
      ]);
      if (mine !== generation) return;
      row = r;
      ready = { connected: !!conn, seedKept: !!seed?.has_secret };
      const key = r ? `${r.shop_id}/${r.updated_at}` : null;
      if (key !== shown) {
        fill(r);
        shown = key;
      }
      renderSummary(r);
      renderTrend(canaries as CanaryRow[], checks);
    } catch (e) {
      if (mine !== generation) return;
      say(`Could not load the schedule: ${(e as Error).message}`);
    }
    render();
  }

  function reset(): void {
    generation++;
    shown = null;
    row = undefined;
    ready = { connected: false, seedKept: false };
    onBox.checked = false;
    weekly.checked = true;
    daily.checked = false;
    daySel.value = '1';
    hourSel.value = '9';
    alertsBox.checked = true;
    digestBox.checked = false;
    clear(summary);
    clear(trend);
    say('');
    render();
  }

  async function save(): Promise<void> {
    const shop = deps.shop();
    if (busy || !deps.client || !shop) return;
    const stop = onBox.checked ? problem() : '';
    if (stop) {
      say(stop);
      return;
    }
    busy = true;
    render();
    try {
      const token = await deps.token();
      if (!token) {
        say('Your session has ended. Sign in again.');
        return;
      }
      const utc = toUtc(Number(daySel.value), Number(hourSel.value), offset());
      const p = product();
      say('Saving the schedule…');
      row = await deps.client.schedule(
        { shopId: shop.id, enabled: onBox.checked, cadence: cadence(), weekday: utc.weekday, hour: utc.hour, variantId: p?.id ?? null, variantTitle: p?.title ?? '', alerts: alertsBox.checked, digest: digestBox.checked },
        token,
      );
      renderSummary(row);
      shown = `${row.shop_id}/${row.updated_at}`;
      say(row.enabled ? `Saved.${row.next_run_at ? ` The next canary is placed ${when(row.next_run_at)}.` : ''}` : 'Saved. The schedule is off.');
    } catch (e) {
      say(e instanceof ShopifyCallFailed ? e.message : 'The schedule could not be saved.');
    } finally {
      busy = false;
      render();
    }
  }

  function sample(): void {
    const now = deps.now();
    const local = { weekday: 1, hour: 9 };
    const utc = toUtc(local.weekday, local.hour, offset());
    const next = nextSlot('weekly', utc.weekday, utc.hour, now);
    const r: ScheduleRow = {
      shop_id: 'sample',
      enabled: true,
      cadence: 'weekly',
      weekday: utc.weekday,
      hour: utc.hour,
      variant_id: 'gid://shopify/ProductVariant/1',
      variant_title: 'Canary pattern (free)',
      alerts: true,
      digest: true,
      next_run_at: next.toISOString(),
      last_run_at: now.toISOString(),
      last_outcome: 'Placed canary #1042; its email arrived after 1 min 10 s, in the Primary inbox.',
      last_digest_at: null,
      updated_at: now.toISOString(),
    };
    renderSummary(r);
    const data = sampleTrendData(now);
    renderTrend(data.canaries, data.checks);
    say('Sample: a weekly canary on Mondays at 9:00 am. Three weeks ago its email went to Spam and an alert went out; the week after, no email arrived at all.');
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void save();
  });
  for (const x of [onBox, weekly, daily]) x.addEventListener('change', render);
  sampleBtn.addEventListener('click', sample);
  render();
  renderTrend([], []);
  return { el, refresh, reset };
}
