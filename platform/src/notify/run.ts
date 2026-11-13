/**
 * One app-notify run (src/notify/README.md, "A run"): for each enabled app,
 * fetch its feed, record the item ids (the first run only seeds), find who
 * is due, skip whoever opted out (all, or this app), claim the person's one
 * email of the day, send it, record the result. Everything outside is
 * injected (database, fetch, send, clock, sleep), so the whole loop runs in
 * tests. The report never contains an address.
 */
import type { Db } from '../signin/db.ts';
import { emailLogoUrl } from '../signin/email.ts';
import { hashKeys, shortHash } from '../signin/keys.ts';
import { appOptOutUrl, appScope, isSuppressed, optOutUrl } from '../signin/optout.ts';
import type { EmailMessage, SendResult } from '../signin/resend.ts';
import { errorText } from '../signin/util.ts';
import { normalizeEmail } from '../signin/validate.ts';
import { fetchFeed, type FeedItem, type FeedResult } from './feed.ts';
import { chooseItems, DISPLAY_NAME, notifyEmail } from './message.ts';

/** The brake: at most this many emails in one run, over every app. */
export const MAX_EMAILS_PER_RUN = 200;
/** Items first seen more than this many days ago are not sent to someone who opts in later. */
export const ITEM_WINDOW_DAYS = 14;
/** How many due people one app's query returns. */
export const MAX_DUE_PER_APP = 1000;
/** The gap between two sends (Resend's default limit is 2 requests a second). */
export const SEND_GAP_MS = 600;
/** Stop starting new sends after this long (the edge function's wall clock is limited). */
export const RUN_BUDGET_MS = 240_000;

export interface NotifyEnv {
  SIGN_IN_HASH_KEY?: string;
  EMAIL_OPTOUT_SECRET?: string;
  EMAIL_LOGO_URL?: string;
}

export interface RunDeps {
  db: Db;
  fetch: typeof fetch;
  send: (msg: EmailMessage) => Promise<SendResult>;
  env: NotifyEnv;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** Overrides for tests and a careful first run. */
  limits?: Partial<{ maxEmails: number; windowDays: number; maxDue: number; gapMs: number; budgetMs: number }>;
}

export interface RunOptions {
  /** Only this app. */
  app?: string;
  /** Fetch and check the feeds and count who is due, but record and send nothing. */
  dryRun?: boolean;
}

export interface AppReport {
  app: string;
  status: 'ok' | 'seeded' | 'feed-error' | 'error' | 'skipped';
  error?: string;
  feedItems?: number;
  skippedItems?: number;
  newItems?: number;
  due?: number;
  sent: number;
  failed: number;
  optedOut: number;
  alreadyToday: number;
}

export interface RunReport {
  ok: boolean;
  dryRun: boolean;
  day: string;
  sent: number;
  failed: number;
  /** True when the per-run cap or the time budget stopped the run early. */
  stopped: 'cap' | 'budget' | 'rate-limit' | null;
  apps: AppReport[];
  error?: string;
}

interface AppRow {
  slug: string;
  display_name: string;
  feed_url: string;
  seeded: boolean;
}

interface DueRow {
  user_id: string;
  email: string;
  item_ids: string[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The UTC day of a time, YYYY-MM-DD: the daily cap's day. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export async function runNotify(deps: RunDeps, opts: RunOptions = {}): Promise<RunReport> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  const clock = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lim = {
    maxEmails: deps.limits?.maxEmails ?? MAX_EMAILS_PER_RUN,
    windowDays: deps.limits?.windowDays ?? ITEM_WINDOW_DAYS,
    maxDue: deps.limits?.maxDue ?? MAX_DUE_PER_APP,
    gapMs: deps.limits?.gapMs ?? SEND_GAP_MS,
    budgetMs: deps.limits?.budgetMs ?? RUN_BUDGET_MS,
  };
  const started = clock();
  const day = utcDay(started);
  const dryRun = opts.dryRun === true;
  const report: RunReport = { ok: true, dryRun, day, sent: 0, failed: 0, stopped: null, apps: [] };
  const { SIGN_IN_HASH_KEY: hashKey, EMAIL_OPTOUT_SECRET: secret } = deps.env;
  // No notify email without its opt-out links, and no opt-out check without the hash key.
  if (!hashKey || !secret) return { ...report, ok: false, error: 'SIGN_IN_HASH_KEY or EMAIL_OPTOUT_SECRET is unset' };
  const logoUrl = emailLogoUrl(deps.env.EMAIL_LOGO_URL);

  let apps: AppRow[];
  try {
    apps = (await deps.db.rpc<AppRow[] | null>('notify_apps_enabled', {})) ?? [];
  } catch (e) {
    log(`app-notify: notify_apps_enabled failed: ${errorText(e)}`);
    return { ...report, ok: false, error: 'the registry could not be read' };
  }
  if (opts.app !== undefined) apps = apps.filter((a) => a.slug === opts.app);

