import { runChecks } from './checks';
import { classify } from './classify';
import { moreProducts, OWNER_PAGES, planFromHome } from './discover';
import { allowed, parseRobots } from './robots';
import type { Feed, MerchantSettings, PageError, PageFacts, PageKind, ScanResult } from './types';
import { normalizeSiteUrl, pageKey, sameSite } from './urls';

/**
 * One check of a store, start to finish: read robots.txt and the home page,
 * pick the pages a reviewer would open, read them a few at a time, then run
 * the cross-page comparison.
 */

export interface Fetcher {
  /** Read one page of the store into facts, or say why it could not be read. */
  page(url: string): Promise<PageFacts | PageError>;
  /** The store's robots.txt text, or null when it has none. */
  robots(site: string): Promise<string | null>;
}

export interface Progress {
  done: number;
  total: number;
  url: string;
}

export interface ScanOptions {
  site: string;
  fetcher: Fetcher;
  feed?: Feed;
  settings?: MerchantSettings;
  now?: () => Date;
  maxPages?: number;
  maxProducts?: number;
  concurrency?: number;
  /** Pause between page loads in each lane, to be gentle on the store. */
  delayMs?: number;
  onProgress?: (p: Progress) => void;
}

export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

export const isError = (r: PageFacts | PageError): r is PageError => 'error' in r;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scanStore(opts: ScanOptions): Promise<ScanResult> {
  const site = normalizeSiteUrl(opts.site);
  const now = opts.now ?? (() => new Date());
  const maxPages = opts.maxPages ?? 50;
  const maxProducts = opts.maxProducts ?? 15;
  const lanes = Math.max(1, opts.concurrency ?? 3);
  const delay = opts.delayMs ?? 0;

  let robotsText: string | null = null;
  try {
    robotsText = await opts.fetcher.robots(site);
  } catch {
    robotsText = null;
  }
  const robots = parseRobots(robotsText ?? '');

  const pages: PageFacts[] = [];
  const errors: PageError[] = [];
  const skippedByRobots: string[] = [];
  const readDespiteRobots: string[] = [];
  const done = new Set<string>();
  let total = 1;
  let count = 0;
  const progress = (url: string) => opts.onProgress?.({ done: count, total, url });

  progress(site);
  const home = await opts.fetcher.page(site);
  count++;
  if (isError(home)) throw new ScanError(`The home page could not be read: ${home.error}`);
  pages.push(home);
  done.add(pageKey(home.url));
  done.add(pageKey(site));
  progress(home.url);

  const finish = (): ScanResult => ({
    site,
    checkedAt: now().toISOString(),
    pages,
    errors,
    skippedByRobots,
    readDespiteRobots,
    feed: opts.feed ? { items: opts.feed.items.length, format: opts.feed.format, warnings: opts.feed.warnings } : undefined,
    findings: runChecks({ pages, errors, feed: opts.feed, settings: opts.settings }),
  });
  if (home.blocked) return finish();

  const plan = planFromHome(home, { products: maxProducts });
  const linked = new Set(home.links.map((l) => l.url));
  const feedLinks = (opts.feed?.items ?? []).map((i) => i.link).filter((l) => l && sameSite(l, site));
  const products = [...new Set([...feedLinks, ...plan.products])].slice(0, maxProducts);

  type Job = { url: string; kind: PageKind; guessed: boolean };
  const jobs: Job[] = [];
  const queue = (url: string, kind: PageKind) => {
    const k = pageKey(url);
    if (done.has(k) || jobs.some((j) => pageKey(j.url) === k)) return;
    const ok = allowed(robots, url);
    if (!ok && !OWNER_PAGES.includes(kind)) {
      if (!skippedByRobots.includes(url)) skippedByRobots.push(url);
      return;
    }
    if (pages.length + errors.length + jobs.length >= maxPages) return;
    if (!ok) readDespiteRobots.push(url);
    jobs.push({ url, kind, guessed: !linked.has(url) && !feedLinks.includes(url) });
  };

  const run = async (batch: Job[]) => {
    total += batch.length;
    let next = 0;
    const lane = async () => {
      while (next < batch.length) {
        const job = batch[next++];
        progress(job.url);
        const r = await opts.fetcher.page(job.url).catch((e: unknown): PageError => ({ url: job.url, error: e instanceof Error ? e.message : 'Could not be read.' }));
        count++;
        done.add(pageKey(job.url));
        if (isError(r)) errors.push({ ...r, kind: job.kind, guessed: job.guessed });
        else if (r.status >= 400) errors.push({ url: job.url, error: `The page answered with error ${r.status}.`, status: r.status, kind: job.kind, guessed: job.guessed });
        else if (!done.has(pageKey(r.url)) || pageKey(r.url) === pageKey(job.url)) {
          done.add(pageKey(r.url));
          pages.push(r.kind === 'other' && job.kind !== 'other' ? { ...r, kind: job.kind } : r);
        }
        progress(job.url);
        if (delay && next < batch.length) await sleep(delay);
      }
    };
    await Promise.all(Array.from({ length: Math.min(lanes, batch.length) }, lane));
  };

  for (const u of plan.info) queue(u, classify(u, home.links.find((l) => l.url === u)?.text));
  for (const u of plan.listings) queue(u, 'listing');
  for (const u of products) queue(u, 'product');
  const first = jobs.splice(0);
  await run(first);

  const haveProducts = pages.filter((p) => p.kind === 'product').length + errors.filter((e) => e.kind === 'product').length;
  if (haveProducts < maxProducts) {
    const have = new Set(pages.map((p) => p.url).concat(errors.map((e) => e.url)));
    for (const u of moreProducts(pages.filter((p) => p.kind === 'listing' || p.kind === 'home'), have, maxProducts - haveProducts)) queue(u, 'product');
    await run(jobs.splice(0));
  }
  return finish();
}
