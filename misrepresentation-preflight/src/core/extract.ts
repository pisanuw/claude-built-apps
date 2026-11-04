import { classify } from './classify';
import { findRiskyClaims } from './claims';
import { decodeEntities, jsonLd, readPage, sentences } from './html';
import { findAddresses, findEmails, findNames, findPhones } from './identity';
import { readProducts } from './products';
import type { PageFacts, Platform } from './types';
import { cleanUrl, sameSite } from './urls';
import { findFreeShipping, findReturns, findShipping } from './windows';

/** Signs that the server sent a bot check or a locked store instead of the page. */
export function blockedReason(html: string, title: string, url: string): string | undefined {
  if (/just a moment|attention required!? \| cloudflare|access denied|pardon our interruption|request unsuccessful/i.test(title) || /cf-chl-|challenge-platform|_Incapsula_Resource/i.test(html.slice(0, 20000))) {
    return 'The store’s bot protection answered instead of the page, so this page could not be read.';
  }
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    // keep empty
  }
  if (path === '/password' || /<form[^>]+action="\/password"/i.test(html)) {
    return 'The store is password protected, so only its password page could be read. Remove the password (Online Store > Preferences in Shopify) before Google reviews it.';
  }
  return undefined;
}

const MAX_LINKS = 400;

export function detectPlatform(html: string): Platform | undefined {
  const head = html.slice(0, 200_000);
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(head)) return 'Shopify';
  if (/woocommerce/i.test(head)) return 'WooCommerce';
  if (/static\.wixstatic\.com|wix-warmup-data|_wixCIDX/i.test(head)) return 'Wix';
  if (/static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/i.test(head)) return 'Squarespace';
  if (/cdn\d*\.bigcommerce\.com|BCData/i.test(head)) return 'BigCommerce';
  return undefined;
}

/** Read one page into the facts the cross-page checks compare. */
export function extractFacts(html: string, url: string, status: number): PageFacts {
  const doc = readPage(html);
  const ld = jsonLd(doc.root);
  const said = sentences(doc.lines);
  const links: PageFacts['links'] = [];
  const seen = new Set<string>();
  for (const a of doc.root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^(mailto|tel|javascript|sms):/i.test(href)) continue;
    const clean = cleanUrl(href, url);
    if (!clean || !sameSite(clean, url) || seen.has(clean)) continue;
    seen.add(clean);
    links.push({ url: clean, text: decodeEntities(a.text).replace(/\s+/g, ' ').trim().slice(0, 80) });
    if (links.length >= MAX_LINKS) break;
  }
  const products = readProducts(doc.root, ld);
  const kind = classify(url, doc.title);
  return {
    url,
    status,
    kind,
    title: doc.title,
    links,
    emails: findEmails(doc.root, doc.lines),
    phones: findPhones(doc.root, doc.lines),
    names: findNames(doc.root, doc.footerLines, doc.lines, ld),
    addresses: findAddresses(doc.root, doc.lines, ld),
    shipping: findShipping(said),
    returns: findReturns(said),
    freeShipping: findFreeShipping(said),
    offers: kind === 'product' || products.productSchemaCount > 0 ? products.offers : [],
    structuredPrices: products.structuredPrices,
    productSchemaCount: products.productSchemaCount,
    risky: findRiskyClaims(said),
    platform: detectPlatform(html),
    blocked: blockedReason(html, doc.title, url),
  };
}