  let attempts = 0;
  let sentAny = false;
  for (const a of apps) {
    const r: AppReport = { app: String(a.slug), status: 'ok', sent: 0, failed: 0, optedOut: 0, alreadyToday: 0 };
    report.apps.push(r);
    if (!SLUG.test(a.slug) || !DISPLAY_NAME.test(a.display_name)) {
      r.status = 'skipped';
      r.error = 'bad registry row';
      continue;
    }
    if (report.stopped) {
      r.status = 'skipped';
      r.error = `run stopped (${report.stopped})`;
      continue;
    }
    const feed: FeedResult = await fetchFeed(deps.fetch, a.feed_url, a.slug);
    if (!feed.ok) {
      r.status = 'feed-error';
      r.error = feed.error;
      log(`app-notify: ${a.slug} feed refused: ${feed.error}`);
      continue;
    }
    r.feedItems = feed.items.length;
    r.skippedItems = feed.skipped;
    const ids = feed.items.map((it) => it.id);
    try {
      if (dryRun) {
        if (!a.seeded) {
          r.status = 'seeded';
          continue;
        }
      } else {
        const obs = await deps.db.rpc<{ seeding?: boolean; new?: number }>('notify_observe', { p_app: a.slug, p_item_ids: ids });
        r.newItems = Number(obs?.new ?? 0);
        if (obs?.seeding) {
          // First run: what is already in the feed is never emailed.
          r.status = 'seeded';
          continue;
        }
      }
      const due = (await deps.db.rpc<DueRow[] | null>('notify_due', { p_app: a.slug, p_item_ids: ids, p_day: day, p_window_days: lim.windowDays, p_limit: lim.maxDue })) ?? [];
      r.due = due.length;
      if (dryRun) continue;
      for (const person of due) {
        if (attempts >= lim.maxEmails) {
          report.stopped = 'cap';
          break;
        }
        if (clock().getTime() - started.getTime() > lim.budgetMs) {
          report.stopped = 'budget';
          break;
        }
        const outcome = await notifyOne(deps, a, feed.items, person, { day, hashKey, secret, logoUrl, log });
        if (outcome === 'opted-out') r.optedOut += 1;
        else if (outcome === 'taken') r.alreadyToday += 1;
        else if (outcome !== 'nothing') {
          if (sentAny && lim.gapMs > 0) await sleep(lim.gapMs);
          attempts += 1;
          sentAny = true;
          const res = await outcome.send();
          if (res === 'sent') r.sent += 1;
          else {
            r.failed += 1;
            if (res === 'rate-limit') {
              report.stopped = 'rate-limit';
              break;
            }
          }
        }
      }
    } catch (e) {
      r.status = 'error';
      r.error = 'database call failed';
      log(`app-notify: ${a.slug} failed: ${errorText(e)}`);
    }
    report.sent += r.sent;
    report.failed += r.failed;
  }
  report.ok = report.apps.every((x) => x.status === 'ok' || x.status === 'seeded');
  return report;
}

type Outcome = 'opted-out' | 'taken' | 'nothing' | { send: () => Promise<'sent' | 'failed' | 'rate-limit'> };

/**
 * One person: check the address and the opt-outs, choose the items, claim
 * the day. The returned send() sends and records; it runs after the gap.
 */
async function notifyOne(
  deps: RunDeps,
  a: AppRow,
  feed: readonly FeedItem[],
  person: DueRow,
  ctx: { day: string; hashKey: string; secret: string; logoUrl: string | null; log: (m: string) => void },
): Promise<Outcome> {
  const to = normalizeEmail(person.email);
  const items = chooseItems(feed, Array.isArray(person.item_ids) ? person.item_ids : []);
  if (!to || items.length === 0) return 'nothing';
  const hash = (await hashKeys(ctx.hashKey, { email: to })).email_hash as string;
  if (await isSuppressed(deps.db, hash, [appScope(a.slug)])) return 'opted-out';
  const appUrl = await appOptOutUrl(ctx.secret, a.slug, hash);
  const allUrl = await optOutUrl(ctx.secret, hash);
  if (!appUrl) return 'nothing';
  const claim = await deps.db.rpc<number | string | null>('notify_claim', { p_app: a.slug, p_user_id: person.user_id, p_item_ids: items.map((it) => it.id), p_day: ctx.day });
  if (claim === null || claim === undefined) return 'taken';
  const msg = notifyEmail({ slug: a.slug, displayName: a.display_name }, to, items, { appOptOutUrl: appUrl, optOutUrl: allUrl, logoUrl: ctx.logoUrl });
  return {
    send: async () => {
      let res: SendResult;
      try {
        res = await deps.send(msg);
      } catch (e) {
        res = { ok: false, status: 0, message: errorText(e) };
      }
      try {
        await deps.db.rpc('notify_finish', { p_id: claim, p_resend_id: res.ok ? res.id || null : null, p_error: res.ok ? null : res.message.slice(0, 300) });
      } catch (e) {
        // The row stays pending: its items count as sent, so nobody gets them twice.
        ctx.log(`app-notify: ${a.slug} notify_finish failed for ${shortHash(hash)}: ${errorText(e)}`);
      }
      if (res.ok) return 'sent';
      ctx.log(`app-notify: ${a.slug} send failed for ${shortHash(hash)}: ${res.message}`);
      return res.status === 429 ? 'rate-limit' : 'failed';
    },
  };
}
