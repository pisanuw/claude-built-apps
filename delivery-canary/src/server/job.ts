/**
 * The scheduled run (milestone 5), every JOB_EVERY_MIN minutes from the
 * Netlify Scheduled Function `canary-run`:
 *
 * 1. Looks in the seed inbox for each scheduled canary still waiting for its
 *    email; when found, runs the full delivery-email check on it (the same
 *    engine as the page), saves it to the shop's history and records arrival
 *    time and placement. After NO_EMAIL_AFTER_MIN minutes it is "no email".
 * 2. Claims each due schedule (the database moves its next run on first, so
 *    a schedule runs once per slot however often this runs) and places its
 *    canary order in the shop.
 * 3. Sends the weekly digests that are due.
 *
 * An alert goes out when a canary lands in Spam, its check fails, no email
 * arrives, the order cannot be placed or the schedule cannot run; the
 * database holds the caps and one alert per canary or problem a day.
 * Everything runs inside JOB_BUDGET_MS (a scheduled function has 30 s).
 */
import { NO_EMAIL_AFTER_MIN } from '../core/schedule';
import { analyseEmail } from '../core/email';
import { evaluate, toReport, verdictOf, type EvaluateInput } from '../core/findings';
import { downloadCandidates } from '../core/links';
import type { Finding, LinkResult } from '../core/types';
import type { ClaimedSchedule, DigestDue, JobStore, WaitingCanary } from './jobrest';
import { alertMail, digestMail, unsubscribeUrl, type AlertKind, type Mail } from './mail';
import { open, seedAad, shopAad, unsubToken } from './secretbox';
import { SeedError, type SeedQuery, type SeedResult } from './seed';
import { getToken, placeCanary, ShopifyError } from './shopify';

export const JOB_BUDGET_MS = 25_000;
/** A look (seed check, link test, alert) or a claim is not started with less than this left. */
const STEP_MIN_MS = 12_000;
/** The link test gets less time here than on the page: a slow link in one shop's email must not hold up every other shop's run (security review). */
const LINK_BUDGET_MS = 5_000;
/** Kept back for the database writes and an alert after a link test. */
const AFTER_LINK_MS = 4_500;
/** Kept for the heartbeat at the end. */
const END_RESERVE_MS = 1_500;

export interface JobDeps {
  key: Buffer;
  store: JobStore;
  seedCheck(q: SeedQuery, budgetMs: number): Promise<SeedResult>;
  /** The link test, finished within budgetMs. */
  fetchFile(url: string, budgetMs: number): Promise<LinkResult>;
  /** Sends one email within timeoutMs and returns Resend's id; null when RESEND_API is not set (then no email is sent). */
  send: ((m: Mail, timeoutMs: number) => Promise<string>) | null;
  /** For calls to Shopify (tests pass a scripted Admin API). */
  shopifyFetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface JobSummary {
  looked: number;
  arrived: number;
  noEmail: number;
  claimed: number;
  placed: number;
  skipped: number;
  notPlaced: number;
  alerts: number;
  digests: number;
  errors: number;
}

export const NO_EMAIL_TEXT = `No download email reached the seed inbox within ${NO_EMAIL_AFTER_MIN} minutes of the canary order. Check the order in Shopify: if your delivery app sent nothing, it may ignore orders made from drafts; if it did send, look for it in the seed inbox and check the sender in Delivery Canary's seed inbox card.`;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function runJob(d: JobDeps, budgetMs = JOB_BUDGET_MS): Promise<JobSummary> {
  const now = d.now ?? Date.now;
  const log = d.log ?? (() => undefined);
  const end = now() + budgetMs;
  const left = () => end - now();
  const s: JobSummary = { looked: 0, arrived: 0, noEmail: 0, claimed: 0, placed: 0, skipped: 0, notPlaced: 0, alerts: 0, digests: 0, errors: 0 };

  async function alert(shopId: string, dedupe: string, a: { kind: AlertKind; orderName: string; product: string; detail: string; findings: Finding[] }): Promise<void> {
    if (!d.send) return;
    try {
      const r = await d.store.reserve(shopId, 'alert', dedupe);
      if ('skip' in r) return;
      const mail = alertMail({ ...a, to: r.email, shopName: r.shopName, unsubscribeUrl: unsubscribeUrl(unsubToken(d.key, shopId)) });
      let id: string;
      try {
        id = await sendTwice(mail);
      } catch (e) {
        await d.store.done(r.sendId, false, (e as Error).message);
        throw e;
      }
      await d.store.done(r.sendId, true, id);
      s.alerts++;
    } catch (e) {
      s.errors++;
      log(`alert for ${shopId}: ${(e as Error).message}`);
    }
  }

  /**
   * Sends within what is left; a refused or failed send is tried once more
   * when time allows (the canary is already settled, so a lost alert would
   * not come back). The send row is marked failed only after both.
   */
  async function sendTwice(mail: Mail): Promise<string> {
    const attempt = () => d.send!(mail, Math.max(1000, Math.min(6000, left() - END_RESERVE_MS)));
    try {
      return await attempt();
    } catch (first) {
      if (left() < END_RESERVE_MS + 3000) throw first;
      return attempt();
    }
  }

  /** The kept seed password, opened; a plain-words problem when it cannot be. */
  function seedPassword(userId: string, shopId: string, seed: WaitingCanary['seed']): { password: string } | { problem: string } {
    if (!seed) return { problem: 'The seed inbox is not set up any more, so the email could not be looked for.' };
    const opened = seed.secret ? open(d.key, seed.secret, seedAad(userId, shopId, seed.address, seed.sender)) : null;
    if (!opened) return { problem: 'No app password is kept for the seed inbox (or it was kept for another address or sender), so the schedule cannot look for the email. Tick "Keep the app password" in the seed inbox card.' };
    return { password: opened };
  }

  async function look(w: WaitingCanary): Promise<void> {
    s.looked++;
    const overdue = now() - Date.parse(w.placedAt) > NO_EMAIL_AFTER_MIN * 60_000;
    const giveUp = async (detail: string) => {
      if (!overdue) {
        await d.store.update(w.canaryId, { error: detail.slice(0, 500) });
        return;
      }
      await d.store.update(w.canaryId, { status: 'no-email', error: detail.slice(0, 500) });
      s.noEmail++;
      if (w.alerts) await alert(w.shopId, `c:${w.canaryId}`, { kind: 'no-email', orderName: w.orderName, product: w.variantTitle, detail, findings: [] });
    };
    const pw = seedPassword(w.userId, w.shopId, w.seed);
    if ('problem' in pw) return giveUp(pw.problem);
    let res: SeedResult;
    try {
      res = await d.seedCheck({ address: w.seed!.address, password: pw.password, sender: w.seed!.sender, subject: w.seed!.subject, days: 2, after: w.placedAt }, Math.min(7500, left() - 4000));
    } catch (e) {
      return giveUp(`The seed inbox could not be checked: ${e instanceof SeedError ? e.message : 'the check failed'}`);
    }
    if (!res.found) return overdue ? giveUp(NO_EMAIL_TEXT) : undefined;

    const transit = Math.round((Date.parse(res.receivedAt) - Date.parse(w.placedAt)) / 1000);
    const arrived = { status: 'arrived' as const, arrived_at: res.receivedAt || null, transit_seconds: Number.isFinite(transit) ? Math.max(0, transit) : null, placement: res.placement, seed_where: res.where, error: '' };
    let input: EvaluateInput;
    try {
      const raw = Buffer.from(res.raw, 'base64');
      const analysis = await analyseEmail(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
      const best = downloadCandidates(analysis.links)[0];
      let link: LinkResult | null = null;
      let linkSkipped = '';
      if (best) {
        try {
          link = await d.fetchFile(best.url, Math.max(1000, Math.min(LINK_BUDGET_MS, left() - AFTER_LINK_MS)));
        } catch {
          linkSkipped = 'The link test could not run.';
        }
      }
      input = { analysis, placement: res.placement, link, linkSkipped, baseline: w.baseline, seed: { where: res.where, receivedAt: res.receivedAt } };
    } catch {
      await d.store.update(w.canaryId, { ...arrived, error: 'The email arrived but could not be read for the full check.' });
      s.arrived++;
      if (w.alerts && res.placement === 'spam') await alert(w.shopId, `c:${w.canaryId}`, { kind: 'spam', orderName: w.orderName, product: w.variantTitle, detail: '', findings: [] });
      return;
    }
    const findings = evaluate(input);
    const verdict = verdictOf(findings);
    await d.store.update(w.canaryId, arrived, { verdict, placement: res.placement, subject: input.analysis.subject, report: toReport(input, findings) });
    s.arrived++;
    if (!w.alerts) return;
    if (res.placement === 'spam') await alert(w.shopId, `c:${w.canaryId}`, { kind: 'spam', orderName: w.orderName, product: w.variantTitle, detail: '', findings });
    else if (verdict === 'fail') await alert(w.shopId, `c:${w.canaryId}`, { kind: 'failed-check', orderName: w.orderName, product: w.variantTitle, detail: '', findings });
  }

  /** What stops a claimed schedule from running, in plain words, or the opened credentials. */
  function ready(c: ClaimedSchedule): { problem: string } | { clientSecret: string; canaryEmail: string } {
    if (!c.variantId) return { problem: 'Pick the canary product in the schedule card.' };
    const conn = c.connection;
    if (!conn) return { problem: 'The shop is not connected to Shopify any more. Connect it again in Delivery Canary.' };
    if (!conn.canaryEmail) return { problem: 'Set up the seed inbox, then connect the shop again: canaries only go to the seed address saved when the shop was connected.' };
    const secret = open(d.key, conn.secret, shopAad(c.userId, c.shopId, conn.domain, conn.clientId, conn.canaryEmail));
    if (secret === null) return { problem: 'The kept Shopify app secret can no longer be read. Connect the shop again.' };
    if (!c.seed || c.seed.address.toLowerCase() !== conn.canaryEmail.toLowerCase()) {
      return { problem: `The seed inbox address changed since the shop was connected (canaries go to ${conn.canaryEmail}). Connect the shop again.` };
    }
    const pw = seedPassword(c.userId, c.shopId, c.seed);
    if ('problem' in pw) return pw;
    return { clientSecret: secret, canaryEmail: conn.canaryEmail };
  }

  async function runSchedule(c: ClaimedSchedule): Promise<void> {
    s.claimed++;
    const r = ready(c);
    if ('problem' in r) {
      s.skipped++;
      await d.store.outcome(c.shopId, `Not run: ${r.problem}`);
      if (c.alerts) await alert(c.shopId, `run:${c.shopId}:${day(now())}`, { kind: 'cannot-run', orderName: '', product: c.variantTitle, detail: r.problem, findings: [] });
      return;
    }
    const started = await d.store.start(c.shopId, c.variantId!, c.variantTitle);
    if ('error' in started) {
      s.skipped++;
      const why =
        started.error === 'busy'
          ? 'another canary of this shop is still being placed; trying again in 15 minutes.'
          : started.error === 'limited'
            ? `${started.message ?? 'the daily canary limit was reached.'} This slot is skipped.`
            : 'the schedule was turned off.';
      await d.store.outcome(c.shopId, `Skipped: ${why}`);
      if (started.error === 'limited' && c.alerts) {
        await alert(c.shopId, `run:${c.shopId}:${day(now())}`, { kind: 'cannot-run', orderName: '', product: c.variantTitle, detail: `This slot was skipped: ${started.message ?? 'the daily limit of 5 canary orders was reached'}.`, findings: [] });
      }
      return;
    }
    const conn = c.connection!;
    const deps = { fetchImpl: d.shopifyFetch, deadline: now() + Math.min(9000, left() - 2500), now };
    try {
      const t = await getToken({ domain: conn.domain, clientId: conn.clientId, clientSecret: r.clientSecret }, deps);
      const placed = await placeCanary(conn.domain, t.accessToken, c.variantId!, r.canaryEmail, deps);
      await d.store.update(started.id, { status: 'placed', order_id: placed.orderId, order_name: placed.orderName, placed_at: placed.placedAt, variant_title: placed.variantTitle || c.variantTitle });
      await d.store.outcome(c.shopId, `Placed canary ${placed.orderName}; looking for its email.`);
      s.placed++;
    } catch (e) {
      const msg = e instanceof ShopifyError ? e.message : 'The canary order could not be placed.';
      const unknown = e instanceof ShopifyError && e.code === 'unknown';
      s.notPlaced++;
      await d.store.update(started.id, { status: unknown ? 'unknown' : 'failed', error: msg.slice(0, 500) });
      await d.store.outcome(c.shopId, `Not placed: ${msg}`);
      if (c.alerts) {
        const detail = unknown ? `${msg} Look in Shopify for an order tagged "delivery-canary".` : msg;
        await alert(c.shopId, `c:${started.id}`, { kind: 'not-placed', orderName: '', product: c.variantTitle, detail, findings: [] });
      }
    }
  }

  async function digest(g: DigestDue): Promise<void> {
    const r = await d.store.reserve(g.shopId, 'digest', `d:${g.shopId}:${day(now())}`);
    if ('skip' in r) return;
    const mail = digestMail({
      to: r.email,
      shopName: r.shopName || g.shopName,
      canaries: g.canaries.map((c) => ({ created_at: c.created_at, status: c.status, placement: (c.placement ?? null) as never, transit_seconds: c.transit_seconds })),
      checks: g.checks.map((c) => ({ created_at: c.created_at, verdict: c.verdict, placement: c.placement as never })),
      now: new Date(now()),
      unsubscribeUrl: unsubscribeUrl(unsubToken(d.key, g.shopId)),
    });
    try {
      await d.store.done(r.sendId, true, await sendTwice(mail));
      s.digests++;
    } catch (e) {
      await d.store.done(r.sendId, false, (e as Error).message);
      throw e;
    }
  }

  const step = async (what: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      s.errors++;
      log(`${what}: ${(e as Error).message}`);
    }
  };

  await step('waiting', async () => {
    for (const w of await d.store.waiting()) {
      if (left() < STEP_MIN_MS) break;
      await step(`look ${w.canaryId}`, () => look(w));
    }
  });
  await step('claim', async () => {
    while (left() >= STEP_MIN_MS) {
      const c = await d.store.claim();
      if (!c) break;
      await step(`schedule ${c.shopId}`, () => runSchedule(c));
    }
  });
  if (d.send) {
    await step('digests', async () => {
      for (const g of await d.store.digestDue()) {
        if (left() < END_RESERVE_MS + 3000) break;
        await step(`digest ${g.shopId}`, () => digest(g));
      }
    });
  }
  await step('heartbeat', () => d.store.heartbeat({ ...s }));
  return s;
}
